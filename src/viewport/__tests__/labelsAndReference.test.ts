import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadSpec } from '../../__tests__/fixtures';
import { PipingGraph } from '../../core/graph/PipingGraph';
import { buildModelLabels, formatElevation } from '../modelLabels';
import { parseDxfReference } from '../../core/importers/DxfReference';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Etapa D: etiquetas permanentes del modelo */
describe('Etiquetas del modelo', () => {
  it('una cota por caño, una elevación por nivel y el número de línea una sola vez', async () => {
    const spec = await loadSpec('RCI1');
    const g = new PipingGraph('RCI1', 4);
    g.activeLineNumber = '100-RCI1-4"';
    const pipeSpec = spec.findPipe(4)!;
    const elbow = spec.findElbow(4, 90)!;
    const turn = g.routeTurnWithElbow(v(0, 0, 1200), v(2000, 0, 1200), v(2000, 0, 2000), pipeSpec, elbow);
    const top = g.addPipe(v(3000, 0, 2500), v(3600, 0, 2500), pipeSpec);

    const labels = buildModelLabels(g);
    const cotas = labels.filter((l) => l.kind === 'cota');
    expect(cotas).toHaveLength(3);
    const first = cotas.find((l) => l.componentId === turn.incomingPipe.id)!;
    expect(first.text).toBe(String(Math.round(2000 - elbow.takeOff!)));
    expect(first.position.distanceTo(v((2000 - elbow.takeOff!) / 2, 0, 1200))).toBeLessThan(0.01);

    // Dos niveles horizontales (1200 y 2500); el tramo vertical no lleva elevación
    const elevs = labels.filter((l) => l.kind === 'elev').map((l) => l.text).sort();
    expect(elevs).toEqual(['EL +1200', 'EL +2500']);
    const lines = labels.filter((l) => l.kind === 'linea');
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('100-RCI1-4"');
    expect(lines[0].componentId).toBe(turn.incomingPipe.id);

    // Con una línea aislada solo se etiqueta lo que se ve
    expect(buildModelLabels(g, new Set([top.id])).filter((l) => l.kind === 'cota')).toHaveLength(1);
    expect(formatElevation(-350.4)).toBe('EL −350');
  });
});

const dxf = (lines: (string | number)[]) => lines.join('\n');

/** Etapa D: DXF de ejes y columnas como referencia de obra */
describe('Referencia de obra desde DXF', () => {
  const sample = dxf([
    0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 6, 0, 'ENDSEC',
    0, 'SECTION', 2, 'BLOCKS',
    0, 'BLOCK', 2, 'COL', 10, 0, 20, 0, 30, 0,
    0, 'LINE', 8, '0', 10, 0, 20, 0, 30, 0, 11, 1, 21, 0, 31, 0,
    0, 'ENDBLK',
    0, 'ENDSEC',
    0, 'SECTION', 2, 'ENTITIES',
    0, 'LINE', 8, 'EJES', 10, 0, 20, 0, 30, 0, 11, 6, 21, 0, 31, 0,
    0, 'LWPOLYLINE', 8, 'COLUMNAS', 90, 4, 70, 1, 10, 0, 20, 0, 10, 0.4, 20, 0, 10, 0.4, 20, 0.4, 10, 0, 20, 0.4,
    0, 'CIRCLE', 10, 3, 20, 3, 30, 0, 40, 0.5,
    0, 'INSERT', 2, 'COL', 10, 10, 20, 5, 30, 0, 41, 2, 42, 2, 50, 90,
    0, 'TEXT', 10, 0, 20, 0, 40, 0.2, 1, 'EJE A',
    0, 'ENDSEC',
    0, 'EOF'
  ]);

  it('lee líneas, polilíneas, círculos y bloques insertados; saltea los textos', () => {
    const ref = parseDxfReference(sample);
    expect(ref.scale).toBe(1000);
    expect(ref.scaleSource).toBe('dxf');
    expect(ref.segments.length / 6).toBe(1 + 4 + 32 + 1);
    expect(ref.skipped).toBe(1);
    expect(ref.truncated).toBe(false);
    // Eje
    expect(ref.segments.slice(0, 6)).toEqual([0, 0, 0, 6, 0, 0]);
    // La polilínea cerrada vuelve al primer punto
    expect(ref.segments.slice(24, 30)).toEqual([0, 0.4, 0, 0, 0, 0]);
    // Bloque: la línea de 1 de largo, a escala 2 y girada 90°, sale de (10, 5) hacia +Y
    const last = ref.segments.slice(-6);
    expect(last[0]).toBeCloseTo(10);
    expect(last[1]).toBeCloseTo(5);
    expect(last[3]).toBeCloseTo(10);
    expect(last[4]).toBeCloseTo(7);
    expect(ref.bounds!.max[0]).toBeCloseTo(10);
    expect(ref.bounds!.min[1]).toBeCloseTo(0);
  });

  it('sin unidades declaradas supone metros si el dibujo es chico, y avisa', () => {
    const ref = parseDxfReference(dxf([0, 'SECTION', 2, 'ENTITIES', 0, 'LINE', 10, 0, 20, 0, 11, 24, 21, 0, 0, 'ENDSEC', 0, 'EOF']));
    expect(ref.scaleSource).toBe('supuesta');
    expect(ref.scale).toBe(1000);
    const big = parseDxfReference(dxf([0, 'SECTION', 2, 'ENTITIES', 0, 'LINE', 10, 0, 20, 0, 11, 24000, 21, 0, 0, 'ENDSEC', 0, 'EOF']));
    expect(big.scale).toBe(1);
  });

  it('un DWG (binario) se rechaza con la indicación de guardarlo como DXF', () => {
    expect(() => parseDxfReference('AC1032\u0000\u0000\u0000binario')).toThrow(/DXF/);
  });
});
