import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createEquipmentFromPreset, EquipmentKind, nozzleWorldPose } from '../equipmentCatalog';
import { buildEquipmentGroup } from '../../../viewport/equipmentMesh';
import { buildPlantCompassGroup } from '../../../viewport/plantCompass';
import { buildInsulationGroup } from '../../../viewport/insulationMesh';
import { PipingGraph } from '../../graph/PipingGraph';
import { SpecFitting } from '../../../types/piping';

const PIPE_SPEC: SpecFitting = {
  pnpid: 1,
  partType: 'PIPE',
  specCode: 'CS150',
  shortDescription: 'Caño 4" SCH 40',
  nominalDiameter: 4,
  outerDiameter: 114.3,
  wallThickness: 6.02,
  schedule: 'SCH 40',
  endType: 'BW'
};

describe('Equipos, boquillas, pipe racks, aislación y compás circular Plant 3D', () => {
  it('calcula correctamente la posición y dirección mundial de las boquillas al trasladar y rotar', () => {
    const tank = createEquipmentFromPreset('vertical_tank', 0, [1000, 500, 0], 90);
    const n1 = tank.nozzles[0]; // localPos [820, 0, 2350], localDir [1, 0, 0]
    const pose = nozzleWorldPose(tank, n1);

    // Rotar +90° alrededor de Z lleva +X a +Y: (820, 0) -> (0, 820)
    expect(pose.position.x).toBeCloseTo(1000, 3);
    expect(pose.position.y).toBeCloseTo(1320, 3);
    expect(pose.position.z).toBeCloseTo(2350, 3);
    expect(pose.direction.x).toBeCloseTo(0, 5);
    expect(pose.direction.y).toBeCloseTo(1, 5);
    expect(pose.direction.z).toBeCloseTo(0, 5);
  });

  it('construye mallas 3D con zonas táctiles nozzleRef para los 3 tipos de equipo y aplica estilos visuales', () => {
    const kinds: EquipmentKind[] = ['vertical_tank', 'horizontal_vessel', 'centrifugal_pump'];
    for (const kind of kinds) {
      const eq = createEquipmentFromPreset(kind, 0, [0, 0, 0], 0);
      const group = buildEquipmentGroup(eq, 'xray');
      const nozzleIds = new Set<string>();
      let hasTransparentMat = false;
      group.traverse((obj) => {
        if (obj.userData?.nozzleRef?.nozzleId) {
          nozzleIds.add(obj.userData.nozzleRef.nozzleId);
        }
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
          if (obj.material.transparent && obj.material.opacity < 1) hasTransparentMat = true;
        }
      });
      expect(nozzleIds.size).toBe(eq.nozzles.length);
      expect(hasTransparentMat).toBe(true);
    }
  });

  it('construye el Pipe Rack estructural con niveles BOP tocables en sus vigas transversales', () => {
    const rack = createEquipmentFromPreset('pipe_rack', 0, [0, 0, 200], 0);
    const group = buildEquipmentGroup(rack, 'shaded');
    const rackLevels = new Set<number>();
    group.traverse((obj) => {
      if (typeof obj.userData?.rackLevelMm === 'number') {
        rackLevels.add(obj.userData.rackLevelMm);
      }
    });
    expect(Array.from(rackLevels).sort((a, b) => a - b)).toEqual([3200, 4400]);
  });

  it('genera envolvente translúcida de aislación térmica respetando el espesor y las piezas visibles', () => {
    const graph = new PipingGraph();
    const p1 = graph.addPipe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1000, 0, 0), PIPE_SPEC);
    graph.addPipe(new THREE.Vector3(0, 500, 0), new THREE.Vector3(1000, 500, 0), PIPE_SPEC);

    const empty = buildInsulationGroup(graph, 0);
    expect(empty.children.length).toBe(0);

    const all = buildInsulationGroup(graph, 50);
    expect(all.children.length).toBe(2);

    const onlyFirst = buildInsulationGroup(graph, 50, new Set([p1.id]));
    expect(onlyFirst.children.length).toBe(1);
  });

  it('construye el compás circular de Plant con puntos táctiles de 45° y arco de desvío activo', () => {
    const compass = buildPlantCompassGroup({
      activeDir: new THREE.Vector3(1, 1, 0).normalize(),
      portDir: new THREE.Vector3(1, 0, 0)
    });

    const snapDirs: [number, number, number][] = [];
    let lineCount = 0;
    compass.traverse((obj) => {
      if (obj.userData?.axisDir) snapDirs.push(obj.userData.axisDir);
      if (obj instanceof THREE.Line) lineCount++;
    });

    // 4 diagonales de 45° en el plano XY (ninguna es opuesta a +X)
    expect(snapDirs.length).toBe(4);
    // Anillo exterior + anillo interior + ticks menores + ticks mayores + arco amarillo activo = 5 líneas
    expect(lineCount).toBe(5);
  });
});
