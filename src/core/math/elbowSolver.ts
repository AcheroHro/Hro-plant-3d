import * as THREE from 'three';
import { ElbowPlacementResult } from '../../types/piping';

/**
 * Tolerancia numérica para cálculos de punto flotante en mm
 */
export const EPSILON = 1e-6;

/**
 * Calcula la colocación matemática exacta de un codo en una intersección de cañerías.
 *
 * Realiza el cálculo en milímetros (mm) de doble precisión, determina los puntos
 * de corte físico, calcula las longitudes netas y genera la matriz 4x4 ortonormal (TRS)
 * y el cuaternión correspondiente libre de gimbal lock.
 *
 * @param pStart Punto de inicio del tramo entrante (Vector3 en mm)
 * @param vertex Vértice de intersección o punto de cambio de dirección (Vector3 en mm)
 * @param pNext Punto de destino del tramo saliente (Vector3 en mm)
 * @param takeOff Cota de despegue (centro a cara T) del codo en mm
 * @param radius Radio de curvatura al eje del codo en mm (opcional; si no se provee se usa takeOff para codos de 90°)
 * @returns Resultado completo de colocación y recorte
 */
export function calculateElbowPlacement(
  pStart: THREE.Vector3,
  vertex: THREE.Vector3,
  pNext: THREE.Vector3,
  takeOff: number,
  radius?: number
): ElbowPlacementResult {
  // 1. Vector entrante: desde pStart hacia vertex
  const vIn = new THREE.Vector3().subVectors(vertex, pStart);
  const lGrossIn = vIn.length();
  if (lGrossIn < EPSILON) {
    throw new Error('El tramo entrante tiene longitud cero: pStart y vertex coinciden.');
  }
  const uIn = vIn.clone().normalize();

  // 2. Vector saliente: desde vertex hacia pNext
  const vOut = new THREE.Vector3().subVectors(pNext, vertex);
  const lGrossOut = vOut.length();
  if (lGrossOut < EPSILON) {
    throw new Error('El tramo saliente tiene longitud cero: vertex y pNext coinciden.');
  }
  const uOut = vOut.clone().normalize();

  // 3. Validación de tramos colineales
  const dotProduct = THREE.MathUtils.clamp(uIn.dot(uOut), -1, 1);
  if (Math.abs(dotProduct - 1) < EPSILON) {
    throw new Error('Los tramos entrante y saliente son colineales en la misma dirección (0°); no se requiere codo.');
  }
  if (Math.abs(dotProduct + 1) < EPSILON) {
    throw new Error('Los tramos entrante y saliente son colineales en sentido opuesto (180°); no es una curva válida para codo estándar.');
  }

  // 4. Ángulo de deflexión / giro (en radianes y grados)
  // uIn apunta hacia adelante; la deflexión respecto a la recta es el ángulo entre uIn y uOut
  const bendAngleRad = Math.acos(dotProduct);
  const bendAngleDeg = THREE.MathUtils.radToDeg(bendAngleRad);

  // 5. Validación de longitud física vs. take-off
  if (lGrossIn < takeOff - EPSILON) {
    throw new Error(
      `El tramo de cañería entrante (${lGrossIn.toFixed(2)} mm) es menor que el take-off del codo (${takeOff.toFixed(2)} mm).`
    );
  }
  if (lGrossOut < takeOff - EPSILON) {
    throw new Error(
      `El tramo de cañería saliente (${lGrossOut.toFixed(2)} mm) es menor que el take-off del codo (${takeOff.toFixed(2)} mm).`
    );
  }

  // 6. Puntos de corte físico de cañería
  // Pcut1 = V - uIn * T
  const cutPoint1 = vertex.clone().sub(uIn.clone().multiplyScalar(takeOff));
  // Pcut2 = V + uOut * T
  const cutPoint2 = vertex.clone().add(uOut.clone().multiplyScalar(takeOff));

  // 7. Longitudes netas de corte
  const netLengthIncoming = lGrossIn - takeOff;
  const netLengthOutgoing = lGrossOut - takeOff;

  // 8. Construcción de la base ortonormal estricta derecha (det = +1)
  // basisX = -uIn (apunta desde el vértice hacia la cañería entrante)
  const basisX = uIn.clone().negate().normalize();

  // basisY apunta en la dirección de la cañería saliente (uOut) en el plano de giro
  const dotX = uOut.dot(basisX);
  const basisY = new THREE.Vector3().copy(uOut).addScaledVector(basisX, -dotX).normalize();

  // basisZ = basisX x basisY (garantiza base ortonormal dextrógira sin reflexión)
  const basisZ = new THREE.Vector3().crossVectors(basisX, basisY).normalize();

  // 9. Matriz de transformación 4x4 ortonormal (TRS)
  const matrix = new THREE.Matrix4();
  matrix.makeBasis(basisX, basisY, basisZ);
  matrix.setPosition(vertex);

  // 10. Cuaternión de orientación libre de gimbal lock
  const rotation = new THREE.Quaternion();
  rotation.setFromRotationMatrix(matrix);

  // 11. Centro del arco del codo y puntos de la línea central (Centerline)
  const effectiveRadius = radius !== undefined && radius > 0 ? radius : takeOff;
  // Desde cutPoint1, el vector hacia el centro de curvatura es perpendicular a uIn, apuntando a basisY
  const arcCenter = cutPoint1.clone().add(basisY.clone().multiplyScalar(effectiveRadius));

  // Discretizar la línea central del codo para representación y cálculo de recorrido
  const centerlineSegments = 16;
  const centerline: THREE.Vector3[] = [];
  
  // Vector desde el centro del arco a cutPoint1
  const vArcStart = cutPoint1.clone().sub(arcCenter);
  // Ángulo de apertura del arco
  for (let i = 0; i <= centerlineSegments; i++) {
    const t = i / centerlineSegments;
    const currentAngle = t * bendAngleRad;
    // Rotar vArcStart alrededor de basisZ en dirección a cutPoint2
    const pt = vArcStart.clone().applyAxisAngle(basisZ, -currentAngle).add(arcCenter);
    centerline.push(pt);
  }

  return {
    cutPoint1,
    cutPoint2,
    netLengthIncoming,
    netLengthOutgoing,
    matrix,
    rotation,
    vertex: vertex.clone(),
    arcCenter,
    centerline,
    bendAngleDeg,
    basisX,
    basisY,
    basisZ
  };
}

