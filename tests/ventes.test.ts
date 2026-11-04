import { describe, expect, it } from 'vitest';
import brut from '../src/data/ouvertures-ventes.json';
import { OUVERTURES } from '../src/data/ouvertures';
import { calendrierDe, etatVente, ouverturesAttendues, validerOuvertures } from '../src/domain/ventes';
import { aMettreAuPanier } from '../src/domain/panier';
import { changerStatuts, lireDeplacements, nouveauDeplacement, type Deplacement, type TrainChoisi } from '../src/domain/deplacements';
import { genererIcs } from '../src/domain/ics';
import { estAReverifier } from '../src/domain/referentiel';

const INOUI: TrainChoisi = { numero: '6136', operateur: 'TGV INOUI', depart: 363, arrivee: 562 };
const OUIGO: TrainChoisi = { numero: '7821', operateur: 'OUIGO', depart: 1072, arrivee: 1270 };
const TRENITALIA: TrainChoisi = { numero: '6119', operateur: 'Trenitalia (Frecciarossa)', depart: 1098, arrivee: 1313 };
const AUJ = '2026-11-04';

function dep(id: string, aller: string, retour: string, ta?: TrainChoisi, tr?: TrainChoisi): Deplacement {
  const d = nouveauDeplacement(id, aller, retour);
  if (ta) d.aller.train = ta;
  if (tr) d.retour.train = tr;
  return d;
}

describe('calendrier des ouvertures de ventes (EXG-10)', () => {
  it('sourcé en https, daté, valide', () => {
    expect(OUVERTURES.operateurs.map((o) => o.id)).toEqual(['tgv-inoui', 'intercites', 'ouigo', 'trenitalia']);
    for (const o of OUVERTURES.operateurs) expect(o.source.startsWith('https://')).toBe(true);
    expect(estAReverifier(OUVERTURES.meta.verifieLe, new Date('2026-11-04'))).toBe(false);
  });
  it.each([
    ['ouverture après la période ouverte', { le: '2027-02-01', du: '2027-01-07', au: '2027-07-02' }],
    ['période inversée', { le: '2026-11-12', du: '2027-07-02', au: '2027-01-07' }],
    ['heure invalide', { le: '2026-11-12', heure: '25:00', du: '2027-01-07', au: '2027-07-02' }],
  ])('refuse : %s', (_n, w) => {
    const mauvais = { ...brut, operateurs: [{ ...brut.operateurs[0], ouvertures: [w] }] };
    expect(() => validerOuvertures(mauvais)).toThrow();
  });
  it('reconnaît l’opérateur affiché d’un train', () => {
    expect(calendrierDe(OUVERTURES, 'TGV INOUI')?.id).toBe('tgv-inoui');
    expect(calendrierDe(OUVERTURES, 'OUIGO')?.id).toBe('ouigo');
    expect(calendrierDe(OUVERTURES, 'Intercités')?.id).toBe('intercites');
    expect(calendrierDe(OUVERTURES, 'Trenitalia (Frecciarossa)')?.id).toBe('trenitalia');
    expect(calendrierDe(OUVERTURES, 'TER')).toBeNull();
  });
});

describe('état de vente d’un trajet', () => {
  it('TGV INOUI : en vente jusqu’au 6 janvier, ouverture le 12 novembre ensuite (bornes comprises)', () => {
    expect(etatVente(OUVERTURES, 'TGV INOUI', '2027-01-06', AUJ)).toEqual({ etat: 'en-vente' });
    const e = etatVente(OUVERTURES, 'TGV INOUI', '2027-01-07', AUJ);
    expect(e.etat).toBe('ouverture');
    if (e.etat === 'ouverture') {
      expect(e.le).toBe('2026-11-12');
      expect(e.heure).toBe(5 * 60 + 45);
    }
    expect(etatVente(OUVERTURES, 'TGV INOUI', '2027-07-02', AUJ).etat).toBe('ouverture');
    expect(etatVente(OUVERTURES, 'TGV INOUI', '2027-07-03', AUJ).etat).toBe('inconnu');
  });
  it('le jour de l’ouverture, le trajet est en vente', () => {
    expect(etatVente(OUVERTURES, 'TGV INOUI', '2027-01-13', '2026-11-12')).toEqual({ etat: 'en-vente' });
    expect(etatVente(OUVERTURES, 'TGV INOUI', '2027-01-13', '2026-11-11').etat).toBe('ouverture');
  });
  it('Intercités ouvre jusqu’au 31 mars seulement ; OUIGO déjà en vente jusqu’au 2 juillet', () => {
    expect(etatVente(OUVERTURES, 'Intercités', '2027-04-01', AUJ).etat).toBe('inconnu');
    expect(etatVente(OUVERTURES, 'OUIGO', '2027-07-02', AUJ)).toEqual({ etat: 'en-vente' });
  });
  it('Trenitalia : au-delà du 10 janvier, ouverture non annoncée (pas de date inventée)', () => {
    expect(etatVente(OUVERTURES, 'Trenitalia (Frecciarossa)', '2027-01-10', AUJ)).toEqual({ etat: 'en-vente' });
    const e = etatVente(OUVERTURES, 'Trenitalia (Frecciarossa)', '2027-01-11', AUJ);
    expect(e.etat).toBe('inconnu');
  });
});

