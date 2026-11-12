import * as THREE from 'three';
import { batchHasPiece, buildMeshBatches, isBatchable, setPieceHidden } from './meshBatches';
import type { PieceSpec } from './modelPieces';

/**
 * Mallas fusionadas que se actualizan sin rearmar todo el modelo en cada edición.
 *
 * - Cada pieza armada se guarda con su firma; si la firma no cambia, no se vuelve a armar.
 * - "Base": malla fusionada grande con el modelo tal como estaba en el último reagrupado.
 * - "Cambios": malla fusionada chica con las piezas nuevas o distintas de la base. En la base,
 *   esas piezas (y las borradas) quedan apagadas.
 * - Cuando los cambios crecen, se reagrupa todo en una base nueva (con las piezas ya armadas).
 * - Deshacer devuelve las piezas a su firma anterior: se prenden de nuevo en la base y listo.
 */
export class IncrementalBatches {
  private cache = new Map<string, { sig: string; object: THREE.Object3D | null }>();
  private base: THREE.Mesh[] = [];
  private baseSigs = new Map<string, string>();
  private recent: THREE.Mesh[] = [];

  /** Datos de la última actualización, para medir y para los tests */
  lastStats = { built: 0, changed: 0, consolidated: false, pieces: 0 };

  constructor(
    /** Piezas distintas de la base a partir de las cuales conviene reagrupar */
    private readonly consolidateAt = (total: number) => Math.max(48, Math.round(total * 0.15))
  ) {}

  /** Mallas fusionadas vigentes (base y cambios) */
  get batches(): THREE.Mesh[] {
    return [...this.base, ...this.recent];
  }

  /**
   * Lleva las mallas a lo que piden `specs`. Devuelve qué poner en la escena: las mallas
   * fusionadas y los objetos que no se pueden fusionar (que son los guardados: no liberarlos).
   */
  update(specs: readonly PieceSpec[]): { batches: THREE.Mesh[]; rest: THREE.Object3D[] } {
    const wanted = new Map<string, PieceSpec>();
    for (const spec of specs) wanted.set(spec.key, spec);

    // 1. Armar solo lo que cambió de firma; soltar lo que ya no está
    let built = 0;
    for (const spec of wanted.values()) {
      const cached = this.cache.get(spec.key);
      if (cached && cached.sig === spec.sig) continue;
      if (cached?.object) disposeGeometries(cached.object);
      const object = spec.build();
      if (object) {
        const key = spec.key;
        object.traverse((child) => {
          child.userData = { ...child.userData, pieceKey: key, ...(spec.pickable ? { componentId: key } : {}) };
        });
        object.updateMatrixWorld(true);
      }
      this.cache.set(spec.key, { sig: spec.sig, object });
      built++;
    }
    for (const [key, cached] of this.cache) {
      if (wanted.has(key)) continue;
      if (cached.object) disposeGeometries(cached.object);
      this.cache.delete(key);
    }

    // 2. Qué difiere de la base
    const rest: THREE.Object3D[] = [];
    const changed: THREE.Object3D[] = [];
    for (const spec of wanted.values()) {
      const object = this.cache.get(spec.key)?.object;
      if (!object) continue;
      if (!isBatchable(object)) {
        rest.push(object);
        continue;
      }
      if (this.baseSigs.get(spec.key) !== spec.sig) changed.push(object);
    }

    // La primera vez (sin malla grande) o cuando los cambios ya son muchos, se reagrupa todo
    const consolidate =
      changed.length > 0 && (this.baseSigs.size === 0 || changed.length >= this.consolidateAt(wanted.size));
    disposeBatches(this.recent);
    this.recent = [];

    if (consolidate) {
      disposeBatches(this.base);
      const all: THREE.Object3D[] = [];
      this.baseSigs = new Map();
      for (const spec of wanted.values()) {
        const object = this.cache.get(spec.key)?.object;
        if (!object || !isBatchable(object)) continue;
        all.push(object);
        this.baseSigs.set(spec.key, spec.sig);
      }
      this.base = buildMeshBatches(all, keyOf).batches;
    } else {
      // En la base se ve lo que sigue igual; lo cambiado o borrado se apaga
      for (const [key, sig] of this.baseSigs) {
        const same = wanted.get(key)?.sig === sig;
        setPieceHidden(this.base, key, !same);
      }
      this.recent = changed.length ? buildMeshBatches(changed, keyOf).batches : [];
    }

    this.lastStats = { built, changed: consolidate ? 0 : changed.length, consolidated: consolidate, pieces: wanted.size };
    return { batches: this.batches, rest };
  }

  /** Si la pieza está dibujada en alguna malla fusionada (en la base solo si no está apagada por un cambio) */
  hasPiece(key: string): boolean {
    return this.batches.some((b) => batchHasPiece(b, key));
  }

  dispose(): void {
    disposeBatches(this.base);
    disposeBatches(this.recent);
    this.base = [];
    this.recent = [];
    this.baseSigs.clear();
    for (const cached of this.cache.values()) if (cached.object) disposeGeometries(cached.object);
    this.cache.clear();
  }
}

const keyOf = (mesh: THREE.Mesh) => (mesh.userData.pieceKey as string | undefined) ?? null;

/** Libera solo geometrías: los materiales son del visor y se comparten */
function disposeGeometries(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}

function disposeBatches(batches: THREE.Mesh[]): void {
  for (const b of batches) b.geometry.dispose();
}
