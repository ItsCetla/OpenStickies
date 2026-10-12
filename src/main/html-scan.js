'use strict';

// Lightweight scanners over note HTML for the main process, which has no DOM.
// Note HTML is always produced by our sanitizer, so its shape is predictable:
// lowercase tags, double-quoted attributes, checklist items as <li class="checked h2">.

const { htmlToText } = require('./store-text');

const LIST_TAG_RE = /<(\/?)(ul|ol|li)\b([^>]*)>/gi;

function attr(attrs, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(attrs || '');
  return m ? m[1] : null;
}

function hasClass(attrs, cls) {
  return new RegExp(`(^|\\s)${cls}(\\s|$)`).test(attr(attrs, 'class') || '');
}

// Count checklist items: { total, done }.
function taskCounts(html) {
  const stack = [];
  let total = 0;
  let done = 0;
  for (const m of String(html || '').matchAll(LIST_TAG_RE)) {
    const [, close, tag, attrs] = m;
    const t = tag.toLowerCase();
    if (t === 'li') {
      if (!close && stack.length && stack[stack.length - 1]) {
        total++;
        if (hasClass(attrs, 'checked')) done++;
      }
      continue;
    }
    if (close) stack.pop();
    else stack.push(t === 'ul' && hasClass(attrs, 'checklist'));
  }
  return { total, done };
}

// Checklist items with their own text (not their sub-items') and where their tag sits,
// so the agent tools can tick items by name.
function checklistEntries(html) {
  const src = String(html || '');
  const tags = [...src.matchAll(LIST_TAG_RE)];
  const stack = [];
  const out = [];
  tags.forEach((m, i) => {
    const [full, close, tag, attrs] = m;
    const t = tag.toLowerCase();
    if (t === 'li') {
      if (!close && stack.length && stack[stack.length - 1]) {
        const end = i + 1 < tags.length ? tags[i + 1].index : src.length;
        const text = htmlToText(src.slice(m.index + full.length, end)).replace(/\s+/g, ' ').trim();
        out.push({ index: m.index, length: full.length, attrs, text, checked: hasClass(attrs, 'checked') });
      }
      return;
    }
    if (close) stack.pop();
    else stack.push(t === 'ul' && hasClass(attrs, 'checklist'));
  });
  return out;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// By 1-based number, exact text, then partial text.
function findChecklistEntry(entries, item) {
  const raw = String(item ?? '').trim();
  if (/^\d+$/.test(raw)) return entries[Number(raw) - 1] || null;
  const q = norm(raw);
  if (!q) return null;
  return entries.find(e => norm(e.text) === q) || entries.find(e => norm(e.text).includes(q)) || null;
}

function setEntryChecked(html, entry, done) {
  const classes = (attr(entry.attrs, 'class') || '').split(/\s+/).filter(c => c && c !== 'checked');
  if (done) classes.unshift('checked');
  const rest = entry.attrs.replace(/\s*\bclass="[^"]*"/i, '');
  const tag = `<li${classes.length ? ` class="${classes.join(' ')}"` : ''}${rest}>`;
  return html.slice(0, entry.index) + tag + html.slice(entry.index + entry.length);
}

// Clear the ticks in checklists marked data-reset="daily|weekly" whose reset time has
// passed. Returns the new HTML, or null if nothing needed resetting.
function resetChecklists(html, now = Date.now()) {
  const src = String(html || '');
  if (!src.includes('data-reset=')) return null;
  let out = '';
  let last = 0;
  let changed = false;
  const stack = []; // per open list: true if inside a list being reset
  for (const m of src.matchAll(LIST_TAG_RE)) {
    const [full, close, tag, attrs] = m;
    const t = tag.toLowerCase();
    const inReset = stack.length > 0 && stack[stack.length - 1];
    let replacement = null;
    if (t === 'li') {
      if (!close && inReset && hasClass(attrs, 'checked')) {
        const cls = (attr(attrs, 'class') || '').split(/\s+/).filter(c => c && c !== 'checked').join(' ');
        const rest = attrs.replace(/\s*\bclass="[^"]*"/i, '');
        replacement = `<li${cls ? ` class="${cls}"` : ''}${rest}>`;
      }
    } else if (close) {
      stack.pop();
    } else {
      const mode = attr(attrs, 'data-reset');
      const due = mode && isResetDue(mode, Number(attr(attrs, 'data-reset-at')) || 0, now);
      stack.push(inReset || !!due);
      if (due) {
        replacement = `<${tag}${attrs.replace(/\s*\bdata-reset-at="[^"]*"/i, '')} data-reset-at="${now}">`;
      }
    }
    if (replacement !== null) {
      out += src.slice(last, m.index) + replacement;
      last = m.index + full.length;
      changed = true;
    }
  }
  if (!changed) return null;
  return out + src.slice(last);
}

// Daily lists reset at the first local midnight after the last reset; weekly ones on Monday.
function isResetDue(mode, lastReset, now) {
  const d = new Date(lastReset || 0);
  d.setHours(0, 0, 0, 0);
  if (mode === 'daily') d.setDate(d.getDate() + 1);
  else if (mode === 'weekly') d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  else return false;
  return now >= d.getTime();
}

// #tags in a note's text (not in code, URLs or headings written as "# Title").
const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]{0,48})/gu;
function extractTags(html) {
  const text = htmlToText(String(html || '').replace(/<(pre|code)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' '));
  const tags = new Set();
  for (const m of text.matchAll(TAG_RE)) {
    const tag = m[2].replace(/[-/]+$/, '').toLowerCase();
    if (tag && !/^\d+$/.test(tag)) tags.add(tag);
  }
  return [...tags].sort();
}

// Ids of other notes this note links to ([[links]] are stored as <a href="note://id">).
function extractLinks(html) {
  const ids = new Set();
  for (const m of String(html || '').matchAll(/href="note:\/\/(n[a-z0-9]{6,40})"/g)) ids.add(m[1]);
  return [...ids];
}

// Text from image alt attributes (where recognized text is kept).
function extractImageText(html) {
  const parts = [];
  for (const m of String(html || '').matchAll(/<img\b[^>]*\balt="([^"]+)"/gi)) parts.push(m[1]);
  return htmlToText(parts.join('\n'));
}

module.exports = { taskCounts, resetChecklists, isResetDue, extractTags, extractLinks, extractImageText, checklistEntries, findChecklistEntry, setEntryChecked, TAG_RE };
