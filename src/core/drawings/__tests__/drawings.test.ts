import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PipingGraph } from '../../graph/PipingGraph';
import { PcfImporter } from '../../importers/PcfImporter';
import { computeSpools } from '../../spools/spoolEngine';
import { buildIsoSheets } from '../isoSheet';
import { sheetsToPdf } from '../pdfWriter';
import { sheetToSvg } from '../svgWriter';
import { drawnLength } from '../isoLayout';
import { Sheet } from '../sheet';
import { readFixtureText, loadSpec } from '../../../__tests__/fixtures';

const texts = (s: Sheet, layer?: string) =>
  s.prims.filter((p): p is Extract<typeof p, { k: 'text' }> => p.k === 'text' && (!layer || p.layer === layer)).map((p) => p.s);

async function l01() {
  const spec = await loadSpec('AES-CS150-A53');
  return PcfImporter.importFromPcf(readFixtureText('pcf/acido', 'L01.pcf'), spec).graph;
}

describe('Isométricos', () => {
  it('L01: hoja de línea + una por spool, numeradas, con rótulo y lista de materiales', async () => {
    const g = await l01();
    const spools = computeSpools(g).spools;
    const sheets = buildIsoSheets(g, { project: 'SKID ACIDO', revision: 'B' });
    expect(sheets).toHaveLength(1 + spools.length);
    expect(sheets.map((s) => s.name)).toEqual(['Línea', ...spools.map((s) => s.id.replace(/^.*-(SP\d+)$/, '$1'))]);
    const t0 = texts(sheets[0]);
    expect(t0).toContain('ISOMÉTRICO DE LÍNEA');
    expect(t0).toContain('SKID ACIDO');
    expect(t0).toContain(`1 / ${sheets.length}`);
    expect(texts(sheets[sheets.length - 1])).toContain(`${sheets.length} / ${sheets.length}`);
    expect(t0.some((s) => s.startsWith('VALV. ESFERICA 2"'))).toBe(true);
    // Todo dentro de la hoja
    for (const s of sheets) {
      for (const p of s.prims) {
        const pts = p.k === 'line' ? [p.a, p.b] : p.k === 'poly' ? p.pts : p.k === 'circle' ? [p.c] : [p.p];
        for (const [x, y] of pts) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(s.width);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(s.height);
        }
      }
    }
  });

  it('las cotas muestran medidas reales: cara a cara de bridas SO en SP01 = 242 mm', async () => {
    const g = await l01();
    const sp01 = buildIsoSheets(g, { includeLine: false, spoolIds: ['SKA-L01-SP01'] })[0];
    expect(texts(sp01)).toContain('SPOOL SKA-L01-SP01');
    expect(texts(sp01, 'DIM')).toContain('242');
    // Corte del niple y sus soldaduras
    expect(texts(sp01)).toContain('N-01');
    expect(texts(sp01).filter((s) => /^W-0[12]$/.test(s))).toHaveLength(4); // en el dibujo y en la tabla
  });

  it('codo con soldadura de campo FFW: cotas a centro de codo y marca de campo', async () => {
    const spec = await loadSpec('AES-CS150-A53');
    const g = new PipingGraph('AES-CS150-A53', 2);
    g.activeLineNumber = 'L-300';
    const r = g.routeTurnWithElbow(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1000, 0, 0),
      new THREE.Vector3(1000, 0, 800),
      spec.findPipe(2)!,
      spec.findElbow(2, 90)!
    );
    g.setFieldWeld(r.jointOut.id, 'FFW', 100);
    const [line] = buildIsoSheets(g, { spoolIds: [] });
    const dims = texts(line, 'DIM');
    expect(dims).toContain('1000');
    // La soldadura de campo es punto de cota: 38 (centro del codo a la soldadura) + 762 = 800
    expect(dims).toContain('38');
    expect(dims).toContain('762');
    expect(texts(line, 'FIELD')).toContain('FFW-01 +100');
  });

  it('la isometría sin escala agranda lo corto y achica lo largo', () => {
    expect(drawnLength(6)).toBe(30);
    expect(drawnLength(3000)).toBeLessThan(500);
    expect(drawnLength(3000)).toBeGreaterThan(drawnLength(300));
  });

  it('PDF válido: tabla xref correcta, una página por hoja y acentos en WinAnsi', async () => {
    const g = await l01();
    const sheets = buildIsoSheets(g, { project: 'Regeneración ácido' });
    const pdf = sheetsToPdf(sheets);
    const text = Array.from(pdf, (b) => String.fromCharCode(b)).join('');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const xref = parseInt(text.match(/startxref\n(\d+)/)![1], 10);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const offsets = text.slice(xref).match(/(\d{10}) 00000 n/g)!.map((m) => parseInt(m, 10));
    offsets.forEach((o, i) => expect(text.slice(o, o + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
    expect(text).toContain(`/Count ${sheets.length}`);
    expect(text).toContain('(Regeneraci\xf3n \xe1cido)');
    expect(sheetToSvg(sheets[0])).toContain('<svg');
  });
});
