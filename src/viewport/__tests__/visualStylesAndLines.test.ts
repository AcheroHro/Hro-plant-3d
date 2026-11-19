import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PipingGraph } from '../../core/graph/PipingGraph';
import { isolatedIds } from '../../store/usePipingStore';
import { createModelMaterials } from '../modelPieces';
import { colorForLine, colorHexCss } from '../spoolColors';

function pipeGraph(lines: string[]): { graph: PipingGraph; ids: string[] } {
  const graph = new PipingGraph('CS150', 2);
  const pipeSpec = {
    pnpid: 1,
    partType: 'PIPE' as const,
    specCode: 'CS150',
    shortDescription: 'Pipe 2"',
    nominalDiameter: 2,
    outerDiameter: 60.3,
    wallThickness: 3.91,
    schedule: 'SCH 40',
    endType: 'BW' as const
  };
  const ids: string[] = [];
  lines.forEach((line, i) => {
    const comp = graph.addPipe(new THREE.Vector3(0, i * 500, 0), new THREE.Vector3(1000, i * 500, 0), pipeSpec);
    comp.parameters.lineNumber = line;
    ids.push(comp.id);
  });
  return { graph, ids };
}

describe('Estilos visuales y Gestor de Líneas', () => {
  it('setVisualStyle aplica Rayos X y Alámbrico a todos los materiales y a colores creados después', () => {
    const mats = createModelMaterials();
    const pipe = mats.pieces.pipe as THREE.MeshStandardMaterial;

    expect(pipe.transparent).toBe(false);
    expect(pipe.wireframe).toBe(false);

    mats.setVisualStyle('xray');
    expect(pipe.transparent).toBe(true);
    expect(pipe.opacity).toBeLessThan(0.5);
    expect(pipe.depthWrite).toBe(false);

    // Un material de color creado mientras Rayos X está activo hereda el estilo
    const dyn = mats.color(0x38bdf8) as THREE.MeshStandardMaterial;
    expect(dyn.transparent).toBe(true);
    expect(dyn.depthWrite).toBe(false);

    mats.setVisualStyle('wireframe');
    expect(pipe.wireframe).toBe(true);
    expect(pipe.transparent).toBe(false);
    expect(dyn.wireframe).toBe(true);

    mats.setVisualStyle('outdoor');
    expect(pipe.wireframe).toBe(false);
    expect(pipe.transparent).toBe(false);
    expect(pipe.opacity).toBe(1);

    mats.dispose();
  });

  it('isolatedIds combina aislamiento y líneas ocultas tipo capas', () => {
    const { graph, ids } = pipeGraph(['L-100', 'L-200', 'L-300']);

    expect(isolatedIds(graph, null, new Set())).toBeNull();

    const hide200 = isolatedIds(graph, null, new Set(['L-200']));
    expect(hide200).toEqual(new Set([ids[0], ids[2]]));

    const only100 = isolatedIds(graph, { kind: 'line', line: 'L-100' }, new Set(['L-200']));
    expect(only100).toEqual(new Set([ids[0]]));

    const hiddenIsolated = isolatedIds(graph, { kind: 'line', line: 'L-200' }, new Set(['L-200']));
    expect(hiddenIsolated?.size).toBe(0);
  });

  it('colorForLine asigna colores distintos y consistentes por línea', () => {
    const lines = ['100-CS150-2"', '200-SS150-4"', '300-CS300-6"'];
    const c0 = colorForLine(lines[0], lines);
    const c1 = colorForLine(lines[1], lines);
    const c2 = colorForLine(lines[2], lines);
    expect(new Set([c0, c1, c2]).size).toBe(3);
    expect(colorHexCss(c0)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
