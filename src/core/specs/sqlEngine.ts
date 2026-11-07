import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

let SQL_PROMISE: Promise<SqlJsStatic> | null = null;

function isNode(): boolean {
  return (
    typeof process !== 'undefined' &&
    !!(process as { versions?: { node?: string } }).versions?.node &&
    typeof (globalThis as { document?: unknown }).document === 'undefined' &&
    typeof (globalThis as { importScripts?: unknown }).importScripts === 'undefined'
  );
}

/** Instancia única de sql.js (WebAssembly). Funciona en el navegador, en un Worker y en Node (tests). */
export function getSqlInstance(): Promise<SqlJsStatic> {
  if (!SQL_PROMISE) {
    SQL_PROMISE = initSqlJs({
      locateFile: (file: string) => (isNode() ? `node_modules/sql.js/dist/${file}` : `/${file}`)
    });
  }
  return SQL_PROMISE;
}

export function isSqliteBuffer(buf: ArrayBuffer | Uint8Array): boolean {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.byteLength < 100) return false;
  return String.fromCharCode(...u8.subarray(0, 15)) === 'SQLite format 3';
}

export async function openSqlite(buffer: ArrayBuffer | Uint8Array): Promise<Database> {
  const SQL = await getSqlInstance();
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return new SQL.Database(u8);
}
