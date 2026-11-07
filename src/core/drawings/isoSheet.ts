import * as THREE from 'three';
import type { PipingGraph } from '../graph/PipingGraph';
import { isFaceEnd } from '../graph/PipingGraph';
import { PcfImporter } from '../importers/PcfImporter';
import { computeSpools, Spool, SpoolResult } from '../spools/spoolEngine';
import { Component, ComponentType } from '../../types/piping';
import { buildLayout } from './isoLayout';
import { Layer, PAPER, PaperSize, Prim, Pt, Sheet, fitText, textWidth } from './sheet';

/**
 * Isométricos de fabricación al estilo de Plant 3D / Isogen:
 * una hoja con la línea completa y una hoja por spool, con cotas a centro de accesorio y
 * cara de brida, globos de ítem, soldaduras numeradas, lista de materiales, cortes y rótulo.
 * La isometría se ajusta a la hoja (sin escala), como en Isogen.
 */

export interface IsoSheetOptions {
  paper?: PaperSize;
  project?: string;
  revision?: string;
  drawnBy?: string;
  date?: string;
  /** Hoja de la línea completa (por defecto sí) */
  includeLine?: boolean;
  /** Spools a dibujar; por defecto todos. [] = ninguno */
  spoolIds?: string[];
}

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
const MARGIN = 10;
const ROW = 4;
const FONT = 2.5;

/** Proyección isométrica: +X abajo-derecha, +Y arriba-derecha, +Z vertical */
function iso(v: THREE.Vector3): Pt {
  return [(v.x + v.y) * COS30, v.z + (v.y - v.x) * SIN30];
}

const ORDER: ComponentType[] = ['PIPE', 'ELBOW', 'TEE', 'CROSS', 'REDUCER', 'OLET', 'COUPLING', 'CAP', 'FLANGE', 'GASKET', 'BOLT_SET', 'VALVE', 'INSTRUMENT', 'MISC'];
const TYPE_LABEL: Record<string, string> = {
  PIPE: 'Caño', ELBOW: 'Codo', TEE: 'Tee', CROSS: 'Cruz', REDUCER: 'Reducción', OLET: 'Olet', COUPLING: 'Cupla',
  CAP: 'Tapón', FLANGE: 'Brida', GASKET: 'Junta', BOLT_SET: 'Bulones', VALVE: 'Válvula', INSTRUMENT: 'Instrumento', MISC: 'Varios'
};

const fmtNd = (nd: number) => {
  const whole = Math.floor(nd + 1e-9);
  const frac = nd - whole;
  const f = Math.abs(frac - 0.5) < 1e-3 ? '1/2' : Math.abs(frac - 0.25) < 1e-3 ? '1/4' : Math.abs(frac - 0.75) < 1e-3 ? '3/4' : '';
  if (!f) return `${Number(nd.toFixed(3))}"`;
  return whole ? `${whole}-${f}"` : `${f}"`;
};

interface BomRow {
  item: number;
  type: ComponentType;
  description: string;
  nd: string;
  qty: string;
  componentIds: string[];
}

/** Caja de texto ya ubicada, para no encimar etiquetas */
type Box = [number, number, number, number];
const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

class SheetBuilder {
  prims: Prim[] = [];
  boxes: Box[] = [];
  constructor(public width: number, public height: number) {}

  line(a: Pt, b: Pt, w: number, layer: Layer, dash = false) {
    this.prims.push({ k: 'line', a, b, w, layer, dash });
  }
  poly(pts: Pt[], closed: boolean, w: number, layer: Layer, fill = false) {
    this.prims.push({ k: 'poly', pts, closed, w, layer, fill });
  }
  circle(c: Pt, r: number, w: number, layer: Layer, fill = false) {
    this.prims.push({ k: 'circle', c, r, w, layer, fill });
  }
  text(p: Pt, s: string, size: number, layer: Layer, opts: { angle?: number; align?: 'l' | 'c' | 'r'; bold?: boolean } = {}) {
    if (!s) return;
    this.prims.push({ k: 'text', p, s, size, layer, ...opts });
  }
  rect(x: number, y: number, w: number, h: number, lw: number, layer: Layer = 'TABLE') {
    this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, lw, layer);
  }
  free(box: Box): boolean {
    return !this.boxes.some((b) => overlaps(b, box));
  }
  reserve(box: Box) {
    this.boxes.push(box);
  }
}

