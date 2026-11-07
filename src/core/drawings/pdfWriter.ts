import { LAYER_COLOR, Prim, Sheet, textWidth } from './sheet';

/**
 * PDF vectorial mínimo (PDF 1.4) sin dependencias: líneas, polígonos, círculos y texto en
 * Helvetica con codificación WinAnsi (acentos y ñ). Funciona sin conexión en el teléfono.
 */

const PT = 72 / 25.4;
const f = (v: number) => (Math.round(v * PT * 100) / 100).toString();

/** Caracteres de WinAnsi fuera de Latin-1 */
const WIN_ANSI: Record<string, number> = { '…': 0x85, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '€': 0x80 };

/** Signos que Helvetica (WinAnsi) no tiene: se escriben con equivalentes ASCII */
const ASCII_FALLBACK: [RegExp, string][] = [
  [/→/g, '->'],
  [/←/g, '<-'],
  [/−/g, '-'],
  [/≈/g, '~'],
  [/≤/g, '<='],
  [/≥/g, '>=']
];

export function pdfSafeText(s: string): string {
  return ASCII_FALLBACK.reduce((t, [re, rep]) => t.replace(re, rep), s);
}

function pdfString(raw: string): string {
  const s = pdfSafeText(raw);
  let out = '';
  for (const ch of s) {
    let code = WIN_ANSI[ch] ?? ch.charCodeAt(0);
    if (code > 0xff) code = ch.normalize('NFD').charCodeAt(0);
    if (code > 0xff) code = 0x3f;
    const c = String.fromCharCode(code);
    out += c === '(' || c === ')' || c === '\\' ? `\\${c}` : c;
  }
  return `(${out})`;
}

function color([r, g, b]: [number, number, number], stroke: boolean): string {
  return `${r} ${g} ${b} ${stroke ? 'RG' : 'rg'}`;
}

/** Círculo con 4 curvas de Bézier */
function circlePath(cx: number, cy: number, r: number): string {
  const k = 0.5523 * r;
  const p = (x: number, y: number) => `${f(x)} ${f(y)}`;
  return [
    `${p(cx + r, cy)} m`,
    `${p(cx + r, cy + k)} ${p(cx + k, cy + r)} ${p(cx, cy + r)} c`,
    `${p(cx - k, cy + r)} ${p(cx - r, cy + k)} ${p(cx - r, cy)} c`,
    `${p(cx - r, cy - k)} ${p(cx - k, cy - r)} ${p(cx, cy - r)} c`,
    `${p(cx + k, cy - r)} ${p(cx + r, cy - k)} ${p(cx + r, cy)} c`
  ].join('\n');
}

const imageName = (ref: string) => `Im${ref.replace(/[^A-Za-z0-9]/g, '')}`;

function primOps(p: Prim): string {
  const c = LAYER_COLOR[p.layer];
  switch (p.k) {
    case 'line':
      return `${color(c, true)} ${f(p.w)} w ${p.dash ? '[3 2] 0 d' : '[] 0 d'} ${f(p.a[0])} ${f(p.a[1])} m ${f(p.b[0])} ${f(p.b[1])} l S`;
    case 'poly': {
      const path = p.pts.map((pt, i) => `${f(pt[0])} ${f(pt[1])} ${i ? 'l' : 'm'}`).join(' ');
      const op = p.fill ? 'b' : p.closed ? 's' : 'S';
      return `${color(c, true)} ${color(c, false)} ${f(p.w)} w [] 0 d ${path} ${op}`;
    }
    case 'circle':
      return `${color(c, true)} ${color(c, false)} ${f(p.w)} w [] 0 d ${circlePath(p.c[0], p.c[1], p.r)} ${p.fill ? 'b' : 's'}`;
    case 'image':
      return `q ${f(p.w)} 0 0 ${f(p.h)} ${f(p.p[0])} ${f(p.p[1])} cm /${imageName(p.ref)} Do Q`;
    case 'text': {
      const w = textWidth(pdfSafeText(p.s), p.size, p.bold);
      const shift = p.align === 'c' ? -w / 2 : p.align === 'r' ? -w : 0;
      const a = ((p.angle ?? 0) * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const tx = p.p[0] + shift * cos;
      const ty = p.p[1] + shift * sin;
      const m = [cos, sin, -sin, cos].map((v) => (Math.round(v * 10000) / 10000).toString()).join(' ');
      return `BT ${color(c, false)} /${p.bold ? 'F2' : 'F1'} ${f(p.size)} Tf ${m} ${f(tx)} ${f(ty)} Tm ${pdfString(p.s)} Tj ET`;
    }
  }
}

export interface PdfMeta {
  title?: string;
  author?: string;
}

export function sheetsToPdf(sheets: Sheet[], meta: PdfMeta = {}): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add('');
  const pagesId = add('');
  const font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  for (const sheet of sheets) {
    const ops = ['1 J 1 j', ...sheet.prims.map(primOps)].join('\n');
    const content = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    // Fotos: el JPEG va tal cual (DCTDecode), el PDF no lo recomprime
    const xobjects: string[] = [];
    for (const ref of new Set(sheet.prims.flatMap((p) => (p.k === 'image' ? [p.ref] : [])))) {
      const img = sheet.images?.[ref];
      if (!img) continue;
      let bin = '';
      for (let i = 0; i < img.jpeg.length; i += 0x8000) bin += String.fromCharCode(...img.jpeg.subarray(i, i + 0x8000));
      const id = add(
        `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB ` +
          `/BitsPerComponent 8 /Filter /DCTDecode /Length ${bin.length} >>\nstream\n${bin}\nendstream`
      );
      xobjects.push(`/${imageName(ref)} ${id} 0 R`);
    }
    const xobj = xobjects.length ? ` /XObject << ${xobjects.join(' ')} >>` : '';
    const page = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${f(sheet.width)} ${f(sheet.height)}] ` +
        `/Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >>${xobj} >> /Contents ${content} 0 R >>`
    );
    pageIds.push(page);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const info = add(`<< /Title ${pdfString(meta.title ?? 'Isometricos')} /Author ${pdfString(meta.author ?? 'Achero Plant 3D')} /Producer (Achero Plant 3D) >>`);

  // Todo el archivo es Latin-1: el largo del string es el largo en bytes
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
