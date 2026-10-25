import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { distanceBetweenSegments, detectPipingCollisions } from '../collisionDetector';
import { PipingGraph } from '../../../core/graph/PipingGraph';
import { SpecFitting } from '../../../types/piping';

describe('collisionDetector - Detección de Interferencias Espaciales', () => {
  it('Debe calcular la distancia exacta entre dos segmentos ortogonales que se cruzan en el espacio', () => {
    // Segmento 1 sobre el eje X de (0, 0, 0) a (1000, 0, 0)
    const a1 = new THREE.Vector3(0, 0, 0);
    const b1 = new THREE.Vector3(1000, 0, 0);

    // Segmento 2 sobre el eje Y a una altura Z = 50 mm, de (500, -500, 50) a (500, 500, 50)
    const a2 = new THREE.Vector3(500, -500, 50);
    const b2 = new THREE.Vector3(500, 500, 50);

    const dist = distanceBetweenSegments(a1, b1, a2, b2);
    // La distancia mínima debe ser exactamente 50 mm
    expect(dist).toBeCloseTo(50, 4);
  });

  it('Debe detectar colisión física cuando la distancia entre cañerías es menor a (OD1 + OD2) / 2', () => {
    const graph = new PipingGraph();

    const spec2: SpecFitting = {
      pnpid: 1005,
      partType: 'PIPE',
      specCode: 'CS150',
      shortDescription: 'PIPE 2"',
      nominalDiameter: 2,
      outerDiameter: 60.3,
      wallThickness: 3.91,
      schedule: 'SCH 40',
      endType: 'BW'
    };

    // Caño 1: de (0, 500, 0) a (1000, 500, 0)
    graph.addPipe(new THREE.Vector3(0, 500, 0), new THREE.Vector3(1000, 500, 0), spec2);

    // Caño 2 cruzado: de (500, 0, 40) a (500, 1000, 40)
    // Distancia entre ejes = 40 mm. (OD1 + OD2) / 2 = (60.3 + 60.3) / 2 = 60.3 mm.
    // 40 < 60.3 => ¡COLISIÓN FÍSICA DETECTADA!
    graph.addPipe(new THREE.Vector3(500, 0, 40), new THREE.Vector3(500, 1000, 40), spec2);

    const result = detectPipingCollisions(graph);
    expect(result.hasCollision).toBe(true);
    expect(result.collidingComponentIds.size).toBe(2);
  });

  it('No debe reportar colisión si las cañerías tienen separación suficiente', () => {
    const graph = new PipingGraph();

    const spec2: SpecFitting = {
      pnpid: 1005,
      partType: 'PIPE',
      specCode: 'CS150',
      shortDescription: 'PIPE 2"',
      nominalDiameter: 2,
      outerDiameter: 60.3,
      wallThickness: 3.91,
      schedule: 'SCH 40',
      endType: 'BW'
    };

    // Caño 1 a Z = 0
    graph.addPipe(new THREE.Vector3(0, 500, 0), new THREE.Vector3(1000, 500, 0), spec2);

    // Caño 2 a Z = 200 mm (200 mm > 60.3 mm)
    graph.addPipe(new THREE.Vector3(500, 0, 200), new THREE.Vector3(500, 1000, 200), spec2);

    const result = detectPipingCollisions(graph);
    expect(result.hasCollision).toBe(false);
    expect(result.collidingComponentIds.size).toBe(0);
  });
});
