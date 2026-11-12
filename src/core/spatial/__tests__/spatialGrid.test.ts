import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GridBox, overlappingPairs, suggestCellSize } from '../spatialGrid';
import { PipingGraph } from '../../graph/PipingGraph';
import { detectPipingCollisions, distanceBetweenSegments } from '../../../viewport/collision/collisionDetector';
import { SpecFitting } from '../../../types/piping';

/** Generador pseudoaleatorio fijo, para que el test dé siempre lo mismo */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const touch = (a: GridBox, b: GridBox) =>
  [0, 1, 2].every((k) => a.min[k] <= b.max[k] && b.min[k] <= a.max[k]);

function bruteForce(boxes: GridBox[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (touch(boxes[i], boxes[j])) out.push([i, j]);
  return out;
}

const pipeSpec = (nd: number, od: number): SpecFitting => ({
  pnpid: 1000 + nd,
  partType: 'PIPE',
  specCode: 'CS150',
  shortDescription: `PIPE ${nd}"`,
  nominalDiameter: nd,
  outerDiameter: od,
  wallThickness: 4,
  schedule: 'SCH 40',
  endType: 'BW'
});

describe('Grilla espacial', () => {
  it('da los mismos pares que comparar todas contra todas, con cajas chicas, largas y enormes', () => {
    const r = rng(7);
    const boxes: GridBox[] = [];
    for (let i = 0; i < 400; i++) {
      const x = r() * 20000 - 10000;
      const y = r() * 20000 - 10000;
      const z = r() * 6000;
      // Algunas largas en un eje (caños) y unas pocas enormes en diagonal
      const huge = i % 97 === 0;
      const axis = Math.floor(r() * 3);
      const len = huge ? 30000 : 200 + r() * 5000;
      const size = [80, 80, 80];
      if (huge) size.fill(len);
      else size[axis] = len;
      boxes.push({ id: String(i), min: [x, y, z], max: [x + size[0], y + size[1], z + size[2]] });
    }
    for (const cell of [suggestCellSize(boxes), 300, 5000]) {
      expect(overlappingPairs(boxes, cell)).toEqual(bruteForce(boxes));
    }
  });

  it('cajas que solo se tocan en una cara cuentan como par; separadas por 1 mm no', () => {
    const a: GridBox = { id: 'a', min: [0, 0, 0], max: [1000, 100, 100] };
    const b: GridBox = { id: 'b', min: [1000, 0, 0], max: [2000, 100, 100] };
    const c: GridBox = { id: 'c', min: [2001, 0, 0], max: [3000, 100, 100] };
    expect(overlappingPairs([a, b, c], 1000)).toEqual([[0, 1]]);
    expect(overlappingPairs([], 1000)).toEqual([]);
  });

  it('la revisión de choques encuentra los mismos choques que la comparación completa, y rápido con 3000 caños', () => {
    const r = rng(11);
    const graph = new PipingGraph();
    const sizes: Array<[number, number]> = [
      [2, 60.3],
      [4, 114.3],
      [8, 219.1]
    ];
    for (let i = 0; i < 3000; i++) {
      const [nd, od] = sizes[i % 3];
      const a = new THREE.Vector3(Math.round(r() * 60000), Math.round(r() * 60000), Math.round(r() * 12000));
      const dir = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)][Math.floor(r() * 3)];
      const b = a.clone().addScaledVector(dir, 500 + Math.round(r() * 5500));
      graph.addPipe(a, b, pipeSpec(nd, od));
    }

    const t0 = performance.now();
    const result = detectPipingCollisions(graph);
    const elapsed = performance.now() - t0;

    // Comparación completa, como era antes
    const pipes = [...graph.components.values()];
    const expected = new Set<string>();
    for (let i = 0; i < pipes.length; i++)
      for (let j = i + 1; j < pipes.length; j++) {
        const A = pipes[i];
        const B = pipes[j];
        const d = distanceBetweenSegments(A.centerline[0], A.centerline[1], B.centerline[0], B.centerline[1]);
        if (d < (A.parameters.outerDiameter + B.parameters.outerDiameter) / 2 - 1e-3) {
          expected.add(A.id);
          expected.add(B.id);
        }
      }

    expect(expected.size).toBeGreaterThan(0);
    expect([...result.collidingComponentIds].sort()).toEqual([...expected].sort());
    expect(elapsed).toBeLessThan(1000);
  });
});
