/**
 * Déplacements déclarés (CU-A) et suivi de réservation (CU-D). Stockés localement (EXG-01),
 * purgés au-delà de 24 mois (EXG-03), validés à chaque relecture.
 */
import { ajouterMois, ecartJours, estDateIso } from './dates';
import { lireMontant } from './argent';
import { contientNumeroCarte } from './securite';
import type { Sens, TrainHoraire } from './horaires';

export type Statut = 'a-reserver' | 'option' | 'paye';
export const STATUTS: readonly Statut[] = ['a-reserver', 'option', 'paye'];
export const LIBELLES_STATUT: Record<Statut, string> = { 'a-reserver': 'À réserver', option: 'Option posée', paye: 'Payé' };

export interface TrainChoisi {
  numero: string;
  operateur: string;
  depart: number;
  arrivee: number;
}

export interface Trajet {
  date: string;
  train?: TrainChoisi;
  statut: Statut;
  /** Date limite de paiement d'une option posée. */
  limiteOption?: string;
  /** Prix du billet, en centimes (facultatif ; compté dans le total une fois payé). */
  prixCentimes?: number;
}

export interface Deplacement {
  id: string;
  aller: Trajet;
  retour: Trajet;
}

export const MAX_DEPLACEMENTS = 300;
export const DUREE_MAX_JOURS = 30;

export function nouveauDeplacement(id: string, aller: string, retour: string): Deplacement {
  return { id, aller: { date: aller, statut: 'a-reserver' }, retour: { date: retour, statut: 'a-reserver' } };
}

/** Contrôle d'une saisie : dates valides, retour au plus tôt le jour de l'aller, 30 jours au plus. */
export function verifierDates(aller: string, retour: string): string | null {
  if (!estDateIso(aller)) return 'Indiquez la date d’aller.';
  if (!estDateIso(retour)) return 'Indiquez la date de retour.';
  if (retour < aller) return 'Le retour doit être le même jour que l’aller ou après.';
  if (ecartJours(aller, retour) > DUREE_MAX_JOURS) return 'Un déplacement dure 30 jours au plus.';
  return null;
}

export const choisir = (t: TrainHoraire): TrainChoisi => ({ numero: t.numero, operateur: t.operateur, depart: t.depart, arrivee: t.arrivee });

/** Identifiant sans chiffres : rien qui ressemble à un numéro (EXG-02). */
const ID = /^[a-z-]{4,40}$/;
export function nouvelId(aleatoire: () => number = Math.random): string {
  let id = 'd-';
  for (let i = 0; i < 12; i++) id += String.fromCharCode(97 + Math.floor(aleatoire() * 26));
  return id;
}
const court = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !contientNumeroCarte(v);

function lireTrain(v: unknown): TrainChoisi | undefined {
  const t = v as Record<string, unknown> | null;
  if (!t) return undefined;
  const ok =
    court(t.numero, 12) && court(t.operateur, 40) &&
    Number.isInteger(t.depart) && Number.isInteger(t.arrivee) &&
    (t.depart as number) >= 0 && (t.arrivee as number) > (t.depart as number) && (t.arrivee as number) <= 48 * 60;
  return ok ? { numero: t.numero as string, operateur: t.operateur as string, depart: t.depart as number, arrivee: t.arrivee as number } : undefined;
}

function lireTrajet(v: unknown): Trajet | null {
  const t = v as Record<string, unknown> | null;
  if (!t || !estDateIso(t.date) || !STATUTS.includes(t.statut as Statut)) return null;
  const trajet: Trajet = { date: t.date, statut: t.statut as Statut };
  const train = lireTrain(t.train);
  if (train) trajet.train = train;
  // La date limite d'une option ne peut pas dépasser le jour du trajet.
  if (t.statut === 'option' && estDateIso(t.limiteOption) && t.limiteOption <= t.date) trajet.limiteOption = t.limiteOption;
  if (Number.isInteger(t.prixCentimes) && (t.prixCentimes as number) >= 0 && (t.prixCentimes as number) <= 100_000) trajet.prixCentimes = t.prixCentimes as number;
  return trajet;
}

/** Relit une liste de déplacements : les entrées invalides sont écartées (et comptées). */
export function lireDeplacements(v: unknown): { deplacements: Deplacement[]; ecartes: number } {
  if (!Array.isArray(v)) return { deplacements: [], ecartes: v === undefined ? 0 : 1 };
  const deplacements: Deplacement[] = [];
  let ecartes = 0;
  const vus = new Set<string>();
  for (const d of v.slice(0, MAX_DEPLACEMENTS)) {
    const r = d as Record<string, unknown> | null;
    const aller = lireTrajet(r?.aller);
    const retour = lireTrajet(r?.retour);
    if (!r || typeof r.id !== 'string' || !ID.test(r.id) || vus.has(r.id) || !aller || !retour || verifierDates(aller.date, retour.date)) {
      ecartes++;
      continue;
    }
    vus.add(r.id);
    deplacements.push({ id: r.id, aller, retour });
  }
  return { deplacements, ecartes: ecartes + Math.max(0, v.length - MAX_DEPLACEMENTS) };
}

/** EXG-03 : déplacements dont le retour date de plus de `mois` mois. */
export function purger(liste: Deplacement[], aujourdhui: string, mois = 24): Deplacement[] {
  const limite = ajouterMois(aujourdhui, -mois);
  return liste.filter((d) => d.retour.date >= limite);
}

export const trier = (liste: Deplacement[]) => [...liste].sort((a, b) => a.aller.date.localeCompare(b.aller.date) || a.id.localeCompare(b.id));

/** Prix saisi : vide → aucun prix ; sinon centimes, ou null si invalide. */
export function lirePrix(saisie: string): number | null | undefined {
  if (!saisie.trim()) return undefined;
  return lireMontant(saisie);
}

/** Total payé d'un déplacement (trajets au statut « payé » avec un prix). */
export const totalPaye = (d: Deplacement) =>
  [d.aller, d.retour].reduce((s, t) => s + (t.statut === 'paye' && t.prixCentimes !== undefined ? t.prixCentimes : 0), 0);

/** Options dont la date limite est passée ou tombe dans les 2 jours. */
export function optionsUrgentes(liste: Deplacement[], aujourdhui: string): { deplacement: Deplacement; cote: 'aller' | 'retour' }[] {
  const res: { deplacement: Deplacement; cote: 'aller' | 'retour' }[] = [];
  for (const d of liste) {
    for (const cote of ['aller', 'retour'] as const) {
      const t = d[cote];
      if (t.statut === 'option' && t.limiteOption && ecartJours(aujourdhui, t.limiteOption) <= 2 && t.date >= aujourdhui) res.push({ deplacement: d, cote });
    }
  }
  return res;
}

export const sensDu = (cote: 'aller' | 'retour'): Sens => (cote === 'aller' ? 'MP' : 'PM');
