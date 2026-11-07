import * as THREE from 'three';
import { PipingGraph } from '../graph/PipingGraph';
import { PcfImporter } from '../importers/PcfImporter';
import { Component, Joint, PcfSourceLine } from '../../types/piping';
import { plantEndToPcf } from '../specs/units';
import { computeSpools } from '../spools/spoolEngine';
import {
  PCF_EOL,
  blockTypeForComponent,
  defaultSkey,
  directionName,
  formatBore,
  formatCoord
} from '../pcf/pcfFormat';

export interface PcfExportOptions {
  pipelineReference?: string;
  projectIdentifier?: string;
  /** Unidad de diámetros; si el modelo vino de un PCF se usa la de ese archivo */
  boreUnits?: 'INCH' | 'MM';
  weightUnits?: 'KGS' | 'LBS';
  /**
   * 'plant' (por defecto): para PCF to Pipe de Plant 3D 2027, con el formato que Plant aceptó
   * (CRLF, PIPING-SPEC por pieza, sin WELD/GASKET/BOLT ni datos propios de la app).
   * 'isogen': agrega soldaduras, juntas, bulones, MATERIALS y los datos de taller de la app.
   */
  target?: 'plant' | 'isogen';
  /** Solo isogen: bloques WELD / GASKET / BOLT */
  includeWeldsAndFasteners?: boolean;
  /** Solo isogen: sección MATERIALS */
  includeMaterialsTable?: boolean;
}

/** Diferencia máxima (mm) para considerar que un punto no se movió y escribir la línea original */
const SAME_POINT = 1e-4;

const IND = '    ';

function point(v: THREE.Vector3): string {
  return `${formatCoord(v.x)} ${formatCoord(v.y)} ${formatCoord(v.z)}`;
}

/**
 * Exportador de PCF.
 *
 * Las piezas importadas de un PCF se escriben con su bloque original: si no se movieron, línea
 * por línea igual; si se movieron, cambian solo las coordenadas. Las piezas creadas en la app
 * se escriben con los datos de su pieza de spec (SKEY, descripción, spec).
 */
export class PcfExporter {
  public static exportToPcf(graph: PipingGraph, options: PcfExportOptions = {}): string {
    const target = options.target ?? 'plant';
    const isogen = target === 'isogen';
    const boreUnits = graph.pcfInfo?.boreUnits ?? options.boreUnits ?? 'INCH';
    const pipelineRef = options.pipelineReference || graph.activeLineNumber || 'LINE-101';
    const lines: string[] = [];
    const materials = new Map<string, string>();

    lines.push(...PcfExporter.header(graph, pipelineRef, boreUnits, options));

    // Isogen: cada pieza de taller lleva su spool; las de montaje, ERECTION-ITEM
    const spoolOf = isogen ? computeSpools(graph).spoolOf : null;

    let pipeSeq = 1;
    for (const comp of graph.components.values()) {
      if (comp.type === 'GASKET' || comp.type === 'BOLT_SET') continue;
      const block = comp.parameters.pcf
        ? PcfExporter.sourceBlock(comp, boreUnits)
        : PcfExporter.newBlock(comp, boreUnits, isogen);
      if (!block.length) continue;
      if (isogen && comp.type === 'PIPE') block.push(...PcfExporter.shopData(comp, pipeSeq++, block));
      if (spoolOf) {
        const has = (k: string) => block.some((l) => l.trim().split(/\s+/)[0] === k);
        const sp = spoolOf.get(comp.id);
        if (sp && !has('SPOOL-IDENTIFIER')) block.push(`${IND}SPOOL-IDENTIFIER ${sp}`);
        const tag = sp ? 'FABRICATION-ITEM' : 'ERECTION-ITEM';
        if (!has('FABRICATION-ITEM') && !has('ERECTION-ITEM')) block.push(`${IND}${tag}`);
      }
      lines.push(...block);
      const code = comp.parameters.itemCode || comp.catalogId;
      if (isogen && code && comp.parameters.description) materials.set(code, comp.parameters.description);
    }

    if (isogen && (options.includeWeldsAndFasteners ?? true)) {
      let n = 1;
      for (const joint of graph.joints.values()) lines.push(...PcfExporter.jointBlocks(joint, graph, boreUnits, n++, materials));
    }

    if (isogen && (options.includeMaterialsTable ?? true) && materials.size) {
      lines.push('MATERIALS');
      for (const [code, desc] of materials) {
        lines.push(`ITEM-CODE ${code}`);
        lines.push(`${IND}DESCRIPTION ${desc}`);
      }
    }

    // Plant 3D lee el PCF en ASCII: se reemplazan caracteres fuera de rango
    return lines.map((l) => PcfExporter.ascii(l)).join(PCF_EOL) + PCF_EOL;
  }

