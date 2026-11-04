// Keeps the UI's concerns apart. Plain scripts share one global scope and there's no build or linter, so this
// test is what holds the boundaries: it reads the page and the files in ui/ as text, with strings and comments
// stripped. Each concern may use only those before it in CONCERNS. Each concern's rules join this file as it moves.
//   node --test tools/test/ui-architecture.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UI = path.join(REPO, 'ui');
const PAGE = fs.readFileSync(path.join(REPO, 'discerny.html'), 'utf8');
const CORE = fs.readFileSync(path.join(UI, 'core.js'), 'utf8');

// The script files in load order, and the one stylesheet. `views` spans the four views- files.
const CONCERNS = ['core', 'files', 'model', 'ops', 'links', 'views-shell', 'views-lists', 'views-records', 'views-panel', 'render', 'input', 'main'];
const SCRIPTS = CONCERNS.map(c => `ui/${c}.js`);
const STYLESHEET = 'ui/discerny.css';

// ---------------------------------------------------------------- reading code as text

// A regular expression can only start where a value is expected.
const BEFORE_REGEX = /(^|[(,=:[!&|?{};+\-*%<>~^\n]|\b(?:return|typeof|case|in|of|delete|void|throw|new|else|do))\s*$/;

// The source with comments gone, and each string, template text and regular expression emptied. Code inside a
// template's ${...} stays, as it runs.
function codeOf(src) {
  const n = src.length;
  let i = 0;
  const quoted = (q) => { i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; return "''"; };
  const template = () => {
    let out = '`';
    i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') i += 2;
      else if (src[i] === '$' && src[i + 1] === '{') { i += 2; out += ' ' + scan(true) + ' '; }
      else i++;
    }
    i++;
    return out + '`';
  };
  const regex = () => {
    let inClass = false;
    i++;
    while (i < n && (src[i] !== '/' || inClass) && src[i] !== '\n') {
      if (src[i] === '\\') i++;
      else if (src[i] === '[') inClass = true;
      else if (src[i] === ']') inClass = false;
      i++;
    }
    i++;
    while (i < n && /[a-z]/.test(src[i])) i++;
    return "''";
  };
  // Reads code to the end, or to the brace that closes a template's ${...}.
  function scan(inTemplate) {
    let out = '', depth = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; }
      else if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; out += ' '; }
      else if (c === "'" || c === '"') out += quoted(c);
      else if (c === '`') out += template();
      else if (c === '/' && BEFORE_REGEX.test(out.slice(-12))) out += regex();
      else if (inTemplate && c === '}' && !depth) { i++; return out; }
      else { if (c === '{') depth++; else if (c === '}') depth--; out += c; i++; }
    }
    return out;
  }
  return scan(false);
}

// The names a piece of code uses: no property after a dot, and no key in an object literal.
function namesUsed(code) {
  const used = new Set();
  const space = (j, step) => { while (j >= 0 && j < code.length && /\s/.test(code[j])) j += step; return code[j]; };
  for (const m of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (m.index > 0 && /[\w$]/.test(code[m.index - 1])) continue; // the end of a number, such as 1e5
    const before = space(m.index - 1, -1), after = space(m.index + m[0].length, 1);
    if (before === '.') continue;
    if (after === ':' && (before === '{' || before === ',')) continue;
    used.add(m[0]);
  }
  return used;
}

// The names a piece of code declares anywhere: functions, parameters, catch variables and var, let and const.
// Scopes aren't followed, so a name declared in one function counts as known in all of this file.
function namesDeclared(code) {
  const known = new Set();
  const addAll = (s) => { for (const m of s.matchAll(/[A-Za-z_$][\w$]*/g)) known.add(m[0]); };
  for (const m of code.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) { if (m[1]) known.add(m[1]); addAll(m[2].replace(/=[^,]*/g, '')); }
  for (const m of code.matchAll(/\bcatch\s*\(([^)]*)\)/g)) addAll(m[1]);
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) addAll(m[1].replace(/=[^,]*/g, ''));
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) known.add(m[1]);
  for (const m of code.matchAll(/\b(?:var|let|const)\s+/g)) {
    // A name comes first and after each comma at the declaration's own depth, up to its semicolon or closing bracket.
    let depth = 0, wantName = true;
    for (let i = m.index + m[0].length; i < code.length; i++) {
      const c = code[i];
      if (wantName) {
        if (/\s/.test(c)) continue;
        wantName = false;
        if (c === '[' || c === '{') {
          let end = i, d = 0;
          do { if ('[{'.includes(code[end])) d++; else if (']}'.includes(code[end])) d--; end++; } while (d && end < code.length);
          addAll(code.slice(i, end));
          i = end - 1;
        } else {
          const name = /^[A-Za-z_$][\w$]*/.exec(code.slice(i, i + 80));
          if (name) { known.add(name[0]); i += name[0].length - 1; }
        }
      } else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (!depth) break; depth--; }
      else if (!depth && c === ';') break;
      else if (!depth && c === ',') wantName = true;
    }
  }
  return known;
}

