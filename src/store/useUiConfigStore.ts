import { create } from 'zustand';

export type PaletteId = 'tools' | 'properties' | 'compass' | 'numpad' | 'openPorts';

export type ToolsLayoutMode = '1col' | '2col' | 'horiz';

export type PropertyPreset = 'COMPACT' | 'WORKSHOP' | 'ENGINEERING';

export interface PaletteWindowState {
  isOpen: boolean;
  isCollapsed: boolean;
  x: number;
  y: number;
  zIndex: number;
}

export interface PropertyFieldsConfig {
  // 1. Identificación y Catálogo
  nippleTag: boolean;
  lineNumber: boolean;
  specAndCatalog: boolean;
  // 2. Geometría y Dimensiones
  nominalAndSchedule: boolean;
  odAndThickness: boolean;
  cutLength: boolean;
  grossLength: boolean;
  fittingDimensions: boolean;
  // 3. Extremos y Uniones
  endFinishes: boolean;
  endTypes: boolean;
  fasteners: boolean;
  // 4. Coordenadas WCS y Elevación
  portsXyz: boolean;
  elevationBop: boolean;
  // 5. Acciones de Modelado 3D
  branchSelection: boolean;
  axialRotation: boolean;
  pipeSplit: boolean;
  deleteButton: boolean;
}

export const PROPERTY_FIELD_LABELS: Record<
  keyof PropertyFieldsConfig,
  { label: string; category: 'GENERAL' | 'GEOMETRY' | 'CONNECTIONS' | 'COORDINATES' | 'ACTIONS' }
> = {
  nippleTag: { label: 'Tag / N.º Niple (N-01)', category: 'GENERAL' },
  lineNumber: { label: 'Número de Línea (Line Number)', category: 'GENERAL' },
  specAndCatalog: { label: 'Descripción de Catálogo (.pspc)', category: 'GENERAL' },
  nominalAndSchedule: { label: 'Diámetro Nominal (ND) y Schedule', category: 'GEOMETRY' },
  odAndThickness: { label: 'Diámetro Exterior (OD) y Espesor (mm)', category: 'GEOMETRY' },
  cutLength: { label: 'Largo Neto de Corte (Editable)', category: 'GEOMETRY' },
  grossLength: { label: 'Largo Bruto Eje a Eje (mm)', category: 'GEOMETRY' },
  fittingDimensions: { label: 'Cotas de Accesorio (Take-Off / Radio)', category: 'GEOMETRY' },
  endFinishes: { label: 'Preparación de Extremos (Bisel/Plano/Rosc.)', category: 'CONNECTIONS' },
  endTypes: { label: 'Tipo de Extremo ASME (BW/FLANG/THD)', category: 'CONNECTIONS' },
  fasteners: { label: 'Juntas y Espárragos (P3dJoint)', category: 'CONNECTIONS' },
  portsXyz: { label: 'Coordenadas 3D de Bocas (X, Y, Z)', category: 'COORDINATES' },
  elevationBop: { label: 'Elevación Eje Z y Cota Inferior (BOP)', category: 'COORDINATES' },
  branchSelection: { label: 'Selector de Derivación Te (#2 / #3)', category: 'ACTIONS' },
  axialRotation: { label: 'Giro Axial (+90° / -90° / +45° / 180°)', category: 'ACTIONS' },
  pipeSplit: { label: 'Partir Caño e Insertar (+Te / +Válv / +Brida)', category: 'ACTIONS' },
  deleteButton: { label: 'Botón Eliminar Pieza', category: 'ACTIONS' }
};

const STORAGE_KEY = 'achero_p3d_ui_config_v1';

const getDefaultPalettes = (): Record<PaletteId, PaletteWindowState> => {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const h = typeof window !== 'undefined' ? window.innerHeight : 768;

  return {
    tools: {
      isOpen: true,
      isCollapsed: false,
      x: 10,
      y: 84,
      zIndex: 21
    },
    openPorts: {
      isOpen: true,
      isCollapsed: false,
      x: 84,
      y: 84,
      zIndex: 22
    },
    properties: {
      isOpen: true,
      // Plegada por defecto: solo se despliega al seleccionar pieza y pulsar "Propiedades"
      isCollapsed: true,
      x: 84,
      y: 130,
      zIndex: 25
    },
    compass: {
      isOpen: true,
      isCollapsed: false,
      x: Math.max(12, w - 164),
      y: 84,
      zIndex: 23
    },
    numpad: {
      isOpen: true,
      isCollapsed: false,
      x: Math.max(12, Math.round((w - Math.min(w - 24, 540)) / 2)),
      y: Math.max(90, h - 125),
      zIndex: 24
    }
  };
};

