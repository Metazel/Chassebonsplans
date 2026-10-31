import { describe, expect, it } from 'vitest';
import { lireLigne, lireReglages } from '../src/domain/saisie';
import { estAReverifier } from '../src/domain/referentiel';
import { validerReferentiel } from '../src/data/parametres';

const ligne = (depart: string, arrivee: string, prix: string) => ({ id: 't1', depart, arrivee, prix });

describe('lecture d’une ligne de train', () => {
  it('vide : ignorée sans erreur', () => expect(lireLigne(ligne('', '', '  ')).etat).toBe('vide'));
  it('incomplète : signalée, sans erreur affichée', () => {
    const l = lireLigne(ligne('', '', '5'));
    expect(l.etat).toBe('incomplet');
    expect(l.erreurs).toEqual({});
  });
  it('valide', () => expect(lireLigne(ligne('19:00', '22:00', '29,90')).train).toEqual({ id: 't1', depart: 1140, arrivee: 1320, prixCentimes: 2990 }));
  it('prix à 0 € accepté (abonnement)', () => expect(lireLigne(ligne('19:00', '22:00', '0')).etat).toBe('valide'));
  it('trajet de 0 minute refusé', () => expect(lireLigne(ligne('19:00', '19:00', '30')).erreurs.arrivee).toMatch(/invraisemblable/));
  it('départ et arrivée inversés (21 h de trajet) refusés', () => expect(lireLigne(ligne('22:00', '19:00', '30')).etat).toBe('invalide'));
  it('passage de minuit vraisemblable accepté', () => expect(lireLigne(ligne('22:30', '01:10', '20')).etat).toBe('valide'));
  it('numéro de carte bancaire refusé comme prix', () => expect(lireLigne(ligne('19:00', '22:00', '4970 1234 1234 1234')).etat).toBe('invalide'));
});

describe('lecture des réglages : pas de repli silencieux', () => {
  const ok = { trajet: '15', limite: '21:45', repas: '10', tolerance: '2' };
  it('valides', () => expect(lireReglages(ok).parametres).toEqual({ trajetGareDomicileMin: 15, limiteDinerDomicileMin: 1305, coutRepasCentimes: 1000, toleranceCentimes: 200 }));
  it.each([
    ['tolerance', 'abc'],
    ['limite', ''],
    ['trajet', '15.5'],
    ['repas', '150'],
  ] as const)('%s = %s → calcul suspendu', (champ, valeur) => {
    const r = lireReglages({ ...ok, [champ]: valeur });
    expect(r.parametres).toBeNull();
    expect(r.erreurs[champ]).toBeTruthy();
  });
});

describe('référentiel : bornes de dates et de valeurs', () => {
  it('fin de mois : 31/08 + 6 mois = fin février', () => {
    expect(estAReverifier('2026-08-31', new Date(2027, 1, 28, 12))).toBe(false);
    expect(estAReverifier('2026-08-31', new Date(2027, 2, 1, 12))).toBe(true);
  });
  it('décimales refusées pour une durée en minutes', () => {
    expect(() => validerReferentiel({ version: '2026-10-31', trajetGareDomicileMin: 15.5, limiteDinerDomicile: '21:45', coutRepasEuros: 10, toleranceEuros: 2, meta: { source: 's', verifieLe: '2026-10-31' } })).toThrow();
  });
  it('version et date de vérification obligatoires au format ISO', () => {
    expect(() => validerReferentiel({ trajetGareDomicileMin: 15, limiteDinerDomicile: '21:45', coutRepasEuros: 10, toleranceEuros: 2, meta: { source: 's', verifieLe: '2026-10-31' } })).toThrow();
    expect(() => validerReferentiel({ version: '2026-10-31', trajetGareDomicileMin: 15, limiteDinerDomicile: '21:45', coutRepasEuros: 10, toleranceEuros: 2, meta: { source: 's', verifieLe: '31/10/2026' } })).toThrow();
  });
});
