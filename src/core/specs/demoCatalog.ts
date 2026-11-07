import { CatalogPart, CatalogPort, PartCategory, SpecCatalogData, SPEC_CATALOG_FORMAT_VERSION } from './catalogTypes';
import { CS150_SPEC_DATA, SpecRecordSeed } from './defaultSpecData';

/**
 * Catálogo demo integrado (no es una spec de Plant): se usa solo si no hay ninguna .pspc
 * cargada. Se convierte al mismo modelo que las specs reales para que haya un único camino.
 */

const CATEGORY: Record<string, PartCategory> = {
  Pipe: 'PIPE',
  Elbow: 'ELBOW',
  Tee: 'TEE',
  Flange: 'FLANGE',
  Valve: 'VALVE',
  Reducer: 'REDUCER',
  Cap: 'CAP'
};

const TEMPLATE: Record<PartCategory, string | undefined> = {
  PIPE: 'CPP',
  ELBOW: 'CPB',
  TEE: 'CPTS',
  FLANGE: 'CPFWR',
  VALVE: 'CPVI001000',
  REDUCER: 'CPJRC',
  CAP: 'CPC',
  CROSS: undefined,
  FLANGE_BLIND: undefined,
  OLET: undefined,
  COUPLING: undefined,
  GASKET: undefined,
  BOLT_SET: undefined,
  INSTRUMENT: undefined,
  SUPPORT: undefined,
  ACTUATOR: undefined,
  MISC: undefined
};

const SKEY: Partial<Record<PartCategory, string>> = {
  ELBOW: 'ELBW',
  TEE: 'TEBW',
  FLANGE: 'FLWN',
  VALVE: 'VTFL',
  REDUCER: 'RCBW',
  CAP: 'KABW'
};

function plantEnd(appEnd: string): string {
  if (appEnd === 'FLANG') return 'FL';
  if (appEnd === 'SW') return 'SW';
  if (appEnd === 'THD') return 'THDF';
  return 'BV';
}

function toPort(p: SpecRecordSeed['ports'][number], name: string, category: PartCategory): CatalogPort {
  return {
    name,
    nominalDiameter: p.nominalDiameter,
    nominalRaw: p.nominalDiameter,
    nominalUnit: 'in',
    outerDiameterMm: p.matchingPipeOD,
    endType: category === 'PIPE' ? 'PL' : plantEnd(p.endType),
    pressureClass: p.pressureClass,
    schedule: p.schedule.replace(/^SCH\s*/i, ''),
    wallThicknessMm: p.wallThickness
  };
}

function convert(rec: SpecRecordSeed): CatalogPart | null {
  const category = CATEGORY[rec.partType];
  if (!category) return null;
  const d = rec.dimensions;
  const params: Record<string, number> = {};
  let ports = rec.ports.map((p, i) => toPort(p, `S${i + 1}`, category));

  if (category === 'PIPE') params.L = -1;
  if (category === 'ELBOW') {
    const A = d.angle ?? 90;
    const T = d.takeOff1 ?? d.radius ?? 76.2;
    params.A = A;
    params.R = T / Math.tan((A * Math.PI) / 360);
  }
  if (category === 'TEE') {
    params.L1 = d.runTakeOff ?? 63.5;
    params.L2 = d.runTakeOff ?? 63.5;
    params.L3 = d.branchTakeOff ?? d.runTakeOff ?? 63.5;
    while (ports.length < 3) ports.push({ ...ports[0], name: `S${ports.length + 1}` });
  }
  if (category === 'FLANGE') {
    params.L = d.faceToFace ?? 63.5;
    params.B = Math.min(params.L * 0.35, 25);
    params.D1 = rec.ports[0].flangeOuterDiameter ?? rec.ports[0].matchingPipeOD * 2;
    // Convención de Plant: S1 = cara (FL), S2 = lado caño (BV)
    const pipeSide = ports.find((p) => p.endType !== 'FL') ?? ports[0];
    const face = ports.find((p) => p.endType === 'FL') ?? { ...ports[0], endType: 'FL' };
    ports = [
      { ...face, name: 'S1' },
      { ...pipeSide, name: 'S2' }
    ];
  }
  if (category === 'VALVE' || category === 'REDUCER' || category === 'CAP') params.L = d.faceToFace ?? 100;

  const schedule = rec.ports[0].schedule.replace(/^SCH\s*/i, '');
  return {
    pnpid: rec.pnpid,
    category,
    plantClass: rec.partType,
    familyId: `demo-${rec.partType.toLowerCase()}${category === 'ELBOW' ? `-${d.angle ?? 90}` : ''}`,
    familyDesc: rec.shortDescription.replace(/\s+[\d/.x"-]+"?$/, ''),
    sizeDesc: rec.shortDescription,
    shortDesc: rec.shortDescription,
    itemCode: rec.catalogId,
    pressureClass: rec.ports[0].pressureClass,
    schedule,
    wallThicknessMm: rec.ports[0].wallThickness,
    isoType: category === 'REDUCER' ? 'REDUCER-CONCENTRIC' : category,
    skey: SKEY[category],
    template: TEMPLATE[category],
    params,
    lengthScale: 1,
    ports,
    extra:
      category === 'ELBOW'
        ? { angleDeg: d.angle ?? 90, curveRadiusMm: d.radius }
        : category === 'FLANGE'
        ? { boltCircleMm: d.boltCircle, boltHoles: d.boltHoles }
        : {}
  };
}

export function buildDemoCatalog(specName = 'CS150'): SpecCatalogData {
  const parts = CS150_SPEC_DATA.map((r) => convert(r)).filter((p): p is CatalogPart => p !== null);
  return {
    formatVersion: SPEC_CATALOG_FORMAT_VERSION,
    specName,
    sourceFile: 'demo',
    isNative: false,
    kind: 'spec',
    description: 'Catálogo demo integrado (no es una spec de Plant 3D)',
    parts,
    warnings: ['Catálogo demo: para trabajar con Plant 3D cargá la .pspc del proyecto.']
  };
}
