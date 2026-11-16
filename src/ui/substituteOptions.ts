import type { Component } from '../types/piping';
import type { SpecDatabaseReader } from '../core/specs/SpecDatabaseReader';

export interface SubstituteOption {
  key: string;
  label: string;
  familyId: string;
  angle?: number;
}

const FACE_ENDS = new Set(['FL', 'LFL', 'WF', 'LUG']);

/**
 * Piezas de la spec que pueden reemplazar a esta en el lugar, como la manija de sustitución de
 * Plant: codos de otro ángulo o familia, válvulas con los mismos extremos y bridas de otro tipo
 * (WN, SO, SW...) con la misma cara y la misma clase.
 */
export function substituteOptions(comp: Component | null | undefined, specReader: SpecDatabaseReader | null | undefined): SubstituteOption[] {
  if (!comp || !specReader) return [];
  const nd = comp.ports[0]?.nominalDiameter || comp.parameters.nominalDiameter;
  const currentFamily = comp.parameters.familyId;
  if (comp.type === 'ELBOW') {
    const currentAngle = Math.abs((comp.parameters.angle || 90) - 45) < 15 ? 45 : 90;
    return specReader.listFamilies('ELBOW', nd).flatMap((fam) =>
      [90, 45]
        .filter((a) => fam.angles.some((x) => Math.abs(x - a) < 1) && !(fam.familyId === currentFamily && a === currentAngle))
        .map((a) => ({ key: `${fam.familyId}-${a}`, label: `${a}° · ${fam.familyDesc}`, familyId: fam.familyId, angle: a }))
    );
  }
  if (comp.type === 'VALVE') {
    const end = comp.ports[0]?.plantEndType;
    return specReader
      .listFamilies('VALVE', nd)
      .filter((fam) => fam.familyId !== currentFamily && (!end || fam.endTypes[0] === end))
      .map((fam) => ({ key: fam.familyId, label: fam.familyDesc, familyId: fam.familyId }));
  }
  if (comp.type === 'FLANGE' && comp.ports.length === 2) {
    const face = comp.ports.find((p) => p.plantEndType && FACE_ENDS.has(p.plantEndType.toUpperCase()));
    const cls = comp.parameters.pressureClass;
    return specReader
      .listFamilies('FLANGE', nd)
      .filter(
        (fam) =>
          fam.familyId !== currentFamily &&
          fam.endTypes.length === 2 &&
          (!face?.plantEndType || fam.endTypes.includes(face.plantEndType)) &&
          (!cls || !fam.pressureClass || fam.pressureClass === cls)
      )
      .map((fam) => ({ key: fam.familyId, label: fam.familyDesc, familyId: fam.familyId }));
  }
  return [];
}
