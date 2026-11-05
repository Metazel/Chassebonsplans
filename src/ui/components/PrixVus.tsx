/**
 * Prix vus sur le site de vente : saisie par train, ou collage de la page de résultats (lecture au mieux,
 * confirmée avant application), puis recommandation au coût complet. Aucune requête vers le site (EXG-08) ;
 * le texte collé n'est ni stocké ni envoyé (correcteur orthographique désactivé).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { formaterHeure } from '../../domain/heure';
import { formaterMontant, lireMontant } from '../../domain/argent';
import { dateCourte } from '../../domain/dates';
import type { ParametresCout } from '../../domain/coutComplet';
import type { TrainHoraire } from '../../domain/horaires';
import { choisir, type Trajet } from '../../domain/deplacements';
import { associerCollage, clePrix, lireCollage, majPrixVu, prixAncien, prixVuDe, recommanderParPrix, type Association } from '../../domain/prix';

/** Lecture d'une saisie de prix : vide → undefined ; « 45, » toléré pendant la frappe ; 0 refusé. */
function lirePrixSaisi(v: string): number | undefined | null {
  const propre = v.trim().replace(/[,.]$/, '');
  if (!propre) return undefined;
  const c = lireMontant(propre);
  return c === null || c === 0 ? null : c;
}

const texte = (c: number | undefined) => (c !== undefined ? formaterMontant(c).replace(/\s?€/, '').replace(/\s/g, '') : '');

function ChampPrix(props: { id: string; train: TrainHoraire; trajet: Trajet; aujourdhui: string; onPrix: (train: TrainHoraire, c: number | undefined) => void }) {
  const { train, trajet } = props;
  const vu = prixVuDe(trajet.prixVus, train);
  const [valeur, setValeur] = useState(texte(vu?.centimes));
  useEffect(() => {
    const lu = lirePrixSaisi(valeur);
    if (lu !== null && lu !== vu?.centimes) setValeur(texte(vu?.centimes));
  }, [vu?.centimes]);
  const lu = lirePrixSaisi(valeur);
  const ancien = vu && prixAncien(vu, props.aujourdhui);
  return (
    <div class="champ champ-prix">
      <label for={props.id}>
        Prix vu — {formaterHeure(train.depart)} {train.operateur} {train.numero} (€)
      </label>
      <input
        id={props.id}
        type="text"
        inputMode="decimal"
        maxLength={10}
        autoComplete="off"
        value={valeur}
        aria-invalid={lu === null ? 'true' : undefined}
        aria-describedby={lu === null ? `${props.id}-err` : ancien ? `${props.id}-age` : undefined}
        onInput={(e) => setValeur((e.currentTarget as HTMLInputElement).value)}
        // Enregistré à la validation du champ (sortie, Entrée), pas à chaque frappe : pas de recommandation transitoire.
        onChange={(e) => {
          const c = lirePrixSaisi((e.currentTarget as HTMLInputElement).value);
          if (c !== null && c !== vu?.centimes) props.onPrix(train, c);
        }}
      />
      {lu === null && (
        <span class="erreur" id={`${props.id}-err`}>
          Prix invalide : en euros, supérieur à 0, par exemple 45,90.
        </span>
      )}
      {lu !== null && ancien && (
        <span class="aide" id={`${props.id}-age`}>
          Vu le {dateCourte(vu.le)} : il a pu changer, il n’est plus comparé.
        </span>
      )}
    </div>
  );
}

