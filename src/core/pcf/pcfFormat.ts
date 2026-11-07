import { ComponentType, EndType } from '../../types/piping';
import { dnToInch, inchToDn } from '../specs/units';

/**
 * Lectura y escritura de bajo nivel de PCF (Piping Component File).
 *
 * El lector conserva cada línea tal cual venía para que la reexportación de una pieza
 * que no se tocó salga idéntica. Formato probado con PCF to Pipe de Plant 3D 2027:
 * CRLF, ASCII, PIPING-SPEC en cada pieza, ANGLE en centésimas (9000), olet con
 * CENTRE-POINT sin diámetro, sin bloques WELD / GASKET / BOLT.
 */

export const PCF_EOL = '\r\n';

export interface PcfLine {
  raw: string;
  key: string;
  /** Resto de la línea sin la palabra clave, recortado */
  value: string;
  tokens: string[];
}

export interface PcfBlock {
  type: string;
  lines: PcfLine[];
}

export interface PcfDocument {
  header: string[];
  blocks: PcfBlock[];
  materials: Map<string, string>;
  boreUnits: 'INCH' | 'MM';
  coordUnits: 'MM' | 'INCH';
  pipelineReference?: string;
  headerSpec?: string;
}

/** Palabras sin sangría que pertenecen a la cabecera y no abren un bloque */
const HEADER_KEYS = /^(ISOGEN-FILES|UNITS-[A-Z-]+|PIPELINE-REFERENCE|PROJECT-IDENTIFIER|DATE-DMY|REVISION|AREA|ATTRIBUTE\d+)$/;

function toLine(raw: string): PcfLine {
  const trimmed = raw.trim();
  const tokens = trimmed.split(/\s+/);
  const key = tokens[0].toUpperCase();
  return { raw: raw.replace(/\s+$/, ''), key, value: trimmed.slice(tokens[0].length).trim(), tokens };
}

export function parsePcf(text: string): PcfDocument {
  const doc: PcfDocument = {
    header: [],
    blocks: [],
    materials: new Map(),
    boreUnits: 'INCH',
    coordUnits: 'MM'
  };
  let cur: PcfBlock | null = null;
  let inHeader = true;
  let inMaterials = false;
  let materialCode: string | null = null;

  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const line = toLine(rawLine);
    const indented = /^\s/.test(rawLine);

    if (inMaterials) {
      if (!indented && line.key === 'ITEM-CODE') materialCode = line.value;
      else if (indented && line.key === 'DESCRIPTION' && materialCode) doc.materials.set(materialCode, line.value);
      continue;
    }

    if (!indented) {
      if (line.key === 'MATERIALS') {
        inMaterials = true;
        cur = null;
        continue;
      }
      if (inHeader && HEADER_KEYS.test(line.key)) {
        doc.header.push(line.raw);
        if (line.key === 'UNITS-BORE') doc.boreUnits = line.value.toUpperCase().startsWith('M') ? 'MM' : 'INCH';
        if (line.key === 'UNITS-CO-ORDS') doc.coordUnits = line.value.toUpperCase().startsWith('I') ? 'INCH' : 'MM';
        if (line.key === 'PIPELINE-REFERENCE') doc.pipelineReference = line.value;
        continue;
      }
      inHeader = false;
      cur = { type: line.key, lines: [] };
      doc.blocks.push(cur);
      continue;
    }

    if (inHeader || !cur) {
      doc.header.push(line.raw);
      if (line.key === 'PIPING-SPEC' && line.value) doc.headerSpec = line.tokens[1];
      continue;
    }
    cur.lines.push(line);
  }
  return doc;
}

/** Tipo de pieza de la app para cada bloque PCF; null = no es una pieza (WELD, SUPPORT...) */
export function componentTypeForBlock(type: string, hasEndPoints: boolean): ComponentType | null {
  if (type === 'PIPE' || type === 'PIPE-FIXED') return 'PIPE';
  if (type === 'ELBOW' || type === 'BEND') return 'ELBOW';
  if (type.startsWith('TEE')) return 'TEE';
  if (type === 'CROSS') return 'CROSS';
  if (type.startsWith('FLANGE')) return 'FLANGE';
  if (type.startsWith('VALVE')) return 'VALVE';
  if (type.startsWith('INSTRUMENT')) return 'INSTRUMENT';
  if (type.startsWith('REDUCER')) return 'REDUCER';
  if (type === 'CAP') return 'CAP';
  if (type === 'OLET' || type === 'ELBOLET') return 'OLET';
  if (type === 'COUPLING' || type === 'UNION') return 'COUPLING';
  if (/^(WELD|GASKET|BOLT|SUPPORT|END-POSITION|END-CONNECTION|MESSAGE|TEXT|COMPONENT-|ISOGEN|LOCATION)/.test(type)) return null;
  return hasEndPoints ? 'MISC' : null;
}

