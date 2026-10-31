/**
 * Référentiels versionnés (EXG-10) : chaque règle porte sa source et sa date de vérification.
 * Une règle non revérifiée depuis plus de 6 mois est signalée à l'écran.
 */

export interface MetaReferentiel {
  source: string;
  /** Date ISO AAAA-MM-JJ. */
  verifieLe: string;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Vrai si la date de vérification a plus de `mois` mois à la date `aujourdhui`. */
export function estAReverifier(verifieLe: string, aujourdhui: Date, mois = 6): boolean {
  const m = ISO.exec(verifieLe);
  if (!m) return true;
  const annee = Number(m[1]);
  const moisCible = Number(m[2]) - 1 + mois;
  // Jour ramené au dernier jour du mois cible (31/08 + 6 mois = 28/02 ou 29/02, pas 03/03).
  const dernierJour = new Date(annee, moisCible + 1, 0).getDate();
  const limite = new Date(annee, moisCible, Math.min(Number(m[3]), dernierJour), 23, 59, 59);
  return aujourdhui.getTime() > limite.getTime();
}
