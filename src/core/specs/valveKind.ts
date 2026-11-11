/** Tipo de válvula, para elegir ícono, botón de la paleta y forma en el visor */
export type ValveKind = 'gate' | 'globe' | 'ball' | 'check' | 'butterfly' | 'plug' | 'other';

export const VALVE_KIND_RULES: { kind: ValveKind; code: string; skey: string; words: RegExp }[] = [
  { kind: 'gate', code: '001', skey: 'VT', words: /gate|compuerta|esclusa/i },
  { kind: 'globe', code: '004', skey: 'VG', words: /globe|globo/i },
  { kind: 'ball', code: '008', skey: 'VB', words: /ball|esf[eé]rica/i },
  { kind: 'check', code: '011', skey: 'VC', words: /check|retenci[oó]n/i },
  { kind: 'butterfly', code: '256', skey: 'VY', words: /butterfly|mariposa/i },
  { kind: 'plug', code: '010', skey: 'VP', words: /plug|macho/i }
];

/**
 * Tipo de válvula según su descripción, la plantilla de Plant (CPVI001 compuerta, 004 globo...)
 * o el SKEY de Isogen (VT, VG, VB, VC, VY, VP).
 */
export function valveKindFrom(description?: string, template?: string, skey?: string): ValveKind {
  const byWord = VALVE_KIND_RULES.find((k) => k.words.test(description || ''));
  if (byWord) return byWord.kind;
  const code = /^CPVI(\d{3})/i.exec(template || '')?.[1];
  const byCode = VALVE_KIND_RULES.find((k) => k.code === code);
  if (byCode) return byCode.kind;
  const key = (skey || '').toUpperCase().slice(0, 2);
  return VALVE_KIND_RULES.find((k) => k.skey === key)?.kind ?? 'other';
}
