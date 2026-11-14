/** Specs que vienen con la app (se eligen en Archivo sin cargar archivos) */
export const BUILT_IN_SPECS = ['RCI1', 'CS150', 'CS300', 'SS150'];

/** Specs que la app conoce: las integradas, más las que se cargaron (la activa, la del modelo) */
export function knownSpecCodes(...loaded: (string | undefined | null)[]): string[] {
  const out = new Set(BUILT_IN_SPECS.map((s) => s.toUpperCase()));
  for (const s of loaded) if (s) out.add(s.toUpperCase());
  return [...out];
}
