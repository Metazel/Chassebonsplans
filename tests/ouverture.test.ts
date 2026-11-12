/**
 * Itération 8 — préparer et acheter une ouverture des ventes : jours fériés, période, lots imbriqués, commandes,
 * import de la confirmation, bilan. Cas de référence : un achat réel de 24 semaines (48 trajets, 24 billets imbriqués,
 * 6 commandes de 4 billets), décalé de 52 semaines et anonymisé (le dépôt est public).
 */
import { describe, expect, it } from 'vitest';
import miseEnPage from './fixtures/confirmation-mise-en-page.txt?raw';
import courriel from './fixtures/confirmation-courriel.txt?raw';
import brutFeries from '../src/data/jours-feries.json';
import { FERIES } from '../src/data/feries';
import { REGLES_AVANTAGE as RA } from '../src/data/avantage';
import { couvert, ferie, validerFeries } from '../src/domain/feries';
import { joursAllerPossibles, semainesPeriode, statutDates, verifierModele, type ModelePeriode } from '../src/domain/periode';
import { DUREE_DEFAUT, lotsDuPlan, planifier } from '../src/domain/croises';
import { BILLETS_PAR_COMMANDE, listePanier, numeroterCommandes, type Lot } from '../src/domain/panier';
import { appliquerConfirmation, lireConfirmation, TAILLE_MAX_CONFIRMATION } from '../src/domain/confirmation';
import { bilanPayes } from '../src/domain/bilan';
import { lireDeplacements, nouveauDeplacement, type Deplacement, type TrainChoisi } from '../src/domain/deplacements';
import { validerHoraires } from '../src/domain/horaires';
import { validerOuvertures } from '../src/domain/ventes';
import { estAReverifier } from '../src/domain/referentiel';

const P = { trajetGareDomicileMin: 15, limiteDinerDomicileMin: 21 * 60 + 45, coutRepasCentimes: 1000, toleranceCentimes: 200 };

/** 24 semaines d'un achat réel (aller, retour), décalées de 52 semaines. */
const SEMAINES_ACHAT: [string, string][] = [
  ['2027-12-15', '2027-12-17'], ['2028-01-06', '2028-01-07'], ['2028-01-13', '2028-01-14'], ['2028-01-20', '2028-01-21'],
  ['2028-01-26', '2028-01-28'], ['2028-02-03', '2028-02-04'], ['2028-02-10', '2028-02-11'], ['2028-02-16', '2028-02-18'],
  ['2028-02-24', '2028-02-25'], ['2028-03-09', '2028-03-10'], ['2028-03-16', '2028-03-17'], ['2028-03-22', '2028-03-24'],
  ['2028-03-30', '2028-03-31'], ['2028-04-06', '2028-04-07'], ['2028-04-12', '2028-04-14'], ['2028-04-27', '2028-04-28'],
  ['2028-05-10', '2028-05-12'], ['2028-05-18', '2028-05-19'], ['2028-05-25', '2028-05-26'], ['2028-06-01', '2028-06-02'],
  ['2028-06-07', '2028-06-09'], ['2028-06-14', '2028-06-16'], ['2028-06-22', '2028-06-23'], ['2028-06-29', '2028-06-30'],
];
const id = (i: number) => `d-${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}aaa`;
const semainesAchat = () => SEMAINES_ACHAT.map(([a, r], i) => nouveauDeplacement(id(i), a, r));
let compteur = 0;
const nouvelId = () => `b-${'abcdefghijklmnopqrstuvwxyz'[compteur++ % 26]}${'abcdefghijklmnopqrstuvwxyz'[Math.floor(compteur / 26) % 26]}xyz`;

