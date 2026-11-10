import * as THREE from 'three';

/**
 * Recorridos ortogonales para unir dos bocas libres, como las soluciones que ofrece Plant 3D al
 * rutear hasta un puerto. Cada recorrido es una poligonal de eje a eje (vértice a vértice): sale
 * recto de la boca de origen, gira a 90° con codos y llega recto a la boca de destino.
 */

export interface RouteLeg {
  dir: THREE.Vector3;
  /** Largo de eje a eje, en mm */
  length: number;
}

export interface RoutePlan {
  legs: RouteLeg[];
  /** Vértices de la poligonal, del origen al destino */
  points: THREE.Vector3[];
  bends: number;
  totalLength: number;
}

export interface RouteOptions {
  /** Distancia del vértice al extremo del codo de 90° */
  takeOff: number;
  /** Tramo recto mínimo entre accesorios */
  minNipple: number;
  max?: number;
}

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

/** Devuelve el eje (con signo) si la dirección está alineada con X, Y o Z */
export function snapToAxis(dir: THREE.Vector3): THREE.Vector3 | null {
  const d = dir.clone().normalize();
  for (const axis of AXES) {
    const dot = d.dot(axis);
    if (Math.abs(dot) > 0.999) return axis.clone().multiplyScalar(Math.sign(dot));
  }
  return null;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

/**
 * @param a  posición de la boca de origen
 * @param da dirección hacia afuera de la boca de origen
 * @param b  posición de la boca de destino
 * @param db dirección hacia afuera de la boca de destino
 */
export function planConnectionRoutes(
  a: THREE.Vector3,
  da: THREE.Vector3,
  b: THREE.Vector3,
  db: THREE.Vector3,
  { takeOff, minNipple, max = 4 }: RouteOptions
): RoutePlan[] {
  const dirA = snapToAxis(da);
  const dirB = snapToAxis(db);
  if (!dirA || !dirB) return [];
  const arrive = dirB.clone().negate();
  const endMin = Math.ceil(takeOff + minNipple);

  // Largos de salida (s) y de llegada (t) a probar: nada, el mínimo, o hasta quedar alineado con la otra boca
  const ab = b.clone().sub(a);
  const sAligned = ab.dot(dirA);
  const tAligned = -ab.dot(dirB);
  const sOptions = [...new Set([0, endMin, sAligned, sAligned - endMin].filter((v) => v === 0 || v >= endMin))];
  const tOptions = [...new Set([0, endMin, tAligned, tAligned - endMin].filter((v) => v === 0 || v >= endMin))];

  const found = new Map<string, RoutePlan>();
  for (const s of sOptions) {
    for (const t of tOptions) {
      const p = a.clone().addScaledVector(dirA, s);
      const q = b.clone().addScaledVector(dirB, t);
      const delta = q.clone().sub(p);
      const middle = AXES.map((axis) => ({ axis, c: delta.dot(axis) })).filter(({ c }) => Math.abs(c) > 0.5);
      for (const order of permutations(middle)) {
        const raw: RouteLeg[] = [
          { dir: dirA.clone(), length: s },
          ...order.map(({ axis, c }) => ({ dir: axis.clone().multiplyScalar(Math.sign(c)), length: Math.abs(c) })),
          { dir: arrive.clone(), length: t }
        ].filter((leg) => leg.length > 0.5);

        // Tramos seguidos en la misma dirección son uno solo; ir y volver no es un recorrido
        const legs: RouteLeg[] = [];
        let valid = raw.length > 0;
        for (const leg of raw) {
          const prev = legs[legs.length - 1];
          const dot = prev ? prev.dir.dot(leg.dir) : 0;
          if (prev && dot > 0.99) prev.length += leg.length;
          else if (prev && dot < -0.99) {
            valid = false;
            break;
          } else legs.push({ dir: leg.dir.clone(), length: leg.length });
        }
        if (!valid || legs.length === 0) continue;
        // Sale recto de la boca de origen y entra recto a la de destino
        if (legs[0].dir.dot(dirA) < 0.99 || legs[legs.length - 1].dir.dot(arrive) < 0.99) continue;
        // Cada tramo tiene que alojar los codos de sus extremos y un niple mínimo
        const fits = legs.every(
          (leg, i) => leg.length >= (i > 0 ? takeOff : 0) + (i < legs.length - 1 ? takeOff : 0) + minNipple - 0.01
        );
        if (!fits) continue;

        const points = [a.clone()];
        for (const leg of legs) points.push(points[points.length - 1].clone().addScaledVector(leg.dir, leg.length));
        if (points[points.length - 1].distanceTo(b) > 0.5) continue;

        const key = legs.map((l) => `${l.dir.x},${l.dir.y},${l.dir.z}:${l.length.toFixed(1)}`).join('|');
        if (!found.has(key)) {
          found.set(key, {
            legs,
            points,
            bends: legs.length - 1,
            totalLength: legs.reduce((sum, l) => sum + l.length, 0)
          });
        }
      }
    }
  }

  return [...found.values()].sort((x, y) => x.bends - y.bends || x.totalLength - y.totalLength).slice(0, max);
}
