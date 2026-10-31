/**
 * Règle de choix au coût complet (cadrage, étape 2).
 *
 * Coût complet = prix du billet + coûts induits par les horaires.
 * Coût induit du lot 1 : un repas à bord si l'arrivée au domicile dépasse l'heure limite du dîner.
 * Choix : le coût complet le plus bas ; à coût égal (à la tolérance près), le train qui ramène
 * le plus tôt à la maison.
 */
import { arriveeApresDepart } from './heure';

export interface ParametresCout {
  /** Durée gare → domicile, en minutes. */
  trajetGareDomicileMin: number;
  /** Heure d'arrivée au domicile au-delà de laquelle on dîne à bord (minutes depuis minuit). */
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

export type Motif = 'seul' | 'moins-cher' | 'egalite-plus-tot';

export interface Recommandation {
  retenu: Evaluation;
  /** Toutes les évaluations, du coût complet le plus bas au plus haut. */
  classement: Evaluation[];
  motif: Motif;
  /** En cas d'égalité : le train au coût complet inférieur ou égal, écarté car il arrive plus tard. */
  concurrent?: Evaluation;
}

export function evaluer(train: TrainValide, p: ParametresCout): Evaluation {
  const arriveeGare = arriveeApresDepart(train.depart, train.arrivee);
  const arriveeDomicile = arriveeGare + p.trajetGareDomicileMin;
  // Échelle continue : une arrivée après minuit dépasse forcément la limite du dîner.
  const repasCentimes = arriveeDomicile > p.limiteDinerDomicileMin ? p.coutRepasCentimes : 0;
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

export function recommander(trains: readonly TrainValide[], p: ParametresCout): Recommandation | null {
  if (trains.length === 0) return null;
  const classement = trains
    .map((t) => evaluer(t, p))
    .sort((a, b) => a.coutCompletCentimes - b.coutCompletCentimes || a.arriveeDomicile - b.arriveeDomicile);
  const moinsCher = classement[0]!;
  const proches = classement.filter((e) => e.coutCompletCentimes - moinsCher.coutCompletCentimes <= p.toleranceCentimes);
  const retenu = proches.reduce((meilleur, e) => (e.arriveeDomicile < meilleur.arriveeDomicile ? e : meilleur));
  if (classement.length === 1) return { retenu, classement, motif: 'seul' };
  // Égalité : un autre train coûte autant ou moins, mais ramène plus tard à la maison.
  const concurrent = classement.find((e) => e !== retenu && e.coutCompletCentimes <= retenu.coutCompletCentimes);
  return concurrent ? { retenu, classement, motif: 'egalite-plus-tot', concurrent } : { retenu, classement, motif: 'moins-cher' };
}
