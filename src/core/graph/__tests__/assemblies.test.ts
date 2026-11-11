import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { isFaceEnd, PipingGraph } from '../PipingGraph';
import { loadSpec } from '../../../__tests__/fixtures';
import { validateModel } from '../../validation/validateModel';
import { PcfExporter } from '../../exporters/PcfExporter';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Etapa A del plan de consistencia: reducciones, bridas y válvulas con sus bridas (spec real RCI1) */
describe('Armados de la spec', () => {
  async function setup(nd = 2) {
    const spec = await loadSpec('RCI1');
    const g = new PipingGraph('RCI1', nd);
    const pipe = g.addPipe(v(0, 0, 0), v(1000, 0, 0), spec.findPipe(nd)!);
    return { spec, g, pipe };
  }

  it('ampliación de 2" a 4": la boca chica queda contra el caño de 2" y la grande sigue la línea', async () => {
    const { spec, g, pipe } = await setup(2);
    const red = g.addReducer(pipe.ports[1], spec.findReducer(2, 4)!, true);
    expect(red.ports[0].nominalDiameter).toBe(2);
    expect(red.ports[0].outerDiameter).toBeCloseTo(60.3, 0);
    expect(red.ports[0].position.distanceTo(pipe.ports[1].position)).toBeLessThan(0.01);
    expect(red.ports[1].nominalDiameter).toBe(4);
    expect(red.ports[1].outerDiameter).toBeCloseTo(114.3, 0);
    // Sin errores de diámetro en la unión
    expect(validateModel(g).some((i) => i.code === 'JOINT_SIZE')).toBe(false);

    // En el PCF cada extremo lleva su diámetro
    const pcf = PcfExporter.exportToPcf(g, { target: 'plant' });
    const block = pcf.slice(pcf.indexOf('REDUCER'));
    const ends = block.split('\n').filter((l: string) => l.trim().startsWith('END-POINT')).slice(0, 2);
    expect(ends[0].trim().split(/\s+/)[4]).toBe('2');
    expect(ends[1].trim().split(/\s+/)[4]).toBe('4');
  });

  it('dos bridas seguidas quedan cara con cara, también después de guardar y reabrir', async () => {
    const { spec, g, pipe } = await setup(2);
    const flange = spec.findFlange(2, undefined, { connectToEndType: 'PL' })!;
    const gasket = spec.findGasket(2);
    const bolts = spec.findBoltSet(2);
    const a = g.addFlange(pipe.ports[1], flange, gasket, bolts);
    const b = g.addFlange(a.ports[1], flange, gasket, bolts);

    const check = (graph: PipingGraph) => {
      const [fa, fb] = Array.from(graph.components.values()).filter((c) => c.type === 'FLANGE');
      // La cara de la primera mira hacia adelante y la de la segunda hacia atrás
      expect(isFaceEnd(fa.ports[1])).toBe(true);
      expect(fa.ports[1].direction.x).toBeCloseTo(1);
      expect(isFaceEnd(fb.ports[0])).toBe(true);
      expect(fb.ports[0].direction.x).toBeCloseTo(-1);
      expect(isFaceEnd(fb.ports[1])).toBe(false);
      const joint = graph.joints.get(fa.ports[1].connectedJointId!)!;
      expect(joint.type).toBe('FLANGED');
      expect(validateModel(graph).some((i) => i.code === 'FLANGE_REVERSED')).toBe(false);
    };
    check(g);
    expect(b.ports[1].connectedJointId).toBeFalsy();

    const copy = new PipingGraph('RCI1', 2);
    copy.deserialize(JSON.parse(JSON.stringify(g.serialize())));
    check(copy);
  });

  it('una cara de brida contra un caño se marca como brida al revés', async () => {
    const { spec, g, pipe } = await setup(2);
    const flange = spec.findFlange(2, undefined, { connectToEndType: 'PL' })!;
    const a = g.addFlange(pipe.ports[1], flange);
    const next = g.addPipe(a.ports[1].position.clone(), a.ports[1].position.clone().add(v(500, 0, 0)), spec.findPipe(2)!);
    g.connectPorts(a.ports[1].id, next.ports[0].id);
    const issue = validateModel(g).find((i) => i.code === 'FLANGE_REVERSED')!;
    expect(issue.severity).toBe('error');
    expect(issue.componentIds[0]).toBe(a.id);
  });

  it('válvula bridada al final de la línea: entra con sus dos bridas y juntas', async () => {
    const { spec, g, pipe } = await setup(2);
    const valve = spec.findValve(2, undefined, { connectToEndType: 'PL' })!;
    expect(valve.plantEndTypes?.[0]).toBe('FL');
    const flange = spec.findFlange(2, undefined, { connectToEndType: 'PL', pressureClass: valve.pressureClass })!;
    const gasket = spec.findGasket(2, undefined, { pressureClass: valve.pressureClass });
    const bolts = spec.findBoltSet(2, undefined, { pressureClass: valve.pressureClass });

    const asm = g.addValveAssembly(pipe.ports[1], valve, { flangeSpec: flange, gasketSpec: gasket, boltSetSpec: bolts });
    expect(asm.flanges).toHaveLength(2);
    const flanged = Array.from(g.joints.values()).filter((j) => j.type === 'FLANGED');
    expect(flanged).toHaveLength(2);
    for (const j of flanged) expect(j.gapMm ?? 0).toBeGreaterThan(0);

    // La línea sigue por el lado caño de la segunda brida
    expect(isFaceEnd(asm.outPort)).toBe(false);
    expect(asm.outPort.connectedJointId).toBeFalsy();
    expect(asm.outPort.direction.x).toBeCloseTo(1);
    const gap = gasket?.gasketThicknessMm ?? 0;
    const expected = 1000 + 2 * (flange.faceToFace ?? 0) + 2 * gap + (valve.faceToFace ?? 0);
    expect(asm.outPort.position.x).toBeCloseTo(expected, 1);
    expect(validateModel(g).filter((i) => i.severity === 'error')).toHaveLength(0);

    // Sobre una cara de brida ya existente solo agrega la de salida
    const g2 = new PipingGraph('RCI1', 2);
    const p2 = g2.addPipe(v(0, 0, 0), v(1000, 0, 0), spec.findPipe(2)!);
    const first = g2.addFlange(p2.ports[1], flange, gasket, bolts);
    const asm2 = g2.addValveAssembly(first.ports[1], valve, { flangeSpec: flange, gasketSpec: gasket, boltSetSpec: bolts });
    expect(asm2.flanges).toHaveLength(1);
    expect(asm2.outPort.position.x).toBeCloseTo(expected, 1);
  });

  it('válvula para soldar o sin brida en la spec: entra sola', async () => {
    const { spec, g, pipe } = await setup(2);
    const valve = spec.findValve(2, undefined, { connectToEndType: 'PL' })!;
    const alone = g.addValveAssembly(pipe.ports[1], valve, { flangeSpec: null });
    expect(alone.flanges).toHaveLength(0);
    expect(alone.outPort.id).toBe(alone.valve.ports[1].id);
  });
});
