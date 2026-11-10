import React, { useRef, useState, useEffect } from 'react';
import { PALETTE_PANEL, PaletteId, useUiConfigStore } from '../store/useUiConfigStore';
import { MobileSheet } from './MobileSheet';
import { usePhoneLayout } from './useIsPhone';

interface FloatingPaletteProps {
  paletteId: PaletteId;
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  headerActions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Si se pasa, reemplaza el comportamiento por defecto del botón de colapsar */
  onToggleCollapseOverride?: () => void;
  /** Permite ocultar el cuerpo independientemente de isCollapsed (ej. cuando no hay pieza seleccionada) */
  forceCollapsed?: boolean;
  /** Si es true, no permite cerrar la paleta con X o muestra solo colapsar */
  hideCloseButton?: boolean;
  /** Clases del cuerpo cuando la paleta se muestra como panel del teléfono */
  sheetBodyClassName?: string;
  /** Escala del contenido en el panel del teléfono */
  sheetZoom?: number;
  /** Texto del panel del teléfono cuando el cuerpo está plegado (por ejemplo, sin pieza elegida) */
  sheetEmptyHint?: string;
  children: React.ReactNode;
}

export const FloatingPalette: React.FC<FloatingPaletteProps> = ({
  paletteId,
  title,
  icon,
  badge,
  headerActions,
  className = '',
  bodyClassName = '',
  onToggleCollapseOverride,
  forceCollapsed,
  hideCloseButton = false,
  sheetBodyClassName,
  sheetZoom,
  sheetEmptyHint,
  children
}) => {
  const phoneLayout = usePhoneLayout();
  const mobilePanel = useUiConfigStore((s) => s.mobilePanel);
  const setMobilePanel = useUiConfigStore((s) => s.setMobilePanel);
  const paletteState = useUiConfigStore((s) => s.palettes[paletteId]);
  const setPalettePosition = useUiConfigStore((s) => s.setPalettePosition);
  const togglePaletteOpen = useUiConfigStore((s) => s.togglePaletteOpen);
  const togglePaletteCollapsed = useUiConfigStore((s) => s.togglePaletteCollapsed);
  const bringToFront = useUiConfigStore((s) => s.bringToFront);

  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  useEffect(() => {
    const handleResize = () => {
      if (!paletteState) return;
      setPalettePosition(paletteId, paletteState.x, paletteState.y);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [paletteId, paletteState?.x, paletteState?.y, setPalettePosition]);

  // Teléfono: la paleta es un panel fijo y se abre desde la barra de pestañas
  if (phoneLayout) {
    const panel = PALETTE_PANEL[paletteId];
    if (!panel || mobilePanel !== panel) return null;
    return (
      <MobileSheet
        layout={phoneLayout}
        title={title}
        icon={icon}
        badge={badge}
        headerActions={headerActions}
        onClose={() => setMobilePanel(null)}
        bodyClassName={forceCollapsed ? '' : sheetBodyClassName ?? bodyClassName}
        zoom={forceCollapsed ? undefined : sheetZoom}
      >
        {forceCollapsed ? <p className="px-4 py-6 text-sm text-slate-400 text-center">{sheetEmptyHint}</p> : children}
      </MobileSheet>
    );
  }

  if (!paletteState || !paletteState.isOpen) return null;

  const effectiveCollapsed =
    forceCollapsed !== undefined ? forceCollapsed : paletteState.isCollapsed;

  const vibrate = (ms = 10) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(ms);
      } catch {
        // Ignore
      }
    }
  };

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Evitar iniciar arrastre si se hizo clic sobre un botón interactivo de la cabecera
    if ((e.target as HTMLElement).closest('button, input, select')) {
      bringToFront(paletteId);
      return;
    }
    e.stopPropagation();
    bringToFront(paletteId);
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragOffsetRef.current = {
      dx: e.clientX - paletteState.x,
      dy: e.clientY - paletteState.y
    };
  };

  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.stopPropagation();
    const nextX = e.clientX - dragOffsetRef.current.dx;
    const nextY = e.clientY - dragOffsetRef.current.dy;
    setPalettePosition(paletteId, nextX, nextY);
  };

  const handleHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    setIsDragging(false);
  };

  const handleCollapseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    vibrate(10);
    if (onToggleCollapseOverride) {
      onToggleCollapseOverride();
    } else {
      togglePaletteCollapsed(paletteId);
    }
  };

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    vibrate(12);
    togglePaletteOpen(paletteId, false);
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={() => bringToFront(paletteId)}
      style={{
        left: `${paletteState.x}px`,
        top: `${paletteState.y}px`,
        zIndex: paletteState.zIndex
      }}
      className={`fixed select-none pointer-events-auto flex flex-col bg-[#161a22]/96 backdrop-blur-xl border rounded-lg shadow-2xl transition-shadow duration-150 ${
        isDragging
          ? 'border-[#38bdf8] shadow-[#0696d7]/30 ring-1 ring-[#38bdf8]/50'
          : 'border-[#323946] hover:border-[#434c5e]'
      } ${className}`}
    >
      {/* Barra de título arrastrable estilo Paleta CAD */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
        className={`flex items-center justify-between gap-2 px-2 py-1.5 bg-gradient-to-r from-[#1f2430] to-[#191d26] ${
          effectiveCollapsed ? 'rounded-lg' : 'rounded-t-lg border-b border-[#2b313d]'
        } cursor-grab active:cursor-grabbing`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Grip de arrastre */}
          <span
            className="text-slate-500 hover:text-slate-300 text-[10px] font-mono leading-none tracking-tighter px-0.5 cursor-grab"
            title="Arrastrar paleta"
          >
            ⋮⋮
          </span>
          {icon && <span className="text-xs flex-shrink-0">{icon}</span>}
          <span className="text-[10px] font-mono font-extrabold uppercase tracking-wider text-slate-200 truncate">
            {title}
          </span>
          {badge && <div className="flex items-center flex-shrink-0">{badge}</div>}
        </div>

        {/* Botones de control de ventana CAD */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {headerActions}

          <button
            type="button"
            onClick={handleCollapseClick}
            className="w-5 h-5 rounded bg-[#262c3a] hover:bg-[#343c4e] border border-[#3a4254] text-slate-300 hover:text-white flex items-center justify-center text-[10px] font-bold active:scale-90 transition-all"
            title={effectiveCollapsed ? 'Desplegar paleta' : 'Plegar / Minimizar paleta'}
          >
            {effectiveCollapsed ? '▾' : '—'}
          </button>

          {!hideCloseButton && (
            <button
              type="button"
              onClick={handleCloseClick}
              className="w-5 h-5 rounded bg-[#262c3a] hover:bg-rose-900/80 border border-[#3a4254] hover:border-rose-500/60 text-slate-400 hover:text-rose-200 flex items-center justify-center text-[10px] font-bold active:scale-90 transition-all"
              title="Cerrar paleta (puede reabrirse desde la barra superior)"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Cuerpo de la paleta */}
      {!effectiveCollapsed && <div className={bodyClassName}>{children}</div>}
    </div>
  );
};
