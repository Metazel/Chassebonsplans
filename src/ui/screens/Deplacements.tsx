import { useEffect, useRef, useState } from 'preact/hooks';
import type { ParametresCout } from '../../domain/coutComplet';
import { dateCourte, dateLongue } from '../../domain/dates';
import { formaterHeure, heureEnClair } from '../../domain/heure';
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
  fenetreDiner,
  heureDiner,
  premierPropose,
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
  changerStatuts,
  choisir,
  payer,
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
import { etatVente, minutesParis, ouverturesAttendues, type OuvertureAttendue } from '../../domain/ventes';
import { estAReverifier } from '../../domain/referentiel';
import { listePanier } from '../../domain/panier';
import { Panier } from '../components/Panier';
import { Avantage } from '../components/Avantage';
import { PrixVus } from '../components/PrixVus';
import { prixVuDe } from '../../domain/prix';
import { figerBillets, planifier } from '../../domain/croises';
import { REGLES_AVANTAGE } from '../../data/avantage';
import { OUVERTURES } from '../../data/ouvertures';
import { REFERENTIEL_COUT } from '../../data/parametres';
import { ExternalLink } from '../components/ExternalLink';

export type EtatHoraires = { etat: 'chargement' } | { etat: 'ok'; horaires: Horaires } | { etat: 'erreur' };

type Cote = 'aller' | 'retour';
const LIBELLE_SENS: Record<Cote, string> = { aller: 'Aller Marseille → Paris', retour: 'Retour Paris → Marseille' };
const LICENCES: Record<string, string> = { 'odc-odbl': 'licence ODbL', lov2: 'Licence Ouverte 2.0', 'fr-lo': 'Licence Ouverte' };

const plage = (c: Cote) => {
  const cr = CRENEAUX[sensDu(c)];
  return `${cr.porte === 'arrivee' ? 'arrivée à Paris' : 'départ de Paris'} entre ${formaterHeure(cr.de)} et ${formaterHeure(cr.a)}`;
};

/** Trains proposés : au retour, jamais de départ avant l'heure fixée (17h30), même un jour sans train dans le créneau. */
const proposerTrajet = (h: Horaires, date: string, cote: Cote) =>
  cote === 'retour' ? proposer(h, date, 'PM', CRENEAUX.PM, REFERENTIEL_COUT.retourPasAvantMin) : proposer(h, date, 'MP');

