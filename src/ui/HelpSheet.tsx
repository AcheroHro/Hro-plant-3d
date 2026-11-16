import React from 'react';
import { CircleHelp, PlayCircle, ShieldCheck, X } from 'lucide-react';
import { useUiConfigStore } from '../store/useUiConfigStore';
import { usePhoneLayout, vibrate } from './useIsPhone';

interface HelpGroup {
  title: string;
  rows: [string, string][];
}

const TOUCH: HelpGroup[] = [
  {
    title: 'Mover la vista',
    rows: [
      ['Arrastrar con un dedo', 'Gira el modelo.'],
      ['Dos dedos', 'Pellizcar acerca o aleja; arrastrar los dos corre la vista.'],
      ['Doble toque en una pieza', 'La encuadra. En el fondo, encuadra todo el modelo.'],
      ['Cubo de arriba a la derecha', 'Cada cara lleva a su vista; la casita vuelve a la isométrica.']
    ]
  },
  {
    title: 'Trazar',
    rows: [
      ['Tocar una boca libre', 'La línea sigue desde ahí, aparece el compás y la barra de abajo pasa a trazar.'],
      ['Tocar el fondo', 'Suelta la pieza y la boca: el compás se apaga hasta que elijas otra boca.'],
      ['Flechas sobre la boca o fila X Y Z', 'Eligen hacia dónde va el caño. Si cambia de rumbo, el codo se pone solo.'],
      ['Arrastrar la manija del caño fantasma', 'Da el largo con el dedo. También se puede escribir y tocar Trazar.'],
      ['Giro, Pend., Desvío y Elev.', 'Ángulos libres, pendiente, corrimientos y llegar a una elevación.'],
      ['Alinear', 'Tocá otra boca o pieza y el largo del tramo se calcula solo hasta quedar alineado con ella.'],
      ['Boca', 'Muestra las coordenadas y la elevación de la boca activa, de eje y de fondo de caño. Escribiendo X, Y y Z la línea va hasta ese punto.']
    ]
  },
  {
    title: 'Piezas',
    rows: [
      ['Poner pieza (en la barra de abajo)', 'Con una boca elegida, muestra lo que la spec tiene en ese diámetro y lo pone en la boca.'],
      ['Mantener apretado un botón con flecha', 'Abre las variantes de la spec: otra familia, otra medida, plano abajo o arriba.'],
      ['Válvula bridada y brida ciega', 'Entran con sus bridas y juntas.']
    ]
  },
  {
    title: 'Corregir',
    rows: [
      ['Tocar una pieza', 'La elige y la barra de abajo muestra lo que se le puede hacer: largo, partir, derivar, purga, soporte, diámetro, datos y borrar.'],
      ['Seguir (en la barra de la pieza)', 'Si la pieza tiene una boca libre, vuelve a trazar desde ahí.'],
      ['Mantener apretada una pieza', 'Abre su menú: partir, derivar, girar o dar vuelta, elevación de eje, soporte, sustituir (codo, válvula o brida WN, SO, SW), nota de campo, aislar, borrar.'],
      ['Tocar un soporte', 'Muestra las cotas hasta lo que tiene a cada lado (accesorio, otro soporte o boca libre). Tocá una cota o escribila en el editor y el soporte se corre; la otra se ajusta sola.'],
      ['Válvula: cara a cara', 'En su menú o en Propiedades se escribe la medida de obra; el caño que sigue a la brida compensa. Plant la trae con el largo de su spec, por eso queda el aviso en la revisión.'],
      ['Dar vuelta o girar (en el menú)', 'Da vuelta una brida o el sentido de una válvula, pasa una reducción excéntrica de plano abajo a plano arriba y gira el volante.'],
      ['Purga o venteo (en Derivación)', 'Arma de un toque la derivación con su niple, válvula y tapa: la purga hacia abajo, el venteo hacia arriba.'],
      ['Cambiar diámetro del tramo (en el menú)', 'Cambia caños y accesorios del tramo por los de otro diámetro de la spec, sin mover los ejes.'],
      ['Arrastrar la punta de un caño', 'Lo alarga o lo acorta.'],
      ['Seleccionar varias (en el menú)', 'Para mover, copiar o borrar un grupo de piezas.'],
      ['Flechas de arriba', 'Deshacer y rehacer.']
    ]
  },
  {
    title: 'Arriba',
    rows: [
      ['Archivo', 'Proyectos, spec y número de línea; abrir y exportar el PCF, informe de campo, planos, spools y cortes y materiales.'],
      ['Vistas (el cubo)', 'Encuadrar, medir, caja de corte, aislar una línea, cotas y el plano DXF de fondo.']
    ]
  },
  {
    title: 'Ver y ubicarse',
    rows: [
      ['Etiquetas (en Vistas)', 'Dibuja sobre el modelo el largo de cada caño, las elevaciones y el número de línea.'],
      ['Tocar una cota', 'Con las etiquetas a la vista, abre el largo de ese caño para escribir el nuevo.'],
      ['Ref. DXF (en Vistas)', 'Carga un DXF de ejes y columnas como fondo para ubicar la cañería. Un DWG hay que guardarlo antes como DXF.']
    ]
  }
];

