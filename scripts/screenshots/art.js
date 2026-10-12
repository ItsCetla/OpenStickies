'use strict';

// Pictures used inside the demo notes. SVG so they stay sharp at any capture scale.

const mountains = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFB37A"/><stop offset="0.55" stop-color="#FFD9A8"/><stop offset="1" stop-color="#FFF1D6"/>
    </linearGradient>
    <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7FB7D9"/><stop offset="1" stop-color="#4E8DB8"/>
    </linearGradient>
  </defs>
  <rect width="320" height="240" fill="url(#sky)"/>
  <circle cx="226" cy="92" r="30" fill="#FFF4C2"/>
  <path d="M0 150 L58 84 L96 122 L150 60 L214 136 L254 104 L320 158 L320 240 L0 240Z" fill="#9C7BB8"/>
  <path d="M150 60 L170 83 L160 80 L150 92 L140 80 L132 82Z" fill="#F4EEF9"/>
  <path d="M0 176 L46 136 L92 170 L142 122 L196 172 L250 140 L320 182 L320 240 L0 240Z" fill="#6E5C9A"/>
  <rect y="186" width="320" height="54" fill="url(#lake)"/>
  <path d="M0 186 C60 180 110 192 160 186 C210 180 260 192 320 186 L320 196 L0 196Z" fill="#3E6E52"/>
  <g fill="#2F5A43">
    <path d="M24 196 L36 150 L48 196Z"/><path d="M44 196 L58 140 L72 196Z"/><path d="M66 196 L76 160 L86 196Z"/>
    <path d="M240 196 L252 156 L264 196Z"/><path d="M262 196 L278 138 L294 196Z"/><path d="M288 196 L300 162 L312 196Z"/>
  </g>
  <g stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="2" stroke-linecap="round">
    <path d="M110 210 H150"/><path d="M180 222 H230"/><path d="M60 228 H92"/>
  </g>
</svg>`;

// A "screen snip" of a small dashboard card.
function chart() {
  const bars = [38, 52, 47, 66, 74, 69, 92];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const x0 = 44, w = 40, gap = 16, base = 214;
  const rects = bars.map((v, i) => {
    const h = v * 1.6;
    const x = x0 + i * (w + gap);
    const fill = i === bars.length - 1 ? '#2F6FDB' : '#9CC3F5';
    return `<rect x="${x}" y="${base - h}" width="${w}" height="${h}" rx="6" fill="${fill}"/>` +
      `<text x="${x + w / 2}" y="${base + 20}" text-anchor="middle" font-size="12" fill="#6B7280">${days[i]}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 260" width="480" height="260" font-family="Segoe UI, Inter, system-ui, sans-serif">
  <rect width="480" height="260" rx="14" fill="#FFFFFF"/>
  <text x="24" y="36" font-size="15" font-weight="700" fill="#111827">New sign-ups</text>
  <text x="24" y="56" font-size="12" fill="#6B7280">Last 7 days</text>
  <text x="456" y="38" text-anchor="end" font-size="22" font-weight="700" fill="#111827">1,284</text>
  <text x="456" y="56" text-anchor="end" font-size="12" font-weight="600" fill="#16A34A">▲ 18% vs last week</text>
  <g stroke="#E5E7EB" stroke-width="1">
    <path d="M24 214 H456"/><path d="M24 160 H456" stroke-dasharray="3 4"/><path d="M24 106 H456" stroke-dasharray="3 4"/>
  </g>
  ${rects}
</svg>`;
}

module.exports = { mountains, chart: chart() };
