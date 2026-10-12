// File-type badges for file shortcuts: a document shape with a short label and a color per kind
// of file. Plain inline SVG so it works under the strict CSP without loading anything.

import { t } from './i18n.js';

const CATEGORIES = {
  doc: { color: '#2b5fb4', noun: 'document' },
  sheet: { color: '#1e7a46', noun: 'spreadsheet' },
  slides: { color: '#c9472a', noun: 'presentation' },
  pdf: { color: '#d93025', noun: 'document' },
  text: { color: '#6b7280', noun: 'text file' },
  image: { color: '#0f9ba8', noun: 'image' },
  audio: { color: '#c2307a', noun: 'audio file' },
  video: { color: '#7048c8', noun: 'video' },
  archive: { color: '#9a6b22', noun: 'archive' },
  code: { color: '#3d4f63', noun: 'code file' },
  data: { color: '#4a7a8c', noun: 'data file' },
  font: { color: '#5b5b66', noun: 'font' },
  exe: { color: '#3a3a40', noun: 'program' },
  design: { color: '#e0512f', noun: 'design file' },
  generic: { color: '#868b94', noun: 'file' }
};

// ext: [category, label?, color?]. The label defaults to the upper-cased extension; code files
// carry their language's own color so a folder of sources is easy to scan.
const TYPES = {
  doc: ['doc'], docx: ['doc'], odt: ['doc'], rtf: ['doc'], pages: ['doc', 'PGS'], wpd: ['doc'], epub: ['doc', 'EPUB'],
  xls: ['sheet'], xlsx: ['sheet'], xlsm: ['sheet'], ods: ['sheet'], numbers: ['sheet', 'NUM'], csv: ['sheet'], tsv: ['sheet'],
  ppt: ['slides'], pptx: ['slides'], odp: ['slides'], key: ['slides'],
  pdf: ['pdf'],
  txt: ['text'], md: ['text'], markdown: ['text', 'MD'], log: ['text'], rst: ['text'], tex: ['text'],
  png: ['image'], jpg: ['image'], jpeg: ['image', 'JPG'], gif: ['image'], webp: ['image', 'WEBP'], bmp: ['image'],
  tif: ['image'], tiff: ['image', 'TIFF'], heic: ['image'], heif: ['image'], avif: ['image'], ico: ['image'], svg: ['image'],
  raw: ['image'], cr2: ['image'], nef: ['image'], dng: ['image'], arw: ['image'],
  mp3: ['audio'], wav: ['audio'], flac: ['audio'], aac: ['audio'], ogg: ['audio'], oga: ['audio'], m4a: ['audio'],
  opus: ['audio'], aiff: ['audio'], aif: ['audio'], wma: ['audio'], mid: ['audio'], midi: ['audio', 'MIDI'],
  mp4: ['video'], mov: ['video'], mkv: ['video'], avi: ['video'], webm: ['video', 'WEBM'], wmv: ['video'], m4v: ['video'],
  flv: ['video'], mpg: ['video'], mpeg: ['video', 'MPEG'], '3gp': ['video'],
  zip: ['archive'], rar: ['archive'], '7z': ['archive'], tar: ['archive'], gz: ['archive'], tgz: ['archive'],
  bz2: ['archive'], xz: ['archive'], zst: ['archive'], dmg: ['archive'], iso: ['archive'], cab: ['archive'],
  js: ['code', 'JS', '#c9a400'], mjs: ['code', 'JS', '#c9a400'], cjs: ['code', 'JS', '#c9a400'], jsx: ['code', 'JSX', '#149eca'],
  ts: ['code', 'TS', '#3178c6'], tsx: ['code', 'TSX', '#3178c6'], py: ['code', 'PY', '#3572a5'], ipynb: ['code', 'IPYN', '#e46e2e'],
  rb: ['code', 'RB', '#cc342d'], go: ['code', 'GO', '#00a7d0'], rs: ['code', 'RS', '#b7410e'], java: ['code', 'JAVA', '#b07219'],
  kt: ['code', 'KT', '#8f5cf7'], swift: ['code', 'SWFT', '#f05138'], c: ['code', 'C', '#555c6e'], h: ['code', 'H', '#555c6e'],
  cpp: ['code', 'C++', '#d6336c'], cc: ['code', 'C++', '#d6336c'], hpp: ['code', 'H++', '#d6336c'], cs: ['code', 'C#', '#178600'],
  php: ['code', 'PHP', '#777bb4'], html: ['code', 'HTML', '#e34c26'], htm: ['code', 'HTML', '#e34c26'], css: ['code', 'CSS', '#563d7c'],
  scss: ['code', 'SCSS', '#c6538c'], less: ['code', 'LESS', '#1d365d'], vue: ['code', 'VUE', '#41b883'], svelte: ['code', 'SVLT', '#ff3e00'],
  sh: ['code', 'SH', '#4eaa25'], bash: ['code', 'BASH', '#4eaa25'], zsh: ['code', 'ZSH', '#4eaa25'], fish: ['code', 'FISH', '#4eaa25'],
  ps1: ['code', 'PS1', '#2671be'], bat: ['exe', 'BAT'], cmd: ['exe', 'CMD'], sql: ['code', 'SQL', '#e38c00'],
  lua: ['code', 'LUA', '#000080'], dart: ['code', 'DART', '#00b4ab'], r: ['code', 'R', '#198ce7'], scala: ['code', 'SCLA', '#c22d40'],
  hs: ['code', 'HS', '#5e5086'], ex: ['code', 'EX', '#6e4a7e'], exs: ['code', 'EXS', '#6e4a7e'], erl: ['code', 'ERL', '#b83998'],
  clj: ['code', 'CLJ', '#5881d8'], pl: ['code', 'PL', '#0298c3'], m: ['code', 'M', '#438eff'], zig: ['code', 'ZIG', '#ec915c'],
  json: ['data', 'JSON'], yaml: ['data', 'YAML'], yml: ['data', 'YML'], xml: ['data'], toml: ['data', 'TOML'], ini: ['data'],
  env: ['data'], db: ['data'], sqlite: ['data', 'SQL3'], parquet: ['data', 'PARQ'],
  ttf: ['font'], otf: ['font'], woff: ['font', 'WOFF'], woff2: ['font', 'WOF2'], eot: ['font'],
  exe: ['exe'], msi: ['exe'], app: ['exe'], apk: ['exe'], deb: ['exe'], rpm: ['exe'], pkg: ['exe'], appimage: ['exe', 'APP'],
  jar: ['exe'], com: ['exe'], dll: ['exe'], so: ['exe'], lnk: ['exe', 'LNK'],
  fig: ['design', 'FIG', '#a259ff'], sketch: ['design', 'SKCH', '#f7b500'], psd: ['design', 'PSD', '#1f8ccf'],
  ai: ['design', 'AI', '#f08a00'], xd: ['design', 'XD', '#d63ab4'], indd: ['design', 'INDD', '#d4146c'],
  afdesign: ['design', 'AFD', '#1b72be'], afphoto: ['design', 'AFP', '#7e4dd2'], blend: ['design', 'BLND', '#e87d0d'],
  stl: ['design', 'STL'], obj: ['design', 'OBJ']
};