describe('ouvertures attendues par mes trajets', () => {
  const liste = [
    dep('d-aaaa', '2027-01-13', '2027-01-15', INOUI, INOUI),
    dep('d-bbbb', '2027-01-20', '2027-01-22', OUIGO, INOUI),
    dep('d-cccc', '2026-11-18', '2026-11-20', INOUI, INOUI),
  ];
  it('regroupe par opérateur et date, ignore ce qui est déjà en vente ou réservé', () => {
    const o = ouverturesAttendues(OUVERTURES, liste, AUJ);
    expect(o).toHaveLength(1);
    expect(o[0]?.operateur.id).toBe('tgv-inoui');
    expect(o[0]?.trajets.map((t) => `${t.deplacement.id}-${t.cote}`)).toEqual(['d-aaaa-aller', 'd-aaaa-retour', 'd-bbbb-retour']);
    const option = changerStatuts(liste, [{ id: 'd-aaaa', cote: 'aller' }], 'option');
    expect(ouverturesAttendues(OUVERTURES, option, AUJ)[0]?.trajets).toHaveLength(2);
  });
  it('agenda : un événement d’ouverture avec alarme 15 min avant l’heure indicative', () => {
    const ics = genererIcs([], new Date('2026-11-04T20:00:00Z'), ouverturesAttendues(OUVERTURES, liste, AUJ));
    expect(ics).toContain('UID:ouverture-tgv-inoui-2026-11-12@chassebonsplans');
    expect(ics).toContain('DTSTART;TZID=Europe/Paris:20261112T054500');
    expect(ics).toContain('TRIGGER:-PT15M');
    expect(ics.replace(/\r\n /g, '')).toContain('SUMMARY:Ouverture des ventes TGV INOUI : 3 trajets à réserver');
  });
});

describe('séance panier', () => {
  it('trains en vente et à réserver, SNCF Connect d’abord (OUIGO compris), puis Trenitalia, par date', () => {
    const liste = [
      dep('d-bbbb', '2026-11-25', '2026-11-27', INOUI, TRENITALIA),
      dep('d-aaaa', '2026-11-18', '2026-11-20', OUIGO, INOUI),
      dep('d-cccc', '2027-01-13', '2027-01-15', INOUI, INOUI), // pas encore en vente
      dep('d-dddd', '2026-10-01', '2026-10-02', INOUI, INOUI), // passé
    ];
    const ordre = aMettreAuPanier(liste, AUJ, OUVERTURES).map((e) => `${e.id}-${e.cote}`);
    expect(ordre).toEqual(['d-aaaa-aller', 'd-aaaa-retour', 'd-bbbb-aller', 'd-bbbb-retour']);
  });
  it('un trajet déjà dans le panier, en option ou payé n’est plus proposé', () => {
    const liste = [dep('d-aaaa', '2026-11-18', '2026-11-20', INOUI, INOUI)];
    const apres = changerStatuts(liste, [{ id: 'd-aaaa', cote: 'aller' }], 'panier');
    expect(aMettreAuPanier(apres, AUJ, OUVERTURES)).toEqual([{ id: 'd-aaaa', cote: 'retour' }]);
  });
  it('fin de séance : statut groupé, date limite d’option effacée hors option', () => {
    const d = dep('d-aaaa', '2026-11-18', '2026-11-20', INOUI, INOUI);
    d.aller = { ...d.aller, statut: 'option', limiteOption: '2026-11-10' };
    const [r] = changerStatuts([d], [{ id: 'd-aaaa', cote: 'aller' }, { id: 'd-aaaa', cote: 'retour' }], 'paye');
    expect(r?.aller).toEqual({ date: '2026-11-18', statut: 'paye', train: INOUI });
    expect(r?.retour.statut).toBe('paye');
  });
  it('statut « dans le panier » et prix visé relus depuis le stockage', () => {
    const d = dep('d-aaaa', '2026-11-18', '2026-11-20', INOUI);
    const [lu] = lireDeplacements([{ ...d, aller: { ...d.aller, statut: 'panier', prixCibleCentimes: 3500 }, retour: { ...d.retour, prixCibleCentimes: 0 } }]).deplacements;
    expect(lu?.aller).toEqual({ date: '2026-11-18', statut: 'panier', train: INOUI, prixCibleCentimes: 3500 });
    expect(lu?.retour.prixCibleCentimes).toBeUndefined();
  });
});
