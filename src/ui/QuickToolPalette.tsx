import React from 'react';
import { usePipingStore } from '../store/usePipingStore';
import { useUiConfigStore, ToolsLayoutMode } from '../store/useUiConfigStore';
import { FloatingPalette } from './FloatingPalette';
import { PieceGrid } from './PieceGrid';
import { usePhoneLayout, vibrate } from './useIsPhone';

/** Paleta de piezas: se arma con lo que la spec tiene en el diámetro de la boca activa */
export const QuickToolPalette: React.FC = () => {
  const nominalDiameter = usePipingStore((s) => s.nominalDiameter);
  const specCode = usePipingStore((s) => s.specCode);
  const specReader = usePipingStore((s) => s.specReader);
  const toggleToolPalette = usePipingStore((s) => s.toggleToolPalette);
  const activePortNd = usePipingStore((s) => {
    const port = s.selectedPortId ? s.graph.ports.get(s.selectedPortId) : undefined;
    return port && !port.connectedJointId ? port.nominalDiameter : undefined;
  });

  const phone = usePhoneLayout();
  const toolsLayout = useUiConfigStore((s) => s.toolsLayout);
  const setToolsLayout = useUiConfigStore((s) => s.setToolsLayout);

  const cycleLayout = (e: React.MouseEvent) => {
    e.stopPropagation();
    vibrate(10);
    const order: ToolsLayoutMode[] = ['1col', '2col', 'horiz'];
    const next = order[(order.indexOf(toolsLayout) + 1) % order.length];
    setToolsLayout(next);
  };

  const gridClass =
    toolsLayout === 'horiz'
      ? 'flex flex-row items-center gap-1 overflow-x-auto max-w-[85vw] py-1 px-1.5'
      : toolsLayout === '2col'
      ? 'grid grid-cols-2 gap-1 p-1.5 w-[124px] max-h-[72vh] overflow-y-auto'
      : 'flex flex-col items-stretch gap-1 p-1.5 w-[70px] max-h-[72vh] overflow-y-auto';

  const nd = activePortNd || nominalDiameter;
  const catalogButton = (
    <button
      type="button"
      onClick={() => {
        vibrate();
        toggleToolPalette();
      }}
      className={
        phone
          ? 'w-full h-11 rounded-xl bg-[#2b313d] border border-amber-500/60 text-amber-300 text-xs font-bold flex items-center justify-center gap-2 active:scale-95 transition-all'
          : `py-1.5 px-1 rounded bg-[#2b313d] hover:bg-[#384050] border border-amber-500/60 flex flex-col items-center justify-center text-amber-300 active:scale-95 transition-all shrink-0 min-w-[52px] ${
              toolsLayout === '2col' ? 'col-span-2' : ''
            }`
      }
      title={`Catálogo de la spec ${specCode}: fijar familias y ver medidas`}
    >
      <span className={`${phone ? 'text-xs' : 'text-[9px]'} font-mono font-black leading-none`}>{specCode}</span>
      <span className={`${phone ? 'text-xs' : 'text-[7px] mt-0.5'} font-bold`}>{phone ? 'Catálogo de la spec' : 'Catálogo'}</span>
    </button>
  );

  return (
    <FloatingPalette
      paletteId="tools"
      title="Piezas"
      badge={
        <span className="px-1 py-0.2 rounded bg-[#0696d7]/20 border border-[#38bdf8]/40 text-[8px] font-mono font-bold text-[#38bdf8]">
          {specReader?.catalog.sizeLabel(nd) ?? `${nd}"`}
        </span>
      }
      sheetBodyClassName="p-3 w-full space-y-2.5"
      headerActions={
        phone ? undefined : (
          <button
            type="button"
            onClick={cycleLayout}
            className="w-5 h-5 rounded bg-[#262c3a] hover:bg-[#343c4e] border border-[#3a4254] text-amber-300 flex items-center justify-center text-[9px] font-mono font-bold active:scale-90 transition-all"
            title={`Cambiar disposición de paleta (${toolsLayout.toUpperCase()})`}
          >
            {toolsLayout === '1col' ? '1C' : toolsLayout === '2col' ? '2C' : '⇄'}
          </button>
        )
      }
      bodyClassName={gridClass}
    >
      <PieceGrid variant={phone ? 'sheet' : 'compact'} />
      {catalogButton}
    </FloatingPalette>
  );
};
