"""Extraction des horaires théoriques Marseille Saint-Charles <-> Paris depuis les GTFS ouverts.

Sources (open data, point d'accès national transport.data.gouv.fr) :
  - SNCF Voyageurs : TGV INOUI, OUIGO, Intercités, TER (licence ODbL) ;
  - Trenitalia France : Frecciarossa.
Le résultat est un JSON compact embarqué dans l'appli : aucune requête réseau depuis le téléphone.
L'extrait dérivé est publié sous la licence de ses sources (ODbL : partage à l'identique).

Usage :
  python3 scripts/extraire_horaires.py --sortie src/data/horaires.json               (télécharge via l'API PAN)
  python3 scripts/extraire_horaires.py --gtfs a.zip --gtfs b.zip --sortie x.json    (fichiers locaux, tests)
Bibliothèque standard uniquement.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import unicodedata
import urllib.request
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

PAN = "https://transport.data.gouv.fr/api/datasets"
JEUX = {
    "horaires-sncf": "SNCF Voyageurs",
    "horaires-des-trains-trenitalia-france": "Trenitalia France",
}
HORIZON_JOURS = 160
TAILLE_MAX = 400 * 1024 * 1024  # garde-fou sur un téléchargement


def normaliser(nom: str) -> str:
    sans_accents = unicodedata.normalize("NFKD", nom).encode("ascii", "ignore").decode()
    return " ".join(sans_accents.lower().replace("-", " ").replace("'", " ").split())


def est_marseille(nom: str) -> bool:
    n = normaliser(nom)
    return n.startswith("marseille") and "charles" in n


def est_paris(nom: str) -> bool:
    return normaliser(nom).startswith("paris")


def lire_csv(z: zipfile.ZipFile, nom: str):
    noms = {Path(n).name: n for n in z.namelist()}
    if nom not in noms:
        return
    with z.open(noms[nom]) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))


def heure(hms: str) -> int:
    """'25:10:00' -> minutes depuis minuit du jour de service (peut dépasser 1440)."""
    h, m, *_ = hms.strip().split(":")
    return int(h) * 60 + int(m)


def jours_service(z: zipfile.ZipFile, debut: date, fin: date) -> dict[str, set[date]]:
    services: dict[str, set[date]] = {}
    noms = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    for r in lire_csv(z, "calendar.txt"):
        d0 = datetime.strptime(r["start_date"], "%Y%m%d").date()
        d1 = datetime.strptime(r["end_date"], "%Y%m%d").date()
        jours = services.setdefault(r["service_id"], set())
        j = max(d0, debut)
        while j <= min(d1, fin):
            if r[noms[j.weekday()]] == "1":
                jours.add(j)
            j += timedelta(days=1)
    for r in lire_csv(z, "calendar_dates.txt"):
        j = datetime.strptime(r["date"], "%Y%m%d").date()
        if not (debut <= j <= fin):
            continue
        jours = services.setdefault(r["service_id"], set())
        if r["exception_type"] == "1":
            jours.add(j)
        elif r["exception_type"] == "2":
            jours.discard(j)
    return services


def extraire(z: zipfile.ZipFile, source: str, debut: date, fin: date) -> list[dict]:
    noms_arrets = {}
    for r in lire_csv(z, "stops.txt"):
        noms_arrets[r["stop_id"]] = r.get("stop_name", "")
    marseille = {s for s, n in noms_arrets.items() if est_marseille(n)}
    paris = {s for s, n in noms_arrets.items() if est_paris(n)}
    if not marseille or not paris:
        return []

    # Premier passage aux gares d'intérêt pour chaque course : (séquence, heure, gare).
    passages: dict[str, dict[str, tuple[int, int, str]]] = {}
    for r in lire_csv(z, "stop_times.txt"):
        s = r["stop_id"]
        cote = "M" if s in marseille else "P" if s in paris else None
        if not cote:
            continue
        seq = int(r["stop_sequence"])
        p = passages.setdefault(r["trip_id"], {})
        hd = r.get("departure_time") or r.get("arrival_time") or ""
        ha = r.get("arrival_time") or r.get("departure_time") or ""
        if not hd:
            continue
        # Premier passage (plus petite séquence) pour partir, dernier (plus grande) pour arriver,
        # quel que soit l'ordre des lignes dans stop_times.txt.
        if cote + "d" not in p or seq < p[cote + "d"][0]:
            p[cote + "d"] = (seq, heure(hd), noms_arrets[s], s)
        if cote + "a" not in p or seq > p[cote + "a"][0]:
            p[cote + "a"] = (seq, heure(ha), noms_arrets[s], s)

    agences = {r.get("agency_id", ""): r.get("agency_name", "") for r in lire_csv(z, "agency.txt")}
    lignes = {}
    for r in lire_csv(z, "routes.txt"):
        lignes[r["route_id"]] = {
            "agence": agences.get(r.get("agency_id", ""), "") or (next(iter(agences.values()), "") if len(agences) == 1 else ""),
            "nom": r.get("route_short_name") or r.get("route_long_name") or "",
            "type": r.get("route_desc", ""),
        }
    services = jours_service(z, debut, fin)

    trains = []
    for r in lire_csv(z, "trips.txt"):
        p = passages.get(r["trip_id"])
        if not p or not ({"Md", "Pa"} <= p.keys() or {"Pd", "Ma"} <= p.keys()):
            continue
        for sens, dep_cle, arr_cle in (("MP", "Md", "Pa"), ("PM", "Pd", "Ma")):
            if dep_cle in p and arr_cle in p and p[dep_cle][0] < p[arr_cle][0]:
                jours = sorted(services.get(r["service_id"], set()))
                if not jours:
                    continue
                ligne = lignes.get(r["route_id"], {})
                # Trenitalia France : le numéro commercial est l'identifiant de ligne (6119, 6105…).
                num = r["route_id"].strip()[:12] if source == "Trenitalia France" else numero(r)
                if not num:
                    continue  # sans numéro, le voyageur ne pourrait pas retrouver le train à la vente
                trains.append({
                    "sens": sens,
                    "numero": num,
                    "operateur": operateur(source, ligne, r, p[dep_cle][3]),
                    "gareDepart": p[dep_cle][2],
                    "gareArrivee": p[arr_cle][2],
                    "depart": p[dep_cle][1],
                    "arrivee": p[arr_cle][1],
                    "jours": [j.isoformat() for j in jours],
                })
    return trains


def derniere_date(trains: list[dict], debut: date) -> date:
    return max((date.fromisoformat(j) for t in trains for j in t["jours"]), default=debut)


def numero(trip: dict) -> str:
    """Numéro commercial : trip_short_name, sinon trip_headsign numérique, sinon chiffres finaux du trip_id."""
    for cle in ("trip_short_name", "trip_headsign"):
        v = (trip.get(cle) or "").strip()
        if v and any(c.isdigit() for c in v) and len(v) <= 12:
            return v
    import re
    m = re.search(r"(?<!\d)(\d{3,5})(?!\d)", trip.get("trip_id", ""))
    return m.group(1) if m else ""


def operateur(source: str, ligne: dict, trip: dict, stop_id: str = "") -> str:
    if source == "Trenitalia France":
        return "Trenitalia (Frecciarossa)"
    # Dans le GTFS SNCF, l'identifiant d'arrêt porte le transporteur : StopPoint:OCEOUIGO-…, OCETGV INOUI-…
    sid = stop_id.upper()
    if "OUIGO" in sid:
        return "OUIGO"
    if "INTERCIT" in sid:
        return "Intercités"
    if "TGV INOUI" in sid or "OCETGV" in sid:
        return "TGV INOUI"
    texte = normaliser(" ".join([ligne.get("agence", ""), ligne.get("nom", ""), ligne.get("type", ""), trip.get("trip_headsign", "")]))
    if "ouigo" in texte:
        return "OUIGO"
    if "intercite" in texte:
        return "Intercités"
    if "ter" in texte.split():
        return "TER"
    return "TGV INOUI"


def regrouper(trains: list[dict], debut: date) -> list[dict]:
    """Fusionne les courses identiques ; jours codés en décalage depuis la date de début (JSON compact)."""
    groupes: dict[tuple, set[int]] = {}
    for t in trains:
        cle = (t["sens"], t["numero"], t["operateur"], t["gareDepart"], t["gareArrivee"], t["depart"], t["arrivee"])
        groupes.setdefault(cle, set()).update((date.fromisoformat(j) - debut).days for j in t["jours"])
    sortie = []
    for (sens, numero, op, gd, ga, dep, arr), jours in sorted(groupes.items(), key=lambda kv: (kv[0][0], kv[0][5], kv[0][1])):
        sortie.append({"s": sens, "n": numero, "o": op, "gd": gd, "ga": ga, "d": dep, "a": arr, "j": sorted(jours)})
    return sortie


_CATALOGUE: list | None = None


def ouvrir(url: str, timeout: int):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "chassebonsplans-horaires"}), timeout=timeout)
    except Exception as exc:  # noqa: BLE001 - l'URL fautive est indispensable au diagnostic
        raise RuntimeError(f"{url} : {exc}") from exc


def jeu(slug: str) -> dict:
    """Fiche d'un jeu de données du point d'accès national, retrouvée par son slug dans le catalogue."""
    global _CATALOGUE
    if _CATALOGUE is None:
        with ouvrir(PAN, 120) as r:
            _CATALOGUE = json.load(r)
    for d in _CATALOGUE:
        if d.get("slug") == slug or d.get("page_url", "").rstrip("/").endswith("/" + slug):
            return d
    raise RuntimeError(f"jeu de données introuvable sur le PAN : {slug}")


def telecharger(slug: str) -> tuple[bytes, dict]:
    meta = jeu(slug)
    gtfs = [res for res in meta.get("resources", []) if str(res.get("format", "")).upper() == "GTFS" and res.get("url")]
    if not gtfs:
        raise RuntimeError(f"aucune ressource GTFS pour {slug}")
    res = gtfs[0]
    with ouvrir(res["url"], 300) as r:
        contenu = r.read(TAILLE_MAX + 1)
    if len(contenu) > TAILLE_MAX:
        raise RuntimeError(f"ressource trop volumineuse : {slug}")
    licence = meta.get("licence") or meta.get("license") or "voir la source"
    print(f"{slug} : {res.get('title', '')} — {res['url']}", file=sys.stderr)
    return contenu, {"nom": JEUX[slug], "url": f"https://transport.data.gouv.fr/datasets/{slug}", "licence": licence}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sortie", required=True)
    ap.add_argument("--gtfs", action="append", default=[], help="fichier GTFS local (nom de source = nom du fichier)")
    ap.add_argument("--debut", help="date de début AAAA-MM-JJ (défaut : aujourd'hui)")
    args = ap.parse_args()
    debut = date.fromisoformat(args.debut) if args.debut else date.today()
    fin = debut + timedelta(days=HORIZON_JOURS)

    trains, sources = [], []
    couverture: dict[str, date] = {}  # dernière date de circulation trouvée, par source
    if args.gtfs:
        for chemin in args.gtfs:
            nom = "Trenitalia France" if "trenitalia" in chemin.lower() else "SNCF Voyageurs"
            with zipfile.ZipFile(chemin) as z:
                trouves = extraire(z, nom, debut, fin)
            trains += trouves
            couverture[nom] = derniere_date(trouves, debut)
            sources.append({"nom": nom, "url": "https://transport.data.gouv.fr", "licence": "fichier local"})
    else:
        for slug in JEUX:
            contenu, meta = telecharger(slug)
            with zipfile.ZipFile(io.BytesIO(contenu)) as z:
                trouves = extraire(z, meta["nom"], debut, fin)
            if not trouves:
                raise RuntimeError(f"aucun train Marseille <-> Paris trouvé dans {slug}")
            trains += trouves
            couverture[meta["nom"]] = derniere_date(trouves, debut)
            sources.append(meta)

    # Chaque source annonce sa propre fin : au-delà, l'appli signale qu'elle manque (liste incomplète)
    # au lieu d'affirmer « aucun train » ; la période globale s'arrête à la source la plus avancée.
    for src in sources:
        src["fin"] = min(fin, couverture[src["nom"]]).isoformat()
    fin = min(fin, max(couverture.values(), default=debut))
    groupes = regrouper(trains, debut)
    sortie = {"version": 1, "genereLe": date.today().isoformat(), "debut": debut.isoformat(), "fin": fin.isoformat(), "sources": sources, "trains": groupes}
    Path(args.sortie).write_text(json.dumps(sortie, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    par_op: dict[str, int] = {}
    for g in groupes:
        par_op[g["o"]] = par_op.get(g["o"], 0) + len(g["j"])
    print(json.dumps({"courses": len(groupes), "circulations_par_operateur": par_op, "couverture": {k: v.isoformat() for k, v in couverture.items()}, "fin": fin.isoformat()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
