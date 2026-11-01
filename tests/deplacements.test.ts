import { describe, expect, it } from 'vitest';
import { ajouterMois, ecartJours, estDateIso, jourSemaine } from '../src/domain/dates';
import {
  MAX_DEPLACEMENTS,
  lireDeplacements,
  lirePrix,
  nouveauDeplacement,
  nouvelId,
  optionsUrgentes,
  purger,
  totalPaye,
  trier,
  verifierDates,
  type Deplacement,
} from '../src/domain/deplacements';
import { aExporter, genererIcs, plier } from '../src/domain/ics';
import { LEVIERS } from '../src/data/leviers';
import { exporter, importer, lireProfil, pourStockage, profilVide } from '../src/domain/profil';

const IDS = new Set(LEVIERS.map((l) => l.id));
const train = { numero: '6136', operateur: 'TGV INOUI', depart: 363, arrivee: 562 };
const dep = (id: string, aller: string, retour: string): Deplacement => nouveauDeplacement(id, aller, retour);

describe('dates', () => {
  it('écart, mois et jour de semaine', () => {
    expect(ecartJours('2026-12-31', '2027-01-01')).toBe(1);
    expect(ecartJours('2026-03-28', '2026-03-30')).toBe(2); // passage à l'heure d'été sans effet
    expect(ajouterMois('2026-03-31', -1)).toBe('2026-02-28');
    expect(ajouterMois('2028-02-29', -24)).toBe('2026-02-28');
    expect(jourSemaine('2026-11-02')).toBe(0); // lundi
    expect(estDateIso('2026-02-29')).toBe(false);
  });
});

