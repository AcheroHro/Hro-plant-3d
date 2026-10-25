import React, { useState } from 'react';
import { usePipingStore } from '../store/usePipingStore';

export const BomModal: React.FC = () => {
  const isBomOpen = usePipingStore((s) => s.isBomOpen);
  const toggleBom = usePipingStore((s) => s.toggleBom);
  const graph = usePipingStore((s) => s.graph);
  const version = usePipingStore((s) => s.version);
  const specCode = usePipingStore((s) => s.specCode);

  const [activeTab, setActiveTab] = useState<'BOM' | 'CUT_LIST'>('BOM');

  if (!isBomOpen) return null;

  const bom = graph.calculateBillOfMaterials();
  const cutList = graph.calculatePipeCutList();
  const totalPipesLengthM =
    bom
      .filter((b) => b.type === 'PIPE')
      .reduce((sum, b) => sum + b.totalCutLengthMm, 0) / 1000;

  const formatTypeBadge = (type: string) => {
    switch (type) {
      case 'PIPE':
        return { label: 'CAÑO', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' };
      case 'ELBOW':
        return { label: 'CODO', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
      case 'TEE':
        return { label: 'TE', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
      case 'FLANGE':
        return { label: 'BRIDA', cls: 'bg-purple-500/20 text-purple-300 border-purple-500/40' };
      case 'VALVE':
        return { label: 'VÁLVULA', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
      case 'REDUCER':
        return { label: 'REDUCCIÓN', cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' };
      case 'CAP':
        return { label: 'CASQUETE', cls: 'bg-slate-500/20 text-slate-300 border-slate-500/40' };
      case 'GASKET':
        return { label: 'JUNTA (P3dJoint)', cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50' };
      case 'BOLT_SET':
        return { label: 'ESPÁRRAGOS (P3dJoint)', cls: 'bg-orange-500/20 text-orange-300 border-orange-500/50' };
      default:
        return { label: type, cls: 'bg-slate-700 text-slate-200 border-slate-600' };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm select-none">
      <div className="w-full max-w-2xl bg-[#1e2128] border border-[#3a3f4d] rounded-xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden">
        {/* Cabecera estilo AutoCAD Plant 3D Data Manager */}
        <div className="h-14 px-4 bg-[#252830] border-b border-[#3a3f4d] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#0696d7]/20 border border-[#0696d7] text-[#38bdf8] text-sm font-black">
              DM
            </span>
            <div className="flex flex-col">
              <span className="font-bold text-sm text-slate-100">
                Data Manager • Cómputo BOM y Lista de Cortes
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                Spec: <strong className="text-[#38bdf8]">{specCode}</strong> • Rev {version} • Total Cañería: {totalPipesLengthM.toFixed(2)} m
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleBom}
            className="w-8 h-8 rounded bg-[#2f333d] border border-[#434959] text-slate-300 font-bold flex items-center justify-center hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        {/* Pestañas de navegación: BOM General vs Planilla de Cortes */}
        <div className="flex px-4 pt-2 bg-[#181a20] border-b border-[#3a3f4d] gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('BOM')}
            className={`px-3 py-2 text-xs font-bold rounded-t border-t border-x transition-all ${
              activeTab === 'BOM'
                ? 'bg-[#1e2128] text-[#38bdf8] border-[#3a3f4d]'
                : 'bg-transparent text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            📊 Materiales + Juntas/Espárragos ({bom.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('CUT_LIST')}
            className={`px-3 py-2 text-xs font-bold rounded-t border-t border-x transition-all ${
              activeTab === 'CUT_LIST'
                ? 'bg-[#1e2128] text-emerald-400 border-[#3a3f4d]'
                : 'bg-transparent text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            🪚 Planilla de Cortes Individuales ({cutList.length})
          </button>
        </div>

        {/* Contenido tabular */}
        <div className="flex-1 overflow-y-auto p-3">
          {activeTab === 'BOM' ? (
            bom.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                No hay cañerías ni accesorios en el modelo 3D actual.
              </div>
            ) : (
              <div className="border border-[#3a3f4d] rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#252830] text-slate-300 border-b border-[#3a3f4d] font-mono text-[11px]">
                    <tr>
                      <th className="p-2.5">Categoría</th>
                      <th className="p-2.5">Descripción de Catálogo (.pspc)</th>
                      <th className="p-2.5 text-center">ND</th>
                      <th className="p-2.5 text-center">Cant.</th>
                      <th className="p-2.5 text-right">Corte Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2c303a] text-slate-200">
                    {bom.map((item, idx) => {
                      const badge = formatTypeBadge(item.type);
                      return (
                        <tr key={idx} className="hover:bg-[#262a34]">
                          <td className="p-2.5">
                            <span
                              className={`inline-block px-2 py-0.5 rounded border text-[10px] font-bold ${badge.cls}`}
                            >
                              {badge.label}
                            </span>
                          </td>
                          <td className="p-2.5 text-[11px] text-slate-200 font-mono">
                            {item.description}
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold text-[#38bdf8]">
                            {item.nominalDiameter}"
                          </td>
                          <td className="p-2.5 text-center font-bold font-mono text-white">
                            {item.quantity}
                          </td>
                          <td className="p-2.5 text-right font-mono text-emerald-400">
                            {item.totalCutLengthMm > 0 ? `${item.totalCutLengthMm.toFixed(1)} mm` : 'Unid.'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : cutList.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              No hay tramos rectos de cañería para listar cortes.
            </div>
          ) : (
            <div className="border border-[#3a3f4d] rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#252830] text-slate-300 border-b border-[#3a3f4d] font-mono text-[11px]">
                  <tr>
                    <th className="p-2.5">Marca Iso</th>
                    <th className="p-2.5 text-center">ND</th>
                    <th className="p-2.5 text-center">Sched</th>
                    <th className="p-2.5 text-right">Cota Eje a Eje</th>
                    <th className="p-2.5 text-right">Corte Neto Taller</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2c303a] text-slate-200 font-mono">
                  {cutList.map((cut) => (
                    <tr key={cut.componentId} className="hover:bg-[#262a34]">
                      <td className="p-2.5 font-bold text-amber-400">C-{cut.itemNumber}</td>
                      <td className="p-2.5 text-center text-[#38bdf8]">{cut.nominalDiameter}"</td>
                      <td className="p-2.5 text-center text-slate-300">{cut.schedule}</td>
                      <td className="p-2.5 text-right text-slate-400">
                        {cut.grossLengthMm.toFixed(1)} mm
                      </td>
                      <td className="p-2.5 text-right font-bold text-emerald-400">
                        {cut.cutLengthMm.toFixed(1)} mm
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pie del modal */}
        <div className="h-12 px-4 bg-[#252830] border-t border-[#3a3f4d] flex items-center justify-between text-[11px] text-slate-400">
          <span>Reglas P3dJoint activas: Bridas y Válvulas incluyen Juntas + Espárragos</span>
          <button
            type="button"
            onClick={toggleBom}
            className="px-4 py-1.5 bg-[#0696d7] hover:bg-[#0582ba] text-white font-bold rounded text-xs"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
