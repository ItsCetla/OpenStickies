// Dependency-free syntax highlighting for code blocks.
//
// Everything here works on plain strings and never touches the DOM, so it runs the same in
// the note window and under Node (scripts/check-highlight.mjs). The editor turns the tokens
// into CSS Custom Highlight ranges, which colors the code without changing the editable DOM.

// The ids are what a code block stores in data-lang. Keep this list in step with the
// "Code language" submenu in src/main/context-menu.js.
export const LANGUAGES = [
  { id: 'text', label: 'Plain text' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'sql', label: 'SQL' },
  { id: 'html', label: 'HTML' },
  { id: 'xml', label: 'XML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
  { id: 'bash', label: 'Shell' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'java', label: 'Java' },
  { id: 'csharp', label: 'C#' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'yaml', label: 'YAML' },
  { id: 'markdown', label: 'Markdown' }
];

export const TOKEN_KINDS = ['keyword', 'string', 'number', 'comment', 'function', 'type', 'operator', 'tag', 'attr', 'punctuation', 'property'];

const IDS = new Set(LANGUAGES.map(l => l.id));

// Names people put after ``` in Markdown, mapped to our ids.
const ALIASES = {
  plain: 'text', plaintext: 'text', txt: 'text', none: 'text', nohighlight: 'text', output: 'text',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript', ecmascript: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', py3: 'python', python3: 'python', gyp: 'python',
  mysql: 'sql', postgres: 'sql', postgresql: 'sql', psql: 'sql', sqlite: 'sql', plsql: 'sql', tsql: 'sql', mssql: 'sql', pgsql: 'sql',
  htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html',
  svg: 'xml', xsl: 'xml', xslt: 'xml', plist: 'xml', rss: 'xml', atom: 'xml', xaml: 'xml', csproj: 'xml',
  scss: 'css', less: 'css', sass: 'css',
  jsonc: 'json', json5: 'json', geojson: 'json', webmanifest: 'json',
  sh: 'bash', shell: 'bash', zsh: 'bash', ksh: 'bash', console: 'bash', shellsession: 'bash', shellscript: 'bash', terminal: 'bash', fish: 'bash',
  h: 'c',
  'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', 'h++': 'cpp',
  kotlin: 'java', kt: 'java', groovy: 'java', scala: 'java',
  cs: 'csharp', 'c#': 'csharp', dotnet: 'csharp',
  golang: 'go',
  rs: 'rust',
  yml: 'yaml',
  md: 'markdown', mkd: 'markdown', mdown: 'markdown', gfm: 'markdown'
};

// A language id from a data-lang value or a Markdown info string, or null if unknown.
export function normalizeLang(value) {
  const s = String(value || '').trim().toLowerCase().split(/[\s{,]/)[0];
  if (!s) return null;
  if (IDS.has(s)) return s;
  return ALIASES[s] || null;
}

export function langLabel(id) {
  const hit = LANGUAGES.find(l => l.id === id);
  return hit ? hit.label : '';
}

// ---------- shared lexer ----------

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

function atLineStart(text, i) {
  for (let j = i - 1; j >= 0; j--) {
    const c = text[j];
    if (c === '\n') return true;
    if (c !== ' ' && c !== '\t') return false;
  }
  return true;
}

function nextNonSpace(text, i) {
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return text[i] || '';
}

function prevNonSpace(text, i) {
  let j = i - 1;
  while (j >= 0 && (text[j] === ' ' || text[j] === '\t')) j--;
  return j >= 0 ? text[j] : '';
}

function push(out, start, end, kind) {
  if (kind && end > start) out.push({ start, end, kind });
}

// Runs `rules` over text. A rule's kind is a token kind, null (consume without a token),
// or a function returning one of those, false (rule doesn't apply here) or an array of
// [from, to, kind] pieces relative to the match.
function lex(text, rules, base, out, ctx = {}) {
  const n = text.length;
  ctx.prevWord = '';
  ctx.depth = ctx.depth || 0;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    let matched = false;
    for (const rule of rules) {
      if (rule.bol && !atLineStart(text, i)) continue;
      rule.re.lastIndex = i;
      const m = rule.re.exec(text);
      if (!m || !m[0].length) continue;
      const kind = typeof rule.kind === 'function' ? rule.kind(m, i, text, ctx) : rule.kind;
      if (kind === false) continue;
      let end = i + m[0].length;
      // Pieces may claim a little past the match (a Rust macro's "!"), so skip over those too.
      if (Array.isArray(kind)) for (const [a, b, k] of kind) { push(out, base + i + a, base + i + b, k); end = Math.max(end, i + b); }
      else push(out, base + i, base + end, kind);
      ctx.prevWord = rule.word ? m[0] : '';
      i = end;
      matched = true;
      break;
    }
    if (!matched) { ctx.prevWord = ''; i++; }
  }
  return out;
}

const NUM = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)(?:[a-zA-Z_]\w*)?/y;
const IDENT = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
const OPERATOR = /[+\-*/%=<>!&|^~?:]+/y;
const PUNCT = /[{}()[\];,.@#\\]/y;
const SLASH_COMMENT = /\/\/[^\n]*/y;
const BLOCK_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/y;
const DQ = /"(?:\\.|[^"\\\n])*"?/y;
const SQ = /'(?:\\.|[^'\\\n])*'?/y;

