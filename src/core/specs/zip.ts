/**
 * Lector mínimo de ZIP (stored + deflate) sin dependencias, para los .pspx de Plant 3D
 * y, más adelante, para los paquetes de campo. Usa DecompressionStream, que existe en
 * los navegadores actuales, en Web Workers y en Node 18+.
 */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function readZip(buffer: ArrayBuffer | Uint8Array): Promise<Map<string, Uint8Array>> {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const files = new Map<string, Uint8Array>();

  // Fin del directorio central: buscar la firma desde el final (comentario de hasta 64 KB)
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('El archivo no es un ZIP válido.');

  const entries = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8');

  for (let n = 0; n < entries; n++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOffset = dv.getUint32(ptr + 42, true);
    const name = decoder.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (dv.getUint32(localOffset, true) !== 0x04034b50) continue;
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const data = u8.subarray(start, start + compSize);
    if (method === 0) files.set(name, data.slice());
    else if (method === 8) files.set(name, await inflateRaw(data));
  }
  return files;
}

/** Decodifica texto quitando el BOM de UTF-8 */
export function decodeText(data: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(data);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
