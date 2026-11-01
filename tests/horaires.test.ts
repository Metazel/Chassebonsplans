import { describe, expect, it } from 'vitest';
import brut from '../static/horaires.json';
import { REFERENTIEL_COUT } from '../src/data/parametres';
import {
  AGE_MAX_HORAIRES,
  CRENEAUX,
  ageHoraires,
  canalVente,
  cleTrain,
  couvre,
  proposer,
  repasABord,
  sourcesAbsentes,
  texteRecherche,
  trainsDuJour,
  validerHoraires,
  villeGare,
  type Horaires,
} from '../src/domain/horaires';

const H = validerHoraires(brut);
const P = REFERENTIEL_COUT.parametres;
const numeros = (ts: { numero: string }[]) => ts.map((t) => t.numero);

/** Petit jeu d'horaires construit à la main pour les cas limites. */
function jeu(trains: { s: 'MP' | 'PM'; n: string; d: number; a: number; j?: number[] }[]): Horaires {
  return validerHoraires({
    version: 1,
    genereLe: '2026-11-01',
    debut: '2026-11-02',
    fin: '2026-11-08',
    sources: [{ nom: 'test', url: 'https://example.org', licence: 'lov2' }],
    trains: trains.map((t) => ({ s: t.s, n: t.n, o: 'TGV INOUI', gd: 'A', ga: 'B', d: t.d, a: t.a, j: t.j ?? [0] })),
  });
}

describe('validation des horaires publiés', () => {
  it('accepte l’échantillon de démonstration', () => {
    expect(H.trains.length).toBeGreaterThan(5);
    expect(H.sources[0]?.licence).toBe('odc-odbl');
  });
  it.each([
    ['version inconnue', { ...brut, version: 2 }],
    ['date impossible', { ...brut, debut: '2026-02-30' }],
    ['période inversée', { ...brut, debut: '2027-02-01' }],
    ['source non https', { ...brut, sources: [{ ...brut.sources[0], url: 'javascript:alert(1)' }] }],
    ['trop de trains', { ...brut, trains: Array.from({ length: 5001 }, () => brut.trains[0]) }],
    ['pas un objet', null],
  ])('refuse le fichier : %s', (_n, v) => {
    expect(() => validerHoraires(v)).toThrow();
  });
  it.each([
    ['sens inconnu', { s: 'XX' }],
    ['numéro vide', { n: '' }],
    ['arrivée avant départ', { d: 600, a: 500 }],
    ['heure hors bornes', { a: 5000 }],
    ['jour négatif', { j: [-1] }],
    ['texte trop long', { gd: 'x'.repeat(81) }],
    ['suite de chiffres type carte', { gd: '4111 1111 1111 1111' }],
  ])('écarte le seul train invalide, garde les autres : %s', (_n, defaut) => {
    const h = validerHoraires({ ...brut, trains: [...brut.trains, { ...brut.trains[0], ...defaut }] });
    expect(h.ecartes).toBe(1);
    expect(h.trains).toHaveLength(brut.trains.length);
  });
});

