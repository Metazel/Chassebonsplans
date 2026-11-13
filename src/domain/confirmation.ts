/**
 * Import de la confirmation de commande SNCF Connect par copier-coller (CU-D) : le voyageur colle le texte du courriel,
 * l'appli en lit les billets (gares, dates, heures, trains, prix, tarif) et, après confirmation, marque les trajets payés
 * et les billets aller-retour engagés. Rien n'est envoyé (EXG-01, EXG-08) ; le texte n'est pas conservé : ni nom,
 * ni référence de dossier, ni moyen de paiement (EXG-02).
 */
import { ajouterJours, ecartJours, estDateIso, jourSemaine } from './dates';
import { lireMontant } from './argent';
import { choisir, nouveauDeplacement, MAX_DEPLACEMENTS, trier, verifierDates, type Deplacement, type TrainChoisi, type Trajet } from './deplacements';
import { DUREE_DEFAUT } from './croises';
import { trainsDuJour, type Horaires, type Sens } from './horaires';

export type Tarif = 'avantage' | 'liberte';

export interface TrajetLu {
  sens: Sens;
  date: string;
  /** Heure de départ, en minutes. */
  depart: number;
  numero?: string;
  operateur?: string;
}

export interface BilletLu {
  /** Prix du billet (aller-retour ou aller simple), en centimes. */
  prixCentimes: number;
  /** Un trajet (aller simple) ou deux (aller puis retour). */
  trajets: TrajetLu[];
  tarif?: Tarif;
}

export interface Confirmation {
  billets: BilletLu[];
  /** Blocs « Voyage » repérés mais illisibles. */
  illisibles: number;
}

/** Texte collé limité (une confirmation fait quelques dizaines de kilo-octets). */
export const TAILLE_MAX_CONFIRMATION = 200_000;

const MOIS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};
const sansAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const GARE = /(Marseille[\s-]+Saint[\s-]+Charles|Marseille[\s-]+St[\s-]+Charles|Paris[\s-]+Gare[\s-]+de[\s-]+Lyon)/giu;
const PRIX = /(\d{1,3}(?: \d{3})*,\d{2})\s?€/u;
const VOYAGEUR = /\((?:\d{1,2}\s?-\s?\d{1,2}\sans|\d{1,2}\sans(?:\set\splus)?|moins\sde\s\d{1,2}\sans)\)/giu;
const QUAND = (mot: string) => new RegExp(`${mot}\\s?:\\s?(?:[\\p{L}]+\\s)?(\\d{1,2})(?:er)?\\s([\\p{L}]+)\\s(\\d{4})\\s(?:à\\s)?(\\d{1,2})\\s?[:h]\\s?(\\d{2})`, 'iu');
const TRAIN = /\b(TGV\s?INOUI|OUIGO(?:\sTRAIN\sCLASSIQUE)?|INTERCIT[ÉE]S(?:\sDE\sNUIT)?|TER|FRECCIAROSSA)\s(?:n°\s?)?(\d{3,5})\b/giu;

