import { JointType } from '../../types/piping';
import { plantJointToAppJoint } from './units';

/**
 * Reglas de unión entre extremos, como el DefaultConnectorsConfig.xml de un proyecto de Plant 3D.
 * Deciden qué unión se forma entre dos puertos (soldadura, socket, rosca, brida con junta y
 * bulones...) y si hay que dejar el espesor de la junta entre caras.
 */
export interface ConnectionRule {
  name: string;
  ends1: string[];
  ends2: string[];
  /** Elementos que Plant agrega en la unión (Buttweld, Gasket, BoltSet, Glue...) */
  jointElements: string[];
  /** Pieza que Plant inserta sola (AutoFlange, AutoThread...) */
  fittingElements: string[];
  requiresSameSize: boolean;
  requiresSameClass: boolean;
  /** Solo aplica entre ciertos tipos de pieza (PipeBend) */
  partTypes?: string[];
}

export interface ConnectionResult {
  rule: ConnectionRule | null;
  jointType: JointType;
  compatible: boolean;
  /** Hay junta entre caras: dejar su espesor */
  hasGasket: boolean;
  hasBoltSet: boolean;
  problems: string[];
}

const rule = (
  name: string,
  ends1: string[],
  ends2: string[],
  jointElements: string[],
  opts: Partial<ConnectionRule> = {}
): ConnectionRule => ({
  name,
  ends1,
  ends2,
  jointElements,
  fittingElements: [],
  requiresSameSize: true,
  requiresSameClass: false,
  ...opts
});

/** Reglas por defecto de Plant 3D 2027 (las mismas que trae un proyecto nuevo) */
export const DEFAULT_CONNECTION_RULES: ConnectionRule[] = [
  rule('Buttweld', ['BV', 'PL'], ['BV', 'PL'], ['Buttweld']),
  rule('Socketweld', ['PL'], ['SW'], ['Socketweld']),
  rule('Threaded', ['THDM', 'PL'], ['THDF'], ['Thread']),
  rule('Flanged', ['FL', 'LFL'], ['FL', 'LFL'], ['Gasket', 'BoltSet'], { requiresSameClass: true }),
  rule('PushFit', ['PL'], ['PFS'], ['Gasket']),
  rule('WaferFlanged', ['FL', 'LFL'], ['WF'], ['Gasket'], { requiresSameClass: true }),
  rule('WaferWafer', ['WF'], ['WF'], ['Gasket'], { requiresSameClass: true }),
  rule('Fusionweld', ['PPL'], ['PPL'], ['Fusionweld']),
  rule('Glue', ['PPL'], ['PSW'], ['Glue']),
  rule('StubLapped', ['LAP'], ['BV', 'PL'], ['StubEnd', 'Buttweld']),
  rule('CollarLapped', ['LAP'], ['BV', 'PL'], ['Collar', 'Buttweld']),
  rule('Clamped', ['PL', 'GRV'], ['GRV'], ['Clamp'], { requiresSameClass: true }),
  rule('Lug', ['FL', 'LFL'], ['LUG'], ['Gasket', 'BoltSet'], { requiresSameClass: true }),
  rule('Slip', ['SO'], ['BV', 'PL'], ['SlipOn']),
  rule('Tap', ['TAP'], ['BV', 'PL'], ['Tapweld']),
  rule('ThreadedTap', ['TAP'], ['THDM', 'PL'], ['Thread']),
  rule('Mechanical', ['MJM', 'PL'], ['MJF'], ['Gland']),
  rule('Triclover', ['TC'], ['TC'], ['Gasket', 'Clamp'])
];

function listIn(block: string, tag: string): string[] {
  const inner = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
  if (!inner) return [];
  return Array.from(inner.matchAll(/<(?:EndCondition|PartType)>([^<]+)<\//g)).map((m) => m[1].trim());
}

/** Lee el DefaultConnectorsConfig.xml de un proyecto de Plant 3D */
export function parseConnectorsConfig(xml: string): ConnectionRule[] {
  const rules: ConnectionRule[] = [];
  for (const block of xml.match(/<Joint\s+Name="[^"]*">[\s\S]*?<\/Joint>/g) ?? []) {
    const name = block.match(/<Joint\s+Name="([^"]*)"/)?.[1] ?? 'Joint';
    const match = block.match(/<MatchCondition>([^<]*)<\/MatchCondition>/)?.[1] ?? '';
    const jointElements = Array.from(block.matchAll(/<JointElement\s+PartType="([^"]+)"/g)).map((m) => m[1]);
    const fittingElements = Array.from(block.matchAll(/<FittingElement\s+PartType="([^"]+)"/g)).map((m) => m[1]);
    const partTypes = listIn(block, 'PartTypes1');
    rules.push({
      name,
      ends1: listIn(block, 'EndConditions1'),
      ends2: listIn(block, 'EndConditions2'),
      jointElements,
      fittingElements,
      requiresSameSize: /NominalDiameter/.test(match),
      requiresSameClass: /PressureClass/.test(match),
      partTypes: partTypes.length ? partTypes : undefined
    });
  }
  return rules;
}

export interface EndInfo {
  endType?: string;
  nominalDiameter?: number;
  pressureClass?: string;
}

/** Decide la unión entre dos extremos según las reglas (primera que coincide, como Plant) */
export function resolveConnection(
  a: EndInfo,
  b: EndInfo,
  rules: ConnectionRule[] = DEFAULT_CONNECTION_RULES
): ConnectionResult {
  const ea = (a.endType || '').toUpperCase();
  const eb = (b.endType || '').toUpperCase();
  const problems: string[] = [];
  const up = (l: string[]) => l.map((x) => x.toUpperCase());

  const found = rules.find((r) => {
    if (r.partTypes || r.fittingElements.length > 0) return false;
    const e1 = up(r.ends1);
    const e2 = up(r.ends2);
    return (e1.includes(ea) && e2.includes(eb)) || (e1.includes(eb) && e2.includes(ea));
  });

  if (!found) {
    return {
      rule: null,
      jointType: 'BUTTWELD',
      compatible: !ea || !eb,
      hasGasket: false,
      hasBoltSet: false,
      problems: ea && eb ? [`Extremos incompatibles: ${ea} con ${eb}`] : []
    };
  }
  if (found.requiresSameSize && a.nominalDiameter && b.nominalDiameter && Math.abs(a.nominalDiameter - b.nominalDiameter) > 0.001) {
    problems.push(`Diámetros distintos (${a.nominalDiameter}" y ${b.nominalDiameter}")`);
  }
  if (found.requiresSameClass && a.pressureClass && b.pressureClass && a.pressureClass !== b.pressureClass) {
    problems.push(`Clases distintas (${a.pressureClass} y ${b.pressureClass})`);
  }
  const elems = found.jointElements.map((e) => e.toLowerCase());
  return {
    rule: found,
    jointType: plantJointToAppJoint(found.name),
    compatible: problems.length === 0,
    hasGasket: elems.includes('gasket'),
    hasBoltSet: elems.includes('boltset'),
    problems
  };
}
