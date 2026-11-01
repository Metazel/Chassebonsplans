/**
 * Horaires théoriques Marseille Saint-Charles ↔ Paris, extraits des GTFS ouverts (SNCF, Trenitalia).
 * Fichier compact produit par scripts/extraire_horaires.py ; tout ce qui est relu est validé.
 */
import { MINUTES_PAR_JOUR, formaterHeure } from './heure';
import { dateLongue, ecartJours, estDateIso } from './dates';
import { evaluer, type ParametresCout } from './coutComplet';
import { contientNumeroCarte } from './securite';

export type Sens = 'MP' | 'PM';

export interface TrainHoraire {
  sens: Sens;
  numero: string;
  operateur: string;
  gareDepart: string;
  gareArrivee: string;
  /** Minutes depuis minuit du jour de circulation (peut dépasser 1440). */
  depart: number;
  arrivee: number;
  /** Décalages en jours depuis `debut`. */
  jours: ReadonlySet<number>;
}

export interface SourceHoraires {
  nom: string;
  url: string;
  licence: string;
}

export interface Horaires {
  debut: string;
  fin: string;
  genereLe: string;
  sources: SourceHoraires[];
  trains: TrainHoraire[];
  /** Trains écartés à la lecture car invalides. */
  ecartes: number;
}

const texte = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || !v || v.length > max || contientNumeroCarte(v)) throw new Error('Horaires invalides');
  return v;
};
const minutes = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 48 * 60) throw new Error('Horaires invalides : heure');
  return v;
};

/** Lit un train ; null si une seule de ses données est invalide (le train est alors écarté, pas tout le fichier). */
function lireTrain(t: Record<string, unknown> | null): TrainHoraire | null {
  try {
    if (!t || (t.s !== 'MP' && t.s !== 'PM')) return null;
    if (!Array.isArray(t.j) || t.j.length > 400 || !t.j.every((j) => Number.isInteger(j) && j >= 0 && j < 400)) return null;
    const depart = minutes(t.d);
    const arrivee = minutes(t.a);
    if (arrivee <= depart) return null;
    return {
      sens: t.s,
      numero: texte(t.n, 12),
      operateur: texte(t.o, 40),
      gareDepart: texte(t.gd, 80),
      gareArrivee: texte(t.ga, 80),
      depart,
      arrivee,
      jours: new Set(t.j as number[]),
    };
  } catch {
    return null;
  }
}

/**
 * Valide le fichier publié. Une structure invalide (version, dates, sources) rejette le fichier ;
 * un train invalide est seulement écarté et compté dans `ecartes`.
 */
export function validerHoraires(src: unknown): Horaires {
  const r = src as Record<string, unknown> | null;
  if (!r || r.version !== 1) throw new Error('Horaires invalides : version');
  for (const cle of ['debut', 'fin', 'genereLe'] as const) {
    if (!estDateIso(r[cle])) throw new Error(`Horaires invalides : ${cle}`);
  }
  if (!Array.isArray(r.sources) || !Array.isArray(r.trains) || r.trains.length > 5000) throw new Error('Horaires invalides');
  if ((r.fin as string) < (r.debut as string)) throw new Error('Horaires invalides : période');
  const lus = r.trains.map((t) => lireTrain(t as Record<string, unknown> | null));
  const trains = lus.filter((t): t is TrainHoraire => t !== null);
  const sources = r.sources.map((s: Record<string, unknown>) => {
    const url = texte(s.url, 200);
    if (!url.startsWith('https://')) throw new Error('Horaires invalides : source');
    return { nom: texte(s.nom, 120), url, licence: texte(s.licence, 40) };
  });
  return { debut: r.debut as string, fin: r.fin as string, genereLe: r.genereLe as string, sources, trains, ecartes: lus.length - trains.length };
}

export function couvre(h: Horaires, date: string): boolean {
  return date >= h.debut && date <= h.fin;
}

/** Âge des horaires publiés, en jours ; au-delà de 14 jours l'appli le signale (publication hebdomadaire). */
export const AGE_MAX_HORAIRES = 14;
export const ageHoraires = (h: Horaires, aujourdhui: string) => ecartJours(h.genereLe, aujourdhui);

/** Trains circulant ce jour-là dans ce sens, triés par heure de départ. */
export function trainsDuJour(h: Horaires, date: string, sens: Sens): TrainHoraire[] {
  const k = ecartJours(h.debut, date);
  return h.trains.filter((t) => t.sens === sens && t.jours.has(k)).sort((a, b) => a.depart - b.depart || a.arrivee - b.arrivee);
}

