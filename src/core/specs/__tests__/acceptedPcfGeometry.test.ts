import { describe, it, expect } from 'vitest';
import { listFixtures, loadSpec, readFixtureText } from '../../../__tests__/fixtures';
import { dist, parsePcfBlocks } from '../../../__tests__/pcfBlocks';

/**
 * Fase 0: compara la ubicación de puertos que calcula la app con los PCF de los skids
 * AES 70730 que Plant 3D 2027 ya importó. Esos PCF salieron de tablas redondeadas
 * (pcf_lib.py), por eso la tolerancia general es 0,5 mm; las bridas SO tienen que dar exacto.
 */
describe('Geometría de plantillas contra PCF aceptados por Plant 3D', () => {
  it('bridas SO exactas y accesorios BW/SW dentro de 0,5 mm', async () => {
    const checked: string[] = [];
    for (const f of listFixtures('pcf/acido', '.pcf')) {
      const { header, blocks } = parsePcfBlocks(readFixtureText('pcf/acido', f));
      for (const b of blocks) {
        const spec = b.attrs['PIPING-SPEC']?.[0] ?? header['PIPING-SPEC'];
        const skey = b.attrs['SKEY']?.[0];
        if (!spec || !skey || !/^(FLSO|FLWN|ELSW|ELBW|TESW|TEBW|RCBW)$/.test(skey)) continue;
        // En CPVC los accesorios son piezas custom (bloques sin parámetros): quedan fuera de esta comparación
        if (spec === 'AES-CPVC80') continue;
        const reader = await loadSpec(spec);
        const e = b.points.filter((p) => p.key === 'END-POINT');
        const c = b.points.find((p) => p.key === 'CENTRE-POINT');
        const nd = e[0].bore!;
        const nd2 = e[1]?.bore;
        const rawAngle = parseFloat(b.attrs['ANGLE']?.[0] ?? '9000');
        const angle = rawAngle > 360 ? rawAngle / 100 : rawAngle;
        const parts = reader.catalog.data.parts.filter(
          (p) =>
            p.skey === skey &&
            Math.abs(p.ports[0].nominalDiameter - nd) < 0.001 &&
            (skey !== 'RCBW' || Math.abs((p.ports[1]?.nominalDiameter ?? 0) - (nd2 ?? 0)) < 0.001) &&
            (!skey.startsWith('EL') || Math.abs((p.params.A ?? p.extra.angleDeg ?? 90) - angle) < 1)
        );
        expect(parts.length, `${f} ${skey} ${nd}" no está en ${spec}`).toBeGreaterThan(0);
        const g = reader.catalog.geometry(parts[0]);
        const measured = c ? dist(c.xyz, e[0].xyz) : dist(e[0].xyz, e[1].xyz);
        const expected = (skey.startsWith('EL') ? g.takeOff : skey.startsWith('TE') ? g.runTakeOff : g.portSpan)!;
        const tol = skey === 'FLSO' ? 0.01 : 0.5;
        expect(
          Math.abs(measured - expected),
          `${f} ${skey} ${nd}": PCF ${measured.toFixed(2)} vs spec ${expected.toFixed(2)}`
        ).toBeLessThanOrEqual(tol);
        expect(g.confidence).toBe('verified');
        checked.push(skey);
      }
    }
    expect(checked.filter((s) => s === 'FLSO').length).toBeGreaterThanOrEqual(20);
    expect(checked.length).toBeGreaterThanOrEqual(30);
  });
});
