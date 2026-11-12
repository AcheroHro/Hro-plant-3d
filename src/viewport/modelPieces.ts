import * as THREE from 'three';
import type { PipingGraph } from '../core/graph/PipingGraph';
import type { Component, Joint, SupportKind, SupportMark } from '../types/piping';
import { buildComponentObject, faceThicknessOf, PieceMaterials } from './buildComponentMesh';
import { createStudsGeometry } from './geometries/flangeGeometry';

/**
 * Todo lo que el visor dibuja del modelo, pieza por pieza, con una firma de lo que define su
 * forma y su color. Si la firma no cambió, la malla armada antes sirve tal cual: así una
 * edición solo rearma las piezas que tocó (ver incrementalBatches.ts).
 */

/** Una cosa dibujable del modelo: una pieza, la soldadura o junta de una unión, o un soporte */
export interface PieceSpec {
  /** Id de la pieza; las juntas y soportes llevan una clave que empieza con '#' */
  key: string;
  /** Si tocarla en el visor la elige (solo las piezas del grafo) */
  pickable: boolean;
  /** Firma de forma, posición y material: si es igual, la malla de antes sirve */
  sig: string;
  build: () => THREE.Object3D | null;
}

/** Materiales del modelo. Viven mientras vive el visor, para que las mallas guardadas sigan siendo válidas */
export interface ModelMaterials {
  pieces: PieceMaterials;
  collision: THREE.Material;
  gasket: THREE.Material;
  stud: THREE.Material;
  fieldWeld: THREE.Material;
  weldBead: THREE.Material;
  support: Record<SupportKind, THREE.Material>;
  /** Material liso de un color (vista por spools o de cambios de campo), uno por color */
  color: (color: number) => THREE.Material;
  dispose: () => void;
}

export function createModelMaterials(): ModelMaterials {
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const pieces: PieceMaterials = {
    pipe: std({ color: 0x829ab1, roughness: 0.32, metalness: 0.72, side: THREE.DoubleSide }),
    fitting: std({ color: 0x4da8da, roughness: 0.26, metalness: 0.78, side: THREE.DoubleSide }),
    tee: std({ color: 0x38bdf8, roughness: 0.24, metalness: 0.8, side: THREE.DoubleSide }),
    flange: std({ color: 0x94a3b8, roughness: 0.24, metalness: 0.85, side: THREE.DoubleSide }),
    valve: std({ color: 0xef4444, roughness: 0.35, metalness: 0.65, side: THREE.DoubleSide }),
    // Volantes y palancas
    trim: std({ color: 0x1f2937, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide })
  };
  const supportColors: Record<SupportKind, number> = { APOYO: 0xfacc15, GUIA: 0x22d3ee, ANCLAJE: 0xf87171, COLGANTE: 0xfb923c };
  const support = Object.fromEntries(
    Object.entries(supportColors).map(([k, color]) => [k, std({ color, roughness: 0.6, metalness: 0.2 })])
  ) as unknown as Record<SupportKind, THREE.Material>;
  const colors = new Map<number, THREE.Material>();
  const all: THREE.Material[] = [];
  const m: ModelMaterials = {
    pieces,
    collision: std({ color: 0xef4444, emissive: 0x7f1d1d, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide }),
    gasket: std({ color: 0xf59e0b, roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide }),
    stud: std({ color: 0x334155, roughness: 0.45, metalness: 0.8 }),
    fieldWeld: std({ color: 0xf97316, emissive: 0x7c2d12, emissiveIntensity: 0.5, roughness: 0.4 }),
    weldBead: std({ color: 0xf97316, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide }),
    support,
    color: (color) => {
      let mat = colors.get(color);
      if (!mat) {
        mat = std({ color, roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide });
        colors.set(color, mat);
        all.push(mat);
      }
      return mat;
    },
    dispose: () => all.forEach((mat) => mat.dispose())
  };
  all.push(...Object.values(pieces), m.collision, m.gasket, m.stud, m.fieldWeld, m.weldBead, ...Object.values(support));
  return m;
}

