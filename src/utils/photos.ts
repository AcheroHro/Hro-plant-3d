import { SheetImage } from '../core/drawings/sheet';
import { getPhoto } from '../persistence/indexedDbStorage';

/**
 * Fotos de campo: se achican a 1600 px y se guardan en JPEG (una foto de celular de 4 MB queda
 * en ~250 kB), así entran muchas en el teléfono y el informe PDF no pesa de más.
 */
const MAX = 1600;

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      // Respeta la orientación EXIF de la cámara
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // sigue con <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function compressPhoto(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await decode(file);
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no puede procesar la foto.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img.source, 0, 0, width, height);
  img.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  if (!blob) throw new Error('No se pudo convertir la foto a JPEG.');
  return { blob, width, height };
}

/** Foto guardada lista para el PDF */
export async function photoForReport(id: string): Promise<SheetImage | null> {
  const ph = await getPhoto(id);
  if (!ph) return null;
  return { jpeg: new Uint8Array(await ph.blob.arrayBuffer()), width: ph.width, height: ph.height };
}
