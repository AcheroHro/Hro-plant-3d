import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { usePipingStore } from '../store/usePipingStore';
import { useUiConfigStore } from '../store/useUiConfigStore';
import { buildPaletteItems, findPaletteItem, PALETTE_GROUPS, PaletteItem } from '../core/specs/paletteItems';
import { PieceIcon } from './icons/PieceIcons';
import { usePhoneLayout, vibrate } from './useIsPhone';

interface PieceGridProps {
  /** `sheet`: grupos con título y botones grandes. `compact`: botones chicos, los ubica el contenedor */
  variant: 'sheet' | 'compact';
  /** Se llama después de insertar (para cerrar un diálogo, por ejemplo) */
  onInserted?: () => void;
  showRecents?: boolean;
}

const LONG_PRESS_MS = 450;

/**
 * Botones de las piezas que la spec tiene en el diámetro de la boca activa. Un toque inserta la
 * pieza que elegiría Plant; mantener apretado (o clic derecho) abre el resto de las familias.
 */
export const PieceGrid: React.FC<PieceGridProps> = ({ variant, onInserted, showRecents = variant === 'sheet' }) => {
  const specReader = usePipingStore((s) => s.specReader);
  const nominalDiameter = usePipingStore((s) => s.nominalDiameter);
  const insertFitting = usePipingStore((s) => s.insertFitting);
  const graph = usePipingStore((s) => s.graph);
  const selectedPortId = usePipingStore((s) => s.selectedPortId);
  const version = usePipingStore((s) => s.version);
  const recentPieces = useUiConfigStore((s) => s.recentPieces);
  const pushRecentPiece = useUiConfigStore((s) => s.pushRecentPiece);
  const layout = usePhoneLayout();

  const [open, setOpen] = useState<PaletteItem | null>(null);
  const press = useRef<{ timer: number | null; fired: boolean; x: number; y: number }>({ timer: null, fired: false, x: 0, y: 0 });

  const port = selectedPortId ? graph.ports.get(selectedPortId) : undefined;
  const activePort = port && !port.connectedJointId ? port : undefined;
  const nd = activePort?.nominalDiameter || nominalDiameter;

  const items = useMemo(
    () => (specReader ? buildPaletteItems(specReader, nd, activePort) : []),
    // version: cambian las familias fijadas o la spec
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [specReader, nd, activePort?.plantEndType, activePort?.pressureClass, version]
  );
  const recents = useMemo(
    () =>
      showRecents
        ? recentPieces
            .map((id) => findPaletteItem(items, id))
            .filter((x): x is PaletteItem => !!x)
            .slice(0, 4)
        : [],
    [items, recentPieces, showRecents]
  );

  const run = (item: PaletteItem) => {
    vibrate(14);
    insertFitting(item.insert.type, item.insert.options);
    if (item.insert.type !== 'OLET') pushRecentPiece(item.id);
    setOpen(null);
    onInserted?.();
  };

  const clearPress = () => {
    if (press.current.timer !== null) window.clearTimeout(press.current.timer);
    press.current.timer = null;
  };

  const sheet = variant === 'sheet';
  const button = (item: PaletteItem, key: string) => (
    <button
      key={key}
      type="button"
      data-piece={item.id}
      title={`${item.description}${item.variants ? ' — mantené apretado o clic derecho para ver más' : ''}`}
      onPointerDown={(e) => {
        clearPress();
        press.current.fired = false;
        press.current.x = e.clientX;
        press.current.y = e.clientY;
        if (item.variants) {
          press.current.timer = window.setTimeout(() => {
            press.current.fired = true;
            press.current.timer = null;
            vibrate(25);
            setOpen(item);
          }, LONG_PRESS_MS);
        }
      }}
      onPointerMove={(e) => {
        if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) clearPress();
      }}
      onPointerUp={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
      onContextMenu={(e) => {
        e.preventDefault();
        clearPress();
        if (item.variants) setOpen(item);
      }}
      onClick={() => {
        if (press.current.fired) {
          press.current.fired = false;
          return;
        }
        run(item);
      }}
      className={
        sheet
          ? 'relative min-h-[62px] min-w-0 px-1 pt-1.5 pb-1 rounded-xl bg-[#212631] border border-[#343c4c] active:border-[#38bdf8] active:bg-[#0696d7]/25 flex flex-col items-center justify-center gap-0.5 text-slate-100 active:scale-95 transition-all select-none'
          : 'relative py-1 px-1 rounded bg-[#212631] hover:bg-[#0696d7]/25 border border-[#343c4c] hover:border-[#38bdf8] flex flex-col items-center justify-center text-slate-200 active:scale-95 transition-all shrink-0 min-w-[52px] select-none'
      }
      style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
    >
      <PieceIcon kind={item.icon} className={sheet ? 'w-12 h-9' : 'w-8 h-6'} />
      <span className={`${sheet ? 'text-[11px]' : 'text-[8px]'} font-bold leading-tight text-center truncate max-w-full`}>{item.label}</span>
      {item.badge && (
        <span
          className={`absolute top-0.5 right-0.5 px-1 rounded bg-black/55 font-mono font-bold text-amber-200 leading-tight ${
            sheet ? 'text-[9px]' : 'text-[7px]'
          }`}
        >
          {item.badge}
        </span>
      )}
      {item.variants && <ChevronDown size={sheet ? 12 : 9} className="absolute bottom-0.5 right-0.5 text-sky-300" aria-hidden="true" />}
    </button>
  );

  if (!specReader) return null;
  if (!items.length) {
    return <p className="p-3 text-xs text-slate-400">La spec no tiene piezas en este diámetro.</p>;
  }

  const variantsSheet =
    open &&
    createPortal(
      <div
        className={`fixed inset-0 z-[70] bg-black/60 flex justify-center pointer-events-auto ${layout === 'portrait' ? 'items-end' : 'items-center'}`}
        onClick={() => setOpen(null)}
      >
        <section
          role="dialog"
          aria-label={`Variantes de ${open.label}`}
          onClick={(e) => e.stopPropagation()}
          className={`w-full max-w-md flex flex-col bg-[#161a22] border border-[#323946] shadow-2xl ${
            layout === 'portrait' ? 'max-h-[75vh] rounded-t-2xl' : 'max-h-[85vh] rounded-xl'
          }`}
        >
          <header className="flex items-center justify-between gap-2 pl-3 pr-1 h-11 shrink-0 border-b border-[#2b313d]">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100 min-w-0">
              <PieceIcon kind={open.icon} className="w-8 h-6 shrink-0" />
              <span className="truncate">
                {open.label} · {specReader.catalog.sizeLabel(nd)}
              </span>
            </h2>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="w-10 h-10 rounded-lg text-slate-300 active:bg-slate-700 flex items-center justify-center"
              aria-label="Cerrar variantes"
            >
              <X size={20} />
            </button>
          </header>
          <ul className="p-2 space-y-1.5 overflow-y-auto overscroll-contain" style={{ touchAction: 'pan-y' }}>
            {open.variants!.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  data-piece={v.id}
                  onClick={() => run(v)}
                  className="w-full min-h-[52px] px-2.5 py-1.5 rounded-lg bg-[#1b2029] border border-[#2b313d] active:border-[#38bdf8] hover:border-[#38bdf8] flex items-center gap-2.5 text-left active:scale-[0.99] transition-all"
                >
                  <PieceIcon kind={v.icon} className="w-10 h-7 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-bold text-slate-100 leading-snug">{v.label}</span>
                    <span className="block text-[11px] text-slate-400 leading-snug">{v.description}</span>
                  </span>
                  {v.badge && <span className="px-1.5 py-0.5 rounded bg-black/40 text-[10px] font-mono font-bold text-amber-200 shrink-0">{v.badge}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>,
      document.body
    );

  if (!sheet) {
    return (
      <>
        {items.map((item) => button(item, item.id))}
        {variantsSheet}
      </>
    );
  }

  const groupTitle = 'text-[10px] uppercase tracking-wide font-bold text-[#38bdf8] mb-1';
  const grid = 'grid grid-cols-4 landscape:grid-cols-3 gap-1.5';
  return (
    <div className="w-full space-y-2.5">
      {recents.length > 0 && (
        <div>
          <h3 className={groupTitle}>Recientes</h3>
          <div className={grid}>{recents.map((item) => button(item, `recent:${item.id}`))}</div>
        </div>
      )}
      {PALETTE_GROUPS.map((group) => {
        const list = items.filter((i) => i.group === group.id);
        if (!list.length) return null;
        return (
          <div key={group.id}>
            <h3 className={groupTitle}>{group.title}</h3>
            <div className={grid}>{list.map((item) => button(item, item.id))}</div>
          </div>
        );
      })}
      <p className="text-[11px] text-slate-400 leading-snug">
        Son las piezas que la spec tiene en {specReader.catalog.sizeLabel(nd)}. Los botones con flecha guardan más variantes: mantenelos
        apretados.
      </p>
      {variantsSheet}
    </div>
  );
};
