// Self-check for the code highlighter: `node scripts/check-highlight.mjs`.
// Asserts language detection on known samples and that tokens stay sorted, in range and
// non-overlapping for every language.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectLanguage, tokenize, normalizeLang, LANGUAGES, TOKEN_KINDS } from '../src/renderer/note/highlight.js';

const samples = [
  ['javascript', `import fs from 'fs';\nconst add = (a, b) => a + b;\nconsole.log(add(1, 2));`],
  ['typescript', `interface User {\n  id: number;\n  name: string;\n}\nconst greet = (u: User): string => \`hi \${u.name}\`;`],
  ['python', `def fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n\nprint(fib(10))`],
  ['sql', `SELECT u.id, u.name\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nWHERE o.total > 100\nORDER BY u.name;`],
  ['html', `<!DOCTYPE html>\n<html>\n<body>\n  <div class="card"><a href="/x">Link</a></div>\n</body>\n</html>`],
  ['css', `.card {\n  color: #333;\n  padding: 8px 12px;\n}\n@media (max-width: 600px) {\n  .card { display: none; }\n}`],
  ['json', `{\n  "name": "openstickies",\n  "version": "3.1.0",\n  "private": true,\n  "tags": ["a", "b"]\n}`],
  ['bash', `#!/usr/bin/env bash\nset -e\nfor f in *.txt; do\n  echo "$f"\ndone`],
  ['go', `package main\n\nimport "fmt"\n\nfunc main() {\n\tx := 5\n\tfmt.Println(x)\n}`],
  ['rust', `use std::collections::HashMap;\n\nfn main() {\n    let mut m = HashMap::new();\n    m.insert("a", 1);\n    println!("{:?}", m);\n}`],
  ['java', `public class Hello {\n  public static void main(String[] args) {\n    System.out.println("Hello");\n  }\n}`],
  ['csharp', `using System;\n\nclass Program {\n  static void Main() {\n    Console.WriteLine("Hi");\n  }\n}`],
  ['cpp', `#include <iostream>\nint main() {\n  std::cout << "hi" << std::endl;\n  return 0;\n}`],
  ['c', `#include <stdio.h>\nint main(void) {\n  printf("hi\\n");\n  return 0;\n}`],
  ['yaml', `name: CI\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest`],
  ['markdown', `# Title\n\nSome **bold** text and a [link](https://example.com).\n\n- [ ] todo`],
  ['xml', `<?xml version="1.0"?>\n<root>\n  <item id="1"/>\n</root>`],
  ['text', `Remember to buy milk and call mom later today.`]
];

let failed = 0;
for (const [want, code] of samples) {
  const got = detectLanguage(code);
  const ok = got.lang === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${want.padEnd(11)} -> ${got.lang} (${got.confidence})`);
}

// Tokens must be well-formed for every language, including on sample text that isn't theirs.
for (const { id } of LANGUAGES) {
  for (const [, code] of samples) {
    const toks = tokenize(code, id);
    let last = 0;
    for (const t of toks) {
      assert.ok(t.start >= last && t.end > t.start && t.end <= code.length, `${id}: bad token ${JSON.stringify(t)}`);
      assert.ok(TOKEN_KINDS.includes(t.kind), `${id}: unknown kind ${t.kind}`);
      last = t.end;
    }
  }
}

// A few spot checks on what the tokens say.
const kindAt = (code, lang, needle) => {
  const at = code.indexOf(needle);
  const t = tokenize(code, lang).find(x => x.start <= at && at < x.end);
  return t ? t.kind : null;
};
assert.equal(kindAt('const x = "hi"; // note', 'js', 'const'), 'keyword');
assert.equal(kindAt('const x = "hi"; // note', 'js', '"hi"'), 'string');
assert.equal(kindAt('const x = "hi"; // note', 'js', '// note'), 'comment');
assert.equal(kindAt('def foo(): pass', 'py', 'foo'), 'function');
assert.equal(kindAt('select * from t where id = 4', 'sql', 'from'), 'keyword');
assert.equal(kindAt('{"a": 1}', 'json', '"a"'), 'property');
assert.equal(kindAt('<a href="x">', 'html', 'href'), 'attr');
assert.equal(kindAt('.c { color: red; }', 'css', 'color'), 'property');
assert.equal(normalizeLang('JS'), 'javascript');
assert.equal(normalizeLang('c++'), 'cpp');
assert.equal(normalizeLang('<script>'), null);

// One long line must tokenize in linear time; these patterns used to rescan to the end of
// the line from every position.
const repeatTo = (unit, n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
for (const [lang, unit] of [['yaml', 'a b c d e f '], ['markdown', '[a'], ['markdown', '**a '], ['sql', '[x']]) {
  const line = repeatTo(unit, 99000);
  const t0 = performance.now();
  tokenize(line, lang);
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `${lang}: ${JSON.stringify(unit)} x 99k took ${ms.toFixed(0)} ms`);
}

// The main process can't import this ES module, so its context-menu list is a copy; keep them equal.
const menuSrc = readFileSync(new URL('../src/main/context-menu.js', import.meta.url), 'utf8');
const menuIds = [...menuSrc.matchAll(/^\s*\['([\w]+)', '([^']+)'\],?\s*(?:\/\/.*)?$/gm)].map(m => `${m[1]}:${m[2]}`);
assert.deepEqual(menuIds, LANGUAGES.map(l => `${l.id}:${l.label}`), 'CODE_LANGUAGES in context-menu.js is out of sync');

if (failed) {
  console.error(`\n${failed} detection sample(s) failed`);
  process.exit(1);
}
console.log('\nall highlight checks passed');
