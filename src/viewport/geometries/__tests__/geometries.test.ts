import { describe, it, expect } from 'vitest';
import { createPipeGeometry } from '../pipeGeometry';
import { createElbowGeometry } from '../elbowGeometry';
import { createFlangeGeometry } from '../flangeGeometry';
import { createTeeGeometry } from '../teeGeometry';
import { createReducerGeometry } from '../reducerGeometry';

describe('Geometrías Paramétricas Procedurales Three.js', () => {
  it('Debe generar la geometría paramétrica de un caño recto (createPipeGeometry)', () => {
    const geom = createPipeGeometry(60.3, 3.91, 1000, 24);
    expect(geom).toBeDefined();

    const pos = geom.getAttribute('position');
    const norm = geom.getAttribute('normal');
    expect(pos).toBeDefined();
    expect(norm).toBeDefined();
    expect(pos.count).toBeGreaterThan(50);

    geom.computeBoundingBox();
    const bbox = geom.boundingBox!;
    // El caño se extruye en Z de 0 a 1000 mm
    expect(bbox.max.z - bbox.min.z).toBeCloseTo(1000, 1);
    // El radio exterior es 60.3 / 2 = 30.15 mm
    expect(bbox.max.x).toBeCloseTo(30.15, 1);
    expect(bbox.min.x).toBeCloseTo(-30.15, 1);

    geom.dispose();
  });

  it('Debe generar la geometría toroidal de un codo 90° (createElbowGeometry)', () => {
    const geom = createElbowGeometry(60.3, 3.91, 76.2, 90, 16, 16);
    expect(geom).toBeDefined();

    const pos = geom.getAttribute('position');
    const index = geom.getIndex();
    expect(pos.count).toBeGreaterThan(100);
    expect(index).not.toBeNull();
    expect(index!.count).toBeGreaterThan(300);

    geom.dispose();
  });

  it('Debe generar la geometría de una brida WN (createFlangeGeometry)', () => {
    const geom = createFlangeGeometry(60.3, 152.4, 3.91, 63.5, 120.7, 4);
    expect(geom).toBeDefined();

    geom.computeBoundingBox();
    const bbox = geom.boundingBox!;
    // Longitud cara a cara 63.5 mm orientada a lo largo del eje Z
    expect(bbox.max.z - bbox.min.z).toBeCloseTo(63.5, 1);
    geom.dispose();
  });

  it('Debe generar la geometría combinada de una Te (createTeeGeometry)', () => {
    const geom = createTeeGeometry(60.3, 3.91, 63.5, 63.5);
    expect(geom).toBeDefined();

    const pos = geom.getAttribute('position');
    expect(pos.count).toBeGreaterThan(100);
    geom.dispose();
  });

  it('Debe generar la geometría de una reducción concéntrica (createReducerGeometry)', () => {
    const geom = createReducerGeometry(88.9, 60.3, 3.91, 88.9, 24);
    expect(geom).toBeDefined();

    geom.computeBoundingBox();
    const bbox = geom.boundingBox!;
    expect(bbox.max.z - bbox.min.z).toBeCloseTo(88.9, 1);
    geom.dispose();
  });

  it('Debe generar la geometría de una válvula con volante (createValveGeometry)', async () => {
    const { createValveGeometry } = await import('../valveGeometry');
    const geom = createValveGeometry(60.3, 3.91, 178);
    expect(geom).toBeDefined();

    geom.computeBoundingBox();
    const bbox = geom.boundingBox!;
    expect(bbox.max.z - bbox.min.z).toBeCloseTo(178, 1);
    geom.dispose();
  });

  it('Debe generar la geometría de una tapa / casquete (createCapGeometry)', async () => {
    const { createCapGeometry } = await import('../capGeometry');
    const geom = createCapGeometry(60.3, 3.91, 38.1);
    expect(geom).toBeDefined();

    geom.computeBoundingBox();
    const bbox = geom.boundingBox!;
    expect(bbox.max.z - bbox.min.z).toBeCloseTo(38.1, 1);
    geom.dispose();
  });
});
