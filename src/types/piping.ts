import * as THREE from 'three';

/**
 * Tipos de componentes estándar de cañería industrial (incluyendo sub-partes P3dJoint)
 */
export type ComponentType =
  | 'PIPE'
  | 'ELBOW'
  | 'TEE'
  | 'FLANGE'
  | 'VALVE'
  | 'REDUCER'
  | 'CAP'
  | 'GASKET'
  | 'BOLT_SET'
  | 'CROSS'
  | 'OLET'
  | 'COUPLING'
  | 'INSTRUMENT'
  | 'MISC';

/**
 * Tipos de extremos de conexión física según normas ASME / AutoCAD Plant 3D
 */
export type EndType = 'BW' | 'SW' | 'THD' | 'FLANG';

/**
 * Preparación física de los extremos de cada niple para la Lista de Cortes de Taller
 */
export type NippleEndFinish = 'Bisel' | 'Plano' | 'Roscado';

/**
 * Tipos de juntas entre componentes
 */
export type JointType =
  | 'BUTTWELD'
  | 'SOCKETWELD'
  | 'THREADED'
  | 'FLANGED'
  | 'GASKET'
  | 'SLIPON'
  | 'GLUE'
  | 'FUSION'
  | 'CLAMP'
  | 'CONTINUOUS';

/** Confianza en la ubicación de los puertos según la plantilla de Plant 3D */
export type GeometryConfidence = 'verified' | 'standard' | 'approximate';

/** Medidas para dibujar una pieza (mm) */
export interface PartVisualDims {
  bodyStart?: number;
  bodyEnd?: number;
  flangeOuterDiameter?: number;
  flangeThickness?: number;
  hubDiameter?: number;
  bodyDiameter?: number;
  actuatorHeight?: number;
}

/** Línea de un bloque PCF tal como venía en el archivo */
export interface PcfSourceLine {
  /** Línea original completa (con su sangría) */
  raw: string;
  key: string;
  /**
   * Línea de geometría: de dónde sale el punto al reexportar.
   * 'P<n>' = puerto n, 'L<n>' = punto n de centerline, 'C' = centro calculado del codo.
   */
  ref?: string;
  /** Coordenadas leídas (para saber si la pieza se movió) */
  xyz?: [number, number, number];
  /** Lo que sigue a las coordenadas (diámetro y extremo), tal cual */
  tail?: string;
}

/** Bloque PCF de origen de un componente importado: permite reexportarlo sin pérdidas */
export interface PcfSourceBlock {
  type: string;
  lines: PcfSourceLine[];
}

/** Datos del PCF importado que no son piezas (cabecera, unidades, fin de línea) */
export interface PcfGraphInfo {
  header: string[];
  boreUnits: 'INCH' | 'MM';
  sourceName?: string;
  /** Bloques que no se importaron como piezas (WELD, SUPPORT...), por tipo */
  skipped?: Record<string, number>;
}

/**
 * Representación de un puerto de conexión polar de un componente
 */
export interface Port {
  /** Identificador único del puerto */
  id: string;
  /** Identificador del componente al que pertenece */
  componentId: string;
  /** Índice del puerto en el componente (0 para puerto 1 / entrada, 1 para puerto 2 / salida, etc.) */
  index: number;
  /** Posición 3D del puerto en coordenadas de mundo (en milímetros mm) */
  position: THREE.Vector3;
  /** Vector unitario normal exterior que apunta hacia afuera de la conexión */
  direction: THREE.Vector3;
  /** Diámetro nominal en pulgadas o mm (ej. 2 para 2") */
  nominalDiameter: number;
  /** Diámetro exterior físico real (OD) en milímetros (ej. 60.3 mm para 2") */
  outerDiameter: number;
  /** Espesor de pared real en milímetros (ej. 3.91 mm para SCH 40) */
  wallThickness: number;
  /** Cédula o Schedule (ej. "SCH 40", "SCH 80", "STD") */
  schedule: string;
  /** Tipo de extremo de la conexión (BW = Soldadura a tope, SW = Socket Weld, etc.) */
  endType: EndType;
  /** Extremo tal como lo define Plant 3D (BV, PL, FL, SW, SO, THDF...) */
  plantEndType?: string;
  /** Clase de presión del puerto (150, 300, 3000...) */
  pressureClass?: string;
  /** Si el puerto está conectado a una junta */
  connectedJointId?: string;
}

/**
 * Representación de un componente en el grafo topológico
 */