const DEF_WORDS = words('def function func fn sub');
const CLASS_WORDS = words('class struct interface enum trait type record union impl namespace module');

// Shared word classifier: keyword, type, function name (definition or call), property, PascalCase type.
function classifier({ keywords, types = new Set(), pascalTypes = true, caseless = false, macros = false }) {
  return (m, i, text, ctx) => {
    const w = m[0];
    const key = caseless ? w.toUpperCase() : w;
    if (types.has(key)) return 'type';
    if (keywords.has(key)) return 'keyword';
    const end = i + w.length;
    if (DEF_WORDS.has(ctx.prevWord)) return 'function';
    if (CLASS_WORDS.has(ctx.prevWord)) return 'type';
    if (macros && text[end] === '!' && text[end + 1] !== '=') return [[0, w.length + 1, 'function']];
    if (nextNonSpace(text, end) === '(') return 'function';
    if (text[i - 1] === '.') return 'property';
    if (pascalTypes && /^[A-Z]/.test(w) && /[a-z]/.test(w)) return 'type';
    return null;
  };
}

// ---------- languages ----------

const JS_KEYWORDS = 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set from as true false null undefined NaN Infinity';
const TS_KEYWORDS = JS_KEYWORDS + ' interface type enum implements declare readonly abstract namespace module keyof infer is private public protected satisfies override unique asserts';

function jsRules(ts) {
  const word = classifier({ keywords: words(ts ? TS_KEYWORDS : JS_KEYWORDS), types: ts ? words('string number boolean any unknown never object bigint symbol') : new Set() });
  return [
    { re: /#![^\n]*/y, kind: (m, i) => (i === 0 ? 'comment' : false) },
    { re: SLASH_COMMENT, kind: 'comment' },
    { re: BLOCK_COMMENT, kind: 'comment' },
    { re: /`(?:\\[\s\S]|[^\\`])*`?/y, kind: 'string' },
    { re: DQ, kind: 'string' },
    { re: SQ, kind: 'string' },
    // A regex literal can only start where a value is expected.
    { re: /\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*/y, kind: (m, i, text) => (/^$|[(,=:[!&|?{};+\-*%<>~^]$/.test(prevNonSpace(text, i)) ? 'string' : false) },
    { re: /@[\w.]+/y, kind: ts ? 'attr' : false },
    { re: NUM, kind: 'number' },
    { re: IDENT, kind: word, word: true },
    { re: OPERATOR, kind: 'operator' },
    { re: PUNCT, kind: 'punctuation' }
  ];
}

const PY_RULES = (() => {
  const word = classifier({
    keywords: words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case True False None self cls print'),
    types: words('int float str bool list dict set tuple bytes object complex frozenset bytearray Exception')
  });
  return [
    { re: /#[^\n]*/y, kind: 'comment' },
    { re: /(?:[rRbBuUfF]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)/y, kind: 'string' },
    { re: /@[\w.]+/y, kind: (m, i, text) => (atLineStart(text, i) ? 'attr' : 'operator') },
    { re: NUM, kind: 'number' },
    { re: IDENT, kind: word, word: true },
    { re: OPERATOR, kind: 'operator' },
    { re: PUNCT, kind: 'punctuation' }
  ];
})();

const SQL_RULES = (() => {
  const word = classifier({
    caseless: true,
    pascalTypes: false,
    keywords: words('SELECT FROM WHERE AND OR NOT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP INDEX VIEW JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL ON AS GROUP BY ORDER HAVING LIMIT OFFSET DISTINCT UNION ALL ANY EXISTS IN IS NULL LIKE ILIKE BETWEEN CASE WHEN THEN ELSE END ASC DESC PRIMARY KEY FOREIGN REFERENCES DEFAULT UNIQUE CHECK CONSTRAINT IF BEGIN COMMIT ROLLBACK TRANSACTION WITH RECURSIVE RETURNING TRUE FALSE DATABASE SCHEMA GRANT REVOKE TRUNCATE CASCADE USING OVER PARTITION WINDOW FETCH NEXT ROWS ONLY TOP REPLACE TRIGGER PROCEDURE FUNCTION RETURNS RETURN DECLARE AUTO_INCREMENT AUTOINCREMENT ADD COLUMN RENAME TO EXCEPT INTERSECT LATERAL EXPLAIN ANALYZE VACUUM PRAGMA'),
    types: words('INT INTEGER BIGINT SMALLINT TINYINT SERIAL BIGSERIAL DECIMAL NUMERIC FLOAT REAL DOUBLE PRECISION CHAR VARCHAR NVARCHAR NCHAR TEXT DATE TIME TIMESTAMP TIMESTAMPTZ DATETIME BOOLEAN BOOL BLOB JSON JSONB UUID BYTEA INTERVAL MONEY')
  });
  return [
    { re: /--[^\n]*/y, kind: 'comment' },
    { re: /#[^\n]*/y, kind: (m, i, text) => (atLineStart(text, i) ? 'comment' : false) },
    { re: BLOCK_COMMENT, kind: 'comment' },
    { re: /[nNeE]?'(?:''|\\.|[^'\\])*'?/y, kind: 'string' },
    { re: /"(?:""|[^"\n])*"?|`[^`\n]*`?|\[[^\]\n]{1,128}\]/y, kind: 'property' },
    { re: /[@:$][\w]+/y, kind: (m, i, text) => (text[i] === ':' && text[i + 1] === ':' ? false : 'property') },
    { re: NUM, kind: 'number' },
    { re: IDENT, kind: word, word: true },
    { re: OPERATOR, kind: 'operator' },
    { re: PUNCT, kind: 'punctuation' }
  ];
})();

