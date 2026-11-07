import { SerializedComponent, SerializedGraphState } from '../../types/piping';

/**
 * Registro de cambios de campo: compara el modelo actual con la línea base (el PCF tal como
 * llegó de Plant) y lista qué piezas se agregaron, borraron, movieron o editaron. Es lo que la
 * oficina técnica necesita saber antes de cargar el PCF corregido en Plant 3D.
 */

export type ChangeKind = 'added' | 'deleted' | 'moved' | 'edited' | 'fieldWeld';

export interface FieldChange {
  kind: ChangeKind;
  /** Pieza afectada (en el modelo actual; para las borradas, la de la línea base) */
  componentId: string;
  type: string;
  label: string;
  details: string[];
  /** Piezas que solo se trasladaron todas juntas (arrastradas por otro cambio) */
  componentIds?: string[];
  /** Traslado puro: todos los puertos corridos lo mismo, sin girar ni cambiar datos */
  shift?: [number, number, number];
}

export const CHANGE_LABEL: Record<ChangeKind, string> = {
  added: 'Agregada',
  deleted: 'Borrada',
  moved: 'Movida',
  edited: 'Editada',
  fieldWeld: 'Soldadura'
};

const TYPE_NAME: Record<string, string> = {
  PIPE: 'Caño',
  ELBOW: 'Codo',
  TEE: 'Te',
  CROSS: 'Cruz',
  FLANGE: 'Brida',
  VALVE: 'Válvula',
  REDUCER: 'Reducción',
  CAP: 'Tapa',
  OLET: 'Olet',
  COUPLING: 'Cupla',
  INSTRUMENT: 'Instrumento',
  MISC: 'Pieza'
};

const fmtNd = (nd: number) => {
  const frac: Record<number, string> = { 0.25: '1/4', 0.375: '3/8', 0.5: '1/2', 0.75: '3/4', 1.25: '1-1/4', 1.5: '1-1/2', 2.5: '2-1/2', 3.5: '3-1/2' };
  return `${frac[nd] ?? String(Number(nd.toFixed(3)))}"`;
};

const mm = (v: number) => `${Math.round(v)} mm`;

export function componentLabel(c: SerializedComponent): string {
  const p = c.parameters;
  const tag = p.nippleTag ? `${p.nippleTag} ` : '';
  const desc = p.description?.trim() || `${TYPE_NAME[c.type] ?? c.type} ${fmtNd(p.nominalDiameter)}`;
  return `${tag}${desc}`;
}

const dist = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sub = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function pipeLength(c: SerializedComponent): number {
  return c.ports.length >= 2 ? dist(c.ports[0].position, c.ports[1].position) : 0;
}

/** Corrimiento expresado como en obra: "300 mm al Este, 50 mm arriba" */
function describeShift(d: [number, number, number]): string {
  const parts: string[] = [];
  const axis = (v: number, pos: string, neg: string) => {
    if (Math.abs(v) >= 0.5) parts.push(`${mm(Math.abs(v))} ${v > 0 ? pos : neg}`);
  };
  axis(d[0], 'al Este', 'al Oeste');
  axis(d[1], 'al Norte', 'al Sur');
  axis(d[2], 'arriba', 'abajo');
  return parts.join(', ');
}

const TOL = 0.5;

function compareComponent(a: SerializedComponent, b: SerializedComponent): FieldChange[] {
  const out: FieldChange[] = [];
  const label = componentLabel(b);
  const base = { componentId: b.id, type: b.type, label };

  // Geometría
  const geo: string[] = [];
  if (b.type === 'PIPE' && a.ports.length >= 2 && b.ports.length >= 2) {
    const la = pipeLength(a);
    const lb = pipeLength(b);
    if (Math.abs(la - lb) >= TOL) geo.push(`Largo ${mm(la)} → ${mm(lb)} (${lb > la ? '+' : '−'}${mm(Math.abs(lb - la))})`);
  }
  const n = Math.min(a.ports.length, b.ports.length);
  let maxShift = 0;
  let shift: [number, number, number] = [0, 0, 0];
  let turned = false;
  for (let i = 0; i < n; i++) {
    const d = dist(a.ports[i].position, b.ports[i].position);
    if (d > maxShift) {
      maxShift = d;
      shift = sub(b.ports[i].position, a.ports[i].position);
    }
    const da = a.ports[i].direction;
    const db = b.ports[i].direction;
    if (da[0] * db[0] + da[1] * db[1] + da[2] * db[2] < 0.9998) turned = true;
  }
  if (maxShift >= TOL && !(b.type === 'PIPE' && geo.length && allButOneFixed(a, b))) {
    geo.push(`Corrida ${describeShift(shift)}`);
  }
  if (turned && b.type !== 'PIPE') geo.push('Girada');
  if (geo.length) {
    const pure =
      !turned &&
      maxShift >= TOL &&
      geo.length === 1 &&
      a.ports.length === b.ports.length &&
      a.ports.every((p, i) => dist(sub(b.ports[i].position, p.position), shift) < TOL);
    out.push({ ...base, kind: 'moved', details: geo, shift: pure ? shift : undefined });
  }

  // Datos
  const ed: string[] = [];
  const pa = a.parameters;
  const pb = b.parameters;
  const field = (name: string, x?: string | number, y?: string | number) => {
    if ((x ?? '') !== (y ?? '')) ed.push(`${name}: ${x || '—'} → ${y || '—'}`);
  };
  if (a.catalogId !== b.catalogId || (pa.itemCode ?? '') !== (pb.itemCode ?? '')) {
    ed.push(`Pieza cambiada: ${pa.description || a.catalogId} → ${pb.description || b.catalogId}`);
  } else {
    field('Descripción', pa.description, pb.description);
  }
  if (Math.abs(pa.nominalDiameter - pb.nominalDiameter) > 1e-6) ed.push(`Diámetro ${fmtNd(pa.nominalDiameter)} → ${fmtNd(pb.nominalDiameter)}`);
  field('Spec', a.specCode, b.specCode);
  field('Línea', pa.lineNumber, pb.lineNumber);
  field('Marca', pa.nippleTag, pb.nippleTag);
  if (pa.endFinish1 !== pb.endFinish1 || pa.endFinish2 !== pb.endFinish2) {
    if (pa.endFinish1 || pb.endFinish1 || pa.endFinish2 || pb.endFinish2) {
      ed.push(`Extremos: ${pa.endFinish1 ?? '—'}/${pa.endFinish2 ?? '—'} → ${pb.endFinish1 ?? '—'}/${pb.endFinish2 ?? '—'}`);
    }
  }
  if (ed.length) out.push({ ...base, kind: 'edited', details: ed });
  return out;
}

