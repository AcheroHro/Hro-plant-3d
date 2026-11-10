import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePipingStore } from '../store/usePipingStore';
import { useProjectStore } from '../store/useProjectStore';
import { CHANGE_LABEL, ChangeKind, componentLabel, diffStates, summarizeChanges } from '../core/field/changeLog';
import { buildFieldReport, ReportNote } from '../core/field/fieldReport';
import { buildIsoSheets } from '../core/drawings/isoSheet';
import { sheetsToPdf } from '../core/drawings/pdfWriter';
import { SheetImage } from '../core/drawings/sheet';
import { getPhoto } from '../persistence/indexedDbStorage';
import { photoForReport } from '../utils/photos';
import { downloadBytes, shareBytes } from '../utils/fileDownloader';
import { FIELD_COLORS } from '../viewport/spoolColors';

const KIND_STYLE: Record<ChangeKind, string> = {
  added: 'text-emerald-300 border-emerald-500/60 bg-emerald-500/10',
  deleted: 'text-rose-300 border-rose-500/60 bg-rose-500/10',
  moved: 'text-amber-300 border-amber-500/60 bg-amber-500/10',
  edited: 'text-sky-300 border-sky-500/60 bg-sky-500/10',
  fieldWeld: 'text-orange-300 border-orange-500/60 bg-orange-500/10'
};