/**
 * Valida la alineación coaxial de dos puertos para una unión física.
 * Para que dos puertos se unan correctamente, sus normales exteriores deben ser opuestas:
 * u1 · u2 ≈ -1 (dentro de la tolerancia angular especificada).
 */
export function validateOpposedPorts(
  dirA: THREE.Vector3,
  dirB: THREE.Vector3,
  toleranceDeg: number = 0.5
): boolean {
  const normA = dirA.clone().normalize();
  const normB = dirB.clone().normalize();
  const dot = normA.dot(normB);
  const minDot = -Math.cos(THREE.MathUtils.degToRad(toleranceDeg));
  return dot <= minDot;
}

/**
 * Regla de fabricación: Valida la longitud mínima de un niple de cañería recta.
 * No se permiten niples menores a 50 mm o a 2 veces el diámetro exterior (lo que resulte mayor).
 */
export function validateMinimumNippleLength(
  lengthMm: number,
  outerDiameterMm: number
): { valid: boolean; minRequiredMm: number; message: string } {
  const minRequiredMm = Math.max(50, 2 * outerDiameterMm);
  const valid = lengthMm >= minRequiredMm - EPSILON;
  return {
    valid,
    minRequiredMm,
    message: valid
      ? `Longitud de niple de ${lengthMm.toFixed(1)} mm cumple con la norma (mínimo requerido: ${minRequiredMm.toFixed(1)} mm).`
      : `Longitud de niple de ${lengthMm.toFixed(1)} mm rechazada. El estándar exige un mínimo de ${minRequiredMm.toFixed(1)} mm (máximo entre 50 mm y 2×OD).`
  };
}