const MOUSE: HelpGroup[] = [
  {
    title: 'Mover la vista',
    rows: [
      ['Arrastrar', 'Gira el modelo.'],
      ['Rueda', 'Acerca o aleja.'],
      ['Doble clic en una pieza', 'La encuadra. En el fondo, encuadra todo el modelo.'],
      ['Cubo de vistas', 'Cada cara lleva a su vista; la casita vuelve a la isométrica.']
    ]
  },
  {
    title: 'Trazar',
    rows: [
      ['Clic en una boca libre', 'La línea sigue desde ahí y aparece el compás.'],
      ['Clic en el fondo', 'Suelta la pieza y la boca: el compás se apaga hasta que elijas otra boca.'],
      ['Flechas sobre la boca o fila X Y Z', 'Eligen hacia dónde va el caño. Si cambia de rumbo, el codo se pone solo.'],
      ['Largo y Enter', 'Traza el tramo. También se puede arrastrar la manija del caño fantasma.'],
      ['Giro, Pend., Desvío y Elev.', 'Ángulos libres, pendiente, corrimientos y llegar a una elevación.'],
      ['Alinear', 'Tocá otra boca o pieza y el largo del tramo se calcula solo hasta quedar alineado con ella.'],
      ['Boca', 'Muestra las coordenadas y la elevación de la boca activa, de eje y de fondo de caño. Escribiendo X, Y y Z la línea va hasta ese punto.']
    ]
  },
  {
    title: 'Piezas',
    rows: [
      ['Clic en un botón de Piezas', 'Pone en la boca activa la pieza que la spec tiene en ese diámetro.'],
      ['Clic derecho en un botón con flecha', 'Abre las variantes de la spec: otra familia, otra medida, plano abajo o arriba.'],
      ['Válvula bridada y brida ciega', 'Entran con sus bridas y juntas.']
    ]
  },
  {
    title: 'Corregir',
    rows: [
      ['Clic en una pieza', 'La elige y muestra sus propiedades.'],
      ['Clic derecho en una pieza', 'Abre su menú: partir, derivar, girar o dar vuelta, elevación de eje, soporte, sustituir (codo, válvula o brida WN, SO, SW), nota de campo, aislar, borrar.'],
      ['Tocar un soporte', 'Muestra las cotas hasta lo que tiene a cada lado (accesorio, otro soporte o boca libre). Tocá una cota o escribila en el editor y el soporte se corre; la otra se ajusta sola.'],
      ['Válvula: cara a cara', 'En su menú o en Propiedades se escribe la medida de obra; el caño que sigue a la brida compensa. Plant la trae con el largo de su spec, por eso queda el aviso en la revisión.'],
      ['Dar vuelta o girar (en el menú)', 'Da vuelta una brida o el sentido de una válvula, pasa una reducción excéntrica de plano abajo a plano arriba y gira el volante.'],
      ['Purga o venteo (en Derivación)', 'Arma de un toque la derivación con su niple, válvula y tapa: la purga hacia abajo, el venteo hacia arriba.'],
      ['Cambiar diámetro del tramo (en el menú)', 'Cambia caños y accesorios del tramo por los de otro diámetro de la spec, sin mover los ejes.'],
      ['Arrastrar la punta de un caño', 'Lo alarga o lo acorta.']
    ]
  },
  {
    title: 'Ver y ubicarse',
    rows: [
      ['Etiquetas (en Vistas)', 'Dibuja sobre el modelo el largo de cada caño, las elevaciones y el número de línea.'],
      ['Clic en una cota', 'Con las etiquetas a la vista, abre el largo de ese caño para escribir el nuevo.'],
      ['Ref. DXF (en Vistas)', 'Carga un DXF de ejes y columnas como fondo para ubicar la cañería. Un DWG hay que guardarlo antes como DXF.']
    ]
  }
];

