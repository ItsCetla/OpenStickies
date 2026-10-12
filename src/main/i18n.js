'use strict';

// UI translations. Strings live in src/locales/<lang>.json as flat "area.key": "Text {name}" pairs;
// en.json is complete and every other file may be partial. Lookups fall back from the chosen
// language to its base language (pt-BR -> pt) and then to English, so a missing translation shows
// English rather than a key. Renderers get the merged table once, synchronously, through the
// preload (window.stickies.i18n()), because pages are served from app:// and can't read src/locales.

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const SUPPORTED = ['en', 'de', 'es', 'fr', 'it', 'pt-BR', 'nl', 'pl', 'ru', 'ja', 'zh-CN', 'ar'];
const RTL = new Set(['ar']);

let lang = 'en';
let strings = {};
let pluralRules = new Intl.PluralRules('en');

function readLocale(code) {
  try { return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), 'utf8')); } catch { return {}; }
}

function systemLocale() {
  try { return require('electron').app.getLocale() || 'en'; } catch { return 'en'; }
}

// 'system' or a locale code -> one of SUPPORTED. "pt-PT" finds pt-BR, "zh-TW" finds zh-CN, "en-GB" finds en.
function resolve(setting) {
  const wanted = String(!setting || setting === 'system' ? systemLocale() : setting).replace('_', '-');
  const exact = SUPPORTED.find(c => c.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact;
  const base = wanted.split('-')[0].toLowerCase();
  return SUPPORTED.find(c => c.split('-')[0].toLowerCase() === base) || 'en';
}

// Returns true when the language actually changed.
function setLanguage(setting) {
  const next = resolve(setting);
  if (next === lang && Object.keys(strings).length) return false;
  lang = next;
  const base = lang.split('-')[0];
  strings = Object.assign({}, readLocale('en'), base !== lang ? readLocale(base) : {}, readLocale(lang));
  try { pluralRules = new Intl.PluralRules(lang); } catch { pluralRules = new Intl.PluralRules('en'); }
  return true;
}

function format(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (params[name] === undefined || params[name] === null ? m : String(params[name])));
}

// t('tray.newNote'), t('manager.savedNamed', { name }) — an unknown key comes back as the key itself.
function t(key, params) {
  if (!Object.keys(strings).length) setLanguage('system');
  const text = Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : key;
  return format(text, params);
}

// Counted strings use paired keys: "<base>.one" and "<base>.other" (plus few/many/zero/two in
// languages that need them). {count} is filled in automatically.
function tp(base, count, params) {
  if (!Object.keys(strings).length) setLanguage('system');
  let cat = 'other';
  try { cat = pluralRules.select(count); } catch { /* keep other */ }
  const key = [`${base}.${cat}`, `${base}.other`].find(k => Object.prototype.hasOwnProperty.call(strings, k)) || `${base}.other`;
  return t(key, Object.assign({ count: count.toLocaleString(lang) }, params));
}

function snapshot() {
  if (!Object.keys(strings).length) setLanguage('system');
  return { lang, dir: RTL.has(lang) ? 'rtl' : 'ltr', strings };
}

module.exports = { SUPPORTED, resolve, setLanguage, t, tp, snapshot, language: () => lang };
