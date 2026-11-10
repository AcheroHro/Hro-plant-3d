import React from 'react';
import { X } from 'lucide-react';
import { PhoneLayout, vibrate } from './useIsPhone';

interface MobileSheetProps {
  layout: Exclude<PhoneLayout, null>;
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  headerActions?: React.ReactNode;
  onClose: () => void;
  bodyClassName?: string;
  /** Agranda el contenido heredado de las paletas de escritorio para que se pueda tocar */
  zoom?: number;
  children: React.ReactNode;
}

/**
 * Panel del teléfono: en vertical sube desde abajo, sobre la barra de pestañas; en horizontal
 * queda al costado derecho. Se muestra uno a la vez para que el modelo siempre se vea.
 */
export const MobileSheet: React.FC<MobileSheetProps> = ({
  layout,
  title,
  icon,
  badge,
  headerActions,
  onClose,
  bodyClassName = '',
  zoom,
  children
}) => (
  <section
    aria-label={title}
    className={`fixed z-40 flex flex-col bg-[#161a22]/95 backdrop-blur-xl border-[#323946] shadow-2xl pointer-events-auto ${
      layout === 'portrait'
        ? 'left-0 right-0 mobile-sheet-bottom max-h-[52vh] rounded-t-2xl border-t'
        : 'right-0 bottom-0 mobile-sheet-top w-[min(340px,46vw)] border-l'
    }`}
  >
    <header className="flex items-center justify-between gap-2 pl-3 pr-1 h-10 shrink-0 border-b border-[#2b313d]">
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-sm shrink-0">{icon}</span>}
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-200 truncate">{title}</h2>
        {badge}
      </div>
      <div className="flex items-center gap-1 shrink-0 [&_button]:min-h-[32px] [&_button]:min-w-[32px] [&_button]:text-[11px]">
        {headerActions}
        <button
          type="button"
          onClick={() => {
            vibrate(10);
            onClose();
          }}
          className="!min-w-[40px] !min-h-[40px] rounded-lg text-slate-300 active:bg-slate-700 flex items-center justify-center"
          aria-label={`Cerrar ${title}`}
        >
          <X size={20} />
        </button>
      </div>
    </header>
    <div
      className={`overflow-y-auto overscroll-contain ${bodyClassName}`}
      style={{ touchAction: 'pan-y', ...(zoom ? { zoom } : {}) }}
    >
      {children}
    </div>
  </section>
);