describe('jours fériés (EXG-07)', () => {
  it('données Etalab embarquées, licence et source citées, 2024 à 2031', () => {
    expect(FERIES.meta.licence).toBe('Licence Ouverte 2.0');
    expect(FERIES.meta.source.startsWith('https://')).toBe(true);
    expect([FERIES.de, FERIES.a]).toEqual([2024, 2031]);
    expect(estAReverifier(FERIES.meta.verifieLe, new Date('2026-11-13T12:00:00Z'))).toBe(false);
  });
  it('2027 : Ascension le jeudi 6 mai, lundis de Pâques et de Pentecôte, Noël 2026 un vendredi', () => {
    expect(ferie(FERIES, '2027-05-06')).toBe('Ascension');
    expect(ferie(FERIES, '2027-03-29')).toBe('Lundi de Pâques');
    expect(ferie(FERIES, '2027-05-17')).toBe('Lundi de Pentecôte');
    expect(ferie(FERIES, '2026-12-25')).toBe('Jour de Noël');
    expect(ferie(FERIES, '2027-05-07')).toBeUndefined();
    expect(couvert(FERIES, '2032-01-01')).toBe(false);
  });
  it.each([
    ['date invalide', (j: Record<string, unknown>) => (j.jours = { '2027-02-30': 'x' })],
    ['année incomplète', (j: Record<string, unknown>) => (j.jours = { '2027-01-01': '1er janvier' })],
    ['licence absente', (j: Record<string, unknown>) => delete (j.meta as Record<string, unknown>).licence],
    ['source non https', (j: Record<string, unknown>) => ((j.meta as Record<string, unknown>).source = 'http://x')],
  ])('refusé : %s', (_, casser) => {
    const j = JSON.parse(JSON.stringify(brutFeries)) as Record<string, unknown>;
    casser(j);
    expect(() => validerFeries(j)).toThrow();
  });
});

describe('préparer une période', () => {
  const modele = (m: Partial<ModelePeriode> = {}): ModelePeriode => ({ du: '2026-12-14', au: '2027-07-02', jourAller: 3, jourRetour: 4, conges: [], ...m });
  it('du jeudi au vendredi, de mi-décembre au 2 juillet : Noël, Jour de l’an et l’Ascension écartés par défaut', () => {
    const s = semainesPeriode(modele(), FERIES, []);
    expect(s).toHaveLength(29);
    expect(s[0]).toMatchObject({ lundi: '2026-12-14', aller: '2026-12-17', retour: '2026-12-18', statut: 'propose' });
    expect(s.filter((x) => x.statut === 'ferie').map((x) => [x.lundi, x.motif])).toEqual([
      ['2026-12-21', 'Jour de Noël'],
      ['2026-12-28', '1er janvier'],
      ['2027-05-03', 'Ascension'],
    ]);
    // Lundis fériés (Pâques, Pentecôte) : la semaine reste proposée, l'aller est le jeudi.
    expect(s.find((x) => x.lundi === '2027-03-29')?.statut).toBe('propose');
    expect(s.at(-1)).toMatchObject({ aller: '2027-07-01', retour: '2027-07-02' });
  });
  it('congés : semaines écartées, bornes comprises ; semaines déjà prévues : non reproposées', () => {
    const s = semainesPeriode(modele({ conges: [{ du: '2027-02-27', au: '2027-03-07' }, { du: '2027-04-22', au: '2027-04-22' }] }), FERIES, [nouveauDeplacement('d-aaaa', '2027-01-06', '2027-01-08')]);
    expect(s.find((x) => x.lundi === '2027-03-01')).toMatchObject({ statut: 'conges' });
    expect(s.find((x) => x.lundi === '2027-04-19')).toMatchObject({ statut: 'conges', motif: 'congés du 2027-04-22 au 2027-04-22' });
    expect(s.find((x) => x.lundi === '2027-02-22')?.statut).toBe('propose');
    expect(s.find((x) => x.lundi === '2027-01-04')?.statut).toBe('existe');
  });
  it('aller le mercredi certaines semaines : jours possibles et statut recalculé', () => {
    const s = semainesPeriode(modele(), FERIES, []).find((x) => x.lundi === '2027-05-03')!;
    expect(joursAllerPossibles(s)).toEqual(['2027-05-03', '2027-05-04', '2027-05-05', '2027-05-06', '2027-05-07']);
    expect(statutDates('2027-05-05', '2027-05-07', [], FERIES).statut).toBe('propose');
  });
  it('la période commence ou finit en milieu de semaine : seules les semaines entières dans la période', () => {
    const s = semainesPeriode(modele({ du: '2026-12-18', au: '2027-01-14' }), FERIES, []);
    expect(s.map((x) => x.lundi)).toEqual(['2026-12-21', '2026-12-28', '2027-01-04']);
  });
  it('hors des années couvertes par les jours fériés : signalé', () => {
    expect(statutDates('2032-01-08', '2032-01-09', [], FERIES)).toEqual({ statut: 'propose', ferieInconnu: true });
  });
  it.each([
    [{ du: '' }, 'début'],
    [{ au: '2026-12-01' }, 'suivre'],
    [{ au: '2028-01-31' }, '54 semaines'],
    [{ jourAller: 4, jourRetour: 3 }, 'même jour'],
    [{ conges: [{ du: '2027-02-10', au: '2027-02-01' }] }, 'congés'],
  ])('modèle invalide %#', (m, attendu) => {
    expect(verifierModele(modele(m as Partial<ModelePeriode>))).toContain(attendu);
    expect(() => semainesPeriode(modele(m as Partial<ModelePeriode>), FERIES, [])).toThrow();
  });
});

