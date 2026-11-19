import React, { useState } from 'react';
import * as THREE from 'three';
import { Box, Compass, Eye, EyeOff, Factory, Flame, Focus, Layers, Palette, Pencil, RotateCw, Sun, Trash2 } from 'lucide-react';
import { IconCajaCorte, IconCotas, IconEncuadrar, IconMedir, IconPlanoDxf } from './icons/ActionIcons';
import { useUiConfigStore, VisualStyle } from '../store/useUiConfigStore';
import { useReferenceStore } from '../store/useReferenceStore';
import { useEquipmentStore } from '../store/useEquipmentStore';
import { EQUIPMENT_PRESETS, EquipmentKind, nozzleWorldPose } from '../core/equipment/equipmentCatalog';
import { usePipingStore, lineOf } from '../store/usePipingStore';
import { colorForLine, colorHexCss } from '../viewport/spoolColors';
import { FloatingPalette } from './FloatingPalette';

const VISUAL_STYLES: { id: VisualStyle; label: string; title: string }[] = [
  { id: 'shaded', label: 'Sólido', title: 'Sombreado técnico estándar' },
  { id: 'xray', label: 'Rayos X', title: 'Translúcido para ver choques y piezas tapadas' },
  { id: 'wireframe', label: 'Alambre', title: 'Alámbrico CAD ligero' },
  { id: 'outdoor', label: 'Sol', title: 'Fondo claro de alto contraste para exteriores' }
];

const INSULATION_PRESETS = [25, 50, 75, 100];

