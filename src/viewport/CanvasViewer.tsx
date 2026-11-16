import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { usePipingStore, isolatedIds } from '../store/usePipingStore';
import { ViewCube } from './ViewCube';
import { usePhoneLayout } from '../ui/useIsPhone';
import { buildComponentObject } from './buildComponentMesh';
import { disposeObject } from './geometries/geometryUtils';
import { setPieceHidden, SUPPORT_KEY, visibleBounds } from './meshBatches';
import { IncrementalBatches } from './incrementalBatches';
import { buildSupportObject, createModelMaterials, modelPieces, ModelMaterials } from './modelPieces';
import { computeSpools } from '../core/spools/spoolEngine';
import { SPOOL_COLORS, ERECTION_COLOR, FIELD_COLORS, FIELD_UNCHANGED_COLOR } from './spoolColors';
import { useProjectStore } from '../store/useProjectStore';
import { diffStates } from '../core/field/changeLog';
import { findScreenMagneticSnap } from './snapping/magneticSnap';
import { buildModelLabels, ModelLabel } from './modelLabels';
import { useUiConfigStore } from '../store/useUiConfigStore';
import { useReferenceStore } from '../store/useReferenceStore';
import { supportDimensions } from '../core/graph/supportDimensions';

// Configurar orientación industrial estándar Z-Up globalmente
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export const CanvasViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const graph = usePipingStore((s) => s.graph);
  const version = usePipingStore((s) => s.version);
  const cameraMode = usePipingStore((s) => s.cameraMode);
  const selectedPortId = usePipingStore((s) => s.selectedPortId);
  const selectedComponentId = usePipingStore((s) => s.selectedComponentId);
  const selectedSupportId = usePipingStore((s) => s.selectedSupportId);
  const cameraViewPreset = usePipingStore((s) => s.cameraViewPreset);
  const activeDirection = usePipingStore((s) => s.activeDirection);
  const numpadValue = usePipingStore((s) => s.numpadValue);
  const collidingComponentIds = usePipingStore((s) => s.collidingComponentIds);
  const spoolView = usePipingStore((s) => s.spoolView);
  const fieldView = useProjectStore((s) => s.fieldView);
  const fieldBaseline = useProjectStore((s) => s.baseline);
  const triggerFrameAll = usePipingStore((s) => s.triggerFrameAll);
  const focusRequest = usePipingStore((s) => s.focusRequest);
  const setSnappedPortId = usePipingStore((s) => s.setSnappedPortId);
  const selectPortAndAlign = usePipingStore((s) => s.selectPortAndAlign);
  const setSelectedComponentId = usePipingStore((s) => s.setSelectedComponentId);
  const connectRoutes = usePipingStore((s) => s.connectRoutes);
  const connectIndex = usePipingStore((s) => s.connectIndex);
  const connectTargetId = usePipingStore((s) => s.connectTargetId);
  const connectPicking = usePipingStore((s) => s.connectPicking);
  const applyRouting = usePipingStore((s) => s.applyRouting);
  const multiSelect = usePipingStore((s) => s.multiSelect);
  const multiMode = usePipingStore((s) => s.multiMode);
  const isolation = usePipingStore((s) => s.isolation);
  const measureActive = usePipingStore((s) => s.measureActive);
  const measurePoints = usePipingStore((s) => s.measurePoints);
  const sectionBox = usePipingStore((s) => s.sectionBox);
  const phone = usePhoneLayout();
  // Estirar un caño arrastrando su grip: largo provisorio hasta soltar
  const [stretch, setStretch] = useState<{ compId: string; anchor: 'start' | 'end'; length: number } | null>(null);
  // Cota del caño elegido: al tocarla se edita el largo
  const [lengthEdit, setLengthEdit] = useState<string | null>(null);
  // Tocar la cota de una etiqueta elige el caño y abre la edición del largo
  const pendingLengthEditRef = useRef(false);

  // Etiquetas permanentes (interruptor en Vistas)
  const showLabels = useUiConfigStore((s) => s.showLabels);
  const labels = useMemo<ModelLabel[]>(
    () =>
      showLabels
        ? buildModelLabels(graph, isolatedIds(graph, isolation)).filter((l) => !(l.kind === 'cota' && l.componentId === selectedComponentId))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showLabels, graph, version, isolation, selectedComponentId]
  );
  const labelsDataRef = useRef<ModelLabel[]>([]);
  const labelElsRef = useRef<(HTMLElement | null)[]>([]);
  labelsDataRef.current = labels;

  // Referencia de obra (DXF de fondo)
  const reference = useReferenceStore((s) => s.reference);
  const refGroupRef = useRef<THREE.LineSegments | null>(null);

  // Referencias para la escena Three.js
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const pipeGroupRef = useRef<THREE.Group | null>(null);
  /** Mallas fusionadas del modelo, para apagar y prender piezas al elegirlas */
  const batchesRef = useRef<THREE.Mesh[]>([]);
  const incrementalRef = useRef<IncrementalBatches | null>(null);
  const modelMaterialsRef = useRef<ModelMaterials | null>(null);
  const portsGroupRef = useRef<THREE.Group | null>(null);
  const cursorGroupRef = useRef<THREE.Group | null>(null);
  // Compás sobre la boca activa y manija de largo: se dibujan en píxeles y se reescalan en cada cuadro
  const gizmoRef = useRef<THREE.Group | null>(null);
  const handleRef = useRef<THREE.Group | null>(null);
  const labelRef = useRef<HTMLButtonElement>(null);
  const dragLengthRef = useRef<{ origin: THREE.Vector3; dir: THREE.Vector3 } | null>(null);
  const gripsRef = useRef<THREE.Object3D[]>([]);
  const dimRef = useRef<HTMLDivElement>(null);
  const dimPosRef = useRef<THREE.Vector3 | null>(null);
  // Cotas del soporte elegido hasta lo que tiene a cada lado (se tocan para escribir la medida)
  const supDimElsRef = useRef<(HTMLDivElement | null)[]>([null, null]);
  const supDimPosRef = useRef<(THREE.Vector3 | null)[]>([null, null]);
  const [supDimEdit, setSupDimEdit] = useState<{ side: 'back' | 'ahead'; text: string } | null>(null);
  useEffect(() => setSupDimEdit(null), [selectedSupportId]);
  const dragStretchRef = useRef<{ compId: string; anchor: 'start' | 'end'; fixed: THREE.Vector3; dir: THREE.Vector3; length: number; start: number } | null>(null);
  const longPressRef = useRef<{ timer: number; fired: boolean } | null>(null);
  // Cubo de vistas: gira con la cámara; al tocar una cara la cámara va hasta esa vista
  const cubeRef = useRef<HTMLDivElement>(null);
  const viewAnimRef = useRef<{ azimuth: number; polar: number } | null>(null);
  // Medida entre dos puntos: marcas de tamaño fijo en pantalla y cartel en el medio
  const measureDotsRef = useRef<THREE.Object3D[]>([]);
  const measureLabelRef = useRef<HTMLDivElement>(null);
  const measureMidRef = useRef<THREE.Vector3 | null>(null);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  // Estado de control de cámara táctil (Z-Up)
  const cameraTargetRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const cameraDistanceRef = useRef<number>(2500);
  const cameraPolarRef = useRef<number>(Math.PI / 3); // 60° de inclinación isométrica
  const cameraAzimuthRef = useRef<number>(-Math.PI / 4); // -45° en horizontal

  // Seguimiento táctil multitouch y detección de tap vs drag
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const previousTouchDistRef = useRef<number | null>(null);
  const previousTouchCenterRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Inicializar Escena Three.js (Fondo oscuro CAD Plant 3D: #11161d)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x11161d);
    sceneRef.current = scene;

    // 2. Inicializar Cámara Perspectiva con Z-Up
    const camera = new THREE.PerspectiveCamera(45, width / height, 10, 80000);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    // 3. Inicializar Renderizador WebGL
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    rendererRef.current = renderer;

    // 4. Iluminación Técnica Industrial (Shaded with Edges look)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.35);
    dirLight1.position.set(2500, 3500, 4500);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.55);
    dirLight2.position.set(-2500, -2000, 1500);
    scene.add(dirLight2);

    const dirLight3 = new THREE.DirectionalLight(0xffffff, 0.4);
    dirLight3.position.set(0, 2000, -3000);
    scene.add(dirLight3);

    // 5. Cuadrícula de Referencia CAD (Plano XY Z=0)
    const grid = new THREE.GridHelper(6000, 60, 0x334155, 0x1e293b);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    // Ejes WCS en el origen (X=Rojo, Y=Verde, Z=Azul)
    const axes = new THREE.AxesHelper(350);
    axes.renderOrder = 1;
    scene.add(axes);

    // 6. Grupos para componentes, puertos y cursor activo
    const pipeGroup = new THREE.Group();
    const portsGroup = new THREE.Group();
    const cursorGroup = new THREE.Group();
    scene.add(pipeGroup);
    scene.add(portsGroup);
    scene.add(cursorGroup);
    pipeGroupRef.current = pipeGroup;
    portsGroupRef.current = portsGroup;
    cursorGroupRef.current = cursorGroup;

    // 7. Actualizar posición inicial de la cámara
    updateCameraPosition();

    // 8. Manejo de pérdida de contexto WebGL
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.warn('Achero Plant 3D: WebGLContextLost detectado.');
    };

    const handleContextRestored = () => {
      console.info('Achero Plant 3D: WebGLContextRestored. Reconstruyendo escena.');
      usePipingStore.getState().initialize();
    };

    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    // 9. Bucle de animación (60 FPS)
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Snapping magnético continuo en pantalla con el grafo actual
      if (cameraRef.current && containerRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        const currentGraph = usePipingStore.getState().graph;
        const openPorts = currentGraph.getOpenPorts();
        const snap = findScreenMagneticSnap(openPorts, cameraRef.current, w, h, 35);
        setSnappedPortId(snap.isSnapped && snap.snappedPort ? snap.snappedPort.id : null);
      }

      // Compás y manija con tamaño constante en pantalla; cota de largo pegada a la manija
      const viewH = containerRef.current?.clientHeight || 1;
      const viewW = containerRef.current?.clientWidth || 1;
      const unitsPerPixel = (pos: THREE.Vector3) =>
        (2 * camera.position.distanceTo(pos) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / viewH;
      const gizmo = gizmoRef.current;
      if (gizmo) gizmo.scale.setScalar(unitsPerPixel(gizmo.position));
      const handle = handleRef.current;
      if (handle) handle.scale.setScalar(unitsPerPixel(handle.position));
      const label = labelRef.current;
      if (label) {
        let shown = false;
        if (handle) {
          const ndc = handle.position.clone().project(camera);
          if (ndc.z < 1 && Math.abs(ndc.x) < 1.05 && Math.abs(ndc.y) < 1.05) {
            const x = ((ndc.x + 1) / 2) * viewW;
            const y = ((1 - ndc.y) / 2) * viewH;
            label.style.transform = `translate(${Math.round(Math.min(x + 18, viewW - 120))}px, ${Math.round(Math.max(y - 46, 4))}px)`;
            shown = true;
          }
        }
        label.style.visibility = shown ? 'visible' : 'hidden';
      }
      for (const grip of gripsRef.current) grip.scale.setScalar(unitsPerPixel(grip.position));
      const dim = dimRef.current;
      if (dim) {
        const pos = dimPosRef.current;
        const ndc = pos ? pos.clone().project(camera) : null;
        if (ndc && ndc.z < 1 && Math.abs(ndc.x) < 1.05 && Math.abs(ndc.y) < 1.05) {
          const x = ((ndc.x + 1) / 2) * viewW;
          const y = ((1 - ndc.y) / 2) * viewH;
          dim.style.transform = `translate(${Math.round(Math.max(4, Math.min(x, viewW - 150)))}px, ${Math.round(Math.max(y + 14, 4))}px)`;
          dim.style.visibility = 'visible';
        } else dim.style.visibility = 'hidden';
      }

      for (let i = 0; i < 2; i++) {
        const el = supDimElsRef.current[i];
        if (!el) continue;
        const pos = supDimPosRef.current[i];
        const ndc = pos ? pos.clone().project(camera) : null;
        if (ndc && ndc.z < 1 && Math.abs(ndc.x) < 1.05 && Math.abs(ndc.y) < 1.05) {
          const x = ((ndc.x + 1) / 2) * viewW;
          const y = ((1 - ndc.y) / 2) * viewH;
          el.style.transform = `translate(${Math.round(Math.max(4, Math.min(x, viewW - 60)))}px, ${Math.round(Math.max(y, 20))}px) translate(-50%, -50%)`;
          el.style.visibility = 'visible';
        } else el.style.visibility = 'hidden';
      }

      // Vista pedida desde el cubo: la cámara gira hasta ahí por el camino corto
      const anim = viewAnimRef.current;
      if (anim) {
        const da = Math.atan2(Math.sin(anim.azimuth - cameraAzimuthRef.current), Math.cos(anim.azimuth - cameraAzimuthRef.current));
        const dp = anim.polar - cameraPolarRef.current;
        if (Math.abs(da) < 0.004 && Math.abs(dp) < 0.004) {
          cameraAzimuthRef.current = anim.azimuth;
          cameraPolarRef.current = anim.polar;
          viewAnimRef.current = null;
        } else {
          cameraAzimuthRef.current += da * 0.22;
          cameraPolarRef.current += dp * 0.22;
        }
        updateCameraPosition();
      }

      // El cubo de vistas copia el giro de la cámara (mundo Z arriba -> pantalla CSS con Y hacia abajo)
      const cube = cubeRef.current;
      if (cube) {
        const e = camera.matrixWorldInverse.elements;
        const m = [e[0], -e[1], e[2], 0, -e[8], e[9], -e[10], 0, -e[4], e[5], -e[6], 0, 0, 0, 0, 1];
        cube.style.transform = `matrix3d(${m.map((n) => n.toFixed(5)).join(',')})`;
      }

      for (const dot of measureDotsRef.current) dot.scale.setScalar(unitsPerPixel(dot.position));
      const mLabel = measureLabelRef.current;
      if (mLabel) {
        const mid = measureMidRef.current;
        const ndc = mid ? mid.clone().project(camera) : null;
        if (ndc && ndc.z < 1 && Math.abs(ndc.x) < 1.05 && Math.abs(ndc.y) < 1.05) {
          const x = ((ndc.x + 1) / 2) * viewW;
          const y = ((1 - ndc.y) / 2) * viewH;
          mLabel.style.transform = `translate(${Math.round(Math.max(4, Math.min(x - 70, viewW - 170)))}px, ${Math.round(Math.max(y - 52, 4))}px)`;
          mLabel.style.visibility = 'visible';
        } else mLabel.style.visibility = 'hidden';
      }

      // Etiquetas del modelo: siguen a su caño y se ocultan cuando el caño queda muy chico en pantalla
      const labelList = labelsDataRef.current;
      for (let i = 0; i < labelList.length; i++) {
        const el = labelElsRef.current[i];
        if (!el) continue;
        const item = labelList[i];
        const ndc = item.position.clone().project(camera);
        let shown = ndc.z < 1 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1;
        if (shown) {
          const a = item.a.clone().project(camera);
          const b = item.b.clone().project(camera);
          const px = Math.hypot(((a.x - b.x) * viewW) / 2, ((a.y - b.y) * viewH) / 2);
          shown = px > (item.kind === 'cota' ? 52 : 110);
        }
        if (shown) {
          const x = ((ndc.x + 1) / 2) * viewW;
          const y = ((1 - ndc.y) / 2) * viewH + (item.kind === 'elev' ? -24 : item.kind === 'linea' ? 24 : 0);
          el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
        }
        el.style.visibility = shown ? 'visible' : 'hidden';
      }

      renderer.render(scene, camera);
    };
    animate();

    // 10. Redimensionado
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      disposeObject(scene);
      renderer.dispose();
    };
  }, []);

  // Actualiza la posición de la cámara según los ángulos polares y la distancia
  const updateCameraPosition = () => {
    if (!cameraRef.current) return;
    const cam = cameraRef.current;
    const target = cameraTargetRef.current;
    const r = cameraDistanceRef.current;
    const polar = cameraPolarRef.current;
    const azimuth = cameraAzimuthRef.current;

    // Conversión a coordenadas esféricas con Z-Up
    const x = target.x + r * Math.sin(polar) * Math.sin(azimuth);
    const y = target.y + r * Math.sin(polar) * Math.cos(azimuth);
    const z = target.z + r * Math.cos(polar);

    cam.position.set(x, y, z);
    cam.lookAt(target);
  };

  // Función Encuadrar Todo (Zoom Extents)
  const executeFrameAll = () => {
    if (!cameraRef.current || !pipeGroupRef.current) return;
    // Solo lo visible: en la malla fusionada una pieza borrada queda apagada hasta el reagrupado
    const box = visibleBounds(pipeGroupRef.current);
    // Sin cañerías todavía: se encuadra la referencia de obra, si hay una a la vista
    if (box.isEmpty() && refGroupRef.current?.visible) box.setFromObject(refGroupRef.current);
    if (box.isEmpty()) {
      // Modelo vacío: el primer tramo sale del origen, que queda al centro
      cameraTargetRef.current.set(0, 0, 0);
      cameraDistanceRef.current = 2500;
    } else {
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z, 350);
      cameraTargetRef.current.copy(center);
      // En pantallas angostas (teléfono vertical) hace falta alejarse más para que entre a lo ancho
      cameraDistanceRef.current = (maxDim * 2.1) / Math.min(1, cameraRef.current.aspect * 1.05);
    }
    updateCameraPosition();
  };

  useEffect(() => {
    if (triggerFrameAll > 0) {
      // Después de reconstruir las mallas (al importar un PCF el modelo nuevo todavía no está dibujado)
      const id = requestAnimationFrame(() => executeFrameAll());
      return () => cancelAnimationFrame(id);
    }
  }, [triggerFrameAll]);

  // Aplicar vistas predefinidas del ViewCube (TOP, FRONT, RIGHT, ISO)
  useEffect(() => {
    if (cameraViewPreset) {
      cameraAzimuthRef.current = cameraViewPreset.azimuth;
      cameraPolarRef.current = cameraViewPreset.polar;
      executeFrameAll();
    }
  }, [cameraViewPreset]);

  // En ROUTE_MODE centrar suavemente sobre el puerto activo seleccionado
  useEffect(() => {
    if (cameraMode === 'ROUTE_MODE' && selectedPortId) {
      const port = graph.ports.get(selectedPortId);
      if (port) {
        // Al centro queda el tramo que se está por trazar, con su manija de largo a la vista
        const len = Math.min(parseFloat(usePipingStore.getState().numpadValue) || 500, 4000);
        cameraTargetRef.current.copy(port.position).addScaledVector(activeDirection, len / 2);
        const cam = cameraRef.current;
        if (cam && !dragLengthRef.current) {
          const fit = (len * 1.35) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * Math.min(cam.aspect, 0.62));
          if (fit > cameraDistanceRef.current) cameraDistanceRef.current = Math.min(fit, 12000);
        }
        updateCameraPosition();
      }
    }
  }, [cameraMode, selectedPortId, version, activeDirection]);

  // Al proponer un recorrido de conexión, se encuadra entero para poder compararlo con los otros
  useEffect(() => {
    const route = connectRoutes[connectIndex];
    const cam = cameraRef.current;
    if (!route || !cam) return;
    const box = new THREE.Box3().setFromPoints(route.points);
    const size = box.getSize(new THREE.Vector3());
    box.getCenter(cameraTargetRef.current);
    const span = Math.max(size.length(), 400);
    cameraDistanceRef.current = THREE.MathUtils.clamp(
      (span * 1.25) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * Math.min(cam.aspect, 0.62)),
      150,
      35000
    );
    updateCameraPosition();
  }, [connectRoutes, connectIndex]);

  // Reconstrucción reactiva del modelo. Solo se rearman las piezas cuya forma, posición o color
  // cambió; el resto sigue en la malla fusionada que ya estaba (ver incrementalBatches.ts)
  useEffect(() => {
    const pipeGroup = pipeGroupRef.current;
    if (!pipeGroup) return;
    if (!modelMaterialsRef.current) modelMaterialsRef.current = createModelMaterials();
    if (!incrementalRef.current) incrementalRef.current = new IncrementalBatches();
    const materials = modelMaterialsRef.current;

    // Vista por spools: un color por spool y gris para el material de montaje
    const spoolResult = spoolView ? computeSpools(graph) : null;
    const spoolColorIndex = new Map(spoolResult?.spools.map((sp) => [sp.id, sp.colorIndex]) ?? []);
    // Vista de campo: lo que cambió respecto del PCF de Plant, por color
    const fieldColor = new Map<string, number>();
    if (fieldView && fieldBaseline) {
      for (const ch of diffStates(fieldBaseline, graph.serialize())) {
        const color = FIELD_COLORS[ch.kind];
        for (const id of ch.componentIds ?? [ch.componentId]) {
          // Lo agregado o editado se ve antes que lo solo movido
          if (!fieldColor.has(id) || ch.kind === 'added' || ch.kind === 'edited') fieldColor.set(id, color);
        }
      }
    }
    const colorOf = (compId: string): number | null => {
      if (fieldView && fieldBaseline) return fieldColor.get(compId) ?? FIELD_UNCHANGED_COLOR;
      if (!spoolResult) return null;
      const sid = spoolResult.spoolOf.get(compId);
      return sid ? SPOOL_COLORS[(spoolColorIndex.get(sid) ?? 0) % SPOOL_COLORS.length] : ERECTION_COLOR;
    };

    const specs = modelPieces(graph, {
      materials,
      // Con una línea aislada, lo demás no se dibuja (ni se puede tocar)
      visibleIds: isolatedIds(graph, isolation),
      colliding: collidingComponentIds,
      colorOf
    });
    const { batches, rest } = incrementalRef.current.update(specs);
    // Lo que sale de la escena no se libera acá: son mallas guardadas o ya liberadas por update()
    pipeGroup.clear();
    for (const obj of [...batches, ...rest]) pipeGroup.add(obj);
    batchesRef.current = batches;
  }, [graph, version, collidingComponentIds, spoolView, fieldView, fieldBaseline, isolation]);

  // Al cerrar el visor se sueltan las mallas guardadas y los materiales del modelo
  useEffect(
    () => () => {
      incrementalRef.current?.dispose();
      incrementalRef.current = null;
      modelMaterialsRef.current?.dispose();
      modelMaterialsRef.current = null;
    },
    []
  );

  // Pieza elegida y selección múltiple: se apagan sus triángulos en las mallas fusionadas y se
  // dibujan aparte con el color de selección. Elegir otra pieza no rearma el modelo.
  useEffect(() => {
    const pipeGroup = pipeGroupRef.current;
    if (!pipeGroup) return;
    const batches = batchesRef.current;
    const visibleIds = isolatedIds(graph, isolation);

    const selectedMaterial = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x0284c7,
      emissiveIntensity: 0.45,
      roughness: 0.2,
      metalness: 0.8,
      side: THREE.DoubleSide
    });
    // Piezas de la selección múltiple (violeta)
    const multiMaterial = new THREE.MeshStandardMaterial({
      color: 0xa78bfa,
      emissive: 0x5b21b6,
      emissiveIntensity: 0.5,
      roughness: 0.3,
      metalness: 0.6,
      side: THREE.DoubleSide
    });

    // El soporte elegido también se dibuja aparte, resaltado
    const supportMark = selectedSupportId ? graph.supports.get(selectedSupportId) : undefined;
    const supportHost = supportMark ? graph.supportHost(supportMark) : null;

    const highlighted = new Map<string, THREE.Material>();
    if (!multiMode && selectedComponentId) highlighted.set(selectedComponentId, selectedMaterial);
    for (const id of multiSelect) highlighted.set(id, multiMaterial);

    const overlay = new THREE.Group();
    const hidden: Array<[THREE.Mesh[], string]> = [];
    for (const [id, material] of highlighted) {
      const comp = graph.components.get(id);
      if (!comp || (visibleIds && !visibleIds.has(id))) continue;
      const obj = buildComponentObject(comp, {
        materials: { pipe: material, fitting: material, tee: material, flange: material, valve: material, trim: material },
        pick: () => material,
        hostOuterDiameter: comp.type === 'OLET' ? graph.oletHost(comp)?.parameters.outerDiameter : undefined
      });
      if (!obj) continue;
      obj.traverse((child) => (child.userData = { ...child.userData, componentId: id }));
      overlay.add(obj);
      hidden.push([setPieceHidden(batches, id, true), id]);
    }
    if (supportMark && supportHost && (!visibleIds || visibleIds.has(supportHost.id))) {
      overlay.add(buildSupportObject(supportMark, supportHost, selectedMaterial));
      hidden.push([setPieceHidden(batches, `${SUPPORT_KEY}${supportMark.id}`, true), `${SUPPORT_KEY}${supportMark.id}`]);
      // Cotas a cada lado, corridas del caño hacia arriba (o de costado si el caño es vertical)
      const dims = supportDimensions(graph, supportMark);
      if (dims) {
        const side = Math.abs(dims.axis.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
        side.addScaledVector(dims.axis, -side.dot(dims.axis)).normalize();
        const off = side.multiplyScalar((supportHost.parameters.outerDiameter || 60) / 2 + 160);
        const pts: THREE.Vector3[] = [];
        const tick = (p: THREE.Vector3) => {
          pts.push(p.clone().addScaledVector(off, 0.35), p.clone().addScaledVector(off, 1.12));
          // Marca oblicua en la línea de cota, como en los planos
          const a = p.clone().add(off);
          const t = dims.axis.clone().multiplyScalar(30).add(off.clone().setLength(30));
          pts.push(a.clone().sub(t), a.clone().add(t));
        };
        const ends = [dims.back, dims.ahead];
        tick(supportMark.position);
        ends.forEach((d, i) => {
          tick(d.to);
          pts.push(supportMark.position.clone().add(off), d.to.clone().add(off));
          supDimPosRef.current[i] = d.distanceMm > 1 ? supportMark.position.clone().lerp(d.to, 0.5).add(off) : null;
        });
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x67e8f9, depthTest: false, transparent: true }));
        lines.renderOrder = 10;
        overlay.add(lines);
      }
    } else {
      supDimPosRef.current = [null, null];
    }
    pipeGroup.add(overlay);

    return () => {
      pipeGroup.remove(overlay);
      disposeObject(overlay);
      // Solo se vuelve a prender lo que apagó este efecto (no lo apagado por una edición)
      for (const [changed, id] of hidden) setPieceHidden(changed, id, false);
    };
  }, [graph, version, collidingComponentIds, spoolView, fieldView, fieldBaseline, isolation, selectedComponentId, selectedSupportId, multiSelect, multiMode]);

  // Bocas libres: anillo, esfera para tocar y flecha. Dependen de la boca activa, no de la pieza elegida
  useEffect(() => {
    const portsGroup = portsGroupRef.current;
    if (!portsGroup) return;
    disposeObject(portsGroup);
    while (portsGroup.children.length > 0) portsGroup.remove(portsGroup.children[0]);
    const visibleIds = isolatedIds(graph, isolation);

    // 2. Construir Grips "+" estilo AutoCAD Plant 3D para TODOS los puertos abiertos (fáciles de tocar en móvil/PC)
    const openPorts = graph.getOpenPorts();
    for (const port of openPorts) {
      if (visibleIds && !visibleIds.has(port.componentId)) continue;
      const isSelected = port.id === selectedPortId;
      const parentComp = graph.components.get(port.componentId);
      const isTeeBranch = parentComp?.type === 'TEE' && parentComp.ports[2]?.id === port.id;

      // Color: Verde brillante si es la boca activa, Ámbar si es el ramal libre de una Te, Cyan para otras bocas
      const gripColor = isSelected ? 0x22c55e : isTeeBranch ? 0xf59e0b : 0x00e5ff;

      // Anillo visible en la cara de la boca
      const portGeom = new THREE.RingGeometry(
        port.outerDiameter * 0.35,
        port.outerDiameter * 0.55 + (isSelected ? 14 : 9),
        24
      );
      const portMat = new THREE.MeshBasicMaterial({
        color: gripColor,
        side: THREE.DoubleSide
      });
      const portMesh = new THREE.Mesh(portGeom, portMat);
      portMesh.position.copy(port.position);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), port.direction);
      portMesh.quaternion.copy(quat);
      portMesh.userData = { portId: port.id, componentId: port.componentId };
      portsGroup.add(portMesh);

      // Esfera interactiva de impacto (Hit Target grande para tocar fácilmente con el dedo o mouse)
      const hitRadius = Math.max(26, port.outerDiameter * 0.48);
      const hitSphereGeom = new THREE.SphereGeometry(hitRadius, 16, 16);
      const hitSphereMat = new THREE.MeshBasicMaterial({
        color: gripColor,
        transparent: true,
        opacity: isSelected ? 0.42 : 0.28,
        depthWrite: false
      });
      const hitSphere = new THREE.Mesh(hitSphereGeom, hitSphereMat);
      hitSphere.position.copy(port.position);
      hitSphere.userData = { portId: port.id, componentId: port.componentId };
      portsGroup.add(hitSphere);

      // Flecha corta saliendo de cada boca libre (permite ver hacia dónde sale cada ramal de una Te)
      const stubLen = isSelected ? 120 : 85;
      const stubArrow = new THREE.ArrowHelper(
        port.direction.clone().normalize(),
        port.position,
        stubLen,
        gripColor,
        28,
        18
      );
      portsGroup.add(stubArrow);
    }
  }, [graph, version, selectedPortId, isolation]);

  // Medida: dos marcas, la línea entre ellas y el cartel con la distancia
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !measurePoints.length) {
      measureMidRef.current = null;
      measureDotsRef.current = [];
      return;
    }
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xf0abfc, depthTest: false, depthWrite: false, transparent: true });
    const dots = measurePoints.map((p) => {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(6, 14, 14), mat);
      dot.position.copy(p);
      dot.renderOrder = 20;
      group.add(dot);
      return dot;
    });
    if (measurePoints.length === 2) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(measurePoints),
        new THREE.LineBasicMaterial({ color: 0xf0abfc, depthTest: false, transparent: true })
      );
      line.renderOrder = 19;
      group.add(line);
      measureMidRef.current = measurePoints[0].clone().lerp(measurePoints[1], 0.5);
    } else {
      measureMidRef.current = null;
    }
    measureDotsRef.current = dots;
    scene.add(group);
    return () => {
      scene.remove(group);
      disposeObject(group);
      measureDotsRef.current = [];
    };
  }, [measurePoints]);

  // Caja de corte: seis planos de recorte y el contorno de la caja
  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!scene || !renderer) return;
    if (!sectionBox) {
      renderer.clippingPlanes = [];
      return;
    }
    const [x0, y0, z0] = sectionBox.min;
    const [x1, y1, z1] = sectionBox.max;
    const pad = 2;
    renderer.clippingPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -x0 + pad),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), x1 + pad),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -y0 + pad),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), y1 + pad),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -z0 + pad),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), z1 + pad)
    ];
    const helper = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)), 0xf59e0b);
    scene.add(helper);
    return () => {
      scene.remove(helper);
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
      renderer.clippingPlanes = [];
    };
  }, [sectionBox]);

  // Cursor de trazado sobre el modelo: compás de Plant en la boca activa, caño fantasma, manija para
  // dar el largo arrastrando y vista previa del recorrido al conectar dos bocas. Va aparte de las
  // mallas para que arrastrar el largo no reconstruya todo el modelo.
  useEffect(() => {
    const cursorGroup = cursorGroupRef.current;
    if (!cursorGroup) return;
    disposeObject(cursorGroup);
    while (cursorGroup.children.length > 0) cursorGroup.remove(cursorGroup.children[0]);
    gizmoRef.current = null;
    handleRef.current = null;
    gripsRef.current = [];
    dimPosRef.current = null;

    // Caño elegido: grips cuadrados en los extremos para estirarlo y cota en el medio
    const picked = !multiMode && selectedComponentId ? graph.components.get(selectedComponentId) : undefined;
    if (picked && picked.type === 'PIPE' && picked.ports.length >= 2 && !connectRoutes.length) {
      const live = stretch && stretch.compId === picked.id ? stretch : null;
      for (const anchor of ['start', 'end'] as const) {
        const fixed = anchor === 'start' ? picked.ports[0] : picked.ports[1];
        const moving = anchor === 'start' ? picked.ports[1] : picked.ports[0];
        const pos =
          live && live.anchor === anchor ? fixed.position.clone().addScaledVector(moving.direction, live.length) : moving.position.clone();
        const grip = new THREE.Group();
        grip.position.copy(pos);
        const edge = new THREE.Mesh(new THREE.BoxGeometry(15, 15, 15), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
        const core = new THREE.Mesh(new THREE.BoxGeometry(11, 11, 11), new THREE.MeshBasicMaterial({ color: 0x2563eb, depthTest: false, transparent: true }));
        edge.renderOrder = 1002;
        core.renderOrder = 1003;
        const grab = new THREE.Mesh(new THREE.SphereGeometry(22, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
        grab.userData = { stretchAnchor: anchor, compId: picked.id };
        grip.add(edge, core, grab);
        cursorGroup.add(grip);
        gripsRef.current.push(grip);
      }
      if (live) {
        const fixed = live.anchor === 'start' ? picked.ports[0] : picked.ports[1];
        const moving = live.anchor === 'start' ? picked.ports[1] : picked.ports[0];
        const end = fixed.position.clone().addScaledVector(moving.direction, live.length);
        const r = (picked.parameters.outerDiameter || 60.3) / 2 + 2;
        const ghost = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, live.length, 20, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
        );
        ghost.position.copy(fixed.position.clone().lerp(end, 0.5));
        ghost.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), moving.direction.clone().normalize());
        cursorGroup.add(ghost);
        dimPosRef.current = fixed.position.clone().lerp(end, 0.5);
      } else {
        dimPosRef.current = picked.ports[0].position.clone().lerp(picked.ports[1].position, 0.5);
      }
    }

    // Solo la boca elegida enciende el cursor: sin boca activa no hay compás ni caño fantasma
    const activePort = selectedPortId ? graph.ports.get(selectedPortId) ?? null : null;
    // Sin modelo todavía, el primer tramo sale del origen
    const origin = activePort ? activePort.position.clone() : graph.components.size === 0 ? new THREE.Vector3(0, 0, 0) : null;
    if (!origin || (activePort && activePort.connectedJointId)) return;

    const overlay = (color: number, opacity = 1) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
    const Y_UP = new THREE.Vector3(0, 1, 0);
    const od = activePort?.outerDiameter || 60.3;

    // Recorrido propuesto para conectar con otra boca
    const route = connectRoutes[connectIndex];
    if (route) {
      const routeMat = new THREE.MeshBasicMaterial({ color: 0xe879f9, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
      for (let k = 0; k + 1 < route.points.length; k++) {
        const a = route.points[k];
        const b = route.points[k + 1];
        const len = a.distanceTo(b);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(od / 2, od / 2, len, 20), routeMat);
        leg.position.copy(a.clone().lerp(b, 0.5));
        leg.quaternion.setFromUnitVectors(Y_UP, b.clone().sub(a).normalize());
        cursorGroup.add(leg);
        if (k > 0) {
          const knee = new THREE.Mesh(new THREE.SphereGeometry(od * 0.62, 16, 12), routeMat);
          knee.position.copy(a);
          cursorGroup.add(knee);
        }
      }
      const axisLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(route.points),
        new THREE.LineBasicMaterial({ color: 0xf5d0fe, depthTest: false, transparent: true })
      );
      axisLine.renderOrder = 998;
      cursorGroup.add(axisLine);
      const target = connectTargetId ? graph.ports.get(connectTargetId) : null;
      if (target) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(od * 0.9, od * 0.12, 10, 28), overlay(0xe879f9));
        ring.position.copy(target.position);
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), target.direction);
        ring.renderOrder = 998;
        cursorGroup.add(ring);
      }
      return;
    }

    const lenMm = Math.max(1, parseFloat(numpadValue) || 500);
    const arrowDir = activeDirection.clone().normalize();
    const previewEnd = origin.clone().addScaledVector(arrowDir, lenMm);

    // Caño fantasma con el diámetro real y el largo que se va a trazar
    const ghostGeom = new THREE.CylinderGeometry(od / 2, od / 2, lenMm, 20, 1, true);
    const ghost = new THREE.Mesh(
      ghostGeom,
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false })
    );
    ghost.position.copy(origin.clone().lerp(previewEnd, 0.5));
    ghost.quaternion.setFromUnitVectors(Y_UP, arrowDir);
    cursorGroup.add(ghost);

    const previewLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([origin, previewEnd]),
      new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 40, gapSize: 20 })
    );
    previewLine.computeLineDistances();
    cursorGroup.add(previewLine);

    // Compás: una flecha por eje (X rojo, Y verde, Z azul); se toca la flecha para elegir la dirección.
    // No se ofrece volver sobre la propia boca (180°).
    const gizmo = new THREE.Group();
    gizmo.position.copy(origin);
    const AXIS_COLOR = [0xef4444, 0x22c55e, 0x3b82f6];
    for (let axis = 0; axis < 3; axis++) {
      for (const sign of [1, -1]) {
        const dir = new THREE.Vector3().setComponent(axis, sign);
        if (activePort && activePort.direction.dot(dir) < -0.99) continue;
        const isActive = arrowDir.dot(dir) > 0.99;
        const quat = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir);
        const mat = overlay(isActive ? 0xfacc15 : AXIS_COLOR[axis], isActive ? 1 : 0.8);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(isActive ? 3 : 2, isActive ? 3 : 2, 40, 8), mat);
        shaft.position.copy(dir.clone().multiplyScalar(38));
        shaft.quaternion.copy(quat);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(isActive ? 10 : 7.5, 18, 14), mat);
        tip.position.copy(dir.clone().multiplyScalar(67));
        tip.quaternion.copy(quat);
        // Zona de toque de 44 px alrededor de la punta
        const hit = new THREE.Mesh(new THREE.SphereGeometry(22, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.copy(dir.clone().multiplyScalar(64));
        hit.userData = { axisDir: [dir.x, dir.y, dir.z] };
        for (const m of [shaft, tip]) m.renderOrder = 999;
        gizmo.add(shaft, tip, hit);
      }
    }
    cursorGroup.add(gizmo);
    gizmoRef.current = gizmo;

    // Manija en la punta del caño fantasma: se arrastra para dar el largo
    const handle = new THREE.Group();
    handle.position.copy(previewEnd);
    const knobRing = new THREE.Mesh(new THREE.SphereGeometry(11, 20, 14), overlay(0xffffff));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(8, 20, 14), overlay(0x22c55e));
    knobRing.renderOrder = 1000;
    knob.renderOrder = 1001;
    const grab = new THREE.Mesh(new THREE.SphereGeometry(26, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    grab.userData = { lengthHandle: true };
    handle.add(knobRing, knob, grab);
    handle.userData = { origin, dir: arrowDir };
    cursorGroup.add(handle);
    handleRef.current = handle;
  }, [graph, version, selectedPortId, selectedComponentId, activeDirection, numpadValue, connectRoutes, connectIndex, connectTargetId, multiMode, stretch]);

  // Otra pieza elegida: se cierra la edición de la cota (salvo que se haya tocado la cota de una etiqueta)
  useEffect(() => {
    const comp = selectedComponentId ? graph.components.get(selectedComponentId) : undefined;
    if (pendingLengthEditRef.current && comp?.type === 'PIPE' && comp.ports.length >= 2) {
      setLengthEdit(String(Math.round(comp.parameters.cutLength || comp.ports[0].position.distanceTo(comp.ports[1].position))));
    } else setLengthEdit(null);
    pendingLengthEditRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedComponentId, version]);

  // La referencia de obra se guarda con el proyecto: al cambiar de modelo se trae la suya
  useEffect(() => {
    void useReferenceStore.getState().loadForActiveProject();
  }, [graph]);

  // Referencia de obra: las líneas del DXF, en gris, debajo del modelo
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !reference || !reference.segments.length) return;
    const positions = new Float32Array(reference.segments.length);
    for (let i = 0; i < positions.length; i++) positions[i] = reference.segments[i] * reference.scale;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x7c8aa0, transparent: true, opacity: 0.75 }));
    lines.visible = reference.visible;
    lines.userData.reference = true;
    scene.add(lines);
    refGroupRef.current = lines;
    return () => {
      scene.remove(lines);
      geometry.dispose();
      (lines.material as THREE.Material).dispose();
      if (refGroupRef.current === lines) refGroupRef.current = null;
    };
  }, [reference]);

  // Gestos multitáctiles y selección 3D CAD:
  // - Tap corto (< 8px): Selecciona puerto abierto (boca/ramal) o selecciona cañería/accesorio en 3D
  // - Arrastrar con 1 dedo: Órbita 3D libre alrededor de la escena (en cualquier modo)
  // - 2 dedos: Paneo y Pellizco (Pinch-to-zoom) simultáneos
  const rayFromPointer = (e: React.PointerEvent): THREE.Raycaster | null => {
    if (!cameraRef.current || !containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, cameraRef.current);
    return raycaster;
  };

  /** Lo que quedó fuera de la caja de corte no se ve, así que tampoco se puede tocar */
  const inSection = (p: THREE.Vector3) => {
    const box = usePipingStore.getState().sectionBox;
    if (!box) return true;
    return [p.x, p.y, p.z].every((v, i) => v >= box.min[i] - 2 && v <= box.max[i] + 2);
  };

  /** Punto de medida para un toque sobre una pieza: sus bocas o, en un caño, el punto del eje */
  const measurePointFor = (compId: string, hitPoint: THREE.Vector3): THREE.Vector3 => {
    const comp = usePipingStore.getState().graph.components.get(compId);
    if (!comp || !comp.ports.length) return hitPoint.clone();
    if (comp.type === 'PIPE' && comp.ports.length >= 2) {
      const a = comp.ports[0].position;
      const axis = comp.ports[1].position.clone().sub(a);
      const len = axis.length();
      axis.normalize();
      const t = THREE.MathUtils.clamp(hitPoint.clone().sub(a).dot(axis), 0, len);
      // Cerca de una punta se toma la punta
      const snap = Math.min(len / 3, Math.max(comp.parameters.outerDiameter, len * 0.12));
      if (t < snap) return a.clone();
      if (t > len - snap) return comp.ports[1].position.clone();
      return a.clone().addScaledVector(axis, t);
    }
    let best = comp.ports[0].position;
    for (const p of comp.ports) if (p.position.distanceTo(hitPoint) < best.distanceTo(hitPoint)) best = p.position;
    return best.clone();
  };

  /** Encuadra una pieza (doble toque sobre ella) */
  const frameComponent = (compId: string) => {
    const comp = usePipingStore.getState().graph.components.get(compId);
    const cam = cameraRef.current;
    if (!comp || !cam) return;
    const box = new THREE.Box3();
    for (const p of comp.ports) box.expandByPoint(p.position);
    for (const pt of comp.centerline) box.expandByPoint(pt);
    if (box.isEmpty()) return;
    box.getCenter(cameraTargetRef.current);
    const span = Math.max(box.getSize(new THREE.Vector3()).length(), 300);
    cameraDistanceRef.current = THREE.MathUtils.clamp((span * 1.9) / Math.min(1, cam.aspect * 1.05), 150, 35000);
    updateCameraPosition();
  };

  // La lista de avisos pide mostrar una pieza
  useEffect(() => {
    if (focusRequest) frameComponent(focusRequest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const handlePointerDown = (e: React.PointerEvent) => {
    viewAnimRef.current = null;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // El puntero ya no está activo: se sigue sin captura
    }
    touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPointersRef.current.size === 1) {
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
      // Sobre la manija verde: el dedo da el largo en vez de orbitar
      const handle = handleRef.current;
      const raycaster = rayFromPointer(e);
      const gripHit = raycaster
        ? raycaster.intersectObjects(gripsRef.current, true).find((h) => h.object.userData?.stretchAnchor)
        : undefined;
      if (handle && raycaster && raycaster.intersectObject(handle, true).some((h) => h.object.userData?.lengthHandle)) {
        dragLengthRef.current = { origin: handle.userData.origin.clone(), dir: handle.userData.dir.clone() };
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(12);
      } else if (gripHit) {
        // Sobre un grip azul: el dedo estira el caño
        const { stretchAnchor, compId } = gripHit.object.userData as { stretchAnchor: 'start' | 'end'; compId: string };
        const comp = usePipingStore.getState().graph.components.get(compId);
        if (comp) {
          const fixed = stretchAnchor === 'start' ? comp.ports[0] : comp.ports[1];
          const moving = stretchAnchor === 'start' ? comp.ports[1] : comp.ports[0];
          const length = fixed.position.distanceTo(moving.position);
          dragStretchRef.current = {
            compId,
            anchor: stretchAnchor,
            fixed: fixed.position.clone(),
            dir: moving.direction.clone().normalize(),
            length,
            start: length
          };
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(12);
        }
      } else {
        // Mantener apretado sobre una pieza abre su menú
        const x = e.clientX;
        const y = e.clientY;
        const timer = window.setTimeout(() => openMenuAt(x, y), 520);
        longPressRef.current = { timer, fired: false };
      }
    } else {
      pointerDownPosRef.current = null;
      dragLengthRef.current = null;
      dragStretchRef.current = null;
      setStretch(null);
      cancelLongPress();
    }
  };

  const cancelLongPress = () => {
    if (longPressRef.current && !longPressRef.current.fired) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  };

  const openMenuAt = (clientX: number, clientY: number) => {
    const press = longPressRef.current;
    if (!press || !cameraRef.current || !containerRef.current || !pipeGroupRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(
      new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1),
      cameraRef.current
    );
    const hit = raycaster.intersectObjects(pipeGroupRef.current.children, true).find((h) => h.object.userData?.componentId);
    if (!hit) {
      longPressRef.current = null;
      return;
    }
    press.fired = true;
    const store = usePipingStore.getState();
    const compId = hit.object.userData.componentId as string;
    const comp = store.graph.components.get(compId);
    if (!comp) return;
    if (!store.multiMode) store.setSelectedComponentId(compId);
    let offsetMm: number | undefined;
    if (comp.type === 'PIPE' && comp.ports.length >= 2) {
      const a = comp.ports[0].position;
      const axis = comp.ports[1].position.clone().sub(a);
      const len = axis.length();
      offsetMm = THREE.MathUtils.clamp(hit.point.clone().sub(a).dot(axis.normalize()), 0, len);
    }
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
    store.openPieceMenu({ x: clientX, y: clientY, componentId: compId, offsetMm });
  };

  /** Posición del dedo sobre un eje: distancia desde `origin` a lo largo de `dir`, y mm por píxel ahí */
  const pointOnAxis = (e: React.PointerEvent, origin: THREE.Vector3, dir: THREE.Vector3): { t: number; step: number } | null => {
    const raycaster = rayFromPointer(e);
    if (!raycaster || !cameraRef.current || !containerRef.current) return null;
    const r = raycaster.ray.direction;
    const w = origin.clone().sub(raycaster.ray.origin);
    const b = dir.dot(r);
    const denom = 1 - b * b;
    if (denom < 1e-3) return null;
    const mmPerPx =
      (2 * cameraRef.current.position.distanceTo(origin) * Math.tan(THREE.MathUtils.degToRad(cameraRef.current.fov / 2))) /
      containerRef.current.clientHeight;
    return { t: (b * r.dot(w) - dir.dot(w)) / denom, step: mmPerPx < 1.2 ? 5 : mmPerPx < 8 ? 10 : 50 };
  };

  /** Largo que marca el dedo: el punto del eje de trazado más cercano al rayo del toque */
  const dragLength = (e: React.PointerEvent) => {
    const drag = dragLengthRef.current;
    const raycaster = rayFromPointer(e);
    if (!drag || !raycaster || !cameraRef.current || !containerRef.current) return;
    const r = raycaster.ray.direction;
    const w = drag.origin.clone().sub(raycaster.ray.origin);
    const b = drag.dir.dot(r);
    const denom = 1 - b * b;
    if (denom < 1e-3) return; // el eje apunta a la cámara: no se puede medir
    const t = (b * r.dot(w) - drag.dir.dot(w)) / denom;
    // El paso depende del zoom: de cerca 5 mm, de lejos 50 mm
    const mmPerPx =
      (2 * cameraRef.current.position.distanceTo(drag.origin) * Math.tan(THREE.MathUtils.degToRad(cameraRef.current.fov / 2))) /
      containerRef.current.clientHeight;
    const step = mmPerPx < 1.2 ? 5 : mmPerPx < 8 ? 10 : 50;
    const length = Math.min(60000, Math.max(step, Math.round(t / step) * step));
    const state = usePipingStore.getState();
    if (String(length) !== state.numpadValue) state.setNumpadValue(String(length));
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!touchPointersRef.current.has(e.pointerId)) return;
    touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pointers = Array.from(touchPointersRef.current.values());

    if (pointerDownPosRef.current && Math.hypot(e.clientX - pointerDownPosRef.current.x, e.clientY - pointerDownPosRef.current.y) > 9) {
      cancelLongPress();
    }

    if (pointers.length === 1 && longPressRef.current?.fired) {
      // Con el menú abierto el dedo ya no orbita
    } else if (pointers.length === 1 && dragStretchRef.current) {
      const drag = dragStretchRef.current;
      const at = pointOnAxis(e, drag.fixed, drag.dir);
      if (at) {
        const length = Math.min(60000, Math.max(at.step, Math.round(at.t / at.step) * at.step));
        if (length !== drag.length) {
          drag.length = length;
          setStretch({ compId: drag.compId, anchor: drag.anchor, length });
        }
      }
    } else if (pointers.length === 1 && dragLengthRef.current) {
      dragLength(e);
    } else if (pointers.length === 1) {
      // 1 dedo / clic izquierdo arrastrado: Órbita alrededor del objetivo (Z-Up) siempre activa
      const dx = e.movementX;
      const dy = e.movementY;

      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        cameraAzimuthRef.current -= dx * 0.0055;
        cameraPolarRef.current = THREE.MathUtils.clamp(
          cameraPolarRef.current - dy * 0.0055,
          0.05,
          Math.PI - 0.05
        );
        updateCameraPosition();
      }
    } else if (pointers.length === 2) {
      // 2 dedos: Paneo y Pellizco (Pinch-to-zoom) simultáneos
      const p1 = pointers[0];
      const p2 = pointers[1];
      const currentDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const currentCenter = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      if (previousTouchDistRef.current !== null && previousTouchCenterRef.current !== null) {
        const distDiff = currentDist - previousTouchDistRef.current;
        cameraDistanceRef.current = THREE.MathUtils.clamp(
          cameraDistanceRef.current - distDiff * 3,
          150,
          35000
        );

        const panX = currentCenter.x - previousTouchCenterRef.current.x;
        const panY = currentCenter.y - previousTouchCenterRef.current.y;

        if (cameraRef.current) {
          const panSpeed = cameraDistanceRef.current * 0.0012;
          const forward = new THREE.Vector3();
          cameraRef.current.getWorldDirection(forward);
          const right = new THREE.Vector3().crossVectors(forward, cameraRef.current.up).normalize();
          const up = cameraRef.current.up.clone().normalize();

          cameraTargetRef.current.addScaledVector(right, -panX * panSpeed);
          cameraTargetRef.current.addScaledVector(up, panY * panSpeed);
        }

        updateCameraPosition();
      }

      previousTouchDistRef.current = currentDist;
      previousTouchCenterRef.current = currentCenter;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const stretched = dragStretchRef.current;
    const menuOpened = Boolean(longPressRef.current?.fired);
    cancelLongPress();
    longPressRef.current = null;
    const wasDraggingLength = Boolean(dragLengthRef.current) || Boolean(stretched) || menuOpened;
    dragLengthRef.current = null;
    dragStretchRef.current = null;
    if (stretched) {
      setStretch(null);
      if (Math.abs(stretched.length - stretched.start) > 0.5) {
        usePipingStore.getState().stretchPipe(stretched.compId, stretched.length, stretched.anchor);
      }
    }

    // Verificar si fue un Tap/Clic limpio (sin arrastrar la cámara) para seleccionar bocas o piezas 3D
    if (!wasDraggingLength && pointerDownPosRef.current && touchPointersRef.current.size === 1) {
      const moveDist = Math.hypot(
        e.clientX - pointerDownPosRef.current.x,
        e.clientY - pointerDownPosRef.current.y
      );

      if (moveDist < 9 && cameraRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, cameraRef.current);

        let handled = false;
        const store = usePipingStore.getState();
        const firstComponentHit = () => {
          for (const hit of raycaster.intersectObjects(pipeGroupRef.current?.children ?? [], true)) {
            const compId = hit.object.userData?.componentId || hit.object.parent?.userData?.componentId;
            if (compId && inSection(hit.point)) return { compId: compId as string, point: hit.point };
          }
          return null;
        };

        // Doble toque: encuadra la pieza tocada, o todo el modelo si fue en el vacío
        const now = performance.now();
        const last = lastTapRef.current;
        if (last && now - last.t < 330 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
          lastTapRef.current = null;
          const hit = firstComponentHit();
          if (hit) frameComponent(hit.compId);
          else store.frameAll();
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);
          handled = true;
        } else {
          lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
        }

        // Medir: el toque marca un punto en vez de seleccionar
        if (!handled && store.measureActive) {
          const hit = firstComponentHit();
          if (hit) {
            store.addMeasurePoint(measurePointFor(hit.compId, hit.point));
            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);
          }
          handled = true;
        }

        // Prioridad 0: flechas del compás sobre la boca activa (eligen la dirección de trazado)
        if (gizmoRef.current && !store.connectPicking) {
          const axisHit = raycaster.intersectObject(gizmoRef.current, true).find((h) => h.object.userData?.axisDir);
          if (axisHit) {
            const [x, y, z] = axisHit.object.userData.axisDir as [number, number, number];
            store.setActiveDirection(new THREE.Vector3(x, y, z));
            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(12);
            handled = true;
          }
        }

        // Prioridad 1: grips de bocas libres. Si el dedo no acierta justo, vale la boca a menos de 28 px.
        if (!handled) {
          let portId: string | null = null;
          if (portsGroupRef.current) {
            const hit = raycaster.intersectObjects(portsGroupRef.current.children, true).find((h) => h.object.userData?.portId);
            if (hit) portId = hit.object.userData.portId;
          }
          if (!portId) {
            let best = 28;
            for (const port of store.graph.getOpenPorts()) {
              const ndc = port.position.clone().project(cameraRef.current);
              if (ndc.z > 1) continue;
              const d = Math.hypot(((ndc.x + 1) / 2) * rect.width + rect.left - e.clientX, ((1 - ndc.y) / 2) * rect.height + rect.top - e.clientY);
              if (d < best) {
                best = d;
                portId = port.id;
              }
            }
          }
          if (portId) {
            // Conectando: el toque elige la boca de destino en vez de cambiar la boca activa
            if (store.connectPicking) store.pickConnectTarget(portId);
            else if (store.alignPicking && portId !== store.selectedPortId) {
              const target = store.graph.ports.get(portId);
              if (target) store.pickAlignTarget(target.position.clone());
            } else selectPortAndAlign(portId);
            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
            handled = true;
          }
        }

        // Prioridad 2: Selección de cualquier cañería o accesorio en 3D (Pipe, Tee, Codo, Brida, Válvula)
        if (!handled && pipeGroupRef.current) {
          const compHits = raycaster.intersectObjects(pipeGroupRef.current.children, true);
          for (const hit of compHits) {
            // Un soporte tocado se elige para editarlo (tipo y tag de Plant, altura, giro)
            const supportId = hit.object.userData?.supportId as string | undefined;
            if (supportId && inSection(hit.point) && !store.alignPicking && !store.multiMode) {
              store.setSelectedSupportId(supportId);
              if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);
              handled = true;
              break;
            }
            const compId = hit.object.userData?.componentId || hit.object.parent?.userData?.componentId;
            if (compId && inSection(hit.point)) {
              // Alinear: la pieza tocada da la referencia en vez de quedar elegida
              if (store.alignPicking) store.pickAlignTarget(measurePointFor(compId, hit.point));
              // Selección múltiple: el toque suma o quita la pieza
              else if (store.multiMode) store.toggleMultiComponent(compId);
              else setSelectedComponentId(compId);
              if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);
              handled = true;
              break;
            }
          }
        }

        // Si se tocó el espacio vacío del visor 3D, deseleccionar la pieza activa
        // También se suelta la boca activa: el compás y el caño fantasma se apagan hasta elegir otra
        if (!handled && !store.multiMode && !store.measureActive) {
          if (store.alignPicking) store.startAlignPicking();
          else {
            setSelectedComponentId(null);
            if (!store.connectPicking && !store.connectRoutes.length) store.setSelectedPortId(null);
          }
        }
      }
    }

    pointerDownPosRef.current = null;
    touchPointersRef.current.delete(e.pointerId);
    if (touchPointersRef.current.size < 2) {
      previousTouchDistRef.current = null;
      previousTouchCenterRef.current = null;
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    cameraDistanceRef.current = THREE.MathUtils.clamp(
      cameraDistanceRef.current + e.deltaY * 1.5,
      150,
      35000
    );
    updateCameraPosition();
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none"
      style={{ touchAction: 'none' }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={(e) => {
          // Clic derecho en la computadora: el mismo menú que mantener apretado
          e.preventDefault();
          longPressRef.current = { timer: 0, fired: false };
          openMenuAt(e.clientX, e.clientY);
          longPressRef.current = null;
        }}
        className="w-full h-full block cursor-grab active:cursor-grabbing outline-none"
      />
      {!(phone && multiMode) && (
        <ViewCube
          ref={cubeRef}
          style={phone ? { top: 'calc(var(--mobile-top) + 2px)', right: 0 } : { top: 104, right: 8 }}
          onView={(azimuth, polar) => {
            viewAnimRef.current = { azimuth, polar };
          }}
          onHome={() => {
            viewAnimRef.current = { azimuth: -Math.PI / 4, polar: Math.PI / 3 };
            usePipingStore.getState().frameAll();
          }}
        />
      )}
      {/* Medida entre los dos puntos tocados */}
      <div ref={measureLabelRef} style={{ visibility: 'hidden' }} className="absolute left-0 top-0 pointer-events-none">
        {measureActive && measurePoints.length === 2 && (
          <div className="px-2.5 py-1 rounded-lg bg-[#2a0f33]/95 border border-fuchsia-300 text-fuchsia-100 font-mono shadow-lg text-center leading-tight">
            <div className="text-sm font-black">{Math.round(measurePoints[0].distanceTo(measurePoints[1]))} mm</div>
            <div className="text-[10px] text-fuchsia-200/90 whitespace-nowrap">
              ΔX {Math.round(Math.abs(measurePoints[1].x - measurePoints[0].x))} · ΔY {Math.round(Math.abs(measurePoints[1].y - measurePoints[0].y))} · ΔZ{' '}
              {Math.round(Math.abs(measurePoints[1].z - measurePoints[0].z))}
            </div>
          </div>
        )}
      </div>
      {/* Etiquetas permanentes: cotas (se tocan para cambiar el largo), elevaciones y número de línea */}
      {labels.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" data-model-labels>
          {labels.map((l, i) =>
            l.kind === 'cota' ? (
              <button
                key={l.id}
                ref={(el) => {
                  labelElsRef.current[i] = el;
                }}
                type="button"
                data-label="cota"
                style={{ visibility: 'hidden' }}
                onClick={() => {
                  pendingLengthEditRef.current = true;
                  usePipingStore.getState().setSelectedComponentId(l.componentId);
                }}
                className="absolute left-0 top-0 pointer-events-auto h-6 min-w-[2.25rem] px-1.5 rounded-md bg-[#0f172a]/85 border border-slate-500/70 text-[11px] font-mono font-bold text-slate-100 active:scale-95"
                title="Cambiar el largo de este caño"
              >
                {l.text}
              </button>
            ) : (
              <div
                key={l.id}
                ref={(el) => {
                  labelElsRef.current[i] = el;
                }}
                data-label={l.kind}
                style={{ visibility: 'hidden' }}
                className={`absolute left-0 top-0 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold whitespace-nowrap border ${
                  l.kind === 'elev' ? 'bg-[#082f49]/85 border-sky-500/60 text-sky-200' : 'bg-[#422006]/85 border-amber-500/60 text-amber-200'
                }`}
              >
                {l.text}
              </div>
            )
          )}
        </div>
      )}
      {/* Cotas del soporte elegido: se tocan para escribir la distancia y el soporte se corre */}
      {(() => {
        const mark = selectedSupportId ? graph.supports.get(selectedSupportId) : undefined;
        const dims = mark ? supportDimensions(graph, mark) : null;
        return (['back', 'ahead'] as const).map((side, i) => {
          const d = dims?.[side];
          const editing = supDimEdit?.side === side;
          return (
            <div
              key={side}
              ref={(el) => {
                supDimElsRef.current[i] = el;
              }}
              style={{ visibility: 'hidden' }}
              className="absolute left-0 top-0"
              data-support-dim={side}
            >
              {mark && d && d.distanceMm > 1 &&
                (editing ? (
                  <form
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      const value = parseFloat(supDimEdit.text);
                      setSupDimEdit(null);
                      if (Number.isFinite(value) && Math.abs(value - d.distanceMm) > 0.5) usePipingStore.getState().moveSupport(mark.id, side, value);
                    }}
                    className="flex items-center gap-1 p-1 rounded-xl bg-[#0f172a] border border-cyan-400 shadow-lg"
                  >
                    <input
                      autoFocus
                      type="number"
                      inputMode="decimal"
                      value={supDimEdit.text}
                      onChange={(ev) => setSupDimEdit({ side, text: ev.target.value })}
                      onFocus={(ev) => ev.target.select()}
                      className="h-10 w-24 px-2 rounded-lg bg-[#1b1f26] text-base font-mono font-black text-cyan-200 outline-none"
                      aria-label={`Distancia del soporte hasta ${d.label} en milímetros`}
                    />
                    <button type="submit" className="h-10 px-3 rounded-lg bg-cyan-600 text-white text-sm font-black">
                      OK
                    </button>
                    <button type="button" onClick={() => setSupDimEdit(null)} className="h-10 w-9 rounded-lg text-slate-300" aria-label="Cancelar">
                      ✕
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSupDimEdit({ side, text: String(Math.round(d.distanceMm)) })}
                    className="h-8 px-2.5 rounded-full bg-[#082f49]/95 border border-cyan-400 text-cyan-100 font-mono font-bold text-xs shadow-lg active:scale-95 whitespace-nowrap"
                    title={`Distancia hasta ${d.label}: tocá para cambiarla`}
                  >
                    {Math.round(d.distanceMm)} mm
                  </button>
                ))}
            </div>
          );
        });
      })()}
      {/* Cota del caño elegido: se toca para escribir el largo; mientras se estira muestra el largo nuevo */}
      <div ref={dimRef} style={{ visibility: 'hidden' }} className="absolute left-0 top-0">
        {(() => {
          const comp = !multiMode && selectedComponentId ? graph.components.get(selectedComponentId) : undefined;
          if (!comp || comp.type !== 'PIPE' || comp.ports.length < 2 || connectRoutes.length) return null;
          const current = Math.round(comp.parameters.cutLength || comp.ports[0].position.distanceTo(comp.ports[1].position));
          if (stretch && stretch.compId === comp.id) {
            return (
              <div className="h-9 px-3 rounded-full bg-amber-400 text-slate-950 font-mono font-black text-sm flex items-center shadow-lg">
                {Math.round(stretch.length)} mm
              </div>
            );
          }
          if (lengthEdit === null) {
            return (
              <button
                type="button"
                onClick={() => setLengthEdit(String(current))}
                className="h-9 px-3 rounded-full bg-[#0f172a]/95 border border-blue-400 text-blue-200 font-mono font-bold text-sm shadow-lg active:scale-95"
                title="Cambiar el largo de este caño"
              >
                {current} mm
              </button>
            );
          }
          const submit = () => {
            const value = parseFloat(lengthEdit);
            setLengthEdit(null);
            if (value > 10 && Math.abs(value - current) > 0.5) {
              // Si un solo extremo está libre, ese es el que se mueve
              const anchor = comp.ports[1].connectedJointId && !comp.ports[0].connectedJointId ? 'end' : 'start';
              usePipingStore.getState().stretchPipe(comp.id, value, anchor);
            }
          };
          return (
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                submit();
              }}
              className="flex items-center gap-1 p-1 rounded-xl bg-[#0f172a] border border-blue-400 shadow-lg"
            >
              <input
                autoFocus
                type="number"
                inputMode="decimal"
                value={lengthEdit}
                onChange={(ev) => setLengthEdit(ev.target.value)}
                onFocus={(ev) => ev.target.select()}
                className="h-10 w-24 px-2 rounded-lg bg-[#1b1f26] text-base font-mono font-black text-blue-200 outline-none"
                aria-label="Largo del caño en milímetros"
              />
              <button type="submit" className="h-10 px-3 rounded-lg bg-blue-600 text-white text-sm font-black">
                OK
              </button>
              <button type="button" onClick={() => setLengthEdit(null)} className="h-10 w-9 rounded-lg text-slate-300" aria-label="Cancelar">
                ✕
              </button>
            </form>
          );
        })()}
      </div>
      {/* Cota del tramo que se está por trazar: acompaña a la manija y, al tocarla, traza */}
      <button
        ref={labelRef}
        type="button"
        onClick={() => {
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(25);
          applyRouting();
        }}
        style={{ visibility: 'hidden' }}
        className={`absolute left-0 top-0 h-10 pl-3 pr-2.5 rounded-full bg-[#0f172a]/95 border border-emerald-400 text-emerald-300 font-mono font-black text-sm shadow-lg items-center gap-2 active:scale-95 ${
          connectRoutes.length || connectPicking ? 'hidden' : 'flex'
        }`}
        title="Trazar este tramo"
      >
        <span>{numpadValue || '0'} mm</span>
        <span className="w-6 h-6 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center text-xs">✓</span>
      </button>
    </div>
  );
};
