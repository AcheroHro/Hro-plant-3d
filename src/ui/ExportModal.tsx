import React, { useState } from 'react';
import { usePipingStore } from '../store/usePipingStore';
import { PcfExporter } from '../core/exporters/PcfExporter';
import { DxfExporter, DxfViewType } from '../core/exporters/DxfExporter';
import { downloadFile } from '../utils/fileDownloader';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  const graph = usePipingStore((s) => s.graph);
  const version = usePipingStore((s) => s.version);
  const specCode = usePipingStore((s) => s.specCode);
  const [dxfView, setDxfView] = useState<DxfViewType>('ISO');
  const [lineRef, setLineRef] = useState<string>('LINE-101');

  if (!isOpen) return null;

  const handleExportPcf = () => {
    const pcfContent = PcfExporter.exportToPcf(graph, {
      pipelineReference: lineRef,
      projectIdentifier: 'ACHERO_PLANT_3D'
    });
    downloadFile(`${lineRef.toLowerCase()}_isogen.pcf`, pcfContent, 'text/plain');
  };

  const handleExportDxf = () => {
    const dxfContent = DxfExporter.exportToDxf(graph, dxfView, lineRef);
    downloadFile(`${lineRef.toLowerCase()}_${dxfView.toLowerCase()}.dxf`, dxfContent, 'application/dxf');
  };

  const compCount = graph.components.size;
  const jointCount = graph.joints.size;

  const viewOptions: { id: DxfViewType; label: string }[] = [
    { id: 'ISO', label: 'Isométrico 2D' },
    { id: 'ALL', label: 'Lámina Completa' },
    { id: 'TOP', label: 'Planta (XY)' },
    { id: 'FRONT', label: 'Alzado (XZ)' },
    { id: 'SIDE', label: 'Perfil (YZ)' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm select-none">
      <div className="w-full max-w-md bg-[#1e2128] border border-[#3a3f4d] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Cabecera estilo AutoCAD Plant 3D Production Iso */}
        <div className="h-14 px-5 bg-[#252830] border-b border-[#3a3f4d] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#0696d7]/20 border border-[#0696d7] text-[#38bdf8] text-sm font-black">
              ISO
            </span>
            <div>
              <h3 className="font-bold text-sm text-slate-100">
                Create Production Iso / Plano DXF
              </h3>
              <p className="text-[10px] text-slate-400 font-mono">
                Spec: {specCode} • {compCount} piezas • {jointCount} soldaduras/bridas • Rev {version}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded bg-[#2f333d] border border-[#434959] text-slate-300 font-bold flex items-center justify-center hover:bg-slate-700 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Contenido */}
        <div className="p-4 space-y-4 text-xs overflow-y-auto max-h-[75vh]">
          {/* Campo de Referencia de Línea */}
          <div className="bg-[#181a20] p-3 rounded-lg border border-[#3a3f4d]">
            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
              Line Number (Identificador de Línea)
            </label>
            <input
              type="text"
              value={lineRef}
              onChange={(e) => setLineRef(e.target.value.toUpperCase())}
              className="w-full h-9 px-3 bg-[#252830] border border-[#434959] rounded font-mono text-sm font-bold text-[#38bdf8] outline-none focus:border-[#0696d7]"
              placeholder="LINE-101"
            />
          </div>

          {/* Opción 1: Exportar DXF Isométrico 2D con Cotas + Tablas BOM/Cortes */}
          <div className="bg-[#252830] border border-[#3a3f4d] rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-100 flex items-center space-x-1.5">
                <span>📐</span>
                <span>Plano CAD 2D con Cotas y Tablas (.DXF)</span>
              </span>
              <span className="text-[10px] bg-emerald-500/15 text-emerald-400 font-mono font-bold px-2 py-0.5 rounded border border-emerald-500/30">
                AutoCAD DWG/DXF
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              Genera el plano 2D con proyección <strong className="text-slate-200">Isométrica 30°/150°</strong>, cotas milimétricas, globos de corte (<code className="text-amber-300 font-mono">C-1, C-2</code>), soldaduras, <strong className="text-slate-200">Tabla BOM con Juntas/Espárragos</strong> y <strong className="text-slate-200">Planilla de Cortes</strong>.
            </p>

            {/* Selector de Proyección */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 mb-3">
              {viewOptions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setDxfView(v.id)}
                  className={`h-8 px-1.5 rounded font-bold text-[10px] border transition-all ${
                    dxfView === v.id
                      ? 'bg-[#0696d7] text-white border-[#38bdf8] shadow'
                      : 'bg-[#1b1e24] text-slate-300 border-[#3a3f4d] hover:bg-[#2f333d]'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleExportDxf}
              disabled={compCount === 0}
              className="w-full h-10 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-md active:scale-[0.99] transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              <span>⬇</span>
              <span>DESCARGAR PLANO .DXF ({dxfView})</span>
            </button>
          </div>

          {/* Opción 2: Exportar Isométrico PCF (PnPIsoPCFWriter compatible) */}
          <div className="bg-[#252830] border border-[#3a3f4d] rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-100 flex items-center space-x-1.5">
                <span>📄</span>
                <span>Archivo de Tubería Isogen (.PCF)</span>
              </span>
              <span className="text-[10px] bg-[#0696d7]/20 text-[#38bdf8] font-mono font-bold px-2 py-0.5 rounded border border-[#0696d7]/40">
                PLANTPCFTOISO
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              Exporta la topología 3D exacta compatible con el comando <code className="text-[#38bdf8] font-mono">PLANTPCFTOISO</code> de tu AutoCAD Plant 3D 2027.
            </p>
            <button
              type="button"
              onClick={handleExportPcf}
              disabled={compCount === 0}
              className="w-full h-10 rounded bg-[#0696d7] hover:bg-[#0582ba] text-white font-extrabold text-xs shadow-md active:scale-[0.99] transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              <span>⬇</span>
              <span>DESCARGAR ARCHIVO .PCF</span>
            </button>
          </div>
        </div>

        {/* Pie */}
        <div className="h-12 px-5 bg-[#252830] border-t border-[#3a3f4d] flex items-center justify-between text-xs text-slate-400">
          <span>Formato vectorial 1:1 en milímetros</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#2f333d] text-slate-200 font-bold rounded border border-[#434959] hover:bg-slate-700"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
