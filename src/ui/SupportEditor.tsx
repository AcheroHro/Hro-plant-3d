import React, { useEffect, useState } from 'react';
import { RotateCcw, RotateCw, X } from 'lucide-react';
import type { SupportKind } from '../types/piping';
import { usePipingStore } from '../store/usePipingStore';
import { PLANT_SUPPORT_TYPES, SUPPORT_KIND_NAMES, supportFrame } from '../core/graph/supportFrame';
import { usePhoneLayout, vibrate } from './useIsPhone';
import { IconBorrar, IconSoporte } from './icons/ActionIcons';

const KINDS: SupportKind[] = ['APOYO', 'GUIA', 'ANCLAJE', 'COLGANTE'];
const OTHER = '__otro__';

/**
 * Editor del soporte elegido: clase, tipo y tag de Plant 3D, altura hasta el punto de apoyo y
 * giro alrededor del caño. En el teléfono va dentro de la barra de abajo (`docked`); en
 * escritorio es un panel flotante arriba al centro.
 */
export const SupportEditor: React.FC<{ docked?: boolean }> = ({ docked = false }) => {
  const phone = usePhoneLayout();
  const supportId = usePipingStore((s) => s.selectedSupportId);
  const graph = usePipingStore((s) => s.graph);
  usePipingStore((s) => s.version);
  const mark = supportId ? graph.supports.get(supportId) : undefined;
  const host = mark ? graph.supportHost(mark) : null;

  const [tag, setTag] = useState('');
  const [height, setHeight] = useState('');
  const [other, setOther] = useState('');
  const [otherOpen, setOtherOpen] = useState(false);
  const frame = mark && host ? supportFrame(mark, host) : null;
  const reach = frame ? Math.round(frame.reachMm) : 0;
  useEffect(() => {
    setTag(mark?.tag ?? '');
    setOther(mark?.plantType ?? '');
  }, [mark?.id, mark?.tag, mark?.plantType]);
  useEffect(() => setOtherOpen(false), [mark?.id]);
  useEffect(() => setHeight(String(reach)), [mark?.id, reach]);

  // En el teléfono lo muestra la barra de abajo; en escritorio, el panel flotante
  if (!mark || !host || !frame || (docked ? !phone : phone)) return null;

  const store = usePipingStore.getState;
  const update = (patch: Parameters<ReturnType<typeof store>['updateSupport']>[1]) => {
    vibrate();
    store().updateSupport(mark.id, patch);
  };
  const options = PLANT_SUPPORT_TYPES[mark.kind];
  const typeValue = !mark.plantType ? '' : options.includes(mark.plantType) ? mark.plantType : OTHER;
  const applyHeight = (value: number) => {
    if (!Number.isFinite(value) || value <= 0 || Math.round(value) === reach) return setHeight(String(reach));
    update({ heightMm: value });
  };
  const nd = host.ports[0]?.nominalDiameter ?? mark.nominalDiameter;
  const vertical = frame.direction === 'UP' || frame.direction === 'DOWN';
  const field = 'h-11 rounded-xl bg-[#111419] border border-[#343b48] px-2.5 text-sm font-bold text-slate-100 outline-none min-w-0';
  const small = 'h-11 rounded-xl bg-[#212631] border border-[#343c4c] text-sm font-bold text-slate-100 active:bg-[#2b3240] flex items-center justify-center gap-1.5';

  const body = (
    <>
      <div className="flex items-center gap-2.5 pl-3 pr-2 py-2 border-b border-[#2b313d] bg-yellow-500/10 rounded-t-2xl shrink-0">
        <IconSoporte size={26} className="text-yellow-300 shrink-0" />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[15px] font-bold text-slate-100 leading-tight truncate">
            {SUPPORT_KIND_NAMES[mark.kind]}
            {mark.tag ? ` ${mark.tag}` : ''}
          </span>
          <span className="text-xs text-slate-400 leading-tight truncate">
            En caño {nd}", eje a EL {Math.round(mark.position.z)} mm
          </span>
        </div>
        <button
          type="button"
          aria-label="Soltar el soporte"
          onClick={() => {
            vibrate();
            store().setSelectedSupportId(null);
          }}
          className="w-11 h-11 rounded-xl text-slate-300 active:bg-slate-700 flex items-center justify-center shrink-0"
        >
          <X size={22} />
        </button>
      </div>

      <div className="overflow-y-auto overscroll-contain p-3 flex flex-col gap-3" style={{ touchAction: 'pan-y' }}>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Clase de soporte">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={mark.kind === k}
              onClick={() => mark.kind !== k && update({ kind: k, plantType: '' })}
              className={`h-10 rounded-lg border text-xs font-bold ${
                mark.kind === k ? 'bg-yellow-400 text-black border-yellow-200' : 'bg-[#212631] border-[#343c4c] text-slate-200'
              }`}
            >
              {SUPPORT_KIND_NAMES[k]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-xs text-slate-400">Tipo en Plant 3D</span>
            <select
              value={otherOpen ? OTHER : typeValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === OTHER) {
                  setOtherOpen(true);
                  setOther(mark.plantType && !options.includes(mark.plantType) ? mark.plantType : '');
                } else {
                  setOtherOpen(false);
                  update({ plantType: v });
                }
              }}
              className={field}
            >
              <option value="">Sin elegir</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
              <option value={OTHER}>Otro (escribir)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-xs text-slate-400">Tag</span>
            <input
              value={tag}
              placeholder="PS-101"
              onChange={(e) => setTag(e.target.value)}
              onBlur={() => tag !== (mark.tag ?? '') && update({ tag })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className={`${field} text-amber-300`}
            />
          </label>
        </div>

        {typeValue === OTHER || otherOpen ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Nombre exacto en la spec de soportes del proyecto</span>
            <input
              value={other}
              placeholder="Por ejemplo: Trunnion"
              onChange={(e) => setOther(e.target.value)}
              onBlur={() => other !== (mark.plantType ?? '') && update({ plantType: other })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className={field}
            />
          </label>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor="support-height" className="text-xs text-slate-400">
            Altura: del eje del caño al punto de apoyo
          </label>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Bajar 50 milímetros" onClick={() => applyHeight(reach - 50)} className={`${small} w-12`}>
              −
            </button>
            <input
              id="support-height"
              inputMode="numeric"
              value={height}
              onChange={(e) => setHeight(e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={() => applyHeight(Number(height))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className={`${field} flex-1 text-center text-lg tabular-nums border-2 border-yellow-500/70`}
            />
            <button type="button" aria-label="Subir 50 milímetros" onClick={() => applyHeight(reach + 50)} className={`${small} w-12`}>
              +
            </button>
            <span className="text-sm text-slate-400">mm</span>
          </div>
          <span className="text-xs text-slate-400">
            {vertical ? `Punto de apoyo a EL ${Math.round(frame.point.z)} mm` : `Apoya de costado, hacia ${frame.direction === 'NORTH' ? '+Y' : frame.direction === 'SOUTH' ? '−Y' : frame.direction === 'EAST' ? '+X' : '−X'}`}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => update({ rotationDeg: (mark.rotationDeg ?? 0) - 90 })} className={`${small} flex-1`}>
            <RotateCcw size={18} />
            Girar −90°
          </button>
          <button type="button" onClick={() => update({ rotationDeg: (mark.rotationDeg ?? 0) + 90 })} className={`${small} flex-1`}>
            <RotateCw size={18} />
            Girar +90°
          </button>
          <button
            type="button"
            onClick={() => {
              vibrate();
              store().removeSupport(mark.id);
            }}
            className={`${small} px-3 text-rose-300`}
          >
            <IconBorrar size={18} />
            Borrar
          </button>
        </div>
        <p className="text-xs text-slate-400 -mt-1">
          Girado {mark.rotationDeg ?? 0}° alrededor del caño. El tipo y el tag salen en el PCF de isométricos y en el informe.
        </p>
      </div>
    </>
  );

  if (docked) return body;
  return (
    <section
      aria-label="Soporte elegido"
      className="fixed z-40 top-[96px] left-1/2 -translate-x-1/2 w-[380px] max-h-[70vh] flex flex-col bg-[#161a22]/97 backdrop-blur-xl border border-[#323946] rounded-2xl shadow-2xl pointer-events-auto"
    >
      {body}
    </section>
  );
};
