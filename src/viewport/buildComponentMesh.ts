import * as THREE from 'three';
import { Component } from '../types/piping';
import { isFaceEnd } from '../core/graph/PipingGraph';
import { valveKindFrom } from '../core/specs/valveKind';
import { createPipeGeometry } from './geometries/pipeGeometry';
import { createElbowGeometry } from './geometries/elbowGeometry';
import { createBlindFlangeGeometry, createFlangeGeometry } from './geometries/flangeGeometry';
import { createTeeGeometry } from './geometries/teeGeometry';
import { createReducerGeometry } from './geometries/reducerGeometry';
import { createValveGeometries, ValveShape } from './geometries/valveGeometry';
import { createCapGeometry } from './geometries/capGeometry';

export interface PieceMaterials {
  pipe: THREE.Material;
  fitting: THREE.Material;
  tee: THREE.Material;
  flange: THREE.Material;
  valve: THREE.Material;
  /** Volantes y palancas */
  trim: THREE.Material;
}

export interface BuildContext {
  materials: PieceMaterials;
  /** Material final de la pieza: selección, choque o vista por spools pisan el material por tipo */
  pick: (base: THREE.Material) => THREE.Material;
  /** Olet: diámetro exterior del caño donde apoya */
  hostOuterDiameter?: number;
}

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);

/** Forma de una válvula a partir de sus bocas y de las medidas que trajo de la spec */
export function valveShapeOf(comp: Component): ValveShape {
  const params = comp.parameters;
  const vis = params.visual;
  const port = comp.ports[0];
  const od = port?.outerDiameter || params.outerDiameter;
  const plant = (port?.plantEndType || '').toUpperCase();
  let ends: ValveShape['ends'];
  if (plant === 'WF' || plant === 'LUG') ends = 'wafer';
  else if (plant === 'FL' || plant === 'LFL') ends = 'flanged';
  else if (plant === 'BV') ends = 'buttweld';
  else if (plant === 'SW' || plant.startsWith('THD')) ends = 'socket';
  else if (port?.endType === 'FLANG') ends = 'flanged';
  else if (port?.endType === 'SW' || port?.endType === 'THD') ends = 'socket';
  else ends = (vis?.flangeOuterDiameter ?? 0) > od * 1.2 || !port ? 'flanged' : 'buttweld';

  const kind = vis?.valveKind ?? valveKindFrom(params.familyDescription || params.description, undefined, params.skey);
  const flangeDiameter = (vis?.flangeOuterDiameter ?? 0) > od * 1.15 ? vis!.flangeOuterDiameter : undefined;
  return {
    kind,
    ends,
    flangeDiameter,
    flangeThickness: (vis?.flangeThickness ?? 0) > 1 ? vis!.flangeThickness : undefined,
    actuator: vis?.actuator ?? (kind === 'check' ? 'none' : undefined),
    actuatorHeight: vis?.actuatorHeight,
    wheelDiameter: vis?.actuatorDiameter,
    leverLength: vis?.actuatorLength
  };
}

/**
 * Hacia dónde sale el vástago de una válvula: hacia arriba; en una línea vertical, hacia +X.
 * Siempre perpendicular al caño.
 */
