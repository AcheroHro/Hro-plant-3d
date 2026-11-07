import type { Database, SqlValue } from 'sql.js';
import {
  CatalogPart,
  CatalogPort,
  PartCategory,
  SpecCatalogData,
  SPEC_CATALOG_FORMAT_VERSION
} from './catalogTypes';
import {
  lengthScaleFor,
  parseIsoSymbol,
  parseParamDefinition,
  parseSchedule,
  toInchNominal,
  wallThicknessFromSchedule
} from './units';

type Row = Record<string, SqlValue>;

/** Tablas hijas de Plant en orden de prioridad para decidir la categoría */
const CLASS_TABLES: [string, PartCategory][] = [
  ['BlindFlange', 'FLANGE_BLIND'],
  ['Elbow', 'ELBOW'],
  ['Tee', 'TEE'],
  ['Reducer', 'REDUCER'],
  ['Olet', 'OLET'],
  ['Cap', 'CAP'],
  ['Coupling', 'COUPLING'],
  ['Gasket', 'GASKET'],
  ['BoltSet', 'BOLT_SET'],
  ['Flange', 'FLANGE'],
  ['Valve', 'VALVE'],
  ['Pipe', 'PIPE'],
  ['ValveActuator', 'ACTUATOR']
];

const ISO_TYPE_CATEGORY: Record<string, PartCategory> = {
  PIPE: 'PIPE',
  'PIPE-FIXED': 'PIPE',
  ELBOW: 'ELBOW',
  BEND: 'ELBOW',
  TEE: 'TEE',
  'TEE-SET-ON': 'TEE',
  CROSS: 'CROSS',
  FLANGE: 'FLANGE',
  'FLANGE-BLIND': 'FLANGE_BLIND',
  VALVE: 'VALVE',
  'VALVE-3WAY': 'VALVE',
  'VALVE-ANGLE': 'VALVE',
  'VALVE-MULTIWAY': 'VALVE',
  'REDUCER-CONCENTRIC': 'REDUCER',
  'REDUCER-ECCENTRIC': 'REDUCER',
  CAP: 'CAP',
  OLET: 'OLET',
  COUPLING: 'COUPLING',
  UNION: 'COUPLING',
  GASKET: 'GASKET',
  BOLT: 'BOLT_SET',
  INSTRUMENT: 'INSTRUMENT',
  'INSTRUMENT-DIAL': 'INSTRUMENT',
  'INSTRUMENT-3WAY': 'INSTRUMENT',
  FILTER: 'INSTRUMENT',
  TRAP: 'INSTRUMENT',
  SUPPORT: 'SUPPORT',
  'LAPJOINT-STUB-END': 'MISC',
  'LAPJOINT-STUBEND': 'MISC',
  'MISC-COMPONENT': 'MISC',
  CLAMP: 'MISC'
};

function str(v: SqlValue | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Uint8Array) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function num(v: SqlValue | undefined): number | undefined {
  if (v === null || v === undefined || v instanceof Uint8Array) return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

/** Convierte un GUID binario de .NET (16 bytes, primeros 3 grupos little-endian) a texto */
export function guidFromBytes(v: SqlValue | undefined): string {
  if (v instanceof Uint8Array && v.length === 16) {
    const h = (i: number) => v[i].toString(16).padStart(2, '0');
    return (
      h(3) + h(2) + h(1) + h(0) + '-' + h(5) + h(4) + '-' + h(7) + h(6) + '-' + h(8) + h(9) + '-' +
      h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
    );
  }
  return str(v) ?? '';
}

function queryRows(db: Database, sql: string): Row[] {
  const out: Row[] = [];
  const stmt = db.prepare(sql);
  try {
    while (stmt.step()) out.push(stmt.getAsObject() as Row);
  } finally {
    stmt.free();
  }
  return out;
}

function tableColumns(db: Database, table: string): Set<string> {
  const cols = new Set<string>();
  for (const r of queryRows(db, `PRAGMA table_info("${table}")`)) cols.add(String(r.name));
  return cols;
}

/** true si la base tiene el esquema de piezas de Plant 3D */
export function isPlantPartsDatabase(db: Database): boolean {
  const tables = new Set(queryRows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => String(r.name)));
  return tables.has('EngineeringItems') && tables.has('PartPort') && tables.has('Port');
}

