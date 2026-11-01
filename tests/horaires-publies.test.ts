/**
 * Contrôle du fichier d'horaires réellement publié (static/horaires.json), avec le validateur de l'appli.
 * En CI, ce test est rejoué après l'extraction des horaires réels : un fichier que l'appli rejetterait
 * ou qui serait incomplet n'est jamais publié.
 */
import { describe, expect, it } from 'vitest';
import brut from '../static/horaires.json';
import { ajouterJours, ecartJours, jourSemaine } from '../src/domain/dates';
import { proposer, validerHoraires } from '../src/domain/horaires';

const h = validerHoraires(brut);

describe('horaires publiés (static/horaires.json)', () => {
  it('lisibles en entier par l’appli : aucun train écarté', () => {
    expect(h.ecartes).toBe(0);
    expect(h.trains.length).toBeGreaterThan(0);
  });
  it('les deux sens, des sources https avec licence', () => {
    expect(new Set(h.trains.map((t) => t.sens))).toEqual(new Set(['MP', 'PM']));
    expect(h.sources.length).toBeGreaterThan(0);
    for (const s of h.sources) {
      expect(s.url.startsWith('https://')).toBe(true);
      expect(s.licence.length).toBeGreaterThan(0);
    }
  });
  it('au moins 4 semaines couvertes', () => {
    expect(ecartJours(h.debut, h.fin)).toBeGreaterThanOrEqual(28);
  });
  it('les jours ouvrés des 4 premières semaines, des trains dans les deux créneaux (hors fériés isolés)', () => {
    let ouvres = 0;
    let complets = 0;
    for (let i = 0; i < 28; i++) {
      const jour = ajouterJours(h.debut, i);
      if (jourSemaine(jour) > 4) continue;
      ouvres++;
      if (proposer(h, jour, 'MP').dansCreneau.length && proposer(h, jour, 'PM').dansCreneau.length) complets++;
    }
    expect(complets).toBeGreaterThanOrEqual(ouvres - 3);
  });
});
