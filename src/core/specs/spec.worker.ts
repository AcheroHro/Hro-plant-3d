/// <reference lib="webworker" />
import { SpecDatabaseReader } from './SpecDatabaseReader';

/**
 * Worker que abre la .pspc / .pcat con sql.js fuera del hilo de la interfaz y devuelve
 * la spec como JSON. Así la app no se congela con catálogos grandes.
 */
self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer; fileName: string }>) => {
  try {
    const data = await SpecDatabaseReader.parseBuffer(e.data.buffer, e.data.fileName);
    (self as unknown as Worker).postMessage({ ok: true, data });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message || String(err) });
  }
};
