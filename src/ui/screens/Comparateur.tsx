import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { formaterHeure } from '../../domain/heure';
import { formaterMontant } from '../../domain/argent';
import { recommander, type Evaluation, type ParametresCout, type Recommandation } from '../../domain/coutComplet';
import { estAReverifier } from '../../domain/referentiel';
import { lireLigne, lireReglages, type LigneLue, type LigneTrain, type Reglages } from '../../domain/saisie';
import { REFERENTIEL_COUT } from '../../data/parametres';
import { Champ } from '../components/Champ';

export const MAX_TRAINS = 6;
let compteur = 0;
export const nouvelleLigne = (): LigneTrain => ({ id: `t${++compteur}`, depart: '', arrivee: '', prix: '' });

const defauts = REFERENTIEL_COUT.parametres;
export const REGLAGES_DEFAUT: Reglages = {
  trajet: String(defauts.trajetGareDomicileMin),
  limite: formaterHeure(defauts.limiteDinerDomicileMin),
  repas: String(defauts.coutRepasCentimes / 100).replace('.', ','),
  tolerance: String(defauts.toleranceCentimes / 100).replace('.', ','),
};

function nomTrain(e: Evaluation, lignes: LigneTrain[]): string {
  const rang = lignes.findIndex((l) => l.id === e.id) + 1;
  return `train ${rang} (${formaterHeure(e.depart)})`;
}

function Explication({ reco, lignes, parametres }: { reco: Recommandation; lignes: LigneTrain[]; parametres: ParametresCout }) {
  const { retenu, motif, concurrent } = reco;
  if (motif === 'moins-cher') return <>C’est le coût complet le plus bas : {formaterMontant(retenu.coutCompletCentimes)}.</>;
  if (motif !== 'egalite-plus-tot' || !concurrent) return null;
  if (concurrent.arriveeDomicile === retenu.arriveeDomicile) {
    return (
      <>
        Il fait jeu égal avec le {nomTrain(concurrent, lignes)} : même coût complet à {formaterMontant(parametres.toleranceCentimes)} près et même heure
        d’arrivée chez vous.
      </>
    );
  }
  return (
    <>
      Le {nomTrain(concurrent, lignes)} coûte {formaterMontant(concurrent.coutCompletCentimes)} au total, soit au plus{' '}
      {formaterMontant(parametres.toleranceCentimes)} de moins, mais vous ramène à {formaterHeure(concurrent.arriveeDomicile)} au lieu de{' '}
      {formaterHeure(retenu.arriveeDomicile)}.
    </>
  );
}

