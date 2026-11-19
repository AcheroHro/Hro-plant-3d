import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { Component, Port } from '../types/piping';
import { usePipingStore } from '../store/usePipingStore';
import { useUiConfigStore } from '../store/useUiConfigStore';
import { pieceName } from '../core/pieceNames';
import { TouchNumpad } from './TouchNumpad';
import { SupportEditor } from './SupportEditor';
import { usePhoneLayout, vibrate } from './useIsPhone';
import {
  ActionIcon,
  IconBocaLibre,
  IconBorrar,
  IconCano,
  IconDarVuelta,
  IconDatos,
  IconDerivar,
  IconDiametroTramo,
  IconGirarEje,
  IconMasOpciones,
  IconPartir,
  IconPiezas,
  IconPurga,
  IconSoporte,
  IconTrazar
} from './icons/ActionIcons';

/** "hacia +X" o "en diagonal" */
function dirName(d: THREE.Vector3): string {
  const n = d.clone().normalize();
  const i = [0, 1, 2].find((k) => Math.abs(n.getComponent(k)) > 0.99);
  return i === undefined ? 'en diagonal' : `hacia ${n.getComponent(i) > 0 ? '+' : '−'}${'XYZ'[i]}`;
}

interface DockAction {
  label: string;
  Icon: ActionIcon;
  onClick: () => void;
  tone?: string;
}

/**
 * Barra de abajo del teléfono: cambia según lo que esté elegido.
 * - Una boca libre (o el modelo vacío): dirección, largo y ayudas para trazar, y poner una pieza.
 * - Una pieza: lo que se le puede hacer a esa pieza.
 * - Nada: cómo elegir desde dónde seguir.
 * En vertical se puede deslizar o tocar la manija para colapsarla y dejar casi toda la pantalla al 3D.
 */
export const ContextDock: React.FC = () => {
  const layout = usePhoneLayout();
  const mobilePanel = useUiConfigStore((s) => s.mobilePanel);
  const dockCollapsed = useUiConfigStore((s) => s.dockCollapsed);
  const setDockCollapsed = useUiConfigStore((s) => s.setDockCollapsed);
  const toggleDockCollapsed = useUiConfigStore((s) => s.toggleDockCollapsed);
  const graph = usePipingStore((s) => s.graph);
  usePipingStore((s) => s.version);
  const selectedComponentId = usePipingStore((s) => s.selectedComponentId);
  const selectedPortId = usePipingStore((s) => s.selectedPortId);
  const multiMode = usePipingStore((s) => s.multiMode);
  const selectedSupportId = usePipingStore((s) => s.selectedSupportId);
  const dragStartY = useRef<number | null>(null);

  if (!layout || multiMode) return null;
  if (mobilePanel && mobilePanel !== 'trazar') return null;

  const isPortrait = layout === 'portrait';
  const collapsed = isPortrait && dockCollapsed && !selectedSupportId;
  const comp = selectedComponentId ? graph.components.get(selectedComponentId) : undefined;
  const port = selectedPortId ? graph.ports.get(selectedPortId) : undefined;
  const openPort = port && !port.connectedJointId ? port : undefined;

  const onHandleDown = (e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Sin captura
    }
  };
  const onHandleUp = (e: React.PointerEvent) => {
    if (dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current;
    dragStartY.current = null;
    vibrate(8);
    if (dy > 28) setDockCollapsed(true);
    else if (dy < -28) setDockCollapsed(false);
    else toggleDockCollapsed();
  };

  return (
    <section
      aria-label={selectedSupportId ? 'Soporte elegido' : comp ? `Acciones de ${pieceName(comp.type)}` : 'Trazar'}
      data-tour="dock"
      className={`fixed z-40 flex flex-col bg-[#161a22]/97 backdrop-blur-xl border-[#323946] shadow-2xl pointer-events-auto transition-[max-height] duration-200 ${
        isPortrait
          ? `left-0 right-0 bottom-0 ${collapsed ? 'max-h-[96px]' : 'max-h-[60vh]'} rounded-t-2xl border-t dock-safe`
          : 'right-0 bottom-0 mobile-sheet-top w-[min(380px,50vw)] border-l'
      }`}
    >
      {isPortrait && !selectedSupportId && (
        <button
          type="button"
          onPointerDown={onHandleDown}
          onPointerUp={onHandleUp}
          onPointerCancel={() => {
            dragStartY.current = null;
          }}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expandir barra de herramientas' : 'Colapsar barra de herramientas para ver más 3D'}
          className="w-full h-5 flex items-center justify-center shrink-0 rounded-t-2xl active:bg-white/5 touch-none"
        >
          <span className="w-10 h-1 rounded-full bg-slate-500/70" />
        </button>
      )}
      {selectedSupportId ? (
        <SupportEditor docked />
      ) : comp ? (
        <PieceDock comp={comp} openPort={openPort} collapsed={collapsed} canCollapse={isPortrait} onToggleCollapse={toggleDockCollapsed} />
      ) : (
        <PortDock openPort={openPort} collapsed={collapsed} canCollapse={isPortrait} onToggleCollapse={toggleDockCollapsed} />
      )}
    </section>
  );
};

