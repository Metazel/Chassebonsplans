"""Recette navigateur de Chasse aux bons plans (Playwright, Chromium sans interface).

Sert dist/ avec un petit serveur statique intégré, puis joue les scénarios métier sur un
téléphone simulé. Usage : npm run build && python3 e2e/run_e2e.py [--shots DOSSIER]
Prérequis : pip install -r e2e/requirements.txt && python -m playwright install chromium.
axe-core est lu dans node_modules ou via $AXE_PATH.
"""

from __future__ import annotations

import functools
import json
import os
import sys
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import Browser, Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = "http://127.0.0.1:4173/"
PHONE = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2, "is_mobile": True, "has_touch": True, "locale": "fr-FR", "timezone_id": "Europe/Paris"}
SHOTS = Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
AXE = Path(os.environ.get("AXE_PATH", ROOT / "node_modules" / "axe-core" / "axe.min.js"))

results: list[tuple[str, bool, str]] = []
EXTERNES: list[str] = []  # toutes les requêtes vers un tiers, tous scénarios confondus (EXG-01, EXG-05)


def scenario(name: str):
    def wrap(fn):
        def run(*args, **kwargs):
            t0 = time.perf_counter()
            try:
                fn(*args, **kwargs)
                results.append((name, True, f"{(time.perf_counter() - t0):.1f}s"))
            except Exception as exc:  # noqa: BLE001 - chaque échec est rapporté
                results.append((name, False, f"{type(exc).__name__}: {exc}".splitlines()[0][:300]))
                print(traceback.format_exc().replace("::", ": :"), file=sys.stderr, flush=True)
        return run
    return wrap


def shot(page: Page, name: str) -> None:
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)


def new_page(browser: Browser, **extra) -> tuple[Page, list[str], list[str]]:
    ctx = browser.new_context(**{**PHONE, **extra})
    errors: list[str] = []
    external: list[str] = []

    def route(r):
        if r.request.url.startswith(URL):
            r.continue_()
        else:  # EXG-01 / EXG-05 : aucune requête vers un tiers
            external.append(r.request.url)
            EXTERNES.append(r.request.url)
            r.abort()

    ctx.route("**/*", route)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.goto(URL)
    return page, errors, external


def saisir_train(page: Page, rang: int, depart: str, arrivee: str, prix: str) -> None:
    groupe = page.get_by_role("group", name=f"Train {rang}")
    groupe.get_by_label("Départ").fill(depart)
    groupe.get_by_label("Arrivée en gare").fill(arrivee)
    groupe.get_by_label("Prix du billet (€)").fill(prix)


def axe(page: Page) -> list[str]:
    page.add_script_tag(path=str(AXE))
    res = page.evaluate("""async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] })).violations
        .map(v => `${v.id}: ${v.nodes.length} élément(s)`)""")
    return res


@scenario("CU4 — cas de référence « le sandwich » : le train plus tôt est recommandé")
def sandwich(browser: Browser) -> None:
    page, errors, external = new_page(browser)
    saisir_train(page, 1, "19:00", "22:00", "30")
    saisir_train(page, 2, "17:45", "20:45", "40")
    reco = page.locator(".reco")
    expect(reco).to_contain_text("train 2 (17:45)")
    expect(page.locator(".resultat")).to_contain_text("vous ramène à 22:15 au lieu de 21:00")
    ligne = page.locator("tr.retenu")
    expect(ligne).to_contain_text("aucun")
    shot(page, "sandwich")
    assert not errors, errors
    assert not external, external


@scenario("CU4 — au-delà de la tolérance, le moins cher l'emporte")
def moins_cher(browser: Browser) -> None:
    page, errors, _ = new_page(browser)
    saisir_train(page, 1, "19:00", "22:00", "30")
    saisir_train(page, 2, "17:45", "20:45", "45")
    expect(page.locator(".reco")).to_contain_text("train 1 (19:00)")
    expect(page.locator(".resultat")).to_contain_text("coût complet le plus bas")
    assert not errors, errors


@scenario("Saisie invalide : erreur liée au champ, sans recommandation fausse")
def saisie_invalide(browser: Browser) -> None:
    page, errors, _ = new_page(browser)
    saisir_train(page, 1, "19:00", "22:00", "trente")
    champ = page.get_by_role("group", name="Train 1").get_by_label("Prix du billet (€)")
    page.keyboard.press("Tab")  # l'erreur s'affiche à la sortie du champ
    expect(champ).to_have_attribute("aria-invalid", "true")
    described = champ.get_attribute("aria-describedby") or ""
    expect(page.locator(f"#{described.split()[-1]}")).to_contain_text("Prix invalide")
    expect(page.locator(".resultat")).to_contain_text("Saisissez au moins deux trains")
    expect(page.locator(".avertissements")).to_contain_text("Train 1 à corriger")
    assert not errors, errors


@scenario("Train incomplet : signalé et exclu, pas de recommandation trompeuse")
def train_incomplet(browser: Browser) -> None:
    page, errors, _ = new_page(browser)
    saisir_train(page, 1, "19:00", "22:00", "30")
    saisir_train(page, 2, "17:45", "20:45", "40")
    page.get_by_role("button", name="Ajouter un train").click()
    page.get_by_role("group", name="Train 3").get_by_label("Prix du billet (€)").fill("5")
    expect(page.locator(".avertissements")).to_contain_text("Train 3 incomplet")
    expect(page.locator(".reco")).to_contain_text("train 2 (17:45)")
    assert not errors, errors


