import * as THREE from 'three';
import type { PipingGraph } from '../graph/PipingGraph';
import { distanceBetweenSegments } from '../../viewport/collision/collisionDetector';
import { Component, ComponentType, FieldWeldKind, Joint, JointType, NippleEndFinish } from '../../types/piping';

/**
 * Spools (piezas de taller) como los arma Plant 3D / Isogen:
 * un spool es el conjunto de piezas unidas por uniones hechas en taller (soldadura a tope,
 * socket, slip-on, roscas, pegado). Se corta en las uniones bridadas, en las soldaduras de
 * campo (FW / FFW) y en los extremos de la línea. Las válvulas, instrumentos y demás piezas
 * abulonadas no van en spools: son materiales de montaje, con sus juntas y bulones.
 */

/** Uniones que se hacen en taller y mantienen las piezas en el mismo spool */
const SHOP_JOINTS = new Set<JointType>(['BUTTWELD', 'SOCKETWELD', 'SLIPON', 'THREADED', 'GLUE', 'FUSION', 'CONTINUOUS']);
/** Uniones soldadas (las que se numeran y se cuentan en pulgadas-diámetro) */
const WELDED_JOINTS = new Set<JointType>(['BUTTWELD', 'SOCKETWELD', 'SLIPON', 'FUSION']);
/** Piezas que solo van en un spool si están soldadas (si son bridadas son de montaje) */
const LOOSE_IF_FLANGED = new Set<ComponentType>(['VALVE', 'INSTRUMENT', 'MISC']);

export type WeldKind = 'SHOP' | FieldWeldKind;

export interface SpoolWeld {
  /** W-01 (taller) o FW-01 / FFW-01 (campo) */
  number: string;
  /** Junta del grafo; los olets no tienen junta (se sueldan sobre el caño) */
  jointId?: string;
  kind: WeldKind;
  /** BW, SW, SO (filete de brida slip-on), OLET, FU (termofusión) */
  type: 'BW' | 'SW' | 'SO' | 'OLET' | 'FU';
  nominalDiameter: number;
  position: THREE.Vector3;
  componentIds: string[];
  /** Spools que une (uno si es de taller, dos si es de campo) */
  spoolIds: string[];
  allowanceMm?: number;
}

export interface SpoolCut {
  componentId: string;
  nippleId: string;
  nominalDiameter: number;
  schedule: string;
  description: string;
  /** Largo de corte incluyendo el sobrelargo de campo */
  cutLengthMm: number;
  allowanceMm: number;
  endFinish1: NippleEndFinish;
  endFinish2: NippleEndFinish;
}

export interface SpoolItem {
  type: ComponentType;
  description: string;
  nominalDiameter: number;
  reducedNominalDiameter?: number;
  skey?: string;
  quantity: number;
  componentIds: string[];
}

export interface Spool {
  id: string;
  /** Número dentro de la línea (1, 2, 3...) */
  index: number;
  lineNumber: string;
  componentIds: string[];
  cuts: SpoolCut[];
  /** Accesorios agrupados (codos, tees, bridas, reducciones...) */
  items: SpoolItem[];
  shopWelds: SpoolWeld[];
  fieldWelds: SpoolWeld[];
  /** Pulgadas-diámetro de soldadura de taller */
  weldInches: number;
  pipeLengthMm: number;
  /** Peso aproximado del caño (acero al carbono); los accesorios no se suman */
  pipeWeightKg: number;
  /** Medidas de la caja que lo envuelve, de mayor a menor (para transporte) */
  envelopeMm: [number, number, number];
  colorIndex: number;
}

export interface LooseItem {
  componentId?: string;
  type: ComponentType | 'GASKET' | 'BOLT_SET';
  description: string;
  nominalDiameter: number;
  quantity: number;
}

export interface SpoolResult {
  spools: Spool[];
  welds: SpoolWeld[];
  /** Materiales de montaje: válvulas e instrumentos bridados, juntas y bulones */
  erection: LooseItem[];
  spoolOf: Map<string, string>;
}

const STEEL_KG_PER_M = (od: number, wt: number) => 0.0246615 * (od - wt) * wt;

class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a) ?? a;
    if (p !== a) {
      p = this.find(p);
      this.parent.set(a, p);
    }
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

function otherPortOf(graph: PipingGraph, joint: Joint, componentId: string) {
  const a = graph.ports.get(joint.portAId);
  const b = graph.ports.get(joint.portBId);
  if (!a || !b) return null;
  return a.componentId === componentId ? b : a;
}

