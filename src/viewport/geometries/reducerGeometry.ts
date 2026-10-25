import * as THREE from 'three';

/**
 * Crea una BufferGeometry paramétrica para una Reducción Concéntrica (Concentric Reducer ASME B16.9).
 * Se alinea a lo largo del eje Z:
 * - z = 0: extremo mayor (OD1)
 * - z = length: extremo menor (OD2)
 *
 * @param od1 Diámetro exterior del extremo mayor en mm
 * @param od2 Diámetro exterior del extremo menor en mm
 * @param wallThickness Espesor de pared en mm
 * @param length Longitud cara a cara en mm
 */
export function createReducerGeometry(
  od1: number,
  od2: number,
  wallThickness: number,
  length: number,
  radialSegments: number = 32
): THREE.BufferGeometry {
  const rOut1 = Math.max(1, od1 / 2);
  const rIn1 = Math.max(0.5, rOut1 - Math.max(0.1, wallThickness));
  const rOut2 = Math.max(1, od2 / 2);
  const rIn2 = Math.max(0.5, rOut2 - Math.max(0.1, wallThickness));
  const L = Math.max(10, length);

  // Perfil para LatheGeometry (revolución)
  const points: THREE.Vector2[] = [
    new THREE.Vector2(rIn1, 0),
    new THREE.Vector2(rOut1, 0),
    new THREE.Vector2(rOut2, L),
    new THREE.Vector2(rIn2, L),
    new THREE.Vector2(rIn1, 0)
  ];

  const geometry = new THREE.LatheGeometry(points, radialSegments);
  // Alinear desde el eje Y hacia el eje +Z (desde z = 0 para OD1 hasta z = L para OD2)
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}