export function valveStemDirection(axis: THREE.Vector3, stemAngleDeg = 0): THREE.Vector3 {
  const a = axis.clone().normalize();
  const up = Math.abs(a.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  up.addScaledVector(a, -up.dot(a)).normalize();
  // El giro se mide siempre igual aunque la válvula se dé vuelta: alrededor del eje "positivo"
  const ref = a.x + a.y + a.z < 0 ? a.clone().negate() : a;
  return stemAngleDeg ? up.applyAxisAngle(ref, THREE.MathUtils.degToRad(stemAngleDeg)).normalize() : up;
}

/** Espesor de la pieza contra una cara bridada, para el largo de los espárragos */
export function faceThicknessOf(comp: Component): number {
  const vis = comp.parameters.visual;
  if (comp.type === 'VALVE') {
    const shape = valveShapeOf(comp);
    const span = comp.ports.length >= 2 ? comp.ports[0].position.distanceTo(comp.ports[1].position) : comp.parameters.faceToFace || 0;
    if (shape.ends === 'wafer') return span / 2;
    return shape.flangeThickness ?? Math.min(25, span * 0.12);
  }
  return Math.max(4, vis?.flangeThickness ?? (comp.parameters.faceToFace || 40) * 0.35);
}

/**
 * Arma el objeto 3D de una pieza del modelo, ya ubicado en el espacio. Es el único lugar donde
 * se decide cómo se dibuja cada tipo de pieza.
 */
export function buildComponentObject(comp: Component, ctx: BuildContext): THREE.Object3D | null {
  const { materials, pick } = ctx;
  const { outerDiameter, wallThickness, cutLength, angle, radius, runTakeOff, branchTakeOff, faceToFace, boltCircle, boltHoles } = comp.parameters;

  if (comp.type === 'PIPE' && comp.centerline.length >= 2) {
    const start = comp.centerline[0];
    const end = comp.centerline[comp.centerline.length - 1];
    const length = cutLength || start.distanceTo(end);
    const mesh = new THREE.Mesh(createPipeGeometry(outerDiameter, wallThickness, length), pick(materials.pipe));
    mesh.position.copy(start);
    mesh.quaternion.setFromUnitVectors(Z, new THREE.Vector3().subVectors(end, start).normalize());
    return mesh;
  }

  if (comp.type === 'ELBOW' && comp.ports.length >= 2) {
    const mesh = new THREE.Mesh(createElbowGeometry(outerDiameter, wallThickness, radius || 76.2, angle || 90), pick(materials.fitting));
    if (comp.parameters.matrixElements && comp.parameters.matrixElements.length === 16) {
      mesh.matrix.fromArray(comp.parameters.matrixElements);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    } else {
      mesh.position.copy(comp.ports[0].position);
    }
    return mesh;
  }

  if (comp.type === 'FLANGE' && comp.ports.length === 1) {
    // Brida ciega: disco lleno con el resalto contra la junta
    const vis = comp.parameters.visual;
    const face = comp.ports[0];
    const thickness = Math.max(2, vis?.flangeThickness ?? faceToFace ?? 20);
    const mesh = new THREE.Mesh(
      createBlindFlangeGeometry(vis?.flangeOuterDiameter ?? outerDiameter * 2, thickness, face.outerDiameter || outerDiameter),
      pick(materials.flange)
    );
    // La geometría tiene la cara en z = 0 y crece hacia +Z; la brida crece al revés de su boca
    mesh.position.copy(face.position);
    mesh.quaternion.setFromUnitVectors(Z, face.direction.clone().negate().normalize());
    return mesh;
  }

  if (comp.type === 'FLANGE' && comp.ports.length >= 2) {
    // Brida con sus medidas de spec: la cara en el puerto de cara y el cuerpo hacia el caño
    const vis = comp.parameters.visual;
    const facePort = comp.ports.find((p) => isFaceEnd(p)) ?? comp.ports[1];
    const pipePort = comp.ports.find((p) => p !== facePort) ?? comp.ports[0];
    const overall = vis?.bodyEnd !== undefined && vis?.bodyStart !== undefined ? Math.max(1, vis.bodyEnd - vis.bodyStart) : faceToFace || 63.5;
    const geom = createFlangeGeometry(
      pipePort.outerDiameter || outerDiameter,
      vis?.flangeOuterDiameter ?? outerDiameter * 2,
      wallThickness,
      overall,
      boltCircle,
      boltHoles,
      { flangeThickness: vis?.flangeThickness, hubDiameter: vis?.hubDiameter }
    );
    const mesh = new THREE.Mesh(geom, pick(materials.flange));
    let dir = facePort.position.clone().sub(pipePort.position);
    if (dir.lengthSq() < 1e-6) dir = facePort.direction.clone();
    dir.normalize();
    mesh.position.copy(facePort.position.clone().addScaledVector(dir, -overall));
    mesh.quaternion.setFromUnitVectors(Z, dir);
    return mesh;
  }

  if (comp.type === 'TEE') {
    const rTakeOff = runTakeOff || Math.max(63.5, outerDiameter * 0.9);
    const bTakeOff = branchTakeOff || Math.max(63.5, outerDiameter * 0.9);
    const branchOD = comp.ports[2]?.outerDiameter;
    const mesh = new THREE.Mesh(
      createTeeGeometry(outerDiameter, wallThickness, rTakeOff, bTakeOff, branchOD && branchOD < outerDiameter - 0.5 ? branchOD : undefined),
      pick(materials.tee)
    );
    const vertex = comp.centerline[1] || comp.centerline[0] || comp.ports[0]?.position;
    const p1 = comp.centerline[0] || comp.ports[0]?.position || vertex;
    const p2 = comp.centerline[2] || comp.ports[1]?.position || vertex.clone().add(new THREE.Vector3(1, 0, 0));
    const p3 = comp.centerline[3] || comp.ports[2]?.position || vertex.clone().add(new THREE.Vector3(0, 1, 0));
    if (vertex && p1 && p2 && p3) {
      // Eje Z local: recorrido principal. Eje Y local: ramal.
      let uRun = new THREE.Vector3().subVectors(p2, p1);
      if (uRun.lengthSq() < 0.0001) uRun = comp.ports[1]?.direction?.clone() || new THREE.Vector3(1, 0, 0);
      uRun.normalize();
      let uBranch = new THREE.Vector3().subVectors(p3, vertex);
      if (uBranch.lengthSq() < 0.0001) uBranch = comp.ports[2]?.direction?.clone() || new THREE.Vector3(0, 1, 0);
      uBranch.normalize();
      uBranch.addScaledVector(uRun, -uBranch.dot(uRun));
      if (uBranch.lengthSq() < 0.0001) {
        uBranch = Math.abs(uRun.y) < 0.8 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
        uBranch.addScaledVector(uRun, -uBranch.dot(uRun));
      }
      uBranch.normalize();
      const uPerp = new THREE.Vector3().crossVectors(uBranch, uRun).normalize();
      mesh.position.copy(vertex);
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(uPerp, uBranch, uRun));
    }
    return mesh;
  }

  if (comp.type === 'REDUCER') {
    // Cada extremo con el diámetro de su boca: sirve igual para reducir que para ampliar.
    // En las excéntricas el eje de salida va corrido, con una generatriz recta.
    const redOD = comp.parameters.reducedOuterDiameter || outerDiameter * 0.7;
    const [pa, pb] = comp.ports;
    const start = pa?.position || comp.centerline[0];
    const end = pb?.position || comp.centerline[1];
    if (!start || !end) return null;
    const smallFirst = !!pa && !!pb && pa.nominalDiameter < pb.nominalDiameter;
    const odStart = pa?.outerDiameter || (smallFirst ? redOD : outerDiameter);
    const odEnd = pb?.outerDiameter || (smallFirst ? outerDiameter : redOD);
    const axis = pb?.direction?.clone().normalize() ?? new THREE.Vector3().subVectors(end, start).normalize();
    const span = new THREE.Vector3().subVectors(end, start);
    const lateral = span.clone().addScaledVector(axis, -span.dot(axis));
    const offset = lateral.length() > 0.05 ? lateral.length() : 0;
    const xDir = offset
      ? lateral.normalize()
      : new THREE.Vector3(1, 0, 0).cross(axis).lengthSq() > 0.01
        ? new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize()
        : new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
    const yDir = new THREE.Vector3().crossVectors(axis, xDir).normalize();
    const geom = createReducerGeometry(odStart, odEnd, wallThickness, Math.abs(span.dot(axis)) || faceToFace || 88.9, 32, offset);
    const mesh = new THREE.Mesh(geom, pick(materials.fitting));
    mesh.position.copy(start);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xDir, yDir, axis));
    return mesh;
  }

  if (comp.type === 'VALVE') {
    const start = comp.ports[0]?.position || comp.centerline[0];
    const end = comp.ports[1]?.position || comp.centerline[1];
    if (!start || !end) return null;
    const span = new THREE.Vector3().subVectors(end, start);
    const length = span.length();
    const axis = length > 1e-3 ? span.clone().normalize() : comp.ports[1]?.direction?.clone().normalize() ?? new THREE.Vector3(1, 0, 0);
    const shape = valveShapeOf(comp);
    // Con encastre, el cuerpo sobresale de las bocas (que están al fondo del socket)
    const vis = comp.parameters.visual;
    const overall = vis?.bodyEnd !== undefined && vis?.bodyStart !== undefined ? Math.max(length, vis.bodyEnd - vis.bodyStart) : length || faceToFace || 178;
    const over = Math.max(0, (overall - length) / 2);
    const { body, trim } = createValveGeometries(comp.ports[0]?.outerDiameter || outerDiameter, overall, shape);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(body, pick(materials.valve)));
    if (trim) group.add(new THREE.Mesh(trim, pick(materials.trim)));
    const stem = valveStemDirection(axis, comp.parameters.stemAngle);
    const side = new THREE.Vector3().crossVectors(stem, axis).normalize();
    group.position.copy(start.clone().addScaledVector(axis, -over));
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, stem, axis));
    return group;
  }

  if (comp.type === 'CAP') {
    const mesh = new THREE.Mesh(createCapGeometry(outerDiameter, wallThickness, faceToFace || 38.1), pick(materials.fitting));
    const start = comp.centerline[0] || comp.ports[0]?.position;
    const end =
      comp.centerline[1] || (start && comp.ports[0] ? start.clone().add(comp.ports[0].direction.clone().negate().multiplyScalar(38.1)) : null);
    if (start && end) {
      mesh.position.copy(start);
      mesh.quaternion.setFromUnitVectors(Z, new THREE.Vector3().subVectors(end, start).normalize());
    }
    return mesh;
  }

  if (comp.type === 'OLET') {
    // Olet: cuerpo cónico que nace en la pared del caño y termina en el collar del ramal
    const center = comp.centerline[0] ?? comp.ports[0]?.position;
    const port = comp.ports[0];
    if (!center || !port) return null;
    const dir = port.position.clone().sub(center);
    const reach = dir.length();
    if (reach < 0.5) return null;
    dir.normalize();
    const hostR = Math.min(reach * 0.98, (ctx.hostOuterDiameter ?? 0) / 2);
    const height = reach - hostR;
    if (height < 1) return null;
    const rBranch = (port.outerDiameter || outerDiameter) / 2;
    const rTop = rBranch * 1.35;
    const rBase = rBranch * 1.9;
    const group = new THREE.Group();
    const collar = Math.min(height * 0.45, Math.max(6, rBranch * 0.9));
    // Empieza un poco adentro del caño para que no quede luz contra la pared curva
    const sink = Math.min(hostR * 0.25, rBase * 0.35);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBase, height - collar + sink, 28), pick(materials.fitting));
    cone.position.copy(center.clone().addScaledVector(dir, hostR - sink + (height - collar + sink) / 2));
    cone.quaternion.setFromUnitVectors(Y, dir);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rTop, collar, 28), pick(materials.fitting));
    top.position.copy(center.clone().addScaledVector(dir, reach - collar / 2));
    top.quaternion.setFromUnitVectors(Y, dir);
    group.add(cone, top);
    return group;
  }

  if (['INSTRUMENT', 'COUPLING', 'CROSS', 'MISC'].includes(comp.type)) {
    // Piezas sin geometría propia: cuerpos cilíndricos entre los puntos de su eje
    const mat = pick(comp.type === 'INSTRUMENT' ? materials.valve : comp.type === 'CROSS' ? materials.tee : materials.fitting);
    const group = new THREE.Group();
    const pts = comp.centerline.length >= 2 ? comp.centerline : comp.ports.map((p) => p.position);
    const segments: [THREE.Vector3, THREE.Vector3, number][] = [];
    if (comp.type === 'CROSS' && pts.length >= 3) {
      const c = pts[1];
      comp.ports.forEach((p) => segments.push([c, p.position, p.outerDiameter]));
    } else if (comp.type === 'COUPLING' && comp.ports.length >= 2 && comp.parameters.visual?.bodyEnd) {
      // Cupla de la spec: el cuerpo tapa los dos encastres
      const vis = comp.parameters.visual;
      const overall = (vis.bodyEnd ?? 0) - (vis.bodyStart ?? 0);
      const a = comp.ports[0].position;
      const b = comp.ports[1].position;
      const axis = comp.ports[1].direction.clone().normalize();
      const over = Math.max(0, (overall - a.distanceTo(b)) / 2);
      segments.push([
        a.clone().addScaledVector(axis, -over),
        b.clone().addScaledVector(axis, over),
        Math.max(vis.bodyDiameter ?? 0, comp.ports[0].outerDiameter * 1.25)
      ]);
    } else {
      const scale = comp.type === 'INSTRUMENT' ? 1.6 : comp.type === 'COUPLING' ? 1.3 : 1.15;
      for (let i = 0; i + 1 < Math.min(pts.length, comp.ports.length || pts.length); i++) {
        segments.push([pts[i], pts[i + 1], (comp.ports[i]?.outerDiameter || outerDiameter) * scale]);
      }
    }
    for (const [a, b, d] of segments) {
      const len = a.distanceTo(b);
      if (len < 0.01) continue;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, len, 24), mat);
      m.position.copy(a.clone().lerp(b, 0.5));
      m.quaternion.setFromUnitVectors(Y, b.clone().sub(a).normalize());
      group.add(m);
    }
    return group.children.length ? group : null;
  }

  return null;
}
