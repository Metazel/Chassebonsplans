/** Séance panier : quels trajets présenter, dans quel ordre (un site de vente après l'autre). */
import { canalVente } from './horaires';
import type { Deplacement } from './deplacements';
import { etatVente, type ReferentielOuvertures } from './ventes';

export interface ElementPanier {
  id: string;
  cote: 'aller' | 'retour';
}

const ORDRE_SITES = ['SNCF Connect', 'Trenitalia'];

/** Trajets à mettre au panier : train choisi, à réserver, à venir et déjà en vente ; groupés par site puis par date. */
export function aMettreAuPanier(liste: Deplacement[], aujourdhui: string, ref: ReferentielOuvertures): ElementPanier[] {
  const res: (ElementPanier & { site: number; date: string })[] = [];
  for (const d of liste) {
    for (const cote of ['aller', 'retour'] as const) {
      const t = d[cote];
      if (!t.train || t.statut !== 'a-reserver' || t.date < aujourdhui) continue;
      if (etatVente(ref, t.train.operateur, t.date, aujourdhui).etat !== 'en-vente') continue;
      const site = ORDRE_SITES.indexOf(canalVente(t.train.operateur)?.nom ?? '');
      res.push({ id: d.id, cote, site: site < 0 ? ORDRE_SITES.length : site, date: t.date });
    }
  }
  return res
    .sort((a, b) => a.site - b.site || a.date.localeCompare(b.date) || (a.cote === b.cote ? 0 : a.cote === 'aller' ? -1 : 1))
    .map(({ id, cote }) => ({ id, cote }));
}

