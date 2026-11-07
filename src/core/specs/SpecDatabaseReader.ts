import { ComponentType, FittingQueryCriteria, SpecFitting } from '../../types/piping';
import { PartCategory, SpecCatalogData, SpecPreferences } from './catalogTypes';
import { ConnectionRule } from './connectionRules';
import { buildDemoCatalog } from './demoCatalog';
import { readPlantPartsDatabase, isPlantPartsDatabase } from './pspcReader';
import { readPspx } from './pspxReader';
import { FamilyOption, PartQuery, SpecCatalog } from './SpecCatalog';
import { isSqliteBuffer, openSqlite } from './sqlEngine';

export { getSqlInstance } from './sqlEngine';

/** Opciones de selección que imitan lo que Plant tiene en cuenta al insertar una pieza */
export interface FindOptions {
  /** Extremo de Plant del puerto donde se conecta (BV, PL, FL, SW...) */
  connectToEndType?: string;
  pressureClass?: string;
  familyId?: string;
  eccentric?: boolean;
}

const CATEGORY_OF: Record<ComponentType, PartCategory> = {
  PIPE: 'PIPE',
  ELBOW: 'ELBOW',
  TEE: 'TEE',
  FLANGE: 'FLANGE',
  VALVE: 'VALVE',
  REDUCER: 'REDUCER',
  CAP: 'CAP',
  GASKET: 'GASKET',
  BOLT_SET: 'BOLT_SET',
  CROSS: 'CROSS',
  OLET: 'OLET',
  COUPLING: 'COUPLING',
  INSTRUMENT: 'INSTRUMENT',
  MISC: 'MISC'
};

/**
 * Acceso a la spec activa de Plant 3D. Mantiene la interfaz que usa el resto de la app
 * (findPipe, findElbow...) pero por dentro elige las piezas con SpecCatalog: familias,
 * prioridades del .pspx, extremos compatibles y geometría por plantilla.
 */
export class SpecDatabaseReader {
  public readonly catalog: SpecCatalog;
  private sourceBuffer?: Uint8Array;

  constructor(catalog: SpecCatalog, sourceBuffer?: Uint8Array) {
    this.catalog = catalog;
    this.sourceBuffer = sourceBuffer;
  }

  get isNativePlant3D(): boolean {
    return this.catalog.isNative;
  }

  get specName(): string {
    return this.catalog.data.specName;
  }

  set specName(name: string) {
    this.catalog.data.specName = name;
  }

  get warnings(): string[] {
    return this.catalog.data.warnings;
  }

  /** Lee una .pspc/.pcat (SQLite). Sin buffer devuelve el catálogo demo. */
  public static async create(buffer?: ArrayBuffer | Uint8Array, sourceFile = 'spec.pspc'): Promise<SpecDatabaseReader> {
    if (!buffer) return SpecDatabaseReader.createDefault('CS150');
    const data = await SpecDatabaseReader.parseBuffer(buffer, sourceFile);
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return new SpecDatabaseReader(new SpecCatalog(data), u8);
  }

  /** Parsea el binario de una spec de Plant al modelo JSON (también lo usa el Worker) */
  public static async parseBuffer(buffer: ArrayBuffer | Uint8Array, sourceFile: string): Promise<SpecCatalogData> {
    if (!isSqliteBuffer(buffer)) {
      throw new Error(`"${sourceFile}" no es una base SQLite de Plant 3D (.pspc / .pcat).`);
    }
    const db = await openSqlite(buffer);
    try {
      if (!isPlantPartsDatabase(db)) {
        throw new Error(`"${sourceFile}" es SQLite pero no tiene las tablas de piezas de Plant 3D (EngineeringItems, PartPort, Port).`);
      }
      return readPlantPartsDatabase(db, sourceFile);
    } finally {
      db.close();
    }
  }

  /** Catálogo demo integrado (no es una spec de Plant) */
  public static async createDefault(specName = 'CS150'): Promise<SpecDatabaseReader> {
    return new SpecDatabaseReader(new SpecCatalog(buildDemoCatalog(specName)));
  }

  /** Spec desde un buffer .pspc y, opcionalmente, su .pspx con las prioridades de Plant */
  public static async fromBuffer(
    buffer: ArrayBuffer | Uint8Array,
    specName?: string,
    pspxBuffer?: ArrayBuffer | Uint8Array
  ): Promise<SpecDatabaseReader> {
    const reader = await SpecDatabaseReader.create(buffer, `${specName || 'spec'}.pspc`);
    if (specName) reader.specName = specName;
    if (pspxBuffer) reader.catalog.setPreferences(await readPspx(pspxBuffer));
    return reader;
  }

  /** Spec ya parseada (por el Worker o desde la caché de IndexedDB) */
  public static fromCatalogData(data: SpecCatalogData, rules?: ConnectionRule[]): SpecDatabaseReader {
    return new SpecDatabaseReader(new SpecCatalog(data, rules));
  }

  public setPreferences(prefs: SpecPreferences | undefined): void {
    this.catalog.setPreferences(prefs);
  }

  public setConnectionRules(rules: ConnectionRule[]): void {
    this.catalog.rules = rules;
  }