describe('lots imbriqués de deux semaines', () => {
  it('achat de référence : 24 billets imbriqués, 48 trajets couverts, 12 lots de deux semaines consécutives', () => {
    const plan = planifier(RA, semainesAchat(), '2027-11-11', { lots: true });
    expect(plan.eligibles).toBe(48);
    const lots = lotsDuPlan(plan);
    expect(lots).toHaveLength(12);
    const premier = lots[0]!.map((b) => (b.type === 'ar' ? [b.origine, b.aller.date, b.retour.date] : []));
    expect(premier).toEqual(
      expect.arrayContaining([
        ['Marseille', '2027-12-15', '2028-01-07'],
        ['Paris', '2027-12-17', '2028-01-06'],
      ]),
    );
    expect(lots.every((l) => l.length === 2)).toBe(true);
  });
  it('sans les lots, l’appariement général couvre autant mais mélange les semaines (lots de trois)', () => {
    const general = planifier(RA, semainesAchat(), '2027-11-11');
    expect(general.eligibles).toBe(48);
    expect(lotsDuPlan(general).some((l) => l.length > 2)).toBe(true);
  });
  it('nombre impair de semaines : l’appariement général est gardé s’il couvre davantage', () => {
    const trois = semainesAchat().slice(2, 5);
    const plan = planifier(RA, trois, '2027-11-11', { lots: true });
    expect(plan.eligibles).toBe(planifier(RA, trois, '2027-11-11').eligibles);
    expect(plan.eligibles).toBe(6);
  });
  it('semaines trop éloignées (plus de 61 jours) : pas de lot', () => {
    const l = [nouveauDeplacement('d-aaaa', '2027-01-07', '2027-01-08'), nouveauDeplacement('d-bbbb', '2027-04-08', '2027-04-09')];
    expect(planifier(RA, l, '2026-11-12', { lots: true }).eligibles).toBe(0);
  });
});

