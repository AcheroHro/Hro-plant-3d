import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { isFaceEnd, PipingGraph } from '../PipingGraph';
import { resizeRun, sameSizeRun } from '../resizeRun';
import { loadSpec } from '../../../__tests__/fixtures';
import { validateModel } from '../../validation/validateModel';
import { valveStemDirection } from '../../../viewport/buildComponentMesh';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const BAD_JOINT = ['JOINT_SIZE', 'JOINT_GAP', 'JOINT_ANGLE', 'FLANGE_REVERSED'];
const jointIssues = (g: PipingGraph) => validateModel(g).filter((i) => BAD_JOINT.includes(i.code));

async function setup(nd = 2) {
  const spec = await loadSpec('RCI1');
  const g = new PipingGraph('RCI1', nd);
  const pipe = g.addPipe(v(0, 0, 0), v(1000, 0, 0), spec.findPipe(nd)!);
  return { spec, g, pipe };
}

/** Etapa D: invertir y girar piezas */
describe('Invertir y girar pieza', () => {
  it('brida: la cara pasa al otro lado y vuelve; la revisión avisa cuando queda al revés', async () => {
    const { spec, g, pipe } = await setup(4);
    const flange = g.addFlange(pipe.ports[1], spec.findFlange(4, undefined, { connectToEndType: 'PL' })!, spec.findGasket(4), spec.findBoltSet(4));
    expect(isFaceEnd(flange.ports[1])).toBe(true);
    expect(g.flipKind(flange.id)).toBe('flange');
    const where = flange.ports.map((p) => p.position.clone());

    g.flipComponent(flange.id);
    expect(isFaceEnd(flange.ports[0])).toBe(true);
    expect(isFaceEnd(flange.ports[1])).toBe(false);
    flange.ports.forEach((p, i) => expect(p.position.distanceTo(where[i])).toBeLessThan(1e-6));
    expect(validateModel(g).some((i) => i.code === 'FLANGE_REVERSED')).toBe(true);

    g.flipComponent(flange.id);
    expect(isFaceEnd(flange.ports[1])).toBe(true);
    expect(validateModel(g).some((i) => i.code === 'FLANGE_REVERSED')).toBe(false);
  });

  it('válvula: cambia el sentido (entrada por salida) sin moverse', async () => {
    const { spec, g, pipe } = await setup(4);
    const check = spec.listFamilies('VALVE', 4).find((f) => /check/i.test(f.familyDesc) && /BW/.test(f.familyDesc))!;
    const valve = g.addValve(pipe.ports[1], spec.findValve(4, undefined, { familyId: check.familyId })!);
    const [inId, outId] = valve.ports.map((p) => p.id);
    const inPos = valve.ports[0].position.clone();
    expect(g.flipKind(valve.id)).toBe('valve');
    g.flipComponent(valve.id);
    expect(valve.ports.map((p) => p.id)).toEqual([outId, inId]);
    expect(valve.ports[1].position.distanceTo(inPos)).toBeLessThan(1e-6);
    expect(valve.ports.map((p) => p.index)).toEqual([1, 2]);
    // Sigue unida al caño
    expect(g.matedPort(valve.ports[1])?.componentId).toBe(pipe.id);
  });

  it('excéntrica: pasa de plano abajo a plano arriba y arrastra lo conectado', async () => {
    const { spec, g, pipe } = await setup(4);
    const red = g.addReducer(pipe.ports[1], spec.findReducer(4, 2, undefined, { eccentric: true })!);
    const offset = red.parameters.lateralOffset!;
    expect(offset).toBeGreaterThan(1);
    const out = red.ports[1];
    const next = g.addPipe(out.position.clone(), out.position.clone().add(v(500, 0, 0)), spec.findPipe(2)!);
    g.connectPorts(out.id, next.ports[0].id);
    expect(g.reducerFlatSide(red.id)).toBe('abajo');
    const z0 = next.ports[1].position.z;

    g.flipComponent(red.id);
    expect(g.reducerFlatSide(red.id)).toBe('arriba');
    expect(next.ports[1].position.z - z0).toBeCloseTo(2 * offset, 3);
    expect(next.ports[0].position.distanceTo(out.position)).toBeLessThan(1e-6);
    expect(jointIssues(g)).toEqual([]);
    // Una concéntrica no se da vuelta
    const { spec: s2, g: g2, pipe: p2 } = await setup(4);
    const conc = g2.addReducer(p2.ports[1], s2.findReducer(4, 3, undefined, { eccentric: false })!);
    if (!conc.parameters.lateralOffset) expect(g2.flipKind(conc.id)).toBeNull();
  });

  it('volante: gira de a 90° alrededor del caño y vuelve a quedar arriba', async () => {
    const { spec, g, pipe } = await setup(4);
    const valve = g.addValve(pipe.ports[1], spec.findValve(4, undefined, { connectToEndType: 'PL' })!);
    const axis = v(1, 0, 0);
    expect(valveStemDirection(axis, valve.parameters.stemAngle).z).toBeCloseTo(1);
    g.rotateComponentAroundRun(valve.id, 90);
    expect(valve.parameters.stemAngle).toBe(90);
    const side = valveStemDirection(axis, 90);
    expect(Math.abs(side.z)).toBeLessThan(1e-6);
    expect(Math.abs(side.y)).toBeCloseTo(1);
    // Dada vuelta la válvula, el volante sigue apuntando al mismo lado
    expect(valveStemDirection(v(-1, 0, 0), 90).distanceTo(side)).toBeLessThan(1e-6);
    for (let i = 0; i < 3; i++) g.rotateComponentAroundRun(valve.id, 90);
    expect(valve.parameters.stemAngle).toBeUndefined();
    // El giro se guarda con el modelo
    g.rotateComponentAroundRun(valve.id, 90);
    const copy = new PipingGraph('RCI1', 4);
    copy.deserialize(g.serialize());
    expect(copy.components.get(valve.id)!.parameters.stemAngle).toBe(90);
  });
});

