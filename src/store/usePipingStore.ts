import { create } from 'zustand';
import * as THREE from 'three';
import { PipingGraph } from '../core/graph/PipingGraph';
import { SpecDatabaseReader } from '../core/specs/SpecDatabaseReader';
import { saveGraphToIndexedDb, loadGraphFromIndexedDb, clearGraphIndexedDb } from '../persistence/indexedDbStorage';
import { detectPipingCollisions } from '../viewport/collision/collisionDetector';
import { calculateElbowPlacement } from '../core/math/elbowSolver';
import { SerializedGraphState, ComponentType, NippleEndFinish } from '../types/piping';
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
    isExportOpen: false,
    isToolPaletteOpen: false,
    canUndo: false,
    canRedo: false,
    version: 0,
    triggerFrameAll: 0,
    cameraViewPreset: null,

    initialize: async () => {
      try {
        const reader = await SpecDatabaseReader.create();
        const specName = reader.specName || 'CS150';
        const initialGraph = new PipingGraph(specName, 2, 'SCH 40');

        // Cargar persistencia si existe
        const savedState = await loadGraphFromIndexedDb();
        if (savedState && Object.keys(savedState.components).length > 0) {
          initialGraph.deserialize(savedState);
          const openPorts = initialGraph.getOpenPorts();
          if (openPorts.length > 0) {
            set({ selectedPortId: openPorts[openPorts.length - 1].id });
          }
        } else {
          // Sembrar un tramo inicial de demostración (1000 mm en +X girando 90° a +Y con corte real)
          const pipeSpec = reader.findPipe(2, specName);
          const elbowSpec = reader.findElbow(2, 90, specName);
          if (pipeSpec && elbowSpec) {
            initialGraph.routeTurnWithElbow(
              new THREE.Vector3(0, 0, 0),
              new THREE.Vector3(1000, 0, 0),
              new THREE.Vector3(1000, 1000, 0),
              pipeSpec,
              elbowSpec
            );
            const open = initialGraph.getOpenPorts();
            if (open.length > 0) {
              set({ selectedPortId: open[open.length - 1].id });
            }
          }
        }

        const collisions = detectPipingCollisions(initialGraph);

        set({
          specReader: reader,
          specCode: specName,
          graph: initialGraph,
          collidingComponentIds: collisions.collidingComponentIds,
          version: 1,
          statusMessage: reader.isNativePlant3D 
            ? `COMMAND: PLANTSPECSET • Especificación AutoCAD Plant 3D '${specName}' activa.`
            : `Catálogo estándar '${specName}' listo.`
        });
      } catch (err) {
        console.error('Error inicializando estado de piping:', err);
        set({ statusMessage: 'Error al inicializar la base de datos de especificaciones.' });
      }
    },

    loadPspcFile: async (buffer: ArrayBuffer, fileName: string) => {
      try {
        const reader = await SpecDatabaseReader.create(buffer);
        const specName = reader.specName || fileName.replace(/\.[^/.]+$/, '');
        const available = reader.getAvailableNominalDiameters(specName);
        const newND = available.includes(get().nominalDiameter) ? get().nominalDiameter : (available[0] || 2);
        
        get().graph.activeSpec = specName;
        get().graph.currentNominalDiameter = newND;

        set({
          specReader: reader,
          specCode: specName,
          nominalDiameter: newND,
          version: get().version + 1,
          statusMessage: `COMMAND: PLANTSPECSET • Especificación '${fileName}' cargada (${available.length} diámetros disponibles).`
        });
      } catch (err) {
        console.error('Error cargando archivo .pspc:', err);
        set({ statusMessage: `Error al leer '${fileName}'. Verifique que sea un archivo .pspc válido.` });
      }
    },

    loadBuiltInSpec: async (targetSpecName: string) => {
      try {
        const fileName = `${targetSpecName}.pspc`;
        let reader: SpecDatabaseReader;
        try {
          const resp = await fetch(`/${fileName}`);
          if (resp.ok) {
            const buffer = await resp.arrayBuffer();
            reader = await SpecDatabaseReader.fromBuffer(buffer, targetSpecName);
          } else {
            reader = await SpecDatabaseReader.createDefault(targetSpecName);
          }
        } catch {
          reader = await SpecDatabaseReader.createDefault(targetSpecName);
        }
        const available = reader.getAvailableNominalDiameters(targetSpecName);
        const newND = available.includes(get().nominalDiameter)
          ? get().nominalDiameter
          : available.includes(2)
          ? 2
          : available[0] || 2;

        get().graph.activeSpec = targetSpecName;
        get().graph.currentNominalDiameter = newND;

        set({
          specReader: reader,
          specCode: targetSpecName,
          nominalDiameter: newND,
          version: get().version + 1,
          statusMessage: `COMMAND: PLANTSPECSET • Spec AutoCAD Plant 3D '${targetSpecName}' activada (${available.length} ND).`
        });
      } catch (err) {
        console.error('Error cargando spec integrada:', err);
        set({ statusMessage: `No se pudo cargar la especificación ${targetSpecName}.pspc.` });
      }
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
          const reducerSpec = specReader.findReducer(currentND, nd, specCode);
          if (reducerSpec && reducerSpec.faceToFace) {
            pushUndoSnapshot();
            const L = reducerSpec.faceToFace;
            const endPoint = port.position.clone().add(port.direction.clone().multiplyScalar(L));

            const comp = graph.addPipe(port.position, endPoint, reducerSpec, L);
            comp.type = 'REDUCER';
            graph.connectPorts(port.id, comp.ports[0].id, 'BUTTWELD');
            
            saveGraphToIndexedDb(graph.serialize());
            set({
              selectedPortId: comp.ports[1].id,
              nominalDiameter: nd,
              version: get().version + 1,
              statusMessage: `Reducción concéntrica ${currentND}"x${nd}" insertada (${L.toFixed(1)} mm cara a cara).`
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

      const gasketSpec = specReader.findGasket(nd, specCode);
      const boltSetSpec = specReader.findBoltSet(nd, specCode);

      try {
        pushUndoSnapshot();
        const result = graph.splitPipeWithFitting(pipeComp.id, fitSpec, pipeSpec, {
          offsetMm,
          branchDir: branchDir || activeDirection,
          gasketSpec,
          boltSetSpec
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
        const { graph: importedGraph, componentCount, pipeCount, lineReference } = PcfImporter.importFromPcf(
          content,
          specReader,
          specCode
        );
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
          statusMessage: `COMMAND: PCFIMPORT • "${fileName}" cargado (${componentCount} piezas, ${pipeCount} niples en línea ${lineReference}).`
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

      // CASO 1: Tramo inicial desde el origen si no hay caños
      if (!connectingPort) {
        pushUndoSnapshot();
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
        pushUndoSnapshot();
        const endPoint = startPoint.clone().add(dir.clone().multiplyScalar(lengthMm));
        const pipe = graph.addPipe(startPoint, endPoint, pipeSpec, lengthMm);
        graph.connectPorts(connectingPort.id, pipe.ports[0].id, 'BUTTWELD');

        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: pipe.ports[1].id,
          selectedComponentId: pipe.id,
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `COMMAND: PLANTPIPEADD • Cañería recta de ${lengthMm} mm añadida con éxito.`
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
      const elbowSpec = specReader.findElbow(nominalDiameter, targetElbowAngle, specCode);

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
        pushUndoSnapshot();

        if (canCutPreviousPipe && prevPipeComp) {
          const prevStart = prevPipeComp.centerline[0].clone();
          const cutPoint1 = vertex.clone().sub(uIn.clone().multiplyScalar(takeOff));
          const netIncoming = prevStart.distanceTo(cutPoint1);

          graph.removeComponent(prevPipeComp.id);
          const newPrevPipe = graph.addPipe(prevStart, cutPoint1, pipeSpec, netIncoming);

          const placement = calculateElbowPlacement(prevStart, vertex, pNext, takeOff, elbowSpec.radius);
          const elbow = graph.addElbow(placement, elbowSpec);
          graph.connectPorts(newPrevPipe.ports[1].id, elbow.ports[0].id, 'BUTTWELD');

          const netOutgoing = placement.netLengthOutgoing;
          const pipeOut = graph.addPipe(placement.cutPoint2, pNext, pipeSpec, netOutgoing);
          graph.connectPorts(elbow.ports[1].id, pipeOut.ports[0].id, 'BUTTWELD');

          saveGraphToIndexedDb(graph.serialize());
          const collisions = detectPipingCollisions(graph);
          set({
            selectedPortId: pipeOut.ports[1].id,
            selectedComponentId: pipeOut.id,
            collidingComponentIds: collisions.collidingComponentIds,
            version: get().version + 1,
            statusMessage: `COMMAND: PLANTPIPEADD • Giro codo ${targetElbowAngle}° (recorte previo: ${netIncoming.toFixed(1)} mm | saliente: ${netOutgoing.toFixed(1)} mm netos).`
          });
        } else {
          const placement = calculateElbowPlacement(pStart, vertex, pNext, takeOff, elbowSpec.radius);
          const elbow = graph.addElbow(placement, elbowSpec);
          graph.connectPorts(connectingPort.id, elbow.ports[0].id, 'BUTTWELD');

          const netOutgoing = placement.netLengthOutgoing;
          const pipeOut = graph.addPipe(placement.cutPoint2, pNext, pipeSpec, netOutgoing);
          graph.connectPorts(elbow.ports[1].id, pipeOut.ports[0].id, 'BUTTWELD');

          saveGraphToIndexedDb(graph.serialize());
          const collisions = detectPipingCollisions(graph);
          set({
            selectedPortId: pipeOut.ports[1].id,
            selectedComponentId: pipeOut.id,
            collidingComponentIds: collisions.collidingComponentIds,
            version: get().version + 1,
            statusMessage: `COMMAND: PLANTPIPEADD • Giro codo ${targetElbowAngle}° agregado (saliente: ${netOutgoing.toFixed(1)} mm netos).`
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

      if (type === 'PIPE') {
        const lengthMm = parseFloat(numpadValue) || 500;
        const pipeSpec = specReader.findPipe(nominalDiameter, specCode);
        if (!pipeSpec) {
          set({ statusMessage: `Cañería ND ${nominalDiameter}" no encontrada en catálogo.` });
          return;
        }
        const endPoint = port.position.clone().add(port.direction.clone().multiplyScalar(lengthMm));
        const newPipe = graph.addPipe(port.position, endPoint, pipeSpec, lengthMm);
        graph.connectPorts(port.id, newPipe.ports[0].id, 'BUTTWELD');
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: newPipe.ports[1].id,
          selectedComponentId: newPipe.id,
          activeDirection: newPipe.ports[1].direction.clone().normalize(),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `COMMAND: PLANTPIPEADD • Tramo de ${lengthMm} mm insertado con éxito.`
        });
        return;
      }

      if (type === 'ELBOW') {
        const angle = options?.angle || 90;
        const elbowSpec = specReader.findElbow(nominalDiameter, angle, specCode);
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
        graph.connectPorts(port.id, elbow.ports[0].id, 'BUTTWELD');

        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: elbow.ports[1].id,
          selectedComponentId: elbow.id,
          activeDirection: uOut.clone().normalize(),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `COMMAND: PLANTFITTINGADD • Codo ${angle}° ND ${nominalDiameter}" insertado. Use 'Girar 90°' para orientar salida.`
        });
        return;
      }

      if (type === 'FLANGE') {
        const flgSpec = specReader.findFlange(nominalDiameter, specCode);
        if (!flgSpec) {
          set({ statusMessage: `Brida ND ${nominalDiameter}" no encontrada en catálogo.` });
          return;
        }
        const gasketSpec = specReader.findGasket(nominalDiameter, specCode);
        const boltSetSpec = specReader.findBoltSet(nominalDiameter, specCode);
        const flg = graph.addFlange(port, flgSpec, gasketSpec, boltSetSpec);
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: flg.ports[1].id,
          selectedComponentId: flg.id,
          activeDirection: flg.ports[1].direction.clone().normalize(),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `COMMAND: PLANTFITTINGADD • Brida WN ${nominalDiameter}" + Junta (${gasketSpec?.shortDescription || 'Gasket'}) + Espárragos (${boltSetSpec?.boltCount || 4}x ${boltSetSpec?.boltSize || '1/2"'}) [P3dJoint].`
        });
        return;
      }

      if (type === 'VALVE') {
        const valveSpec = specReader.findValve(nominalDiameter, specCode);
        if (!valveSpec) {
          set({ statusMessage: `Válvula ND ${nominalDiameter}" no encontrada en catálogo.` });
          return;
        }
        const gasketSpec = specReader.findGasket(nominalDiameter, specCode);
        const boltSetSpec = specReader.findBoltSet(nominalDiameter, specCode);
        const vlv = graph.addValve(port, valveSpec, gasketSpec, boltSetSpec);
        saveGraphToIndexedDb(graph.serialize());
        const collisions = detectPipingCollisions(graph);
        set({
          selectedPortId: vlv.ports[1].id,
          selectedComponentId: vlv.id,
          activeDirection: vlv.ports[1].direction.clone().normalize(),
          collidingComponentIds: collisions.collidingComponentIds,
          version: get().version + 1,
          statusMessage: `COMMAND: PLANTFITTINGADD • ${valveSpec.shortDescription || 'Válvula'} ${nominalDiameter}" + 2x Juntas + 2x Juegos Espárragos (${boltSetSpec?.boltCount || 4}x ${boltSetSpec?.boltSize || '1/2"'}) [P3dJoint].`
        });
        return;
      }

      if (type === 'TEE') {
        const teeSpec = specReader.findTee(nominalDiameter, specCode);
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
            ? `COMMAND: PLANTFITTINGADD • Te ND ${nominalDiameter}" insertada. Continuando por RAMAL 90° (Boca #3).`
            : `COMMAND: PLANTFITTINGADD • Te ND ${nominalDiameter}" insertada. Elija 'Línea Recta' o 'Ramal 90°' en el panel de la Te.`
        });
        return;
      }

      if (type === 'REDUCER') {
        const targetND = options?.targetNd || (nominalDiameter > 1 ? nominalDiameter - 1 : 2);
        const redSpec = specReader.findReducer(nominalDiameter, targetND, specCode);
        if (!redSpec) {
          set({ statusMessage: `Reducción concéntrica ${nominalDiameter}"x${targetND}" no encontrada.` });
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
          statusMessage: `COMMAND: PLANTFITTINGADD • Reducción ${nominalDiameter}"x${targetND}" insertada. Nuevo ND activo: ${targetND}".`
        });
        return;
      }

      if (type === 'CAP') {
        const capSpec = specReader.findCap(nominalDiameter, specCode);
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
          statusMessage: `COMMAND: PLANTFITTINGADD • Casquete ND ${nominalDiameter}" colocado (extremo cerrado).`
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