const CSS_RULES = (() => {
  // Inside a { } block a word followed by ":" is a property, outside it is part of a selector.
  const restOfLineOpens = (text, i) => {
    const nl = text.indexOf('\n', i);
    const line = text.slice(i, nl < 0 ? text.length : nl);
    return /\{/.test(line) || /,\s*$/.test(line);
  };
  return [
    { re: BLOCK_COMMENT, kind: 'comment' },
    { re: SLASH_COMMENT, kind: (m, i, text) => (prevNonSpace(text, i) !== ':' ? 'comment' : false) },
    { re: DQ, kind: 'string' },
    { re: SQ, kind: 'string' },
    { re: /@[\w-]+/y, kind: 'keyword' },
    { re: /!important\b/y, kind: 'keyword' },
    { re: /#[\da-fA-F]{3,8}\b/y, kind: (m, i, text, ctx) => (ctx.depth > 0 && !restOfLineOpens(text, i) ? 'number' : false) },
    { re: /-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?/y, kind: 'number' },
    { re: /[.#][\w-]+/y, kind: (m, i, text, ctx) => (ctx.depth === 0 || restOfLineOpens(text, i) ? 'type' : false) },
    { re: /::?[\w-]+/y, kind: (m, i, text, ctx) => (ctx.depth === 0 || restOfLineOpens(text, i) ? 'keyword' : false) },
    {
      re: /-{0,2}[A-Za-z_][\w-]*/y,
      kind: (m, i, text, ctx) => {
        const end = i + m[0].length;
        if (text[end] === '(') return 'function';
        const nested = restOfLineOpens(text, i);
        if (ctx.depth > 0 && !nested && nextNonSpace(text, end) === ':') return 'property';
        if (ctx.depth === 0 || nested) return 'tag';
        return null;
      }
    },
    { re: /\{/y, kind: (m, i, text, ctx) => { ctx.depth++; return 'punctuation'; } },
    { re: /\}/y, kind: (m, i, text, ctx) => { ctx.depth = Math.max(0, ctx.depth - 1); return 'punctuation'; } },
    { re: /[>+~*=|^$]+/y, kind: 'operator' },
    { re: /[;:,()[\]]/y, kind: 'punctuation' }
  ];
})();

const JSON_RULES = [
  { re: SLASH_COMMENT, kind: 'comment' },
  { re: BLOCK_COMMENT, kind: 'comment' },
  { re: DQ, kind: (m, i, text) => (nextNonSpace(text, i + m[0].length) === ':' ? 'property' : 'string') },
  { re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, kind: 'number' },
  { re: /true|false|null/y, kind: 'keyword' },
  { re: /[{}[\],:]/y, kind: 'punctuation' }
];

const BASH_RULES = (() => {
  const keywords = words('if then else elif fi for while until do done case esac function in select return local export readonly declare unset shift break continue exit source alias set trap eval exec time');
  // Commands sit at the start of a line or after a pipe/separator/keyword.
  const commandPos = (text, i, ctx) => {
    const p = prevNonSpace(text, i);
    return p === '' || p === '\n' || ';|&(`{!'.includes(p) && p !== '' ? true : keywords.has(ctx.prevWord) || ctx.prevWord === 'sudo' || ctx.prevWord === 'xargs';
  };
  return [
    { re: /#[^\n]*/y, kind: (m, i, text) => (i === 0 || /\s|;/.test(text[i - 1]) ? 'comment' : false) },
    { re: /\$'(?:\\.|[^'\\])*'?/y, kind: 'string' },
    { re: /"(?:\\[\s\S]|[^"\\])*"?/y, kind: 'string' },
    { re: /'[^']*'?/y, kind: 'string' },
    { re: /\$(?:\{[^}\n]*\}?|[A-Za-z_]\w*|[@#?*!$\-0-9])/y, kind: 'property' },
    { re: /\$\(\(?|\)\)?/y, kind: 'punctuation' },
    { re: /--?[A-Za-z][\w-]*/y, kind: (m, i, text) => (/\s/.test(text[i - 1] || '') ? 'attr' : false) },
    { re: /\d+(?![\w.-])/y, kind: 'number' },
    {
      re: /[A-Za-z_][\w.+-]*/y,
      word: true,
      kind: (m, i, text, ctx) => {
        const w = m[0];
        const end = i + w.length;
        if (text[end] === '=' && commandPos(text, i, ctx)) return 'property';
        if (keywords.has(w)) return 'keyword';
        if (text.startsWith('()', end) || /^\s*\(\)/.test(text.slice(end, end + 4))) return 'function';
        if (ctx.prevWord === 'function') return 'function';
        if (commandPos(text, i, ctx)) return 'function';
        return null;
      }
    },
    { re: /[|&;<>!=]+/y, kind: 'operator' },
    { re: /[(){}[\]]/y, kind: 'punctuation' }
  ];
})();

function cLikeRules(lang) {
  const C_KW = 'break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while true false NULL';
  const C_TY = 'char double float int long short signed unsigned void bool size_t ssize_t ptrdiff_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t uintptr_t intptr_t FILE _Bool auto';
  const spec = {
    c: { kw: C_KW, ty: C_TY, pre: true },
    cpp: {
      kw: C_KW + ' alignas alignof and auto catch class constexpr consteval constinit const_cast decltype delete dynamic_cast explicit export friend mutable namespace new noexcept not nullptr operator or private protected public reinterpret_cast static_assert static_cast template this throw try typeid typename using virtual override final co_await co_return co_yield concept requires',
      ty: C_TY.replace(' auto', '') + ' wchar_t char8_t char16_t char32_t string vector map set unordered_map unique_ptr shared_ptr',
      pre: true, raw: /R"([^(\s]{0,16})\([\s\S]*?(?:\)\1"|$)/y
    },
    java: {
      kw: 'abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try volatile while var record sealed permits yield true false null fun val when object companion data override open',
      ty: 'boolean byte char double float int long short void',
      annotations: true, textBlocks: true
    },
    csharp: {
      kw: 'abstract as base break case catch checked class const continue default delegate do else enum event explicit extern false finally fixed for foreach goto if implicit in interface internal is lock namespace new null operator out override params private protected public readonly ref return sealed sizeof stackalloc static struct switch this throw true try typeof unchecked unsafe using virtual volatile while async await var get set init record when where yield nameof partial value global required',
      ty: 'bool byte char decimal double float int long object sbyte short string uint ulong ushort void dynamic nint nuint',
      pre: true, verbatim: true
    },
    go: {
      kw: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota',
      ty: 'bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any',
      backtick: true
    },
    rust: {
      kw: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self static struct super trait true type union unsafe use where while macro_rules',
      ty: 'i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str Self',
      rust: true
    }
  }[lang];
  const word = classifier({ keywords: words(spec.kw), types: words(spec.ty), macros: !!spec.rust });
  const rules = [{ re: SLASH_COMMENT, kind: 'comment' }, { re: BLOCK_COMMENT, kind: 'comment' }];
  if (spec.pre) {
    rules.push({
      re: /#[ \t]*[a-zA-Z]+(?:([ \t]*)(<[^>\n]*>))?/y,
      bol: true,
      kind: (m) => (m[2] ? [[0, m[0].length - m[2].length, 'keyword'], [m[0].length - m[2].length, m[0].length, 'string']] : 'keyword')
    });
  }
  if (spec.raw) rules.push({ re: spec.raw, kind: 'string' });
  if (spec.textBlocks) rules.push({ re: /"""[\s\S]*?(?:"""|$)/y, kind: 'string' });
  if (spec.verbatim) rules.push({ re: /\$?@"(?:""|[^"])*"?|@\$"(?:""|[^"])*"?/y, kind: 'string' }, { re: /\$"(?:\\.|[^"\\\n])*"?/y, kind: 'string' });
  if (spec.backtick) rules.push({ re: /`[^`]*`?/y, kind: 'string' });
  if (spec.rust) {
    rules.push(
      { re: /b?r(#*)"[\s\S]*?(?:"\1|$)/y, kind: 'string' },
      { re: /b?"(?:\\[\s\S]|[^"\\])*"?/y, kind: 'string' },
      { re: /b?'(?:\\(?:x[\da-fA-F]{2}|u\{[\da-fA-F]+\}|.)|[^'\\\n])'/y, kind: 'string' },
      { re: /'[A-Za-z_]\w*/y, kind: 'type' },
      { re: /#!?\[[^\]\n]*\]?/y, kind: 'attr' }
    );
  } else {
    rules.push({ re: DQ, kind: 'string' }, { re: SQ, kind: 'string' });
  }
  if (spec.annotations) rules.push({ re: /@[A-Za-z_][\w.]*/y, kind: 'attr' });
  rules.push(
    { re: NUM, kind: 'number' },
    { re: IDENT, kind: word, word: true },
    { re: OPERATOR, kind: 'operator' },
    { re: PUNCT, kind: 'punctuation' }
  );
  return rules;
}

const YAML_RULES = (() => {
  // Only indentation and "- " list markers may come before a mapping key on its line.
  // Scans backwards and stops at the first other character, so the cost is the indent,
  // not the line (a long flow mapping would otherwise be quadratic).
  const keyPos = (text, i) => {
    for (let j = i - 1; j >= 0; j--) {
      const c = text[j];
      if (c === '\n') return true;
      if (c === '-') {
        if (!(text[j + 1] === ' ' || text[j + 1] === '\t')) return false;
      } else if (c !== ' ' && c !== '\t') return false;
    }
    return true;
  };
  const scalarEnds = (text, end) => /^[ \t]*(?:$|\n|#|,|\]|\})/.test(text.slice(end, end + 64));
  return [
    { re: /#[^\n]*/y, kind: (m, i, text) => (i === 0 || /\s/.test(text[i - 1]) ? 'comment' : false) },
    { re: /(?:---|\.\.\.)(?=[ \t]|\n|$)/y, bol: true, kind: 'punctuation' },
    { re: /-(?=[ \t]|\n|$)/y, kind: 'punctuation' },
    {
      re: /(?:"(?:\\.|[^"\\\n]){0,200}"|'(?:''|[^'\n]){0,200}'|[^\s#'"{}[\],:&*!|>-][^\n#]{0,200}?)(?=[ \t]*:(?:[ \t]|\n|$))/y,
      kind: (m, i, text) => (keyPos(text, i) ? 'property' : false)
    },
    { re: /"(?:\\.|[^"\\])*"?|'(?:''|[^'])*'?/y, kind: 'string' },
    { re: /[&*][\w-]+/y, kind: 'type' },
    { re: /!!?[\w/-]*/y, kind: 'type' },
    { re: /[|>][-+]?\d?(?=[ \t]*(?:#|\n|$))/y, kind: 'operator' },
    { re: /[-+]?(?:\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?|0x[\da-fA-F]+|\.(?:inf|nan))/y, kind: (m, i, text) => (scalarEnds(text, i + m[0].length) ? 'number' : false) },
    {
      re: /(?:true|false|yes|no|on|off|null|True|False|Yes|No|On|Off|Null|TRUE|FALSE|NULL|~)(?![\w-])/y,
      kind: (m, i, text) => (/^$|[:\-[,]$/.test(prevNonSpace(text, i)) && scalarEnds(text, i + m[0].length) ? 'keyword' : false)
    },
    { re: /[^\s:#,[\]{}]+/y, kind: null },
    { re: /[{}[\],:?]/y, kind: 'punctuation' }
  ];
})();

const MD_RULES = [
  { re: /(`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?)?(?:\n[ \t]*\1[ \t]*(?=\n|$)|$)/y, bol: true, kind: 'string' },
  { re: /#{1,6}(?=[ \t]|\n|$)[^\n]*/y, bol: true, kind: 'keyword' },
  { re: /(?:-[ \t]*){3,}(?=\n|$)|(?:\*[ \t]*){3,}(?=\n|$)|(?:_[ \t]*){3,}(?=\n|$)/y, bol: true, kind: 'punctuation' },
  { re: />[^\n]*/y, bol: true, kind: 'comment' },
  { re: /(?:[-*+]|\d{1,9}[.)])(?=[ \t])(?:[ \t]+\[[ xX]\](?=[ \t]))?/y, bol: true, kind: 'operator' },
  { re: /`+[^`\n]+?`+/y, kind: 'string' },
  { re: /<(?:https?:|mailto:)[^>\s]+>/y, kind: 'string' },
  { re: /<\/?[A-Za-z][^>\n]*>/y, kind: 'tag' },
  {
    re: /!?\[([^\]\n]{0,500})\]\(([^)\n]{0,2000})\)/y,
    kind: (m) => {
      const open = m[0].indexOf('[');
      const close = open + 1 + m[1].length;
      return [[0, open + 1, 'punctuation'], [open + 1, close, 'function'], [close, close + 2, 'punctuation'], [close + 2, close + 2 + m[2].length, 'string'], [m[0].length - 1, m[0].length, 'punctuation']];
    }
  },
  { re: /(\*\*|__)(?=\S)[^\n]{0,500}?\S\1/y, kind: (m, i, text) => (/\w/.test(text[i - 1] || '') && m[1] === '__' ? false : 'type') },
  { re: /([*_])(?=[^\s*_])[^\n*_]{0,500}?[^\s*_]\1(?!\w)/y, kind: (m, i, text) => (/\w/.test(text[i - 1] || '') ? false : 'type') },
  { re: /~~(?=\S)[^\n]{0,500}?\S~~/y, kind: 'comment' },
  { re: /[\p{L}\p{N}]+/uy, kind: null }
];

// HTML and XML: tags and attributes by hand; <script> and <style> bodies use the JS/CSS rules.
function lexMarkup(text, base, out, html) {
  const n = text.length;
  const entity = /&(?:#\d+|#x[\da-fA-F]+|[A-Za-z][\w]*);/g;
  const plain = (from, to) => {
    entity.lastIndex = from;
    let m;
    while ((m = entity.exec(text)) && m.index < to) push(out, base + m.index, base + m.index + m[0].length, 'number');
  };
  const TAG = /<(\/?)([A-Za-z][\w:.-]*)/y;
  const ATTR = /(\s*)([^\s"'>/=]+)(?:(\s*=\s*)("[^"]*"?|'[^']*'?|[^\s>]+))?/y;
  const CLOSE = /\s*(\/?>)/y;
  let i = 0;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { plain(i, n); break; }
    plain(i, lt);
    i = lt;
    const block = (open, close, kind) => {
      const end = text.indexOf(close, i + open.length);
      const stop = end < 0 ? n : end + close.length;
      push(out, base + i, base + stop, kind);
      i = stop;
    };
    if (text.startsWith('<!--', i)) { block('<!--', '-->', 'comment'); continue; }
    if (text.startsWith('<![CDATA[', i)) { block('<![CDATA[', ']]>', 'string'); continue; }
    if (/^<[!?][A-Za-z?]/.test(text.slice(i, i + 3))) { block('<', '>', 'keyword'); continue; }
    TAG.lastIndex = i;
    const t = TAG.exec(text);
    if (!t) { i++; continue; }
    push(out, base + i, base + i + 1 + t[1].length, 'punctuation');
    push(out, base + i + 1 + t[1].length, base + i + t[0].length, 'tag');
    i += t[0].length;
    let selfClosed = false;
    let closed = false;
    while (i < n) {
      CLOSE.lastIndex = i;
      const c = CLOSE.exec(text);
      if (c) {
        const s = i + c[0].length - c[1].length;
        push(out, base + s, base + i + c[0].length, 'punctuation');
        i += c[0].length;
        selfClosed = c[1] === '/>';
        closed = true;
        break;
      }
      ATTR.lastIndex = i;
      const a = ATTR.exec(text);
      if (!a || !a[0].trim()) break;
      let p = i + a[1].length;
      push(out, base + p, base + p + a[2].length, 'attr');
      p += a[2].length;
      if (a[3]) {
        push(out, base + p, base + p + a[3].length, 'operator');
        p += a[3].length;
        push(out, base + p, base + p + a[4].length, 'string');
      }
      i += a[0].length;
    }
    const name = t[2].toLowerCase();
    if (html && closed && !selfClosed && !t[1] && (name === 'script' || name === 'style')) {
      const rest = text.slice(i);
      const endTag = rest.search(new RegExp(`</${name}\\s*>`, 'i'));
      const body = endTag < 0 ? rest : rest.slice(0, endTag);
      lex(body, name === 'script' ? jsRules(false) : CSS_RULES, base + i, out);
      i += body.length;
    }
  }
  return out;
}

const RULES = {};
function rulesFor(lang) {
  if (!RULES[lang]) {
    switch (lang) {
      case 'javascript': RULES[lang] = jsRules(false); break;
      case 'typescript': RULES[lang] = jsRules(true); break;
      case 'python': RULES[lang] = PY_RULES; break;
      case 'sql': RULES[lang] = SQL_RULES; break;
      case 'css': RULES[lang] = CSS_RULES; break;
      case 'json': RULES[lang] = JSON_RULES; break;
      case 'bash': RULES[lang] = BASH_RULES; break;
      case 'yaml': RULES[lang] = YAML_RULES; break;
      case 'markdown': RULES[lang] = MD_RULES; break;
      case 'c': case 'cpp': case 'java': case 'csharp': case 'go': case 'rust': RULES[lang] = cLikeRules(lang); break;
      default: return null;
    }
  }
  return RULES[lang];
}

// Tokens for `text` as [{ start, end, kind }], sorted and non-overlapping. Unknown or
// plain-text languages give no tokens.
export function tokenize(text, lang) {
  const id = normalizeLang(lang);
  const src = String(text || '');
  if (!id || id === 'text' || !src) return [];
  if (id === 'html' || id === 'xml') return lexMarkup(src, 0, [], id === 'html');
  const rules = rulesFor(id);
  return rules ? lex(src, rules, 0, []) : [];
}

// ---------- language detection ----------

// [pattern, weight, cap]: each match adds `weight`, counted up to `cap` times.
const SIGNALS = {
  python: [
    [/^[ \t]*def [A-Za-z_]\w*\s*\(.*\)\s*(->\s*[^:]+)?:\s*$/m, 7, 3],
    [/^[ \t]*class \w+(\(.*\))?:\s*$/m, 6],
    [/^[ \t]*(from [\w.]+ import [\w*, ]+|import [\w.]+( as \w+)?(, *[\w.]+)*)\s*$/m, 4, 2],
    [/^[ \t]*(elif|except|try|finally|else|with .* as \w+)\b.*:\s*$/m, 4, 2],
    [/^[ \t]*(if|for|while) .+:\s*$/m, 3, 2],
    [/\bself\.\w+/, 3],
    [/\b(None|True|False)\b/, 1],
    [/\bprint\(/, 1],
    [/__\w+__/, 3],
    [/\blambda \w*:/, 3],
    [/f"[^"]*\{/, 2]
  ],
  javascript: [
    [/\b(const|let|var)\s+[\w${}[\], ]+\s*=/, 3, 2],
    [/=>/, 3],
    [/\bfunction\b\s*\*?\s*[\w$]*\s*\(/, 4],
    [/\bconsole\.(log|error|warn|info)\(/, 6],
    [/\bimport\s+[\w${}*, ]+\s+from\s+['"]/, 6],
    [/\b(require|import)\(['"]/, 5],
    [/\b(document|window)\.\w+/, 4],
    [/===|!==/, 3],
    [/\bmodule\.exports\b|\bexport\s+(default|const|function|class)\b/, 5],
    [/\b(async|await)\b/, 1],
    [/\bundefined\b/, 2],
    [/\.then\(|new Promise\(/, 3]
  ],
  typescript: [
    [/\b\w+\??:\s*(string|number|boolean|any|void|unknown|never)(\[\])?\b/, 5, 2],
    [/\binterface\s+\w+(<[^>]*>)?\s*(extends [\w<>, ]+)?\{/, 6],
    [/\btype\s+\w+(<[^>]*>)?\s*=/, 4],
    [/\b(readonly|private|public|protected)\s+\w+\s*[:?]/, 3],
    [/\bas\s+(const|string|number|any|unknown)\b/, 4],
    [/<\w+(\[\])?>\(/, 2],
    [/\benum\s+\w+\s*\{/, 2]
  ],
  sql: [
    [/\bSELECT\b[\s\S]+?\bFROM\b/i, 9],
    [/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(TABLE|INDEX|VIEW|DATABASE)|ALTER\s+TABLE|DROP\s+TABLE)\b/i, 9],
    [/\b(WHERE|INNER JOIN|LEFT JOIN|GROUP BY|ORDER BY|HAVING|LIMIT)\b/i, 2, 3],
    [/\b(VARCHAR|PRIMARY KEY|NOT NULL|FOREIGN KEY)\b/i, 3],
    [/^\s*--\s/m, 1]
  ],
  html: [
    [/<!DOCTYPE\s+html/i, 12],
    [/<(html|head|body|div|span|p|a|ul|ol|li|script|style|table|tr|td|img|br|input|button|section|nav|header|footer|form|label|h[1-6])\b[^>]*>/i, 5, 2],
    [/<\/(html|head|body|div|span|p|a|ul|li|script|table|section|button|h[1-6])>/i, 3, 2],
    [/\b(class|href|src|id)="[^"]*"/, 2]
  ],
  xml: [
    [/^\s*<\?xml\b/, 14],
    [/<\/?[A-Za-z][\w.-]*:[\w.-]+/, 3],
    [/<[A-Za-z][\w.-]*(\s+[\w:.-]+="[^"]*")*\s*\/>/, 2],
    [/<\/[A-Za-z][\w:.-]*>/, 2, 2]
  ],
  css: [
    [/^[ \t]*(?:[.#][\w-]+|[a-z][\w-]*[.#:[][\w-]|\*|(?:html|body|h[1-6]|p|a|div|span|ul|ol|li|img|button|input|table|nav|header|footer|main|section)[ \t]*[,{>])[^\n{};=()]*\{[ \t]*$/m, 3, 3],
    [/^[ \t]*-{0,2}[a-z-]+\s*:\s*[^;{}()\n]+(\([^)]*\))?[^;{}\n]*;\s*$/m, 3, 3],
    [/@(media|import|keyframes|font-face|supports|layer|tailwind)\b/, 6],
    [/#[0-9a-f]{3,8}\b/i, 1],
    [/\b\d+(\.\d+)?(px|em|rem|vh|vw)\b/, 2],
    [/\b(color|margin|padding|display|font-size|background)\s*:/, 3]
  ],
  json: [
    [/^\s*[{[]/, 2],
    [/"[^"\n]*"\s*:\s*["{[\d\-tfn]/, 4, 2]
  ],
  bash: [
    [/^\s*\$ \w/m, 5],
    [/^[ \t]*(sudo|echo|cd|ls|grep|apt(-get)?|brew|npm|npx|yarn|pnpm|pip3?|git|curl|wget|chmod|chown|export|mkdir|rm|cp|mv|cat|docker|kubectl|ssh|tar|make|source)\b/m, 3, 3],
    [/\$\{?[A-Za-z_]\w*\}?/, 2],
    [/^[ \t]*(fi|done|esac)\s*$/m, 6],
    [/^[ \t]*(if|elif) \[\[? /m, 5],
    [/\s\|\s*(grep|sed|awk|xargs|sort|head|tail|wc)\b/, 4],
    [/\s--?[a-z][\w-]*/, 1],
    [/\s&&\s/, 1],
    [/\s2?>\s*\/dev\/null/, 4]
  ],
  c: [
    [/^\s*#\s*include\s*[<"]/m, 7],
    [/\b(printf|scanf|fprintf|malloc|free|sizeof|memcpy|strlen)\s*\(/, 4],
    [/\bint\s+main\s*\(/, 4],
    [/\bstruct\s+\w+\s*\{/, 2],
    [/->/, 1],
    [/\b(uint\d+_t|size_t)\b/, 2]
  ],
  cpp: [
    [/^\s*#\s*include\s*[<"]/m, 7],
    [/\bstd::/, 8],
    [/\b(cout|cin|cerr)\s*(<<|>>)/, 6],
    [/\btemplate\s*</, 6],
    [/#include\s*<(iostream|vector|string|map|memory|algorithm)>/, 6],
    [/\b(nullptr|constexpr|namespace|using namespace)\b/, 4],
    [/\b(public|private|protected):/, 4],
    [/\w::\w/, 2]
  ],
  java: [
    [/\bpublic\s+static\s+void\s+main\s*\(/, 10],
    [/\bSystem\.(out|err)\.print(ln|f)?\(/, 10],
    [/\b(public|private|protected)\s+(static\s+)?(final\s+)?[\w<>[\]]+\s+\w+\s*\(/, 4],
    [/^\s*import\s+(java|javax|org|com)\.[\w.*]+;\s*$/m, 9],
    [/^\s*package\s+[\w.]+;\s*$/m, 8],
    [/@(Override|Test|Autowired|Deprecated)\b/, 6],
    [/\b(extends|implements)\s+\w+/, 2],
    [/\bString\[\]/, 3],
    [/\bfinal\s+\w+/, 1]
  ],
  csharp: [
    [/^\s*using\s+System(\.[\w.]+)?;\s*$/m, 10],
    [/^\s*using\s+[\w.]+;\s*$/m, 4],
    [/\bConsole\.(WriteLine|Write|ReadLine)\(/, 10],
    [/\{\s*get;\s*(private\s+|init;\s*)?(set;)?\s*\}/, 9],
    [/\bnamespace\s+[\w.]+/, 3],
    [/\basync\s+Task\b/, 6],
    [/\b(public|private|internal)\s+(static\s+)?(string|bool|int|void)\s+\w+/, 3],
    [/\bvar\s+\w+\s*=\s*new\b/, 2],
    [/\$"[^"]*\{/, 3]
  ],
  go: [
    [/^package\s+\w+\s*$/m, 8],
    [/\bfunc\s+(\([^)]*\)\s*)?\w+\s*\(/, 8],
    [/:=/, 3],
    [/\bfmt\.\w+\(/, 8],
    [/^import\s*\(/m, 6],
    [/\b(chan|defer|go func)\b/, 4],
    [/\berr\s*!=\s*nil\b/, 8]
  ],
  rust: [
    [/\bfn\s+\w+(<[^>]*>)?\s*\(/, 6],
    [/\blet\s+mut\b/, 8],
    [/\b(println|print|format|vec|panic|assert_eq|eprintln)!\s*[([]/, 7],
    [/^\s*use\s+(std|crate|super|self)::/m, 8],
    [/\b(impl|trait)\s+[\w<>]+/, 4],
    [/\bpub\s+(fn|struct|enum|mod)\b/, 5],
    [/&(mut\s+)?(str|self)\b/, 5],
    [/\b(Some|None|Ok|Err)\b/, 1],
    [/\bmatch\s+\w+\s*\{/, 3],
    [/->\s*(Self|Result|Option|[iu]\d+|bool|String)\b/, 3]
  ],
  yaml: [
    [/^---\s*$/m, 3],
    [/^[ \t]*-?[ \t]*[\w.-]+:[ \t]+[^\s{;(][^;{}()]*$/m, 2, 6],
    [/^[ \t]*[\w.-]+:\s*$/m, 2, 3],
    [/^[ \t]*- [\w"']/m, 1]
  ],
  markdown: [
    [/^#{1,6} \S/m, 3, 3],
    [/\[[^\]\n]+\]\([^)\n]+\)/, 5],
    [/\*\*[^*\n]+\*\*/, 3],
    [/^```/m, 6],
    [/^> \S/m, 2],
    [/^\s*[-*] \[[ xX]\] /m, 6],
    [/^\s*[-*+] \S/m, 1, 3],
    [/^\s*\d+\. \S/m, 1, 2]
  ]
};

