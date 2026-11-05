import { describe, expect, it } from 'vitest';
import brut from '../src/data/regles-avantage.json';
import { REGLES_AVANTAGE as R } from '../src/data/avantage';
import { LEVIERS } from '../src/data/leviers';
import { affectationMax, allerRetourEligible, dureeType, estimer, figerBillets, jambesDe, operateurEligible, planifier, plafond, prixAvecCarte, projectionAnnuelle, validerRegles, type Billet } from '../src/domain/croises';
import { jourSemaine, ajouterJours } from '../src/domain/dates';
import { changerStatuts } from '../src/domain/deplacements';
import { lireProfil, pourStockage, profilVide, aDesDonnees, exporter, importer } from '../src/domain/profil';
import { nouveauDeplacement, type Deplacement, type TrainChoisi } from '../src/domain/deplacements';
import { listePanier } from '../src/domain/panier';
import { OUVERTURES } from '../src/data/ouvertures';

const INOUI_MP: TrainChoisi = { numero: '6136', operateur: 'TGV INOUI', depart: 363, arrivee: 562 };
const INOUI_PM: TrainChoisi = { numero: '6123', operateur: 'TGV INOUI', depart: 1058, arrivee: 1257 };
const OUIGO_PM: TrainChoisi = { numero: '7821', operateur: 'OUIGO', depart: 1072, arrivee: 1270 };
const AUJ = '2026-11-05';

function dep(id: string, aller: string, retour: string, ta: TrainChoisi | null = INOUI_MP, tr: TrainChoisi | null = INOUI_PM): Deplacement {
  const d = nouveauDeplacement(id, aller, retour);
  if (ta) d.aller.train = ta;
  if (tr) d.retour.train = tr;
  return d;
}
const resume = (b: Billet) =>
  b.type === 'ar' ? `${b.croise ? 'croisé' : 'A/R'} ${b.origine} ${b.aller.date}→${b.retour.date}` : `${b.type} ${b.jambe.date}${b.type === 'hors-carte' ? ` (${b.raison})` : ''}`;

describe('règles de la carte Avantage (EXG-10)', () => {
  it('référentiel sourcé, daté, lié au levier du catalogue', () => {
    expect(LEVIERS.some((l) => l.id === R.levier)).toBe(true);
    expect(R.meta.source.startsWith('https://')).toBe(true);
    expect(R.prixCarteCentimes).toBe(4900);
  });
  it.each([
    ['dernier plafond limité', { ...brut, plafonds: [{ dureeMaxMin: 90, centimes: 4900 }] }],
    ['jour hors semaine', { ...brut, nuitsEligibles: [7] }],
    ['source non https', { ...brut, meta: { ...brut.meta, source: 'http://x' } }],
  ])('refuse : %s', (_n, v) => expect(() => validerRegles(v)).toThrow());
  it('opérateurs : TGV INOUI et Intercités, pas OUIGO ni Trenitalia', () => {
    expect(operateurEligible(R, 'TGV INOUI')).toBe(true);
    expect(operateurEligible(R, 'Intercités')).toBe(true);
    expect(operateurEligible(R, 'OUIGO')).toBe(false);
    expect(operateurEligible(R, 'Trenitalia (Frecciarossa)')).toBe(false);
  });
});

describe('aller-retour éligible : une nuit de vendredi, samedi ou dimanche, 61 jours au plus', () => {
  it.each([
    ['lundi → mercredi', '2026-11-09', '2026-11-11', false],
    ['jeudi → vendredi (nuit de jeudi)', '2026-11-12', '2026-11-13', false],
    ['vendredi → samedi (nuit de vendredi)', '2026-11-13', '2026-11-14', true],
    ['dimanche → lundi (nuit de dimanche)', '2026-11-15', '2026-11-16', true],
    ['lundi → lundi suivant', '2026-11-09', '2026-11-16', true],
    ['aller-retour dans la journée du samedi', '2026-11-14', '2026-11-14', false],
    ['61 jours pile', '2026-11-09', '2027-01-09', true],
    ['62 jours', '2026-11-09', '2027-01-10', false],
    ['retour avant l’aller', '2026-11-16', '2026-11-09', false],
  ])('%s', (_n, a, r, attendu) => expect(allerRetourEligible(R, a, r)).toBe(attendu));
});

