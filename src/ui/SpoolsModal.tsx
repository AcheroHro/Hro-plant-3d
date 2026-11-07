import React, { useMemo, useState } from 'react';
import { usePipingStore } from '../store/usePipingStore';
import { FieldWeldKind } from '../types/piping';
import { computeSpools, spoolSheetText, Spool, SpoolWeld } from '../core/spools/spoolEngine';
import { downloadFile } from '../utils/fileDownloader';
import { SPOOL_COLORS } from '../viewport/spoolColors';
import { exportDrawingsPdf } from './DrawingsSection';

const mm = (v: number) => `${Math.round(v)}`;
const nd = (v: number) => `${v}"`;

const WELD_LABEL: Record<string, string> = { SHOP: 'Taller', FW: 'Campo', FFW: 'Campo + sobrelargo' };

/**
 * Spools de la línea: piezas de taller separadas en bridas y soldaduras de campo,
 * con su lista de cortes, accesorios y soldaduras, y los materiales de montaje.
 */
export const SpoolsModal: React.FC = () => {
  const isOpen = usePipingStore((s) => s.isSpoolsOpen);
  const toggleSpools = usePipingStore((s) => s.toggleSpools);
  const graph = usePipingStore((s) => s.graph);
  const version = usePipingStore((s) => s.version);
  const lineNumber = usePipingStore((s) => s.lineNumber);
  const spoolView = usePipingStore((s) => s.spoolView);
  const toggleSpoolView = usePipingStore((s) => s.toggleSpoolView);
  const setFieldWeld = usePipingStore((s) => s.setFieldWeld);
  const setSelectedComponentId = usePipingStore((s) => s.setSelectedComponentId);

  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<'SPOOLS' | 'MONTAJE'>('SPOOLS');
  const [copied, setCopied] = useState<string | null>(null);

  const result = useMemo(() => (isOpen ? computeSpools(graph) : null), [isOpen, graph, version]);
  if (!isOpen || !result) return null;
  const { spools, erection, welds } = result;
  const fieldCount = welds.filter((w) => w.kind !== 'SHOP').length;
  const totalInches = spools.reduce((n, s) => n + s.weldInches, 0);

  const share = async (sp: Spool) => {
    const text = spoolSheetText(sp);
    try {
      if (navigator.share) {
        await navigator.share({ title: `Spool ${sp.id}`, text });
        return;
      }
    } catch {
      // sigue al portapapeles
    }
    await navigator.clipboard?.writeText(text);
    setCopied(sp.id);
    setTimeout(() => setCopied(null), 2000);
  };

  const exportCsv = () => {
    const rows = [['Spool', 'Tipo', 'Item', 'ND', 'Cant', 'Largo corte (mm)', 'Sobrelargo (mm)', 'Extremo 1', 'Extremo 2', 'Descripcion']];
    for (const sp of spools) {
      for (const c of sp.cuts) {
        rows.push([sp.id, 'CORTE', c.nippleId, nd(c.nominalDiameter), '1', mm(c.cutLengthMm), mm(c.allowanceMm), c.endFinish1, c.endFinish2, c.description]);
      }
      for (const i of sp.items) {
        rows.push([sp.id, i.type, i.skey || '', `${nd(i.nominalDiameter)}${i.reducedNominalDiameter ? `x${nd(i.reducedNominalDiameter)}` : ''}`, String(i.quantity), '', '', '', '', i.description]);
      }
      for (const w of sp.shopWelds) rows.push([sp.id, 'SOLDADURA', w.number, nd(w.nominalDiameter), '1', '', '', w.type, '', 'Taller']);
    }
    for (const w of welds.filter((x) => x.kind !== 'SHOP')) {
      rows.push([w.spoolIds.join(' / '), 'SOLD. CAMPO', w.number, nd(w.nominalDiameter), '1', '', mm(w.allowanceMm ?? 0), w.type, '', WELD_LABEL[w.kind]]);
    }
    for (const e of erection) rows.push(['MONTAJE', e.type, '', nd(e.nominalDiameter), String(e.quantity), '', '', '', '', e.description]);
    const csv = '﻿' + rows.map((r) => r.map((v) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(';')).join('\r\n');
    downloadFile(`Spools_${lineNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`, csv, 'text/csv');
  };

  const showIn3d = (sp: Spool) => {
    if (!spoolView) toggleSpoolView();
    setSelectedComponentId(sp.componentIds[0]);
    toggleSpools();
  };

  const WeldRow: React.FC<{ w: SpoolWeld }> = ({ w }) => (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="font-mono text-[11px] text-slate-200">
        <strong className={w.kind === 'SHOP' ? 'text-amber-300' : 'text-orange-400'}>{w.number}</strong> {w.type} {nd(w.nominalDiameter)}
        {w.allowanceMm ? <span className="text-orange-300"> +{w.allowanceMm} mm</span> : null}
      </span>
      {w.jointId ? (
        <span className="flex gap-1">
          {(['SHOP', 'FW', 'FFW'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFieldWeld(w.jointId!, k === 'SHOP' ? null : (k as FieldWeldKind))}
              className={`px-1.5 h-6 rounded text-[10px] font-bold border ${
                w.kind === k ? 'bg-[#0696d7] text-white border-[#38bdf8]' : 'bg-[#14171d] text-slate-400 border-[#3a4252] hover:text-slate-100'
              }`}
              title={k === 'SHOP' ? 'Soldadura de taller' : k === 'FW' ? 'Soldadura de campo: corta el spool' : 'De campo con 100 mm de sobrelargo en el caño'}
            >
              {k === 'SHOP' ? 'Taller' : k}
            </button>
          ))}
        </span>
      ) : (
        <span className="text-[10px] text-slate-500">sobre el caño</span>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm select-none">
      <div className="w-full max-w-3xl bg-[#1b1f26] border border-[#343b48] rounded-xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <div className="px-4 py-2.5 bg-[#232832] border-b border-[#343b48] flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-sm text-slate-100">Spools de taller</span>
            <span className="text-[11px] text-slate-400 font-mono truncate">
              {spools.length} spools • {welds.length - fieldCount} soldaduras de taller ({Math.round(totalInches * 10) / 10} pulg-diám) • {fieldCount} de campo
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
              <input type="checkbox" checked={spoolView} onChange={toggleSpoolView} className="accent-[#0696d7]" />
              Colorear en 3D
            </label>
            <button
              type="button"
              onClick={toggleSpools}
              className="w-8 h-8 rounded bg-[#2f3542] border border-[#434959] text-slate-300 font-bold hover:bg-slate-700"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex px-4 pt-2 bg-[#161920] border-b border-[#343b48] gap-2">
          {(['SPOOLS', 'MONTAJE'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3.5 py-2 text-xs font-bold rounded-t border-t border-x ${
                tab === t ? 'bg-[#1b1f26] text-emerald-400 border-[#343b48]' : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              {t === 'SPOOLS' ? `Spools (${spools.length})` : `Materiales de montaje (${erection.length})`}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {tab === 'SPOOLS' ? (
            spools.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">No hay piezas de taller en el modelo.</div>
            ) : (
              spools.map((sp) => {
                const open = openId === sp.id;
                const color = SPOOL_COLORS[sp.colorIndex % SPOOL_COLORS.length];
                return (
                  <div key={sp.id} className="border border-[#343b48] rounded-lg bg-[#20242c]">
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : sp.id)}
                      className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: `#${color.toString(16).padStart(6, '0')}` }} />
                        <span className="font-mono font-black text-amber-300 text-sm truncate">{sp.id}</span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-400 text-right">
                        {sp.cuts.length} cortes • {sp.shopWelds.length} sold. • {sp.envelopeMm.map(mm).join('×')} mm • ~{sp.pipeWeightKg} kg
                      </span>
                    </button>
                    {open && (
                      <div className="px-3 pb-3 space-y-3 text-xs">
                        <div>
                          <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Cortes de caño</div>
                          {sp.cuts.map((c) => (
                            <div key={c.componentId} className="flex justify-between font-mono text-[11px] py-0.5">
                              <span className="text-amber-400 font-bold">{c.nippleId}</span>
                              <span className="text-[#38bdf8]">{nd(c.nominalDiameter)}</span>
                              <span className="text-emerald-400 font-bold">
                                {mm(c.cutLengthMm)} mm{c.allowanceMm ? ` (+${mm(c.allowanceMm)})` : ''}
                              </span>
                              <span className="text-slate-300">
                                {c.endFinish1}/{c.endFinish2}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Accesorios</div>
                          {sp.items.map((i) => (
                            <div key={i.componentIds[0]} className="font-mono text-[11px] text-slate-200 py-0.5">
                              <strong className="text-white">{i.quantity} ×</strong> {i.description}{' '}
                              <span className="text-[#38bdf8]">
                                {nd(i.nominalDiameter)}
                                {i.reducedNominalDiameter ? `×${nd(i.reducedNominalDiameter)}` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">
                            Soldaduras ({sp.weldInches} pulg-diám) — cambiá a campo para partir el spool
                          </div>
                          {[...sp.shopWelds, ...sp.fieldWelds].map((w) => (
                            <WeldRow key={w.number} w={w} />
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => showIn3d(sp)}
                            className="px-3 py-1.5 rounded bg-[#0696d7]/20 hover:bg-[#0696d7] text-[#38bdf8] hover:text-white border border-[#0696d7]/50 text-[11px] font-bold"
                          >
                            Ver en 3D
                          </button>
                          <button
                            type="button"
                            onClick={() => exportDrawingsPdf(graph, { includeLine: false, spoolIds: [sp.id] }, `ISO_${sp.id}`)}
                            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold"
                          >
                            Plano PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => share(sp)}
                            className="px-3 py-1.5 rounded bg-[#2f3542] border border-[#4b5563] text-slate-100 text-[11px] font-bold"
                          >
                            {copied === sp.id ? 'Copiado' : 'Compartir hoja'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : erection.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">No hay materiales de montaje.</div>
          ) : (
            <div className="border border-[#343b48] rounded-lg divide-y divide-[#2a303c]">
              {erection.map((e, i) => (
                <div key={e.componentId ?? `${e.type}-${i}`} className="px-3 py-1.5 flex justify-between gap-2 font-mono text-[11px] text-slate-200">
                  <span>
                    <strong className="text-white">{e.quantity} ×</strong> {e.description}
                  </span>
                  <span className="text-[#38bdf8] shrink-0">{nd(e.nominalDiameter)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 bg-[#232832] border-t border-[#343b48] flex items-center justify-between gap-2">
          <span className="flex gap-2">
            <button type="button" onClick={exportCsv} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs">
              Exportar CSV (Excel)
            </button>
            <button
              type="button"
              onClick={() => exportDrawingsPdf(graph, { includeLine: true }, `ISO_${lineNumber}`)}
              className="px-3 py-1.5 bg-[#2f3542] border border-[#4b5563] text-slate-100 font-bold rounded text-xs"
            >
              Planos PDF
            </button>
          </span>
          <button type="button" onClick={toggleSpools} className="px-4 py-1.5 bg-[#0696d7] hover:bg-[#0582ba] text-white font-bold rounded text-xs">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
