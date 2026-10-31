import { useMemo, useState } from 'preact/hooks';
import { formaterHeure, lireHeure } from '../domain/heure';
import { formaterMontant, lireMontant } from '../domain/argent';
import { recommander, type Evaluation, type ParametresCout, type Recommandation, type TrainValide } from '../domain/coutComplet';
import { estAReverifier } from '../domain/referentiel';
import { REFERENTIEL_COUT } from '../data/parametres';

interface LigneTrain {
  id: string;
  depart: string;
  arrivee: string;
  prix: string;
}

interface ErreursLigne {
  depart?: string;
  arrivee?: string;
  prix?: string;
}

const MAX_TRAINS = 6;
let compteur = 0;
const nouvelleLigne = (): LigneTrain => ({ id: `t${++compteur}`, depart: '', arrivee: '', prix: '' });

function lireLigne(l: LigneTrain): { train: TrainValide | null; erreurs: ErreursLigne } {
  const erreurs: ErreursLigne = {};
  const vide = !l.depart && !l.arrivee && !l.prix.trim();
  if (vide) return { train: null, erreurs };
  const depart = lireHeure(l.depart);
  const arrivee = lireHeure(l.arrivee);
  const prix = lireMontant(l.prix);
  if (depart === null) erreurs.depart = 'Indiquez l’heure de départ, par exemple 19:00.';
  if (arrivee === null) erreurs.arrivee = 'Indiquez l’heure d’arrivée en gare, par exemple 22:00.';
  if (prix === null) erreurs.prix = 'Indiquez un prix entre 0 et 1 000 €, par exemple 29,90.';
  if (depart === null || arrivee === null || prix === null) return { train: null, erreurs };
  return { train: { id: l.id, depart, arrivee, prixCentimes: prix }, erreurs };
}

interface Reglages {
  trajet: string;
  limite: string;
  repas: string;
  tolerance: string;
}

const defauts = REFERENTIEL_COUT.parametres;
const REGLAGES_DEFAUT: Reglages = {
  trajet: String(defauts.trajetGareDomicileMin),
  limite: formaterHeure(defauts.limiteDinerDomicileMin),
  repas: String(defauts.coutRepasCentimes / 100).replace('.', ','),
  tolerance: String(defauts.toleranceCentimes / 100).replace('.', ','),
};

function lireReglages(r: Reglages): { parametres: ParametresCout; erreurs: Partial<Record<keyof Reglages, string>> } {
  const erreurs: Partial<Record<keyof Reglages, string>> = {};
  const trajet = /^\d{1,3}$/.test(r.trajet.trim()) ? Number(r.trajet) : NaN;
  if (!(trajet >= 0 && trajet <= 180)) erreurs.trajet = 'Entre 0 et 180 minutes.';
  const limite = lireHeure(r.limite);
  if (limite === null) erreurs.limite = 'Une heure, par exemple 21:45.';
  const repas = lireMontant(r.repas, 100);
  if (repas === null) erreurs.repas = 'Entre 0 et 100 €.';
  const tolerance = lireMontant(r.tolerance, 50);
  if (tolerance === null) erreurs.tolerance = 'Entre 0 et 50 €.';
  return {
    parametres: {
      trajetGareDomicileMin: Number.isNaN(trajet) || erreurs.trajet ? defauts.trajetGareDomicileMin : trajet,
      limiteDinerDomicileMin: limite ?? defauts.limiteDinerDomicileMin,
      coutRepasCentimes: repas ?? defauts.coutRepasCentimes,
      toleranceCentimes: tolerance ?? defauts.toleranceCentimes,
    },
    erreurs,
  };
}

