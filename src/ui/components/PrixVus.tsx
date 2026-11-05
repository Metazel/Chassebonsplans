/**
 * Prix vus sur le site de vente : saisie par train, ou collage de la page de résultats (lecture au mieux,
 * confirmée avant application), puis recommandation au coût complet. Aucune requête vers le site (EXG-08).
 */
import { useEffect, useState } from 'preact/hooks';
import { formaterHeure } from '../../domain/heure';
import { formaterMontant, lireMontant } from '../../domain/argent';
import { dateCourte } from '../../domain/dates';
import type { ParametresCout } from '../../domain/coutComplet';
import type { TrainHoraire } from '../../domain/horaires';
import { choisir, type Trajet } from '../../domain/deplacements';
import { associerCollage, clePrix, lireCollage, majPrixVu, prixAncien, prixVuDe, recommanderParPrix } from '../../domain/prix';

function ChampPrix(props: { id: string; train: TrainHoraire; trajet: Trajet; aujourdhui: string; onTrajet: (t: Trajet) => void }) {
  const { train, trajet } = props;
  const vu = prixVuDe(trajet.prixVus, train);
  const texte = (c: number | undefined) => (c !== undefined ? formaterMontant(c).replace(/\s?€/, '').replace(/\s/g, '') : '');
  const [valeur, setValeur] = useState(texte(vu?.centimes));
  useEffect(() => {
    const lu = valeur.trim() ? lireMontant(valeur) : undefined;
    if (lu !== null && lu !== vu?.centimes) setValeur(texte(vu?.centimes));
  }, [vu?.centimes]);
  const lu = valeur.trim() ? lireMontant(valeur) : undefined;
  return (
    <div class="champ champ-prix">
      <label for={props.id}>
        {formaterHeure(train.depart)} · {train.operateur} {train.numero} (€)
      </label>
      <input
        id={props.id}
        type="text"
        inputMode="decimal"
        maxLength={10}
        autoComplete="off"
        value={valeur}
        aria-invalid={lu === null ? 'true' : undefined}
        aria-describedby={lu === null ? `${props.id}-err` : vu && prixAncien(vu, props.aujourdhui) ? `${props.id}-age` : undefined}
        onInput={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          setValeur(v);
          const c = v.trim() ? lireMontant(v) : undefined;
          if (c === null) return;
          const t: Trajet = { ...trajet };
          const prixVus = majPrixVu(trajet.prixVus, clePrix(train), c, props.aujourdhui);
          if (prixVus) t.prixVus = prixVus;
          else delete t.prixVus;
          props.onTrajet(t);
        }}
      />
      {lu === null && (
        <span class="erreur" id={`${props.id}-err`}>
          Prix invalide : en euros, par exemple 45,90.
        </span>
      )}
      {lu !== null && vu && prixAncien(vu, props.aujourdhui) && (
        <span class="aide" id={`${props.id}-age`}>
          Vu le {dateCourte(vu.le)} : il a pu changer.
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
  const [lecture, setLecture] = useState<{ train: TrainHoraire; centimes: number }[] | null>(null);
  const reco = recommanderParPrix(trains, trajet.prixVus, props.p);
  const retenu = reco ? trains.find((t) => clePrix(t) === reco.retenu.id) : undefined;
  const concurrent = reco?.concurrent ? trains.find((t) => clePrix(t) === reco.concurrent!.id) : undefined;
  const dejaChoisi = retenu && trajet.train && clePrix(trajet.train) === clePrix(retenu);
  const connus = trains.filter((t) => prixVuDe(trajet.prixVus, t)).length;

  const appliquer = () => {
    if (!lecture) return;
    let prixVus = trajet.prixVus;
    for (const l of lecture) prixVus = majPrixVu(prixVus, clePrix(l.train), l.centimes, props.aujourdhui);
    const t: Trajet = { ...trajet };
    if (prixVus) t.prixVus = prixVus;
    props.onTrajet(t);
    setLecture(null);
    setColle('');
  };

  return (
    <div class="prix-vus">
      {reco && retenu && (
        <div class="recommandation" role="status">
          <p>
            Au coût complet ({connus} prix connu{connus > 1 ? 's' : ''}) : <strong>{retenu.operateur} {retenu.numero}</strong> à {formaterHeure(retenu.depart)},{' '}
            {formaterMontant(reco.retenu.coutCompletCentimes)}
            {reco.retenu.repasCentimes > 0 && ` dont ${formaterMontant(reco.retenu.repasCentimes)} de dîner à bord`}.{' '}
            {reco.motif === 'seul' && 'C’est le seul train dont le prix est connu.'}
            {reco.motif === 'moins-cher' && 'C’est le moins cher.'}
            {reco.motif === 'egalite-plus-tot' &&
              concurrent &&
              `À ${formaterMontant(props.p.toleranceCentimes)} près du ${concurrent.numero}, il ${props.cote === 'aller' ? 'arrive' : 'vous ramène'} plus tôt.`}
          </p>
          {dejaChoisi ? (
            <p class="aide">C’est votre train choisi.</p>
          ) : (
            <button type="button" class="secondaire" onClick={() => props.onTrajet({ ...trajet, train: choisir(retenu) })}>
              Choisir le {retenu.numero}
            </button>
          )}
        </div>
      )}
      <details class="saisie-prix">
        <summary>{connus ? 'Modifier les prix vus sur le site' : 'Saisir les prix vus sur le site'}</summary>
        <p class="aide">Les prix du site, pour comparer au coût complet (dîner à bord compris). Laissez vide un train sans prix.</p>
        <div class="grille-prix">
          {trains.map((t) => (
            <ChampPrix key={clePrix(t)} id={`${base}-prix-${t.numero}-${t.depart}`} train={t} trajet={trajet} aujourdhui={props.aujourdhui} onTrajet={props.onTrajet} />
          ))}
        </div>
        <div class="champ">
          <label for={`${base}-colle`}>Ou collez la page de résultats</label>
          <textarea
            id={`${base}-colle`}
            rows={3}
            maxLength={200_000}
            value={colle}
            aria-describedby={`${base}-colle-aide`}
            onInput={(e) => {
              setColle((e.currentTarget as HTMLTextAreaElement).value);
              setLecture(null);
            }}
          />
          <span class="aide" id={`${base}-colle-aide`}>
            Sur le site, sélectionnez toute la liste des trains, copiez, collez ici : l’outil y relève les horaires et les prix. Rien n’est envoyé.
          </span>
        </div>
        <button type="button" class="secondaire" disabled={!colle.trim()} onClick={() => setLecture(associerCollage(lireCollage(colle), trains))}>
          Lire les prix
        </button>
        {lecture && (
          <div class="lecture" role="status">
            {lecture.length ? (
              <>
                <p>
                  {lecture.length} prix trouvé{lecture.length > 1 ? 's' : ''} : vérifiez avant d’appliquer.
                </p>
                <ul>
                  {lecture.map((l) => (
                    <li key={clePrix(l.train)}>
                      {formaterHeure(l.train.depart)} · {l.train.operateur} {l.train.numero} : {formaterMontant(l.centimes)}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={appliquer}>
                  Appliquer ces prix
                </button>{' '}
                <button type="button" class="secondaire" onClick={() => setLecture(null)}>
                  Annuler
                </button>
              </>
            ) : (
              <p>Aucun prix reconnu pour les trains de ce créneau : saisissez-les un par un.</p>
            )}
          </div>
        )}
      </details>
    </div>
  );
}