/** Los puertos sin lo que no cambia la forma (a qué junta están unidos) */
const portReplacer = (key: string, value: unknown) => (key === 'connectedJointId' ? undefined : value);
const vec = (v: THREE.Vector3 | undefined) => (v ? [v.x, v.y, v.z] : null);

/** Firma de una pieza: todo lo que lee buildComponentObject, más el material que le toca */
export function componentSignature(comp: Component, materialKey: string, hostOuterDiameter?: number): string {
  return JSON.stringify([comp.type, materialKey, hostOuterDiameter ?? null, comp.parameters, comp.ports, comp.centerline], portReplacer);
}

export interface ModelPiecesOptions {
  materials: ModelMaterials;
  /** Con una línea aislada, solo estas piezas (null: todas) */
  visibleIds: Set<string> | null;
  colliding: Set<string>;
  /** Color de la vista por spools o de cambios de campo (null: el material por tipo) */
  colorOf: (componentId: string) => number | null;
}

/** Lo que hay que dibujar del modelo, sin armar nada todavía */
export function modelPieces(graph: PipingGraph, opts: ModelPiecesOptions): PieceSpec[] {
  const { materials, visibleIds, colliding, colorOf } = opts;
  const visible = (id: string) => !visibleIds || visibleIds.has(id);
  const specs: PieceSpec[] = [];

  for (const comp of graph.components.values()) {
    if (!visible(comp.id)) continue;
    const isColliding = colliding.has(comp.id);
    const color = isColliding ? null : colorOf(comp.id);
    const override = isColliding ? materials.collision : color !== null ? materials.color(color) : null;
    const host = comp.type === 'OLET' ? graph.oletHost(comp)?.parameters.outerDiameter : undefined;
    specs.push({
      key: comp.id,
      pickable: true,
      sig: componentSignature(comp, isColliding ? 'c' : color !== null ? `m${color}` : 'd', host),
      build: () => buildComponentObject(comp, { materials: materials.pieces, pick: (m) => override ?? m, hostOuterDiameter: host })
    });
  }

  for (const mark of graph.liveSupports()) {
    const host = graph.supportHost(mark);
    if (!host || !visible(host.id)) continue;
    const a = host.ports[0].position;
    const b = host.ports[1].position;
    specs.push({
      key: `#support/${mark.id}`,
      pickable: false,
      sig: JSON.stringify([mark.kind, vec(mark.position), host.parameters.outerDiameter, vec(a), vec(b)]),
      build: () => buildSupportObject(mark, host, materials)
    });
  }

  for (const joint of graph.joints.values()) {
    const portA = graph.ports.get(joint.portAId);
    if (!portA || !visible(portA.componentId)) continue;
    const portB = graph.ports.get(joint.portBId);
    const compA = graph.components.get(portA.componentId);
    const compB = portB ? graph.components.get(portB.componentId) : undefined;
    const bolts = [compA, compB].find((c) => c?.parameters.boltCircle && (c.parameters.boltCount || c.parameters.boltHoles));
    specs.push({
      key: `#joint/${joint.id}`,
      pickable: false,
      sig: JSON.stringify([
        joint.type,
        joint.gapMm ?? null,
        !!joint.fieldWeld,
        vec(joint.position),
        vec(portA.position),
        vec(portA.direction),
        portA.outerDiameter,
        vec(portB?.position),
        compA ? faceThicknessOf(compA) : null,
        compB ? faceThicknessOf(compB) : null,
        bolts ? [bolts.parameters.boltCircle, bolts.parameters.boltCount, bolts.parameters.boltHoles, bolts.parameters.boltSize] : null
      ]),
      build: () => buildJointObject(graph, joint, materials)
    });
  }
  return specs;
}

