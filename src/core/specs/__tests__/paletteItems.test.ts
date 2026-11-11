import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadSpec } from '../../../__tests__/fixtures';
import { buildPaletteItems, findPaletteItem, PaletteItem } from '../paletteItems';
import { isFaceEnd, PipingGraph } from '../../graph/PipingGraph';
import { PcfExporter } from '../../exporters/PcfExporter';
import { validateModel } from '../../validation/validateModel';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ids = (items: PaletteItem[]) => items.map((i) => i.id);

/** Etapa B: la paleta sale de la spec real */
describe('Paleta armada desde la spec (RCI1)', () => {
  it('en 4" ofrece lo que la spec tiene, agrupado y con variantes', async () => {
    const spec = await loadSpec('RCI1');
    const items = buildPaletteItems(spec, 4);
    const all = ids(items);
    for (const id of ['pipe', 'elbow:90', 'elbow:45', 'tee:run', 'tee:branch', 'tee:red', 'reducer:conc', 'reducer:ecc', 'flange:pair', 'flange:blind', 'cap']) {
      expect(all, id).toContain(id);
    }
    // Válvulas por tipo, con mariposa (solo existe de 3" para arriba)
    for (const kind of ['gate', 'globe', 'ball', 'check', 'butterfly', 'plug']) expect(all).toContain(`valve:${kind}`);
    // Dos bridas distintas: WN y SO
    const flanges = items.filter((i) => i.group === 'bridas' && i.insert.options?.familyId);
    expect(flanges.map((f) => f.label).sort()).toEqual(['Brida SO', 'Brida WN']);
    // Soldada a tope: la primera es la WN
    expect(flanges[0].label).toBe('Brida WN');

    // La concéntrica solo va a 3"; la excéntrica a 3" y a 2", con plano abajo y arriba
    const conc = findPaletteItem(items, 'reducer:conc')!;
    expect(conc.insert.options).toMatchObject({ targetNd: 3, eccentric: false });
    const ecc = findPaletteItem(items, 'reducer:ecc')!;
    const eccTargets = new Set(ecc.variants!.map((x) => x.insert.options!.targetNd));
    expect(eccTargets.has(2)).toBe(true);
    expect(eccTargets.has(3)).toBe(true);
    expect(ecc.variants!.some((x) => x.insert.options!.flat === 'arriba')).toBe(true);

    // Los grupos salen en orden
    const groups = items.map((i) => i.group);
    expect(groups.indexOf('tramo')).toBeLessThan(groups.indexOf('reducciones'));
    expect(groups.lastIndexOf('valvulas')).toBeLessThan(groups.indexOf('cierres'));
  });

  it('en 2" no inventa piezas: sin mariposa ni te reducida, y las reducciones son ampliaciones', async () => {
    const spec = await loadSpec('RCI1');
    const items = buildPaletteItems(spec, 2);
    const all = ids(items);
    expect(all).not.toContain('valve:butterfly');
    expect(all).not.toContain('tee:red');
    expect(all).toContain('coupling');
    const conc = findPaletteItem(items, 'reducer:conc')!;
    expect(conc.insert.options!.targetNd).toBe(3);
    const ecc = findPaletteItem(items, 'reducer:ecc')!;
    expect(ecc.variants!.map((x) => x.insert.options!.targetNd)).toContain(4);
    // El codo de 90° trae como variante el codo macho-hembra de la spec
    const elbow = findPaletteItem(items, 'elbow:90')!;
    expect(elbow.icon).toBe('elbow90');
    expect(elbow.variants!.some((x) => x.icon === 'elbowStreet')).toBe(true);
    // Válvula de compuerta: la primera es bridada y hay variantes para soldar y roscar
    const gate = findPaletteItem(items, 'valve:gate')!;
    expect(gate.badge).toBe('BRID');
    expect(gate.variants!.length).toBeGreaterThan(2);
  });

  it('cada botón y cada variante apunta a una pieza que la spec encuentra', async () => {
    const spec = await loadSpec('RCI1');
    for (const nd of [2, 3, 4, 6]) {
      const items = buildPaletteItems(spec, nd);
      for (const item of items.flatMap((i) => [i, ...(i.variants ?? [])])) {
        const o = item.insert.options ?? {};
        if (item.insert.type === 'REDUCER') {
          const red = spec.findReducer(nd, o.targetNd!, undefined, { familyId: o.familyId, eccentric: o.eccentric })!;
          expect(red.nominalDiameter, item.id).toBe(Math.max(nd, o.targetNd!));
          expect(red.reducedNominalDiameter, item.id).toBe(Math.min(nd, o.targetNd!));
          expect((red.lateralOffset ?? 0) > 0.01, item.id).toBe(!!o.eccentric);
        }
        if (item.insert.type === 'VALVE') {
          expect(spec.findValve(nd, undefined, { familyId: o.familyId })!.familyId, item.id).toBe(o.familyId);
        }
        if (item.insert.type === 'TEE' && o.branchNd) {
          expect(spec.findTee(nd, undefined, { branchDiameter: o.branchNd })!.reducedNominalDiameter, item.id).toBe(o.branchNd);
        }
      }
    }
  });

  it('otra spec, otra paleta: CS150 suma la brida socket en 2"', async () => {
    const spec = await loadSpec('CS150');
    const labels = buildPaletteItems(spec, 2)
      .filter((i) => i.group === 'bridas')
      .map((i) => i.label);
    expect(labels).toContain('Brida SW');
    expect(labels).toContain('Brida SO');
  });
});

