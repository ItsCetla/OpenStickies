'use strict';

// Small, dependency-free Markdown → HTML converter used when importing .md files.
// Covers the subset a sticky note can display: headings, paragraphs, emphasis,
// strikethrough, inline code, fenced code, quotes, lists, task lists, links,
// images, rules and pipe tables. Output is sanitized again by the note window.

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeUrl(u) {
  const url = String(u || '').trim();
  return /^(https?:|mailto:|sticky-img:|data:image\/)/i.test(url) ? url : '#';
}

function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  // `s` is already HTML-escaped here, so captured URLs are attribute-safe as-is.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, src) => `<img src="${safeUrl(src)}" alt="${alt}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label, href) => `<a href="${safeUrl(href)}">${label}</a>`);
  s = s.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]])/g, (_, pre, url) => `${pre}<a href="${url.startsWith('www.') ? 'https://' + url : url}">${url}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<b>${a || b}</b>`);
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  s = s.replace(/(^|[^\w_])_([^_\s][^_]*)_(?!\w)/g, '$1<i>$2</i>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/==([^=]+)==/g, '<span style="background-color: #FFE45C">$1</span>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

function mdToHtml(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    // Any info string is allowed after the fence (```c++, ```js title="x", ````…).
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      const marker = fence[1];
      const closes = (l) => { const m = /^\s*(`{3,}|~{3,})\s*$/.exec(l); return m && m[1][0] === marker[0] && m[1].length >= marker.length; };
      const body = [];
      i++;
      while (i < lines.length && !closes(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = Math.min(3, h[1].length);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${mdToHtml(body.join('\n'))}</blockquote>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push('<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }

    const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    if (listRe.test(line)) {
      out.push(parseList(lines, i, (next) => { i = next; }));
      continue;
    }

    // Always consume the current line, so a line no block rule claimed can never stall the loop.
    const para = [lines[i++]];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !listRe.test(lines[i]) && !/^\s*(#{1,6}\s|>|```|~~~)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return out.join('');
}

function parseList(lines, start, setIndex) {
  const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const first = listRe.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  let isTask = /^\[[ xX]\]\s/.test(first[3]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = listRe.exec(lines[i]);
    if (!m) {
      if (/^\s*$/.test(lines[i]) || !items.length) break;
      // continuation line
      items[items.length - 1].text += ' ' + lines[i].trim();
      i++;
      continue;
    }
    const indent = m[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent && items.length) {
      items[items.length - 1].children += parseList(lines, i, (n) => { i = n; });
      continue;
    }
    if (/\d/.test(m[2]) !== ordered) break;
    items.push({ text: m[3], children: '' });
    i++;
  }
  setIndex(i);
  isTask = isTask && items.every(it => /^\[[ xX]\]\s/.test(it.text));
  const tag = ordered ? 'ol' : 'ul';
  const lis = items.map(it => {
    if (isTask) {
      const checked = /^\[[xX]\]/.test(it.text);
      return `<li${checked ? ' class="checked"' : ''}>${inline(it.text.replace(/^\[[ xX]\]\s+/, ''))}${it.children}</li>`;
    }
    return `<li>${inline(it.text)}${it.children}</li>`;
  }).join('');
  return `<${tag}${isTask ? ' class="checklist"' : ''}>${lis}</${tag}>`;
}

function textToHtml(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split('\n')
    .map(l => `<p>${l ? esc(l).replace(/\t/g, '    ') : '<br>'}</p>`).join('');
}

module.exports = { mdToHtml, textToHtml, esc };