/** Etapa D: cambiar el diámetro de un tramo entero sin mover los ejes */
describe('Cambiar diámetro de un tramo', () => {
  async function elbowLine(nd: number, legA = 1000, legB = 800) {
    const spec = await loadSpec('RCI1');
    const g = new PipingGraph('RCI1', nd);
    const pipeSpec = spec.findPipe(nd)!;
    const elbowSpec = spec.findElbow(nd, 90, undefined, { connectToEndType: pipeSpec.plantEndTypes?.[0] })!;
    const turn = g.routeTurnWithElbow(v(0, 0, 0), v(legA, 0, 0), v(legA, legB, 0), pipeSpec, elbowSpec);
    return { spec, g, ...turn };
  }

  it('caño, codo, caño de 2" a 4": los extremos y el vértice quedan donde estaban', async () => {
    const { spec, g, incomingPipe, elbow, outgoingPipe } = await elbowLine(2);
    expect(sameSizeRun(g, elbow.id).ids).toHaveLength(3);
    const res = resizeRun(g, spec, incomingPipe.id, 4);
    expect(res).toMatchObject({ changed: 3, from: 2, to: 4 });

    for (const comp of g.components.values()) {
      for (const p of comp.ports) {
        expect(p.nominalDiameter).toBe(4);
        expect(p.outerDiameter).toBeCloseTo(114.3, 0);
      }
    }
    expect(incomingPipe.ports[0].position.distanceTo(v(0, 0, 0))).toBeLessThan(1e-6);
    expect(outgoingPipe.ports[1].position.distanceTo(v(1000, 800, 0))).toBeLessThan(1e-6);
    // El codo de 4" a tope mide 152,4 de centro a cara: los caños se acortan eso
    const takeOff = spec.findElbow(4, 90)!.takeOff!;
    expect(elbow.ports[0].position.distanceTo(v(1000 - takeOff, 0, 0))).toBeLessThan(0.01);
    expect(elbow.ports[1].position.distanceTo(v(1000, takeOff, 0))).toBeLessThan(0.01);
    expect(incomingPipe.parameters.cutLength).toBeCloseTo(1000 - takeOff, 2);
    expect(outgoingPipe.parameters.cutLength).toBeCloseTo(800 - takeOff, 2);
    expect(elbow.parameters.description).toBe(spec.findElbow(4, 90)!.shortDescription);
    expect(jointIssues(g)).toEqual([]);
    // Las uniones pasan de socket a soldadura a tope
    expect([...g.joints.values()].every((j) => j.type === 'BUTTWELD')).toBe(true);
    // Y vuelve: de 4" a 2" queda igual que al principio
    resizeRun(g, spec, elbow.id, 2);
    const back = spec.findElbow(2, 90, undefined, { connectToEndType: spec.findPipe(2)!.plantEndTypes?.[0] })!.takeOff!;
    expect(incomingPipe.parameters.cutLength).toBeCloseTo(1000 - back, 2);
    expect(jointIssues(g)).toEqual([]);
  });

  it('si un caño queda sin largo avisa y no cambia nada', async () => {
    const { spec, g, elbow } = await elbowLine(2, 1000, 120);
    const before = JSON.stringify(g.serialize());
    expect(() => resizeRun(g, spec, elbow.id, 4)).toThrow(/sin largo/);
    expect(JSON.stringify(g.serialize())).toBe(before);
  });

  it('válvula con bridas entre dos caños: el conjunto queda centrado y los caños lo siguen', async () => {
    const { spec, g, pipe } = await setup(4);
    const asm = g.addValveAssembly(pipe.ports[1], spec.findValve(4, undefined, { connectToEndType: 'PL' })!, {
      flangeSpec: spec.findFlange(4, undefined, { connectToEndType: 'PL' }),
      gasketSpec: spec.findGasket(4),
      boltSetSpec: spec.findBoltSet(4)
    });
    const tail = g.addPipe(asm.outPort.position.clone(), asm.outPort.position.clone().add(v(1000, 0, 0)), spec.findPipe(4)!);
    g.connectPorts(asm.outPort.id, tail.ports[0].id);
    const first = asm.flanges[0].ports[0];
    const centre = (first.position.x + asm.outPort.position.x) / 2;
    const end = tail.ports[1].position.clone();

    const res = resizeRun(g, spec, asm.valve.id, 3);
    expect(res.changed).toBe(5);
    expect((first.position.x + asm.outPort.position.x) / 2).toBeCloseTo(centre, 3);
    expect(asm.valve.parameters.faceToFace).toBeCloseTo(asm.valve.ports[0].position.distanceTo(asm.valve.ports[1].position), 3);
    expect(asm.valve.ports[0].nominalDiameter).toBe(3);
    expect(isFaceEnd(asm.valve.ports[0])).toBe(true);
    expect(pipe.ports[0].position.distanceTo(v(0, 0, 0))).toBeLessThan(1e-6);
    expect(tail.ports[1].position.distanceTo(end)).toBeLessThan(1e-6);
    expect(pipe.ports[1].position.distanceTo(first.position)).toBeLessThan(1e-6);
    expect(jointIssues(g)).toEqual([]);
    expect([...g.joints.values()].filter((j) => j.type === 'FLANGED')).toHaveLength(2);
  });

  it('ramal detrás de una reducción: cambia la reducción del borde y la cabecera no se toca', async () => {
    const { spec, g, pipe } = await setup(4);
    const red = g.addReducer(pipe.ports[1], spec.findReducer(4, 3, undefined, { eccentric: false })!);
    const out = red.ports[1];
    const branch = g.addPipe(out.position.clone(), out.position.clone().add(v(600, 0, 0)), spec.findPipe(3)!);
    g.connectPorts(out.id, branch.ports[0].id);
    const end = branch.ports[1].position.clone();
    expect(sameSizeRun(g, branch.id)).toMatchObject({ nd: 3 });
    expect(sameSizeRun(g, branch.id).ids.sort()).toEqual([red.id, branch.id].sort());

    // A 4" la reducción sobraría: se avisa y no se toca nada
    const before = JSON.stringify(g.serialize());
    expect(() => resizeRun(g, spec, branch.id, 4)).toThrow(/reducción/);
    expect(JSON.stringify(g.serialize())).toBe(before);

    const res = resizeRun(g, spec, branch.id, 2);
    expect(red.ports[0].nominalDiameter).toBe(4);
    expect(red.ports[1].nominalDiameter).toBe(2);
    expect(red.parameters.reducedNominalDiameter).toBe(2);
    expect(pipe.ports[0].position.distanceTo(v(0, 0, 0))).toBeLessThan(1e-6);
    expect(pipe.ports[1].position.distanceTo(v(1000, 0, 0))).toBeLessThan(1e-6);
    expect(red.ports[0].position.distanceTo(v(1000, 0, 0))).toBeLessThan(1e-6);
    expect(branch.ports[0].position.distanceTo(red.ports[1].position)).toBeLessThan(1e-6);
    expect(pipe.parameters.nominalDiameter).toBe(4);
    // En RCI1 la 4x2 solo existe excéntrica (plano abajo): el ramal baja de eje, termina en la
    // misma X y queda avisado; la cabecera no se mueve
    const drop = red.parameters.lateralOffset ?? 0;
    expect(drop).toBeGreaterThan(1);
    expect(res.notes.join(' ')).toMatch(/excéntrica/);
    expect(branch.ports[1].position.distanceTo(end.clone().add(v(0, 0, -drop)))).toBeLessThan(1e-3);
    expect(branch.ports[0].position.z).toBeCloseTo(-drop, 3);
    expect(g.reducerFlatSide(red.id)).toBe('abajo');
    expect(validateModel(g).filter((i) => ['JOINT_SIZE', 'JOINT_ANGLE'].includes(i.code))).toEqual([]);
  });
});
