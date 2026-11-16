import React, { useState, useEffect } from 'react';
import { usePipingStore } from '../store/usePipingStore';
import {
  useUiConfigStore,
  PROPERTY_FIELD_LABELS,
  PropertyFieldsConfig
} from '../store/useUiConfigStore';
import { NippleEndFinish } from '../types/piping';
import { pieceName } from '../core/pieceNames';
import { substituteOptions } from './substituteOptions';
import { ElevationField } from './ElevationField';
import { FloatingPalette } from './FloatingPalette';
import { usePhoneLayout } from './useIsPhone';

export const PropertiesInspector: React.FC = () => {
  const graph = usePipingStore((s) => s.graph);
  const version = usePipingStore((s) => s.version);
  const selectedComponentId = usePipingStore((s) => s.selectedComponentId);
  const selectedPortId = usePipingStore((s) => s.selectedPortId);
  const nominalDiameter = usePipingStore((s) => s.nominalDiameter);
  const specCode = usePipingStore((s) => s.specCode);
  const globalLineNumber = usePipingStore((s) => s.lineNumber);

  const selectPortAndAlign = usePipingStore((s) => s.selectPortAndAlign);
  const cycleOpenPort = usePipingStore((s) => s.cycleOpenPort);
  const rotateSelectedComponent = usePipingStore((s) => s.rotateSelectedComponent);
  const updateSelectedPipeLength = usePipingStore((s) => s.updateSelectedPipeLength);
  const updatePipeEndFinishes = usePipingStore((s) => s.updatePipeEndFinishes);
  const updateComponentMetadata = usePipingStore((s) => s.updateComponentMetadata);
  const splitSelectedPipeWithFitting = usePipingStore((s) => s.splitSelectedPipeWithFitting);
  const deleteSelectedComponent = usePipingStore((s) => s.deleteSelectedComponent);
  const substituteSelected = usePipingStore((s) => s.substituteSelected);
  const setSelectedValveFaceToFace = usePipingStore((s) => s.setSelectedValveFaceToFace);
  const specReader = usePipingStore((s) => s.specReader);

  const propertiesPalette = useUiConfigStore((s) => s.palettes.properties);
  const togglePaletteCollapsed = useUiConfigStore((s) => s.togglePaletteCollapsed);
  const propertyFields = useUiConfigStore((s) => s.propertyFields);
  const togglePropertyField = useUiConfigStore((s) => s.togglePropertyField);
  const applyPropertyPreset = useUiConfigStore((s) => s.applyPropertyPreset);
  const isPropertiesConfigOpen = useUiConfigStore((s) => s.isPropertiesConfigOpen);
  const setPropertiesConfigOpen = useUiConfigStore((s) => s.setPropertiesConfigOpen);

  const phone = usePhoneLayout();
  const selectedComp = selectedComponentId ? graph.components.get(selectedComponentId) : null;
  const openPorts = graph.getOpenPorts();

  const [editLength, setEditLength] = useState<string>('1000');
  const [splitOffset, setSplitOffset] = useState<string>('');
  const [editTag, setEditTag] = useState<string>('');
  const [editLine, setEditLine] = useState<string>('');
  const [editFtf, setEditFtf] = useState<string>('');
  // Se vuelve a calcular con cada cambio del modelo: la pieza cambia de familia en el lugar
  const substitutes = substituteOptions(selectedComp, specReader);
  void version;

  // Regla principal solicitada:
  // La paleta de propiedades se pliega automáticamente cuando no hay pieza seleccionada
  // o cuando cambia la pieza, y solo se despliega cuando hay una pieza seleccionada
  // y el usuario presiona el botón "Propiedades".
  useEffect(() => {
    togglePaletteCollapsed('properties', true);
    setPropertiesConfigOpen(false);
  }, [selectedComponentId, togglePaletteCollapsed, setPropertiesConfigOpen]);

  useEffect(() => {
    if (!selectedComp) return;
    setEditTag(selectedComp.parameters.nippleTag || '');
    setEditLine(selectedComp.parameters.lineNumber || globalLineNumber);
    if (selectedComp.parameters.faceToFace !== undefined) setEditFtf(String(Math.round(selectedComp.parameters.faceToFace * 10) / 10));

    if (selectedComp.type === 'PIPE') {
      const len =
        selectedComp.parameters.cutLength ||
        (selectedComp.centerline.length >= 2
          ? selectedComp.centerline[0].distanceTo(selectedComp.centerline[1])
          : 1000);
      setEditLength(Math.round(len).toString());
      setSplitOffset(Math.round(len / 2).toString());
    }
  }, [selectedComponentId, version, selectedComp, globalLineNumber]);

  const vibrate = (ms = 12) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(ms);
      } catch {
        // Ignore
      }
    }
  };

  const endFinish1: NippleEndFinish =
    selectedComp && selectedComp.type === 'PIPE'
      ? graph.resolvePortEndFinish(selectedComp.ports[0], selectedComp.parameters.endFinish1)
      : 'Bisel';
  const endFinish2: NippleEndFinish =
    selectedComp && selectedComp.type === 'PIPE'
      ? graph.resolvePortEndFinish(selectedComp.ports[1], selectedComp.parameters.endFinish2)
      : 'Bisel';

  // En el teléfono el panel se abre desde la barra de pestañas: con una pieza elegida ya muestra sus datos
  const isExpanded = Boolean(selectedComp) && (Boolean(phone) || !propertiesPalette.isCollapsed);

  const handleTogglePropertiesButton = () => {
    vibrate(15);
    if (!selectedComp) {
      usePipingStore.setState({
        statusMessage: 'Tocá primero una pieza para ver sus propiedades.'
      });
      return;
    }
    togglePaletteCollapsed('properties', !propertiesPalette.isCollapsed);
  };

  // Cálculos geométricos y de elevación (WCS / BOP)
  const p1 = selectedComp?.ports[0]?.position;
  const p2 = selectedComp?.ports[1]?.position;
  const p3 = selectedComp?.ports[2]?.position;
  const odMm = selectedComp?.parameters.outerDiameter || 60.3;
  const centerZ = p1 ? p1.z : 0;
  const bopZ = centerZ - odMm / 2;

  return (
    <>
      {/* 1. PALETA FLOTANTE DE BOCAS ABIERTAS (Arrastrable, Minimizable y Cerrable) */}
      {openPorts.length > 0 && (
        <FloatingPalette
          paletteId="openPorts"
          title="Bocas libres"
          icon={<span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />}
          badge={
            <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono font-black text-[9px]">
              {openPorts.length}
            </span>
          }
          bodyClassName="p-2 flex items-center justify-between gap-2 min-w-[220px]"
        >
          <span className="text-[10px] font-mono text-slate-300 truncate">
            Activa:{' '}
            <strong className="text-sky-300">
              #{selectedPortId ? graph.ports.get(selectedPortId)?.index || 1 : 1}
            </strong>
          </span>
          <button
            type="button"
            onClick={() => {
              vibrate();
              cycleOpenPort();
            }}
            className="px-2.5 py-1 rounded bg-[#0696d7] hover:bg-[#0582ba] text-white font-bold text-[10px] font-mono flex items-center gap-1 shadow active:scale-95 transition-all flex-shrink-0"
            title="Saltar a la siguiente boca libre"
          >
            <span>⇄ Otra boca</span>
          </button>
        </FloatingPalette>
      )}

      {/* 2. PALETA FLOTANTE DE PROPIEDADES (Plegada automáticamente hasta seleccionar pieza y pulsar "Propiedades") */}
      <FloatingPalette
        paletteId="properties"
        title="Propiedades"
        icon="📋"
        forceCollapsed={!isExpanded}
        sheetEmptyHint="Tocá un caño o un accesorio en el modelo para ver y editar sus datos."
        sheetBodyClassName="w-full p-2.5 space-y-2 text-xs"
        sheetZoom={1.15}
        onToggleCollapseOverride={handleTogglePropertiesButton}
        badge={
          selectedComp ? (
            <span className="px-1.5 py-0.5 rounded bg-[#0696d7]/25 border border-[#38bdf8]/60 text-[#38bdf8] font-mono font-black text-[9px]">
              {pieceName(selectedComp.type)} {selectedComp.ports[0]?.nominalDiameter || nominalDiameter}&quot;
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono text-[9px]">
              Sin selección
            </span>
          )
        }
        headerActions={
          <div className="flex items-center gap-1">
            {/* Botón explícito "Propiedades" para desplegar cuando hay pieza seleccionada */}
            {selectedComp && !phone && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTogglePropertiesButton();
                }}
                className={`px-2 h-5 rounded font-mono font-extrabold text-[9px] border flex items-center gap-1 transition-all active:scale-95 ${
                  isExpanded
                    ? 'bg-[#0696d7] text-white border-[#38bdf8] shadow shadow-[#0696d7]/40'
                    : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-400/60 animate-pulse'
                }`}
                title={
                  isExpanded
                    ? 'Plegar paleta de propiedades'
                    : 'Desplegar propiedades de la pieza seleccionada'
                }
              >
                <span>{isExpanded ? 'Plegar' : 'Propiedades'}</span>
              </button>
            )}

            {/* Botón Configurador de Campos Visibles (⚙) */}
            {isExpanded && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  vibrate(10);
                  setPropertiesConfigOpen(!isPropertiesConfigOpen);
                }}
                className={`w-5 h-5 rounded border flex items-center justify-center text-[10px] transition-all active:scale-90 ${
                  isPropertiesConfigOpen
                    ? 'bg-amber-500 text-slate-950 border-amber-300 font-black'
                    : 'bg-[#262c3a] hover:bg-[#343c4e] border-[#3a4254] text-slate-300 hover:text-amber-300'
                }`}
                title="Configurar qué campos muestra la paleta de propiedades"
              >
                ⚙
              </button>
            )}
          </div>
        }
        bodyClassName="w-[300px] sm:w-[325px] max-h-[70vh] overflow-y-auto p-2.5 space-y-2 text-xs"
      >
        {/* PANEL CONFIGURADOR DE CAMPOS VISIBLES (⚙) */}
        {isPropertiesConfigOpen && (
          <div className="bg-[#11141b] border border-amber-500/50 rounded-lg p-2.5 space-y-2 shadow-inner">
            <div className="flex items-center justify-between border-b border-[#262c3a] pb-1.5">
              <span className="text-[10px] font-mono font-extrabold uppercase text-amber-300">
                ⚙ Configurar Campos Visibles
              </span>
              <button
                type="button"
                onClick={() => setPropertiesConfigOpen(false)}
                className="text-[10px] font-bold text-sky-400 hover:text-sky-300"
              >
                Listo
              </button>
            </div>

            {/* Presets rápidos de visualización */}
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => {
                  vibrate(10);
                  applyPropertyPreset('COMPACT');
                }}
                className="py-1 px-1.5 rounded bg-[#1d222d] hover:bg-[#283040] border border-[#343d4f] text-[9px] font-mono font-bold text-slate-200"
                title="Solo controles esenciales para campo"
              >
                Compacto
              </button>
              <button
                type="button"
                onClick={() => {
                  vibrate(10);
                  applyPropertyPreset('WORKSHOP');
                }}
                className="py-1 px-1.5 rounded bg-[#1d222d] hover:bg-[#283040] border border-[#343d4f] text-[9px] font-mono font-bold text-emerald-300"
                title="Campos de taller y lista de cortes"
              >
                Taller
              </button>
              <button
                type="button"
                onClick={() => {
                  vibrate(10);
                  applyPropertyPreset('ENGINEERING');
                }}
                className="py-1 px-1.5 rounded bg-[#1d222d] hover:bg-[#283040] border border-[#343d4f] text-[9px] font-mono font-bold text-sky-300"
                title="Mostrar todos los parámetros técnicos y coordenadas"
              >
                Completo
              </button>
            </div>

            {/* Lista de checkboxes por campo */}
            <div className="max-h-44 overflow-y-auto space-y-1 pr-1 divide-y divide-[#1d222c]">
              {(Object.keys(PROPERTY_FIELD_LABELS) as Array<keyof PropertyFieldsConfig>).map(
                (fieldKey) => (
                  <label
                    key={fieldKey}
                    className="flex items-center justify-between pt-1 text-[10px] text-slate-300 cursor-pointer hover:text-white"
                  >
                    <span className="truncate pr-2">{PROPERTY_FIELD_LABELS[fieldKey].label}</span>
                    <input
                      type="checkbox"
                      checked={propertyFields[fieldKey]}
                      onChange={() => togglePropertyField(fieldKey)}
                      className="rounded border-slate-600 accent-[#0696d7] w-3.5 h-3.5 cursor-pointer"
                    />
                  </label>
                )
              )}
            </div>
          </div>
        )}

        {selectedComp && (
          <>
            {/* SECCIÓN 1: IDENTIFICACIÓN Y CATÁLOGO */}
            {(propertyFields.nippleTag ||
              propertyFields.lineNumber ||
              propertyFields.specAndCatalog ||
              propertyFields.deleteButton) && (
              <div className="bg-[#1b2029] border border-[#2d3545] rounded-md p-2 space-y-1.5">
                <div className="flex items-center justify-between border-b border-[#282f3d] pb-1">
                  <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-[#38bdf8]">
                    Identificación
                  </span>
                  {propertyFields.deleteButton && (
                    <button
                      type="button"
                      onClick={() => {
                        vibrate(25);
                        deleteSelectedComponent();
                      }}
                      className="px-2 py-0.5 rounded bg-rose-950/80 hover:bg-rose-800 border border-rose-500/60 text-rose-200 font-bold text-[9px] active:scale-95 transition-all"
                      title="Borrar esta pieza"
                    >
                      🗑 Borrar Pieza
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {propertyFields.nippleTag && (
                    <div>
                      <span className="text-[9px] font-mono text-slate-400 block">
                        Identificación:
                      </span>
                      <input
                        type="text"
                        value={editTag}
                        placeholder={selectedComp.type === 'PIPE' ? 'Ej: N-01' : selectedComp.id.slice(0, 6)}
                        onChange={(e) => setEditTag(e.target.value)}
                        onBlur={() =>
                          updateComponentMetadata(selectedComp.id, { nippleTag: editTag })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            updateComponentMetadata(selectedComp.id, { nippleTag: editTag });
                          }
                        }}
                        className="w-full px-1.5 py-0.5 rounded bg-[#111419] border border-[#343c4c] text-[10px] font-mono font-bold text-amber-300 focus:outline-none focus:border-[#38bdf8]"
                      />
                    </div>
                  )}

                  {propertyFields.lineNumber && (
                    <div>
                      <span className="text-[9px] font-mono text-slate-400 block">
                        Número de línea:
                      </span>
                      <input
                        type="text"
                        value={editLine}
                        onChange={(e) => setEditLine(e.target.value)}
                        onBlur={() =>
                          updateComponentMetadata(selectedComp.id, { lineNumber: editLine })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            updateComponentMetadata(selectedComp.id, { lineNumber: editLine });
                          }
                        }}
                        className="w-full px-1.5 py-0.5 rounded bg-[#111419] border border-[#343c4c] text-[10px] font-mono font-bold text-sky-300 focus:outline-none focus:border-[#38bdf8]"
                      />
                    </div>
                  )}
                </div>

                {propertyFields.specAndCatalog && (
                  <div className="pt-1 border-t border-[#252b38] flex flex-col gap-0.5 text-[10px] font-mono">
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-400">Spec y pieza:</span>
                      <span className="font-bold text-sky-300">
                        {selectedComp.specCode || specCode} • #{selectedComp.catalogId}
                      </span>
                    </div>
                    {selectedComp.parameters.description && (
                      <span className="text-[9px] text-slate-400 truncate" title={selectedComp.parameters.description}>
                        {selectedComp.parameters.description}
                      </span>
                    )}
                    {(selectedComp.parameters.skey || selectedComp.ports.some((p) => p.plantEndType)) && (
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-400">Extremos (SKEY):</span>
                        <span className="font-bold text-slate-200">
                          {selectedComp.parameters.skey || '—'} •{' '}
                          {selectedComp.ports.map((p) => p.plantEndType || p.endType).join('/')}
                        </span>
                      </div>
                    )}
                    {selectedComp.parameters.geometryConfidence && (
                      <span
                        className={`text-[9px] ${
                          selectedComp.parameters.geometryConfidence === 'verified'
                            ? 'text-emerald-400'
                            : selectedComp.parameters.geometryConfidence === 'standard'
                            ? 'text-sky-300'
                            : 'text-amber-400'
                        }`}
                        title={selectedComp.parameters.geometryNote}
                      >
                        {selectedComp.parameters.geometryConfidence === 'verified'
                          ? '✓ Bocas verificadas con Plant 3D'
                          : selectedComp.parameters.geometryConfidence === 'standard'
                          ? '≈ Bocas según norma, sin verificar en Plant'
                          : `! Geometría aproximada${selectedComp.parameters.geometryNote ? `: ${selectedComp.parameters.geometryNote}` : ''}`}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* SECCIÓN 2: GEOMETRÍA Y DIMENSIONES */}
            {(propertyFields.nominalAndSchedule ||
              propertyFields.odAndThickness ||
              propertyFields.cutLength ||
              propertyFields.grossLength ||
              propertyFields.fittingDimensions) && (
              <div className="bg-[#1b2029] border border-[#2d3545] rounded-md p-2 space-y-1.5">
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-emerald-400 block border-b border-[#282f3d] pb-1">
                  Medidas
                </span>

                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-mono">
                  {propertyFields.nominalAndSchedule && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Diámetro:</span>
                        <span className="font-bold text-white">
                          {selectedComp.parameters.nominalDiameter}&quot;
                          {selectedComp.parameters.reducedNominalDiameter
                            ? ` × ${selectedComp.parameters.reducedNominalDiameter}"`
                            : ''}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Schedule:</span>
                        <span className="font-bold text-amber-300">
                          {selectedComp.parameters.schedule || 'STD'}
                        </span>
                      </div>
                    </>
                  )}

                  {propertyFields.odAndThickness && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Diámetro exterior:</span>
                        <span className="text-sky-300">
                          {(selectedComp.parameters.outerDiameter || 60.3).toFixed(1)} mm
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Espesor:</span>
                        <span className="text-sky-300">
                          {(selectedComp.parameters.wallThickness || 3.91).toFixed(2)} mm
                        </span>
                      </div>
                    </>
                  )}

                  {propertyFields.grossLength && selectedComp.type === 'PIPE' && (
                    <div className="col-span-2 flex justify-between pt-0.5 border-t border-[#252b38]">
                      <span className="text-slate-400">Largo de eje a eje:</span>
                      <span className="font-bold text-slate-200">
                        {Math.round(
                          selectedComp.parameters.grossLength ||
                            selectedComp.parameters.cutLength ||
                            0
                        )}{' '}
                        mm
                      </span>
                    </div>
                  )}

                  {propertyFields.fittingDimensions && selectedComp.type !== 'PIPE' && (
                    <div className="col-span-2 pt-0.5 border-t border-[#252b38] grid grid-cols-2 gap-x-2 gap-y-0.5">
                      {selectedComp.parameters.takeOff !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">Centro a cara:</span>
                          <span className="text-emerald-300">
                            {selectedComp.parameters.takeOff.toFixed(1)} mm
                          </span>
                        </div>
                      )}
                      {selectedComp.parameters.angle !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">Ángulo:</span>
                          <span className="text-amber-300">{selectedComp.parameters.angle}°</span>
                        </div>
                      )}
                      {selectedComp.parameters.runTakeOff !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">Centro a cara, línea:</span>
                          <span className="text-emerald-300">
                            {selectedComp.parameters.runTakeOff.toFixed(1)} mm
                          </span>
                        </div>
                      )}
                      {selectedComp.parameters.branchTakeOff !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">Centro a cara, ramal:</span>
                          <span className="text-amber-300">
                            {selectedComp.parameters.branchTakeOff.toFixed(1)} mm
                          </span>
                        </div>
                      )}
                      {selectedComp.parameters.faceToFace !== undefined && selectedComp.type !== 'VALVE' && (
                        <div className="col-span-2 flex justify-between">
                          <span className="text-slate-400">Cara a cara:</span>
                          <span className="text-purple-300">
                            {selectedComp.parameters.faceToFace.toFixed(1)} mm
                          </span>
                        </div>
                      )}
                      {selectedComp.parameters.faceToFace !== undefined && selectedComp.type === 'VALVE' && (
                        <div className="col-span-2 flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-400 shrink-0">Cara a cara (mm):</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              value={editFtf}
                              onChange={(e) => setEditFtf(e.target.value)}
                              onKeyDown={(e) => {
                                const v = parseFloat(editFtf);
                                if (e.key === 'Enter' && !isNaN(v)) setSelectedValveFaceToFace(v);
                              }}
                              aria-label="Cara a cara de la válvula en milímetros"
                              className="w-20 px-1.5 py-0.5 rounded bg-[#111418] border border-[#3a4150] text-purple-300 font-mono font-bold text-[10px] focus:outline-none focus:border-[#38bdf8]"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const v = parseFloat(editFtf);
                                if (!isNaN(v)) {
                                  vibrate(15);
                                  setSelectedValveFaceToFace(v);
                                }
                              }}
                              className="px-2 py-0.5 rounded bg-[#0696d7] hover:bg-[#0582ba] text-white font-bold text-[10px] active:scale-95"
                            >
                              Aplicar
                            </button>
                          </div>
                          {selectedComp.parameters.specFaceToFace !== undefined && (
                            <div className="flex items-center gap-1 text-[9px] text-amber-300">
                              <span className="flex-1">
                                La spec dice {selectedComp.parameters.specFaceToFace.toFixed(1)} mm. Plant la trae con el largo de su spec.
                              </span>
                              <button
                                type="button"
                                onClick={() => setSelectedValveFaceToFace(undefined)}
                                className="px-1.5 py-0.5 rounded bg-[#232832] border border-[#3a4150] text-slate-200 font-bold"
                              >
                                Volver a la spec
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {substitutes.length > 0 && (
                        <label className="col-span-2 flex items-center gap-1 pt-0.5">
                          <span className="text-slate-400 shrink-0">Sustituir por:</span>
                          <select
                            value=""
                            onChange={(e) => {
                              const opt = substitutes.find((o) => o.key === e.target.value);
                              if (opt) substituteSelected(opt.familyId, opt.angle);
                            }}
                            className="flex-1 min-w-0 px-1 py-0.5 rounded bg-[#111418] border border-[#3a4150] text-sky-300 text-[10px]"
                          >
                            <option value="">Elegir…</option>
                            {substitutes.map((o) => (
                              <option key={o.key} value={o.key}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                </div>

                {/* Editor directo de Largo de Corte para PIPE */}
                {propertyFields.cutLength && selectedComp.type === 'PIPE' && (
                  <div className="pt-1 border-t border-[#252b38] flex flex-col gap-1">
                    <span className="text-[9px] font-mono text-slate-300">
                      Largo del caño (mm):
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={editLength}
                        onChange={(e) => setEditLength(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = parseFloat(editLength);
                            if (!isNaN(val) && val >= 20) updateSelectedPipeLength(val);
                          }
                        }}
                        className="w-20 px-2 py-1 rounded bg-[#111418] border border-[#3a4150] text-sky-300 font-mono font-bold text-xs focus:outline-none focus:border-[#38bdf8]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const val = parseFloat(editLength);
                          if (!isNaN(val) && val >= 20) {
                            vibrate(15);
                            updateSelectedPipeLength(val);
                          }
                        }}
                        className="px-2 py-1 rounded bg-[#0696d7] hover:bg-[#0582ba] text-white font-bold text-[10px] active:scale-95"
                      >
                        Aplicar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = Math.max(20, (parseFloat(editLength) || 500) - 100);
                          setEditLength(next.toString());
                          updateSelectedPipeLength(next);
                        }}
                        className="px-1.5 py-1 rounded bg-[#232832] border border-[#3a4150] text-slate-300 font-mono font-bold text-[10px]"
                      >
                        -100
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = (parseFloat(editLength) || 500) + 100;
                          setEditLength(next.toString());
                          updateSelectedPipeLength(next);
                        }}
                        className="px-1.5 py-1 rounded bg-[#232832] border border-[#3a4150] text-slate-200 font-mono font-bold text-[10px]"
                      >
                        +100
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SECCIÓN 3: EXTREMOS Y UNIONES (P3dJoint) */}
            {(propertyFields.endFinishes ||
              propertyFields.endTypes ||
              propertyFields.fasteners) && (
              <div className="bg-[#1b2029] border border-[#2d3545] rounded-md p-2 space-y-1.5">
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-amber-400 block border-b border-[#282f3d] pb-1">
                  Extremos y uniones
                </span>

                {propertyFields.endFinishes && selectedComp.type === 'PIPE' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <span className="text-[9px] font-mono text-slate-400 block mb-0.5">
                        Extremo 1:
                      </span>
                      <select
                        value={endFinish1}
                        onChange={(e) =>
                          updatePipeEndFinishes(
                            selectedComp.id,
                            e.target.value as NippleEndFinish,
                            endFinish2
                          )
                        }
                        className="w-full px-1.5 py-1 rounded bg-[#111418] border border-[#3a4150] text-[10px] font-bold text-amber-300"
                      >
                        <option value="Bisel">Bisel</option>
                        <option value="Plano">Plano</option>
                        <option value="Roscado">Roscado</option>
                      </select>
                    </div>
                    <div>
                      <span className="text-[9px] font-mono text-slate-400 block mb-0.5">
                        Extremo 2:
                      </span>
                      <select
                        value={endFinish2}
                        onChange={(e) =>
                          updatePipeEndFinishes(
                            selectedComp.id,
                            endFinish1,
                            e.target.value as NippleEndFinish
                          )
                        }
                        className="w-full px-1.5 py-1 rounded bg-[#111418] border border-[#3a4150] text-[10px] font-bold text-amber-300"
                      >
                        <option value="Bisel">Bisel</option>
                        <option value="Plano">Plano</option>
                        <option value="Roscado">Roscado</option>
                      </select>
                    </div>
                  </div>
                )}

                {propertyFields.endTypes && (
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-400">Uniones:</span>
                    <span className="text-slate-200 font-bold">
                      {selectedComp.ports.map((p) => `#${p.index}:${p.endType}`).join(' • ')}
                    </span>
                  </div>
                )}

                {propertyFields.fasteners &&
                  (selectedComp.parameters.gasketDescription ||
                    selectedComp.parameters.boltSetDescription) && (
                    <div className="pt-1 border-t border-[#252b38] text-[9px] font-mono text-amber-300 space-y-0.5">
                      {selectedComp.parameters.gasketDescription && (
                        <div>• Junta: {selectedComp.parameters.gasketDescription}</div>
                      )}
                      {selectedComp.parameters.boltSetDescription && (
                        <div>
                          • Espárragos: {selectedComp.parameters.boltCount || 4}×{' '}
                          {selectedComp.parameters.boltSize || '1/2"'} (
                          {selectedComp.parameters.boltLengthMm || 70} mm)
                        </div>
                      )}
                    </div>
                  )}
              </div>
            )}

            {/* SECCIÓN 4: COORDENADAS WCS Y ELEVACIÓN BOP */}
            {(propertyFields.elevationBop || propertyFields.portsXyz) && p1 && (
              <div className="bg-[#1b2029] border border-[#2d3545] rounded-md p-2 space-y-1 font-mono text-[10px]">
                <span className="text-[9px] font-bold uppercase tracking-wider text-purple-300 block border-b border-[#282f3d] pb-1">
                  Coordenadas y elevación
                </span>

                {propertyFields.elevationBop && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Eje (Z):</span>
                      <span className="text-sky-300 font-bold">{Math.round(centerZ)} mm</span>
                    </div>
                    <div className="flex justify-between" title="Fondo de caño (BOP)">
                      <span className="text-slate-400">Fondo:</span>
                      <span className="text-emerald-300 font-bold">{Math.round(bopZ)} mm</span>
                    </div>
                  </div>
                )}

                {propertyFields.portsXyz && (
                  <div className="pt-1 border-t border-[#252b38] space-y-0.5 text-[9px] text-slate-300">
                    <div>
                      <span className="text-slate-400">P1:</span> [{Math.round(p1.x)},{' '}
                      {Math.round(p1.y)}, {Math.round(p1.z)}]
                    </div>
                    {p2 && (
                      <div>
                        <span className="text-slate-400">P2:</span> [{Math.round(p2.x)},{' '}
                        {Math.round(p2.y)}, {Math.round(p2.z)}]
                      </div>
                    )}
                    {p3 && (
                      <div>
                        <span className="text-amber-400">P3 (ramal):</span> [{Math.round(p3.x)},{' '}
                        {Math.round(p3.y)}, {Math.round(p3.z)}]
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Elevación del eje: sube o baja la pieza y estira los caños verticales */}
            <div className="bg-[#1b2029] border border-[#2d3545] rounded-md p-2">
              <ElevationField />
            </div>

            {/* SECCIÓN 5: ACCIONES DE MODELADO 3D EN LA PIEZA */}
            {(propertyFields.branchSelection ||
              propertyFields.axialRotation ||
              propertyFields.pipeSplit) && (
              <div className="bg-[#1b2029] border border-[#2d3545] rounded-md p-2 space-y-2">
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-cyan-300 block border-b border-[#282f3d] pb-1">
                  Acciones
                </span>

                {/* Derivación Te */}
                {propertyFields.branchSelection &&
                  selectedComp.type === 'TEE' &&
                  selectedComp.ports.length >= 3 && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          vibrate(15);
                          selectPortAndAlign(selectedComp.ports[1].id);
                        }}
                        className={`py-1.5 px-2 rounded font-bold text-[10px] border flex items-center justify-center gap-1 transition-all ${
                          selectedPortId === selectedComp.ports[1].id
                            ? 'bg-emerald-600 text-white border-emerald-300 shadow'
                            : 'bg-[#232832] text-slate-200 border-[#3a4150] hover:border-emerald-400'
                        }`}
                      >
                        <span>Seguir por la línea</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          vibrate(15);
                          selectPortAndAlign(selectedComp.ports[2].id);
                        }}
                        className={`py-1.5 px-2 rounded font-bold text-[10px] border flex items-center justify-center gap-1 transition-all ${
                          selectedPortId === selectedComp.ports[2].id
                            ? 'bg-amber-500 text-slate-950 border-amber-200 shadow font-black'
                            : 'bg-[#232832] text-amber-300 border-amber-500/50 hover:bg-amber-950/50'
                        }`}
                      >
                        <span>Salir por el ramal</span>
                      </button>
                    </div>
                  )}

                {/* Giro Axial para TEE y ELBOW */}
                {propertyFields.axialRotation &&
                  (selectedComp.type === 'TEE' || selectedComp.type === 'ELBOW') && (
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-400 font-mono shrink-0">Girar:</span>
                      <button
                        type="button"
                        onClick={() => {
                          vibrate(15);
                          rotateSelectedComponent(90);
                        }}
                        className="flex-1 py-1 px-1.5 rounded bg-[#232832] hover:bg-[#323846] border border-[#434c5e] text-sky-300 font-bold text-[10px] active:scale-95"
                      >
                        +90°
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          vibrate(15);
                          rotateSelectedComponent(-90);
                        }}
                        className="flex-1 py-1 px-1.5 rounded bg-[#232832] hover:bg-[#323846] border border-[#434c5e] text-sky-300 font-bold text-[10px] active:scale-95"
                      >
                        -90°
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          vibrate(15);
                          rotateSelectedComponent(selectedComp.type === 'ELBOW' ? 45 : 180);
                        }}
                        className="flex-1 py-1 px-1.5 rounded bg-[#232832] hover:bg-[#323846] border border-[#434c5e] text-amber-300 font-bold text-[10px] active:scale-95"
                      >
                        {selectedComp.type === 'ELBOW' ? '+45°' : '180°'}
                      </button>
                    </div>
                  )}

                {/* Partir Caño e Intercalar Accesorio */}
                {propertyFields.pipeSplit && selectedComp.type === 'PIPE' && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono font-bold text-emerald-400 uppercase">
                        Partir Caño a (mm):
                      </span>
                      <input
                        type="number"
                        value={splitOffset}
                        onChange={(e) => setSplitOffset(e.target.value)}
                        className="w-16 px-1.5 py-0.5 rounded bg-[#111418] border border-[#3a4150] text-emerald-300 font-mono font-bold text-[10px]"
                        title="Distancia de corte desde el inicio del caño (mm)"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          vibrate(20);
                          splitSelectedPipeWithFitting('TEE', parseFloat(splitOffset) || undefined);
                        }}
                        className="py-1 px-1 rounded bg-[#1b324f] hover:bg-[#0696d7] border border-[#38bdf8]/60 text-sky-200 hover:text-white font-bold text-[10px] active:scale-95"
                      >
                        + Te
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          vibrate(20);
                          splitSelectedPipeWithFitting(
                            'VALVE',
                            parseFloat(splitOffset) || undefined
                          );
                        }}
                        className="py-1 px-1 rounded bg-rose-950/60 hover:bg-rose-700 border border-rose-500/60 text-rose-200 hover:text-white font-bold text-[10px] active:scale-95"
                      >
                        + Válvula
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          vibrate(20);
                          splitSelectedPipeWithFitting(
                            'FLANGE',
                            parseFloat(splitOffset) || undefined
                          );
                        }}
                        className="py-1 px-1 rounded bg-purple-950/60 hover:bg-purple-700 border border-purple-500/60 text-purple-200 hover:text-white font-bold text-[10px] active:scale-95"
                      >
                        + Brida
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </FloatingPalette>
    </>
  );
};
