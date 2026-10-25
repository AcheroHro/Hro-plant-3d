import React, { useState } from 'react';
import { usePipingStore } from '../store/usePipingStore';

export const TouchNumpad: React.FC = () => {
  // Compacto por defecto estilo AutoCAD Command Line para dejar libre el visor 3D
  const [isCollapsed, setIsCollapsed] = useState(true);

  const numpadValue = usePipingStore((s) => s.numpadValue);
  const setNumpadValue = usePipingStore((s) => s.setNumpadValue);
  const appendDigit = usePipingStore((s) => s.appendNumpadDigit);
  const backspace = usePipingStore((s) => s.backspaceNumpad);
  const clear = usePipingStore((s) => s.clearNumpad);
  const quickAdd = usePipingStore((s) => s.quickAddNumpad);
  const applyRouting = usePipingStore((s) => s.applyRouting);
  const activeDirection = usePipingStore((s) => s.activeDirection);
  const nominalDiameter = usePipingStore((s) => s.nominalDiameter);

  const vibrate = (ms: number = 10) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(ms);
      } catch {
        // Ignorar si el dispositivo no soporta vibración
      }
    }
  };

  const handleKey = (digit: string) => {
    vibrate(10);
    appendDigit(digit);
  };

  const handleBackspace = () => {
    vibrate(15);
    backspace();
  };

  const handleClear = () => {
    vibrate(15);
    clear();
  };

  const handleQuickAdd = (amount: number) => {
    vibrate(12);
    quickAdd(amount);
  };

  const handlePreset = (val: string) => {
    vibrate(10);
    setNumpadValue(val);
  };

  const handleApply = () => {
    vibrate(25);
    applyRouting();
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 bg-[#181b22]/96 backdrop-blur-xl border-t border-[#343b48] px-3 pt-1.5 pb-[max(8px,env(safe-area-inset-bottom))] flex flex-col items-center max-w-3xl mx-auto rounded-t-xl shadow-2xl select-none transition-all duration-200">
      {/* Barra superior de Línea de Comandos AutoCAD Plant 3D */}
      <div className="w-full flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#252a34] border border-[#3a4150] text-[10px] font-mono font-bold text-[#38bdf8] hover:bg-[#323846] transition-colors flex-shrink-0"
            title={isCollapsed ? 'Abrir Teclado Numérico Táctil' : 'Ocultar Teclado Táctil'}
          >
            <span>⌨</span>
            <span>{isCollapsed ? 'Teclado' : 'Ocultar'}</span>
          </button>

          {/* Presets rápidos de ingeniería (mm) */}
          {['250', '500', '1000', '1500', '3000'].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => handlePreset(preset)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition-all flex-shrink-0 ${
                numpadValue === preset
                  ? 'bg-[#0696d7] text-white border-[#38bdf8]'
                  : 'bg-[#222630] text-slate-300 border-[#343b48] hover:border-slate-500'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>

        <span className="hidden sm:inline text-[10px] font-mono text-slate-400 flex-shrink-0">
          Ortho: [{activeDirection.x.toFixed(0)}, {activeDirection.y.toFixed(0)}, {activeDirection.z.toFixed(0)}] • ND {nominalDiameter}&quot;
        </span>
      </div>

      {/* BARRA DE ENTRADA DINÁMICA (Command Prompt + Input + Botón Trazar) */}
      <div className="w-full flex items-center justify-between gap-2 p-1.5 bg-[#111419] rounded-lg border border-[#343b48]">
        <div className="flex items-center gap-2 flex-1 min-w-0 pl-1">
          <span className="hidden md:inline text-[11px] font-mono font-bold text-slate-400 whitespace-nowrap">
            &gt;_PLANTPIPEADD Specify length:
          </span>
          <div className="flex items-center gap-1 flex-1">
            <input
              type="number"
              value={numpadValue}
              onChange={(e) => setNumpadValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleApply();
              }}
              className="w-28 sm:w-36 px-2.5 py-1 rounded bg-[#1b1f26] border border-[#38bdf8]/60 text-xl font-mono font-black text-[#38bdf8] focus:outline-none focus:border-[#38bdf8]"
              placeholder="1000"
            />
            <span className="text-xs font-mono font-bold text-slate-400">mm</span>
          </div>
        </div>

        {/* Botones de incremento rápido */}
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => handleQuickAdd(100)}
            className="h-9 px-2 rounded bg-[#252a34] hover:bg-[#323846] border border-[#3a4150] text-[10px] font-mono font-bold text-cyan-300 active:scale-95"
          >
            +100
          </button>
          <button
            type="button"
            onClick={() => handleQuickAdd(500)}
            className="h-9 px-2 rounded bg-[#252a34] hover:bg-[#323846] border border-[#3a4150] text-[10px] font-mono font-bold text-cyan-300 active:scale-95"
          >
            +500
          </button>
        </div>

        {/* BOTÓN PRIMARIO DE TRAZAR TRAMO */}
        <button
          type="button"
          onClick={handleApply}
          className="h-9 px-3.5 rounded-lg bg-[#0696d7] hover:bg-[#0582ba] text-white font-black text-xs tracking-wide shadow-lg shadow-[#0696d7]/30 active:scale-95 transition-all flex items-center justify-center space-x-1.5 border border-[#38bdf8] flex-shrink-0"
          title="Trazar cañería o giro en la boca activa (ENTER)"
        >
          <span>📐</span>
          <span className="whitespace-nowrap">TRAZAR TRAMO</span>
        </button>
      </div>

      {/* TECLADO NUMÉRICO TÁCTIL EXPANDIBLE (Opcional para celulares) */}
      {!isCollapsed && (
        <div className="w-full grid grid-cols-4 gap-1.5 mt-2 pt-1.5 border-t border-[#2e3440]">
          {['7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => handleKey(d)}
              className="h-10 rounded-lg bg-[#252a34] text-sm font-bold text-slate-100 border border-[#383f4d] active:bg-slate-700"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleQuickAdd(100)}
            className="h-10 rounded-lg bg-slate-800 text-xs font-bold text-cyan-300 border border-cyan-900/60"
          >
            +100
          </button>

          {['4', '5', '6'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => handleKey(d)}
              className="h-10 rounded-lg bg-[#252a34] text-sm font-bold text-slate-100 border border-[#383f4d] active:bg-slate-700"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleQuickAdd(500)}
            className="h-10 rounded-lg bg-slate-800 text-xs font-bold text-cyan-300 border border-cyan-900/60"
          >
            +500
          </button>

          {['1', '2', '3'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => handleKey(d)}
              className="h-10 rounded-lg bg-[#252a34] text-sm font-bold text-slate-100 border border-[#383f4d] active:bg-slate-700"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleQuickAdd(1000)}
            className="h-10 rounded-lg bg-slate-800 text-xs font-bold text-cyan-300 border border-cyan-900/60"
          >
            +1000
          </button>

          <button
            type="button"
            onClick={handleClear}
            className="h-10 rounded-lg bg-rose-950/50 text-xs font-bold text-rose-400 border border-rose-900/60"
          >
            C
          </button>
          <button
            type="button"
            onClick={() => handleKey('0')}
            className="h-10 rounded-lg bg-[#252a34] text-sm font-bold text-slate-100 border border-[#383f4d]"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => handleKey('.')}
            className="h-10 rounded-lg bg-[#252a34] text-base font-black text-slate-300 border border-[#383f4d]"
          >
            .
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            className="h-10 rounded-lg bg-amber-950/50 text-xs font-bold text-amber-400 border border-amber-900/60"
          >
            ⌫
          </button>
        </div>
      )}
    </div>
  );
};
