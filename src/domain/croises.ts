/**
 * Carte Avantage et billets croisés (CU-C) : à partir des trajets planifiés, regrouper les allers et retours
 * en billets aller-retour qui respectent les conditions de la carte (une nuit de vendredi, samedi ou dimanche
 * comprise, 61 jours au plus), en croisant d'une semaine à l'autre si besoin ; estimer l'économie.
 * Indicatif : les prix réels sont ceux du site de vente.
 */
import { ecartJours, estDateIso, jourSemaine, ajouterJours } from './dates';
import { etatVente, type ReferentielOuvertures } from './ventes';
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
  for (let i = 1; i < plafonds.length - 1; i++) if ((plafonds[i]!.dureeMaxMin as number) <= (plafonds[i - 1]!.dureeMaxMin as number)) throw invalide('plafonds non triés');
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
  /** Train choisi ; absent si pas encore choisi (supposé TGV INOUI ou Intercités pour la simulation). */
  depart?: number;
  arrivee?: number;
  operateur?: string;
  numero?: string;
  /** Pas encore en vente : date d'ouverture connue. */
  ouvertureLe?: string;
  /** Billet déjà engagé (au panier, en option ou payé) : identifiant partagé avec l'autre trajet. */
  billet?: string;
  /** Prix vu sur le site de vente pour le train choisi, en centimes. */
  prixVuCentimes?: number;
  /** Statut du trajet. */
  statut: string;
}

export type Billet =
  | { type: 'ar'; croise: boolean; origine: 'Marseille' | 'Paris'; aller: Jambe; retour: Jambe; engage: boolean }
  | { type: 'simple'; jambe: Jambe }
  | { type: 'hors-carte'; jambe: Jambe; raison: 'operateur' | 'conditions' | 'carte-expiree' };

export interface PlanAvantage {
  billets: Billet[];
  /** Trajets à réserver couverts par la carte (aller-retour éligibles et allers simples du week-end). */
  eligibles: number;
  /** Dont rendus éligibles par le croisement (et qui ne l'auraient pas été seuls). */
  grace: number;
  /** Trajets à réserver pris en compte. */
  total: number;
}

export interface OptionsPlan {
  /** Minutes écoulées depuis minuit (heure de Paris) : un train du jour déjà parti est ignoré. */
  maintenant?: number;
  /** Fin de validité de la carte : au-delà, les trajets sont hors carte. */
  finValidite?: string;
  /** Calendrier des ouvertures de ventes, pour signaler un trajet pas encore en vente. */
  ouvertures?: ReferentielOuvertures;
}

const avant = (a: Jambe, b: Jambe) => a.date < b.date || (a.date === b.date && (a.arrivee ?? 0) <= (b.depart ?? 24 * 60));
const aReserver = (j: Jambe) => j.statut === 'a-reserver' || j.statut === 'panier';
const dureeDe = (j: Jambe) => (j.depart !== undefined && j.arrivee !== undefined ? j.arrivee - j.depart : undefined);

/** Collecte les trajets à venir avec leur état (train, vente, billet engagé). */
export function jambesDe(liste: Deplacement[], aujourdhui: string, o: OptionsPlan = {}): Jambe[] {
  const jambes: Jambe[] = [];
  for (const d of liste) {
    for (const cote of ['aller', 'retour'] as const) {
      const t = d[cote];
      if (t.date < aujourdhui) continue;
      if (t.train && t.date === aujourdhui && o.maintenant !== undefined && t.train.depart <= o.maintenant) continue;
      const j: Jambe = { id: d.id, cote, sens: cote === 'aller' ? 'MP' : 'PM', date: t.date, statut: t.statut };
      if (t.train) {
        j.depart = t.train.depart;
        j.arrivee = t.train.arrivee;
        j.operateur = t.train.operateur;
        j.numero = t.train.numero;
        const vu = t.prixVus?.find((x) => x.train === `${t.train!.numero}|${t.train!.depart}`);
        if (vu) j.prixVuCentimes = vu.centimes;
        if (o.ouvertures && t.statut === 'a-reserver') {
          const e = etatVente(o.ouvertures, t.train.operateur, t.date, aujourdhui, o.maintenant);
          if (e.etat === 'ouverture') j.ouvertureLe = e.le;
        }
      }
      if (t.billet) j.billet = t.billet;
      jambes.push(j);
    }
  }
  return jambes.sort((a, b) => a.date.localeCompare(b.date) || (a.depart ?? 0) - (b.depart ?? 0) || a.id.localeCompare(b.id));
}

/**
 * Affectation de poids maximal (méthode hongroise, O(n³)) sur une matrice de poids ≥ 0.
 * Renvoie pour chaque ligne la colonne affectée (poids 0 = pas de paire).
 */