describe('plafonds et prix estimé', () => {
  it('plafond selon la durée, bornes comprises', () => {
    expect(plafond(R, 89)).toBe(4900);
    expect(plafond(R, 90)).toBe(6900);
    expect(plafond(R, 180)).toBe(6900);
    expect(plafond(R, 181)).toBe(8900);
  });
  it('30 % de réduction, sans dépasser le plafond', () => {
    expect(prixAvecCarte(R, 10000, 199)).toBe(7000);
    expect(prixAvecCarte(R, 15000, 199)).toBe(8900);
    expect(prixAvecCarte(R, 3000, 199)).toBe(2100);
  });
});

describe('plan de réservation en billets croisés', () => {
  it('deux semaines lundi → mercredi : deux allers-retours croisés, les 4 trajets éligibles', () => {
    const plan = planifier(R, [dep('d-aaaa', '2026-11-09', '2026-11-11'), dep('d-bbbb', '2026-11-16', '2026-11-18')], AUJ);
    expect(plan.billets.map(resume)).toEqual(['croisé Marseille 2026-11-09→2026-11-18', 'croisé Paris 2026-11-11→2026-11-16']);
    expect(plan).toMatchObject({ eligibles: 4, grace: 4, total: 4 });
  });
  it('trois semaines : la chaîne couvre les 6 trajets', () => {
    const plan = planifier(R, [dep('d-aaaa', '2026-11-09', '2026-11-11'), dep('d-bbbb', '2026-11-16', '2026-11-18'), dep('d-cccc', '2026-11-23', '2026-11-25')], AUJ);
    expect(plan.eligibles).toBe(6);
    expect(plan.billets.every((b) => b.type === 'ar')).toBe(true);
  });
  it('une seule semaine lundi → mercredi : rien à croiser, hors carte', () => {
    const plan = planifier(R, [dep('d-aaaa', '2026-11-09', '2026-11-11')], AUJ);
    expect(plan.billets.map(resume)).toEqual(['hors-carte 2026-11-09 (conditions)', 'hors-carte 2026-11-11 (conditions)']);
    expect(plan.eligibles).toBe(0);
  });
  it('un déplacement qui comprend un week-end reste un aller-retour simple quand croiser n’apporte rien de plus', () => {
    const plan = planifier(R, [dep('d-aaaa', '2026-11-12', '2026-11-16'), dep('d-bbbb', '2026-11-19', '2026-11-23')], AUJ);
    expect(plan.billets.map(resume)).toEqual(['A/R Marseille 2026-11-12→2026-11-16', 'A/R Marseille 2026-11-19→2026-11-23']);
    expect(plan.grace).toBe(0);
  });
  it('revue B1 : garder un déplacement déjà éligible ne doit pas coûter de trajets (lun. 9 → mar. 10, sam. 14 → mar. 17)', () => {
    const plan = planifier(R, [dep('d-aaaa', '2026-11-09', '2026-11-10'), dep('d-bbbb', '2026-11-14', '2026-11-17')], AUJ);
    expect(plan.eligibles).toBe(4);
  });
  it('revue B1 : un aller du samedi déjà éligible seul n’est pas gaspillé dans un aller-retour', () => {
    const d1 = dep('d-aaaa', '2026-11-14', '2026-11-14', INOUI_MP, null);
    d1.retour.statut = 'paye'; // seul l'aller du samedi reste à réserver
    const d2 = dep('d-bbbb', '2026-11-16', '2026-11-22');
    const plan = planifier(R, [d1, d2], AUJ);
    expect(plan.eligibles).toBe(3);
    expect(plan.billets.map(resume)).toContain('simple 2026-11-14');
  });
  it('OUIGO : hors carte, l’autre trajet est croisé si possible', () => {
    const plan = planifier(R, [dep('d-aaaa', '2026-11-09', '2026-11-11', INOUI_MP, OUIGO_PM), dep('d-bbbb', '2026-11-16', '2026-11-18')], AUJ);
    expect(plan.billets.map(resume)).toEqual(['croisé Marseille 2026-11-09→2026-11-18', 'hors-carte 2026-11-11 (operateur)', 'hors-carte 2026-11-16 (conditions)']);
  });
  it('aller simple du samedi ou du dimanche : éligible seul', () => {
    const d = dep('d-aaaa', '2026-11-15', '2026-11-17', INOUI_MP, null);
    d.retour.statut = 'paye';
    const plan = planifier(R, [d], AUJ);
    expect(plan.billets.map(resume)).toEqual(['simple 2026-11-15']);
    expect(plan.eligibles).toBe(1);
  });
  it('trajets payés, en option ou passés ignorés ; au-delà de 61 jours pas de croisement', () => {
    const paye = dep('d-aaaa', '2026-11-09', '2026-11-11');
    paye.aller.statut = 'paye';
    const plan = planifier(R, [paye, dep('d-bbbb', '2026-11-02', '2026-11-04'), dep('d-cccc', '2026-11-16', '2026-11-18')], AUJ);
    expect(plan.total).toBe(3);
    expect(plan.billets.map(resume)).toEqual(['croisé Paris 2026-11-11→2026-11-16', 'hors-carte 2026-11-18 (conditions)']);
    const loin = planifier(R, [dep('d-aaaa', '2026-11-09', '2026-11-11'), dep('d-bbbb', '2027-01-18', '2027-01-20')], AUJ);
    expect(loin.eligibles).toBe(0);
  });
});

