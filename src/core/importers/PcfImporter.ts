import * as THREE from 'three';
import { PipingGraph, isFaceEnd } from '../graph/PipingGraph';
import { SpecDatabaseReader } from '../specs/SpecDatabaseReader';
import { ConnectionRule } from '../specs/connectionRules';
import { plantEndToAppEnd, wallThicknessFromSchedule } from '../specs/units';
import { calculateElbowPlacement } from '../math/elbowSolver';
import {
  Component,
  ComponentType,
  NippleEndFinish,
  PcfSourceLine,
  Port
} from '../../types/piping';
import {
  PcfBlock,
  PcfDocument,
  boreToInch,
  componentTypeForBlock,
  directionVector,
  endsFromSkey,
  parsePcf
} from '../pcf/pcfFormat';

/** Diámetro exterior ASME B36.10 por diámetro nominal (pulgadas → mm) */
const OD_TABLE: Record<number, number> = {
  0.125: 10.3, 0.25: 13.7, 0.375: 17.1, 0.5: 21.3, 0.75: 26.7, 1: 33.4, 1.25: 42.2, 1.5: 48.3,
  2: 60.3, 2.5: 73.0, 3: 88.9, 3.5: 101.6, 4: 114.3, 5: 141.3, 6: 168.3, 8: 219.1, 10: 273.1,
  12: 323.9, 14: 355.6, 16: 406.4, 18: 457.2, 20: 508.0, 24: 609.6
};

export function estimateOuterDiameter(ndInches: number): number {
  return OD_TABLE[ndInches] ?? ndInches * 25.4;
}

/** Extremo del END-POINT (BW, SW, FL, SC, PL) traducido a extremo de Plant */
const PCF_END_TO_PLANT: Record<string, string> = {
  BW: 'BV', BV: 'BV', SW: 'SW', FL: 'FL', FLG: 'FL', SC: 'THDF', THD: 'THDF', PL: 'PL', WF: 'WF'
};

/** Distancia máxima para unir dos puertos (mm); entre caras de brida se admite la junta */
const JOIN_TOL = 1.0;
const FACE_GAP_TOL = 7.0;

interface GeoPoint {
  key: string;
  lineIndex: number;
  pos: THREE.Vector3;
  bore?: number;
  endToken?: string;
}

interface ParsedBlock {
  block: PcfBlock;
  type: ComponentType;
  ends: GeoPoint[];
  branches: GeoPoint[];
  centre?: GeoPoint;
  attr: (key: string) => string | undefined;
}

export interface PcfImportOptions {
  connectionRules?: ConnectionRule[];
  sourceName?: string;
}

export interface PcfImportResult {
  graph: PipingGraph;
  componentCount: number;
  pipeCount: number;
  lineReference: string;
  /** Bloques que no son piezas (WELD, GASKET, SUPPORT...) y no se importaron */
  skipped: Record<string, number>;
  warnings: string[];
}

function readPoint(line: PcfBlock['lines'][number], lineIndex: number, units: 'INCH' | 'MM'): GeoPoint | null {
  const [x, y, z] = [1, 2, 3].map((i) => parseFloat(line.tokens[i]));
  if (![x, y, z].every(Number.isFinite)) return null;
  const rawBore = line.tokens[4] !== undefined ? parseFloat(line.tokens[4]) : NaN;
  return {
    key: line.key,
    lineIndex,
    pos: new THREE.Vector3(x, y, z),
    bore: Number.isFinite(rawBore) && rawBore > 0 ? boreToInch(rawBore, units) : undefined,
    endToken: line.tokens[5]?.toUpperCase()
  };
}

