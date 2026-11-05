import { describe, expect, it } from 'vitest';
import { REGLES_AVANTAGE as R } from '../src/data/avantage';
import { REFERENTIEL_COUT } from '../src/data/parametres';
import { estimer, planifier } from '../src/domain/croises';
import { lireDeplacements, nouveauDeplacement } from '../src/domain/deplacements';
import { associerCollage, clePrix, lireCollage, lirePrixVus, majPrixVu, prixAncien, recommanderParPrix } from '../src/domain/prix';

const P = REFERENTIEL_COUT.parametres;
const h = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const train = (numero: string, dep: string, arr: string, operateur = 'TGV INOUI') => ({ numero, depart: h(dep), arrivee: h(arr), operateur });

describe('prix vus : stockage', () => {
  it('relecture validée : clé, montant, date ; un prix par train, le plus récent', () => {
    expect(
      lirePrixVus([
        { train: '6136|363', centimes: 4500, le: '2026-11-04' },
        { train: '6136|363', centimes: 3900, le: '2026-11-05' },
        { train: '6123|1058', centimes: -1, le: '2026-11-05' },
        { train: '4111 1111 1111 1111|363', centimes: 100, le: '2026-11-05' },
        { train: '7821|1072', centimes: 2500, le: 'hier' },
      ]),
    ).toEqual([{ train: '6136|363', centimes: 3900, le: '2026-11-05' }]);
    expect(lirePrixVus('rien')).toBeUndefined();
  });
  it('ajout, remplacement, retrait', () => {
    let v = majPrixVu(undefined, '6136|363', 4500, '2026-11-05');
    v = majPrixVu(v, '6123|1058', 5000, '2026-11-05');
    v = majPrixVu(v, '6136|363', 3900, '2026-11-05');
    expect(v).toEqual([
      { train: '6123|1058', centimes: 5000, le: '2026-11-05' },
      { train: '6136|363', centimes: 3900, le: '2026-11-05' },
    ]);
    expect(majPrixVu(majPrixVu(undefined, '6136|363', 1, '2026-11-05'), '6136|363', undefined, '2026-11-05')).toBeUndefined();
  });
  it('un prix vu il y a plus de 2 jours est signalé', () => {
    expect(prixAncien({ train: 'x|1', centimes: 1, le: '2026-11-03' }, '2026-11-05')).toBe(false);
    expect(prixAncien({ train: 'x|1', centimes: 1, le: '2026-11-02' }, '2026-11-05')).toBe(true);
  });
  it('les prix vus voyagent avec le trajet (stockage, import)', () => {
    const d = nouveauDeplacement('d-aaaa', '2026-11-09', '2026-11-11');
    const [lu] = lireDeplacements([{ ...d, aller: { ...d.aller, prixVus: [{ train: '6136|363', centimes: 4500, le: '2026-11-05' }] } }]).deplacements;
    expect(lu?.aller.prixVus).toEqual([{ train: '6136|363', centimes: 4500, le: '2026-11-05' }]);
  });
});

describe('recommandation au coût complet sur prix vus', () => {
  const t1900 = train('6129', '19:00', '22:00');
  const t1745 = train('6123', '17:45', '20:45');
  const vus = (a: number, b: number) => [
    { train: clePrix(t1900), centimes: a, le: '2026-11-05' },
    { train: clePrix(t1745), centimes: b, le: '2026-11-05' },
  ];
  it('cas de référence « le sandwich » : 19h00 → 22h00 à 30 € contre 17h45 → 20h45 à 40 € → le second', () => {
    const r = recommanderParPrix([t1900, t1745], vus(3000, 4000), P);
    expect(r?.retenu.id).toBe(clePrix(t1745));
    expect(r?.motif).toBe('egalite-plus-tot');
  });
  it('écart au-delà de la tolérance : le moins cher l’emporte', () => {
    expect(recommanderParPrix([t1900, t1745], vus(2700, 4000), P)?.retenu.id).toBe(clePrix(t1900));
  });
  it('seuls les trains au prix connu comptent ; aucun prix : pas de recommandation', () => {
    expect(recommanderParPrix([t1900, t1745], [{ train: clePrix(t1745), centimes: 4000, le: '2026-11-05' }], P)?.motif).toBe('seul');
    expect(recommanderParPrix([t1900, t1745], undefined, P)).toBeNull();
  });
});

describe('lecture d’une page de résultats collée', () => {
  const page = `Aller : Marseille Saint-Charles → Paris Gare de Lyon
mer. 4 nov.
06:03
Marseille Saint-Charles
3h19
09:22
Paris Gare de Lyon
TGV INOUI
2de classe
à partir de
45,00 €
1re classe
78,00 €
06:19
Marseille Saint-Charles
3h20
09:39
OUIGO
Complet
06:38
3h21
09:59
Direct
29 €
`;
  it('départ, arrivée, durée ignorée, plus bas prix, train complet abandonné', () => {
    expect(lireCollage(page)).toEqual([
      { depart: h('06:03'), arrivee: h('09:22'), centimes: 4500 },
      { depart: h('06:38'), arrivee: h('09:59'), centimes: 2900 },
    ]);
  });
  it('heures au format « 6h03 », espaces insécables, durée après l’arrivée', () => {
    expect(lireCollage('6h03 9h22 3h19 45,90 € — 17h38 20h57 3h19 52 EUR')).toEqual([
      { depart: h('06:03'), arrivee: h('09:22'), centimes: 4590 },
      { depart: h('17:38'), arrivee: h('20:57'), centimes: 5200 },
    ]);
  });
  it('arrivée après minuit', () => {
    expect(lireCollage('21:30 00:45 3h15 19 €')).toEqual([{ depart: h('21:30'), arrivee: h('00:45') + 1440, centimes: 1900 }]);
  });
  it('texte sans train : rien', () => {
    expect(lireCollage('Bonjour, 12 € de frais, rendez-vous à 10:00')).toEqual([]);
  });
  it('association aux trains du jour par heure de départ', () => {
    const trains = [train('6136', '06:03', '09:22'), train('7804', '06:19', '09:39', 'OUIGO')];
    expect(associerCollage(lireCollage(page), trains)).toEqual([{ train: trains[0], centimes: 4500 }]);
  });
});

describe('estimation Avantage sur prix vus', () => {
  it('le prix vu du train remplace le prix habituel', () => {
    const d1 = nouveauDeplacement('d-aaaa', '2026-11-09', '2026-11-11');
    const d2 = nouveauDeplacement('d-bbbb', '2026-11-16', '2026-11-18');
    const mp = { numero: '6136', operateur: 'TGV INOUI', depart: 363, arrivee: 562 };
    const pm = { numero: '6123', operateur: 'TGV INOUI', depart: 1058, arrivee: 1257 };
    for (const d of [d1, d2]) {
      d.aller.train = mp;
      d.retour.train = pm;
    }
    d1.aller.prixVus = [{ train: '6136|363', centimes: 14000, le: '2026-11-05' }];
    const plan = planifier(R, [d1, d2], '2026-11-05');
    const e = estimer(R, plan, 10000);
    expect(e.aPrixVu).toBe(1);
    expect(e.economieCentimes).toBe(5100 + 3 * 3000);
    expect(estimer(R, plan).estimes).toBe(1);
  });
});
