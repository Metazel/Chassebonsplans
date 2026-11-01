import { useEffect, useRef, useState } from 'preact/hooks';
import { LEVIERS } from '../data/leviers';
import { aujourdhuiIso, etatValidite, lireProfil, pourStockage, profilVide, rappelSauvegarde, reglagesStockables, type EtatLevier, type Profil } from '../domain/profil';
import type { LigneTrain, Reglages } from '../domain/saisie';
import { CLE_ILLISIBLE, ouvrirStockage, stockageMemoire, type Stockage } from '../state/stockage';
import { Comparateur, REGLAGES_DEFAUT, nouvelleLigne } from './screens/Comparateur';
import { Leviers } from './screens/Leviers';
import { Donnees } from './screens/Donnees';
import { Deplacements, type EtatHoraires } from './screens/Deplacements';
import { purger, type Deplacement } from '../domain/deplacements';
import { lireReglages } from '../domain/saisie';
import { REFERENTIEL_COUT } from '../data/parametres';
import { chargerHoraires } from '../state/horaires';

type Vue = 'deplacements' | 'comparer' | 'leviers' | 'donnees';
const VUES: { id: Vue; libelle: string; titre: string }[] = [
  { id: 'deplacements', libelle: 'Mes déplacements', titre: 'Mes déplacements' },
  { id: 'comparer', libelle: 'Comparer', titre: 'Comparer mes trains' },
  { id: 'leviers', libelle: 'Mes leviers', titre: 'Mes leviers' },
  { id: 'donnees', libelle: 'Mes données', titre: 'Mes données' },
];
const IDS = new Set(LEVIERS.map((l) => l.id));

const lireVue = (h: string): Vue | null => (VUES.some((v) => v.id === h) ? (h as Vue) : null);
const vueDepuisHash = (): Vue => lireVue(location.hash.slice(1)) ?? 'deplacements';

/** Relit et valide le profil stocké ; met de côté une copie brute de ce qui est illisible au lieu de l'écraser. */
async function charger(s: Stockage, aujourdhui: string): Promise<{ profil: Profil; alerte: string | null }> {
  const lu = await lireStocke(s);
  // EXG-03 : les déplacements terminés depuis plus de 24 mois sont effacés à l'ouverture.
  const liste = lu.profil.deplacements;
  if (liste) {
    const gardes = purger(liste, aujourdhui);
    if (gardes.length !== liste.length) {
      const profil: Profil = { ...lu.profil };
      if (gardes.length) profil.deplacements = gardes;
      else delete profil.deplacements;
      await s.ecrire(pourStockage(profil)).catch(() => undefined);
      return { ...lu, profil };
    }
  }
  return lu;
}

async function lireStocke(s: Stockage): Promise<{ profil: Profil; alerte: string | null }> {
  const brut = await s.lire();
  if (brut === null || brut === undefined) return { profil: profilVide(), alerte: null };
  try {
    const { profil, ecartes } = lireProfil(brut, IDS);
    if (!ecartes.length) return { profil, alerte: null };
    await s.ecrire(brut, CLE_ILLISIBLE).catch(() => undefined);
    return { profil, alerte: `Une partie des données enregistrées était illisible et a été écartée (${ecartes.join(', ')}) ; le reste est conservé.` };
  } catch {
    await s.ecrire(brut, CLE_ILLISIBLE).catch(() => undefined);
    return { profil: profilVide(), alerte: 'Les données enregistrées sur cet appareil étaient illisibles : l’outil repart d’un profil vide. Restaurez une sauvegarde si vous en avez une.' };
  }
}

