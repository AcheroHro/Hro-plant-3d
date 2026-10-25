import * as THREE from 'three';

/**
 * Crea una BufferGeometry paramétrica para un codo (ELBOW) con radio de curvatura al eje R,
 * ángulo de deflexión (90° o 45°) y diámetro exterior real (OD).
 *
 * El codo se posiciona con respecto al vértice V (origen 0,0,0 local):
 * - Puerto 1 ubicado en (T, 0, 0)
 * - Puerto 2 ubicado en la dirección del ángulo de salida a distancia T del vértice
 *
 * @param outerDiameter Diámetro exterior físico en mm
 * @param wallThickness Espesor de pared en mm
 * @param radius Radio al centro de curvatura (Centerline Radius R) en mm
 * @param angleDeg Ángulo de deflexión en grados (por defecto 90)
 * @param radialSegments Divisiones del perímetro del tubo (por defecto 24)
 * @param tubularSegments Divisiones a lo largo de la curva (por defecto 24)
 */
export function createElbowGeometry(
  outerDiameter: number,
  wallThickness: number,
  radius: number,
  angleDeg: number = 90,
  radialSegments: number = 24,
  tubularSegments: number = 24
): THREE.BufferGeometry {
  const rOut = Math.max(1, outerDiameter / 2);
  const rIn = Math.max(0.5, rOut - Math.max(0.1, wallThickness));
  const R = Math.max(rOut + 5, radius);
  const angleRad = THREE.MathUtils.degToRad(angleDeg);

  // Take-off T = R * tan(angle / 2)
  const T = R * Math.tan(angleRad / 2);

  // Centro del arco en el plano local XY:
  // Puerto 1 en (T, 0, 0). Tangente apunta a (-1, 0, 0).
  // El centro de curvatura está en (T, R, 0).
  const centerOfCurvature = new THREE.Vector3(T, R, 0);

  // Generar curva central del codo
  const centerlinePoints: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    const currentAngle = t * angleRad;

    // Vector desde el centro hacia el arco:
    // En t=0, apunta a (0, -R, 0).
    // Al aumentar el ángulo, gira en sentido horario alrededor de Z
    const rx = -R * Math.sin(currentAngle);
    const ry = -R * Math.cos(currentAngle);
    const pt = new THREE.Vector3(centerOfCurvature.x + rx, centerOfCurvature.y + ry, 0);
    centerlinePoints.push(pt);

    // Tangente analítica
    const tx = -Math.cos(currentAngle);
    const ty = Math.sin(currentAngle);
    const tangent = new THREE.Vector3(tx, ty, 0).normalize();
    tangents.push(tangent);

    // Binormal perpendicular al plano de curvatura (+Z)
    const binormal = new THREE.Vector3(0, 0, 1);
    binormals.push(binormal);

    // Normal en el plano: Binormal x Tangente
    const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();
    normals.push(normal);
  }

  const positions: number[] = [];
  const normalsArr: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 1. Malla Exterior (Outer Surface)
  for (let i = 0; i <= tubularSegments; i++) {
    const pt = centerlinePoints[i];
    const n = normals[i];
    const b = binormals[i];
    const u = i / tubularSegments;

    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const phi = v * Math.PI * 2;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      // Vector normal unitario desde el eje hacia el exterior
      const normX = cosPhi * n.x + sinPhi * b.x;
      const normY = cosPhi * n.y + sinPhi * b.y;
      const normZ = cosPhi * n.z + sinPhi * b.z;

      const posX = pt.x + rOut * normX;
      const posY = pt.y + rOut * normY;
      const posZ = pt.z + rOut * normZ;

      positions.push(posX, posY, posZ);
      normalsArr.push(normX, normY, normZ);
      uvs.push(u, v);
    }
  }

  // Índices para la superficie exterior
  const stride = radialSegments + 1;
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  // 2. Malla Interior (Inner Surface - hueco del codo)
  const innerOffset = positions.length / 3;
  for (let i = 0; i <= tubularSegments; i++) {
    const pt = centerlinePoints[i];
    const n = normals[i];
    const b = binormals[i];
    const u = i / tubularSegments;

    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const phi = v * Math.PI * 2;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      // Normal interior apunta hacia el centro del tubo (invertida)
      const normX = -(cosPhi * n.x + sinPhi * b.x);
      const normY = -(cosPhi * n.y + sinPhi * b.y);
      const normZ = -(cosPhi * n.z + sinPhi * b.z);

      const posX = pt.x + rIn * (cosPhi * n.x + sinPhi * b.x);
      const posY = pt.y + rIn * (cosPhi * n.y + sinPhi * b.y);
      const posZ = pt.z + rIn * (cosPhi * n.z + sinPhi * b.z);

      positions.push(posX, posY, posZ);
      normalsArr.push(normX, normY, normZ);
      uvs.push(u, v);
    }
  }

  // Índices para la superficie interior (caras invertidas)
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = innerOffset + i * stride + j;
      const b = innerOffset + (i + 1) * stride + j;
      const c = innerOffset + (i + 1) * stride + (j + 1);
      const d = innerOffset + i * stride + (j + 1);

      indices.push(a, d, b);
      indices.push(b, d, c);
    }
  }

  // 3. Tapas anulares en los dos extremos (Puertos 1 y 2)
  // Extremo de entrada (i = 0)
  for (let j = 0; j < radialSegments; j++) {
    const outA = j;
    const outB = j + 1;
    const inA = innerOffset + j;
    const inB = innerOffset + j + 1;

    indices.push(outA, inA, outB);
    indices.push(outB, inA, inB);
  }

  // Extremo de salida (i = tubularSegments)
  const lastOuter = tubularSegments * stride;
  const lastInner = innerOffset + tubularSegments * stride;
  for (let j = 0; j < radialSegments; j++) {
    const outA = lastOuter + j;
    const outB = lastOuter + j + 1;
    const inA = lastInner + j;
    const inB = lastInner + j + 1;

    indices.push(outA, outB, inA);
    indices.push(outB, inB, inA);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalsArr, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}
