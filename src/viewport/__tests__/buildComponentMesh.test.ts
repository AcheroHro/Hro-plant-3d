import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadSpec } from '../../__tests__/fixtures';
import { PipingGraph } from '../../core/graph/PipingGraph';
import { buildComponentObject, faceThicknessOf, valveShapeOf, valveStemDirection, PieceMaterials } from '../buildComponentMesh';
import { createValveGeometries } from '../geometries/valveGeometry';
import { createBlindFlangeGeometry, createStudsGeometry } from '../geometries/flangeGeometry';
import { createTeeGeometry } from '../geometries/teeGeometry';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const mat = () => new THREE.MeshBasicMaterial();
const materials: PieceMaterials = { pipe: mat(), fitting: mat(), tee: mat(), flange: mat(), valve: mat(), trim: mat() };
const ctx = { materials, pick: (m: THREE.Material) => m };
const box = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};
const worldBox = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
};

/** Etapa C: cada pieza se dibuja con su forma y las medidas de la spec */
describe('Geometría de válvulas por tipo', () => {
  it('compuerta bridada: bridas del diámetro real y volante a la altura de la spec', () => {
    const { body, trim } = createValveGeometries(114.3, 228.6, {
      kind: 'gate',
      ends: 'flanged',
      flangeDiameter: 228.6,
      flangeThickness: 23.9,
      actuator: 'wheel',
      actuatorHeight: 685.8,
      wheelDiameter: 298.5
    });
    const b = box(body);
    expect(b.min.z).toBeCloseTo(0, 1);
    expect(b.max.z).toBeCloseTo(228.6, 1);
    expect(b.max.x).toBeCloseTo(114.3, 0);
    const t = box(trim!);
    expect(t.max.y).toBeGreaterThan(685);
    expect(t.max.y).toBeLessThan(700);
    expect(t.max.x - t.min.x).toBeGreaterThan(298);
  });

  it('para soldar a tope termina en el diámetro del caño, sin bridas', () => {
    const { body } = createValveGeometries(114.3, 304.8, { kind: 'gate', ends: 'buttweld', actuator: 'wheel', actuatorHeight: 685.8 });
    const pos = body.getAttribute('position');
    let rEnd = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < 2) rEnd = Math.max(rEnd, Math.hypot(pos.getX(i), pos.getY(i)));
    expect(rEnd).toBeCloseTo(57.15, 0);
  });

  it('esférica: palanca a lo largo del caño; retención: sin accionamiento', () => {
    const ball = createValveGeometries(60.3, 177.8, { kind: 'ball', ends: 'flanged', actuator: 'lever', actuatorHeight: 92, leverLength: 165 });
    const lever = box(ball.trim!);
    expect(lever.max.z - lever.min.z).toBeGreaterThan(160);
    expect(lever.max.y).toBeLessThan(110);
    const check = createValveGeometries(60.3, 203.2, { kind: 'check', ends: 'flanged' });
    expect(check.trim).toBeNull();
  });

  it('mariposa wafer: un aro del espesor de la válvula', () => {
    const { body } = createValveGeometries(114.3, 53.8, { kind: 'butterfly', ends: 'wafer', flangeDiameter: 228.6, actuator: 'lever', actuatorHeight: 196 });
    const pos = body.getAttribute('position');
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 100) continue; // sin contar el cuello del vástago
      zMin = Math.min(zMin, pos.getZ(i));
      zMax = Math.max(zMax, pos.getZ(i));
    }
    expect(zMax - zMin).toBeCloseTo(53.8, 0);
    expect(box(body).max.x).toBeLessThan(114.3);
  });

  it('el vástago sale hacia arriba, y hacia un costado en una línea vertical', () => {
    expect(valveStemDirection(v(1, 0, 0)).z).toBeCloseTo(1);
    expect(valveStemDirection(v(0, -1, 0)).z).toBeCloseTo(1);
    const side = valveStemDirection(v(0, 0, 1));
    expect(Math.abs(side.z)).toBeLessThan(1e-6);
    expect(side.length()).toBeCloseTo(1);
    // En una línea con pendiente sigue perpendicular al caño
    const slope = v(1, 0, 0.1).normalize();
    expect(valveStemDirection(slope).dot(slope)).toBeCloseTo(0, 6);
  });
});

