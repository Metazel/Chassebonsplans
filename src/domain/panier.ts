/**
 * Liste « Réserver mes trains » : trajets à mettre au panier ou déjà au panier, regroupés par site de vente
 * puis par déplacement (un aller-retour se cherche en une fois). Aucune automatisation du site (EXG-08).
 */
import { canalVente, type CanalVente } from './horaires';
import type { Deplacement } from './deplacements';
import { etatVente, type ReferentielOuvertures } from './ventes';

export interface ElementPanier {
  id: string;
  cote: 'aller' | 'retour';
}

export interface GroupePanier {
  site: NonNullable<CanalVente>;
  deplacements: { deplacement: Deplacement; cotes: ('aller' | 'retour')[] }[];
}

const ORDRE_SITES = ['SNCF Connect', 'Trenitalia'];

/**
 * Trajets proposés : train choisi, à venir (un train du jour déjà parti est exclu), et soit déjà au panier,
 * soit à réserver et pas en attente d'une ouverture de ventes connue.
 */
export function listePanier(liste: Deplacement[], aujourdhui: string, maintenant: number, ref: ReferentielOuvertures): GroupePanier[] {
  const groupes = new Map<string, GroupePanier>();
  const tries = [...liste].sort((a, b) => a.aller.date.localeCompare(b.aller.date) || a.id.localeCompare(b.id));
  for (const d of tries) {
    for (const cote of ['aller', 'retour'] as const) {
      const t = d[cote];
      if (!t.train || t.date < aujourdhui || (t.date === aujourdhui && t.train.depart <= maintenant)) continue;
      if (t.statut !== 'panier' && t.statut !== 'a-reserver') continue;
      if (t.statut === 'a-reserver' && etatVente(ref, t.train.operateur, t.date, aujourdhui, maintenant).etat === 'ouverture') continue;
      const site = canalVente(t.train.operateur);
      const g = groupes.get(site.nom) ?? { site, deplacements: [] };
      const dernier = g.deplacements[g.deplacements.length - 1];
      if (dernier && dernier.deplacement.id === d.id) dernier.cotes.push(cote);
      else g.deplacements.push({ deplacement: d, cotes: [cote] });
      groupes.set(site.nom, g);
    }
  }
  const rang = (n: string) => (ORDRE_SITES.indexOf(n) < 0 ? ORDRE_SITES.length : ORDRE_SITES.indexOf(n));
  return [...groupes.values()].sort((a, b) => rang(a.site.nom) - rang(b.site.nom));
}

/** Trajets au panier, pas encore payés ni en option. */
export function dansLePanier(liste: Deplacement[]): ElementPanier[] {
  return liste.flatMap((d) => (['aller', 'retour'] as const).filter((c) => d[c].statut === 'panier').map((cote) => ({ id: d.id, cote })));
}