/** Bloque PCF para una pieza creada en la app */
export function blockTypeForComponent(type: ComponentType, eccentric: boolean): string {
  switch (type) {
    case 'REDUCER':
      return eccentric ? 'REDUCER-ECCENTRIC' : 'REDUCER-CONCENTRIC';
    case 'BOLT_SET':
      return 'BOLT';
    case 'MISC':
      return 'MISC-COMPONENT';
    default:
      return type;
  }
}

/** Diámetro nominal en pulgadas a partir del valor del PCF */
export function boreToInch(raw: number, units: 'INCH' | 'MM'): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return units === 'MM' ? dnToInch(raw) : raw;
}

export function formatBore(ndInch: number, units: 'INCH' | 'MM'): string {
  if (units === 'MM') return inchToDn(ndInch).toFixed(4);
  return String(Number(ndInch.toFixed(4)));
}

export function formatCoord(v: number): string {
  const s = v.toFixed(4);
  return s === '-0.0000' ? '0.0000' : s;
}

/**
 * Extremos que indica el SKEY (últimas dos letras): FL, BW, SW, SC/TH roscado, WF wafer, PL liso.
 * Para bridas la primera letra del par es la cara y el resto el lado caño (FLSO → cara + SO).
 */
export function endsFromSkey(skey: string | undefined, type: ComponentType): { face?: string; body?: string } {
  const k = (skey || '').toUpperCase();
  const tail = k.slice(-2);
  const map: Record<string, string> = { FL: 'FL', BW: 'BV', SW: 'SW', SC: 'THDF', TH: 'THDF', WF: 'WF', LG: 'LUG', PL: 'PL', SO: 'SO', CP: 'PL' };
  if (type === 'FLANGE') {
    if (k.startsWith('FL') || k.startsWith('FB')) {
      const body = k === 'FLWN' ? 'BV' : map[tail];
      return { face: 'FL', body: k.startsWith('FLBL') || k.startsWith('FB') ? undefined : body };
    }
    return { face: 'FL' };
  }
  return { body: map[tail] };
}

/** SKEY por defecto para piezas sin dato de spec (mismas claves que Isogen) */
export function defaultSkey(type: ComponentType, endType: EndType, description = ''): string {
  const e = endType === 'FLANG' ? 'FL' : endType === 'SW' ? 'SW' : endType === 'THD' ? 'SC' : 'BW';
  const d = description.toUpperCase();
  switch (type) {
    case 'ELBOW':
      return `EL${e}`;
    case 'TEE':
      return `TE${e}`;
    case 'CROSS':
      return `CR${e}`;
    case 'REDUCER':
      return `RC${e}`;
    case 'CAP':
      return `CP${e}`;
    case 'OLET':
      return endType === 'SW' ? 'SKSW' : endType === 'THD' ? 'THSC' : 'WOLO';
    case 'COUPLING':
      return `CP${e}`;
    case 'FLANGE':
      return /BLIND|CIEGA/.test(d) ? 'FLBL' : /SLIP|\bSO\b/.test(d) ? 'FLSO' : endType === 'SW' ? 'FLSW' : 'FLWN';
    case 'VALVE': {
      const kind = /GLOBE|GLOBO/.test(d)
        ? 'VV'
        : /CHECK|RETENCION/.test(d)
        ? 'VC'
        : /BALL|ESFERICA/.test(d)
        ? 'VB'
        : /BUTTERFLY|MARIPOSA/.test(d)
        ? 'VF'
        : /PLUG|MACHO/.test(d)
        ? 'VP'
        : /DIAPHRAGM|DIAFRAGMA/.test(d)
        ? 'VD'
        : 'VT';
      return `${kind}${e}`;
    }
    case 'INSTRUMENT':
      return `IN${e}`;
    default:
      return '';
  }
}

/** Dirección PCF (UP, DOWN, EAST, WEST, NORTH, SOUTH) del eje dominante; Z arriba, Y norte */
export function directionName(x: number, y: number, z: number): string {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (az >= ax && az >= ay) return z >= 0 ? 'UP' : 'DOWN';
  if (ax >= ay) return x >= 0 ? 'EAST' : 'WEST';
  return y >= 0 ? 'NORTH' : 'SOUTH';
}

export function directionVector(name: string): [number, number, number] | null {
  switch (name.toUpperCase()) {
    case 'UP':
      return [0, 0, 1];
    case 'DOWN':
      return [0, 0, -1];
    case 'EAST':
      return [1, 0, 0];
    case 'WEST':
      return [-1, 0, 0];
    case 'NORTH':
      return [0, 1, 0];
    case 'SOUTH':
      return [0, -1, 0];
    default:
      return null;
  }
}