/** Arma todas las hojas pedidas */
export function buildIsoSheets(graph: PipingGraph, options: IsoSheetOptions = {}): Sheet[] {
  const spoolsRes = computeSpools(graph);
  const sheets: { sheet: Sheet; title: string; spool?: Spool }[] = [];
  if (options.includeLine ?? true) {
    sheets.push({ sheet: buildSheet(graph, spoolsRes, null, options), title: 'ISOMÉTRICO DE LÍNEA' });
  }
  const wanted = options.spoolIds ?? spoolsRes.spools.map((s) => s.id);
  for (const sp of spoolsRes.spools.filter((s) => wanted.includes(s.id))) {
    sheets.push({ sheet: buildSheet(graph, spoolsRes, sp, options), title: `SPOOL ${sp.id}`, spool: sp });
  }
  // Numeración de hojas en el rótulo
  sheets.forEach((s, i) => {
    for (const p of s.sheet.prims) if (p.k === 'text' && p.s === '#HOJA#') p.s = `${i + 1} / ${sheets.length}`;
  });
  return sheets.map((s) => s.sheet);
}

function buildSheet(graph: PipingGraph, res: SpoolResult, spool: Spool | null, options: IsoSheetOptions): Sheet {
  const paper = PAPER[options.paper ?? 'A3'];
  const b = new SheetBuilder(paper.width, paper.height);
  const W = paper.width;
  const H = paper.height;
  const rightW = options.paper === 'A4' ? 105 : 140;
  const area = { x0: MARGIN + 4, y0: MARGIN + 4, x1: W - MARGIN - rightW - 6, y1: H - MARGIN - 4 };

  // Marco
  b.rect(MARGIN, MARGIN, W - 2 * MARGIN, H - 2 * MARGIN, 0.5, 'FRAME');
  b.line([W - MARGIN - rightW, MARGIN], [W - MARGIN - rightW, H - MARGIN], 0.35, 'FRAME');

  const all = Array.from(graph.components.values());
  const main = spool ? spool.componentIds.map((id) => graph.components.get(id)!).filter(Boolean) : all;
  const mainIds = new Set(main.map((c) => c.id));
  // En la hoja de un spool se dibuja en gris lo que conecta (válvula, brida vecina) para ubicarse
  const context: Component[] = [];
  if (spool) {
    for (const c of main) {
      for (const p of c.ports) {
        const j = p.connectedJointId ? graph.joints.get(p.connectedJointId) : undefined;
        if (!j) continue;
        const other = graph.ports.get(j.portAId === p.id ? j.portBId : j.portAId);
        const oc = other ? graph.components.get(other.componentId) : undefined;
        if (oc && !mainIds.has(oc.id) && !context.includes(oc)) context.push(oc);
      }
    }
  }

  // Isometría sin escala (tramos comprimidos) ajustada al área de dibujo
  const layout = buildLayout(graph, [...main, ...context]);
  const proj = layout.nodes.map(iso);
  if (!proj.length) proj.push([0, 0]);
  const minX = Math.min(...proj.map((p) => p[0]));
  const maxX = Math.max(...proj.map((p) => p[0]));
  const minY = Math.min(...proj.map((p) => p[1]));
  const maxY = Math.max(...proj.map((p) => p[1]));
  const pad = 24;
  const sx = (area.x1 - area.x0 - 2 * pad) / Math.max(maxX - minX, 1);
  const sy = (area.y1 - area.y0 - 2 * pad - 14) / Math.max(maxY - minY, 1);
  const scale = Math.min(sx, sy, 1.2);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const ox = (area.x0 + area.x1) / 2;
  const oy = (area.y0 + area.y1 - 14) / 2;
  const P = (v: THREE.Vector3): Pt => {
    const [x, y] = iso(layout.map(v));
    return [ox + (x - cx) * scale, oy + (y - cy) * scale];
  };

  // Rosa de los vientos isométrica
  drawNorth(b, [area.x0 + 10, area.y1 - 14]);

  // Contexto en gris
  for (const c of context) drawComponent(b, graph, c, P, 'FADED');
  // Piezas de la hoja
  for (const c of main) drawComponent(b, graph, c, P, 'PIPE');

  // Soldaduras
  const welds = spool ? [...spool.shopWelds, ...spool.fieldWelds] : res.welds;
  for (const w of welds) {
    const p = P(w.position);
    if (w.kind === 'SHOP') {
      b.circle(p, 0.75, 0.2, 'WELD', true);
      placeLabel(b, p, w.number, 1.8, 'WELD', false);
    } else {
      b.circle(p, 1.7, 0.35, 'FIELD');
      b.line([p[0] - 1.2, p[1] - 1.2], [p[0] + 1.2, p[1] + 1.2], 0.35, 'FIELD');
      b.line([p[0] - 1.2, p[1] + 1.2], [p[0] + 1.2, p[1] - 1.2], 0.35, 'FIELD');
      placeLabel(b, p, w.number + (w.allowanceMm ? ` +${w.allowanceMm}` : ''), 2.2, 'FIELD', true);
    }
  }

  // Cotas
  drawDimensions(b, graph, main, P);

  // Extremos libres: elevación y coordenadas
  for (const c of main) {
    for (const port of c.ports) {
      if (port.connectedJointId) continue;
      const p = P(port.position);
      const v = port.position;
      const txt = `EL ${v.z >= 0 ? '+' : ''}${Math.round(v.z)}  E ${Math.round(v.x)} N ${Math.round(v.y)}`;
      placeLabel(b, p, txt, 1.9, 'TEXT', false, 9);
    }
  }

  // Lista de materiales y globos
  const bom = buildBom(graph, main, spool ? null : res);
  const itemOf = new Map<string, number>();
  bom.forEach((r) => r.componentIds.forEach((id) => itemOf.set(id, r.item)));
  const cuts = spool ? spool.cuts : res.spools.flatMap((s) => s.cuts);
  const cutOf = new Map(cuts.map((c) => [c.componentId, c]));
  for (const c of main) {
    const mid = midPoint(c);
    if (!mid) continue;
    const p = P(mid);
    if (c.type === 'PIPE') {
      const cut = cutOf.get(c.id);
      if (cut) placeLabel(b, p, cut.nippleId, 2, 'TEXT', true, 5);
      continue;
    }
    const item = itemOf.get(c.id);
    if (item !== undefined) balloon(b, p, String(item));
  }

  // Columna derecha: tablas y rótulo
  const tx = W - MARGIN - rightW;
  let y = H - MARGIN;
  const title = spool ? `SPOOL ${spool.id}` : 'ISOMÉTRICO DE LÍNEA';
  const tableW = rightW;
  y = table(b, tx, y, tableW, 'LISTA DE MATERIALES', [
    { h: 'It', w: 7, align: 'c' },
    { h: 'Cant', w: 14, align: 'r' },
    { h: 'ND', w: 14, align: 'c' },
    { h: 'Descripción', w: tableW - 35, align: 'l' }
  ], bom.map((r) => [String(r.item), r.qty, r.nd, r.description]), 24);

  if (cuts.length) {
    y = table(b, tx, y - 2, tableW, 'LISTA DE CORTES', [
      { h: 'Corte', w: 16, align: 'l' },
      ...(spool ? [] : [{ h: 'Spool', w: 22, align: 'l' as const }]),
      { h: 'ND', w: 14, align: 'c' },
      { h: 'Largo mm', w: 20, align: 'r' },
      { h: 'Extremos', w: tableW - (spool ? 50 : 72), align: 'l' }
    ], cuts.map((c) => {
      const spId = res.spoolOf.get(c.componentId)?.replace(/^.*-(SP\d+)$/, '$1') ?? '';
      return [c.nippleId, ...(spool ? [] : [spId]), fmtNd(c.nominalDiameter), `${Math.round(c.cutLengthMm)}${c.allowanceMm ? '*' : ''}`, `${c.endFinish1} / ${c.endFinish2}`];
    }), spool ? 16 : 14);
  }

  if (spool) {
    const ws = [...spool.shopWelds, ...spool.fieldWelds];
    if (ws.length) {
      y = table(b, tx, y - 2, tableW, `SOLDADURAS (${spool.weldInches} pulg-diám de taller)`, [
        { h: 'N°', w: 18, align: 'l' },
        { h: 'Tipo', w: 14, align: 'c' },
        { h: 'ND', w: 14, align: 'c' },
        { h: 'Lugar', w: tableW - 46, align: 'l' }
      ], ws.map((w) => [w.number, w.type, fmtNd(w.nominalDiameter), w.kind === 'SHOP' ? 'Taller' : w.kind === 'FW' ? 'Campo' : `Campo, sobrelargo ${w.allowanceMm} mm`]), 12);
    }
    const env = spool.envelopeMm.map((v) => Math.round(v)).join(' x ');
    b.text([tx + 2, y - 4], `Envolvente ${env} mm  ·  Caño ${(spool.pipeLengthMm / 1000).toFixed(2)} m  ·  ~${spool.pipeWeightKg} kg`, 2, 'TEXT');
    y -= 6;
  } else {
    y = table(b, tx, y - 2, tableW, 'SPOOLS', [
      { h: 'Spool', w: 40, align: 'l' },
      { h: 'Cortes', w: 16, align: 'r' },
      { h: 'Sold.', w: 16, align: 'r' },
      { h: 'Envolvente mm', w: tableW - 72, align: 'r' }
    ], res.spools.map((s) => [s.id, String(s.cuts.length), String(s.shopWelds.length), s.envelopeMm.map((v) => Math.round(v)).join('x')]), 12);
  }

  // Notas y rótulo
  const tbH = 46;
  const notesY = MARGIN + tbH + 2;
  const notes = [
    'Cotas en mm a centro de accesorio, cara de brida y extremo de válvula.',
    'Isometría ajustada a la hoja: no medir sobre el plano.',
    ...(cuts.some((c) => c.allowanceMm) ? ['* Corte con sobrelargo para soldadura de campo FFW.'] : [])
  ];
  notes.forEach((n, i) => b.text([tx + 2, notesY + (notes.length - i - 1) * 3.2 + 1], fitText(n, 1.9, tableW - 4), 1.9, 'TEXT'));
  titleBlock(b, tx, MARGIN, tableW, tbH, graph, spool, title, options);

  return { name: spool ? spool.id.replace(/^.*-(SP\d+)$/, '$1') : 'Línea', width: W, height: H, prims: b.prims };
}

