import * as THREE from 'three';
import type { Component, SupportKind, SupportMark } from '../../types/piping';

/**
 * Hacia dónde va un soporte y hasta dónde llega, a partir del caño que lo sostiene.
 * Lo usan el dibujo 3D, el PCF y el editor de soportes, así los tres dicen lo mismo.
 *
 * - `away`: dirección desde el eje del caño hacia el apoyo (abajo para un apoyo, arriba para un
 *   colgante; en caños verticales, de costado). `rotationDeg` la gira alrededor del eje del caño.
 * - `reachMm`: distancia desde el eje del caño hasta el punto de apoyo (el piso, la viga).
 *   Es la altura que se cambia en Plant con el grip "Change Support Elevation".
 */
export interface SupportFrame {
  axis: THREE.Vector3;
  away: THREE.Vector3;
  reachMm: number;
  /** Punto de apoyo: donde el soporte toca la estructura */
  point: THREE.Vector3;
  /** Dirección del soporte como la pide Isogen en el PCF */
  direction: 'UP' | 'DOWN' | 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';
}

/** Alcance por defecto: el que dibujaba la app antes de poder cambiarlo */
export function defaultSupportReach(kind: SupportKind, outerDiameter: number): number {
  return outerDiameter / 2 + (kind === 'COLGANTE' ? outerDiameter * 3 : outerDiameter * 1.6);
}

/** Alcance mínimo: el radio del caño más un poco, para que el soporte se vea */
export function minSupportReach(outerDiameter: number): number {
  return outerDiameter / 2 + 20;
}

export function supportFrame(mark: SupportMark, host: Component): SupportFrame {
  const od = host.parameters.outerDiameter || 60.3;
  const axis = host.ports[1].position.clone().sub(host.ports[0].position).normalize();
  const away = Math.abs(axis.z) > 0.9 ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 0, mark.kind === 'COLGANTE' ? 1 : -1);
  away.addScaledVector(axis, -away.dot(axis)).normalize();
  if (mark.rotationDeg) away.applyAxisAngle(axis, THREE.MathUtils.degToRad(mark.rotationDeg)).normalize();
  const reachMm = Math.max(minSupportReach(od), mark.heightMm ?? defaultSupportReach(mark.kind, od));
  const point = mark.position.clone().addScaledVector(away, reachMm);

  // La dirección del PCF es el eje del mundo más parecido a `away`
  const ax = Math.abs(away.x);
  const ay = Math.abs(away.y);
  const az = Math.abs(away.z);
  const direction: SupportFrame['direction'] =
    az >= ax && az >= ay ? (away.z > 0 ? 'UP' : 'DOWN') : ay >= ax ? (away.y > 0 ? 'NORTH' : 'SOUTH') : away.x > 0 ? 'EAST' : 'WEST';
  return { axis, away, reachMm, point, direction };
}

/**
 * Tipos de soporte de Plant 3D para elegir, por clase de soporte de la app. Son nombres de la
 * spec de soportes de Plant (pipesupportsspec): si la del proyecto usa otros, se escribe el
 * nombre exacto en "Otro".
 */
export const PLANT_SUPPORT_TYPES: Record<SupportKind, string[]> = {
  APOYO: ['Base Support', 'Dummy Leg', 'Shoe', 'Stanchion'],
  GUIA: ['Guide', 'U-Bolt'],
  ANCLAJE: ['Anchor', 'Clamp'],
  COLGANTE: ['Beam Bolted Hanger', 'Spring Hanger', 'Rod Hanger']
};

export const SUPPORT_KIND_NAMES: Record<SupportKind, string> = { APOYO: 'Apoyo', GUIA: 'Guía', ANCLAJE: 'Anclaje', COLGANTE: 'Colgante' };
