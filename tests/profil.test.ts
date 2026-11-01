import { describe, expect, it } from 'vitest';
import { LEVIERS, validerCatalogue } from '../src/data/leviers';
import brut from '../src/data/leviers.json';
import { contientNumeroCarte, luhn } from '../src/domain/securite';
import {
  FORMAT_EXPORT,
  TAILLE_MAX_IMPORT,
  aujourdhuiIso,
  estDateIso,
  etatValidite,
  exporter,
  importer,
  lireProfil,
  pourStockage,
  profilVide,
  rappelSauvegarde,
  validerProfil,
  type Profil,
} from '../src/domain/profil';
import { stockageMemoire } from '../src/state/stockage';

const IDS = new Set(LEVIERS.map((l) => l.id));

describe('catalogue des leviers (EXG-10)', () => {
  it('contient les leviers de David, chacun sourcé en https et daté', () => {
    for (const id of ['carte-voyageur-sncf', 'visa-premier', 'pass-ulys', 'carte-fnac-plus', 'carte-avantage-adulte']) expect(IDS.has(id)).toBe(true);
    for (const l of LEVIERS) {
      expect(l.source.startsWith('https://')).toBe(true);
      expect(estDateIso(l.verifieLe)).toBe(true);
    }
  });
  it('la carte Voyageur est présentée comme fidélité, pas comme réduction', () => {
    expect(LEVIERS.find((l) => l.id === 'carte-voyageur-sncf')!.effet).toMatch(/pas une carte de réduction/);
  });
  it('rejette doublons, catégorie inconnue, source non https', () => {
    const base = structuredClone(brut);
    base.leviers.push(structuredClone(base.leviers[0]!));
    expect(() => validerCatalogue(base)).toThrow(/id/);
    const cat = structuredClone(brut);
    (cat.leviers[0] as Record<string, unknown>).categorie = 'bateau';
    expect(() => validerCatalogue(cat)).toThrow(/catégorie/);
    const src = structuredClone(brut);
    src.leviers[0]!.source = 'http://exemple.fr';
    expect(() => validerCatalogue(src)).toThrow(/source/);
  });
});

describe('détection des numéros de carte (EXG-02)', () => {
  it('Luhn', () => {
    expect(luhn('79927398713')).toBe(true);
    expect(luhn('79927398710')).toBe(false);
  });
  it.each(['4111 1111 1111 1111', '4111-1111-1111-1111', '4111.1111.1111.1111', '4111/1111/1111/1111', 'ma carte 5555555555554444 merci', '9' + '4111111111111111' + '8'])('détecte %s', (t) => expect(contientNumeroCarte(t)).toBe(true));
  it('règle prudente : toute suite de 13 chiffres ou plus est refusée, Luhn valide ou non', () => {
    expect(contientNumeroCarte('4111 1111 1111 1112')).toBe(true);
    expect(contientNumeroCarte('1234567890123')).toBe(true);
    expect(contientNumeroCarte('123456789012')).toBe(false);
  });
  it.each(['21:45', '29,90', '0612345678', '2026-10-31', ''])('ignore %s', (t) => expect(contientNumeroCarte(t)).toBe(false));
});

describe('profil local : validation de tout ce qui est relu', () => {
  const ok: Profil = {
    version: 1,
    leviers: { 'visa-premier': { detenu: true }, 'carte-avantage-adulte': { detenu: true, finValidite: '2027-03-31' } },
    reglages: { trajet: '15', limite: '21:45', repas: '10', tolerance: '2' },
    derniereSauvegarde: '2026-10-31',
  };
  it('accepte un profil valide', () => expect(validerProfil(ok, IDS)).toEqual(ok));
  it('ignore et signale les leviers inconnus du catalogue', () => {
    const l = lireProfil({ version: 1, leviers: { inconnu: { detenu: true } } }, IDS);
    expect(l.profil.leviers).toEqual({});
    expect(l.ecartes).toEqual(['levier inconnu inconnu']);
  });
  it.each([
    ['version future', { version: 2, leviers: {} }],
    ['tableau', []],
    ['null', null],
  ])('refuse un profil inexploitable : %s', (_nom, p) => expect(() => lireProfil(p, IDS)).toThrow());
  it.each([
    ['leviers en tableau', { version: 1, leviers: [] }, 'leviers'],
    ['détenu non booléen', { version: 1, leviers: { 'visa-premier': { detenu: 'oui' } } }, 'levier visa-premier'],
    ['date impossible', { version: 1, leviers: { 'visa-premier': { detenu: true, finValidite: '2027-02-30' } } }, 'levier visa-premier'],
    ['réglage trop long', { version: 1, leviers: {}, reglages: { trajet: '1'.repeat(40), limite: '21:45', repas: '10', tolerance: '2' } }, 'réglages'],
    ['numéro de carte dans un réglage', { version: 1, leviers: {}, reglages: { trajet: '15', limite: '21:45', repas: '10', tolerance: '4111111111111111' } }, 'réglages'],
  ])('écarte sans tout perdre : %s', (_nom, p, ecarte) => {
    const avecUlys = { ...(p as object), leviers: Array.isArray((p as { leviers: unknown }).leviers) ? [] : { ...(p as { leviers: object }).leviers, 'pass-ulys': { detenu: true } } };
    const l = lireProfil(avecUlys, IDS);
    expect(l.ecartes).toContain(ecarte);
    if (ecarte !== 'leviers') expect(l.profil.leviers['pass-ulys']).toEqual({ detenu: true });
  });
  it('les leviers non détenus ne sont pas conservés', () => {
    expect(validerProfil({ version: 1, leviers: { 'visa-premier': { detenu: false, finValidite: '2027-01-01' } } }, IDS).leviers).toEqual({});
  });
});