/** Hoja de ayuda: los gestos en una pantalla, y desde acá se repite el recorrido guiado */
export const HelpSheet: React.FC = () => {
  const layout = usePhoneLayout();
  const open = useUiConfigStore((s) => s.helpOpen);
  const setHelpOpen = useUiConfigStore((s) => s.setHelpOpen);
  const setTourStep = useUiConfigStore((s) => s.setTourStep);
  const setIssuesOpen = useUiConfigStore((s) => s.setIssuesOpen);

  if (!open) return null;
  const groups = layout ? TOUCH : MOUSE;
  const action =
    'flex-1 min-w-0 h-11 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all';

  return (
    <div
      className={`fixed inset-0 z-[65] bg-black/60 flex justify-center pointer-events-auto ${layout === 'portrait' ? 'items-end' : 'items-center'}`}
      onClick={() => setHelpOpen(false)}
    >
      <section
        role="dialog"
        aria-label="Ayuda"
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md flex flex-col bg-[#161a22] border border-[#323946] shadow-2xl ${
          layout === 'portrait' ? 'max-h-[88vh] rounded-t-2xl' : 'max-h-[92vh] rounded-xl'
        }`}
      >
        <header className="flex items-center justify-between gap-2 pl-3 pr-1 h-11 shrink-0 border-b border-[#2b313d]">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <CircleHelp size={18} className="text-[#38bdf8]" />
            Ayuda
          </h2>
          <button
            type="button"
            onClick={() => setHelpOpen(false)}
            className="w-10 h-10 rounded-lg text-slate-300 active:bg-slate-700 flex items-center justify-center"
            aria-label="Cerrar Ayuda"
          >
            <X size={20} />
          </button>
        </header>

        <div className="p-3 space-y-3 overflow-y-auto overscroll-contain" style={{ touchAction: 'pan-y' }}>
          <div className="flex gap-2">
            <button
              type="button"
              className={`${action} bg-[#0696d7] border-[#7dd3fc] text-white`}
              onClick={() => {
                vibrate();
                setTourStep(0);
              }}
            >
              <PlayCircle size={18} />
              Ver el recorrido
            </button>
            <button
              type="button"
              className={`${action} bg-[#252a34] border-[#3a4150] text-slate-100`}
              onClick={() => {
                vibrate();
                setIssuesOpen(true);
              }}
            >
              <ShieldCheck size={18} className="text-emerald-300" />
              Revisar el modelo
            </button>
          </div>

          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="text-[10px] uppercase tracking-wide font-bold text-[#38bdf8] mb-1">{group.title}</h3>
              <dl className="rounded-lg border border-[#2b313d] divide-y divide-[#2b313d] bg-[#1b2029]">
                {group.rows.map(([gesture, effect]) => (
                  <div key={gesture} className="px-2.5 py-2">
                    <dt className="text-xs font-bold text-slate-100 leading-snug">{gesture}</dt>
                    <dd className="text-[11px] text-slate-400 leading-snug">{effect}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}

          <p className="text-[11px] text-slate-400 leading-snug">
            El botón de al lado del signo de pregunta revisa el modelo: choques, uniones mal armadas y caños demasiado cortos. Conviene mirarlo antes de
            exportar el PCF.
          </p>
        </div>
      </section>
    </div>
  );
};
