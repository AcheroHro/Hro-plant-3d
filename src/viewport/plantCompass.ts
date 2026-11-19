import * as THREE from 'three';

export interface PlantCompassOptions {
  /** Dirección activa de ruteo (normalizada) */
  activeDir: THREE.Vector3;
  /** Dirección de salida de la boca activa, si existe (para no ofrecer 180° y dibujar arco de desvío) */
  portDir?: THREE.Vector3 | null;
  /** Radio del anillo en unidades locales del gizmo (se escala en pantalla con el gizmo) */
  radius?: number;
}

/**
 * Construye el clásico compás circular graduado de AutoCAD Plant 3D alrededor de la boca activa:
 * - Anillo graduado cada 15° / 45° / 90° en el plano de trabajo activo (XY en horizontal, o plano vertical si sube/baja)
 * - Puntos táctiles interactivos en las diagonales de 45° (`userData.axisDir`) para elegir giros a 45° con un toque
 * - Arco resaltado en amarillo entre la dirección de la boca y la dirección de ruteo actual
 */
export function buildPlantCompassGroup({ activeDir, portDir, radius = 58 }: PlantCompassOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'plant-compass-ring';

  const dir = activeDir.clone().normalize();
  const isVertical = Math.abs(dir.z) > 0.72;

  // Base ortonormal (u, v) del plano donde se dibuja el anillo
  let u: THREE.Vector3;
  let v: THREE.Vector3;
  if (!isVertical) {
    u = new THREE.Vector3(1, 0, 0);
    v = new THREE.Vector3(0, 1, 0);
  } else {
    // Plano vertical que contiene a la dirección horizontal previa (si la hay) o al eje X
    const refH = portDir && Math.hypot(portDir.x, portDir.y) > 0.2
      ? new THREE.Vector3(portDir.x, portDir.y, 0).normalize()
      : new THREE.Vector3(1, 0, 0);
    u = refH;
    v = new THREE.Vector3(0, 0, 1);
  }

  const pointAt = (angleRad: number, r = radius) =>
    new THREE.Vector3()
      .addScaledVector(u, Math.cos(angleRad) * r)
      .addScaledVector(v, Math.sin(angleRad) * r);

  // 1. Anillo exterior e interior sutil (verde Plant 3D)
  const segments = 72;
  const ringPts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    ringPts.push(pointAt((i / segments) * Math.PI * 2, radius));
  }
  const outerRing = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(ringPts),
    new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.78, depthTest: false, depthWrite: false })
  );
  outerRing.renderOrder = 995;
  group.add(outerRing);

  const innerPts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    innerPts.push(pointAt((i / segments) * Math.PI * 2, radius * 0.84));
  }
  const innerRing = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(innerPts),
    new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.28, depthTest: false, depthWrite: false })
  );
  innerRing.renderOrder = 994;
  group.add(innerRing);

  // 2. Marcas de graduación cada 15° (más largas en 45° y 90°)
  const minorTickPts: THREE.Vector3[] = [];
  const majorTickPts: THREE.Vector3[] = [];
  for (let deg = 0; deg < 360; deg += 15) {
    const rad = THREE.MathUtils.degToRad(deg);
    const isMajor = deg % 45 === 0;
    const isCardinal = deg % 90 === 0;
    const r0 = isCardinal ? radius * 0.72 : isMajor ? radius * 0.78 : radius * 0.88;
    const r1 = isMajor ? radius * 1.04 : radius;
    const target = isMajor ? majorTickPts : minorTickPts;
    target.push(pointAt(rad, r0), pointAt(rad, r1));
  }
  const minorTicks = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(minorTickPts),
    new THREE.LineBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.42, depthTest: false, depthWrite: false })
  );
  minorTicks.renderOrder = 995;
  group.add(minorTicks);

  const majorTicks = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(majorTickPts),
    new THREE.LineBasicMaterial({ color: 0x86efac, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false })
  );
  majorTicks.renderOrder = 996;
  group.add(majorTicks);

  // 3. Puntos táctiles de 45° (diagonales 45°, 135°, 225°, 315°) para snap rápido con el dedo
  for (const deg of [45, 135, 225, 315]) {
    const rad = THREE.MathUtils.degToRad(deg);
    const snapDir = pointAt(rad, 1).normalize();
    if (portDir && portDir.dot(snapDir) < -0.95) continue;
    const isActive = dir.dot(snapDir) > 0.985;
    const pos = pointAt(rad, radius);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(isActive ? 5.5 : 3.6, 12, 10),
      new THREE.MeshBasicMaterial({
        color: isActive ? 0xfacc15 : 0x38bdf8,
        transparent: true,
        opacity: isActive ? 1 : 0.85,
        depthTest: false,
        depthWrite: false
      })
    );
    dot.position.copy(pos);
    dot.renderOrder = 998;
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(14, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.copy(pos);
    hit.userData = { axisDir: [snapDir.x, snapDir.y, snapDir.z] };
    group.add(dot, hit);
  }

  // 4. Arco amarillo de desvío entre la boca activa y la dirección elegida
  if (portDir) {
    const a0 = Math.atan2(portDir.dot(v), portDir.dot(u));
    const a1 = Math.atan2(dir.dot(v), dir.dot(u));
    const pProj = Math.hypot(portDir.dot(u), portDir.dot(v));
    const dProj = Math.hypot(dir.dot(u), dir.dot(v));
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (pProj > 0.25 && dProj > 0.25 && Math.abs(delta) > 0.04 && Math.abs(delta) < Math.PI - 0.04) {
      const steps = Math.max(8, Math.ceil(Math.abs(delta) / 0.12));
      const arcPts: THREE.Vector3[] = [];
      for (let i = 0; i <= steps; i++) {
        arcPts.push(pointAt(a0 + (delta * i) / steps, radius * 0.92));
      }
      const arc = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(arcPts),
        new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
      );
      arc.renderOrder = 997;
      group.add(arc);
    }
  }

  return group;
}