function lireQuand(bloc: string, mot: string): { date: string; depart: number } | null {
  const m = QUAND(mot).exec(bloc);
  if (!m) return null;
  const mois = MOIS[sansAccents(m[2]!)];
  const jour = Number(m[1]);
  const h = Number(m[4]);
  const mn = Number(m[5]);
  if (!mois || h > 23 || mn > 59) return null;
  const date = `${m[3]}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
  return estDateIso(date) ? { date, depart: h * 60 + mn } : null;
}

const operateurLu = (o: string) => {
  const s = sansAccents(o).replace(/\s+/g, ' ');
  if (s.startsWith('tgv')) return 'TGV INOUI';
  if (s.startsWith('ouigo')) return s.includes('classique') ? 'OUIGO Train Classique' : 'OUIGO';
  if (s.startsWith('intercit')) return 'Intercités';
  if (s === 'ter') return 'TER';
  return 'Frecciarossa';
};

/** Lit les billets d'une confirmation collée. Texte trop long ou sans bloc « Voyage » : aucun billet. */
export function lireConfirmation(texte: string): Confirmation {
  if (texte.length > TAILLE_MAX_CONFIRMATION) return { billets: [], illisibles: 0 };
  const plat = texte.normalize('NFC').replace(/[\u00a0\u202f\u2009]/g, ' ').replace(/\s+/g, ' ');
  // Le récapitulatif du paiement (total, carte) n'appartient à aucun voyage.
  const voyages = plat.split(/Récapitulatif de votre paiement|Total commande/iu)[0]!;
  const blocs = voyages.split(/\bVoyage\s\d{1,2}\b/u).slice(1);
  const billets: BilletLu[] = [];
  let illisibles = 0;
  for (const bloc of blocs) {
    const gares = [...bloc.matchAll(GARE)].map((m) => sansAccents(m[1]!));
    // Le prix du voyage précède « Aller : » ; ailleurs, un montant serait celui d'un frais ou d'un total.
    const avantAller = bloc.split(/Aller\s?:/u)[0] ?? '';
    const prixTexte = PRIX.exec(avantAller)?.[1];
    const prix = prixTexte ? lireMontant(prixTexte) : null;
    const aller = lireQuand(bloc, 'Aller');
    if (gares.length < 2 || !prix || !aller || gares[0]!.slice(0, 5) === gares[1]!.slice(0, 5)) {
      illisibles++;
      continue;
    }
    const sens: Sens = gares[0]!.startsWith('marseille') ? 'MP' : 'PM';
    const inverse: Sens = sens === 'MP' ? 'PM' : 'MP';
    const trains = [...bloc.matchAll(TRAIN)].map((m) => ({ operateur: operateurLu(m[1]!), numero: m[2]! }));
    const retour = lireQuand(bloc, 'Retour');
    // Plusieurs voyageurs (prix à partager) ou correspondances (plus d'un train par trajet) : non pris en charge, à saisir à la main.
    if ([...bloc.matchAll(VOYAGEUR)].length > 1 || trains.length > (retour ? 2 : 1)) {
      illisibles++;
      continue;
    }
    if (retour && (retour.date < aller.date || (retour.date === aller.date && retour.depart <= aller.depart) || ecartJours(aller.date, retour.date) > 366)) {
      illisibles++;
      continue;
    }
    const trajet = (s: Sens, q: { date: string; depart: number }, t?: { operateur: string; numero: string }): TrajetLu => ({ sens: s, ...q, ...(t ?? {}) });
    const tarif: Tarif | undefined = /TARIF\sAVANTAGE/iu.test(bloc) ? 'avantage' : /TARIF\sLIBERT/iu.test(bloc) ? 'liberte' : undefined;
    billets.push({
      prixCentimes: prix,
      trajets: retour ? [trajet(sens, aller, trains[0]), trajet(inverse, retour, trains[1])] : [trajet(sens, aller, trains[0])],
      ...(tarif ? { tarif } : {}),
    });
  }
  return { billets, illisibles };
}

export interface RapportImport {
  /** Trajets marqués payés (nouveaux ou corrigés d'après la confirmation). */
  payes: number;
  /** Dont trajets déjà payés (par « C'est payé » ou un import précédent) complétés ou corrigés. */
  corriges: number;
  /** Trajets dont la date prévue a été remplacée par celle du billet (même semaine). */
  dates: number;
  /** Déplacements créés pour des trajets sans déplacement. */
  crees: number;
  /** Trajets déjà importés à l'identique : laissés tels quels. */
  dejaImportes: number;
  /** Trajets sans déplacement possible (aller sans retour la même semaine, ou l'inverse) : non importés. */
  ignores: TrajetLu[];
  /** Trajets non importés faute de place (nombre maximal de déplacements atteint). */
  horsPlafond: TrajetLu[];
}

/** Train choisi : celui des horaires (même numéro, même départ) ; sinon le même numéro un autre jour ; sinon une durée type. */
function trainDe(t: TrajetLu, h: Horaires | null, actuel?: TrainChoisi): TrainChoisi | undefined {
  if (!t.numero) return actuel;
  const memeJour = h?.trains.length ? trainsDuJour(h, t.date, t.sens).find((x) => x.numero === t.numero && x.depart === t.depart) : undefined;
  if (memeJour) return choisir(memeJour);
  const autreJour = h?.trains.find((x) => x.sens === t.sens && x.numero === t.numero && x.depart === t.depart);
  if (autreJour) return choisir(autreJour);
  if (actuel && actuel.numero === t.numero && actuel.depart === t.depart) return actuel;
  return { numero: t.numero, operateur: t.operateur ?? 'TGV INOUI', depart: t.depart, arrivee: t.depart + DUREE_DEFAUT };
}

/** Colonnes ALLER et RETOUR lues dans l'ordre inverse : les horaires connaissent le sens de chaque numéro. */
function remettreTrains(b: BilletLu, h: Horaires | null): BilletLu {
  const [x, y] = b.trajets;
  if (!h || !x?.numero || !y?.numero) return b;
  const sensDe = (n: string) => h.trains.find((t) => t.numero === n)?.sens;
  if (sensDe(x.numero) !== y.sens || sensDe(y.numero) !== x.sens) return b;
  const echange = (t: TrajetLu, de: TrajetLu): TrajetLu => ({ ...t, numero: de.numero!, ...(de.operateur ? { operateur: de.operateur } : {}) });
  return { ...b, trajets: [echange(x, y), echange(y, x)] };
}

const lundi = (date: string) => ajouterJours(date, -jourSemaine(date));
const cote = (t: TrajetLu) => (t.sens === 'MP' ? 'aller' : 'retour') as 'aller' | 'retour';

/**
 * Applique une confirmation lue : chaque trajet est rattaché au déplacement du même jour et du même sens
 * (aller Marseille → Paris, retour Paris → Marseille), à défaut à un trajet non payé de la même semaine (sa date
 * devient celle du billet) ; sinon, un aller et le premier retour suivant de la même semaine forment un nouveau
 * déplacement. Les trajets passent « payé » avec le train, le tarif et la moitié du prix d'un aller-retour ;
 * les deux trajets d'un même billet partagent un identifiant de billet (billet engagé). Un trajet déjà importé
 * à l'identique n'est pas modifié ; un trajet payé autrement (« C'est payé », échange) est corrigé.
 */
export function appliquerConfirmation(
  liste: Deplacement[],
  conf: Confirmation,
  h: Horaires | null,
  nouvelId: () => string,
): { deplacements: Deplacement[]; rapport: RapportImport } {
  const rapport: RapportImport = { payes: 0, corriges: 0, dates: 0, crees: 0, dejaImportes: 0, ignores: [], horsPlafond: [] };
  let deplacements = [...liste];
  const billets = conf.billets.map((b) => remettreTrains(b, h));
  const tous = billets.flatMap((b) => b.trajets);
  const duMemeJour = (t: TrajetLu) => deplacements.filter((d) => d[cote(t)].date === t.date);
  /** Déplacement d'un trajet : même jour (de préférence non payé), sinon trajet non payé de la même semaine dont la date peut changer. */
  const trouver = (t: TrajetLu): Deplacement | undefined => {
    const memes = duMemeJour(t);
    // Même jour : d'abord le trajet déjà payé avec ce train (import répété), puis un trajet non payé.
    const c0 = cote(t);
    const dejaCeTrain = memes.find((d) => d[c0].statut === 'paye' && d[c0].train?.numero === t.numero && d[c0].train?.depart === t.depart);
    if (memes.length) return dejaCeTrain ?? memes.find((d) => d[c0].statut !== 'paye') ?? memes[0];
    const c = cote(t);
    return deplacements.find((d) => {
      if (d[c].statut === 'paye' || lundi(d[c].date) !== lundi(t.date) || tous.some((x) => x !== t && x.sens === t.sens && x.date === d[c].date)) return false;
      const [aller, retour] = c === 'aller' ? [t.date, d.retour.date] : [d.aller.date, t.date];
      return !verifierDates(aller, retour);
    });
  };

  // 1. Déplacements à créer pour les trajets orphelins : un aller et le premier retour suivant de la même semaine.
  const orphelins = tous.filter((t) => !trouver(t));
  const allers = orphelins.filter((t) => t.sens === 'MP').sort((a, b) => a.date.localeCompare(b.date) || a.depart - b.depart);
  const retours = orphelins.filter((t) => t.sens === 'PM').sort((a, b) => a.date.localeCompare(b.date) || a.depart - b.depart);
  const utilises = new Set<TrajetLu>();
  for (const a of allers) {
    if (trouver(a)) continue;
    const r = retours.find((x) => !utilises.has(x) && lundi(x.date) === lundi(a.date) && (x.date > a.date || (x.date === a.date && x.depart > a.depart)));
    if (!r) continue;
    if (deplacements.length >= MAX_DEPLACEMENTS) {
      rapport.horsPlafond.push(a, r);
      utilises.add(r);
      continue;
    }
    utilises.add(r);
    deplacements.push(nouveauDeplacement(nouvelId(), a.date, r.date));
    rapport.crees++;
  }

  // 2. Trajets payés, billet par billet.
  for (const b of billets) {
    const parts = b.trajets.length === 2 ? [Math.floor(b.prixCentimes / 2), b.prixCentimes - Math.floor(b.prixCentimes / 2)] : [b.prixCentimes];
    const cibles = b.trajets.map((t, i) => {
      const d = rapport.horsPlafond.includes(t) ? undefined : trouver(t);
      if (!d) return { t, i };
      const actuel = d[cote(t)];
      const train = trainDe(t, h, actuel.train);
      const identique =
        actuel.statut === 'paye' && !!actuel.billet && actuel.date === t.date && actuel.prixCentimes === parts[i] && actuel.tarif === b.tarif &&
        actuel.train?.numero === train?.numero && actuel.train?.depart === train?.depart;
      return { t, i, d, train, identique };
    });
    for (const c of cibles) if (!c.d && !rapport.horsPlafond.includes(c.t)) rapport.ignores.push(c.t);
    const aAppliquer = cibles.filter((c) => c.d && !c.identique);
    rapport.dejaImportes += cibles.filter((c) => c.identique).length;
    if (!aAppliquer.length) continue;
    // Les deux trajets d'un aller-retour gardent (ou reçoivent) le même identifiant de billet.
    const deja = cibles.find((c) => c.identique);
    const billet = b.trajets.length === 2 && cibles.every((c) => c.d) ? ((deja ? deja.d![cote(deja.t)].billet : undefined) ?? nouvelId()) : undefined;
    for (const { t, i, d, train } of aAppliquer) {
      const c = cote(t);
      const courant = deplacements.find((x) => x.id === d!.id)!;
      const actuel = courant[c];
      const nouveau: Trajet = { date: t.date, statut: 'paye', prixCentimes: parts[i]! };
      if (train) nouveau.train = train;
      if (billet) nouveau.billet = billet;
      if (b.tarif) nouveau.tarif = b.tarif;
      if (actuel.statut === 'paye') rapport.corriges++;
      if (actuel.date !== t.date) rapport.dates++;
      deplacements = deplacements.map((x) => (x.id === courant.id ? { ...x, [c]: nouveau } : x));
      rapport.payes++;
    }
  }
  return { deplacements: trier(deplacements), rapport };
}
