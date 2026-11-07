/**
 * Modelo de datos de una spec o catálogo de AutoCAD Plant 3D tal como lo guarda Plant
 * (.pspc / .pcat = SQLite, .pspx = zip con preferencias), normalizado a milímetros.
 *
 * Es JSON plano a propósito: se arma en un Web Worker, se guarda en IndexedDB y
 * el hilo principal lo consulta sin SQLite.
 */

/** Categoría de pieza, derivada de la tabla de Plant y del TYPE de ContentIsoSymbolDefinition */
export type PartCategory =
  | 'PIPE'
  | 'ELBOW'
  | 'TEE'
  | 'CROSS'
  | 'FLANGE'
  | 'FLANGE_BLIND'
  | 'VALVE'
  | 'REDUCER'
  | 'CAP'
  | 'OLET'
  | 'COUPLING'
  | 'GASKET'
  | 'BOLT_SET'
  | 'INSTRUMENT'
  | 'SUPPORT'
  | 'ACTUATOR'
  | 'MISC';

/** Puerto de conexión tal como figura en las tablas Port / EngineeringItems de Plant */
export interface CatalogPort {
  /** Nombre del puerto en Plant (S1, S2, S3...) */
  name: string;
  /** Diámetro nominal canónico en pulgadas (DN se convierte con la tabla estándar) */
  nominalDiameter: number;
  /** Valor nominal tal como lo guarda Plant (2 para 2", 50 para DN50) */
  nominalRaw: number;
  /** Unidad nominal de Plant ('in' o 'mm') */
  nominalUnit: 'in' | 'mm';
  /** Diámetro exterior del caño que acopla, en mm */
  outerDiameterMm: number;
  /** Tipo de extremo de Plant sin traducir: BV, PL, FL, SW, THDF, THDM, SO, WF, LUG, PPL, PSW... */
  endType: string;
  pressureClass?: string;
  schedule?: string;
  wallThicknessMm?: number;
  /** Largo de encastre (socket / rosca) en mm */
  engagementMm?: number;
  flangeThicknessMm?: number;
  facing?: string;
}

/** Datos propios de cada tabla hija de Plant (Elbow, Valve, BoltSet...) */
export interface CatalogPartExtra {
  angleDeg?: number;
  curveRadiusMm?: number;
  lengthMm?: number;
  eccentricity?: string;
  boltSize?: string;
  boltCount?: number;
  boltLengthMm?: number;
  studDescription?: string;
  valveActuator?: string;
  boltCircleMm?: number;
  boltHoles?: number;
}

/** Una pieza de la spec (una fila de EngineeringItems con sus puertos) */
export interface CatalogPart {
  pnpid: number;
  category: PartCategory;
  /** Tabla de Plant donde está la pieza (Pipe, Elbow, Tee, Flange, BlindFlange, Valve...) */
  plantClass: string;
  familyId: string;
  /** PartFamilyLongDesc: "ELL 90 LR, BW, ASME B16.9" */
  familyDesc: string;
  /** PartSizeLongDesc: descripción completa con tamaño */
  sizeDesc: string;
  shortDesc: string;
  itemCode: string;
  material?: string;
  pressureClass?: string;
  schedule?: string;
  wallThicknessMm?: number;
  /** TYPE de ContentIsoSymbolDefinition (ELBOW, TEE, FLANGE-BLIND, OLET...) */
  isoType?: string;
  /** SKEY de Isogen (ELBW, FLSO, VBFL...) */
  skey?: string;
  /** ContentGeometryTemplate: script paramétrico de Plant (CPB, CPFWR_F_SF, CPVI001000...) */
  template?: string;
  /** ContentGeometryParamDefinition tal como viene, en la unidad de largo de la pieza */
  params: Record<string, number>;
  /** Factor para pasar params a mm (25.4 si LengthUnit = in) */
  lengthScale: number;
  /** Puertos ordenados S1, S2, S3... */
  ports: CatalogPort[];
  extra: CatalogPartExtra;
}

/** Prioridad de uso de familias de Plant (content/PartUsePriorities.xml del .pspx) */
export interface PartUsePriority {
  /** Tipo de pieza de Plant: Elbow, Tee, Reducer, Gasket, Flange, Valve... */
  partType: string;
  nominalDiameter: number;
  familyIds: string[];
}

/** Tabla de ramales del .pspx (content/branchtable.xml) */
export interface BranchSymbolDef {
  name: string;
  description: string;
  parts: { partType: string; familyId: string; familyName: string }[];
}

export interface BranchTableEntry {
  headerNd: number;
  branchNd: number;
  symbols: string[];
}

export interface SpecPreferences {
  priorities: PartUsePriority[];
  branchSymbols: BranchSymbolDef[];
  branchTable: BranchTableEntry[];
}

/** Resultado completo de leer una spec */
export interface SpecCatalogData {
  formatVersion: number;
  specName: string;
  sourceFile: string;
  /** true si vino de un archivo de Plant; false para el catálogo demo integrado */
  isNative: boolean;
  /** 'spec' (.pspc) o 'catalog' (.pcat) */
  kind: 'spec' | 'catalog';
  description?: string;
  parts: CatalogPart[];
  preferences?: SpecPreferences;
  /** Avisos de lectura (unidades raras, piezas sin geometría, etc.) */
  warnings: string[];
}

export const SPEC_CATALOG_FORMAT_VERSION = 2;
