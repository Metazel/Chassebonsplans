/**
 * Carte Avantage et billets croisés (CU-C) : intérêt de la carte pour les trajets planifiés,
 * et plan de réservation qui croise les allers-retours d'une semaine à l'autre. Indicatif.
 */
import { useEffect, useState } from 'preact/hooks';
import { dateCourte, dateLongue } from '../../domain/dates';
import { formaterHeure } from '../../domain/heure';
import { formaterMontant } from '../../domain/argent';
import { lirePrix } from '../../domain/deplacements';
import { dureeType, estimer, plafond, type Billet, type Jambe, type PlanAvantage } from '../../domain/croises';
import { REGLES_AVANTAGE as R } from '../../data/avantage';
import { ExternalLink } from './ExternalLink';

const SENS = { MP: 'Marseille → Paris', PM: 'Paris → Marseille' } as const;
const jambe = (j: Jambe) => `${SENS[j.sens]} ${dateCourte(j.date)} à ${formaterHeure(j.depart)} (${j.operateur} ${j.numero})`;

function LigneBillet({ b }: { b: Billet }) {
  if (b.type === 'ar')
    return (
      <li>
        <strong>{b.croise ? `Aller-retour croisé depuis ${b.origine}` : 'Aller-retour'}</strong> : aller {jambe(b.aller)} ; retour {jambe(b.retour)}.
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
      {b.raison === 'operateur' ? 'la carte ne s’applique pas à cet opérateur' : 'aucun autre trajet pour former un aller-retour avec une nuit de week-end'}.
    </li>
  );
}

export function Avantage(props: {
  plan: PlanAvantage;
  detenue: boolean;
  finValidite?: string;
  prixHabituelCentimes?: number;
  onPrixHabituel: (centimes: number | undefined) => void;
}) {
  const { plan } = props;
  const texte = (c: number | undefined) => (c !== undefined ? String(c / 100).replace('.', ',') : '');
  const [prix, setPrix] = useState(texte(props.prixHabituelCentimes));
  useEffect(() => {
    const v = lirePrix(prix);
    if (v !== null && v !== props.prixHabituelCentimes) setPrix(texte(props.prixHabituelCentimes));
  }, [props.prixHabituelCentimes]);
  if (!plan.total) return null;
  const lu = lirePrix(prix);
  const duree = dureeType(plan);
  const estimation = lu ? estimer(R, plan, lu, duree) : null;
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
      <p>
        {plan.eligibles === 0
          ? `Aucun de vos ${plan.total} trajets à réserver ne profite de la carte pour l’instant : il faut une nuit de vendredi, samedi ou dimanche dans chaque aller-retour.`
          : `${plan.eligibles} de vos ${plan.total} trajets à réserver ${props.detenue ? 'profitent' : 'profiteraient'} de la carte (−${R.reductionPourcent} %, prix plafonné à ${plafondTexte} par trajet)${plan.grace ? `, dont ${plan.grace} grâce aux billets croisés` : ''}.`}
      </p>
      {plan.grace > 0 && (
        <p class="aide">
          Billets croisés : un aller-retour qui enjambe le week-end est éligible, même si vous rentrez entre-temps avec un autre billet. Il suffit de réserver
          chaque aller-retour comme indiqué.
        </p>
      )}
      {expireAvant && <p class="alerte">Votre carte expire le {dateLongue(props.finValidite!)} : renouvelez-la avant les trajets suivants.</p>}
      {!props.detenue && plan.eligibles > 0 && (
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
              aria-invalid={lu === null ? 'true' : undefined}
              aria-describedby={lu === null ? 'prix-habituel-err' : 'prix-habituel-aide'}
              onInput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                setPrix(v);
                const c = lirePrix(v);
                if (c === null) return;
                props.onPrixHabituel(c || undefined);
              }}
            />
            {lu === null ? (
              <span class="erreur" id="prix-habituel-err">
                Prix invalide : en euros, par exemple 95.
              </span>
            ) : (
              <span class="aide" id="prix-habituel-aide">
                Le prix que vous payez d’ordinaire, pour estimer l’économie.
              </span>
            )}
          </div>
          {estimation && (
            <p class="estimation" aria-live="polite">
              {estimation.parTrajetCentimes > 0 ? (
                <>
                  Économie estimée : <strong>{formaterMontant(estimation.economieCentimes)}</strong> sur ces {plan.eligibles} trajets (
                  {formaterMontant(estimation.parTrajetCentimes)} par trajet), pour une carte à {formaterMontant(R.prixCarteCentimes)} par an : remboursée dès{' '}
                  {estimation.seuilTrajets} trajet{(estimation.seuilTrajets ?? 0) > 1 ? 's' : ''} éligible{(estimation.seuilTrajets ?? 0) > 1 ? 's' : ''}.
                </>
              ) : (
                'À ce prix, la carte n’apporte pas d’économie.'
              )}
            </p>
          )}
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
        Estimation indicative : les prix réels sont ceux du site de vente, et un tarif Prems peut être moins cher. Règles :{' '}
        <ExternalLink href={R.meta.source}>carte Avantage Adulte</ExternalLink>, vérifiées le {dateLongue(R.meta.verifieLe)}.
      </p>
    </section>
  );
}
