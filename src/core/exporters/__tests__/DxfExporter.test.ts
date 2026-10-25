import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { PipingGraph } from '../../graph/PipingGraph';
import { SpecDatabaseReader } from '../../specs/SpecDatabaseReader';
import { DxfExporter } from '../DxfExporter';

describe('DxfExporter - Exportación 2D Ortogonal AutoCAD DXF', () => {
  let reader: SpecDatabaseReader;

  beforeAll(async () => {
    reader = await SpecDatabaseReader.create();
  });

  it('Debe generar un archivo DXF válido con capas CENTERLINE, PIPING_CONTOUR y DIMENSIONS', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const elbowSpec = reader.findElbow(2, 90, 'CS150')!;

    graph.routeTurnWithElbow(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1000, 0, 0),
      new THREE.Vector3(1000, 1000, 0),
      pipeSpec,
      elbowSpec
    );

    const dxf = DxfExporter.exportToDxf(graph, 'TOP', 'PLANTA_SPOOL_01');

    // 1. Estructura estándar DXF
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('HEADER');
    expect(dxf).toContain('AC1009'); // AutoCAD R12 compatible
    expect(dxf).toContain('TABLES');
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('EOF');

    // 2. Capas técnicas oficiales
    expect(dxf).toContain('CENTERLINE');
    expect(dxf).toContain('PIPING_CONTOUR');
    expect(dxf).toContain('DIMENSIONS');

    // 3. Contenido de entidades acotadas
    expect(dxf).toContain('923.8 mm');
    expect(dxf).toContain('VISTA DE PLANTA (XY)');
  });

  it('Debe generar lámina multi-vista (ALL) con las tres proyecciones ortogonales', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;

    graph.addPipe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(800, 0, 0), pipeSpec);

    const dxf = DxfExporter.exportToDxf(graph, 'ALL', 'LAMINA_GENERAL');

    expect(dxf).toContain('VISTA DE PLANTA (XY)');
    expect(dxf).toContain('ALZADO FRONTAL (XZ)');
    expect(dxf).toContain('PERFIL LATERAL (YZ)');
    expect(dxf).toContain('PROYECCIÓN ISOMÉTRICA 3D');
  });

  it('Debe generar plano Isométrico 2D (ISO) con cotas, marcas de soldadura, globos C-1, Juntas y Espárragos P3dJoint', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const elbowSpec = reader.findElbow(2, 90, 'CS150')!;
    const flangeSpec = reader.findFlange(2, 'CS150')!;
    const valveSpec = reader.findValve(2, 'CS150')!;
    const gasketSpec = reader.findGasket(2, 'CS150');
    const boltSetSpec = reader.findBoltSet(2, 'CS150');

    const routed = graph.routeTurnWithElbow(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1000, 0, 0),
      new THREE.Vector3(1000, 1000, 0),
      pipeSpec,
      elbowSpec
    );

    const flg = graph.addFlange(routed.outgoingPipe.ports[1], flangeSpec, gasketSpec, boltSetSpec);
    graph.addValve(flg.ports[1], valveSpec, gasketSpec, boltSetSpec);

    const bom = graph.calculateBillOfMaterials();
    expect(bom.some((b) => b.type === 'GASKET' && b.quantity === 3)).toBe(true);
    expect(bom.some((b) => b.type === 'BOLT_SET' && b.quantity === 3)).toBe(true);

    const cutList = graph.calculatePipeCutList();
    expect(cutList.length).toBe(2);
    expect(cutList[0].itemNumber).toBe(1);

    const dxf = DxfExporter.exportToDxf(graph, 'ISO', 'ISO_LINE_101');
    expect(dxf).toContain('WELD_MARKS');
    expect(dxf).toContain('ISO_ANNOTATIONS');
    expect(dxf).toContain('NORTE (+Y)');
    expect(dxf).toContain('C-1');
    expect(dxf).toContain('C-2');
    expect(dxf).toContain('JUNTA');
    expect(dxf).toContain('ESPARRAGOS');
    expect(dxf).toContain('PLANILLA DE CORTES INDIVIDUALES DE CANERIA');
  });
});

