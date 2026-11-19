import * as THREE from 'three';
import { PipingGraph } from '../core/graph/PipingGraph';

const Y_UP = new THREE.Vector3(0, 1, 0);

/**
 * Construye una envolvente translúcida de aislación térmica (estilo Toggle Insulation Display de
 * AutoCAD Plant 3D) alrededor de los caños y codos visibles del modelo, con espesor `thicknessMm`.
 * Sirve para comprobar visualmente interferencias y espacio libre real en planta/pipe rack.
 */
export function buildInsulationGroup(
  graph: PipingGraph,
  thicknessMm: number,
  visibleIds: ReadonlySet<string> | null = null
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'insulation-layer';
  if (!(thicknessMm > 0)) return group;

  const mat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    roughness: 0.65,
    metalness: 0.1,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  for (const comp of graph.components.values()) {
    if (visibleIds && !visibleIds.has(comp.id)) continue;
    const od = comp.parameters.outerDiameter || 60.3;
    const r = od / 2 + thicknessMm;

    if (comp.type === 'PIPE' && comp.ports.length >= 2) {
      const a = comp.ports[0].position;
      const b = comp.ports[1].position;
      const len = a.distanceTo(b);
      if (len < 1) continue;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 18, 1, false), mat);
      mesh.position.copy(a.clone().lerp(b, 0.5));
      mesh.quaternion.setFromUnitVectors(Y_UP, b.clone().sub(a).normalize());
      mesh.renderOrder = 10;
      group.add(mesh);
    } else if (comp.type === 'ELBOW' && comp.centerline.length >= 3) {
      // Manto envolvente en codo siguiendo la curva cuadrática de su centerline
      const curve = new THREE.QuadraticBezierCurve3(
        comp.centerline[0].clone(),
        comp.centerline[1].clone(),
        comp.centerline[2].clone()
      );
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, r, 14, false), mat);
      mesh.renderOrder = 10;
      group.add(mesh);
    }
  }

  return group;
}