const fmt = (t: number) => {
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function drawingPrefs(): { drawnBy?: string; project?: string; revision?: string } {
  try {
    return JSON.parse(localStorage.getItem('achero.drawing') || '{}');
  } catch {
    return {};
  }
}

const PhotoThumb: React.FC<{ id: string }> = ({ id }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    getPhoto(id).then((ph) => {
      if (!ph) return;
      u = URL.createObjectURL(ph.blob);
      setUrl(u);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  if (!url) return <div className="w-16 h-16 rounded bg-[#161920] border border-[#343b48]" />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Foto de campo" className="w-16 h-16 object-cover rounded border border-[#343b48]" />
    </a>
  );
};

/** Campo: cambios contra el PCF de Plant, notas con fotos e informe PDF */
export const FieldModal: React.FC = () => {
  const isOpen = useProjectStore((s) => s.isFieldOpen);
  const toggle = useProjectStore((s) => s.toggleField);
  const baseline = useProjectStore((s) => s.baseline);
  const baselineAt = useProjectStore((s) => s.baselineAt);
  const notes = useProjectStore((s) => s.notes);
  const projectName = useProjectStore((s) => s.projectName);
  const sourceName = useProjectStore((s) => s.sourceName);
  const fieldView = useProjectStore((s) => s.fieldView);
  const toggleFieldView = useProjectStore((s) => s.toggleFieldView);
  const addNote = useProjectStore((s) => s.addNote);
  const deleteNote = useProjectStore((s) => s.deleteNote);
  const acceptBaseline = useProjectStore((s) => s.acceptBaseline);
  const graph = usePipingStore((s) => s.graph);
  const version = usePipingStore((s) => s.version);
  const lineNumber = usePipingStore((s) => s.lineNumber);
  const specCode = usePipingStore((s) => s.specCode);
  const selectedComponentId = usePipingStore((s) => s.selectedComponentId);
  const setSelectedComponentId = usePipingStore((s) => s.setSelectedComponentId);

  const [tab, setTab] = useState<'CAMBIOS' | 'NOTAS' | 'INFORME'>('CAMBIOS');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmBase, setConfirmBase] = useState(false);
  const [withIso, setWithIso] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drawnBy, setDrawnBy] = useState(() => drawingPrefs().drawnBy || '');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const fieldTabRequest = useProjectStore((s) => s.fieldTabRequest);
  useEffect(() => {
    if (isOpen && fieldTabRequest) {
      setTab(fieldTabRequest);
      useProjectStore.setState({ fieldTabRequest: undefined });
    }
  }, [isOpen, fieldTabRequest]);

  const changes = useMemo(
    () => (isOpen && baseline ? diffStates(baseline, graph.serialize()) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, baseline, graph, version]
  );
  if (!isOpen) return null;

  const selected = selectedComponentId ? graph.components.get(selectedComponentId) : undefined;
  const selectedLabel = selected ? componentLabel(graph.serialize().components[selected.id]) : null;

  const show = (id: string) => {
    if (!id || !graph.components.has(id)) return;
    if (!fieldView) toggleFieldView();
    setSelectedComponentId(id);
    toggle();
  };

  const saveNote = async () => {
    if (!text.trim() && !photos.length) return;
    setSaving(true);
    await addNote(text, photos);
    setText('');
    setPhotos([]);
    setSaving(false);
  };

  const makePdf = async (share: boolean) => {
    setBusy(true);
    try {
      try {
        localStorage.setItem('achero.drawing', JSON.stringify({ ...drawingPrefs(), drawnBy }));
      } catch {
        // sin almacenamiento
      }
      const reportNotes: ReportNote[] = [];
      for (const n of notes) {
        const imgs = (await Promise.all(n.photoIds.map(photoForReport))).filter((x): x is SheetImage => Boolean(x));
        reportNotes.push({ text: n.text, createdAt: n.createdAt, componentLabel: n.componentLabel, photos: imgs });
      }
      const sheets = buildFieldReport({
        projectName,
        lineNumber,
        sourceName,
        specName: specCode,
        baselineAt,
        drawnBy,
        changes,
        notes: reportNotes
      });
      if (withIso && graph.components.size) {
        const prefs = drawingPrefs();
        sheets.push(...buildIsoSheets(graph, { ...prefs, drawnBy, project: prefs.project || projectName, spoolIds: [] }));
      }
      const pdf = sheetsToPdf(sheets, { title: `Informe de campo ${projectName}`, author: drawnBy || 'Achero Plant 3D' });
      const name = `Campo_${projectName.replace(/[^a-zA-Z0-9_-]+/g, '_')}.pdf`;
      if (!share || !(await shareBytes(name, pdf, 'application/pdf', `Informe de campo ${projectName}`))) {
        downloadBytes(name, pdf, 'application/pdf');
      }
      usePipingStore.setState({ statusMessage: `Informe de campo listo: ${name} (${sheets.length} hojas).` });
    } finally {
      setBusy(false);
    }
  };

  const tabBtn = (t: typeof tab, label: string) => (
    <button
      key={t}
      type="button"
      onClick={() => setTab(t)}
      className={`px-3.5 py-2 text-xs font-bold rounded-t border-t border-x ${
        tab === t ? 'bg-[#1b1f26] text-orange-300 border-[#343b48]' : 'text-slate-400 border-transparent hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm select-none">
      <div className="w-full max-w-2xl bg-[#1b1f26] border border-[#343b48] rounded-xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <div className="px-4 py-2.5 bg-[#232832] border-b border-[#343b48] flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-sm text-slate-100 truncate">Campo · {projectName}</span>
            <span className="text-[11px] text-slate-400 truncate">
              {baseline ? `${summarizeChanges(changes)} · base ${baselineAt ? fmt(baselineAt) : ''}` : 'Sin PCF de origen: abrí un PCF de Plant para registrar cambios'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
              <input type="checkbox" checked={fieldView} onChange={toggleFieldView} className="accent-orange-500" />
              Colorear en 3D
            </label>
            <button type="button" onClick={toggle} className="w-8 h-8 rounded bg-[#2f3542] border border-[#434959] text-slate-300 font-bold hover:bg-slate-700">
              ✕
            </button>
          </div>
        </div>

        <div className="flex px-4 pt-2 bg-[#161920] border-b border-[#343b48] gap-2">
          {tabBtn('CAMBIOS', `Cambios (${changes.length})`)}
          {tabBtn('NOTAS', `Notas (${notes.length})`)}
          {tabBtn('INFORME', 'Informe PDF')}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {tab === 'CAMBIOS' && (
            <div className="space-y-2">
              {!baseline && (
                <p className="text-xs text-slate-400 py-6 text-center">
                  Este proyecto no viene de un PCF, así que no hay contra qué comparar. Podés fijar el modelo actual como base.
                </p>
              )}
              {baseline && changes.length === 0 && (
                <p className="text-xs text-slate-400 py-6 text-center">Sin cambios: el modelo es igual al PCF que llegó de Plant.</p>
              )}
              {changes.map((c, i) => (
                <button
                  key={`${c.kind}-${c.componentId}-${i}`}
                  type="button"
                  onClick={() => show(c.componentId)}
                  disabled={!graph.components.has(c.componentId)}
                  className="w-full text-left rounded-lg border border-[#343b48] bg-[#232832] p-2.5 disabled:cursor-default"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${KIND_STYLE[c.kind]}`}>{CHANGE_LABEL[c.kind]}</span>
                    <span className="text-xs font-bold text-slate-100 truncate">{c.label}</span>
                  </div>
                  {c.details.map((d, k) => (
                    <div key={k} className="text-[11px] text-slate-300 mt-1 font-mono break-words">
                      {d}
                    </div>
                  ))}
                </button>
              ))}
              <div className="pt-3 border-t border-[#343b48] mt-3">
                {confirmBase ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] text-amber-200">
                      La lista de cambios vuelve a cero y el modelo actual pasa a ser la referencia. Hacelo después de mandar el PCF corregido a la oficina.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await acceptBaseline();
                          setConfirmBase(false);
                        }}
                        className="h-9 px-3 rounded bg-amber-600 text-white text-xs font-bold"
                      >
                        Sí, tomar como base
                      </button>
                      <button type="button" onClick={() => setConfirmBase(false)} className="h-9 px-3 rounded text-xs text-slate-400">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmBase(true)}
                    className="h-9 px-3 rounded bg-[#161920] border border-[#434959] text-[11px] text-slate-300"
                  >
                    Tomar el modelo actual como nueva base
                  </button>
                )}
              </div>
            </div>
          )}

          {tab === 'NOTAS' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-orange-500/50 bg-[#232832] p-3 space-y-2">
                <div className="text-[11px] text-slate-400">
                  {selectedLabel ? (
                    <>
                      Se asocia a <span className="text-orange-300 font-bold">{selectedLabel}</span>
                    </>
                  ) : (
                    'Nota general (seleccioná una pieza en 3D para asociarla)'
                  )}
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  placeholder="Qué encontraste en obra: medida real, interferencia, soporte, cambio de pieza…"
                  className="w-full px-2 py-1.5 bg-[#161920] border border-[#434959] rounded text-sm text-slate-100 outline-none focus:border-orange-400 select-text"
                />
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    setPhotos([...photos, ...Array.from(e.target.files ?? [])]);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <input
                  ref={galleryRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    setPhotos([...photos, ...Array.from(e.target.files ?? [])]);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => cameraRef.current?.click()} className="h-10 px-3 rounded bg-[#2b313d] border border-[#3e4656] text-xs font-bold text-slate-100">
                    📷 Sacar foto
                  </button>
                  <button type="button" onClick={() => galleryRef.current?.click()} className="h-10 px-3 rounded bg-[#2b313d] border border-[#3e4656] text-xs text-slate-300">
                    🖼 Galería
                  </button>
                  {photos.length > 0 && (
                    <span className="text-[11px] text-slate-300">
                      {photos.length} foto{photos.length > 1 ? 's' : ''}{' '}
                      <button type="button" onClick={() => setPhotos([])} className="text-rose-300 underline">
                        quitar
                      </button>
                    </span>
                  )}
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={saveNote}
                    disabled={saving || (!text.trim() && !photos.length)}
                    className="h-10 px-4 rounded bg-orange-600 text-white text-xs font-extrabold disabled:opacity-40"
                  >
                    {saving ? 'Guardando…' : 'Guardar nota'}
                  </button>
                </div>
              </div>

              {notes.length === 0 && <p className="text-xs text-slate-500 text-center py-4">Sin notas todavía.</p>}
              {[...notes].reverse().map((n) => (
                <div key={n.id} className="rounded-lg border border-[#343b48] bg-[#232832] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => n.componentId && show(n.componentId)}
                      className="text-[11px] font-bold text-orange-300 truncate text-left"
                    >
                      {fmt(n.createdAt)}
                      {n.componentLabel ? ` · ${n.componentLabel}` : ''}
                    </button>
                    <button type="button" onClick={() => deleteNote(n.id)} className="text-[11px] text-rose-300 shrink-0">
                      Borrar
                    </button>
                  </div>
                  {n.text && <p className="text-xs text-slate-200 mt-1 whitespace-pre-wrap select-text">{n.text}</p>}
                  {n.photoIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {n.photoIds.map((id) => (
                        <PhotoThumb key={id} id={id} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'INFORME' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                PDF para la oficina técnica con la lista de cambios respecto del PCF de Plant, las notas con sus fotos y, si querés, el isométrico de la
                línea como quedó. Mandalo junto con el PCF corregido.
              </p>
              <label className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase font-bold text-slate-400">Relevó</span>
                <input
                  value={drawnBy}
                  onChange={(e) => setDrawnBy(e.target.value)}
                  placeholder="Nombre"
                  className="h-9 px-2 bg-[#232832] border border-[#434959] rounded text-sm text-slate-100 outline-none focus:border-orange-400"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={withIso} onChange={(e) => setWithIso(e.target.checked)} className="accent-orange-500" />
                Agregar el isométrico de la línea como quedó
              </label>
              <div className="text-[11px] text-slate-400 font-mono">
                {changes.length} cambios · {notes.length} notas · {notes.reduce((n, x) => n + x.photoIds.length, 0)} fotos
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => makePdf(false)}
                  disabled={busy}
                  className="flex-1 h-11 rounded bg-orange-600 hover:bg-orange-500 text-white font-extrabold text-xs disabled:opacity-50"
                >
                  {busy ? 'Armando PDF…' : '⬇ DESCARGAR INFORME'}
                </button>
                <button
                  type="button"
                  onClick={() => makePdf(true)}
                  disabled={busy}
                  className="h-11 px-4 rounded bg-[#181a20] border border-[#434959] text-slate-200 font-bold text-xs disabled:opacity-50"
                >
                  Compartir
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-[#343b48] bg-[#161920] flex flex-wrap gap-3 text-[10px] text-slate-400">
          {(['added', 'moved', 'edited', 'fieldWeld'] as ChangeKind[]).map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: `#${FIELD_COLORS[k].toString(16).padStart(6, '0')}` }} />
              {CHANGE_LABEL[k]}
            </span>
          ))}
          <span>· sin cambios en gris</span>
        </div>
      </div>
    </div>
  );
};
