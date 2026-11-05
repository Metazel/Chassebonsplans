/**
 * Liste « Réserver mes trains » : trajets à mettre au panier ou déjà au panier, regroupés par site de vente,
 * puis par recherche à faire (un aller-retour se cherche en une fois). Avec la carte Avantage, les trajets
 * SNCF Connect suivent le plan en billets croisés. Aucune automatisation du site (EXG-08).
 */
import { canalVente, type CanalVente } from './horaires';
import type { Deplacement } from './deplacements';
import { etatVente, type ReferentielOuvertures } from './ventes';
import type { PlanAvantage } from './croises';

export interface ElementPanier {
  id: string;
  cote: 'aller' | 'retour';
}

export interface Lot {
  /** deplacement : trajets d'un même déplacement ; carte : aller-retour du plan Avantage (croisé ou non). */
  type: 'deplacement' | 'carte';
  croise: boolean;
  origine?: 'Marseille' | 'Paris';
  elements: { deplacement: Deplacement; cote: 'aller' | 'retour' }[];
}

export interface GroupePanier {
  site: NonNullable<CanalVente>;
  lots: Lot[];
}

const ORDRE_SITES = ['SNCF Connect', 'Trenitalia'];
const cle = (id: string, cote: string) => `${id}|${cote}`;

/**
 * Trajets proposés : train choisi, à venir (un train du jour déjà parti est exclu), et soit déjà au panier,
 * soit à réserver et pas en attente d'une ouverture de ventes connue.
 */
export function listePanier(liste: Deplacement[], aujourdhui: string, maintenant: number, ref: ReferentielOuvertures, plan?: PlanAvantage): GroupePanier[] {
  const parId = new Map(liste.map((d) => [d.id, d]));
  const candidats = new Map<string, NonNullable<CanalVente>>();
  const tries = [...liste].sort((a, b) => a.aller.date.localeCompare(b.aller.date) || a.id.localeCompare(b.id));
  for (const d of tries) {
    for (const cote of ['aller', 'retour'] as const) {
      const t = d[cote];
      if (!t.train || t.date < aujourdhui || (t.date === aujourdhui && t.train.depart <= maintenant)) continue;
      if (t.statut !== 'panier' && t.statut !== 'a-reserver') continue;
      if (t.statut === 'a-reserver' && etatVente(ref, t.train.operateur, t.date, aujourdhui, maintenant).etat === 'ouverture') continue;
      candidats.set(cle(d.id, cote), canalVente(t.train.operateur));
    }
  }
  const groupes = new Map<string, GroupePanier>();
  const groupe = (site: NonNullable<CanalVente>) => {
    const g = groupes.get(site.nom) ?? { site, lots: [] };
    groupes.set(site.nom, g);
    return g;
  };
  const places = new Set<string>();
  // 1. Allers-retours du plan Avantage dont les deux trajets sont à réserver sur le même site.
  for (const b of plan?.billets ?? []) {
    if (b.type !== 'ar') continue;
    const ka = cle(b.aller.id, b.aller.cote);
    const kr = cle(b.retour.id, b.retour.cote);
    const site = candidats.get(ka);
    if (!site || candidats.get(kr)?.nom !== site.nom) continue;
    const da = parId.get(b.aller.id);
    const dr = parId.get(b.retour.id);
    if (!da || !dr) continue;
    groupe(site).lots.push({ type: 'carte', croise: b.croise, origine: b.origine, elements: [{ deplacement: da, cote: b.aller.cote }, { deplacement: dr, cote: b.retour.cote }] });
    places.add(ka).add(kr);
  }
  // 2. Le reste, par déplacement.
  for (const d of tries) {
    for (const cote of ['aller', 'retour'] as const) {
      const k = cle(d.id, cote);
      const site = candidats.get(k);
      if (!site || places.has(k)) continue;
      const g = groupe(site);
      const dernier = g.lots[g.lots.length - 1];
      if (dernier && dernier.type === 'deplacement' && dernier.elements[0]?.deplacement.id === d.id) dernier.elements.push({ deplacement: d, cote });
      else g.lots.push({ type: 'deplacement', croise: false, elements: [{ deplacement: d, cote }] });
      places.add(k);
    }
  }
  const rang = (n: string) => (ORDRE_SITES.indexOf(n) < 0 ? ORDRE_SITES.length : ORDRE_SITES.indexOf(n));
  const debut = (l: Lot) => l.elements.map((e) => e.deplacement[e.cote].date).sort()[0] ?? '';
  for (const g of groupes.values()) g.lots.sort((a, b) => debut(a).localeCompare(debut(b)));
  return [...groupes.values()].sort((a, b) => rang(a.site.nom) - rang(b.site.nom));
}

/** Trajets au panier, pas encore payés ni en option. */
export function dansLePanier(liste: Deplacement[]): ElementPanier[] {
  return liste.flatMap((d) => (['aller', 'retour'] as const).filter((c) => d[c].statut === 'panier').map((cote) => ({ id: d.id, cote })));
}