  /** Busca una pieza según criterios del grafo */
  public findFitting(criteria: FittingQueryCriteria): SpecFitting | null {
    const q: PartQuery = {
      category: CATEGORY_OF[criteria.partType] ?? 'MISC',
      nominalDiameter: criteria.nominalDiameter,
      secondaryDiameter: criteria.reducedNominalDiameter,
      angle: criteria.angle,
      familyId: criteria.familyId,
      connectToEndType: criteria.connectToEndType,
      pressureClass: criteria.pressureClass,
      eccentric: criteria.eccentric
    };
    return this.catalog.find(q);
  }

  private findBy(partType: ComponentType, nd: number, opts: FindOptions = {}, extra: Partial<FittingQueryCriteria> = {}): SpecFitting | null {
    return this.findFitting({ partType, nominalDiameter: nd, ...opts, ...extra });
  }

  public findPipe(nominalDiameter: number, _specCode?: string, opts?: FindOptions): SpecFitting | null {
    return this.findBy('PIPE', nominalDiameter, opts);
  }

  public findElbow(nominalDiameter: number, angle = 90, _specCode?: string, opts?: FindOptions): SpecFitting | null {
    return this.findBy('ELBOW', nominalDiameter, opts, { angle });
  }

  public findTee(nominalDiameter: number, _specCode?: string, opts?: FindOptions & { branchDiameter?: number }): SpecFitting | null {
    return this.findBy('TEE', nominalDiameter, opts, { reducedNominalDiameter: opts?.branchDiameter });
  }

  public findFlange(nominalDiameter: number, _specCode?: string, opts?: FindOptions): SpecFitting | null {
    return this.findBy('FLANGE', nominalDiameter, opts);
  }

  public findReducer(nominalDiameter1: number, nominalDiameter2: number, _specCode?: string, opts?: FindOptions): SpecFitting | null {
    const big = Math.max(nominalDiameter1, nominalDiameter2);
    const small = Math.min(nominalDiameter1, nominalDiameter2);
    return this.findBy('REDUCER', big, opts, { reducedNominalDiameter: small });
  }

  public findValve(nominalDiameter: number, _specCode?: string, opts?: FindOptions): SpecFitting | null {
    return this.findBy('VALVE', nominalDiameter, opts);
  }

  public findCap(nominalDiameter: number, _specCode?: string, opts?: FindOptions): SpecFitting | null {
    return this.findBy('CAP', nominalDiameter, opts);
  }

  /** Junta para una unión bridada; si la spec no tiene, una genérica marcada como tal */
  public findGasket(nominalDiameter: number, _specCode?: string, opts?: FindOptions): SpecFitting | null {
    const found = this.findBy('GASKET', nominalDiameter, opts);
    if (found) return found;
    const cls = opts?.pressureClass || '150';
    return {
      pnpid: 9000 + Math.round(nominalDiameter * 10),
      partType: 'GASKET',
      specCode: this.specName,
      shortDescription: `GASKET ${cls} LB ${this.catalog.sizeLabel(nominalDiameter)} (genérica: no está en la spec)`,
      nominalDiameter,
      outerDiameter: nominalDiameter * 25.4 * 1.4,
      wallThickness: 1.6,
      schedule: `${cls}#`,
      endType: 'FLANG',
      faceToFace: 1.6,
      gasketThicknessMm: 1.6,
      geometryConfidence: 'approximate'
    };
  }

  /** Juego de bulones para una unión bridada; genérico si la spec no lo trae */
  public findBoltSet(nominalDiameter: number, _specCode?: string, opts?: FindOptions): SpecFitting | null {
    const found = this.findBy('BOLT_SET', nominalDiameter, opts);
    if (found) {
      if (!found.boltCount) found.boltCount = nominalDiameter >= 4 ? 8 : 4;
      return found;
    }
    const count = nominalDiameter >= 10 ? 12 : nominalDiameter >= 4 ? 8 : 4;
    const size = nominalDiameter >= 8 ? '3/4"' : nominalDiameter >= 4 ? '5/8"' : '1/2"';
    return {
      pnpid: 9500 + Math.round(nominalDiameter * 10),
      partType: 'BOLT_SET',
      specCode: this.specName,
      shortDescription: `BOLT SET ${opts?.pressureClass || '150'} LB (${count}x ${size}, genérico: no está en la spec)`,
      nominalDiameter,
      outerDiameter: nominalDiameter * 25.4,
      wallThickness: 3,
      schedule: '150#',
      endType: 'FLANG',
      boltSize: size,
      boltCount: count,
      boltLengthMm: nominalDiameter >= 4 ? 90 : 70,
      geometryConfidence: 'approximate'
    };
  }

  /** Diámetros que tienen caño en la spec */
  public getAvailableNominalDiameters(_specCode?: string): number[] {
    return this.catalog.sizes();
  }

  public listFamilies(category: PartCategory, nominalDiameter: number): FamilyOption[] {
    return this.catalog.families(category, nominalDiameter);
  }

  public setPreferredFamily(category: PartCategory, familyId: string | null): void {
    this.catalog.setPreferredFamily(category, familyId);
  }

  /** Binario original de la spec (vacío para el catálogo demo) */
  public exportBinary(): Uint8Array {
    return this.sourceBuffer ?? new Uint8Array();
  }

  public close(): void {
    this.sourceBuffer = undefined;
  }
}
