import * as THREE from 'three';

/**
 * Genera una BufferGeometry paramétrica para una válvula industrial (ASME B16.10).
 * Alineada a lo largo del eje Z:
 * - z = 0: cara de conexión de entrada
 * - z = faceToFace: cara de conexión de salida
 * - Cuello y volante de maniobra proyectados en el eje Y positivo.
 *
 * @param outerDiameter Diámetro exterior de la cañería en mm
 * @param wallThickness Espesor de pared en mm
 * @param faceToFace Longitud cara a cara en mm
 */
export function createValveGeometry(
  outerDiameter: number,
  _wallThickness: number,
  faceToFace: number
): THREE.BufferGeometry {
  const L = Math.max(50, faceToFace);
  const rPipe = Math.max(2, outerDiameter / 2);
  const rFlange = rPipe * 1.45;
  const flangeThick = Math.min(25, L * 0.18);
  const bodyRadius = rPipe * 1.35;

  const geometries: THREE.BufferGeometry[] = [];

  // 1. Brida / extremo de entrada (z = 0 a z = flangeThick)
  const geomIn = new THREE.CylinderGeometry(rFlange, rFlange, flangeThick, 24);
  geomIn.rotateX(Math.PI / 2);
  geomIn.translate(0, 0, flangeThick / 2);
  geometries.push(geomIn);

  // 2. Brida / extremo de salida (z = L - flangeThick a z = L)
  const geomOut = new THREE.CylinderGeometry(rFlange, rFlange, flangeThick, 24);
  geomOut.rotateX(Math.PI / 2);
  geomOut.translate(0, 0, L - flangeThick / 2);
  geometries.push(geomOut);

  // 3. Cuerpo central esférico/elipsoidal de la válvula
  const geomBody = new THREE.SphereGeometry(bodyRadius, 24, 16);
  geomBody.scale(1.0, 1.1, (L - 2 * flangeThick) / (2 * bodyRadius));
  geomBody.translate(0, 0, L / 2);
  geometries.push(geomBody);

  // 4. Bonete / vástago vertical (hacia +Y)
  const stemHeight = bodyRadius * 1.5;
  const stemRadius = rPipe * 0.35;
  const geomStem = new THREE.CylinderGeometry(stemRadius, stemRadius, stemHeight, 16);
  geomStem.translate(0, bodyRadius + stemHeight / 2, L / 2);
  geometries.push(geomStem);

  // 5. Volante de accionamiento (Handwheel)
  const wheelRadius = rPipe * 1.1;
  const wheelTube = Math.max(3, rPipe * 0.15);
  const geomWheel = new THREE.TorusGeometry(wheelRadius, wheelTube, 12, 24);
  geomWheel.rotateX(Math.PI / 2);
  geomWheel.translate(0, bodyRadius + stemHeight, L / 2);
  geometries.push(geomWheel);

  // Combinar todos los vértices en una única BufferGeometry
  const combinedPositions: number[] = [];
  const combinedNormals: number[] = [];
  const combinedIndices: number[] = [];

  let indexOffset = 0;
  for (const geom of geometries) {
    const pos = geom.getAttribute('position');
    const norm = geom.getAttribute('normal');
    const idx = geom.getIndex();

    for (let i = 0; i < pos.count; i++) {
      combinedPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (norm) {
        combinedNormals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      } else {
        combinedNormals.push(0, 1, 0);
      }
    }

    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        combinedIndices.push(idx.getX(i) + indexOffset);
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        combinedIndices.push(i + indexOffset);
      }
    }

    indexOffset += pos.count;
  }

  const finalGeom = new THREE.BufferGeometry();
  finalGeom.setAttribute('position', new THREE.Float32BufferAttribute(combinedPositions, 3));
  finalGeom.setAttribute('normal', new THREE.Float32BufferAttribute(combinedNormals, 3));
  finalGeom.setIndex(combinedIndices);
  finalGeom.computeVertexNormals();

  return finalGeom;
}
