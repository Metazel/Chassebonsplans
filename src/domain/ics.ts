/**
 * Export agenda (RFC 5545) : un événement par trajet avec train choisi, et un rappel la veille
 * de la date limite de paiement d'une option posée. Heures en Europe/Paris (VTIMEZONE incluse).
 */
import type { Deplacement, Trajet } from './deplacements';

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Paris',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

/** Échappement des textes (RFC 5545 §3.3.11). */
export const echapper = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Plie les lignes à 75 octets (RFC 5545 §3.1). */
export function plier(ligne: string): string {
  const octets = new TextEncoder().encode(ligne);
  if (octets.length <= 75) return ligne;
  const morceaux: string[] = [];
  let courant = '';
  let taille = 0;
  for (const c of ligne) {
    const n = new TextEncoder().encode(c).length;
    if (taille + n > (morceaux.length ? 74 : 75)) {
      morceaux.push(courant);
      courant = '';
      taille = 0;
    }
    courant += c;
    taille += n;
  }
  morceaux.push(courant);
  return morceaux.join('\r\n ');
}

function horodatage(date: string, minutes: number): string {
  const [a, m, j] = date.split('-').map(Number);
  const d = new Date(Date.UTC(a!, m! - 1, j!, 0, minutes));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
}

const jourEntier = (date: string) => date.replace(/-/g, '');

function evenementTrajet(d: Deplacement, cote: 'aller' | 'retour', t: Trajet, stamp: string): string[] {
  if (!t.train) return [];
  const titre = cote === 'aller' ? 'Train Marseille → Paris' : 'Train Paris → Marseille';
  return [
    'BEGIN:VEVENT',
    `UID:${d.id}-${cote}@chassebonsplans`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Paris:${horodatage(t.date, t.train.depart)}`,
    `DTEND;TZID=Europe/Paris:${horodatage(t.date, t.train.arrivee)}`,
    `SUMMARY:${echapper(`${titre} — ${t.train.operateur} ${t.train.numero}`)}`,
    `DESCRIPTION:${echapper(`Statut : ${t.statut === 'paye' ? 'payé' : t.statut === 'option' ? 'option posée' : 'à réserver'}. Horaire théorique, à vérifier sur le billet.`)}`,
    'END:VEVENT',
  ];
}

function rappelOption(d: Deplacement, cote: 'aller' | 'retour', t: Trajet, stamp: string): string[] {
  if (t.statut !== 'option' || !t.limiteOption) return [];
  return [
    'BEGIN:VEVENT',
    `UID:${d.id}-${cote}-option@chassebonsplans`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${jourEntier(t.limiteOption)}`,
    `SUMMARY:${echapper(`Payer l’option du train du ${t.date}${t.train ? ` (${t.train.numero})` : ''}`)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Option à payer avant la date limite',
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
  ];
}

export function genererIcs(liste: Deplacement[], maintenant = new Date()): string {
  const stamp = maintenant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lignes = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chasse aux bons plans//FR', 'CALSCALE:GREGORIAN', ...VTIMEZONE];
  for (const d of liste) {
    for (const cote of ['aller', 'retour'] as const) {
      lignes.push(...evenementTrajet(d, cote, d[cote], stamp), ...rappelOption(d, cote, d[cote], stamp));
    }
  }
  lignes.push('END:VCALENDAR');
  return lignes.map(plier).join('\r\n') + '\r\n';
}
