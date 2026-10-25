import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  calculateElbowPlacement,
  validateOpposedPorts,
  validateMinimumNippleLength,
  EPSILON
} from '../elbowSolver';

describe('elbowSolver - Matemática Vectorial de Codos y Recortes', () => {
  it('GATE DE VALIDACIÓN 1: Intersección 1000mm en +X girando a +Y con codo de 76.2mm take-off produce corte neto de 923.8mm', () => {
    // Ramo entrante de 1000 mm a lo largo del eje +X
    const pStart = new THREE.Vector3(0, 0, 0);
    const vertex = new THREE.Vector3(1000, 0, 0);
    // Ramo saliente girando hacia +Y
    const pNext = new THREE.Vector3(1000, 1000, 0);
    const takeOff = 76.2; // Codo 2" Radio Largo ASME B16.9

    const result = calculateElbowPlacement(pStart, vertex, pNext, takeOff);

    // Verificación exacta de longitud neta de corte
    // 1000 mm - 76.2 mm = 923.8 mm
    expect(result.netLengthIncoming).toBeCloseTo(923.8, 4);
    expect(result.netLengthOutgoing).toBeCloseTo(923.8, 4);

    // Verificación de puntos de corte físico
    // Pcut1 = V - u1 * T = (1000 - 76.2, 0, 0) = (923.8, 0, 0)
    expect(result.cutPoint1.x).toBeCloseTo(923.8, 4);
    expect(result.cutPoint1.y).toBeCloseTo(0, 4);
    expect(result.cutPoint1.z).toBeCloseTo(0, 4);

    // Pcut2 = V + u2 * T = (1000, 0 + 76.2, 0) = (1000, 76.2, 0)
    expect(result.cutPoint2.x).toBeCloseTo(1000, 4);
    expect(result.cutPoint2.y).toBeCloseTo(76.2, 4);
    expect(result.cutPoint2.z).toBeCloseTo(0, 4);

    // Ángulo de deflexión
    expect(result.bendAngleDeg).toBeCloseTo(90.0, 4);

    // Verificar que el arco comience en cutPoint1 y termine exactamente en cutPoint2
    const firstPt = result.centerline[0];
    const lastPt = result.centerline[result.centerline.length - 1];
    expect(firstPt.distanceTo(result.cutPoint1)).toBeLessThan(0.01);
    expect(lastPt.distanceTo(result.cutPoint2)).toBeLessThan(0.01);
  });

  it('GATE DE VALIDACIÓN 2: La matriz de transformación produce base ortonormal estricta (|X|=|Y|=|Z|=1 y dot=0)', () => {
    const pStart = new THREE.Vector3(0, 0, 0);
    const vertex = new THREE.Vector3(1000, 0, 0);
    const pNext = new THREE.Vector3(1000, 1000, 0);
    const takeOff = 76.2;

    const result = calculateElbowPlacement(pStart, vertex, pNext, takeOff);

    // Magnitudes de los vectores de la base deben ser exactamente 1
    expect(result.basisX.length()).toBeCloseTo(1.0, 6);
    expect(result.basisY.length()).toBeCloseTo(1.0, 6);
    expect(result.basisZ.length()).toBeCloseTo(1.0, 6);

    // Productos punto entre pares ortogonales deben ser idénticamente 0
    expect(Math.abs(result.basisX.dot(result.basisY))).toBeLessThan(EPSILON);
    expect(Math.abs(result.basisX.dot(result.basisZ))).toBeLessThan(EPSILON);
    expect(Math.abs(result.basisY.dot(result.basisZ))).toBeLessThan(EPSILON);

    // Comprobar que las columnas de la matriz 4x4 coinciden con la base y la posición
    const elements = result.matrix.elements;
    // Columna 0: X
    const colX = new THREE.Vector3(elements[0], elements[1], elements[2]);
    // Columna 1: Y
    const colY = new THREE.Vector3(elements[4], elements[5], elements[6]);
    // Columna 2: Z
    const colZ = new THREE.Vector3(elements[8], elements[9], elements[10]);
    // Columna 3: Posición (Vértice)
    const colPos = new THREE.Vector3(elements[12], elements[13], elements[14]);

    expect(colX.distanceTo(result.basisX)).toBeLessThan(EPSILON);
    expect(colY.distanceTo(result.basisY)).toBeLessThan(EPSILON);
    expect(colZ.distanceTo(result.basisZ)).toBeLessThan(EPSILON);
    expect(colPos.distanceTo(vertex)).toBeLessThan(EPSILON);
  });

  it('Debe rechazar tramos menores que la cota de take-off del accesorio', () => {
    const pStart = new THREE.Vector3(0, 0, 0);
    const vertex = new THREE.Vector3(50, 0, 0); // 50 mm de largo
    const pNext = new THREE.Vector3(50, 500, 0);
    const takeOff = 76.2; // 76.2 mm > 50 mm

    expect(() => {
      calculateElbowPlacement(pStart, vertex, pNext, takeOff);
    }).toThrowError(/menor que el take-off del codo/);
  });

  it('Debe calcular correctamente un giro espacial 3D (+X hacia elevación +Z)', () => {
    const pStart = new THREE.Vector3(0, 0, 0);
    const vertex = new THREE.Vector3(1200, 0, 0);
    const pNext = new THREE.Vector3(1200, 0, 800);
    const takeOff = 76.2;

    const result = calculateElbowPlacement(pStart, vertex, pNext, takeOff);

    expect(result.netLengthIncoming).toBeCloseTo(1200 - 76.2, 4);
    expect(result.netLengthOutgoing).toBeCloseTo(800 - 76.2, 4);
    expect(result.bendAngleDeg).toBeCloseTo(90.0, 4);

    // Verificación de ortonormalidad en 3D
    expect(result.basisX.length()).toBeCloseTo(1.0, 6);
    expect(result.basisY.length()).toBeCloseTo(1.0, 6);
    expect(result.basisZ.length()).toBeCloseTo(1.0, 6);
    expect(Math.abs(result.basisX.dot(result.basisY))).toBeLessThan(EPSILON);
    expect(Math.abs(result.basisX.dot(result.basisZ))).toBeLessThan(EPSILON);
  });

  it('Debe validar correctamente puertos polares con normales opuestas', () => {
    const dirA = new THREE.Vector3(1, 0, 0); // Hacia +X
    const dirB = new THREE.Vector3(-1, 0, 0); // Hacia -X (opuesto)
    const dirNonOpposed = new THREE.Vector3(0, 1, 0); // Perpendicular

    expect(validateOpposedPorts(dirA, dirB)).toBe(true);
    expect(validateOpposedPorts(dirA, dirNonOpposed)).toBe(false);
  });

  it('Debe aplicar la regla de fabricación de niple mínimo (>= 50mm o 2xOD)', () => {
    // Para caño de 2" (OD = 60.3 mm), 2 * OD = 120.6 mm
    const od = 60.3;
    const rulePass = validateMinimumNippleLength(150, od);
    expect(rulePass.valid).toBe(true);

    const ruleFail = validateMinimumNippleLength(80, od);
    expect(ruleFail.valid).toBe(false);
    expect(ruleFail.minRequiredMm).toBeCloseTo(120.6, 1);
  });
});