// ---------------------------------------------------------------- the page's tags and the ui/ folder

// Each <script> and stylesheet in the page, in order: { src } for one in a file, { inline: true } for one in the page.
function pageTags(html) {
  const tags = [];
  for (const m of html.matchAll(/<script\b([^>]*)>|<link\b([^>]*)>/gi)) {
    const attrs = m[1] ?? m[2], src = /\b(?:src|href)="([^"]*)"/.exec(attrs)?.[1];
    if (m[1] !== undefined) tags.push(src ? { kind: 'script', src, attrs } : { kind: 'inline', attrs });
    else if (/\brel="stylesheet"/.test(attrs)) tags.push({ kind: 'style', src });
  }
  return tags;
}

// What's wrong with the page's tags and the folder's files; the folder holds `files`, named as ui/<name>.
function layoutProblems(html, files) {
  const out = [], tags = pageTags(html);
  const scripts = tags.filter(t => t.kind === 'script').map(t => t.src);
  const known = scripts.filter(s => SCRIPTS.includes(s));
  scripts.filter(s => !SCRIPTS.includes(s)).forEach(s => out.push(`the page loads ${s}, which isn't a concern's file`));
  if (known.join() !== SCRIPTS.filter(s => known.includes(s)).join()) out.push(`script tags out of concern order: ${known.join(', ')}`);
  if (new Set(known).size !== known.length) out.push('a script tag appears twice');
  tags.filter(t => t.kind === 'script' && /\b(type|async|defer)\b/.test(t.attrs)).forEach(t => out.push(`${t.src} isn't an ordinary script tag`));
  const styles = tags.filter(t => t.kind === 'style').map(t => t.src);
  if (styles.join() !== STYLESHEET) out.push(`the page's stylesheets should be just ${STYLESHEET}: ${styles.join(', ')}`);
  // The page's own script runs last, so it can reach everything; the theme snippet before the styles runs first.
  const lastInline = tags.map(t => t.kind).lastIndexOf('inline'), lastFile = tags.map(t => t.kind).lastIndexOf('script');
  if (lastInline >= 0 && lastFile > lastInline) out.push("a script tag comes after the page's own script");
  for (const f of files) {
    if (f !== STYLESHEET && !SCRIPTS.includes(f)) out.push(`ui/ holds an unlisted file: ${f}`);
    else if (f !== STYLESHEET && !scripts.includes(f)) out.push(`no script tag loads ${f}`);
  }
  [...scripts, ...styles].filter(s => (SCRIPTS.includes(s) || s === STYLESHEET) && !files.includes(s)).forEach(s => out.push(`the page names ${s}, which isn't there`));
  return out;
}

const uiFiles = () => fs.readdirSync(UI).map(n => 'ui/' + n);

// ---------------------------------------------------------------- core's rules

// JavaScript's own words and built-ins, which is all core may use from outside itself.
const BUILT_INS = new Set(('break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return super switch this throw true try typeof var void while with yield async await arguments ' +
  'undefined NaN Infinity Object Array String Number Boolean Symbol BigInt Math Date JSON RegExp Map Set WeakMap WeakSet Promise Error TypeError RangeError SyntaxError Intl parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI').split(' '));

