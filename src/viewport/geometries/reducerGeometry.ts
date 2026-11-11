import * as THREE from 'three';

/**
 * Reducción (ASME B16.9) concéntrica o excéntrica, alineada con el eje Z:
 * - z = 0: extremo de entrada (odStart), centrado en el origen;
 * - z = length: extremo de salida (odEnd), con el centro corrido `offset` mm hacia +X.
 *
 * Los diámetros van en el orden en que se recorre la pieza, así que sirve igual para reducir
 * (grande → chico) que para ampliar (chico → grande). Con `offset` igual a la diferencia de
 * radios queda la excéntrica real: una generatriz recta y paralela al eje.
 *
 * @param odStart Diámetro exterior en z = 0, en mm
 * @param odEnd Diámetro exterior en z = length, en mm
 * @param wallThickness Espesor de pared en mm
 * @param length Longitud cara a cara en mm
 * @param radialSegments Lados del polígono de cada extremo
 * @param offset Corrimiento del eje de salida hacia +X, en mm (0 = concéntrica)
 */
export function createReducerGeometry(
  odStart: number,
  odEnd: number,
  wallThickness: number,
  length: number,
  radialSegments: number = 32,
  offset: number = 0
): THREE.BufferGeometry {
  const wall = Math.max(0.1, wallThickness);
  const rOut1 = Math.max(1, odStart / 2);
  const rIn1 = Math.max(0.5, rOut1 - wall);
  const rOut2 = Math.max(1, odEnd / 2);
  const rIn2 = Math.max(0.5, rOut2 - wall);
  const L = Math.max(10, length);
  const n = Math.max(8, Math.round(radialSegments));

  const positions: number[] = [];
  const indices: number[] = [];

  /** Anillo de n + 1 vértices (el último repite el primero para cerrar la costura) */
  const ring = (radius: number, cx: number, z: number): number => {
    const first = positions.length / 3;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      positions.push(cx + radius * Math.cos(a), radius * Math.sin(a), z);
    }
    return first;
  };

  /** Banda entre dos anillos; `flip` invierte la cara visible */
  const band = (a: number, b: number, flip: boolean) => {
    for (let i = 0; i < n; i++) {
      const a0 = a + i;
      const a1 = a + i + 1;
      const b0 = b + i;
      const b1 = b + i + 1;
      if (flip) indices.push(a0, b0, a1, a1, b0, b1);
      else indices.push(a0, a1, b0, a1, b1, b0);
    }
  };

  // Cada superficie con sus propios anillos, para que las aristas de los extremos queden vivas
  band(ring(rOut1, 0, 0), ring(rOut2, offset, L), false); // pared exterior
  band(ring(rIn1, 0, 0), ring(rIn2, offset, L), true); // pared interior
  band(ring(rIn1, 0, 0), ring(rOut1, 0, 0), true); // corona de entrada
  band(ring(rIn2, offset, L), ring(rOut2, offset, L), false); // corona de salida

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
