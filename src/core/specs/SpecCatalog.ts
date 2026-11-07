import { ComponentType, SpecFitting } from '../../types/piping';
import { CatalogPart, PartCategory, SpecCatalogData, SpecPreferences } from './catalogTypes';
import { ConnectionRule, DEFAULT_CONNECTION_RULES, resolveConnection } from './connectionRules';
import { computePartGeometry, PartGeometry } from './partGeometry';
import { formatNominal, plantEndToAppEnd } from './units';

/** Criterios para elegir una pieza de la spec, como hace Plant al rutear */
export interface PartQuery {
  category: PartCategory;
  nominalDiameter: number;
  /** Segundo diámetro: extremo chico de la reducción, ramal de la tee u olet */
  secondaryDiameter?: number;
  angle?: number;
  /** Familia elegida explícitamente (PartFamilyId) */
  familyId?: string;
  /** Extremo de Plant del puerto donde se va a conectar */
  connectToEndType?: string;
  pressureClass?: string;
  eccentric?: boolean;
}

export interface FamilyOption {
  familyId: string;
  familyDesc: string;
  category: PartCategory;
  skey?: string;
  endTypes: string[];
  pressureClass?: string;
  angles: number[];
  secondarySizes: number[];
  confidence: PartGeometry['confidence'];
  partCount: number;
  /** Lugar en las prioridades de Plant (0 = primera), si la spec lo define */
  plantPriority?: number;
}

/** Tipo de pieza de Plant (PartUsePriorities.xml) por categoría */
const PLANT_PART_TYPE: Partial<Record<PartCategory, string>> = {
  PIPE: 'Pipe',
  ELBOW: 'Elbow',
  TEE: 'Tee',
  FLANGE: 'Flange',
  FLANGE_BLIND: 'BlindFlange',
  VALVE: 'Valve',
  REDUCER: 'Reducer',
  CAP: 'Cap',
  OLET: 'Olet',
  COUPLING: 'Coupling',
  GASKET: 'Gasket',
  BOLT_SET: 'BoltSet'
};

const APP_TYPE: Partial<Record<PartCategory, ComponentType>> = {
  PIPE: 'PIPE',
  ELBOW: 'ELBOW',
  TEE: 'TEE',
  FLANGE: 'FLANGE',
  VALVE: 'VALVE',
  REDUCER: 'REDUCER',
  CAP: 'CAP',
  GASKET: 'GASKET',
  BOLT_SET: 'BOLT_SET'
};

/** Agujeros y círculo de bulones ASME B16.5 clase 150 (pulgadas), para dibujar y para el BOM */
const B165_CL150: Record<number, [number, number]> = {
  0.5: [2.38, 4], 0.75: [2.75, 4], 1: [3.12, 4], 1.25: [3.5, 4], 1.5: [3.88, 4], 2: [4.75, 4],
  2.5: [5.5, 4], 3: [6, 4], 3.5: [7, 8], 4: [7.5, 8], 5: [8.5, 8], 6: [9.5, 8], 8: [11.75, 8],
  10: [14.25, 12], 12: [17, 12], 14: [18.75, 12], 16: [21.25, 16], 18: [22.75, 16], 20: [25, 20], 24: [29.5, 20]
};

const EPS = 0.001;