describe('commandes de quatre billets', () => {
  const train = (numero: string, depart: number): TrainChoisi => ({ numero, operateur: 'TGV INOUI', depart, arrivee: depart + 200 });
  const avecTrains = () =>
    semainesAchat().map((d) => ({ ...d, aller: { ...d.aller, train: train('6136', 363) }, retour: { ...d.retour, train: train('6153', 1090) } }));
  const ouvertures = validerOuvertures({
    version: '2026-11-12',
    meta: { source: 'test', verifieLe: '2026-11-12' },
    operateurs: [{ id: 'tgv-inoui', nom: 'TGV INOUI', reconnu: ['inoui', 'tgv'], enVenteJusquau: '2028-07-01', ouvertures: [], source: 'https://exemple.fr' }],
  });
  it('6 commandes de 2 lots, dans l’ordre chronologique', () => {
    const liste = avecTrains();
    const plan = planifier(RA, liste, '2026-11-12', { lots: true });
    const [sncf] = listePanier(liste, '2027-11-11', 600, ouvertures, plan);
    const cartes = sncf!.lots.filter((l) => l.type === 'carte');
    expect(cartes).toHaveLength(24);
    expect(new Set(cartes.map((l) => l.commande))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(cartes.filter((l) => l.commande === 1).flatMap((l) => l.elements.map((e) => e.deplacement[e.cote].date)).sort()).toEqual(
      ['2027-12-15', '2027-12-17', '2028-01-06', '2028-01-07', '2028-01-13', '2028-01-14', '2028-01-20', '2028-01-21'],
    );
    expect(cartes.map((l) => l.commande)).toEqual([...cartes.map((l) => l.commande)].sort((a, b) => a! - b!));
  });
  it('un lot n’est jamais coupé entre deux commandes, sauf s’il dépasse à lui seul une commande : il est alors découpé par tranches', () => {
    const d = (id: string) => nouveauDeplacement(id, '2027-01-07', '2027-01-08');
    const lot = (a: string, b: string): Lot => ({ type: 'carte', croise: true, elements: [{ deplacement: d(a), cote: 'aller' }, { deplacement: d(b), cote: 'retour' }] });
    const lots = [lot('d-aaaa', 'd-bbbb'), lot('d-bbbb', 'd-cccc'), lot('d-cccc', 'd-dddd'), lot('d-eeee', 'd-ffff'), lot('d-ffff', 'd-eeee')];
    numeroterCommandes(lots, 2);
    expect(lots.map((l) => l.commande)).toEqual([1, 1, 2, 3, 3]);
    expect(BILLETS_PAR_COMMANDE).toBe(4);
  });
});

describe('import de la confirmation SNCF Connect (copier-coller)', () => {
  it.each([
    ['mise en page en colonnes', miseEnPage],
    ['courriel copié, une cellule par ligne', courriel],
  ])('lit les 4 billets de la commande 1 (%s)', (_, texte) => {
    const c = lireConfirmation(texte);
    expect(c.illisibles).toBe(0);
    expect(c.billets.map((b) => b.prixCentimes)).toEqual([7400, 11800, 8000, 6400]);
    expect(c.billets[0]).toEqual({
      prixCentimes: 7400,
      tarif: 'avantage',
      trajets: [
        { sens: 'MP', date: '2027-12-15', depart: 363, numero: '6136', operateur: 'TGV INOUI' },
        { sens: 'PM', date: '2028-01-07', depart: 1058, numero: '6123', operateur: 'TGV INOUI' },
      ],
    });
    // Billet au départ de Paris : aller Paris → Marseille, retour Marseille → Paris.
    expect(c.billets[1]!.trajets.map((t) => [t.sens, t.date, t.numero])).toEqual([
      ['PM', '2027-12-17', '6123'],
      ['MP', '2028-01-06', '6136'],
    ]);
  });
  it('rien de personnel n’est lu : ni nom, ni référence, ni moyen de paiement', () => {
    const json = JSON.stringify(lireConfirmation(miseEnPage));
    for (const interdit of ['Martin', 'REF', '9999', 'exemple.fr', '000000', 'HP']) expect(json).not.toContain(interdit);
  });
  it('blocs illisibles comptés ; texte sans bloc ou trop long : aucun billet', () => {
    expect(lireConfirmation('Voyage 1 Marseille Saint-Charles Paris Gare de Lyon Aller : demain')).toEqual({ billets: [], illisibles: 1 });
    expect(lireConfirmation('bonjour')).toEqual({ billets: [], illisibles: 0 });
    expect(lireConfirmation(miseEnPage.padEnd(TAILLE_MAX_CONFIRMATION + 1, ' ')).billets).toHaveLength(0);
    // Retour avant l'aller : incohérent, écarté.
    expect(lireConfirmation('Voyage 1 Marseille Saint-Charles Paris Gare de Lyon 50,00 € Aller : jeudi 14 janvier 2027 à 06:02 Retour : mardi 12 janvier 2027 à 17:38').illisibles).toBe(1);
    // Aller simple, mois accentué, heure « 6h02 ».
    expect(lireConfirmation('Voyage 1 Marseille St Charles Paris Gare de Lyon 45,50 € Aller : jeudi 4 février 2027 à 6h02 OUIGO 7801').billets[0]).toEqual({
      prixCentimes: 4550,
      trajets: [{ sens: 'MP', date: '2027-02-04', depart: 362, numero: '7801', operateur: 'OUIGO' }],
    });
  });
  it('application : trajets payés, prix réparti, billets engagés, déplacements créés au besoin, import répété sans effet', () => {
    compteur = 0;
    const existants = [nouveauDeplacement('d-aaaa', '2027-12-15', '2027-12-17'), nouveauDeplacement('d-bbbb', '2028-01-06', '2028-01-07')];
    const conf = lireConfirmation(miseEnPage);
    const { deplacements, rapport } = appliquerConfirmation(existants, conf, null, nouvelId);
    expect(rapport).toMatchObject({ payes: 8, corriges: 0, dates: 0, crees: 2, dejaImportes: 0, ignores: [], horsPlafond: [] });
    expect(deplacements.map((d) => [d.aller.date, d.retour.date])).toEqual([
      ['2027-12-15', '2027-12-17'],
      ['2028-01-06', '2028-01-07'],
      ['2028-01-13', '2028-01-14'],
      ['2028-01-20', '2028-01-21'],
    ]);
    const [a, b] = deplacements;
    expect(a!.aller).toMatchObject({ statut: 'paye', prixCentimes: 3700, tarif: 'avantage', train: { numero: '6136', depart: 363 } });
    expect(b!.retour).toMatchObject({ statut: 'paye', prixCentimes: 3700 });
    expect(a!.aller.billet).toBe(b!.retour.billet);
    expect(a!.retour.billet).toBe(b!.aller.billet);
    expect(a!.aller.billet).not.toBe(a!.retour.billet);
    // Total : 336 € pour 8 trajets.
    expect(deplacements.flatMap((d) => [d.aller, d.retour]).reduce((s, t) => s + (t.prixCentimes ?? 0), 0)).toBe(33600);
    // Les données importées passent la relecture du stockage (EXG-02 : identifiants de billet sans chiffres).
    expect(lireDeplacements(JSON.parse(JSON.stringify(deplacements)))).toEqual({ deplacements, ecartes: 0 });
    const encore = appliquerConfirmation(deplacements, conf, null, nouvelId);
    expect(encore.rapport).toMatchObject({ payes: 0, crees: 0, dejaImportes: 8 });
    expect(encore.deplacements).toEqual(deplacements);
  });
  it('revue : « C’est payé » puis import : trajets complétés (prix, tarif, train, billets), pas « déjà importés »', () => {
    const conf = lireConfirmation(miseEnPage);
    const avant = appliquerConfirmation([], conf, null, nouvelId).deplacements.map((d) => ({
      ...d,
      aller: { date: d.aller.date, statut: 'paye' as const, billet: 'b-figeaa' },
      retour: { date: d.retour.date, statut: 'paye' as const, billet: 'b-figebb' },
    }));
    const { deplacements, rapport } = appliquerConfirmation(avant, conf, null, nouvelId);
    expect(rapport).toMatchObject({ payes: 8, corriges: 8, dejaImportes: 0 });
    expect(deplacements[0]!.aller).toMatchObject({ prixCentimes: 3700, tarif: 'avantage', train: { numero: '6136' } });
    expect(deplacements[0]!.aller.billet).toBe(deplacements[1]!.retour.billet);
  });
  it('revue : déplacement prévu un autre jour de la même semaine : la date du billet remplace la date prévue', () => {
    const conf = lireConfirmation(miseEnPage);
    const prevus = [nouveauDeplacement('d-aaaa', '2027-12-14', '2027-12-17'), nouveauDeplacement('d-bbbb', '2028-01-06', '2028-01-07')];
    const { deplacements, rapport } = appliquerConfirmation(prevus, conf, null, nouvelId);
    expect(rapport).toMatchObject({ dates: 1, crees: 2, ignores: [] });
    expect(deplacements.find((d) => d.id === 'd-aaaa')!.aller).toMatchObject({ date: '2027-12-15', statut: 'paye' });
    // Un trajet payé n'est jamais déplacé.
    const paye = [{ ...nouveauDeplacement('d-cccc', '2027-12-14', '2027-12-17'), aller: { date: '2027-12-14', statut: 'paye' as const } }];
    const r2 = appliquerConfirmation(paye, lireConfirmation(miseEnPage), null, nouvelId);
    expect(r2.deplacements.find((d) => d.id === 'd-cccc')!.aller.date).toBe('2027-12-14');
  });
  it('revue : prix lu avant « Aller », milliers, récapitulatif ignoré ; NFC ; plusieurs voyageurs ou correspondance : illisible', () => {
    const base = (prix: string, fin = '') => `Voyage 1 Marseille Saint-Charles Paris Gare de Lyon ${prix} Aller : jeudi 13 janvier 2028 à 06:02 TGV INOUI 6136 Paul (30-59 ans)${fin}`;
    // Espace des milliers lu en entier : 1 000 € accepté, 1 234 € refusé (au-delà du plafond de saisie), jamais lu « 234 € ».
    expect(lireConfirmation(base('1 000,00 €')).billets[0]!.prixCentimes).toBe(100000);
    expect(lireConfirmation(base('1 234,00 €'))).toEqual({ billets: [], illisibles: 1 });
    expect(lireConfirmation(base('74,00 EUR', ' Récapitulatif de votre paiement Total commande 336,00 €'))).toEqual({ billets: [], illisibles: 1 });
    expect(lireConfirmation(base('74,00 €', ' Frais 19,00 €')).billets[0]!.prixCentimes).toBe(7400);
    expect(lireConfirmation('Voyage 1 Marseille Saint-Charles Paris Gare de Lyon 50,00 € Aller : jeudi 3 février 2028 à 06:02'.normalize('NFD')).billets[0]!.trajets[0]!.date).toBe('2028-02-03');
    expect(lireConfirmation(base('74,00 €', ' Marie (30-59 ans)')).illisibles).toBe(1);
    expect(lireConfirmation(base('74,00 €', ' TGV INOUI 6100')).illisibles).toBe(1);
  });
  it('revue : colonnes ALLER et RETOUR inversées, remises dans l’ordre grâce aux horaires', () => {
    const h = validerHoraires({
      version: 1,
      genereLe: '2027-11-10',
      debut: '2027-12-13',
      fin: '2028-01-31',
      sources: [{ nom: 'SNCF', url: 'https://exemple.fr', licence: 'odc-odbl' }],
      trains: [
        { s: 'MP', n: '6136', o: 'TGV INOUI', gd: 'Marseille Saint-Charles', ga: 'Paris Gare de Lyon', d: 363, a: 562, j: [2] },
        { s: 'PM', n: '6123', o: 'TGV INOUI', gd: 'Paris Gare de Lyon', ga: 'Marseille Saint-Charles', d: 1058, a: 1257, j: [25] },
      ],
    });
    const texte = 'Voyage 1 Marseille Saint-Charles Paris Gare de Lyon 74,00 € Aller : mercredi 15 décembre 2027 à 06:03 Retour : vendredi 7 janvier 2028 à 17:38 RETOUR ALLER TGV INOUI 6123 | TARIF AVANTAGE ADULTE TGV INOUI 6136 | TARIF AVANTAGE ADULTE';
    const { deplacements } = appliquerConfirmation([], lireConfirmation(texte), h, nouvelId);
    expect(deplacements).toHaveLength(0); // aller et retour à trois semaines d'écart : pas de déplacement à créer
    const prevus = [nouveauDeplacement('d-aaaa', '2027-12-15', '2027-12-17'), nouveauDeplacement('d-bbbb', '2028-01-06', '2028-01-07')];
    const r = appliquerConfirmation(prevus, lireConfirmation(texte), h, nouvelId).deplacements;
    expect(r[0]!.aller.train).toMatchObject({ numero: '6136', arrivee: 562 });
    expect(r[1]!.retour.train).toMatchObject({ numero: '6123', arrivee: 1257 });
  });
  it('revue : deux déplacements le même jour : l’import répété retrouve le trajet déjà payé, sans payer l’autre', () => {
    const conf = lireConfirmation('Voyage 1 Marseille Saint-Charles Paris Gare de Lyon 74,00 € Aller : mercredi 15 décembre 2027 à 06:03 Retour : vendredi 7 janvier 2028 à 17:38 TGV INOUI 6136 TGV INOUI 6123');
    const prevus = [
      nouveauDeplacement('d-aaaa', '2027-12-15', '2027-12-17'),
      nouveauDeplacement('d-bbbb', '2027-12-15', '2027-12-16'),
      nouveauDeplacement('d-cccc', '2028-01-05', '2028-01-07'),
    ];
    const une = appliquerConfirmation(prevus, conf, null, nouvelId);
    const deux = appliquerConfirmation(une.deplacements, conf, null, nouvelId);
    expect(deux.rapport).toMatchObject({ payes: 0, dejaImportes: 2 });
    expect(deux.deplacements.filter((d) => d.aller.statut === 'paye')).toHaveLength(1);
  });
  it('revue : plafond de déplacements atteint : trajets signalés comme tels', () => {
    const pleins = Array.from({ length: 300 }, (_, i) => nouveauDeplacement(`d-${'abcdefghijklmnopqrstuvwxyz'[Math.floor(i / 26) % 26]}${'abcdefghijklmnopqrstuvwxyz'[i % 26]}zz`, '2026-01-05', '2026-01-06'));
    const { rapport } = appliquerConfirmation(pleins, lireConfirmation(miseEnPage), null, nouvelId);
    expect(rapport.horsPlafond).toHaveLength(8);
    expect(rapport.ignores).toHaveLength(0);
  });
  it('trajet sans déplacement possible (aller sans retour la même semaine) : ignoré et signalé', () => {
    const conf = lireConfirmation('Voyage 1 Marseille Saint-Charles Paris Gare de Lyon 45,00 € Aller : jeudi 4 février 2027 à 06:02 TGV INOUI 6136');
    const { deplacements, rapport } = appliquerConfirmation([], conf, null, nouvelId);
    expect(deplacements).toEqual([]);
    expect(rapport.ignores).toHaveLength(1);
  });
  it('train retrouvé dans les horaires (arrivée exacte), sinon durée type', () => {
    const h = validerHoraires({
      version: 1,
      genereLe: '2026-11-10',
      debut: '2027-12-13',
      fin: '2028-01-31',
      sources: [{ nom: 'SNCF', url: 'https://exemple.fr', licence: 'odc-odbl' }],
      trains: [{ s: 'MP', n: '6136', o: 'TGV INOUI', gd: 'Marseille Saint-Charles', ga: 'Paris Gare de Lyon', d: 363, a: 562, j: [2] }],
    });
    const conf = lireConfirmation(miseEnPage);
    const { deplacements } = appliquerConfirmation([], conf, h, nouvelId);
    expect(deplacements[0]!.aller.train).toEqual({ numero: '6136', operateur: 'TGV INOUI', depart: 363, arrivee: 562 });
    expect(deplacements[0]!.retour.train).toEqual({ numero: '6123', operateur: 'TGV INOUI', depart: 1058, arrivee: 1058 + DUREE_DEFAUT });
  });
});

describe('bilan des billets payés', () => {
  const t = (numero: string, depart: number, arrivee: number): TrainChoisi => ({ numero, operateur: 'TGV INOUI', depart, arrivee });
  it('coût par trajet, dîners à bord (arrivée après 21h30), économie Avantage minimale', () => {
    const d = (i: string, retour: TrainChoisi, prix: number): Deplacement => ({
      id: i,
      aller: { date: '2027-01-14', statut: 'paye', train: t('6136', 363, 562), prixCentimes: prix, tarif: 'avantage' },
      retour: { date: '2027-01-15', statut: 'paye', train: retour, prixCentimes: prix, tarif: 'avantage' },
    });
    const b = bilanPayes([d('d-aaaa', t('6153', 1090, 1276), 4200), d('d-bbbb', t('6127', 1118, 1320), 7000)], '2026-11-12', P, 30)!;
    expect(b).toMatchObject({ trajets: 4, avecPrix: 4, totalCentimes: 22400, moyenneCentimes: 5600, dinersABord: 1, coutDinersCentimes: 1000, auTarifAvantage: 4 });
    expect(b.economieAvantageCentimes).toBe(2 * (6000 - 4200) + 2 * (10000 - 7000));
    expect(bilanPayes([], '2026-11-12', P, 30)).toBeNull();
  });
  it('trajets passés exclus ; sans prix : comptés mais hors moyenne', () => {
    const l: Deplacement[] = [
      { id: 'd-aaaa', aller: { date: '2026-11-05', statut: 'paye', prixCentimes: 5000 }, retour: { date: '2026-11-06', statut: 'paye', prixCentimes: 5000 } },
      { id: 'd-bbbb', aller: { date: '2027-01-14', statut: 'paye' }, retour: { date: '2027-01-15', statut: 'paye', prixCentimes: 6000 } },
    ];
    expect(bilanPayes(l, '2026-11-12', P, 30)).toMatchObject({ trajets: 2, avecPrix: 1, totalCentimes: 6000, moyenneCentimes: 6000, auTarifAvantage: 0, economieAvantageCentimes: 0 });
  });
});
