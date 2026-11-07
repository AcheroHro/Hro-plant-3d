import { BranchSymbolDef, BranchTableEntry, PartUsePriority, SpecPreferences } from './catalogTypes';
import { toInchNominal } from './units';
import { decodeText, readZip } from './zip';

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decodeEntities(m[1]) : undefined;
}

function ndFromTag(tag: string | undefined): number {
  if (!tag) return 0;
  const value = parseFloat(attr(tag, 'Value') ?? '0');
  return toInchNominal(value, attr(tag, 'Units'));
}

/** content/PartUsePriorities.xml: orden de familias que Plant usa por tipo y diámetro */
export function parsePartUsePriorities(xml: string): PartUsePriority[] {
  const out: PartUsePriority[] = [];
  const blocks = xml.match(/<PartTypeUsePriority>[\s\S]*?<\/PartTypeUsePriority>/g) ?? [];
  for (const b of blocks) {
    const partType = b.match(/<PartType>([^<]+)<\/PartType>/)?.[1]?.trim();
    const ndTag = b.match(/<ND\b[^>]*\/?>/)?.[0];
    if (!partType || !ndTag) continue;
    const familyIds = (b.match(/<PartFamilyName\b[^>]*\/?>/g) ?? [])
      .map((t) => (attr(t, 'PartFamilyId') ?? '').toLowerCase())
      .filter(Boolean);
    out.push({ partType, nominalDiameter: ndFromTag(ndTag), familyIds });
  }
  return out;
}

/** content/branchtable.xml: símbolos de ramal y tabla cabezal × ramal */
export function parseBranchTable(xml: string): { symbols: BranchSymbolDef[]; table: BranchTableEntry[] } {
  const symbols: BranchSymbolDef[] = [];
  const defsSection = xml.match(/<BranchSymbols>[\s\S]*?<\/BranchSymbols>/)?.[0] ?? '';
  for (const b of defsSection.match(/<BranchSymbol>[\s\S]*?<\/BranchSymbol>/g) ?? []) {
    const name = b.match(/<Name>([^<]*)<\/Name>/)?.[1]?.trim();
    if (!name) continue;
    const description = decodeEntities(b.match(/<Description>([^<]*)<\/Description>/)?.[1]?.trim() ?? '');
    const parts = (b.match(/<PartReference\b[^>]*\/?>/g) ?? []).map((t) => ({
      partType: attr(t, 'PartType') ?? '',
      familyId: (attr(t, 'PartFamilyId') ?? '').toLowerCase(),
      familyName: attr(t, 'PartFamilyName') ?? ''
    }));
    symbols.push({ name, description, parts });
  }
  const table: BranchTableEntry[] = [];
  for (const b of xml.match(/<BranchTableItem>[\s\S]*?<\/BranchTableItem>/g) ?? []) {
    const header = b.match(/<Header\b[^>]*\/?>/)?.[0];
    const branch = b.match(/<Branch\b[^>]*\/?>/)?.[0];
    const syms = Array.from(b.matchAll(/<BranchSymbol>([^<]+)<\/BranchSymbol>/g)).map((m) => m[1].trim());
    table.push({ headerNd: ndFromTag(header), branchNd: ndFromTag(branch), symbols: syms });
  }
  return { symbols, table };
}

/** Lee un .pspx (zip) y devuelve las preferencias de la spec */
export async function readPspx(buffer: ArrayBuffer | Uint8Array): Promise<SpecPreferences> {
  const files = await readZip(buffer);
  const find = (suffix: string) => {
    for (const [name, data] of files) if (name.toLowerCase().endsWith(suffix.toLowerCase())) return decodeText(data);
    return undefined;
  };
  const prioXml = find('PartUsePriorities.xml');
  const branchXml = find('branchtable.xml');
  const branch = branchXml ? parseBranchTable(branchXml) : { symbols: [], table: [] };
  return {
    priorities: prioXml ? parsePartUsePriorities(prioXml) : [],
    branchSymbols: branch.symbols,
    branchTable: branch.table
  };
}
