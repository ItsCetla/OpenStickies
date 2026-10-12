'use strict';

// Plain-text helpers shared by the store and the HTML scanners.

function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/blockquote|\/pre|\/tr|hr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/​/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function titleFromText(text) {
  const line = String(text || '').split('\n').map(s => s.replace(/^[•\s]+/, '').trim()).find(Boolean) || '';
  return line.length > 80 ? line.slice(0, 77) + '…' : line;
}

module.exports = { htmlToText, titleFromText };
