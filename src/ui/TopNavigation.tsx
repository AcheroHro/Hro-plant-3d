import React, { useRef } from 'react';
import { usePipingStore } from '../store/usePipingStore';

const BUILT_IN_SPECS = ['RCI1', 'CS150', 'CS300', 'SS150'];

export const TopNavigation: React.FC = () => {
  const cameraMode = usePipingStore((s) => s.cameraMode);
  const setCameraMode = usePipingStore((s) => s.setCameraMode);
  const nominalDiameter = usePipingStore((s) => s.nominalDiameter);
  const setNominalDiameter = usePipingStore((s) => s.setNominalDiameter);
  const canUndo = usePipingStore((s) => s.canUndo);
  const canRedo = usePipingStore((s) => s.canRedo);
  const undo = usePipingStore((s) => s.undo);
  const redo = usePipingStore((s) => s.redo);
  const frameAll = usePipingStore((s) => s.frameAll);
  const toggleBom = usePipingStore((s) => s.toggleBom);
  const toggleExport = usePipingStore((s) => s.toggleExport);
  const resetGraph = usePipingStore((s) => s.resetGraph);
  const statusMessage = usePipingStore((s) => s.statusMessage);
  const specReader = usePipingStore((s) => s.specReader);
  const specCode = usePipingStore((s) => s.specCode);
  const loadPspcFile = usePipingStore((s) => s.loadPspcFile);
  const loadBuiltInSpec = usePipingStore((s) => s.loadBuiltInSpec);
  const toggleToolPalette = usePipingStore((s) => s.toggleToolPalette);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableDiameters = specReader
    ? specReader.getAvailableNominalDiameters(specCode)
    : [0.5, 0.75, 1, 1.5, 2, 3, 4, 6];

  const handleModeToggle = () => {
    const nextMode = cameraMode === 'INSPECT_MODE' ? 'ROUTE_MODE' : 'INSPECT_MODE';
    setCameraMode(nextMode);
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(10);
      } catch {
        // Ignorar
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    await loadPspcFile(buffer, file.name);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatNd = (d: number) => {
    if (d === 0.5) return '1/2"';
    if (d === 0.75) return '3/4"';
    if (d === 1.25) return '1-1/4"';
    if (d === 1.5) return '1-1/2"';
    if (d === 2.5) return '2-1/2"';
    if (d === 3.5) return '3-1/2"';
    return `${d}"`;
  };

  const specOptions = BUILT_IN_SPECS.includes(specCode)
    ? BUILT_IN_SPECS
    : [specCode, ...BUILT_IN_SPECS];

  return (
    <header className="absolute top-0 left-0 right-0 z-30 flex flex-col bg-[#1e2128]/98 backdrop-blur-md border-b border-[#383d4a] shadow-xl select-none">
      {/* Cinta superior de pestañas estilo AutoCAD Plant 3D 2027 */}
      <div className="h-6 px-3 bg-[#15171c] border-b border-[#2c303a] flex items-center justify-between text-[10px]">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-[#e53935] text-white font-black text-[9px] tracking-tighter shadow-sm">
              P3D
            </span>
            <span className="font-bold text-slate-200 tracking-wide">
              Autodesk AutoCAD Plant 3D 2027 <span className="text-[#0696d7]">• Achero Mobile</span>
            </span>
          </div>
          <div className="hidden sm:flex items-center space-x-1 text-[10px]">
            <span className="px-2 py-0.5 bg-[#262a33] text-[#38bdf8] font-bold rounded-t border-t border-x border-[#383d4a]">
              Home (3D Piping)
            </span>
            <span className="px-2 py-0.5 text-slate-400 hover:text-slate-200 cursor-pointer" onClick={toggleExport}>
              Isos (IsoGen / DXF)
            </span>
            <span className="px-2 py-0.5 text-slate-400 hover:text-slate-200 cursor-pointer" onClick={toggleBom}>
              Data Manager (BOM)
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-2 font-mono text-[9px] text-slate-400">
          <span className="text-emerald-400">● P3dJoint Auto</span>
          <span className="hidden md:inline">| WCS Z-Up (mm)</span>
        </div>
      </div>

      {/* Ribbon Principal de Herramientas (Part Insertion & Visibility) */}
      <div className="h-12 px-2.5 flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar bg-[#252830]">
        {/* Input oculto para cargar archivos .pspc */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pspc"
          onChange={handleFileUpload}
          className="hidden"
        />

        {/* Grupo Ribbon: Part Insertion (Spec Selector + Size Selector + Tool Palette) */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {/* Selector de Spec Oficial (RCI1, CS150, CS300, SS150) */}
          <div className="flex flex-col bg-[#1b1e24] border border-[#3a3f4d] rounded px-1.5 py-0.5">
            <span className="text-[8px] uppercase text-slate-400 font-bold leading-none mb-0.5">
              Spec
            </span>
            <select
              value={specCode}
              onChange={(e) => loadBuiltInSpec(e.target.value)}
              className="bg-transparent text-[11px] font-mono font-bold text-[#38bdf8] outline-none cursor-pointer leading-tight"
              title="Seleccionar Especificación de AutoCAD Plant 3D 2027"
            >
              {specOptions.map((sp) => (
                <option key={sp} value={sp} className="bg-[#1b1e24] text-slate-100">
                  {sp}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de Diámetro Nominal (Size) */}
          <div className="flex flex-col bg-[#1b1e24] border border-[#3a3f4d] rounded px-1.5 py-0.5">
            <span className="text-[8px] uppercase text-slate-400 font-bold leading-none mb-0.5">
              Size (ND)
            </span>
            <select
              value={nominalDiameter}
              onChange={(e) => setNominalDiameter(Number(e.target.value))}
              className="bg-transparent text-[11px] font-mono font-bold text-emerald-400 outline-none cursor-pointer leading-tight"
              title="Seleccionar Diámetro Nominal (Size)"
            >
              {availableDiameters.map((d) => (
                <option key={d} value={d} className="bg-[#1b1e24] text-slate-100">
                  {formatNd(d)}
                </option>
              ))}
            </select>
          </div>

          {/* Botón Cargar otro .pspc */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-9 px-2 rounded bg-[#2f333d] border border-[#434959] hover:border-[#0696d7] text-[11px] font-bold text-slate-200 flex items-center space-x-1 transition-colors"
            title="Importar otro archivo .pspc desde el dispositivo"
          >
            <span>📁</span>
            <span className="hidden lg:inline">.PSPC</span>
          </button>

          {/* Separador vertical tipo Ribbon */}
          <div className="h-7 w-[1px] bg-[#3a3f4d] mx-0.5" />

          {/* Selector de Modo: Route Pipe vs Orbit */}
          <button
            type="button"
            onClick={handleModeToggle}
            className={`h-9 px-2.5 rounded text-xs font-bold transition-all border flex items-center space-x-1.5 ${
              cameraMode === 'ROUTE_MODE'
                ? 'bg-[#0696d7] text-white border-[#38bdf8] shadow-md shadow-[#0696d7]/30'
                : 'bg-[#2f333d] text-slate-200 border-[#434959] hover:bg-[#383d4a]'
            }`}
            title="Alternar entre Ruteo de Cañería (Route Pipe) y Órbita 3D"
          >
            <span>{cameraMode === 'ROUTE_MODE' ? '🔧' : '🔄'}</span>
            <span className="hidden sm:inline">
              {cameraMode === 'ROUTE_MODE' ? 'Route Pipe' : 'Órbita 3D'}
            </span>
          </button>

          {/* Botón Tool Palette (Paleta de Accesorios Plant 3D) */}
          <button
            type="button"
            onClick={() => {
              if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                try {
                  navigator.vibrate(15);
                } catch {
                  // Ignorar
                }
              }
              toggleToolPalette();
            }}
            className="h-9 px-2.5 rounded bg-[#2f333d] hover:bg-[#3a3f4d] border border-amber-500/60 text-amber-300 font-bold text-xs flex items-center space-x-1.5 active:scale-95 transition-all shadow-sm"
            title="Abrir Tool Palette de Accesorios (Codos, Tes, Bridas, Válvulas)"
          >
            <span>🧰</span>
            <span>Tool Palette</span>
          </button>
        </div>

        {/* Grupo Derecho: Undo, Redo, Zoom Extents, Data Manager (BOM) e Iso/DXF */}
        <div className="flex items-center space-x-1 shrink-0">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className={`w-8 h-9 rounded border text-xs flex items-center justify-center transition-all ${
              canUndo
                ? 'bg-[#2f333d] border-[#434959] text-slate-100 hover:border-[#0696d7] active:bg-slate-700'
                : 'bg-[#1b1e24] border-[#2c303a] text-slate-600 cursor-not-allowed'
            }`}
            title="Deshacer (UNDO)"
          >
            ↩
          </button>

          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className={`w-8 h-9 rounded border text-xs flex items-center justify-center transition-all ${
              canRedo
                ? 'bg-[#2f333d] border-[#434959] text-slate-100 hover:border-[#0696d7] active:bg-slate-700'
                : 'bg-[#1b1e24] border-[#2c303a] text-slate-600 cursor-not-allowed'
            }`}
            title="Rehacer (REDO)"
          >
            ↪
          </button>

          <button
            type="button"
            onClick={frameAll}
            className="w-8 h-9 rounded bg-[#2f333d] border border-[#434959] text-xs font-bold text-slate-200 hover:border-[#0696d7] flex items-center justify-center"
            title="Zoom Extents (Encuadrar Modelo)"
          >
            ⛶
          </button>

          <button
            type="button"
            onClick={toggleBom}
            className="h-9 px-2.5 rounded bg-[#2f333d] border border-[#434959] text-xs font-bold text-slate-100 hover:border-[#0696d7] flex items-center space-x-1"
            title="Data Manager: Cómputo BOM, Juntas, Espárragos y Lista de Cortes"
          >
            <span>📋</span>
            <span className="hidden sm:inline">BOM / Cortes</span>
          </button>

          <button
            type="button"
            onClick={toggleExport}
            className="h-9 px-2.5 rounded bg-[#0696d7]/20 border border-[#0696d7] text-xs font-bold text-[#38bdf8] hover:bg-[#0696d7]/30 flex items-center space-x-1 shadow-sm"
            title="Production Iso: Exportar Plano Isométrico 2D (.DXF) e Isogen (.PCF)"
          >
            <span>📐</span>
            <span className="hidden sm:inline">Iso / DXF</span>
          </button>

          <button
            type="button"
            onClick={resetGraph}
            className="w-8 h-9 rounded bg-rose-950/40 border border-rose-800/50 text-rose-400 text-xs flex items-center justify-center hover:bg-rose-900/50"
            title="Limpiar Modelo 3D"
          >
            ↺
          </button>
        </div>
      </div>

      {/* Barra de Estado estilo Línea de Comando de AutoCAD Plant 3D */}
      {statusMessage && (
        <div className="bg-[#181a20] px-3 py-1 text-[10px] text-slate-300 font-mono border-t border-[#2c303a] flex items-center justify-between truncate">
          <div className="flex items-center space-x-1.5 truncate">
            <span className="text-[#0696d7] font-bold shrink-0">&gt;_</span>
            <span className="truncate">{statusMessage}</span>
          </div>
          <span className="text-[10px] font-mono text-amber-400 shrink-0 ml-2">
            SPEC: {specCode} • ND: {formatNd(nominalDiameter)}
          </span>
        </div>
      )}
    </header>
  );
};
