import { ComponentType } from '../../types/piping';
import { CatalogPart, PartCategory } from './catalogTypes';
import type { SpecDatabaseReader } from './SpecDatabaseReader';
import { ValveKind, valveKindFrom } from './valveKind';

export type { ValveKind } from './valveKind';

/** Dibujo del botón: una pieza reconocible por tipo */
export type PieceIconKind =
  | 'pipe'
  | 'elbow90'
  | 'elbow45'
  | 'elbowStreet'
  | 'teeRun'
  | 'teeBranch'
  | 'teeReducing'
  | 'olet'
  | 'reducerConcentric'
  | 'reducerEccentric'
  | 'flangeWN'
  | 'flangeSO'
  | 'flangeBlind'
  | 'flangePair'
  | 'valveGate'
  | 'valveGlobe'
  | 'valveBall'
  | 'valveCheck'
  | 'valveButterfly'
  | 'valvePlug'
  | 'valve'
  | 'cap'
  | 'coupling';

export type PaletteGroupId = 'tramo' | 'derivaciones' | 'reducciones' | 'bridas' | 'valvulas' | 'cierres';

export const PALETTE_GROUPS: { id: PaletteGroupId; title: string }[] = [
  { id: 'tramo', title: 'Caño y codos' },
  { id: 'derivaciones', title: 'Derivaciones' },
  { id: 'reducciones', title: 'Reducciones' },
  { id: 'bridas', title: 'Bridas' },
  { id: 'valvulas', title: 'Válvulas' },
  { id: 'cierres', title: 'Cierres' }
];

/** Lo que se le pasa a `insertFitting` del store */
export interface PieceInsertOptions {
  angle?: number;
  targetNd?: number;
  continueOnBranch?: boolean;
  /** Brida: unión completa (brida + junta + brida) */
  pair?: boolean;
  /** Brida ciega: cierra la línea contra una cara */
  blind?: boolean;
  /** Familia de la spec elegida a mano (PartFamilyId) */
  familyId?: string;
  eccentric?: boolean;
  /** Reducción excéntrica: de qué lado queda la generatriz recta */
  flat?: 'abajo' | 'arriba';
  /** Te reducida: diámetro del ramal */
  branchNd?: number;
}

export interface PaletteItem {
  /** Estable entre diámetros (sirve para "Recientes") */
  id: string;
  group: PaletteGroupId;
  label: string;
  /** Marca chica sobre el ícono: 45°, EXC, SO, 3"... */
  badge?: string;
  icon: PieceIconKind;
  /** Descripción de la pieza de spec que se va a insertar */
  description: string;
  insert: { type: ComponentType; options?: PieceInsertOptions };
  /** Otras piezas de la spec del mismo tipo (se abren manteniendo apretado) */
  variants?: PaletteItem[];
}

interface ActivePortInfo {
  plantEndType?: string;
  pressureClass?: string;
}

const EPS = 0.001;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;
const famKey = (p: CatalogPart) => p.familyId || p.familyDesc;

/** Nombre corto de extremos para la marca del botón */
const END_BADGE: Record<string, string> = {
  FL: 'BRID',
  BV: 'BW',
  SW: 'SW',
  SO: 'SO',
  THDF: 'ROSC',
  THDM: 'ROSC',
  WF: 'WAFER',
  LUG: 'LUG',
  PL: 'LISO'
};

const END_NAME: Record<string, string> = {
  FL: 'Bridada',
  BV: 'Para soldar a tope',
  SW: 'Socket weld',
  THDF: 'Roscada',
  THDM: 'Roscada',
  WF: 'Wafer (entre bridas)',
  LUG: 'Lug (entre bridas)'
};

const VALVE_BUTTONS: { kind: ValveKind; label: string; icon: PieceIconKind }[] = [
  { kind: 'gate', label: 'Compuerta', icon: 'valveGate' },
  { kind: 'globe', label: 'Globo', icon: 'valveGlobe' },
  { kind: 'ball', label: 'Esférica', icon: 'valveBall' },
  { kind: 'check', label: 'Retención', icon: 'valveCheck' },
  { kind: 'butterfly', label: 'Mariposa', icon: 'valveButterfly' },
  { kind: 'plug', label: 'Macho', icon: 'valvePlug' },
  { kind: 'other', label: 'Válvula', icon: 'valve' }
];

