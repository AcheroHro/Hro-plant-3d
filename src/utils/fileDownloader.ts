/**
 * Dispara la descarga de un archivo de texto o binario en el navegador
 * sin necesidad de un servidor o backend.
 */
export function downloadFile(filename: string, content: string, mimeType: string = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Descarga un archivo binario (PDF, imágenes) */
export function downloadBytes(filename: string, bytes: Uint8Array, mimeType: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Comparte un archivo con las apps del teléfono (WhatsApp, mail); false si el navegador no puede */
export async function shareBytes(filename: string, bytes: Uint8Array, mimeType: string, title: string): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const file = new File([bytes as BlobPart], filename, { type: mimeType });
  if (!nav.share || !nav.canShare?.({ files: [file] })) return false;
  try {
    await nav.share({ files: [file], title });
    return true;
  } catch {
    return false;
  }
}
