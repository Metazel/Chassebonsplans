/**
 * Profil de l'utilisateur, stocké uniquement sur l'appareil (EXG-01).
 * Minimisation (EXG-02) : on enregistre quels leviers sont détenus et leur fin de validité,
 * jamais un numéro, un nom ou un identifiant. Tout ce qui est relu (stockage ou import) est validé.
 */
import type { Reglages } from './saisie';
import { contientNumeroCarte } from './securite';

export const VERSION_PROFIL = 1;
export const FORMAT_EXPORT = 'chassebonsplans-export';

export interface EtatLevier {
  detenu: boolean;
  /** Date ISO AAAA-MM-JJ de fin de validité (cartes annuelles), facultative. */
  finValidite?: string;
}

export interface Profil {
  version: typeof VERSION_PROFIL;
  leviers: Record<string, EtatLevier>;
  reglages?: Reglages;
  /** Date ISO de la dernière sauvegarde exportée. */
  derniereSauvegarde?: string;
}

export const profilVide = (): Profil => ({ version: VERSION_PROFIL, leviers: {} });

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function estDateIso(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = ISO.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Longueur maximale d'un champ de réglage (assez court pour qu'aucun numéro de carte n'y tienne). */
export const LONGUEUR_REGLAGE = 10;

/** Un réglage est stockable s'il est court et ne contient pas de numéro de carte (EXG-02). */
export function reglageStockable(v: unknown): v is string {
  return typeof v === 'string' && v.length <= LONGUEUR_REGLAGE && !contientNumeroCarte(v);
}

export function reglagesStockables(g: unknown): g is Reglages {
  const r = g as Record<string, unknown> | null;
  return !!r && reglageStockable(r.trajet) && reglageStockable(r.limite) && reglageStockable(r.repas) && reglageStockable(r.tolerance);
}

export interface Lecture {
  profil: Profil;
  /** Parties écartées à la relecture (le reste du profil est conservé). */
  ecartes: string[];
}

/**
 * Valide un profil relu, champ par champ : une partie invalide est écartée et signalée,
 * sans faire perdre le reste. Seul un profil inexploitable (pas un objet, version inconnue) est refusé.
 * Les leviers inconnus du catalogue sont ignorés (catalogue qui évolue) ; les leviers non détenus ne sont pas gardés.
 */
export function lireProfil(src: unknown, idsConnus: ReadonlySet<string>): Lecture {
  if (typeof src !== 'object' || src === null || Array.isArray(src)) throw new Error('Profil invalide');
  const r = src as Record<string, unknown>;
  if (r.version !== VERSION_PROFIL) throw new Error('Version de profil non prise en charge');
  const ecartes: string[] = [];
  const leviers: Record<string, EtatLevier> = {};
  const brutLeviers = typeof r.leviers === 'object' && r.leviers !== null && !Array.isArray(r.leviers) ? (r.leviers as Record<string, unknown>) : null;
  if (!brutLeviers) ecartes.push('leviers');
  for (const [id, etat] of Object.entries(brutLeviers ?? {})) {
    if (!idsConnus.has(id)) {
      ecartes.push(`levier inconnu ${id.slice(0, 40)}`);
      continue;
    }
    const e = etat as Record<string, unknown> | null;
    if (!e || typeof e.detenu !== 'boolean' || (e.finValidite !== undefined && !estDateIso(e.finValidite))) {
      ecartes.push(`levier ${id}`);
      continue;
    }
    if (!e.detenu) continue;
    leviers[id] = e.finValidite !== undefined ? { detenu: true, finValidite: e.finValidite as string } : { detenu: true };
  }
  const profil: Profil = { version: VERSION_PROFIL, leviers };
  if (r.reglages !== undefined) {
    if (reglagesStockables(r.reglages)) {
      const g = r.reglages;
      profil.reglages = { trajet: g.trajet, limite: g.limite, repas: g.repas, tolerance: g.tolerance };
    } else ecartes.push('réglages');
  }
  if (r.derniereSauvegarde !== undefined) {
    if (estDateIso(r.derniereSauvegarde)) profil.derniereSauvegarde = r.derniereSauvegarde;
    else ecartes.push('date de dernière sauvegarde');
  }
  return { profil, ecartes };
}

/** Variante stricte pour les tests et l'import : le profil lu, sans le détail des parties écartées. */
export function validerProfil(src: unknown, idsConnus: ReadonlySet<string>): Profil {
  return lireProfil(src, idsConnus).profil;
}

/** Ce qui est réellement écrit ou exporté : uniquement des données valides et utiles (EXG-02). */
export function pourStockage(p: Profil): Profil {
  const leviers: Record<string, EtatLevier> = {};
  for (const [id, e] of Object.entries(p.leviers)) {
    if (!e.detenu) continue;
    leviers[id] = e.finValidite && estDateIso(e.finValidite) ? { detenu: true, finValidite: e.finValidite } : { detenu: true };
  }
  const propre: Profil = { version: VERSION_PROFIL, leviers };
  if (p.reglages && reglagesStockables(p.reglages)) propre.reglages = { ...p.reglages };
  if (p.derniereSauvegarde && estDateIso(p.derniereSauvegarde)) propre.derniereSauvegarde = p.derniereSauvegarde;
  return propre;
}

export function aDesDonnees(p: Profil): boolean {
  return Object.values(p.leviers).some((l) => l.detenu) || p.reglages !== undefined;
}

/** Contenu du fichier de sauvegarde (EXG-04). */
export function exporter(p: Profil, aujourdhui: string): string {
  const { derniereSauvegarde: _date, ...donnees } = pourStockage(p);
  void _date;
  return JSON.stringify({ format: FORMAT_EXPORT, exporteLe: aujourdhui, profil: donnees }, null, 2);
}

/** Relit un fichier de sauvegarde ; lève une erreur lisible si le fichier n'est pas valide. */
export const TAILLE_MAX_IMPORT = 100_000;

export function importer(texte: string, idsConnus: ReadonlySet<string>): Lecture {
  if (texte.length > TAILLE_MAX_IMPORT) throw new Error('Fichier trop volumineux pour une sauvegarde.');
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    throw new Error('Ce fichier n’est pas une sauvegarde lisible (JSON invalide).');
  }
  const r = brut as Record<string, unknown> | null;
  if (!r || r.format !== FORMAT_EXPORT) throw new Error('Ce fichier n’est pas une sauvegarde de Chasse aux bons plans.');
  try {
    return lireProfil(r.profil, idsConnus);
  } catch {
    throw new Error('Cette sauvegarde est illisible ou provient d’une version non prise en charge.');
  }
}

const JOUR = 86_400_000;
const versDate = (iso: string) => {
  const [a, m, j] = iso.split('-').map(Number);
  return Date.UTC(a!, m! - 1, j!);
};

export type EtatValidite = 'expire' | 'bientot' | 'valide';

/** Fin de validité : expirée, dans les 30 jours, ou valide. */
export function etatValidite(finValidite: string, aujourdhui: string): EtatValidite {
  const ecart = (versDate(finValidite) - versDate(aujourdhui)) / JOUR;
  if (ecart < 0) return 'expire';
  if (ecart <= 30) return 'bientot';
  return 'valide';
}

/** Rappel de sauvegarde : des données existent et aucune sauvegarde depuis 30 jours. */
export function rappelSauvegarde(p: Profil, aujourdhui: string): boolean {
  if (!aDesDonnees(p)) return false;
  if (!p.derniereSauvegarde) return true;
  return (versDate(aujourdhui) - versDate(p.derniereSauvegarde)) / JOUR > 30;
}

/** Date du jour au format ISO, en heure de Paris. */
export function aujourdhuiIso(maintenant = new Date()): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(maintenant);
}
