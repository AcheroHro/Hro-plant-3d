import { create } from 'zustand';

export type PaletteId = 'tools' | 'properties' | 'compass' | 'numpad' | 'openPorts';

/** Panel abierto en la disposición de teléfono (uno a la vez) */
export type MobilePanel = 'trazar' | 'piezas' | 'propiedades' | 'vistas' | 'mas';

export const PALETTE_PANEL: Record<PaletteId, MobilePanel | null> = {
  numpad: 'trazar',
  tools: 'piezas',
  properties: 'propiedades',
  compass: 'vistas',
  openPorts: null
};

export type ToolsLayoutMode = '1col' | '2col' | 'horiz';

export type PropertyPreset = 'COMPACT' | 'WORKSHOP' | 'ENGINEERING';

/** Proyección de la cámara 3D: perspectiva (3D natural) u ortográfica (sin distorsión, estilo CAD) */
export type CameraProjection = 'perspective' | 'orthographic';

/** Estilos visuales CAD del visor 3D */
export type VisualStyle = 'shaded' | 'xray' | 'wireframe' | 'outdoor';

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
  nippleTag: { label: 'Identificación del caño (N-01)', category: 'GENERAL' },
  lineNumber: { label: 'Número de línea', category: 'GENERAL' },
  specAndCatalog: { label: 'Spec y descripción de la pieza', category: 'GENERAL' },
  nominalAndSchedule: { label: 'Diámetro y schedule', category: 'GEOMETRY' },
  odAndThickness: { label: 'Diámetro exterior y espesor (mm)', category: 'GEOMETRY' },
  cutLength: { label: 'Largo del caño (editable)', category: 'GEOMETRY' },
  grossLength: { label: 'Largo de eje a eje (mm)', category: 'GEOMETRY' },
  fittingDimensions: { label: 'Medidas del accesorio (centro a cara, radio)', category: 'GEOMETRY' },
  endFinishes: { label: 'Preparación de extremos (bisel, plano, rosca)', category: 'CONNECTIONS' },
  endTypes: { label: 'Tipo de extremo (a tope, brida, rosca)', category: 'CONNECTIONS' },
  fasteners: { label: 'Juntas y bulones', category: 'CONNECTIONS' },
  portsXyz: { label: 'Coordenadas de las bocas (X, Y, Z)', category: 'COORDINATES' },
  elevationBop: { label: 'Elevación de eje y de fondo de caño', category: 'COORDINATES' },
  branchSelection: { label: 'Te: seguir por la línea o por el ramal', category: 'ACTIONS' },
  axialRotation: { label: 'Girar la pieza sobre el caño', category: 'ACTIONS' },
  pipeSplit: { label: 'Partir el caño con te, válvula o bridas', category: 'ACTIONS' },
  deleteButton: { label: 'Botón para borrar la pieza', category: 'ACTIONS' }
};

const STORAGE_KEY = 'achero_p3d_ui_config_v1';
/** Sube cuando cambia la disposición inicial: las posiciones guardadas antes se descartan */
const LAYOUT_VERSION = 2;
const TOUR_DONE_KEY = 'achero_p3d_tour_done_v1';
const RECENT_PIECES_KEY = 'achero_p3d_recent_pieces_v1';

