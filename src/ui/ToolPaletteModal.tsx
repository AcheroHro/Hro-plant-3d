import React, { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Search, X } from 'lucide-react';
import { usePipingStore } from '../store/usePipingStore';
import { ComponentType, SpecFitting } from '../types/piping';
import { PartCategory } from '../core/specs/catalogTypes';
import { FamilyOption } from '../core/specs/SpecCatalog';
import { formatNominal } from '../core/specs/units';
import { PieceIconKind } from '../core/specs/paletteItems';
import { PieceGrid } from './PieceGrid';
import { PieceIcon } from './icons/PieceIcons';

const normalizeQuery = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const CONFIDENCE_BADGE: Record<string, { label: string; cls: string; title: string }> = {
  verified: { label: '✓', cls: 'text-emerald-400', title: 'Ubicación de las bocas verificada contra Plant 3D' },
  standard: { label: '≈', cls: 'text-sky-300', title: 'Según norma; todavía no verificada importando en Plant 3D' },
  approximate: { label: '!', cls: 'text-amber-400', title: 'Geometría aproximada: revisar al importar en Plant 3D' }
};

interface SectionProps {
  title: string;
  icon: PieceIconKind;
  category: PartCategory;
  spec: SpecFitting | null | undefined;
  families: FamilyOption[];
  preferred?: string;
  query?: string;
  detail?: React.ReactNode;
  onPickFamily: (familyId: string | null) => void;
  actions: React.ReactNode;
  children?: React.ReactNode;
}

