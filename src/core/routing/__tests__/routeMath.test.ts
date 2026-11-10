import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applySlope, centerlineForElevation, deflect, elbowForBend, planOffset, trimmedTakeOff } from '../routeMath';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('Cálculos de trazado (etapa 4)', () => {
  it('gira el ángulo pedido hacia el eje elegido', () => {
    const d = deflect(v(1, 0, 0), v(0, 1, 0), 30);
    expect(d.x).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    expect(d.y).toBeCloseTo(0.5, 6);
    // Desde una boca en diagonal, 90° sale perpendicular a la boca y no por el eje
    const diag = v(1, 1, 0).normalize();
    expect(deflect(diag, v(1, 0, 0), 90).dot(diag)).toBeCloseTo(0, 6);
    // Eje paralelo a la boca: tramo recto
    expect(deflect(v(1, 0, 0), v(1, 0, 0), 45).x).toBeCloseTo(1, 6);
  });

  it('la pendiente inclina solo los tramos horizontales', () => {
    const d = applySlope(v(0, 1, 0), -1);
    expect(d.z / d.y).toBeCloseTo(-0.01, 6);
    expect(applySlope(v(0, 0, 1), 2).z).toBeCloseTo(1, 6);
    expect(applySlope(v(1, 0, 0), 0).z).toBe(0);
  });

  it('elige codo estándar dentro de tolerancia y recortado fuera', () => {
    expect(elbowForBend(90.6)).toEqual({ baseAngle: 90, trimmed: false });
    expect(elbowForBend(44)).toEqual({ baseAngle: 45, trimmed: false });
    expect(elbowForBend(30)).toEqual({ baseAngle: 45, trimmed: true });
    expect(elbowForBend(30, false)).toEqual({ baseAngle: 90, trimmed: true });
    expect(elbowForBend(60)).toEqual({ baseAngle: 90, trimmed: true });
    expect(elbowForBend(120)).toBeNull();
    // Codo LR de 2" (radio 76,2): a 90° el centro a cara es el radio
    expect(trimmedTakeOff(76.2, 90)).toBeCloseTo(76.2, 6);
    expect(trimmedTakeOff(76.2, 45)).toBeCloseTo(31.56, 2);
  });

  it('desvío rodado a 45°: el diagonal es corrimiento por 1,414', () => {
    const plan = planOffset(v(1, 0, 0), v(0, 300, 400), 45, 35, 120);
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.offset).toBeCloseTo(500, 6);
    expect(plan.travelLength).toBeCloseTo(500 * Math.SQRT2, 6);
    expect(plan.advance).toBeCloseTo(500, 6);
    const end = plan.travelDir.clone().multiplyScalar(plan.travelLength);
    expect(end.x).toBeCloseTo(500, 6);
    expect(end.y).toBeCloseTo(300, 6);
    expect(end.z).toBeCloseTo(400, 6);
  });

  it('rechaza un desvío donde no entran los codos', () => {
    const plan = planOffset(v(1, 0, 0), v(0, 100, 0), 45, 35, 120);
    expect('error' in plan && plan.error).toContain('135 mm');
    const ok = planOffset(v(1, 0, 0), v(0, 400, 0), 90, 76.2, 120);
    expect('error' in ok).toBe(false);
    if (!('error' in ok)) expect(ok.advance).toBe(0);
  });

  it('elevación por fondo o lomo de caño', () => {
    expect(centerlineForElevation(1000, 'BOP', 60.3)).toBeCloseTo(1030.15, 6);
    expect(centerlineForElevation(1000, 'TOP', 60.3)).toBeCloseTo(969.85, 6);
    expect(centerlineForElevation(1000, 'CL', 60.3)).toBe(1000);
  });
});