/** Punto medio de una pieza para el globo */
function midPoint(c: Component): THREE.Vector3 | null {
  if (c.type === 'ELBOW' && c.ports.length >= 2) return PcfImporter.elbowVertex(c.ports[0], c.ports[1]);
  if ((c.type === 'TEE' || c.type === 'CROSS') && c.centerline[1]) return c.centerline[1];
  if (c.type === 'OLET' && c.centerline.length >= 2) return c.centerline[0].clone().lerp(c.centerline[1], 0.5);
  if (c.ports.length >= 2) return c.ports[0].position.clone().lerp(c.ports[1].position, 0.5);
  if (c.centerline.length >= 2) return c.centerline[0].clone().lerp(c.centerline[c.centerline.length - 1], 0.5);
  return c.ports[0]?.position ?? null;
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const norm = (a: Pt): Pt => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l] : [1, 0];
};
const perp = (a: Pt): Pt => [-a[1], a[0]];

/** Tamaño de símbolo en papel según el diámetro */
const symSize = (nd: number) => Math.min(4.5, Math.max(1.8, 1.4 + 0.45 * nd));

function drawComponent(b: SheetBuilder, _graph: PipingGraph, c: Component, P: (v: THREE.Vector3) => Pt, layer: 'PIPE' | 'FADED') {
  const pipeW = layer === 'FADED' ? 0.25 : 0.7;
  const symW = layer === 'FADED' ? 0.2 : 0.35;
  const symLayer: Layer = layer === 'FADED' ? 'FADED' : 'SYMBOL';
  const s = symSize(c.parameters.nominalDiameter);
  const ports = c.ports.map((p) => P(p.position));

  switch (c.type) {
    case 'PIPE':
      if (ports.length >= 2) b.line(ports[0], ports[1], pipeW, layer);
      return;
    case 'ELBOW': {
      if (c.ports.length < 2) return;
      const v = P(PcfImporter.elbowVertex(c.ports[0], c.ports[1]));
      b.poly([ports[0], v, ports[1]], false, pipeW, layer);
      return;
    }
    case 'TEE':
    case 'CROSS': {
      const ctr = c.centerline[1] ? P(c.centerline[1]) : ports[0];
      ports.forEach((p) => b.line(ctr, p, pipeW, layer));
      b.circle(ctr, 0.6, symW, symLayer, true);
      return;
    }
    case 'OLET': {
      const a = P(c.centerline[0] ?? c.ports[0].position);
      const e = ports[0];
      b.line(a, e, pipeW, layer);
      const d = norm(sub(e, a));
      const n = perp(d);
      const base = add(a, mul(d, Math.min(len(sub(e, a)) * 0.5, s)));
      b.poly([add(a, mul(n, s * 0.7)), add(base, mul(n, s * 0.35)), add(base, mul(n, -s * 0.35)), add(a, mul(n, -s * 0.7))], true, symW, symLayer);
      return;
    }
    case 'REDUCER': {
      if (ports.length < 2) return;
      const d = norm(sub(ports[1], ports[0]));
      const n = perp(d);
      const s2 = symSize(c.parameters.reducedNominalDiameter ?? c.parameters.nominalDiameter) * 0.6;
      const s1 = s * 0.6;
      const ecc = (c.parameters.lateralOffset ?? 0) > 0.01;
      const pts: Pt[] = ecc
        ? [add(ports[0], mul(n, s1)), add(ports[1], mul(n, s1)), add(ports[1], mul(n, s1 - 2 * s2)), add(ports[0], mul(n, -s1))]
        : [add(ports[0], mul(n, s1)), add(ports[1], mul(n, s2)), add(ports[1], mul(n, -s2)), add(ports[0], mul(n, -s1))];
      b.poly(pts, true, symW, symLayer);
      return;
    }
    case 'FLANGE': {
      const face = c.ports.find((p) => isFaceEnd(p)) ?? c.ports[c.ports.length - 1];
      const other = c.ports.find((p) => p !== face);
      const f = P(face.position);
      const o = other ? P(other.position) : add(f, [s, 0]);
      b.line(o, f, pipeW, layer);
      const n = perp(norm(sub(f, o)));
      const back = add(f, mul(norm(sub(o, f)), Math.min(len(sub(o, f)), s * 0.5)));
      b.line(add(f, mul(n, s * 1.3)), add(f, mul(n, -s * 1.3)), symW * 1.6, symLayer);
      b.line(add(back, mul(n, s * 0.9)), add(back, mul(n, -s * 0.9)), symW, symLayer);
      return;
    }
    case 'VALVE': {
      if (ports.length < 2) return;
      let [a, e] = ports;
      // Símbolo con largo mínimo para que se lea aunque la válvula sea chica en la escala
      const m = mul(add(a, e), 0.5);
      const d = norm(sub(e, a));
      const half = Math.max(len(sub(e, a)) / 2, s * 1.2);
      a = add(m, mul(d, -half));
      e = add(m, mul(d, half));
      const n = perp(d);
      b.poly([add(a, mul(n, s)), add(a, mul(n, -s)), m], true, symW, symLayer);
      b.poly([add(e, mul(n, s)), add(e, mul(n, -s)), m], true, symW, symLayer);
      const up = n[1] >= 0 ? n : mul(n, -1);
      const top = add(m, mul(up, s * 1.8));
      b.line(m, top, symW, symLayer);
      b.line(add(top, mul(d, -s * 0.8)), add(top, mul(d, s * 0.8)), symW, symLayer);
      if (c.ports.some((p) => isFaceEnd(p))) {
        b.line(add(a, mul(n, s * 1.25)), add(a, mul(n, -s * 1.25)), symW * 1.6, symLayer);
        b.line(add(e, mul(n, s * 1.25)), add(e, mul(n, -s * 1.25)), symW * 1.6, symLayer);
      }
      return;
    }
    case 'INSTRUMENT': {
      if (ports.length < 2) return;
      b.line(ports[0], ports[1], pipeW, layer);
      b.circle(mul(add(ports[0], ports[1]), 0.5), s * 1.1, symW, symLayer);
      return;
    }
    case 'CAP': {
      const a = ports[0];
      const e = c.centerline[1] ? P(c.centerline[1]) : add(a, [s, 0]);
      const d = norm(sub(e, a));
      const n = perp(d);
      const end = add(a, mul(d, Math.max(len(sub(e, a)), s * 0.8)));
      b.line(a, end, pipeW, layer);
      b.line(add(end, mul(n, s * 0.8)), add(end, mul(n, -s * 0.8)), symW * 2, symLayer);
      return;
    }
    case 'COUPLING': {
      if (ports.length < 2) return;
      const d = norm(sub(ports[1], ports[0]));
      const n = perp(d);
      const k = s * 0.7;
      b.poly([add(ports[0], mul(n, k)), add(ports[1], mul(n, k)), add(ports[1], mul(n, -k)), add(ports[0], mul(n, -k))], true, symW, symLayer);
      return;
    }
    default:
      if (ports.length >= 2) b.line(ports[0], ports[1], pipeW, layer);
      else if (c.centerline.length >= 2) b.line(P(c.centerline[0]), P(c.centerline[1]), pipeW, layer);
  }
}