// What's wrong with core's source: anything it uses from outside itself, or D beyond creating it.
function coreProblems(src) {
  const code = codeOf(src), known = namesDeclared(code), out = [];
  for (const n of namesUsed(code)) if (!known.has(n) && !BUILT_INS.has(n)) out.push(`core uses ${n}, from outside itself`);
  const creating = [...code.matchAll(/(?<![\w$.])D(?![\w$])/g)].length;
  if (creating !== 1 || !/^var D = \{ core: \{/m.test(code)) out.push(`core should use D only to create it, as var D = { core: {...} }, but mentions it ${creating} times`);
  return out;
}

// ---------------------------------------------------------------- the rules hold

test('the page loads the concerns in order, and ui/ holds only what is listed', () => {
  assert.deepEqual(layoutProblems(PAGE, uiFiles()), []);
});

test('core uses nothing outside itself, and touches no state, DOM or disk', () => {
  assert.deepEqual(coreProblems(CORE), []);
});

test('core offers only what it has, and the page reaches it through D.core', () => {
  const D = new Function(`${CORE}\n;return D;`)();
  assert.deepEqual(Object.keys(D), ['core']);
  assert.deepEqual(Object.keys(D.core).filter(k => D.core[k] === undefined), []);
  assert.equal(D.core.VERSION, /var VERSION='([^']+)'/.exec(CORE)[1]);
});

// ---------------------------------------------------------------- and the test would catch it if they didn't

const tags = (...names) => names.map(n => `<script src="ui/${n}.js"></script>`).join('\n');
const page = (body) => `<head><link rel="stylesheet" href="ui/discerny.css"><script>theme</script></head><body>${body}<script>'use strict';</script></body>`;
const listed = ['ui/core.js', 'ui/files.js', 'ui/discerny.css'];

test('layout: a good page and folder pass', () => {
  assert.deepEqual(layoutProblems(page(tags('core', 'files')), listed), []);
});

test('layout: fails when the script tags are out of concern order', () => {
  assert.match(layoutProblems(page(tags('files', 'core')), listed).join(), /out of concern order/);
});

test('layout: fails when ui/ holds an unlisted file', () => {
  assert.match(layoutProblems(page(tags('core', 'files')), [...listed, 'ui/extra.js']).join(), /unlisted file: ui\/extra\.js/);
  assert.match(layoutProblems(page(tags('core', 'files')), [...listed, 'ui/notes.md']).join(), /unlisted file: ui\/notes\.md/);
});

test('layout: fails when a listed file has no tag, or a tag names a missing or unknown file', () => {
  assert.match(layoutProblems(page(tags('core')), listed).join(), /no script tag loads ui\/files\.js/);
  assert.match(layoutProblems(page(tags('core', 'files', 'model')), listed).join(), /names ui\/model\.js/);
  assert.match(layoutProblems(page(tags('core', 'other')), ['ui/core.js', 'ui/discerny.css']).join(), /ui\/other\.js, which isn't a concern's file/);
});

test('layout: fails on a module, a deferred script, a script after the page\'s own, or a missing stylesheet', () => {
  assert.match(layoutProblems(page('<script type="module" src="ui/core.js"></script>'), ['ui/core.js', 'ui/discerny.css']).join(), /isn't an ordinary script tag/);
  assert.match(layoutProblems(page('<script defer src="ui/core.js"></script>'), ['ui/core.js', 'ui/discerny.css']).join(), /isn't an ordinary script tag/);
  assert.match(layoutProblems(`<link rel="stylesheet" href="ui/discerny.css"><script>x</script>${tags('core')}`, ['ui/core.js', 'ui/discerny.css']).join(), /comes after the page's own script/);
  assert.match(layoutProblems(tags('core'), ['ui/core.js']).join(), /stylesheets should be/);
});

const goodCore = "var D = { core: {} };\nfunction f(a) { var b = a + 1, c = Math.max(b, 2); return [b, c].map(function (x) { return x; }); }\n";

test('core: a good file passes', () => {
  assert.deepEqual(coreProblems(goodCore), []);
});

test('core: fails when it touches state, the DOM or disk, or uses anything else outside itself', () => {
  for (const use of ['S.m', 'S.view', 'document.title', 'window.innerWidth', 'location.hash', "localStorage.getItem('x')", "fetch('/x')", "fs.readFileSync('x')", "require('fs')", 'process.env', 'indexedDB.open', 'setTimeout(f)', 'console.log(1)', 'render()', 'D.model'])
    assert.ok(coreProblems(`${goodCore}function g() { return ${use}; }\n`).length, use);
});

test('core: fails when it uses D beyond creating it', () => {
  assert.match(coreProblems(`${goodCore}function g() { return D.core; }\n`).join(), /only to create it/);
  assert.match(coreProblems('function g() { return 1; }\n').join(), /only to create it/);
});

test('core: words in strings, comments, regular expressions and property names are not uses', () => {
  const quiet = [
    "var a = 'document.title and S.m';",
    'var b = "window.x";',
    '// document.title',
    '/* fetch(1) */',
    'var c = /location\\.hash[/]document/g;',
    'var d = { document: 1, window: 2 };',
    'var e = d.document + d.window;',
    'var g = `template document text`;',
  ].join('\n');
  assert.deepEqual(coreProblems(`${goodCore}${quiet}\n`), []);
});

test('core: code inside a template runs, so it counts', () => {
  assert.match(coreProblems(`${goodCore}var t = \`x \${document.title} y\`;\n`).join(), /core uses document/);
});
