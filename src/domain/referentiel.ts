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
  const limite = new Date(Number(m[1]), Number(m[2]) - 1 + mois, Number(m[3]));
  return aujourdhui.getTime() > limite.getTime();
}
