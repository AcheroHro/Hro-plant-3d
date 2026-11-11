import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Anchor, ArrowLeftRight, ClipboardList, Diameter, Eye, CopyPlus, GitBranch, MessageSquarePlus, Replace, RotateCw, Scissors, Trash2, Waypoints } from 'lucide-react';
import type { SupportKind } from '../types/piping';
import { usePipingStore } from '../store/usePipingStore';
import { sameSizeRun } from '../core/graph/resizeRun';
import { useProjectStore } from '../store/useProjectStore';
import { useUiConfigStore } from '../store/useUiConfigStore';
import { usePhoneLayout, vibrate } from './useIsPhone';
import { pieceName } from '../core/pieceNames';

const BRANCH_AXES: { label: string; v: [number, number, number]; cls: string }[] = [
  { label: '+X', v: [1, 0, 0], cls: 'text-red-400' },
  { label: '−X', v: [-1, 0, 0], cls: 'text-red-400' },
  { label: '+Y', v: [0, 1, 0], cls: 'text-emerald-400' },
  { label: '−Y', v: [0, -1, 0], cls: 'text-emerald-400' },
  { label: '+Z', v: [0, 0, 1], cls: 'text-sky-400' },
  { label: '−Z', v: [0, 0, -1], cls: 'text-sky-400' }
];

const SUPPORT_KINDS: { kind: SupportKind; label: string }[] = [
  { kind: 'APOYO', label: 'Apoyo' },
  { kind: 'GUIA', label: 'Guía' },
  { kind: 'ANCLAJE', label: 'Anclaje' },
  { kind: 'COLGANTE', label: 'Colgante' }
];

interface SubstituteOption {
  key: string;
  label: string;
  familyId: string;
  angle?: number;
}

