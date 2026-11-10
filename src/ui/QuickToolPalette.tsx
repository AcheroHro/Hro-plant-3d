import React from 'react';
import { usePipingStore } from '../store/usePipingStore';
import { useUiConfigStore, ToolsLayoutMode } from '../store/useUiConfigStore';
import { FloatingPalette } from './FloatingPalette';
import { usePhoneLayout } from './useIsPhone';

export const QuickToolPalette: React.FC = () => {
  const nominalDiameter = usePipingStore((s) => s.nominalDiameter);
  const specCode = usePipingStore((s) => s.specCode);
  const insertFitting = usePipingStore((s) => s.insertFitting);
  const toggleToolPalette = usePipingStore((s) => s.toggleToolPalette);

  const phone = usePhoneLayout();
  const toolsLayout = useUiConfigStore((s) => s.toolsLayout);
  const setToolsLayout = useUiConfigStore((s) => s.setToolsLayout);

  const vibrate = (ms = 12) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(ms);
      } catch {
        // Ignore
      }
    }
  };

  const cycleLayout = (e: React.MouseEvent) => {
    e.stopPropagation();
    vibrate(10);
    const order: ToolsLayoutMode[] = ['1col', '2col', 'horiz'];
    const next = order[(order.indexOf(toolsLayout) + 1) % order.length];
    setToolsLayout(next);
  };

  const gridClass =
    toolsLayout === 'horiz'
      ? 'flex flex-row items-center gap-1 overflow-x-auto max-w-[85vw] py-1 px-1.5'
      : toolsLayout === '2col'
      ? 'grid grid-cols-2 gap-1 p-1.5 w-32'
      : 'flex flex-col items-center gap-1 p-1.5 w-16 sm:w-[70px] max-h-[72vh] overflow-y-auto';

  const btnBase =
    'py-1.5 px-1 rounded bg-[#212631] hover:bg-[#0696d7]/25 border border-[#343c4c] hover:border-[#38bdf8] flex flex-col items-center justify-center text-slate-200 active:scale-95 transition-all shrink-0 min-w-[48px]';

  return (
    <FloatingPalette
      paletteId="tools"
      title={toolsLayout === '1col' ? 'Piezas' : 'Paleta de Accesorios'}
      badge={
        <span className="px-1 py-0.2 rounded bg-[#0696d7]/20 border border-[#38bdf8]/40 text-[8px] font-mono font-bold text-[#38bdf8]">
          {nominalDiameter}&quot;
        </span>
      }
      sheetBodyClassName="grid grid-cols-5 landscape:grid-cols-3 gap-2 p-3 w-full [&>button]:min-h-[60px] [&>button]:min-w-0 [&>button]:rounded-xl [&_span]:text-[11px] [&_svg]:w-7 [&_svg]:h-6"
      headerActions={
        phone ? undefined : <button
          type="button"
          onClick={cycleLayout}
          className="w-5 h-5 rounded bg-[#262c3a] hover:bg-[#343c4e] border border-[#3a4254] text-amber-300 flex items-center justify-center text-[9px] font-mono font-bold active:scale-90 transition-all"
          title={`Cambiar disposición de paleta (${toolsLayout.toUpperCase()})`}
        >
          {toolsLayout === '1col' ? '1C' : toolsLayout === '2col' ? '2C' : '⇄'}
        </button>
      }
      bodyClassName={gridClass}
    >
      {/* Caño Recto (PIPE) */}
      <button
        type="button"
        onClick={() => {
          vibrate();
          insertFitting('PIPE');
        }}
        className={btnBase}
        title="Insertar tramo recto de cañería (PLANTPIPEADD)"
      >
        <svg viewBox="0 0 24 14" className="w-5 h-3.5 stroke-sky-400 fill-none" strokeWidth="2">
          <rect x="2" y="3" width="20" height="8" rx="1" />
          <line x1="2" y1="7" x2="22" y2="7" strokeDasharray="2 2" strokeWidth="1" />
        </svg>
        <span className="text-[8px] font-bold mt-0.5">Caño</span>
      </button>

      {/* Codo 90° */}
      <button
        type="button"
        onClick={() => {
          vibrate();
          insertFitting('ELBOW', { angle: 90 });
        }}
        className={btnBase}
        title="Insertar Codo 90° LR Serie 150"
      >
        <svg viewBox="0 0 20 20" className="w-4 h-3.5 stroke-emerald-400 fill-none" strokeWidth="2.4">
          <path d="M4 16 L4 10 A6 6 0 0 1 10 4 L16 4" />
        </svg>
        <span className="text-[8px] font-bold mt-0.5">Codo 90°</span>
      </button>

      {/* Codo 45° */}
      <button
        type="button"
        onClick={() => {
          vibrate();
          insertFitting('ELBOW', { angle: 45 });
        }}
        className={btnBase}
        title="Insertar Codo 45° LR"
      >
        <svg viewBox="0 0 20 20" className="w-4 h-3.5 stroke-emerald-300 fill-none" strokeWidth="2.4">
          <path d="M3 15 L10 15 L17 6" />
        </svg>
        <span className="text-[8px] font-bold mt-0.5">Codo 45°</span>
      </button>

      {/* Te (Continuar Línea) */}
      <button
        type="button"
        onClick={() => {
          vibrate(18);
          insertFitting('TEE', { continueOnBranch: false });
        }}
        className="py-1.5 px-1 rounded bg-[#1b324f] hover:bg-[#0696d7]/40 border border-[#38bdf8]/60 flex flex-col items-center justify-center text-sky-200 active:scale-95 transition-all shrink-0 min-w-[48px]"
        title="Insertar Te Igual (Continuar por Línea Principal)"
      >
        <svg viewBox="0 0 22 18" className="w-4 h-3.5 stroke-sky-300 fill-none" strokeWidth="2.5">
          <line x1="2" y1="12" x2="20" y2="12" />
          <line x1="11" y1="12" x2="11" y2="2" />
        </svg>
        <span className="text-[8px] font-extrabold mt-0.5 text-sky-300">Te Línea</span>
      </button>

      {/* Te (Continuar por Ramal 90°) */}
      <button
        type="button"
        onClick={() => {
          vibrate(18);
          insertFitting('TEE', { continueOnBranch: true });
        }}
        className="py-1.5 px-1 rounded bg-amber-950/60 hover:bg-amber-800/50 border border-amber-500/60 flex flex-col items-center justify-center text-amber-200 active:scale-95 transition-all shrink-0 min-w-[48px]"
        title="Insertar Te Igual y salir directamente por el Ramal a 90°"
      >
        <svg viewBox="0 0 22 18" className="w-4 h-3.5 stroke-amber-400 fill-none" strokeWidth="2.5">
          <line x1="2" y1="13" x2="20" y2="13" />
          <line x1="11" y1="13" x2="11" y2="2" />
          <polyline points="7,6 11,2 15,6" strokeWidth="2" />
        </svg>
        <span className="text-[8px] font-extrabold mt-0.5 text-amber-300">Te Ramal</span>
      </button>

      {/* Brida WN */}
      <button
        type="button"
        onClick={() => {
          vibrate();
          insertFitting('FLANGE');
        }}
        className={btnBase}
        title="Insertar Brida Welding Neck + Junta + Espárragos"
      >
        <svg viewBox="0 0 20 18" className="w-4 h-3.5 stroke-purple-300 fill-none" strokeWidth="2.2">
          <line x1="3" y1="9" x2="13" y2="9" />
          <line x1="13" y1="2" x2="13" y2="16" />
          <line x1="16" y1="2" x2="16" y2="16" />
        </svg>
        <span className="text-[8px] font-bold mt-0.5">Brida</span>
      </button>

      {/* Válvula */}
      <button
        type="button"
        onClick={() => {
          vibrate();
          insertFitting('VALVE');
        }}
        className={btnBase}
        title="Insertar Válvula Bridada + 2 Juntas + 2 Juegos de Espárragos"
      >
        <svg viewBox="0 0 22 18" className="w-4 h-3.5 stroke-rose-400 fill-none" strokeWidth="2">
          <polygon points="3,4 11,10 3,16" />
          <polygon points="19,4 11,10 19,16" />
          <line x1="11" y1="10" x2="11" y2="2" />
          <line x1="7" y1="2" x2="15" y2="2" />
        </svg>
        <span className="text-[8px] font-bold mt-0.5">Válvula</span>
      </button>

      {/* Reducción */}
      <button
        type="button"
        onClick={() => {
          vibrate();
          insertFitting('REDUCER');
        }}
        className={btnBase}
        title="Insertar Reducción Concéntrica"
      >
        <svg viewBox="0 0 22 18" className="w-4 h-3.5 stroke-cyan-300 fill-none" strokeWidth="2">
          <polygon points="3,3 19,6 19,12 3,15" />
        </svg>
        <span className="text-[8px] font-bold mt-0.5">Reducc.</span>
      </button>

      {/* Casquete / Cap */}
      <button
        type="button"
        onClick={() => {
          vibrate();
          insertFitting('CAP');
        }}
        className={btnBase}
        title="Insertar Casquete / Tapa Soldable (CAP)"
      >
        <svg viewBox="0 0 20 18" className="w-4 h-3.5 stroke-slate-300 fill-none" strokeWidth="2.2">
          <line x1="6" y1="3" x2="6" y2="15" />
          <path d="M6 3 A7 6 0 0 1 6 15" />
        </svg>
        <span className="text-[8px] font-bold mt-0.5">Tapa</span>
      </button>

      {/* Botón Catálogo Completo */}
      <button
        type="button"
        onClick={() => {
          vibrate();
          toggleToolPalette();
        }}
        className={`py-1.5 px-1 rounded bg-[#2b313d] hover:bg-[#384050] border border-amber-500/60 flex flex-col items-center justify-center text-amber-300 active:scale-95 transition-all shrink-0 min-w-[48px] ${
          toolsLayout === '2col' ? 'col-span-2' : ''
        }`}
        title={`Abrir Catálogo Completo de Especificación ${specCode} (.pspc)`}
      >
        <span className="text-[9px] font-mono font-black leading-none">{specCode}</span>
        <span className="text-[7px] font-bold mt-0.5">Catálogo</span>
      </button>
    </FloatingPalette>
  );
};