/** Encabezado de la barra: qué está elegido */
const DockHeader: React.FC<{
  Icon: ActionIcon;
  tone: string;
  band: string;
  title: string;
  subtitle: string;
  collapsed?: boolean;
  canCollapse?: boolean;
  onToggleCollapse?: () => void;
  children?: React.ReactNode;
}> = ({ Icon, tone, band, title, subtitle, collapsed, canCollapse, onToggleCollapse, children }) => (
  <div className={`flex items-center gap-2 pl-3 pr-2 py-2 shrink-0 border-b border-[#2b313d] ${canCollapse ? '' : 'rounded-t-2xl'} ${band}`}>
    <Icon size={26} className={`${tone} shrink-0`} />
    <div
      className="flex flex-col min-w-0 flex-1"
      onClick={
        canCollapse && onToggleCollapse
          ? () => {
              vibrate(8);
              onToggleCollapse();
            }
          : undefined
      }
    >
      <span className="text-[15px] font-bold text-slate-100 leading-tight truncate">{title}</span>
      <span className="text-xs text-slate-400 leading-tight truncate">{subtitle}</span>
    </div>
    {children}
    {canCollapse && onToggleCollapse && (
      <button
        type="button"
        onClick={() => {
          vibrate(8);
          onToggleCollapse();
        }}
        aria-label={collapsed ? 'Expandir barra' : 'Colapsar barra'}
        className="w-9 h-11 rounded-xl text-slate-300 active:bg-slate-700 flex items-center justify-center shrink-0"
      >
        {collapsed ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>
    )}
  </div>
);

const PortDock: React.FC<{
  openPort?: Port;
  collapsed: boolean;
  canCollapse: boolean;
  onToggleCollapse: () => void;
}> = ({ openPort, collapsed, canCollapse, onToggleCollapse }) => {
  const graph = usePipingStore((s) => s.graph);
  const specReader = usePipingStore((s) => s.specReader);
  const nominalDiameter = usePipingStore((s) => s.nominalDiameter);
  const setNominalDiameter = usePipingStore((s) => s.setNominalDiameter);
  const setMobilePanel = useUiConfigStore((s) => s.setMobilePanel);
  const size = (nd: number) => specReader?.catalog.sizeLabel(nd) ?? `${nd}"`;
  const empty = graph.components.size === 0;
  const sizes = specReader?.getAvailableNominalDiameters() ?? [];
  const portComp = openPort ? graph.components.get(openPort.componentId) : undefined;

  const header = openPort ? (
    <DockHeader
      Icon={IconBocaLibre}
      tone="text-emerald-400"
      band="bg-emerald-500/10"
      title={`Boca libre de ${size(openPort.nominalDiameter)}`}
      subtitle={`${portComp ? `En ${pieceName(portComp.type).toLowerCase()}, sale` : 'Sale'} ${dirName(openPort.direction)}`}
      collapsed={collapsed}
      canCollapse={canCollapse}
      onToggleCollapse={onToggleCollapse}
    >
      <PieceButton onClick={() => setMobilePanel('piezas', false)} />
    </DockHeader>
  ) : empty ? (
    <DockHeader
      Icon={IconTrazar}
      tone="text-[#38bdf8]"
      band="bg-sky-500/10"
      title="Primer tramo"
      subtitle="Elegí el diámetro, hacia dónde va y el largo"
      collapsed={collapsed}
      canCollapse={canCollapse}
      onToggleCollapse={onToggleCollapse}
    >
      <label className="sr-only" htmlFor="dock-nd">
        Diámetro
      </label>
      <select
        id="dock-nd"
        value={nominalDiameter}
        onChange={(e) => setNominalDiameter(Number(e.target.value))}
        className="h-11 rounded-xl bg-[#111419] border border-[#343b48] px-2 text-sm font-bold text-emerald-300 outline-none"
      >
        {sizes.map((d) => (
          <option key={d} value={d} className="bg-[#161920] text-slate-100">
            {size(d)}
          </option>
        ))}
      </select>
    </DockHeader>
  ) : (
    <DockHeader
      Icon={IconBocaLibre}
      tone="text-amber-300"
      band="bg-amber-500/10"
      title="Elegí desde dónde seguir"
      subtitle="Tocá una boca libre para trazar o una pieza para corregirla"
      collapsed={collapsed}
      canCollapse={canCollapse}
      onToggleCollapse={onToggleCollapse}
    />
  );

  return (
    <>
      {header}
      {!collapsed && (
        <div className="overflow-y-auto overscroll-contain p-2" style={{ touchAction: 'pan-y' }}>
          <TouchNumpad embedded />
        </div>
      )}
    </>
  );
};

const PieceButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    data-tour="dock-piezas"
    onClick={() => {
      vibrate();
      onClick();
    }}
    className="h-11 px-3 rounded-xl bg-[#0696d7] border border-[#7dd3fc] text-white text-sm font-bold flex items-center gap-1.5 shrink-0 active:scale-95"
  >
    <IconPiezas size={20} />
    Poner pieza
  </button>
);

