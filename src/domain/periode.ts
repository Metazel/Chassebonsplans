/**
 * Préparer une période (CU2) : une semaine type (jour d'aller, jour de retour), une période et des congés
 * donnent la liste des semaines à prévoir. Les jours fériés et les congés écartent une semaine par défaut ;
 * les semaines où un déplacement existe déjà ne sont pas proposées.
 */
import { ajouterJours, ecartJours, estDateIso, jourSemaine } from './dates';
import { couvert, ferie, type Feries } from './feries';
import { DUREE_MAX_JOURS, type Deplacement } from './deplacements';

export interface Conges {
  du: string;
  au: string;
}

export interface ModelePeriode {
  du: string;
  au: string;
  /** Jour de l'aller (0 = lundi). */
  jourAller: number;
  /** Jour du retour (0 = lundi), le même jour ou après l'aller. */
  jourRetour: number;
  conges: Conges[];
}

export type StatutSemaine = 'propose' | 'ferie' | 'conges' | 'existe';

export interface SemainePeriode {
  /** Lundi de la semaine. */
  lundi: string;
  aller: string;
  retour: string;
  statut: StatutSemaine;
  /** Jour férié ou congés en cause. */
  motif?: string;
  /** Les jours fériés ne sont pas connus pour cette date (hors des années couvertes). */
  ferieInconnu?: boolean;
}

/** Période de 54 semaines au plus (une ouverture des ventes couvre environ 6 mois). */
export const SEMAINES_MAX = 54;

export function verifierModele(m: ModelePeriode): string | null {
  if (!estDateIso(m.du)) return 'Indiquez le début de la période.';
  if (!estDateIso(m.au)) return 'Indiquez la fin de la période.';
  if (m.au < m.du) return 'La fin de la période doit suivre son début.';
  if (ecartJours(m.du, m.au) > SEMAINES_MAX * 7) return `Une période dure ${SEMAINES_MAX} semaines au plus.`;
  if (!Number.isInteger(m.jourAller) || !Number.isInteger(m.jourRetour) || m.jourAller < 0 || m.jourRetour > 6 || m.jourRetour < m.jourAller)
    return 'Le retour doit être le même jour que l’aller ou après, dans la même semaine.';
  for (const c of m.conges) {
    if (!estDateIso(c.du) || !estDateIso(c.au)) return 'Indiquez les deux dates de chaque période de congés.';
    if (c.au < c.du) return 'La fin des congés doit suivre leur début.';
  }
  return null;
}

const lundiDe = (date: string) => ajouterJours(date, -jourSemaine(date));
const dansConges = (date: string, conges: Conges[]) => conges.find((c) => date >= c.du && date <= c.au);

/** Statut d'un aller-retour (dates choisies) dans une semaine : utilisé à la génération et quand le voyageur change l'aller. */
export function statutDates(aller: string, retour: string, conges: Conges[], f: Feries): Pick<SemainePeriode, 'statut' | 'motif' | 'ferieInconnu'> {
  const fer = [aller, retour].map((d) => ferie(f, d)).find(Boolean);
  const inconnu = ![aller, retour].every((d) => couvert(f, d));
  if (fer) return { statut: 'ferie', motif: fer, ...(inconnu ? { ferieInconnu: true } : {}) };
  const c = [aller, retour].map((d) => dansConges(d, conges)).find(Boolean);
  if (c) return { statut: 'conges', motif: `congés du ${c.du} au ${c.au}`, ...(inconnu ? { ferieInconnu: true } : {}) };
  return { statut: 'propose', ...(inconnu ? { ferieInconnu: true } : {}) };
}

/** Semaines de la période dont l'aller tombe entre `du` et `au` et le retour au plus tard le `au`. */
export function semainesPeriode(m: ModelePeriode, f: Feries, existants: Deplacement[]): SemainePeriode[] {
  const erreur = verifierModele(m);
  if (erreur) throw new Error(erreur);
  // Semaines déjà occupées : un trajet existant y tombe.
  const occupees = new Set(existants.flatMap((d) => [lundiDe(d.aller.date), lundiDe(d.retour.date)]));
  const semaines: SemainePeriode[] = [];
  for (let lundi = lundiDe(m.du); lundi <= m.au; lundi = ajouterJours(lundi, 7)) {
    const aller = ajouterJours(lundi, m.jourAller);
    const retour = ajouterJours(lundi, m.jourRetour);
    if (aller < m.du || retour > m.au) continue;
    if (occupees.has(lundi)) {
      semaines.push({ lundi, aller, retour, statut: 'existe' });
      continue;
    }
    semaines.push({ lundi, aller, retour, ...statutDates(aller, retour, m.conges, f) });
  }
  return semaines;
}

/** Jours d'aller possibles dans la semaine d'un retour donné (du lundi au jour du retour). */
export const joursAllerPossibles = (s: Pick<SemainePeriode, 'lundi' | 'retour'>) => {
  const jours: string[] = [];
  for (let d = s.lundi; d <= s.retour; d = ajouterJours(d, 1)) jours.push(d);
  return jours.filter((d) => ecartJours(d, s.retour) <= DUREE_MAX_JOURS);
};