  private static header(
    graph: PipingGraph,
    pipelineRef: string,
    boreUnits: 'INCH' | 'MM',
    options: PcfExportOptions
  ): string[] {
    const src = graph.pcfInfo?.header;
    if (src && src.length) {
      return src.map((raw) => {
        const key = raw.trim().split(/\s+/)[0].toUpperCase();
        if (key === 'PIPELINE-REFERENCE') return `PIPELINE-REFERENCE ${pipelineRef}`;
        if (key === 'PROJECT-IDENTIFIER' && options.projectIdentifier) return `${IND}PROJECT-IDENTIFIER ${options.projectIdentifier}`;
        return raw;
      });
    }
    return [
      'ISOGEN-FILES ISOGEN.FLS',
      `UNITS-BORE ${boreUnits}`,
      'UNITS-CO-ORDS MM',
      `UNITS-WEIGHT ${options.weightUnits ?? 'KGS'}`,
      'UNITS-BOLT-DIA MM',
      'UNITS-BOLT-LENGTH MM',
      `PIPELINE-REFERENCE ${pipelineRef}`,
      `${IND}PROJECT-IDENTIFIER ${options.projectIdentifier || 'ACHERO_PLANT_3D'}`,
      `${IND}PIPING-SPEC ${graph.activeSpec}`
    ];
  }

  /** Punto actual de una línea de geometría del bloque original */
  private static resolveRef(comp: Component, ref: string): THREE.Vector3 | null {
    if (ref === 'C') {
      if (comp.ports.length < 2) return null;
      return PcfImporter.elbowVertex(comp.ports[0], comp.ports[1]);
    }
    const n = parseInt(ref.slice(1), 10);
    if (ref[0] === 'P') return comp.ports[n]?.position ?? null;
    if (ref[0] === 'L') return comp.centerline[n] ?? null;
    return null;
  }

  /** Bloque de una pieza importada: líneas originales; se reescribe lo que cambió en la app */
  private static sourceBlock(comp: Component, boreUnits: 'INCH' | 'MM'): string[] {
    const src = comp.parameters.pcf!;
    const out = [src.type];
    const managed: Record<string, string | undefined> = {
      'PIPING-SPEC': comp.specCode,
      SKEY: comp.parameters.skey,
      'ITEM-DESCRIPTION': comp.parameters.description,
      'ITEM-CODE': comp.parameters.itemCode
    };
    const seen = new Set<string>();
    for (const line of src.lines) {
      seen.add(line.key);
      out.push(PcfExporter.sourceLine(comp, line, managed, boreUnits));
    }
    // Spec cambiada en la app en una pieza que no traía PIPING-SPEC: Plant la necesita en cada pieza
    if (!seen.has('PIPING-SPEC') && comp.specCode) out.push(`${IND}PIPING-SPEC ${comp.specCode}`);
    return out;
  }

  private static sourceLine(
    comp: Component,
    line: PcfSourceLine,
    managed: Record<string, string | undefined>,
    _boreUnits: 'INCH' | 'MM'
  ): string {
    const indent = line.raw.match(/^\s*/)?.[0] || IND;
    if (line.ref && line.xyz) {
      const now = PcfExporter.resolveRef(comp, line.ref);
      if (!now) return line.raw;
      const [x, y, z] = line.xyz;
      const moved = Math.abs(now.x - x) > SAME_POINT || Math.abs(now.y - y) > SAME_POINT || Math.abs(now.z - z) > SAME_POINT;
      if (!moved) return line.raw;
      return `${indent}${line.key} ${point(now)}${line.tail ? ` ${line.tail}` : ''}`;
    }
    if (line.key in managed) {
      const value = managed[line.key];
      const original = line.raw.trim().slice(line.key.length).trim();
      const cmp = line.key === 'PIPING-SPEC' || line.key === 'SKEY' ? original.split(/\s+/)[0] : original;
      if (value !== undefined && value !== '' && value !== cmp) return `${indent}${line.key} ${value}`;
    }
    return line.raw;
  }

