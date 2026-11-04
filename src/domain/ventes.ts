/**
 * Ouverture des ventes (CU-E) : un trajet est-il déjà en vente, et sinon quand le sera-t-il ?
 * Calcul local à partir d'un calendrier versionné (aucune requête, EXG-01).
 */
import { estDateIso } from './dates';
import { lireHeure } from './heure';
import type { MetaReferentiel } from './referentiel';
import type { Deplacement } from './deplacements';

export interface Ouverture {
  /** Jour d'ouverture des ventes. */
  le: string;
  /** Heure indicative de mise en ligne, en minutes (facultative). */
  heure?: number;
  /** Période de circulation ouverte ce jour-là. */
  du: string;
  au: string;
}

export interface CalendrierOperateur {
  id: string;
  nom: string;
  /** Fragments (en minuscules) qui identifient l'opérateur dans le nom affiché d'un train. */
  reconnu: string[];
  /** Dernier jour de circulation déjà en vente à la date de vérification. */
  enVenteJusquau: string;
  ouvertures: Ouverture[];
  source: string;
}

export interface ReferentielOuvertures {
  operateurs: CalendrierOperateur[];
  meta: MetaReferentiel;
}

const erreur = (quoi: string) => new Error(`Calendrier des ventes invalide : ${quoi}`);

export function validerOuvertures(src: unknown): ReferentielOuvertures {
  const r = src as Record<string, unknown> | null;
  const meta = r?.meta as Record<string, unknown> | undefined;
  if (!r || !meta || typeof meta.source !== 'string' || !estDateIso(meta.verifieLe)) throw erreur('meta');
  if (!Array.isArray(r.operateurs) || !r.operateurs.length) throw erreur('opérateurs');
  const ids = new Set<string>();
  const operateurs = r.operateurs.map((brutOp: unknown): CalendrierOperateur => {
    if (typeof brutOp !== 'object' || brutOp === null) throw erreur('opérateur');
    const o = brutOp as Record<string, unknown>;
    if (typeof o.id === 'string' && ids.has(o.id)) throw erreur(`${o.id} en double`);
    if (typeof o.id === 'string') ids.add(o.id);
    if (typeof o.id !== 'string' || typeof o.nom !== 'string' || typeof o.source !== 'string' || !o.source.startsWith('https://')) throw erreur('opérateur');
    if (!Array.isArray(o.reconnu) || !o.reconnu.length || !o.reconnu.every((x) => typeof x === 'string' && x === x.toLowerCase() && x.length > 0)) throw erreur(`${o.id} reconnu`);
    if (!estDateIso(o.enVenteJusquau)) throw erreur(`${o.id} enVenteJusquau`);
    if (!Array.isArray(o.ouvertures)) throw erreur(`${o.id} ouvertures`);
    const ouvertures = o.ouvertures.map((brutW: unknown): Ouverture => {
      if (typeof brutW !== 'object' || brutW === null) throw erreur(`${o.id} ouverture`);
      const w = brutW as Record<string, unknown>;
      if (!estDateIso(w.le) || !estDateIso(w.du) || !estDateIso(w.au) || w.au < w.du || w.le > w.du) throw erreur(`${o.id} ouverture`);
      const ouverture: Ouverture = { le: w.le, du: w.du, au: w.au };
      if (w.heure !== undefined) {
        const h = typeof w.heure === 'string' ? lireHeure(w.heure) : null;
        if (h === null) throw erreur(`${o.id} heure`);
        ouverture.heure = h;
      }
      return ouverture;
    });
    return { id: o.id, nom: o.nom, reconnu: o.reconnu as string[], enVenteJusquau: o.enVenteJusquau, ouvertures, source: o.source };
  });
  return { operateurs, meta: { source: meta.source, verifieLe: meta.verifieLe as string } };
}

