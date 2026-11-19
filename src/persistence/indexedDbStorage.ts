import { SerializedGraphState } from '../types/piping';
import { SpecCatalogData } from '../core/specs/catalogTypes';
import { EquipmentRecord } from '../core/equipment/equipmentCatalog';

/**
 * Todo lo que la app guarda en el teléfono (IndexedDB): proyectos de campo con su modelo, la
 * línea base contra la que se registran los cambios, las notas y las fotos; y la última spec.
 */

const DB_NAME = 'AcheroPlant3D_DB';
const DB_VERSION = 3;
const LEGACY_STORE = 'workspace_state';
const LEGACY_KEY = 'active_piping_graph';
const SPEC_STORE = 'spec_cache';
const SPEC_KEY = 'active_spec';
const PROJECTS = 'projects';
const PHOTOS = 'photos';
const ACTIVE_KEY = 'achero.activeProject';

export interface FieldNote {
  id: string;
  /** Pieza a la que se refiere (si se tomó con una pieza seleccionada) */
  componentId?: string;
  /** Descripción de la pieza al momento de la nota (por si después se borra) */
  componentLabel?: string;
  text: string;
  createdAt: number;
  photoIds: string[];
}

/** Referencia de obra: líneas de un DXF dibujadas de fondo */
export interface ReferenceRecord {
  name: string;
  /** Segmentos en unidades del dibujo: x1, y1, z1, x2, y2, z2, ... */
  segments: number[];
  /** Milímetros por unidad del dibujo */
  scale: number;
  visible: boolean;
}

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Archivo PCF de origen */
  sourceName?: string;
  specName?: string;
  state: SerializedGraphState;
  /** Modelo tal como llegó de Plant: los cambios de campo se miden contra esto */
  baseline: SerializedGraphState | null;
  baselineAt?: number;
  notes: FieldNote[];
  reference?: ReferenceRecord;
  equipment?: EquipmentRecord[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sourceName?: string;
  lineNumber?: string;
  componentCount: number;
  noteCount: number;
  hasBaseline: boolean;
}

export interface PhotoRecord {
  id: string;
  projectId: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está disponible en este entorno.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE)) db.createObjectStore(LEGACY_STORE);
      if (!db.objectStoreNames.contains(SPEC_STORE)) db.createObjectStore(SPEC_STORE);
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PHOTOS)) {
        const photos = db.createObjectStore(PHOTOS, { keyPath: 'id' });
        photos.createIndex('projectId', 'projectId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

// ---------------------------------------------------------------------------------------------
// Proyecto activo

export function getActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveProjectId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // sin almacenamiento
  }
}

// ---------------------------------------------------------------------------------------------
// Proyectos

export async function getProject(id: string): Promise<ProjectRecord | null> {
  try {
    return ((await req((await store(PROJECTS)).get(id))) as ProjectRecord) || null;
  } catch {
    return null;
  }
}

export async function putProject(rec: ProjectRecord): Promise<void> {
  await req((await store(PROJECTS, 'readwrite')).put(rec));
}

export async function listProjects(): Promise<ProjectMeta[]> {
  try {
    const all = (await req((await store(PROJECTS)).getAll())) as ProjectRecord[];
    return all
      .map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        sourceName: p.sourceName,
        lineNumber: p.state.activeLineNumber,
        componentCount: Object.keys(p.state.components).length,
        noteCount: p.notes.length,
        hasBaseline: Boolean(p.baseline)
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function createProject(init: {
  name: string;
  state: SerializedGraphState;
  baseline?: SerializedGraphState | null;
  sourceName?: string;
  notes?: FieldNote[];
}): Promise<ProjectRecord> {
  const now = Date.now();
  const rec: ProjectRecord = {
    id: newId('prj'),
    name: init.name,
    createdAt: now,
    updatedAt: now,
    sourceName: init.sourceName,
    specName: init.state.activeSpec,
    state: init.state,
    baseline: init.baseline ?? null,
    baselineAt: init.baseline ? now : undefined,
    notes: init.notes ?? []
  };
  try {
    await putProject(rec);
  } catch (err) {
    console.warn('No se pudo guardar el proyecto:', err);
  }
  setActiveProjectId(rec.id);
  return rec;
}

export async function updateProject(id: string, patch: Partial<Omit<ProjectRecord, 'id'>>): Promise<ProjectRecord | null> {
  try {
    const s = await store(PROJECTS, 'readwrite');
    const cur = (await req(s.get(id))) as ProjectRecord | undefined;
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    await req(s.put(next));
    return next;
  } catch (err) {
    console.warn('No se pudo actualizar el proyecto:', err);
    return null;
  }
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([PROJECTS, PHOTOS], 'readwrite');
  tx.objectStore(PROJECTS).delete(id);
  const keys = await req(tx.objectStore(PHOTOS).index('projectId').getAllKeys(id));
  for (const k of keys) tx.objectStore(PHOTOS).delete(k);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  if (getActiveProjectId() === id) setActiveProjectId(null);
}

// ---------------------------------------------------------------------------------------------
// Modelo del proyecto activo (lo que llaman las acciones de edición)

let pendingState: SerializedGraphState | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function flushState(): Promise<void> {
  const state = pendingState;
  pendingState = null;
  saveTimer = null;
  if (!state) return;
  const id = getActiveProjectId();
  if (id && (await updateProject(id, { state, specName: state.activeSpec }))) return;
  await createProject({ name: state.activeLineNumber || 'Proyecto', state });
}

/** Guarda el modelo en el proyecto activo (agrupa las escrituras seguidas) */
export function saveGraphToIndexedDb(state: SerializedGraphState): Promise<void> {
  pendingState = state;
  if (saveTimer) clearTimeout(saveTimer);
  return new Promise((resolve) => {
    saveTimer = setTimeout(() => flushState().catch((err) => console.warn('No se pudo guardar:', err)).finally(resolve), 250);
  });
}

/** Escribe ya lo pendiente (antes de cambiar de proyecto o cerrar la app) */
export async function flushPendingSave(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  await flushState();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushPendingSave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPendingSave();
  });
}

