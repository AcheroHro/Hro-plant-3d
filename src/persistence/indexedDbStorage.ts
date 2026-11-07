import { SerializedGraphState } from '../types/piping';
import { SpecCatalogData } from '../core/specs/catalogTypes';

const DB_NAME = 'AcheroPlant3D_DB';
const STORE_NAME = 'workspace_state';
const DB_VERSION = 2;
const SPEC_STORE = 'spec_cache';
const SPEC_KEY = 'active_spec';
const STATE_KEY = 'active_piping_graph';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB no está disponible en este entorno.'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(SPEC_STORE)) {
        db.createObjectStore(SPEC_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveGraphToIndexedDb(state: SerializedGraphState): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(state, STATE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Advertencia: No se pudo persistir en IndexedDB:', err);
  }
}

export async function loadGraphFromIndexedDb(): Promise<SerializedGraphState | null> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(STATE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Advertencia: No se pudo recuperar desde IndexedDB:', err);
    return null;
  }
}

export async function clearGraphIndexedDb(): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(STATE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Advertencia: No se pudo limpiar IndexedDB:', err);
  }
}

/** Spec activa ya parseada (JSON), para abrir la app sin conexión y sin volver a leer SQLite */
export interface CachedSpecEntry {
  data: SpecCatalogData;
  connectorsXml?: string;
  savedAt: number;
}

export async function saveSpecCache(entry: CachedSpecEntry): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SPEC_STORE, 'readwrite');
      const req = tx.objectStore(SPEC_STORE).put(entry, SPEC_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Advertencia: No se pudo guardar la spec en IndexedDB:', err);
  }
}

export async function loadSpecCache(): Promise<CachedSpecEntry | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SPEC_STORE, 'readonly');
      const req = tx.objectStore(SPEC_STORE).get(SPEC_KEY);
      req.onsuccess = () => resolve((req.result as CachedSpecEntry) || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Advertencia: No se pudo leer la spec guardada:', err);
    return null;
  }
}