export const TouchCompass: React.FC = () => {
  const activeDirection = usePipingStore((s) => s.activeDirection);
  const setActiveDirection = usePipingStore((s) => s.setActiveDirection);
  const setCameraViewPreset = usePipingStore((s) => s.setCameraViewPreset);
  const graph = usePipingStore((s) => s.graph);
  usePipingStore((s) => s.version);
  const isolation = usePipingStore((s) => s.isolation);
  const hiddenLines = usePipingStore((s) => s.hiddenLines);
  const measureActive = usePipingStore((s) => s.measureActive);
  const measurePoints = usePipingStore((s) => s.measurePoints);
  const sectionBox = usePipingStore((s) => s.sectionBox);
  const store = usePipingStore.getState;
  const showLabels = useUiConfigStore((s) => s.showLabels);
  const cameraProjection = useUiConfigStore((s) => s.cameraProjection);
  const visualStyle = useUiConfigStore((s) => s.visualStyle);
  const colorByLine = useUiConfigStore((s) => s.colorByLine);
  const showPlantCompass = useUiConfigStore((s) => s.showPlantCompass);
  const showInsulation = useUiConfigStore((s) => s.showInsulation);
  const insulationThicknessMm = useUiConfigStore((s) => s.insulationThicknessMm);
  const reference = useReferenceStore((s) => s.reference);
  const referenceNote = useReferenceStore((s) => s.note);
  const equipmentItems = useEquipmentStore((s) => s.items);
  const [editingEqId, setEditingEqId] = useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Líneas presentes en el modelo con su conteo de piezas (Gestor de Líneas tipo capas)
  const lineCounts = new Map<string, number>();
  for (const c of graph.components.values()) {
    const l = lineOf(graph, c);
    if (l) lineCounts.set(l, (lineCounts.get(l) ?? 0) + 1);
  }
  const lines = Array.from(lineCounts.keys()).sort();
  const hasFilter = Boolean(isolation) || hiddenLines.size > 0;
  const toggle = (on: boolean) =>
    `flex-1 min-w-0 py-1.5 rounded border text-[9px] font-bold flex flex-col items-center gap-0.5 active:scale-95 transition-all ${
      on ? 'bg-amber-500 text-black border-amber-200' : 'bg-[#252a34] text-slate-200 border-[#3a4150]'
    }`;
  const small = 'flex-1 min-w-0 rounded bg-[#252a34] border border-[#3a4150] text-[10px] font-mono font-bold text-slate-200 active:scale-95';

  const handleAxisSelect = (x: number, y: number, z: number) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(10);
      } catch {
        // Ignorar si el navegador no permite
      }
    }
    setActiveDirection(new THREE.Vector3(x, y, z));
  };

  const isCurrent = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).normalize();
    return (
      Math.abs(v.x - activeDirection.x) < 0.05 &&
      Math.abs(v.y - activeDirection.y) < 0.05 &&
      Math.abs(v.z - activeDirection.z) < 0.05
    );
  };

  const getActiveLabel = () => {
    if (isCurrent(1, 0, 0)) return '+X';
    if (isCurrent(-1, 0, 0)) return '-X';
    if (isCurrent(0, 1, 0)) return '+Y';
    if (isCurrent(0, -1, 0)) return '-Y';
    if (isCurrent(0, 0, 1)) return '+Z';
    if (isCurrent(0, 0, -1)) return '-Z';
    return `[${activeDirection.x.toFixed(1)},${activeDirection.y.toFixed(1)}]`;
  };

  return (
    <FloatingPalette
      paletteId="compass"
      title="Vistas y dirección"
      icon="🧊"
      badge={
        <span className="px-1.5 py-0.2 rounded bg-[#0696d7]/20 border border-[#38bdf8]/40 text-[#38bdf8] font-mono font-black text-[9px]">
          {getActiveLabel()}
        </span>
      }
      bodyClassName="p-2 flex flex-col items-center w-44 max-h-[78vh] overflow-y-auto"
      sheetBodyClassName="p-3 flex flex-col items-center w-full max-w-[22rem] mx-auto [&_button]:min-h-[42px] [&_button]:text-xs [&_span]:text-[11px]"
    >
      {/* Ayudas de vista: encuadrar, medir, caja de corte, etiquetas, proyección y color por línea */}
      <div className="w-full space-y-1.5 mb-1.5 pb-1.5 border-b border-[#2e3440]">
        <div className="flex gap-1 w-full">
          <button type="button" className={toggle(false)} onClick={() => store().frameAll()} title="Encuadrar todo el modelo">
            <IconEncuadrar size={18} />
            Encuadrar
          </button>
          <button
            type="button"
            className={toggle(measureActive)}
            aria-pressed={measureActive}
            onClick={() => store().toggleMeasure()}
            title="Medir entre dos puntos tocando el modelo"
          >
            <IconMedir size={18} />
            Medir
          </button>
          <button
            type="button"
            className={toggle(!!sectionBox)}
            aria-pressed={!!sectionBox}
            onClick={() => (sectionBox ? store().clearSection() : store().setSectionAround(1000))}
            title="Caja de corte: dibuja solo lo que está cerca de la pieza elegida"
          >
            <IconCajaCorte size={18} />
            Corte
          </button>
        </div>

        <div className="flex gap-1 w-full">
          <button
            type="button"
            className={toggle(showLabels)}
            aria-pressed={showLabels}
            onClick={() => useUiConfigStore.getState().toggleLabels()}
            title="Cotas de los caños, elevaciones y número de línea sobre el modelo"
          >
            <IconCotas size={18} />
            Etiquetas
          </button>
          <button
            type="button"
            className={toggle(cameraProjection === 'orthographic')}
            aria-pressed={cameraProjection === 'orthographic'}
            onClick={() => useUiConfigStore.getState().toggleCameraProjection()}
            title="Alternar cámara Ortográfica (sin distorsión CAD) / Perspectiva"
          >
            <Box size={18} />
            {cameraProjection === 'orthographic' ? 'Orto' : 'Persp'}
          </button>
          <button
            type="button"
            className={toggle(colorByLine)}
            aria-pressed={colorByLine}
            onClick={() => useUiConfigStore.getState().toggleColorByLine()}
            title="Colorear cada cañería según su número de línea (estilo Plant 3D)"
          >
            <Palette size={18} />
            Líneas
          </button>
        </div>

        {/* Estilos visuales CAD (Sólido / Rayos X / Alambre / Sol exterior) */}
        <div className="w-full">
          <div className="grid grid-cols-4 gap-1 w-full" role="group" aria-label="Estilo visual">
            {VISUAL_STYLES.map((st) => {
              const active = visualStyle === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  aria-pressed={active}
                  title={st.title}
                  onClick={() => useUiConfigStore.getState().setVisualStyle(st.id)}
                  className={`py-1 px-1 rounded border text-[9px] font-bold flex items-center justify-center gap-0.5 active:scale-95 transition-all ${
                    active ? 'bg-[#0696d7] text-white border-[#7dd3fc]' : 'bg-[#252a34] text-slate-300 border-[#3a4150]'
                  }`}
                >
                  {st.id === 'outdoor' && <Sun size={11} className="shrink-0" />}
                  <span className="truncate">{st.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-1 w-full">
          <button
            type="button"
            className={toggle(showPlantCompass)}
            aria-pressed={showPlantCompass}
            onClick={() => useUiConfigStore.getState().togglePlantCompass()}
            title="Compás circular graduado de Plant 3D sobre la boca activa (cada 15° y snap a 45°)"
          >
            <Compass size={18} />
            Compás
          </button>
          <button
            type="button"
            className={toggle(showInsulation)}
            aria-pressed={showInsulation}
            onClick={() => useUiConfigStore.getState().toggleInsulation()}
            title="Mostrar envolvente translúcida de aislación térmica sobre cañerías (Plant 3D)"
          >
            <Flame size={18} />
            Aislación
          </button>
          <button
            type="button"
            className={toggle(!!reference?.visible)}
            aria-pressed={!!reference?.visible}
            onClick={() => (reference ? useReferenceStore.getState().setVisible(!reference.visible) : fileRef.current?.click())}
            title="Referencia de obra: un DXF de ejes y columnas dibujado de fondo"
          >
            <IconPlanoDxf size={18} />
            {reference ? 'Ref.' : 'DXF'}
          </button>
        </div>
        {showInsulation && (
          <div className="w-full flex items-center gap-1 bg-[#14171d] border border-[#2e3440] rounded-lg px-1.5 py-1" data-insulation-bar>
            <span className="text-[9px] text-amber-300 font-bold uppercase shrink-0">Esp:</span>
            <div className="grid grid-cols-4 gap-1 flex-1">
              {INSULATION_PRESETS.map((mm) => (
                <button
                  key={mm}
                  type="button"
                  aria-pressed={insulationThicknessMm === mm}
                  onClick={() => useUiConfigStore.getState().setInsulationThickness(mm)}
                  className={`py-0.5 !min-h-[24px] rounded border text-[9px] font-mono font-bold ${
                    insulationThicknessMm === mm
                      ? 'bg-amber-500 text-black border-amber-200'
                      : 'bg-[#252a34] text-slate-300 border-[#3a4150]'
                  }`}
                >
                  {mm}
                </button>
              ))}
            </div>
            <span className="text-[9px] text-slate-400 shrink-0">mm</span>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".dxf,.dwg"
          className="hidden"
          aria-label="Archivo DXF de referencia"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            useReferenceStore.getState().importDxf(await file.text(), file.name);
            // Con el modelo vacío se encuadra la referencia recién cargada
            if (store().graph.components.size === 0) store().frameAll();
          }}
        />
        {reference && (
          <div className="flex gap-1 items-stretch w-full" data-reference-row>
            <select
              value={String(reference.scale)}
              onChange={(e) => useReferenceStore.getState().setScale(parseFloat(e.target.value))}
              className="flex-1 min-w-0 min-h-[32px] px-1 rounded border bg-[#1b1f26] border-[#3a4150] text-[10px] font-mono font-bold text-slate-200"
              aria-label="Unidad del dibujo de referencia"
              title={reference.name}
            >
              {[1, 10, 25.4, 304.8, 1000].map((s) => (
                <option key={s} value={String(s)}>
                  {s === 1 ? 'en mm' : s === 10 ? 'en cm' : s === 1000 ? 'en m' : s === 25.4 ? 'en pulgadas' : 'en pies'}
                </option>
              ))}
            </select>
            <button type="button" className={`${small} px-1`} onClick={() => fileRef.current?.click()} title="Cargar otro DXF">
              Otro
            </button>
            <button type="button" className={`${small} px-1 !text-rose-300`} onClick={() => useReferenceStore.getState().clear()} title="Quitar la referencia del proyecto">
              Quitar
            </button>
          </div>
        )}
        {referenceNote && <div className="text-[10px] leading-snug text-slate-300" data-reference-note>{referenceNote}</div>}

        {/* Equipos de proceso, Pipe Racks y boquillas conectables (estilo AutoCAD Plant 3D) */}
        <div className="w-full rounded-lg bg-[#14171d] border border-[#2e3440] p-1.5 space-y-1.5" data-equipment-panel>
          <div className="flex items-center justify-between gap-1 px-0.5">
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-300">
              <Factory size={11} className="text-amber-400" />
              Equipos y Racks ({equipmentItems.length})
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {(['vertical_tank', 'horizontal_vessel', 'centrifugal_pump', 'pipe_rack'] as EquipmentKind[]).map((kind) => {
              const preset = EQUIPMENT_PRESETS[kind];
              const shortLabel =
                kind === 'vertical_tank'
                  ? '+ Tanque'
                  : kind === 'horizontal_vessel'
                    ? '+ Recipiente'
                    : kind === 'centrifugal_pump'
                      ? '+ Bomba'
                      : '+ Pipe Rack';
              return (
                <button
                  key={kind}
                  type="button"
                  title={preset.description}
                  onClick={() => {
                    const created = useEquipmentStore.getState().addEquipment(kind);
                    usePipingStore.setState({
                      statusMessage:
                        kind === 'pipe_rack'
                          ? `Pipe Rack ${created.tag} colocado (BOP ${created.beamLevelsMm?.join(' / ')} mm).`
                          : `${preset.label} ${created.tag} colocado. Tocá una boquilla para rutear.`
                    });
                    if (store().graph.components.size === 0) store().frameAll();
                  }}
                  className="py-1 px-1.5 !min-h-[30px] rounded bg-[#212631] border border-[#3a4150] text-[10px] font-bold text-slate-200 active:scale-95 hover:border-amber-400/60"
                >
                  {shortLabel}
                </button>
              );
            })}
          </div>
          {equipmentItems.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
              {equipmentItems.map((eq) => {
                const isEditing = editingEqId === eq.id;
                return (
                  <div
                    key={eq.id}
                    className={`rounded border px-1.5 py-1 space-y-1 ${
                      eq.visible ? 'bg-[#1b1f27] border-[#2e3543]' : 'bg-[#15181e] border-[#252a34] opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-mono font-bold text-amber-300 truncate">{eq.tag}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          aria-label={`Editar ${eq.tag}`}
                          aria-pressed={isEditing}
                          title="Editar tag y coordenadas X/Y/Z"
                          onClick={() => setEditingEqId(isEditing ? null : eq.id)}
                          className={`w-6 h-6 !min-h-0 rounded border flex items-center justify-center ${
                            isEditing
                              ? 'bg-[#0b3550] border-[#38bdf8] text-[#38bdf8]'
                              : 'bg-[#252a34] border-[#3a4150] text-slate-200'
                          }`}
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Girar 90° ${eq.tag}`}
                          title="Girar 90°"
                          onClick={() => useEquipmentStore.getState().rotateEquipment(eq.id, 90)}
                          className="w-6 h-6 !min-h-0 rounded bg-[#252a34] border border-[#3a4150] text-slate-200 flex items-center justify-center"
                        >
                          <RotateCw size={11} />
                        </button>
                        <button
                          type="button"
                          aria-label={eq.visible ? `Ocultar ${eq.tag}` : `Mostrar ${eq.tag}`}
                          title={eq.visible ? 'Ocultar equipo' : 'Mostrar equipo'}
                          onClick={() => useEquipmentStore.getState().toggleVisible(eq.id)}
                          className="w-6 h-6 !min-h-0 rounded bg-[#252a34] border border-[#3a4150] text-slate-200 flex items-center justify-center"
                        >
                          {eq.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                        </button>
                        <button
                          type="button"
                          aria-label={`Eliminar ${eq.tag}`}
                          title="Eliminar equipo"
                          onClick={() => {
                            if (isEditing) setEditingEqId(null);
                            useEquipmentStore.getState().removeEquipment(eq.id);
                          }}
                          className="w-6 h-6 !min-h-0 rounded bg-[#252a34] border border-rose-900/60 text-rose-300 flex items-center justify-center"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    {isEditing && (
                      <div className="pt-1 border-t border-[#2e3543] space-y-1">
                        <input
                          type="text"
                          aria-label={`Tag de ${eq.tag}`}
                          value={eq.tag}
                          onChange={(e) => useEquipmentStore.getState().updateEquipment(eq.id, { tag: e.target.value })}
                          className="w-full h-7 px-1.5 rounded bg-[#111419] border border-[#3a4150] text-[10px] font-mono font-bold text-amber-300 outline-none"
                        />
                        <div className="grid grid-cols-3 gap-1">
                          {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                            <label key={axis} className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-[9px] text-slate-400 font-mono">{axis} (mm)</span>
                              <input
                                type="number"
                                step={100}
                                aria-label={`${axis} de ${eq.tag}`}
                                value={eq.position[idx]}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  if (!Number.isFinite(v)) return;
                                  const nextPos: [number, number, number] = [...eq.position];
                                  nextPos[idx] = v;
                                  useEquipmentStore.getState().updateEquipment(eq.id, { position: nextPos });
                                }}
                                className="w-full h-7 px-1 rounded bg-[#111419] border border-[#3a4150] text-[10px] font-mono text-slate-100 outline-none"
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    {eq.nozzles.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {eq.nozzles.map((noz) => (
                          <button
                            key={noz.id}
                            type="button"
                            title={`Iniciar tramo desde ${eq.tag} · ${noz.tag} (${noz.nominalDiameter}")`}
                            onClick={() => {
                              const pose = nozzleWorldPose(eq, noz);
                              store().startFromNozzle(
                                pose.position,
                                pose.direction,
                                noz.nominalDiameter,
                                `${eq.tag} · ${noz.tag}`
                              );
                              useUiConfigStore.getState().setMobilePanel(null);
                            }}
                            className="px-1.5 py-0.5 !min-h-[24px] rounded bg-[#0b3550] border border-[#38bdf8]/60 text-[9px] font-mono font-bold text-[#7dd3fc] active:scale-95"
                          >
                            {noz.tag} {noz.nominalDiameter}"
                          </button>
                        ))}
                      </div>
                    )}
                    {eq.beamLevelsMm && eq.beamLevelsMm.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {eq.beamLevelsMm.map((lvl, idx) => {
                          const absBop = eq.position[2] + lvl;
                          return (
                            <button
                              key={idx}
                              type="button"
                              title={`Llevar la boca activa al nivel ${idx + 1} del rack (BOP ${absBop} mm)`}
                              onClick={() => {
                                store().goToElevation(absBop, 'BOP');
                                useUiConfigStore.getState().setMobilePanel(null);
                              }}
                              className="px-1.5 py-0.5 !min-h-[24px] rounded bg-[#1f2937] border border-emerald-500/50 text-[9px] font-mono font-bold text-emerald-300 active:scale-95"
                            >
                              N{idx + 1} BOP {absBop}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {measureActive && (
          <div className="text-[10px] leading-snug text-fuchsia-200">
            {measurePoints.length === 2
              ? `${Math.round(measurePoints[0].distanceTo(measurePoints[1]))} mm. Tocá otro punto para medir de nuevo.`
              : measurePoints.length === 1
                ? 'Tocá el segundo punto.'
                : 'Tocá dos puntos del modelo: se pega a bocas y ejes.'}
          </div>
        )}

        {/* Gestor de Líneas (Capas): ocultar/mostrar o aislar cada línea */}
        {lines.length > 0 && (
          <div className="w-full rounded-lg bg-[#14171d] border border-[#2e3440] p-1.5 space-y-1" data-line-manager>
            <div className="flex items-center justify-between gap-1 px-0.5">
              <span className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider text-slate-400">
                <Layers size={11} className="text-[#38bdf8]" />
                Líneas ({lines.length})
              </span>
              {hasFilter && (
                <button
                  type="button"
                  onClick={() => store().showAllLines()}
                  className="!min-h-0 px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/60 text-amber-200 !text-[9px] font-bold active:scale-95"
                >
                  Ver todas
                </button>
              )}
            </div>
            {isolation?.kind === 'run' && (
              <div className="flex items-center justify-between gap-1 px-1.5 py-1 rounded bg-amber-500/15 border border-amber-400/50 text-[10px] text-amber-200">
                <span className="truncate">Tramo aislado ({isolation.ids.length})</span>
                <button
                  type="button"
                  onClick={() => store().clearIsolation()}
                  className="!min-h-0 px-1.5 py-0.5 rounded bg-amber-500 text-black !text-[9px] font-black"
                >
                  Soltar
                </button>
              </div>
            )}
            <div className="max-h-36 overflow-y-auto space-y-1 pr-0.5">
              {lines.map((l) => {
                const isHidden = hiddenLines.has(l);
                const isIsolated = isolation?.kind === 'line' && isolation.line === l;
                const swatch = colorHexCss(colorForLine(l, lines));
                const count = lineCounts.get(l) ?? 0;
                return (
                  <div
                    key={l}
                    className={`flex items-center gap-1 px-1.5 py-1 rounded border text-[10px] ${
                      isIsolated
                        ? 'bg-amber-500/15 border-amber-400/60 text-amber-100'
                        : isHidden
                          ? 'bg-[#111419] border-[#262b35] text-slate-500'
                          : 'bg-[#1b1f26] border-[#323946] text-slate-200'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                      style={{ backgroundColor: swatch, opacity: isHidden ? 0.3 : 1 }}
                    />
                    <span className={`flex-1 min-w-0 font-mono font-bold truncate ${isHidden ? 'line-through' : ''}`} title={l}>
                      {l}
                    </span>
                    <span className="text-[9px] font-mono text-slate-400 shrink-0">{count}</span>
                    <button
                      type="button"
                      onClick={() => store().toggleLineHidden(l)}
                      aria-label={isHidden ? `Mostrar línea ${l}` : `Ocultar línea ${l}`}
                      title={isHidden ? 'Mostrar esta línea' : 'Ocultar esta línea'}
                      className={`!min-h-[28px] w-7 rounded flex items-center justify-center shrink-0 active:scale-95 ${
                        isHidden ? 'text-slate-500 bg-[#161920]' : 'text-slate-200 bg-[#252a34]'
                      }`}
                    >
                      {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => (isIsolated ? store().clearIsolation() : store().isolateLine(l))}
                      aria-label={isIsolated ? `Dejar de aislar ${l}` : `Aislar línea ${l}`}
                      title={isIsolated ? 'Mostrar todo' : 'Aislar solo esta línea'}
                      className={`!min-h-[28px] w-7 rounded flex items-center justify-center shrink-0 active:scale-95 ${
                        isIsolated ? 'bg-amber-500 text-black' : 'bg-[#252a34] text-sky-300'
                      }`}
                    >
                      <Focus size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {sectionBox && (
          <div className="space-y-1">
            <div className="flex gap-1 items-stretch">
              {[500, 1000, 2000].map((m) => (
                <button key={m} type="button" className={`${small} py-1`} onClick={() => store().setSectionAround(m)} title={`Caja a ${m} mm de la pieza elegida`}>
                  {m / 1000} m
                </button>
              ))}
            </div>
            {(['X', 'Y', 'Z'] as const).map((name, axis) => (
              <div key={name} className="flex gap-1 items-stretch">
                {(['min', 'max'] as const).map((side) => (
                  <React.Fragment key={side}>
                    <span className="w-5 self-center text-[10px] font-mono font-bold text-amber-200">
                      {name}
                      {side === 'min' ? '−' : '+'}
                    </span>
                    <button
                      type="button"
                      className={small}
                      onClick={() => store().nudgeSection(axis as 0 | 1 | 2, side, side === 'min' ? 250 : -250)}
                      aria-label={`Achicar la caja de corte en ${name}${side === 'min' ? '−' : '+'}`}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className={small}
                      onClick={() => store().nudgeSection(axis as 0 | 1 | 2, side, side === 'min' ? -250 : 250)}
                      aria-label={`Agrandar la caja de corte en ${name}${side === 'min' ? '−' : '+'}`}
                    >
                      +
                    </button>
                  </React.Fragment>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Vistas de Cámara Estilo AutoCAD ViewCube (TOP / FRONT / RIGHT / ISO) */}
      <div className="grid grid-cols-4 gap-1 w-full mb-1.5 pb-1.5 border-b border-[#2e3440]">
        {(['TOP', 'FRONT', 'RIGHT', 'ISO'] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setCameraViewPreset(view)}
            className="py-1 rounded bg-[#252a34] hover:bg-[#0696d7] text-[8px] font-mono font-extrabold text-slate-200 hover:text-white border border-[#3a4150] active:scale-95 transition-all"
            title={`Vista de cámara ${view}`}
          >
            {view}
          </button>
        ))}
      </div>

      <span className="text-[8px] font-mono text-slate-400 mb-1 uppercase tracking-wider">
        Dirección de Trazado:
      </span>

      {/* Grid del compás plano XY (Horizontal) */}
      <div className="grid grid-cols-3 gap-1 mb-1.5 w-full">
        <button
          type="button"
          onClick={() => handleAxisSelect(-1, 1, 0)}
          className={`h-8 rounded text-[10px] font-bold transition-all border flex items-center justify-center ${
            isCurrent(-1, 1, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-slate-300 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="Noroeste (+45°)"
        >
          NO
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(0, 1, 0)}
          className={`h-8 rounded text-[10px] font-extrabold transition-all border flex items-center justify-center ${
            isCurrent(0, 1, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-emerald-400 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="+Y (Norte)"
        >
          +Y
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(1, 1, 0)}
          className={`h-8 rounded text-[10px] font-bold transition-all border flex items-center justify-center ${
            isCurrent(1, 1, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-slate-300 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="Noreste (+45°)"
        >
          NE
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(-1, 0, 0)}
          className={`h-8 rounded text-[10px] font-extrabold transition-all border flex items-center justify-center ${
            isCurrent(-1, 0, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-amber-400 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="-X (Oeste)"
        >
          -X
        </button>

        <div className="h-8 flex items-center justify-center text-[8px] text-slate-400 font-mono border border-[#2e3440] rounded bg-[#14171d]">
          WCS
        </div>

        <button
          type="button"
          onClick={() => handleAxisSelect(1, 0, 0)}
          className={`h-8 rounded text-[10px] font-extrabold transition-all border flex items-center justify-center ${
            isCurrent(1, 0, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-amber-400 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="+X (Este)"
        >
          +X
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(-1, -1, 0)}
          className={`h-8 rounded text-[10px] font-bold transition-all border flex items-center justify-center ${
            isCurrent(-1, -1, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-slate-300 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="Sudoeste (-45°)"
        >
          SO
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(0, -1, 0)}
          className={`h-8 rounded text-[10px] font-extrabold transition-all border flex items-center justify-center ${
            isCurrent(0, -1, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-emerald-400 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="-Y (Sur)"
        >
          -Y
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(1, -1, 0)}
          className={`h-8 rounded text-[10px] font-bold transition-all border flex items-center justify-center ${
            isCurrent(1, -1, 0)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-slate-300 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="Sudeste (-45°)"
        >
          SE
        </button>
      </div>

      {/* Controles de Elevación Vertical Z-Up */}
      <div className="flex w-full space-x-1 pt-1 border-t border-[#2e3440]">
        <button
          type="button"
          onClick={() => handleAxisSelect(0, 0, 1)}
          className={`flex-1 h-8 rounded text-[10px] font-extrabold transition-all border flex items-center justify-center space-x-0.5 ${
            isCurrent(0, 0, 1)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-sky-400 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="Subir cota (+Z Elevación)"
        >
          <span>▲</span>
          <span>+Z</span>
        </button>

        <button
          type="button"
          onClick={() => handleAxisSelect(0, 0, -1)}
          className={`flex-1 h-8 rounded text-[10px] font-extrabold transition-all border flex items-center justify-center space-x-0.5 ${
            isCurrent(0, 0, -1)
              ? 'bg-cad-accent text-cad-dark border-cad-accent shadow'
              : 'bg-[#252a34] text-sky-400 border-[#383f4d] hover:bg-slate-700'
          }`}
          title="Bajar cota (-Z Nivel)"
        >
          <span>▼</span>
          <span>-Z</span>
        </button>
      </div>
    </FloatingPalette>
  );
};