/** ¿La pieza va en un spool? Las válvulas e instrumentos solo si no tienen uniones bridadas */
export function isSpoolMember(graph: PipingGraph, comp: Component): boolean {
  if (comp.type === 'GASKET' || comp.type === 'BOLT_SET') return false;
  if (!LOOSE_IF_FLANGED.has(comp.type)) return true;
  const joints = comp.ports.map((p) => (p.connectedJointId ? graph.joints.get(p.connectedJointId) : undefined));
  if (joints.some((j) => j && !SHOP_JOINTS.has(j.type))) return false;
  if (comp.ports.some((p) => p.endType === 'FLANG')) return false;
  return joints.some((j) => j && SHOP_JOINTS.has(j.type));
}

/** Caño sobre el que va soldado un olet (su CENTRE-POINT está en el eje del caño) */
export function oletHeader(graph: PipingGraph, olet: Component): Component | null {
  const c = olet.centerline[0];
  if (!c) return null;
  let best: { comp: Component; d: number } | null = null;
  for (const comp of graph.components.values()) {
    if (comp.type !== 'PIPE' || comp.ports.length < 2) continue;
    const d = distanceBetweenSegments(c, c, comp.ports[0].position, comp.ports[1].position);
    if (d <= comp.parameters.outerDiameter / 2 + 2 && (!best || d < best.d)) best = { comp, d };
  }
  return best?.comp ?? null;
}

function weldType(joint: Joint, graph: PipingGraph): SpoolWeld['type'] {
  if (joint.type === 'SOCKETWELD') return 'SW';
  if (joint.type === 'SLIPON') return 'SO';
  if (joint.type === 'FUSION') return 'FU';
  const a = graph.ports.get(joint.portAId);
  const b = graph.ports.get(joint.portBId);
  if (a?.endType === 'SW' || b?.endType === 'SW') return 'SW';
  return 'BW';
}

/** Orden de recorrido de la línea desde su primer extremo libre (para numerar como en el iso) */
function walkOrder(graph: PipingGraph): Map<string, number> {
  const order = new Map<string, number>();
  const comps = Array.from(graph.components.values());
  const starts = [
    ...comps.filter((c) => c.ports.some((p) => !p.connectedJointId)),
    ...comps
  ];
  for (const start of starts) {
    if (order.has(start.id)) continue;
    const queue = [start];
    order.set(start.id, order.size);
    while (queue.length) {
      const comp = queue.shift()!;
      for (const port of comp.ports) {
        const j = port.connectedJointId ? graph.joints.get(port.connectedJointId) : undefined;
        const other = j ? otherPortOf(graph, j, comp.id) : null;
        const next = other ? graph.components.get(other.componentId) : undefined;
        if (next && !order.has(next.id)) {
          order.set(next.id, order.size);
          queue.push(next);
        }
      }
      // Los olets siguen al caño en el que están
      if (comp.type === 'PIPE') {
        for (const o of comps) {
          if (o.type === 'OLET' && !order.has(o.id) && oletHeader(graph, o) === comp) {
            order.set(o.id, order.size);
            queue.push(o);
          }
        }
      }
    }
  }
  return order;
}

export function lineOf(graph: PipingGraph, comp: Component): string {
  return comp.parameters.lineNumber || graph.activeLineNumber || 'LINEA';
}

