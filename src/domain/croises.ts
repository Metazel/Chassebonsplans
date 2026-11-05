/**
 * Carte Avantage et billets croisés (CU-C) : à partir des trajets planifiés, regrouper les allers et retours
 * en billets aller-retour qui respectent les conditions de la carte (une nuit de vendredi, samedi ou dimanche
 * comprise, 61 jours au plus), en croisant d'une semaine à l'autre si besoin ; estimer l'économie.
 * Indicatif : les prix réels sont ceux du site de vente.
 */
import { ecartJours, estDateIso, jourSemaine, ajouterJours } from './dates';
import type { Deplacement } from './deplacements';
import type { MetaReferentiel } from './referentiel';

export interface ReglesAvantage {
  levier: string;
  prixCarteCentimes: number;
  reductionPourcent: number;
  /** Jours (0 = lundi) dont la nuit suivante rend un aller-retour éligible. */
  nuitsEligibles: number[];
  /** Jours où un aller simple est éligible. */
  joursSimplesEligibles: number[];
  ecartMaxJours: number;
  operateursEligibles: string[];
  plafonds: { dureeMaxMin: number | null; centimes: number }[];
  meta: MetaReferentiel;
}

const invalide = (quoi: string) => new Error(`Règles Avantage invalides : ${quoi}`);
const entier = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const jours = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((j) => entier(j, 0, 6));

export function validerRegles(src: unknown): ReglesAvantage {
  const r = src as Record<string, unknown> | null;
  const meta = r?.meta as Record<string, unknown> | undefined;
  if (!r || !meta || typeof meta.source !== 'string' || !meta.source.startsWith('https://') || !estDateIso(meta.verifieLe)) throw invalide('meta');
  if (typeof r.levier !== 'string') throw invalide('levier');
  if (!entier(r.prixCarteCentimes, 0, 100_000) || !entier(r.reductionPourcent, 0, 100) || !entier(r.ecartMaxJours, 0, 366)) throw invalide('valeurs');
  if (!jours(r.nuitsEligibles) || !jours(r.joursSimplesEligibles)) throw invalide('jours');
  if (!Array.isArray(r.operateursEligibles) || !r.operateursEligibles.every((o) => typeof o === 'string' && o && o === o.toLowerCase())) throw invalide('opérateurs');
  if (!Array.isArray(r.plafonds) || !r.plafonds.length) throw invalide('plafonds');
  const plafonds = r.plafonds.map((p: Record<string, unknown>) => {
    if (!(p.dureeMaxMin === null || entier(p.dureeMaxMin, 1, 24 * 60)) || !entier(p.centimes, 0, 100_000)) throw invalide('plafond');
    return { dureeMaxMin: p.dureeMaxMin as number | null, centimes: p.centimes as number };
  });
  if (plafonds[plafonds.length - 1]?.dureeMaxMin !== null) throw invalide('dernier plafond sans limite de durée');
  return {
    levier: r.levier,
    prixCarteCentimes: r.prixCarteCentimes as number,
    reductionPourcent: r.reductionPourcent as number,
    nuitsEligibles: r.nuitsEligibles as number[],
    joursSimplesEligibles: r.joursSimplesEligibles as number[],
    ecartMaxJours: r.ecartMaxJours as number,
    operateursEligibles: r.operateursEligibles as string[],
    plafonds,
    meta: { source: meta.source, verifieLe: meta.verifieLe as string },
  };
}

/** Le train est-il d'un opérateur où la carte s'applique (TGV INOUI, Intercités ; pas OUIGO ni Trenitalia) ? */
export const operateurEligible = (r: ReglesAvantage, operateur: string) => {
  const o = operateur.toLowerCase();
  return r.operateursEligibles.some((x) => o.includes(x));
};

