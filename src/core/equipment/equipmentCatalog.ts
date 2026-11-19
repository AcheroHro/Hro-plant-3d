import * as THREE from 'three';

export type EquipmentKind = 'vertical_tank' | 'horizontal_vessel' | 'centrifugal_pump' | 'pipe_rack';

export interface EquipmentNozzle {
  id: string;
  /** Nombre corto de la boquilla (ej. N1, N2, SUCCION, DESCARGA) */
  tag: string;
  /** Posición local respecto al origen del equipo (mm, Z-up) */
  localPos: [number, number, number];
  /** Vector normal saliente local (unitario) */
  localDir: [number, number, number];
  /** Diámetro nominal en pulgadas */
  nominalDiameter: number;
}

export interface EquipmentRecord {
  id: string;
  kind: EquipmentKind;
  /** Tag industrial estilo Plant 3D (ej. TK-101, V-101, P-101, PR-101) */
  tag: string;
  /** Posición base en el mundo (mm, Z-up: z=0 es el piso) */
  position: [number, number, number];
  /** Rotación en torno al eje Z (grados) */
  rotationDeg: number;
  /** Dimensiones principales en mm */
  diameterMm: number;
  lengthMm: number;
  elevationMm: number;
  /** Niveles de apoyo BOP en mm (para Pipe Racks) */
  beamLevelsMm?: number[];
  visible: boolean;
  nozzles: EquipmentNozzle[];
}

export interface EquipmentPreset {
  kind: EquipmentKind;
  label: string;
  tagPrefix: string;
  description: string;
  diameterMm: number;
  lengthMm: number;
  elevationMm: number;
  beamLevelsMm?: number[];
  nozzles: Omit<EquipmentNozzle, 'id'>[];
}

export const EQUIPMENT_PRESETS: Record<EquipmentKind, EquipmentPreset> = {
  vertical_tank: {
    kind: 'vertical_tank',
    label: 'Tanque vertical',
    tagPrefix: 'TK',
    description: 'Tanque cilíndrico vertical con 3 boquillas (entrada, salida y venteo)',
    diameterMm: 1400,
    lengthMm: 2600,
    elevationMm: 450,
    nozzles: [
      { tag: 'N1', localPos: [820, 0, 2350], localDir: [1, 0, 0], nominalDiameter: 4 },
      { tag: 'N2', localPos: [820, 0, 800], localDir: [1, 0, 0], nominalDiameter: 4 },
      { tag: 'N3', localPos: [0, 0, 3380], localDir: [0, 0, 1], nominalDiameter: 2 }
    ]
  },
  horizontal_vessel: {
    kind: 'horizontal_vessel',
    label: 'Recipiente horiz.',
    tagPrefix: 'V',
    description: 'Tambor horizontal sobre silletas con entrada superior y salida inferior',
    diameterMm: 1100,
    lengthMm: 2800,
    elevationMm: 1150,
    nozzles: [
      { tag: 'N1', localPos: [-850, 0, 1820], localDir: [0, 0, 1], nominalDiameter: 4 },
      { tag: 'N2', localPos: [850, 0, 480], localDir: [0, 0, -1], nominalDiameter: 3 },
      { tag: 'N3', localPos: [1650, 0, 1150], localDir: [1, 0, 0], nominalDiameter: 2 }
    ]
  },
  centrifugal_pump: {
    kind: 'centrifugal_pump',
    label: 'Bomba centrífuga',
    tagPrefix: 'P',
    description: 'Bomba sobre base skid con succión horizontal y descarga vertical',
    diameterMm: 420,
    lengthMm: 1050,
    elevationMm: 420,
    nozzles: [
      { tag: 'N1 (Suc)', localPos: [560, 0, 420], localDir: [1, 0, 0], nominalDiameter: 4 },
      { tag: 'N2 (Desc)', localPos: [360, 0, 740], localDir: [0, 0, 1], nominalDiameter: 3 }
    ]
  },
  pipe_rack: {
    kind: 'pipe_rack',
    label: 'Pipe Rack',
    tagPrefix: 'PR',
    description: 'Pórtico estructural metálico de 2 niveles (BOP 3000 y 4200 mm) para apoyar cañerías',
    diameterMm: 2400, // ancho entre columnas (Y)
    lengthMm: 6000, // largo total en X (2 vanos de 3 m)
    elevationMm: 4400, // altura total de columnas
    beamLevelsMm: [3000, 4200],
    nozzles: []
  }
};

/** Crea un equipo o estructura listo para guardar en el proyecto a partir de un preset */
export function createEquipmentFromPreset(
  kind: EquipmentKind,
  existingCount: number,
  position: [number, number, number] = [0, 0, 0],
  rotationDeg = 0
): EquipmentRecord {
  const preset = EQUIPMENT_PRESETS[kind];
  const seq = 101 + existingCount;
  const id = `eq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    kind,
    tag: `${preset.tagPrefix}-${seq}`,
    position,
    rotationDeg,
    diameterMm: preset.diameterMm,
    lengthMm: preset.lengthMm,
    elevationMm: preset.elevationMm,
    beamLevelsMm: preset.beamLevelsMm ? [...preset.beamLevelsMm] : undefined,
    visible: true,
    nozzles: preset.nozzles.map((n, idx) => ({
      ...n,
      id: `${id}-n${idx + 1}`
    }))
  };
}

/** Calcula la posición y dirección saliente de una boquilla en coordenadas del mundo (mm, Z-up) */
export function nozzleWorldPose(
  eq: EquipmentRecord,
  nozzle: EquipmentNozzle
): { position: THREE.Vector3; direction: THREE.Vector3 } {
  const rad = THREE.MathUtils.degToRad(eq.rotationDeg || 0);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const [lx, ly, lz] = nozzle.localPos;
  const [dx, dy, dz] = nozzle.localDir;

  const position = new THREE.Vector3(
    eq.position[0] + lx * cos - ly * sin,
    eq.position[1] + lx * sin + ly * cos,
    eq.position[2] + lz
  );
  const direction = new THREE.Vector3(dx * cos - dy * sin, dx * sin + dy * cos, dz).normalize();
  return { position, direction };
}