/** Menú que aparece en el lugar al mantener apretada una pieza del modelo */
export const PieceMenu: React.FC = () => {
  const menu = usePipingStore((s) => s.pieceMenu);
  const graph = usePipingStore((s) => s.graph);
  const specReader = usePipingStore((s) => s.specReader);
  const close = usePipingStore((s) => s.closePieceMenu);
  const isolation = usePipingStore((s) => s.isolation);
  const phone = usePhoneLayout();
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [showSubstitute, setShowSubstitute] = useState(false);
  const [section, setSection] = useState<'branch' | 'support' | 'size' | null>(null);
  const [runNd, setRunNd] = useState<number | null>(null);
  const [branchNd, setBranchNd] = useState<number | null>(null);

  const comp = menu ? graph.components.get(menu.componentId) : undefined;

  // El menú se abre junto al dedo, sin salirse de la pantalla
  useLayoutEffect(() => {
    setShowSubstitute(false);
    setSection(null);
    setBranchNd(null);
    setRunNd(null);
    if (!menu || !boxRef.current) return setPos(null);
    const { offsetWidth: w, offsetHeight: h } = boxRef.current;
    setPos({
      left: Math.max(8, Math.min(menu.x - w / 2, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(menu.y + 16, window.innerHeight - h - 8))
    });
  }, [menu]);

  useLayoutEffect(() => {
    if (!menu || !boxRef.current || !pos) return;
    const h = boxRef.current.offsetHeight;
    const top = Math.max(8, Math.min(pos.top, window.innerHeight - h - 8));
    if (top !== pos.top) setPos({ ...pos, top });
  }, [showSubstitute, section, menu, pos]);

  const substitutes = useMemo<SubstituteOption[]>(() => {
    if (!comp || !specReader) return [];
    const nd = comp.ports[0]?.nominalDiameter || comp.parameters.nominalDiameter;
    const currentFamily = comp.parameters.familyId;
    if (comp.type === 'ELBOW') {
      const currentAngle = Math.abs((comp.parameters.angle || 90) - 45) < 15 ? 45 : 90;
      return specReader.listFamilies('ELBOW', nd).flatMap((fam) =>
        [90, 45]
          .filter((a) => fam.angles.some((x) => Math.abs(x - a) < 1) && !(fam.familyId === currentFamily && a === currentAngle))
          .map((a) => ({ key: `${fam.familyId}-${a}`, label: `${a}° · ${fam.familyDesc}`, familyId: fam.familyId, angle: a }))
      );
    }
    if (comp.type === 'VALVE') {
      const end = comp.ports[0]?.plantEndType;
      return specReader
        .listFamilies('VALVE', nd)
        .filter((fam) => fam.familyId !== currentFamily && (!end || fam.endTypes[0] === end))
        .map((fam) => ({ key: fam.familyId, label: fam.familyDesc, familyId: fam.familyId }));
    }
    return [];
  }, [comp, specReader]);

  if (!menu || !comp) return null;

  const store = usePipingStore.getState;
  const run = (fn: () => void) => () => {
    vibrate(12);
    close();
    fn();
  };
  const item = 'w-full min-h-[44px] px-3 flex items-center gap-3 text-sm text-slate-100 text-left active:bg-[#2b3240] hover:bg-[#252b37]';
  const nd = comp.ports[0]?.nominalDiameter || comp.parameters.nominalDiameter;
  const offset = menu.offsetMm !== undefined ? Math.round(menu.offsetMm / 10) * 10 : undefined;

  // Derivación y soportes: solo sobre caños, en el punto donde se apretó
  const isPipe = comp.type === 'PIPE' && comp.ports.length >= 2 && offset !== undefined;
  const pipeAxis = isPipe ? comp.ports[1].position.clone().sub(comp.ports[0].position).normalize() : null;
  const pressPoint = isPipe && pipeAxis ? comp.ports[0].position.clone().addScaledVector(pipeAxis, menu.offsetMm ?? 0) : null;
  const branchSizes = isPipe && specReader ? specReader.getAvailableNominalDiameters().filter((n) => n <= nd + 1e-6) : [];
  const branchSize = branchNd ?? branchSizes.filter((n) => n < nd).pop() ?? branchSizes[branchSizes.length - 1];
  const branchAxes = pipeAxis ? BRANCH_AXES.filter((a) => Math.abs(new THREE.Vector3(...a.v).dot(pipeAxis)) < 0.5) : [];
  const nearSupport = isPipe && pressPoint ? graph.supportNear(comp.id, pressPoint) : null;
  const toggleSection = (name: 'branch' | 'support' | 'size') => () => {
    vibrate();
    setSection(section === name ? null : name);
  };
  const cell = 'h-11 rounded-lg bg-[#212631] border border-[#343c4c] text-xs font-bold active:bg-[#2b3240]';
  const flipKind = graph.flipKind(comp.id);
  // Cambiar el diámetro de todo el tramo del mismo diámetro
  const sizeRun = section === 'size' ? sameSizeRun(graph, comp.id) : null;
  const runSizes = sizeRun && specReader ? specReader.getAvailableNominalDiameters().filter((n) => Math.abs(n - sizeRun.nd) > 1e-6) : [];
  const runTarget = runNd ?? runSizes.find((n) => sizeRun && n > sizeRun.nd) ?? runSizes[runSizes.length - 1];

  const openProperties = () => {
    const ui = useUiConfigStore.getState();
    if (phone) ui.setMobilePanel('propiedades', false);
    else {
      ui.togglePaletteOpen('properties', true);
      ui.togglePaletteCollapsed('properties', false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[59]" onPointerDown={close} />
      <div
        ref={boxRef}
        role="menu"
        style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden', touchAction: 'pan-y' }}
        className="fixed z-[60] w-64 max-h-[70vh] overflow-y-auto rounded-xl bg-[#161a22] border border-[#3a4254] shadow-2xl py-1 pointer-events-auto"
      >
        <div className="px-3 py-2 border-b border-[#2b313d]">
          <div className="text-xs font-bold text-[#38bdf8]">
            {pieceName(comp.type)} {nd}&quot;
          </div>
          {comp.parameters.description && <div className="text-[11px] text-slate-400 truncate">{comp.parameters.description}</div>}
        </div>

        <button type="button" role="menuitem" className={item} onClick={run(openProperties)}>
          <ClipboardList size={18} className="text-slate-300 shrink-0" />
          Propiedades
        </button>

        {(comp.type === 'ELBOW' || comp.type === 'TEE') && (
          <button type="button" role="menuitem" className={item} onClick={run(() => store().rotateSelectedComponent(90))}>
            <RotateCw size={18} className="text-amber-300 shrink-0" />
            Girar 90°
          </button>
        )}

        {comp.type === 'VALVE' && comp.parameters.visual?.actuator !== 'none' && (
          <button type="button" role="menuitem" className={item} onClick={run(() => store().rotateSelectedComponent(90))}>
            <RotateCw size={18} className="text-amber-300 shrink-0" />
            Girar el volante 90°
          </button>
        )}

        {flipKind && (
          <button type="button" role="menuitem" className={item} onClick={run(() => store().flipSelectedComponent())}>
            <ArrowLeftRight size={18} className="text-amber-300 shrink-0" />
            {flipKind === 'flange'
              ? 'Dar vuelta la brida'
              : flipKind === 'valve'
                ? 'Invertir el sentido'
                : `Pasar a plano ${graph.reducerFlatSide(comp.id) === 'abajo' ? 'arriba' : 'abajo'}`}
          </button>
        )}

        {comp.type === 'PIPE' && offset !== undefined && (
          <div className="px-3 py-2 border-y border-[#2b313d]">
            <div className="flex items-center gap-2 text-xs text-slate-300 mb-1.5">
              <Scissors size={16} className="text-emerald-300" />
              Partir a {offset} mm del inicio con
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(['TEE', 'VALVE', 'FLANGE'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="h-11 rounded-lg bg-[#212631] border border-[#343c4c] text-xs font-bold text-slate-100 active:bg-[#2b3240]"
                  onClick={run(() => store().splitSelectedPipeWithFitting(t, offset))}
                >
                  {pieceName(t)}
                </button>
              ))}
            </div>
          </div>
        )}

        {isPipe && branchSizes.length > 0 && (
          <>
            <button type="button" role="menuitem" aria-expanded={section === 'branch'} className={item} onClick={toggleSection('branch')}>
              <GitBranch size={18} className="text-emerald-300 shrink-0" />
              <span className="flex-1">Derivación (olet o injerto)</span>
              <span className="text-slate-500">{section === 'branch' ? '▴' : '▾'}</span>
            </button>
            {section === 'branch' && (
              <div className="px-3 py-2 bg-[#111419] border-y border-[#2b313d] space-y-1.5">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  Ramal de
                  <select
                    value={branchSize}
                    onChange={(e) => setBranchNd(parseFloat(e.target.value))}
                    className="h-10 flex-1 px-2 rounded-lg bg-[#1b1f26] border border-[#343c4c] text-sm font-mono font-bold text-sky-300"
                    aria-label="Diámetro del ramal"
                  >
                    {branchSizes.map((n) => (
                      <option key={n} value={n}>
                        {n}&quot;
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['purga', 'venteo'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={`${cell} text-emerald-200`}
                      title="Derivación chica con niple, válvula y tapa, armada de un toque"
                      onClick={run(() => store().addDrainOrVent(comp.id, menu.offsetMm ?? 0, kind))}
                    >
                      {kind === 'purga' ? 'Purga ↓ armada' : 'Venteo ↑ armado'}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-slate-400">Sale a {offset} mm del inicio, hacia:</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {branchAxes.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      className={`${cell} font-mono ${a.cls}`}
                      onClick={run(() => store().addBranchOnPipe(comp.id, menu.offsetMm ?? 0, new THREE.Vector3(...a.v), branchSize))}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button type="button" role="menuitem" aria-expanded={section === 'support'} className={item} onClick={toggleSection('support')}>
              <Anchor size={18} className="text-yellow-300 shrink-0" />
              <span className="flex-1">Soporte</span>
              <span className="text-slate-500">{section === 'support' ? '▴' : '▾'}</span>
            </button>
            {section === 'support' && (
              <div className="px-3 py-2 bg-[#111419] border-y border-[#2b313d] space-y-1.5">
                <div className="text-[11px] text-slate-400">Marcar a {offset} mm del inicio:</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {SUPPORT_KINDS.map((k) => (
                    <button
                      key={k.kind}
                      type="button"
                      className={`${cell} text-slate-100`}
                      onClick={run(() => store().addSupportOnPipe(comp.id, offset ?? 0, k.kind))}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                {nearSupport && (
                  <button
                    type="button"
                    className={`${cell} w-full !border-rose-500/50 text-rose-300`}
                    onClick={run(() => store().removeSupport(nearSupport.id))}
                  >
                    Quitar el soporte de acá
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {substitutes.length > 0 && (
          <>
            <button
              type="button"
              role="menuitem"
              aria-expanded={showSubstitute}
              className={item}
              onClick={() => {
                vibrate();
                setShowSubstitute(!showSubstitute);
              }}
            >
              <Replace size={18} className="text-sky-300 shrink-0" />
              <span className="flex-1">Sustituir por…</span>
              <span className="text-slate-500">{showSubstitute ? '▴' : '▾'}</span>
            </button>
            {showSubstitute && (
              <div className="bg-[#111419] border-y border-[#2b313d]">
                {substitutes.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`${item} !text-xs pl-10`}
                    onClick={run(() => store().substituteSelected(opt.familyId, opt.angle))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {specReader && comp.type !== 'CROSS' && comp.type !== 'INSTRUMENT' && (
          <>
            <button type="button" role="menuitem" aria-expanded={section === 'size'} className={item} onClick={toggleSection('size')}>
              <Diameter size={18} className="text-sky-300 shrink-0" />
              <span className="flex-1">Cambiar diámetro del tramo</span>
              <span className="text-slate-500">{section === 'size' ? '▴' : '▾'}</span>
            </button>
            {section === 'size' && sizeRun && (
              <div className="px-3 py-2 bg-[#111419] border-y border-[#2b313d] space-y-1.5">
                <div className="text-[11px] text-slate-400">
                  {sizeRun.ids.length} pieza{sizeRun.ids.length > 1 ? 's' : ''} seguida{sizeRun.ids.length > 1 ? 's' : ''} de {sizeRun.nd}&quot;. Los ejes no se mueven: los caños
                  absorben la diferencia.
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={runTarget}
                    onChange={(e) => setRunNd(parseFloat(e.target.value))}
                    className="h-11 flex-1 min-w-0 px-2 rounded-lg bg-[#1b1f26] border border-[#343c4c] text-sm font-mono font-bold text-sky-300"
                    aria-label="Diámetro nuevo del tramo"
                  >
                    {runSizes.map((n) => (
                      <option key={n} value={n}>
                        {n}&quot;
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`${cell} px-3 !bg-sky-600 !border-sky-300 text-white`}
                    disabled={runTarget === undefined}
                    onClick={run(() => runTarget !== undefined && store().changeRunDiameter(runTarget))}
                  >
                    Cambiar
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={run(() => useProjectStore.setState({ isFieldOpen: true, fieldTabRequest: 'NOTAS' }))}
        >
          <MessageSquarePlus size={18} className="text-orange-300 shrink-0" />
          Nota de campo
        </button>

        <button type="button" role="menuitem" className={item} onClick={run(() => store().toggleMultiMode(true))}>
          <CopyPlus size={18} className="text-violet-300 shrink-0" />
          Seleccionar varias
        </button>

        <button type="button" role="menuitem" className={item} onClick={run(() => store().selectConnectedRun())}>
          <Waypoints size={18} className="text-violet-300 shrink-0" />
          Toda la línea conectada
        </button>

        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={run(() => (isolation ? store().clearIsolation() : store().isolateRun(comp.id)))}
        >
          <Eye size={18} className="text-amber-300 shrink-0" />
          {isolation ? 'Ver todo el modelo' : 'Aislar esta línea'}
        </button>

        <button type="button" role="menuitem" className={`${item} !text-rose-300 border-t border-[#2b313d]`} onClick={run(() => store().deleteSelectedComponent())}>
          <Trash2 size={18} className="shrink-0" />
          Borrar
        </button>
      </div>
    </>
  );
};
