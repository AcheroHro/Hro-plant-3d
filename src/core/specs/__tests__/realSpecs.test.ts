import { describe, it, expect } from 'vitest';
import { loadSpec, readFixture, readFixtureText } from '../../../__tests__/fixtures';
import { SpecDatabaseReader } from '../SpecDatabaseReader';
import { readPspx } from '../pspxReader';
import { parseConnectorsConfig, resolveConnection } from '../connectionRules';

/**
 * Fase 0 / 1: el motor de specs contra archivos reales de Plant 3D 2027
 * (CS150 de ejemplo y las specs AES-* del proyecto PTA_TK_ACIDO_SODA).
 */
describe('Spec CS150 real (.pspc + .pspx)', () => {
  it('ofrece solo los diámetros que tienen caño', async () => {
    const cs = await loadSpec('CS150');
    const sizes = cs.getAvailableNominalDiameters();
    expect(sizes).toEqual([0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24]);
    expect(sizes).not.toContain(2.5);
    expect(cs.findPipe(2.5)).toBeNull();
  });

  it('caño 2": OD real, espesor de tabla B36.10 y descripción completa de Plant', async () => {
    const pipe = (await loadSpec('CS150')).findPipe(2)!;
    expect(pipe.outerDiameter).toBeCloseTo(60.325, 2);
    expect(pipe.wallThickness).toBeCloseTo(3.91, 2);
    expect(pipe.shortDescription).toBe('PIPE, SEAMLESS, 2" ND, PE, ASME B36.10');
    expect(pipe.plantEndTypes).toEqual(['PL', 'PL']);
  });

  it('codo 2": usa la prioridad de Plant (SW 3000, centro a fondo de encastre 38,1 mm)', async () => {
    const cs = await loadSpec('CS150');
    const elbow = cs.findElbow(2, 90)!;
    expect(elbow.skey).toBe('ELSW');
    expect(elbow.takeOff).toBeCloseTo(38.1, 2);
    expect(elbow.geometryConfidence).toBe('verified');
    expect(cs.listFamilies('ELBOW', 2)[0].plantPriority).toBe(0);
  });

  it('codo 3": LR soldado de la spec, take-off 114,3 mm', async () => {
    const elbow = (await loadSpec('CS150')).findElbow(3, 90)!;
    expect(elbow.skey).toBe('ELBW');
    expect(elbow.takeOff).toBeCloseTo(114.3, 2);
    expect(elbow.endType).toBe('BW');
  });

  it('codo 45 SW 2": L1 - I1 = 1"', async () => {
    expect((await loadSpec('CS150')).findElbow(2, 45)!.takeOff).toBeCloseTo(25.4, 2);
  });

  it('tee 3" igual y tee reductora 4"x3" con el ramal leído de la tabla Port', async () => {
    const cs = await loadSpec('CS150');
    const tee = cs.findTee(3)!;
    expect(tee.runTakeOff).toBeCloseTo(85.85, 2);
    expect(tee.branchTakeOff).toBeCloseTo(85.85, 2);
    const red = cs.findTee(4, undefined, { branchDiameter: 3 })!;
    expect(red.shortDescription).toContain('4"X3"');
    expect(red.reducedNominalDiameter).toBe(3);
    expect(red.reducedOuterDiameter).toBeCloseTo(88.9, 1);
    expect(red.branchTakeOff).toBeCloseTo(98.55, 2);
  });

  it('reducción: no inventa tamaños que la spec no tiene', async () => {
    const cs = await loadSpec('CS150');
    expect(cs.findReducer(3, 1.5)).toBeNull();
    const r = cs.findReducer(3, 2)!;
    expect(r.reducedOuterDiameter).toBeCloseTo(60.325, 2);
    expect(r.faceToFace).toBeCloseTo(88.9, 2);
    expect(r.skey).toBe('RCBW');
  });

  it('válvula: lista todas las familias y deja elegir una', async () => {
    const cs = await loadSpec('CS150');
    const fams = cs.listFamilies('VALVE', 2);
    expect(fams.length).toBeGreaterThan(10);
    expect(cs.findValve(2)!.plantEndTypes).toEqual(['FL', 'FL']);
    const ball = fams.find((f) => /Ball/.test(f.familyDesc) && f.endTypes[0] === 'BV')!;
    const v = cs.findValve(2, undefined, { familyId: ball.familyId })!;
    expect(v.familyDescription).toMatch(/Ball Valve/);
    expect(v.faceToFace).toBeCloseTo(215.9, 1);
  });

  it('la familia fijada en la paleta gana sobre la elección automática', async () => {
    const cs = await SpecDatabaseReader.fromCatalogData((await loadSpec('CS150')).catalog.data);
    const so = cs.listFamilies('FLANGE', 2).find((f) => f.skey === 'FLSO')!;
    cs.setPreferredFamily('FLANGE', so.familyId);
    expect(cs.findFlange(2)!.skey).toBe('FLSO');
    cs.setPreferredFamily('FLANGE', null);
  });

  it('junta y bulones de la clase de la brida, con el largo del bulón en la descripción', async () => {
    const cs = await loadSpec('CS150');
    const g = cs.findGasket(2, undefined, { pressureClass: '150' })!;
    expect(g.gasketThicknessMm).toBeCloseTo(3.175, 3);
    const b = cs.findBoltSet(2, undefined, { pressureClass: '150' })!;
    expect(b.boltSize).toBe('5/8"');
    expect(b.boltCount).toBe(4);
    expect(b.shortDescription).not.toContain('@@@');
  });
});

