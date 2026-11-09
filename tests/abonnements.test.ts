import { describe, expect, it } from 'vitest';
import brut from '../src/data/regles-abonnements.json';
import { REGLES_ABONNEMENTS as R } from '../src/data/abonnements';
import { REGLES_AVANTAGE as RA } from '../src/data/avantage';
import { LEVIERS } from '../src/data/leviers';
import { comparerFormules, echantillonPrix, partLundiJeudi, validerAbonnements, type CoutFormule, type Rythme } from '../src/domain/abonnements';
import { nouveauDeplacement, type Deplacement, type TrainChoisi } from '../src/domain/deplacements';
import { clePrix } from '../src/domain/prix';
import { estAReverifier } from '../src/domain/referentiel';

const rythme = (ar: number, prix: number[], part = 100, dureeMin = 195): Rythme => ({ allersRetoursParAn: ar, prixCentimes: prix, partLundiJeudi: part, dureeMin });
const cout = (fs: CoutFormule[], id: CoutFormule['id']) => fs.find((f) => f.id === id)!;
const ids = (fs: CoutFormule[]) => fs.map((f) => f.id);
const copie = () => JSON.parse(JSON.stringify(brut)) as Record<string, Record<string, unknown>>;

describe('référentiel des abonnements (EXG-10)', () => {
  it('sourcé, daté, lié aux leviers du catalogue', () => {
    for (const f of [R.liberte, R.maxActif, R.maxActifPlus]) {
      expect(LEVIERS.some((l) => l.id === f.levier)).toBe(true);
      expect(f.meta.source.startsWith('https://')).toBe(true);
      expect(estAReverifier(f.meta.verifieLe, new Date('2026-11-09T12:00:00Z'))).toBe(false);
    }
    expect(R.liberte).toMatchObject({ prixCarteCentimes: 34900, prixFixeCentimes: 7300 });
    expect(R.maxActif).toMatchObject({ mensualiteCentimes: 44100, reservationsParAn: 250, joursEligibles: [0, 1, 2, 3], engagementMois: 12 });
    expect(R.maxActifPlus).toMatchObject({ mensualiteCentimes: 70200, reservationsParAn: 450, joursEligibles: [0, 1, 2, 3, 4, 5, 6] });
  });
  it.each([
    ['version', (r: ReturnType<typeof copie>) => ((r as Record<string, unknown>).version = '2026-13-01')],
    ['mensualité nulle', (r: ReturnType<typeof copie>) => (r.maxActif!.mensualiteCentimes = 0)],
    ['mensualité décimale', (r: ReturnType<typeof copie>) => (r.maxActif!.mensualiteCentimes = 441.5)],
    ['jours non pris en charge', (r: ReturnType<typeof copie>) => (r.maxActif!.joursEligibles = [0, 1, 4])],
    ['jours en double', (r: ReturnType<typeof copie>) => (r.maxActif!.joursEligibles = [0, 0, 1, 2, 3])],
    ['source non https', (r: ReturnType<typeof copie>) => ((r.liberte!.meta as Record<string, unknown>).source = 'http://exemple.fr')],
    ['date de vérification', (r: ReturnType<typeof copie>) => ((r.maxActifPlus!.meta as Record<string, unknown>).verifieLe = 'hier')],
    ['source du prix MAX absente', (r: ReturnType<typeof copie>) => delete (r.maxActif!.meta as Record<string, unknown>).sourcePrix],
    ['date du relevé du prix MAX', (r: ReturnType<typeof copie>) => ((r.maxActifPlus!.meta as Record<string, unknown>).prixReleveLe = '2026-02-30')],
    ['prix fixe absent', (r: ReturnType<typeof copie>) => delete r.liberte!.prixFixeCentimes],
    ['formule absente', (r: ReturnType<typeof copie>) => delete (r as Record<string, unknown>).maxActifPlus],
  ])('refusé : %s', (_, casser) => {
    const r = copie();
    casser(r);
    expect(() => validerAbonnements(r)).toThrow();
  });
});

