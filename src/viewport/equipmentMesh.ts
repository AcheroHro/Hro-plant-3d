import * as THREE from 'three';
import { EquipmentRecord, nozzleWorldPose } from '../core/equipment/equipmentCatalog';
import { VisualStyle } from '../store/useUiConfigStore';

const Y_UP = new THREE.Vector3(0, 1, 0);

/** Diámetro exterior aproximado en mm a partir de diámetro nominal en pulgadas (para dibujar la boquilla) */
function approxOdMm(nd: number): number {
  const table: Record<number, number> = {
    0.5: 21.3,
    0.75: 26.7,
    1: 33.4,
    1.5: 48.3,
    2: 60.3,
    3: 88.9,
    4: 114.3,
    6: 168.3,
    8: 219.1,
    10: 273.1,
    12: 323.9
  };
  return table[nd] ?? Math.max(25, nd * 27);
}

/**
 * Construye el grupo 3D de un equipo de proceso (tanque, recipiente o bomba) con sus boquillas
 * bridadas interactivas (`userData.nozzleRef`).
 */
export function buildEquipmentGroup(eq: EquipmentRecord, visualStyle: VisualStyle = 'shaded'): THREE.Group {
  const root = new THREE.Group();
  root.name = `equipment-${eq.tag}`;
  root.visible = eq.visible;
  root.position.set(eq.position[0], eq.position[1], eq.position[2]);
  root.rotation.z = THREE.MathUtils.degToRad(eq.rotationDeg || 0);

  const xray = visualStyle === 'xray';
  const wireframe = visualStyle === 'wireframe';

  const bodyMat = new THREE.MeshStandardMaterial({
    color: eq.kind === 'centrifugal_pump' ? 0x2b6cb0 : 0x64748b,
    metalness: 0.45,
    roughness: 0.52,
    transparent: xray,
    opacity: xray ? 0.34 : 1,
    depthWrite: !xray,
    wireframe
  });
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.35,
    roughness: 0.72,
    transparent: xray,
    opacity: xray ? 0.34 : 1,
    depthWrite: !xray,
    wireframe
  });
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    metalness: 0.4,
    roughness: 0.4,
    transparent: xray,
    opacity: xray ? 0.65 : 1,
    depthWrite: !xray,
    wireframe
  });

  const r = eq.diameterMm / 2;

  if (eq.kind === 'vertical_tank') {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, eq.lengthMm, 28), bodyMat);
    cyl.rotation.x = Math.PI / 2;
    cyl.position.z = eq.elevationMm + eq.lengthMm / 2;
    root.add(cyl);

    // Cabezal superior e inferior semiesférico achatado
    const topCap = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
    topCap.rotation.x = Math.PI / 2;
    topCap.scale.set(1, 0.35, 1);
    topCap.position.z = eq.elevationMm + eq.lengthMm;
    root.add(topCap);

    const botCap = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bodyMat);
    botCap.rotation.x = Math.PI / 2;
    botCap.scale.set(1, 0.35, 1);
    botCap.position.z = eq.elevationMm;
    root.add(botCap);

    // Faldón de apoyo hasta z=0
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.88, r * 0.94, eq.elevationMm, 24, 1, true), baseMat);
    skirt.rotation.x = Math.PI / 2;
    skirt.position.z = eq.elevationMm / 2;
    root.add(skirt);
  } else if (eq.kind === 'horizontal_vessel') {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, eq.lengthMm, 28), bodyMat);
    cyl.rotation.z = Math.PI / 2;
    cyl.position.z = eq.elevationMm;
    root.add(cyl);

    for (const sign of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12), bodyMat);
      cap.scale.set(0.35, 1, 1);
      cap.position.set(sign * (eq.lengthMm / 2), 0, eq.elevationMm);
      root.add(cap);

      const saddle = new THREE.Mesh(new THREE.BoxGeometry(180, r * 1.65, eq.elevationMm - r * 0.45), baseMat);
      saddle.position.set(sign * (eq.lengthMm * 0.32), 0, (eq.elevationMm - r * 0.45) / 2);
      root.add(saddle);
    }
  } else if (eq.kind === 'pipe_rack') {
    // Pipe Rack metálico estructural: 3 pórticos (2 vanos) con vigas en cada nivel BOP
    const width = eq.diameterMm;
    const halfW = width / 2;
    const halfL = eq.lengthMm / 2;
    const colH = eq.elevationMm;
    const colSec = 160;
    const beamH = 180;
    const beamW = 140;
    const levels = eq.beamLevelsMm?.length ? eq.beamLevelsMm : [3000, 4200];
    const baysX = [-halfL, 0, halfL];

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.55,
      roughness: 0.48,
      transparent: xray,
      opacity: xray ? 0.34 : 1,
      depthWrite: !xray,
      wireframe
    });

    // Columnas verticales + placas base
    for (const bx of baysX) {
      for (const side of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(colSec, colSec, colH), steelMat);
        col.position.set(bx, side * halfW, colH / 2);
        root.add(col);

        const plate = new THREE.Mesh(new THREE.BoxGeometry(colSec * 1.7, colSec * 1.7, 24), baseMat);
        plate.position.set(bx, side * halfW, 12);
        root.add(plate);
      }

      // Vigas transversales por nivel (la cara superior queda exactamente en z = level = BOP)
      for (const level of levels) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(beamW, width + colSec, beamH), steelMat);
        beam.position.set(bx, 0, level - beamH / 2);
        beam.userData.rackLevelMm = eq.position[2] + level;
        beam.userData.rackTag = eq.tag;
        root.add(beam);
      }
    }

    // Largueros longitudinales en ambos costados a la altura de cada nivel
    for (const level of levels) {
      for (const side of [-1, 1]) {
        const stringer = new THREE.Mesh(new THREE.BoxGeometry(eq.lengthMm, beamW * 0.85, beamH * 0.85), baseMat);
        stringer.position.set(0, side * halfW, level - beamH / 2);
        root.add(stringer);
      }
    }
  } else {
    // Bomba centrífuga sobre skid
    const skid = new THREE.Mesh(new THREE.BoxGeometry(eq.lengthMm, 520, 120), baseMat);
    skid.position.set(0, 0, 60);
    root.add(skid);

    const motor = new THREE.Mesh(new THREE.CylinderGeometry(165, 165, 480, 20), baseMat);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(-220, 0, eq.elevationMm);
    root.add(motor);

    const coupling = new THREE.Mesh(new THREE.CylinderGeometry(55, 55, 180, 14), bodyMat);
    coupling.rotation.z = Math.PI / 2;
    coupling.position.set(110, 0, eq.elevationMm);
    root.add(coupling);

    const volute = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 190, 24), bodyMat);
    volute.rotation.z = Math.PI / 2;
    volute.position.set(340, 0, eq.elevationMm);
    root.add(volute);
  }

  // Boquillas bridadas con zona táctil para arrancar cañerías directo desde el equipo
  for (const nozzle of eq.nozzles) {
    const od = approxOdMm(nozzle.nominalDiameter);
    const neckLen = 140;
    const flangeR = od * 0.88;
    const dir = new THREE.Vector3(...nozzle.localDir).normalize();
    const face = new THREE.Vector3(...nozzle.localPos);
    const quat = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(od / 2, od / 2, neckLen, 16), nozzleMat);
    neck.position.copy(face).addScaledVector(dir, -neckLen / 2);
    neck.quaternion.copy(quat);

    const flange = new THREE.Mesh(new THREE.CylinderGeometry(flangeR, flangeR, 26, 20), nozzleMat);
    flange.position.copy(face).addScaledVector(dir, -13);
    flange.quaternion.copy(quat);

    // Anillo cyan en la cara de la boquilla (indicador visual de puerto conectable)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(od * 0.62, Math.max(5, od * 0.08), 8, 20),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false, transparent: true })
    );
    ring.position.copy(face);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    ring.renderOrder = 990;

    // Zona táctil amplia (invisible) para facilitar el toque con el dedo en móvil
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(70, flangeR * 1.15), 10, 10),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.copy(face);

    const world = nozzleWorldPose(eq, nozzle);
    const nozzleRef = {
      equipmentId: eq.id,
      equipmentTag: eq.tag,
      nozzleId: nozzle.id,
      nozzleTag: nozzle.tag,
      nominalDiameter: nozzle.nominalDiameter,
      position: [world.position.x, world.position.y, world.position.z] as [number, number, number],
      direction: [world.direction.x, world.direction.y, world.direction.z] as [number, number, number]
    };
    neck.userData.nozzleRef = nozzleRef;
    flange.userData.nozzleRef = nozzleRef;
    ring.userData.nozzleRef = nozzleRef;
    hit.userData.nozzleRef = nozzleRef;

    root.add(neck, flange, ring, hit);
  }

  return root;
}
