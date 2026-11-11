import * as THREE from 'three';

/**
 * Crea una BufferGeometry paramétrica para una brida ASME B16.5 con resalto (RF).
 * Alineada a lo largo del eje Z:
 * - z = 0: lado del caño
 * - z = faceToFace: cara con resalto (RF)
 *
 * Con las medidas de la spec se distingue el tipo: cuello cónico largo (WN, de caño a
 * `hubDiameter`) o cubo corto y recto (slip-on / socket). Así se ve para dónde mira la cara.
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
  // Cubo: diámetro de la spec si viene; nunca más chico que el caño ni más grande que el disco
  const rHub = Math.min(rFlange * 0.85, Math.max(rPipe * 1.08, (dims.hubDiameter ?? 0) / 2 || rPipe * 1.15));
  // Cuello largo (WN): arranca en el diámetro del caño y abre hasta el cubo. Cubo corto (SO/SW): recto.
  const longNeck = hubLength > flangeThickness * 1.2;
  const rNeckStart = longNeck ? rPipe : rHub;

  // Puntos del perfil longitudinal (R, Z) para LatheGeometry
  // Genera un sólido de revolución escalonado con hueco pasante interior
  const points: THREE.Vector2[] = [
    // Interior cilíndrico constante de paso de fluido
    new THREE.Vector2(rIn, 0),
    new THREE.Vector2(rNeckStart, 0), // Extremo del lado caño
    new THREE.Vector2(longNeck ? rPipe + (rHub - rPipe) * 0.25 : rHub, hubLength * 0.5), // Cono del cuello
    new THREE.Vector2(rHub, hubLength), // Base del cuello
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

/**
 * Brida ciega: disco lleno con resalto. La cara de junta queda en z = 0 y el disco crece hacia +Z.
 *
 * @param flangeOD Diámetro exterior del disco en mm
 * @param thickness Espesor total en mm
 * @param pipeOD Diámetro del caño de la línea (define el resalto)
 */
export function createBlindFlangeGeometry(flangeOD: number, thickness: number, pipeOD: number): THREE.BufferGeometry {
  const rFlange = Math.max(10, flangeOD / 2);
  const T = Math.max(2, thickness);
  const raised = Math.min(1.6, T * 0.1);
  const rRaised = Math.min(rFlange * 0.9, (Math.max(1, pipeOD / 2) + rFlange) * 0.5);
  const points: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(rRaised, 0),
    new THREE.Vector2(rRaised, raised),
    new THREE.Vector2(rFlange, raised),
    new THREE.Vector2(rFlange, T),
    new THREE.Vector2(0, T)
  ];
  const geometry = new THREE.LatheGeometry(points, 40);
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Espárragos de una unión bridada, con sus tuercas, repartidos en el círculo de bulones.
 * Centrados en z = 0, a lo largo de Z.
 */
export function createStudsGeometry(boltCircle: number, count: number, studDiameter: number, length: number): THREE.BufferGeometry {
  const n = Math.max(2, Math.round(count));
  const r = Math.max(1, studDiameter / 2);
  const positions: number[] = [];
  const push = (g: THREE.BufferGeometry) => {
    const flat = g.index ? g.toNonIndexed() : g;
    const pos = flat.getAttribute('position');
    for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (flat !== g) flat.dispose();
    g.dispose();
  };
  const nutHeight = r * 1.8;
  for (let i = 0; i < n; i++) {
    // Los agujeros van a caballo de los ejes (ninguno queda arriba del todo)
    const a = ((i + 0.5) / n) * Math.PI * 2;
    const x = (boltCircle / 2) * Math.cos(a);
    const y = (boltCircle / 2) * Math.sin(a);
    const stud = new THREE.CylinderGeometry(r, r, length, 8);
    stud.rotateX(Math.PI / 2);
    stud.translate(x, y, 0);
    push(stud);
    for (const side of [-1, 1]) {
      const nut = new THREE.CylinderGeometry(r * 1.75, r * 1.75, nutHeight, 6);
      nut.rotateX(Math.PI / 2);
      nut.translate(x, y, side * (length / 2 - nutHeight * 0.9));
      push(nut);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.computeVertexNormals();
  return out;
}
