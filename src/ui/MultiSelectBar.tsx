import React, { useState } from 'react';
import * as THREE from 'three';
import { Copy, Move, Trash2, Waypoints, X } from 'lucide-react';
import { usePipingStore } from '../store/usePipingStore';
import { usePhoneLayout, vibrate } from './useIsPhone';

const AXES: { label: string; v: [number, number, number]; cls: string }[] = [
  { label: '+X', v: [1, 0, 0], cls: 'text-red-400' },
  { label: '−X', v: [-1, 0, 0], cls: 'text-red-400' },
  { label: '+Y', v: [0, 1, 0], cls: 'text-emerald-400' },
  { label: '−Y', v: [0, -1, 0], cls: 'text-emerald-400' },
  { label: '+Z', v: [0, 0, 1], cls: 'text-sky-400' },
  { label: '−Z', v: [0, 0, -1], cls: 'text-sky-400' }
];

/** Barra de la selección múltiple: mover, copiar o borrar varias piezas a la vez */
export const MultiSelectBar: React.FC = () => {
  const multiMode = usePipingStore((s) => s.multiMode);
  const multiSelect = usePipingStore((s) => s.multiSelect);
  const graph = usePipingStore((s) => s.graph);
  usePipingStore((s) => s.version);
  const phone = usePhoneLayout();
  const [action, setAction] = useState<'move' | 'copy' | null>(null);
  const [distance, setDistance] = useState('500');

  if (!multiMode) return null;
  const count = multiSelect.filter((id) => graph.components.has(id)).length;
  const store = usePipingStore.getState;
  const btn = 'h-11 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 active:scale-95 disabled:opacity-40';

  const apply = (v: [number, number, number]) => {
    const mm = parseFloat(distance);
    if (!(mm > 0)) return;
    vibrate(20);
    store().moveMulti(new THREE.Vector3(...v).multiplyScalar(mm), action === 'copy');
  };

  return (
    <div
      className={`fixed z-40 rounded-xl bg-[#1a1530]/95 backdrop-blur-md border border-violet-400/60 shadow-2xl p-1.5 space-y-1.5 pointer-events-auto ${
        phone === 'landscape' ? 'left-[72px] w-[330px]' : 'left-2 right-2 mx-auto max-w-xl'
      }`}
      style={{ top: phone ? 'calc(var(--mobile-top) + 8px)' : '108px' }}
    >
      <div className="flex items-center gap-1.5">
        <span className="px-2 text-sm font-black text-violet-200 whitespace-nowrap">
          {count} pieza{count === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={() => {
            vibrate();
            store().selectConnectedRun();
          }}
          disabled={!count}
          className={`${btn} bg-[#221c3d] border-violet-500/40 text-violet-200`}
          title="Sumar todas las piezas unidas a las elegidas"
        >
          <Waypoints size={16} />
          Línea entera
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            vibrate();
            setAction(null);
            store().toggleMultiMode(false);
          }}
          className="w-11 h-11 rounded-lg text-slate-200 flex items-center justify-center shrink-0 active:bg-slate-700"
          aria-label="Terminar la selección múltiple"
        >
          <X size={20} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {(['move', 'copy'] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => {
              vibrate();
              setAction(action === a ? null : a);
            }}
            disabled={!count}
            aria-pressed={action === a}
            className={`${btn} ${action === a ? 'bg-violet-500 border-violet-200 text-white' : 'bg-[#221c3d] border-violet-500/40 text-violet-200'}`}
          >
            {a === 'move' ? <Move size={16} /> : <Copy size={16} />}
            {a === 'move' ? 'Mover' : 'Copiar'}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            vibrate(20);
            store().deleteMulti();
          }}
          disabled={!count}
          className={`${btn} bg-rose-950/60 border-rose-500/50 text-rose-300`}
        >
          <Trash2 size={16} />
          Borrar
        </button>
      </div>

      {action && (
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            inputMode="decimal"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            className="h-11 w-24 min-w-0 px-2 rounded-lg bg-[#111419] border border-violet-400/60 text-base font-mono font-black text-violet-200 outline-none"
            aria-label={`Distancia para ${action === 'move' ? 'mover' : 'copiar'} en milímetros`}
          />
          <span className="text-[11px] font-mono text-slate-400">mm</span>
          <div className="flex-1 grid grid-cols-6 gap-1">
            {AXES.map(({ label, v, cls }) => (
              <button
                key={label}
                type="button"
                onClick={() => apply(v)}
                className={`h-11 rounded-lg bg-[#221c3d] border border-violet-500/40 text-xs font-mono font-black active:scale-95 ${cls}`}
                title={`${action === 'move' ? 'Mover' : 'Copiar'} hacia ${label}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