const DEFAULT_PROPERTY_FIELDS: PropertyFieldsConfig = {
  nippleTag: true,
  lineNumber: true,
  specAndCatalog: true,
  nominalAndSchedule: true,
  odAndThickness: true,
  cutLength: true,
  grossLength: false,
  fittingDimensions: true,
  endFinishes: true,
  endTypes: false,
  fasteners: true,
  portsXyz: false,
  elevationBop: true,
  branchSelection: true,
  axialRotation: true,
  pipeSplit: true,
  deleteButton: true
};

interface UiConfigState {
  palettes: Record<PaletteId, PaletteWindowState>;
  toolsLayout: ToolsLayoutMode;
  propertyFields: PropertyFieldsConfig;
  isPropertiesConfigOpen: boolean;
  topZIndex: number;

  // Acciones de ventana/paleta
  setPalettePosition: (id: PaletteId, x: number, y: number) => void;
  togglePaletteOpen: (id: PaletteId, forceState?: boolean) => void;
  togglePaletteCollapsed: (id: PaletteId, forceState?: boolean) => void;
  bringToFront: (id: PaletteId) => void;
  setToolsLayout: (mode: ToolsLayoutMode) => void;
  resetWorkspaceLayout: () => void;

  // Acciones de configuración de propiedades
  togglePropertyField: (field: keyof PropertyFieldsConfig) => void;
  applyPropertyPreset: (preset: PropertyPreset) => void;
  setPropertiesConfigOpen: (open: boolean) => void;
}

const loadPersistedState = (): Partial<{
  palettes: Record<PaletteId, PaletteWindowState>;
  toolsLayout: ToolsLayoutMode;
  propertyFields: PropertyFieldsConfig;
}> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const savePersistedState = (state: {
  palettes: Record<PaletteId, PaletteWindowState>;
  toolsLayout: ToolsLayoutMode;
  propertyFields: PropertyFieldsConfig;
}) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        palettes: state.palettes,
        toolsLayout: state.toolsLayout,
        propertyFields: state.propertyFields
      })
    );
  } catch {
    // Ignore storage quota errors
  }
};

