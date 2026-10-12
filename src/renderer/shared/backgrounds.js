// Colour maths for custom note backgrounds (solid colours, gradients, pictures). Shared by the
// note window and the notes list so a card previews exactly what the note will look like.

const HEX_RE = /^#[0-9a-f]{6}$/i;

export const GRADIENT_PRESETS = [
  { name: 'Sunrise', from: '#ffd194', to: '#ff7eb3', angle: 135 },
  { name: 'Lagoon', from: '#a1ffce', to: '#3fa7d6', angle: 135 },
  { name: 'Lavender', from: '#e0c3fc', to: '#8ec5fc', angle: 160 },
  { name: 'Peach', from: '#ffecd2', to: '#fcb69f', angle: 180 },
  { name: 'Mint', from: '#d4fc79', to: '#96e6a1', angle: 120 },
  { name: 'Dusk', from: '#3a1c71', to: '#d76d77', angle: 135 },
  { name: 'Ocean', from: '#1e3c72', to: '#2a5298', angle: 160 },
  { name: 'Graphite', from: '#232526', to: '#5b5f63', angle: 135 }
];

export function isHex(c) { return typeof c === 'string' && HEX_RE.test(c); }

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

// WCAG relative luminance (0 = black, 1 = white).
export function luminance([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function mixRgb(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }

const DARK_TEXT = '#22201a';
const LIGHT_TEXT = '#f5f3ee';

// Picks whichever text colour has the better contrast against a background of this luminance.
export function textForLuminance(lum) {
  const onDark = (1.05) / (lum + 0.05);          // contrast of near-white text
  const onLight = (lum + 0.05) / (0.0134 + 0.05); // contrast of near-black text
  return onDark > onLight ? LIGHT_TEXT : DARK_TEXT;
}

// Full note palette ({ bg, bar, text, accent }) from a single colour.
export function deriveColors(hex) {
  const rgb = hexToRgb(hex);
  const lum = luminance(rgb);
  const text = textForLuminance(lum);
  const dark = text === LIGHT_TEXT;
  const [h, s, l] = rgbToHsl(rgb);
  // The title bar is a step darker on light notes and a step lighter on dark ones, like the palette.
  const bar = rgbToHex(hslToRgb([h, s, Math.min(1, Math.max(0, l + (dark ? 0.1 : -0.1)))]));
  // Accent: same hue, more saturated, and far enough from the background to stand out.
  // Greys stay grey: their hue is meaningless, so boosting saturation would tint them red.
  const accent = rgbToHex(hslToRgb([h, s < 0.05 ? s : Math.min(1, s + 0.3), dark ? Math.min(0.8, Math.max(0.6, l + 0.25)) : Math.max(0.3, Math.min(0.42, l - 0.2))]));
  return { bg: hex, bar, text, accent, dark };
}

// Same, for a gradient: text follows the average luminance of both ends, and the bar is
// translucent so the gradient runs behind the title bar while its icons stay readable.
export function deriveGradientColors(from, to) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const avg = rgbToHex(mixRgb(a, b, 0.5));
  const c = deriveColors(avg);
  const lum = (luminance(a) + luminance(b)) / 2;
  c.text = textForLuminance(lum);
  c.dark = c.text === LIGHT_TEXT;
  c.bar = c.dark ? 'rgba(0, 0, 0, 0.22)' : 'rgba(255, 255, 255, 0.38)';
  return c;
}

export function gradientCss(bg) {
  return `linear-gradient(${Math.round(Number(bg.angle) || 0)}deg, ${bg.from}, ${bg.to})`;
}

// A normalized background is trusted (main validates it), but this runs before it is put
// into style attributes, so check again rather than rely on that.
export function safeBackground(bg) {
  if (!bg || typeof bg !== 'object') return null;
  if (bg.type === 'solid' && isHex(bg.color)) return bg;
  if (bg.type === 'gradient' && isHex(bg.from) && isHex(bg.to)) return bg;
  if (bg.type === 'image' && /^sticky-img:\/\/img\/[A-Za-z0-9._-]+$/.test(String(bg.src))) return bg;
  return null;
}
