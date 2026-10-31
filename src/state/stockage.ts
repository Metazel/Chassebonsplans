/**
 * Stockage local (EXG-01) : IndexedDB, sans dépendance.
 * Résilience : si IndexedDB est indisponible (navigation privée, stockage bloqué), l'appli
 * fonctionne en mémoire et le signale ; elle demande au navigateur de ne pas évincer les données.
 */

const BASE = 'chassebonsplans';
const MAGASIN = 'etat';
const CLE = 'profil';

export interface Stockage {
  mode: 'local' | 'memoire';
  lire(): Promise<unknown>;
  ecrire(valeur: unknown): Promise<void>;
  effacer(): Promise<void>;
}

function requete<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, ko) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(MAGASIN);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
    r.onblocked = () => ko(new Error('Base bloquée'));
  });
}

export function stockageMemoire(): Stockage {
  let valeur: unknown = null;
  return {
    mode: 'memoire',
    lire: async () => valeur,
    ecrire: async (v) => {
      valeur = structuredClone(v);
    },
    effacer: async () => {
      valeur = null;
    },
  };
}

export async function ouvrirStockage(): Promise<Stockage> {
  try {
    if (typeof indexedDB === 'undefined') return stockageMemoire();
    const db = await ouvrir();
    // Demande de stockage persistant : le navigateur n'efface pas les données sous pression d'espace.
    navigator.storage?.persist?.().catch(() => undefined);
    const tx = (mode: IDBTransactionMode) => db.transaction(MAGASIN, mode).objectStore(MAGASIN);
    return {
      mode: 'local',
      lire: async () => (await requete(tx('readonly').get(CLE))) ?? null,
      ecrire: async (v) => {
        await requete(tx('readwrite').put(v, CLE));
      },
      effacer: async () => {
        await requete(tx('readwrite').delete(CLE));
      },
    };
  } catch {
    return stockageMemoire();
  }
}
