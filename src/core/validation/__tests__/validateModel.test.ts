import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PipingGraph } from '../../graph/PipingGraph';
import { loadSpec } from '../../../__tests__/fixtures';
import { countIssues, validateModel } from '../validateModel';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Etapa 6: avisos de validación sobre la spec real */
describe('Validación del modelo', () => {
  async function setup() {
    const spec = await loadSpec('AES-CS150-A53');
    const g = new PipingGraph('AES-CS150-A53', 2);
    return { spec, g, pipe: spec.findPipe(2)!, elbow: spec.findElbow(2, 90)! };
  }

  it('una línea bien armada solo avisa de sus bocas libres', async () => {
    const { g, pipe, elbow } = await setup();
    g.routeTurnWithElbow(v(0, 0, 0), v(1000, 0, 0), v(1000, 800, 0), pipe, elbow);
    const issues = validateModel(g);
    expect(countIssues(issues)).toEqual({ error: 0, warning: 0, info: 2 });
    expect(issues.every((i) => i.code === 'OPEN_PORT')).toBe(true);
  });

  it('marca niple corto, caño más largo que la tira y tramos separados', async () => {
    const { g, pipe } = await setup();
    const short = g.addPipe(v(0, 0, 0), v(80, 0, 0), pipe);
    const long = g.addPipe(v(0, 1000, 0), v(7500, 1000, 0), pipe);
    const issues = validateModel(g);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('SHORT_NIPPLE');
    expect(codes).toContain('LONG_PIPE');
    expect(codes).toContain('SEPARATE_RUNS');
    expect(issues.find((i) => i.code === 'SHORT_NIPPLE')!.componentIds).toEqual([short.id]);
    expect(issues.find((i) => i.code === 'LONG_PIPE')!.componentIds).toEqual([long.id]);
    // Lo más grave va primero
    expect(issues[0].severity).toBe('warning');
    expect(issues[issues.length - 1].severity).toBe('info');
  });

  it('marca uniones quebradas, con diámetros distintos y choques', async () => {
    const { spec, g, pipe } = await setup();
    const a = g.addPipe(v(0, 0, 0), v(1000, 0, 0), pipe);
    // 4° de quiebre: entra en la tolerancia de unión del grafo pero no es una pendiente normal
    const rad = THREE.MathUtils.degToRad(4);
    const b = g.addPipe(v(1000, 0, 0), v(1000 + 1000 * Math.cos(rad), 1000 * Math.sin(rad), 0), pipe);
    g.connectPorts(a.ports[1].id, b.ports[0].id);
    const big = g.addPipe(v(0, 0, 0), v(-500, 0, 0), spec.findPipe(4)!);
    g.connectPorts(a.ports[0].id, big.ports[0].id);

    const issues = validateModel(g, { collidingIds: [b.id] });
    const kink = issues.find((i) => i.code === 'JOINT_ANGLE')!;
    expect(kink.severity).toBe('warning');
    expect(kink.title).toContain('4.0°');
    const size = issues.find((i) => i.code === 'JOINT_SIZE')!;
    expect(size.severity).toBe('error');
    expect(size.componentIds.sort()).toEqual([a.id, big.id].sort());
    expect(issues[0].code).toBe('COLLISION');
    expect(issues[0].componentIds).toEqual([b.id]);
  });

  it('una pendiente del 2% no es una unión quebrada; una derivación sin caño sí es un error', async () => {
    const { spec, g, pipe } = await setup();
    const a = g.addPipe(v(0, 0, 0), v(1000, 0, 0), pipe);
    const b = g.addPipe(v(1000, 0, 0), v(2000, 0, -20), pipe);
    g.connectPorts(a.ports[1].id, b.ports[0].id);
    expect(validateModel(g).some((i) => i.code === 'JOINT_ANGLE')).toBe(false);

    const stub = g.addBranchOnPipe(a.id, 500, v(0, 0, 1), spec.findPipe(1)!, null);
    expect(validateModel(g).some((i) => i.code === 'ORPHAN_BRANCH')).toBe(false);
    g.removeComponent(a.id);
    const orphan = validateModel(g).find((i) => i.code === 'ORPHAN_BRANCH')!;
    expect(orphan.severity).toBe('error');
    expect(orphan.componentIds).toEqual([stub.id]);
  });
});
