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

/** Colores para distinguir líneas en el modo "Color por línea" y en el Gestor de Líneas */
export const LINE_COLORS = [
  0x38bdf8, // celeste
  0x34d399, // verde
  0xfbbf24, // ámbar
  0xf472b6, // rosa
  0xa78bfa, // violeta
  0xfb923c, // naranja
  0x22d3ee, // cian
  0xa3e635, // lima
  0xe879f9, // fucsia
  0x2dd4bf, // turquesa
  0x60a5fa, // azul
  0xf87171  // coral
];

/** Devuelve un color determinista para un número de línea dentro del conjunto de líneas del modelo */
export function colorForLine(line: string, sortedLines: string[]): number {
  const idx = sortedLines.indexOf(line);
  if (idx >= 0) return LINE_COLORS[idx % LINE_COLORS.length];
  let hash = 0;
  for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) >>> 0;
  return LINE_COLORS[hash % LINE_COLORS.length];
}

/** Convierte un color numérico (0x38bdf8) a CSS (#38bdf8) */
export function colorHexCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

