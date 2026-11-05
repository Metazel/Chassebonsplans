/** Règles de la carte Avantage Adulte (EXG-10 : sourcées, datées, validées au chargement). */
import brut from './regles-avantage.json';
import { validerRegles, type ReglesAvantage } from '../domain/croises';

export const REGLES_AVANTAGE: ReglesAvantage = validerRegles(brut);
