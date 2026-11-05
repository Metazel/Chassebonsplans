/**
 * Prix réels vus sur le site de vente (saisis ou collés par le voyageur) : coût complet et recommandation
 * des trains d'un trajet. Aucune requête vers le site (EXG-08) : seul le voyageur copie ce qu'il voit.
 */
import { estDateIso, ecartJours } from './dates';
import { lireMontant } from './argent';
import { contientNumeroCarte } from './securite';
import { recommander, type ParametresCout, type Recommandation } from './coutComplet';

export interface PrixVu {
  /** Train concerné : « numéro|départ en minutes ». */
  train: string;
  centimes: number;
  /** Jour où le prix a été vu (les prix changent). */
  le: string;
}

export const MAX_PRIX_VUS = 20;
/** Au-delà, le prix est signalé comme ancien. */
export const AGE_MAX_PRIX_JOURS = 2;

export const clePrix = (t: { numero: string; depart: number }) => `${t.numero}|${t.depart}`;
const CLE = /^[A-Za-z0-9 ]{1,12}\|\d{1,4}$/;

/** Relit les prix vus d'un trajet (entrées invalides écartées, un prix par train, le plus récent). */
export function lirePrixVus(v: unknown): PrixVu[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const parTrain = new Map<string, PrixVu>();
  for (const x of v.slice(0, MAX_PRIX_VUS * 2)) {
    const p = x as Record<string, unknown> | null;
    if (!p || typeof p.train !== 'string' || !CLE.test(p.train) || contientNumeroCarte(p.train)) continue;
    if (!Number.isInteger(p.centimes) || (p.centimes as number) < 0 || (p.centimes as number) > 100_000 || !estDateIso(p.le)) continue;
    const prec = parTrain.get(p.train);
    if (!prec || prec.le <= p.le) parTrain.set(p.train, { train: p.train, centimes: p.centimes as number, le: p.le });
  }
  const res = [...parTrain.values()].slice(0, MAX_PRIX_VUS);
  return res.length ? res : undefined;
}

/** Ajoute, remplace ou retire (centimes undefined) le prix vu d'un train. */
export function majPrixVu(prixVus: PrixVu[] | undefined, train: string, centimes: number | undefined, le: string): PrixVu[] | undefined {
  const autres = (prixVus ?? []).filter((p) => p.train !== train);
  const res = centimes === undefined ? autres : [...autres, { train, centimes, le }].slice(-MAX_PRIX_VUS);
  return res.length ? res : undefined;
}

export const prixVuDe = (prixVus: PrixVu[] | undefined, t: { numero: string; depart: number }) => prixVus?.find((p) => p.train === clePrix(t));

export const prixAncien = (p: PrixVu, aujourdhui: string) => ecartJours(p.le, aujourdhui) > AGE_MAX_PRIX_JOURS;

/**
 * Recommandation au coût complet parmi les trains dont le prix est connu (règle du CLAUDE.md :
 * le moins cher, et à égalité à la tolérance près, celui qui arrive le plus tôt).
 */
export function recommanderParPrix(
  trains: readonly { numero: string; depart: number; arrivee: number }[],
  prixVus: PrixVu[] | undefined,
  p: ParametresCout,
): Recommandation | null {
  const avecPrix = trains.flatMap((t) => {
    const pv = prixVuDe(prixVus, t);
    return pv ? [{ id: clePrix(t), depart: t.depart % 1440, arrivee: t.arrivee % 1440, prixCentimes: pv.centimes }] : [];
  });
  return recommander(avecPrix, p);
}

export interface LigneCollee {
  depart: number;
  arrivee: number;
  centimes: number;
}

const HEURE = /(?<![\d,.])([01]?\d|2[0-3])\s?[h:]\s?([0-5]\d)(?!\d)/g;
const PRIX = /(?<![\d,.])(\d{1,4}(?:[,.]\d{1,2})?)\s?(?:€|EUR)/g;

/**
 * Lit un texte collé depuis une page de résultats (sélectionner tout, copier, coller). Pour chaque train :
 * une heure de départ, puis la première heure qui donne une durée plausible (1 h à 8 h, passage de minuit admis)
 * est l'arrivée ; une durée affichée (« 3h19 ») est reconnue et ignorée ; le prix qui suit est celui du train.
 * Un train sans prix (complet) est abandonné quand une nouvelle heure de départ apparaît. Plusieurs prix pour
 * un même train (classes, tarifs) : le plus bas est gardé. Lecture au mieux, à confirmer par le voyageur.
 */
export function lireCollage(texte: string): LigneCollee[] {
  const t = texte.slice(0, 200_000);
  const jetons: { pos: number; heure?: number; prix?: number }[] = [];
  for (const m of t.matchAll(HEURE)) jetons.push({ pos: m.index, heure: Number(m[1]) * 60 + Number(m[2]) });
  for (const m of t.matchAll(PRIX)) {
    const c = lireMontant(m[1]!.replace('.', ','));
    if (c !== null && c > 0) jetons.push({ pos: m.index, prix: c });
  }
  jetons.sort((x, y) => x.pos - y.pos);
  const res = new Map<string, LigneCollee>();
  const plausible = (d: number, h: number) => {
    const a = h > d ? h : h + 1440;
    return a - d >= 60 && a - d <= 8 * 60 ? a : null;
  };
  let depart: number | null = null;
  let arrivee: number | null = null;
  let dernier: LigneCollee | null = null;
  for (const j of jetons) {
    if (j.heure !== undefined) {
      if (depart === null) {
        depart = j.heure;
      } else if (arrivee === null) {
        const a = plausible(depart, j.heure);
        if (a !== null) arrivee = a;
        // sinon : durée affichée avant l'arrivée, ou bruit : on attend l'heure suivante
      } else if (j.heure !== arrivee - depart) {
        // Nouvelle heure de départ : le train précédent n'avait pas de prix (complet).
        depart = j.heure;
        arrivee = null;
      }
      dernier = null;
      continue;
    }
    if (depart !== null && arrivee !== null) {
      const cle = `${depart}|${arrivee}`;
      dernier = { depart, arrivee, centimes: Math.min(res.get(cle)?.centimes ?? Infinity, j.prix!) };
      res.set(cle, dernier);
    } else if (dernier) {
      // Autre prix du même train (classe, tarif) : on garde le plus bas.
      dernier.centimes = Math.min(dernier.centimes, j.prix!);
    }
    depart = null;
    arrivee = null;
  }
  return [...res.values()].sort((x, y) => x.depart - y.depart);
}

/** Associe les lignes collées aux trains du jour par heure de départ (et d'arrivée si elles divergent). */
export function associerCollage<T extends { numero: string; depart: number; arrivee: number }>(
  lignes: LigneCollee[],
  trains: readonly T[],
): { train: T; centimes: number }[] {
  const res: { train: T; centimes: number }[] = [];
  for (const t of trains) {
    const memeDepart = lignes.filter((l) => l.depart === t.depart % 1440);
    const l = memeDepart.find((x) => x.arrivee % 1440 === t.arrivee % 1440) ?? (memeDepart.length === 1 ? memeDepart[0] : undefined);
    if (l) res.push({ train: t, centimes: l.centimes });
  }
  return res;
}
