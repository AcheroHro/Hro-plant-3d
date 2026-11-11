import * as THREE from 'three';
import { PipingGraph, isFaceEnd } from './PipingGraph';
import { SpecDatabaseReader } from '../specs/SpecDatabaseReader';
import { Component, Port, SpecFitting } from '../../types/piping';
import { calculateElbowPlacement } from '../math/elbowSolver';
import { trimmedTakeOff } from '../routing/routeMath';
import { valveKindFrom } from '../specs/valveKind';

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const NAMES: Record<string, string> = {
  PIPE: 'caño',
  ELBOW: 'codo',
  TEE: 'te',
  FLANGE: 'brida',
  VALVE: 'válvula',
  REDUCER: 'reducción',
  CAP: 'tapa',
  OLET: 'olet',
  COUPLING: 'cupla',
  CROSS: 'cruz',
  INSTRUMENT: 'instrumento'
};
const nameOf = (comp: Component) => NAMES[comp.type] ?? comp.type.toLowerCase();

/** Diámetro que identifica el tramo de una pieza */
function runSizeOf(comp: Component): number {
  if (comp.type === 'OLET') return comp.ports[0]?.nominalDiameter ?? comp.parameters.nominalDiameter;
  return comp.parameters.nominalDiameter || comp.ports[0]?.nominalDiameter;
}

/**
 * Piezas del tramo de un mismo diámetro al que pertenece una pieza: se recorre de unión en unión
 * mientras las dos bocas sean de ese diámetro. Las reducciones y tes reducidas del borde entran,
 * pero no se sigue por su lado de otro diámetro.
 */
export function sameSizeRun(graph: PipingGraph, startId: string): { ids: string[]; nd: number } {
  const start = graph.components.get(startId);
  if (!start) return { ids: [], nd: 0 };
  const nd = runSizeOf(start);
  const seen = new Set<string>([startId]);
  const queue = [start];
  while (queue.length) {
    const comp = queue.shift()!;
    for (const port of comp.ports) {
      if (!same(port.nominalDiameter, nd)) continue;
      const mate = graph.matedPort(port);
      if (!mate || !same(mate.nominalDiameter, nd) || seen.has(mate.componentId)) continue;
      const other = graph.components.get(mate.componentId);
      if (!other) continue;
      seen.add(other.id);
      queue.push(other);
    }
  }
  return { ids: [...seen], nd };
}

export interface ResizeResult {
  /** Piezas reemplazadas */
  changed: number;
  from: number;
  to: number;
  /** Avisos: uniones a revisar, piezas que cambiaron de tipo */
  notes: string[];
}

const PORT_KEYS = ['nominalDiameter', 'outerDiameter', 'wallThickness', 'schedule', 'endType', 'plantEndType', 'pressureClass'] as const;
const KEEP_PARAMS = ['lineNumber', 'nippleTag', 'stemAngle'] as const;

/**
 * Cambia el diámetro de un tramo entero: cada caño y accesorio se reemplaza por el de la spec en
 * el diámetro nuevo. Los ejes no se mueven: los vértices de codos y los centros de tes quedan
 * donde estaban y los caños absorben la diferencia de medidas de los accesorios.
 *
 * Primero calcula todo y recién después toca el modelo; si algo no se puede resolver tira un
 * error con el motivo y el modelo queda como estaba.
 */