/** Largo en pulgadas con fracción al 1/8: 3-1/4" */
function inchFraction(mm: number): string {
  const eighths = Math.round((mm / 25.4) * 8);
  const whole = Math.floor(eighths / 8);
  let num = eighths % 8;
  let den = 8;
  while (num > 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  if (num === 0) return `${whole}"`;
  return whole > 0 ? `${whole}-${num}/${den}"` : `${num}/${den}"`;
}
const sameNd = (a: number, b: number) => Math.abs(a - b) < EPS;

function formatSchedule(s: string | undefined): string {
  if (!s) return 'STD';
  return /^\d/.test(s) ? `SCH ${s}` : s.toUpperCase();
}

/**
 * Spec de Plant 3D lista para consultar en el hilo principal: elige piezas con las
 * prioridades de la spec (.pspx), la compatibilidad de extremos y la familia que el
 * usuario fije en la paleta.
 */
export class SpecCatalog {
  public readonly data: SpecCatalogData;
  public rules: ConnectionRule[];
  private preferred = new Map<PartCategory, string>();
  private geomCache = new Map<number, PartGeometry>();
  private byCategory = new Map<PartCategory, CatalogPart[]>();

  constructor(data: SpecCatalogData, rules: ConnectionRule[] = DEFAULT_CONNECTION_RULES) {
    this.data = data;
    this.rules = rules;
    for (const part of data.parts) {
      const list = this.byCategory.get(part.category) ?? [];
      list.push(part);
      this.byCategory.set(part.category, list);
    }
  }

  get specName(): string {
    return this.data.specName;
  }

  get isNative(): boolean {
    return this.data.isNative;
  }

  get preferences(): SpecPreferences | undefined {
    return this.data.preferences;
  }

  setPreferences(prefs: SpecPreferences | undefined): void {
    this.data.preferences = prefs;
  }

  geometry(part: CatalogPart): PartGeometry {
    let g = this.geomCache.get(part.pnpid);
    if (!g) {
      g = computePartGeometry(part);
      this.geomCache.set(part.pnpid, g);
    }
    return g;
  }

  partsOf(category: PartCategory): CatalogPart[] {
    return this.byCategory.get(category) ?? [];
  }

  getPart(pnpid: number): CatalogPart | undefined {
    return this.data.parts.find((p) => p.pnpid === pnpid);
  }

  /** Diámetros con caño en la spec (los que se pueden rutear) */
  sizes(): number[] {
    const src = this.partsOf('PIPE').length ? this.partsOf('PIPE') : this.data.parts.filter((p) => p.category !== 'ACTUATOR' && p.category !== 'BOLT_SET');
    const set = new Set<number>();
    for (const p of src) if (p.ports[0] && p.ports[0].nominalDiameter > 0) set.add(p.ports[0].nominalDiameter);
    return Array.from(set).sort((a, b) => a - b);
  }

  sizesFor(category: PartCategory): number[] {
    const set = new Set<number>();
    for (const p of this.partsOf(category)) if (p.ports[0]) set.add(p.ports[0].nominalDiameter);
    return Array.from(set).sort((a, b) => a - b);
  }

  sizeLabel(nd: number): string {
    const unit = this.data.parts.find((p) => p.ports[0])?.ports[0].nominalUnit ?? 'in';
    return formatNominal(nd, unit);
  }

  setPreferredFamily(category: PartCategory, familyId: string | null): void {
    if (familyId) this.preferred.set(category, familyId);
    else this.preferred.delete(category);
  }

  getPreferredFamily(category: PartCategory): string | undefined {
    return this.preferred.get(category);
  }

  getPreferredFamilies(): Record<string, string> {
    return Object.fromEntries(this.preferred.entries());
  }

  /** Posición de la familia en las prioridades de Plant para ese tipo y tamaño */
  private plantPriority(category: PartCategory, nd: number, familyId: string): number | undefined {
    const type = PLANT_PART_TYPE[category];
    const prios = this.data.preferences?.priorities;
    if (!type || !prios) return undefined;
    const entry = prios.find((p) => p.partType === type && sameNd(p.nominalDiameter, nd));
    if (!entry) return undefined;
    const idx = entry.familyIds.indexOf(familyId.toLowerCase());
    return idx >= 0 ? idx : undefined;
  }

  private matchesSize(part: CatalogPart, q: PartQuery): boolean {
    const s1 = part.ports[0];
    if (!s1 || !sameNd(s1.nominalDiameter, q.nominalDiameter)) return false;
    if (part.category === 'REDUCER') {
      if (q.secondaryDiameter === undefined) return true;
      return !!part.ports[1] && sameNd(part.ports[1].nominalDiameter, q.secondaryDiameter);
    }
    if (part.category === 'TEE') {
      const branch = part.ports[2]?.nominalDiameter ?? s1.nominalDiameter;
      return sameNd(branch, q.secondaryDiameter ?? q.nominalDiameter) && sameNd(part.ports[1]?.nominalDiameter ?? s1.nominalDiameter, s1.nominalDiameter);
    }
    if (part.category === 'OLET' && q.secondaryDiameter !== undefined) {
      return !!part.ports[1] && sameNd(part.ports[1].nominalDiameter, q.secondaryDiameter);
    }
    return true;
  }

  private angleOf(part: CatalogPart): number {
    return part.params.A ?? part.extra.angleDeg ?? 90;
  }

  /** Puntaje para ordenar candidatos; más alto = mejor */
  private score(part: CatalogPart, q: PartQuery): number {
    let s = 0;
    const nd = q.nominalDiameter;
    const pref = this.preferred.get(q.category);
    if (pref && part.familyId === pref) s += 1000;
    const prio = this.plantPriority(q.category, nd, part.familyId);
    if (prio !== undefined) s += 500 - prio * 10;

    const ends = part.ports.map((p) => p.endType.toUpperCase());
    if (q.connectToEndType) {
      const compatible = part.ports.some(
        (p) => resolveConnection({ endType: q.connectToEndType, nominalDiameter: nd }, { endType: p.endType, nominalDiameter: p.nominalDiameter }, this.rules).rule !== null
      );
      if (compatible) s += q.category === 'VALVE' ? 20 : 200;
    }
    // Práctica ASME: soldado a tope desde 2", socket o rosca por debajo
    const isBw = ends.some((e) => e === 'BV');
    const isSmallBore = ends.some((e) => e === 'SW' || e.startsWith('THD'));
    if (nd >= 2 && isBw) s += 50;
    if (nd < 2 && isSmallBore) s += 50;

    const g = this.geometry(part);
    if (g.confidence === 'verified') s += 5;
    if (g.confidence === 'approximate') s -= 5;

    if (q.category === 'ELBOW') {
      if ((part.template || '').toUpperCase().endsWith('_OMOF')) s -= 300;
      if (/\bSR\b|SHORT/i.test(part.familyDesc)) s -= 10;
    }
    if (q.category === 'REDUCER') {
      const ecc = (part.isoType || '').includes('ECCENTRIC') || (part.template || '').toUpperCase().startsWith('CPJRE');
      if (!!q.eccentric === ecc) s += 100;
      if ((part.template || '').toUpperCase().startsWith('CYLSTACK')) s -= 20;
    }
    if (q.category === 'VALVE') {
      if (ends.includes('FL')) s += 100;
      if (/gate|compuerta/i.test(part.familyDesc)) s += 10;
    }
    if ((q.category === 'GASKET' || q.category === 'BOLT_SET' || q.category === 'FLANGE') && q.pressureClass) {
      if ((part.pressureClass || part.ports[0]?.pressureClass) === q.pressureClass) s += 300;
    }
    return s;
  }

  /** Candidatos ordenados como los elegiría Plant */
  candidates(q: PartQuery): CatalogPart[] {
    let list = this.partsOf(q.category).filter((p) => this.matchesSize(p, q));
    if (q.category === 'ELBOW' && q.angle !== undefined) {
      list = list.filter((p) => Math.abs(this.angleOf(p) - q.angle!) < 1);
    }
    if (q.familyId) {
      const fam = list.filter((p) => p.familyId === q.familyId);
      if (fam.length) list = fam;
    }
    return list
      .map((p) => ({ p, s: this.score(p, q) }))
      .sort((a, b) => b.s - a.s || a.p.pnpid - b.p.pnpid)
      .map((x) => x.p);
  }

  select(q: PartQuery): CatalogPart | null {
    return this.candidates(q)[0] ?? null;
  }

  /** Familias disponibles para un tipo y tamaño (para la paleta) */
  families(category: PartCategory, nd: number): FamilyOption[] {
    const map = new Map<string, FamilyOption>();
    for (const part of this.partsOf(category)) {
      if (!part.ports[0] || !sameNd(part.ports[0].nominalDiameter, nd)) continue;
      const key = part.familyId || part.familyDesc;
      let opt = map.get(key);
      if (!opt) {
        opt = {
          familyId: key,
          familyDesc: part.familyDesc,
          category,
          skey: part.skey,
          endTypes: part.ports.map((p) => p.endType),
          pressureClass: part.pressureClass ?? part.ports[0].pressureClass,
          angles: [],
          secondarySizes: [],
          confidence: this.geometry(part).confidence,
          partCount: 0,
          plantPriority: this.plantPriority(category, nd, key)
        };
        map.set(key, opt);
      }
      opt.partCount++;
      if (category === 'ELBOW') {
        const a = Math.round(this.angleOf(part));
        if (!opt.angles.includes(a)) opt.angles.push(a);
      }
      const second = category === 'TEE' ? part.ports[2] : category === 'REDUCER' || category === 'OLET' ? part.ports[1] : undefined;
      if (second && !opt.secondarySizes.some((x) => sameNd(x, second.nominalDiameter))) opt.secondarySizes.push(second.nominalDiameter);
    }
    const q: PartQuery = { category, nominalDiameter: nd };
    return Array.from(map.values()).sort((a, b) => {
      const pa = this.partsOf(category).find((p) => (p.familyId || p.familyDesc) === a.familyId)!;
      const pb = this.partsOf(category).find((p) => (p.familyId || p.familyDesc) === b.familyId)!;
      return this.score(pb, q) - this.score(pa, q) || a.familyDesc.localeCompare(b.familyDesc);
    });
  }

  /** Convierte una pieza de catálogo al formato que usa el grafo de cañerías */
  toFitting(part: CatalogPart): SpecFitting {
    const g = this.geometry(part);
    const s1 = part.ports[0];
    const nd = s1?.nominalDiameter ?? 0;
    const od = s1?.outerDiameterMm || nd * 25.4;
    const wt = part.wallThicknessMm ?? s1?.wallThicknessMm ?? Math.max(2.5, od * 0.065);
    const partType = APP_TYPE[part.category] ?? 'VALVE';
    const second = part.category === 'TEE' ? part.ports[2] : part.category === 'REDUCER' ? part.ports[1] : undefined;
    const pressureClass = part.pressureClass ?? s1?.pressureClass;

    let boltCircle = part.extra.boltCircleMm;
    let boltHoles = part.extra.boltHoles;
    if ((part.category === 'FLANGE' || part.category === 'VALVE') && (!boltCircle || !boltHoles) && (!pressureClass || pressureClass === '150')) {
      const t = B165_CL150[nd];
      if (t) {
        boltCircle = boltCircle ?? t[0] * 25.4;
        boltHoles = boltHoles ?? t[1];
      }
    }

    const fitting: SpecFitting = {
      pnpid: part.pnpid,
      partType,
      specCode: this.specName,
      shortDescription: (part.sizeDesc || part.familyDesc).replace(
        /@@@/g,
        part.extra.boltLengthMm ? inchFraction(part.extra.boltLengthMm) : '?'
      ),
      nominalDiameter: nd,
      outerDiameter: od,
      wallThickness: wt,
      schedule: formatSchedule(part.schedule),
      endType: plantEndToAppEnd(s1?.endType),
      itemCode: part.itemCode || String(part.pnpid),
      skey: part.skey,
      familyId: part.familyId,
      familyDescription: part.familyDesc,
      template: part.template,
      pressureClass,
      geometryConfidence: g.confidence,
      geometryNote: g.note,
      plantEndTypes: part.ports.map((p) => p.endType),
      portNominalDiameters: part.ports.map((p) => p.nominalDiameter),
      portOuterDiameters: part.ports.map((p) => p.outerDiameterMm),
      visual: g.visual,
      boltCircle,
      boltHoles
    };

    switch (part.category) {
      case 'ELBOW':
        fitting.angle = g.angleDeg;
        fitting.radius = g.radiusMm;
        fitting.takeOff = g.takeOff;
        fitting.takeOff2 = g.takeOff2;
        break;
      case 'TEE':
        fitting.runTakeOff = g.runTakeOff;
        fitting.branchTakeOff = g.branchTakeOff;
        break;
      case 'REDUCER':
        fitting.faceToFace = g.portSpan;
        fitting.lateralOffset = g.lateralOffset;
        break;
      case 'GASKET':
        fitting.faceToFace = g.portSpan;
        fitting.gasketThicknessMm = g.portSpan;
        break;
      case 'BOLT_SET':
        fitting.boltSize = part.extra.boltSize;
        fitting.boltCount = part.extra.boltCount;
        fitting.boltLengthMm = part.extra.boltLengthMm;
        break;
      default:
        fitting.faceToFace = g.portSpan;
    }
    if (second) {
      fitting.reducedNominalDiameter = second.nominalDiameter;
      fitting.reducedOuterDiameter = second.outerDiameterMm;
    }
    return fitting;
  }

  /** Atajo: elegir y convertir */
  find(q: PartQuery): SpecFitting | null {
    const part = this.select(q);
    return part ? this.toFitting(part) : null;
  }
}