/** Tipo de válvula de una pieza de catálogo */
export function valveKindOf(part: Pick<CatalogPart, 'template' | 'familyDesc' | 'skey'>): ValveKind {
  return valveKindFrom(part.familyDesc, part.template, part.skey);
}

export function isEccentricReducer(part: Pick<CatalogPart, 'isoType' | 'template' | 'extra'>): boolean {
  return (
    (part.isoType || '').toUpperCase().includes('ECCENTRIC') ||
    (part.template || '').toUpperCase().startsWith('CPJRE') ||
    String(part.extra?.eccentricity ?? '') === '1'
  );
}

/** Primera parte de la descripción de la familia: "ELL 90 LR", "Gate Valve" */
function head(desc: string, parts = 1): string {
  return desc
    .split(',')
    .slice(0, parts)
    .map((s) => s.trim())
    .join(', ');
}

/**
 * Botones de la paleta para un diámetro: solo lo que la spec tiene. Las piezas salen ordenadas
 * como las elegiría Plant (prioridades del .pspx y extremo de la boca activa); el resto de las
 * familias queda como variante de cada botón.
 */
export function buildPaletteItems(reader: SpecDatabaseReader, nd: number, port?: ActivePortInfo | null): PaletteItem[] {
  const cat = reader.catalog;
  const size = (d: number) => cat.sizeLabel(d);
  const connectToEndType = port?.plantEndType;
  const pressureClass = port?.pressureClass;
  const items: PaletteItem[] = [];

  /** Una pieza por familia, en el orden en que las elegiría Plant */
  const ordered = (category: PartCategory, extra: { angle?: number; secondaryDiameter?: number } = {}): CatalogPart[] => {
    const seen = new Set<string>();
    const out: CatalogPart[] = [];
    for (const part of cat.candidates({ category, nominalDiameter: nd, connectToEndType, pressureClass, ...extra })) {
      const key = famKey(part);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
    return out;
  };
  const endsBadge = (part: CatalogPart) => {
    const ends = Array.from(new Set(part.ports.map((p) => p.endType.toUpperCase())));
    return ends.map((e) => END_BADGE[e] ?? e).join('×');
  };

  // ------------------------------------------------------------------ caño y codos
  const pipe = ordered('PIPE')[0];
  if (pipe) {
    items.push({
      id: 'pipe',
      group: 'tramo',
      label: 'Caño',
      icon: 'pipe',
      description: pipe.sizeDesc || pipe.familyDesc,
      insert: { type: 'PIPE' }
    });
  }

  const elbows = ordered('ELBOW');
  const angleOf = (p: CatalogPart) => Math.round(p.params.A ?? p.extra.angleDeg ?? 90);
  const angles = Array.from(new Set(elbows.map(angleOf))).sort((a, b) => b - a);
  for (const angle of angles) {
    const list = elbows.filter((p) => angleOf(p) === angle);
    const street = (p: CatalogPart) => (p.template || '').toUpperCase().endsWith('_OMOF');
    const main = list.find((p) => !street(p)) ?? list[0];
    const make = (p: CatalogPart, variant: boolean): PaletteItem => ({
      id: variant ? `elbow:${angle}:${famKey(p)}` : `elbow:${angle}`,
      group: 'tramo',
      label: variant ? head(p.familyDesc) : `Codo ${angle}°`,
      badge: variant ? endsBadge(p) : angle === 90 || angle === 45 ? undefined : `${angle}°`,
      icon: street(p) ? 'elbowStreet' : angle <= 60 ? 'elbow45' : 'elbow90',
      description: p.familyDesc,
      insert: { type: 'ELBOW', options: variant ? { angle, familyId: famKey(p) } : { angle } }
    });
    const item = make(main, false);
    if (list.length > 1) item.variants = list.map((p) => make(p, true));
    items.push(item);
  }

  const coupling = ordered('COUPLING')[0];
  if (coupling) {
    items.push({
      id: 'coupling',
      group: 'tramo',
      label: 'Cupla',
      badge: endsBadge(coupling),
      icon: 'coupling',
      description: coupling.familyDesc,
      insert: { type: 'COUPLING', options: { familyId: famKey(coupling) } }
    });
  }

  // ------------------------------------------------------------------ derivaciones
  const tees = cat.partsOf('TEE').filter((p) => p.ports[0] && same(p.ports[0].nominalDiameter, nd));
  const branchOf = (p: CatalogPart) => p.ports[2]?.nominalDiameter ?? nd;
  const equalTee = ordered('TEE')[0];
  if (equalTee) {
    items.push(
      {
        id: 'tee:run',
        group: 'derivaciones',
        label: 'Te línea',
        icon: 'teeRun',
        description: `${equalTee.familyDesc}. La línea sigue derecho.`,
        insert: { type: 'TEE', options: { continueOnBranch: false } }
      },
      {
        id: 'tee:branch',
        group: 'derivaciones',
        label: 'Te ramal',
        icon: 'teeBranch',
        description: `${equalTee.familyDesc}. La línea sigue por el ramal.`,
        insert: { type: 'TEE', options: { continueOnBranch: true } }
      }
    );
  }
  const reducedBranches = Array.from(new Set(tees.map(branchOf).filter((b) => b < nd - EPS))).sort((a, b) => b - a);
  if (reducedBranches.length) {
    const make = (branch: number, variant: boolean, onBranch: boolean): PaletteItem => {
      const part = tees.find((p) => same(branchOf(p), branch))!;
      return {
        id: variant ? `tee:red:${branch}:${onBranch ? 'b' : 'r'}` : 'tee:red',
        group: 'derivaciones',
        label: variant ? `Ramal ${size(branch)} · sigue por ${onBranch ? 'el ramal' : 'la línea'}` : 'Te reducida',
        badge: size(branch),
        icon: 'teeReducing',
        description: part.familyDesc,
        insert: { type: 'TEE', options: { branchNd: branch, continueOnBranch: onBranch } }
      };
    };
    const item = make(reducedBranches[0], false, false);
    item.variants = reducedBranches.flatMap((b) => [make(b, true, false), make(b, true, true)]);
    items.push(item);
  }
  const olet = ordered('OLET')[0];
  if (olet) {
    items.push({
      id: 'olet',
      group: 'derivaciones',
      label: 'Olet',
      icon: 'olet',
      description: `${olet.familyDesc}. Se pone sobre un caño: mantenelo apretado y elegí Derivar.`,
      insert: { type: 'OLET' }
    });
  }

  // ------------------------------------------------------------------ reducciones (achican y agrandan)
  const reducers = cat.partsOf('REDUCER').filter((p) => p.ports[0] && p.ports[1]);
  for (const eccentric of [false, true]) {
    const targets = new Map<number, CatalogPart>();
    for (const p of reducers) {
      if (isEccentricReducer(p) !== eccentric) continue;
      const big = p.ports[0].nominalDiameter;
      const small = p.ports[1].nominalDiameter;
      const target = same(big, nd) ? small : same(small, nd) ? big : null;
      if (target !== null && !same(target, nd) && !targets.has(target)) targets.set(target, p);
    }
    if (!targets.size) continue;
    // Primero achicar (la más cercana), después agrandar
    const sorted = Array.from(targets.keys()).sort((a, b) => {
      const da = a < nd ? 0 : 1;
      const db = b < nd ? 0 : 1;
      return da - db || (a < nd ? b - a : a - b);
    });
    const base = eccentric ? 'reducer:ecc' : 'reducer:conc';
    const make = (target: number, variant: boolean, flat?: 'abajo' | 'arriba'): PaletteItem => {
      const part = targets.get(target)!;
      const verb = target < nd ? 'Reduce' : 'Amplía';
      return {
        id: variant ? `${base}:${target}${flat ? `:${flat}` : ''}` : base,
        group: 'reducciones',
        label: variant
          ? `${verb} a ${size(target)}${flat ? ` · plano ${flat}` : ''}`
          : eccentric
          ? 'Red. exc.'
          : 'Red. conc.',
        badge: `${target < nd ? '▸' : '◂'}${size(target)}`,
        icon: eccentric ? 'reducerEccentric' : 'reducerConcentric',
        description: `${part.familyDesc} · ${size(Math.max(nd, target))} x ${size(Math.min(nd, target))}`,
        insert: { type: 'REDUCER', options: { targetNd: target, eccentric, familyId: famKey(part), flat } }
      };
    };
    const item = make(sorted[0], false, eccentric ? 'abajo' : undefined);
    const variants = eccentric
      ? sorted.flatMap((t) => [make(t, true, 'abajo'), make(t, true, 'arriba')])
      : sorted.map((t) => make(t, true));
    if (variants.length > 1) item.variants = variants;
    items.push(item);
  }

  // ------------------------------------------------------------------ bridas
  const flanges = ordered('FLANGE');
  const flangeName = (p: CatalogPart) => {
    const k = (p.skey || '').toUpperCase();
    if (k === 'FLWN') return { short: 'WN', icon: 'flangeWN' as const };
    if (k === 'FLSO') return { short: 'SO', icon: 'flangeSO' as const };
    if (k === 'FLSI' || k === 'FLSW') return { short: 'SW', icon: 'flangeSO' as const };
    if (k === 'FLSC' || k === 'FLTH') return { short: 'ROSC', icon: 'flangeSO' as const };
    if (k === 'FLLJ' || k === 'FLLB') return { short: 'LAP', icon: 'flangeSO' as const };
    const body = p.ports[1]?.endType.toUpperCase();
    return body === 'BV' ? { short: 'WN', icon: 'flangeWN' as const } : { short: END_BADGE[body ?? ''] ?? '', icon: 'flangeSO' as const };
  };
  flanges.forEach((p, i) => {
    const n = flangeName(p);
    items.push({
      id: `flange:${n.short || i}:${p.pressureClass ?? p.ports[0]?.pressureClass ?? ''}`,
      group: 'bridas',
      label: `Brida ${n.short}`.trim(),
      badge: p.pressureClass ?? p.ports[0]?.pressureClass,
      icon: n.icon,
      description: p.familyDesc,
      insert: { type: 'FLANGE', options: { familyId: famKey(p) } }
    });
  });
  if (flanges[0]) {
    items.push({
      id: 'flange:pair',
      group: 'bridas',
      label: 'Par bridas',
      icon: 'flangePair',
      description: `Unión bridada completa: brida, junta y brida (${head(flanges[0].familyDesc, 2)}).`,
      insert: { type: 'FLANGE', options: { pair: true } }
    });
  }
  const blind = ordered('FLANGE_BLIND')[0];
  if (blind) {
    items.push({
      id: 'flange:blind',
      group: 'cierres',
      label: 'Brida ciega',
      badge: blind.pressureClass ?? blind.ports[0]?.pressureClass,
      icon: 'flangeBlind',
      description: `${blind.familyDesc}. Sobre un caño entra con su brida y la junta.`,
      insert: { type: 'FLANGE', options: { blind: true, familyId: famKey(blind) } }
    });
  }

  // ------------------------------------------------------------------ válvulas, por tipo
  const valves = ordered('VALVE');
  for (const k of VALVE_BUTTONS) {
    const list = valves.filter((p) => valveKindOf(p) === k.kind);
    if (!list.length) continue;
    const make = (p: CatalogPart, variant: boolean): PaletteItem => {
      const end = p.ports[0]?.endType.toUpperCase() ?? '';
      const sub = head(p.familyDesc, 2).split(',')[1]?.trim();
      const subName = sub && !/\bLB\b|^\d/.test(sub) ? sub : '';
      return {
        id: variant ? `valve:${k.kind}:${famKey(p)}` : `valve:${k.kind}`,
        group: 'valvulas',
        label: variant ? [END_NAME[end] ?? end, subName].filter(Boolean).join(' · ') : k.label,
        badge: END_BADGE[end] ?? end,
        icon: k.icon,
        description: p.familyDesc,
        insert: { type: 'VALVE', options: { familyId: famKey(p) } }
      };
    };
    const item = make(list[0], false);
    if (list.length > 1) item.variants = list.map((p) => make(p, true));
    items.push(item);
  }

  // ------------------------------------------------------------------ cierres
  const caps = ordered('CAP');
  if (caps[0]) {
    const make = (p: CatalogPart, variant: boolean): PaletteItem => ({
      id: variant ? `cap:${famKey(p)}` : 'cap',
      group: 'cierres',
      label: variant ? head(p.familyDesc, 2) : 'Tapa',
      badge: variant ? endsBadge(p) : undefined,
      icon: 'cap',
      description: p.familyDesc,
      insert: { type: 'CAP', options: variant ? { familyId: famKey(p) } : undefined }
    });
    const item = make(caps[0], false);
    if (caps.length > 1) item.variants = caps.map((p) => make(p, true));
    items.push(item);
  }

  const order = new Map(PALETTE_GROUPS.map((g, i) => [g.id, i]));
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => order.get(a.item.group)! - order.get(b.item.group)! || a.i - b.i)
    .map((x) => x.item);
}

/** Busca un botón o una variante por su id (para "Recientes") */
export function findPaletteItem(items: PaletteItem[], id: string): PaletteItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const v = item.variants?.find((x) => x.id === id);
    if (v) return v;
  }
  return undefined;
}
