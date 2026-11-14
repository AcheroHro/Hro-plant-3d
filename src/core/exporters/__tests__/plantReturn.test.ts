import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadSpec } from '../../../__tests__/fixtures';
import { PipingGraph } from '../../graph/PipingGraph';
import { PcfExporter, pcfFileName } from '../PcfExporter';
import { validateModel } from '../../validation/validateModel';
import { knownSpecCodes } from '../../specs/builtInSpecs';
import { supportFrame } from '../../graph/supportFrame';
import { computeSpools } from '../../spools/spoolEngine';
import { buildFieldReport } from '../../field/fieldReport';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Línea de 4" con dos codos y una válvula bridada, toda en RCI1 */
async function line() {
  const spec = await loadSpec('RCI1');
  const g = new PipingGraph('RCI1', 4);
  g.activeLineNumber = '100-RCI1-4"';
  const pipe = spec.findPipe(4)!;
  const elbow = spec.findElbow(4, 90)!;
  const turn = g.routeTurnWithElbow(v(0, 0, 0), v(3000, 0, 0), v(3000, 3000, 0), pipe, elbow);
  const valve = spec.findValve(4, undefined, { connectToEndType: 'PL' })!;
  const flange = spec.findFlange(4, undefined, { connectToEndType: 'PL' })!;
  const asm = g.addValveAssembly(turn.outgoingPipe.ports[1], valve, { flangeSpec: flange, gasketSpec: spec.findGasket(4), boltSetSpec: spec.findBoltSet(4) });
  return { spec, g, pipe, elbow, turn, asm };
}

const textOf = (sheets: ReturnType<typeof buildFieldReport>) =>
  sheets.flatMap((s) => s.prims.filter((p): p is Extract<typeof p, { k: 'text' }> => p.k === 'text').map((p) => p.s));