export interface Component {
  /** Identificador único del componente */
  id: string;
  /** Tipo de componente de piping */
  type: ComponentType;
  /** Código de la especificación técnica activa (ej. "CS150") */
  specCode: string;
  /** Identificador en el catálogo original o PnPID de SQLite */
  catalogId: string;
  /** Puertos de conexión polar del componente */
  ports: Port[];
  /** Puntos que componen la línea central geométrica (Centerline) en milímetros */
  centerline: THREE.Vector3[];
  /** Parámetros físicos específicos (cutLength, angle, radius, takeOff, etc.) */
  parameters: {
    /** Diámetro nominal principal */
    nominalDiameter: number;
    /** Diámetro exterior físico real (OD) en mm */
    outerDiameter: number;
    /** Espesor de pared en mm */
    wallThickness: number;
    /** Cédula del componente */
    schedule: string;
    /** Longitud bruta en mm (para tramos rectos de caño) */
    grossLength?: number;
    /** Longitud neta de corte en mm (descontando take-offs de accesorios) */
    cutLength?: number;
    /** Ángulo de curvatura en grados (ej. 90, 45 para codos) */
    angle?: number;
    /** Radio de curvatura al centro en mm (Centerline Radius R) */
    radius?: number;
    /** Distancia de centro a cara en mm (Take-Off T) */
    takeOff?: number;
    /** Cota centro a cara en recorrido principal (Run C) para Tes */
    runTakeOff?: number;
    /** Cota centro a cara en derivación (Branch M) para Tes */
    branchTakeOff?: number;
    /** Longitud cara a cara en mm (para bridas, válvulas o reducciones) */
    faceToFace?: number;
    /** Diámetro de círculo de pernos (Bolt Circle) en mm */
    boltCircle?: number;
    /** Cantidad de agujeros para pernos */
    boltHoles?: number;
    /** Diámetro nominal reducido para reducciones o tes reductoras */
    reducedNominalDiameter?: number;
    /** Diámetro exterior reducido en mm */
    reducedOuterDiameter?: number;
    /** Descripción técnica normalizada */
    description?: string;
    /** Elementos de la matriz de transformación 4x4 (TRS) para accesorios */
    matrixElements?: number[];
    /** Sub-partes automáticas de conexión bridada P3dJoint (Gasket & BoltSet) */
    gasketDescription?: string;
    gasketThicknessMm?: number;
    boltSetDescription?: string;
    boltSize?: string;
    boltCount?: number;
    boltLengthMm?: number;
    /** Número de Línea (Line Number de AutoCAD Plant 3D, ej. "100-CS150-2\"") */
    lineNumber?: string;
    /** Datos de la pieza de spec de Plant 3D */
    itemCode?: string;
    skey?: string;
    familyId?: string;
    familyDescription?: string;
    pressureClass?: string;
    geometryConfidence?: GeometryConfidence;
    geometryNote?: string;
    visual?: PartVisualDims;
    /** Reducción excéntrica: corrimiento lateral del extremo chico (mm) */
    lateralOffset?: number;
    /** Bloque PCF de origen (piezas importadas) */
    pcf?: PcfSourceBlock;
    /** Identificación del niple para lista de cortes (ej. "N-01") */
    nippleTag?: string;
    /** Tipo de preparación del Extremo 1 del niple (Plano, Bisel, Roscado) */
    endFinish1?: NippleEndFinish;
    /** Tipo de preparación del Extremo 2 del niple (Plano, Bisel, Roscado) */
    endFinish2?: NippleEndFinish;
  };
}

/**
 * Junta de conexión física o lógica que une dos puertos
 */
export interface Joint {
  /** Identificador único de la junta */
  id: string;
  /** Tipo de unión física */
  type: JointType;
  /** ID del primer puerto conectado */
  portAId: string;
  /** ID del segundo puerto conectado */
  portBId: string;
  /** Posición 3D de la junta en el espacio (en mm) */
  position: THREE.Vector3;
  /** Separación entre caras (espesor de junta) en mm */
  gapMm?: number;
  /** Nombre de la regla de unión de Plant 3D (Buttweld, Flanged, Slip...) */
  plantJoint?: string;
  /** Soldadura de campo (corta el spool): FW, o FFW con sobrelargo para ajustar en obra */
  fieldWeld?: FieldWeldKind;
  /** Sobrelargo (mm) que se deja en el caño para una soldadura FFW */
  fieldAllowanceMm?: number;
}

export type FieldWeldKind = 'FW' | 'FFW';

/**
 * Resultado del cálculo geométrico y vectorial para la colocación de un codo
 */
