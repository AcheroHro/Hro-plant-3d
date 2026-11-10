import React, { useEffect, useState } from 'react';
import { MobilePanel, tourAlreadySeen, useUiConfigStore } from '../store/useUiConfigStore';
import { getPhoneLayout, usePhoneLayout, vibrate } from './useIsPhone';

interface TourStep {
  title: string;
  text: string;
  /** Valor de data-tour del elemento que se resalta; sin él, el cartel va al centro */
  target?: string;
  /** Panel del teléfono que tiene que estar abierto (null: todos cerrados) */
  panel?: MobilePanel | null;
  /** Paso que solo tiene sentido con la barra de pestañas del teléfono */
  phoneOnly?: boolean;
}

const STEPS: TourStep[] = [
  {
    title: 'Corregir la cañería en obra',
    text: 'Abrís el PCF que sale de Plant 3D, corregís la línea como quedó montada y lo devolvés. Son pocos pasos: te los muestro.',
    panel: null
  },
  {
    title: 'Proyecto, spec y diámetro',
    text: 'Arriba elegís el proyecto, la spec y el diámetro con el que vas a trazar. Las flechas deshacen y rehacen.',
    target: 'top',
    panel: null,
    phoneOnly: true
  },
  {
    title: 'Hacia dónde va el caño',
    text: 'En Trazar, tocá un eje. También podés tocar las flechas que aparecen sobre la boca activa, en el modelo.',
    target: 'axes',
    panel: 'trazar'
  },
  {
    title: 'El largo',
    text: 'Escribí el largo en milímetros y tocá Trazar, o arrastrá la manija del caño fantasma. Si cambiaste de rumbo, el codo se pone solo.',
    target: 'length',
    panel: 'trazar'
  },
  {
    title: 'Lo que no sale a 90°',
    text: 'Giro para ángulos libres, Pend. para la pendiente, Desvío para esquivar algo y Elev. para llegar a una cota.',
    target: 'route-tools',
    panel: 'trazar'
  },
  {
    title: 'Piezas',
    text: 'Codos, tes, válvulas, bridas y reducciones: se ponen en la boca activa.',
    target: 'tab-piezas',
    panel: null,
    phoneOnly: true
  },
  {
    title: 'Tocar el modelo',
    text: 'Un toque elige una pieza o una boca. Mantené apretada una pieza y se abre su menú: partir, derivar, soporte, nota de campo, borrar. Doble toque la encuadra.',
    panel: null
  },
  {
    title: 'Vistas',
    text: 'Tocá una cara del cubo para ver de frente, de costado o en planta. En la pestaña Vistas están medir, aislar una línea y la caja de corte.',
    target: 'cube',
    panel: null
  },
  {
    title: 'Ayuda y revisión',
    text: 'El signo de pregunta muestra todos los gestos y repite este recorrido. Cuando hay piezas, al lado aparece la revisión: avisa de choques, uniones mal armadas y niples cortos.',
    target: 'help',
    panel: null
  },
  {
    title: 'Devolver el trabajo',
    text: 'En Más están abrir y exportar el PCF, los spools, la lista de cortes, los planos y las notas de campo.',
    target: 'tab-mas',
    panel: null,
    phoneOnly: true
  }
];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CARD_HEIGHT = 200;

/** Recorrido guiado: resalta de a un elemento de la pantalla y explica para qué sirve */
export const GuidedTour: React.FC = () => {
  const layout = usePhoneLayout();
  const tourStep = useUiConfigStore((s) => s.tourStep);
  const setTourStep = useUiConfigStore((s) => s.setTourStep);
  const finishTour = useUiConfigStore((s) => s.finishTour);
  const [rect, setRect] = useState<Rect | null>(null);

  // La primera vez en un teléfono arranca solo
  useEffect(() => {
    if (!getPhoneLayout() || tourAlreadySeen()) return;
    const timer = window.setTimeout(() => {
      if (useUiConfigStore.getState().tourStep === null) useUiConfigStore.getState().setTourStep(0);
    }, 900);
    return () => window.clearTimeout(timer);
  }, []);

  const steps = layout ? STEPS : STEPS.filter((s) => !s.phoneOnly);
  const index = tourStep === null ? -1 : Math.min(tourStep, steps.length - 1);
  const step = index >= 0 ? steps[index] : null;

  // Abre el panel que hace falta y sigue al elemento mientras el panel termina de acomodarse
  useEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    if (getPhoneLayout() && step.panel !== undefined) useUiConfigStore.getState().setMobilePanel(step.panel, false);
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
      const r = el?.getBoundingClientRect();
      const next = r && r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
      setRect((prev) =>
        (!prev && !next) || (prev && next && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) ? prev : next
      );
    };
    measure();
    const timer = window.setInterval(measure, 150);
    return () => window.clearInterval(timer);
  }, [step]);

  if (!step) return null;

  const last = index === steps.length - 1;
  const vh = window.innerHeight;
  const pad = 5;
  let cardPos: React.CSSProperties = { top: '50%', transform: 'translateY(-50%)' };
  if (rect) {
    if (rect.y + rect.h + pad + 10 + CARD_HEIGHT < vh) cardPos = { top: rect.y + rect.h + pad + 10 };
    else if (rect.y - pad - 10 - CARD_HEIGHT > 0) cardPos = { bottom: vh - rect.y + pad + 10 };
    else cardPos = { top: 8 };
  }
  const btn = 'h-10 px-3 rounded-lg border text-xs font-bold active:scale-95 transition-all';

  return (
    <div className="fixed inset-0 z-[70] pointer-events-auto" role="dialog" aria-label="Recorrido guiado">
      {rect ? (
        <div
          className="fixed rounded-xl border-2 border-[#38bdf8] pointer-events-none transition-all duration-150"
          style={{
            left: rect.x - pad,
            top: rect.y - pad,
            width: rect.w + pad * 2,
            height: rect.h + pad * 2,
            boxShadow: '0 0 0 9999px rgba(3, 7, 12, 0.72)'
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-[#03070c]/70" />
      )}

      <div
        className="fixed left-3 right-3 mx-auto max-w-sm rounded-xl bg-[#161a22] border border-[#38bdf8]/70 shadow-2xl p-3 space-y-2"
        style={cardPos}
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-black text-slate-100 leading-snug">{step.title}</h2>
          <span className="text-[10px] font-mono text-slate-400 shrink-0">
            {index + 1} de {steps.length}
          </span>
        </div>
        <p className="text-xs text-slate-300 leading-snug">{step.text}</p>
        <div className="flex items-center gap-2 pt-1">
          {!last && (
            <button type="button" className={`${btn} bg-transparent border-transparent text-slate-400`} onClick={finishTour}>
              Saltar
            </button>
          )}
          <span className="flex-1" />
          {index > 0 && (
            <button type="button" className={`${btn} bg-[#252a34] border-[#3a4150] text-slate-100`} onClick={() => setTourStep(index - 1)}>
              Atrás
            </button>
          )}
          <button
            type="button"
            className={`${btn} bg-[#0696d7] border-[#7dd3fc] text-white`}
            onClick={() => {
              vibrate(8);
              if (last) finishTour();
              else setTourStep(index + 1);
            }}
          >
            {last ? 'Listo' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
};
