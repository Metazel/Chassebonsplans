import { describe, expect, it } from 'vitest';
import { formaterHeure, lireHeure } from '../src/domain/heure';
import { formaterMontant, lireMontant } from '../src/domain/argent';
import { estAReverifier } from '../src/domain/referentiel';
import { REFERENTIEL_COUT, validerReferentiel } from '../src/data/parametres';

describe('heures', () => {
  it.each([
    ['21:45', 1305],
    ['21h45', 1305],
    ['9:05', 545],
    [' 00:00 ', 0],
    ['23:59', 1439],
  ])('lit %s', (s, v) => expect(lireHeure(s)).toBe(v));
  it.each(['', '24:00', '12:60', 'abc', '12:5', '1245', '-1:00', '21:45; drop'])('refuse %s', (s) => expect(lireHeure(s)).toBeNull());
  it('formate le lendemain', () => expect(formaterHeure(1440 + 70)).toBe('01:10 (+1 j)'));
});

describe('montants', () => {
  it.each([
    ['29,90', 2990],
    ['29.9', 2990],
    ['30', 3000],
    ['30 €', 3000],
    ['0', 0],
    ['1000', 100000],
  ])('lit %s', (s, v) => expect(lireMontant(s)).toBe(v));
  it.each(['', '-5', '1000,01', '12,345', 'dix', '1e3', '4970123412341234'])('refuse %s', (s) => expect(lireMontant(s)).toBeNull());
  it('formate en euros', () => expect(formaterMontant(2990).replace(/\s/g, ' ')).toBe('29,90 €'));
});

describe('référentiel versionné (EXG-10)', () => {
  it('les valeurs par défaut sont celles du cadrage', () => {
    expect(REFERENTIEL_COUT.parametres).toEqual({ trajetGareDomicileMin: 15, limiteDinerDomicileMin: 1305, coutRepasCentimes: 1000, toleranceCentimes: 200 });
    expect(REFERENTIEL_COUT.meta.verifieLe).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('rejette un référentiel incomplet ou hors bornes', () => {
    expect(() => validerReferentiel(null)).toThrow();
    expect(() => validerReferentiel({ version: '2026-10-31', trajetGareDomicileMin: 15, limiteDinerDomicile: '25:00', coutRepasEuros: 10, toleranceEuros: 2, meta: { source: 's', verifieLe: '2026-10-31' } })).toThrow();
    expect(() => validerReferentiel({ trajetGareDomicileMin: 999, limiteDinerDomicile: '21:45', coutRepasEuros: 10, toleranceEuros: 2, meta: { source: 's', verifieLe: '2026-10-31' } })).toThrow();
    expect(() => validerReferentiel({ trajetGareDomicileMin: 15, limiteDinerDomicile: '21:45', coutRepasEuros: 10, toleranceEuros: 2 })).toThrow();
  });
  it('signale une règle non revérifiée depuis plus de 6 mois', () => {
    expect(estAReverifier('2026-10-31', new Date(2027, 3, 30))).toBe(false);
    expect(estAReverifier('2026-10-31', new Date(2027, 4, 2))).toBe(true);
    expect(estAReverifier('pas une date', new Date())).toBe(true);
  });
});
