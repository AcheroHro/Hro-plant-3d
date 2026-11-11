import React, { useState } from 'react';
import { usePipingStore } from '../store/usePipingStore';
import { NippleEndFinish } from '../types/piping';
import { downloadFile } from '../utils/fileDownloader';

export const BomModal: React.FC = () => {
  const isBomOpen = usePipingStore((s) => s.isBomOpen);
  const toggleBom = usePipingStore((s) => s.toggleBom);
  const graph = usePipingStore((s) => s.graph);
  const version = usePipingStore((s) => s.version);
  const specCode = usePipingStore((s) => s.specCode);
  const lineNumber = usePipingStore((s) => s.lineNumber);
  const updatePipeEndFinishes = usePipingStore((s) => s.updatePipeEndFinishes);
  const setSelectedComponentId = usePipingStore((s) => s.setSelectedComponentId);

  const [activeTab, setActiveTab] = useState<'CUT_LIST' | 'BOM'>('CUT_LIST');
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);

  if (!isBomOpen) return null;

  const bom = graph.calculateBillOfMaterials();
  const cutList = graph.calculatePipeCutList();
  const totalPipesLengthM =
    bom
      .filter((b) => b.type === 'PIPE')
      .reduce((sum, b) => sum + b.totalCutLengthMm, 0) / 1000;

  const handleExportCsv = () => {
    const headers = [
      'Nro de cano',
      'Linea',
      'Diametro Nominal (in)',
      'Largo (mm)',
      'Extremo 1',
      'Extremo 2',
      'Schedule'
    ];
    const rows = cutList.map((c) => [
      c.nippleId,
      c.lineNumber,
      `${c.nominalDiameter}"`,
      Math.round(c.cutLengthMm).toString(),
      c.endFinish1,
      c.endFinish2,
      c.schedule
    ]);
    const csvContent =
      '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
    downloadFile(`Lista_Cortes_${lineNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`, csvContent, 'text/csv');
  };

  const handleShareOrCopyCutList = async () => {
    const lines = [
      `LISTA DE CORTES — LÍNEA: ${lineNumber} (Spec ${specCode})`,
      '------------------------------------------------------------',
      ...cutList.map(
        (c) =>
          `${c.nippleId} | ND ${c.nominalDiameter}" | Largo: ${Math.round(c.cutLengthMm)} mm | Ext.1: ${c.endFinish1} | Ext.2: ${c.endFinish2}`
      ),
      '------------------------------------------------------------',
      `Total de caños: ${cutList.length} (${totalPipesLengthM.toFixed(2)} m lineales)`
    ];
    const text = lines.join('\n');

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `Lista de Cortes ${lineNumber}`,
          text
        });
        return;
      } catch {
        // Fallback to clipboard
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopiedMsg('Copiado al portapapeles');
      setTimeout(() => setCopiedMsg(null), 2500);
    }
  };

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
        return { label: 'TAPA', cls: 'bg-slate-500/20 text-slate-300 border-slate-500/40' };
      case 'GASKET':
        return { label: 'JUNTA', cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50' };
      case 'BOLT_SET':
        return { label: 'BULONES', cls: 'bg-orange-500/20 text-orange-300 border-orange-500/50' };
      default:
        return { label: type, cls: 'bg-slate-700 text-slate-200 border-slate-600' };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm select-none">
      <div className="w-full max-w-3xl bg-[#1b1f26] border border-[#343b48] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Cabecera estilo AutoCAD Plant 3D Data Manager */}
        <div className="h-14 px-4 bg-[#232832] border-b border-[#343b48] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded bg-[#0696d7]/20 border border-[#0696d7] text-[#38bdf8] text-xs font-mono font-black">
              P3D
            </span>
            <div className="flex flex-col">
              <span className="font-bold text-sm text-slate-100">
                Lista de cortes y materiales
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                Línea: <strong className="text-amber-300">{lineNumber}</strong> • Spec:{' '}
                <strong className="text-[#38bdf8]">{specCode}</strong> • Rev {version} • Total Caño:{' '}
                {totalPipesLengthM.toFixed(2)} m
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleBom}
            className="w-8 h-8 rounded bg-[#2f3542] border border-[#434959] text-slate-300 font-bold flex items-center justify-center hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        {/* Pestañas de navegación */}
        <div className="flex px-4 pt-2 bg-[#161920] border-b border-[#343b48] gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('CUT_LIST')}
            className={`px-3.5 py-2 text-xs font-bold rounded-t border-t border-x transition-all ${
              activeTab === 'CUT_LIST'
                ? 'bg-[#1b1f26] text-emerald-400 border-[#343b48]'
                : 'bg-transparent text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            Lista de cortes ({cutList.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('BOM')}
            className={`px-3.5 py-2 text-xs font-bold rounded-t border-t border-x transition-all ${
              activeTab === 'BOM'
                ? 'bg-[#1b1f26] text-[#38bdf8] border-[#343b48]'
                : 'bg-transparent text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            Lista de Materiales BOM ({bom.length})
          </button>
        </div>

        {/* Contenido tabular */}
        <div className="flex-1 overflow-y-auto p-3">
          {activeTab === 'CUT_LIST' ? (
            cutList.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                Todavía no hay caños en el modelo.
              </div>
            ) : (
              <div className="border border-[#343b48] rounded-lg overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#232832] text-slate-300 border-b border-[#343b48] font-mono text-[11px]">
                    <tr>
                      <th className="p-2.5">N.º de caño</th>
                      <th className="p-2.5 text-center">ND</th>
                      <th className="p-2.5 text-right">Largo (mm)</th>
                      <th className="p-2.5 text-center">Extremo 1</th>
                      <th className="p-2.5 text-center">Extremo 2</th>
                      <th className="p-2.5 text-center">Ver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2a303c] text-slate-200 font-mono">
                    {cutList.map((cut) => (
                      <tr key={cut.componentId} className="hover:bg-[#252a34]">
                        <td className="p-2.5 font-black text-amber-400 text-sm">
                          {cut.nippleId}
                        </td>
                        <td className="p-2.5 text-center text-[#38bdf8] font-bold">
                          {cut.nominalDiameter}&quot;
                        </td>
                        <td className="p-2.5 text-right font-black text-emerald-400 text-sm">
                          {Math.round(cut.cutLengthMm)} mm
                        </td>
                        <td className="p-2 text-center">
                          <select
                            value={cut.endFinish1}
                            onChange={(e) =>
                              updatePipeEndFinishes(
                                cut.componentId,
                                e.target.value as NippleEndFinish,
                                cut.endFinish2
                              )
                            }
                            className="px-2 py-1 rounded bg-[#14171d] border border-[#3a4252] text-xs font-bold text-slate-100 focus:outline-none focus:border-[#38bdf8]"
                          >
                            <option value="Bisel">Bisel</option>
                            <option value="Plano">Plano</option>
                            <option value="Roscado">Roscado</option>
                          </select>
                        </td>
                        <td className="p-2 text-center">
                          <select
                            value={cut.endFinish2}
                            onChange={(e) =>
                              updatePipeEndFinishes(
                                cut.componentId,
                                cut.endFinish1,
                                e.target.value as NippleEndFinish
                              )
                            }
                            className="px-2 py-1 rounded bg-[#14171d] border border-[#3a4252] text-xs font-bold text-slate-100 focus:outline-none focus:border-[#38bdf8]"
                          >
                            <option value="Bisel">Bisel</option>
                            <option value="Plano">Plano</option>
                            <option value="Roscado">Roscado</option>
                          </select>
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedComponentId(cut.componentId);
                              toggleBom();
                            }}
                            className="px-2 py-1 rounded bg-[#0696d7]/20 hover:bg-[#0696d7] text-[#38bdf8] hover:text-white border border-[#0696d7]/50 text-[10px] font-bold transition-colors"
                          >
                            Ver en 3D
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : bom.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              Todavía no hay piezas en el modelo.
            </div>
          ) : (
            <div className="border border-[#343b48] rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#232832] text-slate-300 border-b border-[#343b48] font-mono text-[11px]">
                  <tr>
                    <th className="p-2.5">Categoría</th>
                    <th className="p-2.5">Descripción de la spec</th>
                    <th className="p-2.5 text-center">ND</th>
                    <th className="p-2.5 text-center">Cant.</th>
                    <th className="p-2.5 text-right">Largo total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2a303c] text-slate-200">
                  {bom.map((item, idx) => {
                    const badge = formatTypeBadge(item.type);
                    return (
                      <tr key={idx} className="hover:bg-[#252a34]">
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
                          {item.nominalDiameter}&quot;
                        </td>
                        <td className="p-2.5 text-center font-bold font-mono text-white">
                          {item.quantity}
                        </td>
                        <td className="p-2.5 text-right font-mono text-emerald-400">
                          {item.totalCutLengthMm > 0 ? `${Math.round(item.totalCutLengthMm)} mm` : 'Unid.'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pie del modal con exportación directa a CSV (Excel) y compartir por WhatsApp */}
        <div className="px-4 py-2.5 bg-[#232832] border-t border-[#343b48] flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs transition-all"
            >
              Exportar CSV (Excel)
            </button>
            <button
              type="button"
              onClick={handleShareOrCopyCutList}
              className="px-3 py-1.5 bg-[#2f3542] hover:bg-[#3b4252] border border-[#4b5563] text-slate-100 font-bold rounded text-xs transition-all"
            >
              {copiedMsg || 'Compartir / Copiar Lista'}
            </button>
          </div>
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
