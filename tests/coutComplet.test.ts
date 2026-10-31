import { describe, expect, it } from 'vitest';
import { evaluer, recommander, type ParametresCout, type TrainValide } from '../src/domain/coutComplet';
import { lireHeure } from '../src/domain/heure';

const h = (s: string): number => {
  const v = lireHeure(s);
  if (v === null) throw new Error(s);
  return v;
};
const train = (id: string, depart: string, arrivee: string, euros: number): TrainValide => ({
  id,
  depart: h(depart),
  arrivee: h(arrivee),
  prixCentimes: Math.round(euros * 100),
});

/** Paramètres de David : 15 min gare → domicile, dîner à la maison jusqu'à 21h45, repas 10 €, égalité à 2 € près. */
const P: ParametresCout = {
  trajetGareDomicileMin: 15,
  limiteDinerDomicileMin: h('21:45'),
  coutRepasCentimes: 1000,
  toleranceCentimes: 200,
};

describe('coût complet — cas de référence « le sandwich »', () => {
  it('train tardif + repas = train plus tôt plus cher : on prend le plus tôt', () => {
    const tardif = train('tardif', '19:00', '22:00', 30);
    const tot = train('tot', '17:45', '20:45', 40);
    const reco = recommander([tardif, tot], P)!;
    expect(evaluer(tardif, P).repasCentimes).toBe(1000);
    expect(evaluer(tot, P).repasCentimes).toBe(0);
    expect(reco.retenu.id).toBe('tot');
    expect(reco.motif).toBe('egalite-plus-tot');
  });

  it('dans la tolérance (1,50 € de plus) : toujours le plus tôt', () => {
    const reco = recommander([train('tardif', '19:00', '22:00', 30), train('tot', '17:45', '20:45', 41.5)], P)!;
    expect(reco.retenu.id).toBe('tot');
  });

  it('au-delà de la tolérance (3 € de plus) : le moins cher', () => {
    const reco = recommander([train('tardif', '19:00', '22:00', 30), train('tot', '17:45', '20:45', 43)], P)!;
    expect(reco.retenu.id).toBe('tardif');
    expect(reco.motif).toBe('moins-cher');
  });
});

describe('coût complet — limites', () => {
  it('arrivée au domicile pile à 21h45 : pas de repas', () => {
    expect(evaluer(train('x', '18:30', '21:30', 30), P).repasCentimes).toBe(0);
  });
  it('une minute après : repas compté', () => {
    expect(evaluer(train('x', '18:31', '21:31', 30), P).repasCentimes).toBe(1000);
  });
  it('arrivée après minuit : lendemain, repas compté', () => {
    const e = evaluer(train('x', '22:30', '01:10', 20), P);
    expect(e.arriveeGare).toBe(h('01:10') + 1440);
    expect(e.repasCentimes).toBe(1000);
  });
  it('tolérance nulle : égalité stricte départagée par l’heure', () => {
    const p0 = { ...P, toleranceCentimes: 0 };
    const reco = recommander([train('a', '19:00', '22:00', 30), train('b', '17:45', '20:45', 40)], p0)!;
    expect(reco.retenu.id).toBe('b');
  });
  it('repas à 0 € : redevient le moins cher pur', () => {
    const reco = recommander([train('a', '19:00', '22:00', 30), train('b', '17:45', '20:45', 40)], { ...P, coutRepasCentimes: 0 })!;
    expect(reco.retenu.id).toBe('a');
  });
  it('liste vide : aucune recommandation', () => {
    expect(recommander([], P)).toBeNull();
  });
  it('un seul train : motif « seul »', () => {
    expect(recommander([train('a', '19:00', '22:00', 30)], P)!.motif).toBe('seul');
  });
  it('classement trié par coût complet puis par heure d’arrivée', () => {
    const reco = recommander([train('c', '20:00', '23:00', 25), train('a', '16:00', '19:00', 50), train('b', '17:00', '20:00', 35)], P)!;
    expect(reco.classement.map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });
  it('tolérance bornes comprises : 2,00 € d’écart → le plus tôt ; 2,01 € → le moins cher', () => {
    const tardif = train('tardif', '19:00', '22:00', 30); // 40 € avec le repas
    expect(recommander([tardif, train('tot', '17:45', '20:45', 42)], P)!.retenu.id).toBe('tot');
    expect(recommander([tardif, train('tot', '17:45', '20:45', 42.01)], P)!.retenu.id).toBe('tardif');
  });
  it('même coût et même arrivée : égalité signalée avec le concurrent', () => {
    const reco = recommander([train('a', '17:45', '20:45', 40), train('b', '18:00', '20:45', 40)], P)!;
    expect(reco.motif).toBe('egalite-plus-tot');
    expect(reco.concurrent!.arriveeDomicile).toBe(reco.retenu.arriveeDomicile);
  });
  it('limite du dîner après minuit (00:30) : s’entend la nuit suivante', () => {
    const p = { ...P, limiteDinerDomicileMin: h('00:30') };
    expect(evaluer(train('x', '16:15', '19:00', 30), p).repasCentimes).toBe(0);
    expect(evaluer(train('x', '21:30', '00:20', 30), p).repasCentimes).toBe(1000);
  });
  it('propriété (oracle indépendant, minuit et égalités compris) : retenu ≤ min + tolérance et le plus tôt parmi les proches', () => {
    let graine = 42;
    const alea = () => ((graine = (graine * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 0; n < 1000; n++) {
      const trains = Array.from({ length: 2 + Math.floor(alea() * 5) }, (_, i) => {
        const dep = 900 + Math.floor(alea() * 600); // 15:00 à 00:59
        const arr = (dep + 170 + Math.floor(alea() * 30)) % 1440; // peut passer minuit
        const prix = [3000, 4000, 4200][Math.floor(alea() * 3)]! + (alea() < 0.5 ? 0 : Math.floor(alea() * 3000));
        return { id: `t${i}`, depart: dep, arrivee: arr, prixCentimes: prix };
      });
      // Oracle recalculé ici, sans passer par le classement du code testé.
      const couts = trains.map((t) => {
        const arrGare = t.arrivee < t.depart ? t.arrivee + 1440 : t.arrivee;
        const dom = arrGare + P.trajetGareDomicileMin;
        return { id: t.id, dom, cout: t.prixCentimes + (dom > P.limiteDinerDomicileMin ? P.coutRepasCentimes : 0) };
      });
      const min = Math.min(...couts.map((c) => c.cout));
      const plusTot = Math.min(...couts.filter((c) => c.cout - min <= P.toleranceCentimes).map((c) => c.dom));
      const reco = recommander(trains, P)!;
      expect(reco.retenu.coutCompletCentimes - min).toBeLessThanOrEqual(P.toleranceCentimes);
      expect(reco.retenu.arriveeDomicile).toBe(plusTot);
    }
  });
});