/** Un caño alargado o acortado: un extremo quieto y el otro corrido sobre su eje */
function allButOneFixed(a: SerializedComponent, b: SerializedComponent): boolean {
  const moved = a.ports.filter((p, i) => dist(p.position, b.ports[i].position) >= TOL).length;
  return moved <= 1;
}

export function diffStates(baseline: SerializedGraphState, current: SerializedGraphState): FieldChange[] {
  const out: FieldChange[] = [];
  const baseIds = new Set(Object.keys(baseline.components));

  for (const c of Object.values(current.components)) {
    const old = baseline.components[c.id];
    if (!old) {
      const p = c.parameters;
      const details: string[] = [];
      if (c.type === 'PIPE') details.push(`Largo ${mm(pipeLength(c))}`);
      if (c.ports[0]) details.push(`En ${c.ports[0].position.map((v) => Math.round(v)).join(', ')}`);
      if (p.itemCode) details.push(`Código ${p.itemCode}`);
      out.push({ kind: 'added', componentId: c.id, type: c.type, label: componentLabel(c), details });
    } else {
      out.push(...compareComponent(old, c));
    }
    baseIds.delete(c.id);
  }
  for (const id of baseIds) {
    const c = baseline.components[id];
    out.push({ kind: 'deleted', componentId: id, type: c.type, label: componentLabel(c), details: c.parameters.itemCode ? [`Código ${c.parameters.itemCode}`] : [] });
  }

  // Soldaduras de campo marcadas o quitadas
  const fw = (s: SerializedGraphState, id: string) => {
    const j = s.joints[id];
    return j?.fieldWeld ? `${j.fieldWeld}${j.fieldWeld === 'FFW' ? ` +${Math.round(j.fieldAllowanceMm ?? 0)} mm` : ''}` : '';
  };
  const jointIds = new Set([...Object.keys(baseline.joints), ...Object.keys(current.joints)]);
  for (const id of jointIds) {
    const before = fw(baseline, id);
    const after = fw(current, id);
    if (before === after) continue;
    const j = current.joints[id] ?? baseline.joints[id];
    const owner = Object.values(current.components).find((c) => c.ports.some((p) => p.id === j.portAId || p.id === j.portBId));
    out.push({
      kind: 'fieldWeld',
      componentId: owner?.id ?? '',
      type: 'WELD',
      label: owner ? `Unión en ${componentLabel(owner)}` : 'Unión',
      details: [after ? (before ? `${before} → ${after}` : `Soldadura de campo ${after}`) : `Vuelve a taller (antes ${before})`]
    });
  }

  // Las piezas que solo se trasladaron igual (aguas abajo de un caño alargado) van en un renglón
  const groups = new Map<string, FieldChange[]>();
  for (const c of out) {
    if (c.kind !== 'moved' || !c.shift) continue;
    const k = c.shift.map((v) => Math.round(v)).join(',');
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(c);
  }
  for (const [, g] of groups) {
    if (g.length < 2) continue;
    const members = g;
    const first = out.indexOf(members[0]);
    for (const m of members) out.splice(out.indexOf(m), 1);
    out.splice(first, 0, {
      kind: 'moved',
      componentId: members[0].componentId,
      componentIds: members.map((m) => m.componentId),
      type: 'GROUP',
      label: `${members.length} piezas arrastradas`,
      details: [`Corridas ${describeShift(members[0].shift!)} por otro cambio: ${members.slice(0, 4).map((m) => m.label).join('; ')}${members.length > 4 ? '…' : ''}`],
      shift: members[0].shift
    });
  }

  const order: Record<ChangeKind, number> = { deleted: 0, added: 1, moved: 2, edited: 3, fieldWeld: 4 };
  // Las piezas arrastradas van al final de las movidas: primero lo que se cambió a propósito
  const rank = (c: FieldChange) => order[c.kind] * 2 + (c.type === 'GROUP' ? 1 : 0);
  return out.sort((x, y) => rank(x) - rank(y));
}

export function summarizeChanges(changes: FieldChange[]): string {
  if (!changes.length) return 'Sin cambios respecto del PCF original.';
  const count = (k: ChangeKind) => changes.filter((c) => c.kind === k).length;
  const parts = (['added', 'deleted', 'moved', 'edited', 'fieldWeld'] as ChangeKind[])
    .filter((k) => count(k))
    .map((k) => `${count(k)} ${CHANGE_LABEL[k].toLowerCase()}${count(k) > 1 && k !== 'fieldWeld' ? 's' : k === 'fieldWeld' && count(k) > 1 ? 's' : ''}`);
  return parts.join(', ');
}
