import { describe, expect, it } from 'vitest';
import { REGLES_AVANTAGE as R } from '../src/data/avantage';
import { REFERENTIEL_COUT } from '../src/data/parametres';
import { estimer, planifier } from '../src/domain/croises';
import { changerStatuts, lireDeplacements, nettoyerPrixVus, nouveauDeplacement } from '../src/domain/deplacements';
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
  const lire = (t: string, date?: string) => lireCollage(t, date).lignes;
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
  it('départ, arrivée, durée ignorée, premier prix (« à partir de »), train complet abandonné', () => {
    expect(lire(page)).toEqual([
      { depart: h('06:03'), arrivee: h('09:22'), centimes: 4500 },
      { depart: h('06:38'), arrivee: h('09:59'), centimes: 2900 },
    ]);
  });
  it('heures « 6h03 », espaces insécables, durée « 3 h 19 min » ou « 3h 19m »', () => {
    expect(lire('6h03 3 h 19 min 9h22 45,90 € — 17h38 3h 19m 20h57 52 EUR')).toEqual([
      { depart: h('06:03'), arrivee: h('09:22'), centimes: 4590 },
      { depart: h('17:38'), arrivee: h('20:57'), centimes: 5200 },
    ]);
  });
  it('revue I1 : dernier train du soir, durée « 3h28 » prise ni pour une arrivée ni pour un départ', () => {
    expect(lire('18:38\n3h22\n22:00\n30 €\n19:38\n3h28\n23:06\n25 €')).toEqual([
      { depart: h('18:38'), arrivee: h('22:00'), centimes: 3000 },
      { depart: h('19:38'), arrivee: h('23:06'), centimes: 2500 },
    ]);
  });
  it('revue I1 : durée affichée après le prix (Trainline)', () => {
    expect(lire('06:03 09:22 45,90 € 3h 19m 06:38 09:59 29 € 3h 21m')).toEqual([
      { depart: h('06:03'), arrivee: h('09:22'), centimes: 4590 },
      { depart: h('06:38'), arrivee: h('09:59'), centimes: 2900 },
    ]);
  });
  it.each([
    ['économie', '06:03 09:22 45,00 € Économisez 13,50 €', 4500],
    ['bagage', '06:19 09:39 OUIGO 19 € Bagage supplémentaire + 5 €', 1900],
    ['bandeau d’offre entre deux trains', '06:03 09:22 45 € Aller-retour dès 19 € 17:38 20:57 52 €', 4500],
  ])('revue B1 : montant parasite ignoré (%s)', (_n, t, attendu) => {
    expect(lire(t)[0]?.centimes).toBe(attendu);
  });
  it('revue B1 : bandeau d’offre entre deux trains, second train intact', () => {
    expect(lire('06:03 09:22 45 € Aller-retour dès 19 € 17:38 20:57 52 €')[1]).toEqual({ depart: h('17:38'), arrivee: h('20:57'), centimes: 5200 });
  });
  it('revue B1 : prix affiché avant les heures, chaque prix au train qui suit', () => {
    expect(lire('45 € 06:03 09:22 29 € 06:38 09:59')).toEqual([
      { depart: h('06:03'), arrivee: h('09:22'), centimes: 4500 },
      { depart: h('06:38'), arrivee: h('09:59'), centimes: 2900 },
    ]);
  });
  it('revue I2 : « €45.90 » après une heure, et « 1 245,00 € » ne donnent pas un faux prix', () => {
    expect(lire('06:03 09:22 €45.90')).toEqual([{ depart: h('06:03'), arrivee: h('09:22'), centimes: 4590 }]);
    expect(lire('06:03 09:22 1 245,00 €')).toEqual([]);
  });
  it('revue M2 : heure d’en-tête « à partir de 06:00 » ignorée', () => {
    expect(lire('Trains à partir de 06:00\n06:03 3h19 09:22 45 €')).toEqual([{ depart: h('06:03'), arrivee: h('09:22'), centimes: 4500 }]);
  });
  it('arrivée après minuit', () => {
    expect(lire('21:30 00:45 3h15 19 €')).toEqual([{ depart: h('21:30'), arrivee: h('00:45') + 1440, centimes: 1900 }]);
  });
  it('revue I5 : plusieurs jours collés, ou un autre jour que le trajet : rien n’est lu', () => {
    expect(lireCollage('mer. 4 nov. 17:38 20:57 45 € jeu. 5 nov. 17:38 20:57 30 €')).toEqual({ lignes: [], erreur: 'plusieurs-dates' });
    expect(lireCollage(page, '2026-11-05')).toEqual({ lignes: [], erreur: 'autre-date' });
    expect(lireCollage(page, '2026-11-04').lignes).toHaveLength(2);
  });
  it('texte sans train : rien', () => {
    expect(lire('Bonjour, 12 € de frais, rendez-vous à 10:00')).toEqual([]);
  });
  it('200 000 caractères lus en moins d’une seconde', () => {
    const debut = performance.now();
    lireCollage('06:03 3h19 09:22 45 € '.repeat(9000));
    expect(performance.now() - debut).toBeLessThan(1000);
  });
  it('association : même départ et arrivée à ±10 min ; correspondance signalée, non appliquée (revue B2)', () => {
    const trains = [train('6136', '06:03', '09:22'), train('7804', '06:19', '09:39', 'OUIGO'), train('6106', '07:01', '10:22')];
    const a = associerCollage(lire('06:03 10:30 1 correspondance 39 € 06:19 09:39 29 €'), trains);
    expect(a.associes).toEqual([{ train: trains[1], centimes: 2900 }]);
    expect(a.ecarts.map((e) => e.train.numero)).toEqual(['6136']);
    expect(a.nonLus.map((t) => t.numero)).toEqual(['6106']);
  });
});

describe('revue : prix à 0, prix anciens, nettoyage', () => {
  it('un prix à 0 € est refusé à la relecture', () => {
    expect(lirePrixVus([{ train: '6136|363', centimes: 0, le: '2026-11-05' }])).toBeUndefined();
  });
  it('un prix vu il y a plus de 2 jours n’entre pas dans la recommandation', () => {
    const a = train('6123', '17:38', '20:57');
    const b = train('6127', '18:38', '22:00');
    const vus = [
      { train: clePrix(a), centimes: 4500, le: '2026-11-05' },
      { train: clePrix(b), centimes: 1000, le: '2026-10-20' },
    ];
    expect(recommanderParPrix([a, b], vus, P, '2026-11-05')?.retenu.id).toBe(clePrix(a));
  });
  it('payé : le prix vu devient le prix payé, puis les prix vus sont oubliés ; trajets passés nettoyés', () => {
    const d = nouveauDeplacement('d-aaaa', '2026-11-09', '2026-11-11');
    d.aller.train = { numero: '6136', operateur: 'TGV INOUI', depart: 363, arrivee: 562 };
    d.aller.prixVus = [{ train: '6136|363', centimes: 4500, le: '2026-11-05' }];
    d.retour.prixVus = [{ train: '6123|1058', centimes: 4000, le: '2026-11-05' }];
    const [paye] = changerStatuts([d], [{ id: 'd-aaaa', cote: 'aller' }], 'paye');
    expect(paye?.aller.prixCentimes).toBe(4500);
    expect(paye?.aller.prixVus).toBeUndefined();
    const [passe] = nettoyerPrixVus([d], '2026-11-12');
    expect(passe?.retour.prixVus).toBeUndefined();
    const liste = [d];
    expect(nettoyerPrixVus(liste, '2026-11-05')).toBe(liste);
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