/** Un aller-retour de `aller` à `retour` (dates) comprend-il une nuit éligible, à 61 jours au plus ? Bornes comprises. */
export function allerRetourEligible(r: ReglesAvantage, aller: string, retour: string): boolean {
  const n = ecartJours(aller, retour);
  if (n < 0 || n > r.ecartMaxJours) return false;
  // Nuits passées : celles qui commencent les jours aller, aller+1, …, retour-1.
  for (let i = 0; i < Math.min(n, 7); i++) if (r.nuitsEligibles.includes(jourSemaine(ajouterJours(aller, i)))) return true;
  return false;
}

/** Prix plafond Avantage pour un trajet direct de cette durée (minutes). */
export function plafond(r: ReglesAvantage, dureeMin: number): number {
  return (r.plafonds.find((p) => p.dureeMaxMin === null || dureeMin <= p.dureeMaxMin) ?? r.plafonds[r.plafonds.length - 1]!).centimes;
}

/** Prix estimé avec la carte : 30 % de réduction, sans dépasser le plafond. */
export const prixAvecCarte = (r: ReglesAvantage, prixCentimes: number, dureeMin: number) =>
  Math.min(Math.round((prixCentimes * (100 - r.reductionPourcent)) / 100), plafond(r, dureeMin));

export interface Jambe {
  id: string;
  cote: 'aller' | 'retour';
  /** MP : Marseille → Paris ; PM : Paris → Marseille. */
  sens: 'MP' | 'PM';
  date: string;
  depart: number;
  arrivee: number;
  operateur: string;
  numero: string;
}

export type Billet =
  | { type: 'ar'; croise: boolean; origine: 'Marseille' | 'Paris'; aller: Jambe; retour: Jambe }
  | { type: 'simple'; jambe: Jambe }
  | { type: 'hors-carte'; jambe: Jambe; raison: 'operateur' | 'conditions' };

export interface PlanAvantage {
  billets: Billet[];
  /** Trajets couverts par la carte (aller-retour éligibles et allers simples du week-end). */
  eligibles: number;
  /** Dont rendus éligibles par le croisement. */
  grace: number;
  total: number;
}

const avant = (a: Jambe, b: Jambe) => a.date < b.date || (a.date === b.date && a.arrivee <= b.depart);

/**
 * Plan de réservation. Trajets pris en compte : train choisi, statut « à réserver » ou « dans le panier », à venir.
 * 1. Un déplacement qui comprend déjà une nuit éligible reste un aller-retour tel quel.
 * 2. Les autres trajets sont appariés au mieux (appariement maximal, du plus court écart au plus long) :
 *    aller de la semaine S avec retour de la semaine S+1 (depuis Marseille), retour S avec aller S+1 (depuis Paris).
 * 3. Un trajet resté seul : aller simple éligible le samedi ou le dimanche, sinon hors carte.
 */