export function PrixVus(props: {
  base: string;
  cote: 'aller' | 'retour';
  trains: TrainHoraire[];
  trajet: Trajet;
  p: ParametresCout;
  aujourdhui: string;
  onTrajet: (t: Trajet) => void;
}) {
  const { trajet, trains, base } = props;
  const [colle, setColle] = useState('');
  const [lecture, setLecture] = useState<(Association<TrainHoraire> & { erreur?: string }) | null>(null);
  const [annonce, setAnnonce] = useState('');
  const focusApres = useRef<string | null>(null);
  useEffect(() => {
    if (focusApres.current) {
      document.getElementById(focusApres.current)?.focus();
      focusApres.current = null;
    }
  });

  const reco = recommanderParPrix(trains, trajet.prixVus, props.p, props.aujourdhui);
  const retenu = reco ? trains.find((t) => clePrix(t) === reco.retenu.id) : undefined;
  const concurrent = reco?.concurrent ? trains.find((t) => clePrix(t) === reco.concurrent!.id) : undefined;
  const dejaChoisi = retenu && trajet.train && clePrix(trajet.train) === clePrix(retenu);
  const connus = trains.filter((t) => prixVuDe(trajet.prixVus, t)).length;
  const anciens = trains.filter((t) => {
    const v = prixVuDe(trajet.prixVus, t);
    return v && prixAncien(v, props.aujourdhui);
  }).length;

  const enregistrer = (prix: { train: TrainHoraire; centimes: number | undefined }[]) => {
    let prixVus = trajet.prixVus;
    for (const x of prix) prixVus = majPrixVu(prixVus, clePrix(x.train), x.centimes, props.aujourdhui);
    const t: Trajet = { ...trajet };
    if (prixVus) t.prixVus = prixVus;
    else delete t.prixVus;
    props.onTrajet(t);
  };

  const lire = () => {
    const c = lireCollage(colle, trajet.date);
    const erreur =
      c.erreur === 'plusieurs-dates'
        ? 'Le texte contient plusieurs jours : collez les résultats d’un seul jour.'
        : c.erreur === 'autre-date'
          ? `Le texte concerne un autre jour que le ${dateCourte(trajet.date)} : rien n’a été lu.`
          : undefined;
    setLecture({ ...associerCollage(c.lignes, trains), ...(erreur ? { erreur } : {}) });
    focusApres.current = `${base}-lecture`;
  };

  const appliquer = () => {
    if (!lecture) return;
    enregistrer(lecture.associes);
    setAnnonce(`${lecture.associes.length} prix appliqué${lecture.associes.length > 1 ? 's' : ''}.`);
    setLecture(null);
    setColle('');
    focusApres.current = `${base}-colle`;
  };

  return (
    <div class="prix-vus">
      <p class="sr-only" aria-live="polite">
        {annonce}
      </p>
      {reco && retenu && (
        <div class="recommandation">
          <p>
            Au coût complet ({connus - anciens} prix comparé{connus - anciens > 1 ? 's' : ''}) : <strong>{retenu.operateur} {retenu.numero}</strong> à{' '}
            {formaterHeure(retenu.depart)}, {formaterMontant(reco.retenu.coutCompletCentimes)}
            {reco.retenu.repasCentimes > 0 && ` dont ${formaterMontant(reco.retenu.repasCentimes)} de dîner à bord`}.{' '}
            {reco.motif === 'seul' && 'C’est le seul train dont le prix récent est connu.'}
            {reco.motif === 'moins-cher' && 'C’est le moins cher.'}
            {reco.motif === 'egalite-plus-tot' &&
              concurrent &&
              `À ${formaterMontant(props.p.toleranceCentimes)} près du ${concurrent.numero}, il ${props.cote === 'aller' ? 'arrive' : 'vous ramène'} plus tôt.`}
            {anciens > 0 && ` ${anciens} prix vu${anciens > 1 ? 's' : ''} il y a plus de 2 jours, non comparé${anciens > 1 ? 's' : ''} : mettez-les à jour.`}
          </p>
          {dejaChoisi ? (
            <p class="aide">C’est votre train choisi.</p>
          ) : (
            <button
              type="button"
              class="secondaire"
              onClick={() => {
                props.onTrajet({ ...trajet, train: choisir(retenu) });
                setAnnonce(`Train ${retenu.numero} choisi.`);
                focusApres.current = `${base}-${retenu.numero}-${retenu.depart}`;
              }}
            >
              Choisir le {retenu.numero}
            </button>
          )}
        </div>
      )}
      {!reco && anciens > 0 && <p class="aide">Les prix vus datent de plus de 2 jours : mettez-les à jour pour comparer.</p>}
      <details class="saisie-prix">
        <summary>{connus ? 'Modifier les prix vus sur le site' : 'Saisir les prix vus sur le site'}</summary>
        <p class="aide">Les prix du site, pour comparer au coût complet (dîner à bord compris). Laissez vide un train sans prix.</p>
        <div class="grille-prix">
          {trains.map((t) => (
            <ChampPrix
              key={clePrix(t)}
              id={`${base}-prix-${t.numero}-${t.depart}`}
              train={t}
              trajet={trajet}
              aujourdhui={props.aujourdhui}
              onPrix={(train, c) => {
                enregistrer([{ train, centimes: c }]);
                setAnnonce(c === undefined ? `Prix du ${train.numero} effacé.` : `Prix du ${train.numero} enregistré : ${formaterMontant(c)}.`);
              }}
            />
          ))}
        </div>
        <div class="champ">
          <label for={`${base}-colle`}>Ou collez la page de résultats</label>
          <textarea
            id={`${base}-colle`}
            rows={3}
            maxLength={200_000}
            value={colle}
            spellcheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-describedby={`${base}-colle-aide`}
            onInput={(e) => {
              setColle((e.currentTarget as HTMLTextAreaElement).value);
              setLecture(null);
            }}
          />
          <span class="aide" id={`${base}-colle-aide`}>
            Sur le site, sélectionnez la liste des trains de ce jour, copiez, collez ici : l’outil y relève les horaires et les prix. Rien n’est envoyé ni
            conservé.
          </span>
        </div>
        <button type="button" class="secondaire" aria-disabled={!colle.trim() ? 'true' : undefined} onClick={() => colle.trim() && lire()}>
          Lire les prix
        </button>
        {lecture && (
          <div class="lecture" id={`${base}-lecture`} tabIndex={-1} aria-labelledby={`${base}-lecture-titre`} role="group">
            <p id={`${base}-lecture-titre`}>
              {lecture.erreur ??
                (lecture.associes.length
                  ? `${lecture.associes.length} prix trouvé${lecture.associes.length > 1 ? 's' : ''} : vérifiez avant d’appliquer.`
                  : 'Aucun prix reconnu pour les trains de ce créneau : saisissez-les un par un.')}
            </p>
            {!lecture.erreur && lecture.associes.length > 0 && (
              <ul>
                {lecture.associes.map((l) => (
                  <li key={clePrix(l.train)}>
                    {formaterHeure(l.train.depart)} · {l.train.operateur} {l.train.numero} : {formaterMontant(l.centimes)}
                  </li>
                ))}
              </ul>
            )}
            {!lecture.erreur && lecture.ecarts.length > 0 && (
              <p class="alerte">
                Non appliqué{lecture.ecarts.length > 1 ? 's' : ''} :{' '}
                {lecture.ecarts
                  .map((e) => `${e.train.numero} (arrivée lue ${formaterHeure(e.ligne.arrivee)} au lieu de ${formaterHeure(e.train.arrivee)} : correspondance ?)`)
                  .join(' ; ')}
                .
              </p>
            )}
            {!lecture.erreur && lecture.associes.length > 0 && lecture.nonLus.length > 0 && (
              <p class="aide">Sans prix lu : {lecture.nonLus.map((t) => t.numero).join(', ')}.</p>
            )}
            {!lecture.erreur && lecture.associes.length > 0 && (
              <button type="button" onClick={appliquer}>
                Appliquer ces prix
              </button>
            )}{' '}
            <button
              type="button"
              class="secondaire"
              onClick={() => {
                setLecture(null);
                focusApres.current = `${base}-colle`;
              }}
            >
              {lecture.erreur || !lecture.associes.length ? 'Fermer' : 'Annuler'}
            </button>
          </div>
        )}
      </details>
    </div>
  );
}