function drawNorth(b: SheetBuilder, at: Pt) {
  const [nx, ny] = iso(new THREE.Vector3(0, 1, 0));
  const d = norm([nx, ny]);
  const tip = add(at, mul(d, 10));
  b.line(at, tip, 0.35, 'TEXT');
  const n = perp(d);
  b.poly([tip, add(add(tip, mul(d, -2.5)), mul(n, 1.2)), add(add(tip, mul(d, -2.5)), mul(n, -1.2))], true, 0.2, 'TEXT', true);
  b.text(add(tip, mul(d, 3)), 'N', 3, 'TEXT', { align: 'c', bold: true });
}

/** Ubica una etiqueta cerca de un punto sin encimarla con otras */
function placeLabel(b: SheetBuilder, p: Pt, s: string, size: number, layer: Layer, bold: boolean, dist = 3) {
  const w = textWidth(s, size, bold);
  const offsets: Pt[] = [];
  for (const k of [1, 1.8, 2.8, 4]) {
    const r = dist * k;
    offsets.push([r * 0.4, r * 0.6], [-r * 0.4 - w, r * 0.6], [r * 0.4, -r * 0.6 - size], [-r * 0.4 - w, -r * 0.6 - size], [-w / 2, r], [-w / 2, -r - size]);
  }
  for (const o of offsets) {
    const x = p[0] + o[0];
    const y = p[1] + o[1];
    const box: Box = [x - 0.4, y - 0.4, x + w + 0.4, y + size + 0.4];
    if (b.free(box)) {
      b.reserve(box);
      if (Math.hypot(o[0] + w / 2, o[1] + size / 2) > dist * 2.2) b.line(p, [x + (o[0] < 0 ? w : 0), y + size / 2], 0.13, layer);
      b.text([x, y], s, size, layer, { bold });
      return;
    }
  }
  b.text([p[0] + dist, p[1] + dist], s, size, layer, { bold });
}