export interface Creneau {
  /** Sur quoi porte le créneau : l'heure d'arrivée (aller) ou l'heure de départ (retour). */
  porte: 'arrivee' | 'depart';
  de: number;
  a: number;
}

/** Créneaux de David (cadrage v2) : aller arrivée 9h00-9h40, retour départ 17h30-20h00. */
export const CRENEAUX: Record<Sens, Creneau> = {
  MP: { porte: 'arrivee', de: 9 * 60, a: 9 * 60 + 40 },
  PM: { porte: 'depart', de: 17 * 60 + 30, a: 20 * 60 },
};

export interface Propositions {
  dansCreneau: TrainHoraire[];
  /** Si rien dans le créneau : jusqu'à 2 trains les plus proches de chaque côté. */
  proches: TrainHoraire[];
}

export function proposer(h: Horaires, date: string, sens: Sens, creneau: Creneau = CRENEAUX[sens]): Propositions {
  // Trains du jour même seulement : un train de nuit (arrivée le lendemain) ne répond à aucun créneau de la journée.
  const jour = trainsDuJour(h, date, sens).filter((t) => t.depart < MINUTES_PAR_JOUR && (creneau.porte === 'depart' || t.arrivee < MINUTES_PAR_JOUR));
  const cle = (t: TrainHoraire) => (creneau.porte === 'arrivee' ? t.arrivee : t.depart);
  const dansCreneau = jour.filter((t) => cle(t) >= creneau.de && cle(t) <= creneau.a);
  if (dansCreneau.length) return { dansCreneau, proches: [] };
  const avant = jour.filter((t) => cle(t) < creneau.de).sort((a, b) => cle(b) - cle(a)).slice(0, 2).reverse();
  const apres = jour.filter((t) => cle(t) > creneau.a).sort((a, b) => cle(a) - cle(b)).slice(0, 2);
  return { dansCreneau: [], proches: [...avant, ...apres] };
}

/** Gares par défaut d'un sens, quand le train choisi n'est plus dans les horaires publiés. */
export const GARES: Record<Sens, { depart: string; arrivee: string }> = {
  MP: { depart: 'Marseille Saint-Charles', arrivee: 'Paris Gare de Lyon' },
  PM: { depart: 'Paris Gare de Lyon', arrivee: 'Marseille Saint-Charles' },
};

/** Le retour par ce train oblige-t-il à dîner à bord ? Même règle que le coût complet (CLAUDE.md). */
export function repasABord(t: Pick<TrainHoraire, 'depart' | 'arrivee'>, p: ParametresCout): boolean {
  const e = evaluer({ id: '', depart: t.depart % 1440, arrivee: t.arrivee % 1440, prixCentimes: 0 }, p);
  return e.repasCentimes > 0;
}

export const arriveeDomicile = (t: Pick<TrainHoraire, 'arrivee'>, p: ParametresCout) => t.arrivee + p.trajetGareDomicileMin;

/** Identifiant stable d'un train pour un jour donné (sens, numéro, opérateur, horaires). */
export const cleTrain = (t: Pick<TrainHoraire, 'sens' | 'numero' | 'operateur' | 'depart' | 'arrivee'>) =>
  `${t.sens}|${t.numero}|${t.operateur}|${t.depart}|${t.arrivee}`;

export type CanalVente = { nom: string; url: string } | null;

/** Site de vente autorisé par opérateur ; OUIGO : pas de lien (CGU), seulement le numéro et l'horaire. */
export function canalVente(operateur: string): CanalVente {
  const o = operateur.toLowerCase();
  if (o.includes('ouigo')) return null;
  if (o.includes('trenitalia')) return { nom: 'Trenitalia', url: 'https://www.trenitalia.fr/' };
  return { nom: 'SNCF Connect', url: 'https://www.sncf-connect.com/' };
}

/** Nom de gare lisible dans un moteur de recherche (« Marseille-St-Charles » → « Marseille Saint Charles »). */
export const villeGare = (g: string) => g.replace(/\s+Hall.*$/i, '').replace(/-/g, ' ').replace(/\bSt\b/gi, 'Saint').replace(/\s+/g, ' ').trim();

/** Texte prêt à coller dans la recherche d'un site de vente (langage naturel + numéro de train). */
export function texteRecherche(t: Pick<TrainHoraire, 'gareDepart' | 'gareArrivee' | 'depart' | 'numero'>, date: string): string {
  return `${villeGare(t.gareDepart)} → ${villeGare(t.gareArrivee)}, ${dateLongue(date)}, départ ${formaterHeure(t.depart)}, train ${t.numero}`;
}
