/**
 * Cartes et abonnements (CU4) : pour un rythme de déplacements, coût sur un an sans carte, avec la carte Avantage,
 * la carte Liberté, MAX ACTIF et MAX ACTIF+. Indicatif, 2de classe : les prix réels sont ceux du site de vente.
 */
import { useState } from 'preact/hooks';
import { dateLongue } from '../../domain/dates';
import { formaterMontant } from '../../domain/argent';
import { lirePrix } from '../../domain/deplacements';
import { comparerFormules, type CoutFormule, type Echantillon, type IdFormule, type Mensualites } from '../../domain/abonnements';
import { estAReverifier } from '../../domain/referentiel';
import { REGLES_ABONNEMENTS as R } from '../../data/abonnements';
import { REGLES_AVANTAGE as RA } from '../../data/avantage';
import { ExternalLink } from './ExternalLink';

/** Part du lundi au jeudi supposée sans déplacement daté : aller en début de semaine, retour le vendredi. */
export const PART_DEFAUT = 50;
export const AR_MAX = 150;

const NOMS: Record<IdFormule, string> = {
  'sans-carte': 'Sans carte',
  avantage: 'Carte Avantage',
  liberte: R.liberte.nom,
  'max-actif': R.maxActif.nom,
  'max-actif-plus': R.maxActifPlus.nom,
};
const LEVIER: Partial<Record<IdFormule, string>> = {
  avantage: RA.levier,
  liberte: R.liberte.levier,
  'max-actif': R.maxActif.levier,
  'max-actif-plus': R.maxActifPlus.levier,
};

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
export const texteMontant = (c: number | undefined) => (c !== undefined ? String(c / 100).replace('.', ',') : '');

/** Prix habituel saisi : undefined si vide, null si invalide (0 compris), sinon en centimes. */
export function prixHabituelLu(texte: string): number | undefined | null {
  const c = lirePrix(texte);
  return c === 0 ? null : c;
}

function detail(f: CoutFormule, prixMoyen: number, mensualite: number, devis: boolean): string {
  const payants = f.horsFormule ? `${pluriel(f.horsFormule, 'trajet')} au prix habituel` : '';
  switch (f.id) {
    case 'sans-carte':
      return `${pluriel(f.horsFormule, 'trajet')} à ${formaterMontant(Math.round(prixMoyen))} en moyenne.`;
    case 'avantage':
      return `Carte ${formaterMontant(f.abonnementCentimes)} ; ${f.couverts ? `${pluriel(f.couverts, 'trajet')} à −30 % ou au plafond (billets croisés)` : 'aucun trajet réduit'}${payants ? `, ${payants}` : ''}.`;
    case 'liberte':
      return `Carte ${formaterMontant(f.abonnementCentimes)} ; ${f.couverts ? `${pluriel(f.couverts, 'trajet')} ramené${f.couverts > 1 ? 's' : ''} au prix fixe de ${formaterMontant(R.liberte.prixFixeCentimes)}` : `aucun billet au-dessus du prix fixe de ${formaterMontant(R.liberte.prixFixeCentimes)}`}${payants ? `, ${payants}` : ''}.`;
    default:
      return `12 mensualités de ${formaterMontant(mensualite)}${devis ? ' (votre devis)' : ' (à confirmer par devis)'} ; ${f.couverts ? `${pluriel(f.couverts, 'trajet')} à 0 €` : 'aucun trajet à 0 €'}${payants ? `, ${payants}` : ''} ; engagement ${f.engagementMois} mois.`;
  }
}

