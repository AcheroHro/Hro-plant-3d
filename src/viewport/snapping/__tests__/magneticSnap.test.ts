import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { findScreenMagneticSnap } from '../magneticSnap';
import { Port } from '../../../types/piping';

describe('magneticSnap - Snapping Magnético en Espacio de Pantalla', () => {
  it('Debe anclar un puerto cuando su proyección cae a menos de 35px del centro de pantalla', () => {
    // Configurar cámara mirando hacia el origen
    const camera = new THREE.PerspectiveCamera(45, 1, 10, 10000);
    camera.position.set(0, 0, 1000);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    const screenWidth = 800;
    const screenHeight = 800;

    // Puerto ubicado exactamente en el origen (centro de pantalla = 400, 400)
    const centerPort: Port = {
      id: 'port-center',
      componentId: 'comp-1',
      index: 1,
      position: new THREE.Vector3(0, 0, 0),
      direction: new THREE.Vector3(0, 0, 1),
      nominalDiameter: 2,
      outerDiameter: 60.3,
      wallThickness: 3.91,
      schedule: 'SCH 40',
      endType: 'BW'
    };

    const snapResult = findScreenMagneticSnap([centerPort], camera, screenWidth, screenHeight, 35);

    expect(snapResult.isSnapped).toBe(true);
    expect(snapResult.snappedPort?.id).toBe('port-center');
    expect(snapResult.screenDistancePx).toBeCloseTo(0, 1);
  });

  it('No debe anclar si el puerto está fuera del radio de 35px de la retícula', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 10, 10000);
    camera.position.set(0, 0, 1000);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    const screenWidth = 800;
    const screenHeight = 800;

    // Puerto alejado del centro
    const farPort: Port = {
      id: 'port-far',
      componentId: 'comp-2',
      index: 1,
      position: new THREE.Vector3(300, 300, 0),
      direction: new THREE.Vector3(0, 0, 1),
      nominalDiameter: 2,
      outerDiameter: 60.3,
      wallThickness: 3.91,
      schedule: 'SCH 40',
      endType: 'BW'
    };

    const snapResult = findScreenMagneticSnap([farPort], camera, screenWidth, screenHeight, 35);

    expect(snapResult.isSnapped).toBe(false);
    expect(snapResult.snappedPort).toBeNull();
    expect(snapResult.screenDistancePx).toBeGreaterThan(35);
  });
});
