/**
 * Chargement des horaires publiés avec l'appli (même origine, mis en cache par le service worker).
 * Version « fichier unique » : les horaires sont embarqués dans la page (aucune requête).
 */
import { validerHoraires, type Horaires } from '../domain/horaires';

export async function chargerHoraires(): Promise<Horaires> {
  if (!__PWA__) {
    const m = await import('../../static/horaires.json');
    return validerHoraires(m.default);
  }
  const r = await fetch('./horaires.json', { credentials: 'omit' });
  if (!r.ok) throw new Error(`horaires.json : ${r.status}`);
  return validerHoraires(await r.json());
}