describe('Piezas nuevas de la paleta en el grafo', () => {
  async function setup(nd: number) {
    const spec = await loadSpec('RCI1');
    const g = new PipingGraph('RCI1', nd);
    const pipe = g.addPipe(v(0, 0, 0), v(1000, 0, 0), spec.findPipe(nd)!);
    return { spec, g, pipe };
  }

  it('excéntrica plano abajo y plano arriba', async () => {
    const { spec, g, pipe } = await setup(4);
    const red = spec.findReducer(4, 2, undefined, { eccentric: true })!;
    const offset = red.lateralOffset!;
    expect(offset).toBeGreaterThan(20);
    const down = g.addReducer(pipe.ports[1], red, false, false);
    expect(down.ports[1].position.z).toBeCloseTo(-offset, 2);
    // Plano abajo: los fondos de caño coinciden
    expect(down.ports[1].position.z - down.ports[1].outerDiameter / 2).toBeCloseTo(-pipe.ports[1].outerDiameter / 2, 1);

    const second = await setup(4);
    const up = second.g.addReducer(second.pipe.ports[1], red, false, true);
    expect(up.ports[1].position.z).toBeCloseTo(offset, 2);
    expect(up.ports[1].position.z + up.ports[1].outerDiameter / 2).toBeCloseTo(second.pipe.ports[1].outerDiameter / 2, 1);
  });

  it('brida ciega sobre un caño: entra con brida y junta, y cierra la línea', async () => {
    const { spec, g, pipe } = await setup(4);
    const blindSpec = spec.catalog.find({ category: 'FLANGE_BLIND', nominalDiameter: 4 })!;
    expect(blindSpec.partType).toBe('FLANGE');
    const flange = spec.findFlange(4, undefined, { connectToEndType: 'PL' })!;
    const gasket = spec.findGasket(4);
    const res = g.addBlindFlange(pipe.ports[1], blindSpec, { flangeSpec: flange, gasketSpec: gasket, boltSetSpec: spec.findBoltSet(4) });
    expect(res.flange).not.toBeNull();
    expect(res.blind.ports).toHaveLength(1);
    expect(isFaceEnd(res.blind.ports[0])).toBe(true);
    const joint = g.joints.get(res.blind.ports[0].connectedJointId!)!;
    expect(joint.type).toBe('FLANGED');
    expect(joint.gapMm ?? 0).toBeCloseTo(gasket?.gasketThicknessMm ?? 0, 3);
    // Solo queda libre el arranque del caño
    expect(g.getOpenPorts()).toHaveLength(1);
    expect(validateModel(g).filter((i) => i.severity === 'error')).toHaveLength(0);

    const pcf = PcfExporter.exportToPcf(g, { target: 'plant' });
    const block = pcf.slice(pcf.indexOf('FLANGE-BLIND'));
    const ends = block.split('\n').filter((l: string) => l.trim().startsWith('END-POINT')).slice(0, 2);
    expect(ends).toHaveLength(2);
    expect(ends[0]).not.toBe(ends[1]);
    expect(block).toContain('SKEY FLBL');
  });

  it('brida ciega sin brida en la spec y sobre un caño: avisa en vez de armar algo mal', async () => {
    const { spec, g, pipe } = await setup(4);
    const blindSpec = spec.catalog.find({ category: 'FLANGE_BLIND', nominalDiameter: 4 })!;
    expect(() => g.addBlindFlange(pipe.ports[1], blindSpec, {})).toThrow();
  });

  it('cupla de la spec en 2": dos bocas en línea y la línea sigue', async () => {
    const { spec, g, pipe } = await setup(2);
    const cplSpec = spec.catalog.find({ category: 'COUPLING', nominalDiameter: 2 })!;
    expect(cplSpec.partType).toBe('COUPLING');
    const cpl = g.addCoupling(pipe.ports[1], cplSpec);
    expect(cpl.type).toBe('COUPLING');
    expect(cpl.ports[1].direction.x).toBeCloseTo(1);
    expect(cpl.ports[1].position.x).toBeGreaterThanOrEqual(1000);
    expect(cpl.ports[1].connectedJointId).toBeFalsy();
    expect(validateModel(g).filter((i) => i.severity === 'error')).toHaveLength(0);
    const pcf = PcfExporter.exportToPcf(g, { target: 'plant' });
    expect(pcf).toContain('COUPLING');
  });

  it('te reducida de 4" con ramal de 3"', async () => {
    const { spec, g, pipe } = await setup(4);
    const teeSpec = spec.findTee(4, undefined, { branchDiameter: 3 })!;
    const tee = g.addTee(pipe.ports[1], v(0, 0, 1), teeSpec);
    expect(tee.ports[1].nominalDiameter).toBe(4);
    expect(tee.ports[2].nominalDiameter).toBe(3);
    expect(tee.ports[2].outerDiameter).toBeCloseTo(88.9, 0);
  });
});