  /** Bloque de una pieza creada en la app, con los datos de su pieza de spec */
  private static newBlock(comp: Component, boreUnits: 'INCH' | 'MM', isogen: boolean): string[] {
    const p = comp.ports;
    if (!p.length) return [];
    const params = comp.parameters;
    const eccentric = comp.type === 'REDUCER' && ((params.lateralOffset ?? 0) > 0.01 || (params.skey || '').startsWith('RE'));
    const end = (port: (typeof p)[number], pos = port.position) => {
      const token = isogen ? ` ${port.plantEndType ? plantEndToPcf(port.plantEndType) : port.endType === 'FLANG' ? 'FL' : port.endType === 'THD' ? 'SC' : port.endType}` : '';
      return `${IND}END-POINT ${point(pos)} ${formatBore(port.nominalDiameter, boreUnits)}${token}`;
    };
    const out = [blockTypeForComponent(comp.type, eccentric)];

    switch (comp.type) {
      case 'PIPE':
        if (p.length < 2 || p[0].position.distanceTo(p[1].position) < 1e-3) return [];
        out.push(end(p[0]), end(p[1]));
        break;
      case 'ELBOW': {
        if (p.length < 2) return [];
        const c = PcfImporter.elbowVertex(p[0], p[1]);
        out.push(end(p[0]), end(p[1]), `${IND}CENTRE-POINT ${point(c)}`);
        break;
      }
      case 'TEE':
      case 'CROSS': {
        if (p.length < 3) return [];
        const c = comp.centerline[1] ?? p[0].position.clone().lerp(p[1].position, 0.5);
        out.push(end(p[0]), end(p[1]), `${IND}CENTRE-POINT ${point(c)}`);
        p.slice(2).forEach((bp, i) => {
          const token = isogen ? ` ${bp.plantEndType ? plantEndToPcf(bp.plantEndType) : bp.endType}` : '';
          out.push(`${IND}BRANCH${i + 1}-POINT ${point(bp.position)} ${formatBore(bp.nominalDiameter, boreUnits)}${token}`);
        });
        break;
      }
      case 'OLET': {
        // Probado en Plant 2027: CENTRE-POINT sin diámetro y el ramal con el suyo
        const c = comp.centerline[0] ?? p[0].position;
        out.push(`${IND}CENTRE-POINT ${point(c)}`, `${IND}BRANCH1-POINT ${point(p[0].position)} ${formatBore(p[0].nominalDiameter, boreUnits)}`);
        break;
      }
      case 'CAP': {
        const closed = comp.centerline[1] ?? p[0].position.clone().addScaledVector(p[0].direction, -(params.faceToFace || 20));
        out.push(end(p[0]), end(p[0], closed));
        break;
      }
      default:
        p.forEach((port) => out.push(end(port)));
        if (eccentric && p.length >= 2) {
          // FLAT-DIRECTION: lado donde quedan alineadas las generatrices (hacia donde se corre el extremo chico)
          const axis = p[1].direction.clone().normalize();
          const off = p[1].position.clone().sub(p[0].position);
          off.addScaledVector(axis, -off.dot(axis));
          if (off.lengthSq() > 1e-6) {
            const flat = off.normalize();
            out.push(`${IND}FLAT-DIRECTION ${directionName(flat.x, flat.y, flat.z)}`);
          }
        }
    }

    const skey = params.skey || defaultSkey(comp.type, p[0].endType, params.description);
    if (skey) out.push(`${IND}SKEY ${skey}`);
    if (comp.type === 'ELBOW') out.push(`${IND}ANGLE ${Math.round((params.angle ?? 90) * 100)}`);
    if (isogen && (params.itemCode || comp.catalogId)) out.push(`${IND}ITEM-CODE ${params.itemCode || comp.catalogId}`);
    if (params.description) out.push(`${IND}ITEM-DESCRIPTION ${params.description}`);
    out.push(`${IND}PIPING-SPEC ${comp.specCode}`);
    return out;
  }

