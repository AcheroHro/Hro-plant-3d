import { create } from 'zustand';
import * as THREE from 'three';
import { PipingGraph, isFaceEnd } from '../core/graph/PipingGraph';
import { resizeRun } from '../core/graph/resizeRun';
import { SpecDatabaseReader } from '../core/specs/SpecDatabaseReader';
import { PartCategory } from '../core/specs/catalogTypes';
import { valveKindFrom } from '../core/specs/valveKind';
import { aPiece, pieceName, pieceNameLower } from '../core/pieceNames';
import {
  LoadedSpec,
  loadBundledSpec,
  loadCachedSpec,
  loadPreferredFamilies,
  loadSpecFromFiles,
  savePreferredFamilies
} from '../core/specs/specLoader';
import { saveGraphToIndexedDb, loadActiveProject, ProjectRecord } from '../persistence/indexedDbStorage';
import { detectPipingCollisions } from '../viewport/collision/collisionDetector';
import { calculateElbowPlacement } from '../core/math/elbowSolver';
import { SerializedGraphState, FieldWeldKind, Component, ComponentType, NippleEndFinish, Port, SpecFitting, SupportKind, SupportMark } from '../types/piping';
import { PcfImporter } from '../core/importers/PcfImporter';
import { moveSupportTo } from '../core/graph/supportDimensions';
import { applyElevation, planElevation } from '../core/graph/elevation';
import { RoutePlan, planConnectionRoutes } from '../core/routing/connectRoutes';
import { applySlope, centerlineForElevation, deflect, elbowForBend, planOffset, trimmedTakeOff } from '../core/routing/routeMath';

export type CameraMode = 'INSPECT_MODE' | 'ROUTE_MODE';

/** Qué se muestra cuando se aísla: una línea por su número, o un tramo conectado */
export type Isolation = { kind: 'line'; line: string } | { kind: 'run'; ids: string[] };

/** Caja de corte del modelo, en mm */
export interface SectionBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** Número de línea de una pieza: el suyo o, si no tiene, el de la línea activa */
export function lineOf(graph: PipingGraph, comp: { parameters: { lineNumber?: string } }): string {
  return comp.parameters.lineNumber || graph.activeLineNumber || '';
}

/** Piezas visibles con el aislamiento actual y las líneas ocultas; null = se ve todo */
export function isolatedIds(
  graph: PipingGraph,
  isolation: Isolation | null,
  hiddenLines?: ReadonlySet<string> | null
): Set<string> | null {
  const hasHidden = Boolean(hiddenLines && hiddenLines.size > 0);
  if (!isolation && !hasHidden) return null;
  let base: Set<string> | null = null;
  if (isolation) {
    if (isolation.kind === 'run') {
      base = new Set(isolation.ids);
    } else {
      base = new Set<string>();
      for (const comp of graph.components.values()) if (lineOf(graph, comp) === isolation.line) base.add(comp.id);
    }
  }
  if (!hasHidden) return base;
  const ids = new Set<string>();
  for (const comp of graph.components.values()) {
    if (base && !base.has(comp.id)) continue;
    if (hiddenLines!.has(lineOf(graph, comp))) continue;
    ids.add(comp.id);
  }
  return ids;
}

export interface PieceMenuState {
  x: number;
  y: number;
  componentId: string;
  /** En caños: distancia del punto tocado al inicio del caño (mm) */
  offsetMm?: number;
  /** Abrir ya desplegada una opción (desde la barra de abajo del teléfono) */
  section?: 'branch' | 'support' | 'size';
}

export interface PipingState {
  graph: PipingGraph;
  specReader: SpecDatabaseReader | null;
  cameraMode: CameraMode;
  activeDirection: THREE.Vector3;
  nominalDiameter: number;
  schedule: string;
  specCode: string;
  lineNumber: string;
  numpadValue: string;
  selectedPortId: string | null;
  selectedComponentId: string | null;
  snappedPortId: string | null;
  collidingComponentIds: Set<string>;
  statusMessage: string;
  isBomOpen: boolean;
  isExportOpen: boolean;
  isToolPaletteOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  version: number;
  triggerFrameAll: number;
  /** Pedido de encuadrar una pieza (la lista de avisos); seq cambia en cada pedido */
  focusRequest: { id: string; seq: number } | null;
  cameraViewPreset: { azimuth: number; polar: number; seq: number } | null;
  /** Familia de Plant fijada por el usuario para cada tipo de pieza (PartFamilyId) */
  preferredFamilies: Record<string, string>;
  /** Avisos de la última carga de spec */
  specNotes: string[];
  /** Colorear el modelo por spool */
  spoolView: boolean;
  isSpoolsOpen: boolean;
  /** Conectar a otra boca: esperando que se toque la boca de destino */
  connectPicking: boolean;
  connectTargetId: string | null;
  /** Recorridos posibles hasta la boca de destino; el elegido se ve en el modelo */
  connectRoutes: RoutePlan[];
  connectIndex: number;
  /** Vista: solo se dibuja una línea o un tramo conectado */
  isolation: Isolation | null;
  /** Líneas ocultas manualmente desde el Gestor de Líneas (como capas) */
  hiddenLines: Set<string>;
  /** Medir: puntos tocados en el modelo (dos hacen una medida) */
  measureActive: boolean;
  measurePoints: THREE.Vector3[];
  sectionBox: SectionBox | null;
  /** Giro libre: grados que se desvía la línea al tocar un eje; null = sale derecho por el eje */
  turnAngleDeg: number | null;
  /** Pendiente de los tramos horizontales en % (positiva sube, negativa baja; 0 = a nivel) */
  slopePct: number;
  /** Último eje tocado y la dirección que resultó (para resaltarlo aunque el trazado salga inclinado) */
  routeAxis: { axis: THREE.Vector3; result: THREE.Vector3 } | null;
  /** Menú de la pieza que se mantuvo apretada (posición en pantalla y punto tocado del caño) */
  pieceMenu: PieceMenuState | null;
  /** Selección múltiple: los toques suman o quitan piezas en vez de elegir una sola */
  multiMode: boolean;
  multiSelect: string[];

  // Acciones
  openPieceMenu: (menu: PieceMenuState) => void;
  closePieceMenu: () => void;
  /** Cambia el largo de un caño dejando quieto el extremo `anchor` */
  stretchPipe: (componentId: string, newLengthMm: number, anchor: 'start' | 'end') => void;
  /** Sustituye en el lugar el codo o la válvula elegidos por otra familia (y otro ángulo en codos) */
  substituteSelected: (familyId?: string, angle?: number) => void;
  /** Cambia a mano el cara a cara de la válvula elegida; sin valor vuelve al de la spec */
  setSelectedValveFaceToFace: (mm?: number) => void;
  /** Sube o baja la pieza elegida hasta la elevación de eje `z`: los caños verticales se estiran */
  setSelectedElevation: (z: number) => void;
  toggleMultiMode: (on?: boolean) => void;
  toggleMultiComponent: (componentId: string) => void;
  selectConnectedRun: () => void;
  deleteMulti: () => void;
  moveMulti: (delta: THREE.Vector3, copy: boolean) => void;
  startConnectPicking: () => void;
  pickConnectTarget: (portId: string) => void;
  cycleConnectRoute: (delta: number) => void;
  confirmConnect: () => void;
  setTurnAngle: (deg: number | null) => void;
  isolateLine: (line: string) => void;
  /** Aísla todo lo que está conectado a una pieza */
  isolateRun: (componentId: string) => void;
  clearIsolation: () => void;
  /** Oculta o vuelve a mostrar una línea (como capas en Plant 3D) */
  toggleLineHidden: (line: string) => void;
  /** Vuelve a mostrar todas las líneas ocultas y quita el aislamiento */
  showAllLines: () => void;
  toggleMeasure: (on?: boolean) => void;
  addMeasurePoint: (point: THREE.Vector3) => void;
  /** Caja de corte alrededor de la pieza elegida (o de la boca activa, o de todo el modelo) */
  setSectionAround: (marginMm: number) => void;
  /** Corre una cara de la caja de corte */
  nudgeSection: (axis: 0 | 1 | 2, side: 'min' | 'max', deltaMm: number) => void;
  clearSection: () => void;
  setSlope: (pct: number) => void;
  /** Desvío simple o rodado: dos codos y un diagonal para correr la línea `offset` y seguir derecho */
  applyOffset: (offset: THREE.Vector3, angleDeg: number, tailMm?: number) => void;
  /** Prepara el tramo vertical para llegar a una elevación por eje, fondo (BOP) o lomo (TOP) */
  goToElevation: (target: number, ref: 'CL' | 'BOP' | 'TOP') => void;
  /** Derivación sobre un caño sin cortarlo: olet de la spec o injerto directo */
  addBranchOnPipe: (componentId: string, offsetMm: number, dir: THREE.Vector3, branchNd: number) => void;
  addSupportOnPipe: (componentId: string, offsetMm: number, kind: SupportKind) => void;
  removeSupport: (supportId: string) => void;
  /** Soporte elegido para editar (tipo y tag de Plant, altura, giro) */
  selectedSupportId: string | null;
  setSelectedSupportId: (supportId: string | null) => void;
  updateSupport: (
    supportId: string,
    patch: Partial<Pick<SupportMark, 'kind' | 'tag' | 'plantType' | 'heightMm' | 'rotationDeg'>>
  ) => void;
  /** Corre el soporte sobre su tramo para dejarlo a `mm` de lo que tiene del lado `side` */
  moveSupport: (supportId: string, side: 'back' | 'ahead', mm: number) => void;
  cancelConnect: () => void;
  /** Carga la spec y el proyecto activo; devuelve el proyecto abierto */
  initialize: () => Promise<ProjectRecord | null>;
  /** Reemplaza el modelo (al abrir otro proyecto): limpia deshacer y encuadra */
  loadGraphState: (state: SerializedGraphState | null, message?: string) => void;
  setCameraMode: (mode: CameraMode) => void;
  setCameraViewPreset: (preset: 'ISO' | 'TOP' | 'FRONT' | 'RIGHT') => void;
  setActiveDirection: (dir: THREE.Vector3) => void;
  setNominalDiameter: (nd: number) => void;
  setLineNumber: (tag: string) => void;
  appendNumpadDigit: (digit: string) => void;
  backspaceNumpad: () => void;
  quickAddNumpad: (amount: number) => void;
  clearNumpad: () => void;
  setSelectedPortId: (portId: string | null) => void;
  setSelectedComponentId: (compId: string | null) => void;
  selectPortAndAlign: (portId: string) => void;
  cycleOpenPort: () => void;
  rotateSelectedComponent: (angleDeg?: number) => void;
  /** Da vuelta la pieza elegida: cara de la brida, sentido de la válvula o plano de la excéntrica */
  flipSelectedComponent: () => void;
  /** Cambia el diámetro de todo el tramo de la pieza elegida, sin mover los ejes */
  changeRunDiameter: (newNd: number) => void;
  /** Purga (hacia abajo) o venteo (hacia arriba) de un toque: olet + niple + válvula + niple + tapa */
  addDrainOrVent: (componentId: string, offsetMm: number, kind: 'purga' | 'venteo') => void;
  /** Largo hasta alinear: esperando que se toque la boca o la pieza de referencia */
  alignPicking: boolean;
  startAlignPicking: () => void;
  pickAlignTarget: (point: THREE.Vector3) => void;
  /** Traza los tramos a 90° que llevan la boca activa hasta una coordenada del modelo */
  goToCoordinate: (target: THREE.Vector3) => void;
  updateSelectedPipeLength: (newLengthMm: number) => void;
  updatePipeEndFinishes: (componentId: string, endFinish1: NippleEndFinish, endFinish2: NippleEndFinish) => void;
  setFieldWeld: (jointId: string, kind: FieldWeldKind | null, allowanceMm?: number) => void;
  toggleSpoolView: () => void;
  toggleSpools: () => void;
  updateComponentMetadata: (
    componentId: string,
    metadata: { nippleTag?: string; lineNumber?: string; description?: string }
  ) => void;
  splitSelectedPipeWithFitting: (
    fittingType: 'TEE' | 'VALVE' | 'FLANGE',
    offsetMm?: number,
    branchDir?: THREE.Vector3
  ) => void;
  deleteSelectedComponent: () => void;
  setNumpadValue: (val: string) => void;
  setSnappedPortId: (portId: string | null) => void;
  applyRouting: () => void;
  /** Inicia un tramo de cañería directamente desde una boquilla de equipo */
  startFromNozzle: (position: THREE.Vector3, direction: THREE.Vector3, nominalDiameter: number, label: string) => void;
  insertFitting: (
    type: ComponentType,
    options?: {
      angle?: number;
      branchDir?: THREE.Vector3;
      targetNd?: number;
      continueOnBranch?: boolean;
      /** Brida: armar la unión completa (brida + junta + brida) */
      pair?: boolean;
      /** Brida ciega */
      blind?: boolean;
      /** Familia de la spec elegida en la paleta */
      familyId?: string;
      eccentric?: boolean;
      /** Reducción excéntrica: lado de la generatriz recta */
      flat?: 'abajo' | 'arriba';
      /** Te reducida: diámetro del ramal */
      branchNd?: number;
    }
  ) => void;
  undo: () => void;
  redo: () => void;
  frameAll: () => void;
  /** Elige una pieza y lleva la cámara a ella, aunque estuviera oculta por un aislamiento o un corte */
  focusComponent: (compId: string) => void;
  toggleBom: () => void;
  toggleExport: () => void;
  toggleToolPalette: () => void;
  resetGraph: () => Promise<void>;
  loadPspcFile: (buffer: ArrayBuffer, fileName: string) => Promise<void>;
  loadSpecFiles: (files: File[]) => Promise<void>;
  setPreferredFamily: (category: PartCategory, familyId: string | null) => void;
  loadBuiltInSpec: (specName: string) => Promise<void>;
  /** Importa un PCF en el modelo; devuelve el estado importado (el guardado lo hace el proyecto) */
  importPcfFile: (content: string, fileName: string) => SerializedGraphState | null;
}

/** Mientras se arma un recorrido de conexión, los cambios de boca activa son parte de la operación */
let connectExecuting = false;

