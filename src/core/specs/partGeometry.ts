import { valveKindFrom } from './valveKind';
import { CatalogPart } from './catalogTypes';
import { GeometryConfidence, PartVisualDims } from '../../types/piping';

export type { GeometryConfidence };

/**
 * Ubicación de los puertos de cada pieza según su plantilla de geometría de Plant 3D
 * (ContentGeometryTemplate + ContentGeometryParamDefinition).
 *
 * Plant guarda las medidas de cada pieza como parámetros de un script (CPB, CPTS,
 * CPFWR_F_SF...). Para que un PCF conecte al importarlo, los extremos tienen que caer
 * exactamente donde Plant pone los puertos de esa pieza. Las fórmulas de abajo salen
 * del significado de cada parámetro y se contrastaron con ASME B16.9 / B16.11 / B16.5
 * y con los PCF que Plant 3D 2027 ya aceptó conectados (skids AES 70730).
 *
 * Sistemas locales (mm):
 *  - Piezas en línea (caño, válvula, brida, reducción, cupla, junta): eje +X,
 *    S1 mira a -X, S2 mira a +X.
 *  - Codos: vértice en el origen, entra por -X (S1 en x = -T1), sale con el ángulo A en el plano XY.
 *  - Tees y cruces: centro en el origen, recorrido en X, ramal en +Y.
 *  - Olets: eje del cabezal en X por el origen, ramal en +Y.
 *  - Tapas y bridas ciegas: el puerto en el origen mirando a -X, el cuerpo hacia +X.
 */

export type PartShape =
  | 'pipe'
  | 'inline'
  | 'elbow'
  | 'tee'
  | 'cross'
  | 'olet'
  | 'cap'
  | 'flange'
  | 'blind'
  | 'gasket'
  | 'reducer'
  | 'valve'
  | 'none';

export interface PortGeom {
  name: string;
  position: [number, number, number];
  direction: [number, number, number];
}

export interface PartGeometry {
  shape: PartShape;
  ports: PortGeom[];
  confidence: GeometryConfidence;
  note?: string;
  /** Codos: vértice a puerto S1 / S2 (mm) */
  takeOff?: number;
  takeOff2?: number;
  angleDeg?: number;
  /** Radio de curvatura al eje (mm), solo visual */
  radiusMm?: number;
  /** Tees: centro a puertos del recorrido y del ramal (mm) */
  runTakeOff?: number;
  runTakeOff2?: number;
  branchTakeOff?: number;
  /** Piezas en línea: distancia entre S1 y S2 a lo largo del eje (mm) */
  portSpan?: number;
  /** Reducción excéntrica: corrimiento lateral del eje chico (mm) */
  lateralOffset?: number;
  /** Medidas para dibujar (mm) */
  visual: PartVisualDims;
}


const X: [number, number, number] = [1, 0, 0];
const NX: [number, number, number] = [-1, 0, 0];
const Y: [number, number, number] = [0, 1, 0];
const NY: [number, number, number] = [0, -1, 0];

function p(part: CatalogPart, key: string): number | undefined {
  const v = part.params[key];
  return v === undefined || !Number.isFinite(v) ? undefined : v * part.lengthScale;
}

/** Algunos parámetros usan -1 o -2 como "calcular automáticamente" */
function pos(v: number | undefined): number | undefined {
  return v !== undefined && v > 0 ? v : undefined;
}

function od(part: CatalogPart, portIndex = 0): number {
  return part.ports[portIndex]?.outerDiameterMm || part.ports[0]?.outerDiameterMm || 50;
}

function inline(
  part: CatalogPart,
  s1: number,
  s2: number,
  confidence: GeometryConfidence,
  shape: PartShape,
  visual: PartGeometry['visual'],
  note?: string
): PartGeometry {
  return {
    shape,
    ports: [
      { name: part.ports[0]?.name || 'S1', position: [s1, 0, 0], direction: NX },
      { name: part.ports[1]?.name || 'S2', position: [s2, 0, 0], direction: X }
    ],
    portSpan: s2 - s1,
    confidence,
    note,
    visual
  };
}

function elbowGeom(
  part: CatalogPart,
  angleDeg: number,
  t1: number,
  t2: number,
  radius: number,
  confidence: GeometryConfidence,
  note?: string
): PartGeometry {
  const a = (angleDeg * Math.PI) / 180;
  const out: [number, number, number] = [Math.cos(a), Math.sin(a), 0];
  return {
    shape: 'elbow',
    ports: [
      { name: part.ports[0]?.name || 'S1', position: [-t1, 0, 0], direction: NX },
      { name: part.ports[1]?.name || 'S2', position: [out[0] * t2, out[1] * t2, 0], direction: out }
    ],
    takeOff: t1,
    takeOff2: t2,
    angleDeg,
    radiusMm: radius,
    confidence,
    note,
    visual: { bodyDiameter: od(part) }
  };
}

