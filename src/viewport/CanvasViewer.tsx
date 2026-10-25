import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { usePipingStore } from '../store/usePipingStore';
import { createPipeGeometry } from './geometries/pipeGeometry';
import { createElbowGeometry } from './geometries/elbowGeometry';
import { createFlangeGeometry } from './geometries/flangeGeometry';
import { createTeeGeometry } from './geometries/teeGeometry';
import { createReducerGeometry } from './geometries/reducerGeometry';
import { createValveGeometry } from './geometries/valveGeometry';
import { createCapGeometry } from './geometries/capGeometry';
import { disposeObject } from './geometries/geometryUtils';
import { findScreenMagneticSnap } from './snapping/magneticSnap';

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
  const cameraViewPreset = usePipingStore((s) => s.cameraViewPreset);
  const activeDirection = usePipingStore((s) => s.activeDirection);
  const numpadValue = usePipingStore((s) => s.numpadValue);
  const collidingComponentIds = usePipingStore((s) => s.collidingComponentIds);
  const triggerFrameAll = usePipingStore((s) => s.triggerFrameAll);
  const setSnappedPortId = usePipingStore((s) => s.setSnappedPortId);
  const selectPortAndAlign = usePipingStore((s) => s.selectPortAndAlign);
  const setSelectedComponentId = usePipingStore((s) => s.setSelectedComponentId);

  // Referencias para la escena Three.js
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const pipeGroupRef = useRef<THREE.Group | null>(null);
  const portsGroupRef = useRef<THREE.Group | null>(null);
  const cursorGroupRef = useRef<THREE.Group | null>(null);

  // Estado de control de cámara táctil (Z-Up)
  const cameraTargetRef = useRef<THREE.Vector3>(new THREE.Vector3(500, 500, 0));
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
    const box = new THREE.Box3().setFromObject(pipeGroupRef.current);
    if (box.isEmpty()) {
      cameraTargetRef.current.set(500, 500, 0);
      cameraDistanceRef.current = 2500;
    } else {
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z, 350);
      cameraTargetRef.current.copy(center);
      cameraDistanceRef.current = maxDim * 2.1;
    }
    updateCameraPosition();
  };

  useEffect(() => {
    if (triggerFrameAll > 0) {
      executeFrameAll();
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
        cameraTargetRef.current.copy(port.position);
        updateCameraPosition();
      }
    }
  }, [cameraMode, selectedPortId, version]);

  // Reconstrucción reactiva de mallas cuando cambia el grafo, selección o versión
  useEffect(() => {
    if (!pipeGroupRef.current || !portsGroupRef.current || !cursorGroupRef.current) return;

    const pipeGroup = pipeGroupRef.current;
    const portsGroup = portsGroupRef.current;
    const cursorGroup = cursorGroupRef.current;

    // Limpieza de memoria GPU explícita
    disposeObject(pipeGroup);
    disposeObject(portsGroup);
    disposeObject(cursorGroup);
    while (pipeGroup.children.length > 0) pipeGroup.remove(pipeGroup.children[0]);
    while (portsGroup.children.length > 0) portsGroup.remove(portsGroup.children[0]);
    while (cursorGroup.children.length > 0) cursorGroup.remove(cursorGroup.children[0]);

    // Materiales técnicos estilo AutoCAD Plant 3D 2027 (DoubleSide para visibilidad total interior/exterior)
    const pipeMaterial = new THREE.MeshStandardMaterial({
      color: 0x829ab1,
      roughness: 0.32,
      metalness: 0.72,
      side: THREE.DoubleSide
    });

    const fittingMaterial = new THREE.MeshStandardMaterial({
      color: 0x4da8da,
      roughness: 0.26,
      metalness: 0.78,
      side: THREE.DoubleSide
    });

    const teeMaterial = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.24,
      metalness: 0.8,
      side: THREE.DoubleSide
    });

    const flangeMaterial = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.24,
      metalness: 0.85,
      side: THREE.DoubleSide
    });

    const valveMaterial = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.35,
      metalness: 0.65,
      side: THREE.DoubleSide
    });

    const gasketBoltMaterial = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.3,
      metalness: 0.85,
      side: THREE.DoubleSide
    });

    const weldBeadMaterial = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      roughness: 0.4,
      metalness: 0.7,
      side: THREE.DoubleSide
    });

    // Material de selección estilo AutoCAD Plant 3D (Cyan brillante con emisión)
    const selectedMaterial = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x0284c7,
      emissiveIntensity: 0.45,
      roughness: 0.2,
      metalness: 0.8,
      side: THREE.DoubleSide
    });

    // Material de colisión (rojo alerta)
    const collisionMaterial = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0x7f1d1d,
      emissiveIntensity: 0.35,
      roughness: 0.3,
      metalness: 0.8,
      side: THREE.DoubleSide
    });

    // Helper para etiquetar mallas con componentId para selección 3D por clic/tap
    const tagComponentMesh = (obj: THREE.Object3D, compId: string) => {
      obj.userData = { ...obj.userData, componentId: compId };
      obj.traverse((child) => {
        child.userData = { ...child.userData, componentId: compId };
      });
    };

    // 1. Construir geometrías para cada componente
    for (const comp of graph.components.values()) {
      const isColliding = collidingComponentIds.has(comp.id);
      const isSelected = comp.id === selectedComponentId;
      const { outerDiameter, wallThickness, cutLength, angle, radius, runTakeOff, branchTakeOff, faceToFace, boltCircle, boltHoles } =
        comp.parameters;

      const pickMat = (defaultMat: THREE.Material) => {
        if (isSelected) return selectedMaterial;
        if (isColliding) return collisionMaterial;
        return defaultMat;
      };

      if (comp.type === 'PIPE' && comp.centerline.length >= 2) {
        const mat = pickMat(pipeMaterial);
        const start = comp.centerline[0];
        const end = comp.centerline[comp.centerline.length - 1];
        const length = cutLength || start.distanceTo(end);

        const geom = createPipeGeometry(outerDiameter, wallThickness, length);
        const mesh = new THREE.Mesh(geom, mat);

        const vDir = new THREE.Vector3().subVectors(end, start).normalize();
        const vUp = new THREE.Vector3(0, 0, 1);
        const quat = new THREE.Quaternion().setFromUnitVectors(vUp, vDir);

        mesh.position.copy(start);
        mesh.quaternion.copy(quat);
        tagComponentMesh(mesh, comp.id);
        pipeGroup.add(mesh);
      } else if (comp.type === 'ELBOW' && comp.ports.length >= 2) {
        const mat = pickMat(fittingMaterial);
        const elbowRadius = radius || 76.2;
        const geom = createElbowGeometry(outerDiameter, wallThickness, elbowRadius, angle || 90);
        const mesh = new THREE.Mesh(geom, mat);

        if (comp.parameters.matrixElements && comp.parameters.matrixElements.length === 16) {
          mesh.matrix.fromArray(comp.parameters.matrixElements);
          mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
        } else {
          mesh.position.copy(comp.ports[0].position);
        }

        tagComponentMesh(mesh, comp.id);
        pipeGroup.add(mesh);
      } else if (comp.type === 'FLANGE') {
        const mat = pickMat(flangeMaterial);
        const geom = createFlangeGeometry(
          outerDiameter,
          comp.ports[0]?.outerDiameter ? comp.ports[0].outerDiameter * 1.5 : outerDiameter * 1.5,
          wallThickness,
          faceToFace || 63.5,
          boltCircle,
          boltHoles
        );
        const mesh = new THREE.Mesh(geom, mat);
        const start = comp.centerline[0] || comp.ports[0]?.position;
        const end = comp.centerline[1] || comp.ports[1]?.position;
        if (start && end) {
          const vDir = new THREE.Vector3().subVectors(end, start).normalize();
          const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), vDir);
          mesh.position.copy(start);
          mesh.quaternion.copy(quat);

          // Anillo visual de Junta Espirometálica (GasketSubPart P3dJoint)
          const gasketGeom = new THREE.CylinderGeometry(
            outerDiameter * 0.68,
            outerDiameter * 0.68,
            3.2,
            24
          );
          gasketGeom.rotateX(Math.PI / 2);
          const gasketMesh = new THREE.Mesh(gasketGeom, gasketBoltMaterial);
          gasketMesh.position.copy(end);
          gasketMesh.quaternion.copy(quat);
          tagComponentMesh(gasketMesh, comp.id);
          pipeGroup.add(gasketMesh);
        }
        tagComponentMesh(mesh, comp.id);
        pipeGroup.add(mesh);
      } else if (comp.type === 'TEE') {
        const mat = pickMat(teeMaterial);
        const rTakeOff = runTakeOff || Math.max(63.5, outerDiameter * 0.9);
        const bTakeOff = branchTakeOff || Math.max(63.5, outerDiameter * 0.9);
        const geom = createTeeGeometry(outerDiameter, wallThickness, rTakeOff, bTakeOff);
        const mesh = new THREE.Mesh(geom, mat);

        const vertex = comp.centerline[1] || comp.centerline[0] || comp.ports[0]?.position;
        const p1 = comp.centerline[0] || comp.ports[0]?.position || vertex;
        const p2 = comp.centerline[2] || comp.ports[1]?.position || vertex.clone().add(new THREE.Vector3(1, 0, 0));
        const p3 = comp.centerline[3] || comp.ports[2]?.position || vertex.clone().add(new THREE.Vector3(0, 1, 0));

        if (vertex && p1 && p2 && p3) {
          // Eje Z local: dirección del Run continuo (desde p1 hacia p2)
          let uRun = new THREE.Vector3().subVectors(p2, p1);
          if (uRun.lengthSq() < 0.0001) {
            uRun = comp.ports[1]?.direction?.clone() || new THREE.Vector3(1, 0, 0);
          }
          uRun.normalize();

          // Eje Y local: dirección del Ramal Branch (desde vertex hacia p3)
          let uBranch = new THREE.Vector3().subVectors(p3, vertex);
          if (uBranch.lengthSq() < 0.0001) {
            uBranch = comp.ports[2]?.direction?.clone() || new THREE.Vector3(0, 1, 0);
          }
          uBranch.normalize();

          // Garantizar ortogonalidad estricta entre Run y Branch para evitar matriz degenerada
          uBranch.addScaledVector(uRun, -uBranch.dot(uRun));
          if (uBranch.lengthSq() < 0.0001) {
            uBranch = Math.abs(uRun.y) < 0.8 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
            uBranch.addScaledVector(uRun, -uBranch.dot(uRun));
          }
          uBranch.normalize();

          // Eje X local = Y x Z (sistema dextrógiro)
          const uPerp = new THREE.Vector3().crossVectors(uBranch, uRun).normalize();

          const basisMat = new THREE.Matrix4().makeBasis(uPerp, uBranch, uRun);
          const quat = new THREE.Quaternion().setFromRotationMatrix(basisMat);

          mesh.position.copy(vertex);
          mesh.quaternion.copy(quat);
        }
        tagComponentMesh(mesh, comp.id);
        pipeGroup.add(mesh);
      } else if (comp.type === 'REDUCER') {
        const mat = pickMat(fittingMaterial);
        const redOD = comp.parameters.reducedOuterDiameter || outerDiameter * 0.7;
        const geom = createReducerGeometry(outerDiameter, redOD, wallThickness, faceToFace || 88.9);
        const mesh = new THREE.Mesh(geom, mat);
        const start = comp.centerline[0] || comp.ports[0]?.position;
        const end = comp.centerline[1] || comp.ports[1]?.position;
        if (start && end) {
          const vDir = new THREE.Vector3().subVectors(end, start).normalize();
          const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), vDir);
          mesh.position.copy(start);
          mesh.quaternion.copy(quat);
        }
        tagComponentMesh(mesh, comp.id);
        pipeGroup.add(mesh);
      } else if (comp.type === 'VALVE') {
        const mat = pickMat(valveMaterial);
        const geom = createValveGeometry(outerDiameter, wallThickness, faceToFace || 178);
        const mesh = new THREE.Mesh(geom, mat);
        const start = comp.centerline[0] || comp.ports[0]?.position;
        const end = comp.centerline[1] || comp.ports[1]?.position;
        if (start && end) {
          const vDir = new THREE.Vector3().subVectors(end, start).normalize();
          const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), vDir);
          mesh.position.copy(start);
          mesh.quaternion.copy(quat);

          // Anillos de Junta y Espárragos P3dJoint en ambas caras de la válvula
          for (const pt of [start, end]) {
            const gGeom = new THREE.CylinderGeometry(outerDiameter * 0.72, outerDiameter * 0.72, 3.5, 24);
            gGeom.rotateX(Math.PI / 2);
            const gMesh = new THREE.Mesh(gGeom, gasketBoltMaterial);
            gMesh.position.copy(pt);
            gMesh.quaternion.copy(quat);
            tagComponentMesh(gMesh, comp.id);
            pipeGroup.add(gMesh);
          }
        }
        tagComponentMesh(mesh, comp.id);
        pipeGroup.add(mesh);
      } else if (comp.type === 'CAP') {
        const mat = pickMat(fittingMaterial);
        const geom = createCapGeometry(outerDiameter, wallThickness, faceToFace || 38.1);
        const mesh = new THREE.Mesh(geom, mat);
        const start = comp.centerline[0] || comp.ports[0]?.position;
        const end = comp.centerline[1] || (start && comp.ports[0] ? start.clone().add(comp.ports[0].direction.clone().negate().multiplyScalar(38.1)) : null);
        if (start && end) {
          const vDir = new THREE.Vector3().subVectors(end, start).normalize();
          const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), vDir);
          mesh.position.copy(start);
          mesh.quaternion.copy(quat);
        }
        tagComponentMesh(mesh, comp.id);
        pipeGroup.add(mesh);
      }
    }

    // 1.b Renderizar cordones de soldadura / uniones 3D (WeldSubPart / JointMarkerSubPart de Plant 3D)
    for (const joint of graph.joints.values()) {
      const portA = graph.ports.get(joint.portAId);
      if (portA) {
        const ringR = (portA.outerDiameter || 60.3) / 2;
        const beadGeom = new THREE.TorusGeometry(ringR + 1.5, 2.5, 10, 24);
        const beadMat = joint.type === 'FLANGED' ? gasketBoltMaterial : weldBeadMaterial;
        const beadMesh = new THREE.Mesh(beadGeom, beadMat);
        beadMesh.position.copy(joint.position);
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), portA.direction);
        beadMesh.quaternion.copy(quat);
        pipeGroup.add(beadMesh);
      }
    }

    // 2. Construir Grips "+" estilo AutoCAD Plant 3D para TODOS los puertos abiertos (fáciles de tocar en móvil/PC)
    const openPorts = graph.getOpenPorts();
    for (const port of openPorts) {
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

    // 3. Cursor de ruteo activo y previsualización fantasma (Dynamic Input de Plant 3D)
    const activePort = selectedPortId ? graph.ports.get(selectedPortId) : (openPorts.length > 0 ? openPorts[openPorts.length - 1] : null);
    if (activePort) {
      // Línea fantasma proyectada con la longitud y dirección activa
      const lenMm = parseFloat(numpadValue) || 500;
      const previewEnd = activePort.position.clone().add(activeDirection.clone().multiplyScalar(lenMm));
      const lineGeom = new THREE.BufferGeometry().setFromPoints([activePort.position, previewEnd]);
      const lineMat = new THREE.LineDashedMaterial({
        color: 0x38bdf8,
        dashSize: 40,
        gapSize: 20
      });
      const previewLine = new THREE.Line(lineGeom, lineMat);
      previewLine.computeLineDistances();
      cursorGroup.add(previewLine);

      // Flecha indicadora de dirección activa
      const arrowDir = activeDirection.clone().normalize();
      const arrowHelper = new THREE.ArrowHelper(arrowDir, activePort.position, Math.min(260, lenMm), 0x22c55e, 52, 32);
      cursorGroup.add(arrowHelper);
    }
  }, [graph, version, collidingComponentIds, selectedPortId, selectedComponentId, activeDirection, numpadValue]);

  // Gestos multitáctiles y selección 3D CAD:
  // - Tap corto (< 8px): Selecciona puerto abierto (boca/ramal) o selecciona cañería/accesorio en 3D
  // - Arrastrar con 1 dedo: Órbita 3D libre alrededor de la escena (en cualquier modo)
  // - 2 dedos: Paneo y Pellizco (Pinch-to-zoom) simultáneos
  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPointersRef.current.size === 1) {
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    } else {
      pointerDownPosRef.current = null;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!touchPointersRef.current.has(e.pointerId)) return;
    touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pointers = Array.from(touchPointersRef.current.values());

    if (pointers.length === 1) {
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
    // Verificar si fue un Tap/Clic limpio (sin arrastrar la cámara) para seleccionar bocas o piezas 3D
    if (pointerDownPosRef.current && touchPointersRef.current.size === 1) {
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

        // Prioridad 1: Grips de puertos abiertos (bocas de cañería y ramales de Te)
        let handled = false;
        if (portsGroupRef.current) {
          const portHits = raycaster.intersectObjects(portsGroupRef.current.children, true);
          for (const hit of portHits) {
            const portId = hit.object.userData?.portId || hit.object.parent?.userData?.portId;
            if (portId) {
              selectPortAndAlign(portId);
              if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
              handled = true;
              break;
            }
          }
        }

        // Prioridad 2: Selección de cualquier cañería o accesorio en 3D (Pipe, Tee, Codo, Brida, Válvula)
        if (!handled && pipeGroupRef.current) {
          const compHits = raycaster.intersectObjects(pipeGroupRef.current.children, true);
          for (const hit of compHits) {
            const compId = hit.object.userData?.componentId || hit.object.parent?.userData?.componentId;
            if (compId) {
              setSelectedComponentId(compId);
              if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);
              handled = true;
              break;
            }
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
        className="w-full h-full block cursor-grab active:cursor-grabbing outline-none"
      />
    </div>
  );
};
