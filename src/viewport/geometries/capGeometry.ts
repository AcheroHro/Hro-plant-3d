import * as THREE from 'three';

/**
 * Genera una BufferGeometry paramétrica para un casquete / tapa elíptica (ASME B16.9 Cap).
 * Alineada a lo largo del eje Z:
 * - z = 0: extremo biselado para soldar a tope (diámetro exterior coincidente)
 * - z = faceToFace: casquete elíptico cerrado
 *
 * @param outerDiameter Diámetro exterior de la cañería en mm
 * @param wallThickness Espesor de pared en mm
 * @param faceToFace Altura total de la tapa en mm
 */
export function createCapGeometry(
  outerDiameter: number,
  wallThickness: number,
  faceToFace: number
): THREE.BufferGeometry {
  const rOD = Math.max(2, outerDiameter / 2);
  const rID = Math.max(1, rOD - Math.max(0.1, wallThickness));
  const H = Math.max(15, faceToFace);
  const straightLength = Math.max(5, H * 0.35);
  const domeHeight = H - straightLength;

  // Perfil de revolución para LatheGeometry (radio, z)
  const points: THREE.Vector2[] = [];

  // 1. Interior del tramo recto
  points.push(new THREE.Vector2(rID, 0));
  // 2. Extremo de soldadura
  points.push(new THREE.Vector2(rOD, 0));
  // 3. Tramo recto cilíndrico
  points.push(new THREE.Vector2(rOD, straightLength));

  // 4. Domo elipsoidal exterior
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const theta = (i / steps) * (Math.PI / 2);
    const r = rOD * Math.cos(theta);
    const z = straightLength + domeHeight * Math.sin(theta);
    points.push(new THREE.Vector2(Math.max(0, r), z));
  }

  const geometry = new THREE.LatheGeometry(points, 24);
  // Alinear desde el eje Y hacia el eje +Z (desde z = 0 soldadura a z = faceToFace domo cerrado)
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}
