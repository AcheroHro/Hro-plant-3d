/**
 * Modelo de una hoja de plano en milímetros de papel (origen abajo a la izquierda).
 * Lo dibujan igual el PDF, la vista previa SVG y el DXF.
 */

export type Pt = [number, number];

export type Layer = 'FRAME' | 'PIPE' | 'SYMBOL' | 'DIM' | 'TEXT' | 'WELD' | 'FIELD' | 'TABLE' | 'FADED';

export type Prim =
  | { k: 'line'; a: Pt; b: Pt; w: number; layer: Layer; dash?: boolean }
  | { k: 'poly'; pts: Pt[]; closed: boolean; w: number; layer: Layer; fill?: boolean }
  | { k: 'circle'; c: Pt; r: number; w: number; layer: Layer; fill?: boolean }
  | { k: 'text'; p: Pt; s: string; size: number; layer: Layer; angle?: number; align?: 'l' | 'c' | 'r'; bold?: boolean }
  /** Foto JPEG: `p` es la esquina inferior izquierda, `ref` la clave en Sheet.images */
  | { k: 'image'; p: Pt; w: number; h: number; ref: string; layer: Layer };

/** Imagen JPEG para incrustar en el PDF (y data URL para la vista previa) */
export interface SheetImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

export interface Sheet {
  /** Nombre corto para la lista de hojas (Línea, SP01...) */
  name: string;
  width: number;
  height: number;
  prims: Prim[];
  images?: Record<string, SheetImage>;
}

/** Color de cada capa (RGB 0..1) para PDF y SVG */
export const LAYER_COLOR: Record<Layer, [number, number, number]> = {
  FRAME: [0, 0, 0],
  PIPE: [0, 0, 0],
  SYMBOL: [0, 0, 0],
  DIM: [0.1, 0.25, 0.6],
  TEXT: [0, 0, 0],
  WELD: [0, 0, 0],
  FIELD: [0.85, 0.3, 0],
  TABLE: [0, 0, 0],
  FADED: [0.6, 0.6, 0.6]
};

/** Anchos de Helvetica (AFM, en milésimas del cuerpo) para caracteres 32..126 */
const HELV: number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];

/** Ancho aproximado de un texto en mm para un cuerpo `size` (mm) */
export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.normalize('NFD').charCodeAt(0);
    w += code >= 32 && code <= 126 ? HELV[code - 32] : 556;
  }
  return (w / 1000) * size * (bold ? 1.06 : 1);
}

/** Recorta un texto para que entre en `maxW` mm */
export function fitText(s: string, size: number, maxW: number, bold = false): string {
  if (textWidth(s, size, bold) <= maxW) return s;
  let out = s;
  while (out.length > 1 && textWidth(out + '…', size, bold) > maxW) out = out.slice(0, -1);
  return out + '…';
}

export const PAPER = {
  A3: { width: 420, height: 297 },
  A4: { width: 297, height: 210 }
} as const;

export type PaperSize = keyof typeof PAPER;
