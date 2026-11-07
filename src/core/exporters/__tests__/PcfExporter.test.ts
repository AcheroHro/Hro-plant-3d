import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { PipingGraph } from '../../graph/PipingGraph';
import { SpecDatabaseReader } from '../../specs/SpecDatabaseReader';
import { PcfExporter } from '../PcfExporter';
import { PcfImporter } from '../../importers/PcfImporter';

describe('PcfExporter - Exportación Estándar Alias/Isogen y Round-Trip PCF', () => {
  let reader: SpecDatabaseReader;

  beforeAll(async () => {
    reader = await SpecDatabaseReader.create();
  });

  it('Debe serializar un tramo con giro a 90° en bloques PIPE, ELBOW, WELD y MATERIALS con coordenadas exactas', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const elbowSpec = reader.findElbow(2, 90, 'CS150')!;

    // 1000 mm en +X girando a +Y con codo de 76.2 mm
    graph.routeTurnWithElbow(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1000, 0, 0),
      new THREE.Vector3(1000, 1000, 0),
      pipeSpec,
      elbowSpec
    );

    const pcf = PcfExporter.exportToPcf(graph, {
      pipelineReference: 'L-201',
      projectIdentifier: 'PLANTA_GAS_ACHERO'
    });

    // 1. Verificación de encabezados
    expect(pcf).toContain('ISOGEN-FILES ISOGEN.FLS');
    expect(pcf).toContain('UNITS-BORE INCH');
    expect(pcf).toContain('UNITS-CO-ORDS MM');
    expect(pcf).toContain('PIPELINE-REFERENCE L-201');
    expect(pcf).toContain('PROJECT-IDENTIFIER PLANTA_GAS_ACHERO');
    expect(pcf).toContain('PIPING-SPEC CS150');

    // 2. Verificación del bloque PIPE entrante con cota neta de 923.80 mm
    expect(pcf).toContain('PIPE');
    expect(pcf).toContain('END-POINT 0.00 0.00 0.00 2.00 BW');
    expect(pcf).toContain('END-POINT 923.80 0.00 0.00 2.00 BW');
    expect(pcf).toContain('WALL-THICKNESS 3.91');

    // 3. Verificación del bloque ELBOW con vértice de centro en (1000, 0, 0) y ángulo 9000
    expect(pcf).toContain('ELBOW');
    expect(pcf).toContain('END-POINT 923.80 0.00 0.00 2.00 BW');
    expect(pcf).toContain('END-POINT 1000.00 76.20 0.00 2.00 BW');
    expect(pcf).toContain('CENTRE-POINT 1000.00 0.00 0.00');
    expect(pcf).toContain('ANGLE 9000');

    // 4. Verificación del caño saliente, bloque WELD y tabla MATERIALS
    expect(pcf).toContain('END-POINT 1000.00 76.20 0.00 2.00 BW');
    expect(pcf).toContain('END-POINT 1000.00 1000.00 0.00 2.00 BW');
    expect(pcf).toContain('WELD');
    expect(pcf).toContain('MATERIALS');
  });

  it('Debe permitir ciclo completo (Round-Trip) Exportar PCF -> Importar PCF preservando piezas, tags de niples y biseles', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const elbowSpec = reader.findElbow(2, 90, 'CS150')!;

    const { incomingPipe } = graph.routeTurnWithElbow(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1000, 0, 0),
      new THREE.Vector3(1000, 1000, 0),
      pipeSpec,
      elbowSpec
    );

    graph.updateComponentMetadata(incomingPipe.id, {
      nippleTag: 'N-99'
    });
    graph.updatePipeEndFinishes(incomingPipe.id, 'Plano', 'Bisel');

    const pcfText = PcfExporter.exportToPcf(graph, {
      pipelineReference: 'LINE-ROUNDTRIP-01',
      boreUnits: 'MM'
    });

    expect(pcfText).toContain('UNITS-BORE MM');
    expect(pcfText).toContain('END-POINT 0.00 0.00 0.00 50 BW');
    expect(pcfText).toContain('TAG N-99');
    expect(pcfText).toContain('END-PREPARATION Plano/Bisel');

    const imported = PcfImporter.importFromPcf(pcfText, reader, 'CS150');
    expect(imported.componentCount).toBe(3);
    expect(imported.pipeCount).toBe(2);
    expect(imported.lineReference).toBe('LINE-ROUNDTRIP-01');

    const importedPipes = Array.from(imported.graph.components.values()).filter(
      (c) => c.type === 'PIPE'
    );
    expect(importedPipes[0].parameters.nippleTag).toBe('N-99');
    expect(importedPipes[0].parameters.endFinish1).toBe('Plano');
    expect(importedPipes[0].parameters.endFinish2).toBe('Bisel');
  });
});