@scenario("Réglage invalide : calcul suspendu, pas de valeur par défaut cachée")
def reglage_invalide(browser: Browser) -> None:
    page, errors, _ = new_page(browser)
    saisir_train(page, 1, "19:00", "22:00", "30")
    saisir_train(page, 2, "17:45", "20:45", "40")
    page.get_by_text("Réglages du coût complet").click()
    page.get_by_label("Écart toléré (€)").fill("abc")
    expect(page.locator(".reco")).to_contain_text("Corrigez les réglages")
    expect(page.locator("table")).to_have_count(0)
    assert not errors, errors


@scenario("Réglages : changer l'heure limite du dîner change la recommandation")
def reglages(browser: Browser) -> None:
    page, errors, _ = new_page(browser)
    saisir_train(page, 1, "19:00", "22:00", "30")
    saisir_train(page, 2, "17:45", "20:45", "40")
    page.get_by_text("Réglages du coût complet").click()
    page.get_by_label("Dîner à la maison jusqu’à").fill("23:00")
    expect(page.locator(".reco")).to_contain_text("train 1 (19:00)")
    assert not errors, errors


@scenario("Ajouter puis retirer un train : le focus suit (RGAA 12.8)")
def ajout_retrait(browser: Browser) -> None:
    page, errors, _ = new_page(browser)
    page.get_by_role("button", name="Ajouter un train").click()
    expect(page.get_by_role("group", name="Train 3")).to_be_visible()
    expect(page.get_by_role("group", name="Train 3").get_by_label("Départ")).to_be_focused()
    page.get_by_role("button", name="Retirer le train 3").click()
    expect(page.get_by_role("group", name="Train 3")).to_have_count(0)
    expect(page.get_by_role("button", name="Ajouter un train")).to_be_focused()
    for _ in range(4):
        page.get_by_role("button", name="Ajouter un train").click()
    expect(page.get_by_role("group", name="Train 6").get_by_label("Départ")).to_be_focused()
    expect(page.get_by_role("button", name="Ajouter un train")).to_have_count(0)
    assert not errors, errors


@scenario("RGAA — axe-core sans violation, thème clair et sombre")
def accessibilite(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        page, errors, _ = new_page(browser, color_scheme=scheme, bypass_csp=True)  # injection d'axe-core
        saisir_train(page, 1, "19:00", "22:00", "30")
        saisir_train(page, 2, "17:45", "20:45", "40")
        page.get_by_text("Réglages du coût complet").click()
        violations = axe(page)
        shot(page, f"axe-{scheme}")
        assert not violations, f"{scheme}: {violations}"
        assert not errors, errors


@scenario("RGAA — 320 px de large, puis texte à 200 % : pas de défilement horizontal")
def reflow(browser: Browser) -> None:
    sans_defilement = "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
    page, errors, _ = new_page(browser, viewport={"width": 320, "height": 640}, bypass_csp=True)  # style de test injecté
    saisir_train(page, 1, "19:00", "22:00", "30")
    saisir_train(page, 2, "17:45", "20:45", "40")
    shot(page, "reflow-320")
    assert page.evaluate(sans_defilement), "défilement horizontal à 320 px"
    page.set_viewport_size({"width": 640, "height": 800})
    page.add_style_tag(content="html { font-size: 200% !important; }")
    shot(page, "texte-200")
    assert page.evaluate(sans_defilement), "défilement horizontal avec le texte à 200 %"
    assert not errors, errors


@scenario("Clavier : lien d'évitement puis champs atteignables dans l'ordre")
def clavier(browser: Browser) -> None:
    page, errors, _ = new_page(browser, is_mobile=False, has_touch=False)
    page.keyboard.press("Tab")
    expect(page.get_by_role("link", name="Aller au contenu")).to_be_focused()
    page.keyboard.press("Tab")
    focused = page.evaluate("document.activeElement.id")
    assert focused.endswith("-dep"), focused
    assert not errors, errors


@scenario("Sécurité — la PWA publiée porte la CSP stricte")
def csp(_browser: Browser) -> None:
    html = (ROOT / "dist" / "index.html").read_text(encoding="utf-8")
    assert 'http-equiv="Content-Security-Policy"' in html, "CSP absente"
    for directive in ("script-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'"):
        assert directive in html, directive
    assert "unsafe-inline" not in html


@scenario("Hors ligne — après une première visite, l'appli s'ouvre sans réseau")
def hors_ligne(browser: Browser) -> None:
    ctx = browser.new_context(**PHONE)
    page = ctx.new_page()
    page.goto(URL)
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.reload()
    assert page.evaluate("navigator.serviceWorker.controller !== null"), "service worker inactif"
    ctx.set_offline(True)
    page.reload()
    expect(page.get_by_role("heading", level=1)).to_contain_text("coût complet")
    ctx.close()


@scenario("Vie privée — aucune requête vers un tiers sur l'ensemble de la recette")
def aucune_requete_tierce(_browser: Browser) -> None:
    assert not EXTERNES, EXTERNES


def serve() -> ThreadingHTTPServer:
    class Silencieux(SimpleHTTPRequestHandler):
        def log_message(self, *_args) -> None:  # noqa: D401 - journal muet
            pass

    handler = functools.partial(Silencieux, directory=str(ROOT / "dist"))
    srv = ThreadingHTTPServer(("127.0.0.1", 4173), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main() -> int:
    if not (ROOT / "dist" / "index.html").exists():
        print("dist/ absent : lancez npm run build", file=sys.stderr)
        return 2
    srv = serve()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for fn in (sandwich, moins_cher, saisie_invalide, train_incomplet, reglage_invalide, reglages, ajout_retrait, accessibilite, reflow, clavier, csp, hors_ligne, aucune_requete_tierce):
                fn(browser)
            browser.close()
    finally:
        srv.shutdown()
    ok = sum(1 for _, passed, _ in results if passed)
    for name, passed, info in results:
        print(f"{'OK ' if passed else 'KO '} {name} ({info})")
    print(json.dumps({"total": len(results), "ok": ok}))
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