describe('écriture et export : uniquement des données valides (EXG-02)', () => {
  it('pourStockage retire les réglages suspects et les leviers non détenus', () => {
    const sale = {
      version: 1 as const,
      leviers: { 'visa-premier': { detenu: false, finValidite: '2027-01-01' }, 'pass-ulys': { detenu: true } },
      reglages: { trajet: '15', limite: '21:45', repas: '10,00 euros', tolerance: '2' },
    };
    expect(pourStockage(sale)).toEqual({ version: 1, leviers: { 'pass-ulys': { detenu: true } } });
  });
  it('un export est toujours réimportable, même après une saisie invalide', () => {
    const p = { version: 1 as const, leviers: { 'pass-ulys': { detenu: true } }, reglages: { trajet: '15', limite: '21:45', repas: '4111111111111111', tolerance: '2' } };
    const texte = exporter(p, '2026-10-31');
    expect(texte).not.toContain('4111');
    expect(importer(texte, IDS).ecartes).toEqual([]);
  });
});

describe('stockage en mémoire (repli)', () => {
  it('lit, écrit par clé, efface tout', async () => {
    const s = stockageMemoire();
    expect(await s.lire()).toBeNull();
    await s.ecrire({ a: 1 });
    await s.ecrire({ b: 2 }, 'profil-illisible');
    expect(await s.lire()).toEqual({ a: 1 });
    expect(await s.lire('profil-illisible')).toEqual({ b: 2 });
    await s.effacer();
    expect(await s.lire()).toBeNull();
    expect(await s.lire('profil-illisible')).toBeNull();
  });
});

describe('sauvegarde et restauration (EXG-04)', () => {
  const p: Profil = { version: 1, leviers: { 'pass-ulys': { detenu: true } }, derniereSauvegarde: '2026-09-01' };
  it('aller-retour export → import sans perte (hors date de sauvegarde)', () => {
    const texte = exporter(p, '2026-10-31');
    expect(JSON.parse(texte).format).toBe(FORMAT_EXPORT);
    expect(importer(texte, IDS)).toEqual({ profil: { version: 1, leviers: { 'pass-ulys': { detenu: true } } }, ecartes: [] });
  });
  it('messages lisibles pour un fichier invalide', () => {
    expect(() => importer('pas du json', IDS)).toThrow(/JSON invalide/);
    expect(() => importer('{"format":"autre"}', IDS)).toThrow(/pas une sauvegarde/);
    expect(() => importer('x'.repeat(TAILLE_MAX_IMPORT + 1), IDS)).toThrow(/volumineux/);
    expect(() => importer('{"format":"chassebonsplans-export","profil":{"version":9}}', IDS)).toThrow(/version non prise en charge/);
  });
});

describe('alertes de validité et rappel de sauvegarde', () => {
  it('fin de validité : expirée, bientôt (≤ 30 j), valide', () => {
    expect(etatValidite('2026-10-30', '2026-10-31')).toBe('expire');
    expect(etatValidite('2026-10-31', '2026-10-31')).toBe('bientot');
    expect(etatValidite('2026-11-30', '2026-10-31')).toBe('bientot');
    expect(etatValidite('2026-12-01', '2026-10-31')).toBe('valide');
  });
  it('rappel : seulement avec des données, et plus de 30 jours après la dernière sauvegarde', () => {
    expect(rappelSauvegarde(profilVide(), '2026-10-31')).toBe(false);
    const p: Profil = { version: 1, leviers: { 'visa-premier': { detenu: true } } };
    expect(rappelSauvegarde(p, '2026-10-31')).toBe(true);
    expect(rappelSauvegarde({ ...p, derniereSauvegarde: '2026-10-01' }, '2026-10-31')).toBe(false);
    expect(rappelSauvegarde({ ...p, derniereSauvegarde: '2026-09-30' }, '2026-10-31')).toBe(true);
  });
  it('date du jour en heure de Paris (passage de minuit UTC)', () => {
    expect(aujourdhuiIso(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
    expect(aujourdhuiIso(new Date('2026-07-14T21:59:00Z'))).toBe('2026-07-14');
  });
});
