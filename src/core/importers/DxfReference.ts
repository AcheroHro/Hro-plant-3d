/**
 * Lector de DXF para usarlo como referencia de obra (ejes, columnas, bases): saca las líneas del
 * dibujo como segmentos. No interpreta cañerías ni sólidos; los textos y las cotas se saltean.
 */

export interface DxfReference {
  /** Segmentos en unidades del dibujo: x1, y1, z1, x2, y2, z2, ... */
  segments: number[];
  /** Milímetros por unidad del dibujo según $INSUNITS, o la mejor suposición */
  scale: number;
  /** De dónde salió la escala */
  scaleSource: 'dxf' | 'supuesta';
  /** Entidades que no se dibujan (textos, cotas, sombreados, sólidos...) */
  skipped: number;
  /** Se cortó por tamaño */
  truncated: boolean;
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
}

export const MAX_REFERENCE_SEGMENTS = 40000;

type Pair = [number, string];
interface Entity {
  type: string;
  pairs: Pair[];
  /** POLYLINE: vértices que la siguen */
  vertices?: Pair[][];
}

const UNIT_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
const CIRCLE_STEPS = 32;

function readPairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push([code, lines[i + 1].trim()]);
  }
  return pairs;
}

const num = (pairs: Pair[], code: number, fallback = 0) => {
  const hit = pairs.find((p) => p[0] === code);
  const v = hit ? parseFloat(hit[1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
};
const str = (pairs: Pair[], code: number) => pairs.find((p) => p[0] === code)?.[1] ?? '';

/** Agrupa los pares de una sección en entidades (cada una empieza con el código 0) */
function readEntities(pairs: Pair[], from: number, to: number): Entity[] {
  const out: Entity[] = [];
  let current: Entity | null = null;
  let poly: Entity | null = null;
  for (let i = from; i < to; i++) {
    const [code, value] = pairs[i];
    if (code === 0) {
      const type = value.toUpperCase();
      current = { type, pairs: [] };
      if (type === 'VERTEX' && poly) {
        const vertex: Pair[] = [];
        poly.vertices!.push(vertex);
        current.pairs = vertex;
        continue;
      }
      if (type === 'SEQEND') {
        poly = null;
        current = null;
        continue;
      }
      if (type === 'POLYLINE') {
        current.vertices = [];
        poly = current;
      }
      out.push(current);
    } else if (current) current.pairs.push([code, value]);
  }
  return out;
}

/** Transformación de un INSERT: escala, giro alrededor de Z y traslado */
interface Xform {
  sx: number;
  sy: number;
  sz: number;
  cos: number;
  sin: number;
  tx: number;
  ty: number;
  tz: number;
}
const apply = (m: Xform, x: number, y: number, z: number): [number, number, number] => {
  const px = x * m.sx;
  const py = y * m.sy;
  return [px * m.cos - py * m.sin + m.tx, px * m.sin + py * m.cos + m.ty, z * m.sz + m.tz];
};

export function parseDxfReference(text: string): DxfReference {
  const pairs = readPairs(text);
  if (!pairs.some((p) => p[0] === 0 && p[1].toUpperCase() === 'SECTION')) {
    throw new Error('El archivo no parece un DXF de texto. Si es un DWG, guardalo en AutoCAD como DXF (GUARDARCOMO → DXF) y probá de nuevo.');
  }

  // Secciones
  const sections = new Map<string, [number, number]>();
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1].toUpperCase() === 'SECTION' && pairs[i + 1]?.[0] === 2) {
      const name = pairs[i + 1][1].toUpperCase();
      let end = i + 2;
      while (end < pairs.length && !(pairs[end][0] === 0 && pairs[end][1].toUpperCase() === 'ENDSEC')) end++;
      sections.set(name, [i + 2, end]);
      i = end;
    }
  }

  // Unidades del dibujo
  let units: number | null = null;
  const header = sections.get('HEADER');
  if (header) {
    for (let i = header[0]; i < header[1] - 1; i++) {
      if (pairs[i][0] === 9 && pairs[i][1].toUpperCase() === '$INSUNITS') {
        units = parseInt(pairs[i + 1][1], 10);
        break;
      }
    }
  }

  // Bloques, para expandir los INSERT (columnas y ejes suelen venir así)
  const blocks = new Map<string, { base: [number, number, number]; entities: Entity[] }>();
  const blockSec = sections.get('BLOCKS');
  if (blockSec) {
    let i = blockSec[0];
    while (i < blockSec[1]) {
      if (pairs[i][0] === 0 && pairs[i][1].toUpperCase() === 'BLOCK') {
        let bodyStart = i + 1;
        while (bodyStart < blockSec[1] && pairs[bodyStart][0] !== 0) bodyStart++;
        let end = bodyStart;
        while (end < blockSec[1] && !(pairs[end][0] === 0 && pairs[end][1].toUpperCase() === 'ENDBLK')) end++;
        const head = pairs.slice(i + 1, bodyStart);
        const name = str(head, 2);
        if (name) blocks.set(name.toUpperCase(), { base: [num(head, 10), num(head, 20), num(head, 30)], entities: readEntities(pairs, bodyStart, end) });
        i = end + 1;
      } else i++;
    }
  }

  const segments: number[] = [];
  let skipped = 0;
  let truncated = false;
  const push = (map: (x: number, y: number, z: number) => [number, number, number], a: [number, number, number], b: [number, number, number]) => {
    if (segments.length >= MAX_REFERENCE_SEGMENTS * 6) {
      truncated = true;
      return;
    }
    const p = map(...a);
    const q = map(...b);
    if (![...p, ...q].every(Number.isFinite)) return;
    segments.push(p[0], p[1], p[2], q[0], q[1], q[2]);
  };

  const emit = (entities: Entity[], map: (x: number, y: number, z: number) => [number, number, number], depth: number) => {
    for (const e of entities) {
      if (truncated) return;
      const p = e.pairs;
      if (e.type === 'LINE') {
        push(map, [num(p, 10), num(p, 20), num(p, 30)], [num(p, 11), num(p, 21), num(p, 31)]);
      } else if (e.type === 'LWPOLYLINE') {
        const z = num(p, 38);
        const pts: [number, number, number][] = [];
        let x: number | null = null;
        for (const [code, value] of p) {
          if (code === 10) x = parseFloat(value);
          else if (code === 20 && x !== null) {
            pts.push([x, parseFloat(value), z]);
            x = null;
          }
        }
        for (let i = 0; i + 1 < pts.length; i++) push(map, pts[i], pts[i + 1]);
        if (num(p, 70) & 1 && pts.length > 2) push(map, pts[pts.length - 1], pts[0]);
      } else if (e.type === 'POLYLINE') {
        const pts = (e.vertices ?? []).map((v) => [num(v, 10), num(v, 20), num(v, 30)] as [number, number, number]);
        // Las mallas (bit 16 o 64) no son un recorrido
        if (num(p, 70) & (16 | 64)) {
          skipped++;
          continue;
        }
        for (let i = 0; i + 1 < pts.length; i++) push(map, pts[i], pts[i + 1]);
        if (num(p, 70) & 1 && pts.length > 2) push(map, pts[pts.length - 1], pts[0]);
      } else if (e.type === 'CIRCLE' || e.type === 'ARC') {
        const c: [number, number, number] = [num(p, 10), num(p, 20), num(p, 30)];
        const r = num(p, 40);
        const a0 = e.type === 'ARC' ? (num(p, 50) * Math.PI) / 180 : 0;
        let a1 = e.type === 'ARC' ? (num(p, 51) * Math.PI) / 180 : Math.PI * 2;
        if (a1 <= a0) a1 += Math.PI * 2;
        const steps = Math.max(2, Math.ceil((CIRCLE_STEPS * (a1 - a0)) / (Math.PI * 2)));
        for (let i = 0; i < steps; i++) {
          const t0 = a0 + ((a1 - a0) * i) / steps;
          const t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
          push(map, [c[0] + r * Math.cos(t0), c[1] + r * Math.sin(t0), c[2]], [c[0] + r * Math.cos(t1), c[1] + r * Math.sin(t1), c[2]]);
        }
      } else if (e.type === 'INSERT') {
        const block = blocks.get(str(p, 2).toUpperCase());
        if (!block || depth >= 4) {
          skipped++;
          continue;
        }
        const rot = (num(p, 50) * Math.PI) / 180;
        const sx = num(p, 41, 1);
        const sy = num(p, 42, 1);
        const sz = num(p, 43, 1);
        // El punto base del bloque va al punto de inserción
        const inner: Xform = { sx, sy, sz, cos: Math.cos(rot), sin: Math.sin(rot), tx: num(p, 10), ty: num(p, 20), tz: num(p, 30) };
        const [bx, by, bz] = block.base;
        const local = (x: number, y: number, z: number) => apply(inner, x - bx, y - by, z - bz);
        const next = (x: number, y: number, z: number) => {
          const q = local(x, y, z);
          return map(q[0], q[1], q[2]);
        };
        emit(block.entities, next, depth + 1);
      } else if (e.type !== 'VERTEX') skipped++;
    }
  };

  const ents = sections.get('ENTITIES');
  if (ents) emit(readEntities(pairs, ents[0], ents[1]), (x, y, z) => [x, y, z], 0);

  let bounds: DxfReference['bounds'] = null;
  if (segments.length) {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < segments.length; i++) {
      const k = i % 3;
      if (segments[i] < min[k]) min[k] = segments[i];
      if (segments[i] > max[k]) max[k] = segments[i];
    }
    bounds = { min, max };
  }

  // Sin unidades declaradas: un dibujo de menos de 500 unidades de lado casi seguro está en metros
  let scale = units !== null ? UNIT_MM[units] : undefined;
  let scaleSource: DxfReference['scaleSource'] = 'dxf';
  if (!scale) {
    scaleSource = 'supuesta';
    const span = bounds ? Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]) : 0;
    scale = span > 0 && span < 500 ? 1000 : 1;
  }

  return { segments, scale, scaleSource, skipped, truncated, bounds };
}
