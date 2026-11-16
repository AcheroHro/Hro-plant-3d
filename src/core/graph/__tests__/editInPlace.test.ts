import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadSpec } from '../../../__tests__/fixtures';
import { PipingGraph, isFaceEnd } from '../PipingGraph';
import { validateModel } from '../../validation/validateModel';
import { substituteOptions } from '../../../ui/substituteOptions';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const len = (c: { ports: { position: THREE.Vector3 }[] }) => c.ports[0].position.distanceTo(c.ports[1].position);

/** Caño, codo, caño, válvula bridada y un caño de 1000 mm después de la brida de salida (4", RCI1) */
async function line() {
  const spec = await loadSpec('RCI1');
  const g = new PipingGraph('RCI1', 4);
  const pipe = spec.findPipe(4)!;
  const turn = g.routeTurnWithElbow(v(0, 0, 0), v(3000, 0, 0), v(3000, 3000, 0), pipe, spec.findElbow(4, 90)!);
  const valve = spec.findValve(4, undefined, { connectToEndType: 'PL' })!;
  const flange = spec.findFlange(4, undefined, { connectToEndType: 'PL' })!;
  const asm = g.addValveAssembly(turn.outgoingPipe.ports[1], valve, { flangeSpec: flange, gasketSpec: spec.findGasket(4), boltSetSpec: spec.findBoltSet(4) });
  const out = asm.outPort;
  const after = g.addPipe(out.position, out.position.clone().addScaledVector(out.direction, 1000), pipe);
  g.connectPorts(out.id, after.ports[0].id);
  return { spec, g, turn, asm, after };
}

describe('Cambios en el lugar', () => {
  it('sustituye una brida WN por una SO: la cara no se mueve y el caño que sigue compensa', async () => {
    const { spec, g, asm, after } = await line();
    const outFlange = asm.flanges[asm.flanges.length - 1];
    const options = substituteOptions(outFlange, spec);
    const so = options.find((o) => o.label.includes('SO'));
    expect(so).toBeDefined();
    expect(options.some((o) => o.familyId === outFlange.parameters.familyId)).toBe(false);

    const face = outFlange.ports.find((p) => isFaceEnd(p))!;
    const facePos = face.position.clone();
    const farEnd = after.ports[1].position.clone();
    const oldSpan = len(outFlange);
    const oldPipe = len(after);

    g.swapFlange(outFlange.id, spec.findFlange(4, undefined, { familyId: so!.familyId })!);
    expect(outFlange.parameters.skey).toBe('FLSO');
    expect(face.position.distanceTo(facePos)).toBeLessThan(1e-6);
    expect(after.ports[1].position.distanceTo(farEnd)).toBeLessThan(1e-6);
    expect(len(after)).toBeCloseTo(oldPipe + oldSpan - len(outFlange), 3);
    expect(after.parameters.cutLength).toBeCloseTo(len(after), 3);
    // La unión con el caño sigue cerrada
    const pipeSide = outFlange.ports.find((p) => p !== face)!;
    expect(pipeSide.position.distanceTo(after.ports[0].position)).toBeLessThan(1e-6);
    expect(pipeSide.plantEndType).toBe('SO');
  });

  it('no sustituye la brida si el caño que sigue quedaría demasiado corto', async () => {
    const { spec, g, turn } = await line();
    // Brida SO al final de un caño corto, y se pide pasarla a WN (76 mm de largo)
    const so = spec.listFamilies('FLANGE', 4).find((f) => f.skey === 'FLSO')!;
    const wn = spec.listFamilies('FLANGE', 4).find((f) => f.skey === 'FLWN')!;
    const free = turn.incomingPipe.ports[0];
    const flg = g.addFlange(free, spec.findFlange(4, undefined, { familyId: so.familyId })!);
    g.updatePipeLength(turn.incomingPipe.id, 30, 'end');
    expect(() => g.swapFlange(flg.id, spec.findFlange(4, undefined, { familyId: wn.familyId })!)).toThrow(/no entra/);
    expect(flg.parameters.skey).toBe('FLSO');
  });

  it('cambia el cara a cara de una válvula: la entrada queda, el caño después de la brida compensa y se avisa', async () => {
    const { g, asm, after } = await line();
    const valve = asm.valve;
    const spec = valve.parameters.faceToFace!;
    const inlet = valve.ports[0].position.clone();
    const farEnd = after.ports[1].position.clone();
    const oldPipe = len(after);

    g.setValveFaceToFace(valve.id, spec + 40);
    expect(len(valve)).toBeCloseTo(spec + 40, 3);
    expect(valve.ports[0].position.distanceTo(inlet)).toBeLessThan(1e-6);
    expect(after.ports[1].position.distanceTo(farEnd)).toBeLessThan(1e-6);
    expect(len(after)).toBeCloseTo(oldPipe - 40, 3);
    expect(valve.parameters.specFaceToFace).toBeCloseTo(spec, 3);
    expect(validateModel(g).some((i) => i.code === 'VALVE_LENGTH')).toBe(true);

    // Se guarda y vuelve
    const copy = new PipingGraph('RCI1', 4);
    copy.deserialize(g.serialize());
    expect(copy.components.get(valve.id)!.parameters.specFaceToFace).toBeCloseTo(spec, 3);

    g.setValveFaceToFace(valve.id);
    expect(len(valve)).toBeCloseTo(spec, 3);
    expect(len(after)).toBeCloseTo(oldPipe, 3);
    expect(valve.parameters.specFaceToFace).toBeUndefined();
    expect(validateModel(g).some((i) => i.code === 'VALVE_LENGTH')).toBe(false);
  });
});

