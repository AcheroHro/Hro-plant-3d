import { describe, it, expect } from 'vitest';
import { listFixtures, readFixtureText } from '../../../__tests__/fixtures';
import { parsePcfBlocks } from '../../../__tests__/pcfBlocks';
import { PcfImporter } from '../PcfImporter';
import { PcfExporter } from '../../exporters/PcfExporter';

/**
 * Fase 0: ida y vuelta de PCF con archivos reales.
 *
 * Los tests marcados con `it.fails` documentan fallas conocidas que se arreglan en la
 * fase 2 (PCF sin pérdidas). Pasan mientras la falla exista; cuando se arregle, Vitest
 * avisa y hay que cambiarlos a `it`.
 */
const COMPONENT_BLOCKS = /^(PIPE|ELBOW|BEND|TEE|CROSS|FLANGE|FLANGE-BLIND|VALVE|INSTRUMENT|REDUCER-CONCENTRIC|REDUCER-ECCENTRIC|CAP|OLET|COUPLING)$/;

function loadAcido() {
  return listFixtures('pcf/acido', '.pcf').map((f) => ({ f, text: readFixtureText('pcf/acido', f) }));
}

describe('PCF reales: importación', () => {
  it('lee coordenadas y diámetros de los PCF del skid ácido', () => {
    const { graph } = PcfImporter.importFromPcf(readFixtureText('pcf/acido', 'L01.pcf'));
    expect(graph.components.size).toBeGreaterThan(5);
    const nds = new Set(Array.from(graph.components.values()).map((c) => c.parameters.nominalDiameter));
    expect(nds.has(2)).toBe(true);
  });

  it('PCF exportado por Plant con UNITS-BORE MM: DN100 se lee como 4"', () => {
    const { graph } = PcfImporter.importFromPcf(readFixtureText('pcf', 'SampleIsoPreview.pcf'));
    const nds = new Set(Array.from(graph.components.values()).map((c) => c.parameters.nominalDiameter));
    expect(nds.has(4)).toBe(true);
  });

  it('no pierde OLET, INSTRUMENT ni COUPLING', () => {
    for (const { text } of loadAcido()) {
      const expected = parsePcfBlocks(text).blocks.filter((b) => COMPONENT_BLOCKS.test(b.type)).length;
      expect(PcfImporter.importFromPcf(text).componentCount).toBe(expected);
    }
  });
});

describe('PCF reales: reexportación', () => {
  const l01 = readFixtureText('pcf/acido', 'L01.pcf');
  const out = () => PcfExporter.exportToPcf(PcfImporter.importFromPcf(l01).graph, {});

  it('conserva el SKEY de cada pieza (VBFL no puede volver como VGFL)', () => {
    const skeysIn = parsePcfBlocks(l01).blocks.map((b) => b.attrs['SKEY']?.[0]).filter(Boolean);
    const skeysOut = parsePcfBlocks(out()).blocks
      .filter((b) => COMPONENT_BLOCKS.test(b.type))
      .map((b) => b.attrs['SKEY']?.[0])
      .filter(Boolean);
    expect(skeysOut).toEqual(skeysIn);
  });

  it('conserva ITEM-DESCRIPTION', () => {
    expect(out()).toContain('ITEM-DESCRIPTION VALV. ESFERICA 2" CL150 RF B16.10 pos.5');
  });

  it('escribe CRLF como pide Plant 3D', () => {
    expect(out()).toContain('\r\n');
  });

  it('no agrega bloques WELD/GASKET/BOLT para PCF to Pipe', () => {
    expect(out()).not.toMatch(/^(WELD|GASKET|BOLT)\r?$/m);
  });
});
