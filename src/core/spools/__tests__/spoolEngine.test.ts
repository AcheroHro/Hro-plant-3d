import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PipingGraph } from '../../graph/PipingGraph';
import { PcfImporter } from '../../importers/PcfImporter';
import { PcfExporter } from '../../exporters/PcfExporter';
import { computeSpools, spoolSheetText } from '../spoolEngine';
import { readFixtureText, loadSpec } from '../../../__tests__/fixtures';

describe('Spools', () => {
  it('L01 del skid ácido: corta en bridas, deja válvulas e instrumento como montaje', async () => {
    const spec = await loadSpec('AES-CS150-A53');
    const { graph } = PcfImporter.importFromPcf(readFixtureText('pcf/acido', 'L01.pcf'), spec);
    const r = computeSpools(graph);

    // Cada pieza de taller está en un solo spool; válvulas e instrumento no
    for (const c of graph.components.values()) {
      const inSpool = r.spoolOf.has(c.id);
      if (c.type === 'VALVE' || c.type === 'INSTRUMENT') expect(inSpool, c.parameters.description).toBe(false);
      else expect(inSpool, c.type).toBe(true);
    }
    // Ningún spool cruza una unión bridada
    for (const j of graph.joints.values()) {
      if (j.type !== 'FLANGED') continue;
      const a = graph.ports.get(j.portAId)!.componentId;
      const b = graph.ports.get(j.portBId)!.componentId;
      if (r.spoolOf.has(a) && r.spoolOf.has(b)) expect(r.spoolOf.get(a)).not.toBe(r.spoolOf.get(b));
    }
    expect(r.spools[0].id).toBe('SKA-L01-SP01');
    expect(r.spools.every((s) => s.cuts.length > 0)).toBe(true);
    // Montaje: las 8 válvulas, 1 instrumento y una junta por unión bridada
    expect(r.erection.filter((e) => e.type === 'VALVE').length).toBe(8);
    const flanged = Array.from(graph.joints.values()).filter((j) => j.type === 'FLANGED').length;
    expect(r.erection.filter((e) => e.type === 'GASKET').reduce((n, e) => n + e.quantity, 0)).toBe(flanged);
    // Soldaduras numeradas en orden y pulgadas-diámetro sumadas por spool
    expect(r.welds[0].number).toBe('SW-001');
    const total = r.spools.reduce((n, s) => n + s.weldInches, 0);
    expect(total).toBeCloseTo(r.welds.reduce((n, w) => n + w.nominalDiameter, 0), 6);
    expect(spoolSheetText(r.spools[0])).toContain('SPOOL SKA-L01-SP01');
  });

  it('una soldadura de campo parte el spool y FFW suma el sobrelargo al corte', async () => {
    const spec = await loadSpec('AES-CS150-A53');
    const g = new PipingGraph('AES-CS150-A53', 2);
    g.activeLineNumber = 'L-100';
    const r1 = g.routeTurnWithElbow(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1000, 0, 0),
      new THREE.Vector3(1000, 1000, 0),
      spec.findPipe(2)!,
      spec.findElbow(2, 90)!
    );
    expect(computeSpools(g).spools).toHaveLength(1);

    const before = computeSpools(g).spools[0].cuts.find((c) => c.componentId === r1.incomingPipe.id)!.cutLengthMm;
    g.setFieldWeld(r1.jointIn.id, 'FFW', 150);
    const r = computeSpools(g);
    expect(r.spools).toHaveLength(2);
    expect(r.spools.map((s) => s.id)).toEqual(['L-100-SP01', 'L-100-SP02']);
    const fw = r.welds.find((w) => w.kind === 'FFW')!;
    expect(fw.number).toBe('FFW-001');
    expect(fw.spoolIds).toHaveLength(2);
    const cut = r.spools.flatMap((s) => s.cuts).find((c) => c.componentId === r1.incomingPipe.id)!;
    expect(cut.cutLengthMm).toBeCloseTo(before + 150, 6);

    // Se guarda con el modelo
    const copy = new PipingGraph();
    copy.deserialize(JSON.parse(JSON.stringify(g.serialize())));
    expect(computeSpools(copy).spools).toHaveLength(2);

    g.setFieldWeld(r1.jointIn.id, null);
    expect(computeSpools(g).spools).toHaveLength(1);
  });

  it('PCF Isogen: spool por pieza, soldaduras de campo, y vuelven al importar', async () => {
    const spec = await loadSpec('AES-CS150-A53');
    const g = new PipingGraph('AES-CS150-A53', 2);
    g.activeLineNumber = 'L-200';
    const r1 = g.routeTurnWithElbow(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1000, 0, 0),
      new THREE.Vector3(1000, 1000, 0),
      spec.findPipe(2)!,
      spec.findElbow(2, 90)!
    );
    g.setFieldWeld(r1.jointIn.id, 'FW');
    const iso = PcfExporter.exportToPcf(g, { target: 'isogen' });
    expect(iso).toContain('SPOOL-IDENTIFIER L-200-SP01');
    expect(iso).toContain('SPOOL-IDENTIFIER L-200-SP02');
    expect(iso).toMatch(/SKEY WF\r\n/);

    // Plant no recibe nada de spools
    const plant = PcfExporter.exportToPcf(g);
    expect(plant).not.toContain('SPOOL-IDENTIFIER');

    const back = PcfImporter.importFromPcf(iso, spec).graph;
    expect(computeSpools(back).welds.filter((w) => w.kind === 'FW')).toHaveLength(1);
  });
});
