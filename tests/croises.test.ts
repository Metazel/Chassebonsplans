import { describe, expect, it } from 'vitest';
import brut from '../src/data/regles-avantage.json';
import { REGLES_AVANTAGE as R } from '../src/data/avantage';
import { LEVIERS } from '../src/data/leviers';
import { allerRetourEligible, dureeType, estimer, operateurEligible, planifier, plafond, prixAvecCarte, validerRegles, type Billet } from '../src/domain/croises';
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
  it('un déplacement qui comprend déjà un week-end reste un aller-retour simple', () => {
    const plan = planifier(R, [dep('d-aaaa', '2026-11-12', '2026-11-16'), dep('d-bbbb', '2026-11-23', '2026-11-25')], AUJ);
    expect(plan.billets.map(resume)).toEqual(['A/R Marseille 2026-11-12→2026-11-16', 'hors-carte 2026-11-23 (conditions)', 'hors-carte 2026-11-25 (conditions)']);
    expect(plan.grace).toBe(0);
  });
  it('OUIGO : hors carte, l’autre trajet est croisé si possible', () => {
    const plan = planifier(R, [dep('d-aaaa', '2026-11-09', '2026-11-11', INOUI_MP, OUIGO_PM), dep('d-bbbb', '2026-11-16', '2026-11-18')], AUJ);
    expect(plan.billets.map(resume)).toEqual(['croisé Marseille 2026-11-09→2026-11-18', 'hors-carte 2026-11-11 (operateur)', 'hors-carte 2026-11-16 (conditions)']);
  });
  it('aller simple du samedi ou du dimanche : éligible seul', () => {
    const plan = planifier(R, [dep('d-aaaa', '2026-11-15', '2026-11-17', INOUI_MP, null)], AUJ);
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
  it('prix habituel 100 € : 30 € par trajet, 120 € sur 4 trajets, carte remboursée dès 2 trajets', () => {
    expect(estimer(R, plan, 10000, 199)).toEqual({ economieCentimes: 12000, parTrajetCentimes: 3000, seuilTrajets: 2 });
  });
  it('prix habituel 140 € : plafond à 89 €, 51 € par trajet', () => {
    expect(estimer(R, plan, 14000, 199).parTrajetCentimes).toBe(5100);
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
