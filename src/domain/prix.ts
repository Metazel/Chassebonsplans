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
    if (!Number.isInteger(p.centimes) || (p.centimes as number) <= 0 || (p.centimes as number) > 100_000 || !estDateIso(p.le)) continue;
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
  aujourdhui?: string,
  /** Retour : fenêtre d'arrivée en gare à privilégier (heure du dîner) et supplément de coût complet accepté. */
  diner?: { fenetre: { de: number; a: number }; supplementMaxCentimes: number },
): Recommandation | null {
  const avecPrix = trains.flatMap((t) => {
    const pv = prixVuDe(prixVus, t);
    // Un prix vu il y a plus de 2 jours n'entre pas dans la comparaison : il a pu changer.
    return pv && !(aujourdhui && prixAncien(pv, aujourdhui)) ? [{ id: clePrix(t), depart: t.depart % 1440, arrivee: t.arrivee % 1440, prixCentimes: pv.centimes }] : [];
  });
  return recommander(
    avecPrix,
    p,
    diner ? { estPrefere: (e) => e.arriveeGare >= diner.fenetre.de && e.arriveeGare <= diner.fenetre.a, supplementMaxCentimes: diner.supplementMaxCentimes } : undefined,
  );
}

export interface LigneCollee {
  depart: number;
  arrivee: number;
  centimes: number;
}

export interface Collage {
  lignes: LigneCollee[];
  /** Le texte semble couvrir plusieurs jours, ou un autre jour que celui du trajet : rien n'est lu. */
  erreur?: 'plusieurs-dates' | 'autre-date';
}

const ESPACE = '[\\s\\u00a0\\u202f]';
/** Heure « 06:03 », « 6:03 », « 06h03 » ; une durée « 3 h 19 », « 3h19 min », « 3h 19m » n'en est pas une. */
const HEURE = new RegExp(`(?<![\\d,.:€])([01]?\\d|2[0-3])(:|h)([0-5]\\d)(?!\\d)(?!${ESPACE}?(?:min|m\\b|mn))`, 'g');
/** Montant « 45 € », « 45,90 € », « 45.90 EUR », « €45.90 » ; pas les minutes d'une heure ni la fin d'un « 1 245 € ». */
const PRIX = new RegExp(
  `(?<![\\d,.:h€])(\\d{1,4}(?:[,.]\\d{1,2})?)${ESPACE}?(?:€|EUR)|€${ESPACE}?(\\d{1,4}(?:[,.]\\d{1,2})?)(?![\\d,.])`,
  'gi',
);
/** Montant avec séparateur de milliers (« 1 245,00 € ») : jamais un prix de train ici, et sa fin ne doit pas être lue seule. */
const MILLIERS = new RegExp(`\\d{1,3}(?:${ESPACE}\\d{3})+(?:[,.]\\d{1,2})?${ESPACE}?(?:€|EUR)`, 'gi');
/** Montants qui ne sont pas le prix d'un train : économie, bagage, option, offre aller-retour, supplément… */
const HORS_PRIX = /(économis|economis|économie|bagage|option|supplément|supplement|aller-retour|remise|réduction|reduction|carte|\+)[^€\d]{0,20}$/i;
const MOIS: Record<string, number> = { janv: 1, févr: 2, fevr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, août: 8, aout: 8, sept: 9, oct: 10, nov: 11, déc: 12, dec: 12 };
const DATE = /\b(?:lun|mar|mer|jeu|ven|sam|dim)[a-z]*\.?\s+(\d{1,2})\s+(janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec)/gi;

/**
 * Lit un texte collé depuis une page de résultats (sélectionner tout, copier, coller), au mieux :
 * - pour chaque prix, les heures lues depuis le prix précédent : les durées (« 3h28 » égal à arrivée − départ
 *   d'une autre paire) sont écartées, et les deux dernières heures restantes forment départ et arrivée
 *   (une heure d'en-tête ou un train complet sans prix, placés avant, sont ainsi ignorés) ;
 * - seul le premier prix après un train compte (le site affiche « à partir de ») ; les montants d'économie,
 *   de bagage, d'option ou d'offre sont ignorés ;
 * - si les prix sont affichés avant les heures, chaque prix va au train qui suit ;
 * - plusieurs jours dans le texte, ou un autre jour que `date` (AAAA-MM-JJ) : rien n'est lu.
 */
