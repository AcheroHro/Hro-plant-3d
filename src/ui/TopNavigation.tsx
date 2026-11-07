import React, { useRef } from 'react';
import { usePipingStore } from '../store/usePipingStore';
import { useUiConfigStore } from '../store/useUiConfigStore';
import { useProjectStore } from '../store/useProjectStore';
import { PcfExporter } from '../core/exporters/PcfExporter';
import { downloadFile } from '../utils/fileDownloader';

const BUILT_IN_SPECS = ['RCI1', 'CS150', 'CS300', 'SS150'];

export const TopNavigation: React.FC = () => {
  const cameraMode = usePipingStore((s) => s.cameraMode);
  const setCameraMode = usePipingStore((s) => s.setCameraMode);
  const nominalDiameter = usePipingStore((s) => s.nominalDiameter);
  const setNominalDiameter = usePipingStore((s) => s.setNominalDiameter);
  const lineNumber = usePipingStore((s) => s.lineNumber);
  const setLineNumber = usePipingStore((s) => s.setLineNumber);
  const selectedComponentId = usePipingStore((s) => s.selectedComponentId);
  const canUndo = usePipingStore((s) => s.canUndo);
  const canRedo = usePipingStore((s) => s.canRedo);
  const undo = usePipingStore((s) => s.undo);
  const redo = usePipingStore((s) => s.redo);
  const frameAll = usePipingStore((s) => s.frameAll);
  const toggleBom = usePipingStore((s) => s.toggleBom);
  const toggleSpools = usePipingStore((s) => s.toggleSpools);
  const toggleExport = usePipingStore((s) => s.toggleExport);
  const resetGraph = usePipingStore((s) => s.resetGraph);
  const statusMessage = usePipingStore((s) => s.statusMessage);
  const specReader = usePipingStore((s) => s.specReader);
  const specCode = usePipingStore((s) => s.specCode);
  const graph = usePipingStore((s) => s.graph);
  const loadSpecFiles = usePipingStore((s) => s.loadSpecFiles);
  const loadBuiltInSpec = usePipingStore((s) => s.loadBuiltInSpec);
  const projectName = useProjectStore((s) => s.projectName);
  const toggleProjects = useProjectStore((s) => s.toggleProjects);
  const toggleField = useProjectStore((s) => s.toggleField);
  const importFiles = useProjectStore((s) => s.importFiles);
  const noteCount = useProjectStore((s) => s.notes.length);

  const palettes = useUiConfigStore((s) => s.palettes);
  const togglePaletteOpen = useUiConfigStore((s) => s.togglePaletteOpen);
  const togglePaletteCollapsed = useUiConfigStore((s) => s.togglePaletteCollapsed);
  const resetWorkspaceLayout = useUiConfigStore((s) => s.resetWorkspaceLayout);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pcfInputRef = useRef<HTMLInputElement>(null);

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

  const handlePropertiesRibbonClick = () => {
    if (!palettes.properties.isOpen) {
      togglePaletteOpen('properties', true);
    }
    if (!selectedComponentId) {
      togglePaletteCollapsed('properties', true);
      usePipingStore.setState({
        statusMessage:
          'Seleccione una pieza en el visor 3D y presione "Propiedades" para desplegar sus datos.'
      });
      return;
    }
    togglePaletteCollapsed('properties', !palettes.properties.isCollapsed);
  };

  // Spec de Plant: la .pspc (o .pcat) junto con su .pspx y, si está, el DefaultConnectorsConfig.xml del proyecto
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    await loadSpecFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePcfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (pcfInputRef.current) pcfInputRef.current.value = '';
    if (!files.length) return;
    // Cada PCF abre un proyecto nuevo y queda como base para registrar los cambios de campo
    await importFiles(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
  };

  const handleQuickExportPcf = () => {
    if (graph.components.size === 0) {
      usePipingStore.setState({
        statusMessage: 'No hay componentes en el modelo 3D para exportar a .PCF.'
      });
      return;
    }
    const refName = (lineNumber || `100-${specCode}-${nominalDiameter}"`).trim();
    const safeFileName = refName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const pcfContent = PcfExporter.exportToPcf(graph, {
      pipelineReference: refName,
      projectIdentifier: 'ACHERO_PLANT_3D'
    });
    downloadFile(`${safeFileName}.pcf`, pcfContent, 'text/plain');
    usePipingStore.setState({
      statusMessage: `PCF para Plant 3D exportado: ${safeFileName}.pcf (${graph.components.size} piezas). Cargalo con PCF to Pipe.`
    });
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

  const isPropsUnfolded =
    palettes.properties.isOpen && Boolean(selectedComponentId) && !palettes.properties.isCollapsed;

  return (
    <header className="absolute top-0 left-0 right-0 z-30 flex flex-col bg-[#1b1f26]/98 backdrop-blur-md border-b border-[#343b48] shadow-xl select-none">
      {/* Cinta superior de pestañas + Conmutadores de Paletas Flotantes */}
      <div className="h-6 px-2.5 bg-[#13161b] border-b border-[#292e39] flex items-center justify-between text-[10px] overflow-x-auto no-scrollbar gap-2">
        <div className="flex items-center space-x-2.5 shrink-0">
          <div className="flex items-center space-x-1.5">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-[#d93831] text-white font-black text-[9px] tracking-tighter shadow-sm">
              P3D
            </span>
            <span className="font-bold text-slate-200 tracking-wide">
              Achero Plant 3D <span className="text-[#0696d7] hidden sm:inline">• CAD Field</span>
            </span>
          </div>
          <div className="hidden md:flex items-center space-x-1 text-[10px]">
            <span className="px-2 py-0.5 bg-[#232832] text-[#38bdf8] font-bold rounded-t border-t border-x border-[#343b48]">
              Home
            </span>
            <span
              className="px-2 py-0.5 text-slate-400 hover:text-slate-200 cursor-pointer"
              onClick={toggleBom}
            >
              Lista de Cortes / BOM
            </span>
            <span className="px-2 py-0.5 text-slate-400 hover:text-slate-200 cursor-pointer" onClick={toggleSpools}>
              Spools
            </span>
            <span
              className="px-2 py-0.5 text-slate-400 hover:text-slate-200 cursor-pointer"
              onClick={toggleExport}
            >
              Isos (PCF / DXF)
            </span>
          </div>
        </div>

        {/* Barra de Ventanas / Paletas Flotantes (Permite mostrar, ocultar o restaurar cualquier paleta) */}
        <div className="flex items-center space-x-1 shrink-0 font-mono text-[9px]">
          <span className="text-slate-500 hidden sm:inline mr-0.5">Paletas:</span>

          <button
            type="button"
            onClick={() => togglePaletteOpen('tools')}
            className={`px-1.5 py-0.5 rounded border transition-all ${
              palettes.tools.isOpen
                ? 'bg-[#232832] text-sky-300 border-[#38bdf8]/50 font-bold'
                : 'bg-[#161920] text-slate-500 border-[#292e39] hover:text-slate-300'
            }`}
            title="Mostrar / Ocultar Paleta de Piezas"
          >
            🧰 Piezas
          </button>

          <button
            type="button"
            onClick={handlePropertiesRibbonClick}
            className={`px-1.5 py-0.5 rounded border transition-all ${
              isPropsUnfolded
                ? 'bg-[#0696d7] text-white border-[#38bdf8] font-extrabold'
                : palettes.properties.isOpen && selectedComponentId
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 font-bold'
                : palettes.properties.isOpen
                ? 'bg-[#232832] text-slate-300 border-[#38bdf8]/40'
                : 'bg-[#161920] text-slate-500 border-[#292e39] hover:text-slate-300'
            }`}
            title="Desplegar / Plegar Paleta de Propiedades de la pieza seleccionada"
          >
            📋 Propiedades
          </button>

          <button
            type="button"
            onClick={() => togglePaletteOpen('compass')}
            className={`px-1.5 py-0.5 rounded border transition-all ${
              palettes.compass.isOpen
                ? 'bg-[#232832] text-sky-300 border-[#38bdf8]/50 font-bold'
                : 'bg-[#161920] text-slate-500 border-[#292e39] hover:text-slate-300'
            }`}
            title="Mostrar / Ocultar ViewCube 3D"
          >
            🧊 ViewCube
          </button>

          <button
            type="button"
            onClick={() => togglePaletteOpen('numpad')}
            className={`px-1.5 py-0.5 rounded border transition-all ${
              palettes.numpad.isOpen
                ? 'bg-[#232832] text-sky-300 border-[#38bdf8]/50 font-bold'
                : 'bg-[#161920] text-slate-500 border-[#292e39] hover:text-slate-300'
            }`}
            title="Mostrar / Ocultar Línea de Comando / Trazado"
          >
            ⌨ Comando
          </button>

          <button
            type="button"
            onClick={resetWorkspaceLayout}
            className="px-1.5 py-0.5 rounded bg-[#1d222c] hover:bg-[#2b3240] text-amber-300 border border-[#343b48] font-bold"
            title="Restaurar posición y visibilidad de todas las paletas"
          >
            ⊞ Reset Vista
          </button>
        </div>
      </div>

      {/* Ribbon Principal de Herramientas (Line Number + Spec + Size + Import/Export) */}
      <div className="h-12 px-2.5 flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar bg-[#222731]">
        {/* Inputs ocultos para cargar archivos .pspc y .pcf */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pspc,.pspx,.pcat,.xml"
          multiple
          onChange={handleFileUpload}
          className="hidden"
        />
        <input
          ref={pcfInputRef}
          type="file"
          accept=".pcf,.txt,.achero"
          multiple
          onChange={handlePcfUpload}
          className="hidden"
        />

        {/* Grupo Ribbon: Proyecto + Line Number + Spec Selector + Size Selector */}
        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={toggleProjects}
            className="h-9 max-w-[9rem] flex flex-col items-start justify-center bg-[#161920] border border-[#0696d7]/60 hover:border-[#38bdf8] rounded px-1.5"
            title="Proyectos guardados en este equipo"
          >
            <span className="text-[7px] uppercase text-slate-400 font-bold leading-none mb-0.5">Proyecto ▾</span>
            <span className="text-[11px] font-bold text-slate-100 leading-tight truncate max-w-full">{projectName}</span>
          </button>
          <button
            type="button"
            onClick={toggleField}
            className="h-9 px-2.5 rounded bg-orange-600/20 border border-orange-500/70 text-[11px] font-bold text-orange-300 hover:bg-orange-600/30"
            title="Cambios respecto del PCF de Plant, notas con fotos e informe de campo"
          >
            Campo{noteCount ? ` · ${noteCount}` : ""}
          </button>
          {/* Selector / Editor de Line Number (como Plant 3D Route Pipe) */}
          <div className="flex flex-col bg-[#161920] border border-[#343b48] rounded px-1.5 py-0.5">
            <span className="text-[7px] uppercase text-slate-400 font-bold leading-none mb-0.5">
              Line Number
            </span>
            <input
              type="text"
              value={lineNumber}
              onChange={(e) => setLineNumber(e.target.value)}
              className="w-24 sm:w-28 bg-transparent text-[11px] font-mono font-bold text-amber-300 outline-none leading-tight"
              title="Número de Línea (Line Number de AutoCAD Plant 3D)"
            />
          </div>

          {/* Selector de Spec Oficial (RCI1, CS150, CS300, SS150) */}
          <div className="flex flex-col bg-[#161920] border border-[#343b48] rounded px-1.5 py-0.5">
            <span className="text-[7px] uppercase text-slate-400 font-bold leading-none mb-0.5">
              Spec
            </span>
            <select
              value={specCode}
              onChange={(e) => loadBuiltInSpec(e.target.value)}
              className="bg-transparent text-[11px] font-mono font-bold text-[#38bdf8] outline-none cursor-pointer leading-tight"
              title="Seleccionar Especificación de AutoCAD Plant 3D"
            >
              {specOptions.map((sp) => (
                <option key={sp} value={sp} className="bg-[#161920] text-slate-100">
                  {sp}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de Diámetro Nominal (Size) */}
          <div className="flex flex-col bg-[#161920] border border-[#343b48] rounded px-1.5 py-0.5">
            <span className="text-[7px] uppercase text-slate-400 font-bold leading-none mb-0.5">
              Size (ND)
            </span>
            <select
              value={nominalDiameter}
              onChange={(e) => setNominalDiameter(Number(e.target.value))}
              className="bg-transparent text-[11px] font-mono font-bold text-emerald-400 outline-none cursor-pointer leading-tight"
              title="Seleccionar Diámetro Nominal (Size)"
            >
              {availableDiameters.map((d) => (
                <option key={d} value={d} className="bg-[#161920] text-slate-100">
                  {formatNd(d)}
                </option>
              ))}
            </select>
          </div>

          {/* Botón Primario en Ribbon: Desplegar Propiedades de la Pieza Seleccionada */}
          <button
            type="button"
            onClick={handlePropertiesRibbonClick}
            className={`h-9 px-2.5 rounded text-[11px] font-bold transition-all border flex items-center space-x-1 ${
              isPropsUnfolded
                ? 'bg-[#0696d7] text-white border-[#38bdf8] shadow-md shadow-[#0696d7]/30'
                : selectedComponentId
                ? 'bg-amber-500/20 text-amber-300 border-amber-400 hover:bg-amber-500/30 animate-pulse'
                : 'bg-[#2b313d] text-slate-300 border-[#3e4656] hover:border-[#0696d7]'
            }`}
            title="Desplegar o plegar la Paleta de Propiedades de la pieza seleccionada"
          >
            <span>📋</span>
            <span>Propiedades</span>
          </button>

          {/* Botón Cargar otro .pspc */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-9 px-2 rounded bg-[#2b313d] border border-[#3e4656] hover:border-[#0696d7] text-[10px] font-mono font-bold text-slate-200 flex items-center space-x-1 transition-colors"
            title="Cargar spec de Plant 3D: elegí juntos la .pspc, su .pspx y el DefaultConnectorsConfig.xml del proyecto"
          >
            <span>+SPEC</span>
          </button>

          {/* Botón Importar PCF desde la PC */}
          <button
            type="button"
            onClick={() => pcfInputRef.current?.click()}
            className="h-9 px-2 rounded bg-[#2b313d] border border-amber-500/60 hover:border-amber-400 text-[10px] font-mono font-bold text-amber-300 flex items-center space-x-1 transition-colors"
            title="Abrir archivo Isométrico .PCF exportado desde AutoCAD Plant 3D o Achero Plant 3D"
          >
            <span>📂</span>
            <span>ABRIR PCF</span>
          </button>

          {/* Botón Exportar PCF directo de la línea trazada en la App */}
          <button
            type="button"
            onClick={handleQuickExportPcf}
            disabled={graph.components.size === 0}
            className="h-9 px-2.5 rounded bg-sky-600/25 border border-sky-400/70 hover:bg-sky-600/40 hover:border-sky-300 text-[10px] font-mono font-bold text-sky-200 flex items-center space-x-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Exportar y descargar archivo .PCF estándar Isogen / AutoCAD Plant 3D del modelo actual"
          >
            <span>⬇</span>
            <span>EXPORTAR PCF</span>
          </button>

          <div className="h-7 w-[1px] bg-[#343b48] mx-0.5" />

          {/* Selector de Modo: Seguir Boca vs Órbita Libre */}
          <button
            type="button"
            onClick={handleModeToggle}
            className={`h-9 px-2.5 rounded text-[11px] font-bold transition-all border flex items-center space-x-1 ${
              cameraMode === 'ROUTE_MODE'
                ? 'bg-[#0696d7] text-white border-[#38bdf8] shadow-md shadow-[#0696d7]/30'
                : 'bg-[#2b313d] text-slate-200 border-[#3e4656] hover:bg-[#343b48]'
            }`}
            title="En Route Pipe la cámara sigue automáticamente la boca activa"
          >
            <span>{cameraMode === 'ROUTE_MODE' ? 'Route Pipe' : 'Vista Libre'}</span>
          </button>
        </div>

        {/* Grupo Derecho: Undo, Redo, Zoom Extents, Lista de Cortes y Exportar Iso/DXF */}
        <div className="flex items-center space-x-1 shrink-0">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className={`w-8 h-9 rounded border text-xs font-bold flex items-center justify-center transition-all ${
              canUndo
                ? 'bg-[#2b313d] border-[#3e4656] text-slate-100 hover:border-[#0696d7] active:bg-slate-700'
                : 'bg-[#161920] border-[#262b35] text-slate-600 cursor-not-allowed'
            }`}
            title="Deshacer (UNDO)"
          >
            ↩
          </button>

          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className={`w-8 h-9 rounded border text-xs font-bold flex items-center justify-center transition-all ${
              canRedo
                ? 'bg-[#2b313d] border-[#3e4656] text-slate-100 hover:border-[#0696d7] active:bg-slate-700'
                : 'bg-[#161920] border-[#262b35] text-slate-600 cursor-not-allowed'
            }`}
            title="Rehacer (REDO)"
          >
            ↪
          </button>

          <button
            type="button"
            onClick={frameAll}
            className="px-2 h-9 rounded bg-[#2b313d] border border-[#3e4656] text-[10px] font-mono font-bold text-slate-200 hover:border-[#0696d7] flex items-center justify-center"
            title="Zoom Extents (Encuadrar Modelo)"
          >
            EXT
          </button>

          <button
            type="button"
            onClick={toggleSpools}
            className="h-9 px-2.5 rounded bg-amber-600/20 border border-amber-500/70 text-[11px] font-bold text-amber-300 hover:bg-amber-600/30"
            title="Spools de taller: cortes, accesorios, soldaduras de taller y de campo"
          >
            Spools
          </button>

          <button
            type="button"
            onClick={toggleBom}
            className="h-9 px-2.5 rounded bg-emerald-600/20 border border-emerald-500/70 text-[11px] font-bold text-emerald-300 hover:bg-emerald-600/30 flex items-center space-x-1"
            title="Ver Lista de Cortes de Niples (Nro, Largo mm, Extremos Plano/Bisel/Roscado) y BOM"
          >
            <span>Lista de Cortes</span>
          </button>

          <button
            type="button"
            onClick={toggleExport}
            className="h-9 px-2.5 rounded bg-[#0696d7]/20 border border-[#0696d7] text-[11px] font-bold text-[#38bdf8] hover:bg-[#0696d7]/30 flex items-center space-x-1 shadow-sm"
            title="Exportar Plano Isométrico 2D (.DXF) e Isogen (.PCF)"
          >
            <span>Iso / DXF</span>
          </button>

          <button
            type="button"
            onClick={resetGraph}
            className="w-8 h-9 rounded bg-rose-950/40 border border-rose-800/50 text-rose-400 text-xs font-bold flex items-center justify-center hover:bg-rose-900/50"
            title="Reiniciar Línea 3D"
          >
            ↺
          </button>
        </div>
      </div>

      {/* Barra de Estado estilo Línea de Comando de AutoCAD Plant 3D */}
      {statusMessage && (
        <div className="bg-[#14171d] px-3 py-1 text-[10px] text-slate-300 font-mono border-t border-[#282d38] flex items-center justify-between truncate">
          <div className="flex items-center space-x-1.5 truncate">
            <span className="text-[#0696d7] font-bold shrink-0">&gt;_</span>
            <span className="truncate">{statusMessage}</span>
          </div>
          <span className="text-[10px] font-mono text-amber-400 shrink-0 ml-2">
            {lineNumber} • {specCode} • {formatNd(nominalDiameter)}
          </span>
        </div>
      )}
    </header>
  );
};
