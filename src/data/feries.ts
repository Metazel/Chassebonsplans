/** Jours fériés métropolitains (EXG-07 : Etalab, Licence Ouverte 2.0, fichier embarqué). */
import brut from './jours-feries.json';
import { validerFeries, type Feries } from '../domain/feries';

export const FERIES: Feries = validerFeries(brut);
