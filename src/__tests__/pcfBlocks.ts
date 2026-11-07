/** Lector mínimo de bloques PCF para los tests (no es el importador de la app) */
export interface RawPcfBlock {
  type: string;
  attrs: Record<string, string[]>;
  points: { key: string; xyz: [number, number, number]; bore?: number; end?: string }[];
}

export function parsePcfBlocks(text: string): { header: Record<string, string>; blocks: RawPcfBlock[] } {
  const header: Record<string, string> = {};
  const blocks: RawPcfBlock[] = [];
  let cur: RawPcfBlock | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indented = /^\s/.test(raw);
    const tokens = raw.trim().split(/\s+/);
    const key = tokens[0].toUpperCase();
    if (!indented) {
      if (cur) blocks.push(cur);
      cur = null;
      if (tokens.length > 1) {
        header[key] = tokens.slice(1).join(' ');
        continue;
      }
      cur = { type: key, attrs: {}, points: [] };
      continue;
    }
    if (!cur) {
      header[key] = tokens.slice(1).join(' ');
      continue;
    }
    if (/POINT$|^CO-ORDS$/.test(key) && tokens.length >= 4) {
      cur.points.push({
        key,
        xyz: [parseFloat(tokens[1]), parseFloat(tokens[2]), parseFloat(tokens[3])],
        bore: tokens[4] !== undefined ? parseFloat(tokens[4]) : undefined,
        end: tokens[5]
      });
    } else {
      (cur.attrs[key] ||= []).push(tokens.slice(1).join(' '));
    }
  }
  if (cur) blocks.push(cur);
  return { header, blocks };
}

export const dist = (a: [number, number, number], b: [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