/** Bloque de un tipo de pieza: pieza que se va a insertar + familias de la spec para elegir */
const PartSection: React.FC<SectionProps> = ({ title, icon, spec, families, preferred, query = '', detail, onPickFamily, actions, children }) => {
  const q = normalizeQuery(query.trim());
  const matchesFamily = (f: FamilyOption) =>
    !q ||
    normalizeQuery(`${f.familyDesc} ${f.skey ?? ''} ${f.endTypes.join(' ')} ${f.pressureClass ?? ''}`).includes(q);
  const filteredFamilies = q ? families.filter(matchesFamily) : families;
  const headerMatches =
    !q || normalizeQuery(`${title} ${spec?.shortDescription ?? ''} ${spec?.skey ?? ''} ${spec?.itemCode ?? ''}`).includes(q);
  if (q && !headerMatches && filteredFamilies.length === 0) return null;

  const badge = spec?.geometryConfidence ? CONFIDENCE_BADGE[spec.geometryConfidence] : undefined;
  const shownFamilies = q && filteredFamilies.length > 0 ? filteredFamilies : families;
  return (
    <div className="p-3 bg-[#252830] rounded-lg border border-[#3a3f4d] space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-11 h-10 rounded-lg bg-[#181a20] border border-[#3a3f4d] flex items-center justify-center shrink-0">
            <PieceIcon kind={icon} className="w-9 h-7" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">{title}</h3>
            <p className="text-[11px] text-slate-300 leading-snug break-words">
              {spec ? (
                <>
                  {badge && (
                    <span className={`font-black mr-1 ${badge.cls}`} title={badge.title}>
                      {badge.label}
                    </span>
                  )}
                  {spec.shortDescription}
                </>
              ) : (
                <span className="text-rose-300">La spec no tiene esta pieza en este diámetro.</span>
              )}
            </p>
            {spec && detail && <p className="text-[11px] text-slate-400 font-mono mt-0.5">{detail}</p>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">{actions}</div>
      </div>
      {shownFamilies.length > 1 && (
        <div className="flex gap-1 overflow-x-auto no-scrollbar pt-1 border-t border-slate-700/60">
          <button
            onClick={() => onPickFamily(null)}
            className={`px-2 py-1 rounded text-[10px] font-bold shrink-0 ${
              !preferred ? 'bg-[#0696d7] text-white' : 'bg-slate-700 text-slate-300'
            }`}
            title="Usar el orden de prioridad de la spec de Plant 3D"
          >
            Auto (spec)
          </button>
          {shownFamilies.map((f) => (
            <button
              key={f.familyId}
              onClick={() => onPickFamily(f.familyId)}
              className={`px-2 py-1 rounded text-[10px] font-semibold shrink-0 max-w-[220px] truncate ${
                preferred === f.familyId ? 'bg-[#0696d7] text-white' : 'bg-slate-700 text-slate-300'
              }`}
              title={`${f.familyDesc} • extremos ${f.endTypes.join('/')}${f.pressureClass ? ` • clase ${f.pressureClass}` : ''}`}
            >
              {f.skey ? `${f.skey} · ` : ''}
              {f.familyDesc}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
};

export const ToolPaletteModal: React.FC = () => {
  const isToolPaletteOpen = usePipingStore((s) => s.isToolPaletteOpen);
  const toggleToolPalette = usePipingStore((s) => s.toggleToolPalette);
  const nominalDiameter = usePipingStore((s) => s.nominalDiameter);
  const setNominalDiameter = usePipingStore((s) => s.setNominalDiameter);
  const specReader = usePipingStore((s) => s.specReader);
  const specCode = usePipingStore((s) => s.specCode);
  const numpadValue = usePipingStore((s) => s.numpadValue);
  const insertFitting = usePipingStore((s) => s.insertFitting);
  const preferredFamilies = usePipingStore((s) => s.preferredFamilies);
  const setPreferredFamily = usePipingStore((s) => s.setPreferredFamily);
  const version = usePipingStore((s) => s.version);
  const graph = usePipingStore((s) => s.graph);
  const selectedPortId = usePipingStore((s) => s.selectedPortId);

  const [selectedBranchAxis, setSelectedBranchAxis] = useState<'UP' | 'DOWN' | 'NORTH' | 'SOUTH'>('UP');
  const [selectedReducerTarget, setSelectedReducerTarget] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // El puerto activo define con qué extremo se conecta la próxima pieza
  const activePort = selectedPortId ? graph.ports.get(selectedPortId) : undefined;
  const opts = { connectToEndType: activePort?.plantEndType, pressureClass: activePort?.pressureClass };

  const data = useMemo(() => {
    if (!specReader) return null;
    const nd = nominalDiameter;
    const fam = (c: PartCategory) => specReader.listFamilies(c, nd);
    const reducerTargets = Array.from(new Set(fam('REDUCER').flatMap((f) => f.secondarySizes))).sort((a, b) => b - a);
    return {
      sizes: specReader.getAvailableNominalDiameters(),
      unit: specReader.catalog.data.parts.find((p) => p.ports[0])?.ports[0].nominalUnit ?? 'in',
      pipe: specReader.findPipe(nd, specCode, opts),
      elbow90: specReader.findElbow(nd, 90, specCode, opts),
      elbow45: specReader.findElbow(nd, 45, specCode, opts),
      tee: specReader.findTee(nd, specCode, opts),
      flange: specReader.findFlange(nd, specCode, opts),
      valve: specReader.findValve(nd, specCode, opts),
      cap: specReader.findCap(nd, specCode, opts),
      families: {
        PIPE: fam('PIPE'),
        ELBOW: fam('ELBOW'),
        TEE: fam('TEE').filter((f) => f.secondarySizes.some((s) => Math.abs(s - nd) < 0.001)),
        FLANGE: fam('FLANGE'),
        VALVE: fam('VALVE'),
        REDUCER: fam('REDUCER'),
        CAP: fam('CAP')
      },
      reducerTargets,
      hasPriorities: (specReader.catalog.preferences?.priorities.length ?? 0) > 0
    };
    // version: se recalcula al cambiar familias fijadas o la spec
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specReader, nominalDiameter, specCode, version, activePort?.plantEndType, activePort?.pressureClass]);

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

  const handleInsert = (
    type: ComponentType,
    options?: { angle?: number; branchDir?: THREE.Vector3; targetNd?: number; continueOnBranch?: boolean }
  ) => {
    triggerHaptic();
    insertFitting(type, options);
    toggleToolPalette();
  };

  const pick = (category: PartCategory) => (familyId: string | null) => {
    triggerHaptic();
    setPreferredFamily(category, familyId);
  };

  const getBranchVector = () => {
    switch (selectedBranchAxis) {
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

  const fmt = (d: number) => formatNominal(d, data?.unit === 'mm' ? 'mm' : 'in');
  const reducerTarget =
    selectedReducerTarget !== null && data?.reducerTargets.includes(selectedReducerTarget)
      ? selectedReducerTarget
      : data?.reducerTargets[0];
  const reducerSpec =
    specReader && reducerTarget !== undefined ? specReader.findReducer(nominalDiameter, reducerTarget, specCode, opts) : null;
  const btn = 'px-3 py-2 active:scale-95 text-white font-bold text-xs rounded shadow transition-all disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
      <div className="w-full sm:max-w-xl max-h-[88vh] bg-[#1e2128] border-t sm:border border-[#3a3f4d] sm:rounded-xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3a3f4d] bg-[#252830]">
          <div>
            <h2 className="text-sm font-bold text-white">Catálogo de la spec • {specCode}</h2>
            <p className="text-[11px] text-slate-400">
              {specReader?.isNativePlant3D ? 'Spec de Plant 3D' : 'Catálogo demo (no es una spec de Plant)'}
              {data?.hasPriorities ? ' • con prioridades del .pspx' : specReader?.isNativePlant3D ? ' • sin .pspx: elige por extremos' : ''}
              {activePort?.plantEndType ? ` • conecta a extremo ${activePort.plantEndType}` : ''}
            </p>
          </div>
          <button
            onClick={() => {
              triggerHaptic();
              toggleToolPalette();
            }}
            className="w-9 h-9 flex items-center justify-center rounded bg-[#2f333d] border border-[#434959] text-slate-300 hover:text-white"
            aria-label="Cerrar paleta"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-2 bg-[#181a20] border-b border-[#3a3f4d] flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-xs text-slate-400 font-semibold uppercase shrink-0">Diámetro:</span>
          {(data?.sizes ?? []).map((d) => (
            <button
              key={d}
              onClick={() => {
                triggerHaptic();
                setNominalDiameter(d);
              }}
              className={`px-3 py-1 text-xs font-bold rounded shrink-0 ${
                nominalDiameter === d ? 'bg-[#0696d7] text-white' : 'bg-[#252830] text-slate-300 border border-[#3a3f4d]'
              }`}
            >
              {fmt(d)}
            </button>
          ))}
        </div>

        <div className="px-4 py-2 bg-[#16181e] border-b border-[#3a3f4d] flex items-center gap-2">
          <div className="relative flex-1 flex items-center">
            <Search size={14} className="absolute left-2.5 text-slate-400 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar pieza, material, norma, schedule (ej. WN, RF, 300, SCH40)..."
              aria-label="Buscar en el catálogo de la spec"
              className="w-full h-9 pl-8 pr-8 rounded-lg bg-[#111419] border border-[#343b48] text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-[#0696d7]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-1.5 w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-white"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {data && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 no-scrollbar">
            {!searchQuery.trim() && (
              <div className="p-3 bg-[#252830] rounded-lg border border-[#3a3f4d]">
                <PieceGrid variant="sheet" onInserted={toggleToolPalette} showRecents={false} />
              </div>
            )}
            <h3 className="pt-1 text-[10px] uppercase tracking-wide font-bold text-slate-400">
              Familia que se usa en cada tipo (queda fijada para la spec)
            </h3>
            <PartSection
              title="Caño"
              icon="pipe"
              category="PIPE"
              spec={data.pipe}
              families={data.families.PIPE}
              preferred={preferredFamilies.PIPE}
              onPickFamily={pick('PIPE')}
              query={searchQuery}
              detail={data.pipe && `OD ${data.pipe.outerDiameter.toFixed(1)} • esp. ${data.pipe.wallThickness.toFixed(2)} mm • largo ${numpadValue || '1000'} mm`}
              actions={
                <button disabled={!data.pipe} onClick={() => handleInsert('PIPE')} className={`${btn} bg-[#0696d7]`}>
                  Insertar
                </button>
              }
            />

            <PartSection
              title="Codo"
              icon="elbow90"
              category="ELBOW"
              spec={data.elbow90 ?? data.elbow45}
              families={data.families.ELBOW}
              preferred={preferredFamilies.ELBOW}
              onPickFamily={pick('ELBOW')}
              query={searchQuery}
              detail={
                <>
                  {data.elbow90 && `90°: centro a puerto ${data.elbow90.takeOff?.toFixed(1)} mm`}
                  {data.elbow90 && data.elbow45 && ' • '}
                  {data.elbow45 && `45°: ${data.elbow45.takeOff?.toFixed(1)} mm`}
                </>
              }
              actions={
                <>
                  <button disabled={!data.elbow90} onClick={() => handleInsert('ELBOW', { angle: 90 })} className={`${btn} bg-emerald-600`}>
                    90°
                  </button>
                  <button disabled={!data.elbow45} onClick={() => handleInsert('ELBOW', { angle: 45 })} className={`${btn} bg-emerald-700`}>
                    45°
                  </button>
                </>
              }
            />

            <PartSection
              title="Te"
              icon="teeRun"
              category="TEE"
              spec={data.tee}
              families={data.families.TEE}
              preferred={preferredFamilies.TEE}
              onPickFamily={pick('TEE')}
              query={searchQuery}
              detail={data.tee && `recorrido ${data.tee.runTakeOff?.toFixed(1)} • ramal ${data.tee.branchTakeOff?.toFixed(1)} mm`}
              actions={
                <>
                  <button
                    disabled={!data.tee}
                    onClick={() => handleInsert('TEE', { branchDir: getBranchVector(), continueOnBranch: false })}
                    className={`${btn} bg-sky-600`}
                  >
                    ➡ Seguir
                  </button>
                  <button
                    disabled={!data.tee}
                    onClick={() => handleInsert('TEE', { branchDir: getBranchVector(), continueOnBranch: true })}
                    className={`${btn} bg-amber-500 text-slate-950`}
                  >
                    🔀 Ramal
                  </button>
                </>
              }
            >
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="text-slate-400 shrink-0">Ramal hacia:</span>
                <div className="flex gap-1 overflow-x-auto no-scrollbar">
                  {(['UP', 'DOWN', 'NORTH', 'SOUTH'] as const).map((axis) => (
                    <button
                      key={axis}
                      onClick={() => setSelectedBranchAxis(axis)}
                      className={`px-2 py-1 rounded text-[11px] font-bold shrink-0 ${
                        selectedBranchAxis === axis ? 'bg-amber-500 text-slate-950' : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {axis === 'UP' ? '+Z' : axis === 'DOWN' ? '-Z' : axis === 'NORTH' ? '+Y' : '-Y'}
                    </button>
                  ))}
                </div>
              </div>
            </PartSection>

            <PartSection
              title="Brida"
              icon="flangeWN"
              category="FLANGE"
              spec={data.flange}
              families={data.families.FLANGE}
              preferred={preferredFamilies.FLANGE}
              onPickFamily={pick('FLANGE')}
              query={searchQuery}
              detail={data.flange && `cara a puerto del caño ${data.flange.faceToFace?.toFixed(3)} mm • se orienta sola según el extremo`}
              actions={
                <button disabled={!data.flange} onClick={() => handleInsert('FLANGE')} className={`${btn} bg-purple-600`}>
                  Insertar
                </button>
              }
            />

            <PartSection
              title="Válvula"
              icon="valveGate"
              category="VALVE"
              spec={data.valve}
              families={data.families.VALVE}
              preferred={preferredFamilies.VALVE}
              onPickFamily={pick('VALVE')}
              query={searchQuery}
              detail={
                data.valve &&
                `cara a cara ${data.valve.faceToFace?.toFixed(1)} mm • extremos ${data.valve.plantEndTypes?.join('/') ?? data.valve.endType}`
              }
              actions={
                <button disabled={!data.valve} onClick={() => handleInsert('VALVE')} className={`${btn} bg-rose-600`}>
                  Insertar
                </button>
              }
            />

            <PartSection
              title="Reducción"
              icon="reducerConcentric"
              category="REDUCER"
              spec={reducerSpec}
              families={data.families.REDUCER}
              preferred={preferredFamilies.REDUCER}
              onPickFamily={pick('REDUCER')}
              query={searchQuery}
              detail={reducerSpec && `largo ${reducerSpec.faceToFace?.toFixed(1)} mm • extremo chico OD ${reducerSpec.reducedOuterDiameter?.toFixed(2)} mm`}
              actions={
                <button
                  disabled={!reducerSpec}
                  onClick={() => handleInsert('REDUCER', { targetNd: reducerTarget })}
                  className={`${btn} bg-cyan-600`}
                >
                  Insertar
                </button>
              }
            >
              {data.reducerTargets.length > 0 && (
                <div className="flex items-center gap-2 text-xs overflow-x-auto no-scrollbar">
                  <span className="text-slate-400 shrink-0">Reduce a:</span>
                  {data.reducerTargets.map((d) => (
                    <button
                      key={d}
                      onClick={() => setSelectedReducerTarget(d)}
                      className={`px-2 py-1 rounded text-[11px] font-bold shrink-0 ${
                        reducerTarget === d ? 'bg-cyan-500 text-slate-950' : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {fmt(d)}
                    </button>
                  ))}
                </div>
              )}
            </PartSection>

            <PartSection
              title="Tapa"
              icon="cap"
              category="CAP"
              spec={data.cap}
              families={data.families.CAP}
              preferred={preferredFamilies.CAP}
              onPickFamily={pick('CAP')}
              query={searchQuery}
              detail={data.cap && `altura desde el puerto ${data.cap.faceToFace?.toFixed(1)} mm`}
              actions={
                <button disabled={!data.cap} onClick={() => handleInsert('CAP')} className={`${btn} bg-slate-600`}>
                  Colocar
                </button>
              }
            />
          </div>
        )}

        <div className="px-4 py-2.5 bg-slate-950 border-t border-[#3a3f4d] text-[11px] text-slate-400">
          <span className="text-emerald-400 font-black">✓</span> verificada con Plant •{' '}
          <span className="text-sky-300 font-black">≈</span> según norma •{' '}
          <span className="text-amber-400 font-black">!</span> aproximada. Las familias fijadas se recuerdan por spec.
        </div>
      </div>
    </div>
  );
};
