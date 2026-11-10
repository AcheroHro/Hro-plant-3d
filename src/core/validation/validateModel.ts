import * as THREE from 'three';
import { PipingGraph } from '../graph/PipingGraph';
import { Component } from '../../types/piping';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ModelIssue {
  code:
    | 'COLLISION'
    | 'JOINT_SIZE'
    | 'JOINT_GAP'
    | 'JOINT_ANGLE'
    | 'ORPHAN_BRANCH'
    | 'SHORT_NIPPLE'
    | 'LONG_PIPE'
    | 'TRIMMED_ELBOW'
    | 'SEPARATE_RUNS'
    | 'OPEN_PORT';
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** Piezas involucradas: la primera es la que se muestra al tocar el aviso */
  componentIds: string[];
}

export interface ValidateOptions {
  /** Piezas que se chocan (ya calculadas por el detector de colisiones) */
  collidingIds?: Iterable<string>;
  /** Largo de la tira comercial de caño, en mm */
  stockLengthMm?: number;
  /** Desalineación admitida en una unión, en grados (cubre pendientes normales) */
  maxJointAngleDeg?: number;
}

const TYPE_NAME: Record<string, string> = {
  PIPE: 'Caño',
  ELBOW: 'Codo',
  TEE: 'Te',
  FLANGE: 'Brida',
  VALVE: 'Válvula',
  REDUCER: 'Reducción',
  CAP: 'Tapa',
  OLET: 'Derivación',
  CROSS: 'Cruz',
  COUPLING: 'Cupla',
  INSTRUMENT: 'Instrumento'
};

const ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

function name(comp: Component): string {
  const nd = comp.ports[0]?.nominalDiameter || comp.parameters.nominalDiameter;
  return `${TYPE_NAME[comp.type] ?? comp.type} ${nd}"`;
}

/**
 * Revisa el modelo como lo haría un proyectista antes de mandarlo a Plant 3D o al taller:
 * choques, uniones mal armadas, niples demasiado cortos y cosas para tener en cuenta.
 * Devuelve los avisos ordenados de más a menos grave.
 */
export function validateModel(graph: PipingGraph, options: ValidateOptions = {}): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const stock = options.stockLengthMm ?? 6000;
  const maxAngle = options.maxJointAngleDeg ?? 3;

  for (const id of options.collidingIds ?? []) {
    const comp = graph.components.get(id);
    if (!comp) continue;
    issues.push({
      code: 'COLLISION',
      severity: 'error',
      title: `${name(comp)} se choca con otra pieza`,
      detail: 'Dos piezas que no están unidas ocupan el mismo lugar. Mové o acortá una de las dos.',
      componentIds: [id]
    });
  }

  for (const joint of graph.joints.values()) {
    const a = graph.ports.get(joint.portAId);
    const b = graph.ports.get(joint.portBId);
    if (!a || !b) continue;
    const compA = graph.components.get(a.componentId);
    const compB = graph.components.get(b.componentId);
    if (!compA || !compB) continue;
    const ids = [compA.id, compB.id];
    const pair = `${name(compA)} y ${name(compB)}`;
    if (Math.abs(a.nominalDiameter - b.nominalDiameter) > 1e-6) {
      issues.push({
        code: 'JOINT_SIZE',
        severity: 'error',
        title: `Unión entre diámetros distintos (${a.nominalDiameter}" y ${b.nominalDiameter}")`,
        detail: `${pair} están unidos sin reducción.`,
        componentIds: ids
      });
    }
    const gap = a.position.distanceTo(b.position) - (joint.gapMm ?? 0);
    if (Math.abs(gap) > 1) {
      issues.push({
        code: 'JOINT_GAP',
        severity: 'error',
        title: `Unión separada ${Math.abs(gap).toFixed(1)} mm`,
        detail: `Las bocas de ${pair} no coinciden.`,
        componentIds: ids
      });
    }
    const angle = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(-a.direction.dot(b.direction), -1, 1)));
    if (angle > maxAngle) {
      issues.push({
        code: 'JOINT_ANGLE',
        severity: 'warning',
        title: `Unión quebrada ${angle.toFixed(1)}°`,
        detail: `${pair} no quedan alineados. Si es un cambio de dirección, ahí va un codo.`,
        componentIds: ids
      });
    }
  }

  for (const comp of graph.components.values()) {
    if (comp.type === 'OLET' && !graph.oletHost(comp)) {
      issues.push({
        code: 'ORPHAN_BRANCH',
        severity: 'error',
        title: 'Derivación sin caño donde apoyar',
        detail: 'El caño principal se borró o se acortó. Borrá la derivación o volvé a hacerla.',
        componentIds: [comp.id]
      });
    }
    if (comp.type === 'PIPE' && comp.ports.length >= 2) {
      const length = comp.ports[0].position.distanceTo(comp.ports[1].position);
      const min = Math.max(50, 2 * comp.parameters.outerDiameter);
      if (length < min - 0.5) {
        issues.push({
          code: 'SHORT_NIPPLE',
          severity: 'warning',
          title: `Niple de ${Math.round(length)} mm (mínimo ${Math.round(min)} mm)`,
          detail: `${name(comp)}: quedó más corto que dos diámetros. Cuesta soldarlo y alinearlo.`,
          componentIds: [comp.id]
        });
      }
      if (length > stock + 0.5) {
        issues.push({
          code: 'LONG_PIPE',
          severity: 'info',
          title: `Caño de ${(length / 1000).toFixed(2)} m, más largo que una tira`,
          detail: `Supera los ${stock / 1000} m de la tira comercial: lleva al menos una unión intermedia.`,
          componentIds: [comp.id]
        });
      }
    }
    if (comp.type === 'ELBOW' && comp.parameters.trimmedFrom) {
      issues.push({
        code: 'TRIMMED_ELBOW',
        severity: 'info',
        title: `Codo recortado a ${(comp.parameters.angle ?? 0).toFixed(1)}°`,
        detail: `Sale de un codo de ${comp.parameters.trimmedFrom}° cortado en taller.`,
        componentIds: [comp.id]
      });
    }
  }

  // Tramos que no están unidos entre sí
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const id of graph.components.keys()) {
    if (seen.has(id)) continue;
    const run = graph.connectedRun(id);
    run.forEach((other) => seen.add(other));
    groups.push(run);
  }
  if (groups.length > 1) {
    const smallest = [...groups].sort((x, y) => x.length - y.length)[0];
    issues.push({
      code: 'SEPARATE_RUNS',
      severity: 'info',
      title: `${groups.length} tramos sin unir entre sí`,
      detail: 'Está bien si son líneas distintas. Si tenían que ser una sola, falta una conexión.',
      componentIds: smallest
    });
  }

  for (const port of graph.getOpenPorts()) {
    const comp = graph.components.get(port.componentId);
    if (!comp) continue;
    issues.push({
      code: 'OPEN_PORT',
      severity: 'info',
      title: `Boca libre de ${port.nominalDiameter}" en ${name(comp)}`,
      detail: `Elevación de eje ${Math.round(port.position.z)} mm. Si es el final de la línea, va una tapa, una brida o un equipo.`,
      componentIds: [comp.id]
    });
  }

  return issues.sort((x, y) => ORDER[x.severity] - ORDER[y.severity]);
}

/** Cantidad de avisos por gravedad */
export function countIssues(issues: ModelIssue[]): Record<IssueSeverity, number> {
  const out: Record<IssueSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) out[issue.severity]++;
  return out;
}
