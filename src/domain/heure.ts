/** Heures locales (Europe/Paris) manipulées en minutes depuis minuit. Aucune dépendance. */

const HHMM = /^([01]?\d|2[0-3])[:hH]([0-5]\d)$/;

export const MINUTES_PAR_JOUR = 1440;

/** « 21:45 », « 21h45 » ou « 9:05 » → minutes depuis minuit ; null si invalide. */
export function lireHeure(saisie: string): number | null {
  const m = HHMM.exec(saisie.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes (éventuellement au-delà de minuit) → « 21:45 » ou « 01:10 (+1 j) ». */
export function formaterHeure(minutes: number): string {
  const jours = Math.floor(minutes / MINUTES_PAR_JOUR);
  const reste = ((minutes % MINUTES_PAR_JOUR) + MINUTES_PAR_JOUR) % MINUTES_PAR_JOUR;
  const hh = String(Math.floor(reste / 60)).padStart(2, '0');
  const mm = String(reste % 60).padStart(2, '0');
  return jours > 0 ? `${hh}:${mm} (+${jours} j)` : `${hh}:${mm}`;
}

/** Heure d'arrivée ramenée après le départ : une arrivée « avant » le départ tombe le lendemain. */
export function arriveeApresDepart(depart: number, arrivee: number): number {
  return arrivee < depart ? arrivee + MINUTES_PAR_JOUR : arrivee;
}