const loadRecentPieces = (): string[] => {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(RECENT_PIECES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
};

/** El recorrido guiado ya se vio (o se salteó) en este dispositivo */
export const tourAlreadySeen = (): boolean => {
  try {
    return typeof window === 'undefined' || window.localStorage.getItem(TOUR_DONE_KEY) === '1';
  } catch {
    return true;
  }
};

const getDefaultPalettes = (): Record<PaletteId, PaletteWindowState> => {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const h = typeof window !== 'undefined' ? window.innerHeight : 768;

  // Medidas reales de cada paleta abierta, para que al arrancar ninguna tape a otra:
  // Piezas a la izquierda, Bocas libres y Propiedades al lado, Vistas arriba a la derecha
  // y Trazar abajo, a la derecha de donde se despliega Propiedades si la ventana da.
  const SIDE_X = 190;
  const PROPERTIES_W = 325;
  const COMPASS_W = 245;
  const NUMPAD_W = Math.min(w - 24, 542);
  const NUMPAD_H = 204;
  const centred = Math.max(12, Math.round((w - NUMPAD_W) / 2));
  const besideProperties = SIDE_X + PROPERTIES_W + 10;
  const numpadX = besideProperties + NUMPAD_W + 12 <= w ? Math.max(centred, besideProperties) : centred;

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
      x: SIDE_X,
      y: 84,
      zIndex: 22
    },
    properties: {
      isOpen: true,
      // Plegada por defecto: solo se despliega al seleccionar pieza y pulsar "Propiedades"
      isCollapsed: true,
      x: SIDE_X,
      y: 166,
      zIndex: 25
    },
    compass: {
      isOpen: true,
      isCollapsed: false,
      x: Math.max(12, w - COMPASS_W - 12),
      y: 84,
      zIndex: 23
    },
    numpad: {
      isOpen: true,
      isCollapsed: false,
      x: numpadX,
      y: Math.max(90, h - NUMPAD_H - 12),
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
  mobilePanel: MobilePanel | null;
  /** Hoja de ayuda con los gestos */
  helpOpen: boolean;
  /** Últimas piezas insertadas desde la paleta (ids de paletteItems) */
  recentPieces: string[];
  pushRecentPiece: (id: string) => void;
  /** Etiquetas permanentes en el modelo: cotas, elevaciones y número de línea */
  showLabels: boolean;
  toggleLabels: () => void;
  /** Proyección de cámara (perspectiva u ortográfica) */
  cameraProjection: CameraProjection;
  setCameraProjection: (projection: CameraProjection) => void;
  toggleCameraProjection: () => void;
  /** Estilo visual del visor 3D (sombreado, rayos X, alámbrico, exterior) */
  visualStyle: VisualStyle;
  setVisualStyle: (style: VisualStyle) => void;
  /** Colorear piezas por número de línea (estilo Plant 3D) */
  colorByLine: boolean;
  toggleColorByLine: () => void;
  /** Compás circular graduado de Plant 3D sobre la boca activa */
  showPlantCompass: boolean;
  togglePlantCompass: () => void;
  /** Envolvente de aislación térmica translúcida (estilo Toggle Insulation Display de Plant 3D) */
  showInsulation: boolean;
  toggleInsulation: () => void;
  insulationThicknessMm: number;
  setInsulationThickness: (mm: number) => void;
  /** Barra inferior del teléfono colapsada para dar más pantalla al 3D */
  dockCollapsed: boolean;
  setDockCollapsed: (collapsed: boolean) => void;
  toggleDockCollapsed: () => void;
  /** Lista de avisos de la revisión del modelo */
  issuesOpen: boolean;
  /** Paso del recorrido guiado, o null si no está en curso */
  tourStep: number | null;

  setHelpOpen: (open: boolean) => void;
  setIssuesOpen: (open: boolean) => void;
  setTourStep: (step: number | null) => void;
  /** Termina el recorrido y recuerda que ya se vio */
  finishTour: () => void;

  /** Abre un panel del teléfono; si ya estaba abierto lo cierra */
  setMobilePanel: (panel: MobilePanel | null, toggle?: boolean) => void;

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
  layoutVersion: number;
  palettes: Record<PaletteId, PaletteWindowState>;
  toolsLayout: ToolsLayoutMode;
  propertyFields: PropertyFieldsConfig;
}> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw);
    if (saved.layoutVersion !== LAYOUT_VERSION) delete saved.palettes;
    return saved;
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
        layoutVersion: LAYOUT_VERSION,
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
    mobilePanel: 'trazar',
    helpOpen: false,
    recentPieces: loadRecentPieces(),
    pushRecentPiece: (id) => {
      const next = [id, ...get().recentPieces.filter((x) => x !== id)].slice(0, 8);
      try {
        window.localStorage.setItem(RECENT_PIECES_KEY, JSON.stringify(next));
      } catch {
        // Sin almacenamiento: los recientes duran lo que dura la sesión
      }
      set({ recentPieces: next });
    },
    showLabels: (() => {
      try {
        return typeof window !== 'undefined' && window.localStorage.getItem('achero_p3d_labels_v1') === '1';
      } catch {
        return false;
      }
    })(),
    toggleLabels: () => {
      const next = !get().showLabels;
      try {
        window.localStorage.setItem('achero_p3d_labels_v1', next ? '1' : '0');
      } catch {
        // Sin almacenamiento: vale para esta sesión
      }
      set({ showLabels: next });
    },
    cameraProjection: (() => {
      try {
        return typeof window !== 'undefined' && window.localStorage.getItem('achero_p3d_proj_v1') === 'orthographic'
          ? 'orthographic'
          : 'perspective';
      } catch {
        return 'perspective';
      }
    })(),
    setCameraProjection: (projection) => {
      try {
        window.localStorage.setItem('achero_p3d_proj_v1', projection);
      } catch {
        // Sin almacenamiento
      }
      set({ cameraProjection: projection });
    },
    toggleCameraProjection: () => {
      const next: CameraProjection = get().cameraProjection === 'perspective' ? 'orthographic' : 'perspective';
      get().setCameraProjection(next);
    },
    visualStyle: (() => {
      try {
        const v = typeof window !== 'undefined' ? window.localStorage.getItem('achero_p3d_vstyle_v1') : null;
        return v === 'xray' || v === 'wireframe' || v === 'outdoor' ? v : 'shaded';
      } catch {
        return 'shaded';
      }
    })(),
    setVisualStyle: (style) => {
      try {
        window.localStorage.setItem('achero_p3d_vstyle_v1', style);
      } catch {
        // Sin almacenamiento
      }
      set({ visualStyle: style });
    },
    colorByLine: (() => {
      try {
        return typeof window !== 'undefined' && window.localStorage.getItem('achero_p3d_color_line_v1') === '1';
      } catch {
        return false;
      }
    })(),
    toggleColorByLine: () => {
      const next = !get().colorByLine;
      try {
        window.localStorage.setItem('achero_p3d_color_line_v1', next ? '1' : '0');
      } catch {
        // Sin almacenamiento
      }
      set({ colorByLine: next });
    },
    showPlantCompass: (() => {
      try {
        return typeof window === 'undefined' || window.localStorage.getItem('achero_p3d_compass_v1') !== '0';
      } catch {
        return true;
      }
    })(),
    togglePlantCompass: () => {
      const next = !get().showPlantCompass;
      try {
        window.localStorage.setItem('achero_p3d_compass_v1', next ? '1' : '0');
      } catch {
        // Sin almacenamiento
      }
      set({ showPlantCompass: next });
    },
    showInsulation: (() => {
      try {
        return typeof window !== 'undefined' && window.localStorage.getItem('achero_p3d_insul_v1') === '1';
      } catch {
        return false;
      }
    })(),
    toggleInsulation: () => {
      const next = !get().showInsulation;
      try {
        window.localStorage.setItem('achero_p3d_insul_v1', next ? '1' : '0');
      } catch {
        // Sin almacenamiento
      }
      set({ showInsulation: next });
    },
    insulationThicknessMm: (() => {
      try {
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem('achero_p3d_insul_mm_v1') : null;
        const n = raw ? Number(raw) : 50;
        return Number.isFinite(n) && n >= 10 && n <= 300 ? n : 50;
      } catch {
        return 50;
      }
    })(),
    setInsulationThickness: (mm) => {
      const clamped = Math.max(10, Math.min(300, Math.round(mm)));
      try {
        window.localStorage.setItem('achero_p3d_insul_mm_v1', String(clamped));
      } catch {
        // Sin almacenamiento
      }
      set({ insulationThicknessMm: clamped, showInsulation: true });
    },
    dockCollapsed: false,
    setDockCollapsed: (collapsed) => set({ dockCollapsed: collapsed }),
    toggleDockCollapsed: () => set((s) => ({ dockCollapsed: !s.dockCollapsed })),
    issuesOpen: false,
    tourStep: null,

    setMobilePanel: (panel, toggle = true) => {
      const next = toggle && get().mobilePanel === panel ? null : panel;
      // La lista de avisos ocupa el mismo lugar que los paneles: se muestra uno solo
      set(next ? { mobilePanel: next, issuesOpen: false } : { mobilePanel: next });
    },

    setHelpOpen: (open) => set({ helpOpen: open }),
    setIssuesOpen: (open) => set(open ? { issuesOpen: true, mobilePanel: null, helpOpen: false } : { issuesOpen: false }),
    setTourStep: (step) => set(step === null ? { tourStep: null } : { tourStep: step, helpOpen: false, issuesOpen: false }),
    finishTour: () => {
      try {
        window.localStorage.setItem(TOUR_DONE_KEY, '1');
      } catch {
        // Sin almacenamiento: el recorrido se ofrecerá de nuevo
      }
      set({ tourStep: null });
    },

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
