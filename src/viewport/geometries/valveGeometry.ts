import * as THREE from 'three';
import type { ValveKind } from '../../core/specs/valveKind';

export interface ValveShape {
  kind?: ValveKind;
  /** Extremos: bridados, entre bridas (wafer / lug), para soldar a tope o con encastre (socket / rosca) */
  ends?: 'flanged' | 'wafer' | 'buttweld' | 'socket';
  /** Diámetro y espesor de las bridas de la válvula (mm) */
  flangeDiameter?: number;
  flangeThickness?: number;
  /** Accionamiento: volante, palanca o ninguno (retención) */
  actuator?: 'wheel' | 'lever' | 'none';
  /** Altura del accionamiento desde el eje del caño (mm) */
  actuatorHeight?: number;
  /** Diámetro del volante (mm) */
  wheelDiameter?: number;
  /** Largo de la palanca (mm) */
  leverLength?: number;
}

export interface ValveGeometries {
  /** Cuerpo, extremos y bonete */
  body: THREE.BufferGeometry;
  /** Vástago y volante o palanca (null si no lleva) */
  trim: THREE.BufferGeometry | null;
}

/** Une varias geometrías en una sola (sin índices), recalculando normales */
export function mergeSimple(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const g of geometries) {
    const flat = g.index ? g.toNonIndexed() : g;
    const pos = flat.getAttribute('position');
    for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (flat !== g) flat.dispose();
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.computeVertexNormals();
  return out;
}

/** Cilindro a lo largo de Z entre z0 y z1 */
function alongZ(radius: number, z0: number, z1: number, segments = 28, radiusEnd = radius): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radiusEnd, radius, Math.max(0.1, z1 - z0), segments);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, (z0 + z1) / 2);
  return g;
}

/** Cilindro vertical (eje Y) entre y0 e y1, centrado en z */
function alongY(radius: number, y0: number, y1: number, z: number, segments = 20, radiusTop = radius): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radiusTop, radius, Math.max(0.1, y1 - y0), segments);
  g.translate(0, (y0 + y1) / 2, z);
  return g;
}

/**
 * Válvula con forma según su tipo y las medidas de la spec. Alineada a lo largo de Z:
 * z = 0 es la boca de entrada y z = faceToFace la de salida; el vástago sale hacia +Y.
 *
 * - Compuerta y globo: bonete alto con volante. Esférica y macho: cuerpo compacto con palanca.
 * - Mariposa: aro entre bridas con palanca. Retención: cuerpo con tapa, sin accionamiento.
 * - Extremos bridados con el diámetro y espesor reales; para soldar terminan en el diámetro del caño.
 */
