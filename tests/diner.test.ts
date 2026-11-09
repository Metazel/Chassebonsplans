import { describe, expect, it } from 'vitest';
import brut from '../src/data/parametres-cout.json';
import { REFERENTIEL_COUT, validerReferentiel } from '../src/data/parametres';
import { recommander } from '../src/domain/coutComplet';
import { CRENEAUX, fenetreDiner, heureDiner, premierPropose, proposer, validerHoraires } from '../src/domain/horaires';
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
    expect(() => validerReferentiel({ ...brut, arriveeDinerGare: { de: '20:15', a: '21:40' } })).toThrow(/limite du dîner/);
  });
  it('revue : la fenêtre du dîner suit les réglages (jamais « à l’heure du dîner » et « dîner à bord » à la fois)', () => {
    expect(fenetreDiner(DINER, { ...P, trajetGareDomicileMin: 30 })).toEqual({ de: h('20:15'), a: h('21:15') });
    expect(fenetreDiner(DINER, P)).toEqual(DINER);
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
  it('revue : « pas avant » s’applique aussi au créneau (paramètre plus tardif que le créneau)', () => {
    const p = proposer(jeu, '2026-11-02', 'PM', CRENEAUX.PM, h('17:35'));
    expect(p.dansCreneau.map((t) => t.numero)).toEqual(['3']);
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
    const r = recommander(trains, P, { estPrefere: (e) => e.arriveeGare >= DINER.de && e.arriveeGare <= DINER.a, supplementMaxCentimes: 200 });
    expect(r?.retenu.id).toBe('diner');
    expect(r?.motif).toBe('egalite-prefere');
    expect(r?.concurrent?.id).toBe('tot');
  });
  it('décision du 09/11 : jusqu’à 30 € de plus (coût complet) pour arriver à l’heure du dîner, bornes comprises', () => {
    const DIN = { fenetre: DINER, supplementMaxCentimes: REFERENTIEL_COUT.supplementDinerMaxCentimes };
    expect(REFERENTIEL_COUT.supplementDinerMaxCentimes).toBe(3000);
    const a = { numero: '6123', depart: h('17:38'), arrivee: h('20:57') };
    const b = { numero: '6127', depart: h('18:38'), arrivee: h('22:00') };
    const vus = (pa: number, pb: number) => [
      { train: clePrix(a), centimes: pa, le: '2026-11-08' },
      { train: clePrix(b), centimes: pb, le: '2026-11-08' },
    ];
    // 6127 : 25 € + 10 € de dîner à bord = 35 € ; 6123 à 40 € : 5 € de plus, à l'heure du dîner → 6123.
    const r = recommanderParPrix([a, b], vus(4000, 2500), P, '2026-11-08', DIN);
    expect(r?.retenu.id).toBe(clePrix(a));
    expect(r?.motif).toBe('prefere');
    // 30 € de plus pile : retenu ; 30,01 € de plus : le moins cher.
    expect(recommanderParPrix([a, b], vus(6500, 2500), P, '2026-11-08', DIN)?.retenu.id).toBe(clePrix(a));
    expect(recommanderParPrix([a, b], vus(6501, 2500), P, '2026-11-08', DIN)?.retenu.id).toBe(clePrix(b));
    // Sans préférence (aller, comparateur sans fenêtre) : la règle du coût complet seule.
    expect(recommanderParPrix([a, b], vus(4000, 2500), P, '2026-11-08')?.retenu.id).toBe(clePrix(b));
    // Le cas « sandwich » reste vrai : 30 € + 10 € contre 40 € → le 6123.
    expect(recommanderParPrix([a, b], vus(4000, 3000), P, '2026-11-08', DIN)?.retenu.id).toBe(clePrix(a));
  });
  it('revue : le départage à 2 € près entre retours à l’heure du dîner ne franchit jamais les 30 €', () => {
    const pref = { estPrefere: (e: { arriveeGare: number }) => e.arriveeGare >= DINER.de && e.arriveeGare <= DINER.a, supplementMaxCentimes: 3000 };
    const trains = [
      { id: 'tard', depart: h('19:38'), arrivee: h('23:06'), prixCentimes: 3000 }, // 30 € + 10 € de dîner à bord = 40 €
      { id: 'b', depart: h('18:10'), arrivee: h('21:16'), prixCentimes: 7000 }, // 30 € de plus
      { id: 'a', depart: h('17:38'), arrivee: h('20:57'), prixCentimes: 7200 }, // 32 € de plus, plus tôt
    ];
    const r = recommander(trains, P, pref);
    expect(r?.retenu.id).toBe('b');
    expect(r?.motif).toBe('prefere');
    expect(r?.concurrent?.id).toBe('tard');
    expect(r?.supplementMaxCentimes).toBe(3000);
  });
  it('tolérance réglée au-dessus du supplément : les deux trains sont à égalité, le plus tôt l’emporte', () => {
    const pref = { estPrefere: (e: { arriveeGare: number }) => e.arriveeGare >= DINER.de && e.arriveeGare <= DINER.a, supplementMaxCentimes: 3000 };
    const r = recommander(
      [
        { id: 'tard', depart: h('19:38'), arrivee: h('23:06'), prixCentimes: 3000 },
        { id: 'diner', depart: h('17:38'), arrivee: h('20:57'), prixCentimes: 7500 },
      ],
      { ...P, toleranceCentimes: 4000 },
      pref,
    );
    expect(r?.retenu.id).toBe('diner');
    expect(r?.motif).toBe('egalite-plus-tot');
  });
  it('un seul train à l’heure du dîner : motif « seul »', () => {
    const pref = { estPrefere: () => true, supplementMaxCentimes: 3000 };
    expect(recommander([{ id: 'x', depart: h('17:38'), arrivee: h('20:57'), prixCentimes: 4000 }], P, pref)?.motif).toBe('seul');
  });
  it.each([[-1], [501], ['30'], [undefined], [Number.NaN], [1]])('supplément invalide refusé : %s', (v) => {
    expect(() => validerReferentiel({ ...brut, supplementDinerMaxEuros: v })).toThrow();
  });
  it('entre deux retours à l’heure du dîner, le moins cher, puis à égalité le plus tôt', () => {
    const pref = { estPrefere: (e: { arriveeGare: number }) => e.arriveeGare >= DINER.de && e.arriveeGare <= DINER.a, supplementMaxCentimes: 3000 };
    const trains = [
      { id: 'a', depart: h('17:38'), arrivee: h('20:57'), prixCentimes: 5000 },
      { id: 'b', depart: h('18:10'), arrivee: h('21:16'), prixCentimes: 4000 },
      { id: 'c', depart: h('19:38'), arrivee: h('23:06'), prixCentimes: 1500 },
    ];
    expect(recommander(trains, P, pref)?.retenu.id).toBe('b');
    expect(recommander([{ ...trains[0]!, prixCentimes: 4100 }, trains[1]!, trains[2]!], P, pref)?.retenu.id).toBe('a');
  });
});
