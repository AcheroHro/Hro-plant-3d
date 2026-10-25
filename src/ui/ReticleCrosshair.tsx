import React from 'react';
import { usePipingStore } from '../store/usePipingStore';

export const ReticleCrosshair: React.FC = () => {
  const snappedPortId = usePipingStore((s) => s.snappedPortId);
  const cameraMode = usePipingStore((s) => s.cameraMode);

  // Solo mostrar la retícula activa en modo Ruteo o cuando hay un puerto anclado
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
      <div className="relative flex items-center justify-center">
        {/* Línea horizontal del crosshair */}
        <div
          className={`w-8 h-[1.5px] ${
            snappedPortId ? 'bg-cad-accent shadow-lg shadow-cad-accent' : 'bg-slate-400/60'
          }`}
        />
        {/* Línea vertical del crosshair */}
        <div
          className={`absolute h-8 w-[1.5px] ${
            snappedPortId ? 'bg-cad-accent shadow-lg shadow-cad-accent' : 'bg-slate-400/60'
          }`}
        />

        {/* Anillo de snap magnético central */}
        <div
          className={`absolute w-9 h-9 rounded-full border-2 transition-all duration-150 ${
            snappedPortId
              ? 'border-cad-accent bg-cad-accent/20 scale-125 animate-pulse'
              : cameraMode === 'ROUTE_MODE'
              ? 'border-slate-400/40'
              : 'border-transparent'
          }`}
        />

        {/* Etiqueta de aviso de anclaje magnético */}
        {snappedPortId && (
          <div className="absolute top-7 px-2 py-0.5 rounded bg-cad-accent text-cad-dark font-mono font-black text-[10px] whitespace-nowrap tracking-wider shadow-lg">
            PUERTO ANCLADO &lt;35px
          </div>
        )}
      </div>
    </div>
  );
};
