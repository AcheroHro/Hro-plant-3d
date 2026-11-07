import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { PipingGraph } from '../../graph/PipingGraph';
import { SpecDatabaseReader } from '../../specs/SpecDatabaseReader';
import { PcfExporter } from '../PcfExporter';
import { PcfImporter } from '../../importers/PcfImporter';
import { listFixtures, readFixtureText, loadSpec } from '../../../__tests__/fixtures';
import { parsePcfBlocks } from '../../../__tests__/pcfBlocks';

const normalize = (t: string) =>
  t
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0)
    .join('\n');

describe('PcfExporter: piezas creadas en la app', () => {
  let reader: SpecDatabaseReader;

  beforeAll(async () => {
    reader = await SpecDatabaseReader.create();
  });

  function turn() {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const r = graph.routeTurnWithElbow(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1000, 0, 0),
      new THREE.Vector3(1000, 1000, 0),
      reader.findPipe(2, 'CS150')!,
      reader.findElbow(2, 90, 'CS150')!
    );
    return { graph, ...r };
  }

  it('formato para PCF to Pipe de Plant 3D 2027: CRLF, 4 decimales, ANGLE 9000, spec por pieza y sin soldaduras', () => {
    const { graph } = turn();
    const pcf = PcfExporter.exportToPcf(graph, { pipelineReference: 'L-201', projectIdentifier: 'PLANTA' });

    expect(pcf).toContain('\r\n');
    expect(pcf.replace(/\r\n/g, '')).not.toContain('\n');
    expect(/[^\x20-\x7E\r\n]/.test(pcf)).toBe(false);
    expect(pcf).toContain('UNITS-BORE INCH');
    expect(pcf).toContain('PIPELINE-REFERENCE L-201');
    expect(pcf).toContain('    PROJECT-IDENTIFIER PLANTA');
    expect(pcf).toContain('    END-POINT 0.0000 0.0000 0.0000 2\r\n');
    expect(pcf).toContain('    END-POINT 923.8000 0.0000 0.0000 2\r\n');
    expect(pcf).toContain('    CENTRE-POINT 1000.0000 0.0000 0.0000\r\n');
    expect(pcf).toContain('    ANGLE 9000\r\n');
    expect(pcf).not.toMatch(/^(WELD|GASKET|BOLT|MATERIALS)\r?$/m);

    const { blocks } = parsePcfBlocks(pcf);
    expect(blocks.map((b) => b.type)).toEqual(['PIPE', 'ELBOW', 'PIPE']);
    for (const b of blocks) expect(b.attrs['PIPING-SPEC']).toEqual(['CS150']);
  });

  it('formato Isogen: soldaduras, MATERIALS y datos de taller del niple, que vuelven al importar', () => {
    const { graph, incomingPipe } = turn();
    graph.updateComponentMetadata(incomingPipe.id, { nippleTag: 'N-99' });
    graph.updatePipeEndFinishes(incomingPipe.id, 'Plano', 'Bisel');

    const pcf = PcfExporter.exportToPcf(graph, { pipelineReference: 'LINE-RT', boreUnits: 'MM', target: 'isogen' });
    expect(pcf).toContain('UNITS-BORE MM');
    // En Isogen cada extremo lleva su tipo (el caño de la spec demo es PL)
    expect(pcf).toContain('    END-POINT 0.0000 0.0000 0.0000 50.0000 PL');
    expect(pcf).toMatch(/^WELD\r$/m);
    expect(pcf).toMatch(/^MATERIALS\r$/m);
    expect(pcf).toContain('TAG N-99');
    expect(pcf).toContain('END-PREPARATION Plano/Bisel');

    const imported = PcfImporter.importFromPcf(pcf, reader, 'CS150');
    expect(imported.componentCount).toBe(3);
    expect(imported.pipeCount).toBe(2);
    expect(imported.lineReference).toBe('LINE-RT');
    expect(imported.skipped['WELD']).toBe(2);
    const pipes = Array.from(imported.graph.components.values()).filter((c) => c.type === 'PIPE');
    expect(pipes[0].parameters.nippleTag).toBe('N-99');
    expect(pipes[0].parameters.endFinish1).toBe('Plano');
    expect(pipes[0].parameters.endFinish2).toBe('Bisel');
  });

  it('reducción excéntrica de la app: REDUCER-ECCENTRIC con FLAT-DIRECTION del lado del corrimiento', async () => {
    const spec = await loadSpec('AES-CS150-A53');
    const g = new PipingGraph('AES-CS150-A53', 2);
    const pipe = g.addPipe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(500, 0, 0), spec.findPipe(2)!);
    const red = spec.findReducer(2, 1.5, undefined, { eccentric: true });
    expect(red).not.toBeNull();
    const r = g.addReducer(pipe.ports[1], red!);
    const pcf = PcfExporter.exportToPcf(g);
    expect(pcf).toContain('REDUCER-ECCENTRIC');
    const dz = r.ports[1].position.z - r.ports[0].position.z;
    expect(pcf).toContain(`FLAT-DIRECTION ${dz < 0 ? 'DOWN' : 'UP'}`);
  });
});

