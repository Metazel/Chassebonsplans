/** Catalogue des leviers (EXG-10) : chaque levier porte sa source et sa date de vérification. */
import brut from './leviers.json';

export type Categorie = 'train' | 'assurance' | 'route' | 'partenaires';

export interface Levier {
  id: string;
  nom: string;
  categorie: Categorie;
  prix: string;
  effet: string;
  conditions: string[];
  /** Vrai si le levier se renouvelle chaque année (une date de fin de validité a du sens). */
  validiteAnnuelle: boolean;
  source: string;
  verifieLe: string;
}

const CATEGORIES: readonly Categorie[] = ['train', 'assurance', 'route', 'partenaires'];
const ID = /^[a-z0-9-]{1,40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function texte(v: unknown, nom: string, max = 400): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) throw new Error(`Catalogue des leviers invalide : ${nom}`);
  return v;
}

export function validerCatalogue(src: unknown): Levier[] {
  const r = src as { version?: unknown; leviers?: unknown } | null;
  if (!r || typeof r.version !== 'string' || !ISO.test(r.version) || !Array.isArray(r.leviers)) {
    throw new Error('Catalogue des leviers invalide');
  }
  const vus = new Set<string>();
  return r.leviers.map((l: Record<string, unknown>, i) => {
    const id = texte(l.id, `id ${i}`, 40);
    if (!ID.test(id) || vus.has(id)) throw new Error(`Catalogue des leviers invalide : id ${id}`);
    vus.add(id);
    if (!CATEGORIES.includes(l.categorie as Categorie)) throw new Error(`Catalogue des leviers invalide : catégorie de ${id}`);
    if (!Array.isArray(l.conditions)) throw new Error(`Catalogue des leviers invalide : conditions de ${id}`);
    const source = texte(l.source, `source de ${id}`);
    if (!source.startsWith('https://')) throw new Error(`Catalogue des leviers invalide : source de ${id}`);
    const verifieLe = texte(l.verifieLe, `verifieLe de ${id}`, 10);
    if (!ISO.test(verifieLe)) throw new Error(`Catalogue des leviers invalide : verifieLe de ${id}`);
    if (typeof l.validiteAnnuelle !== 'boolean') throw new Error(`Catalogue des leviers invalide : validiteAnnuelle de ${id}`);
    return {
      id,
      nom: texte(l.nom, `nom de ${id}`, 80),
      categorie: l.categorie as Categorie,
      prix: texte(l.prix, `prix de ${id}`, 80),
      effet: texte(l.effet, `effet de ${id}`),
      conditions: l.conditions.map((c, j) => texte(c, `condition ${j} de ${id}`)),
      validiteAnnuelle: l.validiteAnnuelle,
      source,
      verifieLe,
    };
  });
}

export const LEVIERS: Levier[] = validerCatalogue(brut);

export const LIBELLES_CATEGORIES: Record<Categorie, string> = {
  train: 'Train',
  assurance: 'Assurance',
  route: 'Route et stationnement',
  partenaires: 'Offres partenaires',
};