const PieceDock: React.FC<{
  comp: Component;
  openPort?: Port;
  collapsed: boolean;
  canCollapse: boolean;
  onToggleCollapse: () => void;
}> = ({ comp, openPort, collapsed, canCollapse, onToggleCollapse }) => {
  const graph = usePipingStore((s) => s.graph);
  const specReader = usePipingStore((s) => s.specReader);
  const setMobilePanel = useUiConfigStore((s) => s.setMobilePanel);
  const store = usePipingStore.getState;
  const size = (nd: number) => specReader?.catalog.sizeLabel(nd) ?? `${nd}"`;
  const nd = comp.ports[0]?.nominalDiameter || comp.parameters.nominalDiameter;
  const isPipe = comp.type === 'PIPE' && comp.ports.length >= 2;
  const pipeLength = isPipe ? comp.ports[0].position.distanceTo(comp.ports[1].position) : 0;
  const cut = Math.round(comp.parameters.cutLength ?? pipeLength);
  const [draft, setDraft] = useState(String(cut));
  useEffect(() => setDraft(String(cut)), [cut, comp.id]);

  const openMenu = (section?: 'branch' | 'support' | 'size') => {
    vibrate();
    store().openPieceMenu({
      x: window.innerWidth / 2,
      y: window.innerHeight,
      componentId: comp.id,
      // Derivaciones y soportes van en el medio del caño; para otro punto, mantener apretado el caño
      offsetMm: isPipe ? pipeLength / 2 : undefined,
      section
    });
  };
  const applyLength = (value: number) => {
    if (!Number.isFinite(value) || value <= 0 || Math.round(value) === cut) return setDraft(String(cut));
    vibrate(15);
    store().updateSelectedPipeLength(value);
  };
  const release = () => {
    vibrate();
    store().setSelectedComponentId(null);
    store().setSelectedPortId(null);
  };

  const flipKind = graph.flipKind(comp.id);
  const canRotate = comp.type === 'ELBOW' || comp.type === 'TEE' || (comp.type === 'VALVE' && comp.parameters.visual?.actuator !== 'none');
  const datos: DockAction = { label: 'Datos', Icon: IconDatos, onClick: () => setMobilePanel('propiedades', false) };
  const mas: DockAction = { label: 'Más', Icon: IconMasOpciones, onClick: () => openMenu() };
  const borrar: DockAction = { label: 'Borrar', Icon: IconBorrar, onClick: () => store().deleteSelectedComponent(), tone: 'text-rose-300' };
  const diametro: DockAction = { label: 'Diámetro', Icon: IconDiametroTramo, onClick: () => openMenu('size') };

  const actions: DockAction[] = isPipe
    ? [
        { label: 'Partir', Icon: IconPartir, onClick: () => openMenu() },
        { label: 'Derivar', Icon: IconDerivar, onClick: () => openMenu('branch') },
        { label: 'Purga', Icon: IconPurga, onClick: () => openMenu('branch') },
        { label: 'Soporte', Icon: IconSoporte, onClick: () => openMenu('support') },
        diametro,
        datos,
        mas,
        borrar
      ]
    : [
        ...(canRotate
          ? [{ label: comp.type === 'VALVE' ? 'Girar volante' : 'Girar 90°', Icon: IconGirarEje, onClick: () => store().rotateSelectedComponent(90) }]
          : []),
        ...(flipKind
          ? [{ label: flipKind === 'flange' ? 'Dar vuelta' : flipKind === 'valve' ? 'Invertir' : 'Plano', Icon: IconDarVuelta, onClick: () => store().flipSelectedComponent() }]
          : []),
        diametro,
        datos,
        mas,
        borrar
      ];

  return (
    <>
      <DockHeader
        Icon={isPipe ? IconCano : IconPiezas}
        tone="text-[#38bdf8]"
        band="bg-sky-500/10"
        title={`${pieceName(comp.type)} ${size(nd)}${comp.parameters.schedule ? `, ${comp.parameters.schedule}` : ''}`}
        subtitle={comp.parameters.description || 'Pieza elegida'}
        collapsed={collapsed}
        canCollapse={canCollapse}
        onToggleCollapse={onToggleCollapse}
      >
        {openPort && (
          <button
            type="button"
            onClick={() => {
              vibrate();
              store().setSelectedComponentId(null);
            }}
            className="h-11 px-3 rounded-xl bg-emerald-600 border border-emerald-300 text-white text-sm font-bold flex items-center gap-1.5 shrink-0 active:scale-95"
          >
            <IconTrazar size={20} />
            Seguir
          </button>
        )}
        <button type="button" onClick={release} aria-label="Soltar la pieza" className="w-11 h-11 rounded-xl text-slate-300 active:bg-slate-700 flex items-center justify-center shrink-0">
          <X size={22} />
        </button>
      </DockHeader>

      {!collapsed && (
        <div className="overflow-y-auto overscroll-contain px-2 pt-2 pb-1 flex flex-col gap-2" style={{ touchAction: 'pan-y' }}>
          {isPipe && (
            <div className="flex items-center gap-1.5">
              <label htmlFor="dock-largo" className="text-sm text-slate-400 w-12 shrink-0 pl-1">
                Largo
              </label>
              <button type="button" aria-label="Restar 10 milímetros" onClick={() => applyLength(cut - 10)} className="w-12 h-12 rounded-xl bg-[#212631] border border-[#343c4c] text-xl font-bold text-slate-100 active:bg-[#2b3240]">
                −
              </button>
              <input
                id="dock-largo"
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                onBlur={() => applyLength(Number(draft))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className="flex-1 min-w-0 h-12 rounded-xl bg-[#111419] border-2 border-[#0696d7] text-center text-xl font-bold text-slate-100 outline-none tabular-nums"
              />
              <button type="button" aria-label="Sumar 10 milímetros" onClick={() => applyLength(cut + 10)} className="w-12 h-12 rounded-xl bg-[#212631] border border-[#343c4c] text-xl font-bold text-slate-100 active:bg-[#2b3240]">
                +
              </button>
              <span className="text-sm text-slate-400 pr-1">mm</span>
            </div>
          )}

          <div className="grid grid-cols-4 gap-1">
            {actions.map(({ label, Icon, onClick, tone }) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  vibrate();
                  onClick();
                }}
                className={`min-h-[64px] rounded-xl flex flex-col items-center justify-center gap-1 text-xs font-semibold active:bg-[#2b3240] ${tone ?? 'text-slate-100'}`}
              >
                <Icon size={24} />
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 px-1 pb-1">
            {isPipe ? 'Derivar, purga y soporte van en el medio del caño. Para otro punto, mantené apretado el caño.' : 'Mantené apretada la pieza para ver todas las opciones.'}
          </p>
        </div>
      )}
    </>
  );
};
