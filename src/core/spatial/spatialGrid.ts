/**
 * Grilla espacial uniforme: reparte cajas (AABB) en celdas cúbicas y devuelve solo los pares
 * de cajas que comparten alguna celda. Sirve para no comparar todas las piezas contra todas
 * (n²) en la revisión de choques: con un modelo grande, cada caño se compara solo con los
 * que tiene cerca. Pura, sin three.js, en milímetros.
 */

export interface GridBox {
  readonly id: string;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** Una caja que ocupa más celdas que esto se compara aparte contra todas (un caño muy largo en diagonal) */
const MAX_CELLS_PER_BOX = 512;

/**
 * Tamaño de celda razonable para un conjunto de cajas: la mediana del lado mayor de cada una,
 * acotada entre 250 mm y 6 m. Así un caño típico ocupa pocas celdas.
 */
export function suggestCellSize(boxes: readonly GridBox[]): number {
  if (boxes.length === 0) return 1000;
  const sides = boxes
    .map((b) => Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]))
    .sort((a, b) => a - b);
  const median = sides[Math.floor(sides.length / 2)];
  return Math.min(6000, Math.max(250, median));
}

const overlaps = (a: GridBox, b: GridBox) =>
  a.min[0] <= b.max[0] &&
  b.min[0] <= a.max[0] &&
  a.min[1] <= b.max[1] &&
  b.min[1] <= a.max[1] &&
  a.min[2] <= b.max[2] &&
  b.min[2] <= a.max[2];

/**
 * Pares [i, j] (índices en `boxes`, i < j) cuyas cajas se tocan o se superponen.
 * Cada par aparece una sola vez. El resultado es el mismo que comparar todas contra todas.
 */
export function overlappingPairs(boxes: readonly GridBox[], cellSize = suggestCellSize(boxes)): Array<[number, number]> {
  const cells = new Map<string, number[]>();
  const large: number[] = [];
  const inv = 1 / cellSize;

  boxes.forEach((b, index) => {
    const x0 = Math.floor(b.min[0] * inv);
    const y0 = Math.floor(b.min[1] * inv);
    const z0 = Math.floor(b.min[2] * inv);
    const x1 = Math.floor(b.max[0] * inv);
    const y1 = Math.floor(b.max[1] * inv);
    const z1 = Math.floor(b.max[2] * inv);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > MAX_CELLS_PER_BOX) {
      large.push(index);
      return;
    }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const key = `${x},${y},${z}`;
          const list = cells.get(key);
          if (list) list.push(index);
          else cells.set(key, [index]);
        }
  });

  const seen = new Set<number>();
  const pairs: Array<[number, number]> = [];
  const n = boxes.length;
  const add = (a: number, b: number) => {
    const i = Math.min(a, b);
    const j = Math.max(a, b);
    const key = i * n + j;
    if (seen.has(key)) return;
    seen.add(key);
    if (overlaps(boxes[i], boxes[j])) pairs.push([i, j]);
  };

  for (const list of cells.values()) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) add(list[a], list[b]);
  }
  // Las cajas enormes se comparan con todas las demás
  for (const i of large) for (let j = 0; j < n; j++) if (j !== i) add(i, j);

  return pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}