/**
 * Proyecto activo al abrir la app. Si viene de una versión sin proyectos, pasa el modelo que
 * estaba guardado a un proyecto nuevo.
 */
let loading: Promise<ProjectRecord | null> | null = null;

export function loadActiveProject(): Promise<ProjectRecord | null> {
  // Una sola carga a la vez: si la app arranca dos veces seguidas no migra el modelo dos veces
  loading ??= loadActiveProjectOnce().finally(() => {
    loading = null;
  });
  return loading;
}

async function loadActiveProjectOnce(): Promise<ProjectRecord | null> {
  try {
    const id = getActiveProjectId();
    if (id) {
      const p = await getProject(id);
      if (p) return p;
    }
    const metas = await listProjects();
    if (metas.length) {
      const p = await getProject(metas[0].id);
      if (p) {
        setActiveProjectId(p.id);
        return p;
      }
    }
    const legacy = (await req((await store(LEGACY_STORE)).get(LEGACY_KEY))) as SerializedGraphState | undefined;
    if (legacy && Object.keys(legacy.components).length) {
      const rec = await createProject({ name: legacy.activeLineNumber || 'Proyecto 1', state: legacy, sourceName: legacy.pcf?.sourceName });
      await req((await store(LEGACY_STORE, 'readwrite')).delete(LEGACY_KEY));
      return rec;
    }
  } catch (err) {
    console.warn('No se pudo recuperar el proyecto:', err);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Fotos

export async function savePhoto(projectId: string, blob: Blob, width: number, height: number): Promise<string> {
  const rec: PhotoRecord = { id: newId('foto'), projectId, blob, width, height, createdAt: Date.now() };
  await req((await store(PHOTOS, 'readwrite')).put(rec));
  return rec.id;
}

export async function getPhoto(id: string): Promise<PhotoRecord | null> {
  try {
    return ((await req((await store(PHOTOS)).get(id))) as PhotoRecord) || null;
  } catch {
    return null;
  }
}

export async function deletePhoto(id: string): Promise<void> {
  try {
    await req((await store(PHOTOS, 'readwrite')).delete(id));
  } catch {
    // ya no está
  }
}

// ---------------------------------------------------------------------------------------------
// Copia de un proyecto en un archivo (.achero) para pasarlo entre el teléfono y la PC

interface ProjectBundle {
  format: 'achero-project';
  version: 1;
  project: ProjectRecord;
  photos: { id: string; width: number; height: number; createdAt: number; type: string; data: string }[];
}

const blobToBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

export async function exportProjectBundle(id: string): Promise<string | null> {
  const project = await getProject(id);
  if (!project) return null;
  const ids = new Set(project.notes.flatMap((n) => n.photoIds));
  const photos: ProjectBundle['photos'] = [];
  for (const pid of ids) {
    const ph = await getPhoto(pid);
    if (ph) photos.push({ id: ph.id, width: ph.width, height: ph.height, createdAt: ph.createdAt, type: ph.blob.type, data: await blobToBase64(ph.blob) });
  }
  const bundle: ProjectBundle = { format: 'achero-project', version: 1, project, photos };
  return JSON.stringify(bundle);
}

export function isProjectBundle(text: string): boolean {
  return /^\s*\{\s*"format"\s*:\s*"achero-project"/.test(text);
}

/** Importa una copia como proyecto nuevo (no pisa el original si ya existe) */
export async function importProjectBundle(text: string): Promise<ProjectRecord> {
  const bundle = JSON.parse(text) as ProjectBundle;
  if (bundle.format !== 'achero-project') throw new Error('El archivo no es un proyecto de Achero Plant 3D.');
  const src = bundle.project;
  const rec = await createProject({
    name: src.name,
    state: src.state,
    baseline: src.baseline,
    sourceName: src.sourceName,
    notes: []
  });
  const idMap = new Map<string, string>();
  for (const ph of bundle.photos) {
    const bytes = Uint8Array.from(atob(ph.data), (c) => c.charCodeAt(0));
    idMap.set(ph.id, await savePhoto(rec.id, new Blob([bytes], { type: ph.type || 'image/jpeg' }), ph.width, ph.height));
  }
  const notes = src.notes.map((n) => ({ ...n, photoIds: n.photoIds.map((p) => idMap.get(p)).filter((p): p is string => Boolean(p)) }));
  return (await updateProject(rec.id, { notes, baselineAt: src.baselineAt, createdAt: src.createdAt, reference: src.reference })) ?? rec;
}

// ---------------------------------------------------------------------------------------------
// Spec activa ya parseada (JSON), para abrir la app sin conexión y sin volver a leer SQLite

export interface CachedSpecEntry {
  data: SpecCatalogData;
  connectorsXml?: string;
  savedAt: number;
}

export async function saveSpecCache(entry: CachedSpecEntry): Promise<void> {
  try {
    await req((await store(SPEC_STORE, 'readwrite')).put(entry, SPEC_KEY));
  } catch (err) {
    console.warn('Advertencia: No se pudo guardar la spec en IndexedDB:', err);
  }
}

export async function loadSpecCache(): Promise<CachedSpecEntry | null> {
  try {
    return ((await req((await store(SPEC_STORE)).get(SPEC_KEY))) as CachedSpecEntry) || null;
  } catch (err) {
    console.warn('Advertencia: No se pudo leer la spec guardada:', err);
    return null;
  }
}
