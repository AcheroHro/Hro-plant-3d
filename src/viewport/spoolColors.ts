/** Colores para distinguir spools en el visor (se repiten si hay más spools que colores) */
export const SPOOL_COLORS = [
  0x38bdf8, 0x34d399, 0xfbbf24, 0xa78bfa, 0xf472b6, 0x22d3ee, 0xa3e635, 0xfb923c, 0x818cf8, 0x2dd4bf, 0xfacc15, 0xe879f9
];

/** Color de las piezas que no van en spool (válvulas e instrumentos bridados) */
export const ERECTION_COLOR = 0x6b7280;

/** Vista de cambios de campo: color por tipo de cambio; lo que no cambió va en gris */
export const FIELD_COLORS = {
  added: 0x34d399,
  deleted: 0xf43f5e,
  moved: 0xfbbf24,
  edited: 0x38bdf8,
  fieldWeld: 0xfb923c
} as const;

export const FIELD_UNCHANGED_COLOR = 0x4b5563;
