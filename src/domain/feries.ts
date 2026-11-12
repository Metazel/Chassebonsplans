/**
 * Jours fériés de France métropolitaine (EXG-07) : données Etalab (DINUM) sous Licence Ouverte 2.0,
 * embarquées et validées au chargement.
 */
import { estDateIso } from './dates';

export interface Feries {
  version: string;
  meta: { source: string; licence: string; licenceUrl: string; producteur: string; verifieLe: string };
  /** Date ISO → nom du jour férié. */
  jours: ReadonlyMap<string, string>;
  /** Première et dernière années couvertes. */
  de: number;
  a: number;
}

const invalide = (quoi: string) => new Error(`Jours fériés invalides : ${quoi}`);

export function validerFeries(src: unknown): Feries {
  const r = src as Record<string, unknown> | null;
  if (!r || !estDateIso(r.version)) throw invalide('version');
  const m = r.meta as Record<string, unknown> | null;
  const texte = (v: unknown) => typeof v === 'string' && v.trim() !== '' && v.length <= 200;
  if (!m || !texte(m.source) || !(m.source as string).startsWith('https://') || !texte(m.licence) || !texte(m.producteur) || !estDateIso(m.verifieLe))
    throw invalide('meta');
  if (typeof m.licenceUrl !== 'string' || !m.licenceUrl.startsWith('https://')) throw invalide('licence');
  const j = r.jours as Record<string, unknown> | null;
  if (!j || typeof j !== 'object') throw invalide('jours');
  const jours = new Map<string, string>();
  for (const [date, nom] of Object.entries(j)) {
    if (!estDateIso(date) || !texte(nom) || (nom as string).length > 40) throw invalide(`jour ${date}`);
    jours.set(date, nom as string);
  }
  const annees = [...jours.keys()].map((d) => Number(d.slice(0, 4)));
  if (!annees.length) throw invalide('aucun jour');
  const de = Math.min(...annees);
  const a = Math.max(...annees);
  // Une année couverte compte au moins les 11 jours fériés métropolitains.
  for (let an = de; an <= a; an++) if (annees.filter((x) => x === an).length < 11) throw invalide(`année ${an} incomplète`);
  return {
    version: r.version as string,
    meta: { source: m.source as string, licence: m.licence as string, licenceUrl: m.licenceUrl, producteur: m.producteur as string, verifieLe: m.verifieLe as string },
    jours,
    de,
    a,
  };
}

/** Nom du jour férié, ou undefined. */
export const ferie = (f: Feries, date: string): string | undefined => f.jours.get(date);

/** La date est-elle dans les années couvertes par les données ? */
export const couvert = (f: Feries, date: string) => {
  const an = Number(date.slice(0, 4));
  return an >= f.de && an <= f.a;
};
