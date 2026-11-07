import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { FittingQueryCriteria, SpecFitting, ComponentType, EndType } from '../../types/piping';
import { CS150_SPEC_DATA } from './defaultSpecData';

let SQL_PROMISE: Promise<SqlJsStatic> | null = null;

export async function getSqlInstance(): Promise<SqlJsStatic> {
  if (!SQL_PROMISE) {
    SQL_PROMISE = initSqlJs({
      locateFile: (file: string) => {
        if (typeof window === 'undefined') {
          return `node_modules/sql.js/dist/${file}`;
        }
        return `/${file}`;
      }
    });
  }
  return SQL_PROMISE;
}

/**
 * Parsea la cadena ContentGeometryParamDefinition de AutoCAD Plant 3D
 * Ejemplo: "D=2.375,D2=0,R=2.41,A=45,OF=-1,L1=1.62,I1=0.62,L2=1.62,I2=0.62"
 */
function parseParamDefinition(defString?: string | null): Record<string, number> {
  const result: Record<string, number> = {};
  if (!defString) return result;
  const parts = defString.split(',');
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k && v !== undefined) {
      const num = parseFloat(v);
      if (!isNaN(num)) {
        result[k.trim()] = num;
      }
    }
  }
  return result;
}

/**
 * Lector y gestor de especificaciones de AutoCAD Plant 3D (.pspc / SQLite).
 * Soporta de forma nativa tanto el formato oficial de AutoCAD Plant 3D
 * como el esquema relacional simplificado.
 */
export class SpecDatabaseReader {
  private db: Database;
  public isNativePlant3D: boolean = false;
  public specName: string = 'CS150';

  constructor(db: Database) {
    this.db = db;
    this.checkIfNative();
  }

  private checkIfNative(): void {
    try {
      const res = this.db.exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='PartPort';");
      this.isNativePlant3D = (res[0]?.values[0]?.[0] as number) > 0;
      if (this.isNativePlant3D) {
        const repo = this.db.exec("SELECT Name FROM RepositoryDescriptor LIMIT 1;");
        if (repo[0]?.values[0]?.[0]) {
          this.specName = String(repo[0].values[0][0]);
        }
      }
    } catch {
      this.isNativePlant3D = false;
    }
  }

  private static isValidSqliteBuffer(buf: ArrayBuffer): boolean {
    if (buf.byteLength < 100) return false;
    const header = new Uint8Array(buf, 0, 15);
    const magic = String.fromCharCode(...header);
    return magic.startsWith('SQLite format 3');
  }

