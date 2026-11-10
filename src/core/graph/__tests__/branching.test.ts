import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PipingGraph } from '../PipingGraph';
import { PcfExporter } from '../../exporters/PcfExporter';
import { loadSpec } from '../../../__tests__/fixtures';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Etapa 4: derivaciones sin cortar el caño, soportes y ampliaciones sobre la spec real */
describe('Derivaciones, soportes y cambio de diámetro', () => {
  async function header() {
    const spec = await loadSpec('AES-CS150-A53');
    const g = new PipingGraph('AES-CS150-A53', 4);
    const sizes = spec.getAvailableNominalDiameters();
    const big = sizes.includes(4) ? 4 : sizes[sizes.length - 1];
    const small = sizes.filter((n) => n < big)[0];
    const pipe = g.addPipe(v(0, 0, 1000), v(2000, 0, 1000), spec.findPipe(big)!);
    return { spec, g, pipe, big, small };
  }

  it('injerto directo: no corta el caño y deja una boca libre del diámetro del ramal', async () => {
    const { spec, g, pipe, small } = await header();
    const branch = spec.findPipe(small)!;
    const stub = g.addBranchOnPipe(pipe.id, 500, v(0, 0, 1), branch, null);

    expect(g.components.size).toBe(2);
    expect(pipe.ports[1].position.x).toBeCloseTo(2000, 6);
    expect(stub.type).toBe('OLET');
    expect(stub.parameters.stubIn).toBe(true);
    expect(stub.centerline[0].distanceTo(v(500, 0, 1000))).toBeLessThan(1e-6);
    // El ramal nace en el lomo del caño
    expect(stub.ports[0].position.z).toBeCloseTo(1000 + pipe.parameters.outerDiameter / 2, 6);
    expect(stub.ports[0].direction.z).toBeCloseTo(1, 6);
    expect(stub.ports[0].nominalDiameter).toBe(small);
    expect(g.oletsOn(pipe)).toEqual([stub]);
    expect(g.oletHost(stub)).toBe(pipe);

    // Se puede seguir el ramal desde esa boca
    const riser = g.addPipe(stub.ports[0].position.clone(), stub.ports[0].position.clone().add(v(0, 0, 600)), branch);
    g.connectPorts(stub.ports[0].id, riser.ports[0].id);
    expect(g.connectedRun(pipe.id).sort()).toEqual([pipe.id, stub.id, riser.id].sort());

    // En el PCF sale como OLET con su centro sobre el eje del caño
    const pcf = PcfExporter.exportToPcf(g);
    expect(pcf).toMatch(/\r\nOLET\r\n\s+CENTRE-POINT\s+500\.\d+\s+0\.\d+\s+1000\.\d+/);
  });

  it('rechaza un ramal a lo largo del caño o más grande que él', async () => {
    const { spec, g, pipe, big, small } = await header();
    expect(() => g.addBranchOnPipe(pipe.id, 500, v(1, 0, 0), spec.findPipe(small)!, null)).toThrow(/costado/);
    const short = g.addPipe(v(0, 500, 0), v(1000, 500, 0), spec.findPipe(small)!);
    expect(() => g.addBranchOnPipe(short.id, 500, v(0, 0, 1), spec.findPipe(big)!, null)).toThrow(/más grande/);
    expect(g.components.size).toBe(2);
  });

  it('el ramal y los soportes viajan con el caño cuando se corre la línea', async () => {
    const { spec, g, pipe, small } = await header();
    const first = g.addPipe(v(-1000, 0, 1000), v(0, 0, 1000), spec.findPipe(pipe.parameters.nominalDiameter)!);
    g.connectPorts(first.ports[1].id, pipe.ports[0].id);
    const stub = g.addBranchOnPipe(pipe.id, 800, v(0, 1, 0), spec.findPipe(small)!, null);
    const guide = g.addSupport(pipe.id, 1500, 'GUIA');
    const rest = g.addSupport(first.id, 400, 'APOYO');
    expect(guide.position.distanceTo(v(1500, 0, 1000))).toBeLessThan(1e-6);

    // Estirar el primer caño 300 mm corre todo lo que sigue
    g.updatePipeLength(first.id, 1300, 'start');
    expect(pipe.ports[0].position.x).toBeCloseTo(300, 6);
    expect(stub.centerline[0].x).toBeCloseTo(1100, 6);
    expect(stub.ports[0].position.x).toBeCloseTo(1100, 6);
    expect(guide.position.x).toBeCloseTo(1800, 6);
    expect(rest.position.x).toBeCloseTo(-600, 6);
    expect(g.oletHost(stub)).toBe(pipe);
    expect(g.liveSupports()).toHaveLength(2);

    // Los soportes se guardan con el modelo y se pierden si se borra su caño
    const copy = new PipingGraph('AES-CS150-A53', 4);
    copy.deserialize(JSON.parse(JSON.stringify(g.serialize())));
    expect(copy.liveSupports().map((s) => s.kind).sort()).toEqual(['APOYO', 'GUIA']);
    expect(copy.supportNear(pipe.id, v(1750, 0, 1000))?.kind).toBe('GUIA');
    copy.removeComponent(pipe.id);
    expect(copy.liveSupports().map((s) => s.kind)).toEqual(['APOYO']);

    // Solo el PCF de isométricos lleva los soportes
    expect(PcfExporter.exportToPcf(g)).not.toContain('SUPPORT');
    const iso = PcfExporter.exportToPcf(g, { target: 'isogen' });
    expect(iso.match(/\r\nSUPPORT\r\n/g)).toHaveLength(2);
    expect(iso).toContain('SKEY GUID');
  });

  it('ampliación: la reducción se coloca al revés y deja la boca grande libre', async () => {
    const { spec, g, big } = await header();
    const sizes = spec.getAvailableNominalDiameters().filter((n) => n < big);
    const small = sizes.reverse().find((n) => spec.findReducer(big, n)?.faceToFace);
    if (!small) return; // la spec no trae reducciones para este diámetro
    const red = spec.findReducer(big, small)!;
    const thin = g.addPipe(v(0, 3000, 0), v(1000, 3000, 0), spec.findPipe(small)!);
    const comp = g.addReducer(thin.ports[1], red, true);

    expect(comp.ports[0].nominalDiameter).toBe(small);
    expect(comp.ports[1].nominalDiameter).toBe(big);
    expect(comp.ports[1].outerDiameter).toBeGreaterThan(comp.ports[0].outerDiameter);
    expect(comp.ports[1].position.x).toBeCloseTo(1000 + red.faceToFace!, 3);
    expect(thin.ports[1].connectedJointId).toBeDefined();
    expect(comp.ports[1].connectedJointId).toBeUndefined();
  });
});
