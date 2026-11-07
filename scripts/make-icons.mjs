// Genera los íconos PNG de la PWA sin dependencias: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x12, 0x16, 0x1f];
const PIPE = [0x06, 0x96, 0xd7];
const FLANGE = [0xf5, 0x9e, 0x0b];
const RED = [0xd9, 0x38, 0x31];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const distSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  if (t < 0 || t > 1) return Infinity;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};

/**
 * Dibujo en coordenadas 0..1: un caño que entra horizontal, codo de 90° y sube, con bridas
 * en los extremos. `pad` achica el dibujo para la zona segura del ícono "maskable".
 */
function colorAt(x, y, { maskable, rounded }) {
  if (rounded && !maskable) {
    const r = 0.2;
    const cx = Math.min(Math.max(x, r), 1 - r);
    const cy = Math.min(Math.max(y, r), 1 - r);
    if (Math.hypot(x - cx, y - cy) > r) return null;
  }
  const s = maskable ? 0.62 : 0.8;
  const u = (x - 0.5) / s + 0.5;
  const v = (y - 0.5) / s + 0.5;
  const w = 0.075;
  // Tramo horizontal (0.12,0.72)→(0.5,0.72), codo centro (0.5,0.42) radio 0.3, tramo vertical (0.8,0.42)→(0.8,0.12)
  const R = 0.3;
  const cxe = 0.5;
  const cye = 0.42;
  let d = Math.min(distSeg(u, v, 0.14, 0.72, 0.5, 0.72), distSeg(u, v, 0.8, 0.42, 0.8, 0.14));
  if (u >= cxe && v >= cye) d = Math.min(d, Math.abs(Math.hypot(u - cxe, v - cye) - R));
  // Bridas
  const flange = (Math.abs(u - 0.12) < 0.03 && Math.abs(v - 0.72) < 0.15) || (Math.abs(v - 0.12) < 0.03 && Math.abs(u - 0.8) < 0.15);
  if (flange) return FLANGE;
  // Soldaduras a tope a la entrada y salida del codo
  if (d < w && ((Math.abs(u - 0.5) < 0.012 && v > 0.6) || (Math.abs(v - 0.42) < 0.012 && u > 0.7))) return RED;
  if (d < w) return PIPE;
  return BG;
}

function render(size, opts) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = colorAt((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, opts);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
      const o = (py * size + px) * 4;
      buf[o] = a ? r / a : 0;
      buf[o + 1] = a ? g / a : 0;
      buf[o + 2] = a ? b / a : 0;
      buf[o + 3] = (a / (ss * ss)) * 255;
    }
  }
  return png(size, buf);
}

const out = (name, size, opts) => writeFileSync(new URL(`../public/${name}`, import.meta.url), render(size, opts));
out('icon-192.png', 192, { rounded: true });
out('icon-512.png', 512, { rounded: true });
out('icon-maskable-512.png', 512, { maskable: true });
out('apple-touch-icon.png', 180, { maskable: true });
out('favicon-32.png', 32, { rounded: true });
console.log('Íconos generados en public/');