export const useUiConfigStore = create<UiConfigState>((set, get) => {
  const persisted = loadPersistedState();
  const defaults = getDefaultPalettes();

  const initialPalettes: Record<PaletteId, PaletteWindowState> = {
    tools: { ...defaults.tools, ...(persisted.palettes?.tools || {}) },
    openPorts: { ...defaults.openPorts, ...(persisted.palettes?.openPorts || {}) },
    properties: {
      ...defaults.properties,
      ...(persisted.palettes?.properties || {}),
      // Garantizar que inicie plegada al arrancar la sesión
      isCollapsed: true
    },
    compass: { ...defaults.compass, ...(persisted.palettes?.compass || {}) },
    numpad: { ...defaults.numpad, ...(persisted.palettes?.numpad || {}) }
  };

  const initialFields: PropertyFieldsConfig = {
    ...DEFAULT_PROPERTY_FIELDS,
    ...(persisted.propertyFields || {})
  };

  return {
    palettes: initialPalettes,
    toolsLayout: persisted.toolsLayout || '1col',
    propertyFields: initialFields,
    isPropertiesConfigOpen: false,
    topZIndex: 30,

    setPalettePosition: (id, x, y) => {
      const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const h = typeof window !== 'undefined' ? window.innerHeight : 800;
      const clampedX = Math.max(4, Math.min(x, w - 80));
      const clampedY = Math.max(54, Math.min(y, h - 44));

      const nextPalettes = {
        ...get().palettes,
        [id]: {
          ...get().palettes[id],
          x: clampedX,
          y: clampedY
        }
      };
      set({ palettes: nextPalettes });
      savePersistedState({
        palettes: nextPalettes,
        toolsLayout: get().toolsLayout,
        propertyFields: get().propertyFields
      });
    },

    togglePaletteOpen: (id, forceState) => {
      const current = get().palettes[id];
      const nextOpen = forceState !== undefined ? forceState : !current.isOpen;
      const nextZ = get().topZIndex + 1;
      const nextPalettes = {
        ...get().palettes,
        [id]: {
          ...current,
          isOpen: nextOpen,
          zIndex: nextOpen ? nextZ : current.zIndex
        }
      };
      set({ palettes: nextPalettes, topZIndex: nextZ });
      savePersistedState({
        palettes: nextPalettes,
        toolsLayout: get().toolsLayout,
        propertyFields: get().propertyFields
      });
    },

    togglePaletteCollapsed: (id, forceState) => {
      const current = get().palettes[id];
      const nextCollapsed = forceState !== undefined ? forceState : !current.isCollapsed;
      const nextZ = get().topZIndex + 1;
      const nextPalettes = {
        ...get().palettes,
        [id]: {
          ...current,
          isCollapsed: nextCollapsed,
          zIndex: nextZ
        }
      };
      set({ palettes: nextPalettes, topZIndex: nextZ });
      savePersistedState({
        palettes: nextPalettes,
        toolsLayout: get().toolsLayout,
        propertyFields: get().propertyFields
      });
    },

    bringToFront: (id) => {
      const current = get().palettes[id];
      if (!current) return;
      const nextZ = get().topZIndex + 1;
      if (current.zIndex === get().topZIndex) return;
      const nextPalettes = {
        ...get().palettes,
        [id]: {
          ...current,
          zIndex: nextZ
        }
      };
      set({ palettes: nextPalettes, topZIndex: nextZ });
    },

    setToolsLayout: (mode) => {
      set({ toolsLayout: mode });
      savePersistedState({
        palettes: get().palettes,
        toolsLayout: mode,
        propertyFields: get().propertyFields
      });
    },

    resetWorkspaceLayout: () => {
      const fresh = getDefaultPalettes();
      set({
        palettes: fresh,
        toolsLayout: '1col',
        topZIndex: 30
      });
      savePersistedState({
        palettes: fresh,
        toolsLayout: '1col',
        propertyFields: get().propertyFields
      });
    },

    togglePropertyField: (field) => {
      const nextFields = {
        ...get().propertyFields,
        [field]: !get().propertyFields[field]
      };
      set({ propertyFields: nextFields });
      savePersistedState({
        palettes: get().palettes,
        toolsLayout: get().toolsLayout,
        propertyFields: nextFields
      });
    },

    applyPropertyPreset: (preset) => {
      let nextFields: PropertyFieldsConfig;
      if (preset === 'COMPACT') {
        nextFields = {
          nippleTag: false,
          lineNumber: false,
          specAndCatalog: false,
          nominalAndSchedule: true,
          odAndThickness: false,
          cutLength: true,
          grossLength: false,
          fittingDimensions: false,
          endFinishes: true,
          endTypes: false,
          fasteners: false,
          portsXyz: false,
          elevationBop: false,
          branchSelection: true,
          axialRotation: true,
          pipeSplit: true,
          deleteButton: true
        };
      } else if (preset === 'WORKSHOP') {
        nextFields = {
          nippleTag: true,
          lineNumber: true,
          specAndCatalog: true,
          nominalAndSchedule: true,
          odAndThickness: false,
          cutLength: true,
          grossLength: true,
          fittingDimensions: true,
          endFinishes: true,
          endTypes: false,
          fasteners: true,
          portsXyz: false,
          elevationBop: false,
          branchSelection: true,
          axialRotation: true,
          pipeSplit: true,
          deleteButton: true
        };
      } else {
        // ENGINEERING (Completo)
        nextFields = {
          nippleTag: true,
          lineNumber: true,
          specAndCatalog: true,
          nominalAndSchedule: true,
          odAndThickness: true,
          cutLength: true,
          grossLength: true,
          fittingDimensions: true,
          endFinishes: true,
          endTypes: true,
          fasteners: true,
          portsXyz: true,
          elevationBop: true,
          branchSelection: true,
          axialRotation: true,
          pipeSplit: true,
          deleteButton: true
        };
      }
      set({ propertyFields: nextFields });
      savePersistedState({
        palettes: get().palettes,
        toolsLayout: get().toolsLayout,
        propertyFields: nextFields
      });
    },

    setPropertiesConfigOpen: (open) => set({ isPropertiesConfigOpen: open })
  };
});
