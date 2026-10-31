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

function champReglage(v: unknown): string {
  if (typeof v !== 'string' || v.length > 10 || contientNumeroCarte(v)) throw new Error('Réglages invalides');
  return v;
}

/** Valide un profil relu. Les leviers inconnus du catalogue sont ignorés (catalogue qui évolue). */
export function validerProfil(src: unknown, idsConnus: ReadonlySet<string>): Profil {
  if (typeof src !== 'object' || src === null) throw new Error('Profil invalide');
  const r = src as Record<string, unknown>;
  if (r.version !== VERSION_PROFIL) throw new Error('Version de profil non prise en charge');
  if (typeof r.leviers !== 'object' || r.leviers === null || Array.isArray(r.leviers)) throw new Error('Profil invalide : leviers');
  const leviers: Record<string, EtatLevier> = {};
  for (const [id, etat] of Object.entries(r.leviers as Record<string, unknown>)) {
    if (!idsConnus.has(id)) continue;
    const e = etat as Record<string, unknown> | null;
    if (!e || typeof e.detenu !== 'boolean') throw new Error(`Profil invalide : levier ${id}`);
    if (e.finValidite !== undefined && !estDateIso(e.finValidite)) throw new Error(`Profil invalide : fin de validité de ${id}`);
    leviers[id] = e.finValidite !== undefined ? { detenu: e.detenu, finValidite: e.finValidite } : { detenu: e.detenu };
  }
  const profil: Profil = { version: VERSION_PROFIL, leviers };
  if (r.reglages !== undefined) {
    const g = r.reglages as Record<string, unknown> | null;
    if (!g) throw new Error('Réglages invalides');
    profil.reglages = { trajet: champReglage(g.trajet), limite: champReglage(g.limite), repas: champReglage(g.repas), tolerance: champReglage(g.tolerance) };
  }
  if (r.derniereSauvegarde !== undefined) {
    if (!estDateIso(r.derniereSauvegarde)) throw new Error('Profil invalide : dernière sauvegarde');
    profil.derniereSauvegarde = r.derniereSauvegarde;
  }
  return profil;
}

export function aDesDonnees(p: Profil): boolean {
  return Object.values(p.leviers).some((l) => l.detenu) || p.reglages !== undefined;
}

/** Contenu du fichier de sauvegarde (EXG-04). */
export function exporter(p: Profil, aujourdhui: string): string {
  const donnees: Profil = { version: p.version, leviers: p.leviers };
  if (p.reglages) donnees.reglages = p.reglages;
  return JSON.stringify({ format: FORMAT_EXPORT, exporteLe: aujourdhui, profil: donnees }, null, 2);
}

/** Relit un fichier de sauvegarde ; lève une erreur lisible si le fichier n'est pas valide. */
export function importer(texte: string, idsConnus: ReadonlySet<string>): Profil {
  if (texte.length > 100_000) throw new Error('Fichier trop volumineux pour une sauvegarde.');
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    throw new Error('Ce fichier n’est pas une sauvegarde lisible (JSON invalide).');
  }
  const r = brut as Record<string, unknown> | null;
  if (!r || r.format !== FORMAT_EXPORT) throw new Error('Ce fichier n’est pas une sauvegarde de Chasse aux bons plans.');
  return validerProfil(r.profil, idsConnus);
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