export interface ElbowPlacementResult {
  /** Punto de corte físico en el tramo entrante (Pcut1 = V - u1 * T) */
  cutPoint1: THREE.Vector3;
  /** Punto de corte físico en el tramo saliente (Pcut2 = V + u2 * T) */
  cutPoint2: THREE.Vector3;
  /** Longitud neta de corte del tramo entrante (Lnet1 = Lgross1 - T) */
  netLengthIncoming: number;
  /** Longitud neta de corte del tramo saliente (Lnet2 = Lgross2 - T) */
  netLengthOutgoing: number;
  /** Matriz de transformación 4x4 ortonormal (TRS) para posicionar la malla */
  matrix: THREE.Matrix4;
  /** Cuaternión de orientación libre de bloqueo de cardán (Gimbal Lock) */
  rotation: THREE.Quaternion;
  /** Posición del vértice de intersección V */
  vertex: THREE.Vector3;
  /** Centro de curvatura del arco del codo */
  arcCenter: THREE.Vector3;
  /** Puntos que forman la línea central del codo entre cutPoint1 y cutPoint2 */
  centerline: THREE.Vector3[];
  /** Ángulo real de giro en grados */
  bendAngleDeg: number;
  /** Vector ortonormal X de la base local (-u_in) */
  basisX: THREE.Vector3;
  /** Vector ortonormal Y de la base local (u_out en 90° o perpendicular en el plano) */
  basisY: THREE.Vector3;
  /** Vector ortonormal Z de la base local (normal al plano de curvatura) */
  basisZ: THREE.Vector3;
}

/**
 * Especificación técnica de accesorio consultada en catálogo SQLite
 */
export interface SpecFitting {
  pnpid: number;
  partType: ComponentType;
  specCode: string;
  shortDescription: string;
  nominalDiameter: number;
  outerDiameter: number;
  wallThickness: number;
  schedule: string;
  endType: EndType;
  angle?: number;
  radius?: number;
  takeOff?: number;
  runTakeOff?: number;
  branchTakeOff?: number;
  faceToFace?: number;
  boltCircle?: number;
  boltHoles?: number;
  reducedNominalDiameter?: number;
  reducedOuterDiameter?: number;
  boltSize?: string;
  boltCount?: number;
  boltLengthMm?: number;
  gasketThicknessMm?: number;
  /** Datos de Plant 3D de la pieza elegida */
  itemCode?: string;
  skey?: string;
  familyId?: string;
  familyDescription?: string;
  template?: string;
  pressureClass?: string;
  geometryConfidence?: GeometryConfidence;
  geometryNote?: string;
  /** Extremos de Plant por puerto, en orden S1, S2, S3 */
  plantEndTypes?: string[];
  portNominalDiameters?: number[];
  portOuterDiameters?: number[];
  /** Vértice a puerto S2 en codos asimétricos */
  takeOff2?: number;
  /** Corrimiento lateral de reducciones excéntricas */
  lateralOffset?: number;
  visual?: PartVisualDims;
}

/**
 * Criterios para consultar accesorios en la base de datos de especificaciones
 */
export interface FittingQueryCriteria {
  partType: ComponentType;
  nominalDiameter: number;
  specCode?: string;
  angle?: number;
  schedule?: string;
  endType?: EndType;
  reducedNominalDiameter?: number;
  /** Familia de Plant a usar (PartFamilyId) */
  familyId?: string;
  /** Extremo de Plant del puerto al que se va a conectar */
  connectToEndType?: string;
  pressureClass?: string;
  eccentric?: boolean;
}

/**
 * Estado completo serializable del grafo de piping para Zustand / IndexedDB
 */
export interface SerializedPort {
  id: string;
  componentId: string;
  index: number;
  position: [number, number, number];
  direction: [number, number, number];
  nominalDiameter: number;
  outerDiameter: number;
  wallThickness: number;
  schedule: string;
  endType: EndType;
  plantEndType?: string;
  pressureClass?: string;
  connectedJointId?: string;
}

export interface SerializedComponent {
  id: string;
  type: ComponentType;
  specCode: string;
  catalogId: string;
  ports: SerializedPort[];
  centerline: [number, number, number][];
  parameters: Component['parameters'];
}

export interface SerializedJoint {
  id: string;
  type: JointType;
  portAId: string;
  portBId: string;
  position: [number, number, number];
  gapMm?: number;
  plantJoint?: string;
  fieldWeld?: FieldWeldKind;
  fieldAllowanceMm?: number;
}

export interface SerializedGraphState {
  version: number;
  activeSpec: string;
  currentNominalDiameter: number;
  currentSchedule: string;
  components: Record<string, SerializedComponent>;
  joints: Record<string, SerializedJoint>;
  activeLineNumber?: string;
  pcf?: PcfGraphInfo;
}