describe('coût sur un an de chaque formule (2de)', () => {
  it('rythme de David : 44 allers-retours à 60 €, retours le vendredi (50 % du lundi au jeudi) → carte Avantage', () => {
    const fs = comparerFormules(R, RA, rythme(44, [6000], 50));
    expect(ids(fs)).toEqual(['avantage', 'sans-carte', 'liberte', 'max-actif', 'max-actif-plus']);
    expect(cout(fs, 'sans-carte')).toMatchObject({ coutCentimes: 88 * 6000, couverts: 0, horsFormule: 88 });
    // 86 trajets croisés à 42 € (−30 %), le premier aller et le dernier retour à 60 €, plus la carte.
    expect(cout(fs, 'avantage')).toMatchObject({ coutCentimes: 86 * 4200 + 2 * 6000 + 4900, couverts: 86, horsFormule: 2 });
    // Liberté : 73 € fixe, plus cher que 60 € : aucun trajet n'en profite.
    expect(cout(fs, 'liberte')).toMatchObject({ coutCentimes: 34900 + 88 * 6000, couverts: 0 });
    // MAX ACTIF : les 44 trajets du vendredi restent payants.
    expect(cout(fs, 'max-actif')).toMatchObject({ coutCentimes: 12 * 44100 + 44 * 6000, couverts: 44, horsFormule: 44, engagementMois: 12 });
    expect(cout(fs, 'max-actif-plus')).toMatchObject({ coutCentimes: 12 * 70200, couverts: 88, horsFormule: 0 });
  });
  it('trajets chers du lundi au jeudi : MAX ACTIF l’emporte', () => {
    const fs = comparerFormules(R, RA, rythme(44, [10000], 100));
    expect(fs[0]!.id).toBe('max-actif');
    expect(fs[0]!.coutCentimes).toBe(12 * 44100);
    // Avantage : 30 % de 100 € = 70 €, sous le plafond de 89 €.
    expect(cout(fs, 'avantage').coutCentimes).toBe(86 * 7000 + 2 * 10000 + 4900);
    expect(cout(fs, 'liberte').coutCentimes).toBe(34900 + 88 * 7300);
  });
  it('le plafond Avantage s’applique aux billets très chers (plus de 3 h : 89 €)', () => {
    const fs = comparerFormules(R, RA, rythme(10, [15000], 0));
    expect(cout(fs, 'avantage').coutCentimes).toBe(18 * 8900 + 2 * 15000 + 4900);
  });
  it('carte Liberté : prix variés, seuls les billets au-dessus du prix fixe sont ramenés à 73 €', () => {
    const fs = comparerFormules(R, RA, rythme(10, [4000, 12000], 100));
    const l = cout(fs, 'liberte');
    expect(l.billetsCentimes).toBe(Math.round(20 * ((4000 + 7300) / 2)));
    expect(l).toMatchObject({ couverts: 10, horsFormule: 10 });
  });
  it('MAX ACTIF : réservations limitées à 250 par an, le reste au prix habituel', () => {
    const fs = comparerFormules(R, RA, rythme(150, [5000], 100));
    expect(cout(fs, 'max-actif')).toMatchObject({ couverts: 250, horsFormule: 50, billetsCentimes: 50 * 5000 });
    expect(cout(fs, 'max-actif-plus')).toMatchObject({ couverts: 300, horsFormule: 0 });
  });
  it('carte Liberté : un billet à 73 € pile n’en profite pas (borne), à 73,01 € il est ramené à 73 €', () => {
    expect(cout(comparerFormules(R, RA, rythme(10, [7300])), 'liberte')).toMatchObject({ couverts: 0, billetsCentimes: 20 * 7300 });
    expect(cout(comparerFormules(R, RA, rythme(10, [7301])), 'liberte')).toMatchObject({ couverts: 20, billetsCentimes: 20 * 7300 });
  });
  it('MAX ACTIF+ : réservations limitées à 450 par an', () => {
    expect(cout(comparerFormules(R, RA, rythme(300, [5000], 0)), 'max-actif-plus')).toMatchObject({ couverts: 450, horsFormule: 150, billetsCentimes: 150 * 5000 });
  });
  it('MAX ACTIF+ couvre tous les jours, quelle que soit la part du lundi au jeudi', () => {
    expect(cout(comparerFormules(R, RA, rythme(20, [5000], 0)), 'max-actif-plus').couverts).toBe(40);
    expect(cout(comparerFormules(R, RA, rythme(20, [5000], 0)), 'max-actif').couverts).toBe(0);
  });
  it('un seul aller-retour : la carte Avantage ne couvre rien (pas de croisement possible)', () => {
    const fs = comparerFormules(R, RA, rythme(1, [8000], 100));
    expect(cout(fs, 'avantage')).toMatchObject({ couverts: 0, coutCentimes: 2 * 8000 + 4900 });
    expect(fs[0]!.id).toBe('sans-carte');
  });
  it('mensualités d’un devis : remplacent celles du référentiel', () => {
    const fs = comparerFormules(R, RA, rythme(44, [10000], 100), { maxActif: 30000, maxActifPlus: 60000 });
    expect(cout(fs, 'max-actif').abonnementCentimes).toBe(12 * 30000);
    expect(cout(fs, 'max-actif-plus').abonnementCentimes).toBe(12 * 60000);
  });
  it('à coût égal, la formule la moins engageante passe d’abord', () => {
    // 12 allers-retours à 100 € = 2 400 €, comme 12 mensualités de 200 € de MAX ACTIF.
    const fs = comparerFormules(R, RA, rythme(12, [10000], 100), { maxActif: 20000 });
    expect(ids(fs).indexOf('sans-carte')).toBeLessThan(ids(fs).indexOf('max-actif'));
    expect(cout(fs, 'sans-carte').coutCentimes).toBe(cout(fs, 'max-actif').coutCentimes);
  });
  it('aucun trajet : seules les cartes et mensualités comptent', () => {
    const fs = comparerFormules(R, RA, rythme(0, [5000], 50));
    expect(fs[0]).toMatchObject({ id: 'sans-carte', coutCentimes: 0 });
    expect(cout(fs, 'max-actif').coutCentimes).toBe(12 * 44100);
  });
  it.each([
    ['allers-retours négatifs', rythme(-1, [5000])],
    ['allers-retours décimaux', rythme(1.5, [5000])],
    ['sans prix', rythme(10, [])],
    ['prix nul', rythme(10, [0])],
    ['part au-delà de 100 %', rythme(10, [5000], 101)],
    ['part non numérique', rythme(10, [5000], Number.NaN)],
    ['durée nulle', rythme(10, [5000], 50, 0)],
  ])('rythme invalide refusé : %s', (_, r) => {
    expect(() => comparerFormules(R, RA, r)).toThrow();
  });
});

