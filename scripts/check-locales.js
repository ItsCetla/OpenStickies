#!/usr/bin/env node
'use strict';

// Checks the translation files against src/locales/en.json (no dependencies):
//   - every locale has valid JSON with string values, no keys that en.json lacks and the same
//     {placeholders} as English (a locale may leave keys out: they fall back to English);
//   - plural forms beyond one/other (zero, two, few, many) are allowed wherever en.json has "<base>.other";
//   - every literal key used in code (t('…'), tr('…'), tp('…'), tx('…')) and in markup
//     (data-i18n, data-i18n-title, …) exists in en.json.
// Exit code 1 if anything is wrong.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCALES = path.join(ROOT, 'src', 'locales');
const SRC = path.join(ROOT, 'src');
const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

const problems = [];
const fail = (msg) => problems.push(msg);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { fail(`${path.relative(ROOT, file)}: ${err.message}`); return null; }
}

const placeholders = (s) => [...new Set((String(s).match(/\{(\w+)\}/g) || []))].sort().join(' ');

const en = readJson(path.join(LOCALES, 'en.json'));
if (!en) { console.error(problems.join('\n')); process.exit(1); }

for (const [k, v] of Object.entries(en)) if (typeof v !== 'string') fail(`en.json: "${k}" is not a string`);

// Which English key a locale key corresponds to (extra plural forms map to "<base>.other").
function englishKey(key) {
  if (Object.prototype.hasOwnProperty.call(en, key)) return key;
  const m = key.match(/^(.*)\.(\w+)$/);
  if (m && PLURAL_FORMS.includes(m[2]) && Object.prototype.hasOwnProperty.call(en, `${m[1]}.other`)) return `${m[1]}.other`;
  return null;
}

const files = fs.readdirSync(LOCALES).filter(f => f.endsWith('.json') && f !== 'en.json').sort();
for (const file of files) {
  const data = readJson(path.join(LOCALES, file));
  if (!data) continue;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') { fail(`${file}: "${key}" is not a string`); continue; }
    const ek = englishKey(key);
    if (!ek) { fail(`${file}: "${key}" is not in en.json`); continue; }
    // A plural form may drop {count} (e.g. "one" written as a word), but must not invent placeholders.
    const want = placeholders(en[ek]);
    const got = placeholders(value);
    const isPlural = /\.(zero|one|two|few|many|other)$/.test(key);
    if (isPlural ? got.split(' ').some(p => p && !want.split(' ').includes(p) && p !== '{count}') : got !== want) {
      fail(`${file}: "${key}" has placeholders [${got}] but English has [${want}]`);
    }
  }
}

// Keys used in source.
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== 'locales' && ent.name !== 'vendor') walk(p, out); }
    else if (/\.(js|html)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const has = (k) => Object.prototype.hasOwnProperty.call(en, k);
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const line = (i) => text.slice(0, i).split('\n').length;
  if (file.endsWith('.js')) {
    for (const m of text.matchAll(/\b(t|tr|tp|tx)\(\s*'([A-Za-z][\w-]*(?:\.[\w-]+)+)'/g)) {
      const ok = m[1] === 'tp' ? has(`${m[2]}.other`) : has(m[2]);
      if (!ok) fail(`${rel}:${line(m.index)}: ${m[1]}('${m[2]}') is not in en.json`);
    }
  } else {
    for (const m of text.matchAll(/\bdata-i18n(?:-[a-z]+)?="([^"]+)"/g)) {
      if (!has(m[1])) fail(`${rel}:${line(m.index)}: data-i18n key "${m[1]}" is not in en.json`);
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log(`Locales OK: ${Object.keys(en).length} English keys, ${files.length} other locale file${files.length === 1 ? '' : 's'}`);
