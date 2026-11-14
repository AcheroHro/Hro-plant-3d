import React, { useState } from 'react';
import * as THREE from 'three';
import { ArrowUpDown, Check, ChevronLeft, ChevronRight, CornerUpRight, Keyboard, Spline, TrendingDown, X } from 'lucide-react';
import { IconAlinear, IconIrAPunto, IconOtraBoca, IconUnirBoca } from './icons/ActionIcons';
import { planOffset } from '../core/routing/routeMath';
import { usePipingStore } from '../store/usePipingStore';
import { FloatingPalette } from './FloatingPalette';
import { usePhoneLayout, vibrate } from './useIsPhone';

const PRESETS = ['250', '500', '1000', '1500', '3000', '6000'];
const TURN_ANGLES = [15, 22.5, 30, 45, 60];
const SLOPES = [0.5, 1, 2, 5];
type Tool = 'angle' | 'slope' | 'offset' | 'elev' | 'coord';

/** Ejes del compás de Plant: X Este, Y Norte, Z arriba */
const AXES: { label: string; v: [number, number, number]; cls: string }[] = [
  { label: '+X', v: [1, 0, 0], cls: 'text-red-400' },
  { label: '−X', v: [-1, 0, 0], cls: 'text-red-400' },
  { label: '+Y', v: [0, 1, 0], cls: 'text-emerald-400' },
  { label: '−Y', v: [0, -1, 0], cls: 'text-emerald-400' },
  { label: '+Z', v: [0, 0, 1], cls: 'text-sky-400' },
  { label: '−Z', v: [0, 0, -1], cls: 'text-sky-400' }
];

/**
 * Trazar: dirección, largo y ayudas de trazado. En escritorio es una paleta flotante; en el
 * teléfono vive dentro de la barra de abajo cuando hay una boca activa (`embedded`).
 */