/** Arma los spools, las soldaduras y los materiales de montaje del modelo */
export function computeSpools(graph: PipingGraph): SpoolResult {
  const order = walkOrder(graph);
  const byOrder = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  const members = Array.from(graph.components.values()).filter((c) => isSpoolMember(graph, c));
  const memberIds = new Set(members.map((c) => c.id));
  const uf = new UnionFind();
  members.forEach((c) => uf.find(c.id));

  // Uniones de taller entre piezas de spool (las de campo cortan)
  for (const joint of graph.joints.values()) {
    if (!SHOP_JOINTS.has(joint.type) || joint.fieldWeld) continue;
    const a = graph.ports.get(joint.portAId);
    const b = graph.ports.get(joint.portBId);
    if (a && b && memberIds.has(a.componentId) && memberIds.has(b.componentId)) uf.union(a.componentId, b.componentId);
  }
  const oletHeaders = new Map<string, Component>();
  for (const c of members) {
    if (c.type !== 'OLET') continue;
    const header = oletHeader(graph, c);
    if (header) {
      oletHeaders.set(c.id, header);
      uf.union(header.id, c.id);
    }
  }

  // Grupos ordenados por recorrido y numerados por línea
  const groups = new Map<string, string[]>();
  for (const c of members) {
    const root = uf.find(c.id);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(c.id);
  }
  const sortedGroups = Array.from(groups.values())
    .map((ids) => ids.sort(byOrder))
    .sort((a, b) => byOrder(a[0], b[0]));

  const spoolOf = new Map<string, string>();
  const perLine = new Map<string, number>();
  const spools: Spool[] = sortedGroups.map((ids, gi) => {
    const line = lineOf(graph, graph.components.get(ids[0])!);
    const n = (perLine.get(line) ?? 0) + 1;
    perLine.set(line, n);
    const id = `${line}-SP${String(n).padStart(2, '0')}`;
    ids.forEach((cid) => spoolOf.set(cid, id));
    return {
      id,
      index: n,
      lineNumber: line,
      componentIds: ids,
      cuts: [],
      items: [],
      shopWelds: [],
      fieldWelds: [],
      weldInches: 0,
      pipeLengthMm: 0,
      pipeWeightKg: 0,
      envelopeMm: [0, 0, 0],
      colorIndex: gi
    };
  });
  const spoolById = new Map(spools.map((s) => [s.id, s]));

  // Soldaduras numeradas en orden de recorrido
  const welds: SpoolWeld[] = [];
  const weldJoints = Array.from(graph.joints.values())
    .filter((j) => WELDED_JOINTS.has(j.type))
    .map((j) => {
      const a = graph.ports.get(j.portAId);
      const b = graph.ports.get(j.portBId);
      return { j, a, b, key: Math.min(order.get(a?.componentId ?? '') ?? 1e9, order.get(b?.componentId ?? '') ?? 1e9) };
    })
    .filter((w) => w.a && w.b)
    .sort((x, y) => x.key - y.key);
  const raw: Omit<SpoolWeld, 'number'>[] = [];
  for (const { j, a, b } of weldJoints) {
    const ids = [a!.componentId, b!.componentId];
    raw.push({
      jointId: j.id,
      kind: j.fieldWeld ?? 'SHOP',
      type: weldType(j, graph),
      nominalDiameter: Math.min(a!.nominalDiameter, b!.nominalDiameter),
      position: j.position.clone(),
      componentIds: ids,
      spoolIds: Array.from(new Set(ids.map((i) => spoolOf.get(i)).filter((s): s is string => !!s))),
      allowanceMm: j.fieldWeld === 'FFW' ? j.fieldAllowanceMm ?? 100 : undefined
    });
  }
  for (const [oletId, header] of oletHeaders) {
    const olet = graph.components.get(oletId)!;
    raw.push({
      kind: 'SHOP',
      type: 'OLET',
      nominalDiameter: olet.parameters.nominalDiameter,
      position: olet.centerline[0].clone(),
      componentIds: [header.id, oletId],
      spoolIds: [spoolOf.get(oletId)!].filter(Boolean)
    });
  }
  raw.sort((x, y) => Math.min(...x.componentIds.map((i) => order.get(i) ?? 1e9)) - Math.min(...y.componentIds.map((i) => order.get(i) ?? 1e9)));
  let shopN = 0;
  let fieldN = 0;
  for (const w of raw) {
    const number = w.kind === 'SHOP' ? `W-${String(++shopN).padStart(2, '0')}` : `${w.kind}-${String(++fieldN).padStart(2, '0')}`;
    const weld: SpoolWeld = { ...w, number };
    welds.push(weld);
    for (const sid of weld.spoolIds) {
      const sp = spoolById.get(sid)!;
      if (weld.kind === 'SHOP') {
        sp.shopWelds.push(weld);
        sp.weldInches += weld.nominalDiameter;
      } else {
        sp.fieldWelds.push(weld);
      }
    }
  }

  // Sobrelargo de campo: va en el caño del lado del primer spool de la soldadura FFW
  const allowance = new Map<string, number>();
  for (const w of welds) {
    if (w.kind !== 'FFW' || !w.allowanceMm) continue;
    const pipeId = w.componentIds.find((id) => graph.components.get(id)?.type === 'PIPE');
    if (pipeId) allowance.set(pipeId, (allowance.get(pipeId) ?? 0) + w.allowanceMm);
  }

  // Cortes, accesorios, largos y envolvente de cada spool
  const cutsById = new Map(graph.calculatePipeCutList().map((c) => [c.componentId, c]));
  for (const sp of spools) {
    const box = new THREE.Box3();
    const items = new Map<string, SpoolItem>();
    for (const cid of sp.componentIds) {
      const comp = graph.components.get(cid)!;
      comp.ports.forEach((p) => box.expandByPoint(p.position));
      comp.centerline.forEach((p) => box.expandByPoint(p));
      if (comp.type === 'PIPE') {
        const cut = cutsById.get(cid);
        const extra = allowance.get(cid) ?? 0;
        if (cut) {
          sp.cuts.push({
            componentId: cid,
            nippleId: cut.nippleId,
            nominalDiameter: cut.nominalDiameter,
            schedule: cut.schedule,
            description: cut.description,
            cutLengthMm: cut.cutLengthMm + extra,
            allowanceMm: extra,
            endFinish1: cut.endFinish1,
            endFinish2: cut.endFinish2
          });
          sp.pipeLengthMm += cut.cutLengthMm + extra;
          sp.pipeWeightKg += ((cut.cutLengthMm + extra) / 1000) * STEEL_KG_PER_M(comp.parameters.outerDiameter, comp.parameters.wallThickness);
        }
        continue;
      }
      const p = comp.parameters;
      const desc = p.description || `${comp.type} ${p.nominalDiameter}"`;
      const key = `${comp.type}|${desc}|${p.nominalDiameter}|${p.reducedNominalDiameter ?? ''}`;
      const it = items.get(key);
      if (it) {
        it.quantity++;
        it.componentIds.push(cid);
      } else {
        items.set(key, {
          type: comp.type,
          description: desc,
          nominalDiameter: p.nominalDiameter,
          reducedNominalDiameter: p.reducedNominalDiameter,
          skey: p.skey,
          quantity: 1,
          componentIds: [cid]
        });
      }
    }
    sp.items = Array.from(items.values());
    // La caja va por los ejes: se le suma el diámetro mayor (brida o caño) para transporte
    const maxOd = Math.max(
      0,
      ...sp.componentIds.map((cid) => {
        const p = graph.components.get(cid)!.parameters;
        return p.visual?.flangeOuterDiameter ?? p.outerDiameter ?? 0;
      })
    );
    if (!box.isEmpty()) box.expandByScalar(maxOd / 2);
    const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
    sp.envelopeMm = [size.x, size.y, size.z].sort((a, b) => b - a) as [number, number, number];
    sp.weldInches = Math.round(sp.weldInches * 100) / 100;
    sp.pipeWeightKg = Math.round(sp.pipeWeightKg * 10) / 10;
  }

  // Materiales de montaje: piezas fuera de spool + una junta y un juego de bulones por unión bridada
  const erection: LooseItem[] = [];
  const loose = new Map<string, LooseItem>();
  const addLoose = (key: string, item: LooseItem) => {
    const it = loose.get(key);
    if (it) it.quantity += item.quantity;
    else loose.set(key, { ...item });
  };
  for (const comp of graph.components.values()) {
    if (memberIds.has(comp.id) || comp.type === 'GASKET' || comp.type === 'BOLT_SET') continue;
    const desc = comp.parameters.description || `${comp.type} ${comp.parameters.nominalDiameter}"`;
    erection.push({ componentId: comp.id, type: comp.type, description: desc, nominalDiameter: comp.parameters.nominalDiameter, quantity: 1 });
  }
  for (const b of graph.calculateBillOfMaterials()) {
    if (b.type === 'GASKET' || b.type === 'BOLT_SET') addLoose(`${b.type}|${b.description}|${b.nominalDiameter}`, { type: b.type, description: b.description, nominalDiameter: b.nominalDiameter, quantity: b.quantity });
  }
  erection.push(...loose.values());

  return { spools, welds, erection, spoolOf };
}

