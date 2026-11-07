import React, { useState, useEffect, useMemo } from 'react';
import { usePipingStore } from '../store/usePipingStore';
import { PcfExporter } from '../core/exporters/PcfExporter';
import { DxfExporter, DxfViewType } from '../core/exporters/DxfExporter';
import { downloadFile } from '../utils/fileDownloader';
import { DrawingsSection } from './DrawingsSection';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  const graph = usePipingStore((s) => s.graph);
  const version = usePipingStore((s) => s.version);
  const specCode = usePipingStore((s) => s.specCode);
  const activeLineNumber = usePipingStore((s) => s.lineNumber);

  const [dxfView, setDxfView] = useState<DxfViewType>('ISO');
  const [lineRef, setLineRef] = useState<string>(activeLineNumber || 'LINE-101');
  const [boreUnits, setBoreUnits] = useState<'INCH' | 'MM'>('INCH');
  const [pcfTarget, setPcfTarget] = useState<'plant' | 'isogen'>('plant');
  const [includeWelds, setIncludeWelds] = useState<boolean>(true);
  const [includeMaterials, setIncludeMaterials] = useState<boolean>(true);
  const [showPcfPreview, setShowPcfPreview] = useState<boolean>(false);
  const [copiedPcf, setCopiedPcf] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen && activeLineNumber) {
      setLineRef(activeLineNumber);
    }
  }, [isOpen, activeLineNumber]);

  const pcfPreviewContent = useMemo(() => {
    if (!isOpen) return '';
    return PcfExporter.exportToPcf(graph, {
      pipelineReference: lineRef,
      projectIdentifier: 'ACHERO_PLANT_3D',
      boreUnits,
      target: pcfTarget,
      includeWeldsAndFasteners: includeWelds,
      includeMaterialsTable: includeMaterials
    });
  }, [isOpen, graph, version, lineRef, boreUnits, pcfTarget, includeWelds, includeMaterials]);

  // Modelo que vino de un PCF: la unidad de diámetros es la del archivo original
  const pcfSource = graph.pcfInfo;
  const effectiveBore = pcfSource?.boreUnits ?? boreUnits;

  if (!isOpen) return null;

  const safeBaseName = (lineRef || 'line_101').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

  const pcfFileName = pcfTarget === 'plant' ? `${safeBaseName}.pcf` : `${safeBaseName}_isogen.pcf`;

  const handleExportPcf = () => {
    downloadFile(pcfFileName, pcfPreviewContent, 'text/plain');
    usePipingStore.setState({
      statusMessage: `Archivo PCF exportado: ${pcfFileName} (${graph.components.size} piezas).`
    });
  };

  const handleCopyPcf = async () => {
    try {
      await navigator.clipboard.writeText(pcfPreviewContent);
      setCopiedPcf(true);
      setTimeout(() => setCopiedPcf(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleExportDxf = () => {
    const dxfContent = DxfExporter.exportToDxf(graph, dxfView, lineRef);
    downloadFile(`${safeBaseName}_${dxfView.toLowerCase()}.dxf`, dxfContent, 'application/dxf');
    usePipingStore.setState({
      statusMessage: `Plano DXF exportado: ${safeBaseName}_${dxfView.toLowerCase()}.dxf`
    });
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
      <div className="w-full max-w-2xl bg-[#1e2128] border border-[#3a3f4d] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Cabecera estilo AutoCAD Plant 3D Production Iso */}
        <div className="h-14 px-5 bg-[#252830] border-b border-[#3a3f4d] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#0696d7]/20 border border-[#0696d7] text-[#38bdf8] text-sm font-black">
              ISO
            </span>
            <div>
              <h3 className="font-bold text-sm text-slate-100">
                Planos PDF, PCF y DXF
              </h3>
              <p className="text-[10px] text-slate-400 font-mono">
                Spec: {specCode} • {compCount} piezas • {jointCount} uniones • Rev {version}
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
        <div className="p-4 space-y-4 text-xs overflow-y-auto max-h-[78vh]">
          {/* Campo de Referencia de Línea */}
          <div className="bg-[#181a20] p-3 rounded-lg border border-[#3a3f4d]">
            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
              Line Number / Pipeline Reference
            </label>
            <input
              type="text"
              value={lineRef}
              onChange={(e) => setLineRef(e.target.value.toUpperCase())}
              className="w-full h-9 px-3 bg-[#252830] border border-[#434959] rounded font-mono text-sm font-bold text-[#38bdf8] outline-none focus:border-[#0696d7]"
              placeholder="100-CS150-2"
            />
          </div>

          {/* Planos isométricos en PDF (línea y spools) */}
          <DrawingsSection lineRef={lineRef} />

          {/* Opción 1: Exportar Isométrico PCF (PnPIsoPCFWriter / Isogen compatible) */}
          <div className="bg-[#252830] border border-[#0696d7]/60 rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-100 flex items-center space-x-1.5">
                <span>📄</span>
                <span>Archivo de Tubería (.PCF)</span>
              </span>
              <span className="text-[10px] bg-[#0696d7]/20 text-[#38bdf8] font-mono font-bold px-2 py-0.5 rounded border border-[#0696d7]/40">
                {pcfTarget === 'plant' ? 'PCF TO PIPE • PLANT 3D 2027' : 'ISOGEN'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1 mb-2">
              {(['plant', 'isogen'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPcfTarget(t)}
                  className={`h-8 rounded text-[11px] font-bold border transition-all ${
                    pcfTarget === t ? 'bg-[#0696d7] text-white border-[#38bdf8]' : 'bg-[#232832] text-slate-400 border-[#343b48]'
                  }`}
                >
                  {t === 'plant' ? 'Volver a Plant 3D' : 'Isogen completo'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              {pcfTarget === 'plant' ? (
                <>
                  Para cargar en Plant 3D 2027 con <code className="text-[#38bdf8] font-mono">PCF to Pipe</code>: una spec por pieza, CRLF, sin soldaduras ni juntas (Plant las agrega).
                  {pcfSource
                    ? ' Las piezas que vinieron del PCF y no se tocaron salen igual que en el archivo; las movidas cambian solo sus coordenadas.'
                    : ''}
                </>
              ) : (
                <>Con soldaduras, juntas, bulones, tabla MATERIALS y los datos de taller de cada niple (tag y bisel), para Isogen o para volver a abrirlo en la app.</>
              )}
            </p>

            {/* Opciones de Formato PCF */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 bg-[#181a20] p-2.5 rounded border border-[#343b48]">
              <div>
                <span className="text-[9px] uppercase font-bold text-slate-400 block mb-1">
                  Unidad Diámetro (UNITS-BORE)
                </span>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    disabled={!!pcfSource}
                    onClick={() => setBoreUnits('INCH')}
                    className={`h-7 rounded font-mono text-[10px] font-bold border transition-all ${
                      effectiveBore === 'INCH'
                        ? 'bg-[#0696d7] text-white border-[#38bdf8]'
                        : 'bg-[#232832] text-slate-400 border-[#343b48]'
                    }`}
                  >
                    INCH (2")
                  </button>
                  <button
                    type="button"
                    disabled={!!pcfSource}
                    onClick={() => setBoreUnits('MM')}
                    className={`h-7 rounded font-mono text-[10px] font-bold border transition-all ${
                      effectiveBore === 'MM'
                        ? 'bg-[#0696d7] text-white border-[#38bdf8]'
                        : 'bg-[#232832] text-slate-400 border-[#343b48]'
                    }`}
                  >
                    MM (DN 50)
                  </button>
                </div>
              </div>

              {pcfTarget === 'isogen' && (
              <div className="flex flex-col justify-center space-y-1.5 pl-1">
                <label className="flex items-center space-x-2 cursor-pointer text-[10px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={includeWelds}
                    onChange={(e) => setIncludeWelds(e.target.checked)}
                    className="accent-[#0696d7] rounded"
                  />
                  <span>Incluir Soldaduras / Juntas / Espárragos</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer text-[10px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={includeMaterials}
                    onChange={(e) => setIncludeMaterials(e.target.checked)}
                    className="accent-[#0696d7] rounded"
                  />
                  <span>Incluir Tabla MATERIALS al pie</span>
                </label>
              </div>
              )}
              {pcfSource && (
                <p className="text-[10px] text-slate-400 sm:col-span-2">
                  Modelo leído de {pcfSource.sourceName ? `"${pcfSource.sourceName}"` : 'un PCF'}: se respeta su cabecera y su unidad ({pcfSource.boreUnits}).
                </p>
              )}
            </div>

            {/* Botones de Acción PCF */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportPcf}
                disabled={compCount === 0}
                className="flex-1 h-10 rounded bg-[#0696d7] hover:bg-[#0582ba] text-white font-extrabold text-xs shadow-md active:scale-[0.99] transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                <span>⬇</span>
                <span>DESCARGAR ARCHIVO .PCF</span>
              </button>

              <button
                type="button"
                onClick={() => setShowPcfPreview((v) => !v)}
                className="h-10 px-3 rounded bg-[#181a20] hover:bg-[#2f333d] text-slate-200 border border-[#434959] font-mono font-bold text-[10px] transition-colors"
                title="Ver código interno del archivo .PCF generado"
              >
                {showPcfPreview ? 'Ocultar PCF' : 'Ver Código'}
              </button>

              <button
                type="button"
                onClick={handleCopyPcf}
                disabled={compCount === 0}
                className="h-10 px-3 rounded bg-[#181a20] hover:bg-[#2f333d] text-amber-300 border border-amber-500/40 font-mono font-bold text-[10px] transition-colors disabled:opacity-50"
                title="Copiar texto del archivo .PCF al portapapeles"
              >
                {copiedPcf ? '✓ Copiado' : '📋 Copiar'}
              </button>
            </div>

            {/* Vista Previa del Código PCF */}
            {showPcfPreview && (
              <div className="mt-3">
                <pre className="w-full max-h-44 overflow-auto p-2.5 rounded bg-[#111318] border border-[#343b48] text-[10px] font-mono text-emerald-300 leading-relaxed select-text">
                  {pcfPreviewContent}
                </pre>
              </div>
            )}
          </div>

          {/* Opción 2: Exportar DXF Isométrico 2D con Cotas + Tablas BOM/Cortes */}
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
