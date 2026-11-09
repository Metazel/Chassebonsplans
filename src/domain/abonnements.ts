/**
 * Cartes et abonnements SNCF (CU4) : coût sur un an de chaque formule pour un rythme donné
 * (allers-retours par an, prix des billets, part des trajets du lundi au jeudi). Indicatif, 2de classe.
 *
 * - Sans carte : chaque trajet au prix habituel.
 * - Carte Avantage : −30 % ou plafond, sur tous les trajets sauf le premier aller et le dernier retour (billets croisés en chaîne).
 * - Carte Liberté : chaque trajet au moins cher du prix habituel et du prix fixe Liberté.
 * - MAX ACTIF / MAX ACTIF+ : 12 mensualités ; trajets des jours éligibles à 0 € dans la limite des réservations annuelles,
 *   les autres au prix habituel.
 */
import { estDateIso, jourSemaine } from './dates';
import { operateurEligible, prixAvecCarte, type ReglesAvantage } from './croises';
import { prixAncien, prixVuDe } from './prix';
import type { Deplacement } from './deplacements';
import type { MetaReferentiel } from './referentiel';

export interface ReglesLiberte {
  levier: string;
  nom: string;
  prixCarteCentimes: number;
  /** Prix fixe Liberté du trajet, en 2de. */
  prixFixeCentimes: number;
  meta: MetaReferentiel;
}

export interface ReglesMax {
  levier: string;
  nom: string;
  mensualiteCentimes: number;
  reservationsParAn: number;
  /** Jours (0 = lundi) où les réservations à 0 € sont possibles. */
  joursEligibles: number[];
  engagementMois: number;
  meta: MetaReferentiel & { sourcePrix: string; /** Date du relevé de la mensualité (pour l'alerte à 6 mois). */ prixReleveLe: string };
}

export interface ReglesAbonnements {
  version: string;
  liberte: ReglesLiberte;
  maxActif: ReglesMax;
  maxActifPlus: ReglesMax;
}

const invalide = (quoi: string) => new Error(`Règles des abonnements invalides : ${quoi}`);
const entier = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const texte = (v: unknown) => typeof v === 'string' && v.trim() !== '' && v.length <= 80;

function meta(v: unknown, quoi: string): MetaReferentiel {
  const m = v as Record<string, unknown> | null;
  if (!m || typeof m.source !== 'string' || !m.source.startsWith('https://') || !estDateIso(m.verifieLe)) throw invalide(`meta de ${quoi}`);
  return { source: m.source, verifieLe: m.verifieLe as string };
}

/** Les mensualités ne sont pas publiées par la SNCF : la source du prix retenu est exigée à part. */
function sourcePrix(v: unknown, quoi: string): string {
  const s = (v as Record<string, unknown> | null)?.sourcePrix;
  if (typeof s !== 'string' || !s.startsWith('https://')) throw invalide(`source du prix de ${quoi}`);
  return s;
}

function prixReleveLe(v: unknown, quoi: string): string {
  const d = (v as Record<string, unknown> | null)?.prixReleveLe;
  if (!estDateIso(d)) throw invalide(`date du relevé du prix de ${quoi}`);
  return d;
}

function formuleMax(v: unknown, quoi: string): ReglesMax {
  const r = v as Record<string, unknown> | null;
  if (!r || !texte(r.levier) || !texte(r.nom)) throw invalide(quoi);
  if (!entier(r.mensualiteCentimes, 1, 500_000) || !entier(r.reservationsParAn, 1, 2000) || !entier(r.engagementMois, 1, 60)) throw invalide(`valeurs de ${quoi}`);
  const j = r.joursEligibles;
  if (!Array.isArray(j) || !j.length || !j.every((x) => entier(x, 0, 6)) || new Set(j).size !== j.length) throw invalide(`jours de ${quoi}`);
  return {
    levier: r.levier as string,
    nom: r.nom as string,
    mensualiteCentimes: r.mensualiteCentimes as number,
    reservationsParAn: r.reservationsParAn as number,
    joursEligibles: [...(j as number[])].sort((a, b) => a - b),
    engagementMois: r.engagementMois as number,
    meta: { ...meta(r.meta, quoi), sourcePrix: sourcePrix(r.meta, quoi), prixReleveLe: prixReleveLe(r.meta, quoi) },
  };
}