describe('trains du jour et créneaux (cadrage v2 : aller 9h00-9h40, retour 17h30-20h00)', () => {
  it('un mercredi : tous les opérateurs dans les créneaux, triés par départ', () => {
    const aller = proposer(H, '2026-11-04', 'MP');
    expect(numeros(aller.dansCreneau)).toEqual(['6136', '7804']); // 09:22 et 09:39 ; 09:46 (Trenitalia) exclu
    const retour = proposer(H, '2026-11-04', 'PM');
    expect(numeros(retour.dansCreneau)).toEqual(['6123', '7821', '6153', '6119', '6127', '6129']); // départs 17:38 à 19:38
    expect(retour.dansCreneau.map((t) => t.operateur)).toContain('Trenitalia (Frecciarossa)');
    expect(retour.dansCreneau.map((t) => t.operateur)).toContain('OUIGO');
  });
  it('un jour férié (11 novembre) : seuls les trains quotidiens circulent', () => {
    const jour = numeros(trainsDuJour(H, '2026-11-11', 'MP'));
    expect(jour).not.toContain('6136');
    expect(jour).toContain('6102');
  });
  it('rien dans le créneau : deux trains les plus proches de chaque côté', () => {
    const p = proposer(H, '2026-11-11', 'MP');
    expect(p.dansCreneau).toEqual([]);
    expect(numeros(p.proches)).toEqual(['6102', '6104', '6106']); // avant : 08:38, 09:46 est après, 10:22 après
  });
  it('bornes du créneau comprises', () => {
    const h = jeu([
      { s: 'MP', n: '1', d: 300, a: CRENEAUX.MP.de },
      { s: 'MP', n: '2', d: 300, a: CRENEAUX.MP.a },
      { s: 'MP', n: '3', d: 300, a: CRENEAUX.MP.a + 1 },
      { s: 'PM', n: '4', d: CRENEAUX.PM.de, a: 1300 },
      { s: 'PM', n: '5', d: CRENEAUX.PM.a, a: 1380 },
      { s: 'PM', n: '6', d: CRENEAUX.PM.de - 1, a: 1300 },
    ]);
    expect(numeros(proposer(h, '2026-11-02', 'MP').dansCreneau)).toEqual(['1', '2']);
    expect(numeros(proposer(h, '2026-11-02', 'PM').dansCreneau)).toEqual(['4', '5']);
  });
  it('train de nuit (arrivée le lendemain) jamais proposé pour l’aller du jour', () => {
    const h = jeu([
      { s: 'MP', n: '5772', d: 21 * 60, a: 24 * 60 + 8 * 60 + 50 },
      { s: 'MP', n: '1', d: 6 * 60, a: 10 * 60 },
    ]);
    expect(numeros(proposer(h, '2026-11-02', 'MP').proches)).toEqual(['1']);
  });
  it('couverture par source : la source en retard est signalée au-delà de sa fin', () => {
    const h = validerHoraires({
      ...brut,
      sources: [
        { nom: 'SNCF Voyageurs', url: 'https://example.org/a', licence: 'odc-odbl', fin: '2027-01-31' },
        { nom: 'Trenitalia France', url: 'https://example.org/b', licence: 'lov2', fin: '2026-12-11' },
      ],
    });
    expect(sourcesAbsentes(h, '2026-12-11')).toEqual([]);
    expect(sourcesAbsentes(h, '2026-12-12')).toEqual(['Trenitalia France']);
    expect(sourcesAbsentes(H, '2027-01-31')).toEqual([]);
    expect(() => validerHoraires({ ...brut, sources: [{ ...brut.sources[0], fin: 'demain' }] })).toThrow();
  });
  it('âge des horaires publiés', () => {
    expect(ageHoraires(H, '2026-11-15')).toBe(14);
    expect(ageHoraires(H, '2026-11-16')).toBeGreaterThan(AGE_MAX_HORAIRES);
  });
  it('couverture : dates hors période non publiées', () => {
    expect(couvre(H, '2026-11-02')).toBe(true);
    expect(couvre(H, '2027-01-31')).toBe(true);
    expect(couvre(H, '2026-11-01')).toBe(false);
    expect(couvre(H, '2027-02-01')).toBe(false);
    expect(trainsDuJour(H, '2027-02-01', 'MP')).toEqual([]);
  });
});

describe('retour : dîner à bord (même règle que le coût complet, 21h45 au domicile)', () => {
  it('arrivée 21:30 → chez soi 21:45 : pas de repas (borne comprise)', () => {
    expect(repasABord({ depart: 18 * 60, arrivee: 21 * 60 + 30 }, P)).toBe(false);
  });
  it('arrivée 21:31 → repas à bord', () => {
    expect(repasABord({ depart: 18 * 60, arrivee: 21 * 60 + 31 }, P)).toBe(true);
  });
  it('arrivée après minuit → repas à bord', () => {
    expect(repasABord({ depart: 20 * 60, arrivee: 24 * 60 + 10 }, P)).toBe(true);
  });
  it('échantillon : 6119 (21:53) et 6127 (22:00) font dîner à bord, 6153 (21:16) non', () => {
    const r = proposer(H, '2026-11-04', 'PM').dansCreneau;
    const repas = Object.fromEntries(r.map((t) => [t.numero, repasABord(t, P)]));
    expect(repas).toMatchObject({ '6153': false, '6119': true, '6127': true });
  });
});

describe('préparation de la réservation', () => {
  it('texte de recherche : gares lisibles, date, heure, numéro', () => {
    const t = proposer(H, '2026-11-04', 'MP').dansCreneau[0]!;
    expect(texteRecherche(t, '2026-11-04')).toBe('Marseille Saint Charles → Paris Gare de Lyon, mercredi 4 novembre 2026, départ 06:03, train 6136');
    expect(villeGare('Paris-Gare-de-Lyon')).toBe('Paris Gare de Lyon');
    expect(villeGare('Marseille-St-Charles')).toBe('Marseille Saint Charles');
  });
  it('site de vente par opérateur : aucun lien pour OUIGO (CGU)', () => {
    expect(canalVente('TGV INOUI')?.url).toBe('https://www.sncf-connect.com/');
    expect(canalVente('Intercités')?.nom).toBe('SNCF Connect');
    expect(canalVente('Trenitalia (Frecciarossa)')?.url).toBe('https://www.trenitalia.fr/');
    expect(canalVente('OUIGO')).toBeNull();
  });
  it('clé de train stable et distincte entre sens', () => {
    const t = { sens: 'MP' as const, numero: '6136', operateur: 'TGV INOUI', depart: 363, arrivee: 562 };
    expect(cleTrain(t)).toBe(cleTrain({ ...t }));
    expect(cleTrain(t)).not.toBe(cleTrain({ ...t, sens: 'PM' }));
  });
});