/** Globo con número de ítem y su flecha a la pieza */
function balloon(b: SheetBuilder, p: Pt, label: string) {
  const r = 2.4;
  for (const k of [7, 10, 13, 17, 22]) {
    for (const ang of [60, 120, -60, -120, 20, 160, -20, -160, 90, -90]) {
      const a = (ang * Math.PI) / 180;
      const c: Pt = [p[0] + Math.cos(a) * k, p[1] + Math.sin(a) * k];
      const box: Box = [c[0] - r, c[1] - r, c[0] + r, c[1] + r];
      if (b.free(box)) {
        b.reserve(box);
        const d = norm(sub(p, c));
        b.line(add(c, mul(d, r)), p, 0.15, 'TEXT');
        b.circle(p, 0.45, 0.1, 'TEXT', true);
        b.circle(c, r, 0.25, 'TEXT');
        b.text([c[0], c[1] - 0.85], label, 2.3, 'TEXT', { align: 'c', bold: true });
        return;
      }
    }
  }
}

/** Puntos de cota de una pieza: centros de accesorios, caras de bridas, extremos de válvulas */
function dimPoints(graph: PipingGraph, c: Component): THREE.Vector3[] {
  switch (c.type) {
    case 'ELBOW':
      return c.ports.length >= 2 ? [PcfImporter.elbowVertex(c.ports[0], c.ports[1])] : [];
    case 'TEE':
    case 'CROSS':
      return c.centerline[1] ? [c.centerline[1]] : [];
    case 'OLET':
      return [c.centerline[0], c.ports[0]?.position].filter(Boolean) as THREE.Vector3[];
    case 'FLANGE':
      return c.ports.filter((p) => isFaceEnd(p) || !p.connectedJointId).map((p) => p.position);
    case 'PIPE': {
      // Extremos libres y soldaduras de campo
      return c.ports
        .filter((p) => {
          if (!p.connectedJointId) return true;
          return !!graph.joints.get(p.connectedJointId)?.fieldWeld;
        })
        .map((p) => p.position);
    }
    default:
      return c.ports.map((p) => p.position);
  }
}