describe('Vuelta a Plant 3D', () => {
  it('avisa las piezas con una spec que la app no tiene, agrupadas por spec', async () => {
    const { g, turn } = await line();
    const known = knownSpecCodes(g.activeSpec);
    expect(validateModel(g, { knownSpecs: known }).filter((i) => i.code === 'SPEC_UNKNOWN')).toHaveLength(0);

    turn.incomingPipe.specCode = 'CS300-VIEJA';
    turn.outgoingPipe.specCode = 'CS300-VIEJA';
    turn.elbow.specCode = '';
    const issues = validateModel(g, { knownSpecs: known }).filter((i) => i.code === 'SPEC_UNKNOWN');
    expect(issues).toHaveLength(2);
    const old = issues.find((i) => i.title.includes('CS300-VIEJA'))!;
    expect(old.componentIds.sort()).toEqual([turn.incomingPipe.id, turn.outgoingPipe.id].sort());
    expect(old.detail).toContain('placeholder');
    expect(issues.find((i) => i.title.includes('sin spec'))!.componentIds).toEqual([turn.elbow.id]);
    // Sin lista de specs no se revisa
    expect(validateModel(g).some((i) => i.code === 'SPEC_UNKNOWN')).toBe(false);
  });

  it('marca las uniones entre specs distintas: soldadas como aviso, en brida como dato', async () => {
    const { g, turn, asm } = await line();
    expect(validateModel(g).filter((i) => i.code === 'JOINT_SPEC')).toHaveLength(0);

    // Codo soldado con otra spec que el caño
    turn.elbow.specCode = 'CS150';
    const welded = validateModel(g).filter((i) => i.code === 'JOINT_SPEC');
    expect(welded.length).toBeGreaterThanOrEqual(1);
    expect(welded.every((i) => i.severity === 'warning')).toBe(true);
    turn.elbow.specCode = 'RCI1';

    // Válvula con otra spec: el cambio queda en las bridas (las juntas y bulones no cuentan)
    asm.valve.specCode = 'CS150';
    const flanged = validateModel(g).filter((i) => i.code === 'JOINT_SPEC');
    expect(flanged.length).toBeGreaterThanOrEqual(1);
    expect(flanged.every((i) => i.severity === 'info')).toBe(true);
  });

  it('exporta un PCF por número de línea, cada uno con sus piezas y su PIPELINE-REFERENCE', async () => {
    const { g, turn, asm } = await line();
    expect(PcfExporter.exportByLine(g)).toHaveLength(1);

    // La válvula y sus bridas pasan a otra línea
    for (const c of [asm.valve, ...asm.flanges]) c.parameters.lineNumber = '200-RCI1-4"';
    const files = PcfExporter.exportByLine(g);
    expect(files.map((f) => f.lineNumber).sort()).toEqual(['100-RCI1-4"', '200-RCI1-4"']);
    const first = files.find((f) => f.lineNumber === '100-RCI1-4"')!;
    const second = files.find((f) => f.lineNumber === '200-RCI1-4"')!;
    expect(first.fileName).toBe('100-RCI1-4in.pcf');
    expect(first.content).toContain('PIPELINE-REFERENCE 100-RCI1-4"');
    expect(second.content).toContain('PIPELINE-REFERENCE 200-RCI1-4"');
    expect(first.componentCount).toBe(3); // caño, codo, caño
    expect(second.componentCount).toBe(3); // brida, válvula, brida
    expect((first.content.match(/^PIPE$/gm) ?? []).length).toBe(2);
    expect(first.content).not.toMatch(/^VALVE$/m);
    expect(second.content).toMatch(/^VALVE$/m);
    expect(second.content).not.toMatch(/^PIPE$/m);
    void turn;
    expect(pcfFileName('L/100 "A"')).toBe('L_100_inAin.pcf');
  });

  it('soporte con tipo y tag de Plant, altura y giro: se dibuja, se guarda y sale en el PCF', async () => {
    const { g, turn } = await line();
    const pipe = turn.incomingPipe;
    const mark = g.addSupport(pipe.id, 600, 'APOYO');
    const host = g.supportHost(mark)!;
    expect(supportFrame(mark, host).direction).toBe('DOWN');

    g.updateSupport(mark.id, { plantType: 'Dummy Leg', tag: 'PS-101', heightMm: 850, rotationDeg: 90 });
    const frame = supportFrame(mark, host);
    expect(frame.reachMm).toBe(850);
    // Girado 90° alrededor de un caño en X: apoya de costado
    expect(['NORTH', 'SOUTH']).toContain(frame.direction);
    expect(frame.point.distanceTo(mark.position)).toBeCloseTo(850, 3);

    // Vuelta completa y altura menor que el caño: se corrigen
    g.updateSupport(mark.id, { rotationDeg: 450, heightMm: -5 });
    expect(mark.rotationDeg).toBe(90);
    expect(mark.heightMm).toBeUndefined();

    // Se guarda con el proyecto
    g.updateSupport(mark.id, { heightMm: 850, rotationDeg: 180 });
    const copy = new PipingGraph('RCI1', 4);
    copy.deserialize(g.serialize());
    const back = copy.supports.get(mark.id)!;
    expect(back).toMatchObject({ plantType: 'Dummy Leg', tag: 'PS-101', heightMm: 850, rotationDeg: 180 });
    expect(supportFrame(back, copy.supportHost(back)!).direction).toBe('UP');

    const isogen = PcfExporter.exportToPcf(g, { target: 'isogen' });
    expect(isogen).toMatch(/SUPPORT\r\n.*\r\n.*SKEY SKID\r\n\s+NAME PS-101\r\n\s+ITEM-DESCRIPTION Dummy Leg\r\n\s+SUPPORT-DIRECTION UP/);
  });

  it('numera las soldaduras SW-001, FW-001 y FFW-001, igual en la app, el PCF y el informe', async () => {
    const { g, turn } = await line();
    const elbowJoint = [...g.joints.values()].find((j) => {
      const ids = [g.ports.get(j.portAId)?.componentId, g.ports.get(j.portBId)?.componentId];
      return ids.includes(turn.elbow.id) && ids.includes(turn.outgoingPipe.id);
    })!;
    g.setFieldWeld(elbowJoint.id, 'FFW', 150);
    const { welds } = computeSpools(g);
    const numbers = welds.map((w) => w.number);
    expect(numbers.filter((n) => n.startsWith('SW-'))[0]).toBe('SW-001');
    expect(numbers).toContain('FFW-001');
    expect(numbers.every((n) => /^(SW|FW|FFW)-\d{3}$/.test(n))).toBe(true);

    const isogen = PcfExporter.exportToPcf(g, { target: 'isogen' });
    for (const n of numbers) expect(isogen).toContain(`WELD-NO ${n}`);

    const report = buildFieldReport({
      projectName: 'Prueba',
      changes: [],
      notes: [],
      welds: welds.map((w) => ({ number: w.number, kind: w.kind, type: w.type, nominalDiameter: `${w.nominalDiameter}"`, spools: w.spoolIds.join(' / '), allowanceMm: w.allowanceMm })),
      weldMapIncluded: true
    });
    const texts = textOf(report);
    expect(texts).toContain('SOLDADURAS');
    expect(texts).toContain('SW-001');
    expect(texts).toContain('FFW-001');
    expect(texts).toContain('+150 mm');
    expect(texts.some((t) => t.startsWith('El mapa de soldaduras'))).toBe(true);
  });
});
