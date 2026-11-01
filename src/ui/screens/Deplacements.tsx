import { useEffect, useRef, useState } from 'preact/hooks';
import type { ParametresCout } from '../../domain/coutComplet';
import { dateCourte, dateLongue } from '../../domain/dates';
import { formaterHeure } from '../../domain/heure';
import { formaterMontant } from '../../domain/argent';
import {
  AGE_MAX_HORAIRES,
  CRENEAUX,
  GARES,
  ageHoraires,
  arriveeDomicile,
  canalVente,
  cleTrain,
  couvre,
  proposer,
  repasABord,
  sourcesAbsentes,
  texteRecherche,
  trainsDuJour,
  type Horaires,
  type TrainHoraire,
} from '../../domain/horaires';
import {
  LIBELLES_STATUT,
  MAX_DEPLACEMENTS,
  STATUTS,
  choisir,
  lirePrix,
  nouveauDeplacement,
  nouvelId,
  optionsUrgentes,
  sensDu,
  totalPaye,
  trier,
  verifierDates,
  type Deplacement,
  type Statut,
  type Trajet,
} from '../../domain/deplacements';
import { aExporter, genererIcs } from '../../domain/ics';
import { ExternalLink } from '../components/ExternalLink';

export type EtatHoraires = { etat: 'chargement' } | { etat: 'ok'; horaires: Horaires } | { etat: 'erreur' };

type Cote = 'aller' | 'retour';
const LIBELLE_SENS: Record<Cote, string> = { aller: 'Aller Marseille → Paris', retour: 'Retour Paris → Marseille' };
const LICENCES: Record<string, string> = { 'odc-odbl': 'licence ODbL', lov2: 'Licence Ouverte 2.0', 'fr-lo': 'Licence Ouverte' };

const plage = (c: Cote) => {
  const cr = CRENEAUX[sensDu(c)];
  return `${cr.porte === 'arrivee' ? 'arrivée à Paris' : 'départ de Paris'} entre ${formaterHeure(cr.de)} et ${formaterHeure(cr.a)}`;
};

/** Train présélectionné à la création : le premier du créneau, s'il y en a un. */
function preselection(h: Horaires | null, date: string, cote: Cote): Trajet {
  const t: Trajet = { date, statut: 'a-reserver' };
  if (h && couvre(h, date)) {
    const premier = proposer(h, date, sensDu(cote)).dansCreneau[0];
    if (premier) t.train = choisir(premier);
  }
  return t;
}

/** Termine une phrase par un point, sans doubler celui d'une abréviation (« nov. »). */
const finPhrase = (t: string) => (t.endsWith('.') ? t : `${t}.`);

function telechargerTexte(contenu: string, nom: string, type: string) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LigneTrain({ t, cote, p }: { t: TrainHoraire; cote: Cote; p: ParametresCout }) {
  const repas = cote === 'retour' && repasABord(t, p);
  return (
    <>
      <span class="horaire">
        {formaterHeure(t.depart)} → {formaterHeure(t.arrivee)}
      </span>{' '}
      <span class="train-nom">
        {t.operateur} {t.numero}
      </span>
      {cote === 'retour' && (
        <span class={repas ? 'repas a-bord' : 'repas'}>
          {repas
            ? ` · chez vous vers ${formaterHeure(arriveeDomicile(t, p))} : dîner à bord (${formaterMontant(p.coutRepasCentimes)})`
            : ` · chez vous vers ${formaterHeure(arriveeDomicile(t, p))}`}
        </span>
      )}
    </>
  );
}