describe('Specs AES del proyecto', () => {
  it('brida SO: puerto del caño a L - I = 4,064 mm de la cara (regla probada en Plant)', async () => {
    const aes = await loadSpec('AES-CS150-A53');
    const so = aes.listFamilies('FLANGE', 2).find((f) => f.skey === 'FLSO')!;
    const flg = aes.findFlange(2, undefined, { familyId: so.familyId })!;
    expect(flg.faceToFace).toBeCloseTo(4.064, 3);
    expect(flg.plantEndTypes).toEqual(['FL', 'SO']);
  });

  it('reducción 3"x1-1/2": extremo chico con su OD real (48,26 mm)', async () => {
    const r = (await loadSpec('AES-CS150-A53')).findReducer(3, 1.5)!;
    expect(r.reducedNominalDiameter).toBe(1.5);
    expect(r.reducedOuterDiameter).toBeCloseTo(48.26, 2);
  });

  it('tee SW 2": centro a fondo de encastre 38,1 mm (ASME B16.11)', async () => {
    const tee = (await loadSpec('AES-CS150-A53')).findTee(2)!;
    expect(tee.runTakeOff).toBeCloseTo(38.1, 2);
    expect(tee.plantEndTypes).toEqual(['SW', 'SW', 'SW']);
  });

  it('las prioridades del .pspx apuntan a familias que existen en la .pspc (GUID bien leído)', async () => {
    const aes = await loadSpec('AES-CS150-A53');
    const ids = new Set(aes.catalog.data.parts.map((p) => p.familyId));
    const prios = aes.catalog.preferences!.priorities.flatMap((p) => p.familyIds);
    expect(prios.length).toBeGreaterThan(0);
    expect(prios.every((id) => ids.has(id))).toBe(true);
  });

  it('la tabla de ramales del .pspx se lee', async () => {
    const prefs = await readPspx(readFixture('specs', 'AES-CS150-A53.pspx'));
    expect(prefs.branchSymbols.length).toBeGreaterThan(0);
    expect(prefs.branchTable.length).toBeGreaterThan(0);
    expect(prefs.branchTable.every((e) => e.symbols.length > 0)).toBe(true);
  });

  it('el JSON de la spec sirve para reconstruirla sin SQLite (caché offline)', async () => {
    const aes = await loadSpec('AES-THD3000');
    const copy = SpecDatabaseReader.fromCatalogData(JSON.parse(JSON.stringify(aes.catalog.data)));
    expect(copy.getAvailableNominalDiameters()).toEqual(aes.getAvailableNominalDiameters());
    const nd = aes.getAvailableNominalDiameters()[0];
    expect(copy.findPipe(nd)?.outerDiameter).toBeCloseTo(aes.findPipe(nd)!.outerDiameter, 6);
  });
});

describe('Reglas de unión (DefaultConnectorsConfig.xml del proyecto)', () => {
  const rules = parseConnectorsConfig(readFixtureText('project', 'DefaultConnectorsConfig.xml'));

  it('lee las uniones del proyecto', () => {
    const names = rules.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['Buttweld', 'Socketweld', 'Threaded', 'Flanged', 'Slip', 'Glue']));
  });

  it('brida con brida lleva junta y bulones; caño con SW es socket; caño con SO es slip-on', () => {
    expect(resolveConnection({ endType: 'FL' }, { endType: 'FL' }, rules)).toMatchObject({
      jointType: 'FLANGED',
      hasGasket: true,
      hasBoltSet: true
    });
    expect(resolveConnection({ endType: 'PL' }, { endType: 'SW' }, rules).jointType).toBe('SOCKETWELD');
    expect(resolveConnection({ endType: 'SO' }, { endType: 'PL' }, rules).jointType).toBe('SLIPON');
    expect(resolveConnection({ endType: 'PPL' }, { endType: 'PSW' }, rules).jointType).toBe('GLUE');
  });

  it('marca extremos incompatibles (caño contra cara de brida)', () => {
    const r = resolveConnection({ endType: 'PL' }, { endType: 'FL' }, rules);
    expect(r.compatible).toBe(false);
    expect(r.rule).toBeNull();
  });
});