/** Soporte marcado sobre un caño: abrazadera y pie (o varilla, si cuelga) */
function buildSupportObject(mark: SupportMark, host: Component, materials: ModelMaterials): THREE.Object3D {
  const od = host.parameters.outerDiameter || 60.3;
  const axis = host.ports[1].position.clone().sub(host.ports[0].position).normalize();
  const mat = materials.support[mark.kind];
  const group = new THREE.Group();
  const clamp = new THREE.Mesh(new THREE.CylinderGeometry(od * 0.62, od * 0.62, Math.max(30, od * 0.5), 20), mat);
  clamp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  group.add(clamp);
  // El pie baja (o la varilla sube); en caños verticales sale hacia un costado
  const away = Math.abs(axis.z) > 0.9 ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 0, mark.kind === 'COLGANTE' ? 1 : -1);
  away.addScaledVector(axis, -away.dot(axis)).normalize();
  const legLen = mark.kind === 'COLGANTE' ? od * 3 : od * 1.6;
  const legSize = mark.kind === 'COLGANTE' ? od * 0.12 : od * 0.45;
  const leg = new THREE.Mesh(new THREE.BoxGeometry(legSize, legLen, legSize), mat);
  leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), away);
  leg.position.copy(away).multiplyScalar(od / 2 + legLen / 2);
  group.add(leg);
  if (mark.kind !== 'COLGANTE') {
    const plateW = mark.kind === 'ANCLAJE' ? od * 2 : od * 1.4;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(plateW, od * 0.15, plateW), mat);
    plate.quaternion.copy(leg.quaternion);
    plate.position.copy(away).multiplyScalar(od / 2 + legLen);
    group.add(plate);
  }
  group.position.copy(mark.position);
  return group;
}

/** Unión: junta y espárragos si es bridada; cordón de soldadura (más grueso si es de campo) si no */
function buildJointObject(graph: PipingGraph, joint: Joint, materials: ModelMaterials): THREE.Object3D | null {
  const portA = graph.ports.get(joint.portAId);
  if (!portA) return null;
  const group = new THREE.Group();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), portA.direction);
  const od = portA.outerDiameter || 60.3;
  if (joint.type === 'FLANGED') {
    const thickness = Math.max(1, joint.gapMm ?? 1.6);
    const gGeom = new THREE.CylinderGeometry(od * 0.8, od * 0.8, thickness, 28);
    gGeom.rotateX(Math.PI / 2);
    const gasket = new THREE.Mesh(gGeom, materials.gasket);
    gasket.position.copy(joint.position);
    gasket.quaternion.copy(quat);
    group.add(gasket);

    // Espárragos con tuercas, del largo que piden las dos piezas y la junta
    const portB = graph.ports.get(joint.portBId);
    const compA = graph.components.get(portA.componentId);
    const compB = portB ? graph.components.get(portB.componentId) : undefined;
    const withBolts = [compA, compB].find((c) => c?.parameters.boltCircle && (c.parameters.boltCount || c.parameters.boltHoles));
    if (portB && compA && compB && withBolts) {
      const tA = faceThicknessOf(compA);
      const tB = faceThicknessOf(compB);
      const gap = portA.position.distanceTo(portB.position);
      const size = /(\d+)\s*\/\s*(\d+)/.exec(withBolts.parameters.boltSize || '');
      const whole = /^\s*(\d+)(?=[\s-]+\d+\s*\/|\s*")/.exec(withBolts.parameters.boltSize || '');
      const studDia = Math.min(40, Math.max(10, ((whole ? Number(whole[1]) : 0) + (size ? Number(size[1]) / Number(size[2]) : 0)) * 25.4 || 16));
      const studs = new THREE.Mesh(
        createStudsGeometry(
          withBolts.parameters.boltCircle!,
          withBolts.parameters.boltCount || withBolts.parameters.boltHoles || 4,
          studDia,
          tA + tB + gap + studDia * 3.2
        ),
        materials.stud
      );
      studs.position.copy(portA.position.clone().addScaledVector(portA.direction.clone().normalize(), (gap + tB - tA) / 2));
      studs.quaternion.copy(quat);
      group.add(studs);
    }
  } else {
    // Soldadura de campo: anillo naranja más grueso (corta el spool)
    const ringR = od / 2;
    const beadGeom = joint.fieldWeld ? new THREE.TorusGeometry(ringR + 6, 6, 10, 24) : new THREE.TorusGeometry(ringR + 1.5, 2.5, 10, 24);
    const bead = new THREE.Mesh(beadGeom, joint.fieldWeld ? materials.fieldWeld : materials.weldBead);
    bead.position.copy(joint.position);
    bead.quaternion.copy(quat);
    group.add(bead);
  }
  return group;
}
