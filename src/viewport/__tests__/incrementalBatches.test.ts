import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadSpec } from '../../__tests__/fixtures';
import { PipingGraph } from '../../core/graph/PipingGraph';
import { IncrementalBatches } from '../incrementalBatches';
import { createModelMaterials, modelPieces } from '../modelPieces';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Una línea con varios codos, para tener piezas, soldaduras y una válvula bridada */
async function line() {
  const spec = await loadSpec('RCI1');
  const g = new PipingGraph('RCI1', 4);
  const pipe = spec.findPipe(4)!;
  const elbow = spec.findElbow(4, 90)!;
  const a = g.routeTurnWithElbow(v(0, 0, 0), v(3000, 0, 0), v(3000, 3000, 0), pipe, elbow);
  const b = g.routeTurnWithElbow(v(6000, 0, 0), v(9000, 0, 0), v(9000, 3000, 0), pipe, elbow);
  const valve = spec.findValve(4, undefined, { connectToEndType: 'PL' })!;
  const flange = spec.findFlange(4, undefined, { connectToEndType: 'PL' })!;
  g.addValveAssembly(b.outgoingPipe.ports[1], valve, { flangeSpec: flange, gasketSpec: spec.findGasket(4), boltSetSpec: spec.findBoltSet(4) });
  return { spec, g, pipe, a, b };
}

const materials = createModelMaterials();
const specsOf = (g: PipingGraph) => modelPieces(g, { materials, visibleIds: null, colliding: new Set(), colorOf: () => null });

/** Triángulos que se dibujan de verdad (los apagados son degenerados: todos sus índices iguales) */
function drawnTriangles(batches: THREE.Mesh[]): number {
  let n = 0;
  for (const b of batches) {
    const idx = b.geometry.index!.array;
    for (let t = 0; t < idx.length; t += 3) if (!(idx[t] === idx[t + 1] && idx[t + 1] === idx[t + 2])) n++;
  }
  return n;
}

/** Lo mismo, armando todo de cero: lo que tendría que verse */
function freshTriangles(g: PipingGraph): number {
  const fresh = new IncrementalBatches(() => 1);
  const n = drawnTriangles(fresh.update(specsOf(g)).batches);
  fresh.dispose();
  return n;
}

const pick = (batches: THREE.Mesh[], from: THREE.Vector3, to: THREE.Vector3) => {
  const ray = new THREE.Raycaster(from, to.clone().sub(from).normalize());
  return ray.intersectObjects(batches, true).find((h) => h.object.userData?.componentId)?.object.userData.componentId as string | undefined;
};

describe('Mallas fusionadas que se actualizan por partes', () => {
  it('sin cambios no se rearma nada; una edición rearma solo lo que tocó', async () => {
    const { g, spec, pipe, a } = await line();
    const inc = new IncrementalBatches();
    const first = inc.update(specsOf(g));
    const total = specsOf(g).length;
    expect(inc.lastStats).toMatchObject({ built: total, consolidated: true });
    expect(drawnTriangles(first.batches)).toBe(freshTriangles(g));

    inc.update(specsOf(g));
    expect(inc.lastStats).toMatchObject({ built: 0, changed: 0, consolidated: false });

    // Agregar un caño al final: se arman el caño y su soldadura, nada más
    const end = a.outgoingPipe.ports[1];
    const added = g.addPipe(end.position.clone(), end.position.clone().add(v(0, 1500, 0)), pipe);
    const after = inc.update(specsOf(g));
    expect(inc.lastStats.built).toBeLessThanOrEqual(3);
    expect(inc.lastStats.consolidated).toBe(false);
    expect(drawnTriangles(after.batches)).toBe(freshTriangles(g));
    // El caño nuevo se puede tocar
    const mid = added.ports[0].position.clone().lerp(added.ports[1].position, 0.5);
    expect(pick(after.batches, mid.clone().add(v(0, 0, 3000)), mid)).toBe(added.id);
    inc.dispose();
    void spec;
  });

  it('cambiar el largo de un caño apaga la versión vieja en la malla grande; deshacer la vuelve a prender sin rearmar', async () => {
    const { g, a } = await line();
    const inc = new IncrementalBatches();
    inc.update(specsOf(g));
    const target = a.incomingPipe;
    const oldLength = target.parameters.cutLength!;
    const before = g.serialize();
    const [o0, o1] = [target.ports[0].position.clone(), target.ports[1].position.clone()];

    g.updatePipeLength(target.id, oldLength - 1000, 'end');
    // Un punto del tramo viejo que el tramo nuevo ya no cubre
    const now = g.components.get(target.id)!;
    const seg = new THREE.Line3(now.ports[0].position, now.ports[1].position);
    const gone = [0.05, 0.1, 0.2, 0.3, 0.7, 0.8, 0.9, 0.95]
      .map((t) => o0.clone().lerp(o1, t))
      .find((q) => seg.closestPointToPoint(q, true, new THREE.Vector3()).distanceTo(q) > 50)!;
    expect(gone).toBeDefined();
    const edited = inc.update(specsOf(g));
    expect(inc.lastStats.consolidated).toBe(false);
    expect(drawnTriangles(edited.batches)).toBe(freshTriangles(g));
    // Donde estaba el tramo que se acortó ya no hay caño
    expect(pick(edited.batches, gone.clone().add(v(0, 0, 3000)), gone)).toBeUndefined();

    // Deshacer: el grafo vuelve al estado anterior y las piezas a su firma de antes
    g.deserialize(before);
    const undone = inc.update(specsOf(g));
    // Las piezas que arma el grafo de nuevo se reconocen por su firma: nada se rearma y todo
    // vuelve a la malla grande
    expect(inc.lastStats).toMatchObject({ built: 1, changed: 0, consolidated: false });
    expect(drawnTriangles(undone.batches)).toBe(freshTriangles(g));
    expect(pick(undone.batches, gone.clone().add(v(0, 0, 3000)), gone)).toBe(target.id);
    inc.dispose();
  });

  it('cuando los cambios crecen se reagrupa todo en una malla grande', async () => {
    const { g, pipe, a } = await line();
    const inc = new IncrementalBatches(() => 2);
    inc.update(specsOf(g));
    let port = a.outgoingPipe.ports[1];
    for (let i = 0; i < 3; i++) {
      const p = g.addPipe(port.position.clone(), port.position.clone().add(v(0, 0, 500)), pipe);
      port = p.ports[1];
    }
    const res = inc.update(specsOf(g));
    expect(inc.lastStats.consolidated).toBe(true);
    expect(res.batches.length).toBeGreaterThan(0);
    expect(drawnTriangles(res.batches)).toBe(freshTriangles(g));

    // Borrar una pieza: se apaga en la malla grande, sin rearmar nada
    g.removeComponent(port.componentId);
    const removed = inc.update(specsOf(g));
    expect(inc.lastStats).toMatchObject({ built: 0, consolidated: false });
    expect(drawnTriangles(removed.batches)).toBe(freshTriangles(g));
    inc.dispose();
  });
});
