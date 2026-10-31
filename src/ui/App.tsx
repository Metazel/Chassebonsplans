import { useEffect, useRef, useState } from 'preact/hooks';
import { LEVIERS } from '../data/leviers';
import { aujourdhuiIso, etatValidite, profilVide, rappelSauvegarde, validerProfil, type EtatLevier, type Profil } from '../domain/profil';
import type { LigneTrain, Reglages } from '../domain/saisie';
import { ouvrirStockage, stockageMemoire, type Stockage } from '../state/stockage';
import { Comparateur, REGLAGES_DEFAUT, nouvelleLigne } from './screens/Comparateur';
import { Leviers } from './screens/Leviers';
import { Donnees } from './screens/Donnees';

type Vue = 'comparer' | 'leviers' | 'donnees';
const VUES: { id: Vue; libelle: string; titre: string }[] = [
  { id: 'comparer', libelle: 'Comparer', titre: 'Comparer mes trains' },
  { id: 'leviers', libelle: 'Mes leviers', titre: 'Mes leviers' },
  { id: 'donnees', libelle: 'Mes données', titre: 'Mes données' },
];
const IDS = new Set(LEVIERS.map((l) => l.id));

const lireVue = (h: string): Vue | null => (h === 'comparer' || h === 'leviers' || h === 'donnees' ? h : null);
const vueDepuisHash = (): Vue => lireVue(location.hash.slice(1)) ?? 'comparer';

export function App() {
  const [vue, setVue] = useState<Vue>(vueDepuisHash);
  const [stockage, setStockage] = useState<Stockage | null>(null);
  const [profil, setProfil] = useState<Profil>(profilVide);
  const [alerteLecture, setAlerteLecture] = useState(false);
  const [lignes, setLignesEtat] = useState<LigneTrain[]>(() => [nouvelleLigne(), nouvelleLigne()]);
  const premiereVue = useRef(true);
  const aujourdhui = aujourdhuiIso();

  // Chargement du profil local, validé ; un profil illisible n'est jamais utilisé tel quel.
  useEffect(() => {
    let actif = true;
    void (async () => {
      const s = await ouvrirStockage().catch(() => stockageMemoire());
      let p = profilVide();
      try {
        const brut = await s.lire();
        if (brut !== null && brut !== undefined) p = validerProfil(brut, IDS);
      } catch {
        if (actif) setAlerteLecture(true);
      }
      if (actif) {
        setStockage(s);
        setProfil(p);
      }
    })();
    return () => {
      actif = false;
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

  const enregistrer = (suivant: Profil) => {
    setProfil(suivant);
    void stockage?.ecrire(suivant).catch(() => undefined);
  };
  const majProfil = (f: (p: Profil) => Profil) => setProfil((p) => {
    const suivant = f(p);
    void stockage?.ecrire(suivant).catch(() => undefined);
    return suivant;
  });

  const reglages = profil.reglages ?? REGLAGES_DEFAUT;
  const setReglages = (f: (r: Reglages) => Reglages) => majProfil((p) => ({ ...p, reglages: f(p.reglages ?? REGLAGES_DEFAUT) }));
  const setLevier = (id: string, e: EtatLevier) => majProfil((p) => ({ ...p, leviers: { ...p.leviers, [id]: e } }));

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
            Les données enregistrées sur cet appareil étaient illisibles : l’outil repart d’un profil vide. Restaurez une sauvegarde si vous en avez une.
          </p>
        )}
        {expires.length > 0 && vue !== 'leviers' && (
          <p class="alerte">
            {expires.map((l) => l.nom).join(', ')} : validité dépassée. <a href="#leviers">Mettre à jour</a>
          </p>
        )}
        {rappelSauvegarde(profil, aujourdhui) && vue !== 'donnees' && (
          <p class="rappel">
            Pensez à sauvegarder vos données : <a href="#donnees">télécharger une sauvegarde</a>.
          </p>
        )}
        {vue === 'comparer' && <Comparateur lignes={lignes} setLignes={setLignesEtat} reglages={reglages} setReglages={setReglages} resumeLeviers={resumeLeviers} />}
        {vue === 'leviers' && <Leviers profil={profil} aujourdhui={aujourdhui} onChange={setLevier} />}
        {vue === 'donnees' && (
          <Donnees
            profil={profil}
            mode={stockage?.mode ?? 'local'}
            aujourdhui={aujourdhui}
            onExporte={() => majProfil((p) => ({ ...p, derniereSauvegarde: aujourdhui }))}
            onImporte={(p) => enregistrer({ ...p, derniereSauvegarde: aujourdhui })}
            onSupprime={() => {
              setProfil(profilVide());
              void stockage?.effacer().catch(() => undefined);
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
