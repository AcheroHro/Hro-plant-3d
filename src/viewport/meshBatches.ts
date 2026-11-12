import * as THREE from 'three';

/**
 * Mallas fusionadas: todas las piezas que comparten material se juntan en una sola malla,
 * así el teléfono dibuja unas pocas mallas en lugar de una (o varias) por pieza.
 * Cada malla fusionada recuerda qué pieza es dueña de cada triángulo, de modo que tocar
 * el modelo sigue eligiendo una pieza sola: el resultado del rayo trae un objeto con el
 * `userData.componentId` de esa pieza, igual que antes de fusionar.
 * Una pieza se puede ocultar dentro de la malla (para dibujarla aparte, resaltada) sin
 * rearmar nada: solo se apagan sus triángulos.
 */

interface Owner {
  key: string | null;
  /** Objeto liviano que representa a la pieza en los resultados del rayo (no está en la escena) */
  proxy: THREE.Object3D;
  /** Primer triángulo y cantidad de triángulos de la pieza dentro de la malla */
  start: number;
  count: number;
  box: THREE.Box3;
  /** Índices de la pieza mientras está oculta (para volver a mostrarla) */
  saved: Uint16Array | Uint32Array | null;
}

interface BatchInfo {
  owners: Owner[];
  byId: Map<string, Owner>;
}

/** Las mallas fusionadas llevan esta marca en userData */
const BATCH_FLAG = 'meshBatch';

const infoOf = (batch: THREE.Object3D) => batch.userData[BATCH_FLAG] as BatchInfo | undefined;

/** Una malla se puede fusionar si tiene un solo material (con uno solo, three.js ignora los grupos de la geometría) */
function batchableMesh(mesh: THREE.Mesh): boolean {
  return (
    !Array.isArray(mesh.material) &&
    !(mesh as unknown as THREE.InstancedMesh).isInstancedMesh &&
    mesh.geometry?.getAttribute('position') !== undefined
  );
}

/** Arreglo de floats de un atributo de 3 componentes, si se puede leer directo (no intercalado ni normalizado) */
function rawArray(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): ArrayLike<number> | null {
  if ((attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || attr.itemSize !== 3 || attr.normalized) return null;
  return (attr as THREE.BufferAttribute).array;
}

interface Piece {
  owner: string | null;
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpHit = new THREE.Vector3();
const tmpRay = new THREE.Ray();
const tmpInverse = new THREE.Matrix4();

/** Si un objeto armado se puede fusionar entero: solo mallas visibles de un material cada una */
export function isBatchable(root: THREE.Object3D): boolean {
  let ok = true;
  let meshes = 0;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      meshes++;
      if (!batchableMesh(mesh) || !mesh.visible) ok = false;
    } else if (child !== root && !(child as THREE.Group).isGroup) ok = false;
  });
  return ok && meshes > 0;
}

/** Las claves que empiezan con '#' (juntas, soportes) se dibujan pero no se eligen tocándolas */
const pickableKey = (key: string) => !key.startsWith('#');

/**
 * Junta en mallas por material todo lo que hay debajo de `objects`.
 * `ownerOf` dice de qué pieza es cada malla (null: sin dueño, no se puede elegir ni ocultar).
 * Lo que no se puede fusionar vuelve en `rest`, tal cual. Las geometrías de origen no se tocan
 * (quien las armó decide si las guarda o las libera); los materiales se reusan.
 */
export function buildMeshBatches(
  objects: readonly THREE.Object3D[],
  ownerOf: (mesh: THREE.Mesh) => string | null
): { batches: THREE.Mesh[]; rest: THREE.Object3D[] } {
  const byMaterial = new Map<THREE.Material, Piece[]>();
  const rest: THREE.Object3D[] = [];

  for (const root of objects) {
    if (!isBatchable(root)) {
      rest.push(root);
      continue;
    }
    root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
    for (const mesh of meshes) {
      const material = mesh.material as THREE.Material;
      const piece = { owner: ownerOf(mesh), geometry: mesh.geometry, matrix: mesh.matrixWorld };
      const list = byMaterial.get(material);
      if (list) list.push(piece);
      else byMaterial.set(material, [piece]);
    }
  }

  const batches: THREE.Mesh[] = [];
  for (const [material, pieces] of byMaterial) {
    batches.push(mergePieces(material, pieces));
  }

  return { batches, rest };
}

