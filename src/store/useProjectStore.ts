import { create } from 'zustand';
import { usePipingStore } from './usePipingStore';
import {
  FieldNote,
  ProjectMeta,
  ProjectRecord,
  createProject,
  deletePhoto,
  deleteProject,
  exportProjectBundle,
  flushPendingSave,
  getProject,
  importProjectBundle,
  isProjectBundle,
  listProjects,
  newId,
  savePhoto,
  setActiveProjectId,
  updateProject
} from '../persistence/indexedDbStorage';
import { SerializedGraphState } from '../types/piping';
import { IncomingFile } from '../pwa/pwa';
import { compressPhoto } from '../utils/photos';
import { componentLabel } from '../core/field/changeLog';
import { downloadFile } from '../utils/fileDownloader';

/**
 * Proyectos de campo guardados en el teléfono. Cada PCF que llega de Plant abre un proyecto
 * nuevo y queda como línea base: todo lo que se cambie después se registra contra ese PCF.
 */
interface ProjectState {
  projectId: string | null;
  projectName: string;
  sourceName?: string;
  baseline: SerializedGraphState | null;
  baselineAt?: number;
  notes: FieldNote[];
  projects: ProjectMeta[];
  isProjectsOpen: boolean;
  isFieldOpen: boolean;
  /** Colorear en el visor lo que cambió en campo */
  fieldView: boolean;

