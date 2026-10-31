/**
 * Stockage local (EXG-01) : IndexedDB, sans dépendance.
 * Résilience : repli en mémoire signalé si IndexedDB est indisponible ; demande de stockage persistant ;
 * synchronisation entre onglets (BroadcastChannel) pour qu'une suppression s'applique partout (EXG-04).
 */

const BASE = 'chassebonsplans';
const MAGASIN = 'etat';
export const CLE_PROFIL = 'profil';
/** Copie brute d'un profil illisible, mise de côté au lieu d'être écrasée. */
export const CLE_ILLISIBLE = 'profil-illisible';
const CANAL = 'chassebonsplans';

export interface Stockage {
  mode: 'local' | 'memoire';
  lire(cle?: string): Promise<unknown>;
  ecrire(valeur: unknown, cle?: string): Promise<void>;
  effacer(): Promise<void>;
  /** Appelé quand un autre onglet a modifié les données. */
  surChangementExterne(rappel: () => void): () => void;
}

function requete<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, ko) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

function fin(tx: IDBTransaction): Promise<void> {
  return new Promise((ok, ko) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => ko(tx.error);
    tx.onabort = () => ko(tx.error ?? new Error('Écriture annulée'));
  });
}

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(MAGASIN);
    r.onsuccess = () => {
      // Une future version de la base (autre onglet plus récent) ferme proprement celle-ci.
      r.result.onversionchange = () => r.result.close();
      ok(r.result);
    };
    r.onerror = () => ko(r.error);
    r.onblocked = () => ko(new Error('Base bloquée'));
  });
}

function canal(): { annoncer: () => void; ecouter: (f: () => void) => () => void } {
  if (typeof BroadcastChannel === 'undefined') return { annoncer: () => undefined, ecouter: () => () => undefined };
  const bc = new BroadcastChannel(CANAL);
  return {
    annoncer: () => bc.postMessage('maj'),
    ecouter: (f) => {
      const h = () => f();
      bc.addEventListener('message', h);
      return () => bc.removeEventListener('message', h);
    },
  };
}

export function stockageMemoire(): Stockage {
  const valeurs = new Map<string, unknown>();
  return {
    mode: 'memoire',
    lire: async (cle = CLE_PROFIL) => valeurs.get(cle) ?? null,
    ecrire: async (v, cle = CLE_PROFIL) => {
      valeurs.set(cle, structuredClone(v));
    },
    effacer: async () => {
      valeurs.clear();
    },
    surChangementExterne: () => () => undefined,
  };
}

export async function ouvrirStockage(): Promise<Stockage> {
  try {
    if (typeof indexedDB === 'undefined') return stockageMemoire();
    const db = await ouvrir();
    navigator.storage?.persist?.().catch(() => undefined);
    const bc = canal();
    return {
      mode: 'local',
      lire: async (cle = CLE_PROFIL) => (await requete(db.transaction(MAGASIN, 'readonly').objectStore(MAGASIN).get(cle))) ?? null,
      ecrire: async (v, cle = CLE_PROFIL) => {
        const tx = db.transaction(MAGASIN, 'readwrite');
        tx.objectStore(MAGASIN).put(v, cle);
        await fin(tx);
        bc.annoncer();
      },
      effacer: async () => {
        const tx = db.transaction(MAGASIN, 'readwrite');
        tx.objectStore(MAGASIN).clear();
        await fin(tx);
        bc.annoncer();
      },
      surChangementExterne: bc.ecouter,
    };
  } catch {
    return stockageMemoire();
  }
}