function parseBlock(block: PcfBlock, units: 'INCH' | 'MM'): ParsedBlock | null {
  const ends: GeoPoint[] = [];
  const branches: GeoPoint[] = [];
  let centre: GeoPoint | undefined;
  block.lines.forEach((l, i) => {
    if (l.key === 'END-POINT') {
      const p = readPoint(l, i, units);
      if (p) ends.push(p);
    } else if (l.key === 'BRANCH1-POINT' || l.key === 'BRANCH2-POINT' || l.key === 'BRANCH3-POINT') {
      const p = readPoint(l, i, units);
      if (p) branches.push(p);
    } else if ((l.key === 'CENTRE-POINT' || l.key === 'CO-ORDS') && !centre) {
      const p = readPoint(l, i, units);
      if (p) centre = p;
    }
  });
  const type = componentTypeForBlock(block.type, ends.length + branches.length > 0);
  if (!type) return null;
  const attr = (key: string) => block.lines.find((l) => l.key === key)?.value;
  return { block, type, ends, branches, centre, attr };
}

function safeDir(v: THREE.Vector3, fallback?: THREE.Vector3): THREE.Vector3 {
  if (v.lengthSq() > 1e-10) return v.clone().normalize();
  return fallback ? fallback.clone().normalize() : new THREE.Vector3(1, 0, 0);
}

/**
 * Importador de PCF (AutoCAD Plant 3D / Isogen) sin pérdidas.
 *
 * Cada pieza guarda su bloque original (`parameters.pcf`): al reexportar, lo que no se tocó
 * sale igual que vino y lo que se movió reescribe solo sus coordenadas. Lee todos los bloques
 * de piezas (también OLET, INSTRUMENT, COUPLING, CROSS); WELD, GASKET, BOLT y SUPPORT no son
 * piezas en Plant y se cuentan como omitidos.
 */
export class PcfImporter {
  public static importFromPcf(
    pcfContent: string,
    specReader?: SpecDatabaseReader | null,
    activeSpec: string = 'CS150',
    options: PcfImportOptions = {}
  ): PcfImportResult {
    const doc = parsePcf(pcfContent);
    const warnings: string[] = [];
    const skipped: Record<string, number> = {};

    const parsed: ParsedBlock[] = [];
    // Soldaduras de campo del PCF (SKEY WF / FW / FFW): se marcan en la junta al conectar
    const fieldWelds: { pos: THREE.Vector3; kind: 'FW' | 'FFW'; allowance?: number }[] = [];
    for (const block of doc.blocks) {
      const pb = parseBlock(block, doc.boreUnits);
      if (pb) {
        parsed.push(pb);
        continue;
      }
      skipped[block.type] = (skipped[block.type] ?? 0) + 1;
      if (block.type === 'WELD') {
        const skey = block.lines.find((l) => l.key === 'SKEY')?.tokens[1]?.toUpperCase() ?? '';
        const ep = block.lines.find((l) => l.key === 'END-POINT');
        const p = ep ? readPoint(ep, 0, doc.boreUnits) : null;
        const allowance = parseFloat(block.lines.find((l) => l.key === 'FIELD-FIT-ALLOWANCE')?.tokens[1] ?? '');
        const ffw = skey === 'FFW' || Number.isFinite(allowance);
        if (p && (skey === 'WF' || skey === 'FW' || skey === 'FFW')) {
          fieldWelds.push({ pos: p.pos, kind: ffw ? 'FFW' : 'FW', allowance: Number.isFinite(allowance) ? allowance : undefined });
        }
      }
    }

    const headerSpec = doc.headerSpec || activeSpec;
    const lineRef = doc.pipelineReference || `100-${headerSpec}`;
    const firstNd = parsed.find((p) => p.ends[0]?.bore)?.ends[0].bore ?? 2;
    const graph = new PipingGraph(headerSpec, firstNd, 'SCH 40');
    graph.activeLineNumber = lineRef;
    if (options.connectionRules) graph.connectionRules = options.connectionRules;
    graph.pcfInfo = {
      header: doc.header,
      boreUnits: doc.boreUnits,
      sourceName: options.sourceName,
      skipped: Object.keys(skipped).length ? skipped : undefined
    };
    if (doc.coordUnits !== 'MM') warnings.push('El PCF usa coordenadas en pulgadas: la app trabaja en mm.');

    // Todos los puntos de conexión, para saber qué toca qué (cara de brida, boca del tapón)
    const allPoints: { owner: number; type: ComponentType; p: THREE.Vector3 }[] = [];
    parsed.forEach((pb, i) => {
      for (const g of [...pb.ends, ...pb.branches]) allPoints.push({ owner: i, type: pb.type, p: g.pos });
    });
    const touches = (owner: number, p: THREE.Vector3, filter?: (t: ComponentType) => boolean) =>
      allPoints.some((o) => o.owner !== owner && (!filter || filter(o.type)) && o.p.distanceTo(p) <= JOIN_TOL);

    let pipeCount = 0;
    parsed.forEach((pb, idx) => {
      const comp = PcfImporter.buildComponent(pb, idx, doc, headerSpec, lineRef, specReader, touches, warnings);
      if (!comp) return;
      graph.addComponent(comp);
      if (comp.type === 'PIPE') pipeCount++;
    });

    PcfImporter.connectCoincidentPorts(graph);
    for (const fw of fieldWelds) {
      const joint = Array.from(graph.joints.values()).find((j) => j.type !== 'FLANGED' && j.position.distanceTo(fw.pos) <= JOIN_TOL);
      if (joint) graph.setFieldWeld(joint.id, fw.kind, fw.allowance);
    }

    return {
      graph,
      componentCount: graph.components.size,
      pipeCount,
      lineReference: lineRef,
      skipped,
      warnings
    };
  }

