import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PipingGraph } from '../PipingGraph';
import { loadSpec } from '../../../__tests__/fixtures';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Etapa 3: edición con gestos (estirar, sustituir, mover y copiar) sobre la spec real */
describe('Edición del grafo', () => {
  /** Caño de 1000 en +X, codo de 90° hacia +Y, caño de 800 en +Y */
  async function lShape() {
    const spec = await loadSpec('AES-CS150-A53');
    const pipe = spec.findPipe(2)!;
    const elbow90 = spec.findElbow(2, 90)!;
    const g = new PipingGraph('AES-CS150-A53', 2);
    const r = g.routeTurnWithElbow(v(0, 0, 0), v(1000, 0, 0), v(1000, 800, 0), pipe, elbow90);
    return { spec, pipe, g, incoming: r.incomingPipe, elbow: r.elbow, outgoing: r.outgoingPipe };
  }

  /** Todas las uniones siguen con sus dos bocas en el mismo punto y enfrentadas */
  function expectJointsCoincide(g: PipingGraph) {
    for (const joint of g.joints.values()) {
      const a = g.ports.get(joint.portAId)!;
      const b = g.ports.get(joint.portBId)!;
      expect(a.position.distanceTo(b.position)).toBeCloseTo(joint.gapMm ?? 0, 3);
      expect(a.direction.dot(b.direction)).toBeCloseTo(-1, 4);
    }
  }

  it('estirar desde el final corre lo que sigue; desde el inicio deja quieto el resto', async () => {
    const { g, incoming, outgoing } = await lShape();
    const startLen = incoming.ports[0].position.distanceTo(incoming.ports[1].position);
    const endBefore = outgoing.ports[1].position.clone();

    // Anclado en el inicio: el codo y el caño de salida se corren 200 mm en +X
    g.updatePipeLength(incoming.id, startLen + 200, 'start');
    expect(outgoing.ports[1].position.x).toBeCloseTo(endBefore.x + 200, 3);
    expectJointsCoincide(g);

    // Anclado en el final: se mueve la boca libre del inicio y nada más
    const afterFirst = outgoing.ports[1].position.clone();
    g.updatePipeLength(incoming.id, startLen + 500, 'end');
    expect(incoming.ports[0].position.x).toBeCloseTo(-300, 3);
    expect(outgoing.ports[1].position.distanceTo(afterFirst)).toBeLessThan(1e-6);
    expect(incoming.parameters.cutLength).toBeCloseTo(startLen + 500, 3);
    expectJointsCoincide(g);
  });

  it('sustituir un codo de 90° por uno de 45° gira lo conectado a la salida y lo deja unido', async () => {
    const { spec, g, incoming, elbow, outgoing } = await lShape();
    const elbow45 = spec.findElbow(2, 45)!;
    const outLen = outgoing.ports[0].position.distanceTo(outgoing.ports[1].position);
    const inletBefore = elbow.ports[0].position.clone();

    expect(g.closesLoopThrough(elbow.id, elbow.ports[1].id)).toBe(false);
    expect(g.swapElbow(elbow.id, elbow45, 45)).not.toBeNull();

    expect(elbow.parameters.angle).toBeCloseTo(45, 3);
    expect(elbow.ports[0].position.distanceTo(inletBefore)).toBeLessThan(1e-6);
    // La salida ahora apunta a 45° entre +X y +Y
    expect(elbow.ports[1].direction.x).toBeCloseTo(Math.SQRT1_2, 4);
    expect(elbow.ports[1].direction.y).toBeCloseTo(Math.SQRT1_2, 4);
    // El caño de salida conserva su largo y sigue al codo
    expect(outgoing.ports[0].position.distanceTo(outgoing.ports[1].position)).toBeCloseTo(outLen, 3);
    expect(outgoing.ports[1].direction.x).toBeCloseTo(Math.SQRT1_2, 4);
    expect(incoming.ports[0].position.length()).toBeLessThan(1e-6);
    expectJointsCoincide(g);

    // Y vuelve a 90° quedando como estaba
    g.swapElbow(elbow.id, spec.findElbow(2, 90)!, 90);
    expect(outgoing.ports[1].position.distanceTo(v(1000, 800, 0))).toBeLessThan(0.01);
    expectJointsCoincide(g);
  });

  it('mover parte de la línea suelta las uniones con el resto; copiar duplica piezas y uniones', async () => {
    const { g, incoming, elbow, outgoing } = await lShape();
    expect(g.connectedRun(incoming.id).sort()).toEqual([incoming.id, elbow.id, outgoing.id].sort());

    // Copia de la línea entera 1000 mm más arriba
    const copies = g.duplicateComponents([incoming.id, elbow.id, outgoing.id], v(0, 0, 1000));
    expect(copies).toHaveLength(3);
    expect(g.components.size).toBe(6);
    expect(g.joints.size).toBe(4);
    expect(g.connectedRun(copies[0])).toHaveLength(3);
    expect(g.getOpenPorts()).toHaveLength(4);
    for (const id of copies) for (const p of g.components.get(id)!.ports) expect(p.position.z).toBeCloseTo(1000, 6);
    expectJointsCoincide(g);

    // Mover solo codo y caño de salida: se suelta la unión con el caño de entrada
    const detached = g.translateComponents([elbow.id, outgoing.id], v(0, 0, 300));
    expect(detached).toBe(1);
    expect(incoming.ports[1].connectedJointId).toBeUndefined();
    expect(outgoing.ports[1].position.z).toBeCloseTo(300, 6);
    expect(g.connectedRun(elbow.id)).toHaveLength(2);
    expectJointsCoincide(g);
  });

  it('detecta un circuito cerrado', async () => {
    const { pipe, g } = await lShape();
    const a = g.addPipe(v(0, 0, 500), v(500, 0, 500), pipe);
    const b = g.addPipe(v(500, 0, 500), v(900, 0, 500), pipe);
    const c = g.addPipe(v(900, 0, 500), v(1300, 0, 500), pipe);
    g.connectPorts(a.ports[1].id, b.ports[0].id);
    g.connectPorts(b.ports[1].id, c.ports[0].id);
    expect(g.closesLoopThrough(b.id, b.ports[1].id)).toBe(false);
    // Se fuerza una unión entre los dos extremos para simular el circuito
    const jointId = 'jnt_loop';
    g.joints.set(jointId, { id: jointId, type: 'BUTTWELD', portAId: a.ports[0].id, portBId: c.ports[1].id, position: v(0, 0, 500) });
    a.ports[0].connectedJointId = jointId;
    c.ports[1].connectedJointId = jointId;
    expect(g.closesLoopThrough(b.id, b.ports[1].id)).toBe(true);
  });
});