describe('estimation', () => {
  const plan = planifier(R, [dep('d-aaaa', '2026-11-09', '2026-11-11'), dep('d-bbbb', '2026-11-16', '2026-11-18')], AUJ);
  it('durée type : médiane des trajets du plan', () => expect(dureeType(plan)).toBe(199));
  it('prix habituel 100 € : jusqu’à 30 € par trajet, 120 € sur 4 trajets, carte remboursée dès 2 trajets', () => {
    expect(estimer(R, plan, 10000)).toEqual({ economieCentimes: 12000, parTrajetCentimes: 3000, seuilTrajets: 2 });
  });
  it('prix habituel 140 € : plafond à 89 € pour un trajet de plus de 3 h, 51 € par trajet', () => {
    expect(estimer(R, plan, 14000).parTrajetCentimes).toBe(5100);
  });
  it('plafond calculé trajet par trajet (revue I4) : un trajet de 3 h pile plafonné à 69 €', () => {
    const court = { ...INOUI_MP, arrivee: INOUI_MP.depart + 180 };
    const p2 = planifier(R, [dep('d-aaaa', '2026-11-09', '2026-11-11', court), dep('d-bbbb', '2026-11-16', '2026-11-18', court)], AUJ);
    expect(estimer(R, p2, 14000).economieCentimes).toBe(2 * (14000 - 6900) + 2 * (14000 - 8900));
  });
  it('projection sur un an : 40 allers-retours croisés en chaîne = 78 trajets couverts ; net après la carte', () => {
    expect(projectionAnnuelle(R, 10000, 40)).toEqual({ trajets: 78, economieCentimes: 78 * 3000, netCentimes: 78 * 3000 - 4900 });
    expect(projectionAnnuelle(R, 10000, 1)).toEqual({ trajets: 0, economieCentimes: 0, netCentimes: -4900 });
  });
});