/** Calendrier de l'opérateur d'un train, d'après son nom affiché (« TGV INOUI », « Trenitalia (Frecciarossa) »…). */
export function calendrierDe(ref: ReferentielOuvertures, operateur: string): CalendrierOperateur | null {
  const o = operateur.toLowerCase();
  // Le fragment reconnu le plus long l'emporte : « ouigo » plutôt que « tgv » pour un nom qui contiendrait les deux.
  let meilleur: CalendrierOperateur | null = null;
  let longueur = 0;
  for (const c of ref.operateurs) {
    for (const x of c.reconnu) {
      if (o.includes(x) && x.length > longueur) {
        meilleur = c;
        longueur = x.length;
      }
    }
  }
  return meilleur;
}

export type EtatVente =
  | { etat: 'en-vente' }
  /** Opérateur absent du calendrier (TER…) : l'outil ne sait pas, il ne bloque rien. */
  | { etat: 'non-suivi' }
  | { etat: 'ouverture'; operateur: CalendrierOperateur; le: string; heure?: number }
  | { etat: 'inconnu'; operateur: CalendrierOperateur };

/**
 * Le trajet de cette date est-il en vente ? Le jour de l'ouverture, il l'est à partir de l'heure indicative
 * (`maintenant` : minutes écoulées depuis minuit, heure de Paris ; sans elle, dès le matin).
 * Au-delà de ce que le calendrier connaît : « inconnu » (on ne devine pas).
 */
export function etatVente(ref: ReferentielOuvertures, operateur: string, date: string, aujourdhui: string, maintenant?: number): EtatVente {
  const c = calendrierDe(ref, operateur);
  if (!c) return { etat: 'non-suivi' };
  if (date <= c.enVenteJusquau) return { etat: 'en-vente' };
  const fenetre = c.ouvertures.filter((w) => date >= w.du && date <= w.au).sort((a, b) => a.le.localeCompare(b.le))[0];
  if (!fenetre) return { etat: 'inconnu', operateur: c };
  const ouvert = fenetre.le < aujourdhui || (fenetre.le === aujourdhui && (fenetre.heure === undefined || maintenant === undefined || maintenant >= fenetre.heure));
  if (ouvert) return { etat: 'en-vente' };
  return fenetre.heure !== undefined ? { etat: 'ouverture', operateur: c, le: fenetre.le, heure: fenetre.heure } : { etat: 'ouverture', operateur: c, le: fenetre.le };
}

export interface OuvertureAttendue {
  operateur: CalendrierOperateur;
  le: string;
  heure?: number;
  /** Trajets à réserver (avec train choisi) qui attendent cette ouverture. */
  trajets: { deplacement: Deplacement; cote: 'aller' | 'retour' }[];
}

/** Ouvertures à venir qui concernent des trajets à réserver, de la plus proche à la plus lointaine. */
export function ouverturesAttendues(ref: ReferentielOuvertures, liste: Deplacement[], aujourdhui: string, maintenant?: number): OuvertureAttendue[] {
  const parCle = new Map<string, OuvertureAttendue>();
  for (const d of liste) {
    for (const cote of ['aller', 'retour'] as const) {
      const t = d[cote];
      if (!t.train || t.statut !== 'a-reserver' || t.date < aujourdhui) continue;
      const e = etatVente(ref, t.train.operateur, t.date, aujourdhui, maintenant);
      if (e.etat !== 'ouverture') continue;
      const cle = `${e.operateur.id}|${e.le}`;
      const o = parCle.get(cle) ?? (e.heure !== undefined ? { operateur: e.operateur, le: e.le, heure: e.heure, trajets: [] } : { operateur: e.operateur, le: e.le, trajets: [] });
      o.trajets.push({ deplacement: d, cote });
      parCle.set(cle, o);
    }
  }
  return [...parCle.values()].sort((a, b) => a.le.localeCompare(b.le) || a.operateur.nom.localeCompare(b.operateur.nom));
}

/** Minutes écoulées depuis minuit, heure de Paris. */
export function minutesParis(maintenant = new Date()): number {
  const [h, m] = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(maintenant)
    .split(':')
    .map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
