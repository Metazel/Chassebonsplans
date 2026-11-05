/**
 * Carte Avantage et billets croisés (CU-C) : intérêt de la carte pour les trajets planifiés,
 * et plan de réservation qui croise les allers-retours d'une semaine à l'autre. Indicatif.
 */
import { useEffect, useState } from 'preact/hooks';
import { dateCourte, dateLongue } from '../../domain/dates';
import { formaterHeure } from '../../domain/heure';
import { formaterMontant } from '../../domain/argent';
import { lirePrix } from '../../domain/deplacements';
import { dureeType, estimer, jambesCouvertes, plafond, projectionAnnuelle, type Billet, type Jambe, type PlanAvantage } from '../../domain/croises';
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
  onPrixHabituel: (centimes: number | undefined) => void;
}) {
  const { plan } = props;
  const texte = (c: number | undefined) => (c !== undefined ? String(c / 100).replace('.', ',') : '');
  const [prix, setPrix] = useState(texte(props.prixHabituelCentimes));
  const [ar, setAr] = useState('40');
  useEffect(() => {
    const v = lirePrix(prix);
    if (v !== null && (v || undefined) !== props.prixHabituelCentimes) setPrix(texte(props.prixHabituelCentimes));
  }, [props.prixHabituelCentimes]);
  if (!plan.total) return null;
  const lu = lirePrix(prix);
  const prixOk = lu !== null && (lu === undefined || lu <= 100_000);
  const duree = dureeType(plan);
  const estimation = prixOk ? estimer(R, plan, lu || undefined) : null;
  // Prix de référence pour l'année : le prix habituel saisi, sinon la moyenne des prix vus sur le site.
  // Seuls les trajets couverts par la carte (pas OUIGO ni les billets hors carte) servent de référence.
  const vus = jambesCouvertes(plan).flatMap((j) => (j.prixVuCentimes !== undefined ? [j.prixVuCentimes] : []));
  const reference = lu || (vus.length ? Math.round(vus.reduce((a, b) => a + b, 0) / vus.length) : undefined);
  const arParAn = /^\d{1,3}$/.test(ar.trim()) ? Number(ar) : null;
  const projection = reference && prixOk && arParAn !== null && arParAn <= 60 ? projectionAnnuelle(R, reference, arParAn, duree) : null;
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
          <div class="champ champ-court">
            <label for="prix-habituel">Prix habituel d’un trajet sans carte (€)</label>
            <input
              id="prix-habituel"
              type="text"
              inputMode="decimal"
              maxLength={10}
              autoComplete="off"
              value={prix}
              aria-invalid={!prixOk ? 'true' : undefined}
              aria-describedby={!prixOk ? 'prix-habituel-err' : 'prix-habituel-aide'}
              onInput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                setPrix(v);
                const c = lirePrix(v);
                if (c === null || (c !== undefined && c > 100_000)) return;
                props.onPrixHabituel(c || undefined);
              }}
            />
            {!prixOk ? (
              <span class="erreur" id="prix-habituel-err">
                Prix invalide : en euros, de 0 à 1 000, par exemple 95.
              </span>
            ) : (
              <span class="aide" id="prix-habituel-aide">
                Le prix que vous payez d’ordinaire, pour estimer l’économie.
              </span>
            )}
          </div>
          <div class="champ champ-court">
            <label for="ar-par-an">Allers-retours par an (estimation)</label>
            <input
              id="ar-par-an"
              type="text"
              inputMode="numeric"
              maxLength={3}
              autoComplete="off"
              value={ar}
              aria-invalid={arParAn === null || arParAn > 60 ? 'true' : undefined}
              aria-describedby={arParAn === null || arParAn > 60 ? 'ar-par-an-err' : undefined}
              onInput={(e) => setAr((e.currentTarget as HTMLInputElement).value)}
            />
            {(arParAn === null || arParAn > 60) && (
              <span class="erreur" id="ar-par-an-err">
                Un nombre de 0 à 60.
              </span>
            )}
          </div>
          <div class="estimation" aria-live="polite">
            {estimation && estimation.estimes > 0 && (
              <p>
                Sur vos trajets planifiés : jusqu’à <strong>{formaterMontant(estimation.economieCentimes)}</strong> d’économie ({estimation.estimes} trajet
                {estimation.estimes > 1 ? 's' : ''}, jusqu’à {formaterMontant(estimation.parTrajetCentimes)} par trajet
                {estimation.aPrixVu > 0 && `, dont ${estimation.aPrixVu} estimé${estimation.aPrixVu > 1 ? 's' : ''} sur le prix vu sur le site`}).
              </p>
            )}
            {projection && !lu && <p class="aide">Projection sur un an faite avec la moyenne de vos prix vus ({formaterMontant(reference!)}).</p>}
            {projection &&
              (projection.netCentimes > 0 ? (
                <p>
                  <strong>La carte vaut le coup</strong> : sur un an, à {arParAn} allers-retours croisés d’une semaine à l’autre, jusqu’à{' '}
                  {formaterMontant(projection.economieCentimes)} d’économie, soit jusqu’à <strong>{formaterMontant(projection.netCentimes)} nets</strong>{' '}
                  après les {formaterMontant(R.prixCarteCentimes)} de la carte.
                </p>
              ) : (
                <p>
                  <strong>La carte ne vaut pas le coup</strong> à ce prix et à ce rythme : l’économie (au plus {formaterMontant(projection.economieCentimes)} par
                  an) ne couvre pas les {formaterMontant(R.prixCarteCentimes)} de la carte.
                </p>
              ))}
          </div>
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