describe('liste du panier avec la carte', () => {
  it('les trajets SNCF Connect suivent le plan : une recherche par aller-retour croisé', () => {
    const liste = [dep('d-aaaa', '2026-11-09', '2026-11-11'), dep('d-bbbb', '2026-11-16', '2026-11-18')];
    const plan = planifier(R, liste, AUJ);
    const [sncf] = listePanier(liste, AUJ, 600, OUVERTURES, plan);
    expect(sncf?.lots.map((l) => `${l.type}${l.croise ? ' croisé' : ''} ${l.origine}: ${l.elements.map((e) => `${e.deplacement.id}-${e.cote}`).join(' + ')}`)).toEqual([
      'carte croisé Marseille: d-aaaa-aller + d-bbbb-retour',
      'carte croisé Paris: d-aaaa-retour + d-bbbb-aller',
    ]);
    const sans = listePanier(liste, AUJ, 600, OUVERTURES)[0];
    expect(sans?.lots.map((l) => l.type)).toEqual(['deplacement', 'deplacement']);
  });
});

describe('revue : optimalité contre la force brute', () => {
  // Générateur pseudo-aléatoire déterministe.
  let graine = 42;
  const hasard = () => ((graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648);
  const bruteForce = (liste: Deplacement[]) => {
    const js = jambesDe(liste, AUJ).filter((j) => operateurEligible(R, j.operateur ?? 'TGV INOUI'));
    const simple = (d: string) => (R.joursSimplesEligibles.includes(jourSemaine(d)) ? 1 : 0);
    let meilleur = 0;
    const explorer = (i: number, libres: boolean[], score: number) => {
      if (i === js.length) {
        meilleur = Math.max(meilleur, score + js.reduce((n, j, k) => n + (libres[k] ? simple(j.date) : 0), 0));
        return;
      }
      if (!libres[i]) return explorer(i + 1, libres, score);
      explorer(i + 1, libres, score);
      for (let k = i + 1; k < js.length; k++) {
        const a = js[i]!;
        const b = js[k]!;
        if (!libres[k] || a.sens === b.sens || !allerRetourEligible(R, a.date, b.date)) continue;
        if (a.date === b.date && (a.arrivee ?? 0) > (b.depart ?? 0)) continue;
        const l = [...libres];
        l[i] = l[k] = false;
        explorer(i + 1, l, score + 2);
      }
    };
    explorer(0, js.map(() => true), 0);
    return meilleur;
  };
  it('3 000 plannings aléatoires de 2 à 4 déplacements : le plan couvre autant de trajets que l’optimum', () => {
    for (let n = 0; n < 3000; n++) {
      const liste: Deplacement[] = [];
      const nb = 2 + Math.floor(hasard() * 3);
      for (let k = 0; k < nb; k++) {
        const aller = ajouterJours('2026-11-09', Math.floor(hasard() * 40));
        const retour = ajouterJours(aller, Math.floor(hasard() * 6));
        liste.push(dep(`d-${'abcd'[k]}${'abcd'[k]}${'abcd'[k]}`, aller, retour));
      }
      const plan = planifier(R, liste, AUJ);
      expect(plan.eligibles, JSON.stringify(liste.map((d) => [d.aller.date, d.retour.date]))).toBe(bruteForce(liste));
    }
  });
  it('affectation de poids maximal : cas simple', () => {
    expect(affectationMax([[3, 1], [3, 0]])).toEqual([1, 0]);
    expect(affectationMax([[0, 0], [0, 5]])).toEqual([0, 1]);
  });
});

describe('revue : cohérence avec la vente, le panier et la carte', () => {
  it('B3 : un billet engagé (au panier) n’est plus réapparié quand on ajoute une semaine', () => {
    let liste = [dep('d-aaaa', '2026-11-09', '2026-11-11'), dep('d-bbbb', '2026-11-16', '2026-11-18')];
    const plan = planifier(R, liste, AUJ);
    liste = figerBillets(plan, changerStatuts(liste, [{ id: 'd-aaaa', cote: 'aller' }], 'panier', { le: AUJ }), () => 'b-figee');
    expect(liste[0]?.aller.billet).toBe('b-figee');
    expect(liste[1]?.retour.billet).toBe('b-figee');
    const apres = planifier(R, [...liste, dep('d-cccc', '2026-11-23', '2026-11-25')], AUJ);
    expect(apres.billets.find((b) => b.type === 'ar' && b.engage && b.aller.date === '2026-11-09' && b.retour.date === '2026-11-18')).toBeTruthy();
  });
  it('B3 : revenus tous deux « à réserver », les trajets sont libérés', () => {
    let liste = [dep('d-aaaa', '2026-11-09', '2026-11-11'), dep('d-bbbb', '2026-11-16', '2026-11-18')];
    liste = figerBillets(planifier(R, liste, AUJ), changerStatuts(liste, [{ id: 'd-aaaa', cote: 'aller' }], 'panier'), () => 'b-figee');
    liste = changerStatuts(liste, [{ id: 'd-aaaa', cote: 'aller' }], 'a-reserver');
    liste = figerBillets(planifier(R, liste, AUJ), liste, () => 'b-autre');
    expect(liste[0]?.aller.billet).toBeUndefined();
  });
  it('B2 : partenaire pas encore en vente → la liste du panier dit d’attendre au lieu de vendre le trajet seul', () => {
    const liste = [dep('d-aaaa', '2027-01-04', '2027-01-06'), dep('d-bbbb', '2027-01-11', '2027-01-13')];
    // Le 05/11, ces dates sont après le 06/01 (en vente jusqu'au 06/01) : seuls les trajets du 4 et du 6 sont en vente.
    const plan = planifier(R, liste, AUJ, { ouvertures: OUVERTURES, maintenant: 600 });
    const lots = listePanier(liste, AUJ, 600, OUVERTURES, plan)[0]?.lots ?? [];
    expect(lots.map((l) => `${l.type}:${l.elements.map((e) => `${e.deplacement.id}-${e.cote}`).join('+')}${l.attente ? `@${l.attente.ouvertureLe}` : ''}`)).toEqual([
      'attente:d-aaaa-aller@2026-11-12',
      'attente:d-aaaa-retour@2026-11-12',
    ]);
  });
  it('train du jour déjà parti : ignoré par le plan comme par le panier', () => {
    const plan = planifier(R, [dep('d-aaaa', AUJ, '2026-11-09'), dep('d-bbbb', '2026-11-16', '2026-11-18')], AUJ, { maintenant: 7 * 60 });
    expect(plan.total).toBe(3);
  });
  it('carte qui expire pendant la période : les trajets suivants sont hors carte', () => {
    const plan = planifier(R, [dep('d-aaaa', '2026-11-09', '2026-11-11'), dep('d-bbbb', '2026-11-16', '2026-11-18')], AUJ, { finValidite: '2026-11-15' });
    expect(plan.billets.map(resume)).toContain('hors-carte 2026-11-16 (carte-expiree)');
    expect(plan.eligibles).toBe(0);
  });
  it('trajet sans train choisi : compté pour croiser (train supposé TGV INOUI ou Intercités)', () => {
    const plan = planifier(R, [dep('d-aaaa', '2026-11-09', '2026-11-11'), dep('d-bbbb', '2026-11-16', '2026-11-18', null, null)], AUJ);
    expect(plan.eligibles).toBe(4);
  });
});

describe('revue : prix habituel dans le profil', () => {
  const ids = new Set(LEVIERS.map((l) => l.id));
  it('relu, stocké, exporté, importé ; valeur invalide écartée', () => {
    const p = pourStockage({ ...profilVide(), prixHabituelCentimes: 9500 });
    expect(p.prixHabituelCentimes).toBe(9500);
    expect(aDesDonnees(p)).toBe(true);
    expect(importer(exporter(p, AUJ), ids).profil.prixHabituelCentimes).toBe(9500);
    const lu = lireProfil({ version: 1, leviers: {}, prixHabituelCentimes: -3 }, ids);
    expect(lu.profil.prixHabituelCentimes).toBeUndefined();
    expect(lu.ecartes).toEqual(['prix habituel']);
  });
  it('les plafonds du catalogue des leviers et des règles concordent', () => {
    const conditions = LEVIERS.find((l) => l.id === R.levier)!.conditions.join(' ');
    for (const p of R.plafonds) expect(conditions).toContain(`${p.centimes / 100} €`);
  });
});