export function lireCollage(texte: string, date?: string): Collage {
  const t = texte.slice(0, 200_000);
  const jours = new Set<string>();
  for (const m of t.matchAll(DATE)) jours.add(`${MOIS[m[2]!.toLowerCase()]}-${Number(m[1])}`);
  if (jours.size > 1) return { lignes: [], erreur: 'plusieurs-dates' };
  if (date && jours.size === 1) {
    const [, mm, jj] = date.split('-').map(Number);
    if (!jours.has(`${mm}-${jj}`)) return { lignes: [], erreur: 'autre-date' };
  }
  const jetons: { pos: number; heure?: number; prix?: number }[] = [];
  for (const m of t.matchAll(HEURE)) jetons.push({ pos: m.index, heure: Number(m[1]) * 60 + Number(m[3]) });
  const milliers = [...t.matchAll(MILLIERS)].map((m) => [m.index, m.index + m[0].length] as const);
  for (const m of t.matchAll(PRIX)) {
    if (milliers.some(([a, b]) => m.index >= a && m.index < b)) continue;
    if (HORS_PRIX.test(t.slice(Math.max(0, m.index - 40), m.index))) continue;
    const c = lireMontant((m[1] ?? m[2])!.replace('.', ','));
    if (c !== null && c > 0) jetons.push({ pos: m.index, prix: c });
  }
  jetons.sort((x, y) => x.pos - y.pos);
  const plausible = (d: number, h: number) => {
    const a = h > d ? h : h + 1440;
    return a - d >= 60 && a - d <= 8 * 60 ? a : null;
  };
  /** Départ et arrivée d'un segment d'heures : durées écartées, deux dernières heures restantes. */
  const paire = (heures: number[]): [number, number] | null => {
    const duree = new Set<number>();
    heures.forEach((h, k) =>
      heures.forEach((d, i) =>
        heures.forEach((x, j) => {
          // Une durée s'affiche après le départ de son train : k après i (évite qu'un départ passe pour la durée d'une autre paire).
          if (i < j && i < k && k !== j && plausible(d, x) !== null && plausible(d, x)! - d === h) duree.add(k);
        }),
      ),
    );
    const restes = heures.filter((_, k) => !duree.has(k));
    if (restes.length < 2) return null;
    const d = restes[restes.length - 2]!;
    const a = plausible(d, restes[restes.length - 1]!);
    return a === null ? null : [d, a];
  };
  const premierPrix = jetons.findIndex((j) => j.prix !== undefined);
  const premiereHeure = jetons.findIndex((j) => j.heure !== undefined);
  const prixAvant = premierPrix >= 0 && premiereHeure >= 0 && premierPrix < premiereHeure;
  const res = new Map<string, LigneCollee>();
  const ajouter = (p: [number, number] | null, centimes: number | undefined) => {
    if (!p || centimes === undefined) return;
    const cle = `${p[0]}|${p[1]}`;
    if (!res.has(cle)) res.set(cle, { depart: p[0], arrivee: p[1], centimes });
  };
  let heures: number[] = [];
  let prixEnAttente: number | undefined;
  let prisPourCeSegment = false;
  for (const j of jetons) {
    if (j.heure !== undefined) {
      heures.push(j.heure);
      prisPourCeSegment = false;
      continue;
    }
    if (prixAvant) {
      // Mise en page « prix puis heures » : le prix précédent revient aux heures lues depuis.
      if (heures.length) ajouter(paire(heures), prixEnAttente);
      if (heures.length || prixEnAttente === undefined) prixEnAttente = j.prix;
      heures = [];
      continue;
    }
    if (!prisPourCeSegment && heures.length) {
      ajouter(paire(heures), j.prix);
      prisPourCeSegment = true;
      heures = [];
    }
  }
  if (prixAvant && heures.length) ajouter(paire(heures), prixEnAttente);
  return { lignes: [...res.values()].sort((x, y) => x.depart - y.depart) };
}

/** Écart d'arrivée admis entre la page collée et l'horaire publié (minutes). */
export const ECART_ARRIVEE_MAX = 10;

export interface Association<T> {
  /** Prix sûrs : même départ, arrivée à ±10 min. */
  associes: { train: T; centimes: number }[];
  /** Même départ mais arrivée différente (correspondance ?) : non appliqués. */
  ecarts: { train: T; ligne: LigneCollee }[];
  /** Trains du créneau sans prix lu. */
  nonLus: T[];
}

/** Associe les lignes collées aux trains du jour par heure de départ, arrivée à ±10 min. */
export function associerCollage<T extends { numero: string; depart: number; arrivee: number }>(lignes: LigneCollee[], trains: readonly T[]): Association<T> {
  const res: Association<T> = { associes: [], ecarts: [], nonLus: [] };
  for (const t of trains) {
    const memeDepart = lignes.filter((l) => l.depart === t.depart % 1440);
    const ok = memeDepart.find((l) => Math.abs((l.arrivee % 1440) - (t.arrivee % 1440)) <= ECART_ARRIVEE_MAX);
    if (ok) res.associes.push({ train: t, centimes: ok.centimes });
    else if (memeDepart[0]) res.ecarts.push({ train: t, ligne: memeDepart[0] });
    else res.nonLus.push(t);
  }
  return res;
}
