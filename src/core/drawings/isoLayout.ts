import * as THREE from 'three';
import type { PipingGraph } from '../graph/PipingGraph';
import { PcfImporter } from '../importers/PcfImporter';
import { Component } from '../../types/piping';

/**
 * Isometría "sin escala" como la de Isogen: cada tramo recto se dibuja con un largo que
 * crece despacio con el largo real (logaritmo), así una pieza de 6 mm se ve y un caño de
 * 3 m no se come la hoja. Las direcciones se respetan; las cotas muestran el valor real.
 */

const key = (v: THREE.Vector3) => `${Math.round(v.x * 2) / 2},${Math.round(v.y * 2) / 2},${Math.round(v.z * 2) / 2}`;

/** Largo dibujado para un largo real (mm de modelo) */
export function drawnLength(l: number): number {
  if (l < 0.5) return l;
  return Math.max(30, 150 * Math.log(1 + l / 150));
}

interface Edge {
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** false para las uniones (la junta entre bridas no se agranda) */
  compress: boolean;
}

function skeleton(_graph: PipingGraph, c: Component, oletCentres: THREE.Vector3[]): Edge[] {
  const p = c.ports.map((q) => q.position);
  const e = (a: THREE.Vector3, b: THREE.Vector3): Edge => ({ a, b, compress: true });
  switch (c.type) {
    case 'PIPE': {
      if (p.length < 2) return [];
      // Los olets parten el caño en el punto donde se sueldan
      const d = p[1].clone().sub(p[0]);
      const L = d.length();
      if (L < 1e-6) return [e(p[0], p[1])];
      const on = oletCentres
        .map((o) => ({ o, t: o.clone().sub(p[0]).dot(d) / (L * L) }))
        .filter(({ o, t }) => t > 0 && t < 1 && p[0].clone().addScaledVector(d, t).distanceTo(o) < c.parameters.outerDiameter / 2 + 2)
        .sort((x, y) => x.t - y.t)
        .map(({ o }) => o);
      const chain = [p[0], ...on, p[1]];
      return chain.slice(1).map((b, i) => e(chain[i], b));
    }
    case 'ELBOW': {
      if (p.length < 2) return [];
      const v = PcfImporter.elbowVertex(c.ports[0], c.ports[1]);
      return [e(p[0], v), e(v, p[1])];
    }
    case 'TEE':
    case 'CROSS': {
      const ctr = c.centerline[1];
      return ctr ? p.map((q) => e(q, ctr)) : [];
    }
    case 'OLET':
      return c.centerline[0] && p[0] ? [e(c.centerline[0], p[0])] : [];
    case 'CAP':
      return c.centerline[1] && p[0] ? [e(p[0], c.centerline[1])] : [];
    default:
      return p.length >= 2 ? [e(p[0], p[1])] : [];
  }
}

export interface IsoLayout {
  /** Punto del modelo → punto deformado (sigue en mm de modelo, antes de proyectar) */
  map: (v: THREE.Vector3) => THREE.Vector3;
  nodes: THREE.Vector3[];
}

export function buildLayout(graph: PipingGraph, comps: Component[]): IsoLayout {
  const ids = new Set(comps.map((c) => c.id));
  const oletCentres = comps.filter((c) => c.type === 'OLET' && c.centerline[0]).map((c) => c.centerline[0]);
  const edges: Edge[] = [];
  for (const c of comps) edges.push(...skeleton(graph, c, oletCentres));
  for (const j of graph.joints.values()) {
    const a = graph.ports.get(j.portAId);
    const b = graph.ports.get(j.portBId);
    if (a && b && ids.has(a.componentId) && ids.has(b.componentId)) edges.push({ a: a.position, b: b.position, compress: false });
  }

  const orig = new Map<string, THREE.Vector3>();
  const adj = new Map<string, { to: string; vec: THREE.Vector3; compress: boolean }[]>();
  const link = (a: THREE.Vector3, b: THREE.Vector3, compress: boolean) => {
    const ka = key(a);
    const kb = key(b);
    orig.set(ka, a);
    orig.set(kb, b);
    if (ka === kb) return;
    (adj.get(ka) ?? adj.set(ka, []).get(ka)!).push({ to: kb, vec: b.clone().sub(a), compress });
    (adj.get(kb) ?? adj.set(kb, []).get(kb)!).push({ to: ka, vec: a.clone().sub(b), compress });
  };
  edges.forEach((ed) => link(ed.a, ed.b, ed.compress));

  // Recorrido desde un extremo libre: cada tramo se ubica a partir del anterior
  const placed = new Map<string, THREE.Vector3>();
  const starts = [...orig.keys()].sort((x, y) => (adj.get(x)?.length ?? 0) - (adj.get(y)?.length ?? 0));
  for (const s of starts) {
    if (placed.has(s)) continue;
    placed.set(s, orig.get(s)!.clone());
    const queue = [s];
    while (queue.length) {
      const k = queue.shift()!;
      const from = placed.get(k)!;
      for (const { to, vec, compress } of adj.get(k) ?? []) {
        if (placed.has(to)) continue;
        const l = vec.length();
        const step = compress && l > 1e-6 ? vec.clone().multiplyScalar(drawnLength(l) / l) : vec.clone();
        placed.set(to, from.clone().add(step));
        queue.push(to);
      }
    }
  }

  const map = (v: THREE.Vector3): THREE.Vector3 => {
    const hit = placed.get(key(v));
    if (hit) return hit;
    // Punto sobre un tramo (soldadura entre bridas, punto medio): se interpola
    for (const ed of edges) {
      const d = ed.b.clone().sub(ed.a);
      const L2 = d.lengthSq();
      if (L2 < 1e-9) continue;
      const t = v.clone().sub(ed.a).dot(d) / L2;
      if (t < -1e-6 || t > 1 + 1e-6) continue;
      if (ed.a.clone().addScaledVector(d, t).distanceTo(v) > 1) continue;
      const A = placed.get(key(ed.a));
      const B = placed.get(key(ed.b));
      if (A && B) return A.clone().lerp(B, t);
    }
    // Lo más cercano ya ubicado, corrido lo mismo que en el modelo
    let best: { k: string; d: number } | null = null;
    for (const [k, o] of orig) {
      const d = o.distanceTo(v);
      if (!best || d < best.d) best = { k, d };
    }
    if (!best) return v.clone();
    return placed.get(best.k)!.clone().add(v.clone().sub(orig.get(best.k)!).multiplyScalar(0.3));
  };

  return { map, nodes: [...placed.values()] };
}