export function resizeRun(graph: PipingGraph, reader: SpecDatabaseReader, startId: string, newNd: number): ResizeResult {
  const { ids, nd: oldNd } = sameSizeRun(graph, startId);
  if (!ids.length) throw new Error('No hay una pieza elegida.');
  if (same(oldNd, newNd)) throw new Error(`El tramo ya es de ${newNd}".`);
  const inRun = new Set(ids);
  const comps = ids.map((id) => graph.components.get(id)!);
  const label = (n: number) => reader.catalog.sizeLabel(n);

  const pipeSpec = reader.findPipe(newNd);
  if (!pipeSpec) throw new Error(`La spec no tiene caño de ${label(newNd)}.`);
  const pipeEnd = pipeSpec.plantEndTypes?.[0];
  const missing = (what: string): never => {
    throw new Error(`La spec no tiene ${what}. No se cambió nada.`);
  };

  /** Modelo de borrador donde se arman las piezas nuevas para copiar sus medidas y extremos */
  const draft = () => {
    const g = new PipingGraph(graph.activeSpec, newNd);
    g.connectionRules = graph.connectionRules;
    return g;
  };
  const stub = (g: PipingGraph, spec: SpecFitting = pipeSpec) => g.addPipe(new THREE.Vector3(-1000, 0, 0), new THREE.Vector3(0, 0, 0), spec);
  const byFamily = <T>(comp: Component, find: (opts: { familyId?: string; connectToEndType?: string; pressureClass?: string }) => T | null): T | null =>
    (comp.parameters.familyId ? find({ familyId: comp.parameters.familyId }) : null) ??
    find({ connectToEndType: pipeEnd, pressureClass: comp.parameters.pressureClass }) ??
    find({ connectToEndType: pipeEnd });
  const gasketFor = (cls?: string) => reader.findGasket(newNd, undefined, { pressureClass: cls });
  const boltsFor = (cls?: string) => reader.findBoltSet(newNd, undefined, { pressureClass: cls });

  // ---- Plan ----
  const oldPos = new Map<string, THREE.Vector3>();
  for (const comp of comps) for (const p of comp.ports) oldPos.set(p.id, p.position.clone());
  const posOf = (p: Port) => newPos.get(p.id) ?? oldPos.get(p.id) ?? p.position;
  const newPos = new Map<string, THREE.Vector3>();
  /** Boca de la pieza de borrador de la que cada boca copia diámetro y extremo */
  const attrs = new Map<string, Port>();
  /** Cambios de parámetros y eje de cada pieza, para aplicar al final */
  const finish: (() => void)[] = [];
  const translations: { portId: string; compId: string; delta: THREE.Vector3 }[] = [];
  const notes: string[] = [];

  const nodes = new Set<string>();
  const rigid = new Map<string, number>(); // pieza recta de dos bocas -> largo nuevo
  const terminals = new Set<string>();
  const pipes: Component[] = [];

  const applyParams = (comp: Component, proto: Component) => {
    const kept = KEEP_PARAMS.map((k) => [k, comp.parameters[k]] as const);
    comp.specCode = proto.specCode;
    comp.catalogId = proto.catalogId;
    Object.assign(comp.parameters, proto.parameters);
    const params = comp.parameters as unknown as Record<string, unknown>;
    for (const [k, v] of kept) if (v !== undefined) params[k] = v;
    delete comp.parameters.pcf;
  };

  for (const comp of comps) {
    if (comp.type === 'PIPE' && comp.ports.length >= 2) {
      const proto = stub(draft());
      comp.ports.forEach((p, i) => attrs.set(p.id, proto.ports[i]));
      pipes.push(comp);
      finish.push(() => {
        applyParams(comp, proto);
        const length = comp.ports[0].position.distanceTo(comp.ports[1].position);
        comp.centerline = [comp.ports[0].position.clone(), comp.ports[1].position.clone()];
        comp.parameters.cutLength = length;
        comp.parameters.grossLength = length;
      });
      continue;
    }

    if (comp.type === 'ELBOW' && comp.ports.length >= 2) {
      const [pIn, pOut] = comp.ports;
      const uIn = pIn.direction.clone().negate().normalize();
      const uOut = pOut.direction.clone().normalize();
      const k = uIn.dot(uOut);
      if (1 - k * k < 1e-8) throw new Error('Hay un codo sin ángulo en el tramo. Borralo y volvé a intentar.');
      const chord = pOut.position.clone().sub(pIn.position);
      const s0 = (chord.dot(uIn) - k * chord.dot(uOut)) / (1 - k * k);
      const vertex = pIn.position.clone().addScaledVector(uIn, s0);
      const angle = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(k, -1, 1)));
      const base = comp.parameters.trimmedFrom ?? (Math.abs(angle - 45) < 1 ? 45 : Math.abs(angle - 90) < 1 ? 90 : angle < 45 ? 45 : 90);
      const spec = byFamily(comp, (o) => reader.findElbow(newNd, base, undefined, o)) ?? missing(`codo de ${base}° en ${label(newNd)}`);
      const trimmed = Math.abs(angle - base) > 0.5;
      const rad = THREE.MathUtils.degToRad(angle);
      let takeOff = spec.takeOff || (spec.radius ? spec.radius * Math.tan(rad / 2) : 0);
      if (trimmed) {
        const end = spec.plantEndTypes?.[0];
        const buttWeld = end ? end.toUpperCase() === 'BV' : spec.endType === 'BW';
        if (!buttWeld) throw new Error(`Hay un codo recortado a ${angle.toFixed(1)}° y los codos de ${label(newNd)} no se pueden recortar.`);
        const radius = spec.radius || takeOff / Math.tan(THREE.MathUtils.degToRad(base) / 2);
        takeOff = trimmedTakeOff(radius, angle);
      }
      if (!takeOff) throw new Error(`El codo de ${label(newNd)} de la spec no trae medidas.`);
      const takeOut = trimmed ? takeOff : spec.takeOff2 || takeOff;
      newPos.set(pIn.id, vertex.clone().addScaledVector(uIn, -takeOff));
      newPos.set(pOut.id, vertex.clone().addScaledVector(uOut, takeOut));
      nodes.add(comp.id);
      finish.push(() => {
        const placement = calculateElbowPlacement(
          vertex.clone().addScaledVector(uIn, -takeOff - 100),
          vertex,
          vertex.clone().addScaledVector(uOut, takeOff + 100),
          takeOff,
          spec.radius
        );
        [pIn, pOut].forEach((port, i) =>
          Object.assign(port, graph.portFromSpec(comp.id, port.index, port.position, port.direction, spec, i), {
            id: port.id,
            connectedJointId: port.connectedJointId
          })
        );
        comp.specCode = spec.specCode;
        comp.catalogId = String(spec.pnpid);
        comp.centerline = placement.centerline.map((pt) => pt.clone());
        Object.assign(comp.parameters, {
          nominalDiameter: spec.nominalDiameter,
          outerDiameter: spec.outerDiameter,
          wallThickness: spec.wallThickness,
          schedule: spec.schedule,
          angle: placement.bendAngleDeg,
          radius: spec.radius || spec.takeOff,
          takeOff: trimmed ? takeOff : spec.takeOff,
          trimmedFrom: trimmed ? base : undefined,
          description: spec.shortDescription,
          matrixElements: Array.from(placement.matrix.elements),
          ...graph.specParameters(spec)
        });
        delete comp.parameters.pcf;
      });
      continue;
    }

    if (comp.type === 'TEE' && comp.ports.length >= 3 && comp.centerline.length >= 2) {
      const [r1, , br] = comp.ports;
      const runNew = same(r1.nominalDiameter, oldNd) ? newNd : r1.nominalDiameter;
      const branchNew = same(br.nominalDiameter, oldNd) ? newNd : br.nominalDiameter;
      if (branchNew > runNew + 1e-6) {
        throw new Error(`El ramal de una te quedaría de ${label(branchNew)}, más grande que su línea principal de ${label(runNew)}. Cambiá primero la línea principal.`);
      }
      let spec: SpecFitting | null;
      if (same(runNew, branchNew)) {
        spec = byFamily(comp, (o) => reader.findTee(runNew, undefined, o));
        if (spec?.reducedNominalDiameter && !same(spec.reducedNominalDiameter, runNew)) spec = reader.findTee(runNew);
        if (spec?.reducedNominalDiameter && !same(spec.reducedNominalDiameter, runNew)) spec = null;
        if (!spec) missing(`te de ${label(runNew)}`);
      } else {
        spec = reader.findTee(runNew, undefined, { branchDiameter: branchNew });
        const got = spec?.reducedNominalDiameter ?? spec?.portNominalDiameters?.[2];
        if (!spec || got === undefined || !same(got, branchNew)) missing(`te reducida de ${label(runNew)} x ${label(branchNew)}`);
      }
      const g = draft();
      const proto = g.addTee(stub(g, reader.findPipe(runNew) ?? pipeSpec).ports[1], new THREE.Vector3(0, 0, 1), spec!);
      const centre = comp.centerline[1].clone();
      const run = proto.parameters.runTakeOff || 63.5;
      const branch = proto.parameters.branchTakeOff || 63.5;
      comp.ports.slice(0, 3).forEach((p, i) => {
        attrs.set(p.id, proto.ports[i]);
        newPos.set(p.id, centre.clone().addScaledVector(p.direction.clone().normalize(), i < 2 ? run : branch));
      });
      nodes.add(comp.id);
      finish.push(() => {
        applyParams(comp, proto);
        comp.centerline = [comp.ports[0].position.clone(), centre.clone(), comp.ports[1].position.clone(), comp.ports[2].position.clone()];
      });
      continue;
    }

    if (comp.type === 'REDUCER' && comp.ports.length === 2) {
      const sPort = comp.ports.find((p) => same(p.nominalDiameter, oldNd))!;
      const xPort = comp.ports.find((p) => p !== sPort)!;
      const other = xPort.nominalDiameter;
      if (same(other, oldNd)) throw new Error('Hay una reducción con las dos bocas del mismo diámetro. Borrala y volvé a intentar.');
      if (same(other, newNd)) {
        throw new Error(`El tramo llega a una reducción ${label(Math.max(oldNd, other))} x ${label(Math.min(oldNd, other))}: con ${label(newNd)} ya no haría falta. Borrá esa reducción antes de cambiar el diámetro.`);
      }
      const u = sPort.direction.clone().normalize();
      const lOld = sPort.position.clone().sub(xPort.position).dot(u);
      const latOld = xPort.position.clone().sub(sPort.position.clone().addScaledVector(u, -lOld));
      const wasEcc = latOld.length() > 0.05;
      const spec =
        reader.findReducer(newNd, other, undefined, { eccentric: wasEcc }) ??
        reader.findReducer(newNd, other) ??
        missing(`reducción de ${label(Math.max(newNd, other))} x ${label(Math.min(newNd, other))}`);
      const g = draft();
      const proto = g.addReducer(stub(g).ports[1], spec);
      const protoBig = proto.ports[0];
      const protoSmall = proto.ports[1];
      const sIsBig = newNd > other;
      attrs.set(sPort.id, sIsBig ? protoBig : protoSmall);
      attrs.set(xPort.id, sIsBig ? protoSmall : protoBig);
      const lNew = proto.parameters.faceToFace || lOld;
      const offNew = proto.parameters.lateralOffset ?? 0;
      // Lado del plano de la excéntrica: se conserva; si era concéntrica, plano abajo
      let flat: THREE.Vector3;
      if (wasEcc) flat = latOld.clone().normalize().multiplyScalar(other < oldNd ? 1 : -1);
      else {
        flat = Math.abs(u.z) > 0.9 ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 0, -1);
        flat.addScaledVector(u, -flat.dot(u)).normalize();
      }
      const latNew = offNew > 0.05 ? flat.clone().multiplyScalar((other < newNd ? 1 : -1) * offNew) : new THREE.Vector3();
      const shift = latNew.clone().sub(latOld);
      newPos.set(sPort.id, sPort.position.clone().addScaledVector(u, lNew - lOld));
      if (shift.length() > 0.05) {
        // El lado que no cambia queda quieto: se corre de eje el tramo que se está cambiando
        if (graph.closesLoopThrough(comp.id, sPort.id)) {
          throw new Error('La reducción excéntrica del borde está en un circuito cerrado y el tramo se tendría que correr de eje. Cortá el circuito primero.');
        }
        translations.push({ portId: sPort.id, compId: comp.id, delta: shift.clone().negate() });
        notes.push(
          wasEcc
            ? `La excéntrica a ${label(other)} cambió de medida: el tramo se corrió ${Math.round(shift.length())} mm de eje.`
            : `La reducción a ${label(other)} pasó a ser excéntrica (la spec no tiene concéntrica en esa medida): el tramo se corrió ${Math.round(shift.length())} mm de eje.`
        );
      }
      nodes.add(comp.id);
      finish.push(() => {
        applyParams(comp, proto);
        comp.centerline = [comp.ports[0].position.clone(), comp.ports[1].position.clone()];
      });
      continue;
    }

    if (comp.type === 'OLET' && comp.ports.length === 1) {
      const port = comp.ports[0];
      const hostNd = comp.parameters.nominalDiameter;
      if (newNd > hostNd - 1e-6) {
        throw new Error(`El tramo nace de una derivación sobre un caño de ${label(hostNd)}: el ramal tiene que ser más chico. Para ${label(newNd)} hace falta una te.`);
      }
      const hostSpec = reader.findPipe(hostNd) ?? missing(`caño de ${label(hostNd)}`);
      const oletSpec = reader.findFitting({ partType: 'OLET', nominalDiameter: hostNd, reducedNominalDiameter: newNd });
      if (!oletSpec && !comp.parameters.stubIn) notes.push(`La spec no tiene olet ${label(hostNd)} x ${label(newNd)}: la derivación quedó como injerto directo.`);
      const g = draft();
      const proto = g.addBranchOnPipe(stub(g, hostSpec).id, 500, new THREE.Vector3(0, 0, 1), pipeSpec, oletSpec);
      const centre = comp.centerline[0].clone();
      attrs.set(port.id, proto.ports[0]);
      newPos.set(port.id, centre.clone().addScaledVector(port.direction.clone().normalize(), proto.parameters.takeOff ?? 0));
      nodes.add(comp.id);
      finish.push(() => {
        applyParams(comp, proto);
        comp.parameters.outerDiameter = proto.parameters.outerDiameter;
        comp.centerline = [centre.clone(), port.position.clone()];
      });
      continue;
    }

    if (comp.type === 'FLANGE' && comp.ports.length === 1) {
      const cls = comp.parameters.pressureClass;
      const blindSpec = reader.catalog.find({ category: 'FLANGE_BLIND', nominalDiameter: newNd }) ?? missing(`brida ciega de ${label(newNd)}`);
      const flangeSpec = reader.findFlange(newNd, undefined, { connectToEndType: pipeEnd, pressureClass: cls }) ?? missing(`brida de ${label(newNd)}`);
      const g = draft();
      const proto = g.addBlindFlange(stub(g).ports[1], blindSpec, { flangeSpec, gasketSpec: gasketFor(cls), boltSetSpec: boltsFor(cls) }).blind;
      attrs.set(comp.ports[0].id, proto.ports[0]);
      terminals.add(comp.id);
      const before = comp.ports[0].position.clone();
      finish.push(() => {
        applyParams(comp, proto);
        const move = comp.ports[0].position.clone().sub(before);
        comp.centerline.forEach((pt) => pt.add(move));
      });
      continue;
    }

    if (comp.type === 'CAP' && comp.ports.length === 1) {
      const spec = byFamily(comp, (o) => reader.findCap(newNd, undefined, o)) ?? missing(`tapa de ${label(newNd)}`);
      const g = draft();
      const proto = g.addCap(stub(g).ports[1], spec);
      attrs.set(comp.ports[0].id, proto.ports[0]);
      terminals.add(comp.id);
      finish.push(() => {
        applyParams(comp, proto);
        const p = comp.ports[0];
        comp.centerline = [p.position.clone(), p.position.clone().addScaledVector(p.direction.clone().normalize(), -(proto.parameters.faceToFace || 38.1))];
      });
      continue;
    }

    if ((comp.type === 'FLANGE' || comp.type === 'VALVE' || comp.type === 'COUPLING') && comp.ports.length === 2) {
      const cls = comp.parameters.pressureClass;
      const g = draft();
      const at = stub(g).ports[1];
      let proto: Component;
      if (comp.type === 'FLANGE') {
        const spec = byFamily(comp, (o) => reader.findFlange(newNd, undefined, o)) ?? missing(`brida de ${label(newNd)}`);
        proto = g.addFlange(at, spec, gasketFor(cls ?? spec.pressureClass), boltsFor(cls ?? spec.pressureClass));
      } else if (comp.type === 'VALVE') {
        const spec = pickValve(comp) ?? missing(`válvula equivalente de ${label(newNd)}`);
        proto = g.addValve(at, spec, gasketFor(cls ?? spec.pressureClass), boltsFor(cls ?? spec.pressureClass));
      } else {
        const spec = reader.catalog.find({ category: 'COUPLING', nominalDiameter: newNd }) ?? missing(`cupla de ${label(newNd)}`);
        proto = g.addCoupling(at, spec);
      }
      // En las bridas la cara sigue del mismo lado
      const swap = comp.type === 'FLANGE' && isFaceEnd(comp.ports[0]) !== isFaceEnd(proto.ports[0]);
      comp.ports.forEach((p, i) => attrs.set(p.id, proto.ports[swap ? 1 - i : i]));
      rigid.set(comp.id, proto.ports[0].position.distanceTo(proto.ports[1].position));
      finish.push(() => {
        applyParams(comp, proto);
        comp.centerline = [comp.ports[0].position.clone(), comp.ports[1].position.clone()];
      });
      continue;
    }

    throw new Error(`En el tramo hay un ${nameOf(comp)} que no se puede cambiar de diámetro solo. Reemplazalo a mano.`);
  }

  /** Válvula del diámetro nuevo: misma familia; si no, mismo tipo y misma forma de unirse */
  function pickValve(comp: Component): SpecFitting | null {
    if (comp.parameters.familyId) {
      const exact = reader.findValve(newNd, undefined, { familyId: comp.parameters.familyId });
      if (exact && exact.familyId === comp.parameters.familyId) return exact;
    }
    const kind = comp.parameters.visual?.valveKind ?? valveKindFrom(comp.parameters.familyDescription || comp.parameters.description, undefined, comp.parameters.skey);
    const oldEnd = (comp.ports[0].plantEndType || '').toUpperCase();
    const wasFace = isFaceEnd(comp.ports[0]);
    const families = reader.listFamilies('VALVE', newNd);
    const score = (fam: (typeof families)[number]) => {
      const end = (fam.endTypes[0] || '').toUpperCase();
      const face = ['FL', 'LFL', 'WF', 'LUG'].includes(end);
      const fits = face || !pipeEnd ? true : graph.resolveJoint({ plantEndType: end, nominalDiameter: newNd } as Port, { plantEndType: pipeEnd, nominalDiameter: newNd } as Port).problems.length === 0;
      return (valveKindFrom(fam.familyDesc) === kind ? 0 : 1000) + (face === wasFace ? 0 : 100) + (fits ? 0 : 50) + (end === oldEnd ? 0 : 1);
    };
    const best = [...families].sort((a, b) => score(a) - score(b))[0];
    if (!best) return null;
    const spec = reader.findValve(newNd, undefined, { familyId: best.familyId });
    if (spec && score(best) >= 100) notes.push(`Una válvula pasó a ser ${spec.shortDescription}: revisá que sea la que querés.`);
    return spec;
  }

  // ---- Piezas rectas en cadena (bridas, válvulas, cuplas): se acomodan entre los puntos fijos ----
  const mateIn = (port: Port): { port: Port; comp: Component } | null => {
    const mate = graph.matedPort(port);
    const comp = mate ? graph.components.get(mate.componentId) : null;
    return mate && comp ? { port: mate, comp } : null;
  };
  /** Posición nueva de una boca que sigue a su vecina, conservando la luz de la junta */
  const follow = (port: Port, mate: Port) => posOf(mate).clone().add(oldPos.get(port.id)!.clone().sub(oldPos.get(mate.id) ?? mate.position));

  const placed = new Set<string>();
  for (const id of rigid.keys()) {
    if (placed.has(id)) continue;
    // Ir hasta una punta de la cadena
    let cur = graph.components.get(id)!;
    let outer = cur.ports[0];
    for (let guard = 0; guard < 500; guard++) {
      const next = mateIn(outer);
      if (!next || !rigid.has(next.comp.id) || next.comp.id === id) break;
      cur = next.comp;
      outer = cur.ports.find((p) => p !== next.port)!;
    }
    const members: { comp: Component; a: Port; b: Port }[] = [];
    let a = outer;
    for (let guard = 0; guard < 500; guard++) {
      const b = cur.ports.find((p) => p !== a)!;
      members.push({ comp: cur, a, b });
      placed.add(cur.id);
      const next = mateIn(b);
      if (!next || !rigid.has(next.comp.id) || placed.has(next.comp.id)) break;
      cur = next.comp;
      a = next.port;
    }
    const endA = members[0].a;
    const endB = members[members.length - 1].b;
    const axis = oldPos.get(endB.id)!.clone().sub(oldPos.get(endA.id)!);
    if (axis.length() < 0.01) throw new Error(`Hay una ${nameOf(members[0].comp)} sin largo en el tramo.`);
    axis.normalize();
    let total = 0;
    const gaps: number[] = [];
    members.forEach((m, i) => {
      total += rigid.get(m.comp.id)!;
      if (i + 1 < members.length) {
        const gap = oldPos.get(members[i + 1].a.id)!.distanceTo(oldPos.get(m.b.id)!);
        gaps.push(gap);
        total += gap;
      }
    });
    const endInfo = (port: Port): { kind: 'hard' | 'soft' | 'free'; pos: THREE.Vector3 } => {
      const mate = mateIn(port);
      const own = oldPos.get(port.id)!.clone();
      if (!mate) return { kind: 'soft', pos: own };
      if (!inRun.has(mate.comp.id)) return { kind: 'hard', pos: own };
      if (nodes.has(mate.comp.id)) return { kind: 'hard', pos: follow(port, mate.port) };
      if (terminals.has(mate.comp.id)) return { kind: 'soft', pos: own };
      return { kind: 'free', pos: own };
    };
    const ia = endInfo(endA);
    const ib = endInfo(endB);
    let start: THREE.Vector3;
    if (ia.kind === 'hard' && ib.kind === 'hard') {
      const room = ib.pos.clone().sub(ia.pos).dot(axis);
      if (Math.abs(room - total) > 0.5) {
        throw new Error(
          `Entre dos accesorios hay ${members.length > 1 ? 'piezas' : `una ${nameOf(members[0].comp)}`} sin caño en el medio: en ${label(newNd)} ${members.length > 1 ? 'miden' : 'mide'} ${Math.round(total)} mm y el lugar es de ${Math.round(room)} mm. Agregá un caño ahí o cambiá esas piezas a mano.`
        );
      }
      start = ia.pos;
    } else if (ia.kind === 'hard') start = ia.pos;
    else if (ib.kind === 'hard') start = ib.pos.clone().addScaledVector(axis, -total);
    else if (ia.kind === 'soft') start = ia.pos;
    else if (ib.kind === 'soft') start = ib.pos.clone().addScaledVector(axis, -total);
    else start = ia.pos.clone().lerp(ib.pos, 0.5).addScaledVector(axis, -total / 2);
    const cursor = start.clone();
    members.forEach((m, i) => {
      newPos.set(m.a.id, cursor.clone());
      cursor.addScaledVector(axis, rigid.get(m.comp.id)!);
      newPos.set(m.b.id, cursor.clone());
      if (i < gaps.length) cursor.addScaledVector(axis, gaps[i]);
    });
  }

  // Dos accesorios soldados entre sí (codo con codo, codo con reducción): no hay caño que absorba
  for (const id of nodes) {
    const comp = graph.components.get(id)!;
    for (const port of comp.ports) {
      const mate = mateIn(port);
      if (!mate || !nodes.has(mate.comp.id)) continue;
      const before = oldPos.get(port.id)!.distanceTo(oldPos.get(mate.port.id)!);
      if (Math.abs(posOf(port).distanceTo(posOf(mate.port)) - before) > 0.5) {
        throw new Error(
          `Hay un ${nameOf(comp)} unido directo a un ${nameOf(mate.comp)}, sin caño en el medio: con las medidas de ${label(newNd)} no cierran sin mover los ejes. Agregá un caño entre los dos o cambialos a mano.`
        );
      }
    }
  }

  // Tapas y bridas ciegas siguen a la pieza donde cierran
  for (const id of terminals) {
    const port = graph.components.get(id)!.ports[0];
    const mate = mateIn(port);
    if (mate && newPos.has(mate.port.id)) newPos.set(port.id, follow(port, mate.port));
  }

  // Los caños absorben la diferencia: cada punta sigue a la pieza que tiene unida
  const checkPipe = (pipe: Component, p0: THREE.Vector3, p1: THREE.Vector3) => {
    const dir = pipe.ports[1].position.clone().sub(pipe.ports[0].position).normalize();
    const span = p1.clone().sub(p0);
    const length = span.dot(dir);
    const was = Math.round(pipe.ports[0].position.distanceTo(pipe.ports[1].position));
    if (length < 5) {
      throw new Error(`Un caño de ${was} mm queda sin largo: los accesorios de ${label(newNd)} ocupan más lugar. Alargá ese tramo antes de cambiar el diámetro.`);
    }
    if (span.addScaledVector(dir, -length).length() > 0.5) throw new Error(`Un caño de ${was} mm dejaría de estar derecho. No se cambió nada.`);
  };
  for (const pipe of pipes) {
    for (const port of pipe.ports) {
      const mate = mateIn(port);
      if (mate && newPos.has(mate.port.id)) newPos.set(port.id, follow(port, mate.port));
    }
    checkPipe(pipe, posOf(pipe.ports[0]), posOf(pipe.ports[1]));
  }

  // Vecinos de otro diámetro (corrida de una te reducida): si son caños, se ajustan a la boca nueva
  const outside: { port: Port; pos: THREE.Vector3 }[] = [];
  for (const comp of comps) {
    for (const port of comp.ports) {
      const moved = newPos.get(port.id);
      if (!moved || moved.distanceTo(oldPos.get(port.id)!) < 0.05) continue;
      const mate = mateIn(port);
      if (!mate || inRun.has(mate.comp.id) || translations.some((t) => t.portId === port.id)) continue;
      if (mate.comp.type !== 'PIPE' || mate.comp.ports.length < 2) {
        throw new Error(`Un ${nameOf(comp)} del tramo cambia de medida y está unido directo a un ${nameOf(mate.comp)} de otro diámetro, sin caño que absorba la diferencia.`);
      }
      const pos = mate.port.position.clone().add(moved.clone().sub(oldPos.get(port.id)!));
      const [q0, q1] = mate.comp.ports;
      checkPipe(mate.comp, q0 === mate.port ? pos : q0.position, q1 === mate.port ? pos : q1.position);
      outside.push({ port: mate.port, pos });
    }
  }

  // Olets apoyados en caños del tramo: cambian de medida de cabecera y su boca se aleja o acerca
  const hosted: (() => void)[] = [];
  for (const pipe of pipes) {
    for (const olet of graph.oletsOn(pipe)) {
      if (inRun.has(olet.id) || olet.ports.length !== 1) continue;
      const port = olet.ports[0];
      const branchNd = port.nominalDiameter;
      const branchSpec = reader.findPipe(branchNd) ?? missing(`caño de ${label(branchNd)}`);
      if (branchSpec.outerDiameter > pipeSpec.outerDiameter + 0.1) {
        throw new Error(`Sobre el tramo hay una derivación de ${label(branchNd)}, que no entra en un caño de ${label(newNd)}. Borrala o cambiala primero.`);
      }
      const oletSpec = same(branchNd, newNd) ? null : reader.findFitting({ partType: 'OLET', nominalDiameter: newNd, reducedNominalDiameter: branchNd });
      if (!oletSpec && !olet.parameters.stubIn) notes.push(`La spec no tiene olet ${label(newNd)} x ${label(branchNd)}: una derivación quedó como injerto directo.`);
      const g = draft();
      const proto = g.addBranchOnPipe(stub(g).id, 500, new THREE.Vector3(0, 0, 1), branchSpec, oletSpec);
      const centre = olet.centerline[0].clone();
      const pos = centre.clone().addScaledVector(port.direction.clone().normalize(), proto.parameters.takeOff ?? 0);
      const delta = pos.clone().sub(port.position);
      hosted.push(() => {
        if (delta.length() > 0.05 && port.connectedJointId) graph.translateDownstream(port.id, olet.id, delta);
        port.position.copy(pos);
        PORT_KEYS.forEach((k) => ((port as unknown as Record<string, unknown>)[k] = proto.ports[0][k]));
        applyParams(olet, proto);
        olet.centerline = [centre.clone(), pos.clone()];
      });
    }
  }

  // ---- Aplicar ----
  for (const comp of comps) {
    for (const port of comp.ports) {
      const pos = newPos.get(port.id);
      if (pos) port.position.copy(pos);
      const from = attrs.get(port.id);
      if (from) PORT_KEYS.forEach((k) => ((port as unknown as Record<string, unknown>)[k] = from[k]));
    }
  }
  finish.forEach((fn) => fn());
  for (const { port, pos } of outside) {
    const pipe = graph.components.get(port.componentId)!;
    port.position.copy(pos);
    pipe.centerline = [pipe.ports[0].position.clone(), pipe.ports[1].position.clone()];
    const length = pipe.ports[0].position.distanceTo(pipe.ports[1].position);
    pipe.parameters.cutLength = length;
    pipe.parameters.grossLength = length;
  }
  hosted.forEach((fn) => fn());
  // Excéntricas del borde: el tramo cambiado se corre de eje junto con su boca de la reducción
  for (const t of translations) {
    const port = graph.ports.get(t.portId)!;
    const comp = graph.components.get(t.compId)!;
    graph.translateDownstream(t.portId, t.compId, t.delta);
    port.position.add(t.delta);
    comp.centerline = [comp.ports[0].position.clone(), comp.ports[1].position.clone()];
  }

  const problems = new Set<string>();
  for (const comp of comps) for (const port of comp.ports) graph.refreshJoint(port).forEach((p) => problems.add(p));
  if (problems.size) notes.push(`${problems.size} unión${problems.size > 1 ? 'es' : ''} a revisar: ${[...problems][0]}`);

  return { changed: comps.length, from: oldNd, to: newNd, notes };
}
