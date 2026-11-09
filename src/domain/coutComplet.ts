/**
 * Règle de choix au coût complet (cadrage, étape 2).
 *
 * Coût complet = prix du billet + coûts induits par les horaires.
 * Coût induit du lot 1 : un repas à bord si l'arrivée au domicile dépasse l'heure limite du dîner.
 * Choix : le coût complet le plus bas ; si d'autres trains sont à la tolérance près (écart
 * inférieur ou égal, bornes comprises), celui qui ramène le plus tôt à la maison.
 * Préférence facultative (retour à l'heure du dîner, décisions des 08 et 09/11/2026) : le train préféré
 * l'emporte s'il ne coûte pas plus que le supplément accepté de plus que le moins cher.
 */
import { MINUTES_PAR_JOUR, arriveeApresDepart } from './heure';

const MIDI = 12 * 60;

export interface ParametresCout {
  /** Durée gare → domicile, en minutes. */
  trajetGareDomicileMin: number;
  /**
   * Heure d'arrivée au domicile au-delà de laquelle on dîne à bord (minutes depuis minuit).
   * Une limite avant midi (ex. 00:30) s'entend la nuit suivante.
   */
  limiteDinerDomicileMin: number;
  /** Prix d'un repas à bord, en centimes. */
  coutRepasCentimes: number;
  /** Écart de coût complet considéré comme une égalité, en centimes. */
  toleranceCentimes: number;
}

export interface TrainValide {
  id: string;
  /** Minutes depuis minuit. */
  depart: number;
  /** Minutes depuis minuit (une valeur inférieure au départ signifie le lendemain). */
  arrivee: number;
  prixCentimes: number;
}

export interface Evaluation {
  id: string;
  depart: number;
  arriveeGare: number;
  arriveeDomicile: number;
  prixCentimes: number;
  repasCentimes: number;
  coutCompletCentimes: number;
}

export type Motif = 'seul' | 'moins-cher' | 'egalite-plus-tot' | 'egalite-prefere' | 'prefere';

export interface Recommandation {
  retenu: Evaluation;
  /** Toutes les évaluations, du coût complet le plus bas au plus haut. */
  classement: Evaluation[];
  motif: Motif;
  /**
   * Égalité : le train au coût complet inférieur ou égal, écarté car il arrive plus tard (ou plus tôt mais hors de la préférence) ;
   * motif « prefere » : le moins cher, écarté au profit du train préféré.
   */
  concurrent?: Evaluation;
  /** Motif « prefere » : supplément maximal réellement appliqué, en centimes. */
  supplementMaxCentimes?: number;
}

export function evaluer(train: TrainValide, p: ParametresCout): Evaluation {
  const arriveeGare = arriveeApresDepart(train.depart, train.arrivee);
  const arriveeDomicile = arriveeGare + p.trajetGareDomicileMin;
  // Échelle continue depuis le minuit du départ : une limite avant midi tombe la nuit suivante.
  const limite = p.limiteDinerDomicileMin < MIDI ? p.limiteDinerDomicileMin + MINUTES_PAR_JOUR : p.limiteDinerDomicileMin;
  const repasCentimes = arriveeDomicile > limite ? p.coutRepasCentimes : 0;
  return {
    id: train.id,
    depart: train.depart,
    arriveeGare,
    arriveeDomicile,
    prixCentimes: train.prixCentimes,
    repasCentimes,
    coutCompletCentimes: train.prixCentimes + repasCentimes,
  };
}

/** Préférence (retour à l'heure du dîner) et supplément de coût complet accepté pour l'obtenir. */
export interface Preference {
  estPrefere: (e: Evaluation) => boolean;
  /** Supplément accepté, en centimes ; au moins la tolérance (à égalité, le préféré l'emporte toujours). */
  supplementMaxCentimes: number;
}

/**
 * Le moins cher au coût complet ; à égalité (tolérance), celui qui ramène le plus tôt.
 * Avec une préférence : le préféré le moins cher l'emporte s'il ne coûte pas plus que le supplément accepté
 * de plus que le moins cher (bornes comprises) ; entre préférés à égalité, le plus tôt.
 */
export function recommander(trains: readonly TrainValide[], p: ParametresCout, preference?: Preference): Recommandation | null {
  if (trains.length === 0) return null;
  const classement = trains
    .map((t) => evaluer(t, p))
    .sort((a, b) => a.coutCompletCentimes - b.coutCompletCentimes || a.arriveeDomicile - b.arriveeDomicile);
  const moinsCher = classement[0]!;
  const plusTot = (liste: Evaluation[]) => liste.reduce((meilleur, e) => (e.arriveeDomicile < meilleur.arriveeDomicile ? e : meilleur));
  const proches = classement.filter((e) => e.coutCompletCentimes - moinsCher.coutCompletCentimes <= p.toleranceCentimes);
  const preferes = preference ? classement.filter(preference.estPrefere) : [];
  const meilleurPrefere = preferes[0];
  const marge = Math.max(preference?.supplementMaxCentimes ?? 0, p.toleranceCentimes);
  if (meilleurPrefere && meilleurPrefere.coutCompletCentimes - moinsCher.coutCompletCentimes <= marge) {
    // Entre préférés à égalité, le plus tôt, sans jamais dépasser le supplément accepté par rapport au moins cher.
    const retenu = plusTot(
      preferes.filter(
        (e) => e.coutCompletCentimes - meilleurPrefere.coutCompletCentimes <= p.toleranceCentimes && e.coutCompletCentimes - moinsCher.coutCompletCentimes <= marge,
      ),
    );
    if (classement.length === 1) return { retenu, classement, motif: 'seul' };
    if (retenu.coutCompletCentimes - moinsCher.coutCompletCentimes > p.toleranceCentimes) {
      // Plus cher que le moins cher au-delà de la tolérance, mais dans le supplément accepté.
      return { retenu, classement, motif: 'prefere', concurrent: moinsCher, supplementMaxCentimes: marge };
    }
    const precoce = proches.find((e) => e !== retenu && e.arriveeDomicile < retenu.arriveeDomicile);
    if (precoce) return { retenu, classement, motif: 'egalite-prefere', concurrent: precoce };
    const concurrentEgal = classement.find((e) => e !== retenu && e.coutCompletCentimes <= retenu.coutCompletCentimes);
    return concurrentEgal ? { retenu, classement, motif: 'egalite-plus-tot', concurrent: concurrentEgal } : { retenu, classement, motif: 'moins-cher' };
  }
  const retenu = plusTot(proches);
  if (classement.length === 1) return { retenu, classement, motif: 'seul' };
  // Égalité : un autre train coûte autant ou moins, mais ramène plus tard à la maison.
  const concurrent = classement.find((e) => e !== retenu && e.coutCompletCentimes <= retenu.coutCompletCentimes);
  return concurrent ? { retenu, classement, motif: 'egalite-plus-tot', concurrent } : { retenu, classement, motif: 'moins-cher' };
}
