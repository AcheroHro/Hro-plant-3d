import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PipingGraph } from '../PipingGraph';
import { loadSpec } from '../../../__tests__/fixtures';
import { detectPipingCollisions } from '../../../viewport/collision/collisionDetector';

/**
 * Fase 1: el grafo usando piezas reales de la spec AES-CS150-A53 del proyecto.
 */
describe('Grafo con spec real de Plant 3D', () => {
  async function setup() {
    const spec = await loadSpec('AES-CS150-A53');
    const so = spec.listFamilies('FLANGE', 2).find((f) => f.skey === 'FLSO')!;
    const gateRf = spec.listFamilies('VALVE', 2).find((f) => f.endTypes[0] === 'FL')!;
    return {
      spec,
      pipe: spec.findPipe(2)!,
      flange: spec.findFlange(2, undefined, { familyId: so.familyId })!,
      valve: spec.findValve(2, undefined, { familyId: gateRf.familyId })!,
      gasket: spec.findGasket(2, undefined, { pressureClass: '150' })!,
      bolts: spec.findBoltSet(2, undefined, { pressureClass: '150' })!
    };
  }

  it('caño + brida SO + válvula bridada + brida: orientación, junta entre caras y uniones de Plant', async () => {
    const { pipe, flange, valve, gasket, bolts } = await setup();
    const g = new PipingGraph('AES-CS150-A53', 2);
    const p = g.addPipe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(500, 0, 0), pipe);

    // Brida entra por el lado caño: la cara queda 4,064 mm más adelante
    const f1 = g.addFlange(p.ports[1], flange, gasket, bolts);
    expect(f1.ports[0].plantEndType).toBe('SO');
    expect(f1.ports[1].plantEndType).toBe('FL');
    expect(f1.ports[1].position.x).toBeCloseTo(504.064, 3);
    const j1 = g.joints.get(p.ports[1].connectedJointId!)!;
    expect(j1.type).toBe('SLIPON');

    // Válvula contra la cara: queda el espesor de la junta y la unión es bridada
    const v = g.addValve(f1.ports[1], valve, gasket, bolts);
    const t = gasket.gasketThicknessMm!;
    expect(t).toBeGreaterThan(1);
    expect(v.ports[0].position.x).toBeCloseTo(504.064 + t, 3);
    const j2 = g.joints.get(v.ports[0].connectedJointId!)!;
    expect(j2.type).toBe('FLANGED');
    expect(j2.gapMm).toBeCloseTo(t, 6);

    // Brida contra la otra cara de la válvula: entra cara a cara y deja libre el lado caño
    const f2 = g.addFlange(v.ports[1], flange, gasket, bolts);
    expect(f2.ports[0].plantEndType).toBe('FL');
    expect(f2.ports[1].plantEndType).toBe('SO');
    expect(f2.ports[1].position.x).toBeCloseTo(v.ports[1].position.x + t + 4.064, 3);

    // BOM: una junta y un juego de bulones por cada unión bridada
    const bom = g.calculateBillOfMaterials();
    const qty = (type: string) => bom.filter((b) => b.type === type).reduce((n, b) => n + b.quantity, 0);
    expect(qty('GASKET')).toBe(2);
    expect(qty('BOLT_SET')).toBe(2);
    expect(bom.find((b) => b.type === 'GASKET')!.description).toBe(gasket.shortDescription);
  });

  it('codo SW contra caño: unión socket y codo con su centro a fondo de encastre', async () => {
    const { spec, pipe } = await setup();
    const elbow = spec.findElbow(2, 90)!;
    const g = new PipingGraph('AES-CS150-A53', 2);
    const r = g.routeTurnWithElbow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1000, 0, 0), new THREE.Vector3(1000, 1000, 0), pipe, elbow);
    expect(r.jointIn.type).toBe('SOCKETWELD');
    expect(r.incomingPipe.ports[1].position.x).toBeCloseTo(1000 - 38.1, 2);
    expect(r.elbow.parameters.skey).toBe('ELSW');
    // Los dos caños quedan cerca por el codo corto: no es una colisión
    expect(detectPipingCollisions(g).hasCollision).toBe(false);
  });

  it('partir un caño con una válvula bridada agrega las dos bridas y conserva el largo total', async () => {
    const { pipe, flange, valve, gasket, bolts } = await setup();
    const g = new PipingGraph('AES-CS150-A53', 2);
    const p = g.addPipe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2000, 0, 0), pipe);
    const res = g.splitPipeWithFitting(p.id, valve, pipe, { gasketSpec: gasket, boltSetSpec: bolts, flangeSpec: flange })!;
    expect(res.extra).toHaveLength(2);
    expect(res.pipe2.ports[1].position.x).toBeCloseTo(2000, 6);
    const flanged = Array.from(g.joints.values()).filter((j) => j.type === 'FLANGED');
    expect(flanged).toHaveLength(2);
    expect(g.getOpenPorts()).toHaveLength(2);
  });

  it('serializa y restaura extremos de Plant y la junta entre caras', async () => {
    const { pipe, flange, valve, gasket, bolts } = await setup();
    const g = new PipingGraph('AES-CS150-A53', 2);
    const p = g.addPipe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(500, 0, 0), pipe);
    const f1 = g.addFlange(p.ports[1], flange, gasket, bolts);
    g.addValve(f1.ports[1], valve, gasket, bolts);
    const copy = new PipingGraph();
    copy.deserialize(JSON.parse(JSON.stringify(g.serialize())));
    const fl = Array.from(copy.joints.values()).find((j) => j.type === 'FLANGED')!;
    expect(fl.gapMm).toBeCloseTo(gasket.gasketThicknessMm!, 6);
    expect(Array.from(copy.ports.values()).some((pp) => pp.plantEndType === 'SO')).toBe(true);
  });
});
