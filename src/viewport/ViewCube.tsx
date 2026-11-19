import React, { forwardRef, useRef } from 'react';
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

/** Cuadrantes isométricos estándar de AutoCAD (SO, SE, NO, NE) */
const ISO_CORNERS: { label: string; title: string; azimuth: number; polar: number }[] = [
  { label: 'SO', title: 'Isométrica Sudoeste', azimuth: -Math.PI / 4, polar: Math.PI / 3 },
  { label: 'SE', title: 'Isométrica Sudeste', azimuth: Math.PI / 4, polar: Math.PI / 3 },
  { label: 'NO', title: 'Isométrica Noroeste', azimuth: (-3 * Math.PI) / 4, polar: Math.PI / 3 },
  { label: 'NE', title: 'Isométrica Noreste', azimuth: (3 * Math.PI) / 4, polar: Math.PI / 3 }
];

interface ViewCubeProps {
  /** Lleva la cámara a una vista (con animación) */
  onView: (azimuth: number, polar: number) => void;
  /** Vista isométrica y encuadre de todo */
  onHome: () => void;
  /** Orbitar la cámara arrastrando directamente sobre el cubo */
  onOrbit?: (dx: number, dy: number) => void;
  /** Proyección actual de la cámara */
  projection?: 'perspective' | 'orthographic';
  /** Alternar entre perspectiva y ortográfica */
  onToggleProjection?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Cubo de vistas como el ViewCube de AutoCAD: gira con la cámara, cada cara lleva a su vista
 * y arrastrándolo con el dedo orbita la escena suavemente.
 */
export const ViewCube = forwardRef<HTMLDivElement, ViewCubeProps>(
  ({ onView, onHome, onOrbit, projection = 'perspective', onToggleProjection, className = '', style }, ref) => {
    const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
    const suppressClickRef = useRef(false);

    const onPointerDown = (e: React.PointerEvent) => {
      if (!onOrbit) return;
      dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Sin captura
      }
    };
    const onPointerMove = (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || !onOrbit) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 6) return;
      d.moved = true;
      d.x = e.clientX;
      d.y = e.clientY;
      onOrbit(dx, dy);
    };
    const onPointerUp = () => {
      if (dragRef.current?.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      dragRef.current = null;
    };

    return (
      <div data-tour="cube" className={`absolute z-20 flex flex-col items-center gap-1 select-none ${className}`} style={style}>
        <div
          style={{ width: SIZE * 1.5, height: SIZE * 1.5, touchAction: 'none' }}
          className="flex items-center justify-center cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div ref={ref} style={{ width: SIZE, height: SIZE, position: 'relative', transformStyle: 'preserve-3d' }}>
            {FACES.map((face) => (
              <button
                key={face.label}
                type="button"
                title={face.title}
                aria-label={face.title}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  onView(face.azimuth, face.polar);
                }}
                style={{ transform: face.transform, backfaceVisibility: 'hidden', width: SIZE, height: SIZE }}
                className="absolute inset-0 flex items-center justify-center bg-[#1e2632]/95 border border-[#5b6b82] text-[9px] font-black tracking-wide text-slate-100 active:bg-[#0696d7]"
              >
                {face.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onHome}
            title="Vista isométrica y encuadrar todo"
            aria-label="Vista isométrica y encuadrar todo"
            className="w-9 h-8 rounded-lg bg-[#1e2632]/90 border border-[#3a4150] text-slate-200 flex items-center justify-center active:bg-[#0696d7]"
          >
            <Home size={15} />
          </button>
          {onToggleProjection && (
            <button
              type="button"
              onClick={onToggleProjection}
              aria-pressed={projection === 'orthographic'}
              title={projection === 'orthographic' ? 'Cámara ortográfica (tocar para pasar a perspectiva)' : 'Cámara perspectiva (tocar para pasar a ortográfica)'}
              className={`h-8 px-2 rounded-lg border text-[10px] font-mono font-black tracking-tight active:scale-95 transition-colors ${
                projection === 'orthographic'
                  ? 'bg-amber-500 text-slate-950 border-amber-200'
                  : 'bg-[#1e2632]/90 text-slate-200 border-[#3a4150]'
              }`}
            >
              {projection === 'orthographic' ? 'ORTO' : 'PERSP'}
            </button>
          )}
        </div>
        {/* 4 vistas isométricas rápidas estilo esquinas del ViewCube */}
        <div className="grid grid-cols-4 gap-0.5">
          {ISO_CORNERS.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => onView(c.azimuth, c.polar)}
              title={c.title}
              aria-label={c.title}
              className="h-6 px-1.5 rounded bg-[#1e2632]/85 border border-[#3a4150] text-[8px] font-mono font-bold text-slate-300 active:bg-[#0696d7] active:text-white"
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
);
ViewCube.displayName = 'ViewCube';
