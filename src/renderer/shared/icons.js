// Hand-drawn 24×24 stroke icons. `d` paths are stroked; `f` paths/circles are filled.
const P = {
  plus: { d: 'M12 5v14M5 12h14' },
  minus: { d: 'M5 12h14' },
  close: { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' },
  more: { c: [[5.5, 12, 1.5], [12, 12, 1.5], [18.5, 12, 1.5]] },
  pin: { d: 'M9.5 3.5h5l-.8 5.6 3.3 3.2v1.4H7v-1.4l3.3-3.2-.8-5.6zM12 13.7V20.5' },
  pinFilled: { d: 'M12 13.7V20.5', f: 'M9.5 3.5h5l-.8 5.6 3.3 3.2v1.4H7v-1.4l3.3-3.2-.8-5.6z' },
  trash: { d: 'M4.5 7h15M10 11v6M14 11v6M6.5 7l.9 11.6A2 2 0 0 0 9.4 20.5h5.2a2 2 0 0 0 2-1.9L17.5 7M9 7V4.5h6V7' },
  bold: { d: 'M7.5 5h5.25a3.5 3.5 0 0 1 0 7H7.5zM7.5 12h6.25a3.5 3.5 0 0 1 0 7H7.5z', w: 2.3 },
  italic: { d: 'M11 5h6M7 19h6M14 5l-4 14', w: 2 },
  underline: { d: 'M7 4.5v6.5a5 5 0 0 0 10 0V4.5M5.5 20h13', w: 2 },
  strike: { d: 'M4.5 12h15M16 7.6C15.4 5.9 13.9 5 12 5c-2.5 0-4 1.3-4 3 0 1.3.8 2.3 2.6 3M8 16.3c.5 1.8 2 2.7 4 2.7 2.5 0 4-1.3 4-3 0-.8-.3-1.5-.8-2', w: 1.9 },
  textSize: { d: 'M3 19L8 5l5 14M4.8 14.2h6.4M14.5 19l3.25-8.5L21 19M15.5 16.3h4.5' },
  heading: { d: 'M6 5v14M17 5v14M6 12h11', w: 2 },
  listUl: { d: 'M9.5 6.5h10M9.5 12h10M9.5 17.5h10', c: [[5, 6.5, 1.35], [5, 12, 1.35], [5, 17.5, 1.35]] },
  listOl: { d: 'M10 6.5h10M10 12h10M10 17.5h10M4.2 5.2l1.4-.9v4.4M3.8 14.6a1.4 1.4 0 0 1 2.7.4c0 1-2.7 2-2.7 3.2h2.8', w: 1.6 },
  checklist: { d: 'M4 4.5h5.5V10H4zM5.3 7.4l1.2 1.2 2.3-2.7M4 14h5.5v5.5H4zM12.5 7.25h8M12.5 16.75h8', w: 1.6 },
  link: { d: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1' },
  image: { d: 'M3.5 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM3.5 16l5-5 4.5 4.5 2.5-2.5 5 5', c: [[15.5, 9.2, 1.5]] },
  code: { d: 'M9 7l-5 5 5 5M15 7l5 5-5 5' },
  codeBlock: { d: 'M3.5 6.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM9.5 10l-2.2 2 2.2 2M14.5 10l2.2 2-2.2 2' },
  quote: { d: 'M9.5 7.5c-2.2.8-3.6 2.7-3.6 5.5v3.5h4.4V12H7.4M18.5 7.5c-2.2.8-3.6 2.7-3.6 5.5v3.5h4.4V12h-2.9' },
  alignLeft: { d: 'M4 6h16M4 10h10M4 14h16M4 18h10' },
  alignCenter: { d: 'M4 6h16M7 10h10M4 14h16M7 18h10' },
  alignRight: { d: 'M4 6h16M10 10h10M4 14h16M10 18h10' },
  hr: { d: 'M3.5 12h17M8 6.5h8M8 17.5h8', o: 0.5 },
  table: { d: 'M4 6a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18zM4 9.75h16M4 14.75h16M10 9.75v9.75' },
  eraser: { d: 'M15.5 4.5l4 4-9 9H6.5l-2.5-2.5zM12.5 7.5l4 4M10 20h10' },
  textColor: { d: 'M6.5 16L12 4l5.5 12M8.4 12h7.2', w: 1.9 },
  highlight: { d: 'M14.5 4.5l5 5L11.5 17.5H7.5v-4zM7.5 17.5l-2 2' },
  indent: { d: 'M4 6h16M11 10h9M11 14h9M4 18h16M4.5 9.5l3 2.5-3 2.5' },
  outdent: { d: 'M4 6h16M11 10h9M11 14h9M4 18h16M7.5 9.5L4.5 12l3 2.5' },
  bell: { d: 'M6 16v-5a6 6 0 0 1 12 0v5l1.7 2H4.3zM10 20.5a2.1 2.1 0 0 0 4 0' },
  lock: { d: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3' },
  unlock: { d: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2' },
  chevronUp: { d: 'M6 15l6-6 6 6' },
  chevronDown: { d: 'M6 9l6 6 6-6' },
  chevronRight: { d: 'M9 6l6 6-6 6' },
  chevronLeft: { d: 'M15 6l-6 6 6 6' },
  drop: { d: 'M12 3.5C9 7.4 6.5 10.6 6.5 14a5.5 5.5 0 0 0 11 0c0-3.4-2.5-6.6-5.5-10.5z' },
  download: { d: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14' },
  copy: { d: 'M8.5 8.5h10.5V20H8.5zM5 15.5V4.5h10.5' },
  notes: { d: 'M5 4h14a1 1 0 0 1 1 1v10l-5 5H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM15 20v-4a1 1 0 0 1 1-1h4M8 8.5h8M8 12h5' },
  search: { d: 'M20 20l-4.6-4.6', circ: [[10.5, 10.5, 6]] },
  settings: { d: 'M4 7h9M17 7h3M4 17h3M11 17h9', circ: [[15, 7, 2], [9, 17, 2]] },
  sun: { d: 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4', circ: [[12, 12, 4]] },
  moon: { d: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z' },
  restore: { d: 'M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4.5v4h4' },
  html: { d: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14' },
  check: { d: 'M5 12.5l4.5 4.5L19 7', w: 2 },
  eye: { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', circ: [[12, 12, 3]] },
  eyeOff: { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM4 4l16 16', circ: [[12, 12, 3]] },
  printer: { d: 'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z' },
  clock: { d: 'M12 7.5V12l3 2', circ: [[12, 12, 8.5]] },
  palette: { d: 'M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.5-.7 1.5-1.4 0-.5-.3-.9-.5-1.2-.3-.4-.5-.8-.5-1.3 0-.8.7-1.5 1.5-1.5H16a4.5 4.5 0 0 0 4.5-4.5c0-3.9-3.8-7.1-8.5-7.1z', c: [[8, 10.5, 1.2], [11, 7.5, 1.2], [15, 8, 1.2]] },
  undo: { d: 'M9 14L4.5 9.5 9 5M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3' },
  redo: { d: 'M15 14l4.5-4.5L15 5M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3' },
  sort: { d: 'M7 4.5v15M4 16.5l3 3 3-3M13.5 6.5h6.5M13.5 12h4.5M13.5 17.5h2.5' },
  external: { d: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' },
  calendar: { d: 'M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4' },
  folder: { d: 'M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z' },
  upload: { d: 'M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14' },
  info: { d: 'M12 11v5.5M12 7.6v.1', circ: [[12, 12, 8.5]] },
  keyboard: { d: 'M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5zM7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14.5h8' },
  calendarClock: { d: 'M20 11V6.5H4.5v13H11M4.5 10.5H20M8.5 4v4M15.5 4v4M17 15v2l1.3 1', circ: [[17, 17, 4]] },
  superscript: { d: 'M4 8l8 10M12 8l-8 10M16 9.5c0-1 .8-1.7 1.8-1.7s1.7.7 1.7 1.5c0 1.4-3.5 2.4-3.5 3.7h3.6', w: 1.7 },
  shield: { d: 'M12 3.5l7 2.6v5.4c0 4.3-3 7.7-7 9-4-1.3-7-4.7-7-9V6.1zM9.6 11.6V10.4a2.4 2.4 0 0 1 4.8 0v1.2M9 11.6h6v4.1H9z', w: 1.6 },
  fingerprint: { d: 'M8.2 18.5c.7-1.9 1-4 1-6.3a2.8 2.8 0 0 1 5.6 0c0 2.6-.3 5-1.2 7.3M12 12.4c0 3-.5 5.6-1.7 7.6M5.4 15.6c.4-1.1.6-2.3.6-3.5a6 6 0 0 1 9.6-4.8M17.9 10.6c.1.5.1 1 .1 1.5 0 1.8-.2 3.5-.6 5.1', w: 1.6 },
  grip: { c: [[9, 6.5, 1.5], [15, 6.5, 1.5], [9, 12, 1.5], [15, 12, 1.5], [9, 17.5, 1.5], [15, 17.5, 1.5]] },
  snip: { d: 'M4 8.5V5a1 1 0 0 1 1-1h3.5M15.5 4H19a1 1 0 0 1 1 1v3.5M20 15.5V19a1 1 0 0 1-1 1h-3.5M8.5 20H5a1 1 0 0 1-1-1v-3.5M9 12h6M12 9v6' },
  template: { d: 'M4.5 4.5h15v4h-15zM4.5 11.5h6.5v8H4.5zM14 11.5h5.5M14 15.5h5.5M14 19.5h3.5' },
  history: { d: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 5v3.8h3.8M12 8v4.2l2.8 1.8' },
  tag: { d: 'M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2a1.5 1.5 0 0 1 0 2.1l-6.5 6.5a1.5 1.5 0 0 1-2.1 0z', c: [[8, 8, 1.4]] },
  hash: { d: 'M9.5 4l-2 16M16.5 4l-2 16M4.5 9h15.5M4 15h15.5' },
  layers: { d: 'M12 3.5l8.5 4.5-8.5 4.5L3.5 8zM3.5 12l8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5' },
  bookmark: { d: 'M6.5 4h11v16.5l-5.5-4-5.5 4z' },
  menu: { d: 'M4 7h16M4 12h16M4 17h16' },
  pencil: { d: 'M4 20h4.2L19 9.2a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8zM13.5 6.5l4 4' },
  inbox: { d: 'M4 13.5l2.5-8h11l2.5 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13.5h4.5l1.5 2.5h4l1.5-2.5H20' },
  wrapInline: { d: 'M3 6h18M3 18h18M3 12h3.5M17.5 12H21M8.5 9.25h7v5.5h-7z' },
  wrapLeft: { d: 'M3 5.5h8v7H3zM14 6h7M14 9.25h7M14 12.5h7M3 16.5h18M3 20h12' },
  wrapRight: { d: 'M13 5.5h8v7h-8zM3 6h7M3 9.25h7M3 12.5h7M3 16.5h18M3 20h12' },
  wrapBlock: { d: 'M3 4h18M7 7.5h10v8H7zM3 19.5h18' },
  wrapBehind: { fo: 'M5.5 4.5h13v15h-13z', d: 'M5.5 4.5h13v15h-13zM3 8.5h18M3 12h18M3 15.5h13' },
  wrapFront: { d: 'M3 7h3M18 7h3M3 12h3M18 12h3M3 17h3M18 17h3', f: 'M8 5h8v14H8z' },
  subscript: { d: 'M4 6l8 10M12 6l-8 10M16 15.5c0-1 .8-1.7 1.8-1.7s1.7.7 1.7 1.5c0 1.4-3.5 2.4-3.5 3.7h3.6', w: 1.7 }
};

export function icon(name, { size = 18, cls = '' } = {}) {
  const p = P[name];
  if (!p) return '';
  const w = p.w || 1.75;
  let inner = '';
  if (p.fo) inner += `<path d="${p.fo}" fill="currentColor" fill-opacity="0.28"/>`;
  if (p.d) inner += `<path d="${p.d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${p.o ? ` stroke-opacity="1"` : ''}/>`;
  if (p.f) inner += `<path d="${p.f}" fill="currentColor" stroke="currentColor" stroke-width="${w}" stroke-linejoin="round"/>`;
  if (p.c) for (const [cx, cy, r] of p.c) inner += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/>`;
  if (p.circ) for (const [cx, cy, r] of p.circ) inner += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="${w}"/>`;
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
}

// Replace every <i data-icon="name"> placeholder inside root with its SVG.
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    const size = Number(el.dataset.size) || 18;
    el.outerHTML = icon(el.dataset.icon, { size });
  }
}
