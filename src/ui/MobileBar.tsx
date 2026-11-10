import React from 'react';
import { Box, ClipboardList, Menu, Route, Shapes } from 'lucide-react';
import { usePipingStore } from '../store/usePipingStore';
import { MobilePanel, useUiConfigStore } from '../store/useUiConfigStore';
import { usePhoneLayout, vibrate } from './useIsPhone';

const TABS: { id: MobilePanel; label: string; Icon: typeof Box }[] = [
  { id: 'trazar', label: 'Trazar', Icon: Route },
  { id: 'piezas', label: 'Piezas', Icon: Shapes },
  { id: 'propiedades', label: 'Propiedades', Icon: ClipboardList },
  { id: 'vistas', label: 'Vistas', Icon: Box },
  { id: 'mas', label: 'Más', Icon: Menu }
];

/** Barra de pestañas del teléfono: abajo en vertical, a la izquierda en horizontal */
export const MobileBar: React.FC = () => {
  const layout = usePhoneLayout();
  const mobilePanel = useUiConfigStore((s) => s.mobilePanel);
  const setMobilePanel = useUiConfigStore((s) => s.setMobilePanel);
  const hasSelection = usePipingStore((s) => Boolean(s.selectedComponentId));

  if (!layout) return null;

  return (
    <nav
      aria-label="Paneles"
      className={`fixed z-50 flex bg-[#13161b] border-[#343b48] pointer-events-auto ${
        layout === 'portrait'
          ? 'left-0 right-0 bottom-0 flex-row border-t mobile-bar-safe'
          : 'left-0 bottom-0 mobile-sheet-top w-14 flex-col border-r'
      }`}
    >
      {TABS.map(({ id, label, Icon }) => {
        const active = mobilePanel === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            data-tour={`tab-${id}`}
            onClick={() => {
              vibrate(8);
              setMobilePanel(id);
            }}
            className={`relative flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 transition-colors ${
              active ? 'text-[#38bdf8]' : 'text-slate-400 active:text-slate-100'
            }`}
          >
            <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
            <span className={`text-[10px] leading-none truncate max-w-full px-0.5 ${active ? 'font-bold' : 'font-medium'}`}>
              {label}
            </span>
            {id === 'propiedades' && hasSelection && !active && (
              <span className="absolute top-1.5 left-1/2 ml-2.5 w-2 h-2 rounded-full bg-amber-400" />
            )}
            {active && (
              <span
                className={`absolute bg-[#38bdf8] rounded-full ${
                  layout === 'portrait' ? 'top-0 left-1/4 right-1/4 h-0.5' : 'left-0 top-1/4 bottom-1/4 w-0.5'
                }`}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
};