function Champ(props: {
  id: string;
  libelle: string;
  valeur: string;
  type?: 'text' | 'time';
  aide?: string;
  erreur?: string | undefined;
  inputMode?: 'decimal' | 'numeric';
  onInput: (v: string) => void;
}) {
  const decrit = [props.aide ? `${props.id}-aide` : '', props.erreur ? `${props.id}-err` : ''].filter(Boolean).join(' ');
  const commun = {
    id: props.id,
    value: props.valeur,
    autoComplete: 'off',
    'aria-invalid': props.erreur ? ('true' as const) : undefined,
    'aria-describedby': decrit || undefined,
    onInput: (e: Event) => props.onInput((e.currentTarget as HTMLInputElement).value),
  };
  return (
    <div class="champ">
      <label for={props.id}>{props.libelle}</label>
      {props.aide && (
        <span class="aide" id={`${props.id}-aide`}>
          {props.aide}
        </span>
      )}
      {props.type === 'time' ? (
        <input type="time" {...commun} />
      ) : (
        <input type="text" inputMode={props.inputMode} {...commun} />
      )}
      {props.erreur && (
        <span class="erreur" id={`${props.id}-err`}>
          {props.erreur}
        </span>
      )}
    </div>
  );
}

function nomTrain(e: Evaluation, lignes: LigneTrain[]): string {
  const rang = lignes.findIndex((l) => l.id === e.id) + 1;
  return `Train ${rang} (${formaterHeure(e.depart)})`;
}

