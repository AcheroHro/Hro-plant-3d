import * as THREE from 'three';
import { createPipeGeometry } from './pipeGeometry';

/**
 * Crea una BufferGeometry paramétrica para una Te igual (Straight Tee ASME B16.9).
 * El recorrido principal (Run) se orienta a lo largo del eje Z, desde -runTakeOff hasta +runTakeOff.
 * La derivación (Branch) se proyecta a lo largo del eje Y positivo, desde 0 hasta branchTakeOff.
 *
 * @param outerDiameter Diámetro exterior en mm
 * @param wallThickness Espesor de pared en mm
 * @param runTakeOff Cota centro a cara de recorrido principal (C) en mm
 * @param branchTakeOff Cota centro a cara de derivación (M) en mm
 */
export function createTeeGeometry(
  outerDiameter: number,
  wallThickness: number,
  runTakeOff: number,
  branchTakeOff: number
): THREE.BufferGeometry {
  const rOut = Math.max(2, outerDiameter / 2);
  const totalRun = Math.max(20, runTakeOff * 2);
  const safeBranch = Math.max(10, branchTakeOff);

  // 1. Tramo principal (Run) a lo largo del eje Z desde -runTakeOff hasta +runTakeOff
  const geomRun = createPipeGeometry(outerDiameter, wallThickness, totalRun, 28);
  geomRun.translate(0, 0, -runTakeOff);

  // 2. Derivación (Branch) a lo largo del eje +Y desde 0 hasta +branchTakeOff
  const geomBranch = createPipeGeometry(outerDiameter, wallThickness, safeBranch, 28);
  geomBranch.rotateX(-Math.PI / 2);

  // 3. Cuerpo forjado central de intersección (crotch ASME B16.9) para unión sólida
  const geomHub = new THREE.SphereGeometry(rOut * 1.06, 20, 16);

  // 4. Biseles / collares en las 3 bocas para visual realista estilo AutoCAD Plant 3D
  const collarRun1 = new THREE.CylinderGeometry(rOut * 1.04, rOut * 1.04, Math.min(8, runTakeOff * 0.15), 24);
  collarRun1.rotateX(Math.PI / 2);
  collarRun1.translate(0, 0, -runTakeOff);

  const collarRun2 = new THREE.CylinderGeometry(rOut * 1.04, rOut * 1.04, Math.min(8, runTakeOff * 0.15), 24);
  collarRun2.rotateX(Math.PI / 2);
  collarRun2.translate(0, 0, runTakeOff);

  const collarBranch = new THREE.CylinderGeometry(rOut * 1.04, rOut * 1.04, Math.min(8, safeBranch * 0.15), 24);
  collarBranch.translate(0, safeBranch, 0);

  const parts = [geomRun, geomBranch, geomHub, collarRun1, collarRun2, collarBranch];

  const combinedPositions: number[] = [];
  const combinedNormals: number[] = [];
  const combinedIndices: number[] = [];

  let vertexOffset = 0;
  for (const part of parts) {
    const pos = part.getAttribute('position');
    const norm = part.getAttribute('normal');
    const idx = part.getIndex();

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
        combinedIndices.push(idx.getX(i) + vertexOffset);
      }
    } else {
      // IMPORTANTE: ExtrudeGeometry no tiene índice (idx === null),
      // por lo que debemos agregar los índices secuenciales de sus triángulos
      for (let i = 0; i < pos.count; i++) {
        combinedIndices.push(i + vertexOffset);
      }
    }

    vertexOffset += pos.count;
    part.dispose();
  }

  const combined = new THREE.BufferGeometry();
  combined.setAttribute('position', new THREE.Float32BufferAttribute(combinedPositions, 3));
  combined.setAttribute('normal', new THREE.Float32BufferAttribute(combinedNormals, 3));
  combined.setIndex(combinedIndices);
  combined.computeVertexNormals();

  return combined;
}
