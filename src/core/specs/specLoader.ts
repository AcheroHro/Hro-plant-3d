import { SpecCatalogData, SpecPreferences, SPEC_CATALOG_FORMAT_VERSION } from './catalogTypes';
import { ConnectionRule, DEFAULT_CONNECTION_RULES, parseConnectorsConfig } from './connectionRules';
import { readPspx } from './pspxReader';
import { SpecDatabaseReader } from './SpecDatabaseReader';
import { loadSpecCache, saveSpecCache } from '../../persistence/indexedDbStorage';

/** Tamaño a partir del cual se avisa que el catálogo puede no entrar en la memoria de un teléfono */
const LARGE_FILE_BYTES = 120 * 1024 * 1024;

/** Parsea la base de la spec en un Web Worker (en tests o navegadores sin Worker, en el hilo actual) */
export async function parseSpecBuffer(buffer: ArrayBuffer, fileName: string): Promise<SpecCatalogData> {
  if (typeof Worker === 'undefined' || typeof window === 'undefined') {
    return SpecDatabaseReader.parseBuffer(buffer, fileName);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./spec.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ ok: boolean; data?: SpecCatalogData; error?: string }>) => {
      worker.terminate();
      if (e.data.ok && e.data.data) resolve(e.data.data);
      else reject(new Error(e.data.error || 'No se pudo leer la spec.'));
    };
    worker.onerror = (ev) => {
      worker.terminate();
      // Si el Worker no arranca (navegador viejo), leer en el hilo principal
      ev.preventDefault();
      SpecDatabaseReader.parseBuffer(buffer, fileName).then(resolve, reject);
    };
    worker.postMessage({ buffer, fileName }, [buffer]);
  });
}

export interface LoadedSpec {
  reader: SpecDatabaseReader;
  rules: ConnectionRule[];
  /** Avisos para mostrar al usuario */
  notes: string[];
}

function finish(data: SpecCatalogData, connectorsXml: string | undefined, notes: string[]): LoadedSpec {
  let rules = DEFAULT_CONNECTION_RULES;
  if (connectorsXml) {
    const parsed = parseConnectorsConfig(connectorsXml);
    if (parsed.length) rules = parsed;
    else notes.push('DefaultConnectorsConfig.xml sin uniones reconocibles: se usan las reglas por defecto.');
  }
  const reader = SpecDatabaseReader.fromCatalogData(data, rules);
  return { reader, rules, notes: [...notes, ...data.warnings] };
}

/**
 * Carga una spec desde archivos elegidos por el usuario: la .pspc o .pcat (obligatoria),
 * su .pspx (prioridades y tabla de ramales) y el DefaultConnectorsConfig.xml del proyecto.
 */
export async function loadSpecFromFiles(files: File[]): Promise<LoadedSpec> {
  const db = files.find((f) => /\.(pspc|pcat)$/i.test(f.name));
  const pspx = files.find((f) => /\.pspx$/i.test(f.name));
  const xml = files.find((f) => /\.xml$/i.test(f.name));
  const notes: string[] = [];
  if (!db) {
    throw new Error('Elegí la .pspc de la spec (y si podés, su .pspx y el DefaultConnectorsConfig.xml del proyecto).');
  }
  if (db.size > LARGE_FILE_BYTES) {
    notes.push(`${db.name} pesa ${(db.size / 1048576).toFixed(0)} MB: en un teléfono puede quedarse sin memoria.`);
  }
  const data = await parseSpecBuffer(await db.arrayBuffer(), db.name);
  if (pspx) {
    data.preferences = await readPspx(await pspx.arrayBuffer());
  } else if (data.kind === 'spec') {
    notes.push('Sin el .pspx la app no conoce las prioridades de la spec: elige por compatibilidad de extremos.');
  }
  const connectorsXml = xml ? await xml.text() : undefined;
  await saveSpecCache({ data, connectorsXml, savedAt: Date.now() });
  return finish(data, connectorsXml, notes);
}

async function fetchOptional(url: string): Promise<ArrayBuffer | undefined> {
  try {
    const r = await fetch(url);
    if (!r.ok) return undefined;
    const buf = await r.arrayBuffer();
    // Vite devuelve index.html para rutas inexistentes
    const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 15));
    if (String.fromCharCode(...head).startsWith('<!doctype') || String.fromCharCode(...head).startsWith('<!DOCTYPE')) return undefined;
    return buf;
  } catch {
    return undefined;
  }
}

/** Spec integrada en la app (carpeta public/) */
export async function loadBundledSpec(name: string): Promise<LoadedSpec> {
  const buf = await fetchOptional(`/${name}.pspc`);
  if (!buf) throw new Error(`No está la spec integrada ${name}.pspc.`);
  const data = await parseSpecBuffer(buf, `${name}.pspc`);
  const pspx = await fetchOptional(`/${name}.pspx`);
  let prefs: SpecPreferences | undefined;
  if (pspx) {
    try {
      prefs = await readPspx(pspx);
    } catch {
      prefs = undefined;
    }
  }
  data.preferences = prefs;
  await saveSpecCache({ data, savedAt: Date.now() });
  return finish(data, undefined, []);
}

/** Última spec usada, guardada en IndexedDB (funciona sin conexión) */
export async function loadCachedSpec(): Promise<LoadedSpec | null> {
  const entry = await loadSpecCache();
  if (!entry || entry.data.formatVersion !== SPEC_CATALOG_FORMAT_VERSION) return null;
  return finish(entry.data, entry.connectorsXml, []);
}

/** Familias fijadas por el usuario en la paleta, por spec */
export function loadPreferredFamilies(specName: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(`achero.families.${specName}`);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function savePreferredFamilies(specName: string, families: Record<string, string>): void {
  try {
    localStorage.setItem(`achero.families.${specName}`, JSON.stringify(families));
  } catch {
    // Sin almacenamiento local: la preferencia dura hasta cerrar la app
  }
}
