import { describe, it, expect } from 'vitest';
import { PcfImporter } from '../../importers/PcfImporter';
import { diffStates, summarizeChanges } from '../changeLog';
import { readFixtureText } from '../../../__tests__/fixtures';

const load = () => PcfImporter.importFromPcf(readFixtureText('pcf/acido', 'L01.pcf')).graph;

describe('Registro de cambios de campo', () => {
  it('sin tocar nada no hay cambios', () => {
    const g = load();
    expect(diffStates(g.serialize(), g.serialize())).toEqual([]);
    expect(summarizeChanges([])).toMatch(/Sin cambios/);
  });

  it('alargar un caño: un cambio de largo y el resto en un solo renglón de piezas arrastradas', () => {
    const g = load();
    const base = g.serialize();
    const pipe = Array.from(g.components.values()).find((c) => c.type === 'PIPE' && Math.abs(c.ports[0].position.x + 18.94) < 1e-6)!;
    const before = pipe.ports[0].position.distanceTo(pipe.ports[1].position);
    g.updatePipeLength(pipe.id, before + 100);
    const changes = diffStates(base, g.serialize());
    const own = changes.find((c) => c.componentId === pipe.id && c.type === 'PIPE')!;
    expect(own.kind).toBe('moved');
    expect(own.details[0]).toBe(`Largo ${Math.round(before)} mm → ${Math.round(before + 100)} mm (+100 mm)`);
    const group = changes.find((c) => c.type === 'GROUP')!;
    expect(group.componentIds!.length).toBeGreaterThan(3);
    expect(group.details[0]).toMatch(/^Corridas 100 mm al Este/);
    expect(changes.filter((c) => c.kind === 'moved')).toHaveLength(2);
  });

  it('borrar, editar y marcar soldadura de campo', () => {
    const g = load();
    const base = g.serialize();
    const valves = Array.from(g.components.values()).filter((c) => c.type === 'VALVE');
    g.updateComponentMetadata(valves[0].id, { description: 'VALVULA CAMBIADA EN CAMPO' });
    g.removeComponent(valves[1].id);
    const joint = Array.from(g.joints.values()).find((j) => j.type === 'BUTTWELD')!;
    g.setFieldWeld(joint.id, 'FFW', 150);
    const changes = diffStates(base, g.serialize());
    expect(changes.map((c) => c.kind)).toEqual(['deleted', 'edited', 'fieldWeld']);
    expect(changes[1].details[0]).toMatch(/→ VALVULA CAMBIADA EN CAMPO$/);
    expect(changes[2].details[0]).toBe('Soldadura de campo FFW +150 mm');
    expect(summarizeChanges(changes)).toBe('1 borrada, 1 editada, 1 soldadura');
  });
});

describe('Informe de campo', () => {
  it('arma hojas A4 con la tabla de cambios, notas y fotos incrustadas en el PDF', async () => {
    const { buildFieldReport } = await import('../fieldReport');
    const { sheetsToPdf } = await import('../../drawings/pdfWriter');
    const g = load();
    const base = g.serialize();
    const valve = Array.from(g.components.values()).find((c) => c.type === 'VALVE')!;
    g.updateComponentMetadata(valve.id, { description: 'VALVULA CAMBIADA EN CAMPO' });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const sheets = buildFieldReport({
      projectName: 'Skid ácido',
      lineNumber: 'SKA-L01',
      changes: diffStates(base, g.serialize()),
      notes: Array.from({ length: 6 }, (_, i) => ({
        text: `Nota ${i + 1}: la válvula quedó girada respecto del plano y hay que revisar el soporte`,
        createdAt: Date.UTC(2026, 10, 7, 12),
        componentLabel: 'VALV. ESFERICA 2"',
        photos: [
          { jpeg, width: 1600, height: 1200 },
          { jpeg, width: 900, height: 1600 }
        ]
      }))
    });
    expect(sheets.length).toBeGreaterThan(1);
    const all = sheets.flatMap((s) => s.prims);
    expect(all.filter((p) => p.k === 'image')).toHaveLength(12);
    for (const s of sheets) {
      expect(s.width).toBe(210);
      for (const p of s.prims) {
        if (p.k === 'image') {
          expect(p.p[1]).toBeGreaterThanOrEqual(12);
          expect(p.p[1] + p.h).toBeLessThanOrEqual(297);
        }
      }
    }
    const texts = all.filter((p): p is Extract<typeof p, { k: 'text' }> => p.k === 'text').map((p) => p.s);
    expect(texts).toContain('Resumen: 1 editada · 6 notas');
    expect(texts).toContain(`Hoja ${sheets.length} / ${sheets.length}`);
    const pdf = Array.from(sheetsToPdf(sheets), (b) => String.fromCharCode(b)).join('');
    expect(pdf.match(/\/Subtype \/Image/g)).toHaveLength(12);
    expect(pdf).toContain('/Filter /DCTDecode');
    const xref = parseInt(pdf.match(/startxref\n(\d+)/)![1], 10);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
  });
});