function teeGeom(
  part: CatalogPart,
  l1: number,
  l2: number,
  l3: number,
  confidence: GeometryConfidence,
  note?: string
): PartGeometry {
  return {
    shape: 'tee',
    ports: [
      { name: part.ports[0]?.name || 'S1', position: [-l1, 0, 0], direction: NX },
      { name: part.ports[1]?.name || 'S2', position: [l2, 0, 0], direction: X },
      { name: part.ports[2]?.name || 'S3', position: [0, l3, 0], direction: Y }
    ],
    runTakeOff: l1,
    runTakeOff2: l2,
    branchTakeOff: l3,
    confidence,
    note,
    visual: { bodyDiameter: od(part) }
  };
}

/** Geometría de puertos de una pieza de catálogo */
export function computePartGeometry(part: CatalogPart): PartGeometry {
  const t = (part.template || '').toUpperCase();
  const D = od(part);

  // ---------------------------------------------------------------- caño
  if (part.category === 'PIPE') {
    const L = pos(p(part, 'L')) ?? 1000;
    return inline(part, 0, L, 'verified', 'pipe', { bodyStart: 0, bodyEnd: L, bodyDiameter: D });
  }

  // ---------------------------------------------------------------- codos
  if (part.category === 'ELBOW') {
    const A = part.params.A ?? part.extra.angleDeg ?? 90;
    const R = pos(p(part, 'R')) ?? part.extra.curveRadiusMm ?? 1.5 * D;
    if (t.endsWith('_OFOF')) {
      // SW / roscado: L = centro a extremo de la pieza, I = encastre. El caño llega al fondo del encastre.
      const L1 = p(part, 'L1') ?? R * Math.tan((A * Math.PI) / 360);
      const L2 = p(part, 'L2') ?? L1;
      const t1 = L1 - (p(part, 'I1') ?? 0);
      const t2 = L2 - (p(part, 'I2') ?? 0);
      return elbowGeom(part, A, t1, t2, R, 'verified', 'Centro a fondo de encastre (ASME B16.11)');
    }
    if (t.endsWith('_OMOF')) {
      // Codo macho-hembra (street ell): pata macho completa, pata hembra hasta el fondo del encastre
      const t1 = p(part, 'L1') ?? D;
      const t2 = (p(part, 'L2') ?? D) - (p(part, 'I') ?? 0);
      return elbowGeom(part, A, t1, t2, R, 'approximate', 'Codo macho-hembra: patas distintas, sin verificar en Plant');
    }
    // BW: el puerto está a R·tan(A/2) del vértice
    const T = R * Math.tan((A * Math.PI) / 360);
    const known = t === 'CPB' || t === '';
    return elbowGeom(part, A, T, T, R, known ? 'verified' : 'standard', known ? undefined : `Plantilla ${t} tratada como codo soldado`);
  }

  // ---------------------------------------------------------------- tees y cruces
  if (part.category === 'TEE') {
    const L1 = p(part, 'L1') ?? p(part, 'L') ?? 1.25 * D;
    const L2 = p(part, 'L2') ?? L1;
    const L3 = p(part, 'L3') ?? L1;
    if (t.endsWith('_OFOFOF')) {
      // B16.11: en esta plantilla L1/L2/L3 ya son centro a fondo de encastre (2" = 1.50")
      return teeGeom(part, L1, L2, L3, 'verified', 'Centro a fondo de encastre (ASME B16.11)');
    }
    if (t === 'CPTS' || t === '') return teeGeom(part, L1, L2, L3, 'verified');
    if (t === 'CPTY') {
      const g = teeGeom(part, L1, L2, L3, 'approximate', 'Ramal en Y: se dibuja a 90°');
      return g;
    }
    return teeGeom(part, L1, L2, L3, 'standard', `Plantilla ${t} tratada como tee`);
  }

  if (part.category === 'CROSS') {
    const L1 = p(part, 'L1') ?? 1.25 * D;
    const L2 = p(part, 'L2') ?? L1;
    const L3 = p(part, 'L3') ?? L1;
    const L4 = p(part, 'L4') ?? L3;
    return {
      shape: 'cross',
      ports: [
        { name: 'S1', position: [-L1, 0, 0], direction: NX },
        { name: 'S2', position: [L2, 0, 0], direction: X },
        { name: 'S3', position: [0, L3, 0], direction: Y },
        { name: 'S4', position: [0, -L4, 0], direction: NY }
      ],
      runTakeOff: L1,
      runTakeOff2: L2,
      branchTakeOff: L3,
      confidence: t.includes('_OF') ? 'approximate' : 'standard',
      visual: { bodyDiameter: D }
    };
  }

  // ---------------------------------------------------------------- bridas
  if (part.category === 'FLANGE') {
    const L = p(part, 'L') ?? 2 * D;
    const B = p(part, 'B') ?? L * 0.3;
    const D1 = p(part, 'D1') ?? D * 2;
    const visual = {
      bodyStart: 0,
      bodyEnd: L,
      flangeOuterDiameter: D1,
      flangeThickness: B,
      hubDiameter: p(part, 'D3') || p(part, 'D2') || D
    };
    if (t.endsWith('_F_SF')) {
      // Slip-on / socket: el caño entra hasta I desde atrás → puerto a L - I de la cara (SO 2" = 0.16")
      const I = p(part, 'I') ?? 0;
      return inline(part, 0, L - I, 'verified', 'flange', visual, 'Puerto del caño a L - I de la cara');
    }
    if (t === 'CPFWR' || t === 'CPFWO') return inline(part, 0, L, 'verified', 'flange', visual);
    if (t === 'CPFLR' || t === 'CPFLO') {
      return inline(part, 0, p(part, 'L') ?? B, 'approximate', 'flange', visual, 'Brida loca: sin verificar en Plant');
    }
    return inline(part, 0, L, 'standard', 'flange', visual, `Plantilla ${t} tratada como brida con cuello`);
  }

  if (part.category === 'FLANGE_BLIND') {
    const L = p(part, 'L') ?? 0.5 * D;
    const Dd = p(part, 'D') ?? 2 * D;
    return {
      shape: 'blind',
      ports: [{ name: part.ports[0]?.name || 'S1', position: [0, 0, 0], direction: NX }],
      portSpan: L,
      confidence: 'standard',
      visual: { bodyStart: 0, bodyEnd: L, flangeOuterDiameter: Dd, flangeThickness: L }
    };
  }

  // ---------------------------------------------------------------- reducciones
  if (part.category === 'REDUCER') {
    const D2 = od(part, 1);
    if (t === 'CYLSTACK002') {
      // Cupla reductora SW: dos encastres
      const L1 = p(part, 'L1') ?? D;
      const L2 = p(part, 'L2') ?? D2;
      const I1 = p(part, 'I1') ?? 0;
      const I2 = p(part, 'I2') ?? 0;
      return inline(part, I1, L1 + L2 - I2, 'approximate', 'reducer', { bodyStart: 0, bodyEnd: L1 + L2, bodyDiameter: D }, 'Cupla reductora: sin verificar en Plant');
    }
    const L = p(part, 'L') ?? (part.extra.lengthMm || 1.5 * D);
    const g = inline(part, 0, L, t === 'CPJRC' || t === 'CPJRE' ? 'verified' : 'standard', 'reducer', {
      bodyStart: 0,
      bodyEnd: L,
      bodyDiameter: D
    });
    const eccentric = t.startsWith('CPJRE') || (part.isoType || '').includes('ECCENTRIC');
    if (eccentric) {
      const E = pos(p(part, 'E'));
      g.lateralOffset = E ?? (D - D2) / 2;
    }
    return g;
  }

  // ---------------------------------------------------------------- válvulas e instrumentos en línea
  if (part.category === 'VALVE' || part.category === 'INSTRUMENT') {
    const L = p(part, 'L') ?? part.extra.lengthMm ?? 3 * D;
    // H1/H2: diámetro de las bridas (H11/H12 en las mariposas). HA: alto del accionamiento desde el eje.
    const flangeOD = pos(p(part, 'H1')) ?? pos(p(part, 'H11'));
    const H = Math.max(flangeOD ?? 0, pos(p(part, 'H2')) ?? 0, D * 1.6);
    const actuatorName = (part.extra.valveActuator || '').toLowerCase();
    const isValve = part.category === 'VALVE';
    const visual: NonNullable<PartGeometry['visual']> = {
      bodyStart: 0,
      bodyEnd: L,
      bodyDiameter: H,
      flangeThickness: pos(p(part, 'B1')),
      flangeOuterDiameter: flangeOD,
      actuatorHeight: pos(p(part, 'HA')),
      actuatorDiameter: pos(p(part, 'DA')),
      actuatorLength: pos(p(part, 'LA')),
      actuator: actuatorName.includes('wheel') ? 'wheel' : actuatorName.includes('lever') ? 'lever' : isValve && !actuatorName ? 'none' : undefined,
      valveKind: isValve ? valveKindFrom(part.familyDesc, part.template, part.skey) : undefined
    };
    if (t.endsWith('_OFOF')) {
      const I1 = p(part, 'I1') ?? 0;
      const I2 = p(part, 'I2') ?? I1;
      return inline(part, I1, L - I2, 'standard', 'valve', visual, 'Extremos SW/roscados: puertos al fondo del encastre');
    }
    if (t.startsWith('CPVI') || t.startsWith('CDBOX') || t.startsWith('CDCYLINDER')) {
      const conf = t.startsWith('CPVI') ? 'standard' : 'approximate';
      return inline(part, 0, L, conf, 'valve', visual);
    }
    return inline(part, 0, L, 'approximate', 'valve', visual, `Plantilla ${t || 'sin plantilla'}: cara a cara = L`);
  }

  // ---------------------------------------------------------------- cuplas
  if (part.category === 'COUPLING') {
    const L = p(part, 'L') ?? D;
    const L1 = p(part, 'L1') ?? 0;
    const L2 = p(part, 'L2') ?? L1;
    const I1 = p(part, 'I1') ?? 0;
    const I2 = p(part, 'I2') ?? I1;
    // En SW el largo total son los dos encastres; en roscadas es L. El caño llega al fondo de cada encastre.
    const overall = Math.max(L, L1 + L2);
    return inline(
      part,
      I1,
      overall - I2,
      'approximate',
      'inline',
      { bodyStart: 0, bodyEnd: overall, bodyDiameter: D * 1.3 },
      'Cupla: largo menos dos encastres, sin verificar en Plant'
    );
  }

  // ---------------------------------------------------------------- juntas
  if (part.category === 'GASKET') {
    const L = p(part, 'L') ?? 3;
    return inline(part, 0, L, 'verified', 'gasket', {
      bodyStart: 0,
      bodyEnd: L,
      bodyDiameter: p(part, 'D1') ?? D * 1.5
    });
  }

  // ---------------------------------------------------------------- tapas
  if (part.category === 'CAP') {
    const L = p(part, 'L') ?? D * 0.6;
    const I = t.includes('_OF') ? p(part, 'I') ?? 0 : 0;
    return {
      shape: 'cap',
      ports: [{ name: part.ports[0]?.name || 'S1', position: [0, 0, 0], direction: NX }],
      portSpan: L - I,
      confidence: I > 0 ? 'standard' : 'verified',
      note: I > 0 ? 'Tapa SW: el caño llega al fondo del encastre' : undefined,
      visual: { bodyStart: -I, bodyEnd: L - I, bodyDiameter: D }
    };
  }

  // ---------------------------------------------------------------- olets
  if (part.category === 'OLET') {
    const header = p(part, 'D2') ?? D * 2;
    const L = p(part, 'L') ?? D;
    const I = t.includes('_OF') ? p(part, 'I') ?? 0 : 0;
    const branchY = header / 2 + L - I;
    return {
      shape: 'olet',
      ports: [
        { name: part.ports[0]?.name || 'S1', position: [0, header / 2, 0], direction: NY },
        { name: part.ports[1]?.name || 'S2', position: [0, branchY, 0], direction: Y }
      ],
      branchTakeOff: branchY,
      confidence: I > 0 ? 'approximate' : 'standard',
      note:
        I > 0
          ? 'Sockolet: en los skids no conectó ni con L ni con L - I; queda por verificar'
          : 'Ramal a radio del cabezal + L',
      visual: { bodyDiameter: p(part, 'W') ?? (p(part, 'D') ?? D) * 1.6 }
    };
  }

  if (part.category === 'BOLT_SET' || part.category === 'ACTUATOR' || part.category === 'SUPPORT') {
    return { shape: 'none', ports: [], confidence: 'standard', visual: {} };
  }

  // ---------------------------------------------------------------- otros: en línea con L
  const L = p(part, 'L') ?? D;
  if (part.ports.length >= 2) {
    return inline(part, 0, L, 'approximate', 'inline', { bodyStart: 0, bodyEnd: L, bodyDiameter: D * 1.4 }, `Plantilla ${t || 'sin plantilla'} sin regla propia`);
  }
  return {
    shape: 'cap',
    ports: part.ports.length ? [{ name: part.ports[0].name, position: [0, 0, 0], direction: NX }] : [],
    portSpan: L,
    confidence: 'approximate',
    note: `Plantilla ${t || 'sin plantilla'} sin regla propia`,
    visual: { bodyStart: 0, bodyEnd: L, bodyDiameter: D }
  };
}

export const CONFIDENCE_LABEL: Record<GeometryConfidence, string> = {
  verified: 'Verificada con Plant',
  standard: 'Según norma, sin verificar en Plant',
  approximate: 'Aproximada: revisar en Plant'
};