export function createValveGeometries(outerDiameter: number, faceToFace: number, shape: ValveShape = {}): ValveGeometries {
  const L = Math.max(10, faceToFace);
  const rPipe = Math.max(2, outerDiameter / 2);
  const kind = shape.kind ?? 'other';
  const ends = shape.ends ?? 'flanged';
  const mid = L / 2;
  const body: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];

  const rFlange = Math.max(rPipe * 1.35, (shape.flangeDiameter ?? outerDiameter * 2) / 2);
  const tFlange = Math.min(L * 0.3, Math.max(4, shape.flangeThickness ?? Math.min(25, L * 0.12)));
  const actuator = shape.actuator ?? (kind === 'check' ? 'none' : kind === 'ball' || kind === 'plug' || kind === 'butterfly' ? 'lever' : 'wheel');
  const rStem = Math.max(3, rPipe * 0.16);

  if (ends === 'wafer') {
    // Mariposa wafer o lug: un aro del espesor de la válvula, apretado entre las dos bridas
    const rBody = Math.max(rPipe * 1.25, rFlange * (kind === 'butterfly' ? 0.82 : 0.9));
    body.push(alongZ(rBody, 0, L, 32));
    const top = Math.max(rBody * 1.35, shape.actuatorHeight ?? rBody * 2);
    body.push(alongY(rPipe * 0.42, rBody * 0.9, top * 0.78, mid, 16));
    if (actuator !== 'none') trim.push(alongY(rStem, top * 0.78, top, mid, 12));
    pushActuator(trim, actuator, top, mid, shape, rPipe, rStem);
    return { body: mergeSimple(body), trim: trim.length ? mergeSimple(trim) : null };
  }

  // Extremos
  let z0 = 0;
  let z1 = L;
  if (ends === 'flanged') {
    body.push(alongZ(rFlange, 0, tFlange, 32), alongZ(rFlange, L - tFlange, L, 32));
    z0 = tFlange;
    z1 = L - tFlange;
  } else if (ends === 'socket') {
    const collar = Math.min(L * 0.2, Math.max(8, rPipe * 0.7));
    body.push(alongZ(rPipe * 1.3, 0, collar, 24), alongZ(rPipe * 1.3, L - collar, L, 24));
    z0 = collar;
    z1 = L - collar;
  }
  // Cuello de paso entre los extremos
  const rNeck = rPipe * (ends === 'buttweld' ? 1.0 : 1.08);
  body.push(alongZ(rNeck, z0, z1, 24));

  // Cuerpo central según el tipo
  const span = Math.max(4, z1 - z0);
  const rBody = Math.min(rPipe * (kind === 'globe' ? 1.75 : kind === 'ball' ? 1.6 : 1.45), ends === 'flanged' ? rFlange * 0.95 : rPipe * 2);
  let bonnetBase = rBody;
  if (kind === 'ball' || kind === 'globe' || kind === 'other') {
    const sphere = new THREE.SphereGeometry(rBody, 24, 16);
    sphere.scale(1, 1, Math.min(1.25, (span * 0.5) / rBody));
    sphere.translate(0, 0, mid);
    body.push(sphere);
  } else if (kind === 'plug') {
    // Macho cónico: cuerpo vertical más ancho arriba
    body.push(alongY(rBody * 0.85, -rBody * 1.05, rBody * 1.15, mid, 24, rBody * 1.1));
    bonnetBase = rBody * 1.15;
  } else if (kind === 'check') {
    // Retención a clapeta: cuerpo abombado con la tapa arriba
    const sphere = new THREE.SphereGeometry(rBody, 24, 16);
    sphere.scale(1, 1.05, Math.min(1.5, (span * 0.5) / rBody));
    sphere.translate(0, rBody * 0.15, mid);
    body.push(sphere);
    body.push(alongY(rBody * 0.8, rBody * 0.9, rBody * 1.3, mid, 24));
    const capTop = rBody * 1.3 + Math.max(6, tFlange * 0.7);
    body.push(alongY(rBody * 0.98, rBody * 1.3, capTop, mid, 24));
    // Flecha de sentido de flujo sobre la tapa (de la entrada a la salida)
    const arrowLen = Math.min(span * 0.8, rBody * 1.5);
    const arrow = new THREE.ConeGeometry(rBody * 0.38, arrowLen, 4);
    arrow.rotateX(Math.PI / 2);
    arrow.scale(1, 0.35, 1);
    arrow.translate(0, capTop + rBody * 0.12, mid);
    body.push(arrow);
  } else {
    // Compuerta: cuerpo chato (cuña) que sube hacia el bonete
    const wedge = Math.min(span * 0.42, rBody * 0.75);
    const box = new THREE.CylinderGeometry(rBody * 0.9, rBody * 1.05, rBody * 2.3, 20);
    box.scale(1, 1, wedge / rBody);
    box.translate(0, rBody * 0.15, mid);
    body.push(box);
    bonnetBase = rBody * 1.3;
  }

  if (kind !== 'check') {
    const top = Math.max(bonnetBase * 1.5, shape.actuatorHeight ?? (actuator === 'wheel' ? rPipe * 6 : rPipe * 2.6));
    if (actuator === 'wheel') {
      // Bonete con su brida, yugo y vástago hasta el volante
      const bonnetTop = bonnetBase + (top - bonnetBase) * 0.45;
      body.push(alongY(rBody * 0.95, bonnetBase, bonnetBase + Math.max(5, tFlange * 0.6), mid, 20));
      body.push(alongY(rBody * 0.62, bonnetBase, bonnetTop, mid, 20, rBody * 0.42));
      trim.push(alongY(rStem, bonnetTop, top, mid, 12));
    } else {
      const neckTop = bonnetBase + (top - bonnetBase) * 0.6;
      body.push(alongY(rBody * 0.5, bonnetBase * 0.9, neckTop, mid, 16));
      if (actuator !== 'none') trim.push(alongY(rStem, neckTop, top, mid, 12));
    }
    pushActuator(trim, actuator, top, mid, shape, rPipe, rStem);
  }

  return { body: mergeSimple(body), trim: trim.length ? mergeSimple(trim) : null };
}

function pushActuator(
  trim: THREE.BufferGeometry[],
  actuator: 'wheel' | 'lever' | 'none',
  top: number,
  mid: number,
  shape: ValveShape,
  rPipe: number,
  rStem: number
): void {
  if (actuator === 'wheel') {
    const rWheel = Math.max(rPipe * 1.1, (shape.wheelDiameter ?? rPipe * 3.2) / 2);
    const tube = Math.max(3, rWheel * 0.07);
    const wheel = new THREE.TorusGeometry(rWheel, tube, 10, 32);
    wheel.rotateX(Math.PI / 2);
    wheel.translate(0, top, mid);
    trim.push(wheel);
    // Rayos del volante
    for (let i = 0; i < 2; i++) {
      const spoke = new THREE.BoxGeometry(rWheel * 2, tube * 1.2, tube * 1.2);
      spoke.rotateY((i * Math.PI) / 2);
      spoke.translate(0, top, mid);
      trim.push(spoke);
    }
  } else if (actuator === 'lever') {
    // Palanca a lo largo del caño (válvula abierta)
    const length = Math.max(rPipe * 2.5, shape.leverLength ?? rPipe * 5);
    const lever = new THREE.BoxGeometry(rStem * 2.4, rStem * 1.3, length);
    lever.translate(0, top, mid + length / 2 - rStem * 2);
    trim.push(lever);
  }
}

/**
 * Compatibilidad: válvula genérica bridada con volante, en una sola geometría.
 */
export function createValveGeometry(outerDiameter: number, _wallThickness: number, faceToFace: number): THREE.BufferGeometry {
  const { body, trim } = createValveGeometries(outerDiameter, Math.max(50, faceToFace), { kind: 'other', actuator: 'wheel' });
  return trim ? mergeSimple([body, trim]) : body;
}