function readPort(r: Row, fallbackName: string): CatalogPort {
  const nominalUnit = str(r.NominalUnit) === 'mm' ? 'mm' : 'in';
  const scale = lengthScaleFor(str(r.LengthUnit) ?? str(r.NominalUnit));
  const nominalRaw = num(r.NominalDiameter) ?? 0;
  const nd = toInchNominal(nominalRaw, nominalUnit);
  const schedule = str(r.Schedule);
  const wt = num(r.WallThickness);
  const eng = num(r.EngagementLength);
  const ft = num(r.FlangeThickness);
  return {
    name: str(r.PortName) ?? str(r.Name) ?? fallbackName,
    nominalDiameter: nd,
    nominalRaw,
    nominalUnit,
    outerDiameterMm: (num(r.MatchingPipeOd) ?? 0) * scale,
    endType: str(r.EndType) ?? 'Undefined_ET',
    pressureClass: str(r.PressureClass),
    schedule,
    wallThicknessMm: wt !== undefined && wt > 0 ? wt * scale : undefined,
    engagementMm: eng !== undefined && eng > 0 ? eng * scale : undefined,
    flangeThicknessMm: ft !== undefined && ft > 0 ? ft * scale : undefined,
    facing: str(r.Facing)
  };
}

/**
 * Lee una spec (.pspc) o un catálogo (.pcat) de Plant 3D abierto con sql.js.
 * Trae todas las piezas con todos sus puertos, unidades pasadas a mm.
 */