export const usePipingStore = create<PipingState>((set, get) => {
  // Historial de snapshots para Undo / Redo 100% fiable
  let undoSnapshots: SerializedGraphState[] = [];
  let redoSnapshots: SerializedGraphState[] = [];

  const pushUndoSnapshot = () => {
    const { graph } = get();
    undoSnapshots.push(graph.serialize());
    if (undoSnapshots.length > 50) undoSnapshots.shift();
    redoSnapshots = [];
    set({ canUndo: true, canRedo: false });
  };

  /** Codo para un giro de `bendDeg`: de catálogo si da, o recortado si la spec es para soldar a tope */
  const elbowForTurn = (
    nd: number,
    bendDeg: number,
    port?: Port | null
  ): { spec: SpecFitting; takeOff: number; trimmedFrom?: number } | { error: string } => {
    const { specReader, specCode } = get();
    if (!specReader) return { error: 'No hay spec cargada.' };
    const has45 = !!specReader.findElbow(nd, 45, specCode, findOpts(port));
    const choice = elbowForBend(bendDeg, has45);
    if (!choice) return { error: `Giro de ${bendDeg.toFixed(0)}°: un codo no gira más de 90°. Hacelo en dos tramos.` };
    const spec = specReader.findElbow(nd, choice.baseAngle, specCode, findOpts(port));
    if (!spec) return { error: `La spec no tiene codo de ${choice.baseAngle}° en ${formatSize(nd)}.` };
    const rad = THREE.MathUtils.degToRad(bendDeg);
    const catalogTakeOff = spec.takeOff || (spec.radius ? spec.radius * Math.tan(rad / 2) : 76.2);
    if (!choice.trimmed) return { spec, takeOff: catalogTakeOff };
    const end = spec.plantEndTypes?.[0];
    const buttWeld = end ? end.toUpperCase() === 'BV' : spec.endType === 'BW';
    if (!buttWeld) {
      return { error: `Giro de ${bendDeg.toFixed(1)}°: los codos de esta spec (${end || spec.endType}) no se pueden recortar. Usá 45° o 90°.` };
    }
    const radius = spec.radius || catalogTakeOff / Math.tan(THREE.MathUtils.degToRad(choice.baseAngle) / 2);
    return { spec, takeOff: trimmedTakeOff(radius, bendDeg), trimmedFrom: choice.baseAngle };
  };

  /** Dirección de trazado que resulta de tocar un eje, según el giro libre y la pendiente activos */
  const routeDirectionFor = (axis: THREE.Vector3): THREE.Vector3 => {
    const { graph, selectedPortId, turnAngleDeg, slopePct } = get();
    const port = selectedPortId ? graph.ports.get(selectedPortId) : null;
    const a = axis.clone().normalize();
    if (turnAngleDeg !== null && port && !port.connectedJointId) return deflect(port.direction, a, turnAngleDeg);
    return applySlope(a, slopePct);
  };

  /**
   * Traza varios tramos seguidos como un solo paso de deshacer. Si uno falla deja el modelo como estaba
   * y devuelve el motivo; si sale bien devuelve null.
   */
  const traceLegs = (legs: { dir: THREE.Vector3; length: number }[]): string | null => {
    const undoBefore = undoSnapshots.length;
    const keepNumpad = get().numpadValue;
    connectExecuting = true;
    try {
      for (const leg of legs) {
        const before = get().selectedPortId;
        set({ activeDirection: leg.dir.clone(), numpadValue: String(Math.round(leg.length * 100) / 100) });
        get().applyRouting();
        if (get().selectedPortId === before) {
          const why = get().statusMessage;
          if (undoSnapshots.length > undoBefore) {
            undoSnapshots.length = undoBefore + 1;
            get().undo();
            redoSnapshots.pop();
          }
          set({ numpadValue: keepNumpad, canRedo: redoSnapshots.length > 0 });
          return why;
        }
      }
      undoSnapshots.length = undoBefore + 1;
      set({ numpadValue: keepNumpad });
      return null;
    } finally {
      connectExecuting = false;
    }
  };

  /** Opciones de selección según el puerto donde se conecta (extremo y clase de Plant) */
  const findOpts = (port?: Port | null) => ({
    connectToEndType: port?.plantEndType,
    pressureClass: port?.pressureClass
  });

  const formatSize = (nd: number) => get().specReader?.catalog.sizeLabel(nd) ?? `${nd}"`;

  /** Dirección dicha en palabras: "hacia +X" o "en diagonal" */
  const dirName = (d: THREE.Vector3) => {
    const n = d.clone().normalize();
    const i = [0, 1, 2].find((k) => Math.abs(n.getComponent(k)) > 0.99);
    return i === undefined ? 'en diagonal' : `hacia ${n.getComponent(i) > 0 ? '+' : '−'}${'XYZ'[i]}`;
  };

  /**
   * Reducciones de la spec para pasar de un diámetro a otro: la directa o, si no existe, dos
   * encadenadas por un diámetro intermedio. Se prefiere la concéntrica.
   */
  const reducerSteps = (from: number, to: number, port?: Port | null): { from: number; to: number; spec: SpecFitting }[] => {
    const { specReader, specCode } = get();
    if (!specReader) return [];
    const find = (a: number, b: number) => {
      const spec = specReader.findReducer(a, b, specCode, findOpts(port));
      return spec && spec.faceToFace ? spec : null;
    };
    const direct = find(from, to);
    if (direct) return [{ from, to, spec: direct }];
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const middles = specReader
      .getAvailableNominalDiameters()
      .filter((m) => m > lo + 1e-6 && m < hi - 1e-6)
      .sort((a, b) => Math.abs(a - to) - Math.abs(b - to));
    for (const mid of middles) {
      const first = find(from, mid);
      const second = first ? find(mid, to) : null;
      if (first && second) return [{ from, to: mid, spec: first }, { from: mid, to, spec: second }];
    }
    return [];
  };

  /** Aviso cuando la ubicación de puertos de la pieza no está verificada contra Plant */
  const geomWarn = (spec?: SpecFitting | null) =>
    spec?.geometryConfidence === 'approximate'
      ? ` ⚠ Geometría aproximada (${spec.geometryNote || 'plantilla sin verificar'}): revisar al importar en Plant.`
      : '';

  /**
   * Si el puerto es una cara de brida, inserta antes la brida de la spec (como AutoFlange de
   * Plant 3D) y devuelve su lado caño. Si no, devuelve el mismo puerto.
   */
  const flangeOffFaceIfNeeded = (port: Port): { port: Port; note: string } => {
    const { graph, specReader, specCode } = get();
    if (!specReader || !isFaceEnd(port)) return { port, note: '' };
    const nd = port.nominalDiameter;
    const flg = specReader.findFlange(nd, specCode, findOpts(port));
    if (!flg) return { port, note: ' ⚠ La spec no tiene brida para salir de esta cara.' };
    const gasket = specReader.findGasket(nd, specCode, { pressureClass: port.pressureClass || flg.pressureClass });
    const bolts = specReader.findBoltSet(nd, specCode, { pressureClass: port.pressureClass || flg.pressureClass });
    const added = graph.addFlange(port, flg, gasket, bolts);
    return { port: added.ports[1], note: ` + ${flg.familyDescription || 'brida'} automática con junta.` };
  };

  /** Aplica una spec recién cargada al store y al grafo */
  const applyLoadedSpec = (loaded: LoadedSpec, origin: string) => {
    const reader = loaded.reader;
    const specName = reader.specName;
    const families = loadPreferredFamilies(specName);
    for (const [cat, fam] of Object.entries(families)) reader.setPreferredFamily(cat as PartCategory, fam);
    const graph = get().graph;
    graph.connectionRules = loaded.rules;
    graph.activeSpec = specName;
    const available = reader.getAvailableNominalDiameters();
    const current = get().nominalDiameter;
    const newND = available.includes(current) ? current : available.includes(2) ? 2 : available[0] || 2;
    graph.currentNominalDiameter = newND;
    const kind = reader.isNativePlant3D ? (reader.catalog.data.kind === 'catalog' ? 'Catálogo' : 'Spec') : 'Catálogo demo';
    const prios = reader.catalog.preferences?.priorities.length ?? 0;
    set({
      specReader: reader,
      specCode: specName,
      nominalDiameter: newND,
      preferredFamilies: families,
      specNotes: loaded.notes,
      version: get().version + 1,
      statusMessage: `${kind} '${specName}' ${origin}: ${reader.catalog.data.parts.length} piezas, ${available.length} diámetros${
        prios ? `, ${prios} prioridades de Plant` : ''
      }.${loaded.notes.length ? ` ⚠ ${loaded.notes[0]}` : ''}`
    });
  };

  return {
    graph: new PipingGraph('CS150', 2, 'SCH 40'),
    specReader: null,
    cameraMode: 'INSPECT_MODE',
    activeDirection: new THREE.Vector3(1, 0, 0), // Por defecto hacia +X (Este)
    nominalDiameter: 2,
    schedule: 'SCH 40',
    specCode: 'CS150',
    lineNumber: '100-CS150-2"',
    numpadValue: '1000', // 1000 mm de longitud inicial
    selectedPortId: null,
    selectedComponentId: null,
    selectedSupportId: null,
    snappedPortId: null,
    collidingComponentIds: new Set<string>(),
    statusMessage: 'Listo para trazar.',
    isBomOpen: false,
    spoolView: false,
    isSpoolsOpen: false,
    connectPicking: false,
    connectTargetId: null,
    connectRoutes: [],
    connectIndex: 0,
    isolation: null,
    hiddenLines: new Set<string>(),
    measureActive: false,
    measurePoints: [],
    sectionBox: null,
    turnAngleDeg: null,
    slopePct: 0,
    alignPicking: false,
    routeAxis: null,
    pieceMenu: null,
    multiMode: false,
    multiSelect: [],
    isExportOpen: false,
    isToolPaletteOpen: false,
    canUndo: false,
    canRedo: false,
    version: 0,
    triggerFrameAll: 0,
    focusRequest: null,
    cameraViewPreset: null,
    preferredFamilies: {},
    specNotes: [],

    initialize: async () => {
      let project: ProjectRecord | null = null;
      try {
        // 1) Última spec usada (IndexedDB, sirve sin conexión) 2) spec integrada 3) catálogo demo
        let loaded: LoadedSpec | null = null;
        try {
          loaded = await loadCachedSpec();
        } catch {
          loaded = null;
        }
        let origin = 'restaurada';
        if (!loaded) {
          try {
            loaded = await loadBundledSpec('RCI1');
            origin = 'integrada';
          } catch {
            loaded = null;
          }
        }
        if (!loaded) {
          const demo = await SpecDatabaseReader.createDefault('CS150');
          loaded = { reader: demo, rules: get().graph.connectionRules, notes: demo.warnings };
          origin = 'cargado';
        }
        const reader = loaded.reader;
        const specName = reader.specName || 'CS150';
        const initialGraph = new PipingGraph(specName, 2, 'SCH 40');
        initialGraph.connectionRules = loaded.rules;

        // Cargar persistencia si existe
        project = await loadActiveProject();
        const savedState = project?.state;
        if (savedState && Object.keys(savedState.components).length > 0) {
          initialGraph.deserialize(savedState);
          if (savedState.activeLineNumber) set({ lineNumber: savedState.activeLineNumber });
          const openPorts = initialGraph.getOpenPorts();
          if (openPorts.length > 0) {
            set({ selectedPortId: openPorts[openPorts.length - 1].id });
          }
        } else {
          // Tramo inicial de demostración con piezas de la spec
          const sizes = reader.getAvailableNominalDiameters();
          const nd = sizes.includes(2) ? 2 : sizes[0];
          const pipeSpec = nd ? reader.findPipe(nd, specName) : null;
          const elbowSpec = nd ? reader.findElbow(nd, 90, specName) : null;
          if (pipeSpec && elbowSpec) {
            try {
              initialGraph.routeTurnWithElbow(
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(1000, 0, 0),
                new THREE.Vector3(1000, 1000, 0),
                pipeSpec,
                elbowSpec
              );
            } catch {
              // spec sin codo utilizable para la demo
            }
            const open = initialGraph.getOpenPorts();
            if (open.length > 0) {
              set({ selectedPortId: open[open.length - 1].id });
            }
          }
        }

        const collisions = detectPipingCollisions(initialGraph);
        set({ graph: initialGraph, collidingComponentIds: collisions.collidingComponentIds });
        applyLoadedSpec(loaded, origin);
        if (project) set({ statusMessage: `Proyecto "${project.name}" abierto. ${get().statusMessage}` });
      } catch (err) {
        console.error('Error inicializando estado de piping:', err);
        set({ statusMessage: 'No se pudo abrir la spec incluida en la app.' });
      }
      return project;
    },

    loadGraphState: (state, message) => {
      const { specCode, nominalDiameter } = get();
      const g = new PipingGraph(specCode, nominalDiameter, 'SCH 40');
      g.connectionRules = get().graph.connectionRules;
      if (state) {
        g.deserialize(state);
        g.activeSpec = specCode;
      }
      undoSnapshots = [];
      redoSnapshots = [];
      const open = g.getOpenPorts();
      const last = open.length ? open[open.length - 1] : null;
      set({
        graph: g,
        lineNumber: state?.activeLineNumber || g.activeLineNumber || get().lineNumber,
        selectedPortId: last?.id ?? null,
        selectedComponentId: null,
    selectedSupportId: null,
        snappedPortId: null,
        activeDirection: last ? last.direction.clone().normalize() : new THREE.Vector3(1, 0, 0),
        collidingComponentIds: detectPipingCollisions(g).collidingComponentIds,
        canUndo: false,
        canRedo: false,
        version: get().version + 1,
        triggerFrameAll: get().triggerFrameAll + 1,
        statusMessage: message ?? get().statusMessage
      });
    },

    loadSpecFiles: async (files: File[]) => {
      try {
        set({ statusMessage: `Leyendo ${files.map((f) => f.name).join(', ')}...` });
        const loaded = await loadSpecFromFiles(files);
        applyLoadedSpec(loaded, 'cargada');
      } catch (err) {
        console.error('Error cargando spec:', err);
        set({ statusMessage: `No se pudo cargar la spec: ${(err as Error).message}` });
      }
    },

    loadPspcFile: async (buffer: ArrayBuffer, fileName: string) => {
      await get().loadSpecFiles([new File([buffer], fileName)]);
    },

    loadBuiltInSpec: async (targetSpecName: string) => {
      try {
        const loaded = await loadBundledSpec(targetSpecName);
        applyLoadedSpec(loaded, 'activada');
      } catch {
        const demo = await SpecDatabaseReader.createDefault(targetSpecName);
        applyLoadedSpec({ reader: demo, rules: get().graph.connectionRules, notes: demo.warnings }, 'demo');
      }
    },

    setPreferredFamily: (category, familyId) => {
      const { specReader, preferredFamilies } = get();
      if (!specReader) return;
      specReader.setPreferredFamily(category, familyId);
      const next = { ...preferredFamilies };
      if (familyId) next[category] = familyId;
      else delete next[category];
      savePreferredFamilies(specReader.specName, next);
      const fam = familyId
        ? specReader.catalog.data.parts.find((p) => p.familyId === familyId)?.familyDesc
        : undefined;
      set({
        preferredFamilies: next,
        version: get().version + 1,
        statusMessage: fam ? `${pieceName(category)}: se usa siempre ${fam}.` : `${pieceName(category)}: vuelve a elegir la spec.`
      });
    },

    setCameraMode: (mode) => set({ cameraMode: mode }),

    setActiveDirection: (dir) => {
      const result = routeDirectionFor(dir);
      const { turnAngleDeg, slopePct } = get();
      const plain = result.distanceTo(dir.clone().normalize()) < 1e-6;
      const how = plain ? '' : turnAngleDeg !== null ? ` con giro de ${turnAngleDeg}°` : ` con pendiente de ${slopePct}%`;
      set({
        activeDirection: result,
        routeAxis: { axis: dir.clone().normalize(), result: result.clone() },
        statusMessage: `Trazado ${dirName(dir)}${how}`
      });
    },

    isolateLine: (line) => {
      const count = isolatedIds(get().graph, { kind: 'line', line })?.size ?? 0;
      if (!count) return set({ statusMessage: `No hay piezas en la línea ${line}.` });
      const hidden = new Set(get().hiddenLines);
      hidden.delete(line);
      set({
        isolation: { kind: 'line', line },
        hiddenLines: hidden,
        triggerFrameAll: get().triggerFrameAll + 1,
        statusMessage: `Aislada la línea ${line}: ${count} pieza${count === 1 ? '' : 's'}. El resto del modelo queda oculto.`
      });
    },

    isolateRun: (componentId) => {
      const { graph } = get();
      if (!graph.components.has(componentId)) return;
      const ids = graph.connectedRun(componentId);
      set({
        isolation: { kind: 'run', ids },
        triggerFrameAll: get().triggerFrameAll + 1,
        statusMessage: `Aislado el tramo conectado: ${ids.length} pieza${ids.length === 1 ? '' : 's'}. El resto del modelo queda oculto.`
      });
    },

    clearIsolation: () => {
      if (!get().isolation) return;
      set({ isolation: null, triggerFrameAll: get().triggerFrameAll + 1, statusMessage: 'Se muestra todo el modelo.' });
    },

    toggleLineHidden: (line) => {
      const next = new Set(get().hiddenLines);
      const hiding = !next.has(line);
      if (hiding) next.add(line);
      else next.delete(line);
      const iso = get().isolation;
      const clearIso = hiding && iso?.kind === 'line' && iso.line === line;
      set({
        hiddenLines: next,
        ...(clearIso ? { isolation: null } : {}),
        statusMessage: hiding ? `Línea ${line} ocultada.` : `Línea ${line} visible.`
      });
    },

    showAllLines: () => {
      if (!get().isolation && get().hiddenLines.size === 0) return;
      set({
        isolation: null,
        hiddenLines: new Set<string>(),
        triggerFrameAll: get().triggerFrameAll + 1,
        statusMessage: 'Se muestran todas las líneas del modelo.'
      });
    },

    toggleMeasure: (on) => {
      const next = on ?? !get().measureActive;
      set({
        measureActive: next,
        measurePoints: [],
        statusMessage: next ? 'Medir: tocá el primer punto sobre una pieza (se pega a bocas y ejes).' : 'Medir terminado.'
      });
    },

    addMeasurePoint: (point) => {
      const prev = get().measurePoints;
      // Con una medida completa, el toque siguiente empieza otra
      const points = prev.length >= 2 ? [point.clone()] : [...prev, point.clone()];
      if (points.length < 2) return set({ measurePoints: points, statusMessage: 'Medir: tocá el segundo punto.' });
      const d = points[1].clone().sub(points[0]);
      set({
        measurePoints: points,
        statusMessage: `Distancia ${Math.round(d.length())} mm • ΔX ${Math.round(Math.abs(d.x))} • ΔY ${Math.round(Math.abs(d.y))} • ΔZ ${Math.round(Math.abs(d.z))}`
      });
    },

    setSectionAround: (marginMm) => {
      const { graph, selectedComponentId, selectedPortId } = get();
      const box = new THREE.Box3();
      const comp = selectedComponentId ? graph.components.get(selectedComponentId) : null;
      const port = selectedPortId ? graph.ports.get(selectedPortId) : null;
      let around = 'todo el modelo';
      if (comp) {
        for (const p of comp.ports) box.expandByPoint(p.position);
        for (const pt of comp.centerline) box.expandByPoint(pt);
        around = 'la pieza elegida';
      } else if (port) {
        box.expandByPoint(port.position);
        around = 'la boca activa';
      } else {
        for (const c of graph.components.values()) for (const p of c.ports) box.expandByPoint(p.position);
      }
      if (box.isEmpty()) return set({ statusMessage: 'Caja de corte: no hay modelo para cortar.' });
      box.expandByScalar(Math.max(100, marginMm));
      set({
        sectionBox: { min: box.min.toArray() as [number, number, number], max: box.max.toArray() as [number, number, number] },
        statusMessage: `Caja de corte a ${Math.round(marginMm)} mm alrededor de ${around}. Lo de afuera no se dibuja.`
      });
    },

    nudgeSection: (axis, side, deltaMm) => {
      const box = get().sectionBox;
      if (!box) return;
      const next: SectionBox = { min: [...box.min], max: [...box.max] };
      next[side][axis] += deltaMm;
      // La caja no se da vuelta: queda al menos de 100 mm
      if (next.max[axis] - next.min[axis] < 100) return;
      set({ sectionBox: next });
    },

    clearSection: () => {
      if (!get().sectionBox) return;
      set({ sectionBox: null, statusMessage: 'Caja de corte apagada.' });
    },

    setTurnAngle: (deg) => {
      const angle = deg !== null && deg > 0 && deg < 90 ? deg : null;
      set({ turnAngleDeg: angle });
      const last = get().routeAxis;
      if (last) get().setActiveDirection(last.axis);
      set({
        statusMessage:
          angle === null
            ? 'Giro a eje: la línea sale derecho por el eje que toques.'
            : `Giro libre de ${angle}°: tocá el eje hacia donde se desvía la línea.`
      });
    },

    setSlope: (pct) => {
      const slope = Number.isFinite(pct) ? THREE.MathUtils.clamp(pct, -8, 8) : 0;
      set({ slopePct: slope });
      const last = get().routeAxis;
      if (last) get().setActiveDirection(last.axis);
      set({
        statusMessage:
          slope === 0
            ? 'Pendiente apagada: los tramos horizontales salen a nivel.'
            : `Pendiente de ${Math.abs(slope)}% ${slope > 0 ? 'subiendo' : 'bajando'} en los tramos horizontales (${Math.abs(slope) * 10} mm por metro).`
      });
    },

    applyOffset: (offset, angleDeg, tailMm) => {
      const { graph, specReader, selectedPortId, specCode } = get();
      const port = selectedPortId ? graph.ports.get(selectedPortId) : null;
      if (!specReader || !port || port.connectedJointId) {
        set({ statusMessage: 'Desvío: primero tocá la boca libre desde la que sale la línea.' });
        return;
      }
      const nd = port.nominalDiameter;
      const pipeSpec = specReader.findPipe(nd, specCode);
      if (!pipeSpec) return set({ statusMessage: `Desvío: la spec no tiene caño de ${nd}".` });
      const elbow = elbowForTurn(nd, angleDeg, port);
      if ('error' in elbow) return set({ statusMessage: `Desvío: ${elbow.error}` });
      const minNipple = Math.max(50, 2 * pipeSpec.outerDiameter);
      const dir = port.direction.clone().normalize();
      const plan = planOffset(dir, offset, angleDeg, elbow.takeOff, minNipple);
      if ('error' in plan) return set({ statusMessage: `Desvío: ${plan.error}` });
      const tail = tailMm && tailMm > 0 ? tailMm : Math.ceil((elbow.takeOff + minNipple) / 10) * 10;
      set({ nominalDiameter: nd });
      const failed = traceLegs([
        { dir: plan.travelDir, length: plan.travelLength },
        { dir, length: tail }
      ]);
      if (failed) return set({ statusMessage: `Desvío: no se pudo armar. ${failed}` });
      set({
        routeAxis: null,
        statusMessage: `Desvío de ${Math.round(plan.offset)} mm con dos codos de ${angleDeg}°: diagonal de ${Math.round(plan.travelLength)} mm entre vértices, avanza ${Math.round(plan.advance)} mm.`
      });
    },

    goToElevation: (target, ref) => {
      const { graph, selectedPortId } = get();
      const port = selectedPortId ? graph.ports.get(selectedPortId) : null;
      if (!port || port.connectedJointId || !Number.isFinite(target)) {
        set({ statusMessage: 'Elevación: primero tocá la boca libre desde la que sale la línea.' });
        return;
      }
      const targetCl = centerlineForElevation(target, ref, port.outerDiameter);
      // El tramo vertical se mide desde el vértice del codo: si el caño anterior no se puede recortar,
      // el vértice queda un centro a cara más adelante (importa cuando la línea viene con pendiente)
      let fromZ = port.position.z;
      const vertical = Math.abs(port.direction.z) > 0.99;
      if (!vertical && Math.abs(port.direction.z) > 1e-6) {
        const up0 = new THREE.Vector3(0, 0, targetCl > fromZ ? 1 : -1);
        const bend = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(port.direction.dot(up0), -1, 1)));
        const elbow = elbowForTurn(port.nominalDiameter, bend, port);
        const prev = graph.components.get(port.componentId);
        if (!('error' in elbow)) {
          const prevLen = prev?.type === 'PIPE' ? prev.ports[0].position.distanceTo(prev.ports[1].position) : 0;
          const canCut = prevLen >= elbow.takeOff + Math.max(50, 2 * port.outerDiameter);
          if (!canCut) fromZ += port.direction.z * elbow.takeOff;
        }
      }
      const delta = targetCl - fromZ;
      const name = ref === 'CL' ? 'el eje' : ref === 'BOP' ? 'el fondo de caño (BOP)' : 'el lomo de caño (TOP)';
      if (Math.abs(delta) < 1) return set({ statusMessage: `Elevación: ${name} ya está en ${Math.round(target)} mm.` });
      const up = delta > 0;
      if (vertical && port.direction.z > 0 !== up) {
        set({ statusMessage: `Elevación: la boca mira hacia ${up ? 'abajo' : 'arriba'} y hay que ${up ? 'subir' : 'bajar'}. Salí primero en horizontal.` });
        return;
      }
      const dir = new THREE.Vector3(0, 0, up ? 1 : -1);
      set({
        activeDirection: dir,
        routeAxis: { axis: dir.clone(), result: dir.clone() },
        numpadValue: String(Math.round(Math.abs(delta) * 10) / 10),
        statusMessage: `Elevación: ${up ? 'subí' : 'bajá'} ${Math.round(Math.abs(delta))} mm para dejar ${name} en ${Math.round(target)} mm. Tocá TRAZAR.`
      });
    },

    addBranchOnPipe: (componentId, offsetMm, dir, branchNd) => {
      const { graph, specReader, specCode } = get();
      const pipe = graph.components.get(componentId);
      if (!specReader || !pipe || pipe.type !== 'PIPE') return;
      const headerNd = pipe.parameters.nominalDiameter;
      const branchSpec = specReader.findPipe(branchNd, specCode);
      if (!branchSpec) return set({ statusMessage: `Derivación: la spec no tiene caño de ${branchNd}".` });
      const oletSpec =
        branchNd < headerNd ? specReader.findFitting({ partType: 'OLET', nominalDiameter: headerNd, reducedNominalDiameter: branchNd }) : null;
      pushUndoSnapshot();
      try {
        const comp = graph.addBranchOnPipe(componentId, offsetMm, dir, branchSpec, oletSpec);
        const port = comp.ports[0];
        saveGraphToIndexedDb(graph.serialize());
        set({
          selectedPortId: port.id,
          selectedComponentId: comp.id,
          activeDirection: port.direction.clone().normalize(),
          routeAxis: null,
          nominalDiameter: branchNd,
          collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
          version: get().version + 1,
          statusMessage: oletSpec
            ? `Derivación con ${oletSpec.shortDescription}. Seguí trazando el ramal de ${branchNd}".`
            : `Injerto directo (stub-in) de ${branchNd}" sobre ${headerNd}": la spec no tiene olet para esa medida. Seguí trazando el ramal.`
        });
      } catch (e) {
        undoSnapshots.pop();
        set({ canUndo: undoSnapshots.length > 0, statusMessage: `Derivación: ${(e as Error).message}` });
      }
    },

    changeRunDiameter: (newNd) => {
      const { graph, specReader, selectedComponentId, selectedPortId } = get();
      const comp = selectedComponentId ? graph.components.get(selectedComponentId) : null;
      if (!specReader || !comp) return set({ statusMessage: 'Cambiar diámetro: elegí primero una pieza del tramo.' });
      pushUndoSnapshot();
      try {
        const res = resizeRun(graph, specReader, comp.id, newNd);
        saveGraphToIndexedDb(graph.serialize());
        const active = selectedPortId ? graph.ports.get(selectedPortId) : null;
        set({
          nominalDiameter: active ? active.nominalDiameter : get().nominalDiameter,
          collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
          version: get().version + 1,
          statusMessage:
            `Tramo pasado de ${formatSize(res.from)} a ${formatSize(res.to)}: ${res.changed} pieza${res.changed > 1 ? 's' : ''} cambiada${res.changed > 1 ? 's' : ''}; los ejes no se movieron.` +
            (res.notes.length ? ` ⚠ ${res.notes.join(' ')}` : '')
        });
      } catch (e) {
        // El cambio se calcula entero antes de tocar el modelo; por las dudas se vuelve al estado anterior
        get().undo();
        redoSnapshots.pop();
        set({ canRedo: redoSnapshots.length > 0, statusMessage: `Cambiar diámetro: ${(e as Error).message}` });
      }
    },

    addDrainOrVent: (componentId, offsetMm, kind) => {
      const { graph, specReader } = get();
      const pipe = graph.components.get(componentId);
      if (!specReader || !pipe || pipe.type !== 'PIPE' || pipe.ports.length < 2) return;
      const label = kind === 'purga' ? 'Purga' : 'Venteo';
      const headerNd = pipe.parameters.nominalDiameter;
      const sizes = specReader.getAvailableNominalDiameters().filter((n) => n < headerNd - 1e-6);
      const hasOlet = (n: number) => !!specReader.findFitting({ partType: 'OLET', nominalDiameter: headerNd, reducedNominalDiameter: n });
      const preferred = [0.75, 1, 0.5, 1.5, 2].filter((n) => sizes.some((s) => Math.abs(s - n) < 1e-6));
      const branchNd = preferred.find(hasOlet) ?? preferred[0] ?? sizes[0];
      if (branchNd === undefined) {
        set({ statusMessage: `${label}: la spec no tiene un diámetro más chico que ${formatSize(headerNd)} para el ramal.` });
        return;
      }
      const axis = pipe.ports[1].position.clone().sub(pipe.ports[0].position).normalize();
      const vertical = Math.abs(axis.z) > 0.9;
      const dir = vertical ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, kind === 'purga' ? -1 : 1);

      const undoBefore = undoSnapshots.length;
      const keepNumpad = get().numpadValue;
      const keepNd = get().nominalDiameter;
      const count = () => get().graph.components.size;
      const rollback = (why: string) => {
        if (undoSnapshots.length > undoBefore) {
          undoSnapshots.length = undoBefore + 1;
          get().undo();
          redoSnapshots.pop();
        }
        set({ canRedo: redoSnapshots.length > 0, numpadValue: keepNumpad, nominalDiameter: keepNd, statusMessage: `${label}: no se pudo armar. ${why}` });
      };
      /** Un paso del armado; devuelve false si no agregó nada */
      const step = (fn: () => void) => {
        const before = count();
        fn();
        return count() > before;
      };
      const nipple = (mm: number) =>
        step(() => {
          set({ numpadValue: String(mm) });
          get().insertFitting('PIPE');
        });

      connectExecuting = true;
      try {
        if (!step(() => get().addBranchOnPipe(componentId, offsetMm, dir, branchNd))) return;
        if (!nipple(100)) return rollback(get().statusMessage);

        // Válvula que entre directo en el niple (socket o a tope); si no hay, la que elija la spec
        const nipplePort = get().selectedPortId ? get().graph.ports.get(get().selectedPortId!) : null;
        const families = specReader.listFamilies('VALVE', branchNd);
        const score = (fam: (typeof families)[number]) => {
          const end = (fam.endTypes[0] || '').toUpperCase();
          const kindOrder = ['gate', 'ball', 'globe', 'plug'].indexOf(valveKindFrom(fam.familyDesc));
          const face = ['FL', 'LFL', 'WF', 'LUG'].includes(end);
          const fits =
            nipplePort && end
              ? get().graph.resolveJoint({ ...nipplePort, plantEndType: end, endType: nipplePort.endType } as Port, nipplePort).problems.length === 0
              : true;
          return (face ? 50 : 0) + (fits ? 0 : 100) + (end === 'SW' ? 0 : 5) + (kindOrder < 0 ? 9 : kindOrder);
        };
        const family = [...families].sort((a, b) => score(a) - score(b))[0];
        if (!step(() => get().insertFitting('VALVE', family ? { familyId: family.familyId } : undefined))) return rollback(get().statusMessage);

        // Cierre: brida ciega si quedó una cara, o niple con tapa
        const out = get().selectedPortId ? get().graph.ports.get(get().selectedPortId!) : null;
        let closed: string;
        if (out && isFaceEnd(out)) {
          closed = step(() => get().insertFitting('FLANGE', { blind: true })) ? 'brida ciega' : '';
        } else {
          closed = nipple(75) && step(() => get().insertFitting('CAP')) ? 'niple con tapa' : '';
        }

        undoSnapshots.length = undoBefore + 1;
        const where = vertical ? 'hacia +X (el caño es vertical)' : kind === 'purga' ? 'hacia abajo' : 'hacia arriba';
        set({
          numpadValue: keepNumpad,
          nominalDiameter: keepNd,
          canUndo: true,
          selectedPortId: closed ? null : get().selectedPortId,
          statusMessage: closed
            ? `${label} de ${formatSize(branchNd)} ${where}: derivación, niple, válvula y ${closed}.`
            : `${label} de ${formatSize(branchNd)} ${where}: derivación, niple y válvula. ⚠ La spec no tiene con qué cerrarla: quedó la boca abierta.`
        });
      } finally {
        connectExecuting = false;
      }
    },

    startAlignPicking: () => {
      const { graph, selectedPortId, alignPicking } = get();
      if (alignPicking) return set({ alignPicking: false, statusMessage: 'Alinear: cancelado.' });
      const port = selectedPortId ? graph.ports.get(selectedPortId) : null;
      if (!port || port.connectedJointId) {
        set({ statusMessage: 'Alinear: primero tocá la boca libre desde la que sale la línea.' });
        return;
      }
      if (get().connectPicking || get().connectRoutes.length) get().cancelConnect();
      set({ alignPicking: true, statusMessage: 'Alinear: tocá la boca o la pieza con la que tiene que quedar alineado el tramo.' });
    },

    pickAlignTarget: (point) => {
      const { graph, selectedPortId, activeDirection } = get();
      const port = selectedPortId ? graph.ports.get(selectedPortId) : null;
      if (!port || port.connectedJointId) return set({ alignPicking: false, statusMessage: 'Alinear: no hay una boca activa libre.' });
      const dir = activeDirection.clone().normalize();
      const dist = point.clone().sub(port.position).dot(dir);
      const axisName = (['X', 'Y', 'Z'] as const).find((_, i) => Math.abs(dir.getComponent(i)) > 0.99);
      const along = axisName ? `${dir.getComponent(['X', 'Y', 'Z'].indexOf(axisName)) > 0 ? '+' : '−'}${axisName}` : 'la dirección elegida';
      if (dist < 1) {
        set({
          alignPicking: false,
          statusMessage:
            dist > -1
              ? `Alinear: la boca ya está alineada con esa referencia en ${along}.`
              : `Alinear: esa referencia queda ${Math.round(-dist)} mm hacia atrás en ${along}. Elegí la otra dirección y probá de nuevo.`
        });
        return;
      }
      set({
        alignPicking: false,
        numpadValue: String(Math.round(dist * 10) / 10),
        statusMessage: `Alinear: ${Math.round(dist)} mm en ${along} para quedar alineado con la referencia. Tocá TRAZAR.`
      });
    },

    goToCoordinate: (target) => {
      const { graph, selectedPortId } = get();
      const port = selectedPortId ? graph.ports.get(selectedPortId) : null;
      if (!port || port.connectedJointId) {
        set({ statusMessage: 'Ir a coordenada: primero tocá la boca libre desde la que sale la línea.' });
        return;
      }
      if (![target.x, target.y, target.z].every(Number.isFinite)) return set({ statusMessage: 'Ir a coordenada: faltan valores de X, Y o Z.' });
      const delta = target.clone().sub(port.position);
      if (delta.length() < 1) return set({ statusMessage: 'Ir a coordenada: la boca ya está en ese punto.' });
      const names = ['X', 'Y', 'Z'];
      const own = [0, 1, 2].find((i) => Math.abs(port.direction.getComponent(i)) > 0.999);
      if (own === undefined) {
        set({ statusMessage: 'Ir a coordenada: la boca sale en diagonal o con pendiente. Trazá primero un tramo sobre un eje.' });
        return;
      }
      const sign = Math.sign(port.direction.getComponent(own));
      const ahead = delta.getComponent(own) * sign;
      if (ahead < -1) {
        set({
          statusMessage: `Ir a coordenada: el punto queda ${Math.round(-ahead)} mm hacia atrás de la boca en ${names[own]}. Salí primero hacia un costado.`
        });
        return;
      }
      const unit = (i: number, s: number) => new THREE.Vector3(i === 0 ? s : 0, i === 1 ? s : 0, i === 2 ? s : 0);
      const legs: { dir: THREE.Vector3; length: number }[] = [];
      if (ahead >= 1) legs.push({ dir: unit(own, sign), length: ahead });
      [0, 1, 2]
        .filter((i) => i !== own && Math.abs(delta.getComponent(i)) >= 1)
        .sort((a, b) => Math.abs(delta.getComponent(b)) - Math.abs(delta.getComponent(a)))
        .forEach((i) => legs.push({ dir: unit(i, Math.sign(delta.getComponent(i))), length: Math.abs(delta.getComponent(i)) }));
      set({ nominalDiameter: port.nominalDiameter });
      const failed = traceLegs(legs);
      if (failed) return set({ statusMessage: `Ir a coordenada: no se pudo armar. ${failed}` });
      const end = get().selectedPortId ? get().graph.ports.get(get().selectedPortId!) : null;
      const miss = end ? end.position.distanceTo(target) : 0;
      if (miss > 2) {
        // No se llega exacto: no dejar una línea que termina en otro lado
        get().undo();
        redoSnapshots.pop();
        set({
          canRedo: redoSnapshots.length > 0,
          statusMessage: `Ir a coordenada: desde esta boca no se llega exacto (quedaría a ${Math.round(miss)} mm, por el codo de salida). Trazá antes un tramo recto y probá de nuevo.`
        });
        return;
      }
      set({
        routeAxis: null,
        statusMessage: `Línea llevada a X ${Math.round(target.x)} · Y ${Math.round(target.y)} · Z ${Math.round(target.z)} en ${legs.length} tramo${legs.length > 1 ? 's' : ''}.`
      });
    },

    addSupportOnPipe: (componentId, offsetMm, kind) => {
      const { graph } = get();
      pushUndoSnapshot();
      try {
        const mark = graph.addSupport(componentId, offsetMm, kind);
        saveGraphToIndexedDb(graph.serialize());
        const names: Record<SupportKind, string> = { APOYO: 'Apoyo', GUIA: 'Guía', ANCLAJE: 'Anclaje', COLGANTE: 'Colgante' };
        // Queda elegido para completarle el tipo de Plant, el tag y la altura
        set({
          version: get().version + 1,
          selectedSupportId: mark.id,
          selectedComponentId: null,
          statusMessage: `${names[kind]} marcado en el caño, a elevación ${Math.round(mark.position.z)} mm de eje. Completá su tipo de Plant y su tag.`
        });
      } catch (e) {
        undoSnapshots.pop();
        set({ canUndo: undoSnapshots.length > 0, statusMessage: (e as Error).message });
      }
    },

    removeSupport: (supportId) => {
      const { graph } = get();
      if (!graph.supports.has(supportId)) return;
      pushUndoSnapshot();
      graph.removeSupport(supportId);
      saveGraphToIndexedDb(graph.serialize());
      set({
        version: get().version + 1,
        selectedSupportId: get().selectedSupportId === supportId ? null : get().selectedSupportId,
        statusMessage: 'Soporte quitado.'
      });
    },

    setSelectedSupportId: (supportId) => {
      const mark = supportId ? get().graph.supports.get(supportId) : undefined;
      if (!mark) return set({ selectedSupportId: null });
      set({
        selectedSupportId: mark.id,
        selectedComponentId: null,
        statusMessage: `Elegido: soporte ${mark.tag || mark.plantType || mark.kind.toLowerCase()}.`
      });
    },

    updateSupport: (supportId, patch) => {
      const { graph } = get();
      if (!graph.supports.has(supportId)) return;
      pushUndoSnapshot();
      try {
        const mark = graph.updateSupport(supportId, patch);
        saveGraphToIndexedDb(graph.serialize());
        set({ version: get().version + 1, statusMessage: `Soporte ${mark.tag || mark.plantType || mark.kind.toLowerCase()} actualizado.` });
      } catch (e) {
        undoSnapshots.pop();
        set({ canUndo: undoSnapshots.length > 0, statusMessage: (e as Error).message });
      }
    },

    moveSupport: (supportId, side, mm) => {
      const { graph } = get();
      const mark = graph.supports.get(supportId);
      if (!mark) return;
      const before = mark.position.clone();
      pushUndoSnapshot();
      const problem = moveSupportTo(graph, mark, side, mm);
      if (problem || before.distanceTo(mark.position) < 0.01) {
        undoSnapshots.pop();
        return set({ canUndo: undoSnapshots.length > 0, statusMessage: problem ?? 'El soporte ya está a esa medida.' });
      }
      saveGraphToIndexedDb(graph.serialize());
      set({ version: get().version + 1, statusMessage: `Soporte corrido ${Math.round(before.distanceTo(mark.position))} mm sobre el caño.` });
    },

    setNominalDiameter: (nd) => {
      const { graph, specReader, selectedPortId } = get();
      if (!specReader) return;

      if (selectedPortId) {
        const port = graph.ports.get(selectedPortId);
        // Cambio de diámetro en ruta: reducción (o ampliación) de la spec en la boca activa
        const portNd = port?.nominalDiameter ?? nd;
        if (port && !port.connectedJointId && Math.abs(nd - portNd) > 1e-6) {
          const steps = reducerSteps(portNd, nd, port);
          if (steps.length) {
            pushUndoSnapshot();
            const start = flangeOffFaceIfNeeded(port);
            let current = start.port;
            let last: Component | null = null;
            const notes: string[] = [];
            for (const step of steps) {
              last = graph.addReducer(current, step.spec, step.to > step.from);
              current = last.ports[1];
              const eccentric = (step.spec.lateralOffset ?? 0) > 0.01;
              notes.push(
                `${formatSize(step.from)} a ${formatSize(step.to)}${eccentric ? ' excéntrica (la spec no tiene concéntrica en esa medida)' : ''}`
              );
            }
            saveGraphToIndexedDb(graph.serialize());
            set({
              selectedPortId: current.id,
              selectedComponentId: last!.id,
              activeDirection: current.direction.clone().normalize(),
              nominalDiameter: nd,
              collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
              version: get().version + 1,
              statusMessage: `${steps.length > 1 ? 'Reducciones' : nd > portNd ? 'Ampliación' : 'Reducción'} ${notes.join(' y ')}.${start.note}${geomWarn(steps[0].spec)}`
            });
            return;
          }
          set({
            nominalDiameter: nd,
            statusMessage: `La spec no tiene reducción entre ${formatSize(portNd)} y ${formatSize(nd)}: la boca activa sigue en ${formatSize(portNd)}.`
          });
          return;
        }
      }

      set({ nominalDiameter: nd, statusMessage: `Diámetro activo: ${formatSize(nd)}.` });
    },

    setNumpadValue: (val) => set({ numpadValue: val }),

    appendNumpadDigit: (digit) => {
      const current = get().numpadValue;
      if (digit === '.' && current.includes('.')) return;
      if (current === '0' && digit !== '.') {
        set({ numpadValue: digit });
      } else {
        set({ numpadValue: current + digit });
      }
    },

    backspaceNumpad: () => {
      const current = get().numpadValue;
      if (current.length <= 1) {
        set({ numpadValue: '0' });
      } else {
        set({ numpadValue: current.slice(0, -1) });
      }
    },

    quickAddNumpad: (amount) => {
      const currentNum = parseFloat(get().numpadValue) || 0;
      const newNum = Math.max(0, currentNum + amount);
      set({ numpadValue: newNum.toString() });
    },

    clearNumpad: () => set({ numpadValue: '0' }),

    setSelectedPortId: (portId) => {
      if (!portId) {
        set({ selectedPortId: null });
        return;
      }
      const port = get().graph.ports.get(portId);
      if (port) {
        set({
          selectedPortId: port.id,
          selectedComponentId: port.componentId,
          activeDirection: port.direction.clone().normalize(),
          nominalDiameter: port.connectedJointId ? get().nominalDiameter : port.nominalDiameter || get().nominalDiameter,
          statusMessage: `Boca activa: ${port.index === 3 ? 'ramal' : 'línea'} de ${formatSize(port.nominalDiameter)}, sale ${dirName(port.direction)}.`
        });
      } else {
        set({ selectedPortId: portId });
      }
    },

    setSelectedComponentId: (compId) => {
      if (!compId) {
        set({ selectedComponentId: null, selectedSupportId: null });
        return;
      }
      if (get().selectedSupportId) set({ selectedSupportId: null });
      const comp = get().graph.components.get(compId);
      if (!comp) {
        set({ selectedComponentId: null });
        return;
      }
      // Si el componente tiene algún puerto libre, seleccionarlo automáticamente como puerto activo
      const openPort = comp.ports.find((p) => !p.connectedJointId);
      if (openPort) {
        set({
          selectedComponentId: comp.id,
          selectedPortId: openPort.id,
          activeDirection: openPort.direction.clone().normalize(),
          nominalDiameter: openPort.nominalDiameter || get().nominalDiameter,
          statusMessage: `Elegido: ${comp.parameters.description || pieceName(comp.type)}. Su boca libre quedó activa.`
        });
      } else {
        set({
          selectedComponentId: comp.id,
          statusMessage: `Elegido: ${comp.parameters.description || pieceName(comp.type)}.`
        });
      }
    },

    selectPortAndAlign: (portId) => {
      const port = get().graph.ports.get(portId);
      if (!port) return;
      set({
        selectedPortId: port.id,
        selectedComponentId: port.componentId,
        activeDirection: port.direction.clone().normalize(),
        nominalDiameter: port.nominalDiameter || get().nominalDiameter,
        statusMessage: `Boca activa: ${port.index === 3 ? 'ramal' : 'línea'} de ${formatSize(port.nominalDiameter)}, sale ${dirName(port.direction)}.`
      });
    },

    cycleOpenPort: () => {
      const { graph, selectedPortId } = get();
      const openPorts = graph.getOpenPorts();
      if (openPorts.length === 0) {
        set({ statusMessage: 'No hay bocas libres en el modelo.' });
        return;
      }
      const currentIndex = openPorts.findIndex((p) => p.id === selectedPortId);
      const nextPort = openPorts[(currentIndex + 1) % openPorts.length];
      set({
        selectedPortId: nextPort.id,
        selectedComponentId: nextPort.componentId,
        activeDirection: nextPort.direction.clone().normalize(),
        nominalDiameter: nextPort.nominalDiameter || get().nominalDiameter,
        statusMessage: `Boca ${((currentIndex + 1) % openPorts.length) + 1} de ${openPorts.length}: ${nextPort.index === 3 ? 'ramal' : 'línea'} de ${formatSize(nextPort.nominalDiameter)}.`
      });
    },

    rotateSelectedComponent: (angleDeg = 90) => {
      const { graph, selectedComponentId, selectedPortId } = get();
      const targetId =
        selectedComponentId || (selectedPortId ? graph.ports.get(selectedPortId)?.componentId || null : null);
      if (!targetId) {
        set({ statusMessage: 'Elegí una te, un codo o una válvula para girar.' });
        return;
      }
      try {
        pushUndoSnapshot();
        const updated = graph.rotateComponentAroundRun(targetId, angleDeg);
        if (!updated) {
          undoSnapshots.pop();
          set({ canUndo: undoSnapshots.length > 0, statusMessage: 'Esta pieza no se puede girar sobre el caño.' });
          return;
        }
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        const activePort = selectedPortId ? graph.ports.get(selectedPortId) : null;
        set({
          activeDirection: activePort ? activePort.direction.clone().normalize() : get().activeDirection,
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage:
            updated.type === 'VALVE'
              ? `Volante girado ${angleDeg}°: ahora queda a ${Math.round(updated.parameters.stemAngle ?? 0)}° de la vertical.`
              : `${updated.type === 'TEE' ? 'Ramal de te' : 'Codo'} girado ${angleDeg}° alrededor del caño.`
        });
      } catch (e: unknown) {
        set({ statusMessage: (e as Error).message });
      }
    },

    flipSelectedComponent: () => {
      const { graph, selectedComponentId, selectedPortId } = get();
      const comp = selectedComponentId ? graph.components.get(selectedComponentId) : null;
      const kind = comp ? graph.flipKind(comp.id) : null;
      if (!comp || !kind) {
        set({ statusMessage: 'Se pueden dar vuelta bridas, válvulas y reducciones excéntricas.' });
        return;
      }
      if (kind === 'reducer' && graph.closesLoopThrough(comp.id, comp.ports[1].id)) {
        set({ statusMessage: 'No se puede dar vuelta: la línea cierra un circuito y la salida de la reducción se corre.' });
        return;
      }
      pushUndoSnapshot();
      const res = graph.flipComponent(comp.id);
      if (!res) return;
      saveGraphToIndexedDb(graph.serialize());
      const active = selectedPortId ? graph.ports.get(selectedPortId) : null;
      const warn = res.problems.length ? ` ⚠ ${res.problems[0]}` : '';
      const message =
        kind === 'flange'
          ? 'Brida dada vuelta: la cara quedó del otro lado.'
          : kind === 'valve'
            ? 'Válvula invertida: cambió el sentido de flujo.'
            : `Excéntrica con el plano hacia ${graph.reducerFlatSide(comp.id) ?? 'el otro lado'}; lo conectado a la salida se corrió.`;
      set({
        activeDirection: active ? active.direction.clone().normalize() : get().activeDirection,
        collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
        version: get().version + 1,
        statusMessage: message + warn
      });
    },

    updateSelectedPipeLength: (newLengthMm: number) => {
      const { graph, selectedComponentId, selectedPortId } = get();
      const targetId =
        selectedComponentId || (selectedPortId ? graph.ports.get(selectedPortId)?.componentId || null : null);
      if (!targetId || isNaN(newLengthMm) || newLengthMm <= 10) return;

      pushUndoSnapshot();
      const updated = graph.updatePipeLength(targetId, newLengthMm);
      if (!updated) {
        set({ statusMessage: 'Elegí un caño para cambiarle el largo.' });
        return;
      }
      saveGraphToIndexedDb(graph.serialize());
      const collisions = detectPipingCollisions(graph);
      set({
        collidingComponentIds: collisions.collidingComponentIds,
        version: get().version + 1,
        statusMessage: `Largo del caño: ${newLengthMm.toFixed(0)} mm (lo que sigue se corrió con él).`
      });
    },

    updatePipeEndFinishes: (componentId, endFinish1, endFinish2) => {
      const { graph } = get();
      pushUndoSnapshot();
      const updated = graph.updatePipeEndFinishes(componentId, endFinish1, endFinish2);
      if (!updated) return;
      saveGraphToIndexedDb(graph.serialize());
      set({
        version: get().version + 1,
        statusMessage: `Extremos del caño: ${endFinish1} / ${endFinish2}.`
      });
    },

    setFieldWeld: (jointId, kind, allowanceMm) => {
      const { graph } = get();
      pushUndoSnapshot();
      const joint = graph.setFieldWeld(jointId, kind, allowanceMm);
      if (!joint) return;
      saveGraphToIndexedDb(graph.serialize());
      set({
        version: get().version + 1,
        statusMessage: kind
          ? `Soldadura de campo ${kind}${kind === 'FFW' ? ` (sobrelargo ${joint.fieldAllowanceMm} mm)` : ''}: corta el spool.`
          : 'Soldadura de taller: las dos piezas quedan en el mismo spool.'
      });
    },

    toggleSpoolView: () => set((st) => ({ spoolView: !st.spoolView, version: st.version + 1 })),
    toggleSpools: () => set((st) => ({ isSpoolsOpen: !st.isSpoolsOpen })),

    updateComponentMetadata: (componentId, metadata) => {
      const { graph } = get();
      pushUndoSnapshot();
      const updated = graph.updateComponentMetadata(componentId, metadata);
      if (!updated) return;
      saveGraphToIndexedDb(graph.serialize());
      set({
        version: get().version + 1,
        statusMessage: `Datos guardados: ${pieceNameLower(updated.type)}${metadata.nippleTag || metadata.lineNumber ? ` ${metadata.nippleTag || metadata.lineNumber}` : ''}.`
      });
    },

    splitSelectedPipeWithFitting: (fittingType, offsetMm, branchDir) => {
      const { graph, specReader, selectedComponentId, specCode, activeDirection } = get();
      if (!specReader || !selectedComponentId) {
        set({ statusMessage: 'Elegí primero un caño para partirlo.' });
        return;
      }
      const pipeComp = graph.components.get(selectedComponentId);
      if (!pipeComp || pipeComp.type !== 'PIPE') {
        set({ statusMessage: 'La pieza elegida no es un caño.' });
        return;
      }

      const nd = pipeComp.parameters.nominalDiameter || get().nominalDiameter;
      const pipeSpec = specReader.findPipe(nd, specCode);
      const fitSpec =
        fittingType === 'TEE'
          ? specReader.findTee(nd, specCode)
          : fittingType === 'VALVE'
          ? specReader.findValve(nd, specCode)
          : specReader.findFlange(nd, specCode);

      if (!pipeSpec || !fitSpec) {
        set({ statusMessage: `La spec no tiene ${pieceNameLower(fittingType)} de ${formatSize(nd)}.` });
        return;
      }

      const cls = fitSpec.pressureClass;
      const gasketSpec = specReader.findGasket(nd, specCode, { pressureClass: cls });
      const boltSetSpec = specReader.findBoltSet(nd, specCode, { pressureClass: cls });
      const flangeSpec = fittingType === 'TEE' ? null : specReader.findFlange(nd, specCode, { connectToEndType: 'PL', pressureClass: cls });

      try {
        pushUndoSnapshot();
        const result = graph.splitPipeWithFitting(pipeComp.id, fitSpec, pipeSpec, {
          offsetMm,
          branchDir: branchDir || activeDirection,
          gasketSpec,
          boltSetSpec,
          flangeSpec
        });
        if (!result) return;

        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        const nextPort =
          result.fitting.type === 'TEE' && result.fitting.ports[2]
            ? result.fitting.ports[2]
            : result.pipe2.ports[1];

        set({
          selectedComponentId: result.fitting.id,
          selectedPortId: nextPort.id,
          activeDirection: nextPort.direction.clone().normalize(),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `Caño partido en dos (${Math.round(result.pipe1.parameters.cutLength || 0)} mm y ${Math.round(result.pipe2.parameters.cutLength || 0)} mm) con ${aPiece(fittingType)} en el medio.`
        });
      } catch (e: unknown) {
        set({ statusMessage: (e as Error).message });
      }
    },

    setLineNumber: (tag) => {
      const { graph } = get();
      graph.activeLineNumber = tag;
      set({ lineNumber: tag, statusMessage: `Línea activa: ${tag}` });
    },

    importPcfFile: (content, fileName) => {
      try {
        pushUndoSnapshot();
        const { specReader, specCode } = get();
        const {
          graph: importedGraph,
          componentCount,
          pipeCount,
          lineReference,
          skipped,
          warnings
        } = PcfImporter.importFromPcf(content, specReader, specCode, {
          connectionRules: get().graph.connectionRules,
          sourceName: fileName
        });
        if (componentCount === 0) {
          set({ statusMessage: `"${fileName}" no tiene piezas de PCF que se puedan leer.` });
          return null;
        }
        undoSnapshots = [];
        redoSnapshots = [];
        const openPorts = importedGraph.getOpenPorts();
        const lastPort = openPorts.length > 0 ? openPorts[openPorts.length - 1] : null;
        const collisions = detectPipingCollisions(importedGraph);

        set({
          graph: importedGraph,
          lineNumber: lineReference,
          selectedPortId: lastPort ? lastPort.id : null,
        nominalDiameter: lastPort ? lastPort.nominalDiameter : get().nominalDiameter,
          selectedComponentId: lastPort ? lastPort.componentId : null,
          activeDirection: lastPort ? lastPort.direction.clone().normalize() : new THREE.Vector3(1, 0, 0),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          triggerFrameAll: get().triggerFrameAll + 1,
          statusMessage: `"${fileName}" cargado (${componentCount} piezas, ${pipeCount} caños, línea ${lineReference}, ${openPorts.length} bocas libres).${
            Object.keys(skipped).length
              ? ` Omitidos (Plant los regenera): ${Object.entries(skipped).map(([k, n]) => `${n} ${k}`).join(', ')}.`
              : ''
          }${warnings.length ? ` Avisos: ${warnings.join(' ')}` : ''}`,
          canUndo: false,
          canRedo: false
        });
        return importedGraph.serialize();
      } catch (e: unknown) {
        set({ statusMessage: `No se pudo importar el PCF: ${(e as Error).message}` });
        return null;
      }
    },

    deleteSelectedComponent: () => {
      const { graph, selectedComponentId, selectedPortId } = get();
      const targetId =
        selectedComponentId || (selectedPortId ? graph.ports.get(selectedPortId)?.componentId || null : null);
      if (!targetId) {
        set({ statusMessage: 'Elegí una pieza para borrarla.' });
        return;
      }
      pushUndoSnapshot();
      const removed = graph.removeComponent(targetId);
      saveGraphToIndexedDb(graph.serialize());
      const openPorts = graph.getOpenPorts();
      const nextPort = openPorts.length > 0 ? openPorts[openPorts.length - 1] : null;
      const collisions = detectPipingCollisions(graph);
      set({
        selectedComponentId: nextPort ? nextPort.componentId : null,
        selectedPortId: nextPort ? nextPort.id : null,
        activeDirection: nextPort ? nextPort.direction.clone().normalize() : get().activeDirection,
        collidingComponentIds: collisions.collidingComponentIds,
        version: get().version + 1,
        statusMessage: removed
          ? `${pieceName(removed.type)} de ${formatSize(removed.parameters.nominalDiameter)} borrada del modelo.`
          : 'Pieza borrada.'
      });
    },

    setCameraViewPreset: (preset) => {
      const seq = (get().cameraViewPreset?.seq || 0) + 1;
      switch (preset) {
        case 'TOP':
          set({ cameraViewPreset: { azimuth: 0, polar: 0.02, seq } });
          break;
        case 'FRONT':
          set({ cameraViewPreset: { azimuth: 0, polar: Math.PI / 2 - 0.02, seq } });
          break;
        case 'RIGHT':
          set({ cameraViewPreset: { azimuth: Math.PI / 2, polar: Math.PI / 2 - 0.02, seq } });
          break;
        case 'ISO':
        default:
          set({ cameraViewPreset: { azimuth: -Math.PI / 4, polar: Math.PI / 3, seq } });
          break;
      }
    },

    setSnappedPortId: (portId) => set({ snappedPortId: portId }),

    startFromNozzle: (position, direction, nominalDiameter, label) => {
      const { graph, specReader, specCode } = get();
      if (!specReader) return;

      const start = position.clone();
      const dir = direction.clone().normalize();

      // Si ya hay una boca libre pegada a esa boquilla, solo la activamos
      for (const port of graph.getOpenPorts()) {
        if (port.position.distanceTo(start) < 25) {
          set({
            selectedPortId: port.id,
            selectedComponentId: port.componentId,
            activeDirection: port.direction.clone().normalize(),
            nominalDiameter: port.nominalDiameter || nominalDiameter,
            statusMessage: `Boca activa en ${label} (${formatSize(port.nominalDiameter)}).`
          });
          return;
        }
      }

      const pipeSpec =
        specReader.findPipe(nominalDiameter, specCode) ??
        specReader.findPipe(get().nominalDiameter, specCode);
      if (!pipeSpec) {
        set({ statusMessage: `La spec no tiene caño de ${formatSize(nominalDiameter)} para ${label}.` });
        return;
      }

      const initLen = Math.max(400, Math.round(pipeSpec.outerDiameter * 4));
      pushUndoSnapshot();
      const end = start.clone().addScaledVector(dir, initLen);
      const pipe = graph.addPipe(start, end, pipeSpec, initLen);
      saveGraphToIndexedDb(graph.serialize());
      const collisions = detectPipingCollisions(graph);
      set({
        selectedPortId: pipe.ports[1].id,
        selectedComponentId: pipe.id,
        activeDirection: dir.clone(),
        nominalDiameter: pipeSpec.nominalDiameter,
        collidingComponentIds: collisions.collidingComponentIds,
        version: get().version + 1,
        statusMessage: `Tramo de ${initLen} mm iniciado desde boquilla ${label} (${formatSize(pipeSpec.nominalDiameter)}).`
      });
    },

    applyRouting: () => {
      const {
        graph,
        specReader,
        numpadValue,
        activeDirection,
        nominalDiameter,
        selectedPortId,
        specCode
      } = get();

      if (!specReader) return;

      const lengthMm = parseFloat(numpadValue);
      if (isNaN(lengthMm) || lengthMm <= 0) {
        set({ statusMessage: 'Largo inválido: escribí un valor mayor a cero, en milímetros.' });
        return;
      }

      const pipeSpec = specReader.findPipe(nominalDiameter, specCode);
      if (!pipeSpec) {
        set({ statusMessage: `La spec no tiene caño de ${formatSize(nominalDiameter)}.` });
        return;
      }

      // Regla de niple mínimo: no permitir tramos rectos menores a max(50 mm, 2 * OD)
      const minNipple = Math.max(50, 2 * pipeSpec.outerDiameter);

      // Sin boca activa (se tocó el fondo) no se elige una por el usuario
      if (!selectedPortId && graph.components.size > 0) {
        set({ statusMessage: 'Tocá una boca libre para seguir trazando desde ahí.' });
        return;
      }

      // Determinar puerto de inicio (prioridad estricta al puerto activo seleccionado)
      let connectingPort = selectedPortId ? graph.ports.get(selectedPortId) : null;
      if (!connectingPort || connectingPort.connectedJointId) {
        const openPorts = graph.getOpenPorts();
        if (openPorts.length > 0) {
          connectingPort = openPorts[openPorts.length - 1];
        } else {
          connectingPort = null;
        }
      }

      const dir = activeDirection.clone().normalize();

      // Saliendo de una cara de brida: primero la brida de la spec (AutoFlange de Plant)
      let snapshotTaken = false;
      const snap = () => {
        if (!snapshotTaken) {
          pushUndoSnapshot();
          snapshotTaken = true;
        }
      };
      let autoNote = '';
      if (connectingPort && isFaceEnd(connectingPort)) {
        snap();
        const res = flangeOffFaceIfNeeded(connectingPort);
        connectingPort = res.port;
        autoNote = res.note;
      }

      // CASO 1: Tramo inicial desde el origen si no hay caños
      if (!connectingPort) {
        snap();
        const startPoint = new THREE.Vector3(0, 0, 0);
        const endPoint = startPoint.clone().add(dir.clone().multiplyScalar(lengthMm));
        const pipe = graph.addPipe(startPoint, endPoint, pipeSpec, lengthMm);
        
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: pipe.ports[1].id,
          selectedComponentId: pipe.id,
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `Primer tramo de ${lengthMm} mm trazado.`
        });
        return;
      }

      // CASO 2: Conexión a un puerto existente
      const startPoint = connectingPort.position.clone();
      const incomingDirection = connectingPort.direction.clone();
      const prevComponent = graph.components.get(connectingPort.componentId);

      const dot = incomingDirection.dot(dir);
      const isStraight = dot > 0.99;
      const isOpposed = dot < -0.99;

      if (isOpposed) {
        set({
          statusMessage: 'No se puede volver hacia atrás (180°). Elegí otra dirección.'
        });
        return;
      }

      if (isStraight) {
        // Continuación recta
        snap();
        const endPoint = startPoint.clone().add(dir.clone().multiplyScalar(lengthMm));
        const pipe = graph.addPipe(startPoint, endPoint, pipeSpec, lengthMm);
        graph.connectPorts(connectingPort.id, pipe.ports[0].id);

        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: pipe.ports[1].id,
          selectedComponentId: pipe.id,
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `Caño de ${lengthMm} mm agregado.${autoNote}`
        });
        return;
      }

      // CASO 3: Giro angular (de eje a eje - vértice V)
      // Calcular ángulo de deflexión entre la dirección entrante (uIn) y saliente (dir)
      const uIn = incomingDirection.clone().normalize();
      const uOut = dir.clone().normalize();
      const bendAngleRad = Math.acos(THREE.MathUtils.clamp(uIn.dot(uOut), -1, 1));
      const bendAngleDeg = THREE.MathUtils.radToDeg(bendAngleRad);

      // Codo de catálogo si el giro da 45° o 90° (con tolerancia); si no, recortado al ángulo
      const turn = elbowForTurn(nominalDiameter, bendAngleDeg, connectingPort);
      if ('error' in turn) {
        set({ statusMessage: turn.error });
        return;
      }
      const elbowSpec = turn.spec;
      const takeOff = turn.takeOff;
      const addElbow = (placement: Parameters<typeof graph.addElbow>[0]) => {
        const elbow = graph.addElbow(placement, elbowSpec);
        if (turn.trimmedFrom) {
          elbow.parameters.trimmedFrom = turn.trimmedFrom;
          elbow.parameters.takeOff = takeOff;
          elbow.parameters.description = `${elbowSpec.shortDescription} · recortado a ${bendAngleDeg.toFixed(1)}°`;
        }
        return elbow;
      };

      let pStart = startPoint.clone();
      let vertex = startPoint.clone();
      let canCutPreviousPipe = false;
      let prevPipeComp = prevComponent;

      if (prevPipeComp && prevPipeComp.type === 'PIPE' && prevPipeComp.centerline.length >= 2) {
        const prevGross = prevPipeComp.parameters.grossLength || prevPipeComp.centerline[0].distanceTo(prevPipeComp.centerline[1]);
        if (prevGross >= takeOff + minNipple) {
          canCutPreviousPipe = true;
          vertex = startPoint.clone();
          pStart = prevPipeComp.centerline[0].clone();
        }
      }

      if (!canCutPreviousPipe) {
        vertex = startPoint.clone().add(uIn.clone().multiplyScalar(takeOff));
        pStart = startPoint.clone();
      }

      if (lengthMm < takeOff) {
        set({
          statusMessage: `El tramo de ${lengthMm} mm es más corto que el codo (${Math.round(takeOff)} mm de centro a cara).`
        });
        return;
      }

      const pNext = vertex.clone().add(uOut.clone().multiplyScalar(lengthMm));

      try {
        snap();

        if (canCutPreviousPipe && prevPipeComp) {
          const prevStart = prevPipeComp.centerline[0].clone();
          const cutPoint1 = vertex.clone().sub(uIn.clone().multiplyScalar(takeOff));
          const netIncoming = prevStart.distanceTo(cutPoint1);

          // El caño se rehace más corto: conserva la unión que tenía aguas arriba
          const upJointId = prevPipeComp.ports[0].connectedJointId;
          const upJoint = upJointId ? graph.joints.get(upJointId) : undefined;
          const upPortId = upJoint ? (upJoint.portAId === prevPipeComp.ports[0].id ? upJoint.portBId : upJoint.portAId) : null;

          graph.removeComponent(prevPipeComp.id);
          const newPrevPipe = graph.addPipe(prevStart, cutPoint1, pipeSpec, netIncoming);
          if (upJoint && upPortId) {
            const rejoined = graph.connectPorts(upPortId, newPrevPipe.ports[0].id, upJoint.type, { gapMm: upJoint.gapMm });
            Object.assign(rejoined, { ...upJoint, id: rejoined.id, portAId: rejoined.portAId, portBId: rejoined.portBId });
          }

          const placement = calculateElbowPlacement(prevStart, vertex, pNext, takeOff, elbowSpec.radius);
          const elbow = addElbow(placement);
          graph.connectPorts(newPrevPipe.ports[1].id, elbow.ports[0].id);

          const netOutgoing = placement.netLengthOutgoing;
          const pipeOut = graph.addPipe(placement.cutPoint2, pNext, pipeSpec, netOutgoing);
          graph.connectPorts(elbow.ports[1].id, pipeOut.ports[0].id);

          saveGraphToIndexedDb(graph.serialize());
          const collisions = detectPipingCollisions(graph);
          set({
            selectedPortId: pipeOut.ports[1].id,
            selectedComponentId: pipeOut.id,
            collidingComponentIds: collisions.collidingComponentIds,
            version: get().version + 1,
            statusMessage: `${elbowSpec.shortDescription}: el caño anterior quedó en ${Math.round(netIncoming)} mm y el nuevo en ${Math.round(netOutgoing)} mm.${geomWarn(elbowSpec)}`
          });
        } else {
          const placement = calculateElbowPlacement(pStart, vertex, pNext, takeOff, elbowSpec.radius);
          const elbow = addElbow(placement);
          graph.connectPorts(connectingPort.id, elbow.ports[0].id);

          const netOutgoing = placement.netLengthOutgoing;
          const pipeOut = graph.addPipe(placement.cutPoint2, pNext, pipeSpec, netOutgoing);
          graph.connectPorts(elbow.ports[1].id, pipeOut.ports[0].id);

          saveGraphToIndexedDb(graph.serialize());
          const collisions = detectPipingCollisions(graph);
          set({
            selectedPortId: pipeOut.ports[1].id,
            selectedComponentId: pipeOut.id,
            collidingComponentIds: collisions.collidingComponentIds,
            version: get().version + 1,
            statusMessage: `${elbowSpec.shortDescription}: caño nuevo de ${Math.round(netOutgoing)} mm.${autoNote}${geomWarn(elbowSpec)}`
          });
        }
      } catch (e: unknown) {
        const err = e as Error;
        set({ statusMessage: `No se pudo calcular el codo: ${err.message}` });
      }
    },

    startConnectPicking: () => {
      const { graph, selectedPortId, connectPicking } = get();
      if (connectPicking) {
        get().cancelConnect();
        return;
      }
      const start = selectedPortId ? graph.ports.get(selectedPortId) : null;
      if (!start || start.connectedJointId) {
        set({ statusMessage: 'Conectar: primero tocá la boca libre desde la que querés salir.' });
        return;
      }
      if (graph.getOpenPorts().length < 2) {
        set({ statusMessage: 'Conectar: no hay otra boca libre a la que llegar.' });
        return;
      }
      set({
        connectPicking: true,
        connectTargetId: null,
        connectRoutes: [],
        connectIndex: 0,
        statusMessage: 'Conectar: tocá en el modelo la boca libre de destino.'
      });
    },

    pickConnectTarget: (portId) => {
      const { graph, specReader, selectedPortId, specCode } = get();
      const start = selectedPortId ? graph.ports.get(selectedPortId) : null;
      const target = graph.ports.get(portId);
      const fail = (statusMessage: string) => set({ connectTargetId: null, connectRoutes: [], connectIndex: 0, statusMessage });
      if (!specReader || !start || start.connectedJointId) return fail('Conectar: no hay una boca activa libre.');
      if (!target || target.connectedJointId) return fail('Conectar: esa boca ya está unida.');
      if (target.id === start.id || target.componentId === start.componentId) {
        return fail('Conectar: elegí una boca de otra pieza.');
      }
      if (isFaceEnd(start) || isFaceEnd(target)) {
        return fail('Conectar: una de las bocas es una cara de brida. Poné antes su contrabrida o un caño y volvé a intentar.');
      }
      const nd = start.nominalDiameter;
      if (target.nominalDiameter !== nd) {
        return fail(`Conectar: las bocas son de distinto diámetro (${nd}" y ${target.nominalDiameter}"). Poné antes una reducción.`);
      }
      const pipeSpec = specReader.findPipe(nd, specCode);
      const elbowSpec = specReader.findElbow(nd, 90, specCode, findOpts(start));
      if (!pipeSpec || !elbowSpec) return fail(`Conectar: la spec no tiene caño o codo de 90° en ${nd}".`);
      const takeOff = elbowSpec.takeOff || elbowSpec.radius || 76.2;
      const minNipple = Math.max(50, 2 * pipeSpec.outerDiameter);
      const routes = planConnectionRoutes(start.position, start.direction, target.position, target.direction, { takeOff, minNipple });
      if (routes.length === 0) {
        return fail('Conectar: no hay un recorrido a 90° entre esas bocas (están muy cerca, en ángulo o de espaldas). Trazá a mano.');
      }
      set({
        connectPicking: false,
        connectTargetId: target.id,
        connectRoutes: routes,
        connectIndex: 0,
        statusMessage: `Conectar: ${routes.length} recorrido${routes.length > 1 ? 's' : ''} posible${routes.length > 1 ? 's' : ''}. Elegí uno y confirmá.`
      });
    },

    cycleConnectRoute: (delta) => {
      const n = get().connectRoutes.length;
      if (n) set({ connectIndex: (get().connectIndex + delta + n) % n });
    },

    cancelConnect: () => {
      if (!get().connectPicking && !get().connectRoutes.length) return;
      set({ connectPicking: false, connectTargetId: null, connectRoutes: [], connectIndex: 0, statusMessage: 'Conectar cancelado.' });
    },

    confirmConnect: () => {
      const { graph, connectRoutes, connectIndex, connectTargetId, selectedPortId, numpadValue } = get();
      const route = connectRoutes[connectIndex];
      const start = selectedPortId ? graph.ports.get(selectedPortId) : null;
      if (!route || !connectTargetId || !start) return;
      const undoBefore = undoSnapshots.length;
      const clear = { connectPicking: false, connectTargetId: null, connectRoutes: [], connectIndex: 0, numpadValue };
      // Todo el recorrido es un solo paso de deshacer; si un tramo falla no queda nada a medias
      const rollback = (why: string) => {
        if (undoSnapshots.length > undoBefore) {
          undoSnapshots.length = undoBefore + 1;
          get().undo();
          redoSnapshots.pop();
        }
        set({ ...clear, canRedo: redoSnapshots.length > 0, statusMessage: `Conectar: no se pudo armar el recorrido. ${why}` });
      };

      connectExecuting = true;
      try {
        set({ nominalDiameter: start.nominalDiameter });
        for (const leg of route.legs) {
          const before = get().selectedPortId;
          set({ activeDirection: leg.dir.clone(), numpadValue: String(Math.round(leg.length * 100) / 100) });
          get().applyRouting();
          if (get().selectedPortId === before) return rollback(get().statusMessage);
        }
        const lastId = get().selectedPortId;
        try {
          if (!lastId) throw new Error('No quedó una boca para unir.');
          graph.connectPorts(lastId, connectTargetId);
        } catch (e) {
          return rollback((e as Error).message);
        }
        undoSnapshots.length = undoBefore + 1;
        saveGraphToIndexedDb(graph.serialize());
        const open = graph.getOpenPorts();
        const next = open.length ? open[open.length - 1] : null;
        set({
          ...clear,
          selectedPortId: next ? next.id : null,
          selectedComponentId: get().selectedComponentId,
          activeDirection: next ? next.direction.clone().normalize() : get().activeDirection,
          collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
          version: get().version + 1,
          canUndo: true,
          statusMessage: `Bocas conectadas con ${route.legs.length} tramo${route.legs.length > 1 ? 's' : ''} y ${route.bends} codo${route.bends === 1 ? '' : 's'} (${Math.round(route.totalLength)} mm de eje a eje).`
        });
      } finally {
        connectExecuting = false;
      }
    },

    openPieceMenu: (menu) => set({ pieceMenu: menu }),
    closePieceMenu: () => set({ pieceMenu: null }),

    stretchPipe: (componentId, newLengthMm, anchor) => {
      const { graph } = get();
      const comp = graph.components.get(componentId);
      if (!comp || comp.type !== 'PIPE' || !(newLengthMm > 10)) return;
      const moving = anchor === 'start' ? comp.ports[1] : comp.ports[0];
      if (graph.closesLoopThrough(comp.id, moving.id)) {
        set({ statusMessage: 'No se puede estirar: la línea cierra un circuito. Cortala primero borrando una pieza.' });
        return;
      }
      pushUndoSnapshot();
      graph.updatePipeLength(comp.id, newLengthMm, anchor);
      saveGraphToIndexedDb(graph.serialize());
      set({
        collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
        version: get().version + 1,
        statusMessage: `Largo del caño: ${Math.round(newLengthMm)} mm${moving.connectedJointId ? ' (lo conectado a ese extremo se corrió con él)' : ''}.`
      });
    },

    substituteSelected: (familyId, angle) => {
      const { graph, specReader, selectedComponentId, specCode } = get();
      const comp = selectedComponentId ? graph.components.get(selectedComponentId) : null;
      if (!specReader || !comp) return;
      const nd = comp.ports[0]?.nominalDiameter || comp.parameters.nominalDiameter;
      const out = comp.ports[1];
      if (comp.type !== 'FLANGE' && out && graph.closesLoopThrough(comp.id, out.id)) {
        set({ statusMessage: 'No se puede sustituir: la línea cierra un circuito y la pieza nueva no mide lo mismo.' });
        return;
      }
      try {
        let updated = null;
        let name = '';
        if (comp.type === 'ELBOW') {
          const target = angle ?? (Math.abs((comp.parameters.angle || 90) - 45) < 15 ? 45 : 90);
          const spec = specReader.findElbow(nd, target, specCode, { familyId });
          if (!spec) return set({ statusMessage: `La spec no tiene ese codo de ${target}° en ${nd}".` });
          pushUndoSnapshot();
          updated = graph.swapElbow(comp.id, spec, target);
          name = spec.shortDescription;
        } else if (comp.type === 'VALVE') {
          const spec = specReader.findValve(nd, specCode, { familyId });
          if (!spec) return set({ statusMessage: `La spec no tiene esa válvula en ${nd}".` });
          pushUndoSnapshot();
          updated = graph.swapValve(comp.id, spec);
          name = spec.shortDescription;
        } else if (comp.type === 'FLANGE') {
          const spec = specReader.findFlange(nd, specCode, { familyId, pressureClass: comp.parameters.pressureClass });
          if (!spec) return set({ statusMessage: `La spec no tiene esa brida en ${nd}".` });
          pushUndoSnapshot();
          try {
            updated = graph.swapFlange(comp.id, spec);
          } catch (e) {
            get().undo();
            redoSnapshots.pop();
            return set({ canRedo: redoSnapshots.length > 0, statusMessage: `No se pudo sustituir la brida: ${(e as Error).message}` });
          }
          name = spec.shortDescription;
        } else {
          return set({ statusMessage: 'Se pueden sustituir en el lugar codos, válvulas y bridas.' });
        }
        if (!updated) {
          get().undo();
          redoSnapshots.pop();
          return set({ canRedo: redoSnapshots.length > 0, statusMessage: 'No se pudo sustituir esta pieza en el lugar.' });
        }
        saveGraphToIndexedDb(graph.serialize());
        const active = get().selectedPortId ? graph.ports.get(get().selectedPortId!) : null;
        set({
          activeDirection: active ? active.direction.clone().normalize() : get().activeDirection,
          collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
          version: get().version + 1,
          statusMessage: `Pieza sustituida por ${name}. ${comp.type === 'ELBOW' ? 'Lo conectado a su salida se acomodó.' : 'El caño que sigue se ajustó al largo nuevo.'}`
        });
      } catch (e) {
        set({ statusMessage: `No se pudo sustituir: ${(e as Error).message}` });
      }
    },

    setSelectedElevation: (z) => {
      const { graph, selectedComponentId } = get();
      if (!selectedComponentId) return;
      const plan = planElevation(graph, selectedComponentId, z);
      if (typeof plan === 'string') return set({ statusMessage: `Elevación: ${plan}` });
      if (Math.abs(plan.toZ - plan.fromZ) < 0.5) return set({ statusMessage: `Elevación: la pieza ya está en ${Math.round(z)} mm.` });
      pushUndoSnapshot();
      applyElevation(graph, plan);
      saveGraphToIndexedDb(graph.serialize());
      const dz = Math.round(plan.toZ - plan.fromZ);
      const n = plan.moveIds.size;
      const st = plan.stretch.length;
      set({
        collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
        version: get().version + 1,
        statusMessage: `Elevación de eje ${Math.round(plan.toZ)} mm (${dz > 0 ? 'subió' : 'bajó'} ${Math.abs(dz)} mm): se ${n === 1 ? 'movió 1 pieza' : `movieron ${n} piezas`}${st ? ` y ${st === 1 ? 'se ajustó 1 caño vertical' : `se ajustaron ${st} caños verticales`}` : ''}.`
      });
    },

    setSelectedValveFaceToFace: (mm) => {
      const { graph, selectedComponentId } = get();
      const comp = selectedComponentId ? graph.components.get(selectedComponentId) : null;
      if (!comp || comp.type !== 'VALVE') return;
      pushUndoSnapshot();
      try {
        graph.setValveFaceToFace(comp.id, mm);
      } catch (e) {
        get().undo();
        redoSnapshots.pop();
        return set({ canRedo: redoSnapshots.length > 0, statusMessage: `No se cambió el cara a cara: ${(e as Error).message}` });
      }
      saveGraphToIndexedDb(graph.serialize());
      const ftf = Math.round((comp.parameters.faceToFace ?? 0) * 10) / 10;
      const spec = comp.parameters.specFaceToFace;
      set({
        collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
        version: get().version + 1,
        statusMessage:
          spec !== undefined
            ? `Cara a cara de la válvula: ${ftf} mm (la spec dice ${Math.round(spec * 10) / 10} mm). Plant la va a traer con el largo de su spec.`
            : `Cara a cara de la válvula: ${ftf} mm, el de la spec.`
      });
    },

    toggleMultiMode: (on) => {
      const next = on ?? !get().multiMode;
      const { selectedComponentId, multiSelect } = get();
      set({
        multiMode: next,
        // Al entrar, la pieza que ya estaba elegida es la primera de la selección
        multiSelect: next ? (multiSelect.length ? multiSelect : selectedComponentId ? [selectedComponentId] : []) : [],
        version: get().version + 1,
        statusMessage: next ? 'Selección múltiple: tocá las piezas que querés mover, copiar o borrar.' : 'Selección múltiple terminada.'
      });
    },

    toggleMultiComponent: (componentId) => {
      const current = get().multiSelect;
      const next = current.includes(componentId) ? current.filter((id) => id !== componentId) : [...current, componentId];
      set({ multiSelect: next, version: get().version + 1, statusMessage: `${next.length} pieza${next.length === 1 ? '' : 's'} en la selección.` });
    },

    selectConnectedRun: () => {
      const { graph, multiSelect, selectedComponentId } = get();
      const seeds = multiSelect.length ? multiSelect : selectedComponentId ? [selectedComponentId] : [];
      const all = new Set<string>();
      for (const id of seeds) for (const other of graph.connectedRun(id)) all.add(other);
      set({ multiMode: true, multiSelect: [...all], version: get().version + 1, statusMessage: `${all.size} piezas: toda la línea conectada.` });
    },

    deleteMulti: () => {
      const { graph } = get();
      const ids = get().multiSelect.filter((id) => graph.components.has(id));
      if (!ids.length) return;
      pushUndoSnapshot();
      for (const id of ids) graph.removeComponent(id);
      saveGraphToIndexedDb(graph.serialize());
      const open = graph.getOpenPorts();
      const next = open.length ? open[open.length - 1] : null;
      set({
        multiMode: false,
        multiSelect: [],
        selectedComponentId: next ? next.componentId : null,
        selectedPortId: next ? next.id : null,
        activeDirection: next ? next.direction.clone().normalize() : get().activeDirection,
        collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
        version: get().version + 1,
        statusMessage: `${ids.length} pieza${ids.length === 1 ? '' : 's'} borrada${ids.length === 1 ? '' : 's'}.`
      });
    },

    moveMulti: (delta, copy) => {
      const { graph } = get();
      const ids = get().multiSelect.filter((id) => graph.components.has(id));
      if (!ids.length || delta.lengthSq() < 1e-6) return;
      pushUndoSnapshot();
      let message: string;
      let selection = ids;
      if (copy) {
        selection = graph.duplicateComponents(ids, delta);
        message = `${ids.length} pieza${ids.length === 1 ? '' : 's'} copiada${ids.length === 1 ? '' : 's'} a ${Math.round(delta.length())} mm. La copia quedó seleccionada.`;
      } else {
        const detached = graph.translateComponents(ids, delta);
        message = `${ids.length} pieza${ids.length === 1 ? '' : 's'} movida${ids.length === 1 ? '' : 's'} ${Math.round(delta.length())} mm.${
          detached ? ` Se soltaron ${detached} unión${detached === 1 ? '' : 'es'} con el resto del modelo.` : ''
        }`;
      }
      saveGraphToIndexedDb(graph.serialize());
      const selectedPort = get().selectedPortId ? graph.ports.get(get().selectedPortId!) : null;
      set({
        multiSelect: selection,
        selectedPortId: selectedPort && !selectedPort.connectedJointId ? selectedPort.id : null,
        collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
        version: get().version + 1,
        statusMessage: message
      });
    },

    undo: () => {
      if (undoSnapshots.length === 0) {
        set({ canUndo: false });
        return;
      }
      const { graph } = get();
      redoSnapshots.push(graph.serialize());

      const previousState = undoSnapshots.pop()!;
      graph.deserialize(previousState);
      saveGraphToIndexedDb(graph.serialize());

      const openPorts = graph.getOpenPorts();
      const lastPort = openPorts.length > 0 ? openPorts[openPorts.length - 1] : null;
      const collisions = detectPipingCollisions(graph);

      set({
        selectedPortId: lastPort ? lastPort.id : null,
        nominalDiameter: lastPort ? lastPort.nominalDiameter : get().nominalDiameter,
        selectedComponentId: lastPort ? lastPort.componentId : null,
        activeDirection: lastPort ? lastPort.direction.clone().normalize() : new THREE.Vector3(1, 0, 0),
        version: get().version + 1,
        collidingComponentIds: collisions.collidingComponentIds,
        canUndo: undoSnapshots.length > 0,
        canRedo: true,
        statusMessage: 'Deshecho.'
      });
    },

    redo: () => {
      if (redoSnapshots.length === 0) {
        set({ canRedo: false });
        return;
      }
      const { graph } = get();
      undoSnapshots.push(graph.serialize());

      const nextState = redoSnapshots.pop()!;
      graph.deserialize(nextState);
      saveGraphToIndexedDb(graph.serialize());

      const openPorts = graph.getOpenPorts();
      const lastPort = openPorts.length > 0 ? openPorts[openPorts.length - 1] : null;
      const collisions = detectPipingCollisions(graph);

      set({
        selectedPortId: lastPort ? lastPort.id : null,
        nominalDiameter: lastPort ? lastPort.nominalDiameter : get().nominalDiameter,
        selectedComponentId: lastPort ? lastPort.componentId : null,
        activeDirection: lastPort ? lastPort.direction.clone().normalize() : new THREE.Vector3(1, 0, 0),
        version: get().version + 1,
        collidingComponentIds: collisions.collidingComponentIds,
        canUndo: true,
        canRedo: redoSnapshots.length > 0,
        statusMessage: 'Rehecho.'
      });
    },

    frameAll: () => {
      set({ triggerFrameAll: get().triggerFrameAll + 1 });
    },

    focusComponent: (compId) => {
      const { graph, isolation, hiddenLines } = get();
      const comp = graph.components.get(compId);
      if (!comp) return;
      const visible = isolatedIds(graph, isolation, hiddenLines);
      if (visible && !visible.has(compId)) {
        const nextHidden = new Set(hiddenLines);
        nextHidden.delete(lineOf(graph, comp));
        set({ isolation: null, hiddenLines: nextHidden });
      }
      if (get().sectionBox) set({ sectionBox: null });
      get().setSelectedComponentId(compId);
      set({ focusRequest: { id: compId, seq: (get().focusRequest?.seq ?? 0) + 1 } });
    },

    toggleBom: () => set((state) => ({ isBomOpen: !state.isBomOpen })),

    toggleExport: () => set((state) => ({ isExportOpen: !state.isExportOpen })),

    toggleToolPalette: () => set((state) => ({ isToolPaletteOpen: !state.isToolPaletteOpen })),

    insertFitting: (type, options) => {
      const { graph, specReader, selectedPortId, nominalDiameter, specCode, activeDirection, numpadValue } = get();
      if (!specReader) return;

      // Sin boca activa (se tocó el fondo) no se elige una por el usuario
      if (!selectedPortId && graph.components.size > 0) {
        set({ statusMessage: 'Tocá una boca libre para poner la pieza ahí.' });
        return;
      }

      // Determinar puerto de conexión activo
      if (type === 'OLET') {
        set({ statusMessage: 'El olet va sobre un caño: mantené apretado el caño (o clic derecho) y elegí Derivar.' });
        return;
      }

      let port = selectedPortId ? graph.ports.get(selectedPortId) : null;
      if (!port || port.connectedJointId) {
        const openPorts = graph.getOpenPorts();
        if (openPorts.length > 0) {
          port = openPorts[openPorts.length - 1];
        } else {
          set({ statusMessage: 'No hay bocas libres donde poner la pieza.' });
          return;
        }
      }

      pushUndoSnapshot();

      // Caños y accesorios soldados no se atornillan a una cara: primero la brida de la spec
      let autoNote = '';
      // Familia elegida en la paleta: manda sobre las prioridades de la spec
      const pick = (p: Port) => ({ ...findOpts(p), familyId: options?.familyId });
      const fail = (message: string) => {
        undoSnapshots.pop();
        set({ canUndo: undoSnapshots.length > 0, statusMessage: message });
      };

      if (type === 'PIPE' || type === 'ELBOW' || type === 'TEE' || type === 'REDUCER' || type === 'CAP' || type === 'COUPLING') {
        const res = flangeOffFaceIfNeeded(port);
        port = res.port;
        autoNote = res.note;
      }

      if (type === 'PIPE') {
        const lengthMm = parseFloat(numpadValue) || 500;
        const pipeSpec = specReader.findPipe(nominalDiameter, specCode);
        if (!pipeSpec) {
          set({ statusMessage: `La spec no tiene caño de ${formatSize(nominalDiameter)}.` });
          return;
        }
        const endPoint = port.position.clone().add(port.direction.clone().multiplyScalar(lengthMm));
        const newPipe = graph.addPipe(port.position, endPoint, pipeSpec, lengthMm);
        graph.connectPorts(port.id, newPipe.ports[0].id);
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: newPipe.ports[1].id,
          selectedComponentId: newPipe.id,
          activeDirection: newPipe.ports[1].direction.clone().normalize(),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `Caño de ${lengthMm} mm agregado.${autoNote}`
        });
        return;
      }

      if (type === 'ELBOW') {
        const angle = options?.angle || 90;
        const elbowSpec = specReader.findElbow(port.nominalDiameter || nominalDiameter, angle, specCode, pick(port));
        if (!elbowSpec) {
          set({ statusMessage: `La spec no tiene codo de ${angle}° en ${formatSize(port.nominalDiameter || nominalDiameter)}.` });
          return;
        }
        const takeOff = elbowSpec.takeOff || (elbowSpec.radius ? elbowSpec.radius * Math.tan((angle * Math.PI) / 360) : 76.2);
        const uIn = port.direction.clone().normalize();
        let uOut = activeDirection.clone().normalize();

        if (angle === 45) {
          let rotAxis = new THREE.Vector3().crossVectors(uIn, activeDirection).normalize();
          if (rotAxis.length() < 0.1) {
            rotAxis = Math.abs(uIn.z) < 0.8
              ? new THREE.Vector3(0, 0, 1).cross(uIn).normalize()
              : new THREE.Vector3(0, 1, 0).cross(uIn).normalize();
          }
          uOut = uIn.clone().applyAxisAngle(rotAxis, Math.PI / 4).normalize();
        } else {
          if (Math.abs(uIn.dot(uOut)) > 0.95) {
            uOut = Math.abs(uIn.y) > 0.8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
          } else {
            uOut = uOut.clone().addScaledVector(uIn, -uOut.dot(uIn)).normalize();
          }
        }

        const pStart = port.position.clone();
        const vertex = pStart.clone().add(uIn.clone().multiplyScalar(takeOff));
        const pNext = vertex.clone().add(uOut.clone().multiplyScalar(takeOff * 2));
        const placement = calculateElbowPlacement(pStart, vertex, pNext, takeOff, elbowSpec.radius);
        const elbow = graph.addElbow(placement, elbowSpec);
        graph.connectPorts(port.id, elbow.ports[0].id);

        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: elbow.ports[1].id,
          selectedComponentId: elbow.id,
          activeDirection: uOut.clone().normalize(),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `${elbowSpec.shortDescription}. Para orientar la salida, mantené apretado el codo y elegí Girar 90°.${autoNote}${geomWarn(elbowSpec)}`
        });
        return;
      }

      if (type === 'FLANGE') {
        const nd = port.nominalDiameter || nominalDiameter;
        if (options?.blind) {
          const blindSpec = specReader.catalog.find({
            category: 'FLANGE_BLIND',
            nominalDiameter: nd,
            familyId: options.familyId,
            pressureClass: port.pressureClass
          });
          if (!blindSpec) return fail(`La spec no tiene brida ciega de ${formatSize(nd)}.`);
          const cls = port.pressureClass || blindSpec.pressureClass;
          const mate = isFaceEnd(port) ? null : specReader.findFlange(nd, specCode, { ...findOpts(port), pressureClass: cls });
          if (!isFaceEnd(port) && !mate) return fail(`La brida ciega va contra una brida y la spec no tiene brida de ${formatSize(nd)}.`);
          const gasket = specReader.findGasket(nd, specCode, { pressureClass: cls });
          const bolts = specReader.findBoltSet(nd, specCode, { pressureClass: cls });
          const res = graph.addBlindFlange(port, blindSpec, { flangeSpec: mate, gasketSpec: gasket, boltSetSpec: bolts });
          saveGraphToIndexedDb(graph.serialize());
          const open = graph.getOpenPorts();
          const nextPort = open.length > 0 ? open[open.length - 1] : null;
          set({
            selectedPortId: nextPort ? nextPort.id : null,
            selectedComponentId: res.blind.id,
            activeDirection: nextPort ? nextPort.direction.clone().normalize() : get().activeDirection,
            collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
            version: get().version + 1,
            statusMessage: `${blindSpec.shortDescription}${res.flange ? `, con ${mate?.familyDescription || 'su brida'} y junta` : ' con junta'}. La línea quedó cerrada.`
          });
          return;
        }
        const flgSpec = specReader.findFlange(nd, specCode, pick(port));
        if (!flgSpec) return fail(`La spec no tiene brida de ${formatSize(nd)}.`);
        const gasketSpec = specReader.findGasket(nd, specCode, { pressureClass: port.pressureClass || flgSpec.pressureClass });
        const boltSetSpec = specReader.findBoltSet(nd, specCode, { pressureClass: port.pressureClass || flgSpec.pressureClass });
        const flg = graph.addFlange(port, flgSpec, gasketSpec, boltSetSpec);
        // Par de bridas: la segunda va cara con cara, con junta y bulones
        let outPort = flg.ports[1];
        let pairNote = '';
        if (options?.pair && isFaceEnd(outPort)) {
          // La segunda es de la misma familia que la primera
          outPort = graph.addFlange(outPort, flgSpec, gasketSpec, boltSetSpec).ports[1];
          pairNote = ` + ${gasketSpec?.shortDescription || 'junta'} + segunda brida`;
        }
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: outPort.id,
          selectedComponentId: flg.id,
          activeDirection: outPort.direction.clone().normalize(),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `${flgSpec.shortDescription}${isFaceEnd(port) ? ` + ${gasketSpec?.shortDescription || 'junta'}` : ''}${pairNote}.${geomWarn(flgSpec)}`
        });
        return;
      }

      if (type === 'VALVE') {
        const nd = port.nominalDiameter || nominalDiameter;
        const valveSpec = specReader.findValve(nd, specCode, pick(port));
        if (!valveSpec) return fail(`La spec no tiene válvula de ${formatSize(nd)}.`);
        const gasketSpec = specReader.findGasket(nd, specCode, { pressureClass: valveSpec.pressureClass });
        const boltSetSpec = specReader.findBoltSet(nd, specCode, { pressureClass: valveSpec.pressureClass });
        // Válvula de caras (bridada, wafer, lug): entra con sus bridas y juntas, como el AutoFlange de Plant
        const valveIsFlanged = isFaceEnd({ plantEndType: valveSpec.plantEndTypes?.[0], endType: valveSpec.endType });
        const mateFlange = valveIsFlanged
          ? specReader.findFlange(nd, specCode, {
              connectToEndType: isFaceEnd(port) ? 'PL' : port.plantEndType ?? 'PL',
              pressureClass: valveSpec.pressureClass
            })
          : null;
        const assembly = graph.addValveAssembly(port, valveSpec, { flangeSpec: mateFlange, gasketSpec, boltSetSpec });
        if (assembly.flanges.length) {
          autoNote = ` Con ${assembly.flanges.length === 2 ? 'sus dos bridas' : 'su brida'} (${mateFlange?.familyDescription || 'brida'}) y juntas.`;
        } else if (valveIsFlanged) {
          autoNote = ' ⚠ La spec no tiene brida para esta válvula: quedó sin bridas.';
        }
        const vlv = assembly.valve;
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: assembly.outPort.id,
          selectedComponentId: vlv.id,
          activeDirection: assembly.outPort.direction.clone().normalize(),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `${valveSpec.shortDescription}.${autoNote}${geomWarn(valveSpec)}`
        });
        return;
      }

      if (type === 'TEE') {
        const teeSpec = specReader.findTee(port.nominalDiameter || nominalDiameter, specCode, { ...pick(port), branchDiameter: options?.branchNd });
        if (!teeSpec) {
          return fail(
            `La spec no tiene te${options?.branchNd ? ` con ramal de ${formatSize(options.branchNd)}` : ''} en ${formatSize(port.nominalDiameter || nominalDiameter)}.`
          );
        }
        const uIn = port.direction.clone().normalize();
        let branchDir = options?.branchDir ? options.branchDir.clone() : activeDirection.clone().normalize();
        // Si la dirección activa es paralela al tramo entrante, elegir un vector ortogonal por defecto (+Y o +Z)
        if (Math.abs(uIn.dot(branchDir)) > 0.92) {
          branchDir = Math.abs(uIn.y) < 0.8 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
        } else {
          branchDir = branchDir.addScaledVector(uIn, -branchDir.dot(uIn)).normalize();
        }

        const tee = graph.addTee(port, branchDir, teeSpec);
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);

        const targetPort = options?.continueOnBranch ? tee.ports[2] : tee.ports[1];
        set({
          selectedPortId: targetPort.id,
          selectedComponentId: tee.id,
          activeDirection: targetPort.direction.clone().normalize(),
          nominalDiameter: targetPort.nominalDiameter || get().nominalDiameter,
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: options?.continueOnBranch
            ? `${teeSpec.shortDescription}. Continuando por el ramal.${autoNote}${geomWarn(teeSpec)}`
            : `${teeSpec.shortDescription}. Tocá la boca por la que querés seguir: la línea o el ramal.${autoNote}${geomWarn(teeSpec)}`
        });
        return;
      }

      if (type === 'REDUCER') {
        const nd = port.nominalDiameter || nominalDiameter;
        const smaller = specReader.catalog
          .families('REDUCER', nd)
          .flatMap((f) => f.secondarySizes)
          .sort((a, b) => b - a);
        const targetND = options?.targetNd || smaller[0];
        const found = targetND
          ? specReader.findReducer(nd, targetND, specCode, { ...pick(port), eccentric: options?.eccentric })
          : null;
        // La pieza tiene que ser de esos dos diámetros (la búsqueda por familia no lo asegura)
        const redSpec =
          found &&
          Math.abs(found.nominalDiameter - Math.max(nd, targetND)) < 1e-6 &&
          Math.abs((found.reducedNominalDiameter ?? 0) - Math.min(nd, targetND)) < 1e-6
            ? found
            : null;
        if (!redSpec) return fail(`La spec no tiene reducción de ${formatSize(nd)}${targetND ? ` a ${formatSize(targetND)}` : ''}.`);
        const red = graph.addReducer(port, redSpec, targetND > nd, options?.flat === 'arriba');
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: red.ports[1].id,
          selectedComponentId: red.id,
          activeDirection: red.ports[1].direction.clone().normalize(),
          nominalDiameter: targetND,
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `${targetND > nd ? 'Ampliación' : 'Reducción'}: ${redSpec.shortDescription}${
            (redSpec.lateralOffset ?? 0) > 0.01 ? ` (plano ${options?.flat === 'arriba' ? 'arriba' : 'abajo'})` : ''
          }. La línea sigue en ${formatSize(targetND)}.${autoNote}${geomWarn(redSpec)}`
        });
        return;
      }

      if (type === 'COUPLING') {
        const nd = port.nominalDiameter || nominalDiameter;
        const cplSpec = specReader.catalog.find({
          category: 'COUPLING',
          nominalDiameter: nd,
          familyId: options?.familyId,
          connectToEndType: port.plantEndType
        });
        if (!cplSpec) return fail(`La spec no tiene cupla de ${formatSize(nd)}.`);
        const cpl = graph.addCoupling(port, cplSpec);
        saveGraphToIndexedDb(graph.serialize());
        set({
          selectedPortId: cpl.ports[1].id,
          selectedComponentId: cpl.id,
          activeDirection: cpl.ports[1].direction.clone().normalize(),
          collidingComponentIds: detectPipingCollisions(graph).collidingComponentIds,
          version: get().version + 1,
          statusMessage: `${cplSpec.shortDescription}.${autoNote}${geomWarn(cplSpec)}`
        });
        return;
      }

      if (type === 'CAP') {
        const capSpec = specReader.findCap(port.nominalDiameter || nominalDiameter, specCode, pick(port));
        if (!capSpec) {
          set({ statusMessage: `La spec no tiene tapa en ${formatSize(port.nominalDiameter || nominalDiameter)}.` });
          return;
        }
        const cap = graph.addCap(port, capSpec);
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        const open = graph.getOpenPorts();
        const nextPort = open.length > 0 ? open[open.length - 1] : null;
        set({
          selectedPortId: nextPort ? nextPort.id : null,
          selectedComponentId: cap.id,
          activeDirection: nextPort ? nextPort.direction.clone().normalize() : get().activeDirection,
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `${capSpec.shortDescription}. La línea quedó cerrada.${autoNote}${geomWarn(capSpec)}`
        });
        return;
      }
    },

    resetGraph: async () => {
      pushUndoSnapshot();
      const specName = get().specCode || 'CS150';
      const newGraph = new PipingGraph(specName, get().nominalDiameter, 'SCH 40');
      newGraph.connectionRules = get().graph.connectionRules;
      newGraph.activeLineNumber = get().lineNumber;
      saveGraphToIndexedDb(newGraph.serialize());
      set({
        graph: newGraph,
        selectedPortId: null,
        selectedComponentId: null,
    selectedSupportId: null,
        snappedPortId: null,
        collidingComponentIds: new Set(),
        version: get().version + 1,
        statusMessage: 'Modelo vaciado.'
      });
    }
  };
});

