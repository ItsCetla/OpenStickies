'use strict';
// Syntax colors for code blocks in exported HTML, and so in PDFs and printouts.
//
// The note window paints tokens with CSS Custom Highlights, which only exist in a live DOM, so
// an export wraps each token in <span class="tok-<kind>"> instead. The lexer is the renderer's
// highlight.js, a dependency-free ES module that runs under Node as well; it is loaded lazily
// with import() because the main process is CommonJS.
const path = require('path');
const { pathToFileURL } = require('url');

// Same backstops as the editor (src/renderer/note/editor.js): huge blocks and very long lines
// stay plain.
const MAX_CHARS = 100000;
const MAX_LINE = 10000;

const PRE_RE = /<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi;
const PIECE_RE = /<[^>]*>|[^<]+/g;
const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

let loading = null;

function highlighter() {
  if (!loading) {
    const file = path.join(__dirname, '..', 'renderer', 'note', 'highlight.js');
    loading = import(pathToFileURL(file).href).catch((err) => {
      console.warn('[export] code highlighter unavailable:', err.message);
      return null;
    });
  }
  return loading;
}

function decode(s) {
  return s.replace(ENTITY_RE, (m, ent) => {
    const low = ent.toLowerCase();
    if (low[0] === '#') {
      const code = low[1] === 'x' ? parseInt(low.slice(2), 16) : parseInt(low.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[low] !== undefined ? NAMED[low] : m;
  });
}

function encode(s) {
  return s.replace(/[&<> ]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&nbsp;'));
}

function hasLongLine(text, max) {
  let start = 0;
  while (start <= text.length) {
    let nl = text.indexOf('\n', start);
    if (nl < 0) nl = text.length;
    if (nl - start > max) return true;
    start = nl + 1;
  }
  return false;
}

function attr(attrs, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return m ? (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]) : null;
}

// The code block's inner HTML as [{ tag }] and [{ text, at }] pieces plus the text the lexer
// sees, where <br> counts as a newline (the same text the editor builds in codeText()).
function splitPieces(inner) {
  const pieces = [];
  let text = '';
  for (const m of inner.matchAll(PIECE_RE)) {
    const s = m[0];
    if (s[0] === '<') {
      pieces.push({ tag: s });
      if (/^<br\b/i.test(s)) text += '\n';
    } else {
      const t = decode(s);
      pieces.push({ text: t, at: text.length });
      text += t;
    }
  }
  return { pieces, text };
}

// Re-emit one text run with the tokens that overlap it wrapped in spans. Tokens come sorted
// and non-overlapping; `hint` is the first token that may still touch this run.
function emitRun(piece, tokens, hint) {
  const from = piece.at;
  const to = from + piece.text.length;
  let i = hint;
  while (i < tokens.length && tokens[i].end <= from) i++;
  let out = '';
  let pos = from;
  let j = i;
  for (; j < tokens.length && tokens[j].start < to; j++) {
    const tok = tokens[j];
    const s = Math.max(tok.start, from);
    const e = Math.min(tok.end, to);
    if (s > pos) out += encode(piece.text.slice(pos - from, s - from));
    out += `<span class="tok-${tok.kind}">${encode(piece.text.slice(s - from, e - from))}</span>`;
    pos = e;
  }
  if (pos < to) out += encode(piece.text.slice(pos - from));
  // A token that runs past this piece continues in the next one.
  const next = j > 0 && tokens[j - 1] && tokens[j - 1].end > to ? j - 1 : j;
  return { out, next };
}

function colorBlock(hl, attrs, inner) {
  const { pieces, text } = splitPieces(inner);
  if (!text.trim() || text.length > MAX_CHARS || hasLongLine(text, MAX_LINE)) return null;
  const lang = hl.normalizeLang(attr(attrs, 'data-lang')) || hl.detectLanguage(text).lang;
  const tokens = hl.tokenize(text, lang);
  if (!tokens.length) return null;
  let out = '';
  let hint = 0;
  for (const p of pieces) {
    if (p.tag !== undefined) { out += p.tag; continue; }
    const r = emitRun(p, tokens, hint);
    out += r.out;
    hint = r.next;
  }
  return out;
}

// `html` with every <pre> block's tokens wrapped in <span class="tok-…">. Blocks that can't be
// colored (plain text, nothing recognizable, too big) are returned as they were.
async function colorCode(html) {
  const src = String(html || '');
  if (!/<pre\b/i.test(src)) return src;
  const hl = await highlighter();
  if (!hl) return src;
  return src.replace(PRE_RE, (m, attrs, inner) => {
    try {
      const colored = colorBlock(hl, attrs, inner);
      return colored === null ? m : `<pre${attrs}>${colored}</pre>`;
    } catch (err) {
      console.warn('[export] could not color a code block:', err.message);
      return m;
    }
  });
}

// Light-theme token colors, the same ones the note window uses (src/renderer/note/note.css).
// `text` is the note's text color, for the two kinds that are a dimmed version of it.
function codeColorCss(text) {
  const dim = (alpha) => `color-mix(in srgb, ${text} ${alpha}%, transparent)`;
  return `
  .tok-keyword { color: #a626a4; }
  .tok-string { color: #3f8a2e; }
  .tok-number { color: #b35c00; }
  .tok-comment { color: ${dim(52)}; font-style: italic; }
  .tok-function { color: #2f63d6; }
  .tok-type { color: #a15c00; }
  .tok-operator { color: #0e7f8a; }
  .tok-tag { color: #c2332e; }
  .tok-attr { color: #9a5a00; }
  .tok-punctuation { color: ${dim(75)}; }
  .tok-property { color: #b0373f; }`;
}

module.exports = { colorCode, codeColorCss };
