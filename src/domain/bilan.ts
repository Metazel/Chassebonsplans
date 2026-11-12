/**
 * Bilan des billets payés à venir : coût par trajet, dîners à bord imposés par les horaires de retour (coût complet)
 * et économie de la carte Avantage sur les billets payés à ce tarif (lu sur la confirmation de commande).
 */
import type { Deplacement } from './deplacements';
import { repasABord } from './horaires';
import type { ParametresCout } from './coutComplet';

export interface Bilan {
  /** Trajets payés à venir. */
  trajets: number;
  /** Dont avec un prix connu. */
  avecPrix: number;
  totalCentimes: number;
  /** Prix moyen d'un trajet (sur ceux dont le prix est connu). */
  moyenneCentimes: number;
  /** Retours payés qui arrivent trop tard pour dîner à la maison. */
  dinersABord: number;
  coutDinersCentimes: number;
  /** Trajets payés au tarif Avantage, et économie minimale estimée (−30 % ; davantage si le plafond s'est appliqué). */
  auTarifAvantage: number;
  economieAvantageCentimes: number;
}

/** `maintenant` (minutes, heure de Paris) : un train du jour déjà parti n'est plus « à venir ». */
export function bilanPayes(liste: Deplacement[], aujourdhui: string, p: ParametresCout, reductionPourcent: number, maintenant?: number): Bilan | null {
  const aVenir = (t: Deplacement['aller']) =>
    t.date > aujourdhui || (t.date === aujourdhui && (maintenant === undefined || !t.train || t.train.depart > maintenant));
  const payes = liste.flatMap((d) => (['aller', 'retour'] as const).map((cote) => ({ cote, t: d[cote] }))).filter(({ t }) => t.statut === 'paye' && aVenir(t));
  if (!payes.length) return null;
  const avecPrix = payes.filter(({ t }) => t.prixCentimes !== undefined);
  const total = avecPrix.reduce((s, { t }) => s + t.prixCentimes!, 0);
  const diners = payes.filter(({ cote, t }) => cote === 'retour' && t.train && repasABord(t.train, p)).length;
  const avantage = avecPrix.filter(({ t }) => t.tarif === 'avantage');
  const economie =
    reductionPourcent > 0 && reductionPourcent < 100
      ? avantage.reduce((s, { t }) => s + Math.round((t.prixCentimes! * 100) / (100 - reductionPourcent)) - t.prixCentimes!, 0)
      : 0;
  return {
    trajets: payes.length,
    avecPrix: avecPrix.length,
    totalCentimes: total,
    moyenneCentimes: avecPrix.length ? Math.round(total / avecPrix.length) : 0,
    dinersABord: diners,
    coutDinersCentimes: diners * p.coutRepasCentimes,
    auTarifAvantage: avantage.length,
    economieAvantageCentimes: economie,
  };
}