export function affectationMax(poids: number[][]): number[] {
  const n = Math.max(poids.length, ...poids.map((l) => l.length), 0);
  if (!n) return [];
  const max = Math.max(0, ...poids.flat());
  const cout = (i: number, j: number) => max - (poids[i]?.[j] ?? 0);
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const voie = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const vu = new Array<boolean>(n + 1).fill(false);
    do {
      vu[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (vu[j]) continue;
        const c = cout(i0 - 1, j - 1) - u[i0]! - v[j]!;
        if (c < minv[j]!) {
          minv[j] = c;
          voie[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (vu[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else minv[j]! -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = voie[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const res = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) res[p[j]! - 1] = j - 1;
  return res;
}

/**
 * Plan de réservation, optimal en nombre de trajets couverts par la carte.
 * - Billets engagés (au panier, en option, payés : même identifiant de billet) : gardés tels quels.
 * - Autres trajets à réserver : appariement de poids maximal entre allers et retours de sens opposés
 *   (aller-retour éligible = 2 trajets couverts, moins ceux déjà couverts seuls en aller simple du week-end) ;
 *   à égalité, aller-retour du même déplacement d'abord, puis le plus court écart.
 * - Trajet resté seul : aller simple éligible le samedi ou le dimanche, sinon hors carte.
 */
export function planifier(r: ReglesAvantage, liste: Deplacement[], aujourdhui: string, o: OptionsPlan = {}): PlanAvantage {
  const toutes = jambesDe(liste, aujourdhui, o);
  const billets: Billet[] = [];
  const pris = new Set<Jambe>();
  const expiree = (j: Jambe) => o.finValidite !== undefined && j.date > o.finValidite;
  const eligibleOperateur = (j: Jambe) => j.operateur === undefined || operateurEligible(r, j.operateur);

  // 1. Billets engagés : les deux trajets portent le même identifiant.
  const parBillet = new Map<string, Jambe[]>();
  for (const j of toutes) if (j.billet) parBillet.set(j.billet, [...(parBillet.get(j.billet) ?? []), j]);
  for (const [, js] of parBillet) {
    if (js.length !== 2 || !js.some(aReserver)) continue;
    const [a, b] = avant(js[0]!, js[1]!) ? [js[0]!, js[1]!] : [js[1]!, js[0]!];
    billets.push({ type: 'ar', croise: a.id !== b.id, origine: a.sens === 'MP' ? 'Marseille' : 'Paris', aller: a, retour: b, engage: true });
    pris.add(a).add(b);
  }

  const jambes = toutes.filter((j) => aReserver(j) && !pris.has(j));
  const hors = jambes.filter((j) => !eligibleOperateur(j) || expiree(j));
  const pool = jambes.filter((j) => eligibleOperateur(j) && !expiree(j));
  const simple = (j: Jambe) => (r.joursSimplesEligibles.includes(jourSemaine(j.date)) ? 1 : 0);
  const mp = pool.filter((j) => j.sens === 'MP');
  const pm = pool.filter((j) => j.sens === 'PM');
  // Poids entier : gain en trajets couverts (×10 000), puis préférence « même déplacement » (+500), puis écart court.
  const poids = mp.map((x) =>
    pm.map((y) => {
      const [a, b] = avant(x, y) ? [x, y] : [y, x];
      if (!avant(a, b) || !allerRetourEligible(r, a.date, b.date)) return 0;
      const gain = 2 - simple(x) - simple(y);
      if (gain <= 0) return 0;
      return gain * 10_000 + (x.id === y.id ? 500 : 0) + (r.ecartMaxJours - ecartJours(a.date, b.date));
    }),
  );
  const affectation = affectationMax(poids);
  let grace = 0;
  mp.forEach((x, i) => {
    const k = affectation[i] ?? -1;
    const y = pm[k];
    if (!y || !(poids[i]?.[k] ?? 0)) return;
    const [aller, retour] = avant(x, y) ? [x, y] : [y, x];
    const croise = x.id !== y.id;
    billets.push({ type: 'ar', croise, origine: aller.sens === 'MP' ? 'Marseille' : 'Paris', aller, retour, engage: false });
    pris.add(x).add(y);
    if (croise) grace += 2 - simple(x) - simple(y);
  });
  for (const j of pool) {
    if (pris.has(j)) continue;
    billets.push(simple(j) ? { type: 'simple', jambe: j } : { type: 'hors-carte', jambe: j, raison: 'conditions' });
  }
  for (const j of hors) billets.push({ type: 'hors-carte', jambe: j, raison: expiree(j) ? 'carte-expiree' : 'operateur' });

  const dateBillet = (b: Billet) => (b.type === 'ar' ? b.aller.date : b.jambe.date);
  billets.sort((a, b) => dateBillet(a).localeCompare(dateBillet(b)));
  const couvertes = (b: Billet) => (b.type === 'ar' ? [b.aller, b.retour].filter(aReserver).length : b.type === 'simple' ? 1 : 0);
  return { billets, eligibles: billets.reduce((n, b) => n + couvertes(b), 0), grace, total: toutes.filter(aReserver).length };
}

/** Trajets couverts par la carte dans le plan (avec leur durée, pour le plafond). */
const jambesCouvertes = (plan: PlanAvantage) =>
  plan.billets.flatMap((b) => (b.type === 'ar' ? [b.aller, b.retour].filter(aReserver) : b.type === 'simple' ? [b.jambe] : []));

export interface Estimation {
  /** Économie maximale sur les trajets éligibles du plan dont un prix est connu (−30 % ou plafond, trajet par trajet). */
  economieCentimes: number;
  /** Économie maximale moyenne par trajet estimé. */
  parTrajetCentimes: number;
  /** Trajets éligibles nécessaires pour rembourser la carte (null si aucune économie). */
  seuilTrajets: number | null;
  /** Trajets estimés, et parmi eux ceux estimés sur le prix vu sur le site. */
  estimes: number;
  aPrixVu: number;
}

/** Durée par défaut d'un Marseille ↔ Paris direct quand le train n'est pas choisi (3 h 15). */
export const DUREE_DEFAUT = 195;

/**
 * Estimation maximale : chaque trajet éligible coûterait au plus le moins cher de « −30 % » et du plafond de sa durée,
 * à partir du prix vu sur le site pour ce train, sinon du prix habituel saisi. Maximum : un prix déjà réduit
 * (Prems) baisse moins.
 */
export function estimer(r: ReglesAvantage, plan: PlanAvantage, prixHabituelCentimes?: number): Estimation {
  const gains: number[] = [];
  let aPrixVu = 0;
  for (const j of jambesCouvertes(plan)) {
    const prix = j.prixVuCentimes ?? prixHabituelCentimes;
    if (prix === undefined) continue;
    if (j.prixVuCentimes !== undefined) aPrixVu++;
    gains.push(Math.max(0, prix - prixAvecCarte(r, prix, dureeDe(j) ?? DUREE_DEFAUT)));
  }
  const total = gains.reduce((a, b) => a + b, 0);
  const defaut = prixHabituelCentimes !== undefined ? Math.max(0, prixHabituelCentimes - prixAvecCarte(r, prixHabituelCentimes, DUREE_DEFAUT)) : 0;
  const moyen = gains.length ? Math.round(total / gains.length) : defaut;
  return { economieCentimes: total, parTrajetCentimes: moyen, seuilTrajets: moyen > 0 ? Math.ceil(r.prixCarteCentimes / moyen) : null, estimes: gains.length, aPrixVu };
}

/**
 * Projection sur un an : `allersRetours` déplacements par an, croisés en chaîne d'une semaine à l'autre :
 * tous les trajets sont couverts sauf le premier aller et le dernier retour (si l'année en compte au moins 2).
 */
export function projectionAnnuelle(r: ReglesAvantage, prixHabituelCentimes: number, allersRetours: number, dureeMin = DUREE_DEFAUT) {
  const parTrajet = Math.max(0, prixHabituelCentimes - prixAvecCarte(r, prixHabituelCentimes, dureeMin));
  const trajets = allersRetours >= 2 ? 2 * allersRetours - 2 : 0;
  const brut = parTrajet * trajets;
  return { trajets, economieCentimes: brut, netCentimes: brut - r.prixCarteCentimes };
}

/** Durée type (médiane) des trajets couverts, pour la projection ; 3 h 15 par défaut. */
export function dureeType(plan: PlanAvantage): number {
  const d = jambesCouvertes(plan)
    .map(dureeDe)
    .filter((x): x is number => x !== undefined)
    .sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)]! : DUREE_DEFAUT;
}

/**
 * Fige les billets engagés : dès qu'un trajet d'un aller-retour du plan quitte « à réserver », les deux trajets
 * reçoivent le même identifiant de billet, et le plan ne les réapparie plus. Revenus tous deux à « à réserver »,
 * ils sont libérés.
 */
export function figerBillets(plan: PlanAvantage, liste: Deplacement[], nouvelId: () => string): Deplacement[] {
  const marques = new Map<string, string | null>(); // « id|cote » → billet (null = libérer)
  const statut = (id: string, cote: 'aller' | 'retour') => liste.find((d) => d.id === id)?.[cote].statut;
  for (const b of plan.billets) {
    if (b.type !== 'ar') continue;
    const engage = statut(b.aller.id, b.aller.cote) !== 'a-reserver' || statut(b.retour.id, b.retour.cote) !== 'a-reserver';
    const deja = b.aller.billet && b.aller.billet === b.retour.billet;
    if (engage && !deja) {
      const id = nouvelId();
      marques.set(`${b.aller.id}|${b.aller.cote}`, id).set(`${b.retour.id}|${b.retour.cote}`, id);
    } else if (!engage && deja) {
      marques.set(`${b.aller.id}|${b.aller.cote}`, null).set(`${b.retour.id}|${b.retour.cote}`, null);
    }
  }
  if (!marques.size) return liste;
  return liste.map((d) => {
    let r = d;
    for (const cote of ['aller', 'retour'] as const) {
      const m = marques.get(`${d.id}|${cote}`);
      if (m === undefined) continue;
      const t = { ...r[cote] };
      if (m === null) delete t.billet;
      else t.billet = m;
      r = { ...r, [cote]: t };
    }
    return r;
  });
}