  /**
   * Crea una nueva instancia de SpecDatabaseReader cargando un buffer binario .pspc
   * o sembrando el catálogo predeterminado CS150 en memoria.
   */
  public static async create(buffer?: ArrayBuffer | Uint8Array): Promise<SpecDatabaseReader> {
    const SQL = await getSqlInstance();
    let db: Database;
    if (buffer) {
      const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      db = new SQL.Database(u8);
    } else {
      // Intentar cargar RCI1.pspc si existe en el entorno web o local
      let loaded = false;
      if (typeof window !== 'undefined') {
        try {
          const resp = await fetch('/RCI1.pspc');
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            if (SpecDatabaseReader.isValidSqliteBuffer(buf)) {
              db = new SQL.Database(new Uint8Array(buf));
              loaded = true;
            }
          }
        } catch {
          // continuar con fallback
        }
      }

      if (!loaded) {
        return SpecDatabaseReader.createDefault('CS150');
      }
    }
    const reader = new SpecDatabaseReader(db!);
    return reader;
  }

  /**
   * Crea una instancia en memoria con el catálogo ASME B31.3 / B16.9 / B16.5 para la spec indicada
   */
  public static async createDefault(specName: string = 'CS150'): Promise<SpecDatabaseReader> {
    const SQL = await getSqlInstance();
    const db = new SQL.Database();
    const reader = new SpecDatabaseReader(db);
    reader.specName = specName;
    reader.initializeSchema();
    reader.seedDefaultData(specName);
    return reader;
  }

  /**
   * Crea una instancia a partir de un buffer binario explícito (.pspc)
   */
  public static async fromBuffer(buffer: ArrayBuffer | Uint8Array, specName?: string): Promise<SpecDatabaseReader> {
    const rawBuf = buffer instanceof Uint8Array ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer;
    if (!SpecDatabaseReader.isValidSqliteBuffer(rawBuf as ArrayBuffer)) {
      return SpecDatabaseReader.createDefault(specName || 'CS150');
    }
    const reader = await SpecDatabaseReader.create(buffer);
    if (specName) {
      reader.specName = specName;
    }
    return reader;
  }

  /**
   * Inicializa el esquema de tablas estándar de AutoCAD Plant 3D (para modo simulado/custom)
   */
  public initializeSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS EngineeringItems (
        PnPID INTEGER PRIMARY KEY,
        PartType TEXT NOT NULL,
        SpecCode TEXT NOT NULL,
        ShortDescription TEXT,
        CatalogId TEXT,
        PartFamily TEXT
      );

      CREATE TABLE IF NOT EXISTS PipePortProperties (
        PnPID INTEGER NOT NULL,
        PortIndex INTEGER NOT NULL,
        NominalDiameter REAL NOT NULL,
        MatchingPipeOD REAL NOT NULL,
        FlangeOuterDiameter REAL,
        WallThickness REAL NOT NULL,
        Schedule TEXT,
        EndType TEXT NOT NULL,
        PressureClass TEXT,
        PRIMARY KEY (PnPID, PortIndex),
        FOREIGN KEY (PnPID) REFERENCES EngineeringItems(PnPID)
      );

      CREATE TABLE IF NOT EXISTS ComponentDimension (
        PnPID INTEGER PRIMARY KEY,
        DesignLength REAL,
        Length REAL,
        TakeOff1 REAL,
        TakeOff2 REAL,
        Angle REAL,
        Radius REAL,
        RunTakeOff REAL,
        BranchTakeOff REAL,
        FaceToFace REAL,
        BoltCircle REAL,
        BoltHoles INTEGER,
        ReducedNominalDiameter REAL,
        ReducedOuterDiameter REAL,
        FOREIGN KEY (PnPID) REFERENCES EngineeringItems(PnPID)
      );
    `);
  }

  /**
   * Siembra en la base de datos el catálogo industrial CS150 (o adaptado a targetSpecCode)
   */
  public seedDefaultData(targetSpecCode: string = 'CS150'): void {
    const insertItem = this.db.prepare(`
      INSERT OR REPLACE INTO EngineeringItems (PnPID, PartType, SpecCode, ShortDescription, CatalogId)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertPort = this.db.prepare(`
      INSERT OR REPLACE INTO PipePortProperties (PnPID, PortIndex, NominalDiameter, MatchingPipeOD, FlangeOuterDiameter, WallThickness, Schedule, EndType, PressureClass)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertDim = this.db.prepare(`
      INSERT OR REPLACE INTO ComponentDimension (PnPID, DesignLength, Length, TakeOff1, TakeOff2, Angle, Radius, RunTakeOff, BranchTakeOff, FaceToFace, BoltCircle, BoltHoles, ReducedNominalDiameter, ReducedOuterDiameter)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const record of CS150_SPEC_DATA) {
      insertItem.run([
        record.pnpid,
        record.partType,
        targetSpecCode || record.specCode,
        record.shortDescription,
        record.catalogId
      ]);

      for (const p of record.ports) {
        insertPort.run([
          record.pnpid,
          p.portIndex,
          p.nominalDiameter,
          p.matchingPipeOD,
          p.flangeOuterDiameter ?? null,
          p.wallThickness,
          p.schedule,
          p.endType,
          p.pressureClass
        ]);
      }

      insertDim.run([
        record.pnpid,
        record.dimensions.designLength ?? null,
        record.dimensions.length ?? null,
        record.dimensions.takeOff1 ?? null,
        record.dimensions.takeOff2 ?? null,
        record.dimensions.angle ?? null,
        record.dimensions.radius ?? null,
        record.dimensions.runTakeOff ?? null,
        record.dimensions.branchTakeOff ?? null,
        record.dimensions.faceToFace ?? null,
        record.dimensions.boltCircle ?? null,
        record.dimensions.boltHoles ?? null,
        record.dimensions.reducedNominalDiameter ?? null,
        record.dimensions.reducedOuterDiameter ?? null
      ]);
    }

    insertItem.free();
    insertPort.free();
    insertDim.free();
  }

  /**
   * Localiza un accesorio o cañería según criterios dados
   */
  public findFitting(criteria: FittingQueryCriteria): SpecFitting | null {
    if (this.isNativePlant3D) {
      return this.findFittingNative(criteria);
    }
    return this.findFittingSimulated(criteria);
  }

  /**
   * Implementación de consulta para base de datos nativa oficial de AutoCAD Plant 3D (.pspc)
   */
  private findFittingNative(criteria: FittingQueryCriteria): SpecFitting | null {
    const partTypeUpper = criteria.partType.toUpperCase();
    const nd = criteria.nominalDiameter;

    if (partTypeUpper === 'PIPE') {
      const q = `
        SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
               e.Schedule, e.WallThickness, e.ContentGeometryParamDefinition, e.EndType
        FROM EngineeringItems e
        JOIN Pipe p ON e.PnPID = p.PnPID
        WHERE ABS(e.NominalDiameter - ?) < 0.01
        LIMIT 1;
      `;
      const stmt = this.db.prepare(q);
      stmt.bind([nd]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        const isInch = row.NominalUnit === 'in' || !row.NominalUnit;
        const scale = isInch ? 25.4 : 1.0;
        const odMm = Number(row.MatchingPipeOd) * scale;
        const params = parseParamDefinition(row.ContentGeometryParamDefinition as string);
        const wtMm = row.WallThickness ? Number(row.WallThickness) * scale : (params.THK ? params.THK * scale : Math.max(2.5, odMm * 0.065));

        return {
          pnpid: Number(row.PnPID),
          partType: 'PIPE',
          specCode: this.specName,
          shortDescription: String(row.ShortDescription || `Cañería ${nd}"`),
          nominalDiameter: nd,
          outerDiameter: odMm,
          wallThickness: wtMm,
          schedule: String(row.Schedule || '40'),
          endType: (row.EndType as EndType) || 'BUTTWELD'
        };
      }
      stmt.free();
      return null;
    }

    if (partTypeUpper === 'ELBOW') {
      const angleTarget = criteria.angle !== undefined ? criteria.angle : 90;
      const q = `
        SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
               e.Schedule, e.WallThickness, e.ContentGeometryParamDefinition, e.EndType,
               elb.PathAngle, elb.CurveRadius
        FROM EngineeringItems e
        JOIN Elbow elb ON e.PnPID = elb.PnPID
        WHERE ABS(e.NominalDiameter - ?) < 0.01
          AND ABS(elb.PathAngle - ?) < 5
        ORDER BY CASE WHEN elb.CurveRadius > 0 THEN 0 ELSE 1 END, elb.PnPID ASC
        LIMIT 1;
      `;
      const stmt = this.db.prepare(q);
      stmt.bind([nd, angleTarget]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        const isInch = row.NominalUnit === 'in' || !row.NominalUnit;
        const scale = isInch ? 25.4 : 1.0;
        const odMm = Number(row.MatchingPipeOd) * scale;
        const params = parseParamDefinition(row.ContentGeometryParamDefinition as string);
        const wtMm = row.WallThickness ? Number(row.WallThickness) * scale : Math.max(2.5, odMm * 0.065);
        const angleDeg = Number(row.PathAngle || angleTarget);
        
        // Calcular takeOff en mm:
        // Si hay R o CurveRadius, takeOff = R * tan(angle / 2)
        // O si hay L1 en params
        let radiusMm = 0;
        let takeOffMm = 0;

        if (row.CurveRadius && Number(row.CurveRadius) > 0) {
          radiusMm = Number(row.CurveRadius) * scale;
          takeOffMm = radiusMm * Math.tan((angleDeg * Math.PI) / 360);
        } else if (params.R && params.R > 0) {
          radiusMm = params.R * scale;
          takeOffMm = radiusMm * Math.tan((angleDeg * Math.PI) / 360);
        } else if (params.L1) {
          takeOffMm = params.L1 * scale;
          radiusMm = takeOffMm / Math.tan((angleDeg * Math.PI) / 360);
        } else {
          // Radio largo estándar ASME B16.9: R = 1.5 * ND
          radiusMm = nd * 1.5 * 25.4;
          takeOffMm = radiusMm * Math.tan((angleDeg * Math.PI) / 360);
        }

        return {
          pnpid: Number(row.PnPID),
          partType: 'ELBOW',
          specCode: this.specName,
          shortDescription: String(row.ShortDescription || `Codo ${angleDeg}° ND ${nd}"`),
          nominalDiameter: nd,
          outerDiameter: odMm,
          wallThickness: wtMm,
          schedule: String(row.Schedule || '40'),
          endType: (row.EndType as EndType) || 'BUTTWELD',
          angle: angleDeg,
          radius: radiusMm,
          takeOff: takeOffMm
        };
      }
      stmt.free();
      return null;
    }

    if (partTypeUpper === 'TEE') {
      const q = `
        SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
               e.Schedule, e.WallThickness, e.ContentGeometryParamDefinition, e.EndType
        FROM EngineeringItems e
        JOIN Tee t ON e.PnPID = t.PnPID
        WHERE ABS(e.NominalDiameter - ?) < 0.01
        LIMIT 1;
      `;
      const stmt = this.db.prepare(q);
      stmt.bind([nd]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        const isInch = row.NominalUnit === 'in' || !row.NominalUnit;
        const scale = isInch ? 25.4 : 1.0;
        const odMm = Number(row.MatchingPipeOd) * scale;
        const params = parseParamDefinition(row.ContentGeometryParamDefinition as string);
        const runTakeOffMm = (params.L1 || params.L || nd * 1.5) * scale;
        const branchTakeOffMm = (params.L3 || params.L2 || runTakeOffMm / scale) * scale;

        return {
          pnpid: Number(row.PnPID),
          partType: 'TEE',
          specCode: this.specName,
          shortDescription: String(row.ShortDescription || `Te ND ${nd}"`),
          nominalDiameter: nd,
          outerDiameter: odMm,
          wallThickness: Math.max(2.5, odMm * 0.065),
          schedule: String(row.Schedule || '40'),
          endType: (row.EndType as EndType) || 'BUTTWELD',
          runTakeOff: runTakeOffMm,
          branchTakeOff: branchTakeOffMm
        };
      }
      stmt.free();
      return null;
    }

    if (partTypeUpper === 'FLANGE') {
      const q = `
        SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
               e.Schedule, e.WallThickness, e.ContentGeometryParamDefinition, e.EndType
        FROM EngineeringItems e
        JOIN Flange f ON e.PnPID = f.PnPID
        WHERE ABS(e.NominalDiameter - ?) < 0.01
        LIMIT 1;
      `;
      const stmt = this.db.prepare(q);
      stmt.bind([nd]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        const isInch = row.NominalUnit === 'in' || !row.NominalUnit;
        const scale = isInch ? 25.4 : 1.0;
        const odMm = Number(row.MatchingPipeOd) * scale;
        const params = parseParamDefinition(row.ContentGeometryParamDefinition as string);
        const faceToFaceMm = (params.L || 2.5) * scale;

        return {
          pnpid: Number(row.PnPID),
          partType: 'FLANGE',
          specCode: this.specName,
          shortDescription: String(row.ShortDescription || `Brida ND ${nd}"`),
          nominalDiameter: nd,
          outerDiameter: odMm,
          wallThickness: Math.max(3.0, odMm * 0.08),
          schedule: String(row.Schedule || '150#'),
          endType: (row.EndType as EndType) || 'FLANG',
          faceToFace: faceToFaceMm,
          boltCircle: odMm * 1.3,
          boltHoles: nd >= 4 ? 8 : 4
        };
      }
      stmt.free();
      return null;
    }

    if (partTypeUpper === 'REDUCER') {
      const q = `
        SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
               e.Schedule, e.WallThickness, e.ContentGeometryParamDefinition, e.EndType, r.Length
        FROM EngineeringItems e
        JOIN Reducer r ON e.PnPID = r.PnPID
        WHERE ABS(e.NominalDiameter - ?) < 0.01
        LIMIT 1;
      `;
      const stmt = this.db.prepare(q);
      stmt.bind([nd]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        const isInch = row.NominalUnit === 'in' || !row.NominalUnit;
        const scale = isInch ? 25.4 : 1.0;
        const odMm = Number(row.MatchingPipeOd) * scale;
        const params = parseParamDefinition(row.ContentGeometryParamDefinition as string);
        const lengthMm = (row.Length ? Number(row.Length) : (params.L || 3.5)) * scale;

        return {
          pnpid: Number(row.PnPID),
          partType: 'REDUCER',
          specCode: this.specName,
          shortDescription: String(row.ShortDescription || `Reducción Concéntrica ND ${nd}"`),
          nominalDiameter: nd,
          outerDiameter: odMm,
          wallThickness: Math.max(2.5, odMm * 0.065),
          schedule: String(row.Schedule || '40'),
          endType: (row.EndType as EndType) || 'BUTTWELD',
          faceToFace: lengthMm,
          reducedNominalDiameter: criteria.reducedNominalDiameter,
          reducedOuterDiameter: criteria.reducedNominalDiameter ? criteria.reducedNominalDiameter * 25.4 : odMm * 0.7
        };
      }
      stmt.free();
      return null;
    }

    if (partTypeUpper === 'VALVE') {
      const q = `
        SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
               e.Schedule, e.WallThickness, e.ContentGeometryParamDefinition, e.EndType, v.Length
        FROM EngineeringItems e
        JOIN Valve v ON e.PnPID = v.PnPID
        WHERE ABS(e.NominalDiameter - ?) < 0.01
        LIMIT 1;
      `;
      const stmt = this.db.prepare(q);
      stmt.bind([nd]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        const isInch = row.NominalUnit === 'in' || !row.NominalUnit;
        const scale = isInch ? 25.4 : 1.0;
        const odMm = Number(row.MatchingPipeOd) * scale;
        const params = parseParamDefinition(row.ContentGeometryParamDefinition as string);
        const lengthMm = (row.Length ? Number(row.Length) : (params.L || nd * 3.5)) * scale;

        return {
          pnpid: Number(row.PnPID),
          partType: 'VALVE',
          specCode: this.specName,
          shortDescription: String(row.ShortDescription || `Válvula ND ${nd}"`),
          nominalDiameter: nd,
          outerDiameter: odMm,
          wallThickness: Math.max(3.0, odMm * 0.08),
          schedule: String(row.Schedule || '150#'),
          endType: (row.EndType as EndType) || 'FLANG',
          faceToFace: lengthMm,
          boltCircle: odMm * 1.3,
          boltHoles: nd >= 4 ? 8 : 4
        };
      }
      stmt.free();
      return null;
    }

    if (partTypeUpper === 'CAP') {
      const q = `
        SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
               e.Schedule, e.WallThickness, e.ContentGeometryParamDefinition, e.EndType
        FROM EngineeringItems e
        JOIN Cap c ON e.PnPID = c.PnPID
        WHERE ABS(e.NominalDiameter - ?) < 0.01
        LIMIT 1;
      `;
      const stmt = this.db.prepare(q);
      stmt.bind([nd]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        const isInch = row.NominalUnit === 'in' || !row.NominalUnit;
        const scale = isInch ? 25.4 : 1.0;
        const odMm = Number(row.MatchingPipeOd) * scale;
        const params = parseParamDefinition(row.ContentGeometryParamDefinition as string);
        const lengthMm = (params.L || params.H || nd * 0.75) * scale;

        return {
          pnpid: Number(row.PnPID),
          partType: 'CAP',
          specCode: this.specName,
          shortDescription: String(row.ShortDescription || `Tapa / Casquete ND ${nd}"`),
          nominalDiameter: nd,
          outerDiameter: odMm,
          wallThickness: Math.max(2.5, odMm * 0.065),
          schedule: String(row.Schedule || '40'),
          endType: (row.EndType as EndType) || 'BW',
          faceToFace: lengthMm
        };
      }
      stmt.free();
      return null;
    }

    if (partTypeUpper === 'GASKET') {
      const q = `
        SELECT e.PnPID, e.ShortDescription, e.PartFamilyLongDesc, e.NominalDiameter, e.NominalUnit,
               e.PressureClass, e.ContentGeometryParamDefinition
        FROM EngineeringItems e
        JOIN Gasket g ON e.PnPID = g.PnPID
        WHERE ABS(e.NominalDiameter - ?) < 0.01
        LIMIT 1;
      `;
      try {
        const stmt = this.db.prepare(q);
        stmt.bind([nd]);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          const isInch = row.NominalUnit === 'in' || !row.NominalUnit;
          const scale = isInch ? 25.4 : 1.0;
          const params = parseParamDefinition(row.ContentGeometryParamDefinition as string);
          const thkMm = (params.L || 0.0625) * scale;
          const odMm = (params.D1 || nd * 1.5) * scale;
          const desc = String(row.PartFamilyLongDesc || row.ShortDescription || `GASKET ${row.PressureClass || '150'} LB ND ${nd}"`);

          return {
            pnpid: Number(row.PnPID),
            partType: 'GASKET',
            specCode: this.specName,
            shortDescription: desc,
            nominalDiameter: nd,
            outerDiameter: odMm,
            wallThickness: thkMm,
            schedule: String(row.PressureClass ? `${row.PressureClass}#` : '150#'),
            endType: 'FLANG',
            faceToFace: thkMm,
            gasketThicknessMm: thkMm
          };
        }
        stmt.free();
      } catch {
        // Fallback si no existe tabla Gasket
      }
      return {
        pnpid: 9000 + Math.round(nd * 10),
        partType: 'GASKET',
        specCode: this.specName,
        shortDescription: `GASKET, 150 LB, CS/PTFE ASME B16.21 ND ${nd}"`,
        nominalDiameter: nd,
        outerDiameter: nd * 25.4 * 1.4,
        wallThickness: 1.59,
        schedule: '150#',
        endType: 'FLANG',
        faceToFace: 1.59,
        gasketThicknessMm: 1.59
      };
    }

    if (partTypeUpper === 'BOLT_SET') {
      const q = `
        SELECT e.PnPID, e.ShortDescription, e.PartFamilyLongDesc, e.NominalDiameter, e.NominalUnit,
               e.PressureClass, b.BoltSize, b.NumberInSet, b.Length, b.StudTypeDescription, b.StudDescription
        FROM EngineeringItems e
        JOIN BoltSet b ON e.PnPID = b.PnPID
        WHERE ABS(e.NominalDiameter - ?) < 0.01
        LIMIT 1;
      `;
      try {
        const stmt = this.db.prepare(q);
        stmt.bind([nd]);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          const isInch = row.NominalUnit === 'in' || !row.NominalUnit;
          const scale = isInch ? 25.4 : 1.0;
          const boltSize = String(row.BoltSize || (nd >= 4 ? '5/8"' : '1/2"'));
          const boltCount = Math.max(4, Math.round(Number(row.NumberInSet || (nd >= 4 ? 8 : 4))));
          const boltLenIn = Number(row.Length || 2.5);
          const boltLenMm = boltLenIn * scale;
          const studMat = String(row.StudDescription || 'ASTM A193 B7 / A194 2H');
          const familyDesc = String(row.PartFamilyLongDesc || 'BOLT SET, RF, 150 LB');
          const desc = `${familyDesc} (${boltCount}x ${boltSize} L=${boltLenMm.toFixed(0)}mm ${studMat})`;

          return {
            pnpid: Number(row.PnPID),
            partType: 'BOLT_SET',
            specCode: this.specName,
            shortDescription: desc,
            nominalDiameter: nd,
            outerDiameter: nd * 25.4,
            wallThickness: 3.0,
            schedule: String(row.PressureClass ? `${row.PressureClass}#` : '150#'),
            endType: 'FLANG',
            boltSize,
            boltCount,
            boltLengthMm: boltLenMm
          };
        }
        stmt.free();
      } catch {
        // Fallback si no existe tabla BoltSet
      }
      const fallbackCount = nd >= 4 ? 8 : 4;
      const fallbackSize = nd >= 4 ? '5/8"' : '1/2"';
      return {
        pnpid: 9500 + Math.round(nd * 10),
        partType: 'BOLT_SET',
        specCode: this.specName,
        shortDescription: `BOLT SET, RF, 150 LB (${fallbackCount}x ${fallbackSize} Stud Bolt ASTM A193 B7)`,
        nominalDiameter: nd,
        outerDiameter: nd * 25.4,
        wallThickness: 3.0,
        schedule: '150#',
        endType: 'FLANG',
        boltSize: fallbackSize,
        boltCount: fallbackCount,
        boltLengthMm: 70
      };
    }

    return null;
  }

  /**
   * Consulta sobre catálogo simulado / esquema CS150
   */
  private findFittingSimulated(criteria: FittingQueryCriteria): SpecFitting | null {
    const specCode = criteria.specCode || 'CS150';
    const partUpper = criteria.partType.toUpperCase();
    const nd = criteria.nominalDiameter;

    if (partUpper === 'GASKET') {
      return {
        pnpid: 9000 + Math.round(nd * 10),
        partType: 'GASKET',
        specCode,
        shortDescription: `Junta Espirometálica 150# CS/PTFE ASME B16.20 ND ${nd}"`,
        nominalDiameter: nd,
        outerDiameter: nd * 25.4 * 1.4,
        wallThickness: 1.59,
        schedule: '150#',
        endType: 'FLANG',
        faceToFace: 1.59,
        gasketThicknessMm: 1.59
      };
    }

    if (partUpper === 'BOLT_SET') {
      const boltCount = nd >= 10 ? 12 : nd >= 4 ? 8 : 4;
      const boltSize = nd >= 8 ? '3/4"' : nd >= 4 ? '5/8"' : '1/2"';
      const boltLengthMm = nd >= 4 ? 90 : 70;
      return {
        pnpid: 9500 + Math.round(nd * 10),
        partType: 'BOLT_SET',
        specCode,
        shortDescription: `Juego Espárragos RF 150# (${boltCount}x ${boltSize} L=${boltLengthMm}mm ASTM A193 B7)`,
        nominalDiameter: nd,
        outerDiameter: nd * 25.4,
        wallThickness: 3.0,
        schedule: '150#',
        endType: 'FLANG',
        boltSize,
        boltCount,
        boltLengthMm
      };
    }

    let query = `
      SELECT 
        e.PnPID, e.PartType, e.SpecCode, e.ShortDescription,
        p.NominalDiameter, p.MatchingPipeOD, p.WallThickness, p.Schedule, p.EndType,
        d.Angle, d.Radius, d.TakeOff1, d.TakeOff2, d.RunTakeOff, d.BranchTakeOff,
        d.FaceToFace, d.BoltCircle, d.BoltHoles, d.ReducedNominalDiameter, d.ReducedOuterDiameter
      FROM EngineeringItems e
      JOIN PipePortProperties p ON e.PnPID = p.PnPID AND p.PortIndex = 1
      LEFT JOIN ComponentDimension d ON e.PnPID = d.PnPID
      WHERE LOWER(e.PartType) = LOWER(?)
        AND LOWER(e.SpecCode) = LOWER(?)
        AND ABS(p.NominalDiameter - ?) < 0.01
    `;

    const params: (string | number)[] = [criteria.partType, specCode, criteria.nominalDiameter];

    if (criteria.angle !== undefined) {
      query += ` AND ABS(COALESCE(d.Angle, 0) - ?) < 0.5`;
      params.push(criteria.angle);
    }

    if (criteria.schedule) {
      query += ` AND LOWER(p.Schedule) = LOWER(?)`;
      params.push(criteria.schedule);
    }

    if (criteria.endType) {
      query += ` AND LOWER(p.EndType) = LOWER(?)`;
      params.push(criteria.endType);
    }

    if (criteria.reducedNominalDiameter !== undefined) {
      query += ` AND ABS(COALESCE(d.ReducedNominalDiameter, 0) - ?) < 0.01`;
      params.push(criteria.reducedNominalDiameter);
    }

    query += ` LIMIT 1`;

    const stmt = this.db.prepare(query);
    stmt.bind(params);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();

      const partTypeNormalized = (String(row.PartType).toUpperCase()) as ComponentType;
      const endTypeNormalized = (String(row.EndType).toUpperCase()) as EndType;

      return {
        pnpid: Number(row.PnPID),
        partType: partTypeNormalized,
        specCode: String(row.SpecCode),
        shortDescription: String(row.ShortDescription || ''),
        nominalDiameter: Number(row.NominalDiameter),
        outerDiameter: Number(row.MatchingPipeOD),
        wallThickness: Number(row.WallThickness),
        schedule: String(row.Schedule || 'SCH 40'),
        endType: endTypeNormalized,
        angle: row.Angle !== null ? Number(row.Angle) : undefined,
        radius: row.Radius !== null ? Number(row.Radius) : undefined,
        takeOff: row.TakeOff1 !== null ? Number(row.TakeOff1) : undefined,
        runTakeOff: row.RunTakeOff !== null ? Number(row.RunTakeOff) : undefined,
        branchTakeOff: row.BranchTakeOff !== null ? Number(row.BranchTakeOff) : undefined,
        faceToFace: row.FaceToFace !== null ? Number(row.FaceToFace) : undefined,
        boltCircle: row.BoltCircle !== null ? Number(row.BoltCircle) : undefined,
        boltHoles: row.BoltHoles !== null ? Number(row.BoltHoles) : undefined,
        reducedNominalDiameter: row.ReducedNominalDiameter !== null ? Number(row.ReducedNominalDiameter) : undefined,
        reducedOuterDiameter: row.ReducedOuterDiameter !== null ? Number(row.ReducedOuterDiameter) : undefined
      };
    }

    stmt.free();
    return null;
  }

  /**
   * Consulta una cañería recta (PIPE)
   */
  public findPipe(nominalDiameter: number, specCode?: string): SpecFitting | null {
    return this.findFitting({ partType: 'PIPE', nominalDiameter, specCode });
  }

  /**
   * Consulta un codo (ELBOW) por diámetro y ángulo
   */
  public findElbow(nominalDiameter: number, angle: number = 90, specCode?: string): SpecFitting | null {
    return this.findFitting({ partType: 'ELBOW', nominalDiameter, angle, specCode });
  }

  /**
   * Consulta una te (TEE)
   */
  public findTee(nominalDiameter: number, specCode?: string): SpecFitting | null {
    return this.findFitting({ partType: 'TEE', nominalDiameter, specCode });
  }

  /**
   * Consulta una brida (FLANGE)
   */
  public findFlange(nominalDiameter: number, specCode?: string): SpecFitting | null {
    return this.findFitting({ partType: 'FLANGE', nominalDiameter, specCode });
  }

  /**
   * Consulta una reducción (REDUCER) entre dos diámetros
   */
  public findReducer(nominalDiameter1: number, nominalDiameter2: number, specCode?: string): SpecFitting | null {
    const bigND = Math.max(nominalDiameter1, nominalDiameter2);
    const smallND = Math.min(nominalDiameter1, nominalDiameter2);
    return this.findFitting({
      partType: 'REDUCER',
      nominalDiameter: bigND,
      reducedNominalDiameter: smallND,
      specCode
    });
  }

  /**
   * Consulta una válvula (VALVE)
   */
  public findValve(nominalDiameter: number, specCode?: string): SpecFitting | null {
    return this.findFitting({ partType: 'VALVE', nominalDiameter, specCode });
  }

  /**
   * Consulta una tapa / casquete (CAP)
   */
  public findCap(nominalDiameter: number, specCode?: string): SpecFitting | null {
    return this.findFitting({ partType: 'CAP', nominalDiameter, specCode });
  }

  /**
   * Consulta una junta para unión bridada (GASKET - Regla P3dJoint)
   */
  public findGasket(nominalDiameter: number, specCode?: string): SpecFitting | null {
    return this.findFitting({ partType: 'GASKET', nominalDiameter, specCode });
  }

  /**
   * Consulta un juego de espárragos/bulones para unión bridada (BOLT_SET - Regla P3dJoint)
   */
  public findBoltSet(nominalDiameter: number, specCode?: string): SpecFitting | null {
    return this.findFitting({ partType: 'BOLT_SET', nominalDiameter, specCode });
  }

  /**
   * Obtiene la lista de diámetros nominales disponibles en la especificación
   */
  public getAvailableNominalDiameters(specCode?: string): number[] {
    if (this.isNativePlant3D) {
      const stmt = this.db.prepare(`
        SELECT DISTINCT e.NominalDiameter
        FROM EngineeringItems e
        WHERE e.NominalDiameter IS NOT NULL AND e.NominalDiameter > 0
        ORDER BY e.NominalDiameter ASC
      `);
      const diameters: number[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        diameters.push(Number(row.NominalDiameter));
      }
      stmt.free();
      return diameters;
    }

    const code = specCode || 'CS150';
    const stmt = this.db.prepare(`
      SELECT DISTINCT p.NominalDiameter
      FROM PipePortProperties p
      JOIN EngineeringItems e ON p.PnPID = e.PnPID
      WHERE LOWER(e.SpecCode) = LOWER(?)
      ORDER BY p.NominalDiameter ASC
    `);
    stmt.bind([code]);
    const diameters: number[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      diameters.push(Number(row.NominalDiameter));
    }
    stmt.free();
    return diameters;
  }

  /**
   * Exporta la base de datos completa como Uint8Array compatible con .pspc
   */
  public exportBinary(): Uint8Array {
    return this.db.export();
  }

  /**
   * Libera la memoria de la base de datos SQLite
   */
  public close(): void {
    this.db.close();
  }
}
