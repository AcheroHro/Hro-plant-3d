import * as THREE from 'three';

/**
 * Crea una BufferGeometry paramétrica para una brida con cuello soldable (Weld Neck Flange ASME B16.5 RF).
 * Alineada a lo largo del eje Z:
 * - z = 0: extremo soldado a tope (mismo OD que el caño)
 * - z = faceToFace: cara con resalto (RF)
 *
 * @param pipeOD Diámetro exterior de caño coincidente en mm
 * @param flangeOD Diámetro exterior de la brida en mm
 * @param wallThickness Espesor de pared del caño en mm
 * @param faceToFace Longitud cara a cara en mm
 * @param boltCircle Diámetro del círculo de pernos en mm
 * @param boltHoles Cantidad de agujeros para pernos
 */
export function createFlangeGeometry(
  pipeOD: number,
  flangeOD: number,
  wallThickness: number,
  faceToFace: number,
  _boltCircle: number = 0,
  _boltHoles: number = 4,
  dims: { flangeThickness?: number; hubDiameter?: number } = {}
): THREE.BufferGeometry {
  const rPipe = Math.max(1, pipeOD / 2);
  const rIn = Math.max(0.5, rPipe - Math.max(0.1, wallThickness));
  const rFlange = Math.max(rPipe + 10, flangeOD / 2);
  const hasSpecDims = dims.flangeThickness !== undefined && dims.flangeThickness > 0;
  const L = hasSpecDims ? Math.max(faceToFace, dims.flangeThickness!) : Math.max(20, faceToFace);

  // Con medidas de la spec: espesor real del disco (B) y cuello hasta completar el largo (L)
  const raisedFaceThickness = hasSpecDims ? Math.min(1.6, dims.flangeThickness! * 0.1) : L * 0.1;
  const flangeThickness = hasSpecDims ? dims.flangeThickness! - raisedFaceThickness : L * 0.35;
  const hubLength = hasSpecDims ? Math.max(0, L - dims.flangeThickness!) : L * 0.55;
  const rRaisedFace = (rPipe + rFlange) * 0.5;

  // Puntos del perfil longitudinal (R, Z) para LatheGeometry
  // Genera un sólido de revolución escalonado con hueco pasante interior
  const points: THREE.Vector2[] = [
    // Interior cilíndrico constante de paso de fluido
    new THREE.Vector2(rIn, 0),
    new THREE.Vector2(rPipe, 0), // Extremo de soldadura a tope
    new THREE.Vector2(rPipe * 1.05, hubLength * 0.5), // Cono del cuello
    new THREE.Vector2(rPipe * 1.15, hubLength), // Base del cuello
    new THREE.Vector2(rFlange, hubLength), // Cara posterior del disco
    new THREE.Vector2(rFlange, hubLength + flangeThickness), // Diámetro exterior del disco
    new THREE.Vector2(rRaisedFace, hubLength + flangeThickness), // Resalto RF
    new THREE.Vector2(rRaisedFace, hubLength + flangeThickness + raisedFaceThickness),
    new THREE.Vector2(rIn, hubLength + flangeThickness + raisedFaceThickness), // Cara de junta interna
    new THREE.Vector2(rIn, 0) // Cierra en el origen
  ];

  const geometry = new THREE.LatheGeometry(points, 32);
  // Alinear desde el eje Y de torno hacia el eje +Z (desde z = 0 soldadura a z = faceToFace cara RF)
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();

  return geometry;
}