export const TouchNumpad: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [showTouchKeys, setShowTouchKeys] = useState(false);
  const [tool, setTool] = useState<Tool | null>(null);
  const [slopeDown, setSlopeDown] = useState(true);
  const [offsetValues, setOffsetValues] = useState<[string, string, string]>(['', '', '']);
  const [offsetAngle, setOffsetAngle] = useState(45);
  const [elevTarget, setElevTarget] = useState('');
  const [elevRef, setElevRef] = useState<'CL' | 'BOP' | 'TOP'>('BOP');
  const [coord, setCoord] = useState<[string, string, string]>(['', '', '']);
  const phone = usePhoneLayout();
  const alignPicking = usePipingStore((s) => s.alignPicking);

  const numpadValue = usePipingStore((s) => s.numpadValue);
  const setNumpadValue = usePipingStore((s) => s.setNumpadValue);
  const appendDigit = usePipingStore((s) => s.appendNumpadDigit);
  const backspace = usePipingStore((s) => s.backspaceNumpad);
  const clear = usePipingStore((s) => s.clearNumpad);
  const quickAdd = usePipingStore((s) => s.quickAddNumpad);
  const applyRouting = usePipingStore((s) => s.applyRouting);
  const activeDirection = usePipingStore((s) => s.activeDirection);
  const setActiveDirection = usePipingStore((s) => s.setActiveDirection);
  const nominalDiameter = usePipingStore((s) => s.nominalDiameter);
  const cycleOpenPort = usePipingStore((s) => s.cycleOpenPort);
  const connectPicking = usePipingStore((s) => s.connectPicking);
  const connectRoutes = usePipingStore((s) => s.connectRoutes);
  const connectIndex = usePipingStore((s) => s.connectIndex);
  const startConnectPicking = usePipingStore((s) => s.startConnectPicking);
  const cycleConnectRoute = usePipingStore((s) => s.cycleConnectRoute);
  const confirmConnect = usePipingStore((s) => s.confirmConnect);
  const cancelConnect = usePipingStore((s) => s.cancelConnect);
  const turnAngleDeg = usePipingStore((s) => s.turnAngleDeg);
  const slopePct = usePipingStore((s) => s.slopePct);
  const routeAxis = usePipingStore((s) => s.routeAxis);
  const setTurnAngle = usePipingStore((s) => s.setTurnAngle);
  const setSlope = usePipingStore((s) => s.setSlope);
  const applyOffset = usePipingStore((s) => s.applyOffset);
  const goToElevation = usePipingStore((s) => s.goToElevation);
  const graph = usePipingStore((s) => s.graph);
  const selectedPortId = usePipingStore((s) => s.selectedPortId);
  usePipingStore((s) => s.version);
  const activePort = selectedPortId ? graph.ports.get(selectedPortId) : undefined;
  const openPort = activePort && !activePort.connectedJointId ? activePort : undefined;

  // Sin boca activa (se tocó el fondo) y con piezas en el modelo: hay que elegir desde dónde seguir
  const openPorts = graph.getOpenPorts();
  const needsPort = !openPort && graph.components.size > 0;

  const handleApply = () => {
    vibrate(25);
    applyRouting();
  };

  const pickPortNotice = (
    <div className="w-full flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-400/50">
      <span className="flex-1 min-w-0 text-xs text-amber-100 leading-snug">
        {openPorts.length ? 'Tocá una boca libre del modelo para seguir desde ahí.' : 'No quedan bocas libres en el modelo.'}
      </span>
      {openPorts.length > 0 && (
        <button
          type="button"
          onClick={() => {
            vibrate();
            usePipingStore.getState().setSelectedPortId(openPorts[openPorts.length - 1].id);
          }}
          className={`${phone ? 'h-10' : 'h-8'} px-3 rounded-lg bg-amber-500 border border-amber-200 text-black text-xs font-black shrink-0 active:scale-95`}
        >
          Última boca
        </button>
      )}
    </div>
  );

  const near = (a: THREE.Vector3, v: [number, number, number], tol: number) =>
    Math.abs(a.x - v[0]) < tol && Math.abs(a.y - v[1]) < tol && Math.abs(a.z - v[2]) < tol;
  // Con giro libre o pendiente la dirección no coincide con el eje: se resalta el eje que se tocó
  const isDir = (v: [number, number, number]) =>
    routeAxis && routeAxis.result.distanceTo(activeDirection) < 1e-4 ? near(routeAxis.axis, v, 0.01) : near(activeDirection, v, 0.05);

  const route = connectRoutes[connectIndex];
  // Alto mínimo táctil: 44 px en el teléfono
  const tall = phone ? 'h-11' : 'h-8';
  const chip = `${phone ? 'h-9 px-3 text-xs' : 'h-7 px-2 text-[10px]'} rounded-lg border font-mono font-bold flex items-center gap-1.5 shrink-0 active:scale-95 transition-all`;

  /** Elección del recorrido para unir dos bocas (reemplaza la entrada de largo mientras dura) */
  const connectChooser = route && (
    <div className="w-full flex items-center gap-1.5 p-1.5 bg-[#111419] rounded-lg border border-fuchsia-500/60">
      <button
        type="button"
        onClick={() => {
          vibrate();
          cycleConnectRoute(-1);
        }}
        disabled={connectRoutes.length < 2}
        className={`${tall} w-10 rounded-lg bg-[#252a34] border border-[#3a4150] text-slate-200 flex items-center justify-center disabled:opacity-30`}
        aria-label="Recorrido anterior"
      >
        <ChevronLeft size={20} />
      </button>
      <div className="flex-1 min-w-0 text-center leading-tight">
        <div className="text-xs font-bold text-fuchsia-300 whitespace-nowrap">
          Recorrido {connectIndex + 1}/{connectRoutes.length}
        </div>
        <div className="text-[11px] font-mono text-slate-300 whitespace-nowrap">
          {route.bends} codo{route.bends === 1 ? '' : 's'} · {(route.totalLength / 1000).toFixed(2)} m
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          vibrate();
          cycleConnectRoute(1);
        }}
        disabled={connectRoutes.length < 2}
        className={`${tall} w-10 rounded-lg bg-[#252a34] border border-[#3a4150] text-slate-200 flex items-center justify-center disabled:opacity-30`}
        aria-label="Recorrido siguiente"
      >
        <ChevronRight size={20} />
      </button>
      <button
        type="button"
        onClick={() => {
          vibrate();
          cancelConnect();
        }}
        className={`${tall} w-10 rounded-lg bg-[#252a34] border border-[#3a4150] text-slate-300 flex items-center justify-center`}
        aria-label="Cancelar conexión"
      >
        <X size={18} />
      </button>
      <button
        type="button"
        onClick={() => {
          vibrate(25);
          confirmConnect();
        }}
        className={`${tall} px-3 rounded-lg bg-fuchsia-600 border border-fuchsia-300 text-white font-black text-xs flex items-center gap-1 shrink-0 active:scale-95`}
      >
        <Check size={16} />
        <span>CONECTAR</span>
      </button>
    </div>
  );

  const lengthBar = (
    <div data-tour="length" className="w-full flex items-center justify-between gap-1.5 p-1.5 bg-[#111419] rounded-lg border border-[#343b48]">
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <input
          type="number"
          inputMode="decimal"
          value={numpadValue}
          onChange={(e) => setNumpadValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleApply();
          }}
          className={`${tall} min-w-0 w-full max-w-[8rem] px-2 rounded bg-[#1b1f26] border border-[#38bdf8]/60 text-lg font-mono font-black text-[#38bdf8] focus:outline-none focus:border-[#38bdf8]`}
          placeholder="1000"
          aria-label="Largo del tramo en milímetros"
        />
        <span className="text-[11px] font-mono font-bold text-slate-400">mm</span>
      </div>
      {[100, 500].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => {
            vibrate(12);
            quickAdd(n);
          }}
          className={`${tall} px-2 rounded bg-[#252a34] border border-[#3a4150] text-[11px] font-mono font-bold text-cyan-300 active:scale-95 shrink-0`}
        >
          +{n}
        </button>
      ))}
      <button
        type="button"
        onClick={handleApply}
        className={`${tall} px-3.5 rounded-lg bg-[#0696d7] hover:bg-[#0582ba] text-white font-black text-xs tracking-wide shadow-lg shadow-[#0696d7]/30 active:scale-95 transition-all border border-[#38bdf8] shrink-0`}
        title="Trazar cañería o giro en la boca activa (ENTER)"
      >
        TRAZAR
      </button>
    </div>
  );

  /** Dirección por ejes: lo mismo que tocar las flechas del compás sobre el modelo */
  const axisRow = (
    <div data-tour="axes" className="w-full grid grid-cols-6 gap-1">
      {AXES.map(({ label, v, cls }) => (
        <button
          key={label}
          type="button"
          onClick={() => {
            vibrate();
            setActiveDirection(new THREE.Vector3(...v));
          }}
          className={`${phone ? 'h-9' : 'h-7'} rounded-lg border text-xs font-mono font-black transition-all active:scale-95 ${
            isDir(v) ? 'bg-cad-accent text-cad-dark border-cad-accent' : `bg-[#222630] border-[#343b48] ${cls}`
          }`}
          aria-pressed={isDir(v)}
          title={`Trazar hacia ${label}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const actionsRow = (
    <div data-tour="align-tools" className="w-full flex items-center gap-1.5 overflow-x-auto no-scrollbar" style={{ touchAction: 'pan-x' }}>
      <button
        type="button"
        onClick={() => {
          vibrate();
          startConnectPicking();
        }}
        className={`${chip} ${
          connectPicking ? 'bg-fuchsia-600 text-white border-fuchsia-300 animate-pulse' : 'bg-[#222630] text-fuchsia-300 border-fuchsia-500/50'
        }`}
        title="Unir la boca activa con otra boca libre: la app propone los recorridos"
      >
        <IconUnirBoca size={16} />
        <span>{connectPicking ? 'Tocá la boca destino' : 'Conectar a boca'}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          vibrate();
          usePipingStore.getState().startAlignPicking();
        }}
        className={`${chip} ${alignPicking ? 'bg-amber-500 text-black border-amber-200 animate-pulse' : 'bg-[#222630] text-amber-300 border-amber-500/50'}`}
        title="Largo hasta alinear: tocá otra boca o pieza y el largo del tramo se calcula solo"
        aria-pressed={alignPicking}
      >
        <IconAlinear size={16} />
        <span>{alignPicking ? 'Tocá la referencia' : 'Alinear'}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          vibrate();
          cycleOpenPort();
        }}
        className={`${chip} bg-[#222630] text-emerald-300 border-emerald-500/40`}
        title="Saltar a la siguiente boca o ramal libre"
      >
        <IconOtraBoca size={16} />
        <span>Otra boca</span>
      </button>
      <button
        type="button"
        onClick={() => {
          vibrate();
          setShowTouchKeys(!showTouchKeys);
        }}
        className={`${chip} ${showTouchKeys ? 'bg-[#0696d7] text-white border-[#38bdf8]' : 'bg-[#222630] text-sky-300 border-[#343b48]'}`}
        aria-pressed={showTouchKeys}
      >
        <Keyboard size={14} />
        <span>Teclado</span>
      </button>
      <span className="w-px h-5 bg-[#343b48] shrink-0" />
      {PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => {
            vibrate();
            setNumpadValue(preset);
          }}
          className={`${chip} ${
            numpadValue === preset ? 'bg-[#0696d7] text-white border-[#38bdf8]' : 'bg-[#222630] text-slate-300 border-[#343b48]'
          }`}
        >
          {preset}
        </button>
      ))}
    </div>
  );

  const toolChip = (id: Tool, icon: React.ReactNode, label: string, on: boolean) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        vibrate();
        setTool(tool === id ? null : id);
        // Datos de la boca: los campos arrancan con la coordenada actual
        if (id === 'coord' && tool !== id && openPort) {
          setCoord([openPort.position.x, openPort.position.y, openPort.position.z].map((n) => String(Math.round(n * 10) / 10)) as [string, string, string]);
        }
      }}
      aria-expanded={tool === id}
      data-tool={id}
      className={`${chip} flex-1 min-w-0 justify-center !px-1 !gap-1 ${
        tool === id
          ? 'bg-amber-500 text-black border-amber-200'
          : on
            ? 'bg-amber-500/20 text-amber-200 border-amber-400/70'
            : 'bg-[#222630] text-slate-300 border-[#343b48]'
      }`}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );

  /** Ayudas de trazado de Plant: giro libre, pendiente, desvío y elevación */
  const toolsRow = (
    <div data-tour="route-tools" className="w-full flex items-center gap-1.5">
      {toolChip('angle', <CornerUpRight size={14} />, turnAngleDeg === null ? 'Giro' : `Giro ${turnAngleDeg}°`, turnAngleDeg !== null)}
      {toolChip('slope', <TrendingDown size={14} />, slopePct === 0 ? 'Pend.' : `${slopePct > 0 ? '+' : '−'}${Math.abs(slopePct)}%`, slopePct !== 0)}
      {toolChip('offset', <Spline size={14} />, 'Desvío', false)}
      {toolChip('elev', <ArrowUpDown size={14} />, 'Elev.', false)}
      {toolChip('coord', <IconIrAPunto size={16} />, 'Boca', false)}
    </div>
  );

  const opt = (active: boolean) =>
    `${phone ? 'h-10' : 'h-8'} px-2 rounded-lg border text-xs font-mono font-bold active:scale-95 ${
      active ? 'bg-amber-500 text-black border-amber-200' : 'bg-[#222630] text-slate-200 border-[#343b48]'
    }`;
  const field = `${phone ? 'h-10' : 'h-8'} min-w-0 w-full px-2 rounded-lg bg-[#1b1f26] border border-amber-400/50 text-sm font-mono font-bold text-amber-200 outline-none`;
  const hint = 'text-[11px] leading-snug text-slate-400';
  const go = `${phone ? 'h-10' : 'h-8'} px-3 rounded-lg bg-amber-500 border border-amber-200 text-black text-xs font-black shrink-0 active:scale-95 disabled:opacity-40`;

  // Desvío: se corre la línea en los ejes que no son el de la boca activa
  const portDir = openPort?.direction;
  const offsetAxes = (['X', 'Y', 'Z'] as const)
    .map((name, i) => ({ name, i }))
    .filter(({ i }) => !portDir || Math.abs(portDir.getComponent(i)) < 0.9);
  const offsetVector = new THREE.Vector3(...offsetValues.map((t, i) => (offsetAxes.some((a) => a.i === i) ? parseFloat(t) || 0 : 0)));
  const offsetPlan = portDir ? planOffset(portDir, offsetVector, offsetAngle, 0, 0) : null;

  const toolPanel = tool && (
    <div className="w-full p-2 rounded-lg bg-[#111419] border border-amber-500/40 space-y-1.5">
      {tool === 'angle' && (
        <>
          <div className="grid grid-cols-6 gap-1">
            <button type="button" className={opt(turnAngleDeg === null)} onClick={() => setTurnAngle(null)}>
              A eje
            </button>
            {TURN_ANGLES.map((a) => (
              <button key={a} type="button" className={opt(turnAngleDeg === a)} onClick={() => setTurnAngle(a)}>
                {a}°
              </button>
            ))}
          </div>
          <div className={hint}>
            {turnAngleDeg === null
              ? 'A eje: la línea sale por el eje que toques (codos de 90° o 45°).'
              : `La línea se desvía ${turnAngleDeg}° hacia el eje que toques. Fuera de 45° y 90° el codo va recortado (solo specs para soldar a tope).`}
          </div>
        </>
      )}

      {tool === 'slope' && (
        <>
          <div className="grid grid-cols-6 gap-1">
            <button type="button" className={opt(slopePct === 0)} onClick={() => setSlope(0)}>
              Nivel
            </button>
            <button
              type="button"
              className={opt(false)}
              onClick={() => {
                setSlopeDown(!slopeDown);
                if (slopePct !== 0) setSlope(-slopePct);
              }}
              aria-label="Cambiar entre bajar y subir"
            >
              {slopeDown ? 'Baja' : 'Sube'}
            </button>
            {SLOPES.map((p) => (
              <button key={p} type="button" className={opt(Math.abs(slopePct) === p)} onClick={() => setSlope(slopeDown ? -p : p)}>
                {p}%
              </button>
            ))}
          </div>
          <div className={hint}>
            {slopePct === 0
              ? 'A nivel. Elegí una pendiente y los tramos horizontales salen inclinados (1% = 10 mm por metro).'
              : `Los tramos horizontales ${slopePct > 0 ? 'suben' : 'bajan'} ${Math.abs(slopePct) * 10} mm por metro en el sentido en que trazás.`}
          </div>
        </>
      )}

      {tool === 'offset' && (
        <>
          <div className="flex items-center gap-1.5">
            {offsetAxes.map(({ name, i }) => (
              <label key={name} className="flex-1 min-w-0 flex items-center gap-1 text-xs font-mono font-bold text-slate-300">
                {name}
                <input
                  type="number"
                  inputMode="decimal"
                  value={offsetValues[i]}
                  onChange={(e) => {
                    const next = [...offsetValues] as [string, string, string];
                    next[i] = e.target.value;
                    setOffsetValues(next);
                  }}
                  placeholder="0"
                  className={field}
                  aria-label={`Corrimiento en ${name} en milímetros (negativo hacia el otro lado)`}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-slate-400 mr-1">Codos</span>
            {[30, 45, 60, 90].map((a) => (
              <button key={a} type="button" className={`${opt(offsetAngle === a)} flex-1`} onClick={() => setOffsetAngle(a)}>
                {a}°
              </button>
            ))}
            <button
              type="button"
              className={go}
              disabled={!openPort || !offsetPlan || 'error' in offsetPlan}
              onClick={() => {
                vibrate(25);
                applyOffset(offsetVector, offsetAngle);
              }}
            >
              DESVIAR
            </button>
          </div>
          <div className={hint}>
            {!openPort
              ? 'Tocá primero la boca libre desde la que sale la línea.'
              : offsetPlan && !('error' in offsetPlan)
                ? `Corre ${Math.round(offsetPlan.offset)} mm: diagonal de ${Math.round(offsetPlan.travelLength)} mm entre vértices y avanza ${Math.round(offsetPlan.advance)} mm. La línea sigue en la misma dirección.`
                : 'Cuánto se corre la línea en cada eje (mm, negativo hacia el otro lado). Con dos ejes es un desvío rodado.'}
          </div>
        </>
      )}

      {tool === 'elev' && (
        <>
          <div className="flex items-center gap-1">
            <input
              type="number"
              inputMode="decimal"
              value={elevTarget}
              onChange={(e) => setElevTarget(e.target.value)}
              placeholder="Elevación mm"
              className={field}
              aria-label="Elevación de destino en milímetros"
            />
            {(['BOP', 'CL', 'TOP'] as const).map((r) => (
              <button key={r} type="button" className={opt(elevRef === r)} onClick={() => setElevRef(r)}>
                {r === 'CL' ? 'Eje' : r}
              </button>
            ))}
            <button
              type="button"
              className={go}
              disabled={!openPort || elevTarget === '' || Number.isNaN(parseFloat(elevTarget))}
              onClick={() => {
                vibrate();
                goToElevation(parseFloat(elevTarget), elevRef);
              }}
            >
              IR
            </button>
          </div>
          <div className={hint}>
            {openPort
              ? `Boca activa: eje ${Math.round(openPort.position.z)} · BOP ${Math.round(openPort.position.z - openPort.outerDiameter / 2)} · TOP ${Math.round(
                  openPort.position.z + openPort.outerDiameter / 2
                )} mm. IR arma el tramo vertical; después tocá TRAZAR.`
              : 'Tocá primero la boca libre desde la que sale la línea.'}
          </div>
        </>
      )}

      {tool === 'coord' && (
        <>
          {openPort ? (
            <div className="text-xs font-mono text-slate-200 leading-relaxed" data-port-info>
              <span className="text-red-400">X {Math.round(openPort.position.x)}</span> · <span className="text-emerald-400">Y {Math.round(openPort.position.y)}</span> ·{' '}
              <span className="text-sky-400">Z {Math.round(openPort.position.z)}</span>
              <span className="text-slate-400">
                {' '}
                — {openPort.nominalDiameter}&quot; · eje {Math.round(openPort.position.z)}
                {Math.abs(openPort.direction.z) < 0.9
                  ? ` · fondo ${Math.round(openPort.position.z - openPort.outerDiameter / 2)} · lomo ${Math.round(openPort.position.z + openPort.outerDiameter / 2)}`
                  : ' · boca vertical'}
              </span>
            </div>
          ) : (
            <div className={hint}>Tocá una boca libre para ver su coordenada y elevación.</div>
          )}
          <div className="flex items-center gap-1">
            {(['X', 'Y', 'Z'] as const).map((name, i) => (
              <input
                key={name}
                type="number"
                inputMode="decimal"
                value={coord[i]}
                onChange={(e) => setCoord(coord.map((v, j) => (j === i ? e.target.value : v)) as [string, string, string])}
                placeholder={name}
                className={field}
                aria-label={`Coordenada ${name} de destino en milímetros`}
              />
            ))}
            <button
              type="button"
              className={go}
              disabled={!openPort || coord.some((v) => v === '' || Number.isNaN(parseFloat(v)))}
              onClick={() => {
                vibrate();
                usePipingStore.getState().goToCoordinate(new THREE.Vector3(parseFloat(coord[0]), parseFloat(coord[1]), parseFloat(coord[2])));
              }}
            >
              IR
            </button>
          </div>
          <div className={hint}>IR traza los tramos a 90° hasta esa coordenada (mm). Se deshace de un solo paso.</div>
        </>
      )}
    </div>
  );

  const keyCls = `${phone ? 'h-11' : 'h-9'} rounded-lg border font-bold active:bg-slate-700`;
  const digit = (d: string) => (
    <button
      key={d}
      type="button"
      onClick={() => {
        vibrate();
        appendDigit(d);
      }}
      className={`${keyCls} bg-[#252a34] text-sm text-slate-100 border-[#383f4d]`}
    >
      {d}
    </button>
  );
  const plus = (n: number) => (
    <button
      key={`p${n}`}
      type="button"
      onClick={() => {
        vibrate(12);
        quickAdd(n);
      }}
      className={`${keyCls} bg-slate-800 text-xs text-cyan-300 border-cyan-900/60`}
    >
      +{n}
    </button>
  );

  const body = (
    <>
      {needsPort && pickPortNotice}
      {axisRow}
      {connectChooser || lengthBar}
      {toolsRow}
      {toolPanel}
      {/* Con una ayuda abierta se oculta esta fila para no tapar el modelo */}
      {!(tool && phone) && actionsRow}

      {showTouchKeys && (
        <div className="w-full grid grid-cols-4 gap-1.5 pt-1.5 border-t border-[#2e3440]">
          {['7', '8', '9'].map(digit)}
          {plus(100)}
          {['4', '5', '6'].map(digit)}
          {plus(500)}
          {['1', '2', '3'].map(digit)}
          {plus(1000)}
          <button
            type="button"
            onClick={() => {
              vibrate(15);
              clear();
            }}
            className={`${keyCls} bg-rose-950/50 text-xs text-rose-400 border-rose-900/60`}
          >
            C
          </button>
          {digit('0')}
          {digit('.')}
          <button
            type="button"
            onClick={() => {
              vibrate(15);
              backspace();
            }}
            className={`${keyCls} bg-amber-950/50 text-xs text-amber-400 border-amber-900/60`}
            aria-label="Borrar"
          >
            ⌫
          </button>
        </div>
      )}
    </>
  );

  if (embedded) return <div className="flex flex-col items-center gap-2 w-full">{body}</div>;
  // En el teléfono Trazar está en la barra de abajo (ContextDock)
  if (phone) return null;

  return (
    <FloatingPalette
      paletteId="numpad"
      title="Trazar"
      icon={phone ? undefined : '⌨'}
      badge={
        <span className="px-1.5 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-sky-300 font-mono font-bold text-[9px]">
          [{activeDirection.x.toFixed(0)},{activeDirection.y.toFixed(0)},{activeDirection.z.toFixed(0)}] • {nominalDiameter}&quot;
        </span>
      }
      bodyClassName="p-2.5 flex flex-col items-center gap-1.5 w-[92vw] max-w-[540px]"
      sheetBodyClassName="p-2 flex flex-col items-center gap-2 w-full"
    >
      {body}
    </FloatingPalette>
  );
};
