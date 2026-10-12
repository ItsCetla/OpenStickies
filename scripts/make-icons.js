'use strict';

// Renders the Stickies icon (a yellow sticky note with a folded corner) at several
// sizes with supersampled anti-aliasing, then writes PNGs and a multi-size .ico.
// No dependencies: includes a minimal PNG encoder.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets');

// ---------- geometry (normalized 0..1) ----------
const NOTE = { x0: 0.1, y0: 0.11, x1: 0.9, y1: 0.89, r: 0.075 };
const FOLD = 0.23;
const FOLD_LINE = NOTE.x1 + NOTE.y1 - FOLD; // points with x + y > FOLD_LINE are cut away
const BAND = 0.26;

function roundedRectDist(x, y, { x0, y0, x1, y1, r }) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r;
  const hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(x - cx) - hx;
  const dy = Math.abs(y - cy) - hy;
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
}

function capsuleDist(x, y, ax, ay, bx, by, r) {
  const px = x - ax;
  const py = y - ay;
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, (px * vx + py * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - vx * t, py - vy * t) - r;
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

const BODY_TOP = hex('#FFE97A');
const BODY_BOTTOM = hex('#FFD640');
const BAND_COLOR = hex('#F7C51E');
const FLAP_A = hex('#F2C230');
const FLAP_B = hex('#DDA70E');
const LINE = [150, 110, 0, 120];

function over(dst, src) {
  const a = src[3] / 255;
  const da = dst[3] / 255;
  const oa = a + da * (1 - a);
  if (oa === 0) return [0, 0, 0, 0];
  return [
    (src[0] * a + dst[0] * da * (1 - a)) / oa,
    (src[1] * a + dst[1] * da * (1 - a)) / oa,
    (src[2] * a + dst[2] * da * (1 - a)) / oa,
    oa * 255
  ];
}

function samplePoint(x, y, { lines, shadow }) {
  let c = [0, 0, 0, 0];

  if (shadow) {
    const d = roundedRectDist(x, y - 0.025, NOTE);
    const cut = x + y - 0.025 > FOLD_LINE + 0.02;
    if (!cut) {
      const a = Math.max(0, Math.min(1, 1 - (d + 0.005) / 0.05));
      if (a > 0) c = over(c, [0, 0, 0, 70 * a * a]);
    }
  }

  const inNote = roundedRectDist(x, y, NOTE) <= 0 && x + y <= FOLD_LINE;
  if (inNote) {
    const t = (y - NOTE.y0) / (NOTE.y1 - NOTE.y0);
    let body = mix(BODY_TOP, BODY_BOTTOM, t);
    if (y < BAND) body = BAND_COLOR;
    c = over(c, body);

    if (lines) {
      const r = 0.026;
      const segs = [[0.24, 0.42, 0.76, 0.42], [0.24, 0.54, 0.76, 0.54], [0.24, 0.66, 0.56, 0.66]];
      if (segs.some(([ax, ay, bx, by]) => capsuleDist(x, y, ax, ay, bx, by, r) <= 0)) c = over(c, LINE);
    }

    // The folded-over flap.
    const fx = NOTE.x1 - FOLD;
    const fy = NOTE.y1 - FOLD;
    if (x >= fx && y >= fy) {
      const k = ((x - fx) + (y - fy)) / FOLD; // 0 at the inner corner, 1 at the fold line
      c = over(c, mix(FLAP_A, FLAP_B, Math.min(1, k)));
    }
    // Soft crease shadow just inside the fold line.
    const crease = FOLD_LINE - (x + y);
    if (crease < 0.03 && x >= fx - 0.01 && y >= fy - 0.01) c = over(c, [120, 80, 0, 60 * (1 - crease / 0.03)]);
  }
  return c;
}

function render(size) {
  const ss = size <= 32 ? 6 : 4;
  const opts = { lines: size >= 20, shadow: size >= 32 };
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = samplePoint((i + (sx + 0.5) / ss) / size, (j + (sy + 0.5) / ss) / size, opts);
          const ca = c[3] / 255;
          r += c[0] * ca; g += c[1] * ca; b += c[2] * ca; a += ca;
        }
      }
      const n = ss * ss;
      const o = (j * size + i) * 4;
      if (a > 0) {
        px[o] = Math.round(r / a);
        px[o + 1] = Math.round(g / a);
        px[o + 2] = Math.round(b / a);
      }
      px[o + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, size, px);
}

// ---------- PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.png)]);
}

fs.mkdirSync(OUT, { recursive: true });
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const images = icoSizes.map(size => ({ size, png: render(size) }));
fs.writeFileSync(path.join(OUT, 'icon.ico'), encodeIco(images));
fs.writeFileSync(path.join(OUT, 'icon.png'), render(512));
fs.writeFileSync(path.join(OUT, 'tray.png'), images.find(i => i.size === 16).png);
fs.writeFileSync(path.join(OUT, 'tray@2x.png'), images.find(i => i.size === 32).png);
console.log('Wrote icons to', OUT);
