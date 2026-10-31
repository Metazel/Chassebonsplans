/**
 * Lecture et validation des saisies (hors interface, donc testable).
 * Principe : une recommandation n'est jamais calculée sur des données que l'utilisateur ne voit pas
 * (train incomplet signalé, réglage invalide = calcul suspendu, pas de repli silencieux).
 */
import { arriveeApresDepart, lireHeure } from './heure';
import { lireMontant } from './argent';
import type { ParametresCout, TrainValide } from './coutComplet';

export interface LigneTrain {
  id: string;
  depart: string;
  arrivee: string;
  prix: string;
}

export interface ErreursLigne {
  depart?: string;
  arrivee?: string;
  prix?: string;
}

export type EtatLigne = 'vide' | 'incomplet' | 'invalide' | 'valide';

export interface LigneLue {
  etat: EtatLigne;
  train: TrainValide | null;
  erreurs: ErreursLigne;
}

/** Durée de trajet vraisemblable : de 30 min à 12 h. */
export const DUREE_MIN = 30;
export const DUREE_MAX = 12 * 60;

export function lireLigne(l: LigneTrain): LigneLue {
  const erreurs: ErreursLigne = {};
  const remplis = [l.depart.trim(), l.arrivee.trim(), l.prix.trim()].filter(Boolean).length;
  if (remplis === 0) return { etat: 'vide', train: null, erreurs };
  const depart = l.depart.trim() ? lireHeure(l.depart) : null;
  const arrivee = l.arrivee.trim() ? lireHeure(l.arrivee) : null;
  const prix = l.prix.trim() ? lireMontant(l.prix) : null;
  if (l.depart.trim() && depart === null) erreurs.depart = 'Heure invalide : indiquez par exemple 19:00.';
  if (l.arrivee.trim() && arrivee === null) erreurs.arrivee = 'Heure invalide : indiquez par exemple 22:00.';
  if (l.prix.trim() && prix === null) erreurs.prix = 'Prix invalide : entre 0 et 1 000 €, par exemple 29,90.';
  if (depart !== null && arrivee !== null && !erreurs.arrivee) {
    const duree = arriveeApresDepart(depart, arrivee) - depart;
    if (duree < DUREE_MIN || duree > DUREE_MAX) {
      erreurs.arrivee = 'Trajet invraisemblable : la durée doit être comprise entre 30 min et 12 h.';
    }
  }
  if (Object.keys(erreurs).length > 0) return { etat: 'invalide', train: null, erreurs };
  if (depart === null || arrivee === null || prix === null) return { etat: 'incomplet', train: null, erreurs };
  return { etat: 'valide', train: { id: l.id, depart, arrivee, prixCentimes: prix }, erreurs };
}

export interface Reglages {
  trajet: string;
  limite: string;
  repas: string;
  tolerance: string;
}

export type ErreursReglages = Partial<Record<keyof Reglages, string>>;

/** Paramètres lus, ou null si un réglage est invalide (le calcul est alors suspendu). */
export function lireReglages(r: Reglages): { parametres: ParametresCout | null; erreurs: ErreursReglages } {
  const erreurs: ErreursReglages = {};
  const trajet = /^\d{1,3}$/.test(r.trajet.trim()) ? Number(r.trajet) : NaN;
  if (!(trajet >= 0 && trajet <= 180)) erreurs.trajet = 'Entre 0 et 180 minutes, nombre entier.';
  const limite = lireHeure(r.limite);
  if (limite === null) erreurs.limite = 'Une heure, par exemple 21:45.';
  const repas = lireMontant(r.repas, 100);
  if (repas === null) erreurs.repas = 'Entre 0 et 100 €.';
  const tolerance = lireMontant(r.tolerance, 50);
  if (tolerance === null) erreurs.tolerance = 'Entre 0 et 50 €.';
  if (limite === null || repas === null || tolerance === null || Object.keys(erreurs).length > 0) {
    return { parametres: null, erreurs };
  }
  return {
    parametres: { trajetGareDomicileMin: trajet, limiteDinerDomicileMin: limite, coutRepasCentimes: repas, toleranceCentimes: tolerance },
    erreurs,
  };
}