describe('PcfExporter: PCF de Plant ida y vuelta sin pérdidas', () => {
  it('los 15 PCF del skid ácido vuelven idénticos si no se tocan', () => {
    for (const f of listFixtures('pcf/acido', '.pcf')) {
      const text = readFixtureText('pcf/acido', f);
      const out = PcfExporter.exportToPcf(PcfImporter.importFromPcf(text).graph);
      expect(normalize(out), f).toBe(normalize(text));
    }
  });

  it('PCF exportado por Plant (UNITS-BORE MM): las piezas vuelven iguales y sin WELD', () => {
    const text = readFixtureText('pcf', 'SampleIsoPreview.pcf');
    const res = PcfImporter.importFromPcf(text);
    expect(res.skipped['WELD']).toBeGreaterThan(0);
    const out = PcfExporter.exportToPcf(res.graph);
    expect(out).toContain('UNITS-BORE  MM');
    const pieces = (t: string) =>
      parsePcfBlocks(t).blocks.filter((b) => !/^(WELD|END-POSITION-NULL|MATERIALS|ITEM-CODE)$/.test(b.type));
    expect(pieces(out)).toEqual(pieces(text));
  });

  it('al alargar un caño se reescriben solo las coordenadas de lo que se movió', () => {
    const text = readFixtureText('pcf/acido', 'L01.pcf');
    const { graph } = PcfImporter.importFromPcf(text);
    // Caño de 233.88 mm entre las dos primeras bridas: se alarga 100 mm y empuja todo lo que sigue
    const pipe = Array.from(graph.components.values()).find(
      (c) => c.type === 'PIPE' && Math.abs(c.ports[0].position.x + 18.94) < 1e-6
    )!;
    expect(pipe).toBeDefined();
    const before = pipe.ports[0].position.distanceTo(pipe.ports[1].position);
    graph.updatePipeLength(pipe.id, before + 100);

    const out = PcfExporter.exportToPcf(graph);
    const a = parsePcfBlocks(text).blocks;
    const b = parsePcfBlocks(out).blocks;
    expect(b.length).toBe(a.length);
    // Las primeras piezas no se movieron; la válvula siguiente quedó 100 mm más allá
    expect(b[0]).toEqual(a[0]);
    const valveIn = a.findIndex((x) => x.attrs['ITEM-DESCRIPTION']?.[0].includes('CV-1039'));
    expect(b[valveIn].points[0].xyz[0]).toBeCloseTo(a[valveIn].points[0].xyz[0] + 100, 4);
    expect(b[valveIn].attrs).toEqual(a[valveIn].attrs);
    // La tee arrastra su centro y su ramal
    const tee = a.findIndex((x) => x.type === 'TEE');
    expect(b[tee].points.map((p) => p.xyz[0])).toEqual(a[tee].points.map((p) => p.xyz[0] + 100));
    expect(out).toContain('    END-POINT 1355.0000 -200.0000 2067.0000 2\r\n');
  });

  it('cambiar la descripción o la spec de una pieza importada cambia solo esa línea', () => {
    const text = readFixtureText('pcf/acido', 'L01.pcf');
    const { graph } = PcfImporter.importFromPcf(text);
    const valve = Array.from(graph.components.values()).find((c) => c.type === 'VALVE')!;
    graph.updateComponentMetadata(valve.id, { description: 'VALV. ESFERICA 2" CAMBIADA EN CAMPO' });
    const out = PcfExporter.exportToPcf(graph);
    expect(out).toContain('    ITEM-DESCRIPTION VALV. ESFERICA 2" CAMBIADA EN CAMPO\r\n');
    expect(out.split('\r\n').length).toBe(text.split(/\r?\n/).length);
  });

  it('partir un caño importado con una válvula: los dos tramos conservan descripción y spec', async () => {
    const spec = await loadSpec('AES-CS150-A53');
    const text = readFixtureText('pcf/acido', 'L01.pcf');
    const { graph } = PcfImporter.importFromPcf(text, spec);
    const pipe = Array.from(graph.components.values()).find(
      (c) => c.type === 'PIPE' && c.ports[0].position.distanceTo(c.ports[1].position) > 600
    )!;
    const valve = spec.findValve(pipe.parameters.nominalDiameter)!;
    const res = graph.splitPipeWithFitting(pipe.id, valve, spec.findPipe(pipe.parameters.nominalDiameter)!, {
      gasketSpec: spec.findGasket(pipe.parameters.nominalDiameter),
      boltSetSpec: spec.findBoltSet(pipe.parameters.nominalDiameter),
      flangeSpec: spec.findFlange(pipe.parameters.nominalDiameter)
    })!;
    expect(res.pipe1.parameters.description).toBe('Cano');
    expect(res.pipe2.specCode).toBe('AES-CS150-A53');
    const out = PcfExporter.exportToPcf(graph);
    const blocks = parsePcfBlocks(out).blocks;
    expect(blocks.filter((b) => b.type === 'VALVE').length).toBe(
      parsePcfBlocks(text).blocks.filter((b) => b.type === 'VALVE').length + 1
    );
    for (const blk of blocks) expect(blk.attrs['PIPING-SPEC']?.length, blk.type).toBe(1);
  });
});
