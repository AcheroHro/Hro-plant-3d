import { LAYER_COLOR, Prim, Sheet } from './sheet';

/** Vista previa SVG de una hoja (mismo dibujo que el PDF) */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rgb = ([r, g, b]: [number, number, number]) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
const n = (v: number) => Math.round(v * 100) / 100;

function base64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function sheetToSvg(sheet: Sheet): string {
  const H = sheet.height;
  const y = (v: number) => n(H - v);
  const el = (p: Prim): string => {
    const c = rgb(LAYER_COLOR[p.layer]);
    switch (p.k) {
      case 'line':
        return `<line x1="${n(p.a[0])}" y1="${y(p.a[1])}" x2="${n(p.b[0])}" y2="${y(p.b[1])}" stroke="${c}" stroke-width="${p.w}"${p.dash ? ' stroke-dasharray="3 2"' : ''}/>`;
      case 'poly': {
        const pts = p.pts.map((q) => `${n(q[0])},${y(q[1])}`).join(' ');
        return `<${p.closed || p.fill ? 'polygon' : 'polyline'} points="${pts}" fill="${p.fill ? c : 'none'}" stroke="${c}" stroke-width="${p.w}"/>`;
      }
      case 'circle':
        return `<circle cx="${n(p.c[0])}" cy="${y(p.c[1])}" r="${n(p.r)}" fill="${p.fill ? c : 'none'}" stroke="${c}" stroke-width="${p.w}"/>`;
      case 'image': {
        const img = sheet.images?.[p.ref];
        if (!img) return '';
        return `<image x="${n(p.p[0])}" y="${y(p.p[1] + p.h)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none" href="data:image/jpeg;base64,${base64(img.jpeg)}"/>`;
      }
      case 'text': {
        const anchor = p.align === 'c' ? 'middle' : p.align === 'r' ? 'end' : 'start';
        const rot = p.angle ? ` transform="rotate(${n(-p.angle)} ${n(p.p[0])} ${y(p.p[1])})"` : '';
        return `<text x="${n(p.p[0])}" y="${y(p.p[1])}" font-size="${p.size}" font-family="Helvetica, Arial, sans-serif"${p.bold ? ' font-weight="bold"' : ''} text-anchor="${anchor}" fill="${c}"${rot}>${esc(p.s)}</text>`;
      }
    }
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheet.width} ${sheet.height}" width="100%" style="background:#fff" stroke-linecap="round" stroke-linejoin="round">${sheet.prims.map(el).join('')}</svg>`;
}