  attach: (rec: ProjectRecord | null) => void;
  refreshList: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  newProject: (name?: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  exportBundle: (id: string) => Promise<void>;
  importFiles: (files: IncomingFile[]) => Promise<void>;
  addNote: (text: string, photos: File[]) => Promise<void>;
  updateNote: (id: string, text: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  /** Toma el modelo actual como nueva base (después de mandar los cambios a la oficina) */
  acceptBaseline: () => Promise<void>;
  toggleProjects: () => void;
  toggleField: () => void;
  toggleFieldView: () => void;
}

const status = (msg: string) => usePipingStore.setState({ statusMessage: msg });
const baseName = (f: string) => f.replace(/\.[^.]+$/, '');

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectId: null,
  projectName: 'Proyecto',
  baseline: null,
  notes: [],
  projects: [],
  isProjectsOpen: false,
  isFieldOpen: false,
  fieldView: false,

  attach: (rec) => {
    if (!rec) {
      set({ projectId: null, projectName: 'Proyecto', baseline: null, baselineAt: undefined, notes: [], sourceName: undefined });
      return;
    }
    setActiveProjectId(rec.id);
    set({
      projectId: rec.id,
      projectName: rec.name,
      sourceName: rec.sourceName,
      baseline: rec.baseline,
      baselineAt: rec.baselineAt,
      notes: rec.notes
    });
  },

  refreshList: async () => set({ projects: await listProjects() }),

  openProject: async (id) => {
    await flushPendingSave();
    const rec = await getProject(id);
    if (!rec) {
      status('No se encontró el proyecto.');
      return;
    }
    get().attach(rec);
    usePipingStore.getState().loadGraphState(rec.state, `Proyecto "${rec.name}" abierto (${Object.keys(rec.state.components).length} piezas).`);
    set({ isProjectsOpen: false });
  },

  newProject: async (name) => {
    await flushPendingSave();
    const pipe = usePipingStore.getState();
    pipe.loadGraphState(null);
    const state = usePipingStore.getState().graph.serialize();
    const n = (await listProjects()).length + 1;
    const rec = await createProject({ name: name || `Proyecto ${n}`, state });
    get().attach(rec);
    set({ isProjectsOpen: false });
    status(`Proyecto nuevo "${rec.name}": modelo vacío. Trazá desde cero o abrí un PCF.`);
  },

  renameProject: async (id, name) => {
    const clean = name.trim();
    if (!clean) return;
    await updateProject(id, { name: clean });
    if (id === get().projectId) set({ projectName: clean });
    await get().refreshList();
  },

  removeProject: async (id) => {
    await deleteProject(id);
    if (id === get().projectId) {
      const rest = await listProjects();
      if (rest.length) await get().openProject(rest[0].id);
      else await get().newProject();
    }
    await get().refreshList();
  },

  exportBundle: async (id) => {
    await flushPendingSave();
    const json = await exportProjectBundle(id);
    if (!json) return;
    const rec = await getProject(id);
    const name = (rec?.name || 'proyecto').replace(/[^a-zA-Z0-9_-]+/g, '_');
    downloadFile(`${name}.achero`, json, 'application/json');
    status(`Copia del proyecto guardada: ${name}.achero (modelo, base, notas y fotos). Abrila en otro equipo con "Abrir".`);
  },

  importFiles: async (files) => {
    let last: ProjectRecord | null = null;
    const done: string[] = [];
    for (const f of files) {
      try {
        if (isProjectBundle(f.text)) {
          await flushPendingSave();
          last = await importProjectBundle(f.text);
          done.push(last.name);
          continue;
        }
        if (!/\.pcf$/i.test(f.name) && !/^\s*(PIPELINE-REFERENCE|END-POINT)/m.test(f.text)) {
          status(`"${f.name}" no parece un PCF.`);
          continue;
        }
        await flushPendingSave();
        const state = usePipingStore.getState().importPcfFile(f.text, f.name);
        if (!state) continue;
        const msg = usePipingStore.getState().statusMessage;
        last = await createProject({ name: baseName(f.name), state, baseline: state, sourceName: f.name });
        get().attach(last);
        done.push(last.name);
        status(`Proyecto "${last.name}" creado. ${msg}`);
      } catch (err) {
        status(`No se pudo abrir "${f.name}": ${(err as Error).message}`);
      }
    }
    // Si llegaron varios, queda abierto el último
    if (last && files.length > 1) {
      await get().openProject(last.id);
      status(`${done.length} proyectos abiertos: ${done.join(', ')}. Elegí cuál ver en Proyectos.`);
    } else if (last && isProjectBundle(files[0].text)) {
      await get().openProject(last.id);
    }
    await get().refreshList();
  },

  addNote: async (text, photos) => {
    const { projectId } = get();
    if (!projectId) return;
    const pipe = usePipingStore.getState();
    const comp = pipe.selectedComponentId ? pipe.graph.components.get(pipe.selectedComponentId) : undefined;
    const photoIds: string[] = [];
    for (const file of photos) {
      try {
        const ph = await compressPhoto(file);
        photoIds.push(await savePhoto(projectId, ph.blob, ph.width, ph.height));
      } catch (err) {
        status(`No se pudo guardar la foto ${file.name}: ${(err as Error).message}`);
      }
    }
    const note: FieldNote = {
      id: newId('nota'),
      componentId: comp?.id,
      componentLabel: comp ? componentLabel(pipe.graph.serialize().components[comp.id]) : undefined,
      text: text.trim(),
      createdAt: Date.now(),
      photoIds
    };
    const notes = [...get().notes, note];
    set({ notes });
    await updateProject(projectId, { notes });
    status(`Nota guardada${note.componentLabel ? ` en ${note.componentLabel}` : ''}${photoIds.length ? ` con ${photoIds.length} foto${photoIds.length > 1 ? 's' : ''}` : ''}.`);
  },

  updateNote: async (id, text) => {
    const { projectId } = get();
    if (!projectId) return;
    const notes = get().notes.map((n) => (n.id === id ? { ...n, text } : n));
    set({ notes });
    await updateProject(projectId, { notes });
  },

  deleteNote: async (id) => {
    const { projectId } = get();
    if (!projectId) return;
    const note = get().notes.find((n) => n.id === id);
    for (const ph of note?.photoIds ?? []) await deletePhoto(ph);
    const notes = get().notes.filter((n) => n.id !== id);
    set({ notes });
    await updateProject(projectId, { notes });
  },

  acceptBaseline: async () => {
    const { projectId } = get();
    if (!projectId) return;
    const state = usePipingStore.getState().graph.serialize();
    const now = Date.now();
    set({ baseline: state, baselineAt: now });
    await updateProject(projectId, { state, baseline: state, baselineAt: now });
    status('El modelo actual quedó como nueva base: los próximos cambios se registran desde acá.');
  },

  toggleProjects: () => {
    const open = !get().isProjectsOpen;
    set({ isProjectsOpen: open });
    if (open) void get().refreshList();
  },
  toggleField: () => set((s) => ({ isFieldOpen: !s.isFieldOpen })),
  toggleFieldView: () => {
    set((s) => ({ fieldView: !s.fieldView }));
    usePipingStore.setState((s) => ({ version: s.version + 1 }));
  }
}));
