import { create } from 'zustand';
import * as THREE from 'three';
import { PipingGraph, isFaceEnd } from '../core/graph/PipingGraph';
import { SpecDatabaseReader } from '../core/specs/SpecDatabaseReader';
import { PartCategory } from '../core/specs/catalogTypes';
import {
  LoadedSpec,
  loadBundledSpec,
  loadCachedSpec,
  loadPreferredFamilies,
  loadSpecFromFiles,
  savePreferredFamilies
} from '../core/specs/specLoader';
import { saveGraphToIndexedDb, loadGraphFromIndexedDb, clearGraphIndexedDb } from '../persistence/indexedDbStorage';
import { detectPipingCollisions } from '../viewport/collision/collisionDetector';
import { calculateElbowPlacement } from '../core/math/elbowSolver';
import { SerializedGraphState, FieldWeldKind, ComponentType, NippleEndFinish, Port, SpecFitting } from '../types/piping';
import { PcfImporter } from '../core/importers/PcfImporter';

export type CameraMode = 'INSPECT_MODE' | 'ROUTE_MODE';

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
  cameraViewPreset: { azimuth: number; polar: number; seq: number } | null;
  /** Familia de Plant fijada por el usuario para cada tipo de pieza (PartFamilyId) */
  preferredFamilies: Record<string, string>;
  /** Avisos de la última carga de spec */
  specNotes: string[];
  /** Colorear el modelo por spool */
  spoolView: boolean;
  isSpoolsOpen: boolean;

  // Acciones
  initialize: () => Promise<void>;
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
  insertFitting: (
    type: ComponentType,
    options?: { angle?: number; branchDir?: THREE.Vector3; targetNd?: number; continueOnBranch?: boolean }
  ) => void;
  undo: () => void;
  redo: () => void;
  frameAll: () => void;
  toggleBom: () => void;
  toggleExport: () => void;
  toggleToolPalette: () => void;
  resetGraph: () => Promise<void>;
  loadPspcFile: (buffer: ArrayBuffer, fileName: string) => Promise<void>;
  loadSpecFiles: (files: File[]) => Promise<void>;
  setPreferredFamily: (category: PartCategory, familyId: string | null) => void;
  loadBuiltInSpec: (specName: string) => Promise<void>;
  importPcfFile: (content: string, fileName: string) => void;
}

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

  /** Opciones de selección según el puerto donde se conecta (extremo y clase de Plant) */
  const findOpts = (port?: Port | null) => ({
    connectToEndType: port?.plantEndType,
    pressureClass: port?.pressureClass
  });

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
    snappedPortId: null,
    collidingComponentIds: new Set<string>(),
    statusMessage: 'Sistema de cañerías listo. Trazado de eje a eje activo.',
    isBomOpen: false,
    spoolView: false,
    isSpoolsOpen: false,
    isExportOpen: false,
    isToolPaletteOpen: false,
    canUndo: false,
    canRedo: false,
    version: 0,
    triggerFrameAll: 0,
    cameraViewPreset: null,
    preferredFamilies: {},
    specNotes: [],

    initialize: async () => {
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
        const savedState = await loadGraphFromIndexedDb();
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
      } catch (err) {
        console.error('Error inicializando estado de piping:', err);
        set({ statusMessage: 'Error al inicializar la base de datos de especificaciones.' });
      }
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
        statusMessage: fam ? `Familia fija para ${category}: ${fam}` : `${category}: vuelve a la elección automática de la spec.`
      });
    },

    setCameraMode: (mode) => set({ cameraMode: mode }),

    setActiveDirection: (dir) => {
      set({
        activeDirection: dir.clone().normalize(),
        statusMessage: `Vector director activo: [${dir.x}, ${dir.y}, ${dir.z}]`
      });
    },

    setNominalDiameter: (nd) => {
      const { graph, specReader, selectedPortId, specCode } = get();
      if (!specReader) return;

      const currentND = get().nominalDiameter;
      if (nd !== currentND && selectedPortId) {
        const port = graph.ports.get(selectedPortId);
        if (port && !port.connectedJointId) {
          const reducerSpec = nd < currentND ? specReader.findReducer(currentND, nd, specCode, findOpts(port)) : null;
          if (reducerSpec && reducerSpec.faceToFace) {
            pushUndoSnapshot();
            const start = flangeOffFaceIfNeeded(port);
            const comp = graph.addReducer(start.port, reducerSpec);
            saveGraphToIndexedDb(graph.serialize());
            set({
              selectedPortId: comp.ports[1].id,
              nominalDiameter: nd,
              version: get().version + 1,
              statusMessage: `${reducerSpec.shortDescription} insertada (${reducerSpec.faceToFace.toFixed(1)} mm).${start.note}${geomWarn(reducerSpec)}`
            });
            return;
          }
        }
      }

      set({ nominalDiameter: nd, statusMessage: `Diámetro Nominal seleccionado: ${nd}"` });
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
          statusMessage: `Boca activa seleccionada: Puerto #${port.index} (${port.index === 3 ? 'Ramal 90°' : 'Línea Run'}) • Dir: [${port.direction.x.toFixed(1)}, ${port.direction.y.toFixed(1)}, ${port.direction.z.toFixed(1)}]`
        });
      } else {
        set({ selectedPortId: portId });
      }
    },

    setSelectedComponentId: (compId) => {
      if (!compId) {
        set({ selectedComponentId: null });
        return;
      }
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
          statusMessage: `Seleccionado: ${comp.parameters.description || comp.type} (${comp.parameters.nominalDiameter}") • Boca libre #${openPort.index} lista.`
        });
      } else {
        set({
          selectedComponentId: comp.id,
          statusMessage: `Seleccionado: ${comp.parameters.description || comp.type} (${comp.parameters.nominalDiameter}").`
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
        statusMessage: `COMMAND: PLANTPIPEADD • Continuando desde Boca #${port.index} (${port.index === 3 ? 'Ramal Derivación 90°' : 'Línea Principal Run'}) • Dir [${port.direction.x.toFixed(1)}, ${port.direction.y.toFixed(1)}, ${port.direction.z.toFixed(1)}]`
      });
    },

    cycleOpenPort: () => {
      const { graph, selectedPortId } = get();
      const openPorts = graph.getOpenPorts();
      if (openPorts.length === 0) {
        set({ statusMessage: 'No hay bocas abiertas en la cañería.' });
        return;
      }
      const currentIndex = openPorts.findIndex((p) => p.id === selectedPortId);
      const nextPort = openPorts[(currentIndex + 1) % openPorts.length];
      set({
        selectedPortId: nextPort.id,
        selectedComponentId: nextPort.componentId,
        activeDirection: nextPort.direction.clone().normalize(),
        nominalDiameter: nextPort.nominalDiameter || get().nominalDiameter,
        statusMessage: `Boca activa cambiada (${((currentIndex + 1) % openPorts.length) + 1}/${openPorts.length}): Puerto #${nextPort.index} (${nextPort.index === 3 ? 'Ramal Tee' : 'Continuación'})`
      });
    },

    rotateSelectedComponent: (angleDeg = 90) => {
      const { graph, selectedComponentId, selectedPortId } = get();
      const targetId =
        selectedComponentId || (selectedPortId ? graph.ports.get(selectedPortId)?.componentId || null : null);
      if (!targetId) {
        set({ statusMessage: 'Seleccione una Te o un Codo para rotarlo.' });
        return;
      }
      try {
        pushUndoSnapshot();
        const updated = graph.rotateComponentAroundRun(targetId, angleDeg);
        if (!updated) {
          set({ statusMessage: 'Este componente no admite rotación axial libre.' });
          return;
        }
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        const activePort = selectedPortId ? graph.ports.get(selectedPortId) : null;
        set({
          activeDirection: activePort ? activePort.direction.clone().normalize() : get().activeDirection,
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `${updated.type === 'TEE' ? 'Ramal de Te' : 'Codo'} girado ${angleDeg}° alrededor del eje.`
        });
      } catch (e: unknown) {
        set({ statusMessage: (e as Error).message });
      }
    },

    updateSelectedPipeLength: (newLengthMm: number) => {
      const { graph, selectedComponentId, selectedPortId } = get();
      const targetId =
        selectedComponentId || (selectedPortId ? graph.ports.get(selectedPortId)?.componentId || null : null);
      if (!targetId || isNaN(newLengthMm) || newLengthMm <= 10) return;

      pushUndoSnapshot();
      const updated = graph.updatePipeLength(targetId, newLengthMm);
      if (!updated) {
        set({ statusMessage: 'Seleccione un tramo de cañería (PIPE) para cambiar su longitud.' });
        return;
      }
      saveGraphToIndexedDb(graph.serialize());
      const collisions = detectPipingCollisions(graph);
      set({
        collidingComponentIds: collisions.collidingComponentIds,
        version: get().version + 1,
        statusMessage: `Longitud de niple actualizada a ${newLengthMm.toFixed(0)} mm (línea aguas abajo desplazada).`
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
        statusMessage: `Extremos del niple actualizados: [${endFinish1} / ${endFinish2}].`
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
        statusMessage: `Propiedades de pieza actualizadas (${updated.type} • ${
          metadata.nippleTag || metadata.lineNumber || updated.id
        }).`
      });
    },

    splitSelectedPipeWithFitting: (fittingType, offsetMm, branchDir) => {
      const { graph, specReader, selectedComponentId, specCode, activeDirection } = get();
      if (!specReader || !selectedComponentId) {
        set({ statusMessage: 'Seleccione primero un tramo de cañería (PIPE) en 3D para partirlo.' });
        return;
      }
      const pipeComp = graph.components.get(selectedComponentId);
      if (!pipeComp || pipeComp.type !== 'PIPE') {
        set({ statusMessage: 'La pieza seleccionada no es un caño recto.' });
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
        set({ statusMessage: `No se encontró especificación para ${fittingType} ND ${nd}".` });
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
          statusMessage: `COMMAND: PLANTFITTINGADD • Caño partido en 2 niples (${Math.round(result.pipe1.parameters.cutLength || 0)} mm y ${Math.round(result.pipe2.parameters.cutLength || 0)} mm) con ${fittingType} insertado en línea.`
        });
      } catch (e: unknown) {
        set({ statusMessage: (e as Error).message });
      }
    },

    setLineNumber: (tag) => {
      const { graph } = get();
      graph.activeLineNumber = tag;
      set({ lineNumber: tag, statusMessage: `Line Number activo: ${tag}` });
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
          set({ statusMessage: `El archivo "${fileName}" no contenía bloques PCF válidos.` });
          return;
        }
        saveGraphToIndexedDb(importedGraph.serialize());
        const openPorts = importedGraph.getOpenPorts();
        const lastPort = openPorts.length > 0 ? openPorts[openPorts.length - 1] : null;
        const collisions = detectPipingCollisions(importedGraph);

        set({
          graph: importedGraph,
          lineNumber: lineReference,
          selectedPortId: lastPort ? lastPort.id : null,
          selectedComponentId: lastPort ? lastPort.componentId : null,
          activeDirection: lastPort ? lastPort.direction.clone().normalize() : new THREE.Vector3(1, 0, 0),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          triggerFrameAll: get().triggerFrameAll + 1,
          statusMessage: `COMMAND: PCFIMPORT • "${fileName}" cargado (${componentCount} piezas, ${pipeCount} caños, línea ${lineReference}, ${openPorts.length} bocas libres).${
            Object.keys(skipped).length
              ? ` Omitidos (Plant los regenera): ${Object.entries(skipped).map(([k, n]) => `${n} ${k}`).join(', ')}.`
              : ''
          }${warnings.length ? ` Avisos: ${warnings.join(' ')}` : ''}`
        });
      } catch (e: unknown) {
        set({ statusMessage: `Error importando PCF: ${(e as Error).message}` });
      }
    },

    deleteSelectedComponent: () => {
      const { graph, selectedComponentId, selectedPortId } = get();
      const targetId =
        selectedComponentId || (selectedPortId ? graph.ports.get(selectedPortId)?.componentId || null : null);
      if (!targetId) {
        set({ statusMessage: 'Seleccione una pieza o cañería para eliminarla.' });
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
          ? `Pieza eliminada (${removed.type} ${removed.parameters.nominalDiameter}").`
          : 'Pieza eliminada.'
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
        set({ statusMessage: 'Longitud inválida. Ingrese un valor mayor a cero en milímetros.' });
        return;
      }

      const pipeSpec = specReader.findPipe(nominalDiameter, specCode);
      if (!pipeSpec) {
        set({ statusMessage: `Especificación no disponible para cañería ND ${nominalDiameter}".` });
        return;
      }

      // Regla de niple mínimo: no permitir tramos rectos menores a max(50 mm, 2 * OD)
      const minNipple = Math.max(50, 2 * pipeSpec.outerDiameter);

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
          statusMessage: `COMMAND: PLANTPIPEADD • Tramo inicial de ${lengthMm} mm trazado en dirección activa.`
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
          statusMessage: 'Dirección opuesta (180°). Seleccione un desvío angular válido (90° o 45°).'
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
          statusMessage: `COMMAND: PLANTPIPEADD • Cañería recta de ${lengthMm} mm añadida.${autoNote}`
        });
        return;
      }

      // CASO 3: Giro angular (de eje a eje - vértice V)
      // Calcular ángulo de deflexión entre la dirección entrante (uIn) y saliente (dir)
      const uIn = incomingDirection.clone().normalize();
      const uOut = dir.clone().normalize();
      const bendAngleRad = Math.acos(THREE.MathUtils.clamp(uIn.dot(uOut), -1, 1));
      const bendAngleDeg = THREE.MathUtils.radToDeg(bendAngleRad);

      // Determinar si corresponde codo de 45° o 90°
      const targetElbowAngle = Math.abs(bendAngleDeg - 45) < 15 ? 45 : 90;
      const elbowSpec = specReader.findElbow(nominalDiameter, targetElbowAngle, specCode, findOpts(connectingPort));

      if (!elbowSpec) {
        set({
          statusMessage: `No se encontró codo de ${targetElbowAngle}° para ND ${nominalDiameter}" en catálogo.`
        });
        return;
      }

      const takeOff = elbowSpec.takeOff || (elbowSpec.radius ? elbowSpec.radius * Math.tan(bendAngleRad / 2) : 76.2);

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
          statusMessage: `Error: La longitud ${lengthMm} mm es menor que el take-off del codo (${takeOff.toFixed(1)} mm).`
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

          graph.removeComponent(prevPipeComp.id);
          const newPrevPipe = graph.addPipe(prevStart, cutPoint1, pipeSpec, netIncoming);

          const placement = calculateElbowPlacement(prevStart, vertex, pNext, takeOff, elbowSpec.radius);
          const elbow = graph.addElbow(placement, elbowSpec);
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
            statusMessage: `COMMAND: PLANTPIPEADD • ${elbowSpec.shortDescription} (recorte previo: ${netIncoming.toFixed(1)} mm | saliente: ${netOutgoing.toFixed(1)} mm netos).${geomWarn(elbowSpec)}`
          });
        } else {
          const placement = calculateElbowPlacement(pStart, vertex, pNext, takeOff, elbowSpec.radius);
          const elbow = graph.addElbow(placement, elbowSpec);
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
            statusMessage: `COMMAND: PLANTPIPEADD • ${elbowSpec.shortDescription} (saliente: ${netOutgoing.toFixed(1)} mm netos).${autoNote}${geomWarn(elbowSpec)}`
          });
        }
      } catch (e: unknown) {
        const err = e as Error;
        set({ statusMessage: `Error al calcular codo: ${err.message}` });
      }
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
        selectedComponentId: lastPort ? lastPort.componentId : null,
        activeDirection: lastPort ? lastPort.direction.clone().normalize() : new THREE.Vector3(1, 0, 0),
        version: get().version + 1,
        collidingComponentIds: collisions.collidingComponentIds,
        canUndo: undoSnapshots.length > 0,
        canRedo: true,
        statusMessage: 'COMMAND: UNDO • Acción deshecha con éxito.'
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
        selectedComponentId: lastPort ? lastPort.componentId : null,
        activeDirection: lastPort ? lastPort.direction.clone().normalize() : new THREE.Vector3(1, 0, 0),
        version: get().version + 1,
        collidingComponentIds: collisions.collidingComponentIds,
        canUndo: true,
        canRedo: redoSnapshots.length > 0,
        statusMessage: 'COMMAND: REDO • Acción rehecha con éxito.'
      });
    },

    frameAll: () => {
      set({ triggerFrameAll: get().triggerFrameAll + 1 });
    },

    toggleBom: () => set((state) => ({ isBomOpen: !state.isBomOpen })),

    toggleExport: () => set((state) => ({ isExportOpen: !state.isExportOpen })),

    toggleToolPalette: () => set((state) => ({ isToolPaletteOpen: !state.isToolPaletteOpen })),

    insertFitting: (type, options) => {
      const { graph, specReader, selectedPortId, nominalDiameter, specCode, activeDirection, numpadValue } = get();
      if (!specReader) return;

      // Determinar puerto de conexión activo
      let port = selectedPortId ? graph.ports.get(selectedPortId) : null;
      if (!port || port.connectedJointId) {
        const openPorts = graph.getOpenPorts();
        if (openPorts.length > 0) {
          port = openPorts[openPorts.length - 1];
        } else {
          set({ statusMessage: 'No hay puertos abiertos disponibles para insertar el accesorio.' });
          return;
        }
      }

      pushUndoSnapshot();

      // Caños y accesorios soldados no se atornillan a una cara: primero la brida de la spec
      let autoNote = '';
      if (type === 'PIPE' || type === 'ELBOW' || type === 'TEE' || type === 'REDUCER' || type === 'CAP') {
        const res = flangeOffFaceIfNeeded(port);
        port = res.port;
        autoNote = res.note;
      }

      if (type === 'PIPE') {
        const lengthMm = parseFloat(numpadValue) || 500;
        const pipeSpec = specReader.findPipe(nominalDiameter, specCode);
        if (!pipeSpec) {
          set({ statusMessage: `Cañería ND ${nominalDiameter}" no encontrada en catálogo.` });
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
          statusMessage: `COMMAND: PLANTPIPEADD • Tramo de ${lengthMm} mm insertado.${autoNote}`
        });
        return;
      }

      if (type === 'ELBOW') {
        const angle = options?.angle || 90;
        const elbowSpec = specReader.findElbow(port.nominalDiameter || nominalDiameter, angle, specCode, findOpts(port));
        if (!elbowSpec) {
          set({ statusMessage: `Codo de ${angle}° ND ${nominalDiameter}" no encontrado en catálogo.` });
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
          statusMessage: `COMMAND: PLANTFITTINGADD • ${elbowSpec.shortDescription} insertado. Use 'Girar 90°' para orientar la salida.${autoNote}${geomWarn(elbowSpec)}`
        });
        return;
      }

      if (type === 'FLANGE') {
        const nd = port.nominalDiameter || nominalDiameter;
        const flgSpec = specReader.findFlange(nd, specCode, findOpts(port));
        if (!flgSpec) {
          set({ statusMessage: `La spec no tiene brida de ${nd}".` });
          return;
        }
        const gasketSpec = specReader.findGasket(nd, specCode, { pressureClass: port.pressureClass || flgSpec.pressureClass });
        const boltSetSpec = specReader.findBoltSet(nd, specCode, { pressureClass: port.pressureClass || flgSpec.pressureClass });
        const flg = graph.addFlange(port, flgSpec, gasketSpec, boltSetSpec);
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: flg.ports[1].id,
          selectedComponentId: flg.id,
          activeDirection: flg.ports[1].direction.clone().normalize(),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `COMMAND: PLANTFITTINGADD • ${flgSpec.shortDescription}${isFaceEnd(port) ? ` + ${gasketSpec?.shortDescription || 'junta'}` : ''}.${geomWarn(flgSpec)}`
        });
        return;
      }

      if (type === 'VALVE') {
        const nd = port.nominalDiameter || nominalDiameter;
        const valveSpec = specReader.findValve(nd, specCode, findOpts(port));
        if (!valveSpec) {
          set({ statusMessage: `La spec no tiene válvula de ${nd}".` });
          return;
        }
        const gasketSpec = specReader.findGasket(nd, specCode, { pressureClass: valveSpec.pressureClass });
        const boltSetSpec = specReader.findBoltSet(nd, specCode, { pressureClass: valveSpec.pressureClass });
        // Válvula bridada sobre un caño o accesorio soldado: primero la brida (AutoFlange de Plant)
        const valveIsFlanged = isFaceEnd({ plantEndType: valveSpec.plantEndTypes?.[0], endType: valveSpec.endType });
        if (valveIsFlanged && !isFaceEnd(port)) {
          const flg = specReader.findFlange(nd, specCode, { connectToEndType: port.plantEndType, pressureClass: valveSpec.pressureClass });
          if (flg) {
            port = graph.addFlange(port, flg, gasketSpec, boltSetSpec).ports[1];
            autoNote = ` + ${flg.familyDescription || 'brida'} automática.`;
          }
        }
        const vlv = graph.addValve(port, valveSpec, gasketSpec, boltSetSpec);
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: vlv.ports[1].id,
          selectedComponentId: vlv.id,
          activeDirection: vlv.ports[1].direction.clone().normalize(),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `COMMAND: PLANTFITTINGADD • ${valveSpec.shortDescription}.${autoNote}${geomWarn(valveSpec)}`
        });
        return;
      }

      if (type === 'TEE') {
        const teeSpec = specReader.findTee(port.nominalDiameter || nominalDiameter, specCode, findOpts(port));
        if (!teeSpec) {
          set({ statusMessage: `Te ND ${nominalDiameter}" no encontrada en catálogo.` });
          return;
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
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: options?.continueOnBranch
            ? `COMMAND: PLANTFITTINGADD • ${teeSpec.shortDescription}. Continuando por el ramal.${autoNote}${geomWarn(teeSpec)}`
            : `COMMAND: PLANTFITTINGADD • ${teeSpec.shortDescription}. Elija 'Línea Recta' o 'Ramal 90°' en el panel de la Te.${autoNote}${geomWarn(teeSpec)}`
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
        const redSpec = targetND ? specReader.findReducer(nd, targetND, specCode, findOpts(port)) : null;
        if (!redSpec) {
          set({ statusMessage: `La spec no tiene reducción de ${nd}"${targetND ? ` a ${targetND}"` : ''}.` });
          return;
        }
        const red = graph.addReducer(port, redSpec);
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: red.ports[1].id,
          selectedComponentId: red.id,
          activeDirection: red.ports[1].direction.clone().normalize(),
          nominalDiameter: targetND,
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `COMMAND: PLANTFITTINGADD • ${redSpec.shortDescription}. Nuevo ND activo: ${targetND}".${autoNote}${geomWarn(redSpec)}`
        });
        return;
      }

      if (type === 'CAP') {
        const capSpec = specReader.findCap(port.nominalDiameter || nominalDiameter, specCode, findOpts(port));
        if (!capSpec) {
          set({ statusMessage: `Tapa / Casquete ND ${nominalDiameter}" no encontrada en catálogo.` });
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
          statusMessage: `COMMAND: PLANTFITTINGADD • ${capSpec.shortDescription} colocado.${autoNote}${geomWarn(capSpec)}`
        });
        return;
      }
    },

    resetGraph: async () => {
      pushUndoSnapshot();
      await clearGraphIndexedDb();
      const specName = get().specCode || 'CS150';
      const newGraph = new PipingGraph(specName, get().nominalDiameter, 'SCH 40');
      set({
        graph: newGraph,
        selectedPortId: null,
        selectedComponentId: null,
        snappedPortId: null,
        collidingComponentIds: new Set(),
        version: get().version + 1,
        statusMessage: 'Escena de cañerías reiniciada.'
      });
    }
  };
});