describe('part des trajets du lundi au jeudi', () => {
  it('jeudi et vendredi : 50 % ; lundi à jeudi : 100 % ; week-end : 0 %', () => {
    expect(partLundiJeudi(['2026-11-12', '2026-11-13'])).toBe(50); // jeudi, vendredi
    expect(partLundiJeudi(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'])).toBe(100);
    expect(partLundiJeudi(['2026-11-14', '2026-11-15'])).toBe(0);
    expect(partLundiJeudi(['2026-11-09', '2026-11-13', '2026-11-13'])).toBe(33);
  });
  it('aucune date valide : null', () => {
    expect(partLundiJeudi([])).toBeNull();
    expect(partLundiJeudi(['2026-02-30'])).toBeNull();
  });
});

describe('prix réels utilisés comme prix sans carte', () => {
  const INOUI: TrainChoisi = { numero: '6123', operateur: 'TGV INOUI', depart: 1058, arrivee: 1257 };
  const OUIGO: TrainChoisi = { numero: '7821', operateur: 'OUIGO', depart: 1072, arrivee: 1270 };
  const AUJ = '2026-11-09';
  const dep = (id: string, aller: Partial<Deplacement['aller']>, retour: Partial<Deplacement['retour']> = {}): Deplacement => {
    const d = nouveauDeplacement(id, '2026-11-12', '2026-11-13');
    return { ...d, aller: { ...d.aller, ...aller }, retour: { ...d.retour, ...retour } };
  };
  it('prix payés et prix vus récents pour le train choisi, TGV INOUI seulement', () => {
    const liste = [
      dep('a', { train: INOUI, statut: 'paye', prixCentimes: 8000 }, { train: INOUI, prixVus: [{ train: clePrix(INOUI), centimes: 6000, le: AUJ }] }),
      dep('b', { train: OUIGO, statut: 'paye', prixCentimes: 2900 }, { train: OUIGO, prixVus: [{ train: clePrix(OUIGO), centimes: 3500, le: AUJ }] }),
    ];
    expect(echantillonPrix(RA, liste, AUJ)).toEqual({ prix: [8000, 6000], horsFormules: 2, anciens: 0 });
  });
  it('prix vu il y a plus de 2 jours écarté ; prix vu pour un autre train ignoré ; payé sans prix ignoré', () => {
    const liste = [
      dep('a', { train: INOUI, prixVus: [{ train: clePrix(INOUI), centimes: 6000, le: '2026-11-06' }] }, { train: INOUI, prixVus: [{ train: clePrix(OUIGO), centimes: 2900, le: AUJ }] }),
      dep('b', { train: INOUI, statut: 'paye' }, { statut: 'paye', prixCentimes: 5000 }),
    ];
    expect(echantillonPrix(RA, liste, AUJ)).toEqual({ prix: [], horsFormules: 0, anciens: 1 });
  });
});
