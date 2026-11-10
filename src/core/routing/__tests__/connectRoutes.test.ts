import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { planConnectionRoutes } from '../connectRoutes';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const OPTS = { takeOff: 76, minNipple: 120 };

describe('planConnectionRoutes', () => {
  it('une con un solo caño dos bocas enfrentadas en línea', () => {
    const routes = planConnectionRoutes(v(0, 0, 0), v(1, 0, 0), v(1500, 0, 0), v(-1, 0, 0), OPTS);
    expect(routes[0].bends).toBe(0);
    expect(routes[0].legs).toHaveLength(1);
    expect(routes[0].totalLength).toBeCloseTo(1500);
  });

  it('arma una L cuando las bocas están a 90°', () => {
    // Origen mira a +X; destino en (1000, 800) mira a -Y: llega subiendo por +Y
    const routes = planConnectionRoutes(v(0, 0, 0), v(1, 0, 0), v(1000, 800, 0), v(0, -1, 0), OPTS);
    expect(routes[0].bends).toBe(1);
    expect(routes[0].points.map((p) => p.toArray())).toEqual([
      [0, 0, 0],
      [1000, 0, 0],
      [1000, 800, 0]
    ]);
  });

  it('ofrece varias Z para bocas paralelas desplazadas, la más corta primero', () => {
    const routes = planConnectionRoutes(v(0, 0, 0), v(1, 0, 0), v(2000, 600, 0), v(-1, 0, 0), OPTS);
    expect(routes.length).toBeGreaterThan(1);
    for (const r of routes) {
      expect(r.bends).toBe(2);
      expect(r.points[r.points.length - 1].distanceTo(v(2000, 600, 0))).toBeLessThan(0.5);
      // Sale recto del origen y entra recto al destino
      expect(r.legs[0].dir.x).toBe(1);
      expect(r.legs[r.legs.length - 1].dir.x).toBe(1);
    }
  });

  it('resuelve un desvío en tres ejes', () => {
    const routes = planConnectionRoutes(v(0, 0, 0), v(1, 0, 0), v(1500, 900, 700), v(0, 0, 1), OPTS);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.legs[0].dir.x).toBe(1);
      expect(r.legs[r.legs.length - 1].dir.z).toBe(-1);
      for (let i = 1; i < r.legs.length; i++) expect(r.legs[i].dir.dot(r.legs[i - 1].dir)).toBeCloseTo(0);
    }
  });

  it('no propone nada si los tramos no alojan los codos o las bocas no son ortogonales', () => {
    // Desplazamiento lateral de 100 mm: no entran dos codos con su niple
    expect(planConnectionRoutes(v(0, 0, 0), v(1, 0, 0), v(2000, 100, 0), v(-1, 0, 0), OPTS)).toEqual([]);
    // Boca a 45°
    expect(planConnectionRoutes(v(0, 0, 0), v(1, 1, 0), v(2000, 600, 0), v(-1, 0, 0), OPTS)).toEqual([]);
    // Destino detrás del origen y mirando igual: habría que volver sobre el mismo eje
    expect(planConnectionRoutes(v(0, 0, 0), v(1, 0, 0), v(-1000, 0, 0), v(1, 0, 0), OPTS)).toEqual([]);
  });
});