  /** Datos de taller de la app (solo Isogen): TAG del niple y preparación de extremos */
  private static shopData(comp: Component, seq: number, block: string[]): string[] {
    const has = (k: string) => block.some((l) => l.trim().startsWith(`${k} `));
    const extra: string[] = [];
    const [p1, p2] = comp.ports;
    if (!has('TAG')) extra.push(`${IND}TAG ${comp.parameters.nippleTag || `N-${String(seq).padStart(2, '0')}`}`);
    if (!has('END-PREPARATION') && p1 && p2) {
      const prep = (port: typeof p1, f?: string) => f || (port.endType === 'THD' ? 'Roscado' : port.endType === 'SW' ? 'Plano' : 'Bisel');
      extra.push(`${IND}END-PREPARATION ${prep(p1, comp.parameters.endFinish1)}/${prep(p2, comp.parameters.endFinish2)}`);
    }
    return extra;
  }

  /** Solo Isogen: WELD por soldadura y GASKET + BOLT por unión bridada */
  private static jointBlocks(
    joint: Joint,
    graph: PipingGraph,
    boreUnits: 'INCH' | 'MM',
    n: number,
    materials: Map<string, string>
  ): string[] {
    const a = graph.ports.get(joint.portAId);
    const b = graph.ports.get(joint.portBId);
    if (!a || !b) return [];
    const nd = a.nominalDiameter;
    const bore = formatBore(nd, boreUnits);
    if (joint.type === 'FLANGED') {
      const ca = graph.components.get(a.componentId);
      const cb = graph.components.get(b.componentId);
      const src = [ca, cb].find((c) => c?.parameters.gasketDescription) ?? ca;
      const gDesc = src?.parameters.gasketDescription || `JUNTA ${nd}"`;
      const bDesc = src?.parameters.boltSetDescription || `ESPARRAGOS ${nd}"`;
      const gCode = `GSK-${graph.activeSpec}-${Math.round(nd * 100)}`;
      const bCode = `BLT-${graph.activeSpec}-${Math.round(nd * 100)}`;
      materials.set(gCode, gDesc);
      materials.set(bCode, bDesc);
      return [
        'GASKET',
        `${IND}END-POINT ${point(a.position)} ${bore}`,
        `${IND}END-POINT ${point(b.position)} ${bore}`,
        `${IND}ITEM-CODE ${gCode}`,
        `${IND}ITEM-DESCRIPTION ${gDesc}`,
        'BOLT',
        `${IND}END-POINT ${point(joint.position)} ${bore}`,
        `${IND}BOLT-DIA ${src?.parameters.boltSize || ''}`.trimEnd(),
        `${IND}BOLT-LENGTH ${src?.parameters.boltLengthMm ?? ''}`.trimEnd(),
        `${IND}BOLT-QUANTITY ${src?.parameters.boltCount ?? 4}`,
        `${IND}ITEM-CODE ${bCode}`,
        `${IND}ITEM-DESCRIPTION ${bDesc}`
      ];
    }
    if (joint.type === 'CONTINUOUS') return [];
    return [
      'WELD',
      `${IND}END-POINT ${point(joint.position)} ${bore}`,
      `${IND}END-POINT ${point(joint.position)} ${bore}`,
      `${IND}SKEY ${joint.fieldWeld ? 'WF' : joint.type === 'SOCKETWELD' ? 'SW' : 'WW'}`,
      `${IND}WELD-NO ${joint.fieldWeld ? `${joint.fieldWeld}-` : 'W-'}${n}`,
      ...(joint.fieldWeld ? [`${IND}ERECTION-ITEM`] : [`${IND}FABRICATION-ITEM`]),
      ...(joint.fieldWeld === 'FFW' ? [`${IND}FIELD-FIT-ALLOWANCE ${joint.fieldAllowanceMm ?? 100}`] : [])
    ];
  }

  private static ascii(line: string): string {
    return line
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[“”″]/g, '"')
      .replace(/[‘’′]/g, "'")
      .replace(/°/g, ' DEG')
      .replace(/[^\x20-\x7E\t]/g, '?');
  }
}
