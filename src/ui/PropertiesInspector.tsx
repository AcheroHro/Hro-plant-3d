import React, { useState, useEffect } from 'react';
import { usePipingStore } from '../store/usePipingStore';

export const PropertiesInspector: React.FC = () => {
  const graph = usePipingStore((s) => s.graph);
  const version = usePipingStore((s) => s.version);
  const selectedComponentId = usePipingStore((s) => s.selectedComponentId);
  const selectedPortId = usePipingStore((s) => s.selectedPortId);
  const nominalDiameter = usePipingStore((s) => s.nominalDiameter);
  const specCode = usePipingStore((s) => s.specCode);

  const insertFitting = usePipingStore((s) => s.insertFitting);
  const selectPortAndAlign = usePipingStore((s) => s.selectPortAndAlign);
  const cycleOpenPort = usePipingStore((s) => s.cycleOpenPort);
  const rotateSelectedComponent = usePipingStore((s) => s.rotateSelectedComponent);
  const updateSelectedPipeLength = usePipingStore((s) => s.updateSelectedPipeLength);
  const deleteSelectedComponent = usePipingStore((s) => s.deleteSelectedComponent);
  const toggleToolPalette = usePipingStore((s) => s.toggleToolPalette);

  const selectedComp = selectedComponentId ? graph.components.get(selectedComponentId) : null;
  const openPorts = graph.getOpenPorts();

  const [editLength, setEditLength] = useState<string>('1000');

  useEffect(() => {
    if (selectedComp && selectedComp.type === 'PIPE') {
      const len =
        selectedComp.parameters.cutLength ||
        (selectedComp.centerline.length >= 2
          ? selectedComp.centerline[0].distanceTo(selectedComp.centerline[1])
          : 1000);
      setEditLength(Math.round(len).toString());
    }
  }, [selectedComponentId, version, selectedComp]);

  const vibrate = (ms = 15) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(ms);
      } catch {
        // Ignore
      }
    }
  };

  return (
    <>
      {/* 1. PALETA DE HERRAMIENTAS ACOPLADA IZQUIERDA (AutoCAD Plant 3D Docked Tool Palette) */}
      <aside className="absolute left-2 top-20 bottom-20 z-20 flex flex-col justify-between w-14 sm:w-16 bg-[#1b1f26]/95 backdrop-blur-md border border-[#343b48] rounded-lg shadow-2xl py-1.5 px-1 select-none overflow-y-auto">
        <div className="flex flex-col items-center space-y-1">
          <div className="w-full text-center pb-1 border-b border-[#2e3440]">
            <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-[#38bdf8] block">
              {specCode}
            </span>
            <span className="text-[9px] font-mono font-black text-amber-400 block">
              {nominalDiameter}&quot;
            </span>
          </div>

          {/* Caño Recto */}
          <button
            type="button"
            onClick={() => {
              vibrate();
              insertFitting('PIPE');
            }}
            className="w-full py-1.5 px-0.5 rounded bg-[#252a34] hover:bg-[#0696d7]/30 border border-[#383f4d] hover:border-[#38bdf8] flex flex-col items-center text-slate-200 active:scale-95 transition-all"
            title="Insertar tramo recto de cañería (PIPE)"
          >
            <span className="text-sm leading-none">📏</span>
            <span className="text-[8px] font-bold mt-0.5">Caño</span>
          </button>

          {/* Codo 90° */}
          <button
            type="button"
            onClick={() => {
              vibrate();
              insertFitting('ELBOW', { angle: 90 });
            }}
            className="w-full py-1.5 px-0.5 rounded bg-[#252a34] hover:bg-[#0696d7]/30 border border-[#383f4d] hover:border-[#38bdf8] flex flex-col items-center text-slate-200 active:scale-95 transition-all"
            title="Insertar Codo 90° LR Serie 150"
          >
            <span className="text-sm leading-none">↪️</span>
            <span className="text-[8px] font-bold mt-0.5">Codo 90°</span>
          </button>

          {/* Codo 45° */}
          <button
            type="button"
            onClick={() => {
              vibrate();
              insertFitting('ELBOW', { angle: 45 });
            }}
            className="w-full py-1.5 px-0.5 rounded bg-[#252a34] hover:bg-[#0696d7]/30 border border-[#383f4d] hover:border-[#38bdf8] flex flex-col items-center text-slate-200 active:scale-95 transition-all"
            title="Insertar Codo 45° LR"
          >
            <span className="text-sm leading-none">↗️</span>
            <span className="text-[8px] font-bold mt-0.5">Codo 45°</span>
          </button>

          {/* Te (Continuar Línea) */}
          <button
            type="button"
            onClick={() => {
              vibrate(20);
              insertFitting('TEE', { continueOnBranch: false });
            }}
            className="w-full py-1.5 px-0.5 rounded bg-[#1e3a5f]/70 hover:bg-[#0696d7]/40 border border-[#38bdf8]/60 flex flex-col items-center text-sky-200 active:scale-95 transition-all"
            title="Insertar Te Igual (Continuar por Línea Principal)"
          >
            <span className="text-sm leading-none">┣</span>
            <span className="text-[8px] font-extrabold mt-0.5 text-sky-300">Te Línea</span>
          </button>

          {/* Te (Continuar por Ramal 90°) */}
          <button
            type="button"
            onClick={() => {
              vibrate(20);
              insertFitting('TEE', { continueOnBranch: true });
            }}
            className="w-full py-1.5 px-0.5 rounded bg-amber-950/60 hover:bg-amber-800/50 border border-amber-500/60 flex flex-col items-center text-amber-200 active:scale-95 transition-all"
            title="Insertar Te Igual y salir directamente por el Ramal a 90°"
          >
            <span className="text-sm leading-none">🔀</span>
            <span className="text-[8px] font-extrabold mt-0.5 text-amber-300">Te Ramal</span>
          </button>

          {/* Brida WN */}
          <button
            type="button"
            onClick={() => {
              vibrate();
              insertFitting('FLANGE');
            }}
            className="w-full py-1.5 px-0.5 rounded bg-[#252a34] hover:bg-[#0696d7]/30 border border-[#383f4d] hover:border-[#38bdf8] flex flex-col items-center text-slate-200 active:scale-95 transition-all"
            title="Insertar Brida Welding Neck + Junta + Espárragos"
          >
            <span className="text-sm leading-none">⚙️</span>
            <span className="text-[8px] font-bold mt-0.5">Brida</span>
          </button>

          {/* Válvula */}
          <button
            type="button"
            onClick={() => {
              vibrate();
              insertFitting('VALVE');
            }}
            className="w-full py-1.5 px-0.5 rounded bg-[#252a34] hover:bg-[#0696d7]/30 border border-[#383f4d] hover:border-[#38bdf8] flex flex-col items-center text-slate-200 active:scale-95 transition-all"
            title="Insertar Válvula Bridada + 2 Juntas + 2 Juegos de Espárragos"
          >
            <span className="text-sm leading-none">🛑</span>
            <span className="text-[8px] font-bold mt-0.5">Válvula</span>
          </button>

          {/* Reducción */}
          <button
            type="button"
            onClick={() => {
              vibrate();
              insertFitting('REDUCER');
            }}
            className="w-full py-1.5 px-0.5 rounded bg-[#252a34] hover:bg-[#0696d7]/30 border border-[#383f4d] hover:border-[#38bdf8] flex flex-col items-center text-slate-200 active:scale-95 transition-all"
            title="Insertar Reducción Concéntrica"
          >
            <span className="text-sm leading-none">🔻</span>
            <span className="text-[8px] font-bold mt-0.5">Reducc.</span>
          </button>

          {/* Casquete / Cap */}
          <button
            type="button"
            onClick={() => {
              vibrate();
              insertFitting('CAP');
            }}
            className="w-full py-1.5 px-0.5 rounded bg-[#252a34] hover:bg-[#0696d7]/30 border border-[#383f4d] hover:border-[#38bdf8] flex flex-col items-center text-slate-200 active:scale-95 transition-all"
            title="Insertar Casquete / Tapa Soldable (CAP)"
          >
            <span className="text-sm leading-none">半球</span>
            <span className="text-[8px] font-bold mt-0.5">Tapa</span>
          </button>
        </div>

        {/* Botón Catálogo Completo */}
        <button
          type="button"
          onClick={() => {
            vibrate();
            toggleToolPalette();
          }}
          className="w-full py-1.5 px-0.5 mt-1 rounded bg-[#2e3440] hover:bg-[#3b4252] border border-amber-500/50 flex flex-col items-center text-amber-300 active:scale-95 transition-all"
          title="Abrir Catálogo Completo de Especificación"
        >
          <span className="text-xs leading-none">🧰</span>
          <span className="text-[7px] font-bold mt-0.5">Catálogo</span>
        </button>
      </aside>

      {/* 2. PANEL CONTEXTUAL DE PROPIEDADES Y CONTROL DE RAMALES / PIEZA SELECCIONADA */}
      <div className="absolute left-20 sm:left-22 top-20 z-20 flex flex-col gap-1.5 max-w-[290px] sm:max-w-xs pointer-events-auto">
        {/* Barra rápida de bocas abiertas (Permite saltar entre ramales en cualquier momento) */}
        {openPorts.length > 0 && (
          <div className="flex items-center gap-1.5 bg-[#1b1f26]/95 backdrop-blur-md border border-[#343b48] px-2.5 py-1.5 rounded-lg shadow-xl">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <span className="text-[10px] font-mono text-slate-300 truncate">
              Bocas libres: <strong className="text-emerald-400">{openPorts.length}</strong>
            </span>
            <button
              type="button"
              onClick={() => {
                vibrate();
                cycleOpenPort();
              }}
              className="ml-auto px-2 py-1 rounded bg-[#0696d7] hover:bg-[#0582ba] text-white font-bold text-[10px] font-mono flex items-center gap-1 shadow active:scale-95 transition-all flex-shrink-0"
              title="Saltar a la siguiente boca o ramal abierto (Tab)"
            >
              <span>⏭ Cambiar Boca/Ramal</span>
            </button>
          </div>
        )}

        {/* Inspector de la Pieza Seleccionada en 3D (Te, Caño, Codo, Brida, Válvula) */}
        {selectedComp && (
          <div className="bg-[#1b1f26]/95 backdrop-blur-md border border-[#0696d7]/80 rounded-lg p-2.5 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-[#2e3440] pb-1.5 mb-2">
              <div className="flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded bg-[#0696d7]/20 border border-[#38bdf8]/50 text-[#38bdf8] font-mono font-black text-[10px]">
                  {selectedComp.type}
                </span>
                <span className="font-bold text-slate-100 text-[11px] truncate">
                  ND {selectedComp.ports[0]?.nominalDiameter || nominalDiameter}&quot; •{' '}
                  {specCode}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  vibrate(25);
                  deleteSelectedComponent();
                }}
                className="px-2 py-0.5 rounded bg-rose-950/80 hover:bg-rose-800 border border-rose-500/60 text-rose-200 font-bold text-[10px] active:scale-95 transition-all"
                title="Eliminar esta pieza del modelo 3D (DELETE)"
              >
                🗑 Borrar
              </button>
            </div>

            {/* CONTROLES ESPECIALES PARA TE (ELEGIR CONTINUAR POR LÍNEA O POR RAMAL 90° Y GIRAR RAMAL) */}
            {selectedComp.type === 'TEE' && selectedComp.ports.length >= 3 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-mono font-bold text-amber-300 uppercase tracking-wide">
                  🔀 Control de Derivación Te (3 Bocas):
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      vibrate(15);
                      selectPortAndAlign(selectedComp.ports[1].id);
                    }}
                    className={`py-1.5 px-2 rounded font-bold text-[10px] border flex items-center justify-center gap-1 transition-all ${
                      selectedPortId === selectedComp.ports[1].id
                        ? 'bg-emerald-600 text-white border-emerald-300 shadow-lg shadow-emerald-600/30'
                        : 'bg-[#252a34] text-slate-200 border-[#3a4150] hover:border-emerald-400'
                    }`}
                  >
                    <span>➡</span>
                    <span>Seguir Línea (#2)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      vibrate(15);
                      selectPortAndAlign(selectedComp.ports[2].id);
                    }}
                    className={`py-1.5 px-2 rounded font-bold text-[10px] border flex items-center justify-center gap-1 transition-all ${
                      selectedPortId === selectedComp.ports[2].id
                        ? 'bg-amber-500 text-slate-950 border-amber-200 shadow-lg shadow-amber-500/30 font-black'
                        : 'bg-[#252a34] text-amber-300 border-amber-500/50 hover:bg-amber-950/50'
                    }`}
                  >
                    <span>🔀</span>
                    <span>Salir Ramal (#3)</span>
                  </button>
                </div>

                {/* Botones para rotar hacia dónde apunta el ramal de la Te (+90° / -90° / 180°) */}
                <div className="flex items-center gap-1 pt-1">
                  <span className="text-[10px] text-slate-400 font-mono">Orientar Ramal:</span>
                  <button
                    type="button"
                    onClick={() => {
                      vibrate(15);
                      rotateSelectedComponent(90);
                    }}
                    className="flex-1 py-1 px-1.5 rounded bg-[#252a34] hover:bg-[#323846] border border-[#434c5e] text-sky-300 font-bold text-[10px] active:scale-95"
                  >
                    🔄 +90°
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      vibrate(15);
                      rotateSelectedComponent(-90);
                    }}
                    className="flex-1 py-1 px-1.5 rounded bg-[#252a34] hover:bg-[#323846] border border-[#434c5e] text-sky-300 font-bold text-[10px] active:scale-95"
                  >
                    🔄 -90°
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      vibrate(15);
                      rotateSelectedComponent(180);
                    }}
                    className="flex-1 py-1 px-1.5 rounded bg-[#252a34] hover:bg-[#323846] border border-[#434c5e] text-sky-300 font-bold text-[10px] active:scale-95"
                  >
                    🔄 180°
                  </button>
                </div>
              </div>
            )}

            {/* CONTROLES ESPECIALES PARA CODO (ROTAR ORIENTACIÓN DEL CODO) */}
            {selectedComp.type === 'ELBOW' && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-mono text-slate-300">
                  Girar salida del Codo sobre su eje:
                </span>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      vibrate(15);
                      rotateSelectedComponent(90);
                    }}
                    className="py-1.5 px-2 rounded bg-[#252a34] hover:bg-[#323846] border border-[#434c5e] text-sky-300 font-bold text-[10px] active:scale-95"
                  >
                    🔄 +90°
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      vibrate(15);
                      rotateSelectedComponent(-90);
                    }}
                    className="py-1.5 px-2 rounded bg-[#252a34] hover:bg-[#323846] border border-[#434c5e] text-sky-300 font-bold text-[10px] active:scale-95"
                  >
                    🔄 -90°
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      vibrate(15);
                      rotateSelectedComponent(45);
                    }}
                    className="py-1.5 px-2 rounded bg-[#252a34] hover:bg-[#323846] border border-[#434c5e] text-amber-300 font-bold text-[10px] active:scale-95"
                  >
                    🔄 +45°
                  </button>
                </div>
              </div>
            )}

            {/* CONTROLES ESPECIALES PARA CAÑERÍA (MODIFICAR LARGO EN MILÍMETROS) */}
            {selectedComp.type === 'PIPE' && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-mono text-slate-300">
                  Modificar largo del caño seleccionado (mm):
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={editLength}
                    onChange={(e) => setEditLength(e.target.value)}
                    className="w-24 px-2 py-1 rounded bg-[#111418] border border-[#3a4150] text-sky-300 font-mono font-bold text-xs focus:outline-none focus:border-[#38bdf8]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const val = parseFloat(editLength);
                      if (!isNaN(val) && val >= 50) {
                        vibrate(15);
                        updateSelectedPipeLength(val);
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-[#0696d7] hover:bg-[#0582ba] text-white font-bold text-[10px] active:scale-95"
                  >
                    Aplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = (parseFloat(editLength) || 500) + 250;
                      setEditLength(next.toString());
                      updateSelectedPipeLength(next);
                    }}
                    className="px-2 py-1 rounded bg-[#252a34] border border-[#3a4150] text-slate-200 font-bold text-[10px]"
                  >
                    +250
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};
