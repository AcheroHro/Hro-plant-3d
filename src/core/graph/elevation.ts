import * as THREE from 'three';
import type { Component, Port } from '../../types/piping';
import type { PipingGraph } from './PipingGraph';

const VERTICAL = 0.99;
const MIN_PIPE_MM = 20;

/** Caño que cambia de largo al subir o bajar un grupo: su boca `portId` se corre con el grupo */
export interface ElevationStretch {
  pipeId: string;
  portId: string;
  fromMm: number;
  toMm: number;
}

export interface ElevationPlan {
  /** Elevación del eje de la pieza, antes y después (mm) */
  fromZ: number;
  toZ: number;
  /** Piezas que se mueven enteras */
  moveIds: Set<string>;
  /** Caños verticales que se estiran o se acortan */
  stretch: ElevationStretch[];
}

const axisOf = (c: Component): THREE.Vector3 | null =>
  c.ports.length >= 2 ? c.ports[1].position.clone().sub(c.ports[0].position).normalize() : null;

export const isVerticalPipe = (c: Component): boolean => {
  const a = c.type === 'PIPE' ? axisOf(c) : null;
  return !!a && Math.abs(a.z) >= VERTICAL;
};

/** Elevación del eje de una pieza: la media de sus bocas (en un caño horizontal, su eje) */
export function pieceElevation(comp: Component): number {
  if (!comp.ports.length) return comp.centerline[0]?.z ?? 0;
  return comp.ports.reduce((s, p) => s + p.position.z, 0) / comp.ports.length;
}

/**
 * Qué pasa si la pieza se sube o se baja hasta `z`, como la manija de elevación de Plant: se mueve
 * todo lo que está unido a ella sin pasar por un caño vertical, y los caños verticales que la
 * atan al resto se estiran o se acortan. Una pieza dentro de un tramo vertical se desliza sobre
 * el tramo. Devuelve un mensaje si no se puede.
 */
export function planElevation(graph: PipingGraph, componentId: string, z: number): ElevationPlan | string {
  const comp = graph.components.get(componentId);
  if (!comp) return 'Esa pieza ya no está en el modelo.';
  if (!Number.isFinite(z)) return 'Escribí una elevación en milímetros.';
  if (isVerticalPipe(comp)) return 'Es un caño vertical: cambiale el largo, o cambiá la elevación desde el tramo horizontal o una pieza.';
  const fromZ = pieceElevation(comp);
  const dz = z - fromZ;

  const moveIds = new Set<string>([comp.id]);
  const touching = new Map<string, Port[]>(); // caño vertical -> bocas suyas unidas al grupo
  const queue: Component[] = [comp];
  const visit = (c: Component) => {
    if (moveIds.has(c.id)) return;
    moveIds.add(c.id);
    queue.push(c);
  };
  while (queue.length) {
    const c = queue.shift()!;
    for (const port of c.ports) {
      const mate = graph.matedPort(port);
      const next = mate ? graph.components.get(mate.componentId) : undefined;
      if (!mate || !next || moveIds.has(next.id)) continue;
      if (isVerticalPipe(next)) {
        const list = touching.get(next.id) ?? [];
        if (!list.includes(mate)) list.push(mate);
        touching.set(next.id, list);
      } else visit(next);
    }
    // Olets apoyados en un caño del grupo y el caño donde apoya un olet del grupo
    if (c.type === 'PIPE') for (const o of graph.oletsOn(c)) visit(o);
    if (c.type === 'OLET') {
      const host = graph.oletHost(c);
      if (host && !isVerticalPipe(host)) visit(host);
      else if (host) return 'La pieza sale con un olet de un caño vertical: cambiá la elevación desde el caño vertical.';
    }
  }

  const stretch: ElevationStretch[] = [];
  for (const [pipeId, ports] of touching) {
    const pipe = graph.components.get(pipeId)!;
    if (ports.length >= 2 || moveIds.has(pipeId)) {
      // Los dos extremos van con el grupo: el caño se mueve entero
      moveIds.add(pipeId);
      continue;
    }
    if (graph.oletsOn(pipe).length) return 'Un caño vertical que habría que estirar tiene un olet: movelo a mano.';
    const port = ports[0];
    const other = pipe.ports.find((p) => p.id !== port.id)!;
    const axis = port.position.clone().sub(other.position);
    const fromMm = axis.length();
    const toMm = port.position.clone().add(new THREE.Vector3(0, 0, dz)).sub(other.position).dot(axis.normalize());
    if (toMm < MIN_PIPE_MM) {
      return `El caño vertical de ${pipe.parameters.nominalDiameter}" quedaría de ${Math.round(toMm)} mm: se puede ${dz > 0 ? 'subir' : 'bajar'} como máximo ${Math.floor(Math.abs(dz) - (MIN_PIPE_MM - toMm))} mm.`;
    }
    stretch.push({ pipeId, portId: port.id, fromMm, toMm });
  }
  return { fromZ, toZ: z, moveIds, stretch };
}

/** Aplica un plan de `planElevation` */
export function applyElevation(graph: PipingGraph, plan: ElevationPlan): void {
  const delta = new THREE.Vector3(0, 0, plan.toZ - plan.fromZ);
  if (Math.abs(delta.z) < 1e-6) return;
  const joints = new Set<string>();
  for (const id of plan.moveIds) {
    for (const p of graph.components.get(id)?.ports ?? []) if (p.connectedJointId) joints.add(p.connectedJointId);
  }
  graph.translateGroup(plan.moveIds, joints, delta);
  for (const s of plan.stretch) {
    const pipe = graph.components.get(s.pipeId);
    const port = graph.ports.get(s.portId);
    if (!pipe || !port) continue;
    port.position.add(delta);
    pipe.centerline[pipe.ports.indexOf(port)]?.copy(port.position);
    pipe.parameters.cutLength = s.toMm;
    pipe.parameters.grossLength = s.toMm;
  }
}
