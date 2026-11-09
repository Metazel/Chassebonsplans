/**
 * Carte Avantage et billets croisés (CU-C) : intérêt de la carte pour les trajets planifiés,
 * et plan de réservation qui croise les allers-retours d'une semaine à l'autre. Indicatif.
 */
import { dateCourte, dateLongue } from '../../domain/dates';
import { formaterHeure } from '../../domain/heure';
import { formaterMontant } from '../../domain/argent';
import { dureeType, estimer, plafond, type Billet, type Jambe, type PlanAvantage } from '../../domain/croises';
import { estAReverifier } from '../../domain/referentiel';
import { REGLES_AVANTAGE as R } from '../../data/avantage';
import { ExternalLink } from './ExternalLink';

const SENS = { MP: 'Marseille → Paris', PM: 'Paris → Marseille' } as const;
const jambe = (j: Jambe) =>
  j.depart !== undefined && j.operateur
    ? `${SENS[j.sens]} ${dateCourte(j.date)} à ${formaterHeure(j.depart)} (${j.operateur} ${j.numero ?? ''})`
    : `${SENS[j.sens]} ${dateCourte(j.date)} (train à choisir : TGV INOUI ou Intercités pour profiter de la carte)`;

function LigneBillet({ b }: { b: Billet }) {
  if (b.type === 'ar')
    return (
      <li>
        <strong>{b.croise ? `Aller-retour croisé depuis ${b.origine}` : 'Aller-retour'}</strong>
        {b.engage && ' (engagé)'} : aller {jambe(b.aller)} ; retour {jambe(b.retour)}.
      </li>
    );
  if (b.type === 'simple')
    return (
      <li>
        <strong>Aller simple du week-end</strong> : {jambe(b.jambe)}.
      </li>
    );
  return (
    <li class="hors-carte">
      <strong>Hors carte</strong> : {jambe(b.jambe)} —{' '}
      {b.raison === 'operateur'
        ? 'la carte ne s’applique pas à cet opérateur'
        : b.raison === 'carte-expiree'
          ? 'après la fin de validité de votre carte'
          : 'aucun autre trajet pour former un aller-retour avec une nuit de week-end'}
      .
    </li>
  );
}

export function Avantage(props: {
  plan: PlanAvantage;
  detenue: boolean;
  /** Carte déclarée mais expirée aujourd'hui. */
  expiree: boolean;
  finValidite?: string;
  prixHabituelCentimes?: number;
}) {
  const { plan } = props;
  if (!plan.total) return null;
  const duree = dureeType(plan);
  const estimation = estimer(R, plan, props.prixHabituelCentimes);
  const reglesAnciennes = estAReverifier(R.meta.verifieLe, new Date());
  const dates = plan.billets.flatMap((b) => (b.type === 'ar' ? [b.retour.date] : b.type === 'simple' ? [b.jambe.date] : []));
  const expireAvant = props.detenue && props.finValidite && dates.some((d) => d > props.finValidite!);

  const plafondTexte = formaterMontant(plafond(R, duree));
  const liste = (
    <ul class="billets">
      {plan.billets.map((b) => (
        <LigneBillet key={b.type === 'ar' ? `${b.aller.id}-${b.aller.cote}` : `${b.jambe.id}-${b.jambe.cote}`} b={b} />
      ))}
    </ul>
  );

  return (
    <section class="avantage" aria-labelledby="titre-avantage">
      <h2 id="titre-avantage">{props.detenue ? 'Votre carte Avantage : billets à prendre' : 'Carte Avantage : intéressante pour vous ?'}</h2>
      {reglesAnciennes && (
        <p class="alerte" role="status">
          Règles de la carte vérifiées le {dateLongue(R.meta.verifieLe)}, il y a plus de 6 mois : vérifiez-les sur le site de la SNCF avant de vous y fier.
        </p>
      )}
      {props.expiree && <p class="alerte">Votre carte Avantage a expiré le {dateLongue(props.finValidite ?? '')} : renouvelez-la, ou mettez à jour Mes leviers.</p>}
      <p>
        {plan.eligibles === 0
          ? `Aucun de vos ${plan.total} trajets à réserver ne profite de la carte pour l’instant : il faut une nuit de vendredi, samedi ou dimanche dans chaque aller-retour.`
          : `${plan.eligibles} de vos ${plan.total} trajets à réserver ${props.detenue ? 'profitent' : 'profiteraient'} de la carte (−${R.reductionPourcent} %, prix plafonné à ${plafondTexte} par trajet)${plan.grace ? `, dont ${plan.grace} grâce aux billets croisés` : ''}.`}
      </p>
      {plan.grace > 0 && (
        <p class="aide">
          Billets croisés : un aller-retour qui enjambe le week-end est éligible, même si vous rentrez entre-temps avec un autre billet. Il suffit de réserver
          chaque aller-retour comme indiqué. Un billet croisé engage sur deux à trois semaines : si votre planning bouge, l’échange au tarif Avantage est
          gratuit jusqu’à 7 jours avant le départ, puis payant.
        </p>
      )}
      {expireAvant && <p class="alerte">Votre carte expire le {dateLongue(props.finValidite!)} : renouvelez-la avant les trajets suivants.</p>}
      {!props.detenue && (
        <>
          <div class="estimation" aria-live="polite">
            {estimation && estimation.estimes > 0 && (
              <p>
                Sur vos trajets planifiés : jusqu’à <strong>{formaterMontant(estimation.economieCentimes)}</strong> d’économie ({estimation.estimes} trajet
                {estimation.estimes > 1 ? 's' : ''}, jusqu’à {formaterMontant(estimation.parTrajetCentimes)} par trajet
                {estimation.aPrixVu > 0 && `, dont ${estimation.aPrixVu} estimé${estimation.aPrixVu > 1 ? 's' : ''} sur le prix vu sur le site`}).
              </p>
            )}
          </div>
          <p class="aide">Sur un an, comparez avec les autres cartes et abonnements dans « Cartes et abonnements », plus bas.</p>
          <p class="aide">
            Vous l’avez déjà ? Déclarez-la dans <a href="#leviers">Mes leviers</a> : la liste « Réserver mes trains » suivra alors ce plan.
          </p>
        </>
      )}
      {props.detenue ? (
        <>
          {liste}
          <p class="aide">La liste « Réserver mes trains » suit ce plan : une recherche aller-retour par billet.</p>
        </>
      ) : (
        <details>
          <summary>Voir comment croiser les billets</summary>
          {liste}
        </details>
      )}
      <p class="aide">
        Estimation maximale : −30 % ou le plafond, en 2de classe ; un prix déjà réduit (Prems, promotion) baisse moins, et les prix réels sont ceux du site
        de vente. Règles :{' '}
        <ExternalLink href={R.meta.source}>carte Avantage Adulte</ExternalLink>, vérifiées le {dateLongue(R.meta.verifieLe)}.
      </p>
    </section>
  );
}
