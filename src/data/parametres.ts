/** Paramètres par défaut du coût complet, lus depuis le référentiel JSON et validés. */
import brut from './parametres-cout.json';
import { lireHeure } from '../domain/heure';
import type { ParametresCout } from '../domain/coutComplet';
import type { MetaReferentiel } from '../domain/referentiel';

export interface ReferentielCout {
  parametres: ParametresCout;
  /** Retour : arrivée en gare à privilégier (heure du dîner), en minutes. */
  arriveeDinerGare: { de: number; a: number };
  /** Retour : aucun départ proposé avant cette heure (minutes). */
  retourPasAvantMin: number;
  /** Retour : supplément de coût complet accepté pour arriver à l'heure du dîner, en centimes. */
  supplementDinerMaxCentimes: number;
  meta: MetaReferentiel;
}

function nombre(v: unknown, min: number, max: number, nom: string, entier = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (entier && !Number.isInteger(v))) {
    throw new Error(`Référentiel coût complet invalide : ${nom}`);
  }
  return v;
}

export function validerReferentiel(src: unknown): ReferentielCout {
  if (typeof src !== 'object' || src === null) throw new Error('Référentiel coût complet invalide');
  const r = src as Record<string, unknown>;
  const limite = typeof r.limiteDinerDomicile === 'string' ? lireHeure(r.limiteDinerDomicile) : null;
  if (limite === null) throw new Error('Référentiel coût complet invalide : limiteDinerDomicile');
  if (typeof r.version !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.version)) throw new Error('Référentiel coût complet invalide : version');
  const meta = r.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta.source !== 'string' || typeof meta.verifieLe !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(meta.verifieLe)) {
    throw new Error('Référentiel coût complet invalide : meta');
  }
  const diner = r.arriveeDinerGare as Record<string, unknown> | undefined;
  const dinerDe = typeof diner?.de === 'string' ? lireHeure(diner.de) : null;
  const dinerA = typeof diner?.a === 'string' ? lireHeure(diner.a) : null;
  if (dinerDe === null || dinerA === null || dinerA <= dinerDe) throw new Error('Référentiel coût complet invalide : arriveeDinerGare');
  const pasAvant = typeof r.retourPasAvant === 'string' ? lireHeure(r.retourPasAvant) : null;
  if (pasAvant === null) throw new Error('Référentiel coût complet invalide : retourPasAvant');
  const trajet = nombre(r.trajetGareDomicileMin, 0, 180, 'trajetGareDomicileMin', true);
  // La fin de la fenêtre du dîner ne peut pas dépasser l'arrivée en gare qui permet encore de dîner à la maison.
  if (dinerA > limite - trajet) throw new Error('Référentiel coût complet invalide : arriveeDinerGare après la limite du dîner');
  return {
    arriveeDinerGare: { de: dinerDe, a: dinerA },
    retourPasAvantMin: pasAvant,
    supplementDinerMaxCentimes: Math.round(nombre(r.supplementDinerMaxEuros, 0, 500, 'supplementDinerMaxEuros') * 100),
    parametres: {
      trajetGareDomicileMin: nombre(r.trajetGareDomicileMin, 0, 180, 'trajetGareDomicileMin', true),
      limiteDinerDomicileMin: limite,
      coutRepasCentimes: Math.round(nombre(r.coutRepasEuros, 0, 100, 'coutRepasEuros') * 100),
      toleranceCentimes: Math.round(nombre(r.toleranceEuros, 0, 50, 'toleranceEuros') * 100),
    },
    meta: { source: meta.source, verifieLe: meta.verifieLe },
  };
}

export const REFERENTIEL_COUT: ReferentielCout = validerReferentiel(brut);
