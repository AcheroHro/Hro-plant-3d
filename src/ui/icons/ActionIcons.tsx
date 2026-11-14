import React from 'react';

/**
 * Íconos de acciones dibujados a partir de lo que se ve en la obra (caños, bocas, bridas,
 * válvulas), con el mismo trazo que lucide para convivir con el resto de la app.
 */
export interface ActionIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export type ActionIcon = React.FC<ActionIconProps>;

const make = (name: string, body: React.ReactNode): ActionIcon => {
  const Icon: ActionIcon = ({ size = 22, strokeWidth = 1.8, className }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {body}
    </svg>
  );
  Icon.displayName = name;
  return Icon;
};

/* Archivo */
export const IconProyecto = make('IconProyecto', <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M7 15h5a2 2 0 0 0 2-2v-1" /></>);
export const IconAbrirPcf = make('IconAbrirPcf', <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M7 16h4a2 2 0 0 0 2-2v-2" /><path d="m11 13 2-2 2 2" /></>);
export const IconExportarPcf = make('IconExportarPcf', <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 12h4a2 2 0 0 1 2 2v2" /><path d="m12 15 2 2 2-2" /></>);
export const IconSpec = make('IconSpec', <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /><path d="M9 8h6" /></>);
export const IconInformeCampo = make('IconInformeCampo', <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></>);
export const IconSpools = make('IconSpools', <><path d="M2 16h7a3 3 0 0 0 3-3V6h10" /><circle cx="2.5" cy="16" r="1.4" fill="currentColor" /><circle cx="12" cy="6" r="1.4" fill="currentColor" /><circle cx="21.5" cy="6" r="1.4" fill="currentColor" /></>);
export const IconCortesMateriales = make('IconCortesMateriales', <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /><path d="M15 15.5 16.5 17 19 14.5" /></>);
export const IconPlanosIso = make('IconPlanosIso', <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M6 15l4 2.3 5-2.9V9.6l3-1.7" /><path d="M15 21v-3h6" /></>);

/* Modelar */
export const IconTrazar = make('IconTrazar', <><path d="M3 19h6a4 4 0 0 0 4-4V6" /><path d="m10 9 3-3 3 3" /><circle cx="3" cy="19" r="1.2" fill="currentColor" /></>);
export const IconPiezas = make('IconPiezas', <><path d="M2 12h3M19 12h3" /><path d="M5 7v10M19 7v10" /><path d="m7 8 10 8V8L7 16z" /><path d="M12 12V5M9.5 5h5" /></>);
export const IconBocaLibre = make('IconBocaLibre', <><path d="M2 12h10" /><ellipse cx="15" cy="12" rx="2.5" ry="6" /><path d="M19 12h3" /></>);
export const IconUnirBoca = make('IconUnirBoca', <><path d="M2 8h5M17 16h5" /><ellipse cx="8" cy="8" rx="1.5" ry="3" /><ellipse cx="16" cy="16" rx="1.5" ry="3" /><path d="M10 8h2a2 2 0 0 1 2 2v4" strokeDasharray="2 2.2" /></>);
export const IconAlinear = make('IconAlinear', <><path d="M3 17h11" /><path d="M18 4v16" strokeDasharray="2 2.2" /><path d="m11 14 3 3-3 3" /><circle cx="18" cy="17" r="2" /></>);
export const IconIrAPunto = make('IconIrAPunto', <><path d="M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11z" /><path d="M9.5 10h5M12 7.5v5" /></>);
export const IconOtraBoca = make('IconOtraBoca', <><path d="M17 3l4 4-4 4" /><path d="M3 7h18" /><path d="M7 21l-4-4 4-4" /><path d="M21 17H3" /></>);

/* Corregir */
export const IconPartir = make('IconPartir', <><path d="M2 9h7v6H2M22 9h-7v6h7" /><path d="M12 4v16" strokeDasharray="2 2" /><path d="m10 6 2-2 2 2" /></>);
export const IconDerivar = make('IconDerivar', <><path d="M2 15h20" /><path d="M2 19h20" strokeOpacity={0.35} /><path d="M10 15V5h4v10" /><path d="M9 5h6" /></>);
export const IconPurga = make('IconPurga', <><path d="M2 5h20" /><path d="M12 5v4" /><path d="m9 9 6 5V9l-6 5z" /><path d="M12 14v3" /><path d="M12 20v.5" strokeWidth={2.6} /></>);
export const IconSoporte = make('IconSoporte', <><circle cx="12" cy="8" r="4" /><path d="M12 12v6" /><path d="M7 21h10" /><path d="M9 18h6" /></>);
export const IconDiametroTramo = make('IconDiametroTramo', <><path d="M2 8h6l8-3v14l-8-3H2z" /><path d="M19 9v6" /><path d="m17.5 10.5 1.5-1.5 1.5 1.5M17.5 13.5l1.5 1.5 1.5-1.5" /></>);
export const IconDarVuelta = make('IconDarVuelta', <><path d="M8 5v14" /><path d="M2 12h6" /><path d="M14 8h6l-2-2M20 16h-6l2 2" /></>);
export const IconGirarEje = make('IconGirarEje', <><path d="M3 12h18" /><path d="M17 6.5A7 7 0 1 0 19 12" /><path d="M19 4v4h-4" /></>);
export const IconDatos = make('IconDatos', <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>);
export const IconMasOpciones = make('IconMasOpciones', <><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>);
export const IconBorrar = make('IconBorrar', <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13" /><path d="M9 7V4h6v3" /></>);
export const IconCano = make('IconCano', <><rect x="2" y="8" width="20" height="8" rx="1.5" /><path d="M6 8v8M18 8v8" /></>);

/* Revisar y ver */
export const IconChoques = make('IconChoques', <><path d="M3 15 15 3" /><path d="M9 21 21 9" /><path d="m11 11 2 2" /><path d="M5 5l1.5 1.5M17.5 17.5 19 19" /></>);
export const IconMedir = make('IconMedir', <><path d="M4 7v10M20 7v10" /><path d="M4 12h16" /><path d="m7 9-3 3 3 3M17 9l3 3-3 3" /></>);
export const IconCotas = make('IconCotas', <><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9" /><path d="M8 8h.01" /><path d="M10 14h5" /></>);
export const IconCajaCorte = make('IconCajaCorte', <><path d="M12 3 4 7v10l8 4 8-4V7z" strokeDasharray="3 2" /><path d="M4 7l8 4 8-4M12 11v10" /></>);
export const IconAislarLinea = make('IconAislarLinea', <><path d="M3 17h7a3 3 0 0 0 3-3V5" strokeWidth={2.8} /><path d="M15 19h6M18 16v6" strokeOpacity={0.5} /><path d="M17 5h4" strokeOpacity={0.5} /></>);
export const IconPlanoDxf = make('IconPlanoDxf', <><path d="M3 8h18M3 16h18M8 3v18M16 3v18" strokeDasharray="2 2" /><rect x="6.5" y="6.5" width="3" height="3" /><rect x="14.5" y="14.5" width="3" height="3" /></>);
export const IconVistas = make('IconVistas', <><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></>);
export const IconEncuadrar = make('IconEncuadrar', <><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /><path d="m8 14 4-6 4 6" /></>);
export const IconSeguirBoca = make('IconSeguirBoca', <><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>);