export function validerAbonnements(src: unknown): ReglesAbonnements {
  const r = src as Record<string, unknown> | null;
  if (!r || !estDateIso(r.version)) throw invalide('version');
  const l = r.liberte as Record<string, unknown> | null;
  if (!l || !texte(l.levier) || !texte(l.nom) || !entier(l.prixCarteCentimes, 1, 500_000) || !entier(l.prixFixeCentimes, 1, 100_000)) throw invalide('carte Liberté');
  const maxActif = formuleMax(r.maxActif, 'MAX ACTIF');
  const maxActifPlus = formuleMax(r.maxActifPlus, 'MAX ACTIF+');
  // Le calcul sait traiter « du lundi au jeudi » ou « tous les jours » : tout autre calendrier serait mal estimé.
  for (const f of [maxActif, maxActifPlus]) if (f.joursEligibles.join() !== '0,1,2,3' && f.joursEligibles.length !== 7) throw invalide(`jours de ${f.nom} non pris en charge`);
  return {
    version: r.version as string,
    liberte: { levier: l.levier as string, nom: l.nom as string, prixCarteCentimes: l.prixCarteCentimes as number, prixFixeCentimes: l.prixFixeCentimes as number, meta: meta(l.meta, 'carte Liberté') },
    maxActif,
    maxActifPlus,
  };
}

export type IdFormule = 'sans-carte' | 'avantage' | 'liberte' | 'max-actif' | 'max-actif-plus';

export interface Rythme {
  allersRetoursParAn: number;
  /** Prix des billets sans carte, en centimes : un prix habituel, ou les prix vus et payés (non vide). */
  prixCentimes: number[];
  /** Part des trajets faits du lundi au jeudi, en % (0 à 100). */
  partLundiJeudi: number;
  /** Durée type d'un trajet, en minutes (plafonds Avantage). */
  dureeMin: number;
}

export interface CoutFormule {
  id: IdFormule;
  /** Coût sur un an : carte ou mensualités, plus billets. */
  coutCentimes: number;
  abonnementCentimes: number;
  billetsCentimes: number;
  /** Trajets réduits ou à 0 € par la formule. */
  couverts: number;
  /** Trajets payés plein pot (hors formule). */
  horsFormule: number;
  /** Engagement minimal, en mois (0 : aucun engagement au-delà de la carte annuelle). */
  engagementMois: number;
}

export interface Mensualites {
  maxActif?: number;
  maxActifPlus?: number;
}

/** Ordre de préférence à coût égal : la formule la moins engageante d'abord. */
const ORDRE: IdFormule[] = ['sans-carte', 'avantage', 'liberte', 'max-actif', 'max-actif-plus'];

const moyenne = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function validerRythme(r: Rythme): void {
  if (!entier(r.allersRetoursParAn, 0, 365)) throw new Error('Rythme invalide : allers-retours par an');
  if (!r.prixCentimes.length || !r.prixCentimes.every((p) => entier(p, 1, 100_000))) throw new Error('Rythme invalide : prix');
  if (!(r.partLundiJeudi >= 0 && r.partLundiJeudi <= 100)) throw new Error('Rythme invalide : part du lundi au jeudi');
  if (!entier(r.dureeMin, 1, 24 * 60)) throw new Error('Rythme invalide : durée');
}