export function App() {
  const [vue, setVue] = useState<Vue>(vueDepuisHash);
  const [stockage, setStockage] = useState<Stockage | null>(null);
  const [profil, setProfilEtat] = useState<Profil>(profilVide);
  const profilRef = useRef<Profil>(profil);
  const [reglages, setReglagesEtat] = useState<Reglages>(REGLAGES_DEFAUT);
  const [alerteLecture, setAlerteLecture] = useState<string | null>(null);
  const [erreurEcriture, setErreurEcriture] = useState(false);
  const [lignes, setLignesEtat] = useState<LigneTrain[]>(() => [nouvelleLigne(), nouvelleLigne()]);
  const premiereVue = useRef(true);
  const aujourdhui = aujourdhuiIso();
  const [horaires, setHoraires] = useState<EtatHoraires>({ etat: 'chargement' });

  useEffect(() => {
    let actif = true;
    chargerHoraires().then(
      (h) => actif && setHoraires({ etat: 'ok', horaires: h }),
      () => actif && setHoraires({ etat: 'erreur' }),
    );
    return () => {
      actif = false;
    };
  }, []);

  const appliquer = (p: Profil) => {
    profilRef.current = p;
    setProfilEtat(p);
  };

  // Chargement : aucune saisie n'est possible avant (pas de course entre lecture et écriture).
  useEffect(() => {
    let actif = true;
    let detacher = () => undefined as void;
    void (async () => {
      const s = await ouvrirStockage().catch(() => stockageMemoire());
      const { profil: p, alerte } = await charger(s, aujourdhuiIso()).catch(() => ({ profil: profilVide(), alerte: 'Lecture des données impossible.' }));
      if (!actif) return;
      appliquer(p);
      setReglagesEtat(p.reglages ?? REGLAGES_DEFAUT);
      setAlerteLecture(alerte);
      setStockage(s);
      // Un autre onglet a modifié les données (dont une suppression) : on relit.
      detacher = s.surChangementExterne(() => {
        void lireStocke(s).then(({ profil: q }) => {
          if (!actif) return;
          appliquer(q);
          setReglagesEtat(q.reglages ?? REGLAGES_DEFAUT);
        });
      });
    })();
    return () => {
      actif = false;
      detacher();
    };
  }, []);

  // Navigation par ancre (#leviers, #donnees) ; titre de page et focus sur le titre de la vue.
  useEffect(() => {
    // Les ancres internes (lien d'évitement #contenu) ne changent pas de vue.
    const surHash = () => {
      const v = lireVue(location.hash.slice(1));
      if (v) setVue(v);
    };
    window.addEventListener('hashchange', surHash);
    // L'ancre a pu changer entre le premier rendu et la pose de l'écouteur : on resynchronise.
    surHash();
    return () => window.removeEventListener('hashchange', surHash);
  }, []);
  useEffect(() => {
    const titre = VUES.find((v) => v.id === vue)?.titre ?? '';
    document.title = `${titre} — Chasse aux bons plans`;
    if (premiereVue.current) {
      premiereVue.current = false;
      return;
    }
    document.getElementById('titre-vue')?.focus();
  }, [vue]);

  /** Applique et enregistre ; seule une version nettoyée et valide est écrite (EXG-02). */
  const enregistrer = (p: Profil): Promise<boolean> => {
    appliquer(p);
    if (!stockage) return Promise.resolve(false);
    return stockage
      .ecrire(pourStockage(p))
      .then(() => {
        setErreurEcriture(false);
        return true;
      })
      .catch(() => {
        setErreurEcriture(true);
        return false;
      });
  };

  const setReglages = (f: (r: Reglages) => Reglages) => {
    const suivant = f(reglages);
    setReglagesEtat(suivant);
    // Un réglage trop long ou suspect reste à l'écran (avec son erreur) mais n'est jamais enregistré.
    if (reglagesStockables(suivant)) void enregistrer({ ...profilRef.current, reglages: suivant });
  };
  const setLevier = (id: string, e: EtatLevier) => {
    const leviers = { ...profilRef.current.leviers };
    if (e.detenu) leviers[id] = e;
    else delete leviers[id];
    void enregistrer({ ...profilRef.current, leviers });
  };

  const setDeplacements = (liste: Deplacement[]) => {
    const p: Profil = { ...profilRef.current };
    if (liste.length) p.deplacements = liste;
    else delete p.deplacements;
    void enregistrer(p);
  };
  const parametres = lireReglages(reglages).parametres ?? REFERENTIEL_COUT.parametres;

  const detenus = LEVIERS.filter((l) => profil.leviers[l.id]?.detenu);
  const expires = detenus.filter((l) => {
    const fin = profil.leviers[l.id]?.finValidite;
    return fin !== undefined && etatValidite(fin, aujourdhui) === 'expire';
  });
  const trainDetenus = detenus.filter((l) => l.categorie === 'train' && !expires.includes(l));

  const resumeLeviers = (
    <p class="resume-leviers">
      {trainDetenus.length
        ? `Vos leviers train : ${trainDetenus.map((l) => l.nom).join(', ')}. Ils seront pris en compte par le simulateur (itération suivante).`
        : 'Aucun levier train déclaré.'}{' '}
      <a href="#leviers">Gérer mes leviers</a>
    </p>
  );

  return (
    <>
      <a class="evitement" href="#contenu">
        Aller au contenu
      </a>
      <header>
        <p class="marque">Chasse aux bons plans</p>
        <nav aria-label="Navigation principale">
          <ul>
            {VUES.map((v) => (
              <li key={v.id}>
                <a href={`#${v.id}`} aria-current={vue === v.id ? 'page' : undefined}>
                  {v.libelle}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="contenu" tabIndex={-1}>
        {alerteLecture && (
          <p class="alerte" role="status">
            {alerteLecture}
          </p>
        )}
        {erreurEcriture && (
          <p class="alerte" role="alert">
            Vos dernières modifications n’ont pas pu être enregistrées sur cet appareil (stockage plein ou indisponible). Téléchargez une sauvegarde depuis
            « Mes données ».
          </p>
        )}
        {expires.length > 0 && vue !== 'leviers' && (
          <p class="alerte" role="status">
            {expires.map((l) => l.nom).join(', ')} : validité dépassée. <a href="#leviers">Mettre à jour</a>
          </p>
        )}
        {rappelSauvegarde(profil, aujourdhui) && vue !== 'donnees' && (
          <p class="rappel">
            Pensez à sauvegarder vos données : <a href="#donnees">télécharger une sauvegarde</a>.
          </p>
        )}
        {!stockage && (
          <p role="status" class="aide">
            Chargement de vos données…
          </p>
        )}
        {stockage && vue === 'deplacements' && (
          <Deplacements deplacements={profil.deplacements ?? []} horaires={horaires} parametres={parametres} aujourdhui={aujourdhui} onChange={setDeplacements} />
        )}
        {stockage && vue === 'comparer' && <Comparateur lignes={lignes} setLignes={setLignesEtat} reglages={reglages} setReglages={setReglages} resumeLeviers={resumeLeviers} />}
        {stockage && vue === 'leviers' && <Leviers profil={profil} aujourdhui={aujourdhui} onChange={setLevier} />}
        {stockage && vue === 'donnees' && (
          <Donnees
            profil={profil}
            mode={stockage.mode}
            aujourdhui={aujourdhui}
            onExporte={() => void enregistrer({ ...profilRef.current, derniereSauvegarde: aujourdhui })}
            onImporte={(p) => {
              setReglagesEtat(p.reglages ?? REGLAGES_DEFAUT);
              // EXG-03 : une sauvegarde ancienne ne réintroduit pas de déplacements de plus de 24 mois.
              const restaure: Profil = { ...p, derniereSauvegarde: aujourdhui };
              const gardes = purger(p.deplacements ?? [], aujourdhui);
              if (gardes.length) restaure.deplacements = gardes;
              else delete restaure.deplacements;
              return enregistrer(restaure);
            }}
            onSupprime={() => {
              appliquer(profilVide());
              setReglagesEtat(REGLAGES_DEFAUT);
              return stockage.effacer().then(
                () => true,
                () => {
                  setErreurEcriture(true);
                  return false;
                },
              );
            }}
          />
        )}
      </main>
      <footer>
        <p>Outil indicatif, non affilié à la SNCF ni aux autres marques citées. Vos saisies restent sur cet appareil : rien n’est envoyé sur Internet.</p>
      </footer>
    </>
  );
}
