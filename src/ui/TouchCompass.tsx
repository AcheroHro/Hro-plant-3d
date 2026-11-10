import React from 'react';
import * as THREE from 'three';
import { Box, Maximize, Ruler } from 'lucide-react';
import { usePipingStore, lineOf } from '../store/usePipingStore';
import { FloatingPalette } from './FloatingPalette';

export const TouchCompass: React.FC = () => {
  const activeDirection = usePipingStore((s) => s.activeDirection);
  const setActiveDirection = usePipingStore((s) => s.setActiveDirection);
  const setCameraViewPreset = usePipingStore((s) => s.setCameraViewPreset);
  const graph = usePipingStore((s) => s.graph);
  usePipingStore((s) => s.version);
  const isolation = usePipingStore((s) => s.isolation);
  const measureActive = usePipingStore((s) => s.measureActive);
  const measurePoints = usePipingStore((s) => s.measurePoints);
  const sectionBox = usePipingStore((s) => s.sectionBox);
  const store = usePipingStore.getState;

  // Líneas presentes en el modelo, para aislar una
  const lines = Array.from(new Set(Array.from(graph.components.values(), (c) => lineOf(graph, c)).filter(Boolean))).sort();
  const isolationValue = !isolation ? '' : isolation.kind === 'line' ? `line:${isolation.line}` : 'run';
  const toggle = (on: boolean) =>
    `flex-1 min-w-0 py-1.5 rounded border text-[9px] font-bold flex flex-col items-center gap-0.5 active:scale-95 transition-all ${
      on ? 'bg-amber-500 text-black border-amber-200' : 'bg-[#252a34] text-slate-200 border-[#3a4150]'
    }`;
  const small = 'flex-1 min-w-0 rounded bg-[#252a34] border border-[#3a4150] text-[10px] font-mono font-bold text-slate-200 active:scale-95';

  const handleAxisSelect = (x: number, y: number, z: number) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(10);
      } catch {
        // Ignorar si el navegador no permite
      }
    }
    setActiveDirection(new THREE.Vector3(x, y, z));
  };

  const isCurrent = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).normalize();
    return (
      Math.abs(v.x - activeDirection.x) < 0.05 &&
      Math.abs(v.y - activeDirection.y) < 0.05 &&
      Math.abs(v.z - activeDirection.z) < 0.05
    );
  };

  const getActiveLabel = () => {
    if (isCurrent(1, 0, 0)) return '+X';
    if (isCurrent(-1, 0, 0)) return '-X';
    if (isCurrent(0, 1, 0)) return '+Y';
    if (isCurrent(0, -1, 0)) return '-Y';
    if (isCurrent(0, 0, 1)) return '+Z';
    if (isCurrent(0, 0, -1)) return '-Z';
    return `[${activeDirection.x.toFixed(1)},${activeDirection.y.toFixed(1)}]`;
  };

  return (
    <FloatingPalette
      paletteId="compass"
      title="Vistas y dirección"
      icon="🧊"
      badge={
        <span className="px-1.5 py-0.2 rounded bg-[#0696d7]/20 border border-[#38bdf8]/40 text-[#38bdf8] font-mono font-black text-[9px]">
          {getActiveLabel()}
        </span>
      }
      bodyClassName="p-2 flex flex-col items-center w-36"
      sheetBodyClassName="p-3 flex flex-col items-center w-full max-w-[20rem] mx-auto [&_button]:min-h-[44px] [&_button]:text-xs [&_span]:text-[11px]"
    >
      {/* Ayudas de vista: encuadrar, medir, aislar una línea y caja de corte */}
      <div className="w-full space-y-1.5 mb-1.5 pb-1.5 border-b border-[#2e3440]">
        <div className="flex gap-1 w-full">
          <button type="button" className={toggle(false)} onClick={() => store().frameAll()} title="Encuadrar todo el modelo">
            <Maximize size={14} />
            Encuadrar
          </button>
          <button
            type="button"
            className={toggle(measureActive)}
            aria-pressed={measureActive}
            onClick={() => store().toggleMeasure()}
            title="Medir entre dos puntos tocando el modelo"
          >
            <Ruler size={14} />
            Medir
          </button>
          <button
            type="button"
            className={toggle(!!sectionBox)}
            aria-pressed={!!sectionBox}
            onClick={() => (sectionBox ? store().clearSection() : store().setSectionAround(1000))}
            title="Caja de corte: dibuja solo lo que está cerca de la pieza elegida"
          >
            <Box size={14} />
            Corte
          </button>
        </div>

        {measureActive && (
          <div className="text-[10px] leading-snug text-fuchsia-200">
            {measurePoints.length === 2
              ? `${Math.round(measurePoints[0].distanceTo(measurePoints[1]))} mm. Tocá otro punto para medir de nuevo.`
              : measurePoints.length === 1
                ? 'Tocá el segundo punto.'
                : 'Tocá dos puntos del modelo: se pega a bocas y ejes.'}
          </div>
        )}

        <select
          value={isolationValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') store().clearIsolation();
            else if (v.startsWith('line:')) store().isolateLine(v.slice(5));
          }}
          className={`w-full min-h-[32px] px-1.5 rounded border text-[10px] font-mono font-bold ${
            isolation ? 'bg-amber-500/20 border-amber-400 text-amber-100' : 'bg-[#1b1f26] border-[#3a4150] text-slate-200'
          }`}
          aria-label="Aislar una línea"
        >
          <option value="">Ver todo el modelo</option>
          {isolation?.kind === 'run' && <option value="run">Solo el tramo conectado ({isolation.ids.length})</option>}
          {lines.map((l) => (
            <option key={l} value={`line:${l}`}>
              Solo línea {l}
            </option>
          ))}
        </select>

        {sectionBox && (
          <div className="space-y-1">
            <div className="flex gap-1 items-stretch">
              {[500, 1000, 2000].map((m) => (
                <button key={m} type="button" className={`${small} py-1`} onClick={() => store().setSectionAround(m)} title={`Caja a ${m} mm de la pieza elegida`}>
                  {m / 1000} m
                </button>
              ))}
            </div>
            {(['X', 'Y', 'Z'] as const).map((name, axis) => (
              <div key={name} className="flex gap-1 items-stretch">
                {(['min', 'max'] as const).map((side) => (
                  <React.Fragment key={side}>
                    <span className="w-5 self-center text-[10px] font-mono font-bold text-amber-200">
                      {name}
                      {side === 'min' ? '−' : '+'}
                    </span>
                    <button
                      type="button"
                      className={small}
                      onClick={() => store().nudgeSection(axis as 0 | 1 | 2, side, side === 'min' ? 250 : -250)}
                      aria-label={`Achicar la caja de corte en ${name}${side === 'min' ? '−' : '+'}`}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className={small}
                      onClick={() => store().nudgeSection(axis as 0 | 1 | 2, side, side === 'min' ? -250 : 250)}
                      aria-label={`Agrandar la caja de corte en ${name}${side === 'min' ? '−' : '+'}`}
                    >
                      +
                    </button>
                  </React.Fragment>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Vistas de Cámara Estilo AutoCAD ViewCube (TOP / FRONT / RIGHT / ISO) */}
      <div className="grid grid-cols-4 gap-1 w-full mb-1.5 pb-1.5 border-b border-[#2e3440]">
        {(['TOP', 'FRONT', 'RIGHT', 'ISO'] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setCameraViewPreset(view)}
            className="py-1 rounded bg-[#252a34] hover:bg-[#0696d7] text-[8px] font-mono font-extrabold text-slate-200 hover:text-white border border-[#3a4150] active:scale-95 transition-all"
            title={`Vista de cámara ${view}`}
          >
            {view}
          </button>
        ))}
      </div>

      <span className="text-[8px] font-mono text-slate-400 mb-1 uppercase tracking-wider">
        Dirección de Trazado:
      </span>

      {/* Grid del compás plano XY (Horizontal) */}
      <div className="grid grid-cols-3 gap-1 mb-1.5 w-full">
        <button
          type="button"
          onClick={() => handleAxisSelect(-1, 1, 0)}
          className={`h-8 rounded text-[10px] font-bold transition-all border flex items-center justify-center ${
            isCurrent(-1, 1, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-slate-300 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="Noroeste (+45°)"
        >
          NO
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(0, 1, 0)}
          className={`h-8 rounded text-[10px] font-extrabold transition-all border flex items-center justify-center ${
            isCurrent(0, 1, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-emerald-400 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="+Y (Norte)"
        >
          +Y
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(1, 1, 0)}
          className={`h-8 rounded text-[10px] font-bold transition-all border flex items-center justify-center ${
            isCurrent(1, 1, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-slate-300 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="Noreste (+45°)"
        >
          NE
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(-1, 0, 0)}
          className={`h-8 rounded text-[10px] font-extrabold transition-all border flex items-center justify-center ${
            isCurrent(-1, 0, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-amber-400 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="-X (Oeste)"
        >
          -X
        </button>

        <div className="h-8 flex items-center justify-center text-[8px] text-slate-400 font-mono border border-[#2e3440] rounded bg-[#14171d]">
          WCS
        </div>

        <button
          type="button"
          onClick={() => handleAxisSelect(1, 0, 0)}
          className={`h-8 rounded text-[10px] font-extrabold transition-all border flex items-center justify-center ${
            isCurrent(1, 0, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-amber-400 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="+X (Este)"
        >
          +X
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(-1, -1, 0)}
          className={`h-8 rounded text-[10px] font-bold transition-all border flex items-center justify-center ${
            isCurrent(-1, -1, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-slate-300 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="Sudoeste (-45°)"
        >
          SO
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(0, -1, 0)}
          className={`h-8 rounded text-[10px] font-extrabold transition-all border flex items-center justify-center ${
            isCurrent(0, -1, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-emerald-400 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="-Y (Sur)"
        >
          -Y
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(1, -1, 0)}
          className={`h-8 rounded text-[10px] font-bold transition-all border flex items-center justify-center ${
            isCurrent(1, -1, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-slate-300 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="Sudeste (-45°)"
        >
          SE
        </button>
      </div>

      {/* Controles de Elevación Vertical Z-Up */}
      <div className="flex w-full space-x-1 pt-1 border-t border-[#2e3440]">
        <button
          type="button"
          onClick={() => handleAxisSelect(0, 0, 1)}
          className={`flex-1 h-8 rounded text-[10px] font-extrabold transition-all border flex items-center justify-center space-x-0.5 ${
            isCurrent(0, 0, 1)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-sky-400 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="Subir cota (+Z Elevación)"
        >
          <span>▲</span>
          <span>+Z</span>
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(0, 0, -1)}
          className={`flex-1 h-8 rounded text-[10px] font-extrabold transition-all border flex items-center justify-center space-x-0.5 ${
            isCurrent(0, 0, -1)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-sky-400 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="Bajar cota (-Z Nivel)"
        >
          <span>▼</span>
          <span>-Z</span>
        </button>
      </div>
    </FloatingPalette>
  );
};