/** Texto plano de la hoja de un spool (para compartir por WhatsApp o copiar) */
export function spoolSheetText(sp: Spool): string {
  const fmt = (nd: number) => `${nd}"`;
  const lines = [
    `SPOOL ${sp.id}  (linea ${sp.lineNumber})`,
    `Envolvente: ${sp.envelopeMm.map((v) => Math.round(v)).join(' x ')} mm  |  Cano: ${(sp.pipeLengthMm / 1000).toFixed(2)} m, ~${sp.pipeWeightKg} kg`,
    `Soldaduras de taller: ${sp.shopWelds.length} (${sp.weldInches} pulg-diam)  |  De campo: ${sp.fieldWelds.map((w) => w.number).join(', ') || 'ninguna'}`,
    '-- CORTES --',
    ...sp.cuts.map(
      (c) =>
        `${c.nippleId}  ${fmt(c.nominalDiameter)}  ${Math.round(c.cutLengthMm)} mm${c.allowanceMm ? ` (incl. ${c.allowanceMm} sobrelargo)` : ''}  ${c.endFinish1}/${c.endFinish2}`
    ),
    '-- ACCESORIOS --',
    ...sp.items.map(
      (i) => `${i.quantity} x ${i.description} ${fmt(i.nominalDiameter)}${i.reducedNominalDiameter ? `x${fmt(i.reducedNominalDiameter)}` : ''}`
    ),
    '-- SOLDADURAS --',
    ...sp.shopWelds.map((w) => `${w.number} ${w.type} ${fmt(w.nominalDiameter)}`)
  ];
  return lines.join('\n');
}