function Resultat({ reco, lignes, parametres }: { reco: Recommandation | null; lignes: LigneTrain[]; parametres: ParametresCout }) {
  if (!reco || reco.classement.length < 2) {
    return <p>Saisissez au moins deux trains complets pour obtenir une recommandation.</p>;
  }
  const { retenu, classement, motif, concurrent } = reco;
  return (
    <>
      <p class="reco">
        Prenez le <strong>{nomTrain(retenu, lignes)}</strong> : arrivée en gare à {formaterHeure(retenu.arriveeGare)}, chez vous vers{' '}
        {formaterHeure(retenu.arriveeDomicile)}.
      </p>
      <p>
        {motif === 'moins-cher' && <>C’est le coût complet le plus bas : {formaterMontant(retenu.coutCompletCentimes)}.</>}
        {motif === 'egalite-plus-tot' && concurrent && (
          <>
            Son coût complet ({formaterMontant(retenu.coutCompletCentimes)}) égale celui du {nomTrain(concurrent, lignes)} (
            {formaterMontant(concurrent.coutCompletCentimes)}) à {formaterMontant(parametres.toleranceCentimes)} près, et vous êtes chez vous à{' '}
            {formaterHeure(retenu.arriveeDomicile)} au lieu de {formaterHeure(concurrent.arriveeDomicile)}.
          </>
        )}
      </p>
      <table>
        <caption>Détail du coût complet, du moins cher au plus cher</caption>
        <thead>
          <tr>
            <th scope="col">Train</th>
            <th scope="col">Billet</th>
            <th scope="col">Repas à bord</th>
            <th scope="col">Coût complet</th>
            <th scope="col">Chez vous</th>
          </tr>
        </thead>
        <tbody>
          {classement.map((e) => (
            <tr key={e.id} class={e === retenu ? 'retenu' : undefined}>
              <th scope="row">
                {nomTrain(e, lignes)}
                {e === retenu && <span class="badge"> recommandé</span>}
              </th>
              <td data-label="Billet : ">{formaterMontant(e.prixCentimes)}</td>
              <td data-label="Repas à bord : ">{e.repasCentimes ? formaterMontant(e.repasCentimes) : 'aucun'}</td>
              <td data-label="Coût complet : ">{formaterMontant(e.coutCompletCentimes)}</td>
              <td data-label="Chez vous : ">{formaterHeure(e.arriveeDomicile)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function App() {
  const [lignes, setLignes] = useState<LigneTrain[]>(() => [nouvelleLigne(), nouvelleLigne()]);
  const [reglages, setReglages] = useState<Reglages>(REGLAGES_DEFAUT);

  const lues = useMemo(() => lignes.map(lireLigne), [lignes]);
  const { parametres, erreurs: erreursReglages } = useMemo(() => lireReglages(reglages), [reglages]);
  const trains = lues.map((l) => l.train).filter((t): t is TrainValide => t !== null);
  const reco = useMemo(() => recommander(trains, parametres), [trains.map((t) => `${t.id}${t.depart}${t.arrivee}${t.prixCentimes}`).join('|'), parametres]);
  const aReverifier = estAReverifier(REFERENTIEL_COUT.meta.verifieLe, new Date());

  const maj = (id: string, champ: keyof Omit<LigneTrain, 'id'>, v: string) =>
    setLignes((ls) => ls.map((l) => (l.id === id ? { ...l, [champ]: v } : l)));

  return (
    <>
      <a class="evitement" href="#contenu">
        Aller au contenu
      </a>
      <header>
        <p class="marque">Chasse aux bons plans</p>
      </header>
      <main id="contenu" tabIndex={-1}>
        <h1>Mon train retour au coût complet</h1>
        <p class="intro">
          Le coût complet ajoute au billet ce que les horaires vous font dépenser : un repas à bord si vous arrivez chez vous après{' '}
          {formaterHeure(parametres.limiteDinerDomicileMin)}. À coût égal, le train qui vous ramène le plus tôt l’emporte.
        </p>

        <section aria-labelledby="titre-trains">
          <h2 id="titre-trains">Trains comparés</h2>
          {lignes.map((l, i) => (
            <fieldset key={l.id} class="train">
              <legend>Train {i + 1}</legend>
              <div class="ligne">
                <Champ id={`${l.id}-dep`} libelle="Départ" type="time" valeur={l.depart} erreur={lues[i]?.erreurs.depart} onInput={(v) => maj(l.id, 'depart', v)} />
                <Champ id={`${l.id}-arr`} libelle="Arrivée en gare" type="time" valeur={l.arrivee} erreur={lues[i]?.erreurs.arrivee} onInput={(v) => maj(l.id, 'arrivee', v)} />
                <Champ id={`${l.id}-prix`} libelle="Prix du billet (€)" inputMode="decimal" valeur={l.prix} erreur={lues[i]?.erreurs.prix} onInput={(v) => maj(l.id, 'prix', v)} />
              </div>
              {lignes.length > 2 && (
                <button type="button" class="secondaire" onClick={() => setLignes((ls) => ls.filter((x) => x.id !== l.id))}>
                  Retirer le train {i + 1}
                </button>
              )}
            </fieldset>
          ))}
          {lignes.length < MAX_TRAINS && (
            <button type="button" onClick={() => setLignes((ls) => [...ls, nouvelleLigne()])}>
              Ajouter un train
            </button>
          )}
        </section>

        <section aria-labelledby="titre-reco" class="resultat">
          <h2 id="titre-reco">Recommandation</h2>
          <div aria-live="polite">
            <Resultat reco={reco} lignes={lignes} parametres={parametres} />
          </div>
        </section>

        <section aria-labelledby="titre-reglages">
          <details>
            <summary>
              <h2 id="titre-reglages">Réglages du coût complet</h2>
            </summary>
            <div class="ligne">
              <Champ id="r-trajet" libelle="Trajet gare → domicile (min)" inputMode="numeric" valeur={reglages.trajet} erreur={erreursReglages.trajet} onInput={(v) => setReglages((r) => ({ ...r, trajet: v }))} />
              <Champ id="r-limite" libelle="Dîner à la maison jusqu’à" type="time" valeur={reglages.limite} erreur={erreursReglages.limite} onInput={(v) => setReglages((r) => ({ ...r, limite: v }))} />
              <Champ id="r-repas" libelle="Prix d’un repas à bord (€)" inputMode="decimal" valeur={reglages.repas} erreur={erreursReglages.repas} onInput={(v) => setReglages((r) => ({ ...r, repas: v }))} />
              <Champ
                id="r-tolerance"
                libelle="Égalité à … € près"
                inputMode="decimal"
                aide="En dessous de cet écart, le train le plus tôt l’emporte."
                valeur={reglages.tolerance}
                erreur={erreursReglages.tolerance}
                onInput={(v) => setReglages((r) => ({ ...r, tolerance: v }))}
              />
            </div>
            <p class="aide">
              Valeurs par défaut : {REFERENTIEL_COUT.meta.source} Vérifiées le {REFERENTIEL_COUT.meta.verifieLe}.
            </p>
            {aReverifier && <p class="alerte">Ces valeurs n’ont pas été revérifiées depuis plus de 6 mois.</p>}
          </details>
        </section>
      </main>
      <footer>
        <p>Outil indicatif, non affilié à la SNCF. Vos saisies restent sur cet appareil : rien n’est envoyé sur Internet.</p>
      </footer>
    </>
  );
}
