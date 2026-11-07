import { describe, it, expect, beforeAll } from 'vitest';
import { SpecDatabaseReader } from '../SpecDatabaseReader';

describe('SpecDatabaseReader - Ingesta de Catálogo y Consultas SQL', () => {
  let reader: SpecDatabaseReader;

  beforeAll(async () => {
    reader = await SpecDatabaseReader.create();
  });

  it('Debe consultar cañería recta (PIPE) retornando OD y espesor real exactos (anti-truco ND)', () => {
    const pipe2 = reader.findPipe(2, 'CS150');
    expect(pipe2).not.toBeNull();
    // Requisito estricto: Diámetro exterior real (60.3 mm), NO nominal (50 o 2)
    expect(pipe2?.outerDiameter).toBeCloseTo(60.3, 1);
    expect(pipe2?.wallThickness).toBeCloseTo(3.91, 2);
    expect(pipe2?.schedule).toBe('SCH 40');
    expect(pipe2?.endType).toBe('BW');
  });

  it('Debe consultar codo de 90° (ELBOW 90 LR) con take-off y radio ASME B16.9', () => {
    const elbow2 = reader.findElbow(2, 90, 'CS150');
    expect(elbow2).not.toBeNull();
    expect(elbow2?.nominalDiameter).toBe(2);
    expect(elbow2?.outerDiameter).toBeCloseTo(60.3, 1);
    expect(elbow2?.angle).toBe(90);
    // Para 2" Radio Largo (1.5 x D = 1.5 x 50.8 = 76.2 mm)
    expect(elbow2?.radius).toBeCloseTo(76.2, 1);
    expect(elbow2?.takeOff).toBeCloseTo(76.2, 1);
    expect(elbow2?.endType).toBe('BW');
  });

  it('Debe consultar codo de 45° (ELBOW 45 LR) con take-off correcto', () => {
    const elbow45 = reader.findElbow(2, 45, 'CS150');
    expect(elbow45).not.toBeNull();
    expect(elbow45?.angle).toBe(45);
    expect(elbow45?.takeOff).toBeCloseTo(35.0, 1);
  });

  it('Debe consultar Te igual (TEE STRAIGHT) retornando cotas Run y Branch', () => {
    const tee2 = reader.findTee(2, 'CS150');
    expect(tee2).not.toBeNull();
    expect(tee2?.runTakeOff).toBeCloseTo(63.5, 1);
    expect(tee2?.branchTakeOff).toBeCloseTo(63.5, 1);
  });

  it('Debe consultar Brida con cuello (FLANGE WN RF CL 150) con cara a cara y círculo de pernos', () => {
    const flg2 = reader.findFlange(2, 'CS150');
    expect(flg2).not.toBeNull();
    expect(flg2?.faceToFace).toBeCloseTo(63.5, 1);
    expect(flg2?.boltCircle).toBeCloseTo(120.7, 1);
    expect(flg2?.boltHoles).toBe(4);
  });

  it('Debe consultar Reducción Concéntrica (REDUCER CONCENTRIC)', () => {
    const red3to2 = reader.findReducer(3, 2, 'CS150');
    expect(red3to2).not.toBeNull();
    expect(red3to2?.nominalDiameter).toBe(3);
    expect(red3to2?.reducedNominalDiameter).toBe(2);
    expect(red3to2?.faceToFace).toBeCloseTo(88.9, 1);
  });

  it('Debe listar todos los diámetros nominales disponibles en la especificación', () => {
    const diameters = reader.getAvailableNominalDiameters('CS150');
    expect(diameters).toContain(0.5);
    expect(diameters).toContain(1);
    expect(diameters).toContain(2);
    expect(diameters).toContain(3);
    expect(diameters).toContain(4);
  });

  it('Debe reconstruir el lector desde el JSON de la spec (caché offline)', () => {
    const copy = SpecDatabaseReader.fromCatalogData(JSON.parse(JSON.stringify(reader.catalog.data)));
    const pipe3 = copy.findPipe(3, 'CS150');
    expect(pipe3).not.toBeNull();
    expect(pipe3?.outerDiameter).toBeCloseTo(88.9, 1);
    expect(copy.isNativePlant3D).toBe(false);
  });

  it('Debe cargar e interpretar correctamente el archivo real RCI1.pspc de AutoCAD Plant 3D', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const pspcPath = path.resolve(process.cwd(), 'RCI1.pspc');
    if (fs.existsSync(pspcPath)) {
      const buffer = fs.readFileSync(pspcPath);
      const nativeReader = await SpecDatabaseReader.fromBuffer(buffer, 'RCI1');
      expect(nativeReader.specName).toBe('RCI1');

      const diameters = nativeReader.getAvailableNominalDiameters('RCI1');
      expect(diameters.length).toBeGreaterThan(0);

      // Buscar cañería de 2" o del primer diámetro disponible
      const testNd = diameters.includes(2) ? 2 : diameters[0];
      const pipe = nativeReader.findPipe(testNd, 'RCI1');
      expect(pipe).not.toBeNull();
      expect(pipe?.outerDiameter).toBeGreaterThan(0);
      expect(pipe?.wallThickness).toBeGreaterThan(0);

      // Buscar codo
      const elbow = nativeReader.findElbow(testNd, 90, 'RCI1');
      if (elbow) {
        expect(elbow.takeOff).toBeGreaterThan(0);
        expect(elbow.outerDiameter).toBeGreaterThan(0);
      }

      nativeReader.close();
    }
  });
});