/** Piezas que van en línea recta (sus dos bocas sobre el mismo eje) */
const INLINE = new Set<ComponentType>(['PIPE', 'VALVE', 'FLANGE', 'REDUCER', 'COUPLING', 'INSTRUMENT', 'CAP', 'MISC']);

function drawDimensions(b: SheetBuilder, graph: PipingGraph, comps: Component[], P: (v: THREE.Vector3) => Pt) {
  // Tramos rectos: piezas en línea conectadas y colineales
  const legs: { o: THREE.Vector3; d: THREE.Vector3; ids: Set<string> }[] = [];
  const legOf = new Map<string, number>();
  const axisOf = (c: Component) => {
    if (c.ports.length >= 2) return { o: c.ports[0].position, d: c.ports[1].position.clone().sub(c.ports[0].position) };
    if (c.centerline.length >= 2) return { o: c.centerline[0], d: c.centerline[1].clone().sub(c.centerline[0]) };
    return null;
  };
  const onLine = (o: THREE.Vector3, d: THREE.Vector3, p: THREE.Vector3) => {
    const v = p.clone().sub(o);
    return v.clone().sub(d.clone().multiplyScalar(v.dot(d))).length() < 1.0;
  };
  for (const c of comps) {
    if (!INLINE.has(c.type) || legOf.has(c.id)) continue;
    const ax = axisOf(c);
    if (!ax || ax.d.length() < 0.5) continue;
    const d = ax.d.clone().normalize();
    const leg = { o: ax.o.clone(), d, ids: new Set([c.id]) };
    const idx = legs.length;
    legs.push(leg);
    legOf.set(c.id, idx);
    const queue = [c];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const p of cur.ports) {
        const j = p.connectedJointId ? graph.joints.get(p.connectedJointId) : undefined;
        if (!j) continue;
        const op = graph.ports.get(j.portAId === p.id ? j.portBId : j.portAId);
        const oc = op ? graph.components.get(op.componentId) : undefined;
        if (!oc || legOf.has(oc.id) || !INLINE.has(oc.type) || !comps.includes(oc)) continue;
        const oax = axisOf(oc);
        if (!oax || oax.d.length() < 0.5) continue;
        if (Math.abs(Math.abs(oax.d.clone().normalize().dot(d)) - 1) > 1e-3 || !onLine(leg.o, d, oax.o)) continue;
        legOf.set(oc.id, idx);
        leg.ids.add(oc.id);
        queue.push(oc);
      }
    }
  }

  for (const leg of legs) {
    const pts: THREE.Vector3[] = [];
    const candidates = new Set<Component>();
    for (const id of leg.ids) {
      const c = graph.components.get(id)!;
      candidates.add(c);
      // Accesorios vecinos (codos, tees, olets) cuyo centro cae sobre el tramo
      for (const p of c.ports) {
        const j = p.connectedJointId ? graph.joints.get(p.connectedJointId) : undefined;
        const op = j ? graph.ports.get(j.portAId === p.id ? j.portBId : j.portAId) : undefined;
        const oc = op ? graph.components.get(op.componentId) : undefined;
        if (oc && !INLINE.has(oc.type)) candidates.add(oc);
      }
    }
    for (const c of comps) if (c.type === 'OLET') candidates.add(c);
    for (const c of candidates) for (const p of dimPoints(graph, c)) if (onLine(leg.o, leg.d, p)) pts.push(p);
    const sorted = pts
      .map((p) => ({ p, t: p.clone().sub(leg.o).dot(leg.d) }))
      .sort((a, z) => a.t - z.t);
    const uniq: { p: THREE.Vector3; t: number }[] = [];
    for (const q of sorted) if (!uniq.length || q.t - uniq[uniq.length - 1].t > 0.5) uniq.push(q);
    for (let i = 0; i + 1 < uniq.length; i++) {
      dimension(b, P(uniq[i].p), P(uniq[i + 1].p), uniq[i + 1].t - uniq[i].t);
    }
  }
}

