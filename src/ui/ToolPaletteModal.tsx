import React, { useState } from 'react';
import * as THREE from 'three';
import { usePipingStore } from '../store/usePipingStore';
import { ComponentType } from '../types/piping';

export const ToolPaletteModal: React.FC = () => {
  const isToolPaletteOpen = usePipingStore((s) => s.isToolPaletteOpen);
  const toggleToolPalette = usePipingStore((s) => s.toggleToolPalette);
  const nominalDiameter = usePipingStore((s) => s.nominalDiameter);
  const setNominalDiameter = usePipingStore((s) => s.setNominalDiameter);
  const specReader = usePipingStore((s) => s.specReader);
  const specCode = usePipingStore((s) => s.specCode);
  const numpadValue = usePipingStore((s) => s.numpadValue);
  const insertFitting = usePipingStore((s) => s.insertFitting);

  // Estados locales para opciones de inserción avanzada
  const [selectedBranchAxis, setSelectedBranchAxis] = useState<'UP' | 'DOWN' | 'NORTH' | 'SOUTH'>('UP');
  const [selectedReducerTarget, setSelectedReducerTarget] = useState<number>(
    nominalDiameter > 1 ? nominalDiameter - 1 : 2
  );

  if (!isToolPaletteOpen) return null;

  const triggerHaptic = () => {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(20);
      } catch {
        // Ignorar si no está soportado
      }
    }
  };

  const availableDiameters = specReader
    ? specReader.getAvailableNominalDiameters(specCode)
    : [0.5, 0.75, 1, 1.5, 2, 3, 4, 6];

  // Datos de los accesorios activos según la especificación
  const pipeSpec = specReader?.findPipe(nominalDiameter, specCode);
  const elbow90Spec = specReader?.findElbow(nominalDiameter, 90, specCode);
  const elbow45Spec = specReader?.findElbow(nominalDiameter, 45, specCode);
  const teeSpec = specReader?.findTee(nominalDiameter, specCode);
  const flangeSpec = specReader?.findFlange(nominalDiameter, specCode);
  const valveSpec = specReader?.findValve(nominalDiameter, specCode);
  const reducerSpec = specReader?.findReducer(nominalDiameter, selectedReducerTarget, specCode);
  const capSpec = specReader?.findCap(nominalDiameter, specCode);
  const gasketSpec = specReader?.findGasket(nominalDiameter, specCode);
  const boltSetSpec = specReader?.findBoltSet(nominalDiameter, specCode);

  const handleInsert = (
    type: ComponentType,
    options?: { angle?: number; branchDir?: THREE.Vector3; targetNd?: number; continueOnBranch?: boolean }
  ) => {
    triggerHaptic();
    insertFitting(type, options);
    // Cerrar paleta para volver al visor 3D
    toggleToolPalette();
  };

  const getBranchVector = () => {
    switch (selectedBranchAxis) {
      case 'UP':
        return new THREE.Vector3(0, 0, 1);
      case 'DOWN':
        return new THREE.Vector3(0, 0, -1);
      case 'NORTH':
        return new THREE.Vector3(0, 1, 0);
      case 'SOUTH':
        return new THREE.Vector3(0, -1, 0);
      default:
        return new THREE.Vector3(0, 0, 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
      <div className="w-full sm:max-w-xl max-h-[88vh] bg-[#1e2128] border-t sm:border border-[#3a3f4d] sm:rounded-xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        
        {/* Cabecera estilo AutoCAD Plant 3D Dynamic Tool Palette */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#3a3f4d] bg-[#252830]">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded bg-amber-500/20 border border-amber-500/50 text-lg">
              🧰
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white tracking-wide">
                Dynamic Tool Palette • {specCode}
              </h2>
              <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                <span>Spec Activa: <strong className="text-[#38bdf8]">{specCode}</strong></span>
                <span>•</span>
                <span>ND: <strong className="text-emerald-400">{nominalDiameter}"</strong></span>
                <span>•</span>
                <span className="text-amber-400">P3dJoint Auto</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              triggerHaptic();
              toggleToolPalette();
            }}
            className="w-9 h-9 flex items-center justify-center rounded bg-[#2f333d] border border-[#434959] text-slate-300 hover:text-white hover:bg-slate-700 active:scale-95 transition-all text-base"
            aria-label="Cerrar paleta"
          >
            ✕
          </button>
        </div>

        {/* Selector rápido de Diámetro Nominal en cabecera */}
        <div className="px-5 py-2.5 bg-[#181a20] border-b border-[#3a3f4d] flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider shrink-0">
            Size (ND):
          </span>
          <div className="flex gap-1.5 shrink-0">
            {availableDiameters.map((d) => (
              <button
                key={d}
                onClick={() => {
                  triggerHaptic();
                  setNominalDiameter(d);
                }}
                className={`px-3 py-1 text-xs font-bold rounded transition-all ${
                  nominalDiameter === d
                    ? 'bg-[#0696d7] text-white shadow-md font-extrabold scale-105'
                    : 'bg-[#252830] text-slate-300 border border-[#3a3f4d] hover:bg-[#2f333d]'
                }`}
              >
                {d}"
              </button>
            ))}
          </div>
        </div>

        {/* Contenido de Accesorios (Grid con Scroll suave) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5 no-scrollbar">

          {/* 1. CAÑERÍA / NIPLE RECTO */}
          <div className="p-3.5 bg-[#252830] rounded-lg border border-[#3a3f4d] hover:border-sky-500/50 transition-all flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-sky-950/70 border border-sky-600/40 flex items-center justify-center text-2xl shrink-0">
                🚰
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Pipe • Cañería / Niple Recto</h3>
                <p className="text-xs text-slate-400">
                  {pipeSpec ? (
                    <>OD: <span className="text-sky-300 font-mono">{pipeSpec.outerDiameter.toFixed(1)} mm</span> • Espesor: <span className="text-sky-300 font-mono">{pipeSpec.wallThickness.toFixed(2)} mm</span></>
                  ) : (
                    'Especificación estándar ASME'
                  )}
                </p>
                <p className="text-[11px] text-emerald-400 font-medium mt-0.5">
                  Longitud Numpad: <strong>{numpadValue || '1000'} mm</strong>
                </p>
              </div>
            </div>
            <button
              onClick={() => handleInsert('PIPE')}
              className="px-4 py-2.5 bg-[#0696d7] hover:bg-[#0582ba] active:scale-95 text-white font-bold text-xs rounded shadow-lg shrink-0 transition-all"
            >
              Insertar
            </button>
          </div>

          {/* 2. CODO 90° LR */}
          <div className="p-3.5 bg-[#252830] rounded-lg border border-[#3a3f4d] hover:border-emerald-500/50 transition-all flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-emerald-950/70 border border-emerald-600/40 flex items-center justify-center text-2xl shrink-0">
                ↩️
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Elbow 90° LR • Codo 90° Radio Largo</h3>
                <p className="text-xs text-slate-400">
                  {elbow90Spec ? (
                    <>Take-Off: <span className="text-emerald-300 font-mono">{(elbow90Spec.takeOff || elbow90Spec.radius || 76.2).toFixed(1)} mm</span> • {elbow90Spec.shortDescription}</>
                  ) : (
                    'ASME B16.9 Codo 90°'
                  )}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">Gira hacia el vector director activo del ViewCube</p>
              </div>
            </div>
            <button
              onClick={() => handleInsert('ELBOW', { angle: 90 })}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded shadow-lg shrink-0 transition-all"
            >
              Insertar
            </button>
          </div>

          {/* 3. CODO 45° LR */}
          <div className="p-3.5 bg-[#252830] rounded-lg border border-[#3a3f4d] hover:border-emerald-500/50 transition-all flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-emerald-950/70 border border-emerald-600/40 flex items-center justify-center text-2xl shrink-0">
                📐
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Elbow 45° LR • Codo 45° Radio Largo</h3>
                <p className="text-xs text-slate-400">
                  {elbow45Spec ? (
                    <>Take-Off: <span className="text-emerald-300 font-mono">{(elbow45Spec.takeOff || 35.0).toFixed(1)} mm</span> • {elbow45Spec.shortDescription}</>
                  ) : (
                    'ASME B16.9 Codo 45°'
                  )}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">Desvío angular diagonal de 45°</p>
              </div>
            </div>
            <button
              onClick={() => handleInsert('ELBOW', { angle: 45 })}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded shadow-lg shrink-0 transition-all"
            >
              Insertar
            </button>
          </div>

          {/* 4. TE IGUAL */}
          <div className="p-3.5 bg-[#252830] rounded-lg border border-[#3a3f4d] hover:border-amber-500/50 transition-all space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-amber-950/70 border border-amber-600/40 flex items-center justify-center text-2xl shrink-0">
                  🔀
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Tee • Te Recta Igual (3 Bocas)</h3>
                  <p className="text-xs text-slate-400">
                    {teeSpec ? (
                      <>Run (C): <span className="text-amber-300 font-mono">{(teeSpec.runTakeOff || 63.5).toFixed(1)} mm</span> • Branch (M): <span className="text-amber-300 font-mono">{(teeSpec.branchTakeOff || 63.5).toFixed(1)} mm</span></>
                    ) : (
                      'ASME B16.9 Te Igual'
                    )}
                  </p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
                <button
                  onClick={() => handleInsert('TEE', { branchDir: getBranchVector(), continueOnBranch: false })}
                  className="px-3 py-2 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white font-bold text-[11px] rounded shadow shrink-0 transition-all"
                  title="Insertar Te y continuar trazando por la línea principal (#2)"
                >
                  ➡ Seguir Línea
                </button>
                <button
                  onClick={() => handleInsert('TEE', { branchDir: getBranchVector(), continueOnBranch: true })}
                  className="px-3 py-2 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-[11px] rounded shadow shrink-0 transition-all"
                  title="Insertar Te y salir directamente por el Ramal a 90° (#3)"
                >
                  🔀 Salir Ramal 90°
                </button>
              </div>
            </div>
            
            {/* Selector de orientación de la derivación branch */}
            <div className="pt-2 border-t border-slate-700/60 flex items-center justify-between text-xs">
              <span className="text-slate-400">Boca de Derivación:</span>
              <div className="flex gap-1">
                {(['UP', 'DOWN', 'NORTH', 'SOUTH'] as const).map((axis) => (
                  <button
                    key={axis}
                    onClick={() => {
                      triggerHaptic();
                      setSelectedBranchAxis(axis);
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                      selectedBranchAxis === axis
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {axis === 'UP' ? '+Z (Arriba)' : axis === 'DOWN' ? '-Z (Abajo)' : axis === 'NORTH' ? '+Y (Norte)' : '-Y (Sur)'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 5. BRIDA WN (WELD NECK) + P3dJoint Fasteners */}
          <div className="p-3.5 bg-[#252830] rounded-lg border border-[#3a3f4d] hover:border-purple-500/50 transition-all flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-purple-950/70 border border-purple-600/40 flex items-center justify-center text-2xl shrink-0">
                ⭕
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Flange WN RF • Brida con Cuello</h3>
                <p className="text-xs text-slate-400">
                  {flangeSpec ? (
                    <>Cara a cara: <span className="text-purple-300 font-mono">{(flangeSpec.faceToFace || 63.5).toFixed(1)} mm</span> • {flangeSpec.shortDescription}</>
                  ) : (
                    'ASME B16.5 Clase 150 RF'
                  )}
                </p>
                <p className="text-[10px] text-amber-300 font-mono mt-0.5">
                  ⚡ P3dJoint Auto: +1 {gasketSpec?.shortDescription || 'Gasket'} &amp; +1 Juego Espárragos ({boltSetSpec?.boltCount || 4}x {boltSetSpec?.boltSize || '1/2"'})
                </p>
              </div>
            </div>
            <button
              onClick={() => handleInsert('FLANGE')}
              className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-bold text-xs rounded shadow-lg shrink-0 transition-all"
            >
              Insertar
            </button>
          </div>

          {/* 6. VÁLVULA + P3dJoint Fasteners */}
          <div className="p-3.5 bg-[#252830] rounded-lg border border-[#3a3f4d] hover:border-rose-500/50 transition-all flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-rose-950/70 border border-rose-600/40 flex items-center justify-center text-2xl shrink-0">
                🛑
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Valve • Válvula Bridada Industrial</h3>
                <p className="text-xs text-slate-400">
                  {valveSpec ? (
                    <>Cara a cara: <span className="text-rose-300 font-mono">{(valveSpec.faceToFace || 178).toFixed(1)} mm</span> • {valveSpec.shortDescription}</>
                  ) : (
                    'ASME B16.10 Válvula con volante'
                  )}
                </p>
                <p className="text-[10px] text-amber-300 font-mono mt-0.5">
                  ⚡ P3dJoint Auto: +2 Juntas &amp; +2 Juegos Espárragos ({boltSetSpec?.boltCount || 4}x {boltSetSpec?.boltSize || '1/2"'})
                </p>
              </div>
            </div>
            <button
              onClick={() => handleInsert('VALVE')}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs rounded shadow-lg shrink-0 transition-all"
            >
              Insertar
            </button>
          </div>

          {/* 7. REDUCCIÓN CONCÉNTRICA */}
          <div className="p-3.5 bg-slate-800/80 rounded-xl border border-slate-700/70 hover:border-cyan-500/50 transition-all space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-cyan-950/70 border border-cyan-600/40 flex items-center justify-center text-2xl shrink-0">
                  🔻
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Reducción Concéntrica</h3>
                  <p className="text-xs text-slate-400">
                    {nominalDiameter}" a <span className="text-cyan-300 font-bold">{selectedReducerTarget}"</span> • L: <span className="text-cyan-300 font-mono">{(reducerSpec?.faceToFace || 88.9).toFixed(1)} mm</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleInsert('REDUCER', { targetNd: selectedReducerTarget })}
                className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-900/30 shrink-0 transition-all"
              >
                Insertar
              </button>
            </div>

            {/* Selector de diámetro destino para la reducción */}
            <div className="pt-2 border-t border-slate-700/60 flex items-center justify-between text-xs overflow-x-auto no-scrollbar gap-2">
              <span className="text-slate-400 shrink-0">Diámetro Destino:</span>
              <div className="flex gap-1 shrink-0">
                {availableDiameters
                  .filter((d) => d !== nominalDiameter)
                  .map((d) => (
                    <button
                      key={d}
                      onClick={() => {
                        triggerHaptic();
                        setSelectedReducerTarget(d);
                      }}
                      className={`px-2 py-1 rounded text-[11px] font-bold ${
                        selectedReducerTarget === d
                          ? 'bg-cyan-500 text-slate-950'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {d}"
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {/* 8. TAPA / CASQUETE (CAP) */}
          <div className="p-3.5 bg-slate-800/80 rounded-xl border border-slate-700/70 hover:border-slate-500/50 transition-all flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-slate-900/90 border border-slate-600/40 flex items-center justify-center text-2xl shrink-0">
                ⏹️
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Tapa / Casquete (Cap)</h3>
                <p className="text-xs text-slate-400">
                  {capSpec ? (
                    <>Altura: <span className="text-slate-300 font-mono">{(capSpec.faceToFace || 38.1).toFixed(1)} mm</span> • ASME B16.9</>
                  ) : (
                    'ASME B16.9 Casquete elíptico'
                  )}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">Cierre hermético de línea de cañería</p>
              </div>
            </div>
            <button
              onClick={() => handleInsert('CAP')}
              className="px-4 py-2.5 bg-slate-600 hover:bg-slate-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-lg shrink-0 transition-all"
            >
              Colocar
            </button>
          </div>

        </div>

        {/* Pie de la paleta con atajo */}
        <div className="px-5 py-3 bg-slate-950 border-t border-cad-border flex items-center justify-between text-xs text-slate-400">
          <span>Toca cualquier accesorio para insertarlo en el puerto seleccionado.</span>
          <button
            onClick={() => {
              triggerHaptic();
              toggleToolPalette();
            }}
            className="text-sky-400 hover:text-sky-300 font-semibold"
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
};
