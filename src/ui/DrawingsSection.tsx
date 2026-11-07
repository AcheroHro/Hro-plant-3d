import React, { useEffect, useMemo, useState } from 'react';
import { usePipingStore } from '../store/usePipingStore';
import { buildIsoSheets, IsoSheetOptions } from '../core/drawings/isoSheet';
import { sheetsToPdf } from '../core/drawings/pdfWriter';
import { sheetToSvg } from '../core/drawings/svgWriter';
import { PaperSize } from '../core/drawings/sheet';
import { downloadBytes, shareBytes } from '../utils/fileDownloader';

const STORE_KEY = 'achero.drawing';

interface Saved {
  project: string;
  revision: string;
  drawnBy: string;
  paper: PaperSize;
}

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { project: '', revision: '0', drawnBy: '', paper: 'A3', ...JSON.parse(raw) };
  } catch {
    // sin almacenamiento
  }
  return { project: '', revision: '0', drawnBy: '', paper: 'A3' };
}

/** Exporta y comparte isométricos en PDF: la línea completa y un plano por spool */
export function exportDrawingsPdf(
  graph: ReturnType<typeof usePipingStore.getState>['graph'],
  options: IsoSheetOptions,
  fileBase: string,
  share = false
): Promise<boolean> {
  const sheets = buildIsoSheets(graph, { ...loadSaved(), ...options });
  const pdf = sheetsToPdf(sheets, { title: fileBase, author: options.drawnBy || 'Achero Plant 3D' });
  const name = `${fileBase.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  if (share) return shareBytes(name, pdf, 'application/pdf', fileBase);
  downloadBytes(name, pdf, 'application/pdf');
  return Promise.resolve(true);
}

export const DrawingsSection: React.FC<{ lineRef: string }> = ({ lineRef }) => {
  const graph = usePipingStore((s) => s.graph);
  const version = usePipingStore((s) => s.version);
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [includeLine, setIncludeLine] = useState(true);
  const [includeSpools, setIncludeSpools] = useState(true);
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch {
      // sin almacenamiento
    }
  }, [saved]);

  const options: IsoSheetOptions = {
    ...saved,
    includeLine,
    spoolIds: includeSpools ? undefined : []
  };
  const sheets = useMemo(
    () => (graph.components.size ? buildIsoSheets(graph, options) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, version, saved, includeLine, includeSpools]
  );
  const current = sheets[Math.min(page, sheets.length - 1)];
  const svg = useMemo(() => (current ? sheetToSvg(current) : ''), [current]);
  const base = `ISO_${lineRef || graph.activeLineNumber}`;

  const pdfBytes = () => sheetsToPdf(sheets, { title: base, author: saved.drawnBy || 'Achero Plant 3D' });
  const fileName = `${base.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  const download = () => {
    downloadBytes(fileName, pdfBytes(), 'application/pdf');
    usePipingStore.setState({ statusMessage: `Planos PDF exportados: ${fileName} (${sheets.length} hojas).` });
  };
  const share = async () => {
    const ok = await shareBytes(fileName, pdfBytes(), 'application/pdf', base);
    if (!ok) {
      download();
      setMsg('Este navegador no comparte archivos: se descargó el PDF.');
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const field = (label: string, key: keyof Saved, placeholder = '') => (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase font-bold text-slate-400">{label}</span>
      <input
        value={saved[key]}
        placeholder={placeholder}
        onChange={(e) => setSaved({ ...saved, [key]: e.target.value })}
        className="h-8 px-2 bg-[#232832] border border-[#434959] rounded text-[11px] text-slate-100 outline-none focus:border-[#0696d7]"
      />
    </label>
  );

  return (
    <div className="bg-[#252830] border border-emerald-600/60 rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-slate-100">Planos isométricos (PDF)</span>
        <span className="text-[10px] bg-emerald-600/20 text-emerald-300 font-mono font-bold px-2 py-0.5 rounded border border-emerald-600/40">
          {sheets.length} HOJAS
        </span>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
        Isométrico de la línea y uno por spool, como los de Plant: cotas a centro de accesorio y cara de brida, globos de ítem, soldaduras,
        lista de materiales, cortes y rótulo.
      </p>

      <div className="grid grid-cols-2 gap-2 mb-2">
        {field('Proyecto', 'project', 'Obra / cliente')}
        {field('Dibujó', 'drawnBy', 'Nombre')}
        {field('Revisión', 'revision')}
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase font-bold text-slate-400">Hoja</span>
          <div className="grid grid-cols-2 gap-1">
            {(['A3', 'A4'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSaved({ ...saved, paper: p })}
                className={`h-8 rounded text-[11px] font-bold border ${
                  saved.paper === p ? 'bg-[#0696d7] text-white border-[#38bdf8]' : 'bg-[#232832] text-slate-400 border-[#343b48]'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </label>
      </div>
      <div className="flex gap-4 mb-3 text-[11px] text-slate-300">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={includeLine} onChange={(e) => setIncludeLine(e.target.checked)} className="accent-[#0696d7]" />
          Línea completa
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={includeSpools} onChange={(e) => setIncludeSpools(e.target.checked)} className="accent-[#0696d7]" />
          Un plano por spool
        </label>
      </div>

      {current && (
        <div className="mb-3">
          <div className="flex items-center gap-1 mb-1 overflow-x-auto">
            {sheets.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPage(i)}
                className={`h-6 px-2 rounded text-[10px] font-mono font-bold border shrink-0 ${
                  i === page ? 'bg-emerald-600 text-white border-emerald-400' : 'bg-[#181a20] text-slate-400 border-[#343b48]'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="rounded border border-[#343b48] overflow-hidden bg-white" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={download}
          disabled={!sheets.length}
          className="flex-1 h-10 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs disabled:opacity-50"
        >
          ⬇ DESCARGAR PDF
        </button>
        <button
          type="button"
          onClick={share}
          disabled={!sheets.length}
          className="h-10 px-3 rounded bg-[#181a20] border border-[#434959] text-slate-200 font-bold text-[11px] disabled:opacity-50"
        >
          {msg ? '✓' : 'Compartir'}
        </button>
      </div>
      {msg && <p className="text-[10px] text-amber-300 mt-1">{msg}</p>}
    </div>
  );
};
