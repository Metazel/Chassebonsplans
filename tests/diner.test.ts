import { describe, expect, it } from 'vitest';
import brut from '../src/data/parametres-cout.json';
import { REFERENTIEL_COUT, validerReferentiel } from '../src/data/parametres';
import { recommander } from '../src/domain/coutComplet';
import { CRENEAUX, heureDiner, premierPropose, proposer, validerHoraires } from '../src/domain/horaires';
import { clePrix, recommanderParPrix } from '../src/domain/prix';

const h = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const P = REFERENTIEL_COUT.parametres;
const DINER = REFERENTIEL_COUT.arriveeDinerGare;

describe('retours à l’heure du dîner (décision du 08/11/2026)', () => {
  it('référentiel : arrivée en gare à privilégier de 20:15 à 21:30, aucun départ avant 17:30', () => {
    expect(DINER).toEqual({ de: h('20:15'), a: h('21:30') });
    expect(REFERENTIEL_COUT.retourPasAvantMin).toBe(h('17:30'));
    // La fin de la fenêtre coïncide avec la limite du dîner à la maison (21h45 moins 15 min de trajet).
    expect(DINER.a).toBe(P.limiteDinerDomicileMin - P.trajetGareDomicileMin);
    expect(() => validerReferentiel({ ...brut, arriveeDinerGare: { de: '21:30', a: '20:15' } })).toThrow();
    expect(() => validerReferentiel({ ...brut, retourPasAvant: 'tôt' })).toThrow();
  });
  it('fenêtre du dîner, bornes comprises', () => {
    expect(heureDiner({ arrivee: h('20:14') }, DINER)).toBe('avant');
    expect(heureDiner({ arrivee: h('20:15') }, DINER)).toBe('diner');
    expect(heureDiner({ arrivee: h('21:30') }, DINER)).toBe('diner');
    expect(heureDiner({ arrivee: h('21:31') }, DINER)).toBe('apres');
  });

  const jeu = validerHoraires({
    version: 1,
    genereLe: '2026-11-01',
    debut: '2026-11-02',
    fin: '2026-11-08',
    sources: [{ nom: 'test', url: 'https://example.org', licence: 'lov2' }],
    trains: [
      { s: 'PM', n: '1', o: 'TGV INOUI', gd: 'Paris', ga: 'Marseille', d: h('16:00'), a: h('19:10'), j: [0, 1] },
      { s: 'PM', n: '2', o: 'TGV INOUI', gd: 'Paris', ga: 'Marseille', d: h('17:30'), a: h('20:10'), j: [0] },
      { s: 'PM', n: '3', o: 'TGV INOUI', gd: 'Paris', ga: 'Marseille', d: h('17:38'), a: h('20:57'), j: [0] },
      { s: 'PM', n: '4', o: 'TGV INOUI', gd: 'Paris', ga: 'Marseille', d: h('20:30'), a: h('23:50'), j: [0, 1] },
    ],
  });
  it('présélection du retour : le premier qui arrive à l’heure du dîner (17:38 → 20:57 plutôt que 17:30 → 20:10)', () => {
    const p = proposer(jeu, '2026-11-02', 'PM', CRENEAUX.PM, REFERENTIEL_COUT.retourPasAvantMin);
    expect(premierPropose(p, DINER)?.numero).toBe('3');
    expect(premierPropose(p)?.numero).toBe('2');
  });
  it('jour sans train dans le créneau : jamais de retour avant 17:30, seulement les plus proches après', () => {
    const p = proposer(jeu, '2026-11-03', 'PM', CRENEAUX.PM, REFERENTIEL_COUT.retourPasAvantMin);
    expect(p.proches.map((t) => t.numero)).toEqual(['4']);
    expect(proposer(jeu, '2026-11-03', 'PM').proches.map((t) => t.numero)).toEqual(['1', '4']);
  });
  it('à égalité de coût complet, le train à l’heure du dîner l’emporte sur un plus précoce', () => {
    const trains = [
      { id: 'tot', depart: h('17:30'), arrivee: h('20:10'), prixCentimes: 4000 },
      { id: 'diner', depart: h('17:38'), arrivee: h('20:57'), prixCentimes: 4100 },
    ];
    expect(recommander(trains, P)?.retenu.id).toBe('tot');
    const r = recommander(trains, P, (e) => e.arriveeGare >= DINER.de && e.arriveeGare <= DINER.a);
    expect(r?.retenu.id).toBe('diner');
    expect(r?.motif).toBe('egalite-prefere');
    expect(r?.concurrent?.id).toBe('tot');
  });
  it('au-delà de la tolérance, le coût complet reste le critère (règle du sandwich inchangée)', () => {
    const a = { numero: '6123', depart: h('17:38'), arrivee: h('20:57') };
    const b = { numero: '6127', depart: h('18:38'), arrivee: h('22:00') };
    const vus = [
      { train: clePrix(a), centimes: 4000, le: '2026-11-08' },
      { train: clePrix(b), centimes: 2500, le: '2026-11-08' },
    ];
    // 6127 : 25 € + 10 € de dîner à bord = 35 € < 40 € - 2 € : il reste recommandé.
    expect(recommanderParPrix([a, b], vus, P, '2026-11-08', DINER)?.retenu.id).toBe(clePrix(b));
    // Le cas « sandwich » : 30 € + 10 € contre 40 € → le 6123, à l'heure du dîner.
    vus[1]!.centimes = 3000;
    expect(recommanderParPrix([a, b], vus, P, '2026-11-08', DINER)?.retenu.id).toBe(clePrix(a));
  });
});