function dimension(b: SheetBuilder, a: Pt, z: Pt, valueMm: number) {
  const dv = sub(z, a);
  if (len(dv) < 0.3) return;
  const d = norm(dv);
  let n = perp(d);
  if (n[1] < 0 || (Math.abs(n[1]) < 1e-6 && n[0] > 0)) n = mul(n, -1);
  const label = String(Math.round(valueMm));
  const size = 2.1;
  const w = textWidth(label, size);
  for (const off of [6, 10, 14, -6, -10, 18]) {
    const nn = mul(n, off);
    const a2 = add(a, nn);
    const z2 = add(z, nn);
    const mid = mul(add(a2, z2), 0.5);
    const box: Box = [mid[0] - w / 2 - 0.5, mid[1] - 1, mid[0] + w / 2 + 0.5, mid[1] + size + 1.5];
    if (!b.free(box) && off !== 18) continue;
    b.reserve(box);
    const ext = mul(n, Math.sign(off) * 1.2);
    b.line(add(a, mul(n, Math.sign(off) * 1)), add(a2, ext), 0.13, 'DIM');
    b.line(add(z, mul(n, Math.sign(off) * 1)), add(z2, ext), 0.13, 'DIM');
    b.line(a2, z2, 0.18, 'DIM');
    // Marcas oblicuas de cota
    const t: Pt = mul(norm(add(d, n)), 1.1);
    b.line(sub(a2, t), add(a2, t), 0.3, 'DIM');
    b.line(sub(z2, t), add(z2, t), 0.3, 'DIM');
    let ang = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang <= -90) ang += 180;
    const up: Pt = mul(perp(norm([Math.cos((ang * Math.PI) / 180), Math.sin((ang * Math.PI) / 180)])), 0.8);
    b.text(add(mid, up), label, size, 'DIM', { align: 'c', angle: ang });
    return;
  }
}

function buildBom(graph: PipingGraph, comps: Component[], lineRes: SpoolResult | null): BomRow[] {
  const groups = new Map<string, BomRow & { lengthMm: number; count: number }>();
  for (const c of comps) {
    const p = c.parameters;
    const desc = p.description || `${TYPE_LABEL[c.type] ?? c.type} ${fmtNd(p.nominalDiameter)}`;
    const nd = p.reducedNominalDiameter ? `${fmtNd(p.nominalDiameter)}x${fmtNd(p.reducedNominalDiameter)}` : fmtNd(p.nominalDiameter);
    const key = `${c.type}|${desc}|${nd}`;
    const g = groups.get(key) ?? { item: 0, type: c.type, description: desc, nd, qty: '', componentIds: [], lengthMm: 0, count: 0 };
    g.componentIds.push(c.id);
    g.count++;
    if (c.type === 'PIPE') g.lengthMm += c.ports.length >= 2 ? c.ports[0].position.distanceTo(c.ports[1].position) : 0;
    groups.set(key, g);
  }
  // Juntas y bulones: una por unión bridada de las piezas de la hoja
  const ids = new Set(comps.map((c) => c.id));
  for (const j of graph.joints.values()) {
    if (j.type !== 'FLANGED') continue;
    const pa = graph.ports.get(j.portAId);
    const pb = graph.ports.get(j.portBId);
    if (!pa || !pb || (!ids.has(pa.componentId) && !ids.has(pb.componentId))) continue;
    if (!lineRes && !(ids.has(pa.componentId) && ids.has(pb.componentId))) continue;
    const src = [graph.components.get(pa.componentId), graph.components.get(pb.componentId)].find((c) => c?.parameters.gasketDescription);
    const nd = fmtNd(Math.min(pa.nominalDiameter, pb.nominalDiameter));
    for (const [type, desc] of [
      ['GASKET', src?.parameters.gasketDescription || `Junta ${nd}`],
      ['BOLT_SET', src?.parameters.boltSetDescription || `Juego de bulones ${nd}`]
    ] as const) {
      const key = `${type}|${desc}|${nd}`;
      const g = groups.get(key) ?? { item: 0, type: type as ComponentType, description: desc, nd, qty: '', componentIds: [], lengthMm: 0, count: 0 };
      g.count++;
      groups.set(key, g);
    }
  }
  const rows = Array.from(groups.values()).sort((a, z) => ORDER.indexOf(a.type) - ORDER.indexOf(z.type) || a.nd.localeCompare(z.nd));
  return rows.map((r, i) => ({
    item: i + 1,
    type: r.type,
    description: r.description,
    nd: r.nd,
    qty: r.type === 'PIPE' ? `${(r.lengthMm / 1000).toFixed(2)} m` : String(r.count),
    componentIds: r.componentIds
  }));
}

