/** Cartes Liberté et abonnements MAX ACTIF (EXG-10 : sourcés, datés, validés au chargement). */
import brut from './regles-abonnements.json';
import { validerAbonnements, type ReglesAbonnements } from '../domain/abonnements';

export const REGLES_ABONNEMENTS: ReglesAbonnements = validerAbonnements(brut);