describe('Cotas del soporte', () => {
  it('mide hasta el centro del codo y hasta la cara de la brida, y se corre a la medida escrita', async () => {
    const { supportDimensions, moveSupportTo } = await import('../supportDimensions');
    const { g, turn } = await line();
    // Caño de salida del codo: de la cara del codo hacia +Y, termina en la brida de la válvula
    const pipe = turn.outgoingPipe;
    const mark = g.addSupport(pipe.id, 500, 'APOYO');
    const dims = supportDimensions(g, mark)!;
    const elbowFace = pipe.ports[0].position;
    // Hacia el codo: hasta el vértice (3000, 0, 0); hacia adelante: hasta la cara de la brida
    expect(dims.back.label).toContain('codo');
    expect(dims.back.to.distanceTo(v(3000, 0, 0))).toBeLessThan(0.01);
    expect(dims.back.distanceMm).toBeCloseTo(mark.position.y, 3);
    expect(dims.back.roomMm).toBeCloseTo(mark.position.distanceTo(elbowFace), 3);
    expect(dims.ahead.label).toContain('brida');
    const total = dims.back.distanceMm + dims.ahead.distanceMm;

    expect(moveSupportTo(g, mark, 'back', 1200)).toBeNull();
    const after = supportDimensions(g, mark)!;
    expect(after.back.distanceMm).toBeCloseTo(1200, 3);
    expect(after.back.distanceMm + after.ahead.distanceMm).toBeCloseTo(total, 3);
    expect(g.supportHost(mark)?.id).toBe(pipe.id);

    // No puede meterse en el codo ni pasar la brida
    expect(moveSupportTo(g, mark, 'back', 10)).toMatch(/No entra/);
    expect(moveSupportTo(g, mark, 'ahead', -5)).toMatch(/positiva/);
    expect(moveSupportTo(g, mark, 'back', total + 100)).toMatch(/No entra/);
    expect(supportDimensions(g, mark)!.back.distanceMm).toBeCloseTo(1200, 3);
  });

  it('se detiene en otro soporte y sigue por caños alineados', async () => {
    const { supportDimensions } = await import('../supportDimensions');
    const spec = await loadSpec('RCI1');
    const g = new PipingGraph('RCI1', 4);
    const pipe = spec.findPipe(4)!;
    // Dos caños soldados en línea: la cota pasa por la soldadura
    const p1 = g.addPipe(v(0, 0, 0), v(1000, 0, 0), pipe);
    const p2 = g.addPipe(v(1000, 0, 0), v(2500, 0, 0), pipe);
    g.connectPorts(p1.ports[1].id, p2.ports[0].id);
    const a = g.addSupport(p1.id, 400, 'APOYO');
    let dims = supportDimensions(g, a)!;
    expect(dims.ahead.label).toBe('boca libre');
    expect(dims.ahead.distanceMm).toBeCloseTo(2100, 3);
    expect(dims.back.distanceMm).toBeCloseTo(400, 3);

    const b = g.addSupport(p2.id, 700, 'GUIA');
    g.updateSupport(b.id, { tag: 'PS-2' });
    dims = supportDimensions(g, a)!;
    expect(dims.ahead.label).toBe('soporte PS-2');
    expect(dims.ahead.distanceMm).toBeCloseTo(1300, 3);
  });
});

