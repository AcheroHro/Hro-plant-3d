/**
 * Nombre de cada tipo de pieza tal como se muestra en toda la app: menú de pieza, propiedades,
 * revisión del modelo, mensajes y listas. Un solo lugar para que no haya dos nombres para lo mismo.
 */
export const PIECE_NAMES: Record<string, string> = {
  PIPE: 'Caño',
  ELBOW: 'Codo',
  TEE: 'Te',
  FLANGE: 'Brida',
  VALVE: 'Válvula',
  REDUCER: 'Reducción',
  CAP: 'Tapa',
  OLET: 'Olet',
  CROSS: 'Cruz',
  COUPLING: 'Cupla',
  INSTRUMENT: 'Instrumento',
  GASKET: 'Junta',
  BOLT_SET: 'Bulones',
  FLANGE_BLIND: 'Brida ciega',
  MISC: 'Accesorio'
};

/** Femeninos, para armar "una brida" o "un codo" */
const FEMININE = new Set(['TEE', 'FLANGE', 'VALVE', 'REDUCER', 'CAP', 'CROSS', 'COUPLING', 'GASKET', 'FLANGE_BLIND']);

/** "Caño", "Brida"... */
export function pieceName(type: string): string {
  return PIECE_NAMES[type] ?? type;
}

/** "caño", "brida"... para usar dentro de una frase */
export function pieceNameLower(type: string): string {
  return pieceName(type).toLowerCase();
}

/** "un caño", "una brida" */
export function aPiece(type: string): string {
  return `${FEMININE.has(type) ? 'una' : 'un'} ${pieceNameLower(type)}`;
}