/** Train présélectionné à la création : le premier du créneau (au retour, le premier qui arrive à l'heure du dîner). */
function preselection(h: Horaires | null, date: string, cote: Cote): Trajet {
  const t: Trajet = { date, statut: 'a-reserver' };
  if (h && couvre(h, date)) {
    const premier = premierPropose(proposerTrajet(h, date, cote), cote === 'retour' ? fenetreDiner(REFERENTIEL_COUT.arriveeDinerGare, REFERENTIEL_COUT.parametres) : undefined);
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

function LigneTrain({ t, cote, p, prix }: { t: TrainHoraire; cote: Cote; p: ParametresCout; prix?: number | undefined }) {
  const repas = cote === 'retour' && repasABord(t, p);
  const tropTot = cote === 'retour' && t.depart < REFERENTIEL_COUT.retourPasAvantMin;
  const diner = cote === 'retour' && !tropTot && heureDiner(t, fenetreDiner(REFERENTIEL_COUT.arriveeDinerGare, p)) === 'diner';
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
      {diner && <span class="ideal"> · à l’heure du dîner</span>}
      {tropTot && <span class="repas a-bord"> · part avant {heureEnClair(REFERENTIEL_COUT.retourPasAvantMin)}</span>}
      {prix !== undefined && (
        <span class="prix-train">
          {' '}
          · {formaterMontant(prix)}
          {repas && `, coût complet ${formaterMontant(prix + p.coutRepasCentimes)}`}
        </span>
      )}
    </>
  );
}

/** Le trajet est-il en vente ? Sinon, date d'ouverture connue ou non (calendrier daté, sans requête). */
function EtatVenteTrajet(props: { operateur: string; date: string; aujourdhui: string }) {
  const e = etatVente(OUVERTURES, props.operateur, props.date, props.aujourdhui, minutesParis());
  if (e.etat === 'non-suivi') return null;
  if (e.etat === 'en-vente') return <p class="vente en-vente">En vente</p>;
  if (e.etat === 'ouverture')
    return (
      <p class="alerte vente">
        Pas encore en vente : ouverture le {dateLongue(e.le)}
        {e.heure !== undefined && ` vers ${heureEnClair(e.heure)}`}.
      </p>
    );
  return <p class="alerte vente">Ouverture des ventes {e.operateur.nom} non encore annoncée pour cette date : vérifiez sur le site.</p>;
}

/**
 * Prépare l'alerte SNCF Connect du trajet : « alerte réservation » s'il n'est pas encore en vente,
 * « alerte petits prix » (prix cible) s'il l'est. L'alerte est créée par le voyageur sur son compte (EXG-08).
 */
function AlerteSncf(props: { base: string; trajet: Trajet; cote: Cote; recherche: string; aujourdhui: string; onTrajet: (t: Trajet) => void }) {
  const { trajet, base } = props;
  const sens = sensDu(props.cote);
  const choisi = trajet.train;
  const e = choisi ? etatVente(OUVERTURES, choisi.operateur, trajet.date, props.aujourdhui, minutesParis()) : { etat: 'en-vente' as const };
  const texteCible = (c: number | undefined) => (c !== undefined ? String(c / 100).replace('.', ',') : '');
  const [cible, setCible] = useState(texteCible(trajet.prixCibleCentimes));
  // Le champ suit la valeur enregistrée quand elle change ailleurs (autre onglet).
  useEffect(() => {
    const v = lirePrix(cible);
    if (v !== null && (v || undefined) !== trajet.prixCibleCentimes) setCible(texteCible(trajet.prixCibleCentimes));
  }, [trajet.prixCibleCentimes]);
  const lu = lirePrix(cible);
  const reservation = e.etat === 'ouverture' || e.etat === 'inconnu';
  const pret = reservation || !!lu;
  return (
    <details class="alerte-sncf">
      <summary>Être prévenu par SNCF Connect{reservation ? ' à l’ouverture des ventes' : ' d’un petit prix'}</summary>
      {!reservation && (
        <div class="champ champ-court">
          <label for={`${base}-cible`}>Prix visé (€)</label>
          <input
            id={`${base}-cible`}
            type="text"
            inputMode="decimal"
            maxLength={10}
            autoComplete="off"
            value={cible}
            aria-invalid={lu === null ? 'true' : undefined}
            aria-describedby={lu === null ? `${base}-cible-err` : undefined}
            onInput={(ev) => {
              const v = (ev.currentTarget as HTMLInputElement).value;
              setCible(v);
              const prix = lirePrix(v);
              if (prix === null) return;
              const t: Trajet = { ...trajet };
              if (prix === undefined || prix === 0) delete t.prixCibleCentimes;
              else t.prixCibleCentimes = prix;
              props.onTrajet(t);
            }}
          />
          {lu === null && (
            <span class="erreur" id={`${base}-cible-err`}>
              Prix invalide : en euros, par exemple 35.
            </span>
          )}
        </div>
      )}
      {pret ? (
        <>
          <p class="aide">Dans le formulaire d’alerte, renseignez :</p>
          <dl class="champs-alerte">
            <dt>Départ</dt>
            <dd>{GARES[sens].depart}</dd>
            <dt>Arrivée</dt>
            <dd>{GARES[sens].arrivee}</dd>
            <dt>Date</dt>
            <dd>{dateLongue(trajet.date)} (aller simple)</dd>
            {!reservation && lu && (
              <>
                <dt>Budget</dt>
                <dd>{formaterMontant(lu)}</dd>
              </>
            )}
          </dl>
          <p>
            Sur <ExternalLink href="https://www.sncf-connect.com/">SNCF Connect</ExternalLink>, connecté à votre compte : Compte › Alertes billets disponibles ›{' '}
            {reservation ? 'Alertes réservation' : 'Alerte petits prix'} › Créer une alerte. Vous serez prévenu par e-mail ou notification.
          </p>
          <p class="aide">Chemin indiqué par l’aide SNCF Connect, vérifié le {dateLongue(OUVERTURES.meta.verifieLe)}.</p>
        </>
      ) : (
        <p class="aide">Indiquez le prix visé pour préparer l’alerte petits prix.</p>
      )}
    </details>
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
  const { dansCreneau, proches } = publie ? proposerTrajet(h, trajet.date, cote) : { dansCreneau: [], proches: [] };
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
  // Pas encore en vente : inutile de proposer la réservation, l'alerte d'ouverture la remplace.
  const pasEnVente = !!choisi && trajet.statut === 'a-reserver' && etatVente(OUVERTURES, choisi.operateur, trajet.date, props.aujourdhui, minutesParis()).etat === 'ouverture';
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
    const t: Trajet = { ...trajet, statut };
    if (statut !== 'option') delete t.limiteOption;
    if (statut !== 'panier') delete t.panierLe;
    // Payé : le prix vu du train devient le prix payé s'il n'y en a pas, puis les prix vus sont oubliés.
    if (statut === 'paye') {
      payer(t);
      if (t.prixCentimes !== undefined) setPrix(prixTexte(t.prixCentimes));
    }
    props.onTrajet(t);
  };

  return (
    <section class="trajet" aria-labelledby={`${base}-titre`}>
      <h3 id={`${base}-titre`}>
        {LIBELLE_SENS[cote]} — {dateLongue(trajet.date)}
      </h3>
      {choisi && trajet.statut === 'a-reserver' && trajet.date >= props.aujourdhui && <EtatVenteTrajet operateur={choisi.operateur} date={trajet.date} aujourdhui={props.aujourdhui} />}
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
      {publie && liste.length === 0 && (
        <p class="alerte">
          {cote === 'retour' && duJour.some((t) => t.depart < REFERENTIEL_COUT.retourPasAvantMin)
            ? `Aucun train direct après ${heureEnClair(REFERENTIEL_COUT.retourPasAvantMin)} ce jour-là dans les horaires publiés.`
            : 'Aucun train direct ce jour-là dans les horaires publiés.'}
        </p>
      )}
      {publie && liste.length > 0 && (
        <fieldset class="choix-train" aria-describedby={`${base}-creneau`}>
          <legend>Train {cote === 'aller' ? 'aller' : 'retour'}</legend>
          <p class="aide" id={`${base}-creneau`}>
            {dansCreneau.length
              ? `Trains avec ${plage(cote)}, ${absentes.length ? 'opérateurs publiés' : 'tous opérateurs'}.`
              : `Aucun train avec ${plage(cote)} ce jour-là. ${cote === 'retour' ? `Voici les suivants (jamais avant ${heureEnClair(REFERENTIEL_COUT.retourPasAvantMin)}).` : 'Voici les plus proches.'}`}
          </p>
          {affiches.map((t) => {
            const cle = cleTrain(t);
            const id = `${base}-${t.numero}-${t.depart}`;
            return (
              <div class="option-train" key={cle}>
                <input type="radio" id={id} name={base} checked={cle === cleChoisi} onChange={() => props.onTrajet({ ...trajet, train: choisir(t) })} />
                <label for={id}>
                  <LigneTrain t={t} cote={cote} p={p} prix={prixVuDe(trajet.prixVus, t)?.centimes} />
                </label>
              </div>
            );
          })}
        </fieldset>
      )}
      {publie && affiches.length > 0 && trajet.statut === 'a-reserver' && trajet.date >= props.aujourdhui && !pasEnVente && (
        <PrixVus
          base={base}
          cote={cote}
          trains={cote === 'retour' ? affiches.filter((t) => t.depart >= REFERENTIEL_COUT.retourPasAvantMin) : affiches}
          trajet={trajet}
          p={p}
          aujourdhui={props.aujourdhui}
          onTrajet={props.onTrajet}
        />
      )}
      {choisi && publie && !trainChoisi && (
        <p class="alerte">
          Le train {choisi.numero} de {formaterHeure(choisi.depart)} n’apparaît plus dans les horaires publiés pour ce jour : vérifiez-le sur le site de
          vente.
        </p>
      )}
      {choisi && recherche && !pasEnVente && (
        <div class="reservation">
          <p class="recherche" id={`${base}-recherche`}>
            {recherche}
          </p>
          <div class="actions">
            <button type="button" class="secondaire" aria-describedby={`${base}-recherche`} onClick={() => void copier()}>
              Copier la recherche
            </button>
            {canal && <ExternalLink href={canal.url}>Réserver sur {canal.nom}</ExternalLink>}
          </div>
          <p class="aide" aria-live="polite">
            {copie === 'ok' && 'Recherche copiée : collez-la dans le champ de recherche du site de vente.'}
            {copie === 'echec' && 'Copie impossible ici : sélectionnez le texte ci-dessus pour le copier.'}
          </p>
        </div>
      )}
      {choisi && trajet.statut === 'a-reserver' && trajet.date >= props.aujourdhui && canalVente(choisi.operateur).nom === 'SNCF Connect' && (
        <AlerteSncf base={base} trajet={trajet} cote={cote} recherche={recherche ?? ''} aujourdhui={props.aujourdhui} onTrajet={props.onTrajet} />
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
  selectionne: boolean;
  onSelection: (oui: boolean) => void;
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
  const periode = `du ${dateCourte(d.aller.date)} au ${dateCourte(d.retour.date)}`;
  return (
    <li class={props.selectionne ? 'deplacement selectionne' : 'deplacement'}>
      <article aria-labelledby={`${d.id}-titre`}>
        <div class="tete-deplacement">
          <h2 id={`${d.id}-titre`} tabIndex={-1}>
            Du {dateCourte(d.aller.date)} au {dateCourte(d.retour.date)}
          </h2>
          <div class="actions-deplacement">
          <label class="selection" for={`${d.id}-sel`}>
            <input type="checkbox" id={`${d.id}-sel`} checked={props.selectionne} onChange={(e) => props.onSelection((e.currentTarget as HTMLInputElement).checked)} />
            <span aria-hidden="true">Sélectionner</span>
            <span class="sr-only">Sélectionner le déplacement {periode}</span>
          </label>
          {!confirmer && (
            <button
              type="button"
              class="secondaire supprimer"
              ref={supprimer}
              aria-label={`Supprimer le déplacement ${periode}`}
              onClick={() => {
                focus.current = 'annuler';
                setConfirmer(true);
              }}
            >
              Supprimer
            </button>
          )}
          </div>
        </div>
        {confirmer && (
          <div class="confirmation" role="group" aria-labelledby={`${d.id}-conf`}>
            <p id={`${d.id}-conf`}>Supprimer le déplacement {periode} ?</p>
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
        <p class="aide">
          {restants === 0 ? 'Réservation terminée.' : restants === 1 ? 'Un trajet reste à payer.' : 'Deux trajets restent à payer.'}
          {total > 0 && ` Total payé : ${formaterMontant(total)}.`}
        </p>
        {(['aller', 'retour'] as const).map((cote) => (
          <BlocTrajet key={cote} d={d} cote={cote} horaires={props.horaires} p={props.p} aujourdhui={props.aujourdhui} onTrajet={(t) => props.onChange({ ...d, [cote]: t })} />
        ))}
      </article>
    </li>
  );
}

/** Bandeau des ouvertures de ventes à venir qui concernent des trajets à réserver, avec rappel agenda. */
function BandeauOuvertures(props: { ouvertures: OuvertureAttendue[]; onRappel: (o: OuvertureAttendue) => void }) {
  if (!props.ouvertures.length) return null;
  return (
    <section class="ouvertures" aria-labelledby="titre-ouvertures">
      <h2 id="titre-ouvertures">Ouvertures des ventes à venir</h2>
      <ul>
        {props.ouvertures.map((o) => (
          <li key={`${o.operateur.id}-${o.le}`}>
            <p>
              <strong>
                {o.operateur.nom} : {dateLongue(o.le)}
                {o.heure !== undefined && `, vers ${heureEnClair(o.heure)}`}
              </strong>{' '}
              — {o.trajets.length} de vos trajets attend{o.trajets.length > 1 ? 'ent' : ''} cette ouverture. Les premiers billets sont les moins chers.
            </p>
            <button type="button" class="secondaire" onClick={() => props.onRappel(o)}>
              Me réveiller pour l’ouverture {o.operateur.nom} (.ics)
            </button>
          </li>
        ))}
      </ul>
      <p class="aide">Heure indicative, constatée lors des dernières ouvertures. Calendrier vérifié le {dateLongue(OUVERTURES.meta.verifieLe)}.</p>
    </section>
  );
}

export function Deplacements(props: {
  deplacements: Deplacement[];
  horaires: EtatHoraires;
  parametres: ParametresCout;
  aujourdhui: string;
  onChange: (liste: Deplacement[]) => void;
  /** Carte Avantage déclarée dans Mes leviers (et sa fin de validité). */
  avantage: { detenue: boolean; finValidite?: string };
  prixHabituelCentimes?: number;
  onPrixHabituel: (centimes: number | undefined) => void;
}) {
  const { deplacements, aujourdhui } = props;
  const [aller, setAller] = useState('');
  const [retour, setRetour] = useState('');
  const [erreur, setErreur] = useState<{ texte: string; champ: 'aller' | 'retour' } | null>(null);
  const [annonce, setAnnonce] = useState('');
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [confirmerSelection, setConfirmerSelection] = useState(false);
  const focusApres = useRef<string | null>(null);
  const h = props.horaires.etat === 'ok' ? props.horaires.horaires : null;

  useEffect(() => {
    if (focusApres.current) {
      document.getElementById(focusApres.current)?.focus();
      focusApres.current = null;
    }
  });
  // Une sélection ne garde que des déplacements qui existent encore (suppression ailleurs, autre onglet).
  useEffect(() => {
    const ids = new Set(deplacements.map((d) => d.id));
    if ([...selection].some((id) => !ids.has(id))) setSelection(new Set([...selection].filter((id) => ids.has(id))));
  }, [deplacements]);

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
  const maintenant = minutesParis();
  const ouvertures = ouverturesAttendues(OUVERTURES, aVenir, aujourdhui, maintenant);
  const avecTrain = aVenir.filter(aExporter);
  const carteActive = props.avantage.detenue && (!props.avantage.finValidite || props.avantage.finValidite >= aujourdhui);
  const plan = planifier(REGLES_AVANTAGE, deplacements, aujourdhui, {
    maintenant,
    ouvertures: OUVERTURES,
    ...(carteActive && props.avantage.finValidite ? { finValidite: props.avantage.finValidite } : {}),
  });
  // Avec la carte, un aller-retour du plan dont un trajet quitte « à réserver » est figé : le plan ne le réapparie plus.
  const changer = (liste: Deplacement[]) => props.onChange(carteActive ? figerBillets(plan, liste, nouvelId) : liste);
  const groupesPanier = listePanier(deplacements, aujourdhui, maintenant, OUVERTURES, carteActive ? plan : undefined);
  const calendrierAncien = estAReverifier(OUVERTURES.meta.verifieLe, new Date(), 2);
  const age = h ? ageHoraires(h, aujourdhui) : 0;

  const maj = (d: Deplacement) => changer(deplacements.map((x) => (x.id === d.id ? d : x)));
  const retirer = (d: Deplacement) => {
    setAnnonce(`Déplacement supprimé : du ${dateCourte(d.aller.date)} au ${dateCourte(d.retour.date)}`);
    focusApres.current = 'titre-liste';
    props.onChange(deplacements.filter((x) => x.id !== d.id));
  };
  const selectionner = (id: string, oui: boolean) => {
    const s2 = new Set(selection);
    if (oui) s2.add(id);
    else s2.delete(id);
    setSelection(s2);
    if (!s2.size) setConfirmerSelection(false);
  };
  const supprimerSelection = () => {
    const n = selection.size;
    props.onChange(deplacements.filter((d) => !selection.has(d.id)));
    setSelection(new Set());
    setConfirmerSelection(false);
    setAnnonce(`${n} déplacement${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}`);
    focusApres.current = 'titre-liste';
  };

  const carte = (d: Deplacement) => (
    <CarteDeplacement
      key={d.id}
      d={d}
      horaires={props.horaires}
      p={props.parametres}
      aujourdhui={aujourdhui}
      selectionne={selection.has(d.id)}
      onSelection={(oui) => selectionner(d.id, oui)}
      onChange={maj}
      onSupprimer={() => retirer(d)}
    />
  );

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
      <Panier
        groupes={groupesPanier}
        deplacements={deplacements}
        aujourdhui={aujourdhui}
        onStatut={(cibles, statut, extra) => changer(changerStatuts(deplacements, cibles, statut, extra))}
        onAnnonce={setAnnonce}
      />
      <Avantage
        plan={plan}
        detenue={carteActive}
        expiree={props.avantage.detenue && !carteActive}
        {...(props.avantage.finValidite ? { finValidite: props.avantage.finValidite } : {})}
        {...(props.prixHabituelCentimes !== undefined ? { prixHabituelCentimes: props.prixHabituelCentimes } : {})}
        onPrixHabituel={props.onPrixHabituel}
      />
      {calendrierAncien && (
        <p class="alerte" role="status">
          Calendrier des ouvertures de ventes vérifié le {dateLongue(OUVERTURES.meta.verifieLe)} : il a pu changer, vérifiez sur les sites de vente.
        </p>
      )}
      <BandeauOuvertures
        ouvertures={ouvertures}
        onRappel={(o) => {
          telechargerTexte(genererIcs([], new Date(), [o]), `ouverture-ventes-${o.operateur.id}-${o.le}.ics`, 'text/calendar');
          setAnnonce(`Rappel de l’ouverture ${o.operateur.nom} téléchargé : ouvrez-le pour l’ajouter à votre agenda.`);
        }}
      />

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
        {selection.size > 0 && (
          <div class="barre-selection" role="group" aria-label="Déplacements sélectionnés">
            {!confirmerSelection ? (
              <>
                <p>
                  {selection.size} déplacement{selection.size > 1 ? 's' : ''} sélectionné{selection.size > 1 ? 's' : ''}
                </p>
                <button
                  type="button"
                  class="danger"
                  id="supprimer-selection"
                  onClick={() => {
                    focusApres.current = 'annuler-selection';
                    setConfirmerSelection(true);
                  }}
                >
                  Supprimer la sélection
                </button>{' '}
                <button type="button" class="secondaire" onClick={() => setSelection(new Set())}>
                  Tout désélectionner
                </button>
              </>
            ) : (
              <>
                <p>
                  Supprimer définitivement {selection.size} déplacement{selection.size > 1 ? 's' : ''} ?
                </p>
                <button type="button" class="danger" onClick={supprimerSelection}>
                  Oui, supprimer
                </button>{' '}
                <button
                  type="button"
                  class="secondaire"
                  id="annuler-selection"
                  onClick={() => {
                    focusApres.current = 'supprimer-selection';
                    setConfirmerSelection(false);
                  }}
                >
                  Annuler
                </button>
              </>
            )}
          </div>
        )}
        {aVenir.length === 0 ? (
          <p class="aide">Aucun déplacement prévu.</p>
        ) : (
          <ul class="deplacements">{aVenir.map(carte)}</ul>
        )}
        {avecTrain.length > 0 && (
          <p>
            <button
              type="button"
              onClick={() => {
                telechargerTexte(genererIcs(avecTrain, new Date(), ouvertures), 'chassebonsplans-deplacements.ics', 'text/calendar');
                setAnnonce('Fichier agenda téléchargé : ouvrez-le pour ajouter vos trains, ouvertures de ventes et rappels d’option.');
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
              {passes.map(carte)}
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