describe('Elevación de una pieza', () => {
  it('baja un tramo horizontal y el caño vertical que lo ata se estira', async () => {
    const { applyElevation, planElevation, pieceElevation } = await import('../elevation');
    const spec = await loadSpec('RCI1');
    const g = new PipingGraph('RCI1', 4);
    // Horizontal a EL 0, codo y vertical hasta EL 2000
    const turn = g.routeTurnWithElbow(v(0, 0, 0), v(3000, 0, 0), v(3000, 0, 2000), spec.findPipe(4)!, spec.findElbow(4, 90)!);
    const vertical = turn.outgoingPipe;
    const top = vertical.ports[1].position.clone();
    const before = len(vertical);
    const plan = planElevation(g, turn.incomingPipe.id, -300);
    expect(typeof plan).not.toBe('string');
    if (typeof plan === 'string') return;
    expect([...plan.moveIds].sort()).toEqual([turn.incomingPipe.id, turn.elbow.id].sort());
    expect(plan.stretch).toHaveLength(1);
    applyElevation(g, plan);
    expect(pieceElevation(turn.incomingPipe)).toBeCloseTo(-300, 3);
    expect(turn.elbow.ports[0].position.z).toBeCloseTo(-300, 3);
    expect(vertical.ports[1].position.distanceTo(top)).toBeLessThan(1e-6);
    expect(len(vertical)).toBeCloseTo(before + 300, 3);
    expect(vertical.parameters.cutLength).toBeCloseTo(before + 300, 3);
    // La unión del codo con el vertical sigue cerrada
    expect(turn.elbow.ports[1].position.distanceTo(vertical.ports[0].position)).toBeLessThan(1e-6);

    // Subir demasiado: el vertical quedaría corto y no se hace nada
    expect(planElevation(g, turn.incomingPipe.id, 2500)).toMatch(/quedaría/);
    expect(planElevation(g, vertical.id, 100)).toMatch(/vertical/);
  });

  it('una válvula en un tramo vertical se desliza: un caño se acorta y el otro se alarga', async () => {
    const { applyElevation, planElevation } = await import('../elevation');
    const spec = await loadSpec('RCI1');
    const g = new PipingGraph('RCI1', 4);
    const pipe = spec.findPipe(4)!;
    const low = g.addPipe(v(0, 0, 0), v(0, 0, 1500), pipe);
    const valve = spec.findValve(4, undefined, { connectToEndType: 'PL' })!;
    const flange = spec.findFlange(4, undefined, { connectToEndType: 'PL' })!;
    const asm = g.addValveAssembly(low.ports[1], valve, { flangeSpec: flange, gasketSpec: spec.findGasket(4), boltSetSpec: spec.findBoltSet(4) });
    const out = asm.outPort;
    const high = g.addPipe(out.position, out.position.clone().addScaledVector(out.direction, 1000), pipe);
    g.connectPorts(out.id, high.ports[0].id);
    const lowLen = len(low);
    const highLen = len(high);
    const z0 = (asm.valve.ports[0].position.z + asm.valve.ports[1].position.z) / 2;

    const plan = planElevation(g, asm.valve.id, z0 + 120);
    if (typeof plan === 'string') throw new Error(plan);
    expect(plan.moveIds.has(asm.valve.id)).toBe(true);
    expect(plan.moveIds.has(low.id) || plan.moveIds.has(high.id)).toBe(false);
    applyElevation(g, plan);
    expect(len(low)).toBeCloseTo(lowLen + 120, 3);
    expect(len(high)).toBeCloseTo(highLen - 120, 3);
    expect(low.ports[0].position.z).toBeCloseTo(0, 6);
  });
});