export function Abonnements(props: {
  /** Dates des trajets déclarés (passés et à venir), pour la part du lundi au jeudi. */
  datesTrajets: string[];
  /** Part du lundi au jeudi calculée sur ces dates (null si aucune). */
  partCalculee: number | null;
  /** Prix payés ou vus récemment pour les trains choisis (TGV INOUI, Intercités). */
  echantillon: Echantillon;
  /** Le voyageur détient une carte ou un abonnement train : ses prix payés et vus sont déjà réduits. */
  cartesDetenues: boolean;
  dureeMin: number;
  /** Leviers détenus et valides (identifiants du catalogue). */
  detenus: ReadonlySet<string>;
  /** Saisie du prix habituel, partagée avec la carte Avantage (état tenu par l'écran). */
  prixTexte: string;
  onPrixTexte: (texte: string) => void;
}) {
  const prix = props.prixTexte;
  const [ar, setAr] = useState('40');
  const [part, setPart] = useState<string | null>(null);
  const [devis, setDevis] = useState({ maxActif: '', maxActifPlus: '' });
  const [devisOuvert, setDevisOuvert] = useState(false);

  const lu = lirePrix(prix);
  const prixOk = prixHabituelLu(prix) !== null;
  const arParAn = /^\d{1,3}$/.test(ar.trim()) && Number(ar) <= AR_MAX ? Number(ar) : null;
  const partTexte = part ?? String(props.partCalculee ?? PART_DEFAUT);
  const partLue = /^\d{1,3}$/.test(partTexte.trim()) && Number(partTexte) <= 100 ? Number(partTexte) : null;
  const lireDevis = (v: string) => (v.trim() ? lirePrix(v) : undefined);
  const devisLus = { maxActif: lireDevis(devis.maxActif), maxActifPlus: lireDevis(devis.maxActifPlus) };
  const devisOk = (v: number | null | undefined) => v !== null && v !== 0;
  const devisErreur = !devisOk(devisLus.maxActif) || !devisOk(devisLus.maxActifPlus);
  const mensualites: Mensualites = {
    ...(devisLus.maxActif ? { maxActif: devisLus.maxActif } : {}),
    ...(devisLus.maxActifPlus ? { maxActifPlus: devisLus.maxActifPlus } : {}),
  };

  // Base de prix : le prix habituel saisi, sinon les prix payés ou vus pour vos trains, si aucune carte ne les a déjà réduits.
  const observes = props.cartesDetenues ? [] : props.echantillon.prix;
  const echantillon = lu ? [lu] : observes;
  const saisiesOk = prixOk && arParAn !== null && partLue !== null && devisOk(devisLus.maxActif) && devisOk(devisLus.maxActifPlus);
  const formules =
    saisiesOk && echantillon.length
      ? comparerFormules(R, RA, { allersRetoursParAn: arParAn, prixCentimes: echantillon, partLundiJeudi: partLue, dureeMin: props.dureeMin }, mensualites)
      : null;
  const prixMoyen = echantillon.length ? echantillon.reduce((a, b) => a + b, 0) / echantillon.length : 0;
  const premier = formules?.[0];
  const sans = formules?.find((f) => f.id === 'sans-carte');
  const second = formules?.[1];
  const maintenant = new Date();
  const anciennes =
    [R.liberte.meta.verifieLe, R.maxActif.meta.verifieLe, R.maxActif.meta.prixReleveLe, R.maxActifPlus.meta.verifieLe, R.maxActifPlus.meta.prixReleveLe, RA.meta.verifieLe].some((d) =>
      estAReverifier(d, maintenant),
    );
  const ecartes = [
    props.echantillon.horsFormules ? `${pluriel(props.echantillon.horsFormules, 'prix')} OUIGO ou Trenitalia` : '',
    props.echantillon.anciens ? `${pluriel(props.echantillon.anciens, 'prix')} vu${props.echantillon.anciens > 1 ? 's' : ''} il y a plus de 2 jours` : '',
  ].filter(Boolean);
  const maxSansDevis = premier && ((premier.id === 'max-actif' && !mensualites.maxActif) || (premier.id === 'max-actif-plus' && !mensualites.maxActifPlus));

  return (
    <section class="abonnements" aria-labelledby="titre-abonnements">
      <h2 id="titre-abonnements">Cartes et abonnements : lequel pour votre rythme ?</h2>
      {anciennes && (
        <p class="alerte" role="status">
          Prix et conditions vérifiés il y a plus de 6 mois : vérifiez-les sur les sites de la SNCF avant de vous y fier.
        </p>
      )}
      <p class="aide">Coût estimé sur un an, en 2de classe, de chaque formule pour vos trajets Marseille ↔ Paris.</p>
      <div class="champs-ligne">
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
            onInput={(e) => props.onPrixTexte((e.currentTarget as HTMLInputElement).value)}
          />
          {!prixOk ? (
            <span class="erreur" id="prix-habituel-err">
              Prix invalide : en euros, de 0,01 à 1 000, par exemple 95.
            </span>
          ) : (
            <span class="aide" id="prix-habituel-aide">
              {props.cartesDetenues
                ? 'Le prix sans carte : vos prix payés et vus sur SNCF Connect tiennent déjà compte de vos cartes.'
                : observes.length === 1
                  ? 'Laissé vide : le prix payé ou vu sur le site pour votre train (TGV INOUI ou Intercités).'
                  : observes.length > 1
                    ? `Laissé vide : la moyenne des ${observes.length} prix payés ou vus sur le site pour vos trains (TGV INOUI ou Intercités).`
                    : 'Le prix que vous payez d’ordinaire, sans carte.'}
              {!lu && !props.cartesDetenues && ecartes.length > 0 && ` Écartés : ${ecartes.join(', ')}.`}
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
            aria-invalid={arParAn === null ? 'true' : undefined}
            aria-describedby={arParAn === null ? 'ar-par-an-err' : undefined}
            onInput={(e) => setAr((e.currentTarget as HTMLInputElement).value)}
          />
          {arParAn === null && (
            <span class="erreur" id="ar-par-an-err">
              Un nombre de 0 à {AR_MAX}.
            </span>
          )}
        </div>
        <div class="champ champ-court">
          <label for="part-lundi-jeudi">Trajets du lundi au jeudi (%)</label>
          <input
            id="part-lundi-jeudi"
            type="text"
            inputMode="numeric"
            maxLength={3}
            autoComplete="off"
            value={partTexte}
            aria-invalid={partLue === null ? 'true' : undefined}
            aria-describedby={partLue === null ? 'part-lundi-jeudi-err' : 'part-lundi-jeudi-aide'}
            onInput={(e) => setPart((e.currentTarget as HTMLInputElement).value)}
          />
          {partLue === null ? (
            <span class="erreur" id="part-lundi-jeudi-err">
              Un pourcentage de 0 à 100.
            </span>
          ) : (
            <span class="aide" id="part-lundi-jeudi-aide">
              {part !== null
                ? 'Votre estimation. MAX ACTIF ne couvre que ces jours-là.'
                : props.partCalculee !== null
                  ? `D’après vos ${pluriel(props.datesTrajets.length, 'trajet')} déclarés. MAX ACTIF ne couvre que ces jours-là.`
                  : 'Par défaut : aller en début de semaine, retour le vendredi. MAX ACTIF ne couvre que du lundi au jeudi.'}
            </span>
          )}
        </div>
      </div>
      <details open={devisOuvert || devisErreur} onToggle={(e) => setDevisOuvert((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Mensualités de votre devis MAX ACTIF (facultatif)</summary>
        <p class="aide">
          La SNCF ne publie pas les mensualités : sans devis, l’estimation prend {formaterMontant(R.maxActif.mensualiteCentimes)} (MAX ACTIF) et{' '}
          {formaterMontant(R.maxActifPlus.mensualiteCentimes)} (MAX ACTIF+) par mois en 2de, relevés par <ExternalLink href={R.maxActif.meta.sourcePrix}>Milesopedia</ExternalLink> le{' '}
          {dateLongue(R.maxActif.meta.prixReleveLe)}.
        </p>
        {(
          [
            ['maxActif', 'devis-max-actif', 'Mensualité MAX ACTIF (€)', '441'],
            ['maxActifPlus', 'devis-max-actif-plus', 'Mensualité MAX ACTIF+ (€)', '702'],
          ] as const
        ).map(([cle, id, libelle, exemple]) => {
          const ok = devisOk(devisLus[cle]);
          return (
            <div class="champ champ-court" key={id}>
              <label for={id}>{libelle}</label>
              <input
                id={id}
                type="text"
                inputMode="decimal"
                maxLength={10}
                autoComplete="off"
                value={devis[cle]}
                aria-invalid={ok ? undefined : 'true'}
                aria-describedby={ok ? undefined : `${id}-err`}
                onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setDevis((d) => ({ ...d, [cle]: v }));
                }}
              />
              {!ok && (
                <span class="erreur" id={`${id}-err`}>
                  Montant invalide : en euros, de 0,01 à 1 000, par exemple {exemple}.
                </span>
              )}
            </div>
          );
        })}
      </details>
      <div class="verdict" aria-live="polite">
        {!echantillon.length && prixOk && (
          <p>
            {props.cartesDetenues
              ? 'Indiquez votre prix habituel sans carte pour comparer.'
              : 'Indiquez votre prix habituel, ou saisissez les prix vus sur le site pour vos trains, pour comparer.'}
          </p>
        )}
        {echantillon.length > 0 && !saisiesOk && <p>Corrigez les champs signalés pour comparer.</p>}
        {premier && sans && (
          <p>
            {premier.id === 'sans-carte' ? (
              <>
                <strong>Aucune carte ni abonnement ne vaut le coup</strong> à ce rythme : {formaterMontant(sans.coutCentimes)} de billets sur un an.
              </>
            ) : (
              <>
                <strong>
                  {NOMS[premier.id]} : {formaterMontant(premier.coutCentimes)} sur un an
                </strong>
                , soit {formaterMontant(sans.coutCentimes - premier.coutCentimes)} de moins que sans carte
                {second && second.id !== 'sans-carte'
                  ? second.coutCentimes === premier.coutCentimes
                    ? `, à égalité avec ${NOMS[second.id]}`
                    : ` et ${formaterMontant(second.coutCentimes - premier.coutCentimes)} de moins que ${NOMS[second.id]}`
                  : ''}
                .
                {maxSansDevis && ' Mensualité estimée : demandez un devis avant de vous engager pour 12 mois.'}
              </>
            )}
          </p>
        )}
      </div>
      {formules && (
        <div class="tableau">
          <table>
            <caption>Coût estimé sur un an, de la formule la moins chère à la plus chère</caption>
            <thead>
              <tr>
                <th scope="col">Formule</th>
                <th scope="col">Sur un an</th>
                <th scope="col">Détail</th>
              </tr>
            </thead>
            <tbody>
              {formules.map((f) => {
                const mensualite = f.id === 'max-actif' ? (mensualites.maxActif ?? R.maxActif.mensualiteCentimes) : (mensualites.maxActifPlus ?? R.maxActifPlus.mensualiteCentimes);
                const aDevis = f.id === 'max-actif' ? !!mensualites.maxActif : !!mensualites.maxActifPlus;
                const levier = LEVIER[f.id];
                return (
                  <tr key={f.id} class={f === premier ? 'retenu' : undefined}>
                    <th scope="row">
                      {NOMS[f.id]}
                      {f === premier && <span class="badge"> le moins cher</span>}
                      {levier && props.detenus.has(levier) && <span> (vous l’avez)</span>}
                    </th>
                    <td data-label="Sur un an : ">{formaterMontant(f.coutCentimes)}</td>
                    <td data-label="Détail : ">{detail(f, prixMoyen, mensualite, aDevis)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ul class="aide hypotheses">
        <li>Carte Avantage : estimation maximale, billets croisés d’une semaine à l’autre (une nuit de week-end dans chaque aller-retour) ; un prix déjà réduit baisse moins.</li>
        <li>
          Carte Liberté : prix fixe de {formaterMontant(R.liberte.prixFixeCentimes)} sur TGV INOUI, même en dernière minute, billet échangeable et remboursable ; plus le prix
          habituel varie, plus elle rapporte : laissez le prix habituel vide pour calculer sur vos prix réels.
        </li>
        <li>MAX ACTIF et MAX ACTIF+ : TGV INOUI seulement, places à 0 € dans la limite de celles attribuées, engagement de 12 mois.</li>
        <li>Non comptés : les combinaisons (MAX ACTIF et carte Avantage pour les trajets du vendredi, tarif Avantage de la carte Liberté pour les voyages personnels), la 1re classe, les repas à bord.</li>
        <li>Les prix affichés par SNCF Connect tiennent déjà compte des cartes enregistrées dans votre compte SNCF Connect.</li>
      </ul>
      <p class="aide">
        Sources : <ExternalLink href={R.liberte.meta.source}>carte Liberté</ExternalLink>, <ExternalLink href={R.maxActif.meta.source}>MAX ACTIF et MAX ACTIF+</ExternalLink>,{' '}
        <ExternalLink href={RA.meta.source}>carte Avantage</ExternalLink>. Liberté et MAX vérifiées le {dateLongue(R.maxActif.meta.verifieLe)}, carte Avantage le{' '}
        {dateLongue(RA.meta.verifieLe)}. Outil indicatif, non affilié.
      </p>
    </section>
  );
}