usePipingStore.subscribe((state, prev) => {
  // Modelo nuevo: las ayudas de vista del anterior ya no valen
  if (state.graph !== prev.graph && (state.isolation || state.hiddenLines.size > 0 || state.sectionBox || state.measurePoints.length)) {
    usePipingStore.setState({ isolation: null, hiddenLines: new Set<string>(), sectionBox: null, measurePoints: [] });
    return;
  }
  // Tramo aislado: sigue a las piezas que se agregan o se rehacen al trazar
  if (state.version !== prev.version && state.isolation?.kind === 'run') {
    const alive = state.isolation.ids.filter((id) => state.graph.components.has(id));
    if (!alive.length) {
      usePipingStore.setState({ isolation: null });
    } else {
      const ids = new Set<string>();
      for (const id of alive) if (!ids.has(id)) for (const other of state.graph.connectedRun(id)) ids.add(other);
      const same = ids.size === state.isolation.ids.length && state.isolation.ids.every((id) => ids.has(id));
      if (!same) usePipingStore.setState({ isolation: { kind: 'run', ids: [...ids] } });
    }
  }
  if (connectExecuting) return;
  const pending = state.connectPicking || state.connectRoutes.length > 0;
  if (pending && (state.selectedPortId !== prev.selectedPortId || state.version !== prev.version || state.graph !== prev.graph)) {
    usePipingStore.setState({ connectPicking: false, connectTargetId: null, connectRoutes: [], connectIndex: 0 });
  }
});
