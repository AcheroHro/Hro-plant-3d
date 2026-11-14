import { Prim, Sheet, SheetImage, fitText, textWidth } from '../drawings/sheet';
import { CHANGE_LABEL, FieldChange, summarizeChanges } from './changeLog';

/**
 * Informe de campo en A4 vertical: qué cambió respecto del PCF de Plant, las notas y las fotos.
 * Se arma con el mismo modelo de hoja que los isométricos (sale en el mismo PDF).
 */

export interface ReportNote {
  text: string;
  createdAt: number;
  componentLabel?: string;
  photos: SheetImage[];
}

/** Una soldadura de la línea, con la numeración de obra (SW-001, FW-001, FFW-001) */
export interface ReportWeld {
  number: string;
  kind: 'SHOP' | 'FW' | 'FFW';
  /** Tipo de unión: a tope, enchufe, olet */
  type: string;
  nominalDiameter: string;
  spools: string;
  /** Solo en las de ajuste en obra: sobrelargo que se deja en el caño (mm) */
  allowanceMm?: number;
}

export const WELD_KIND_LABEL: Record<ReportWeld['kind'], string> = { SHOP: 'Taller', FW: 'Campo', FFW: 'Ajuste en obra' };

export interface FieldReportInput {
  projectName: string;
  lineNumber?: string;
  sourceName?: string;
  specName?: string;
  baselineAt?: number;
  drawnBy?: string;
  date?: Date;
  changes: FieldChange[];
  notes: ReportNote[];
  /** Soldaduras de la línea (lista para el mapa de soldaduras) */
  welds?: ReportWeld[];
  /** Si el isométrico de la línea, con los números de soldadura, va al final del informe */
  weldMapIncluded?: boolean;
}

const W = 210;
const H = 297;
const M = 12;
const FOOT = 14;

const fmtDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Corta un texto en renglones que entren en `maxW` mm */
export function wrapText(s: string, size: number, maxW: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of s.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) <= maxW) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // Palabra más larga que el renglón
      let w = word;
      while (textWidth(w, size, bold) > maxW) {
        let cut = w.length - 1;
        while (cut > 1 && textWidth(w.slice(0, cut), size, bold) > maxW) cut--;
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

export function buildFieldReport(input: FieldReportInput): Sheet[] {
  const sheets: Sheet[] = [];
  let prims: Prim[] = [];
  let images: Record<string, SheetImage> = {};
  let y = H - M;
  let imgSeq = 0;

  const text = (x: number, yy: number, s: string, size = 2.8, opts: Partial<Extract<Prim, { k: 'text' }>> = {}) =>
    prims.push({ k: 'text', p: [x, yy], s, size, layer: 'TEXT', ...opts });
  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.2) => prims.push({ k: 'line', a: [x1, y1], b: [x2, y2], w, layer: 'TABLE' });

  const newPage = () => {
    if (prims.length) sheets.push({ name: `Informe ${sheets.length + 1}`, width: W, height: H, prims, images });
    prims = [];
    images = {};
    y = H - M;
    // Encabezado corto en las hojas siguientes
    if (sheets.length) {
      text(M, y - 3, `INFORME DE CAMPO · ${input.projectName}`, 3, { bold: true });
      y -= 8;
      line(M, y, W - M, y, 0.3);
      y -= 4;
    }
  };
  const ensure = (h: number) => {
    if (y - h < M + FOOT) newPage();
  };

  newPage();

  // Encabezado
  text(M, y - 5, 'INFORME DE CAMBIOS EN CAMPO', 5.5, { bold: true });
  text(W - M, y - 5, fmtDate(input.date ?? new Date()), 3, { align: 'r' });
  y -= 11;
  const rows: [string, string][] = [
    ['Proyecto', input.projectName],
    ['Línea', input.lineNumber || '—'],
    ['PCF de origen', input.sourceName || '—'],
    ['Spec', input.specName || '—'],
    ['Base de comparación', input.baselineAt ? fmtDate(new Date(input.baselineAt)) : 'sin PCF de origen: todo el modelo es nuevo'],
    ['Relevó', input.drawnBy || '—']
  ];
  for (const [k, v] of rows) {
    text(M, y, k.toUpperCase(), 2.3, { bold: true, layer: 'FADED' });
    text(M + 42, y, fitText(v, 3, W - 2 * M - 42), 3);
    y -= 5;
  }
  y -= 1;
  prims.push({ k: 'poly', pts: [[M, y], [W - M, y], [W - M, y - 9], [M, y - 9]], closed: true, w: 0.3, layer: 'FIELD' });
  text(M + 3, y - 6, `Resumen: ${summarizeChanges(input.changes)}${input.notes.length ? ` · ${input.notes.length} nota${input.notes.length > 1 ? 's' : ''}` : ''}`, 3.2, {
    bold: true,
    layer: 'FIELD'
  });
  y -= 16;

  // Tabla de cambios
  const cols = [M, M + 8, M + 30, M + 92, W - M];
  const header = () => {
    ensure(14);
    text(M, y, 'CAMBIOS RESPECTO DEL PCF DE PLANT 3D', 3.4, { bold: true });
    y -= 4;
    line(M, y, W - M, y, 0.4);
    y -= 4;
    ['#', 'Cambio', 'Pieza', 'Detalle'].forEach((h, i) => text(cols[i] + 1, y, h, 2.6, { bold: true }));
    y -= 2;
    line(M, y, W - M, y, 0.3);
  };
  if (input.changes.length) {
    header();
    input.changes.forEach((c, i) => {
      const SIZE = 2.6;
      const LH = 3.6;
      const pieza = wrapText(c.label, SIZE, cols[3] - cols[2] - 2);
      const detalle = c.details.flatMap((d) => wrapText(d, SIZE, cols[4] - cols[3] - 2));
      const n = Math.max(pieza.length, detalle.length, 1);
      const h = n * LH + 2;
      if (y - h < M + FOOT) {
        newPage();
        header();
      }
      const top = y - LH;
      text(cols[0] + 1, top, String(i + 1), SIZE);
      text(cols[1] + 1, top, CHANGE_LABEL[c.kind], SIZE, { bold: true, layer: c.kind === 'deleted' || c.kind === 'fieldWeld' ? 'FIELD' : 'TEXT' });
      pieza.forEach((s, k) => text(cols[2] + 1, top - k * LH, s, SIZE));
      detalle.forEach((s, k) => text(cols[3] + 1, top - k * LH, s, SIZE));
      y -= h;
      line(M, y, W - M, y, 0.1);
    });
    y -= 8;
  } else {
    text(M, y, 'No hay cambios de geometría ni de datos respecto del PCF de origen.', 3);
    y -= 10;
  }

  // Soldaduras con la numeración de obra. Plant solo numera con enteros; acá van SW, FW y FFW
  const welds = input.welds ?? [];
  if (welds.length) {
    const wc = [M, M + 24, M + 58, M + 82, M + 102, W - M - 28, W - M];
    const count = (k: ReportWeld['kind']) => welds.filter((w) => w.kind === k).length;
    const weldHeader = () => {
      ensure(18);
      text(M, y, 'SOLDADURAS', 3.4, { bold: true });
      text(
        W - M,
        y,
        `${count('SHOP')} de taller (SW) · ${count('FW')} de campo (FW) · ${count('FFW')} de ajuste en obra (FFW)`,
        2.6,
        { align: 'r', layer: 'FADED' }
      );
      y -= 4;
      line(M, y, W - M, y, 0.4);
      y -= 4;
      ['N.º', 'Tipo', 'Unión', 'Diámetro', 'Spool', 'Sobrelargo'].forEach((h, i) => text(wc[i] + 1, y, h, 2.6, { bold: true }));
      y -= 2;
      line(M, y, W - M, y, 0.3);
    };
    weldHeader();
    for (const w of welds) {
      const LH = 4.2;
      if (y - LH < M + FOOT) {
        newPage();
        weldHeader();
      }
      const top = y - 3.2;
      const field = w.kind !== 'SHOP';
      text(wc[0] + 1, top, w.number, 2.8, { bold: true, layer: field ? 'FIELD' : 'TEXT' });
      text(wc[1] + 1, top, WELD_KIND_LABEL[w.kind], 2.6, { layer: field ? 'FIELD' : 'TEXT' });
      text(wc[2] + 1, top, w.type, 2.6);
      text(wc[3] + 1, top, w.nominalDiameter, 2.6);
      text(wc[4] + 1, top, fitText(w.spools || '—', 2.6, wc[5] - wc[4] - 2), 2.6);
      text(wc[5] + 1, top, w.allowanceMm ? `+${w.allowanceMm} mm` : '—', 2.6);
      y -= LH;
      line(M, y, W - M, y, 0.1);
    }
    y -= 3;
    if (input.weldMapIncluded) {
      ensure(6);
      text(M, y - 1, 'El mapa de soldaduras es el isométrico de la línea, al final del informe: cada número está en su unión.', 2.6, { layer: 'FADED' });
      y -= 6;
    }
    y -= 5;
  }

  // Notas y fotos
  if (input.notes.length) {
    ensure(20);
    text(M, y, 'NOTAS Y FOTOS DE CAMPO', 3.4, { bold: true });
    y -= 4;
    line(M, y, W - M, y, 0.4);
    y -= 6;
    input.notes.forEach((note, i) => {
      const head = `${i + 1}. ${fmtDate(new Date(note.createdAt))}${note.componentLabel ? ` · ${note.componentLabel}` : ''}`;
      const body = wrapText(note.text || '(sin texto)', 3, W - 2 * M - 4);
      const colW = (W - 2 * M - 6) / 2;
      const photoH = (ph: SheetImage) => ph.height * Math.min(colW / ph.width, 85 / ph.height);
      const firstRow = note.photos.length ? Math.max(...note.photos.slice(0, 2).map(photoH)) + 4 : 0;
      // El texto de la nota no queda separado de su primera foto
      ensure(6 + body.length * 4.2 + firstRow);
      text(M, y, fitText(head, 2.8, W - 2 * M, true), 2.8, { bold: true });
      y -= 4.5;
      for (const s of body) {
        ensure(4.2);
        text(M + 3, y, s, 3);
        y -= 4.2;
      }
      y -= 1;
      // Fotos de a dos por renglón
      for (let k = 0; k < note.photos.length; k += 2) {
        const pair = note.photos.slice(k, k + 2).map((ph) => {
          const scale = Math.min(colW / ph.width, 85 / ph.height);
          return { ph, w: ph.width * scale, h: ph.height * scale };
        });
        const rowH = Math.max(...pair.map((p) => p.h));
        ensure(rowH + 4);
        pair.forEach(({ ph, w, h }, j) => {
          const ref = `p${++imgSeq}`;
          images[ref] = ph;
          const x = M + j * (colW + 6) + (colW - w) / 2;
          prims.push({ k: 'image', p: [x, y - h], w, h, ref, layer: 'TEXT' });
          prims.push({ k: 'poly', pts: [[x, y - h], [x + w, y - h], [x + w, y], [x, y]], closed: true, w: 0.2, layer: 'FADED' });
        });
        y -= rowH + 4;
      }
      y -= 4;
    });
  }

  if (prims.length) sheets.push({ name: `Informe ${sheets.length + 1}`, width: W, height: H, prims, images });

  // Pie con número de hoja
  sheets.forEach((s, i) => {
    s.prims.push({ k: 'line', a: [M, M + 6], b: [W - M, M + 6], w: 0.2, layer: 'FADED' });
    s.prims.push({ k: 'text', p: [M, M + 2], s: 'Achero Plant 3D · informe de campo', size: 2.4, layer: 'FADED' });
    s.prims.push({ k: 'text', p: [W - M, M + 2], s: `Hoja ${i + 1} / ${sheets.length}`, size: 2.4, layer: 'FADED', align: 'r' });
  });
  return sheets;
}