interface Col {
  h: string;
  w: number;
  align: 'l' | 'c' | 'r';
}

/** Tabla con título; devuelve la coordenada y de abajo. Si hay más filas que `maxRows`, avisa. */
function table(b: SheetBuilder, x: number, yTop: number, width: number, title: string, cols: Col[], rows: string[][], maxRows: number): number {
  let y = yTop;
  b.rect(x, y - ROW - 1, width, ROW + 1, 0.3);
  b.text([x + 2, y - ROW + 0.2], title, 2.4, 'TABLE', { bold: true });
  y -= ROW + 1;
  const shown = rows.slice(0, maxRows);
  const drawRow = (cells: string[], bold: boolean) => {
    let cx = x;
    cells.forEach((cell, i) => {
      const c = cols[i];
      const txt = fitText(cell, FONT, c.w - 1.6, bold);
      const tx = c.align === 'l' ? cx + 0.8 : c.align === 'r' ? cx + c.w - 0.8 : cx + c.w / 2;
      b.text([tx, y - ROW + 1.1], txt, FONT, 'TABLE', { align: c.align, bold });
      cx += c.w;
    });
    b.line([x, y - ROW], [x + width, y - ROW], 0.12, 'TABLE');
    y -= ROW;
  };
  const top = y;
  drawRow(cols.map((c) => c.h), true);
  shown.forEach((r) => drawRow(r, false));
  if (rows.length > maxRows) {
    b.text([x + 1, y - ROW + 1.1], `+${rows.length - maxRows} filas más: ver la hoja de cada spool o el CSV`, FONT, 'TABLE');
    b.line([x, y - ROW], [x + width, y - ROW], 0.12, 'TABLE');
    y -= ROW;
  }
  // Bordes verticales
  let cx = x;
  b.line([x, top], [x, y], 0.3, 'TABLE');
  for (const c of cols) {
    cx += c.w;
    b.line([cx, top], [cx, y], c === cols[cols.length - 1] ? 0.3 : 0.12, 'TABLE');
  }
  b.line([x, y], [x + width, y], 0.3, 'TABLE');
  return y;
}

function titleBlock(b: SheetBuilder, x: number, y: number, w: number, h: number, graph: PipingGraph, spool: Spool | null, title: string, o: IsoSheetOptions) {
  b.rect(x, y, w, h, 0.5);
  const comps = Array.from(graph.components.values());
  const specs = Array.from(new Set(comps.map((c) => c.specCode).filter(Boolean))).join(', ') || graph.activeSpec;
  const nds = Array.from(new Set(comps.map((c) => c.parameters.nominalDiameter))).sort((a, z) => z - a).map(fmtNd).join(', ');
  const line = spool?.lineNumber ?? graph.activeLineNumber;
  const rowH = h / 6;
  const cell = (cx: number, cy: number, cw: number, label: string, value: string, big = false) => {
    b.rect(cx, cy, cw, rowH, 0.15);
    b.text([cx + 1, cy + rowH - 2], label, 1.6, 'FADED');
    b.text([cx + 1, cy + 1.2], fitText(value, big ? 3 : 2.3, cw - 2, big), big ? 3 : 2.3, 'TABLE', { bold: big });
  };
  const half = w / 2;
  cell(x, y + rowH * 5, w, 'PROYECTO', o.project || '—');
  cell(x, y + rowH * 4, w, 'PLANO', title, true);
  cell(x, y + rowH * 3, half, 'LÍNEA', line);
  cell(x + half, y + rowH * 3, half, 'SPEC', specs);
  cell(x, y + rowH * 2, half, 'DIÁMETROS', nds);
  cell(x + half, y + rowH * 2, half, 'ESCALA', 'Sin escala');
  cell(x, y + rowH, half, 'DIBUJÓ', o.drawnBy || 'Achero Plant 3D');
  cell(x + half, y + rowH, half, 'FECHA', o.date || new Date().toLocaleDateString('es-AR'));
  cell(x, y, half, 'REVISIÓN', o.revision || '0');
  b.rect(x + half, y, half, rowH, 0.15);
  b.text([x + half + 1, y + rowH - 2], 'HOJA', 1.6, 'FADED');
  b.text([x + half + 1, y + 1.2], '#HOJA#', 2.3, 'TABLE');
}
