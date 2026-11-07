import { EndType, JointType } from '../../types/piping';

/** DN métrico ↔ diámetro nominal en pulgadas (ISO 6708 / ASME B36.10) */
const DN_TO_INCH: [number, number][] = [
  [6, 0.125], [8, 0.25], [10, 0.375], [15, 0.5], [20, 0.75], [25, 1], [32, 1.25], [40, 1.5],
  [50, 2], [65, 2.5], [80, 3], [90, 3.5], [100, 4], [125, 5], [150, 6], [200, 8], [250, 10],
  [300, 12], [350, 14], [400, 16], [450, 18], [500, 20], [550, 22], [600, 24], [650, 26],
  [700, 28], [750, 30], [800, 32], [850, 34], [900, 36], [1000, 40], [1050, 42], [1200, 48]
];

export function dnToInch(dn: number): number {
  const hit = DN_TO_INCH.find(([d]) => Math.abs(d - dn) < 0.5);
  return hit ? hit[1] : Math.round((dn / 25) * 100) / 100;
}

export function inchToDn(nd: number): number {
  const hit = DN_TO_INCH.find(([, i]) => Math.abs(i - nd) < 0.001);
  return hit ? hit[0] : Math.round(nd * 25);
}

/** Normaliza un nominal de Plant (2 'in' o 50 'mm') a pulgadas */
export function toInchNominal(raw: number, unit: string | null | undefined): number {
  if (!Number.isFinite(raw)) return 0;
  return unit === 'mm' ? dnToInch(raw) : raw;
}

/** Etiqueta legible de un diámetro: 1-1/2", 2", DN50 */
export function formatNominal(ndInches: number, unit: 'in' | 'mm' = 'in'): string {
  if (unit === 'mm') return `DN${inchToDn(ndInches)}`;
  const whole = Math.floor(ndInches + 1e-9);
  const frac = ndInches - whole;
  const fracs: [number, string][] = [[0.125, '1/8'], [0.25, '1/4'], [0.375, '3/8'], [0.5, '1/2'], [0.75, '3/4']];
  const f = fracs.find(([v]) => Math.abs(v - frac) < 0.001);
  if (frac < 0.001) return `${whole}"`;
  if (f) return whole > 0 ? `${whole}-${f[1]}"` : `${f[1]}"`;
  return `${ndInches}"`;
}

/** Factor a milímetros para la unidad de largo de Plant */
export function lengthScaleFor(unit: string | null | undefined): number {
  if (!unit) return 25.4;
  const u = unit.toLowerCase();
  if (u === 'mm') return 1;
  if (u === 'cm') return 10;
  if (u === 'm') return 1000;
  if (u === 'ft') return 304.8;
  return 25.4;
}

/**
 * Espesores de pared ASME B36.10M en mm, para cuando la spec no los trae
 * (las specs de ejemplo de Plant dejan WallThickness vacío).
 */
const WT_TABLE: Record<string, Record<number, number>> = {
  '10': { 0.5: 2.11, 0.75: 2.11, 1: 2.77, 1.25: 2.77, 1.5: 2.77, 2: 2.77, 2.5: 3.05, 3: 3.05, 3.5: 3.05, 4: 3.05, 5: 3.4, 6: 3.4, 8: 3.76, 10: 4.19, 12: 4.57, 14: 6.35, 16: 6.35, 18: 6.35, 20: 6.35, 24: 6.35 },
  '40': { 0.5: 2.77, 0.75: 2.87, 1: 3.38, 1.25: 3.56, 1.5: 3.68, 2: 3.91, 2.5: 5.16, 3: 5.49, 3.5: 5.74, 4: 6.02, 5: 6.55, 6: 7.11, 8: 8.18, 10: 9.27, 12: 10.31, 14: 11.13, 16: 12.7, 18: 14.27, 20: 15.09, 24: 17.48 },
  STD: { 0.5: 2.77, 0.75: 2.87, 1: 3.38, 1.25: 3.56, 1.5: 3.68, 2: 3.91, 2.5: 5.16, 3: 5.49, 3.5: 5.74, 4: 6.02, 5: 6.55, 6: 7.11, 8: 8.18, 10: 9.27, 12: 9.53, 14: 9.53, 16: 9.53, 18: 9.53, 20: 9.53, 24: 9.53 },
  '80': { 0.5: 3.73, 0.75: 3.91, 1: 4.55, 1.25: 4.85, 1.5: 5.08, 2: 5.54, 2.5: 7.01, 3: 7.62, 3.5: 8.08, 4: 8.56, 5: 9.53, 6: 10.97, 8: 12.7, 10: 15.09, 12: 17.48, 14: 19.05, 16: 21.44, 18: 23.83, 20: 26.19, 24: 30.96 },
  XS: { 0.5: 3.73, 0.75: 3.91, 1: 4.55, 1.25: 4.85, 1.5: 5.08, 2: 5.54, 2.5: 7.01, 3: 7.62, 3.5: 8.08, 4: 8.56, 5: 9.53, 6: 10.97, 8: 12.7, 10: 12.7, 12: 12.7, 14: 12.7, 16: 12.7, 18: 12.7, 20: 12.7, 24: 12.7 },
  '160': { 0.5: 4.78, 0.75: 5.56, 1: 6.35, 1.25: 6.35, 1.5: 7.14, 2: 8.74, 2.5: 9.53, 3: 11.13, 4: 13.49, 5: 15.88, 6: 18.26, 8: 23.01, 10: 28.58, 12: 33.32 }
};

