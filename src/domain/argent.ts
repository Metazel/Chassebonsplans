/** Montants en centimes entiers pour éviter les erreurs d'arrondi. */

const MONTANT = /^(\d{1,4})(?:[.,](\d{1,2}))?$/;

/** « 29,90 », « 29.9 » ou « 30 » → 2990 centimes ; null si invalide ou hors bornes. */
export function lireMontant(saisie: string, maxEuros = 1000): number | null {
  const m = MONTANT.exec(saisie.trim().replace(/\s|€/g, ''));
  if (!m) return null;
  const euros = Number(m[1]);
  const centimes = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  const total = euros * 100 + centimes;
  return total <= maxEuros * 100 ? total : null;
}

const FORMAT = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export function formaterMontant(centimes: number): string {
  return FORMAT.format(centimes / 100);
}