const cleanExt = (ext) => String(ext || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);

function typeOf(ext, kind) {
  if (kind === 'folder') return { cat: 'folder', label: '', color: '#e8a917' };
  const e = cleanExt(ext);
  const t = Object.prototype.hasOwnProperty.call(TYPES, e) ? TYPES[e] : null;
  const cat = t ? t[0] : 'generic';
  const label = (t && t[1]) || e.toUpperCase().slice(0, 4);
  const color = (t && t[2]) || CATEGORIES[cat].color;
  return { cat, label, color };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function fileIcon(ext, kind) {
  const { cat, label, color } = typeOf(ext, kind);
  if (cat === 'folder') {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="32" height="40">'
      + '<path d="M2 11a3 3 0 0 1 3-3h7.2l3 3H27a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="#c98a0c"/>'
      + '<path d="M2 15a3 3 0 0 1 3-3h22a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="' + color + '"/></svg>';
  }
  const size = label.length >= 4 ? 7.6 : label.length === 3 ? 9 : 10.5;
  const text = label
    ? `<text x="16" y="31.6" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-weight="700" font-size="${size}" fill="#fff">${esc(label)}</text>`
    : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="32" height="40">'
    + '<path d="M5 1.5h15.5l9 9V36a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 36V4A2.5 2.5 0 0 1 5 1.5z" fill="#fff" stroke="' + color + '" stroke-opacity=".55"/>'
    + '<path d="M20.5 1.5v6.5a2.5 2.5 0 0 0 2.5 2.5h6.5" fill="' + color + '" fill-opacity=".25" stroke="' + color + '" stroke-opacity=".55" stroke-linejoin="round"/>'
    + '<rect x="2.5" y="24" width="27" height="11" rx="2" fill="' + color + '"/>'
    + text + '</svg>';
}

const urlCache = new Map();

// The same badge as a data: URL, for CSS backgrounds and <img>.
export function fileIconUrl(ext, kind) {
  const key = `${kind === 'folder' ? 'folder' : 'file'}:${cleanExt(ext)}`;
  let url = urlCache.get(key);
  if (!url) {
    url = 'data:image/svg+xml,' + encodeURIComponent(fileIcon(ext, kind));
    urlCache.set(key, url);
  }
  return url;
}

// "PDF document", "XLSX spreadsheet", "Folder"...
export function fileKindLabel(ext, kind) {
  const { cat, label } = typeOf(ext, kind);
  if (cat === 'folder') return t('fileKind.folder');
  if (cat === 'generic') return label ? t('fileKind.generic', { label }) : t('fileKind.file');
  return t(`fileKind.${cat}`, { label }, `${label} ${CATEGORIES[cat].noun}`);
}

// Chips store only their name and path; the badge is painted on through a CSS variable so it
// never ends up in the saved note.
export function hydrateFileChips(root) {
  for (const a of root.querySelectorAll('a.file-chip')) {
    const url = fileIconUrl(a.getAttribute('data-ext'), a.getAttribute('data-kind'));
    a.style.setProperty('--chip-icon', `url("${url}")`);
  }
}
