import React, { useEffect, useMemo, useState } from 'react';
import { usePipingStore } from '../store/usePipingStore';
import { isVerticalPipe, pieceElevation, planElevation } from '../core/graph/elevation';
import { vibrate } from './useIsPhone';

/**
 * Elevación del eje de la pieza elegida: se escribe la nueva (o se sube y baja de a 50 y 100 mm)
 * y antes de aplicar se ve qué se mueve y qué caños verticales cambian de largo.
 */
export const ElevationField: React.FC<{ compact?: boolean; onApplied?: () => void }> = ({ compact = false, onApplied }) => {
  const graph = usePipingStore((s) => s.graph);
  const version = usePipingStore((s) => s.version);
  const id = usePipingStore((s) => s.selectedComponentId);
  const comp = id ? graph.components.get(id) : undefined;
  const current = comp ? Math.round(pieceElevation(comp)) : 0;
  const [text, setText] = useState('');
  useEffect(() => setText(String(current)), [id, current, version]);

  const target = Number(text);
  const plan = useMemo(
    () => (comp && Number.isFinite(target) && Math.round(target) !== current ? planElevation(graph, comp.id, target) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comp, target, current, version]
  );
  if (!comp || comp.ports.length === 0 || isVerticalPipe(comp)) return null;

  const apply = (z: number) => {
    if (!Number.isFinite(z) || Math.round(z) === current) return;
    vibrate(15);
    usePipingStore.getState().setSelectedElevation(z);
    onApplied?.();
  };
  const step = (d: number) => apply(current + d);
  const btn = compact
    ? 'h-9 px-2 rounded bg-[#232832] border border-[#3a4150] text-slate-200 font-mono font-bold text-xs active:scale-95'
    : 'px-1.5 py-1 rounded bg-[#232832] border border-[#3a4150] text-slate-300 font-mono font-bold text-[10px] active:scale-95';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className={compact ? 'text-sm text-slate-100 flex-1' : 'text-[9px] font-mono text-slate-300 shrink-0'}>Elevación de eje</span>
        <input
          type="number"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply(Number(text))}
          aria-label="Elevación del eje de la pieza en milímetros"
          className={
            compact
              ? 'w-24 h-9 px-2 rounded bg-[#0f1216] border border-[#3a4150] text-sky-300 font-mono font-bold text-sm'
              : 'w-20 px-1.5 py-0.5 rounded bg-[#111418] border border-[#3a4150] text-sky-300 font-mono font-bold text-[10px] focus:outline-none focus:border-[#38bdf8]'
          }
        />
        <button
          type="button"
          onClick={() => apply(Number(text))}
          disabled={!plan || typeof plan === 'string'}
          className={`${compact ? 'h-9 px-2 text-xs' : 'px-2 py-0.5 text-[10px]'} rounded bg-[#0696d7] hover:bg-[#0582ba] text-white font-bold disabled:opacity-40`}
        >
          Aplicar
        </button>
      </div>
      <div className="flex items-center gap-1">
        {[-100, -50, 50, 100].map((d) => (
          <button key={d} type="button" className={`${btn} flex-1`} onClick={() => step(d)} aria-label={`${d > 0 ? 'Subir' : 'Bajar'} ${Math.abs(d)} milímetros`}>
            {d > 0 ? `+${d}` : `−${-d}`}
          </button>
        ))}
      </div>
      {plan && (
        <span className={`${compact ? 'text-xs' : 'text-[9px]'} ${typeof plan === 'string' ? 'text-amber-300' : 'text-slate-400'} leading-snug`}>
          {typeof plan === 'string'
            ? plan
            : `Se ${plan.moveIds.size === 1 ? 'mueve 1 pieza' : `mueven ${plan.moveIds.size} piezas`}${
                plan.stretch.length
                  ? `; ${plan.stretch.map((s) => `caño vertical ${Math.round(s.fromMm)} → ${Math.round(s.toMm)} mm`).join(', ')}`
                  : ' (no hay caños verticales: se mueve todo lo unido)'
              }.`}
        </span>
      )}
    </div>
  );
};