  private static buildComponent(
    pb: ParsedBlock,
    idx: number,
    doc: PcfDocument,
    headerSpec: string,
    lineRef: string,
    specReader: SpecDatabaseReader | null | undefined,
    touches: (owner: number, p: THREE.Vector3, filter?: (t: ComponentType) => boolean) => boolean,
    warnings: string[]
  ): Component | null {
    const { type, ends, branches, centre, attr } = pb;
    const id = `${type.toLowerCase()}_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
    const specCode = attr('PIPING-SPEC')?.split(/\s+/)[0] || headerSpec;
    const skey = attr('SKEY')?.split(/\s+/)[0];
    const itemCode = attr('ITEM-CODE');
    const description =
      attr('ITEM-DESCRIPTION') || attr('DESCRIPTION') || (itemCode ? doc.materials.get(itemCode) : undefined);

    // Puntos que son puertos: END-POINT (en tapones solo la boca) y luego los BRANCH
    let portPoints: GeoPoint[] = [...ends, ...branches];
    let closedEnd: GeoPoint | undefined;
    if (type === 'CAP' && ends.length === 2) {
      const open0 = touches(idx, ends[0].pos);
      const open1 = touches(idx, ends[1].pos);
      const mouth = !open0 && open1 ? 1 : 0;
      portPoints = [ends[mouth]];
      closedEnd = ends[1 - mouth];
    }
    if (portPoints.length === 0) {
      warnings.push(`${pb.block.type} sin puntos de conexión: no se importó.`);
      return null;
    }

    const bores = portPoints.map((g) => g.bore);
    const mainNd = bores.find((b) => b !== undefined) ?? 2;
    const ndOf = (g: GeoPoint) => g.bore ?? mainNd;
    const pipeSpec = specReader?.findPipe(mainNd) ?? null;
    const odOf = (nd: number) =>
      pipeSpec && Math.abs(pipeSpec.nominalDiameter - nd) < 1e-6 ? pipeSpec.outerDiameter : specReader?.findPipe(nd)?.outerDiameter ?? estimateOuterDiameter(nd);
    const schedule = pipeSpec?.schedule || 'SCH 40';
    const wt = pipeSpec?.wallThickness ?? wallThicknessFromSchedule(mainNd, '40') ?? 3.91;

    // Eje de la pieza: en excéntricas se quita el corrimiento de FLAT-DIRECTION
    const flat = attr('FLAT-DIRECTION') ? directionVector(attr('FLAT-DIRECTION')!) : null;
    let axis = ends.length >= 2 ? ends[1].pos.clone().sub(ends[0].pos) : new THREE.Vector3();
    let lateralOffset: number | undefined;
    if (flat && ends.length >= 2) {
      const f = new THREE.Vector3(...flat);
      lateralOffset = Math.abs(axis.dot(f));
      axis = axis.clone().addScaledVector(f, -axis.dot(f));
    }

    // Dirección hacia afuera de cada puerto
    const dirOf = (g: GeoPoint, k: number): THREE.Vector3 => {
      if (type === 'CAP' && closedEnd) return safeDir(g.pos.clone().sub(closedEnd.pos));
      if (centre && (type === 'ELBOW' || type === 'TEE' || type === 'CROSS' || type === 'OLET' || branches.includes(g))) {
        const d = g.pos.clone().sub(centre.pos);
        if (d.lengthSq() > 1e-10) return d.normalize();
      }
      if (ends.length >= 2 && ends.includes(g)) {
        const sign = g === ends[0] ? -1 : 1;
        return safeDir(axis.clone().multiplyScalar(sign), new THREE.Vector3(sign, 0, 0));
      }
      return safeDir(new THREE.Vector3(), new THREE.Vector3(k === 0 ? -1 : 1, 0, 0));
    };

    // Extremos de Plant: el token del END-POINT manda; si no, lo indica el SKEY
    const skeyEnds = endsFromSkey(skey, type);
    let faceIndex = -1;
    if (type === 'FLANGE') {
      if (portPoints.length >= 2) {
        const isPipe = (t: ComponentType) => t === 'PIPE';
        const hub0 = touches(idx, portPoints[0].pos, isPipe);
        const hub1 = touches(idx, portPoints[1].pos, isPipe);
        faceIndex = hub0 && !hub1 ? 1 : 0;
      } else {
        faceIndex = 0;
      }
    }
    const plantEndOf = (g: GeoPoint, k: number): string | undefined => {
      if (g.endToken && PCF_END_TO_PLANT[g.endToken]) {
        const e = PCF_END_TO_PLANT[g.endToken];
        // En bridas el END-POINT "BW" del lado caño de una SO sigue siendo SO
        if (type === 'FLANGE' && k !== faceIndex && skeyEnds.body === 'SO') return 'SO';
        return e;
      }
      if (type === 'FLANGE') return k === faceIndex ? skeyEnds.face : skeyEnds.body;
      if (type === 'PIPE') return pipeSpec?.plantEndTypes?.[0];
      return skeyEnds.body;
    };

    const ports: Port[] = portPoints.map((g, k) => {
      const nd = ndOf(g);
      const plantEnd = plantEndOf(g, k);
      return {
        id: `${id}_p${k + 1}`,
        componentId: id,
        index: k,
        position: g.pos.clone(),
        direction: dirOf(g, k),
        nominalDiameter: nd,
        outerDiameter: odOf(nd),
        wallThickness: wt,
        schedule,
        endType: plantEnd ? plantEndToAppEnd(plantEnd) : 'BW',
        plantEndType: plantEnd
      };
    });

    // Centerline y referencias de cada línea de geometría para reexportar
    const refs = new Map<number, string>();
    portPoints.forEach((g, k) => refs.set(g.lineIndex, `P${k}`));
    let centerline: THREE.Vector3[];
    const params: Component['parameters'] = {
      nominalDiameter: ports[0].nominalDiameter,
      outerDiameter: ports[0].outerDiameter,
      wallThickness: wt,
      schedule,
      description,
      lineNumber: lineRef,
      itemCode,
      skey
    };

    if (type === 'PIPE') {
      centerline = [ports[0].position.clone(), (ports[1] ?? ports[0]).position.clone()];
      const len = centerline[0].distanceTo(centerline[1]);
      params.grossLength = len;
      params.cutLength = len;
      PcfImporter.readPipeExtras(pb, params);
    } else if (type === 'ELBOW' && ports.length >= 2) {
      const c = centre?.pos ?? PcfImporter.elbowVertex(ports[0], ports[1]);
      if (centre) refs.set(centre.lineIndex, 'C');
      const rawAngle = attr('ANGLE') ? parseFloat(attr('ANGLE')!) : NaN;
      const geomAngle = 180 - THREE.MathUtils.radToDeg(ports[0].direction.angleTo(ports[1].direction));
      const angle = Number.isFinite(rawAngle) ? (rawAngle > 360 ? rawAngle / 100 : rawAngle) : geomAngle;
      const takeOff = ports[0].position.distanceTo(c);
      params.angle = Math.round(angle * 100) / 100;
      params.takeOff = takeOff;
      params.radius = angle > 0.5 && angle < 179.5 ? takeOff / Math.tan(THREE.MathUtils.degToRad(angle) / 2) : takeOff;
      centerline = [ports[0].position.clone(), c.clone(), ports[1].position.clone()];
      try {
        const pStart = c.clone().addScaledVector(ports[0].direction, takeOff * 2);
        const pNext = c.clone().addScaledVector(ports[1].direction, takeOff * 2);
        const placement = calculateElbowPlacement(pStart, c, pNext, takeOff, params.radius);
        params.matrixElements = Array.from(placement.matrix.elements);
      } catch {
        warnings.push(`Codo en ${ports[0].position.toArray().map((v) => v.toFixed(0)).join(',')} sin geometría de giro válida.`);
      }
    } else if ((type === 'TEE' || type === 'CROSS') && ports.length >= 3) {
      const c = centre?.pos ?? ports[0].position.clone().lerp(ports[1].position, 0.5);
      if (centre) refs.set(centre.lineIndex, 'L1');
      centerline = [ports[0].position.clone(), c.clone(), ...ports.slice(1).map((p) => p.position.clone())];
      params.runTakeOff = ports[0].position.distanceTo(c);
      params.branchTakeOff = ports[2].position.distanceTo(c);
      if (ports[2].nominalDiameter !== ports[0].nominalDiameter) {
        params.reducedNominalDiameter = ports[2].nominalDiameter;
        params.reducedOuterDiameter = ports[2].outerDiameter;
      }
    } else if (type === 'OLET') {
      const c = centre?.pos ?? ports[0].position.clone().addScaledVector(ports[0].direction, -30);
      if (centre) refs.set(centre.lineIndex, 'L0');
      centerline = [c.clone(), ports[0].position.clone()];
      params.takeOff = c.distanceTo(ports[0].position);
    } else if (type === 'CAP') {
      const end = closedEnd?.pos ?? ports[0].position.clone().addScaledVector(ports[0].direction, -ports[0].outerDiameter * 0.6);
      if (closedEnd) refs.set(closedEnd.lineIndex, 'L1');
      centerline = [ports[0].position.clone(), end.clone()];
      params.faceToFace = ports[0].position.distanceTo(end);
    } else {
      centerline = ports.map((p) => p.position.clone());
      if (ports.length >= 2) params.faceToFace = ports[0].position.distanceTo(ports[1].position);
      if (centre) {
        refs.set(centre.lineIndex, `L${centerline.length}`);
        centerline.push(centre.pos.clone());
      }
      if (type === 'REDUCER' && ports.length >= 2 && ports[1].nominalDiameter !== ports[0].nominalDiameter) {
        params.reducedNominalDiameter = ports[1].nominalDiameter;
        params.reducedOuterDiameter = ports[1].outerDiameter;
      }
      if (type === 'REDUCER' && lateralOffset !== undefined) params.lateralOffset = lateralOffset;
    }

    const lines: PcfSourceLine[] = pb.block.lines.map((l, i) => {
      const ref = refs.get(i);
      if (!ref) return { raw: l.raw, key: l.key };
      return {
        raw: l.raw,
        key: l.key,
        ref,
        xyz: [parseFloat(l.tokens[1]), parseFloat(l.tokens[2]), parseFloat(l.tokens[3])],
        tail: l.tokens.slice(4).join(' ')
      };
    });
    params.pcf = { type: pb.block.type, lines };

    return {
      id,
      type,
      specCode,
      catalogId: itemCode || skey || type,
      ports,
      centerline,
      parameters: params
    };
  }

  /** Datos de taller propios de la app (TAG, END-PREPARATION) si el PCF los trae */
  private static readPipeExtras(pb: ParsedBlock, params: Component['parameters']): void {
    const tag = pb.attr('TAG');
    if (tag) params.nippleTag = tag;
    const prep = pb.attr('END-PREPARATION');
    if (prep && prep.includes('/')) {
      const parse = (v: string): NippleEndFinish | undefined => {
        const t = v.trim();
        if (t === 'Bisel' || t === 'BE') return 'Bisel';
        if (t === 'Plano' || t === 'PE') return 'Plano';
        if (t === 'Roscado' || t === 'TE') return 'Roscado';
        return undefined;
      };
      const [a, b] = prep.split('/');
      const e1 = parse(a);
      const e2 = parse(b);
      if (e1) params.endFinish1 = e1;
      if (e2) params.endFinish2 = e2;
    }
  }

  /** Vértice de un codo: punto más cercano entre las rectas de sus dos bocas */
  public static elbowVertex(a: Port, b: Port): THREE.Vector3 {
    const d1 = a.direction.clone().negate();
    const d2 = b.direction.clone().negate();
    const w = a.position.clone().sub(b.position);
    const A = d1.dot(d1);
    const B = d1.dot(d2);
    const C = d2.dot(d2);
    const D = d1.dot(w);
    const E = d2.dot(w);
    const den = A * C - B * B;
    if (Math.abs(den) < 1e-9) return a.position.clone().lerp(b.position, 0.5);
    const s = (B * E - C * D) / den;
    const t = (A * E - B * D) / den;
    const p1 = a.position.clone().addScaledVector(d1, s);
    const p2 = b.position.clone().addScaledVector(d2, t);
    return p1.lerp(p2, 0.5);
  }

  /** Une los puertos que coinciden en posición y están enfrentados, con la regla de Plant */
  private static connectCoincidentPorts(graph: PipingGraph): void {
    const ports = Array.from(graph.ports.values());
    for (let i = 0; i < ports.length; i++) {
      const a = ports[i];
      if (a.connectedJointId) continue;
      let best: { p: Port; d: number } | null = null;
      for (let j = 0; j < ports.length; j++) {
        const b = ports[j];
        if (i === j || b.connectedJointId || b.componentId === a.componentId) continue;
        if (a.direction.dot(b.direction) > -0.95) continue;
        const d = a.position.distanceTo(b.position);
        const tol = isFaceEnd(a) && isFaceEnd(b) ? FACE_GAP_TOL : JOIN_TOL;
        if (d <= tol && (!best || d < best.d)) best = { p: b, d };
      }
      if (!best) continue;
      const b = best.p;
      // Caño sin dato de spec: el extremo lo define la pieza a la que entra
      for (const [pipePort, other] of [[a, b], [b, a]] as const) {
        if (pipePort.plantEndType || graph.components.get(pipePort.componentId)?.type !== 'PIPE') continue;
        const o = (other.plantEndType || '').toUpperCase();
        pipePort.plantEndType = o === 'SW' || o === 'SO' ? 'PL' : o === 'PSW' ? 'PPL' : o.startsWith('THD') ? 'THDM' : other.plantEndType ? 'BV' : undefined;
        if (pipePort.plantEndType) pipePort.endType = plantEndToAppEnd(pipePort.plantEndType);
      }
      try {
        graph.connectPorts(a.id, b.id, undefined, { gapMm: best.d });
      } catch {
        // Puertos que no se pueden unir: quedan abiertos y se ven en el modelo
      }
    }
  }
}
