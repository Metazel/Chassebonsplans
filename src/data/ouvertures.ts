/** Calendrier des ouvertures des ventes par opérateur (EXG-10 : sourcé, daté, validé au chargement). */
import brut from './ouvertures-ventes.json';
import { validerOuvertures, type ReferentielOuvertures } from '../domain/ventes';

export const OUVERTURES: ReferentielOuvertures = validerOuvertures(brut);