export function planifier(r: ReglesAvantage, liste: Deplacement[], aujourdhui: string): PlanAvantage {
  const jambes: Jambe[] = [];
  for (const d of liste) {
    for (const cote of ['aller', 'retour'] as const) {
      const t = d[cote];
      if (!t.train || t.date < aujourdhui || (t.statut !== 'a-reserver' && t.statut !== 'panier')) continue;
      jambes.push({ id: d.id, cote, sens: cote === 'aller' ? 'MP' : 'PM', date: t.date, depart: t.train.depart, arrivee: t.train.arrivee, operateur: t.train.operateur, numero: t.train.numero });
    }
  }
  jambes.sort((a, b) => a.date.localeCompare(b.date) || a.depart - b.depart);
  const billets: Billet[] = [];
  const hors = jambes.filter((j) => !operateurEligible(r, j.operateur));
  const pool = jambes.filter((j) => operateurEligible(r, j.operateur));
  const utilise = new Set<Jambe>();

  // 1. Déplacements déjà éligibles tels quels.
  for (const a of pool) {
    if (a.cote !== 'aller') continue;
    const b = pool.find((x) => x.id === a.id && x.cote === 'retour');
    if (b && avant(a, b) && allerRetourEligible(r, a.date, b.date)) {
      billets.push({ type: 'ar', croise: false, origine: 'Marseille', aller: a, retour: b });
      utilise.add(a).add(b);
    }
  }

  // 2. Appariement maximal (chemins augmentants) entre trajets restants de sens opposés.
  const restants = pool.filter((j) => !utilise.has(j));
  const mp = restants.filter((j) => j.sens === 'MP');
  const pm = restants.filter((j) => j.sens === 'PM');
  const compatible = (x: Jambe, y: Jambe) => {
    const [premier, second] = avant(x, y) ? [x, y] : [y, x];
    return premier !== second && allerRetourEligible(r, premier.date, second.date) && avant(premier, second);
  };
  const voisins = new Map<Jambe, Jambe[]>(
    mp.map((x) => [x, pm.filter((y) => compatible(x, y)).sort((a, b) => Math.abs(ecartJours(x.date, a.date)) - Math.abs(ecartJours(x.date, b.date)))]),
  );
  const partenaire = new Map<Jambe, Jambe>(); // trajet PM → trajet MP
  const augmenter = (x: Jambe, vus: Set<Jambe>): boolean => {
    for (const y of voisins.get(x) ?? []) {
      if (vus.has(y)) continue;
      vus.add(y);
      const actuel = partenaire.get(y);
      if (!actuel || augmenter(actuel, vus)) {
        partenaire.set(y, x);
        return true;
      }
    }
    return false;
  };
  for (const x of mp) augmenter(x, new Set());
  let grace = 0;
  for (const [y, x] of partenaire) {
    const [aller, retour] = avant(x, y) ? [x, y] : [y, x];
    billets.push({ type: 'ar', croise: x.id !== y.id, origine: aller.sens === 'MP' ? 'Marseille' : 'Paris', aller, retour });
    utilise.add(x).add(y);
    grace += x.id !== y.id ? 2 : 0;
  }

  // 3. Trajets seuls.
  for (const j of pool) {
    if (utilise.has(j)) continue;
    if (r.joursSimplesEligibles.includes(jourSemaine(j.date))) billets.push({ type: 'simple', jambe: j });
    else billets.push({ type: 'hors-carte', jambe: j, raison: 'conditions' });
  }
  for (const j of hors) billets.push({ type: 'hors-carte', jambe: j, raison: 'operateur' });

  const dateBillet = (b: Billet) => (b.type === 'ar' ? b.aller.date : b.jambe.date);
  billets.sort((a, b) => dateBillet(a).localeCompare(dateBillet(b)));
  const eligibles = billets.reduce((n, b) => n + (b.type === 'ar' ? 2 : b.type === 'simple' ? 1 : 0), 0);
  return { billets, eligibles, grace, total: jambes.length };
}

export interface Estimation {
  /** Économie estimée sur les trajets éligibles du plan. */
  economieCentimes: number;
  /** Économie estimée par trajet éligible. */
  parTrajetCentimes: number;
  /** Trajets éligibles nécessaires pour rembourser la carte (null si aucune économie). */
  seuilTrajets: number | null;
}

/**
 * Estimation à partir d'un prix habituel sans carte (saisi par le voyageur), pour un trajet de durée `dureeMin`.
 */
export function estimer(r: ReglesAvantage, plan: PlanAvantage, prixHabituelCentimes: number, dureeMin: number): Estimation {
  const parTrajet = Math.max(0, prixHabituelCentimes - prixAvecCarte(r, prixHabituelCentimes, dureeMin));
  return {
    economieCentimes: parTrajet * plan.eligibles,
    parTrajetCentimes: parTrajet,
    seuilTrajets: parTrajet > 0 ? Math.ceil(r.prixCarteCentimes / parTrajet) : null,
  };
}

/** Durée type des trajets du plan (médiane), pour le plafond ; 3 h 15 par défaut. */
export function dureeType(plan: PlanAvantage): number {
  const d = plan.billets
    .flatMap((b) => (b.type === 'ar' ? [b.aller, b.retour] : [b.jambe]))
    .map((j) => j.arrivee - j.depart)
    .sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)]! : 195;
}
