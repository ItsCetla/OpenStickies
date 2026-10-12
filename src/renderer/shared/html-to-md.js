// Convert an editor DOM subtree to GitHub-flavored Markdown.
import { BLOCK_TAGS } from './sanitize.js';

const escapeMd = (s) => s.replace(/([\\`*_[\]])/g, '\\$1');

// A local path as a file:// URL. Parentheses are escaped too, so the URL can't end a Markdown link early.
export function fileUrl(path) {
  const p = String(path || '');
  const enc = (seg) => encodeURIComponent(seg).replace(/[()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  if (/^\\\\/.test(p)) {
    const [host, ...rest] = p.slice(2).split(/[\\/]/);
    return `file://${enc(host)}/${rest.map(enc).join('/')}`;
  }
  if (/^[A-Za-z]:[\\/]/.test(p)) return `file:///${p.slice(0, 2)}/${p.slice(3).split(/[\\/]/).map(enc).join('/')}`;
  return `file://${p.split('/').map(enc).join('/')}`;
}

function wrap(marker, text) {
  if (!text.trim()) return text;
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  return `${lead}${marker}${text.trim()}${marker}${trail}`;
}

function inlineOf(nodes) {
  let s = '';
  for (const c of nodes) {
    if (c.nodeType === 3) { s += escapeMd(c.data.replace(/ /g, ' ').replace(/​/g, '')); continue; }
    if (c.nodeType !== 1) continue;
    const kids = () => inlineOf(c.childNodes);
    switch (c.nodeName) {
      case 'B': case 'STRONG': s += wrap('**', kids()); break;
      case 'I': case 'EM': s += wrap('*', kids()); break;
      case 'S': case 'DEL': case 'STRIKE': s += wrap('~~', kids()); break;
      case 'U': s += `<u>${kids()}</u>`; break;
      case 'SUB': s += `<sub>${kids()}</sub>`; break;
      case 'SUP': s += `<sup>${kids()}</sup>`; break;
      case 'CODE': case 'KBD': {
        const t = c.textContent;
        const fence = t.includes('`') ? '``' : '`';
        s += `${fence}${t}${fence}`;
        break;
      }
      case 'A':
        if (c.classList.contains('file-chip') && c.getAttribute('data-path')) s += `[${escapeMd(c.textContent)}](${fileUrl(c.getAttribute('data-path'))})`;
        else s += `[${kids()}](${c.getAttribute('href') || ''})`;
        break;
      case 'IMG': s += `![${escapeMd(c.getAttribute('alt') || '')}](${c.getAttribute('src') || ''})`; break;
      case 'BR': s += '  \n'; break;
      case 'SPAN': {
        const bg = c.style && c.style.backgroundColor;
        s += bg ? wrap('==', kids()) : kids();
        break;
      }
      default:
        if (BLOCK_TAGS.has(c.nodeName)) s += '\n' + renderBlock(c) + '\n';
        else s += kids();
    }
  }
  return s;
}

function renderBlocks(nodes) {
  const blocks = [];
  let run = [];
  const flush = () => {
    const t = inlineOf(run).replace(/^\s+|\s+$/g, '');
    if (t) blocks.push(t);
    run = [];
  };
  for (const n of nodes) {
    if (n.nodeType === 1 && BLOCK_TAGS.has(n.nodeName)) {
      flush();
      const b = renderBlock(n);
      if (b) blocks.push(b);
    } else run.push(n);
  }
  flush();
  return blocks;
}

function renderBlock(el) {
  switch (el.nodeName) {
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
      return '#'.repeat(Number(el.nodeName[1])) + ' ' + inlineOf(el.childNodes).trim();
    case 'BLOCKQUOTE':
      return renderBlocks(el.childNodes).join('\n\n').split('\n').map(l => (l ? '> ' + l : '>')).join('\n');
    case 'PRE': {
      // A chosen language wins over the editor's guess; plain text gets a bare fence.
      const lang = el.getAttribute('data-lang') || el.getAttribute('data-lang-auto') || '';
      const code = el.textContent.replace(/\n$/, '');
      // The fence must be longer than any run of backticks inside the code.
      const runs = code.match(/`{3,}/g) || [];
      const fence = '`'.repeat(Math.max(3, ...runs.map(r => r.length + 1)));
      return fence + (lang === 'text' ? '' : lang) + '\n' + code + '\n' + fence;
    }
    case 'HR':
      return '---';
    case 'UL': case 'OL':
      return renderList(el, 0);
    case 'TABLE':
      return renderTable(el);
    case 'P': {
      const t = inlineOf(el.childNodes).trim();
      return t;
    }
    default:
      return renderBlocks(el.childNodes).join('\n\n');
  }
}

function renderList(list, depth) {
  const ordered = list.nodeName === 'OL';
  const check = list.classList.contains('checklist');
  let n = Number(list.getAttribute('start')) || 1;
  const pad = '    '.repeat(depth);
  const lines = [];
  for (const li of list.children) {
    if (li.nodeName === 'UL' || li.nodeName === 'OL') { lines.push(renderList(li, depth + 1)); continue; }
    if (li.nodeName !== 'LI') continue;
    const marker = ordered ? `${n++}.` : '-';
    const box = check ? (li.classList.contains('checked') ? '[x] ' : '[ ] ') : '';
    const nested = [];
    const inline = [];
    for (const c of li.childNodes) {
      if (c.nodeType === 1 && (c.nodeName === 'UL' || c.nodeName === 'OL')) nested.push(c);
      else inline.push(c);
    }
    let text = renderBlocks(inline).join(' ').replace(/\n+/g, ' ');
    // Markdown can't put a heading in a list item, so a title-styled item becomes bold.
    if (check && /\bh[1-3]\b/.test(li.className) && text && !/^\*\*.*\*\*$/.test(text)) text = `**${text}**`;
    lines.push(`${pad}${marker} ${box}${text}`);
    for (const sub of nested) lines.push(renderList(sub, depth + 1));
  }
  return lines.join('\n');
}

function renderTable(table) {
  const rows = [...table.querySelectorAll('tr')].map(tr =>
    [...tr.children].filter(c => c.nodeName === 'TD' || c.nodeName === 'TH')
      .map(c => inlineOf(c.childNodes).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()));
  if (!rows.length) return '';
  const cols = Math.max(...rows.map(r => r.length));
  const fill = (r) => Array.from({ length: cols }, (_, i) => r[i] || '');
  const line = (r) => `| ${fill(r).join(' | ')} |`;
  return [line(rows[0]), `| ${Array(cols).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

export function htmlToMarkdown(root) {
  return renderBlocks(root.childNodes).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