/** Coût sur un an de chaque formule, du moins cher au plus cher (à coût égal, la moins engageante d'abord). */
export function comparerFormules(r: ReglesAbonnements, ra: ReglesAvantage, rythme: Rythme, m: Mensualites = {}): CoutFormule[] {
  validerRythme(rythme);
  const trajets = 2 * rythme.allersRetoursParAn;
  const prix = moyenne(rythme.prixCentimes);
  const plein = (n: number) => Math.round(n * prix);
  const formules: CoutFormule[] = [];
  formules.push({ id: 'sans-carte', coutCentimes: plein(trajets), abonnementCentimes: 0, billetsCentimes: plein(trajets), couverts: 0, horsFormule: trajets, engagementMois: 0 });

  // Carte Avantage : billets croisés en chaîne, tous les trajets couverts sauf le premier aller et le dernier retour.
  const couvertsAvantage = rythme.allersRetoursParAn >= 2 ? trajets - 2 : 0;
  const prixAvantage = moyenne(rythme.prixCentimes.map((p) => prixAvecCarte(ra, p, rythme.dureeMin)));
  const billetsAvantage = Math.round(couvertsAvantage * prixAvantage) + plein(trajets - couvertsAvantage);
  formules.push({ id: 'avantage', coutCentimes: ra.prixCarteCentimes + billetsAvantage, abonnementCentimes: ra.prixCarteCentimes, billetsCentimes: billetsAvantage, couverts: couvertsAvantage, horsFormule: trajets - couvertsAvantage, engagementMois: 0 });

  // Carte Liberté : le voyageur prend le moins cher du prix fixe et du billet ordinaire.
  const prixLiberte = moyenne(rythme.prixCentimes.map((p) => Math.min(p, r.liberte.prixFixeCentimes)));
  const billetsLiberte = Math.round(trajets * prixLiberte);
  const partChers = rythme.prixCentimes.filter((p) => p > r.liberte.prixFixeCentimes).length / rythme.prixCentimes.length;
  const couvertsLiberte = Math.round(trajets * partChers);
  formules.push({ id: 'liberte', coutCentimes: r.liberte.prixCarteCentimes + billetsLiberte, abonnementCentimes: r.liberte.prixCarteCentimes, billetsCentimes: billetsLiberte, couverts: couvertsLiberte, horsFormule: trajets - couvertsLiberte, engagementMois: 0 });

  for (const [id, f, mensualite] of [
    ['max-actif', r.maxActif, m.maxActif],
    ['max-actif-plus', r.maxActifPlus, m.maxActifPlus],
  ] as const) {
    const part = f.joursEligibles.length === 7 ? 100 : rythme.partLundiJeudi;
    const couverts = Math.min(Math.round((trajets * part) / 100), f.reservationsParAn);
    const abonnement = (mensualite ?? f.mensualiteCentimes) * 12;
    const billets = plein(trajets - couverts);
    formules.push({ id, coutCentimes: abonnement + billets, abonnementCentimes: abonnement, billetsCentimes: billets, couverts, horsFormule: trajets - couverts, engagementMois: f.engagementMois });
  }
  return formules.sort((a, b) => a.coutCentimes - b.coutCentimes || ORDRE.indexOf(a.id) - ORDRE.indexOf(b.id));
}

/** Part (en %, arrondie) des trajets datés faits du lundi au jeudi ; null s'il n'y en a aucun. */
export function partLundiJeudi(dates: string[]): number | null {
  const valides = dates.filter((d) => estDateIso(d));
  if (!valides.length) return null;
  return Math.round((100 * valides.filter((d) => jourSemaine(d) <= 3).length) / valides.length);
}

export interface Echantillon {
  /** Prix sans carte retenus, en centimes. */
  prix: number[];
  /** Prix écartés : OUIGO ou Trenitalia, où aucune de ces formules ne s'applique. */
  horsFormules: number;
  /** Prix vus il y a plus de 2 jours, écartés comme dans la comparaison des trains. */
  anciens: number;
}

/**
 * Prix réels utilisables comme « prix sans carte » : payés, ou vus récemment sur le site pour le train choisi,
 * sur TGV INOUI ou Intercités seulement. À n'utiliser que si le voyageur ne détient aucune carte ni abonnement :
 * SNCF Connect affiche alors des prix déjà réduits, qu'il ne faut pas réduire une deuxième fois.
 */
export function echantillonPrix(ra: ReglesAvantage, liste: Deplacement[], aujourdhui: string): Echantillon {
  const e: Echantillon = { prix: [], horsFormules: 0, anciens: 0 };
  for (const t of liste.flatMap((d) => [d.aller, d.retour])) {
    if (!t.train) continue;
    let prix: number | undefined;
    if (t.statut === 'paye') prix = t.prixCentimes || undefined;
    else {
      const vu = prixVuDe(t.prixVus, t.train);
      if (vu && prixAncien(vu, aujourdhui)) {
        e.anciens++;
        continue;
      }
      prix = vu?.centimes;
    }
    if (prix === undefined) continue;
    if (!operateurEligible(ra, t.train.operateur)) e.horsFormules++;
    else e.prix.push(prix);
  }
  return e;
}
