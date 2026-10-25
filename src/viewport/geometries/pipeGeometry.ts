import * as THREE from 'three';

/**
 * Crea una BufferGeometry paramétrica para un caño tubular con espesor de pared real (OD e ID).
 * Se alinea a lo largo del eje Z local, desde z = 0 hasta z = length.
 *
 * @param outerDiameter Diámetro exterior físico (OD) en mm
 * @param wallThickness Espesor de pared físico en mm
 * @param length Longitud del tramo en mm
 * @param radialSegments Cantidad de divisiones radiales (por defecto 24)
 */
export function createPipeGeometry(
  outerDiameter: number,
  wallThickness: number,
  length: number,
  radialSegments: number = 24
): THREE.BufferGeometry {
  const rOut = Math.max(1, outerDiameter / 2);
  const rIn = Math.max(0.5, rOut - Math.max(0.1, wallThickness));
  const safeLength = Math.max(0.1, length);

  // Usamos una extrusión de forma anular paramétrica
  const shape = new THREE.Shape();
  // Círculo exterior (en sentido horario)
  shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);

  // Hueco interior (en sentido antihorario)
  const holePath = new THREE.Path();
  holePath.absarc(0, 0, rIn, 0, Math.PI * 2, true);
  shape.holes.push(holePath);

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    steps: 1,
    depth: safeLength,
    bevelEnabled: false,
    curveSegments: radialSegments
  };

  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.computeVertexNormals();
  return geometry;
}