function mergePieces(material: THREE.Material, pieces: Piece[]): THREE.Mesh {
  // Las mallas de una misma pieza quedan seguidas, para que sus triángulos sean un solo rango
  pieces.sort((a, b) => (a.owner === b.owner ? 0 : (a.owner ?? '') < (b.owner ?? '') ? -1 : 1));
  let vertexCount = 0;
  let indexCount = 0;
  for (const p of pieces) {
    const pos = p.geometry.getAttribute('position');
    if (!p.geometry.getAttribute('normal')) p.geometry.computeVertexNormals();
    vertexCount += pos.count;
    indexCount += p.geometry.index ? p.geometry.index.count : pos.count;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const owners: Owner[] = [];
  const byId = new Map<string, Owner>();
  const nm = new THREE.Matrix3();
  let v = 0;
  let ix = 0;

  for (const p of pieces) {
    const pos = p.geometry.getAttribute('position');
    const nor = p.geometry.getAttribute('normal');
    const e = p.matrix.elements;
    nm.getNormalMatrix(p.matrix);
    const n = nm.elements;
    const firstTriangle = ix / 3;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    // Cuentas a mano sobre los arreglos crudos (sin Vector3 ni getX por vértice): es la parte
    // que más pesa con modelos grandes
    const pa = rawArray(pos);
    const na = rawArray(nor);
    for (let k = 0; k < pos.count; k++) {
      const x = pa ? pa[k * 3] : pos.getX(k);
      const y = pa ? pa[k * 3 + 1] : pos.getY(k);
      const z = pa ? pa[k * 3 + 2] : pos.getZ(k);
      const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      const wx = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
      const wy = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
      const wz = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
      const o = (v + k) * 3;
      positions[o] = wx;
      positions[o + 1] = wy;
      positions[o + 2] = wz;
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wz < minZ) minZ = wz;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
      if (wz > maxZ) maxZ = wz;

      const nx = na ? na[k * 3] : nor.getX(k);
      const ny = na ? na[k * 3 + 1] : nor.getY(k);
      const nz = na ? na[k * 3 + 2] : nor.getZ(k);
      const tx = n[0] * nx + n[3] * ny + n[6] * nz;
      const ty = n[1] * nx + n[4] * ny + n[7] * nz;
      const tz = n[2] * nx + n[5] * ny + n[8] * nz;
      const len = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      normals[o] = tx / len;
      normals[o + 1] = ty / len;
      normals[o + 2] = tz / len;
    }
    if (p.geometry.index) {
      const src = p.geometry.index.array;
      for (let k = 0; k < src.length; k++) indices[ix + k] = src[k] + v;
      ix += src.length;
    } else {
      for (let k = 0; k < pos.count; k++) indices[ix + k] = k + v;
      ix += pos.count;
    }
    v += pos.count;

    const count = ix / 3 - firstTriangle;
    const box = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
    const last = owners[owners.length - 1];
    if (p.owner !== null && last && last.key === p.owner) {
      last.count += count;
      last.box.union(box);
    } else {
      const proxy = new THREE.Object3D();
      if (p.owner !== null && pickableKey(p.owner)) proxy.userData = { componentId: p.owner };
      const owner: Owner = { key: p.owner, proxy, start: firstTriangle, count, box, saved: null };
      owners.push(owner);
      if (p.owner !== null) byId.set(p.owner, owner);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const batch = new THREE.Mesh(geometry, material);
  const info: BatchInfo = { owners, byId };
  batch.userData = { [BATCH_FLAG]: info };
  batch.raycast = batchRaycast;
  return batch;
}

/**
 * Oculta (o vuelve a mostrar) los triángulos de una pieza en las mallas fusionadas.
 * Devuelve las mallas donde cambió algo (para deshacer exactamente eso después).
 * Sirve para dibujarla aparte, resaltada, o para reemplazarla sin rearmar la malla.
 */
export function setPieceHidden(batches: readonly THREE.Object3D[], key: string, hidden: boolean): THREE.Mesh[] {
  const changed: THREE.Mesh[] = [];
  for (const batch of batches) {
    const info = infoOf(batch);
    const owner = info?.byId.get(key);
    if (!info || !owner) continue;
    if ((owner.saved !== null) === hidden) continue;
    changed.push(batch as THREE.Mesh);
    const index = (batch as THREE.Mesh).geometry.index!;
    const array = index.array as Uint16Array | Uint32Array;
    const from = owner.start * 3;
    const to = (owner.start + owner.count) * 3;
    if (hidden) {
      owner.saved = array.slice(from, to);
      // Triángulos degenerados (todos al vértice 0): no se dibujan
      array.fill(0, from, to);
    } else {
      array.set(owner.saved!, from);
      owner.saved = null;
    }
    index.addUpdateRange(from, to - from);
    index.needsUpdate = true;
  }
  return changed;
}

/** Si la malla fusionada tiene a esa pieza */
export function batchHasPiece(batch: THREE.Object3D, key: string): boolean {
  return !!infoOf(batch)?.byId.has(key);
}

/**
 * Caja de lo que se ve: en las mallas fusionadas solo cuenta lo que no está oculto
 * (una pieza borrada queda apagada dentro de la malla hasta el próximo reagrupado).
 */
export function visibleBounds(root: THREE.Object3D, box = new THREE.Box3()): THREE.Box3 {
  root.updateMatrixWorld(true);
  const visit = (obj: THREE.Object3D) => {
    if (!obj.visible) return;
    const info = infoOf(obj);
    if (info) {
      for (const o of info.owners) if (o.saved === null && o.count > 0) box.union(o.box.clone().applyMatrix4(obj.matrixWorld));
      return;
    }
    if ((obj as THREE.Mesh).isMesh) {
      const g = (obj as THREE.Mesh).geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(g.boundingBox!.clone().applyMatrix4(obj.matrixWorld));
    }
    obj.children.forEach(visit);
  };
  visit(root);
  return box;
}

/**
 * Rayo contra una malla fusionada: primero las cajas de cada pieza (barato) y solo dentro
 * de las que toca, sus triángulos. Cada impacto sale con `object` = la pieza tocada.
 */
function batchRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
  const info = infoOf(this);
  if (!info) return;
  const geometry = this.geometry;
  if (geometry.boundingSphere && !raycaster.ray.intersectsSphere(geometry.boundingSphere)) return;

  // Las fusionadas se arman en coordenadas del mundo y no se mueven, pero por las dudas
  tmpInverse.copy(this.matrixWorld).invert();
  tmpRay.copy(raycaster.ray).applyMatrix4(tmpInverse);

  const pos = geometry.getAttribute('position');
  const index = geometry.index!.array;
  const backfaceCulling = (this.material as THREE.Material).side === THREE.FrontSide;

  for (const owner of info.owners) {
    if (owner.saved !== null || !tmpRay.intersectsBox(owner.box)) continue;
    let best: { distance: number; point: THREE.Vector3; faceIndex: number } | null = null;
    for (let t = owner.start; t < owner.start + owner.count; t++) {
      tmpA.fromBufferAttribute(pos, index[t * 3]);
      tmpB.fromBufferAttribute(pos, index[t * 3 + 1]);
      tmpC.fromBufferAttribute(pos, index[t * 3 + 2]);
      if (!tmpRay.intersectTriangle(tmpA, tmpB, tmpC, backfaceCulling, tmpHit)) continue;
      const world = tmpHit.clone().applyMatrix4(this.matrixWorld);
      const distance = raycaster.ray.origin.distanceTo(world);
      if (distance < raycaster.near || distance > raycaster.far) continue;
      if (!best || distance < best.distance) best = { distance, point: world, faceIndex: t };
    }
    if (best) intersects.push({ distance: best.distance, point: best.point, faceIndex: best.faceIndex, object: owner.proxy });
  }
}

/** Id de la pieza a la que pertenece un triángulo de una malla fusionada */
export function ownerOfTriangle(batch: THREE.Mesh, faceIndex: number): string | null {
  const owner = infoOf(batch)?.owners.find((o) => faceIndex >= o.start && faceIndex < o.start + o.count);
  return (owner?.proxy.userData.componentId as string | undefined) ?? null;
}
