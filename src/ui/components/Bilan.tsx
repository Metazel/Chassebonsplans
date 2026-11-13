/** Bilan des billets payés à venir : coût par trajet, dîners à bord, économie de la carte Avantage. */
import { formaterMontant } from '../../domain/argent';
import { formaterHeure } from '../../domain/heure';
import type { Bilan as DonneesBilan } from '../../domain/bilan';

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

export function Bilan(props: { bilan: DonneesBilan | null; limiteGareMin: number }) {
  const b = props.bilan;
  if (!b) return null;
  return (
    <section aria-labelledby="titre-bilan">
      <h2 id="titre-bilan">Bilan de vos billets payés</h2>
      <ul class="bilan">
        <li>
          <strong>{pluriel(b.trajets, 'trajet')}</strong> payés à venir
          {b.avecPrix > 0 && (
            <>
              {' '}
              : {formaterMontant(b.totalCentimes)}, soit <strong>{formaterMontant(b.moyenneCentimes)} par trajet</strong>
            </>
          )}
          {b.avecPrix < b.trajets && ` (${pluriel(b.trajets - b.avecPrix, 'trajet')} sans prix indiqué)`}.
        </li>
        {b.auTarifAvantage > 0 && (
          <li>
            Carte Avantage : au moins <strong>{formaterMontant(b.economieAvantageCentimes)}</strong> d’économie sur {pluriel(b.auTarifAvantage, 'trajet')} payés à
            ce tarif (−30 % ; davantage si le prix a été plafonné).
          </li>
        )}
        <li>
          {b.dinersABord > 0
            ? `${pluriel(b.dinersABord, 'retour')} arrive${b.dinersABord > 1 ? 'nt' : ''} après ${formaterHeure(props.limiteGareMin)} : dîner à bord, soit ${formaterMontant(b.coutDinersCentimes)} en coût complet.`
            : 'Tous vos retours payés arrivent à temps pour dîner à la maison.'}
        </li>
      </ul>
    </section>
  );
}