describe('Piezas armadas con la spec real (RCI1)', () => {
  async function setup(nd: number) {
    const spec = await loadSpec('RCI1');
    const g = new PipingGraph('RCI1', nd);
    const pipe = g.addPipe(v(0, 0, 0), v(1000, 0, 0), spec.findPipe(nd)!);
    return { spec, g, pipe };
  }

  it('la válvula de compuerta bridada lleva las medidas de la spec y el volante queda arriba', async () => {
    const { spec, g, pipe } = await setup(4);
    const valveSpec = spec.findValve(4, undefined, { connectToEndType: 'PL' })!;
    const flange = spec.findFlange(4, undefined, { connectToEndType: 'PL' })!;
    const asm = g.addValveAssembly(pipe.ports[1], valveSpec, { flangeSpec: flange, gasketSpec: spec.findGasket(4), boltSetSpec: spec.findBoltSet(4) });
    const shape = valveShapeOf(asm.valve);
    expect(shape).toMatchObject({ kind: 'gate', ends: 'flanged', actuator: 'wheel' });
    expect(shape.flangeDiameter).toBeCloseTo(228.6, 0);
    expect(shape.actuatorHeight).toBeCloseTo(685.8, 0);
    expect(faceThicknessOf(asm.valve)).toBeCloseTo(23.9, 0);

    const obj = buildComponentObject(asm.valve, ctx)!;
    const b = worldBox(obj);
    // El cuerpo queda entre sus dos bocas a lo largo de X (el volante puede pasarse)
    const bodyBox = worldBox(obj.children[0]);
    expect(bodyBox.min.x).toBeCloseTo(asm.valve.ports[0].position.x, 0);
    expect(bodyBox.max.x).toBeCloseTo(asm.valve.ports[1].position.x, 0);
    // El volante arriba (Z es la altura), no para abajo ni al costado
    expect(b.max.z).toBeGreaterThan(680);
    expect(b.min.z).toBeGreaterThan(-130);
    expect(Math.abs(b.max.y + b.min.y)).toBeLessThan(1);
  });

  it('cada tipo de válvula de la spec se reconoce y se puede dibujar', async () => {
    const { spec } = await setup(4);
    const kinds = new Set<string>();
    for (const fam of spec.listFamilies('VALVE', 4)) {
      const { g, pipe } = await setup(4);
      const valveSpec = spec.findValve(4, undefined, { familyId: fam.familyId })!;
      const valve = g.addValve(pipe.ports[1], valveSpec);
      const shape = valveShapeOf(valve);
      kinds.add(shape.kind!);
      const obj = buildComponentObject(valve, ctx)!;
      const b = worldBox(obj);
      expect(Number.isFinite(b.max.z), fam.familyDesc).toBe(true);
      if (/BW/.test(fam.familyDesc)) expect(shape.ends, fam.familyDesc).toBe('buttweld');
      if (/LUG|WFR/.test(fam.familyDesc)) expect(shape.ends, fam.familyDesc).toBe('wafer');
      if (shape.kind === 'check') expect(shape.actuator).toBe('none');
    }
    expect([...kinds].sort()).toEqual(['ball', 'butterfly', 'check', 'gate', 'globe', 'plug']);
  });

  it('válvula socket de 2": el cuerpo tapa los encastres', async () => {
    const { spec, g, pipe } = await setup(2);
    const fam = spec.listFamilies('VALVE', 2).find((f) => /Gate.*SW/.test(f.familyDesc))!;
    const valve = g.addValve(pipe.ports[1], spec.findValve(2, undefined, { familyId: fam.familyId })!);
    expect(valveShapeOf(valve).ends).toBe('socket');
    const b = worldBox(buildComponentObject(valve, ctx)!);
    expect(b.min.x).toBeLessThan(valve.ports[0].position.x - 5);
    expect(b.max.x).toBeGreaterThan(valve.ports[1].position.x + 5);
  });

  it('brida ciega: disco lleno del lado de afuera de la cara', async () => {
    const { spec, g, pipe } = await setup(4);
    const blindSpec = spec.catalog.find({ category: 'FLANGE_BLIND', nominalDiameter: 4 })!;
    const res = g.addBlindFlange(pipe.ports[1], blindSpec, {
      flangeSpec: spec.findFlange(4, undefined, { connectToEndType: 'PL' }),
      gasketSpec: spec.findGasket(4),
      boltSetSpec: spec.findBoltSet(4)
    });
    const face = res.blind.ports[0].position.x;
    const b = worldBox(buildComponentObject(res.blind, ctx)!);
    expect(b.min.x).toBeCloseTo(face, 1);
    expect(b.max.x).toBeCloseTo(face + 23.9, 0);
    expect(b.max.z).toBeCloseTo(114.3, 0);
  });

  it('olet: nace en la pared del caño y llega a la boca del ramal', async () => {
    const { spec, g, pipe } = await setup(4);
    const oletSpec = spec.findFitting({ partType: 'OLET', nominalDiameter: 4, reducedNominalDiameter: 1 });
    const olet = g.addBranchOnPipe(pipe.id, 500, v(0, 0, 1), spec.findPipe(1)!, oletSpec);
    expect(olet.type).toBe('OLET');
    const b = worldBox(buildComponentObject(olet, { ...ctx, hostOuterDiameter: 114.3 })!);
    expect(b.max.z).toBeCloseTo(olet.ports[0].position.z, 0);
    expect(b.min.z).toBeLessThan(57.15);
    expect(b.min.z).toBeGreaterThan(30);
  });

  it('te reducida: el ramal se dibuja con su diámetro', () => {
    const pos = createTeeGeometry(114.3, 6, 105, 98, 88.9).getAttribute('position');
    let w = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 90) w = Math.max(w, Math.abs(pos.getX(i)));
    expect(w).toBeGreaterThan(44);
    expect(w).toBeLessThan(50);
    const equal = createTeeGeometry(114.3, 6, 105, 105).getAttribute('position');
    let we = 0;
    for (let i = 0; i < equal.count; i++) if (equal.getY(i) > 90) we = Math.max(we, Math.abs(equal.getX(i)));
    expect(we).toBeGreaterThan(57);
  });
});

describe('Brida ciega y espárragos', () => {
  it('brida ciega: de la cara (z = 0) al espesor', () => {
    const b = box(createBlindFlangeGeometry(228.6, 23.9, 114.3));
    expect(b.min.z).toBeCloseTo(0, 3);
    expect(b.max.z).toBeCloseTo(23.9, 3);
    expect(b.max.x).toBeCloseTo(114.3, 1);
  });

  it('espárragos: repartidos en el círculo de bulones y del largo pedido', () => {
    const g = createStudsGeometry(190.5, 8, 15.9, 90);
    const b = box(g);
    expect(b.max.z - b.min.z).toBeCloseTo(90, 0);
    expect(b.max.x).toBeGreaterThan(190.5 / 2 - 15);
    expect(b.max.x).toBeLessThan(190.5 / 2 + 15);
  });
});
