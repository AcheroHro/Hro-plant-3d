import * as THREE from 'three';
import { PipingGraph } from '../core/graph/PipingGraph';
import { Component } from '../types/piping';

export interface ModelLabel {
  id: string;
  /** cota: largo de un caño · elev: elevación de eje de un tramo horizontal · linea: número de línea */
  kind: 'cota' | 'elev' | 'linea';
  text: string;
  position: THREE.Vector3;
  componentId: string;
  /** Extremos del caño: si en pantalla quedan muy juntos, la etiqueta se oculta */
  a: THREE.Vector3;
  b: THREE.Vector3;
}

const MAX_LABELS = 240;

const lengthOf = (pipe: Component) => pipe.ports[0].position.distanceTo(pipe.ports[1].position);
const along = (pipe: Component, t: number) => pipe.ports[0].position.clone().lerp(pipe.ports[1].position, t);

/** Elevación con signo, como en los planos: EL +1200 */
export function formatElevation(z: number): string {
  const r = Math.round(z);
  return `EL ${r >= 0 ? '+' : '−'}${Math.abs(r)}`;
}

/**
 * Etiquetas permanentes del modelo: la cota de cada caño, la elevación de eje de cada nivel
 * horizontal de una línea (sobre su caño más largo) y el número de cada línea (también sobre
 * su caño más largo). `visible` limita a las piezas que se están dibujando.
 */
export function buildModelLabels(graph: PipingGraph, visible?: Set<string> | null): ModelLabel[] {
  const pipes: Component[] = [];
  for (const comp of graph.components.values()) {
    if (comp.type !== 'PIPE' || comp.ports.length < 2) continue;
    if (visible && !visible.has(comp.id)) continue;
    if (lengthOf(comp) < 1) continue;
    pipes.push(comp);
  }
  pipes.sort((p, q) => lengthOf(q) - lengthOf(p));
  const lineOf = (pipe: Component) => pipe.parameters.lineNumber || graph.activeLineNumber || '';

  const labels: ModelLabel[] = [];
  const base = (pipe: Component) => ({ componentId: pipe.id, a: pipe.ports[0].position.clone(), b: pipe.ports[1].position.clone() });

  // Número de línea y elevaciones: una vez por línea y por nivel, en el caño más largo
  const seenLine = new Set<string>();
  const seenLevel = new Set<string>();
  for (const pipe of pipes) {
    const line = lineOf(pipe);
    if (line && !seenLine.has(line)) {
      seenLine.add(line);
      labels.push({ id: `linea:${line}`, kind: 'linea', text: line, position: along(pipe, 0.75), ...base(pipe) });
    }
    const [p0, p1] = pipe.ports;
    const horizontal = Math.abs(p0.position.z - p1.position.z) < 1;
    const level = `${line}|${Math.round(p0.position.z)}`;
    if (horizontal && !seenLevel.has(level)) {
      seenLevel.add(level);
      labels.push({ id: `elev:${level}`, kind: 'elev', text: formatElevation(p0.position.z), position: along(pipe, 0.25), ...base(pipe) });
    }
  }

  // Cotas: los caños más largos primero, hasta el tope
  for (const pipe of pipes) {
    if (labels.length >= MAX_LABELS) break;
    const length = Math.round(pipe.parameters.cutLength || lengthOf(pipe));
    labels.push({ id: `cota:${pipe.id}`, kind: 'cota', text: String(length), position: along(pipe, 0.5), ...base(pipe) });
  }
  return labels;
}
