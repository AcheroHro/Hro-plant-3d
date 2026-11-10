import React, { forwardRef } from 'react';
import { Home } from 'lucide-react';

const SIZE = 60;
const HALF = SIZE / 2;

/** Caras del cubo: su giro en CSS y la vista de cámara (azimut y polar, Z arriba) a la que llevan */
const FACES: { label: string; title: string; transform: string; azimuth: number; polar: number }[] = [
  { label: 'FRENTE', title: 'Vista de frente (mirando al norte)', transform: `translateZ(${HALF}px)`, azimuth: Math.PI, polar: Math.PI / 2 },
  { label: 'ATRÁS', title: 'Vista de atrás (mirando al sur)', transform: `rotateY(180deg) translateZ(${HALF}px)`, azimuth: 0, polar: Math.PI / 2 },
  { label: 'DER', title: 'Vista derecha (desde el este)', transform: `rotateY(90deg) translateZ(${HALF}px)`, azimuth: Math.PI / 2, polar: Math.PI / 2 },
  { label: 'IZQ', title: 'Vista izquierda (desde el oeste)', transform: `rotateY(-90deg) translateZ(${HALF}px)`, azimuth: -Math.PI / 2, polar: Math.PI / 2 },
  { label: 'ARRIBA', title: 'Vista en planta', transform: `rotateX(90deg) translateZ(${HALF}px)`, azimuth: Math.PI, polar: 0.05 },
  { label: 'ABAJO', title: 'Vista desde abajo', transform: `rotateX(-90deg) translateZ(${HALF}px)`, azimuth: Math.PI, polar: Math.PI - 0.05 }
];

interface ViewCubeProps {
  /** Lleva la cámara a una vista (con animación) */
  onView: (azimuth: number, polar: number) => void;
  /** Vista isométrica y encuadre de todo */
  onHome: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Cubo de vistas como el ViewCube de AutoCAD: gira con la cámara y cada cara lleva a su vista.
 * El visor le actualiza el `transform` en cada cuadro a través de la ref.
 */
export const ViewCube = forwardRef<HTMLDivElement, ViewCubeProps>(({ onView, onHome, className = '', style }, ref) => (
  <div data-tour="cube" className={`absolute z-20 flex flex-col items-center gap-1 select-none ${className}`} style={style}>
    <div style={{ width: SIZE * 1.5, height: SIZE * 1.5 }} className="flex items-center justify-center">
      <div ref={ref} style={{ width: SIZE, height: SIZE, position: 'relative', transformStyle: 'preserve-3d' }}>
        {FACES.map((face) => (
          <button
            key={face.label}
            type="button"
            title={face.title}
            aria-label={face.title}
            onClick={() => onView(face.azimuth, face.polar)}
            style={{ transform: face.transform, backfaceVisibility: 'hidden', width: SIZE, height: SIZE }}
            className="absolute inset-0 flex items-center justify-center bg-[#1e2632]/95 border border-[#5b6b82] text-[9px] font-black tracking-wide text-slate-100 active:bg-[#0696d7]"
          >
            {face.label}
          </button>
        ))}
      </div>
    </div>
    <button
      type="button"
      onClick={onHome}
      title="Vista isométrica y encuadrar todo"
      aria-label="Vista isométrica y encuadrar todo"
      className="w-11 h-9 rounded-lg bg-[#1e2632]/90 border border-[#3a4150] text-slate-200 flex items-center justify-center active:bg-[#0696d7]"
    >
      <Home size={16} />
    </button>
  </div>
));
ViewCube.displayName = 'ViewCube';
