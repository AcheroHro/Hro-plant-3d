import * as THREE from 'three';
import { Component } from '../../types/piping';
import { PipingGraph } from '../../core/graph/PipingGraph';

export interface CollisionResult {
  hasCollision: boolean;
  collidingComponentIds: Set<string>;
  details: {
    componentAId: string;
    componentBId: string;
    distanceMm: number;
    minRequiredDistanceMm: number;
  }[];
}

/**
 * Calcula la distancia mínima euclídea entre dos segmentos 3D finitos [A1, B1] y [A2, B2].
 * Algoritmo exacto de distancia entre segmentos en el espacio tridimensional.
 */
export function distanceBetweenSegments(
  a1: THREE.Vector3,
  b1: THREE.Vector3,
  a2: THREE.Vector3,
  b2: THREE.Vector3
): number {
  const u = new THREE.Vector3().subVectors(b1, a1);
  const v = new THREE.Vector3().subVectors(b2, a2);
  const w = new THREE.Vector3().subVectors(a1, a2);

  const a = u.dot(u);
  const b = u.dot(v);
  const c = v.dot(v);
  const d = u.dot(w);
  const e = v.dot(w);
  const D = a * c - b * b;

  let sc: number;
  let sN: number;
  let sD = D;
  let tc: number;
  let tN: number;
  let tD = D;

  const EPSILON = 1e-6;

  if (D < EPSILON) {
    // Segmentos casi paralelos
    sN = 0.0;
    sD = 1.0;
    tN = e;
    tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0.0) {
      sN = 0.0;
      tN = e;
      tD = c;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c;
    }
  }

  if (tN < 0.0) {
    tN = 0.0;
    if (-d < 0.0) {
      sN = 0.0;
    } else if (-d > a) {
      sN = sD;
    } else {
      sN = -d;
      sD = a;
    }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0.0) {
      sN = 0.0;
    } else if (-d + b > a) {
      sN = sD;
    } else {
      sN = -d + b;
      sD = a;
    }
  }

  sc = Math.abs(sN) < EPSILON ? 0.0 : sN / sD;
  tc = Math.abs(tN) < EPSILON ? 0.0 : tN / tD;

  const dP = new THREE.Vector3()
    .copy(w)
    .addScaledVector(u, sc)
    .addScaledVector(v, -tc);

  return dP.length();
}

/**
 * Detecta colisiones e interferencias espaciales entre cañerías del grafo no conectadas entre sí.
 * Retorna las IDs de los componentes en colisión para destacarlos en color rojo.
 */
export function detectPipingCollisions(graph: PipingGraph): CollisionResult {
  const components = Array.from(graph.components.values()).filter(
    (c) => c.type === 'PIPE' && c.centerline.length >= 2
  );

  const collidingIds = new Set<string>();
  const details: CollisionResult['details'] = [];

  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      const compA = components[i];
      const compB = components[j];

      // Si comparten una junta directa, están conectados y no constituyen colisión
      if (areComponentsDirectlyConnected(compA, compB, graph)) {
        continue;
      }

      const odA = compA.parameters.outerDiameter;
      const odB = compB.parameters.outerDiameter;
      const minDistance = (odA + odB) / 2;

      // Calcular distancia mínima entre las líneas centrales
      const dist = distanceBetweenSegments(
        compA.centerline[0],
        compA.centerline[compA.centerline.length - 1],
        compB.centerline[0],
        compB.centerline[compB.centerline.length - 1]
      );

      if (dist < minDistance - 1e-3) {
        collidingIds.add(compA.id);
        collidingIds.add(compB.id);
        details.push({
          componentAId: compA.id,
          componentBId: compB.id,
          distanceMm: dist,
          minRequiredDistanceMm: minDistance
        });
      }
    }
  }

  return {
    hasCollision: collidingIds.size > 0,
    collidingComponentIds: collidingIds,
    details
  };
}

function areComponentsDirectlyConnected(
  compA: Component,
  compB: Component,
  graph: PipingGraph
): boolean {
  for (const portA of compA.ports) {
    if (portA.connectedJointId) {
      const joint = graph.joints.get(portA.connectedJointId);
      if (joint) {
        const otherPortId = joint.portAId === portA.id ? joint.portBId : joint.portAId;
        const otherPort = graph.ports.get(otherPortId);
        if (otherPort && otherPort.componentId === compB.id) {
          return true;
        }
      }
    }
  }
  return false;
}
