import React from 'react';
import * as THREE from 'three';
import { usePipingStore } from '../store/usePipingStore';
import { FloatingPalette } from './FloatingPalette';

export const TouchCompass: React.FC = () => {
  const activeDirection = usePipingStore((s) => s.activeDirection);
  const setActiveDirection = usePipingStore((s) => s.setActiveDirection);
  const setCameraViewPreset = usePipingStore((s) => s.setCameraViewPreset);

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
      title="ViewCube"
      icon="🧊"
      badge={
        <span className="px-1.5 py-0.2 rounded bg-[#0696d7]/20 border border-[#38bdf8]/40 text-[#38bdf8] font-mono font-black text-[9px]">
          {getActiveLabel()}
        </span>
      }
      bodyClassName="p-2 flex flex-col items-center w-36"
    >
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
