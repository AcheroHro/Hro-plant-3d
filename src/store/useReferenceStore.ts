import { create } from 'zustand';
import { parseDxfReference } from '../core/importers/DxfReference';
import { getActiveProjectId, getProject, updateProject, ReferenceRecord } from '../persistence/indexedDbStorage';

interface ReferenceState {
  /** Proyecto al que pertenece la referencia cargada */
  projectId: string | null;
  reference: ReferenceRecord | null;
  /** Resultado de la última importación, para mostrar en Vistas */
  note: string;
  /** Trae la referencia guardada con el proyecto activo (si cambió de proyecto) */
  loadForActiveProject: () => Promise<void>;
  importDxf: (text: string, fileName: string) => void;
  setScale: (mmPerUnit: number) => void;
  setVisible: (visible: boolean) => void;
  clear: () => void;
}

const persist = (reference: ReferenceRecord | null) => {
  const id = getActiveProjectId();
  if (id) void updateProject(id, { reference: reference ?? undefined });
};

/** Referencia de obra: un DXF de ejes y columnas dibujado de fondo, guardado con el proyecto */
export const useReferenceStore = create<ReferenceState>((set, get) => ({
  projectId: null,
  reference: null,
  note: '',

  loadForActiveProject: async () => {
    const id = getActiveProjectId();
    if (id === get().projectId) return;
    set({ projectId: id, reference: null, note: '' });
    if (!id) return;
    const rec = await getProject(id);
    // Mientras se leía pudo cambiar de proyecto otra vez
    if (get().projectId === id) set({ reference: rec?.reference ?? null });
  },

  importDxf: (text, fileName) => {
    try {
      const parsed = parseDxfReference(text);
      const count = parsed.segments.length / 6;
      if (!count) {
        set({ note: `${fileName}: no tiene líneas para dibujar (${parsed.skipped} elementos de otro tipo).` });
        return;
      }
      const reference: ReferenceRecord = {
        name: fileName,
        // Décimas de unidad alcanzan y achican lo que se guarda
        segments: parsed.segments.map((n) => Math.round(n * 1000) / 1000),
        scale: parsed.scale,
        visible: true
      };
      const unit = parsed.scale === 1 ? 'milímetros' : parsed.scale === 10 ? 'centímetros' : parsed.scale === 1000 ? 'metros' : `${parsed.scale} mm por unidad`;
      set({
        projectId: getActiveProjectId(),
        reference,
        note:
          `${count} líneas, en ${unit}${parsed.scaleSource === 'supuesta' ? ' (supuesto: el DXF no lo dice)' : ''}.` +
          (parsed.skipped ? ` Sin dibujar: ${parsed.skipped} textos, cotas u otros.` : '') +
          (parsed.truncated ? ' ⚠ El dibujo es muy grande: se cargó solo una parte.' : '')
      });
      persist(reference);
    } catch (e) {
      set({ note: (e as Error).message });
    }
  },

  setScale: (mmPerUnit) => {
    const cur = get().reference;
    if (!cur || !(mmPerUnit > 0)) return;
    const reference = { ...cur, scale: mmPerUnit };
    set({ reference });
    persist(reference);
  },

  setVisible: (visible) => {
    const cur = get().reference;
    if (!cur) return;
    const reference = { ...cur, visible };
    set({ reference });
    persist(reference);
  },

  clear: () => {
    set({ reference: null, note: 'Referencia quitada.' });
    persist(null);
  }
}));
