import React, { useRef, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { usePwaStore } from '../pwa/pwa';

const when = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === today.toDateString()) return `hoy ${hm}`;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${hm}`;
};

/** Proyectos guardados en el teléfono: abrir, renombrar, copiar a otro equipo y borrar */
export const ProjectsModal: React.FC = () => {
  const isOpen = useProjectStore((s) => s.isProjectsOpen);
  const toggle = useProjectStore((s) => s.toggleProjects);
  const projects = useProjectStore((s) => s.projects);
  const activeId = useProjectStore((s) => s.projectId);
  const openProject = useProjectStore((s) => s.openProject);
  const newProject = useProjectStore((s) => s.newProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const removeProject = useProjectStore((s) => s.removeProject);
  const exportBundle = useProjectStore((s) => s.exportBundle);
  const importFiles = useProjectStore((s) => s.importFiles);
  const online = usePwaStore((s) => s.online);
  const offlineReady = usePwaStore((s) => s.offlineReady);
  const canInstall = usePwaStore((s) => s.canInstall);
  const installed = usePwaStore((s) => s.installed);
  const install = usePwaStore((s) => s.install);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = '';
    if (!list.length) return;
    await importFiles(await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() }))));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm select-none">
      <div className="w-full max-w-xl bg-[#1b1f26] border border-[#343b48] rounded-xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <div className="px-4 py-2.5 bg-[#232832] border-b border-[#343b48] flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-sm text-slate-100">Proyectos en este equipo</span>
            <span className="text-[11px] text-slate-400 truncate">
              {projects.length} guardados · {online ? 'con conexión' : 'sin conexión'}
              {offlineReady ? ' · lista para usar sin señal' : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="w-8 h-8 rounded bg-[#2f3542] border border-[#434959] text-slate-300 font-bold hover:bg-slate-700 shrink-0"
          >
            ✕
          </button>
        </div>

        <input ref={inputRef} type="file" accept=".pcf,.achero,.json,.txt" multiple onChange={onFiles} className="hidden" />
        <div className="grid grid-cols-2 gap-2 p-3 border-b border-[#343b48] bg-[#161920]">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="h-11 rounded bg-amber-500/20 border border-amber-500/70 text-amber-200 font-bold text-xs"
          >
            📂 Abrir PCF o copia (.achero)
          </button>
          <button type="button" onClick={() => newProject()} className="h-11 rounded bg-[#2b313d] border border-[#3e4656] text-slate-200 font-bold text-xs">
            + Proyecto vacío
          </button>
          {canInstall && !installed && (
            <button
              type="button"
              onClick={install}
              className="col-span-2 h-10 rounded bg-[#0696d7] text-white font-extrabold text-xs border border-[#38bdf8]"
            >
              ⤓ Instalar la app en este equipo
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {projects.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-8">
              Todavía no hay proyectos. Abrí un PCF exportado de Plant 3D: cada PCF queda como un proyecto y lo que cambies se compara contra él.
            </p>
          )}
          {projects.map((p) => {
            const active = p.id === activeId;
            return (
              <div
                key={p.id}
                className={`rounded-lg border p-3 ${active ? 'border-[#0696d7] bg-[#0696d7]/10' : 'border-[#343b48] bg-[#232832]'}`}
              >
                {editing === p.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      renameProject(p.id, draft);
                      setEditing(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="flex-1 h-9 px-2 bg-[#161920] border border-[#434959] rounded text-sm text-slate-100 outline-none focus:border-[#0696d7]"
                    />
                    <button type="submit" className="h-9 px-3 rounded bg-[#0696d7] text-white text-xs font-bold">
                      OK
                    </button>
                  </form>
                ) : (
                  <button type="button" onClick={() => !active && openProject(p.id)} className="w-full text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-slate-100 truncate">{p.name}</span>
                      {active ? (
                        <span className="text-[10px] font-bold text-[#38bdf8] shrink-0">ABIERTO</span>
                      ) : (
                        <span className="text-[10px] text-slate-400 shrink-0">Abrir ›</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">
                      {p.lineNumber || '—'} · {p.componentCount} piezas · {p.noteCount} notas · {when(p.updatedAt)}
                    </div>
                    {p.sourceName && <div className="text-[10px] text-slate-500 truncate">Desde {p.sourceName}</div>}
                  </button>
                )}
                <div className="flex gap-1.5 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(p.id);
                      setDraft(p.name);
                    }}
                    className="h-8 px-2.5 rounded bg-[#161920] border border-[#343b48] text-[11px] text-slate-300"
                  >
                    Renombrar
                  </button>
                  <button
                    type="button"
                    onClick={() => exportBundle(p.id)}
                    className="h-8 px-2.5 rounded bg-[#161920] border border-[#343b48] text-[11px] text-slate-300"
                    title="Archivo con el modelo, la base, las notas y las fotos para abrir en otro equipo"
                  >
                    Copia .achero
                  </button>
                  <div className="flex-1" />
                  {confirmDel === p.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          removeProject(p.id);
                          setConfirmDel(null);
                        }}
                        className="h-8 px-2.5 rounded bg-rose-700 text-white text-[11px] font-bold"
                      >
                        Borrar definitivamente
                      </button>
                      <button type="button" onClick={() => setConfirmDel(null)} className="h-8 px-2 rounded text-[11px] text-slate-400">
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDel(p.id)}
                      className="h-8 px-2.5 rounded bg-rose-950/40 border border-rose-800/50 text-[11px] text-rose-300"
                    >
                      Borrar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