function BlocTrajet(props: {
  d: Deplacement;
  cote: Cote;
  horaires: EtatHoraires;
  p: ParametresCout;
  aujourdhui: string;
  onTrajet: (t: Trajet) => void;
}) {
  const { d, cote, p } = props;
  const trajet = d[cote];
  const sens = sensDu(cote);
  const base = `${d.id}-${cote}`;
  const prixTexte = (c: number | undefined) => (c !== undefined ? formaterMontant(c).replace(/\s?€/, '').replace(/\s/g, '') : '');
  const [prix, setPrix] = useState(prixTexte(trajet.prixCentimes));
  const [copie, setCopie] = useState<'ok' | 'echec' | null>(null);
  // Le champ suit le prix enregistré quand il change ailleurs (autre onglet, restauration).
  useEffect(() => {
    const lu = lirePrix(prix);
    if (lu !== null && lu !== trajet.prixCentimes) setPrix(prixTexte(trajet.prixCentimes));
  }, [trajet.prixCentimes]);
  const h = props.horaires.etat === 'ok' ? props.horaires.horaires : null;
  const publie = h !== null && couvre(h, trajet.date);
  const { dansCreneau, proches } = publie ? proposer(h, trajet.date, sens) : { dansCreneau: [], proches: [] };
  const liste = dansCreneau.length ? dansCreneau : proches;
  const absentes = publie ? sourcesAbsentes(h, trajet.date) : [];
  const choisi = trajet.train;
  const cleChoisi = choisi ? cleTrain({ sens, ...choisi }) : null;
  // Le train choisi est recherché dans tous les trains du jour (il peut être hors créneau).
  const duJour = publie ? trainsDuJour(h, trajet.date, sens) : [];
  const trainChoisi = cleChoisi ? duJour.find((t) => cleTrain(t) === cleChoisi) : undefined;
  const affiches = trainChoisi && !liste.some((t) => cleTrain(t) === cleChoisi) ? [...liste, trainChoisi] : liste;
  const prixLu = lirePrix(prix);
  const recherche = choisi
    ? texteRecherche(
        { gareDepart: trainChoisi?.gareDepart ?? GARES[sens].depart, gareArrivee: trainChoisi?.gareArrivee ?? GARES[sens].arrivee, depart: choisi.depart, numero: choisi.numero },
        trajet.date,
      )
    : null;
  const canal = choisi ? canalVente(choisi.operateur) : null;
  // Le message « copiée » ne vaut que pour la recherche affichée.
  useEffect(() => setCopie(null), [recherche]);

  const copier = async () => {
    if (!recherche) return;
    try {
      await navigator.clipboard.writeText(recherche);
      setCopie('ok');
    } catch {
      setCopie('echec');
    }
  };

  const changerStatut = (statut: Statut) => {
    const t: Trajet = { date: trajet.date, statut };
    if (trajet.train) t.train = trajet.train;
    if (statut === 'option' && trajet.limiteOption) t.limiteOption = trajet.limiteOption;
    if (trajet.prixCentimes !== undefined) t.prixCentimes = trajet.prixCentimes;
    props.onTrajet(t);
  };

  return (
    <section class="trajet" aria-labelledby={`${base}-titre`}>
      <h3 id={`${base}-titre`}>
        {LIBELLE_SENS[cote]} — {dateLongue(trajet.date)}
      </h3>
      {props.horaires.etat === 'chargement' && <p class="aide">Chargement des horaires…</p>}
      {props.horaires.etat === 'erreur' && <p class="alerte">Horaires indisponibles : choisissez votre train directement sur le site de vente.</p>}
      {h && !publie && trajet.date < h.debut && trajet.date >= props.aujourdhui && <p class="aide">Horaires non disponibles pour cette date.</p>}
      {h && !publie && trajet.date > h.fin && (
        <p class="alerte">
          Horaires pas encore publiés pour cette date (connus du {dateCourte(h.debut)} au {dateCourte(h.fin)}). Revenez plus tard : ils sont mis à jour
          chaque semaine.
        </p>
      )}
      {publie && absentes.length > 0 && (
        <p class="alerte">Horaires {absentes.join(', ')} pas encore publiés pour cette date : la liste peut être incomplète.</p>
      )}
      {publie && liste.length === 0 && <p class="alerte">Aucun train direct ce jour-là dans les horaires publiés.</p>}
      {publie && liste.length > 0 && (
        <fieldset class="choix-train" aria-describedby={`${base}-creneau`}>
          <legend>Train {cote === 'aller' ? 'aller' : 'retour'}</legend>
          <p class="aide" id={`${base}-creneau`}>
            {dansCreneau.length
              ? `Trains avec ${plage(cote)}, ${absentes.length ? 'opérateurs publiés' : 'tous opérateurs'}.`
              : `Aucun train avec ${plage(cote)} ce jour-là. Voici les plus proches.`}
          </p>
          {affiches.map((t) => {
            const cle = cleTrain(t);
            const id = `${base}-${t.numero}-${t.depart}`;
            return (
              <div class="option-train" key={cle}>
                <input type="radio" id={id} name={base} checked={cle === cleChoisi} onChange={() => props.onTrajet({ ...trajet, train: choisir(t) })} />
                <label for={id}>
                  <LigneTrain t={t} cote={cote} p={p} />
                </label>
              </div>
            );
          })}
        </fieldset>
      )}
      {choisi && publie && !trainChoisi && (
        <p class="alerte">
          Le train {choisi.numero} de {formaterHeure(choisi.depart)} n’apparaît plus dans les horaires publiés pour ce jour : vérifiez-le sur le site de
          vente.
        </p>
      )}
      {choisi && recherche && (
        <div class="reservation">
          <p class="recherche" id={`${base}-recherche`}>
            {recherche}
          </p>
          <div class="actions">
            <button type="button" class="secondaire" aria-describedby={`${base}-recherche`} onClick={() => void copier()}>
              Copier la recherche
            </button>
            {canal ? (
              <ExternalLink href={canal.url}>Réserver sur {canal.nom}</ExternalLink>
            ) : (
              <span class="aide">OUIGO : réservez sur le site ou l’application OUIGO.</span>
            )}
          </div>
          <p class="aide" aria-live="polite">
            {copie === 'ok' && 'Recherche copiée : collez-la dans le champ de recherche du site de vente.'}
            {copie === 'echec' && 'Copie impossible ici : sélectionnez le texte ci-dessus pour le copier.'}
          </p>
        </div>
      )}
      <div class="ligne suivi">
        <div class="champ">
          <label for={`${base}-statut`}>
            Réservation<span class="sr-only"> {cote === 'aller' ? 'aller' : 'retour'} du {dateCourte(trajet.date)}</span>
          </label>
          <select id={`${base}-statut`} value={trajet.statut} onChange={(e) => changerStatut((e.currentTarget as HTMLSelectElement).value as Statut)}>
            {STATUTS.map((s) => (
              <option key={s} value={s}>
                {LIBELLES_STATUT[s]}
              </option>
            ))}
          </select>
        </div>
        {trajet.statut === 'option' && (
          <div class="champ">
            <label for={`${base}-limite`}>Payer l’option avant le</label>
            <input
              id={`${base}-limite`}
              type="date"
              value={trajet.limiteOption ?? ''}
              max={trajet.date}
              onInput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                const t: Trajet = { ...trajet };
                if (v) t.limiteOption = v;
                else delete t.limiteOption;
                props.onTrajet(t);
              }}
            />
          </div>
        )}
        {trajet.statut === 'paye' && (
          <div class="champ">
            <label for={`${base}-prix`}>Prix payé (€, facultatif)</label>
            <input
              id={`${base}-prix`}
              type="text"
              inputMode="decimal"
              maxLength={10}
              autoComplete="off"
              value={prix}
              aria-invalid={prixLu === null ? 'true' : undefined}
              aria-describedby={prixLu === null ? `${base}-prix-err` : undefined}
              onInput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                setPrix(v);
                const lu = lirePrix(v);
                if (lu === null) return;
                const t: Trajet = { ...trajet };
                if (lu === undefined) delete t.prixCentimes;
                else t.prixCentimes = lu;
                props.onTrajet(t);
              }}
            />
            {prixLu === null && (
              <span class="erreur" id={`${base}-prix-err`}>
                Prix invalide : en euros, par exemple 39,90.
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function CarteDeplacement(props: {
  d: Deplacement;
  horaires: EtatHoraires;
  p: ParametresCout;
  aujourdhui: string;
  onChange: (d: Deplacement) => void;
  onSupprimer: () => void;
}) {
  const { d } = props;
  const [confirmer, setConfirmer] = useState(false);
  const annuler = useRef<HTMLButtonElement>(null);
  const supprimer = useRef<HTMLButtonElement>(null);
  const focus = useRef<'annuler' | 'supprimer' | null>(null);
  useEffect(() => {
    if (focus.current === 'annuler') annuler.current?.focus();
    else if (focus.current === 'supprimer') supprimer.current?.focus();
    focus.current = null;
  }, [confirmer]);
  const total = totalPaye(d);
  const restants = [d.aller, d.retour].filter((t) => t.statut !== 'paye').length;
  return (
    <li class="deplacement">
      <article aria-labelledby={`${d.id}-titre`}>
        <h2 id={`${d.id}-titre`} tabIndex={-1}>
          Du {dateCourte(d.aller.date)} au {dateCourte(d.retour.date)}
        </h2>
        <p class="aide">
          {restants === 0 ? 'Réservation terminée.' : restants === 1 ? 'Un trajet reste à payer.' : 'Deux trajets restent à payer.'}
          {total > 0 && ` Total payé : ${formaterMontant(total)}.`}
        </p>
        {(['aller', 'retour'] as const).map((cote) => (
          <BlocTrajet key={cote} d={d} cote={cote} horaires={props.horaires} p={props.p} aujourdhui={props.aujourdhui} onTrajet={(t) => props.onChange({ ...d, [cote]: t })} />
        ))}
        {!confirmer ? (
          <button
            type="button"
            class="secondaire"
            ref={supprimer}
            onClick={() => {
              focus.current = 'annuler';
              setConfirmer(true);
            }}
          >
            Supprimer ce déplacement
          </button>
        ) : (
          <div class="confirmation" role="group" aria-labelledby={`${d.id}-conf`}>
            <p id={`${d.id}-conf`}>Supprimer le déplacement du {dateCourte(d.aller.date)} au {dateCourte(d.retour.date)} ?</p>
            <button type="button" class="danger" onClick={props.onSupprimer}>
              Oui, supprimer
            </button>{' '}
            <button
              type="button"
              class="secondaire"
              ref={annuler}
              onClick={() => {
                focus.current = 'supprimer';
                setConfirmer(false);
              }}
            >
              Annuler
            </button>
          </div>
        )}
      </article>
    </li>
  );
}

export function Deplacements(props: {
  deplacements: Deplacement[];
  horaires: EtatHoraires;
  parametres: ParametresCout;
  aujourdhui: string;
  onChange: (liste: Deplacement[]) => void;
}) {
  const { deplacements, aujourdhui } = props;
  const [aller, setAller] = useState('');
  const [retour, setRetour] = useState('');
  const [erreur, setErreur] = useState<{ texte: string; champ: 'aller' | 'retour' } | null>(null);
  const [annonce, setAnnonce] = useState('');
  const focusApres = useRef<string | null>(null);
  const h = props.horaires.etat === 'ok' ? props.horaires.horaires : null;

  useEffect(() => {
    if (focusApres.current) {
      document.getElementById(focusApres.current)?.focus();
      focusApres.current = null;
    }
  });

  const ajouter = (e: Event) => {
    e.preventDefault();
    let err = verifierDates(aller, retour);
    if (!err && aller < aujourdhui) err = 'Le déplacement doit commencer aujourd’hui ou plus tard.';
    if (!err && deplacements.length >= MAX_DEPLACEMENTS) err = `${MAX_DEPLACEMENTS} déplacements au plus : supprimez-en d’anciens.`;
    if (err) {
      const champ = err.includes('retour') ? 'retour' : 'aller';
      setErreur({ texte: err, champ });
      focusApres.current = `nouveau-${champ}`;
      return;
    }
    const d: Deplacement = { ...nouveauDeplacement(nouvelId(), aller, retour), aller: preselection(h, aller, 'aller'), retour: preselection(h, retour, 'retour') };
    setErreur(null);
    setAller('');
    setRetour('');
    setAnnonce(`Déplacement ajouté : du ${dateCourte(aller)} au ${dateCourte(retour)}`);
    focusApres.current = `${d.id}-titre`;
    props.onChange(trier([...deplacements, d]));
  };

  const aVenir = deplacements.filter((d) => d.retour.date >= aujourdhui);
  const passes = deplacements.filter((d) => d.retour.date < aujourdhui);
  const urgentes = optionsUrgentes(deplacements, aujourdhui);
  const avecTrain = aVenir.filter(aExporter);
  const age = h ? ageHoraires(h, aujourdhui) : 0;

  const maj = (d: Deplacement) => props.onChange(deplacements.map((x) => (x.id === d.id ? d : x)));
  const retirer = (d: Deplacement) => {
    setAnnonce(`Déplacement supprimé : du ${dateCourte(d.aller.date)} au ${dateCourte(d.retour.date)}`);
    focusApres.current = 'titre-liste';
    props.onChange(deplacements.filter((x) => x.id !== d.id));
  };

  const champDate = (champ: 'aller' | 'retour', libelle: string, valeur: string, set: (v: string) => void, min: string) => (
    <div class="champ">
      <label for={`nouveau-${champ}`}>{libelle}</label>
      <input
        id={`nouveau-${champ}`}
        type="date"
        value={valeur}
        min={min}
        aria-invalid={erreur?.champ === champ ? 'true' : undefined}
        aria-describedby={erreur?.champ === champ ? 'nouveau-err' : undefined}
        onInput={(e) => set((e.currentTarget as HTMLInputElement).value)}
      />
    </div>
  );

  return (
    <>
      <h1 id="titre-vue" tabIndex={-1}>
        Mes déplacements
      </h1>
      <p class="intro">
        Indiquez vos jours à Paris : l’outil liste les trains de vos créneaux, tous opérateurs, et prépare votre réservation. Vous réservez ensuite sur le
        site de vente ; rien n’est réservé ni payé ici.
      </p>
      {h && age > AGE_MAX_HORAIRES && (
        <p class="alerte" role="status">
          Horaires mis à jour il y a {age} jours : ils ont pu changer. Vérifiez sur le site de vente.
        </p>
      )}
      {h && h.ecartes > 0 && (
        <p class="alerte" role="status">
          {h.ecartes > 1
            ? `${h.ecartes} trains illisibles dans les horaires publiés ont été écartés : vérifiez sur le site de vente.`
            : 'Un train illisible dans les horaires publiés a été écarté : vérifiez sur le site de vente.'}
        </p>
      )}
      <p class="sr-only" aria-live="polite">
        {annonce}
      </p>
      {urgentes.length > 0 && (
        <ul class="avertissements" aria-label="Options à payer">
          {urgentes.map(({ deplacement: d, cote }) => (
            <li key={`${d.id}-${cote}`}>
              {finPhrase(
                (d[cote].limiteOption ?? d[cote].date) < aujourdhui
                  ? `Option ${cote} du ${dateCourte(d[cote].date)} expirée le ${dateCourte(d[cote].limiteOption ?? d[cote].date)} : vérifiez votre réservation`
                  : `Option ${cote} du ${dateCourte(d[cote].date)} à payer avant le ${dateCourte(d[cote].limiteOption ?? d[cote].date)}`,
              )}
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="titre-ajout">
        <h2 id="titre-ajout">Ajouter un déplacement</h2>
        <form class="ajout" onSubmit={ajouter} noValidate>
          <div class="ligne">
            {champDate('aller', 'Aller (Marseille → Paris) le', aller, setAller, aujourdhui)}
            {champDate('retour', 'Retour (Paris → Marseille) le', retour, setRetour, aller || aujourdhui)}
          </div>
          {erreur && (
            <p class="erreur" id="nouveau-err">
              {erreur.texte}
            </p>
          )}
          <button type="submit">Ajouter ce déplacement</button>
        </form>
      </section>

      <section aria-labelledby="titre-liste">
        <h2 id="titre-liste" tabIndex={-1}>
          À venir
        </h2>
        {aVenir.length === 0 ? (
          <p class="aide">Aucun déplacement prévu.</p>
        ) : (
          <ul class="deplacements">
            {aVenir.map((d) => (
              <CarteDeplacement key={d.id} d={d} horaires={props.horaires} p={props.parametres} aujourdhui={aujourdhui} onChange={maj} onSupprimer={() => retirer(d)} />
            ))}
          </ul>
        )}
        {avecTrain.length > 0 && (
          <p>
            <button
              type="button"
              onClick={() => {
                telechargerTexte(genererIcs(avecTrain), 'chassebonsplans-deplacements.ics', 'text/calendar');
                setAnnonce('Fichier agenda téléchargé : ouvrez-le pour ajouter vos trains et rappels d’option.');
              }}
            >
              Ajouter à mon agenda (.ics)
            </button>
          </p>
        )}
      </section>

      {passes.length > 0 && (
        <section aria-labelledby="titre-passes">
          <details>
            <summary>
              <h2 id="titre-passes">Déplacements passés ({passes.length})</h2>
            </summary>
            <p class="aide">Conservés 24 mois, puis effacés automatiquement.</p>
            <ul class="deplacements">
              {passes.map((d) => (
                <CarteDeplacement key={d.id} d={d} horaires={props.horaires} p={props.parametres} aujourdhui={aujourdhui} onChange={maj} onSupprimer={() => retirer(d)} />
              ))}
            </ul>
          </details>
        </section>
      )}

      {h && (
        <section aria-labelledby="titre-sources">
          <h2 id="titre-sources">Sources des horaires</h2>
          <p class="aide">
            Horaires théoriques du {dateLongue(h.debut)} au {dateLongue(h.fin)}, mis à jour le {dateLongue(h.genereLe)}. Ils peuvent changer : vérifiez
            toujours sur le site de vente.
          </p>
          <ul class="aide">
            {h.sources.map((s) => (
              <li key={s.url}>
                <ExternalLink href={s.url}>{s.nom}</ExternalLink>, {LICENCES[s.licence] ?? s.licence}
                {s.fin && s.fin < h.fin && `, publiés jusqu’au ${dateLongue(s.fin)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