function Detail({ reco, lignes }: { reco: Recommandation; lignes: LigneTrain[] }) {
  return (
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
        {reco.classement.map((e) => (
          <tr key={e.id} class={e === reco.retenu ? 'retenu' : undefined}>
            <th scope="row">
              {nomTrain(e, lignes).replace(/^t/, 'T')}
              {e === reco.retenu && <span class="badge"> recommandé</span>}
            </th>
            <td data-label="Billet : ">{formaterMontant(e.prixCentimes)}</td>
            <td data-label="Repas à bord : ">{e.repasCentimes ? formaterMontant(e.repasCentimes) : 'aucun'}</td>
            <td data-label="Coût complet : ">{formaterMontant(e.coutCompletCentimes)}</td>
            <td data-label="Chez vous : ">{formaterHeure(e.arriveeDomicile)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Avertissements({ lues }: { lues: LigneLue[] }) {
  const ecartees = lues.map((l, i) => ({ etat: l.etat, rang: i + 1 })).filter((l) => l.etat === 'incomplet' || l.etat === 'invalide');
  if (!ecartees.length) return null;
  return (
    <ul class="avertissements">
      {ecartees.map((l) => (
        <li key={l.rang}>
          Train {l.rang} {l.etat === 'incomplet' ? 'incomplet' : 'à corriger'} : il n’est pas pris en compte.
        </li>
      ))}
    </ul>
  );
}

export function Comparateur(props: {
  lignes: LigneTrain[];
  setLignes: (f: (ls: LigneTrain[]) => LigneTrain[]) => void;
  reglages: Reglages;
  setReglages: (f: (r: Reglages) => Reglages) => void;
  resumeLeviers: ComponentChildren;
}) {
  const { lignes, setLignes, reglages, setReglages } = props;
  const focusApres = useRef<string | null>(null);

  // Gestion du focus après ajout ou retrait d'un train (RGAA 12.8).
  useEffect(() => {
    if (focusApres.current) {
      document.getElementById(focusApres.current)?.focus();
      focusApres.current = null;
    }
  }, [lignes]);

  const lues = lignes.map(lireLigne);
  const { parametres, erreurs: erreursReglages } = lireReglages(reglages);
  const trains = lues.flatMap((l) => (l.train ? [l.train] : []));
  const reco = parametres ? recommander(trains, parametres) : null;
  const aReverifier = estAReverifier(REFERENTIEL_COUT.meta.verifieLe, new Date());

  const maj = (id: string, champ: keyof Omit<LigneTrain, 'id'>, v: string) =>
    setLignes((ls) => ls.map((l) => (l.id === id ? { ...l, [champ]: v } : l)));
  const ajouter = () => {
    const l = nouvelleLigne();
    focusApres.current = `${l.id}-dep`;
    setLignes((ls) => [...ls, l]);
  };
  const retirer = (id: string) => {
    focusApres.current = 'ajouter-train';
    setLignes((ls) => ls.filter((x) => x.id !== id));
  };

  let phrase: ComponentChildren;
  if (!parametres) phrase = 'Corrigez les réglages du coût complet pour obtenir une recommandation.';
  else if (!reco || reco.classement.length < 2) phrase = 'Saisissez au moins deux trains complets pour obtenir une recommandation.';
  else
    phrase = (
      <>
        Prenez le <strong>{nomTrain(reco.retenu, lignes)}</strong> : arrivée en gare à {formaterHeure(reco.retenu.arriveeGare)}, chez vous vers{' '}
        {formaterHeure(reco.retenu.arriveeDomicile)}.
      </>
    );

  return (
    <>
      <h1 id="titre-vue" tabIndex={-1}>
        Mon train retour au coût complet
      </h1>
      <p class="intro">
        Le coût complet ajoute au billet ce que les horaires vous font dépenser : un repas à bord si vous arrivez chez vous après{' '}
        {formaterHeure((parametres ?? defauts).limiteDinerDomicileMin)}. À coût égal, le train qui vous ramène le plus tôt l’emporte.
      </p>
      {props.resumeLeviers}

      <section aria-labelledby="titre-trains">
        <h2 id="titre-trains">Trains comparés</h2>
        <p class="aide">Pour chaque train, les trois champs sont obligatoires. Prix en euros, par exemple 29,90.</p>
        {lignes.map((l, i) => (
          <fieldset key={l.id} class="train">
            <legend>Train {i + 1}</legend>
            <div class="ligne">
              <Champ id={`${l.id}-dep`} libelle="Départ" type="time" valeur={l.depart} erreur={lues[i]?.erreurs.depart} onInput={(v) => maj(l.id, 'depart', v)} />
              <Champ id={`${l.id}-arr`} libelle="Arrivée en gare" type="time" valeur={l.arrivee} erreur={lues[i]?.erreurs.arrivee} onInput={(v) => maj(l.id, 'arrivee', v)} />
              <Champ id={`${l.id}-prix`} libelle="Prix du billet (€)" inputMode="decimal" valeur={l.prix} erreur={lues[i]?.erreurs.prix} onInput={(v) => maj(l.id, 'prix', v)} />
            </div>
            {lignes.length > 2 && (
              <button type="button" class="secondaire" onClick={() => retirer(l.id)}>
                Retirer le train {i + 1}
              </button>
            )}
          </fieldset>
        ))}
        {lignes.length < MAX_TRAINS ? (
          <button type="button" id="ajouter-train" onClick={ajouter}>
            Ajouter un train
          </button>
        ) : (
          <p class="aide" id="ajouter-train" tabIndex={-1}>
            Six trains au plus.
          </p>
        )}
      </section>

      <section aria-labelledby="titre-reco" class="resultat">
        <h2 id="titre-reco">Recommandation</h2>
        <p class="reco" aria-live="polite" aria-atomic="true">
          {phrase}
        </p>
        <Avertissements lues={lues} />
        {parametres && reco && reco.classement.length >= 2 && (
          <>
            <p>
              <Explication reco={reco} lignes={lignes} parametres={parametres} />
            </p>
            <Detail reco={reco} lignes={lignes} />
          </>
        )}
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
              libelle="Écart toléré (€)"
              inputMode="decimal"
              aide="Jusqu’à cet écart compris, le train qui ramène le plus tôt l’emporte."
              valeur={reglages.tolerance}
              erreur={erreursReglages.tolerance}
              onInput={(v) => setReglages((r) => ({ ...r, tolerance: v }))}
            />
          </div>
          <p class="aide">
            Valeurs par défaut : {REFERENTIEL_COUT.meta.source} Vérifiées le {REFERENTIEL_COUT.meta.verifieLe}. Heure théorique d’arrivée : en cas de
            retard, l’outil ne l’anticipe pas.
          </p>
          {aReverifier && <p class="alerte">Ces valeurs n’ont pas été revérifiées depuis plus de 6 mois.</p>}
        </details>
      </section>
    </>
  );
}