export function readPlantPartsDatabase(db: Database, sourceFile: string): SpecCatalogData {
  const warnings: string[] = [];
  const tables = new Set(queryRows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => String(r.name)));

  let specName = sourceFile.replace(/\.[^/.]+$/, '');
  let description: string | undefined;
  let kind: 'spec' | 'catalog' = /\.pcat$/i.test(sourceFile) ? 'catalog' : 'spec';
  if (tables.has('RepositoryDescriptor')) {
    const repo = queryRows(db, 'SELECT * FROM RepositoryDescriptor LIMIT 1')[0];
    if (repo) {
      specName = str(repo.Name) ?? specName;
      description = str(repo.Description);
      const type = str(repo.Type) ?? '';
      if (/Catalog/i.test(type) && !/Specification/i.test(type)) kind = 'catalog';
      if (/Specification/i.test(type)) kind = 'spec';
    }
  }

  // Pertenencia a tablas hijas y sus datos propios
  const classOf = new Map<number, [string, PartCategory]>();
  const childData = new Map<string, Map<number, Row>>();
  for (const [table, cat] of CLASS_TABLES) {
    if (!tables.has(table)) continue;
    const rows = queryRows(db, `SELECT * FROM "${table}"`);
    const map = new Map<number, Row>();
    for (const r of rows) {
      const id = num(r.PnPID);
      if (id === undefined) continue;
      map.set(id, r);
      if (!classOf.has(id)) classOf.set(id, [table, cat]);
    }
    childData.set(table, map);
  }

  // Puertos adicionales (S2, S3...)
  const extraPorts = new Map<number, CatalogPort[]>();
  if (tables.has('PartPort') && tables.has('Port')) {
    const portCols = tableColumns(db, 'Port');
    const sel = ['PortName', 'NominalDiameter', 'NominalUnit', 'MatchingPipeOd', 'EndType', 'PressureClass', 'Schedule', 'WallThickness', 'EngagementLength', 'LengthUnit', 'FlangeThickness', 'Facing']
      .filter((c) => portCols.has(c))
      .map((c) => `p."${c}"`)
      .join(', ');
    for (const r of queryRows(db, `SELECT pp.Part AS PartId, pp.Name AS Name, ${sel} FROM PartPort pp JOIN Port p ON p.PnPID = pp.Port ORDER BY pp.Part, pp.Name`)) {
      const partId = num(r.PartId);
      if (partId === undefined) continue;
      const list = extraPorts.get(partId) ?? [];
      list.push(readPort(r, `S${list.length + 2}`));
      extraPorts.set(partId, list);
    }
  }

  const parts: CatalogPart[] = [];
  let missingTemplate = 0;
  for (const r of queryRows(db, 'SELECT * FROM EngineeringItems')) {
    const pnpid = num(r.PnPID);
    if (pnpid === undefined) continue;

    const iso = parseIsoSymbol(str(r.ContentIsoSymbolDefinition));
    const template = str(r.ContentGeometryTemplate);
    const cls = classOf.get(pnpid);
    let category: PartCategory | undefined = iso.type ? ISO_TYPE_CATEGORY[iso.type] : undefined;
    if (template && /^CPVX/i.test(template)) category = 'ACTUATOR';
    if (!category) category = cls?.[1];
    if (!category) category = 'MISC';
    // Una brida ciega también está en la tabla Flange en algunos catálogos
    if (cls?.[0] === 'BlindFlange') category = 'FLANGE_BLIND';

    const lengthScale = lengthScaleFor(str(r.LengthUnit) ?? str(r.NominalUnit));
    const s1 = readPort(r, 'S1');
    const ports: CatalogPort[] = [];
    if (s1.nominalRaw > 0 || category !== 'ACTUATOR') ports.push(s1);
    for (const extra of extraPorts.get(pnpid) ?? []) {
      if (!ports.some((pp) => pp.name === extra.name)) ports.push(extra);
    }
    const portCount = num(r.ConnectionPortCount) ?? ports.length;
    while (ports.length < portCount && ports.length > 0) {
      ports.push({ ...ports[0], name: `S${ports.length + 1}` });
    }

    const familyDesc = str(r.PartFamilyLongDesc) ?? str(r.ShortDescription) ?? `Pieza ${pnpid}`;
    const sizeDesc = str(r.PartSizeLongDesc) ?? familyDesc;
    const schedule = str(r.Schedule) ?? parseSchedule(sizeDesc) ?? parseSchedule(familyDesc);
    let wallThicknessMm = s1.wallThicknessMm;
    if (wallThicknessMm === undefined && (category === 'PIPE' || /BW|B16\.9|B36\.10/i.test(familyDesc))) {
      wallThicknessMm = wallThicknessFromSchedule(s1.nominalDiameter, schedule);
    }

    const extra: CatalogPart['extra'] = {};
    const el = childData.get('Elbow')?.get(pnpid);
    if (el) {
      extra.angleDeg = num(el.PathAngle);
      const cr = num(el.CurveRadius);
      if (cr !== undefined && cr > 0) extra.curveRadiusMm = cr * lengthScale;
    }
    for (const t of ['Valve', 'Reducer', 'Pipe']) {
      const row = childData.get(t)?.get(pnpid);
      const len = row ? num(row.Length) : undefined;
      if (len !== undefined && len > 0) extra.lengthMm = len * lengthScale;
      if (row && t === 'Reducer') extra.eccentricity = str(row.Eccentricity);
      if (row && t === 'Valve') extra.valveActuator = str(row.ActuatorFamilyName);
    }
    const bolt = childData.get('BoltSet')?.get(pnpid);
    if (bolt) {
      extra.boltSize = str(bolt.BoltSize);
      extra.boltCount = num(bolt.NumberInSet);
      const bl = num(bolt.Length);
      if (bl !== undefined) extra.boltLengthMm = bl * lengthScale;
      extra.studDescription = [str(bolt.StudTypeDescription), str(bolt.StudDescription)].filter(Boolean).join(' ');
    }

    if (!template && category !== 'BOLT_SET' && category !== 'ACTUATOR') missingTemplate++;

    parts.push({
      pnpid,
      category,
      plantClass: cls?.[0] ?? iso.type ?? 'Unknown',
      familyId: guidFromBytes(r.PartFamilyId),
      familyDesc,
      sizeDesc,
      shortDesc: str(r.ShortDescription) ?? familyDesc,
      itemCode: str(r.ItemCode) ?? '',
      material: str(r.Material),
      pressureClass: str(r.PressureClass),
      schedule,
      wallThicknessMm,
      isoType: iso.type,
      skey: iso.skey,
      template,
      params: parseParamDefinition(str(r.ContentGeometryParamDefinition)),
      lengthScale,
      ports,
      extra
    });
  }

  if (missingTemplate > 0) {
    warnings.push(`${missingTemplate} piezas sin plantilla de geometría: se dibujan aproximadas.`);
  }
  if (!parts.some((pp) => pp.category === 'PIPE') && kind === 'spec') {
    warnings.push('La spec no tiene caños: no se puede rutear con ella.');
  }

  return {
    formatVersion: SPEC_CATALOG_FORMAT_VERSION,
    specName,
    sourceFile,
    isNative: true,
    kind,
    description,
    parts,
    warnings
  };
}
