import * as THREE from 'three';

/** Tolerancia para usar un codo estándar aunque el giro no sea exacto (pendientes, desalineaciones) */
export const STANDARD_ELBOW_TOLERANCE_DEG = 3;

/**
 * Dirección de salida al girar `angleDeg` desde `portDir` hacia el lado de `axis`.
 * Con 90° sale perpendicular a la boca; si `axis` es paralelo a la boca no hay hacia dónde girar
 * y se devuelve el eje tal cual (tramo recto u opuesto).
 */
export function deflect(portDir: THREE.Vector3, axis: THREE.Vector3, angleDeg: number): THREE.Vector3 {
  const d = portDir.clone().normalize();
  const a = axis.clone().normalize();
  const perp = a.clone().addScaledVector(d, -a.dot(d));
  if (perp.lengthSq() < 1e-6) return a;
  perp.normalize();
  const rad = THREE.MathUtils.degToRad(angleDeg);
  return d.multiplyScalar(Math.cos(rad)).addScaledVector(perp, Math.sin(rad)).normalize();
}

/** Inclina una dirección horizontal con una pendiente en % (positiva sube, negativa baja) */
export function applySlope(dir: THREE.Vector3, slopePct: number): THREE.Vector3 {
  const d = dir.clone().normalize();
  if (!slopePct || Math.abs(d.z) > 0.2) return d;
  const h = new THREE.Vector3(d.x, d.y, 0).normalize();
  return h.addScaledVector(new THREE.Vector3(0, 0, 1), slopePct / 100).normalize();
}

export interface ElbowChoice {
  /** Codo de catálogo del que se parte */
  baseAngle: 45 | 90;
  /** true si hay que recortarlo para dar el ángulo pedido */
  trimmed: boolean;
}

/** Qué codo corresponde a un giro: estándar si está dentro de tolerancia, si no uno recortado */
export function elbowForBend(bendDeg: number, has45 = true): ElbowChoice | null {
  const tol = STANDARD_ELBOW_TOLERANCE_DEG;
  if (bendDeg > 90 + tol) return null;
  if (Math.abs(bendDeg - 90) <= tol) return { baseAngle: 90, trimmed: false };
  if (Math.abs(bendDeg - 45) <= tol && has45) return { baseAngle: 45, trimmed: false };
  return { baseAngle: bendDeg < 45 && has45 ? 45 : 90, trimmed: true };
}

/** Centro a cara de un codo de radio `radius` recortado a `bendDeg` */
export function trimmedTakeOff(radius: number, bendDeg: number): number {
  return radius * Math.tan(THREE.MathUtils.degToRad(bendDeg) / 2);
}

export interface OffsetPlan {
  /** Dirección del tramo diagonal */
  travelDir: THREE.Vector3;
  /** Largo del tramo diagonal, de vértice a vértice */
  travelLength: number;
  /** Lo que avanza la línea en su dirección original mientras se desvía */
  advance: number;
  /** Corrimiento total (lateral y vertical compuestos) */
  offset: number;
}

/**
 * Desvío (simple o rodado): dos codos iguales de `angleDeg` y un tramo diagonal, para correr la línea
 * `offset` (vector perpendicular a `dir`; la parte paralela se descarta) y seguir en la misma dirección.
 */
export function planOffset(
  dir: THREE.Vector3,
  offset: THREE.Vector3,
  angleDeg: number,
  takeOff: number,
  minNipple: number
): OffsetPlan | { error: string } {
  const d = dir.clone().normalize();
  const o = offset.clone().addScaledVector(d, -offset.dot(d));
  const mag = o.length();
  if (mag < 1) return { error: 'Indicá cuánto hay que correr la línea (en mm).' };
  if (!(angleDeg >= 10 && angleDeg <= 90)) return { error: 'El ángulo de los codos tiene que estar entre 10° y 90°.' };
  const rad = THREE.MathUtils.degToRad(angleDeg);
  const travelLength = mag / Math.sin(rad);
  const advance = angleDeg > 89.99 ? 0 : mag / Math.tan(rad);
  const minTravel = 2 * takeOff + minNipple;
  if (travelLength < minTravel - 1e-6) {
    const minOffset = Math.ceil(minTravel * Math.sin(rad));
    return { error: `Con codos de ${angleDeg}° el corrimiento mínimo es de ${minOffset} mm (entran los dos codos y un niple).` };
  }
  return { travelDir: deflect(d, o, angleDeg), travelLength, advance, offset: mag };
}

/** Elevación del eje para que el fondo (BOP) o el lomo (TOP) del caño quede en `target` */
export function centerlineForElevation(target: number, ref: 'CL' | 'BOP' | 'TOP', outerDiameter: number): number {
  return ref === 'BOP' ? target + outerDiameter / 2 : ref === 'TOP' ? target - outerDiameter / 2 : target;
}
