import * as THREE from 'three';
import type { Component, SupportMark } from '../../types/piping';
import type { PipingGraph } from './PipingGraph';
import { pieceName } from '../pieceNames';

/** Cota de un soporte hasta lo que tiene a un lado sobre su tramo recto */
export interface SupportSideDim {
  /** Distancia del soporte a la referencia (mm) */
  distanceMm: number;
  /** Punto de referencia sobre el eje: cara del accesorio, centro del codo o de la te, otro soporte o boca libre */
  to: THREE.Vector3;
  /** Qué hay ahí, para mostrar: "codo 4\"", "válvula 4\"", "soporte PS-101", "boca libre" */
  label: string;
  /** Lo máximo que el soporte se puede correr hacia este lado sin salirse del caño (mm) */
  roomMm: number;
}

export interface SupportDims {
  /** Dirección del tramo, de `back` hacia `ahead` */
  axis: THREE.Vector3;
  back: SupportSideDim;
  ahead: SupportSideDim;
}

const ALIGNED = 0.9995;

const centreOf = (comp: Component): THREE.Vector3 | null => {
  if (comp.type === 'ELBOW' && comp.ports.length >= 2) {
    // Vértice: donde se cruzan los ejes de las dos bocas
    const [a, b] = comp.ports;
    const ua = a.direction.clone().negate().normalize();
    const ub = b.direction.clone().negate().normalize();
    const k = ua.dot(ub);
    if (1 - k * k < 1e-8) return null;
    const w = b.position.clone().sub(a.position);
    const s = (w.dot(ua) - k * w.dot(ub)) / (1 - k * k);
    return a.position.clone().addScaledVector(ua, s);
  }
  if ((comp.type === 'TEE' || comp.type === 'CROSS') && comp.ports.length >= 2) {
    return comp.ports[0].position.clone().lerp(comp.ports[1].position, 0.5);
  }
  return null;
};

/**
 * Cotas de un soporte hasta lo más cercano a cada lado, sobre el tramo recto donde está, como las
 * cotas de ubicación de soportes de Plant: se recorre el caño (y los caños alineados que siguen)
 * hasta el primer accesorio, otro soporte o una boca libre. En codos y tes la cota llega al
 * centro, como en el isométrico; en el resto, a la cara.
 */
export function supportDimensions(graph: PipingGraph, mark: SupportMark): SupportDims | null {
  const host = graph.supportHost(mark);
  if (!host || host.ports.length < 2) return null;
  const axis = host.ports[1].position.clone().sub(host.ports[0].position).normalize();
  const others = [...graph.supports.values()].filter((s) => s.id !== mark.id);

  const walk = (sign: 1 | -1): SupportSideDim => {
    const dir = axis.clone().multiplyScalar(sign);
    const at = (p: THREE.Vector3) => p.clone().sub(mark.position).dot(dir);
    let pipe: Component = host;
    const seen = new Set<string>();
    for (let guard = 0; guard < 64; guard++) {
      seen.add(pipe.id);
      const end = pipe.ports.reduce((best, p) => (at(p.position) > at(best.position) ? p : best), pipe.ports[0]);
      const endAt = at(end.position);
      // Otro soporte sobre este caño, entre el soporte y el extremo
      let nearest: { s: SupportMark; d: number } | null = null;
      for (const s of others) {
        const d = at(s.position);
        if (d <= 0.5 || d > endAt + 0.5 || graph.supportHost(s) !== pipe) continue;
        if (!nearest || d < nearest.d) nearest = { s, d };
      }
      if (nearest) {
        return {
          distanceMm: nearest.d,
          to: mark.position.clone().addScaledVector(dir, nearest.d),
          label: `soporte${nearest.s.tag ? ` ${nearest.s.tag}` : ''}`,
          roomMm: nearest.d
        };
      }
      const mate = graph.matedPort(end);
      const next = mate ? graph.components.get(mate.componentId) : undefined;
      if (!mate || !next) return { distanceMm: endAt, to: end.position.clone(), label: 'boca libre', roomMm: endAt };
      if (next.type === 'PIPE' && !seen.has(next.id) && next.ports.length >= 2) {
        const nextAxis = next.ports[1].position.clone().sub(next.ports[0].position).normalize();
        if (Math.abs(nextAxis.dot(axis)) >= ALIGNED) {
          pipe = next;
          continue;
        }
      }
      const nd = next.ports[0]?.nominalDiameter || next.parameters.nominalDiameter;
      const label = `${pieceName(next.type).toLowerCase()} ${nd}"`;
      const centre = centreOf(next);
      if (centre) {
        const d = at(centre);
        return { distanceMm: d, to: mark.position.clone().addScaledVector(dir, d), label, roomMm: endAt };
      }
      return { distanceMm: endAt, to: end.position.clone(), label, roomMm: endAt };
    }
    return { distanceMm: 0, to: mark.position.clone(), label: '', roomMm: 0 };
  };

  return { axis, back: walk(-1), ahead: walk(1) };
}

/**
 * Corre un soporte sobre su tramo para que quede a `mm` de lo que tiene del lado `side`. No pasa
 * accesorios ni otros soportes. Devuelve el mensaje de por qué no se pudo, o null.
 */
export function moveSupportTo(graph: PipingGraph, mark: SupportMark, side: 'back' | 'ahead', mm: number): string | null {
  const dims = supportDimensions(graph, mark);
  if (!dims) return 'El soporte no está sobre un caño.';
  if (!Number.isFinite(mm) || mm < 0) return 'La medida tiene que ser positiva.';
  const here = dims[side];
  const there = dims[side === 'back' ? 'ahead' : 'back'];
  // Correrse hacia este lado es positivo; la cota baja en lo mismo
  const shift = here.distanceMm - mm;
  if (shift > here.roomMm + 0.01) {
    return `No entra: hasta ${here.label} hay como mínimo ${Math.ceil(here.distanceMm - here.roomMm)} mm de este lado.`;
  }
  if (-shift > there.roomMm + 0.01) {
    return `No entra: el soporte llegaría a ${there.label}. Lo máximo de este lado es ${Math.floor(here.distanceMm + there.roomMm)} mm.`;
  }
  const sign = side === 'ahead' ? 1 : -1;
  mark.position.addScaledVector(dims.axis, sign * shift);
  return null;
}
