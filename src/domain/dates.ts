/** Dates calendaires ISO AAAA-MM-JJ (sans fuseau). */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function estDateIso(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = ISO.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const JOUR = 86_400_000;
const utc = (iso: string) => {
  const [a, m, j] = iso.split('-').map(Number);
  return Date.UTC(a!, m! - 1, j!);
};

/** Nombre de jours de `de` à `a` (négatif si `a` est avant). */
export const ecartJours = (de: string, a: string) => Math.round((utc(a) - utc(de)) / JOUR);

export const ajouterJours = (iso: string, n: number) => new Date(utc(iso) + n * JOUR).toISOString().slice(0, 10);

/** Ajoute (ou retire) des mois, la date étant ramenée au dernier jour du mois si besoin (31 mars − 1 mois = 28/29 février). */
export function ajouterMois(iso: string, n: number): string {
  const [a, m, j] = iso.split('-').map(Number);
  const cible = new Date(Date.UTC(a!, m! - 1 + n, 1));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(j!, dernier));
  return cible.toISOString().slice(0, 10);
}

/** 0 = lundi … 6 = dimanche. */
export const jourSemaine = (iso: string) => (new Date(utc(iso)).getUTCDay() + 6) % 7;

const FORMAT_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const FORMAT_COURT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const dateLongue = (iso: string) => FORMAT_LONG.format(new Date(utc(iso)));
export const dateCourte = (iso: string) => FORMAT_COURT.format(new Date(utc(iso)));
