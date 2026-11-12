import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadSpec } from '../../__tests__/fixtures';
import { PipingGraph } from '../../core/graph/PipingGraph';
import { buildComponentObject, PieceMaterials } from '../buildComponentMesh';
import { buildMeshBatches, ownerOfTriangle, setPieceHidden } from '../meshBatches';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const mat = () => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
const materials: PieceMaterials = { pipe: mat(), fitting: mat(), tee: mat(), flange: mat(), valve: mat(), trim: mat() };

/** Un modelo con un poco de todo: caños, codo, te, válvula bridada con sus bridas, reducción y tapa */
async function model() {
  const spec = await loadSpec('RCI1');
  const g = new PipingGraph('RCI1', 4);
  const pipeSpec = spec.findPipe(4)!;
  const turn = g.routeTurnWithElbow(v(0, 0, 0), v(3000, 0, 0), v(3000, 2000, 0), pipeSpec, spec.findElbow(4, 90)!);
  const valve = spec.findValve(4, undefined, { connectToEndType: 'PL' })!;
  const flange = spec.findFlange(4, undefined, { connectToEndType: 'PL' })!;
  const asm = g.addValveAssembly(turn.outgoingPipe.ports[1], valve, { flangeSpec: flange, gasketSpec: spec.findGasket(4), boltSetSpec: spec.findBoltSet(4) });
  const open = asm.flanges[1].ports.find((p) => !p.connectedJointId)!;
  const after = g.addPipe(open.position, open.position.clone().addScaledVector(open.direction, 800), pipeSpec);
  const tee = g.addTee(after.ports[1], v(0, 0, 1), spec.findTee(4)!);
  const run = tee.ports.find((p) => !p.connectedJointId && p.direction.z === 0)!;
  const p2 = g.addPipe(run.position, run.position.clone().addScaledVector(run.direction, 600), pipeSpec);
  g.addCap(p2.ports[1], spec.findCap(4)!);
  return g;
}

function buildAll(g: PipingGraph): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const comp of g.components.values()) {
    const obj = buildComponentObject(comp, { materials, pick: (m) => m, hostOuterDiameter: undefined });
    if (!obj) continue;
    obj.traverse((c) => (c.userData = { ...c.userData, componentId: comp.id }));
    out.push(obj);
  }
  return out;
}

const firstPiece = (hits: THREE.Intersection[]) => hits.find((h) => h.object.userData?.componentId);

describe('Mallas fusionadas', () => {
  it('una malla por material, con los mismos triángulos que las piezas sueltas', async () => {
    const g = await model();
    const loose = buildAll(g);
    let triangles = 0;
    let meshes = 0;
    const used = new Set<THREE.Material>();
    for (const o of loose)
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        meshes++;
        used.add(m.material as THREE.Material);
        triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
      });

    const { batches, rest } = buildMeshBatches(buildAll(g), (m) => m.userData.componentId ?? null);
    expect(rest).toHaveLength(0);
    expect(batches).toHaveLength(used.size);
    const merged = batches.reduce((n, b) => n + b.geometry.index!.count / 3, 0);
    expect(merged).toBe(triangles);
    // Muchas mallas sueltas pasan a ser una por material
    expect(meshes).toBeGreaterThan(batches.length);

    // La caja del modelo no cambia
    const group = (objs: THREE.Object3D[]) => {
      const gr = new THREE.Group();
      objs.forEach((o) => gr.add(o));
      return new THREE.Box3().setFromObject(gr);
    };
    const a = group(loose);
    const b = group(batches);
    expect(a.min.distanceTo(b.min)).toBeLessThan(1e-3);
    expect(a.max.distanceTo(b.max)).toBeLessThan(1e-3);
  });

  it('tocar el modelo elige la misma pieza que sin fusionar, desde muchos ángulos', async () => {
    const g = await model();
    const loose = buildAll(g);
    loose.forEach((o) => o.updateMatrixWorld(true));
    const { batches } = buildMeshBatches(buildAll(g), (m) => m.userData.componentId ?? null);

    const raycaster = new THREE.Raycaster();
    let compared = 0;
    for (const comp of g.components.values()) {
      const target = comp.ports.reduce((s, p) => s.add(p.position), new THREE.Vector3()).divideScalar(comp.ports.length);
      for (const from of [v(5000, 4000, 3000), v(-4000, 3000, 2500), v(1500, -5000, 4000), v(2000, 1000, -6000)]) {
        raycaster.set(from, target.clone().sub(from).normalize());
        const before = raycaster.intersectObjects(loose, true);
        const after = raycaster.intersectObjects(batches, true);
        const hb = firstPiece(before);
        const ha = firstPiece(after);
        expect(!!ha).toBe(!!hb);
        if (!hb || !ha) continue;
        expect(ha.distance).toBeCloseTo(hb.distance, 3);
        // Si dos piezas se tocan justo en ese punto (cara contra cara), cualquiera de las dos vale
        const tie = before.some((h) => h.object.userData?.componentId === ha.object.userData.componentId && Math.abs(h.distance - hb.distance) < 1e-3);
        expect(ha.object.userData.componentId === hb.object.userData.componentId || tie).toBe(true);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });

  it('lo que no se puede fusionar queda igual, y cada triángulo sabe de qué pieza es', () => {
    const shared = new THREE.MeshBasicMaterial();
    const a = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), shared);
    a.userData.componentId = 'A';
    const b = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), shared);
    b.position.set(100, 0, 0);
    b.userData.componentId = 'B';
    const multi = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), [shared, new THREE.MeshBasicMaterial()]);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([v(0, 0, 0), v(1, 1, 1)]));

    const { batches, rest } = buildMeshBatches([a, b, multi, line], (m) => m.userData.componentId ?? null);
    expect(batches).toHaveLength(1);
    expect(rest).toEqual([multi, line]);
    // 12 triángulos por cubo, A primero y B después
    expect(ownerOfTriangle(batches[0], 0)).toBe('A');
    expect(ownerOfTriangle(batches[0], 11)).toBe('A');
    expect(ownerOfTriangle(batches[0], 12)).toBe('B');

    const ray = new THREE.Raycaster(v(100, 0, 100), v(0, 0, -1));
    const hit = ray.intersectObjects(batches, true)[0];
    expect(hit.object.userData.componentId).toBe('B');
    expect(hit.distance).toBeCloseTo(95, 5);

    // Ocultar B (para dibujarla aparte, resaltada): sus triángulos se apagan y el rayo la saltea
    const index = batches[0].geometry.index!;
    const before = Array.from(index.array);
    expect(setPieceHidden(batches, 'B', true)).toEqual([batches[0]]);
    // Ocultarla de nuevo no cambia nada
    expect(setPieceHidden(batches, 'B', true)).toEqual([]);
    expect(Array.from(index.array.slice(36, 72)).every((i) => i === 0)).toBe(true);
    expect(Array.from(index.array.slice(0, 36))).toEqual(before.slice(0, 36));
    expect(ray.intersectObjects(batches, true)).toHaveLength(0);
    // Volver a mostrarla deja todo como estaba
    setPieceHidden(batches, 'B', false);
    expect(Array.from(index.array)).toEqual(before);
    expect(ray.intersectObjects(batches, true)[0].object.userData.componentId).toBe('B');
    expect(setPieceHidden(batches, 'nadie', true)).toEqual([]);
  });
});
