import React, { useMemo } from 'react';
import { CircleAlert, CircleCheck, CircleHelp, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import { usePipingStore } from '../store/usePipingStore';
import { useUiConfigStore } from '../store/useUiConfigStore';
import { countIssues, IssueSeverity, ModelIssue, validateModel } from '../core/validation/validateModel';
import { knownSpecCodes } from '../core/specs/builtInSpecs';
import { MobileSheet } from './MobileSheet';
import { usePhoneLayout, vibrate } from './useIsPhone';

const SEVERITY: Record<IssueSeverity, { label: string; plural: string; Icon: typeof Info; tone: string }> = {
  error: { label: 'error', plural: 'errores', Icon: CircleX, tone: 'text-rose-400' },
  warning: { label: 'advertencia', plural: 'advertencias', Icon: TriangleAlert, tone: 'text-amber-300' },
  info: { label: 'dato', plural: 'datos', Icon: Info, tone: 'text-sky-300' }
};

const countText = (n: number, s: IssueSeverity) => `${n} ${n === 1 ? SEVERITY[s].label : SEVERITY[s].plural}`;

/**
 * Revisión del modelo: un botón sobre el visor con la cantidad de problemas y, al tocarlo, la lista.
 * Tocar un aviso elige la pieza y lleva la cámara a ella. Al lado va el botón de ayuda.
 */
export const ModelCheck: React.FC = () => {
  const layout = usePhoneLayout();
  const graph = usePipingStore((s) => s.graph);
  const version = usePipingStore((s) => s.version);
  const colliding = usePipingStore((s) => s.collidingComponentIds);
  const selectedId = usePipingStore((s) => s.selectedComponentId);
  const multiMode = usePipingStore((s) => s.multiMode);
  const issuesOpen = useUiConfigStore((s) => s.issuesOpen);
  const setIssuesOpen = useUiConfigStore((s) => s.setIssuesOpen);
  const setHelpOpen = useUiConfigStore((s) => s.setHelpOpen);
  const specName = usePipingStore((s) => s.specReader?.specName);

  const issues = useMemo(
    () => validateModel(graph, { collidingIds: colliding, knownSpecs: knownSpecCodes(graph.activeSpec, specName) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, version, colliding, specName]
  );
  const counts = countIssues(issues);
  const problems = counts.error + counts.warning;
  const empty = graph.components.size === 0;

  const summary = empty
    ? 'Todavía no hay piezas'
    : problems === 0
      ? 'Sin problemas'
      : [counts.error ? countText(counts.error, 'error') : '', counts.warning ? countText(counts.warning, 'warning') : '']
          .filter(Boolean)
          .join(' y ');

  const chipTone = counts.error
    ? 'bg-rose-600 border-rose-300 text-white'
    : counts.warning
      ? 'bg-amber-500 border-amber-200 text-black'
      : 'bg-[#1e2632]/90 border-[#3a4150] text-emerald-300';
  const ChipIcon = counts.error ? CircleX : counts.warning ? TriangleAlert : CircleCheck;

  const position: React.CSSProperties = layout
    ? { top: 'calc(var(--mobile-top) + 6px)', left: layout === 'landscape' ? 62 : 6 }
    : { bottom: 12, left: 12 };

  const row = (issue: ModelIssue, i: number) => {
    const { Icon, tone } = SEVERITY[issue.severity];
    const active = issue.componentIds.includes(selectedId ?? '');
    return (
      <li key={`${issue.code}-${issue.componentIds[0]}-${i}`}>
        <button
          type="button"
          onClick={() => {
            vibrate(8);
            usePipingStore.getState().focusComponent(issue.componentIds[0]);
          }}
          className={`w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-lg border active:bg-[#2b3240] ${
            active ? 'bg-[#243042] border-[#38bdf8]/70' : 'bg-[#1d222c] border-[#2f3644]'
          }`}
        >
          <Icon size={18} className={`${tone} shrink-0 mt-0.5`} />
          <span className="min-w-0">
            <span className="block text-xs font-bold text-slate-100 leading-snug">{issue.title}</span>
            <span className="block text-[11px] text-slate-400 leading-snug">{issue.detail}</span>
          </span>
        </button>
      </li>
    );
  };

  const list = (
    <>
      <p className="text-[11px] text-slate-300 leading-snug">
        {empty
          ? 'Trazá o abrí un PCF y acá aparecen los avisos.'
          : problems === 0
            ? 'No hay errores ni advertencias. Abajo quedan los datos para tener en cuenta.'
            : 'Tocá un aviso para ver la pieza en el modelo.'}
      </p>
      {!empty && issues.length === 0 && <p className="text-xs text-emerald-300 font-bold">Modelo sin avisos.</p>}
      <ul className="space-y-1.5">{issues.map(row)}</ul>
    </>
  );

  return (
    <>
      {!(layout && multiMode) && (
        <div className="fixed z-20 flex items-center gap-1.5 pointer-events-auto select-none" style={position}>
          <button
            type="button"
            data-tour="help"
            onClick={() => {
              vibrate(8);
              setHelpOpen(true);
            }}
            className="w-10 h-10 rounded-full bg-[#1e2632]/90 border border-[#3a4150] text-slate-100 flex items-center justify-center active:bg-[#0696d7] shadow-lg"
            aria-label="Ayuda"
            title="Ayuda: gestos y recorrido guiado"
          >
            <CircleHelp size={20} />
          </button>
          {!empty && (
            <button
              type="button"
              data-tour="check"
              onClick={() => {
                vibrate(8);
                setIssuesOpen(!issuesOpen);
              }}
              aria-pressed={issuesOpen}
              aria-label={`Revisar el modelo: ${summary}`}
              title={`Revisar el modelo: ${summary}`}
              className={`h-10 px-2.5 rounded-full border flex items-center gap-1.5 text-xs font-black font-mono shadow-lg active:scale-95 ${chipTone}`}
            >
              <ChipIcon size={18} />
              {problems > 0 && <span>{problems}</span>}
            </button>
          )}
        </div>
      )}

      {issuesOpen &&
        (layout ? (
          <MobileSheet
            layout={layout}
            title="Revisión del modelo"
            icon={<CircleAlert size={16} className="text-amber-300" />}
            badge={<span className="text-[10px] font-mono text-slate-400 truncate">{summary}</span>}
            onClose={() => setIssuesOpen(false)}
            bodyClassName="p-2.5 space-y-2"
          >
            {list}
          </MobileSheet>
        ) : (
          <section
            aria-label="Revisión del modelo"
            className="fixed z-40 left-3 bottom-16 w-[340px] max-h-[55vh] flex flex-col rounded-lg bg-[#161a22]/96 backdrop-blur-xl border border-[#323946] shadow-2xl pointer-events-auto"
          >
            <header className="flex items-center justify-between gap-2 pl-3 pr-1 h-9 shrink-0 border-b border-[#2b313d]">
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-200 truncate">Revisión del modelo · {summary}</h2>
              <button
                type="button"
                onClick={() => setIssuesOpen(false)}
                className="w-8 h-8 rounded text-slate-300 hover:bg-slate-700 flex items-center justify-center"
                aria-label="Cerrar Revisión del modelo"
              >
                <X size={16} />
              </button>
            </header>
            <div className="p-2.5 space-y-2 overflow-y-auto">{list}</div>
          </section>
        ))}
    </>
  );
};
