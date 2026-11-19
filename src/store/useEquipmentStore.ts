import { create } from 'zustand';
import {
  EquipmentKind,
  EquipmentRecord,
  createEquipmentFromPreset
} from '../core/equipment/equipmentCatalog';
import { getActiveProjectId, getProject, updateProject } from '../persistence/indexedDbStorage';

interface EquipmentState {
  projectId: string | null;
  items: EquipmentRecord[];
  loadForActiveProject: () => Promise<void>;
  addEquipment: (kind: EquipmentKind, position?: [number, number, number]) => EquipmentRecord;
  updateEquipment: (id: string, patch: Partial<Pick<EquipmentRecord, 'tag' | 'position' | 'rotationDeg'>>) => void;
  rotateEquipment: (id: string, deltaDeg?: number) => void;
  toggleVisible: (id: string) => void;
  removeEquipment: (id: string) => void;
  clearAll: () => void;
}

const persist = (items: EquipmentRecord[]) => {
  const id = getActiveProjectId();
  if (id) void updateProject(id, { equipment: items });
};

/** Equipos de proceso (tanques, recipientes, bombas) y estructuras (pipe racks) por proyecto */
export const useEquipmentStore = create<EquipmentState>((set, get) => ({
  projectId: null,
  items: [],

  loadForActiveProject: async () => {
    const id = getActiveProjectId();
    if (id === get().projectId) return;
    set({ projectId: id, items: [] });
    if (!id) return;
    const rec = await getProject(id);
    if (get().projectId === id) {
      set({ items: Array.isArray(rec?.equipment) ? rec.equipment : [] });
    }
  },

  addEquipment: (kind, position) => {
    const current = get().items;
    const sameKindCount = current.filter((e) => e.kind === kind).length;
    // Si no se indica posición, escalonar en X para que no se encimen los equipos
    const defaultPos: [number, number, number] = position ?? [current.length * 2600, 0, 0];
    const created = createEquipmentFromPreset(kind, sameKindCount, defaultPos, 0);
    const next = [...current, created];
    set({ projectId: getActiveProjectId(), items: next });
    persist(next);
    return created;
  },

  updateEquipment: (id, patch) => {
    const next = get().items.map((item) => (item.id === id ? { ...item, ...patch } : item));
    set({ items: next });
    persist(next);
  },

  rotateEquipment: (id, deltaDeg = 90) => {
    const next = get().items.map((item) =>
      item.id === id ? { ...item, rotationDeg: (item.rotationDeg + deltaDeg) % 360 } : item
    );
    set({ items: next });
    persist(next);
  },

  toggleVisible: (id) => {
    const next = get().items.map((item) => (item.id === id ? { ...item, visible: !item.visible } : item));
    set({ items: next });
    persist(next);
  },

  removeEquipment: (id) => {
    const next = get().items.filter((item) => item.id !== id);
    set({ items: next });
    persist(next);
  },

  clearAll: () => {
    set({ items: [] });
    persist([]);
  }
}));
