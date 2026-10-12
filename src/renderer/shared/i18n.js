// UI translations for renderer pages. The main process merges src/locales/<lang>.json with its
// English fallback and hands the table over through the preload in one synchronous call, so the
// first paint already has the right words and text direction.
//
// Markup carries English text as a fallback plus a key:
//   data-i18n="key"              -> textContent
//   data-i18n-html="key"         -> innerHTML (only for strings with simple markup such as <b>)
//   data-i18n-title="key"        -> title attribute
//   data-i18n-placeholder="key"  -> placeholder attribute
//   data-i18n-aria="key"         -> aria-label attribute
//   data-i18n-dataplaceholder    -> data-placeholder (the note editor's empty-state hint)

let table = null;

function load() {
  try { table = window.stickies.i18n(); } catch { table = null; }
  if (!table || !table.strings) table = { lang: 'en', dir: 'ltr', strings: {} };
  try { plural = new Intl.PluralRules(table.lang); } catch { plural = new Intl.PluralRules('en'); }
  return table;
}

let plural = null;

function data() { return table || load(); }

// Fetches the table again (after the language setting changed). Returns true if it changed.
export function refreshI18n() {
  const before = table && table.lang;
  load();
  return before !== table.lang;
}

export function lang() { return data().lang; }
export function dir() { return data().dir; }

function format(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (params[name] === undefined || params[name] === null ? m : String(params[name])));
}

// t('manager.savedNamed', { name: 'x' }). An unknown key falls back to `fallback`, then to the key.
export function t(key, params, fallback) {
  const s = data().strings;
  const text = Object.prototype.hasOwnProperty.call(s, key) ? s[key] : (fallback !== undefined ? fallback : key);
  return format(text, params);
}

// Counted strings: tp('manager.notesCount', 3) reads "manager.notesCount.one" / "manager.notesCount.other"
// (and few/many/two/zero where a language has them), with {count} filled in.
export function tp(base, count, params) {
  const s = data().strings;
  let cat = 'other';
  try { cat = plural.select(count); } catch { /* keep other */ }
  const key = [`${base}.${cat}`, `${base}.other`].find(k => Object.prototype.hasOwnProperty.call(s, k)) || `${base}.other`;
  return t(key, Object.assign({ count: Number(count).toLocaleString(data().lang) }, params));
}

const ATTRS = [['data-i18n-title', 'title'], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria', 'aria-label'], ['data-i18n-dataplaceholder', 'data-placeholder']];

// Translates every tagged element under root and sets the page language and direction.
export function applyTranslations(root = document) {
  const { lang: code, dir: direction, strings } = data();
  const has = (k) => Object.prototype.hasOwnProperty.call(strings, k);
  const doc = root.ownerDocument || root;
  if (doc.documentElement) {
    doc.documentElement.lang = code;
    doc.documentElement.dir = direction;
  }
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const k = el.getAttribute('data-i18n');
    if (has(k)) el.textContent = strings[k];
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    const k = el.getAttribute('data-i18n-html');
    if (has(k)) el.innerHTML = strings[k];
  }
  for (const [attr, target] of ATTRS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const k = el.getAttribute(attr);
      if (has(k)) el.setAttribute(target, strings[k]);
    }
  }
}

// Names that live in colors.json and backgrounds.js stay English there; these look up their
// translations ("color.yellow", "font.handwriting", "gradient.sunrise") and fall back to the name.
export const colorName = (name) => t(`color.${String(name).toLowerCase()}`, null, name);
export const fontName = (font) => t(`font.${font.id}`, null, font.name);
export const gradientName = (name) => t(`gradient.${String(name).toLowerCase()}`, null, name);