function count(re, text, cap) {
  if (cap <= 1) return re.test(text) ? 1 : 0;
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  let n = 0;
  for (const _ of text.matchAll(new RegExp(re.source, flags))) { if (++n >= cap) break; }
  return n;
}

// Best guess at the language of a snippet: { lang, confidence 0..1 }. Returns 'text' when
// nothing stands out, so prose in a code block stays uncolored.
export function detectLanguage(text) {
  const src = String(text || '').slice(0, 5000);
  const trimmed = src.trim();
  if (!trimmed) return { lang: 'text', confidence: 0 };

  const first = trimmed.split('\n', 1)[0];
  const bang = /^#!.*?\b(bash|sh|zsh|ksh|dash|python[\d.]*|node|deno|bun)\b/.exec(first);
  if (bang) {
    const b = bang[1];
    return { lang: /^python/.test(b) ? 'python' : /^(node|deno|bun)$/.test(b) ? 'javascript' : 'bash', confidence: 1 };
  }

  const scores = {};
  for (const [lang, signals] of Object.entries(SIGNALS)) {
    let s = 0;
    for (const [re, weight, cap = 1] of signals) s += weight * count(re, src, cap);
    scores[lang] = s;
  }

  // TypeScript is JavaScript plus types: it only wins with type annotations.
  scores.typescript = scores.typescript > 0 ? scores.typescript + scores.javascript : 0;
  // C++ shares C's #include; without C++-only signs it is plain C.
  if (scores.cpp <= 7) scores.cpp = 0;
  if (/^[{[]/.test(trimmed) && /[}\]]$/.test(trimmed) && trimmed.length < 200000) {
    try { JSON.parse(trimmed); scores.json += 14; } catch { /* not strict JSON */ }
  }
  // Markup languages look alike: real HTML tags push toward HTML, everything else toward XML.
  if (scores.xml && scores.html >= 5 && !/^\s*<\?xml/.test(src)) scores.xml = Math.min(scores.xml, scores.html - 1);
  // A file full of "key: value" lines that also has braces or semicolons isn't YAML.
  if (/[{};]\s*$/m.test(src)) scores.yaml = Math.floor(scores.yaml / 3);

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, top] = ranked[0];
  const second = ranked[1] ? ranked[1][1] : 0;
  if (top < 3) return { lang: 'text', confidence: 0 };
  const confidence = Math.round((top / (top + second + 2)) * 100) / 100;
  return { lang: best, confidence };
}