describe('saisie d’un déplacement', () => {
  it.each([
    ['', '2026-11-04', 'aller'],
    ['2026-11-02', '', 'retour'],
    ['2026-11-04', '2026-11-02', 'même jour'],
    ['2026-11-01', '2026-12-02', '30 jours'],
  ])('refuse %s → %s', (a, r, motif) => {
    expect(verifierDates(a, r)).toContain(motif);
  });
  it('accepte l’aller-retour dans la journée et 30 jours pile (borne comprise)', () => {
    expect(verifierDates('2026-11-02', '2026-11-02')).toBeNull();
    expect(verifierDates('2026-11-01', '2026-12-01')).toBeNull();
  });
  it('identifiant sans chiffre (EXG-02) et unique', () => {
    const ids = new Set(Array.from({ length: 200 }, () => nouvelId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^d-[a-z]{12}$/);
  });
  it('prix : vide, valide ou invalide', () => {
    expect(lirePrix('')).toBeUndefined();
    expect(lirePrix('39,90')).toBe(3990);
    expect(lirePrix('trente')).toBeNull();
  });
});

describe('relecture validée (stockage, import)', () => {
  it('garde les déplacements valides, écarte et compte le reste', () => {
    const ok = { ...dep('d-abcd', '2026-11-02', '2026-11-04'), aller: { date: '2026-11-02', statut: 'option', limiteOption: '2026-11-01', train } };
    const { deplacements, ecartes } = lireDeplacements([
      ok,
      { ...ok }, // doublon d'identifiant
      { ...ok, id: 'd-1234' }, // chiffres interdits
      { ...ok, id: 'd-efgh', retour: { date: '2026-10-01', statut: 'paye' } }, // retour avant l'aller
      { ...ok, id: 'd-ijkl', aller: { date: '2026-11-02', statut: 'inconnu' } },
      null,
    ]);
    expect(deplacements).toEqual([ok]);
    expect(ecartes).toBe(5);
  });
  it('nettoie un train suspect ou incohérent sans perdre le trajet', () => {
    const d = { ...dep('d-abcd', '2026-11-02', '2026-11-04') };
    const [lu] = lireDeplacements([
      { ...d, aller: { ...d.aller, train: { ...train, operateur: '4111 1111 1111 1111' } }, retour: { ...d.retour, train: { ...train, arrivee: 100 } } },
    ]).deplacements;
    expect(lu?.aller.train).toBeUndefined();
    expect(lu?.retour.train).toBeUndefined();
  });
  it('date limite d’option après le trajet : écartée', () => {
    const d = dep('d-abcd', '2026-11-02', '2026-11-04');
    const [lu] = lireDeplacements([{ ...d, aller: { date: '2026-11-02', statut: 'option', limiteOption: '2026-11-03' } }]).deplacements;
    expect(lu?.aller).toEqual({ date: '2026-11-02', statut: 'option' });
  });
  it('date limite d’option conservée seulement au statut « option » ; prix borné', () => {
    const d = dep('d-abcd', '2026-11-02', '2026-11-04');
    const [lu] = lireDeplacements([
      { ...d, aller: { date: '2026-11-02', statut: 'paye', limiteOption: '2026-11-01', prixCentimes: 3990 }, retour: { date: '2026-11-04', statut: 'paye', prixCentimes: 10_000_000 } },
    ]).deplacements;
    expect(lu?.aller).toEqual({ date: '2026-11-02', statut: 'paye', prixCentimes: 3990 });
    expect(lu?.retour.prixCentimes).toBeUndefined();
  });
  it(`limite de ${MAX_DEPLACEMENTS} déplacements`, () => {
    const lettres = (i: number) => 'd-' + i.toString(26).replace(/./g, (c) => String.fromCharCode(97 + parseInt(c, 26)));
    const liste = Array.from({ length: MAX_DEPLACEMENTS + 5 }, (_, i) => dep(lettres(i) + 'zz', '2026-11-02', '2026-11-04'));
    const { deplacements, ecartes } = lireDeplacements(liste);
    expect(deplacements).toHaveLength(MAX_DEPLACEMENTS);
    expect(ecartes).toBe(5);
  });
  it('le profil transporte les déplacements : stockage, export, import', () => {
    const d = { ...dep('d-abcd', '2026-11-02', '2026-11-04'), aller: { date: '2026-11-02', statut: 'paye' as const, train, prixCentimes: 3990 } };
    const p = pourStockage({ ...profilVide(), deplacements: [d] });
    expect(p.deplacements).toEqual([d]);
    const relu = importer(exporter(p, '2026-11-01'), IDS);
    expect(relu.profil.deplacements).toEqual([d]);
    expect(relu.ecartes).toEqual([]);
    const abime = lireProfil({ version: 1, leviers: {}, deplacements: [d, { id: 'x' }] }, IDS);
    expect(abime.profil.deplacements).toEqual([d]);
    expect(abime.ecartes).toEqual(['1 déplacement']);
  });
});

describe('EXG-03 — purge à 24 mois', () => {
  it('efface les déplacements revenus depuis plus de 24 mois, borne gardée', () => {
    const liste = [dep('d-aaaa', '2024-10-28', '2024-10-31'), dep('d-bbbb', '2024-10-30', '2024-11-01'), dep('d-cccc', '2026-11-02', '2026-11-04')];
    expect(purger(liste, '2026-11-01').map((d) => d.id)).toEqual(['d-bbbb', 'd-cccc']);
    expect(purger(liste, '2026-11-01', 0).map((d) => d.id)).toEqual(['d-cccc']);
  });
});

describe('suivi', () => {
  it('tri par date d’aller', () => {
    expect(trier([dep('d-bbbb', '2026-11-09', '2026-11-10'), dep('d-aaaa', '2026-11-02', '2026-11-04')]).map((d) => d.id)).toEqual(['d-aaaa', 'd-bbbb']);
  });
  it('total payé : seuls les trajets payés avec un prix', () => {
    const d = dep('d-aaaa', '2026-11-02', '2026-11-04');
    expect(totalPaye({ ...d, aller: { ...d.aller, statut: 'paye', prixCentimes: 3990 }, retour: { ...d.retour, statut: 'option', prixCentimes: 5000 } })).toBe(3990);
  });
  it('options urgentes : limite passée ou dans les 2 jours, trajet pas encore fait', () => {
    const d = dep('d-aaaa', '2026-11-09', '2026-11-12');
    const avec = (limite: string) => ({ ...d, aller: { ...d.aller, statut: 'option' as const, limiteOption: limite } });
    expect(optionsUrgentes([avec('2026-11-03')], '2026-11-01')).toHaveLength(1);
    expect(optionsUrgentes([avec('2026-11-04')], '2026-11-01')).toHaveLength(0);
    expect(optionsUrgentes([avec('2026-10-30')], '2026-11-01')).toHaveLength(1);
    expect(optionsUrgentes([avec('2026-11-03')], '2026-11-10')).toHaveLength(0); // trajet passé
  });
});

describe('export agenda .ics (RFC 5545)', () => {
  const d: Deplacement = {
    id: 'd-abcd',
    aller: { date: '2026-11-02', statut: 'option', limiteOption: '2026-11-01', train },
    retour: { date: '2026-11-04', statut: 'a-reserver', train: { numero: '6129', operateur: 'TGV INOUI', depart: 1178, arrivee: 1386 } },
  };
  const ics = genererIcs([d], new Date('2026-11-01T10:00:00Z'));
  it('structure, fuseau de Paris et fins de ligne CRLF', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('TZID:Europe/Paris');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
  it('un événement par train, rappel d’option la veille', () => {
    expect(ics).toContain('DTSTART;TZID=Europe/Paris:20261102T060300');
    expect(ics).toContain('DTEND;TZID=Europe/Paris:20261102T092200');
    expect(ics).toContain('DTSTART;TZID=Europe/Paris:20261104T193800');
    expect(ics).toContain('UID:d-abcd-aller-option@chassebonsplans');
    expect(ics).toContain('TRIGGER:-PT15H'); // la veille vers 9 h, pas à minuit
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain('SUMMARY:(À réserver) Train Paris → Marseille');
  });
  it('arrivée après minuit : fin d’événement le lendemain', () => {
    const tard = genererIcs([{ ...d, retour: { ...d.retour, train: { ...train, depart: 1200, arrivee: 1450 } } }]);
    expect(tard).toContain('DTEND;TZID=Europe/Paris:20261105T001000');
  });
  it('échappement et pliage', () => {
    expect(plier('X'.repeat(160)).split('\r\n').map((l) => l.length)).toEqual([75, 75, 12]);
    expect(genererIcs([{ ...d, aller: { ...d.aller, train: { ...train, operateur: 'A, B; C' } } }]).replace(/\r\n /g, '')).toContain('A\\, B\\; C');
  });
  it('aucun événement sans train choisi ni option ; rappel d’option gardé sans train', () => {
    const vide = dep('d-zzzz', '2026-11-02', '2026-11-04');
    expect(aExporter(vide)).toBe(false);
    expect(genererIcs([vide])).not.toContain('BEGIN:VEVENT');
    const option = { ...vide, aller: { date: '2026-11-02', statut: 'option' as const, limiteOption: '2026-11-01' } };
    expect(aExporter(option)).toBe(true);
    expect(genererIcs([option])).toContain('UID:d-zzzz-aller-option@chassebonsplans');
  });
  it('un export plus récent porte une séquence plus grande (mise à jour, pas doublon)', () => {
    const seq = (t: string) => Number(/SEQUENCE:(\d+)/.exec(genererIcs([d], new Date(t)))?.[1]);
    expect(seq('2026-11-02T10:00:00Z')).toBeGreaterThan(seq('2026-11-01T10:00:00Z'));
  });
});
