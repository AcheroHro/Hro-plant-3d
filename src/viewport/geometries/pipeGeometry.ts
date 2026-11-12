import * as THREE from 'three';

/**
 * Crea una BufferGeometry paramétrica para un caño tubular con espesor de pared real (OD e ID).
 * Se alinea a lo largo del eje Z local, desde z = 0 hasta z = length.
 *
 * Es un tubo indexado: pared exterior e interior con normales suaves y dos coronas planas en
 * las puntas. Con 32 divisiones son unos 260 vértices por caño (la extrusión que se usaba antes
 * llevaba más de 1100), lo que pesa mucho al armar y fusionar modelos grandes en el teléfono.
 *
 * @param outerDiameter Diámetro exterior físico (OD) en mm
 * @param wallThickness Espesor de pared físico en mm
 * @param length Longitud del tramo en mm
 * @param radialSegments Cantidad de divisiones radiales (por defecto 32)
 */
export function createPipeGeometry(
  outerDiameter: number,
  wallThickness: number,
  length: number,
  radialSegments: number = 32
): THREE.BufferGeometry {
  const rOut = Math.max(1, outerDiameter / 2);
  const rIn = Math.max(0.5, rOut - Math.max(0.1, wallThickness));
  const safeLength = Math.max(0.1, length);
  const n = Math.max(3, Math.round(radialSegments));

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const ring = (r: number, z: number, nx: (c: number) => number, ny: (s: number) => number, nz: number) => {
    const start = positions.length / 3;
    for (let j = 0; j <= n; j++) {
      const a = (j / n) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      positions.push(r * c, r * s, z);
      normals.push(nx(c), ny(s), nz);
    }
    return start;
  };

  // Paredes: exterior con la normal hacia afuera, interior hacia adentro
  const out0 = ring(rOut, 0, (c) => c, (s) => s, 0);
  const out1 = ring(rOut, safeLength, (c) => c, (s) => s, 0);
  const in0 = ring(rIn, 0, (c) => -c, (s) => -s, 0);
  const in1 = ring(rIn, safeLength, (c) => -c, (s) => -s, 0);
  for (let j = 0; j < n; j++) {
    indices.push(out0 + j, out0 + j + 1, out1 + j + 1, out0 + j, out1 + j + 1, out1 + j);
    indices.push(in0 + j, in1 + j + 1, in0 + j + 1, in0 + j, in1 + j, in1 + j + 1);
  }

  // Coronas planas en las dos puntas (vértices propios, para que la normal sea la del plano)
  const capOut0 = ring(rOut, 0, () => 0, () => 0, -1);
  const capIn0 = ring(rIn, 0, () => 0, () => 0, -1);
  const capOut1 = ring(rOut, safeLength, () => 0, () => 0, 1);
  const capIn1 = ring(rIn, safeLength, () => 0, () => 0, 1);
  for (let j = 0; j < n; j++) {
    indices.push(capOut0 + j, capIn0 + j, capIn0 + j + 1, capOut0 + j, capIn0 + j + 1, capOut0 + j + 1);
    indices.push(capOut1 + j, capOut1 + j + 1, capIn1 + j + 1, capOut1 + j, capIn1 + j + 1, capIn1 + j);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}