/** Extrae el schedule de un texto de Plant: "Sch 40", "SCH 80S", "STD", "XS" */
export function parseSchedule(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.toUpperCase();
  const m = t.match(/SCH(?:EDULE)?\.?\s*(\d{2,3})S?\b/);
  if (m) return m[1];
  if (/\bXXS\b/.test(t)) return 'XXS';
  if (/\bXS\b/.test(t)) return 'XS';
  if (/\bSTD\b/.test(t)) return 'STD';
  return undefined;
}

/** Espesor según schedule ASME B36.10; undefined si no hay dato */
export function wallThicknessFromSchedule(ndInches: number, schedule: string | undefined): number | undefined {
  const key = schedule ? schedule.toUpperCase().replace(/^SCH\s*/, '') : 'STD';
  const table = WT_TABLE[key];
  return table ? table[ndInches] : undefined;
}

/** Traduce un extremo de Plant al tipo simplificado que usa la app para cortes y PCF */
export function plantEndToAppEnd(plantEnd: string | undefined): EndType {
  const e = (plantEnd || '').toUpperCase();
  if (e === 'FL' || e === 'LFL' || e === 'WF' || e === 'LUG') return 'FLANG';
  if (e === 'SW' || e === 'PSW') return 'SW';
  if (e.startsWith('THD')) return 'THD';
  return 'BW';
}

/** Tipo de extremo para el END-POINT de un PCF */
export function plantEndToPcf(plantEnd: string | undefined): string {
  const e = (plantEnd || '').toUpperCase();
  if (e === 'FL' || e === 'LFL' || e === 'LUG' || e === 'WF') return 'FL';
  if (e === 'SW' || e === 'PSW') return 'SW';
  if (e === 'THDF' || e === 'THDM') return 'SC';
  if (e === 'PL' || e === 'PPL') return 'PL';
  return 'BW';
}

/** Parsea "D=2.375,R=3,A=90,OF=-1" a números (sin convertir unidades) */
export function parseParamDefinition(defString?: string | null): Record<string, number> {
  const result: Record<string, number> = {};
  if (!defString) return result;
  for (const part of String(defString).split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const num = parseFloat(part.slice(idx + 1));
    if (k && Number.isFinite(num)) result[k] = num;
  }
  return result;
}

/** Parsea "TYPE=ELBOW,SKEY=ELBW" */
export function parseIsoSymbol(def?: string | null): { type?: string; skey?: string } {
  const out: { type?: string; skey?: string } = {};
  if (!def) return out;
  for (const part of String(def).split(',')) {
    const [k, v] = part.split('=').map((s) => s?.trim());
    if (!k || !v) continue;
    if (k.toUpperCase() === 'TYPE') out.type = v.toUpperCase();
    if (k.toUpperCase() === 'SKEY') out.skey = v.toUpperCase();
  }
  return out;
}

/** Tipo de unión de la app a partir del nombre de unión de Plant */
export function plantJointToAppJoint(plantJoint: string | undefined): JointType {
  switch (plantJoint) {
    case 'Socketweld':
      return 'SOCKETWELD';
    case 'Threaded':
    case 'ThreadedTap':
      return 'THREADED';
    case 'Flanged':
    case 'Lug':
    case 'WaferFlanged':
    case 'WaferWafer':
      return 'FLANGED';
    case 'Slip':
      return 'SLIPON';
    case 'Glue':
      return 'GLUE';
    case 'Fusionweld':
      return 'FUSION';
    case 'Clamped':
    case 'Triclover':
      return 'CLAMP';
    case 'PipeBend':
      return 'CONTINUOUS';
    default:
      return 'BUTTWELD';
  }
}
