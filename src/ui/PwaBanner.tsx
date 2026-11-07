import React, { useEffect, useState } from 'react';
import { usePwaStore } from '../pwa/pwa';

/** Avisos de la app instalada: sin conexión, versión nueva y lista para trabajar sin señal */
export const PwaBanner: React.FC = () => {
  const online = usePwaStore((s) => s.online);
  const updateReady = usePwaStore((s) => s.updateReady);
  const offlineReady = usePwaStore((s) => s.offlineReady);
  const applyUpdate = usePwaStore((s) => s.applyUpdate);
  const [showReady, setShowReady] = useState(false);

  useEffect(() => {
    if (!offlineReady) return;
    let seen = false;
    try {
      seen = localStorage.getItem('achero.offlineReadySeen') === '1';
      localStorage.setItem('achero.offlineReadySeen', '1');
    } catch {
      // sin almacenamiento
    }
    if (seen) return;
    setShowReady(true);
    const t = setTimeout(() => setShowReady(false), 6000);
    return () => clearTimeout(t);
  }, [offlineReady]);

  if (!updateReady && online && !showReady) return null;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-3 z-[60] flex flex-col items-center gap-2 pointer-events-none px-3 w-full max-w-md">
      {!online && (
        <div className="pointer-events-auto px-3 py-1.5 rounded-full bg-slate-800/95 border border-slate-600 text-[11px] text-slate-200 shadow-lg">
          Sin conexión · los cambios se guardan en este equipo
        </div>
      )}
      {showReady && (
        <div className="pointer-events-auto px-3 py-1.5 rounded-full bg-emerald-800/95 border border-emerald-500 text-[11px] text-emerald-50 shadow-lg">
          ✓ Lista para usar sin señal en obra
        </div>
      )}
      {updateReady && (
        <div className="pointer-events-auto w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#0696d7] text-white shadow-xl">
          <span className="text-xs font-bold">Hay una versión nueva de la app</span>
          <button type="button" onClick={applyUpdate} className="h-8 px-3 rounded bg-white text-[#0369a1] text-xs font-extrabold">
            Actualizar
          </button>
        </div>
      )}
    </div>
  );
};
