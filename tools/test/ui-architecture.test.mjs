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
// template's ${...} stays, as it runs. With keepStrings, strings and template text stay, for reading hook names and markup.
function codeOf(src, { keepStrings = false } = {}) {
  const n = src.length;
  let i = 0;
  const quoted = (q) => { const from = i; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; return keepStrings ? src.slice(from, i) : "''"; };
  const template = () => {
    let out = '`';
    i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { if (keepStrings) out += src.slice(i, i + 2); i += 2; }
      else if (src[i] === '$' && src[i + 1] === '{') { i += 2; out += ' ' + scan(true) + ' '; }
      else { if (keepStrings) out += src[i]; i++; }
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

// The names declared at the top level of a piece of code, with nothing from inside a bracket.
function namesAtTopLevel(code) {
  let depth = 0, outer = '';
  for (const c of code) {
    if ('([{'.includes(c)) { if (!depth) outer += c; depth++; }
    else if (')]}'.includes(c)) { depth--; if (!depth) outer += c; }
    else if (!depth) outer += c;
  }
  assert.equal(depth, 0, 'brackets should balance, or the code was misread');
  return namesDeclared(outer);
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

// ---------------------------------------------------------------- rules for every moved concern

// A file's concern: the views- files are all one.
const concernOf = (file) => path.basename(file, '.js').replace(/^views-.*/, 'views');
const ORDER = ['core', 'files', 'model', 'ops', 'links', 'views', 'render', 'input', 'main'];
const movedScripts = () => SCRIPTS.filter(f => fs.existsSync(path.join(REPO, f)));
const readRepo = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

// The page's own script, in the body: what's left of the UI until every concern has moved. The theme snippet in the head is not part of it.
function inlineScript(html) {
  const body = html.slice(html.indexOf('<body'));
  return [...body.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
}

// A concern uses only the namespaces before it, and assigns only to its own.
function namespaceProblems(concern, src) {
  const out = [], at = ORDER.indexOf(concern);
  for (const m of codeOf(src).matchAll(/(?<![\w$.])D\.([A-Za-z_$][\w$]*)(\.[A-Za-z_$][\w$]*)?(\s*=(?!=))?/g)) {
    if (ORDER.indexOf(m[1]) > at || ORDER.indexOf(m[1]) < 0) out.push(`${concern} uses D.${m[1]}, which comes after it`);
    if (m[3] && m[1] !== concern) out.push(`${concern} assigns to D.${m[1]}${m[2] || ''}, another concern's namespace`);
  }
  return out;
}

// A moved concern calling a function still in the page's own script would be leaning on code that hasn't moved.
function inlineCallProblems(concern, src, inline) {
  const code = codeOf(src), out = [];
  for (const n of namesAtTopLevel(codeOf(inline))) {
    if (new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}\\s*\\(`).test(code)) out.push(`${concern} calls ${n}() bare, from the page's own script`);
  }
  return out;
}

// Strings that start a tag: building markup, which only the views do.
function markupProblems(concern, src) {
  return [...codeOf(src, { keepStrings: true }).matchAll(/(['"`])\s*<\/?[A-Za-z][^'"`]{0,30}/g)].map(m => `${concern} builds markup: ${m[0]}`);
}

// A local D would hide the namespace, in the concern's files and in the page's own script alike.
function shadowProblems(where, src) {
  return namesDeclared(codeOf(src)).has('D') ? [`${where} declares a local D, which hides the namespace`] : [];
}

// Call sites name what they use in full. The one alias a file may have is var S = D.model.S.
function aliasProblems(where, src) {
  const out = [];
  for (const m of codeOf(src).matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(D\.[a-z]+\.[A-Za-z_$][\w$]*)\s*[;,\n]/g)) {
    if (m[1] !== 'S' || m[2] !== 'D.model.S') out.push(`${where} aliases ${m[2]} as ${m[1]}`);
  }
  return out;
}

// ---------------------------------------------------------------- files's rules

// What files may use from the browser, beyond JavaScript's own built-ins. `get` is the word in its accessors.
const FILES_BROWSER = new Set(['D', 'get', 'fetch', 'indexedDB', 'setTimeout', 'clearTimeout', 'console']);

// What's wrong with files's source: anything from outside itself and core, any mention of state or Items, or the DOM.
function filesProblems(src, core = CORE) {
  const code = codeOf(src), out = [];
  const known = new Set([...namesDeclared(code), ...namesAtTopLevel(codeOf(core))]);
  for (const n of namesUsed(code)) if (!known.has(n) && !BUILT_INS.has(n) && !FILES_BROWSER.has(n)) out.push(`files uses ${n}, from outside itself and core`);
  for (const [what, re] of [['S.', /(?<![\w$.])S\./], ['OPS', /(?<![\w$.])OPS\b/], ['.items', /\.items\b/], ['.meta', /\.meta\b/], ['.people', /\.people\b/], ['document', /(?<![\w$.])document\b/], ['window', /(?<![\w$.])window\b/], ['location', /(?<![\w$.])location\b/]]) {
    if (re.test(code)) out.push(`files mentions ${what}`);
  }
  return out;
}

// ---------------------------------------------------------------- model's rules

// What model may use beyond itself, core and JavaScript's own built-ins: its one word from the browser is localStorage, for the User's preferences.
const MODEL_BROWSER = new Set(['D', 'get', 'localStorage']);

// What's wrong with model's source: anything from outside itself and core, the DOM, markup, or reaching files for anything but its hook.
function modelProblems(src, core = CORE) {
  const code = codeOf(src), out = [];
  const known = new Set([...namesDeclared(code), ...namesAtTopLevel(codeOf(core))]);
  for (const n of namesUsed(code)) if (!known.has(n) && !BUILT_INS.has(n) && !MODEL_BROWSER.has(n)) out.push(`model uses ${n}, from outside itself and core`);
  const used = namesUsed(code);
  for (const what of ['document', 'window', 'location', 'OPS']) if (used.has(what)) out.push(`model mentions ${what}`);
  for (const m of code.matchAll(/(?<![\w$.])D\.files\.([A-Za-z_$][\w$]*)/g)) if (m[1] !== 'install') out.push(`model reaches D.files.${m[1]}: it never changes files`);
  return out.concat(markupProblems('model', src));
}

// ---------------------------------------------------------------- ops's rules

// What ops may use from the browser, beyond itself, core and JavaScript's own built-ins: its timers, for toasts and rereading a file, and the console.
const OPS_BROWSER = new Set(['D', 'setTimeout', 'console']);

// What's wrong with ops's source: anything from outside itself and core, the DOM or location, or markup.
function opsProblems(src, core = CORE) {
  const code = codeOf(src), out = [];
  const known = new Set([...namesDeclared(code), ...namesAtTopLevel(codeOf(core))]);
  const used = namesUsed(code);
  for (const n of used) if (!known.has(n) && !BUILT_INS.has(n) && !OPS_BROWSER.has(n)) out.push(`ops uses ${n}, from outside itself and core`);
  return out.concat(markupProblems('ops', src));
}

// ---------------------------------------------------------------- links's rules

// What links may use from the browser, beyond itself, core and JavaScript's own built-ins: reading and writing the hash, and nothing else of the address.
const LINKS_BROWSER = new Set(['D', 'location']);

// What's wrong with links's source: anything from outside itself and core, which is how it would navigate or use the DOM; ops; any other use of the address; or markup.
function linksProblems(src, core = CORE) {
  const code = codeOf(src), out = [];
  const known = new Set([...namesDeclared(code), ...namesAtTopLevel(codeOf(core))]);
  for (const n of namesUsed(code)) if (!known.has(n) && !BUILT_INS.has(n) && !LINKS_BROWSER.has(n)) out.push(`links uses ${n}, from outside itself and core`);
  if (/(?<![\w$.])D\.ops\b/.test(code)) out.push('links uses D.ops: it never changes Items');
  if (/(?<![\w$.])location\b(?!\s*\.\s*(?:hash|replace)\b)/.test(code)) out.push('links uses location for more than the hash');
  return out.concat(markupProblems('links', src));
}

// ---------------------------------------------------------------- views's rules

// The four files of the views, which are one concern.
const VIEW_FILES = SCRIPTS.filter(f => concernOf(f) === 'views');

// What a piece of code does to a value it should only read: assigning to it, or a method that changes it. `root` is a pattern for the value, and `bare` allows it with no member after it.
function changesTo(code, root) {
  const member = String.raw`(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])`;
  return [
    new RegExp(String.raw`${root}${member}+\s*(?:=(?!=)|\+\+|--|[-+*/%]=|\|\|=|&&=|\?\?=)`),
    new RegExp(String.raw`${root}${member}*\.(?:push|pop|shift|unshift|splice|sort|reverse|fill|add|delete|clear|set)\s*\(`),
    new RegExp(String.raw`(?:\+\+|--|\bdelete\s)\s*${root}\b`),
  ].some(re => re.test(code));
}

// What's wrong with a views file: anything from outside itself and core, which is how it would reach the DOM, fetch or the page's script; ops; files beyond Q and srv; or changing app state.
function viewsProblems(src, core = CORE) {
  const code = codeOf(src), out = [];
  const known = new Set([...namesDeclared(code), ...namesAtTopLevel(codeOf(core)), 'D']);
  for (const n of namesUsed(code)) if (!known.has(n) && !BUILT_INS.has(n)) out.push(`views uses ${n}, from outside itself and core`);
  if (/(?<![\w$.])D\.ops\b/.test(code)) out.push('views uses D.ops: drawing never changes anything');
  for (const m of code.matchAll(/(?<![\w$.])D\.files\.([A-Za-z_$][\w$]*)/g)) if (m[1] !== 'Q' && m[1] !== 'srv') out.push(`views reaches D.files.${m[1]}: it reads only Q and srv`);
  const held = { S: String.raw`(?<![\w$.])(?:D\.model\.)?S`, 'D.files.Q': String.raw`(?<![\w$.])D\.files\.Q`, 'D.links.nav': String.raw`(?<![\w$.])D\.links\.nav`, 'D.model.forced': String.raw`(?<![\w$.])D\.model\.forced` };
  for (const [what, root] of Object.entries(held)) if (changesTo(code, root)) out.push(`views changes ${what}: it only reads app state`);
  for (const m of code.matchAll(/(?<![\w$.])D\.(?:model\.(?:lsSet|forceClear|setSettings)|links\.syncLink)\b/g)) out.push(`views calls ${m[0]}, which changes app state`);
  return out;
}

// The names a views file offers: those in its D.views = {...} or Object.assign(D.views, {...}).
function viewsOffers(src) {
  const m = /D\.views = \{([\s\S]*?)\};|Object\.assign\(D\.views, \{([\s\S]*?)\}\);/.exec(codeOf(src));
  return m ? [...(m[1] ?? m[2]).matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map(x => x[1]) : null;
}

// ---------------------------------------------------------------- render's rules

// What render may use from the browser, beyond itself, core and JavaScript's own built-ins. `get` is the word in its accessor.
const RENDER_BROWSER = new Set(['D', 'get', 'document', 'window', 'requestAnimationFrame', 'console']);

// What's wrong with render's source: anything from outside itself and core, or knowing what a View means.
function renderProblems(src, core = CORE) {
  const code = codeOf(src), out = [];
  const known = new Set([...namesDeclared(code), ...namesAtTopLevel(codeOf(core))]);
  for (const n of namesUsed(code)) if (!known.has(n) && !BUILT_INS.has(n) && !RENDER_BROWSER.has(n)) out.push(`render uses ${n}, from outside itself and core`);
  for (const [what, re] of [['S.view', /(?<![\w$.])S\.view\b/], ['item(', /(?<![\w$])item\s*\(/], ['inboxCount', /\binboxCount\b/]]) if (re.test(code)) out.push(`render mentions ${what}: it never knows what a View means`);
  if (codeOf(src, { keepStrings: true }).includes('data-row')) out.push('render mentions data-row: it never knows what a View means');
  return out;
}

// Only render puts markup on the page.
function innerHtmlProblems(where, src) {
  return /\.\s*(?:innerHTML|outerHTML)\s*=(?!=)|\.\s*insertAdjacentHTML\s*\(/.test(codeOf(src)) ? [`${where} writes markup to the page, which only render does`] : [];
}

// ---------------------------------------------------------------- input's rules

// What input may use from the browser, beyond itself, core and JavaScript's own built-ins: the page and the address, timers, the clipboard, and setThemeColor from the page's head.
const INPUT_BROWSER = new Set(['D', 'document', 'window', 'location', 'navigator', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'console', 'setThemeColor']);

// What's wrong with input's source: anything from outside itself and core, which is how it would lean on the page's script or reach the folder without files; or markup.
function inputProblems(src, core = CORE) {
  const code = codeOf(src), out = [];
  const known = new Set([...namesDeclared(code), ...namesAtTopLevel(codeOf(core))]);
  for (const n of namesUsed(code)) if (!known.has(n) && !BUILT_INS.has(n) && !INPUT_BROWSER.has(n)) out.push(`input uses ${n}, from outside itself and core`);
  return out.concat(markupProblems('input', src));
}

// ---------------------------------------------------------------- the hooks

// The whole set. A new hook needs a row here and in files's registry; if the need can be met by moving code, move the code.
const HOOK_TABLE = {
  redraw: { firedBy: ['files', 'ops'], installedBy: 'render' },
  toast: { firedBy: ['files'], installedBy: 'ops' },
  runJob: { firedBy: ['files'], installedBy: 'ops' },
  afterJob: { firedBy: ['files'], installedBy: 'ops' },
  folderState: { firedBy: ['files'], installedBy: 'model' },
  afterDraw: { firedBy: ['render'], installedBy: 'input' },
};
const PAGE_OWN = 'page'; // the page's own script could install what hasn't moved, so it's held only to the table's names and the one-installer rule

// Each install(...) and fire(...) call in a source, with the hook's name; a name that isn't a plain string comes back as null.
function hookCalls(src) {
  const code = codeOf(src, { keepStrings: true });
  return [...code.matchAll(/(?<![\w$.])(?:(function)\s+)?(?:D\.files\.)?(install|fire)\s*\(\s*(?:'([^']*)'|"([^"]*)")?/g)]
    .filter(m => !m[1])
    .map(m => ({ call: m[2], name: m[3] ?? m[4] ?? null }));
}

// What's wrong with the hooks across every source, each { concern, src }. Once main has landed, every hook has an installer.
function hookProblems(sources, { mainLanded = false } = {}) {
  const out = [], installs = {};
  for (const { concern, src } of sources) {
    for (const { call, name } of hookCalls(src)) {
      const row = Object.hasOwn(HOOK_TABLE, name ?? '') ? HOOK_TABLE[name] : null;
      if (!row) { out.push(`${concern} calls ${call} with ${name === null ? 'a name that is not a plain string' : `${name}, which isn't in the table`}`); continue; }
      if (call === 'install') {
        (installs[name] ||= []).push(concern);
        if (concern !== PAGE_OWN && row.installedBy !== concern) out.push(`${concern} installs ${name}, which is ${row.installedBy}'s to install`);
      } else if (concern !== PAGE_OWN && !row.firedBy.includes(concern)) out.push(`${concern} fires ${name}, which only ${row.firedBy.join(' and ')} may fire`);
    }
  }
  for (const [name, who] of Object.entries(installs)) if (who.length > 1) out.push(`${name} is installed more than once: ${who.join(', ')}`);
  if (mainLanded) for (const name of Object.keys(HOOK_TABLE)) if (!installs[name]) out.push(`${name} has no installer`);
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

test('the page\'s own script is read whole, or the bare-call rule would miss what is in it', () => {
  const names = namesAtTopLevel(codeOf(inlineScript(PAGE)));
  for (const n of ['S', 'boot']) assert.ok(names.has(n), n);
  assert.equal(names.has('ev'), false, 'a parameter inside the script is not at its top level');
  assert.equal(names.has('setThemeColor'), false);
});

test('every moved concern uses only those before it, and calls nothing bare from the page\'s own script', () => {
  for (const f of movedScripts().filter(f => f !== 'ui/core.js')) {
    assert.deepEqual(namespaceProblems(concernOf(f), readRepo(f)), [], f);
    assert.deepEqual(inlineCallProblems(concernOf(f), readRepo(f), inlineScript(PAGE)), [], f);
  }
});

test('files uses only core, and knows nothing of Items, state or the DOM', () => {
  assert.deepEqual(filesProblems(readRepo('ui/files.js')), []);
});

test('model uses only core and its hook, never changes files, never uses DOM APIs and never builds markup', () => {
  assert.deepEqual(modelProblems(readRepo('ui/model.js')), []);
});

test('ops uses only the concerns before it, never builds markup and never uses DOM APIs or location', () => {
  assert.deepEqual(opsProblems(readRepo('ui/ops.js')), []);
});

test('links uses only the concerns before it, never calls ops, never navigates and never builds markup', () => {
  assert.deepEqual(linksProblems(readRepo('ui/links.js')), []);
});

test('views reads model and links, and files only for Q and srv, and never assigns to app state or uses ops, DOM APIs or fetch', () => {
  assert.equal(VIEW_FILES.length, 4);
  for (const f of VIEW_FILES) assert.deepEqual(viewsProblems(readRepo(f)), [], f);
});

test('the first views file creates D.views, the others add to it, and no name is offered twice', () => {
  const offers = VIEW_FILES.map(f => viewsOffers(readRepo(f)));
  offers.forEach((o, i) => assert.ok(o && o.length, VIEW_FILES[i]));
  assert.match(codeOf(readRepo(VIEW_FILES[0])), /D\.views = \{/);
  for (const f of VIEW_FILES.slice(1)) assert.match(codeOf(readRepo(f)), /Object\.assign\(D\.views, \{/, f);
  const all = offers.flat();
  assert.deepEqual(all.filter((n, i) => all.indexOf(n) !== i), []);
});

test('render uses only the concerns before it, and never knows what a View means', () => {
  assert.deepEqual(renderProblems(readRepo('ui/render.js')), []);
});

test('no concern but render writes markup to the page', () => {
  const sources = movedScripts().filter(f => f !== 'ui/render.js').map(f => [f, readRepo(f)]).concat([['the page', inlineScript(PAGE)]]);
  for (const [where, src] of sources) assert.deepEqual(innerHtmlProblems(where, src), []);
  assert.match(codeOf(readRepo('ui/render.js')), /\.innerHTML\s*=/);
});

test('input uses only the concerns before it, and never builds markup', () => {
  assert.deepEqual(inputProblems(readRepo('ui/input.js')), []);
});

test('input has left the page, whose listeners reach it through D.input', () => {
  const inline = inlineScript(PAGE), names = namesAtTopLevel(codeOf(inline));
  for (const n of ['ACT', 'CH', 'IN', 'SUB', 'KD', 'onKey', 'go', 'goAny', 'select', 'closePanel', 'rowIds', 'neighbour', 'moveCursor', 'targetId', 'toggleDone', 'accept', 'addQuick', 'addPrjFrom', 'addTagFrom', 'openPalette', 'closeDialog', 'poll', 'regainAccess', 'retrySave', 'openState', 'openLink', 'land', 'pickFolder', 'changeFolder', 'regrant', 'openFolder', 'startTimers', 'setWb', 'loadFolderSugs']) assert.equal(names.has(n), false, n);
  assert.deepEqual([...names].sort(), ['S', 'boot'], 'only start-up is left');
  for (const n of ['ACT', 'CH', 'IN', 'SUB', 'onKey', 'land', 'openFolder']) assert.match(codeOf(inline), new RegExp(`D\\.input\\.${n}\\b`), n);
  assert.deepEqual(hookCalls(inline), [], 'the page installs no hook now');
  assert.deepEqual(hookCalls(readRepo('ui/input.js')), [{ call: 'install', name: 'afterDraw' }]);
});

test('the views and render have left the page, whose callers in input and start-up reach them through D.views and D.render', () => {
  const inline = inlineScript(PAGE), names = namesAtTopLevel(codeOf(inline));
  for (const n of ['prioMark', 'scoreCell', 'scoreFact', 'prioToggle', 'esc', 'bt', 'ic', 'vRow', 'vSec', 'viewToday', 'viewInbox', 'viewAll', 'viewDone', 'vChange', 'viewProject', 'viewPeople', 'viewReview', 'viewClaude', 'vPanel', 'panelTask', 'vSide', 'vMain', 'viewFor', 'vPalette', 'vGate', 'vApp', 'keyOf', 'morphNode', 'morphChildren', 'renderQ', 'measure', 'render', 'renderNow', 'afterRender', 'focusLater']) assert.equal(names.has(n), false, n);
  const input = codeOf(readRepo('ui/input.js'));
  assert.match(input, /D\.views\.viewFor\(/);
  assert.match(input, /D\.render\.render\(/);
  assert.match(input, /D\.render\.focusLater\(/);
  assert.match(codeOf(inline), /D\.render\.measure\(/);
});

test('the Link code has left the page, whose callers reach it through D.links', () => {
  const inline = inlineScript(PAGE), names = namesAtTopLevel(codeOf(inline));
  for (const n of ['LINK_VIEW', 'VIEW_LINK', 'RECORD_VIEW', 'stateKey', 'ENT_Q', 'LINK_STATE', 'TAB_LINK', 'linkValue', 'linkQuery', 'stateOfHash', 'linkItem', 'linkNow', 'linkOfHash', 'mergedInto', 'idShaped', 'linkText', 'missingId', 'linkResult', 'syncLink', 'search', 'linkPush', 'hashOwn', 'landing', 'autoOpen', 'offView']) assert.equal(names.has(n), false, n);
  assert.match(codeOf(readRepo('ui/views-shell.js')), /D\.links\.search\(/);
  assert.match(codeOf(inline), /D\.links\.nav\.hashOwn/);
});

test('no local D hides the namespace, and S is the only alias, in any moved concern or the page\'s own script', () => {
  const sources = movedScripts().filter(f => f !== 'ui/core.js').map(f => [f, readRepo(f)]).concat([['the page', inlineScript(PAGE)]]);
  for (const [where, src] of sources) {
    assert.deepEqual(shadowProblems(where, src), []);
    assert.deepEqual(aliasProblems(where, src), []);
  }
});

test('the hooks keep to the table: who fires each, who installs each, and one installer', () => {
  const sources = movedScripts().map(f => ({ concern: concernOf(f), src: readRepo(f) })).concat({ concern: PAGE_OWN, src: inlineScript(PAGE) });
  assert.deepEqual(hookProblems(sources, { mainLanded: fs.existsSync(path.join(UI, 'main.js')) }), []);
});

test('files\'s registry names exactly the hooks in the table', () => {
  const m = /var HOOKS = \{([^}]*)\}/.exec(codeOf(readRepo('ui/files.js')));
  assert.ok(m, 'files declares HOOKS');
  assert.deepEqual([...m[1].matchAll(/([A-Za-z]+)\s*:/g)].map(x => x[1]).sort(), Object.keys(HOOK_TABLE).sort());
});

// ---------------------------------------------------------------- files as it runs

const FORMAT_NOW = /var FORMAT='([^']+)'/.exec(CORE)[1];

// A fresh copy of files with its hooks recorded, over a fake folder. A hook's behaviour can be set in `does`.
function loadFiles({ fetch: fakeFetch, does = {}, folder = { 'DISCERNY.md': `<!-- format: ${FORMAT_NOW} -->\n` } } = {}) {
  const timers = [], events = [];
  const load = new Function('fetch', 'setTimeout', 'clearTimeout', 'console', `${CORE}\n${readRepo('ui/files.js')}\n;return D;`);
  const D = load(fakeFetch, (f, ms) => { timers.push({ f, ms }); return timers.length; }, () => {}, { error() {} });
  for (const name of ['redraw', 'toast', 'runJob', 'afterJob', 'folderState', 'afterDraw']) {
    D.files.install(name, (arg) => { events.push(arg === undefined ? name : [name, arg]); return does[name] && does[name](arg, D); });
  }
  const notThere = () => { const e = new Error('not there'); e.name = 'NotFoundError'; return e; };
  D.files.useFolder({
    name: 'folder',
    getFileHandle: async (n) => { if (!(n in folder)) throw notThere(); return { getFile: async () => ({ lastModified: 7, text: async () => folder[n] }) }; },
  });
  return { D, F: D.files, Q: D.files.Q, events, timers, folder };
}
const named = (name) => { const e = new Error(name + ' happened'); e.name = name; return e; };

test('files offers its interface on D.files, and nothing else reaches the global', () => {
  const { D, F } = loadFiles();
  assert.deepEqual(Object.keys(D), ['core', 'files']);
  for (const n of ['dir', 'useFolder', 'srv', 'serverInfo', 'serverMtimes', 'folderSuggestions', 'api', 'lastMod', 'readText', 'writeText', 'modOf', 'readDrafts', 'idbGet', 'idbSet', 'Q', 'requestSync', 'scheduleSync', 'kick', 'discardPending', 'isPermErr', 'isMoved', 'errText', 'formatGate', 'install', 'fire']) {
    assert.ok(n in F, n);
    assert.notEqual(F[n], undefined, n);
  }
  for (const n of ['HOOKS', 'on', 'idb', 'apiError', 'refuseFormat']) assert.equal(n in F, false, n);
});

test('srv and dir read live, and are set only through serverInfo and useFolder', async () => {
  const { F } = loadFiles({ fetch: async () => ({ ok: true, json: async () => ({ folder: 'x', session: 's' }) }) });
  assert.equal(F.srv, null);
  assert.equal(F.dir.name, 'folder');
  assert.equal(await F.serverInfo(), true);
  assert.equal(F.srv.folder, 'x');
  const other = { name: 'other' };
  F.useFolder(other);
  assert.equal(F.dir, other);
  assert.throws(() => { 'use strict'; F.srv = {}; }, TypeError);
  assert.throws(() => { 'use strict'; F.dir = {}; }, TypeError);
});

test('both ways of reaching a folder sit behind readText', async () => {
  const handle = loadFiles({ folder: { 'A.md': 'by handle' } });
  assert.equal(await handle.F.readText('A.md'), 'by handle');
  assert.equal(handle.F.lastMod['A.md'], 7);
  assert.equal(await handle.F.readText('MISSING.md'), '');
  assert.equal(handle.F.lastMod['MISSING.md'], 0);
  const asked = [];
  const served = loadFiles({ fetch: async (p, o) => { asked.push([p, o && o.headers && o.headers['X-Discerny-Session']]); return p === '/api/info' ? { ok: true, json: async () => ({ session: 's' }) } : { ok: true, status: 200, headers: { get: () => '9' }, text: async () => 'by server' }; } });
  await served.F.serverInfo();
  assert.equal(await served.F.readText('A.md'), 'by server');
  assert.equal(served.F.lastMod['A.md'], 9);
  assert.deepEqual(asked[1], ['/api/file/A.md', 's']);
});

test('folderSuggestions gives what the server suggests, or null when it has none to give', async () => {
  const asked = [];
  const yes = loadFiles({ fetch: async (p) => { asked.push(p); return { ok: true, json: async () => [{ name: 'a', folder: '/a' }] }; } });
  assert.deepEqual(await yes.F.folderSuggestions(), [{ name: 'a', folder: '/a' }]);
  assert.deepEqual(asked, ['/api/folders']);
  const no = loadFiles({ fetch: async () => ({ ok: false }) });
  assert.equal(await no.F.folderSuggestions(), null);
});

test('hooks: install refuses a name not in the set, and a second installer', () => {
  const load = () => new Function(`${CORE}\n${readRepo('ui/files.js')}\n;return D;`)().files;
  const F = load();
  assert.throws(() => F.install('nope', () => {}), /bad hook install: nope/);
  assert.throws(() => F.install('toString', () => {}), /bad hook install: toString/);
  F.install('toast', () => 'said');
  assert.throws(() => F.install('toast', () => {}), /bad hook install: toast/);
  assert.equal(F.fire('toast', 'x'), 'said');
  assert.throws(() => F.fire('redraw'), /no hook installed: redraw/);
});

test('kick hands each job to runJob and tells afterJob once it has left the queue', async () => {
  let left = null;
  const t = loadFiles({ does: { afterJob: (_, D) => { left = D.files.Q.jobs.length; } } });
  const job = { keys: [], label: 'a' };
  t.Q.jobs.push(job);
  await t.F.kick();
  assert.deepEqual(t.events, ['redraw', ['runJob', job], 'afterJob', 'redraw']);
  assert.equal(left, 0);
  assert.equal(t.Q.running, false);
  assert.ok(t.Q.lastSaved > 0);
  assert.equal(t.timers.at(-1).ms, 500, 'a save is followed by a read');
});

test('kick waits for runJob\'s promise before the next job', async () => {
  let finish, order = [];
  const t = loadFiles({ does: { runJob: (job) => { order.push(job.label); return job.label === 'a' ? new Promise(r => { finish = r; }) : null; } } });
  t.Q.jobs.push({ label: 'a' }, { label: 'b' });
  const done = t.F.kick();
  for (let i = 0; i < 20 && !finish; i++) await new Promise(r => setImmediate(r));
  assert.deepEqual(order, ['a']);
  assert.equal(t.Q.jobs.length, 2);
  finish();
  await done;
  assert.deepEqual(order, ['a', 'b']);
});

test('a sync job doesn\'t count as a save', async () => {
  const t = loadFiles();
  t.F.requestSync(false);
  await new Promise(r => setImmediate(r));
  for (let i = 0; i < 20 && t.Q.running; i++) await new Promise(r => setImmediate(r));
  assert.equal(t.Q.lastSaved, 0);
  assert.equal(t.timers.length, 0);
});

test('kick reports a lost folder, a moved server and a failed read through the hooks', async () => {
  const failing = async (err, job) => {
    const t = loadFiles({ does: { runJob: () => { throw err; } } });
    t.Q.jobs.push(job);
    await t.F.kick();
    return t;
  };
  const lost = await failing(named('NotAllowedError'), { label: 'a' });
  assert.ok(lost.events.some(e => e[0] === 'folderState' && e[1].lost === true));
  assert.match(lost.Q.blocked.msg, /no longer has permission/);
  const moved = await failing(named('FolderChanged'), { label: 'a' });
  assert.ok(moved.events.some(e => e[0] === 'folderState' && e[1].moved === true));
  assert.ok(moved.Q.blocked);
  const read = await failing(named('Weird'), { sync: true });
  assert.ok(read.events.some(e => e[0] === 'toast' && /read the folder: Weird happened/.test(e[1])));
  assert.equal(read.Q.jobs.length, 0);
  assert.equal(read.Q.blocked, null);
  const save = await failing(named('Weird'), { label: 'a' });
  assert.equal(save.Q.blocked.msg, 'Weird happened');
  assert.equal(save.events.filter(e => e[0] === 'toast').length, 0);
  assert.equal(save.events.at(-1), 'redraw');
});

test('a folder whose Format changed is refused through folderState, and pending jobs are dropped', async () => {
  const t = loadFiles({ folder: { 'DISCERNY.md': '<!-- format: 0.0.1.5 -->\n' } });
  t.Q.jobs.push({ label: 'a' });
  await t.F.kick();
  const said = t.events.find(e => e[0] === 'folderState');
  assert.equal(said[1].ready, false);
  assert.equal(said[1].gate.mode, 'fmtold');
  assert.match(said[1].gate.msg, /not written/);
  assert.equal(t.Q.jobs.length, 0);
  assert.equal(t.events.filter(e => e[0] === 'runJob').length, 0);
});

// ---------------------------------------------------------------- model as it runs

// A fresh copy of model over core and files, in Node, where no window or document exists. store is its localStorage.
function loadModel(store = {}) {
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const load = new Function('localStorage', `${CORE}\n${readRepo('ui/files.js')}\n${readRepo('ui/model.js')}\n;return D;`);
  return load(localStorage);
}

// A small model: an open Task, a Proposal, a change Proposal, a Comment to acknowledge and two Records.
function withData(D) {
  const parse = new Function(`${CORE}\n;return { parse, pParse, eParse, rParse, aParse };`)();
  const inbox = parse.parse('# Inbox\n\n- [ ] T-0002 A proposal {received-datetime: 2026-01-01 09:00}\n\n## Changes\n- Relate T-0001 and P-0001 {kind: involves; source: x; received-datetime: 2026-01-01 09:00}\n  - why: y\n');
  D.model.S.m = {
    tasks: parse.parse('# Tasks\n\n<!-- next-id: 3 -->\n- [ ] T-0001 Order the widgets {type: task}\n  - comment: {added-datetime: 2026-01-01 09:00; author: email; acknowledged: no}\n    News\n'),
    inbox, done: parse.parse('# Done\n'),
    people: parse.pParse('# People\n\n## Us\n- Ann Example {id: P-0001}\n'),
    projects: parse.eParse('# Projects\n\n- Widgets {id: PRJ-0001; type: project; status: active}\n'),
    systems: parse.eParse('# Systems\n'),
    rels: parse.rParse(''), asks: parse.aParse(''), log: [], sources: [], drafts: [],
    settings: { text: '' }, interactions: { text: '' },
  };
  return D.model;
}

test('model offers its interface on D.model, and keeps the rest private', () => {
  const D = loadModel();
  assert.deepEqual(Object.keys(D), ['core', 'files', 'model']);
  for (const n of ['S', 'SET', 'setSettings', 'pauseDays', 'searchAll', 'flatResults', 'ix', 'item', 'allItems', 'entsOf', 'inboxList', 'nextList', 'prjItems', 'scored', 'todayStr', 'whereOf', 'homeView', 'recOf', 'inboxCount', 'changeByLine', 'relOf', 'undosOf', 'CHANGE_WORD', 'changeVal', 'canSnooze', 'prjName', 'commentAt', 'personOf', 'entSnapshot', 'cur', 'panelOpen', 'isRail', 'isDrawer', 'forced', 'forceClear', 'lsSet', 'idNum', 'changesOn']) {
    assert.ok(n in D.model, n);
    assert.notEqual(D.model[n], undefined, n);
  }
  for (const n of ['IX', 'SCORED', 'STOP', 'search', 'prioMark', 'scoreFact', 'prioToggle', 'scoreCell']) assert.equal(n in D.model, false, n);
});

test('SET reads live, and only setSettings changes it', () => {
  const D = loadModel(), M = D.model;
  assert.equal(M.pauseDays(), 28);
  const now = D.core.readSettings('[priority]\npause-days = 7\n');
  M.setSettings(now);
  assert.equal(M.SET, now);
  assert.equal(M.pauseDays(), 7);
  assert.throws(() => { 'use strict'; M.SET = {}; }, TypeError);
});

test('layout is read from S.width, with no window to ask', () => {
  const { S, isRail, isDrawer, panelOpen } = loadModel().model;
  S.side = 'auto';
  S.width = 1439;
  assert.equal(isRail(), true);
  S.width = 1440;
  assert.equal(isRail(), false);
  S.side = 'rail';
  assert.equal(isRail(), true);
  S.side = 'full';
  S.width = 600;
  assert.equal(isRail(), false);
  S.side = 'auto';
  S.width = 700;
  assert.equal(isDrawer(), true);
  S.width = 2000;
  assert.equal(isDrawer(), false);
  assert.equal(panelOpen(), false);
});

test('model installs folderState, which patches S, and only once', () => {
  const D = loadModel();
  D.files.fire('folderState', { lost: true });
  assert.equal(D.model.S.lost, true);
  D.files.fire('folderState', { ready: false, gate: { mode: 'fmtold' } });
  assert.equal(D.model.S.gate.mode, 'fmtold');
  assert.throws(() => D.files.install('folderState', () => {}), /bad hook install: folderState/);
});

test('searchAll is search without the Link row', () => {
  const M = withData(loadModel());
  assert.deepEqual(M.searchAll('').map(g => g.title), ['Jump to']);
  assert.deepEqual(M.searchAll('widgets').map(g => g.title), ['Tasks', 'Projects and systems']);
  assert.deepEqual(M.searchAll('T-0001').map(g => g.title), ['Tasks']);
  assert.deepEqual(M.searchAll('today').map(g => g.title), ['Commands']);
  assert.equal(M.flatResults(M.searchAll('T-0001'))[0].id, 'T-0001');
});

test('the helpers stranded in later sections work from state alone', () => {
  const M = withData(loadModel());
  assert.equal(M.inboxCount(), 3, 'a Proposal, a change Proposal and a Comment to acknowledge');
  assert.equal(M.item('T-0001').title, 'Order the widgets');
  assert.equal(M.cur('T-0001'), M.item('T-0001'));
  assert.equal(M.recOf('PRJ-0001').name, 'Widgets');
  assert.equal(M.commentAt('T-0001', 0).v, 'News');
  assert.equal(M.personOf('P-0001').name, 'Ann Example');
  assert.equal(M.prjName('PRJ-0001'), 'Widgets');
  assert.equal(M.entSnapshot('PRJ-0001').id, 'PRJ-0001');
  M.forceClear('qa-in');
  assert.equal(M.forced.has('qa-in'), true);
});

// ---------------------------------------------------------------- ops as it runs

const STARTER = {
  'DISCERNY.md': `<!-- format: ${FORMAT_NOW} -->\n`,
  'TASKS.md': '# Tasks\n\n<!-- next-id: 5 -->\n- [ ] T-0001 Order the widgets {type: task; due-date: 2026-01-10}\n- [ ] T-0002 Read the memo {type: fyi}\n- [ ] T-0003 Wait for parts {type: task; status: waiting; who: Bo Example}\n- [ ] T-0004 Finish the report {type: task}\n  - comment: {added-datetime: 2026-01-01 09:00; author: email; acknowledged: no; suggests: done}\n    All done\n',
  'INBOX.md': '# Inbox\n\n## Changes\n- Relate T-0001 and T-0002 {kind: related; source: x; received-datetime: 2026-01-01 09:00}\n  - why: y\n',
  'DONE.md': '# Done\n',
  'PEOPLE.md': '# People\n\n<!-- next-id: 3 -->\n## Us\n- Ann Example {id: P-0001}\n- Bo Example {id: P-0002}\n',
  'PROJECTS.md': '# Projects\n\n<!-- next-id: 2 -->\n- Widgets {id: PRJ-0001; type: project; status: active}\n',
  'SYSTEMS.md': '# Systems\n',
  'RELATIONSHIPS.md': '# Relationships\n',
  'ASK-AGENT.md': '# Ask\n',
  'ASK-AGENT-LOG.md': '# Log\n',
  'SOURCES.md': '# Sources\n\n## defaults\n- timezone: Europe/London\n',
  'INTERACTIONS.md': '# Interactions\n',
  'IGNORED.md': '# Ignored\n',
  'DISMISSED.md': '# Dismissed\n',
};

// A fresh copy of ops over the concerns before it, in Node, on an in-memory folder, with nothing from the DOM. Each redraw and toast is recorded.
function loadOps({ folder = { ...STARTER } } = {}) {
  const events = [], timers = [], writes = [];
  let mod = 1;
  const mods = {};
  const load = new Function('fetch', 'setTimeout', 'clearTimeout', 'console', 'localStorage',
    `${CORE}\n${readRepo('ui/files.js')}\n${readRepo('ui/model.js')}\n${readRepo('ui/ops.js')}\n;return D;`);
  const D = load(() => { throw new Error('no server here'); }, (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, () => {}, { error() {} }, { getItem: () => null, setItem() {} });
  const notThere = () => { const e = new Error('not there'); e.name = 'NotFoundError'; return e; };
  D.files.useFolder({
    name: 'folder',
    getFileHandle: async (n, o) => {
      if (!(n in folder) && !(o && o.create)) throw notThere();
      return {
        getFile: async () => ({ lastModified: mods[n] || 0, text: async () => folder[n] || '' }),
        createWritable: async () => ({ write: async (t) => { folder[n] = t; mods[n] = ++mod; writes.push(n); events.push('wrote ' + n); }, close: async () => {}, abort: async () => {} }),
      };
    },
    getDirectoryHandle: async () => { throw notThere(); },
  });
  D.files.install('redraw', () => { events.push('redraw'); });
  return { D, O: D.ops, S: D.model.S, Q: D.files.Q, folder, events, timers, writes };
}
// Waits for the queue to finish. With naps, it also runs the short timers a job is asleep on while it rereads a file.
async function drained(t, { naps = false } = {}) {
  for (let i = 0; i < 400; i++) {
    await new Promise(r => setImmediate(r));
    if (naps) t.timers.splice(0).forEach(x => { if (x.ms < 2000) x.fn(); else t.timers.push(x); });
    if (!t.Q.running && (!t.Q.jobs.length || t.Q.blocked)) return;
  }
  assert.fail('the queue never finished');
}
async function opened(options) {
  const t = loadOps(options);
  t.O.applyLoaded(await t.O.loadAll());
  t.events.length = 0;
  return t;
}

test('ops offers its interface on D.ops, and keeps the rest private', () => {
  const { D, O } = loadOps();
  assert.deepEqual(Object.keys(D), ['core', 'files', 'model', 'ops']);
  for (const n of ['OPS', 'op', 'LOG_KEYS', 'commit', 'patch', 'loadAll', 'applyLoaded', 'ignorable', 'dismissLine', 'toastShow', 'toastDrop', 'toastUndo', 'undoLast', 'relYes', 'changeNo', 'emailYes', 'prioYes', 'promotePerson', 'demotePerson', 'undoChange', 'markDoneAck', 'personAdd', 'snoozeItem', 'chase', 'gotIt', 'acknowledge', 'makeTask', 'setItemDue', 'saveComment']) {
    assert.ok(n in O, n);
    assert.notEqual(O[n], undefined, n);
  }
  for (const n of ['persist', 'runJob', 'readStable', 'looksWrong', 'countOf', 'sleep', 'BASE', 'PARSE', 'serKey', 'sigs', 'parseSources', 'applyAliasNews', 'duePatch', 'noteAlias', 'undoFns', 'toggleDone', 'accept', 'dismiss', 'mergeItems', 'deleteTask', 'addQuick', 'addCommentFrom']) assert.equal(n in O, false, n);
  for (const n of ['entGroup', 'newPrjOnTask', 'restoreEnt', 'meta', 'complete', 'ensureIds']) assert.equal(typeof O.OPS[n], 'function', n);
});

test('ops installs toast, runJob and afterJob, and only once', () => {
  const { D } = loadOps();
  for (const name of ['toast', 'runJob', 'afterJob']) assert.throws(() => D.files.install(name, () => {}), new RegExp(`bad hook install: ${name}`));
});

test('a sync job reads the folder into state', async () => {
  const t = loadOps();
  t.Q.jobs.push({ sync: true });
  await t.D.files.kick();
  assert.equal(t.S.m.tasks.items.length, 4);
  assert.equal(t.S.m.people.people[1].name, 'Bo Example');
  assert.ok(t.S.lastSync > 0, 'a sync job notes when it read');
});

test('commit applies to the screen, redraws, then saves, and its undo takes it back', async () => {
  const t = await opened();
  const before = t.S.ver;
  t.O.patch('T-0001', { urgency: 'soon' }, 'Changed.', t.O.OPS.meta('T-0001', { urgency: '' }));
  assert.equal(t.D.model.item('T-0001').meta.urgency, 'soon', 'on screen at once');
  assert.equal(t.S.ver, before + 1);
  assert.deepEqual(t.events.slice(0, 3), ['redraw', 'redraw', 'redraw'], 'its toast, the commit and the queue starting');
  assert.equal(t.writes.length, 0, 'not saved until the queue has run');
  await drained(t);
  assert.match(t.folder['TASKS.md'], /T-0001 [^\n]*urgency: soon/);
  assert.equal(t.O.undoLast(), true);
  await drained(t);
  assert.doesNotMatch(t.folder['TASKS.md'], /urgency: soon/);
  assert.equal(t.S.toasts.at(-1).text, 'Undone.');
});

test('a save is applied to what the file holds now, so an edit from outside stays', async () => {
  const t = await opened();
  const was = t.folder['TASKS.md'];
  t.folder['TASKS.md'] = was + '- [ ] T-0009 Added by an agent {type: task}\n';
  t.O.commit(t.O.OPS.meta('T-0001', { urgency: 'later' }));
  await drained(t);
  assert.match(t.folder['TASKS.md'], /T-0009 Added by an agent/);
  assert.match(t.folder['TASKS.md'], /T-0001 [^\n]*urgency: later/);
});

test('a file suddenly empty refuses the save, and nothing is written over it', async () => {
  const t = await opened();
  t.folder['TASKS.md'] = '';
  t.O.commit(t.O.OPS.meta('T-0001', { urgency: 'later' }));
  await drained(t, { naps: true });
  assert.match(t.Q.blocked.msg, /TASKS\.md is empty or missing/);
  assert.equal(t.folder['TASKS.md'], '');
  assert.deepEqual(t.writes, []);
});

test('toasts: a new one redraws and goes on its timer, a dropped one redraws once', async () => {
  const t = await opened();
  const id = t.O.toastShow('Hello');
  assert.deepEqual(t.events, ['redraw']);
  assert.equal(t.timers.at(-1).ms, 5000);
  t.O.toastShow('With undo', t.O.op('x', [], () => {}));
  assert.equal(t.timers.at(-1).ms, 9000);
  t.events.length = 0;
  t.O.toastDrop(id);
  t.O.toastDrop(id);
  assert.deepEqual(t.events, ['redraw']);
  t.D.files.fire('toast', 'From files');
  assert.equal(t.S.toasts.at(-1).text, 'From files');
  assert.equal(t.S.toasts.at(-1).undo, false);
});

test('undoLast says when there is nothing to undo', async () => {
  const t = await opened();
  t.O.toastShow('No undo here');
  assert.equal(t.O.undoLast(), false);
});

test('a change from outside is marked and told', async () => {
  const t = await opened();
  t.folder['TASKS.md'] = t.folder['TASKS.md'].replace('Read the memo', 'Read the new memo');
  t.O.applyLoaded(await t.O.loadAll());
  assert.equal(t.S.fresh.has('T-0002'), true);
  assert.match(t.S.toasts.at(-1).text, /Updated from your files: 1 item changed/);
});

test('a Record saved under another number is renamed on screen and followed', async () => {
  const t = await opened();
  t.S.sel = 'T-0005';
  t.S.composer['T-0005'] = 'draft';
  t.D.model.S.m.tasks.items.push({ id: 'T-0005', title: 'Mine', meta: {}, subs: [] });
  t.D.model.aliasNews.push(['T-0005', 'T-0006']);
  t.D.files.fire('afterJob');
  assert.equal(t.S.sel, 'T-0006');
  assert.equal(t.S.composer['T-0006'], 'draft');
  assert.ok(t.S.m.tasks.items.some(i => i.id === 'T-0006'));
  assert.match(t.S.toasts.at(-1).text, /Saved as T-0006: T-0005/);
});

test('an answer to a change Proposal writes the line, says so, and undoes', async () => {
  const t = await opened();
  const line = t.D.model.inboxCount() && t.S.m.inbox.post.find(l => /^- Relate/.test(l));
  t.O.relYes(line);
  await drained(t);
  assert.match(t.folder['RELATIONSHIPS.md'], /T-0001 ~ T-0002 \{kind: related\}/);
  assert.doesNotMatch(t.folder['INBOX.md'], /Relate T-0001/);
  assert.equal(t.S.toasts.at(-1).text, 'Related T-0001 and T-0002.');
  t.O.undoLast();
  await drained(t);
  assert.doesNotMatch(t.folder['RELATIONSHIPS.md'], /T-0001 ~ T-0002/);
  assert.match(t.folder['INBOX.md'], /Relate T-0001 and T-0002/);
});

test('a No to a change Proposal is remembered for good', async () => {
  const t = await opened();
  t.O.changeNo(t.S.m.inbox.post.find(l => /^- Relate/.test(l)));
  await drained(t);
  assert.match(t.folder['IGNORED.md'], /rel\|T-0001\|T-0002/);
  assert.doesNotMatch(t.folder['INBOX.md'], /Relate T-0001/);
});

test('the actions that only commit do what they say', async () => {
  const t = await opened();
  t.O.acknowledge('T-0002');
  await drained(t);
  assert.match(t.folder['DONE.md'], /\[x\] T-0002/);
  assert.equal(t.S.toasts.at(-1).text, 'Filed T-0002 as read.');
  t.O.gotIt('T-0003');
  await drained(t);
  assert.doesNotMatch(t.folder['TASKS.md'], /T-0003 [^\n]*status: waiting/);
  t.O.chase('T-0001');
  await drained(t);
  assert.match(t.folder['ASK-AGENT.md'], /- T-0001 \{/);
  t.O.chase('T-0001');
  assert.match(t.S.toasts.at(-1).text, /already queued/);
  t.O.setItemDue('T-0001', '2026-03-04', '10:30');
  await drained(t);
  assert.match(t.folder['TASKS.md'], /T-0001 [^\n]*due-date: 2026-03-04; [^\n]*due-time: 10:30/);
  t.O.setItemDue('T-0001', 'not a date');
  t.O.promotePerson('P-0002');
  await drained(t);
  assert.match(t.folder['INTERACTIONS.md'], /P-0002 decision promote/);
  t.O.demotePerson('P-0002');
  await drained(t);
  assert.match(t.folder['INTERACTIONS.md'], /P-0002 decision demote/);
  t.O.markDoneAck('T-0004');
  await drained(t);
  assert.match(t.folder['DONE.md'], /\[x\] T-0004/);
  assert.equal(t.O.undoLast(), true);
  await drained(t);
  assert.match(t.folder['TASKS.md'], /T-0004 Finish the report/);
  assert.match(t.folder['TASKS.md'], /acknowledged: no/);
});

test('saving a Comment with no change only redraws', async () => {
  const t = await opened();
  t.O.commit(t.O.OPS.comment('T-0001', { at: '2026-01-02 09:00', author: 'user', text: 'First' }));
  await drained(t);
  t.events.length = 0;
  t.S.cmtEdit = 'x';
  t.S.cmtEditText = 'First';
  t.O.saveComment('T-0001', 0);
  assert.equal(t.S.cmtEdit, null);
  assert.deepEqual(t.events, ['redraw']);
  assert.equal(t.Q.jobs.length, 0);
  t.S.cmtEditText = 'Second';
  t.O.saveComment('T-0001', 0);
  await drained(t);
  assert.match(t.folder['TASKS.md'], /Second/);
  assert.doesNotMatch(t.folder['TASKS.md'], /First/);
});

test('the Side panel\'s extra operations change the Record and restore it', async () => {
  const t = await opened();
  t.O.commit(t.O.OPS.entGroup('PRJ', 'PRJ-0001', 'Later'));
  await drained(t);
  assert.match(t.folder['PROJECTS.md'], /## Later\n- Widgets/);
  const out = {};
  t.O.commit(t.O.OPS.newPrjOnTask('T-0001', 'Gadgets', out));
  await drained(t);
  assert.equal(out.id, 'PRJ-0002');
  assert.match(t.folder['PROJECTS.md'], /- Gadgets \{id: PRJ-0002/);
  assert.match(t.folder['TASKS.md'], /T-0001 [^\n]*projects: PRJ-0002/);
  const snap = t.D.model.entSnapshot('PRJ-0002');
  t.O.commit(t.O.OPS.deleteEnt('PRJ', 'PRJ-0002'));
  await drained(t);
  assert.doesNotMatch(t.folder['PROJECTS.md'], /Gadgets/);
  t.O.commit(t.O.OPS.restoreEnt('PRJ', snap));
  await drained(t);
  assert.match(t.folder['PROJECTS.md'], /- Gadgets \{id: PRJ-0002/);
});

// ---------------------------------------------------------------- links as it runs

// A fresh copy of links over the concerns it may use, in Node, with a small model and an address of its own. ops isn't loaded: links has no need of it.
function loadLinks(hash = '') {
  const replaced = [], location = { hash, replace(h) { location.hash = h; replaced.push(h); } };
  const load = new Function('localStorage', 'location', `${CORE}\n${readRepo('ui/files.js')}\n${readRepo('ui/model.js')}\n${readRepo('ui/links.js')}\n;return D;`);
  const D = load({ getItem: () => null, setItem() {} }, location);
  withData(D);
  return { D, L: D.links, S: D.model.S, location, replaced };
}

test('links offers its interface on D.links, and keeps the rest private', () => {
  const { D, L } = loadLinks();
  assert.deepEqual(Object.keys(D), ['core', 'files', 'model', 'links']);
  for (const n of ['LINK_VIEW', 'VIEW_LINK', 'RECORD_VIEW', 'LINK_STATE', 'TAB_LINK', 'linkQuery', 'stateOfHash', 'linkItem', 'linkNow', 'linkOfHash', 'mergedInto', 'missingId', 'syncLink', 'search', 'nav']) {
    assert.ok(n in L, n);
    assert.notEqual(L[n], undefined, n);
  }
  for (const n of ['stateKey', 'ENT_Q', 'linkValue', 'idShaped', 'linkText', 'linkResult', 'openState', 'linkTarget', 'onThisView', 'openLink', 'openView', 'land', 'go', 'select']) assert.equal(n in L, false, n);
});

test('nav holds the Link variables, and they start as a fresh page needs', () => {
  const { L } = loadLinks();
  assert.deepEqual(L.nav, { linkPush: false, hashOwn: '', landing: false, autoOpen: null, offView: null });
  assert.equal(Object.getOwnPropertyDescriptor(L, 'nav').get, undefined, 'one object, never reassigned, so it needs no accessor');
});

test('every View has one Link name, which reads back to that View', () => {
  const { L } = loadLinks();
  assert.equal(Object.keys(L.LINK_VIEW).length, 13);
  for (const name of Object.keys(L.LINK_VIEW)) assert.equal(L.VIEW_LINK[L.LINK_VIEW[name]], name);
  assert.equal(L.LINK_VIEW['next-actions'], 'next');
  assert.equal(L.VIEW_LINK.claude, 'agent');
  assert.deepEqual({ ...L.RECORD_VIEW }, { P: 'person', PRJ: 'project', SYS: 'system' });
});

test('a hash reads as its Link and its state', () => {
  const { L } = loadLinks();
  assert.equal(L.linkOfHash('#/today'), 'today');
  assert.equal(L.linkOfHash('#/next-actions/T-0001?group=kind'), 'next-actions/T-0001');
  assert.equal(L.linkOfHash(''), '');
  assert.equal(L.linkOfHash('#/%E0%A4'), '%E0%A4', 'what will not decode stays as typed');
  assert.deepEqual(L.stateOfHash('#/all-items?q=a%20%26%20b&group=type'), [['q', 'a & b'], ['group', 'type']]);
  assert.deepEqual(L.stateOfHash('#/all-items?flag'), [['flag', '']]);
  assert.deepEqual(L.stateOfHash('#/today'), []);
});

test('the Link now names the View or Record, the Item, and only state that differs from its default', () => {
  const { L, S } = loadLinks();
  assert.equal(L.linkNow(), 'today');
  assert.equal(L.linkNow('T-0001'), 'today/T-0001');
  S.view = 'project'; S.entity = 'PRJ-0001';
  assert.equal(L.linkNow(), 'PRJ-0001');
  S.view = 'all'; S.entity = null;
  assert.equal(L.linkQuery(), '');
  S.wq = 'a & b'; S.wb.group = 'type'; S.wb.sort = 'due';
  assert.equal(L.linkQuery(), '?q=a%20%26%20b&group=type&sort=due-date');
  S.tab = 'links';
  assert.equal(L.linkQuery(), '?q=a%20%26%20b&group=type&sort=due-date');
  assert.equal(L.linkQuery('T-0001'), '?q=a%20%26%20b&group=type&sort=due-date&tab=relationships');
});

test('a View state setter clears the field it fills', () => {
  const { D, L, S } = loadLinks();
  L.LINK_STATE.people.q.set('ann');
  assert.equal(S.pq, 'ann');
  assert.equal(D.model.forced.has('people-q'), true);
  assert.equal(L.LINK_STATE.projects.q, L.LINK_STATE.systems.q, 'Projects and Systems share one key');
});

test('the Link names an Item the User opened, not one the Inbox opened by itself', () => {
  const { L, S } = loadLinks();
  assert.equal(L.linkItem(), null);
  S.panel = true; S.sel = 'T-0001';
  assert.equal(L.linkItem(), 'T-0001');
  L.nav.autoOpen = 'T-0001';
  assert.equal(L.linkItem(), null);
  L.nav.autoOpen = null; S.sel = 'P-0001';
  assert.equal(L.linkItem(), null);
  S.sel = 'T-9999';
  assert.equal(L.linkItem(), null);
});

test('syncLink replaces the hash it wrote last, or adds history when asked', () => {
  const t = loadLinks('#/today');
  t.L.nav.hashOwn = '#/today';
  t.S.view = 'inbox';
  t.L.syncLink();
  assert.deepEqual(t.replaced, ['#/inbox']);
  assert.equal(t.L.nav.hashOwn, '#/inbox');
  t.S.view = 'fyi'; t.L.nav.linkPush = true;
  t.L.syncLink();
  assert.deepEqual(t.replaced, ['#/inbox'], 'not replaced');
  assert.equal(t.location.hash, '#/fyi');
  assert.equal(t.L.nav.hashOwn, '#/fyi');
  assert.equal(t.L.nav.linkPush, false);
});

test('syncLink leaves alone a hash the page didn\'t write', () => {
  const t = loadLinks('#/fyi');
  t.L.nav.hashOwn = '#/today'; t.L.nav.linkPush = true;
  t.L.syncLink();
  assert.equal(t.location.hash, '#/fyi');
  assert.deepEqual(t.replaced, []);
  assert.equal(t.L.nav.hashOwn, '#/today', 'land takes that hash as its own');
  assert.equal(t.L.nav.linkPush, true);
});

test('syncLink writes nothing when the hash is right already', () => {
  const t = loadLinks('#/today');
  t.L.nav.hashOwn = '#/today';
  t.L.syncLink();
  assert.deepEqual(t.replaced, []);
});

test('an ID that was merged is found by its Comment', () => {
  const { D, L } = loadLinks();
  assert.equal(L.mergedInto('T-0009'), null);
  const parse = new Function(`${CORE}\n;return parse;`)();
  D.model.S.m.tasks = parse('# Tasks\n\n- [ ] T-0001 Order the widgets {type: task}\n  - comment: {added-datetime: 2026-01-01 09:00; author: user}\n    Merged T-0009 into this.\n');
  assert.equal(L.mergedInto('T-0009'), 'T-0001');
});

test('missingId names an ID, typed or in a whole address, and nothing else', () => {
  const { L } = loadLinks();
  assert.equal(L.missingId('t-0009'), 'T-0009');
  assert.equal(L.missingId('http://127.0.0.1:4790/#/PRJ-0009'), 'PRJ-0009');
  assert.equal(L.missingId('widgets'), null);
  assert.equal(L.missingId('today/T-0009'), null);
});

test('search adds the Link row to searchAll, and adds nothing when the text is no Link', () => {
  const { D, L } = loadLinks();
  assert.deepEqual(L.search('widgets'), D.model.searchAll('widgets'));
  const row = (q) => { const g = L.search(q); return g[0] && g[0].title === 'Link' ? g[0].items[0] : null; };
  assert.deepEqual(row('inbox'), { label: 'Go to inbox', sub: 'View', id: '', act: 'link', arg: 'inbox' });
  assert.deepEqual(row('http://127.0.0.1:4790/#/PRJ-0001'), { label: 'Go to PRJ-0001', sub: 'Widgets', id: '', act: 'link', arg: 'PRJ-0001' });
  assert.equal(row('T-0001').sub, D.model.labelOf('T-0001'));
  assert.equal(row('today/T-0009').sub, 'T-0009 isn’t in this Data folder');
  assert.equal(row('T-0009'), null, 'a bare ID with nothing behind it stays a search');
  assert.equal(row('a/b/c'), null);
  assert.equal(row('nowhere'), null);
});

// ---------------------------------------------------------------- views as they run

// A fresh copy of the views over what they read, in Node, with no ops, window or document. Only links reads the address.
function loadViews() {
  const location = { hash: '', replace(h) { location.hash = h; } };
  const load = new Function('localStorage', 'location', `${CORE}\n${readRepo('ui/files.js')}\n${readRepo('ui/model.js')}\n${readRepo('ui/links.js')}\n${VIEW_FILES.map(readRepo).join('\n')}\n;return D;`);
  const D = load({ getItem: () => null, setItem() {} }, location);
  withData(D);
  D.model.S.ready = true;
  D.model.S.width = 1600;
  D.model.S.eq = ''; // going to a View sets it
  return { D, V: D.views, S: D.model.S };
}
const stateNow = (S) => JSON.stringify(S, (k, v) => (v instanceof Set ? [...v] : v));

test('views offers what the page and the steps use on D.views, and keeps the rest private', () => {
  const { D, V } = loadViews();
  assert.deepEqual(Object.keys(D), ['core', 'files', 'model', 'links', 'views']);
  for (const n of ['page', 'viewFor', 'esc', 'mergeCands', 'linkCands']) assert.equal(typeof V[n], 'function', n);
  for (const n of ['vApp', 'vMain', 'vGate', 'saveState', 'vBanner', 'vFolderForm', 'vClaudeTab', 'panelEnt']) assert.equal(n in V, false, n);
});

test('page() draws the app when the folder is read, and the gate when it isn\'t', () => {
  const { V, S } = loadViews();
  assert.match(V.page(), /data-k="app"/);
  S.ready = false;
  S.gate = { mode: 'pick', msg: '' };
  assert.match(V.page(), /data-k="gate"/);
  S.ready = true;
  S.m = null;
  assert.match(V.page(), /data-k="gate"/);
});

test('every View draws from state alone, and drawing changes nothing', () => {
  const { V, S } = loadViews();
  const pages = [['today'], ['inbox'], ['next'], ['waiting'], ['upcoming'], ['fyi'], ['all'], ['done'], ['projects'], ['systems'], ['people'], ['project', 'PRJ-0001'], ['system', 'SYS-0009'], ['person', 'P-0001'], ['review'], ['claude']];
  for (const [view, entity] of pages) {
    S.view = view;
    S.entity = entity || null;
    const before = stateNow(S);
    assert.match(V.page(), /data-k="main"/, view);
    assert.equal(stateNow(S), before, view);
  }
  S.view = 'today';
  S.entity = null;
  for (const dialog of ['palette', 'keys']) {
    S.dialog = dialog;
    const before = stateNow(S);
    assert.match(V.page(), /dlg-scrim/, dialog);
    assert.equal(stateNow(S), before, dialog);
  }
  S.dialog = null;
  for (const id of ['T-0001', 'T-0002', 'P-0001', 'PRJ-0001']) {
    S.sel = id;
    S.panel = true;
    const before = stateNow(S);
    assert.match(V.page(), /class="panel/, id);
    assert.equal(stateNow(S), before, id);
  }
});

// ---------------------------------------------------------------- render as it runs

// A fresh copy of render over the views, in Node, with a small stand-in for the document. Frames wait in `frames` until a test lets one fall.
function loadRender() {
  const frames = [], errors = [], focused = [], template = { innerHTML: null, content: { childNodes: [] } }, found = {};
  const root = { nodeType: 1, firstChild: null };
  const document = { activeElement: null, body: {}, getElementById: () => root, createElement: () => template, querySelector: (sel) => found[sel] || null, contains: () => true };
  const element = (sel) => { found[sel] = { focus() { focused.push(sel); } }; };
  const location = { hash: '', replace() {} };
  const load = new Function('localStorage', 'location', 'document', 'window', 'requestAnimationFrame', 'console', `${CORE}\n${readRepo('ui/files.js')}\n${readRepo('ui/model.js')}\n${readRepo('ui/links.js')}\n${VIEW_FILES.map(readRepo).join('\n')}\n${readRepo('ui/render.js')}\n;return D;`);
  const D = load({ getItem: () => null, setItem() {} }, location, document, { innerWidth: 1234 }, (f) => { frames.push(f); return frames.length; }, { error(e) { errors.push(e); } });
  const after = [];
  D.files.install('afterDraw', () => { after.push(D.model.S.focusSel); });
  return { D, R: D.render, S: D.model.S, frames, template, after, element, focused, errors };
}

test('render offers its interface on D.render, and keeps the morph private', () => {
  const { D, R } = loadRender();
  assert.deepEqual(Object.keys(D), ['core', 'files', 'model', 'links', 'views', 'render']);
  for (const n of ['render', 'renderNow', 'focusLater', 'measure']) assert.equal(typeof R[n], 'function', n);
  assert.equal(R.renderQ, false);
  for (const n of ['morphChildren', 'morphNode', 'morphAttrs', 'keyOf', 'sameNode', 'afterRender']) assert.equal(n in R, false, n);
});

test('renderQ reads live, and says a frame is queued until it falls', () => {
  const { R, frames } = loadRender();
  R.render();
  assert.equal(R.renderQ, true);
  R.render();
  assert.equal(frames.length, 1, 'one frame, however many ask');
  frames[0]();
  assert.equal(R.renderQ, false);
  assert.throws(() => { 'use strict'; R.renderQ = true; }, TypeError);
});

test('render installs redraw, which queues a frame', () => {
  const { D, R, frames } = loadRender();
  D.files.fire('redraw');
  assert.equal(frames.length, 1);
  assert.equal(R.renderQ, true);
  assert.throws(() => D.files.install('redraw', () => {}), /bad hook install: redraw/);
});

test('a frame measures, draws page(), keeps S.focusSel and then fires afterDraw', () => {
  const { D, R, S, template, after, element, focused } = loadRender();
  element('#x');
  S.focusSel = '#x';
  D.model.forced.add('a');
  R.renderNow();
  assert.equal(S.width, 1234);
  assert.equal(template.innerHTML, D.views.page());
  assert.equal(D.model.forced.size, 0);
  assert.deepEqual(focused, ['#x']);
  assert.deepEqual(after, [null], 'afterDraw comes once, after the focus');
});

test('a View that throws is told on the page, and afterDraw still fires', () => {
  const { D, R, template, after, errors } = loadRender();
  D.views.page = () => { throw new Error('boom'); };
  R.renderNow();
  assert.match(template.innerHTML, /Something went wrong drawing the page/);
  assert.match(template.innerHTML, /boom/);
  assert.equal(errors.length, 1);
  assert.equal(after.length, 1);
});

test('focusLater moves focus at once when it can, or draws so that it can', () => {
  const { R, S, frames, element, focused, template } = loadRender();
  R.focusLater('#gone');
  assert.equal(frames.length, 0, 'drawn now, not queued');
  assert.notEqual(template.innerHTML, null);
  assert.equal(S.focusSel, null);
  element('#x');
  R.focusLater('#x');
  assert.deepEqual(focused, ['#x']);
  assert.equal(S.focusSel, '#x', 'kept for the frame');
  assert.equal(frames.length, 1);
});

// ---------------------------------------------------------------- input as it runs

// A fresh copy of input over every concern before it, in Node, with a small stand-in for the document. rows are the rows on the page, in order; els are what a selector finds.
function loadInput({ hash = '', rows = ['T-0001'], picker = null, store = {}, fetch = null } = {}) {
  const frames = [], focused = [], scrolled = [], els = {}, timers = [], intervals = [], listeners = [];
  const template = { innerHTML: null, content: { childNodes: [] } }, root = { nodeType: 1, firstChild: null };
  const element = (sel, more = {}) => { els[sel] = { focus() { focused.push(sel); }, scrollIntoView() { scrolled.push(sel); }, ...more }; return els[sel]; };
  const location = { hash, protocol: 'http:', reloaded: 0, replace(h) { location.hash = h; }, reload() { location.reloaded++; } };
  const document = {
    activeElement: null, body: {}, title: '', hidden: false,
    documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } },
    getElementById: (id) => (id === 'app' ? root : els['#' + id] || null), createElement: () => template,
    querySelector: (sel) => els[sel] || null, querySelectorAll: () => rows.map(id => ({ getAttribute: () => id })), contains: () => true,
    addEventListener: (name) => listeners.push(name),
  };
  const window = { innerWidth: 1600, addEventListener: (name) => listeners.push(name) };
  if (picker) window.showDirectoryPicker = picker;
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const themes = [];
  const load = new Function('localStorage', 'location', 'document', 'window', 'requestAnimationFrame', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'navigator', 'setThemeColor', 'fetch',
    `${CORE}\n${movedScripts().filter(f => f !== 'ui/core.js' && f !== 'ui/main.js').map(readRepo).join('\n')}\n;return D;`);
  const D = load(localStorage, location, document, window, (f) => { frames.push(f); return frames.length; }, { error() {} }, (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, () => {}, (fn, ms) => { intervals.push({ fn, ms }); }, {}, (t) => themes.push(t), fetch);
  withData(D);
  const S = D.model.S;
  S.ready = true; S.width = 1600; S.eq = ''; S.view = 'today';
  return { D, I: D.input, S, location, document, window, frames, focused, scrolled, element, store, themes, timers, intervals, listeners };
}
// A key press, as onKey reads one.
const keyOn = (key, target, more = {}) => { const ev = { key, target: target || { tagName: 'BODY', closest: () => null, getAttribute: () => null }, defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {}, ...more }; return ev; };
// A click or field element, as the handlers read one.
const elWith = (attrs = {}, more = {}) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null), closest: () => null, ...more });

test('input offers what start-up and the steps use on D.input, and keeps the rest private', () => {
  const { D, I } = loadInput();
  assert.deepEqual(Object.keys(D), ['core', 'files', 'model', 'ops', 'links', 'views', 'render', 'input']);
  for (const n of ['ACT', 'CH', 'IN', 'SUB']) assert.equal(typeof I[n], 'object', n);
  for (const n of ['onKey', 'land', 'openFolder', 'go', 'goAny', 'select', 'closePanel', 'toggleDone', 'accept', 'dismiss', 'mergeItems', 'deleteTask', 'addQuick', 'addCommentFrom', 'addLink']) assert.equal(typeof I[n], 'function', n);
  for (const n of ['KD', 'GO_KEYS', 'rowIds', 'neighbour', 'moveCursor', 'targetId', 'did', 'dvv', 'poll', 'regainAccess', 'retrySave', 'setWb', 'openState', 'openLink', 'copyText', 'addPrjFrom', 'addTagFrom', 'pickFolder', 'changeFolder', 'regrant', 'startTimers', 'loadFolderSugs']) assert.equal(n in I, false, n);
});

test('input installs afterDraw, and only once', () => {
  const { D } = loadInput();
  assert.throws(() => D.files.install('afterDraw', () => {}), /bad hook install: afterDraw/);
});

test('afterDraw scrolls to the row asked for, clears an Item now on the View, keeps the Link and sets the title', () => {
  const { D, S, document, element, scrolled, location } = loadInput();
  element('.main [data-row="T-0001"]');
  element('#page-title', { textContent: 'Today' });
  element('.main [data-row="T-0001"], .main [data-k="ack-T-0001"]');
  S.scrollRow = 'T-0001';
  D.links.nav.offView = 'T-0001';
  D.links.nav.hashOwn = location.hash;
  D.files.fire('afterDraw');
  assert.deepEqual(scrolled, ['.main [data-row="T-0001"]']);
  assert.equal(S.scrollRow, null);
  assert.equal(D.links.nav.offView, null);
  assert.equal(location.hash, '#/today');
  assert.match(document.title, /^Today · Discerny \(\d+ in inbox\)$/);
});

test('afterDraw before the folder is read leaves the Link alone', () => {
  const { D, S, document, location } = loadInput({ hash: '#/inbox' });
  S.ready = false;
  D.files.fire('afterDraw');
  assert.equal(location.hash, '#/inbox');
  assert.equal(document.title, 'Discerny');
});

test('go changes the View, clears what belonged to the old one, and asks for history only when it changed', () => {
  const { D, I, S, focused, element } = loadInput();
  element('#page-title');
  S.sel = 'T-0001'; S.panel = true; S.pq = 'x'; S.dialog = 'keys';
  I.go('today');
  assert.equal(D.links.nav.linkPush, false, 'the same View adds no history');
  assert.equal(S.panel, false);
  assert.equal(S.sel, null);
  assert.equal(S.dialog, null);
  assert.equal(S.pq, 'x', 'a filter stays on the same View');
  I.go('projects');
  assert.equal(S.view, 'projects');
  assert.equal(D.links.nav.linkPush, true);
  assert.equal(S.pq, '');
  assert.equal(focused.at(-1), '#page-title');
});

test('going to the Inbox opens its first Proposal, unless the window is a drawer', () => {
  const wide = loadInput();
  wide.I.go('inbox');
  assert.equal(wide.S.sel, 'T-0002');
  assert.equal(wide.D.links.nav.autoOpen, 'T-0002');
  const narrow = loadInput();
  narrow.S.width = 500;
  narrow.I.go('inbox');
  assert.equal(narrow.S.sel, null);
});

test('goAny goes where each kind of ID lives', () => {
  const { I, S } = loadInput();
  I.goAny('P-0001');
  assert.deepEqual([S.view, S.entity], ['person', 'P-0001']);
  I.goAny('PRJ-0001');
  assert.deepEqual([S.view, S.entity], ['project', 'PRJ-0001']);
  I.goAny('T-0001');
  assert.deepEqual([S.sel, S.panel], ['T-0001', true]);
});

test('select opens the Item and clears the last one\'s drafts, and closePanel puts focus back on its row', () => {
  const { D, I, S, focused, element } = loadInput();
  S.cmtDraft = 'half written';
  element('.main [data-row="T-0001"] .t');
  element('#panel-top');
  I.select('T-0001');
  assert.deepEqual([S.sel, S.panel, S.cur, S.cmtDraft], ['T-0001', true, 'T-0001', '']);
  assert.equal(D.links.nav.linkPush, true);
  assert.equal(focused.at(-1), '#panel-top');
  I.closePanel();
  assert.deepEqual([S.sel, S.panel], [null, false]);
  assert.equal(focused.at(-1), '.main [data-row="T-0001"] .t');
});

test('a click on Go, Theme and Retry does what the button says', () => {
  const { D, I, S, themes, store } = loadInput();
  I.ACT.go(elWith({ 'data-v': 'people-gaps' }));
  assert.deepEqual([S.view, S.pf], ['people', 'gaps']);
  S.theme = 'light';
  I.ACT.theme();
  assert.equal(S.theme, 'dark');
  assert.deepEqual(themes, ['dark']);
  assert.equal(store['discerny-theme'], 'dark');
  D.files.Q.blocked = { msg: 'x' };
  S.confirm = 'discard';
  I.ACT.retry();
  assert.equal(S.confirm, null);
});

test('Retry after a lost folder asks for access first, and stays blocked without it', async () => {
  const { D, I, S } = loadInput();
  D.files.useFolder({ name: 'f', requestPermission: async () => 'denied' });
  D.files.Q.blocked = { msg: 'x' };
  S.lost = true;
  I.ACT.retry();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.equal(S.lost, true);
  assert.deepEqual(D.files.Q.blocked, { msg: 'x' });
  D.files.useFolder({ name: 'f', requestPermission: async () => 'granted', getFileHandle: async () => { throw Object.assign(new Error('gone'), { name: 'NotFoundError' }); } });
  I.ACT.retry();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.equal(S.lost, false);
  assert.equal(D.files.Q.blocked, null);
});

test('keys: Ctrl K opens and closes the palette, G then a letter goes to a View, ? opens the shortcuts', () => {
  const { I, S } = loadInput();
  const ctrlK = keyOn('k', undefined, { ctrlKey: true });
  I.onKey(ctrlK);
  assert.equal(ctrlK.defaultPrevented, true);
  assert.equal(S.dialog, 'palette');
  I.onKey(keyOn('K', undefined, { ctrlKey: true }));
  assert.equal(S.dialog, null);
  I.onKey(keyOn('g'));
  assert.ok(S.gAt > 0);
  I.onKey(keyOn('p'));
  assert.equal(S.view, 'projects');
  I.onKey(keyOn('?'));
  assert.equal(S.dialog, 'keys');
  I.onKey(keyOn('Escape'));
  assert.equal(S.dialog, null);
});

test('keys: J and K walk the rows, Enter opens the one you are on, and Escape closes it', () => {
  const { I, S } = loadInput({ rows: ['T-0001', 'T-0002'] });
  I.onKey(keyOn('j'));
  assert.equal(S.cur, 'T-0001');
  I.onKey(keyOn('j'));
  assert.equal(S.cur, 'T-0002');
  I.onKey(keyOn('j'));
  assert.equal(S.cur, 'T-0002', 'it stops at the last row');
  I.onKey(keyOn('k'));
  assert.equal(S.cur, 'T-0001');
  I.onKey(keyOn('Enter'));
  assert.deepEqual([S.sel, S.panel], ['T-0001', true]);
  I.onKey(keyOn('Escape'));
  assert.equal(S.panel, false);
});

test('keys: a letter typed in a field stays in the field', () => {
  const { I, S } = loadInput();
  const input = { tagName: 'INPUT', type: 'text', closest: () => null, getAttribute: () => null };
  const ev = keyOn('j', input);
  I.onKey(ev);
  assert.equal(ev.defaultPrevented, false);
  assert.ok(!S.cur);
  const ctrlZ = keyOn('z', input, { ctrlKey: true });
  I.onKey(ctrlZ);
  assert.equal(ctrlZ.defaultPrevented, false, 'the field undoes its own typing');
});

test('keys: X completes the Item under the cursor and moves to the next row, and a field\'s own keys go first', () => {
  const { D, I, S } = loadInput({ rows: ['T-0001', 'T-0002'] });
  S.cur = 'T-0001';
  I.onKey(keyOn('x'));
  assert.equal(D.model.whereOf('T-0001'), 'done');
  assert.equal(S.cur, 'T-0002');
  S.qa = 'typed';
  const box = { tagName: 'INPUT', type: 'text', value: 'typed', getAttribute: (k) => (k === 'data-kd' ? 'qa' : null) };
  box.closest = () => box;
  I.onKey(keyOn('Escape', box));
  assert.equal(S.qa, '', 'Escape in quick add clears it');
});

test('typing keeps the draft in state, and leaving a field commits only a real change', () => {
  const { D, I, S } = loadInput();
  I.IN.qa(elWith({}, { value: 'Ring Ann' }));
  assert.equal(S.qa, 'Ring Ann');
  I.IN.composer(elWith({}, { value: 'no panel open' }));
  assert.deepEqual(S.composer, {}, 'the composer belongs to the open Item');
  const before = S.ver;
  I.CH.title(elWith({ 'data-id': 'T-0001' }, { value: 'Order the widgets', id: 'f-title' }));
  assert.equal(S.ver, before, 'no change, no commit');
  I.CH.title(elWith({ 'data-id': 'T-0001' }, { value: 'Order more widgets', id: 'f-title' }));
  assert.equal(D.model.item('T-0001').title, 'Order more widgets');
  assert.equal(S.ver, before + 1);
  I.CH.title(elWith({ 'data-id': 'T-0001' }, { value: '  ', id: 'f-title' }));
  assert.equal(D.model.item('T-0001').title, 'Order more widgets', 'an empty title puts the old one back');
  assert.ok(D.model.forced.has('f-title'));
});

test('quick add makes the Item, clears the box and offers Undo; an empty box only moves focus', () => {
  const { D, I, S, focused, element } = loadInput();
  element('#qa-in');
  I.addQuick();
  assert.equal(focused.at(-1), '#qa-in');
  S.qa = 'Ring Ann';
  I.addQuick();
  assert.equal(S.qa, '');
  assert.ok(D.model.allItems().some(i => i.title === 'Ring Ann'));
  assert.match(S.toasts.at(-1).text, /^Added T-0003 /);
});

test('Done, Reopen and Accept move the Item and say so, and Accept moves on to the next Proposal', () => {
  const { D, I, S } = loadInput();
  I.toggleDone('T-0001');
  assert.equal(D.model.whereOf('T-0001'), 'done');
  assert.match(S.toasts.at(-1).text, /^Done: /);
  I.toggleDone('T-0001');
  assert.equal(D.model.whereOf('T-0001'), 'open');
  assert.match(S.toasts.at(-1).text, /^Reopened T-0001/);
  S.view = 'inbox';
  I.accept('T-0002');
  assert.equal(D.model.whereOf('T-0002'), 'open');
  assert.match(S.toasts.at(-1).text, /^Accepted T-0002 into /);
  assert.equal(S.sel, null, 'nothing left to clarify');
});

test('Dismiss as Duplicate only opens the search; Already handled accepts and completes', () => {
  const { D, I, S } = loadInput();
  I.dismiss('T-0002', 'Duplicate');
  assert.equal(S.dupFor, 'T-0002');
  assert.equal(D.model.whereOf('T-0002'), 'inbox');
  I.dismiss('T-0002', 'Already handled');
  assert.equal(D.model.whereOf('T-0002'), 'done');
});

test('the All items filters are remembered', () => {
  const { I, S, store } = loadInput();
  I.CH['wb-sort'](elWith({}, { value: 'due' }));
  assert.equal(S.wb.sort, 'due');
  assert.equal(JSON.parse(store['discerny-wb']).sort, 'due');
});

test('landing on a Link opens its View and Item, and says what it couldn\'t find', () => {
  const t = loadInput({ hash: '#/inbox/T-0002' });
  t.I.land();
  assert.deepEqual([t.S.view, t.S.sel], ['inbox', 'T-0002']);
  assert.equal(t.D.links.nav.linkPush, false, 'the browser has already made its history entry');
  assert.equal(t.D.links.nav.hashOwn, '#/inbox/T-0002');
  const gone = loadInput({ hash: '#/T-0009' });
  gone.I.land();
  assert.equal(gone.S.view, 'today');
  assert.match(gone.S.toasts.at(-1).text, /T-0009 isn’t in this Data folder/);
  const named = loadInput({ hash: '#/nowhere' });
  named.I.land();
  assert.equal(named.S.view, 'today');
  assert.match(named.S.toasts.at(-1).text, /no View called “nowhere”/);
});

test('picking a folder with no TASKS.md says so, and a cancelled picker does nothing', async () => {
  const notThere = () => Object.assign(new Error('not there'), { name: 'NotFoundError' });
  const wrong = loadInput({ picker: async () => ({ name: 'Holiday', getFileHandle: async () => { throw notThere(); } }) });
  wrong.S.ready = false;
  wrong.I.ACT.pick();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.deepEqual(wrong.S.gate, { mode: 'wrong', msg: '“Holiday” has no TASKS.md.' });
  const cancelled = loadInput({ picker: async () => { throw Object.assign(new Error('no'), { name: 'AbortError' }); } });
  cancelled.S.ready = false;
  cancelled.S.gate = { mode: 'pick', msg: '' };
  cancelled.I.ACT.pick();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.deepEqual(cancelled.S.gate, { mode: 'pick', msg: '' });
});

test('Change folder, by the picker: refuses unsaved work and a folder with no TASKS.md', async () => {
  const notThere = () => Object.assign(new Error('not there'), { name: 'NotFoundError' });
  const t = loadInput({ picker: async () => ({ name: 'Holiday', getFileHandle: async () => { throw notThere(); } }) });
  t.D.files.Q.jobs.push({ label: 'a' });
  t.D.files.Q.running = true;
  t.I.ACT.folder();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.match(t.S.toasts.at(-1).text, /Wait until your changes are saved/);
  t.D.files.Q.jobs.length = 0;
  t.I.ACT.folder();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.match(t.S.toasts.at(-1).text, /“Holiday” has no TASKS\.md/);
  assert.equal(t.location.reloaded, 0);
});

test('Change folder, on a served page: opens the dialog, and a switch reloads on the new folder or says why not', async () => {
  const t = loadInput({ fetch: async (p, o) => {
    if (p === '/api/info') return { ok: true, json: async () => ({ folder: 'x', name: 'x', session: 's', canSwitch: true }) };
    if (p === '/api/folders') return { ok: true, json: async () => [{ name: 'a', folder: '/a' }] };
    return JSON.parse(o.body).path === '/bad' ? { ok: false, status: 400, text: async () => 'No such folder.' } : { ok: true };
  } });
  await t.D.files.serverInfo();
  t.I.ACT.folder();
  assert.equal(t.S.dialog, 'folder');
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.deepEqual(t.S.folderSugs, [{ name: 'a', folder: '/a' }]);
  t.S.folderPath = '/bad';
  await t.I.SUB['folder-switch']();
  assert.equal(t.S.folderErr, 'No such folder.');
  assert.equal(t.S.folderBusy, false);
  assert.equal(t.location.reloaded, 0);
  t.S.folderPath = '/good';
  await t.I.SUB['folder-switch']();
  assert.equal(t.location.reloaded, 1);
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

const goodFiles = "(function () { 'use strict'; var Q = { jobs: [] }; function f(a) { setTimeout(f, 1); return fetch(a); } D.files = { get Q() { return Q; }, f: f }; })();\n";
const smallCore = 'var D = { core: {} };\nfunction parse(t) { return t; }\n';

test('files: a good file passes', () => {
  assert.deepEqual(filesProblems(goodFiles, smallCore), []);
  assert.deepEqual(filesProblems(`${goodFiles}var x = parse('document.title and S.m');\n`, smallCore), []);
});

test('files: fails when it knows of state or Items, uses the DOM, or uses anything outside itself and core', () => {
  for (const use of ['S.m', 'S', 'OPS.x', 'j.items', 'j.meta', 'm.people', 'document.title', 'window.x', 'location.reload()', 'render()', 'toastShow(a)', 'localStorage.x', 'parseFake(a)'])
    assert.ok(filesProblems(`${goodFiles}function g(a) { return ${use}; }\n`, smallCore).length, use);
});

const goodModel = "(function () { 'use strict'; var S = { a: 1 }; function f(k) { return parse(localStorage.getItem(k)); } D.model = { S: S, f: f }; D.files.install('folderState', f); })();\n";

test('model: a good file passes, and quiet words are not uses', () => {
  assert.deepEqual(modelProblems(goodModel, smallCore), []);
  assert.deepEqual(modelProblems(`${goodModel}var x = 'document.title and a < b'; // window.x\n`, smallCore), []);
});

test('model: fails when it uses the DOM or anything outside itself and core', () => {
  for (const use of ['document.title', 'window.innerWidth', 'location.hash', 'fetch(a)', 'indexedDB.open(a)', 'setTimeout(f)', 'render()', 'OPS.x', 'commit(a)', 'esc(a)'])
    assert.ok(modelProblems(`${goodModel}function g(a) { return ${use}; }\n`, smallCore).length, use);
});

test('model: fails when it reaches files for anything but its hook', () => {
  for (const use of ['D.files.writeText(a, a)', 'D.files.requestSync()', 'D.files.Q.jobs', 'D.files.kick()', 'D.files.srv'])
    assert.match(modelProblems(`${goodModel}function g(a) { return ${use}; }\n`, smallCore).join(), /never changes files/, use);
});

test('model: fails when it builds markup, in a string or a template', () => {
  for (const use of [`'<div class="x">'`, `"<span>"`, `'</div>'`, `'  <b>'`, '`<li>${a}</li>`'])
    assert.match(modelProblems(`${goodModel}function g(a) { return ${use}; }\n`, smallCore).join(), /builds markup/, use);
  assert.deepEqual(markupProblems('model', "var a = '<' + b; var c = x < y; var d = '< 3';"), []);
});

const goodOps = "(function () { 'use strict'; var S = D.model.S; function f(a) { setTimeout(f, 1); console.error(a); D.files.fire('redraw'); return parse(a); } D.ops = { f: f }; D.files.install('toast', f); })();\n";

test('ops: a good file passes, and quiet words are not uses', () => {
  assert.deepEqual(opsProblems(goodOps, smallCore), []);
  assert.deepEqual(opsProblems(`${goodOps}var x = 'document.title and a < b'; // window.x\n`, smallCore), []);
});

test('ops: fails when it uses the DOM, location or anything else outside itself and core', () => {
  for (const use of ['document.title', 'window.innerWidth', 'location.hash', 'localStorage.x', 'fetch(a)', 'render()', 'go(a)', 'focusLater(a)', 'esc(a)', 'requestAnimationFrame(a)'])
    assert.ok(opsProblems(`${goodOps}function g(a) { return ${use}; }\n`, smallCore).length, use);
});

test('ops: fails when it builds markup, in a string or a template', () => {
  for (const use of [`'<div class="x">'`, `"<span>"`, `'</div>'`, '`<li>${a}</li>`'])
    assert.match(opsProblems(`${goodOps}function g(a) { return ${use}; }\n`, smallCore).join(), /builds markup/, use);
});

test('ops: fails when it reaches a concern after it, fires a hook not its own, or leans on the page\'s script', () => {
  assert.match(namespaceProblems('ops', 'D.links.go(); ').join(), /ops uses D\.links/);
  assert.match(namespaceProblems('ops', 'D.views.page(); ').join(), /ops uses D\.views/);
  assert.match(namespaceProblems('ops', 'D.model.S = 1; ').join(), /assigns to D\.model\.S/);
  assert.match(hookProblems([{ concern: 'ops', src: "D.files.fire('toast', 'x');" }]).join(), /ops fires toast/);
  assert.match(hookProblems([{ concern: 'ops', src: "D.files.install('redraw', f);" }]).join(), /ops installs redraw/);
  assert.deepEqual(hookProblems([{ concern: 'ops', src: "D.files.fire('redraw'); D.files.install('toast', f); D.files.install('runJob', f); D.files.install('afterJob', f);" }]), []);
  assert.match(inlineCallProblems('ops', 'select(a);', 'function select(a) {}').join(), /calls select\(\) bare/);
});

const goodLinks = "(function () { 'use strict'; var S = D.model.S, nav = { hashOwn: '' }; function f(a) { if (location.hash !== nav.hashOwn) return encodeURIComponent(a); location.replace(a); location.hash = a; return parse(D.model.item(a)); } D.links = { f: f, nav: nav }; })();\n";

test('links: a good file passes, and quiet words are not uses', () => {
  assert.deepEqual(linksProblems(goodLinks, smallCore), []);
  assert.deepEqual(linksProblems(`${goodLinks}var x = 'D.ops.commit(a) and document.title and a < b'; // go(a)\n`, smallCore), []);
});

test('links: fails when it changes Items, navigates, uses the DOM or anything else outside itself and core', () => {
  for (const use of ['D.ops.commit(a)', 'D.ops.toastShow(a)', 'go(a)', 'select(a)', 'openLink(a)', 'render()', 'focusLater(a)', 'document.title', 'window.innerWidth', 'fetch(a)', 'localStorage.x', 'OPS.ack(a)', 'commit(a)'])
    assert.ok(linksProblems(`${goodLinks}function g(a) { return ${use}; }\n`, smallCore).length, use);
});

test('links: fails when it uses the address for more than the hash', () => {
  for (const use of ['location.href', 'location.reload()', 'location.assign(a)', 'location', 'location.pathname'])
    assert.match(linksProblems(`${goodLinks}function g(a) { return ${use}; }\n`, smallCore).join(), /location for more than the hash/, use);
});

test('links: fails when it builds markup, in a string or a template', () => {
  for (const use of [`'<div class="x">'`, `"<span>"`, '`<li>${a}</li>`'])
    assert.match(linksProblems(`${goodLinks}function g(a) { return ${use}; }\n`, smallCore).join(), /builds markup/, use);
});

test('links: fails when it reaches a concern after it, sets off any hook, or leans on the page\'s script', () => {
  assert.match(namespaceProblems('links', 'D.views.page(); ').join(), /links uses D\.views/);
  assert.match(namespaceProblems('links', 'D.input.go(); ').join(), /links uses D\.input/);
  assert.match(namespaceProblems('links', 'D.model.S = 1; ').join(), /assigns to D\.model\.S/);
  assert.match(hookProblems([{ concern: 'links', src: "D.files.fire('redraw');" }]).join(), /links fires redraw/);
  assert.match(hookProblems([{ concern: 'links', src: "D.files.install('afterDraw', f);" }]).join(), /links installs afterDraw/);
  assert.match(inlineCallProblems('links', 'go(a);', 'function go(a) {}').join(), /calls go\(\) bare/);
});

const goodViews = "(function () { 'use strict'; var S = D.model.S; function f(a) { return parse(a) + S.view + D.files.srv + D.files.Q.jobs.length + D.links.nav.offView + D.links.search(a) + D.model.item(a) + D.views.f(a); } D.views = { f: f }; })();\n";

test('views: a good file passes, and reading or quiet words are not uses', () => {
  assert.deepEqual(viewsProblems(goodViews, smallCore), []);
  for (const quiet of ['S.view === a', 'S.view == a', 'S.n != a', 'S.n <= 1', 'S.n >= 1', "'document.title and S.view = a and D.ops.commit(a)'", 'S.m.items.filter(f).length', 'S.m.items.slice().sort(f)', 'D.model.forced.has(a)'])
    assert.deepEqual(viewsProblems(`${goodViews}function g(a) { return ${quiet}; }\n`, smallCore), [], quiet);
});

test('views: fails when it uses ops, files beyond Q and srv, the DOM, fetch or the page\'s script', () => {
  for (const use of ['D.ops.commit(a)', 'D.ops.toastShow(a)', 'D.files.kick()', 'D.files.writeText(a, a)', 'D.files.dir', 'document.title', 'window.innerWidth', 'location.hash', 'fetch(a)', 'localStorage.x', 'setTimeout(a)', 'render()', 'go(a)', 'commit(a)', 'toggleDone(a)'])
    assert.ok(viewsProblems(`${goodViews}function g(a) { return ${use}; }\n`, smallCore).length, use);
});

test('views: fails when it changes app state, however it goes about it', () => {
  for (const use of ['S.view = a', 'S.m.x = a', 'S.wb[a] = 1', 'S.n++', '--S.n', 'S.n += 1', 'delete S.x', 'S.toasts.push(a)', 'S.fresh.add(a)', 'S.fresh.clear()', 'D.model.S.view = a', 'D.files.Q.blocked = a', 'D.files.Q.jobs.push(a)', 'D.links.nav.offView = a', 'D.model.forced.add(a)', 'D.model.forceClear(a)', 'D.model.lsSet(a, a)', 'D.model.setSettings(a)', 'D.links.syncLink()'])
    assert.match(viewsProblems(`${goodViews}function g(a) { return ${use}; }\n`, smallCore).join(), /changes|calls/, use);
});

test('views: fails when it reaches a concern after it, sets off any hook, or leans on the page\'s script', () => {
  assert.match(namespaceProblems('views', 'D.render.render();').join(), /views uses D\.render/);
  assert.match(namespaceProblems('views', 'D.input.go();').join(), /views uses D\.input/);
  assert.match(namespaceProblems('views', 'D.model.S = 1;').join(), /assigns to D\.model\.S/);
  assert.deepEqual(namespaceProblems('views', 'D.views = {}; D.views.page(); D.links.search(a); D.ops;'), []);
  assert.match(hookProblems([{ concern: 'views', src: "D.files.install('afterDraw', f);" }]).join(), /views installs afterDraw/);
  assert.match(inlineCallProblems('views', 'go(a);', 'function go(a) {}').join(), /calls go\(\) bare/);
});

test('views: the offers are read from either way of adding them', () => {
  assert.deepEqual(viewsOffers('D.views = { a: a, b: b };'), ['a', 'b']);
  assert.deepEqual(viewsOffers('Object.assign(D.views, { c: c });'), ['c']);
  assert.equal(viewsOffers('var a = 1;'), null);
});

const goodRender = "(function () { 'use strict'; var S = D.model.S, q = false; function f(a) { var t = document.createElement(a); t.innerHTML = D.views.page(); S.width = window.innerWidth; console.error(a); requestAnimationFrame(f); D.files.fire('afterDraw'); return parse(a) + S.focusSel; } D.render = { get q() { return q; }, f: f }; D.files.install('redraw', f); })();\n";

test('render: a good file passes, and quiet words are not uses', () => {
  assert.deepEqual(renderProblems(goodRender, smallCore), []);
  assert.deepEqual(hookProblems([{ concern: 'render', src: goodRender }]), []);
  assert.deepEqual(renderProblems(`${goodRender}// S.view and item(a) and data-row\nvar x = 'S.view and inboxCount';\n`, smallCore), []);
});

test('render: fails when it knows what a View means, or uses anything else outside itself and core', () => {
  for (const use of ['S.view', 'D.model.item(a)', 'item(a)', 'D.model.inboxCount()', "'.main [data-row]'", 'toggleDone(a)', 'go(a)', 'vRow(a)', 'fetch(a)', 'localStorage.x', 'location.hash'])
    assert.ok(renderProblems(`${goodRender}function g(a) { return ${use}; }\n`, smallCore).length, use);
});

test('render: fails when it reaches a concern after it, or sets off a hook not its own', () => {
  assert.match(namespaceProblems('render', 'D.input.go();').join(), /render uses D\.input/);
  assert.match(namespaceProblems('render', 'D.views.page = f;').join(), /assigns to D\.views\.page/);
  assert.match(hookProblems([{ concern: 'render', src: "D.files.fire('redraw');" }]).join(), /render fires redraw/);
  assert.match(hookProblems([{ concern: 'render', src: "D.files.install('afterDraw', f);" }]).join(), /render installs afterDraw/);
});

const goodInput = "(function () { 'use strict'; var S = D.model.S; function f(a) { document.querySelector(a); window.innerWidth; location.reload(); navigator.clipboard; setTimeout(f, 1); setInterval(f, 1); requestAnimationFrame(f); console.error(a); setThemeColor(a); D.ops.commit(a); D.links.nav.linkPush = true; D.render.render(); D.views.viewFor(); return parse(a) + S.view; } D.input = { f: f }; D.files.install('afterDraw', f); })();\n";

test('input: a good file passes, and quiet words are not uses', () => {
  assert.deepEqual(inputProblems(goodInput, smallCore), []);
  assert.deepEqual(hookProblems([{ concern: 'input', src: goodInput }]), []);
  assert.deepEqual(namespaceProblems('input', goodInput), []);
  assert.deepEqual(inputProblems(`${goodInput}// fetch(a) and '<div>'\nvar x = 'fetch(a) and localStorage and a < b';\n`, smallCore), []);
});

test('input: fails when it builds markup, in a string or a template', () => {
  for (const use of ["'<div>' + a", '"<span class=x>"', '`<b>${a}</b>`', "'</div>'"])
    assert.match(inputProblems(`${goodInput}function g(a) { return ${use}; }\n`, smallCore).join(), /builds markup/, use);
});

test('input: fails when it reaches round a concern, by the browser or the page\'s script', () => {
  for (const use of ['fetch(a)', 'localStorage.x', 'indexedDB.open(a)', 'boot()', 'vRow(a)', 'commit(a)', 'kick()'])
    assert.ok(inputProblems(`${goodInput}function g(a) { return ${use}; }\n`, smallCore).length, use);
});

test('input: fails when it reaches a concern after it, or sets off a hook not its own', () => {
  assert.match(namespaceProblems('input', 'D.main.boot();').join(), /input uses D\.main/);
  assert.match(namespaceProblems('input', 'D.ops.commit = f;').join(), /assigns to D\.ops\.commit/);
  assert.match(namespaceProblems('input', 'D.render.render = f;').join(), /assigns to D\.render\.render/);
  assert.match(hookProblems([{ concern: 'input', src: "D.files.fire('redraw');" }]).join(), /input fires redraw/);
  assert.match(hookProblems([{ concern: 'input', src: "D.files.fire('afterDraw');" }]).join(), /input fires afterDraw/);
  assert.match(hookProblems([{ concern: 'input', src: "D.files.install('toast', f);" }]).join(), /input installs toast/);
  assert.match(inlineCallProblems('input', 'boot();', 'function boot() {}').join(), /calls boot\(\) bare/);
});

test('only render writes markup to the page', () => {
  for (const use of ['a.innerHTML = b', 'a.outerHTML = b', "a.insertAdjacentHTML('beforeend', b)"])
    assert.match(innerHtmlProblems('views', `${use};`).join(), /only render/, use);
  assert.deepEqual(innerHtmlProblems('views', "var a = b.innerHTML; var c = b.innerHTML === d; var e = 'x.innerHTML = y';"), []);
});

test('a local D hiding the namespace fails, and so does any alias but S', () => {
  assert.match(shadowProblems('x', 'function f(k) { var D = EDEF[k]; return D.key; }').join(), /local D/);
  assert.match(shadowProblems('x', 'function f(D) { return D.key; }').join(), /local D/);
  assert.deepEqual(shadowProblems('x', 'function f(k) { var kindDef = EDEF[k]; return D.model.x(kindDef); } var a = { D: 1 };'), []);
  assert.deepEqual(aliasProblems('x', 'var S = D.model.S;\nvar n = D.model.item(id);\n'), []);
  assert.match(aliasProblems('x', 'var Q = D.files.Q;').join(), /aliases D\.files\.Q as Q/);
  assert.match(aliasProblems('x', 'function f() { var i = D.model.item, j = 1; }').join(), /aliases D\.model\.item as i/);
  assert.match(aliasProblems('x', 'var T = D.model.S;').join(), /aliases D\.model\.S as T/);
});

test('namespaces: a concern fails when it uses one after it, or assigns to another\'s', () => {
  assert.deepEqual(namespaceProblems('files', 'D.core.parse(x); D.files = {}; D.files.kick();'), []);
  assert.match(namespaceProblems('files', 'D.model.S;').join(), /uses D\.model/);
  assert.match(namespaceProblems('model', 'D.input.go();').join(), /uses D\.input/);
  assert.match(namespaceProblems('model', 'D.files = {};').join(), /assigns to D\.files/);
  assert.match(namespaceProblems('model', 'D.files.kick = f;').join(), /assigns to D\.files\.kick/);
  assert.deepEqual(namespaceProblems('model', 'D.files.Q.blocked = null; if (D.files.srv == null) f();'), []);
  assert.deepEqual(namespaceProblems('files', "var a = 'D.model.S'; // D.model.S\n"), []);
});

test('bare calls: a concern fails when it calls a function from the page\'s own script', () => {
  const inline = 'var S = {}; function render() { function inner() {} return inner(); }';
  assert.match(inlineCallProblems('files', 'render();', inline).join(), /calls render\(\) bare/);
  assert.deepEqual(inlineCallProblems('files', 'x.render(); inner(); var a = "render()";', inline), []);
});

test('hooks: the table\'s own firers and installers pass, and the page\'s script may stand in', () => {
  const good = [
    { concern: 'files', src: "function fire(name, arg) { return on[name](arg); } function install(name, fn) {} fire('redraw'); fire('toast', 'x'); fire('runJob', j); fire('afterJob'); fire('folderState', {});" },
    { concern: 'ops', src: "D.files.fire('redraw'); D.files.install('toast', f);" },
    { concern: 'model', src: "D.files.install('folderState', f);" },
    { concern: 'page', src: "D.files.install('redraw', f);" },
  ];
  assert.deepEqual(hookProblems(good), []);
});

test('hooks: fails on a name not in the table, or one that is not a plain string', () => {
  assert.match(hookProblems([{ concern: 'files', src: "fire('nope');" }]).join(), /nope, which isn't in the table/);
  assert.match(hookProblems([{ concern: 'page', src: "D.files.install('nope', f);" }]).join(), /nope, which isn't in the table/);
  assert.match(hookProblems([{ concern: 'files', src: 'fire(name);' }]).join(), /not a plain string/);
  assert.match(hookProblems([{ concern: 'files', src: "fire('constructor');" }]).join(), /constructor, which isn't in the table/);
});

test('hooks: fails when a concern fires or installs a hook its row doesn\'t name', () => {
  assert.match(hookProblems([{ concern: 'model', src: "D.files.fire('redraw');" }]).join(), /model fires redraw/);
  assert.match(hookProblems([{ concern: 'ops', src: "D.files.fire('toast', 'x');" }]).join(), /ops fires toast/);
  assert.match(hookProblems([{ concern: 'input', src: "D.files.install('redraw', f);" }]).join(), /input installs redraw/);
  for (const concern of ['core', 'views', 'main'])
    assert.match(hookProblems([{ concern, src: "D.files.fire('redraw');" }]).join(), new RegExp(`${concern} fires redraw`));
});

test('hooks: fails when a hook is installed twice across the concerns and the page\'s own script', () => {
  assert.match(hookProblems([{ concern: 'render', src: "D.files.install('redraw', f);" }, { concern: 'page', src: "D.files.install('redraw', g);" }]).join(), /redraw is installed more than once/);
});

test('hooks: once main has landed, every hook needs an installer', () => {
  assert.match(hookProblems([], { mainLanded: true }).join(), /afterDraw has no installer/);
  assert.deepEqual(hookProblems([]), []);
});

test('hooks: a mention in a comment isn\'t a call', () => {
  assert.deepEqual(hookProblems([{ concern: 'views', src: "// fire('redraw')\nvar a = 1; /* install('nope', f) */" }]), []);
});
