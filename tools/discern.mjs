#!/usr/bin/env node
// discern.mjs: the deterministic half of every Discerny source skill (see SOURCE-SKILLS.md).
// Node 18 or later, no dependencies. It reuses the file parser in discerny.html (the block between
// //<core> and //</core>), so the UI and this helper can never disagree about the format.
//
//   node tools/discern.mjs <command> [args] [--dir <folder>] [--now <ISO time>]
//   node tools/discern.mjs --version   prints the app's version (VERSION in discerny.html)
//
// Commands: connect, new, state, match, who, local, add, propose, meetings, ignore, comment, change, ref, commit, log, check, upgrade, serve.
// Input for match, add, propose, meetings, ignore and log comes on stdin (JSON, or text for log); output is JSON on stdout.
// Exit codes: 0 done, 1 invalid input (the message says what to fix), 2 the user must decide.
// Every command but connect, new, check, upgrade and --version refuses a data folder in another Format, with exit 2.
//
// The app (this helper, the UI, the skills) and the user's data live in separate folders. The data folder
// is --dir, else $DISCERNY_DIR, else data_folder in config.toml in the app folder, which connect and new write.
// An app folder from an earlier build may still have data-folder.txt instead, which is read until the next connect or new.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const CONFIG = path.join(REPO, 'config.toml');
const LINK = path.join(REPO, 'data-folder.txt');
const MIGRATIONS = path.join(REPO, 'migrations');
const STARTER = path.join(REPO, 'new_discerny_repo');
const DAY = 864e5, HOUR = 36e5;

// ---------------------------------------------------------------- arguments and output
const argv = process.argv.slice(2);
const OPT = { dir: '', now: process.env.DISCERN_NOW || '', write: false, dry: false, zone: '', one: false, done: '', port: '4790', author: '', ack: false, field: null, to: null, suggests: '' };
const ARGS = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dir') OPT.dir = argv[++i];
  else if (a === '--now') OPT.now = argv[++i];
  else if (a === '--zone') OPT.zone = argv[++i];
  else if (a === '--write') OPT.write = true;
  else if (a === '--dry-run') OPT.dry = true;
  else if (a === '--one') OPT.one = true;
  else if (a === '--done') OPT.done = argv[++i] || '';
  else if (a === '--port') OPT.port = argv[++i] || '';
  else if (a === '--author') OPT.author = argv[++i] || '';
  else if (a === '--to-acknowledge') OPT.ack = true;
  else if (a === '--field') OPT.field = argv[++i] || '';
  else if (a === '--to') OPT.to = argv[++i] ?? '';
  else if (a === '--suggests') OPT.suggests = argv[++i] || '';
  else ARGS.push(a);
}
// ---------------------------------------------------------------- config.toml
// The App folder's settings. The helper reads and writes a subset of TOML itself, with no dependencies:
// comments, blank lines, [table] headings, and key = value with a basic or literal string, an integer or a boolean.
const UNESCAPE = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
// The settings as { top: { key: { value, line } }, tables: { name: { key: { value, line } } }, firstTable, lines, eol }.
// Throws an Error naming the line for anything outside the subset.
function parseConfig(text) {
  const eol = eolOf(text), lines = text.split(/\r?\n/);
  const top = {}, tables = {};
  let cur = top, firstTable = -1;
  lines.forEach((ln, i) => {
    const where = `config.toml line ${i + 1}`;
    const rest = (s) => { if (!/^\s*(#.*)?$/.test(s)) throw new Error(`${where}: unexpected "${s.trim()}" after the value; put a comment after #`); };
    if (/^\s*(#.*)?$/.test(ln)) return;
    const h = /^\s*\[\s*([A-Za-z0-9_-]+)\s*\](.*)$/.exec(ln);
    if (h) {
      rest(h[2]);
      if (tables[h[1]]) throw new Error(`${where}: [${h[1]}] appears twice; keep one`);
      cur = tables[h[1]] = {};
      if (firstTable < 0) firstTable = i;
      return;
    }
    const kv = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(ln);
    if (!kv) throw new Error(`${where}: "${ln.trim()}" is not key = value, a [table] heading or a # comment`);
    const [, key, v] = kv;
    let m, value;
    if ((m = /^'([^'\r\n]*)'(.*)$/.exec(v))) value = m[1];
    else if ((m = /^"((?:[^"\\]|\\.)*)"(.*)$/.exec(v))) {
      value = m[1].replace(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g, (s, c) => {
        if (c.length > 1) return String.fromCodePoint(parseInt(c.slice(1), 16));
        if (!(c in UNESCAPE)) throw new Error(`${where}: \\${c} is not an escape TOML knows; write \\\\ for a backslash, or use single quotes`);
        return UNESCAPE[c];
      });
    } else if ((m = /^([+-]?(?:0|[1-9](?:_?\d)*))(?![\w.:-])(.*)$/.exec(v))) value = Number(m[1].replace(/_/g, ''));
    else if ((m = /^(true|false)(?![\w.-])(.*)$/.exec(v))) value = m[1] === 'true';
    else throw new Error(`${where}: the value of ${key} must be a 'string', a "string", a whole number, true or false`);
    rest(m[m.length - 1]);
    if (cur[key]) throw new Error(`${where}: ${key} is set twice; keep one`);
    cur[key] = { value, line: i };
  });
  return { top, tables, firstTable, lines, eol };
}
function configText() { try { return fs.readFileSync(CONFIG, 'utf8'); } catch (e) { return ''; } }
// A TOML string: literal ('...') so Windows paths need no escaping, or basic ("...") when it holds a '.
function tomlString(s) { return s.includes("'") ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : `'${s}'`; }
// Sets data_folder in config.toml, changing no other line and making the file if it is missing, and retires data-folder.txt.
// Throws, writing nothing, when config.toml can't be read.
function connectTo(d) {
  const text = configText();
  const cfg = parseConfig(text ||'# Settings for this Discerny app folder. discern connect and discern new write data_folder; the rest is yours to edit.\n');
  const { lines, eol } = cfg, line = `data_folder = ${tomlString(d)}`, had = cfg.top.data_folder;
  if (had) lines[had.line] = line;
  else if (cfg.firstTable >= 0) lines.splice(cfg.firstTable, 0, line);
  else { while (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push(line, ''); }
  fs.writeFileSync(CONFIG, lines.join(eol));
  fs.rmSync(LINK, { force: true });
}
function linked() { try { return fs.readFileSync(LINK, 'utf8').trim(); } catch (e) { return ''; } }
// The folder connect and new last recorded, and where: [folder, 'config.toml' | 'data-folder.txt'], or ['', ''].
// Throws, as parseConfig does, when config.toml can't be read.
function connected() {
  const configured = (parseConfig(configText()).top.data_folder || {}).value;
  return configured ? [path.resolve(REPO, configured), 'config.toml']
    : linked() ? [path.resolve(REPO, linked()), 'data-folder.txt'] : ['', ''];
}
const [DIR, FROM] = OPT.dir ? [path.resolve(OPT.dir), '--dir']
  : process.env.DISCERNY_DIR ? [path.resolve(process.env.DISCERNY_DIR), 'DISCERNY_DIR']
  : (() => { try { return connected(); } catch (e) { fail(e.message); } })();
const NOT_CONNECTED = 'no data folder is connected. Ask the user which folder holds their Discerny data, then run: discern connect <folder>; or start one with: discern new <folder>';
function isDataFolder(d) { return fs.existsSync(path.join(d, 'TASKS.md')); }
function notDataFolder(d, want) { return `${d} has no TASKS.md, so it is not a Discerny data folder. To start a new one there, run: discern new ${want}`; }

function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
function fail(msg, code = 1) { out({ error: msg }); process.exit(code); }
function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; } }
function stdinJson() {
  const t = readStdin().trim();
  if (!t) fail('expected JSON on stdin');
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : [v]; } catch (e) { fail('stdin is not valid JSON: ' + e.message); }
}
// The JSON keys of older Formats, which are not read, and what each one is now, by command.
const OLD_KEYS = {
  match: { sender_name: 'sender-name', recipient_name: 'recipient-name', meeting_date: 'meeting-date', meeting_start: 'meeting-start', new_time: 'new-time', event_id: 'event-id' },
  add: { ty: 'type', prj: 'projects', tg: 'tags', top: 'tags', urg: 'urgency', p: 'priority', due: 'due-date and due-time', st: 'status', dep: 'dependencies',
    src: 'origin', refs: 'source-keys', asg: 'received-datetime', received: 'received-datetime', meeting_subject: 'meeting-subject' },
  propose: { received: 'received-datetime', event_date: 'event-date' },
  meetings: { event_id: 'event-id', organizer_name: 'organizer-name', web_link: 'web-link' },
  ignore: { ref: 'source-key' },
};
// Refuses the whole input when any row uses an old key, naming each one and its new name.
function refuseOldKeys(cmd, rows, what) {
  const old = OLD_KEYS[cmd], found = [];
  rows.forEach((r, i) => { if (r && typeof r === 'object') Object.keys(r).forEach(k => { if (Object.hasOwn(old, k)) found.push(`${what} ${i}: ${k} is an old name, not read: write ${old[k]}`); }); });
  if (found.length) fail('nothing was written. Every key is named as the Format names its fields, with hyphens. ' + found.join(' | '));
}

// ---------------------------------------------------------------- the shared parser from the UI
function loadCore() {
  const p = path.join(REPO, 'discerny.html');
  const html = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const a = html.indexOf('//<core>'), b = html.indexOf('//</core>');
  if (a < 0 || b < a) fail('no //<core> ... //</core> block found in discerny.html next to tools/');
  const names = ['VERSION', 'FORMAT', 'versionCmp', 'formatOf', 'formatIs', 'parse','serItem', 'nextId', 'getSub', 'pParse', 'eParse', 'TYPES', 'URG_ORDER', 'STATUS', 'PRIORITIES', 'FILES', 'WATCH',
    'CHANGES_HEAD', 'changesOf', 'changeKey', 'relLine', 'REL_RE', 'NOTE_RE', 'LOG_RE', 'serSub', 'placeSub', 'ITEM_RANK', 'PERSON_RANK', 'ENT_RANK', 'setDesc', 'addComment', 'USER_ID',
    'pSerItem', 'commentsOf', 'CHANGE_FIELDS', 'fieldChange', 'priorityPaused', 'PRIORITY_PAUSE', 'dueOf', 'setDue', 'ignoredOf', 'ignoredLine', 'addHistory'];
  const ret = '{' + names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ') + '}';
  try { return new Function(`'use strict';\n${html.slice(a + 8, b)}\n;return ${ret};`)(); }
  catch (e) { fail(`the //<core> block in discerny.html did not load: ${e.message}`); }
}
const C = loadCore();

// ---------------------------------------------------------------- files
function fp(f) { return path.join(DIR, f); }
function read(f) { return fs.existsSync(fp(f)) ? fs.readFileSync(fp(f), 'utf8') : ''; }
function eolOf(t) { return /\r\n/.test(t) ? '\r\n' : '\n'; }
function write(f, text) {
  if (!String(text).trim()) fail(`refusing to leave ${f} empty`);
  fs.writeFileSync(fp(f), text);
}
function appendLines(f, lines, header) {
  let t = read(f);
  if (!t.trim()) t = header + '\n';
  const eol = eolOf(t);
  if (!t.endsWith('\n')) t += eol;
  write(f, t + lines.join(eol) + eol);
}
// The headers of the starter files, word for word, for a file that is missing or empty.
const INBOX_HEAD = ['# Inbox',
  '<!-- Proposals from the discern-* source skills, waiting for the user to clarify them.',
  '     New items come first: Accept moves an item to TASKS.md; Dismiss remembers its message in',
  '     DISMISSED.md.',
  '     IDs come from the next-id counter in TASKS.md.',
  '     Changes to records follow under "## Changes", one line each with a "- why:" sub-line: a',
  '     Relationship, a new person, a new email address or a Priority person, which the user answers Yes or',
  '     No. -->', ''].join('\n');
const IGNORED_HEAD = ['# Ignored',
  '<!-- One line per source key never to be proposed again, ignored by a source skill or deleted by the user:',
  '     `- <source key> {ignored-date: YYYY-MM-DD; reason: not actionable}`. Parse the braces from the final " {".',
  '     A Proposal the user dismisses goes in DISMISSED.md instead.',
  '     A No to a proposed change is kept here too, as rel|<id>|<id> (either order) or person|<address>;',
  '     a No to a Priority person is kept as priority|<P-id>, and pauses them for 28 days only. -->', ''].join('\n');
// New Items go in INBOX.md above "## Changes", and change Proposals at its end, under that heading.
function addToInbox(lines, changes) {
  let t = read('INBOX.md');
  if (!t.trim()) t = INBOX_HEAD + '\n';
  const eol = eolOf(t), ls = t.replace(/\r?\n$/, '').split(/\r?\n/), c = ls.indexOf(C.CHANGES_HEAD);
  if (c < 0) ls.push(...lines);
  else if (lines.length) {
    let at = c;
    while (at > 0 && !ls[at - 1].trim()) at--;
    ls.splice(at, 0, ...lines, ...(at === c ? [''] : []));
  }
  if (changes.length) {
    if (ls.indexOf(C.CHANGES_HEAD) < 0) { while (ls.length && !ls[ls.length - 1].trim()) ls.pop(); ls.push('', C.CHANGES_HEAD); }
    ls.push(...changes);
  }
  write('INBOX.md', ls.join(eol) + eol);
}

// ---------------------------------------------------------------- time
function nowDate() {
  const v = OPT.now;
  if (!v) return new Date();
  const d = new Date(v);
  if (isNaN(d)) fail(`--now ${v} is not an ISO time`);
  return d;
}
function iso(d) { return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
function parseDuration(s) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s || '').trim());
  if (!m) fail(`${s} is not an ISO 8601 duration such as PT2H or P1D`);
  const [, w, d, h, mi, se] = m.map(x => +x || 0);
  return (((w * 7 + d) * 24 + h) * 60 + mi) * 6e4 + se * 1e3;
}
const WINDOWS_ZONES = {
  'UTC': 'UTC', 'Coordinated Universal Time': 'UTC', 'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik', 'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw', 'GTB Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Kiev', 'E. Europe Standard Time': 'Europe/Chisinau',
  'South Africa Standard Time': 'Africa/Johannesburg', 'Israel Standard Time': 'Asia/Jerusalem',
  'Arabian Standard Time': 'Asia/Dubai', 'India Standard Time': 'Asia/Kolkata',
  'Singapore Standard Time': 'Asia/Singapore', 'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo', 'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland', 'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix', 'Pacific Standard Time': 'America/Los_Angeles',
  'Atlantic Standard Time': 'America/Halifax', 'E. South America Standard Time': 'America/Sao_Paulo',
};
function zoneOf(name) {
  if (!name) return null;
  const n = String(name).trim();
  if (WINDOWS_ZONES[n]) return WINDOWS_ZONES[n];
  try { new Intl.DateTimeFormat('en', { timeZone: n }); return n; }
  catch (e) { fail(`unknown time zone "${n}": use an IANA name such as Europe/London, or a Windows name such as GMT Standard Time`); }
}
const FMT = {};
function parts(ms, tz) {
  const f = FMT[tz] || (FMT[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const o = {}; f.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
  return o;
}
function offsetAt(ms, tz) { const p = parts(ms, tz); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; }
function wallToInstant(wall, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(wall));
  if (!m) fail(`${wall} is not a date and time`);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let t = guess - offsetAt(guess, tz);
  const o2 = offsetAt(t, tz);
  if (guess - o2 !== t) t = guess - o2;
  return new Date(t);
}
// An instant: an ISO string with Z or an offset, or {dateTime, timeZone} wall-clock time in a named zone.
function toInstant(v, zone) {
  if (v && typeof v === 'object') return wallToInstant(v.dateTime, zoneOf(v.timeZone) || 'UTC');
  const s = String(v || '');
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) { const d = new Date(s); if (!isNaN(d)) return d; }
  if (zone) return wallToInstant(s, zoneOf(zone));
  fail(`${s} has no time zone: give it with Z or an offset, or as {"dateTime": ..., "timeZone": ...}`);
}
function local(d, tz) { const p = parts(d.getTime(), tz); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; }

// ---------------------------------------------------------------- SOURCES.md
function parseSources(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks = {}; let cur = null, key = null;
  lines.forEach((ln, i) => {
    const h = /^## (.+?)\s*$/.exec(ln);
    if (h) { cur = blocks[h[1]] = { name: h[1], start: i, end: i, keys: {} }; key = null; return; }
    if (!cur) return;
    const k = /^- ([A-Za-z0-9][A-Za-z0-9_-]*):\s?(.*)$/.exec(ln);
    if (k) { key = cur.keys[k[1]] = { line: i, value: k[2].trim(), list: [], listLines: [] }; cur.end = i; return; }
    const it = /^ {2,}- (.*)$/.exec(ln);
    if (it && key) { key.list.push(it[1]); key.listLines.push(i); cur.end = i; }
  });
  return { lines, blocks };
}
function val(block, k) { return block && block.keys[k] ? block.keys[k].value : ''; }
function list(block, k) {
  if (!block || !block.keys[k]) return [];
  const e = block.keys[k];
  if (e.list.length) return e.list.map(s => s.trim()).filter(Boolean);
  return e.value ? e.value.split(',').map(s => s.trim()).filter(Boolean) : [];
}
function sources() { return parseSources(read('SOURCES.md')); }
function defaults(S) { return (S || sources()).blocks.defaults || null; }
function timezone(S) { return zoneOf(val(defaults(S), 'timezone')) || 'UTC'; }

// ---------------------------------------------------------------- people
function people() { return C.pParse(read('PEOPLE.md')).people; }
function csv(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }
function userRecord(P) {
  return (P || people()).find(p => p.meta.id === C.USER_ID) || null;
}
function personView(p) { return p ? { id: p.meta.id || null, name: p.name, emails: csv(p.meta.emails), handles: csv(p.meta.handles), manager: p.meta.manager || null } : null; }
function findPerson(q, P) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return null;
  P = P || people();
  return P.find(p => csv(p.meta.emails).some(e => e.toLowerCase() === s))
    || P.find(p => csv(p.meta.handles).some(h => h.toLowerCase() === s))
    || P.find(p => p.name.toLowerCase() === s) || firstNameOnly(s, P);
}
// A message often addresses someone by first name alone; that finds them only when no one else has it.
function firstNameOnly(s, P) {
  if (/\s|@/.test(s)) return null;
  const hits = P.filter(p => p.name.toLowerCase().split(/\s+/)[0] === s);
  return hits.length === 1 ? hits[0] : null;
}

// ---------------------------------------------------------------- refs
const PREFIX = /^\s*(re|fw|fwd|accepted|tentative|declined|canceled|cancelled|updated)\s*:\s*/i;
function normSubject(s) {
  let t = String(s || ''), notice = null, m;
  while ((m = PREFIX.exec(t))) {
    const w = m[1].toLowerCase();
    if (!['re', 'fw', 'fwd'].includes(w) && !notice) notice = w === 'cancelled' ? 'Canceled' : w[0].toUpperCase() + w.slice(1);
    t = t.slice(m[0].length);
  }
  return { subject: t.replace(/\s+/g, ' ').trim(), notice };
}
function strip19(k) { return String(k || '').replace(/^19:/, ''); }
function chatKey(chatId) { return strip19(chatId).slice(0, 20); }
function isContainer(ref) { return /\|\*$/.test(ref) || /^teams\|[^|]+$/.test(ref); }
function calRef(date, subject, suffix) { return `cal|${date}|${normSubject(subject).subject.toLowerCase()}` + (suffix ? `|${suffix}` : ''); }

function loadIndex() {
  const recs = [];
  const add = (store, it) => {
    const status = it.meta.status || '';
    C.getSub(it, 'source-key').forEach(b => recs.push({ store, id: it.id, title: it.title, status, type: it.meta.type || '', due: C.dueOf(it.meta), ref: b.v.trim() }));
  };
  C.parse(read('TASKS.md')).items.forEach(it => add(it.done ? 'done' : 'tasks', it));
  C.parse(read('INBOX.md')).items.forEach(it => add('inbox', it));
  C.parse(read('DONE.md')).items.forEach(it => add('done', it));
  C.ignoredOf(read('IGNORED.md')).forEach(g => recs.push({ store: 'ignored', id: null, status: '', ref: g.key, reason: g.fields.reason || '' }));
  dismissals().forEach(d => recs.push({ store: 'dismissed', id: null, status: '', ref: d.ref, reason: d.fields.reason || '' }));
  return recs;
}
// DISMISSED.md: one line per source key of a Proposal the user dismissed, `- <ref> {key: value; ...}`, the braces
// parsed from the final " {". Readers accept the old `key:value` spacing.
function dismissals(text = read('DISMISSED.md')) {
  const found = [];
  text.replace(/\r/g, '').split('\n').forEach((ln, line) => {
    const t = ln.replace(/^- /, '').trim(), b = t.lastIndexOf(' {'), braced = b > 0 && t.endsWith('}');
    const ref = (braced ? t.slice(0, b) : t).trim();
    if (!/^[a-z][a-z0-9-]*\|/i.test(ref)) return;
    const fields = {};
    if (braced) t.slice(b + 2, -1).split(';').forEach(p => { const i = p.indexOf(':'); if (i > 0) fields[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
    found.push({ line, ref, fields });
  });
  return found;
}
const RANK = { tasks: 0, inbox: 1, done: 2, ignored: 3, dismissed: 3 };
function storeOutcome(r) { return r.store === 'tasks' ? (r.status === 'waiting' ? 'waiting' : 'open') : r.store; }
function pick(hits) {
  const best = hits.slice().sort((a, b) => RANK[a.store] - RANK[b.store])[0];
  return { outcome: storeOutcome(best), ids: [...new Set(hits.filter(h => h.id).map(h => h.id))], store: best.store };
}

function matchMail(c, recs) {
  const s = c.norm.toLowerCase();
  const exact = [], contain = [];
  recs.forEach(r => {
    if (!r.ref.toLowerCase().startsWith('mail|')) return;
    const t = r.ref.slice(5).trim().toLowerCase();
    if (!t) return;
    if (t === s) exact.push(r);
    else { const [a, b] = t.length <= s.length ? [t, s] : [s, t]; if (a.length >= 15 && b.includes(a)) contain.push(r); }
  });
  if (exact.length) return pick(exact);
  const items = new Set(contain.map(r => r.id || r.store + ':' + r.ref));
  if (items.size === 1) return pick(contain);
  if (items.size > 1) return { outcome: 'ambiguous', ids: [...new Set(contain.filter(h => h.id).map(h => h.id))] };
  return null;
}
function matchExact(ref, recs) {
  const l = ref.toLowerCase();
  const hits = recs.filter(r => r.ref.toLowerCase() === l);
  return hits.length ? pick(hits) : null;
}
function matchTeams(c, recs) {
  const ck = c.chatKey, msg = String(c.message || '');
  const exact = [], containers = [];
  recs.forEach(r => {
    const p = r.ref.split('|');
    if (p[0].toLowerCase() !== 'teams' || p.length < 2) return;
    const k = strip19(p[1]);
    if (!k) return;
    const compatible = ck.startsWith(k) || k.startsWith(ck);
    if (p.length === 2 || p[2] === '*') { if (compatible) containers.push(r); }
    else if (msg && p[2] === msg && compatible) exact.push(r);
  });
  if (exact.length) return pick(exact);
  const ign = containers.filter(r => r.store === 'ignored');
  if (ign.length) return { outcome: 'ignored', ids: [], container: true };
  const rel = containers.filter(r => r.store === 'tasks' || r.store === 'inbox');
  if (rel.length) return { outcome: 'related', ids: [...new Set(rel.map(r => r.id))], waiting: rel.some(r => r.status === 'waiting') };
  return null;
}

// The calendar source skill tracks Meetings, so invitations and the replies to them are dropped, except
// the replies the user has to answer: a decline for a small Meeting (4 or fewer invited, or a count the
// agent couldn't find), a tentative proposing a new time, and any reply that asks something.
function needsReply(invite, it) {
  if (!['accepted', 'tentative', 'declined', 'reply'].includes(invite)) return false;
  return !!it.asks || (invite === 'declined' && !(it.invited > 4)) || (invite === 'tentative' && !!it['new-time']);
}
// When a reply to an invitation is due: a day after it was received, in the user's time zone, moving a
// Saturday or Sunday to the Monday at the same time, and never after the Meeting starts. Bank holidays are ignored.
function replyDue(received, start, tz) {
  const l = local(toInstant(received), tz);
  const next = new Date(Date.UTC(+l.slice(0, 4), +l.slice(5, 7) - 1, +l.slice(8, 10) + 1));
  const wd = next.getUTCDay();
  if (wd === 6 || wd === 0) next.setUTCDate(next.getUTCDate() + (wd === 6 ? 2 : 1));
  const due = next.toISOString().slice(0, 10) + l.slice(10);
  const starts = start ? local(toInstant(start), tz) : '';
  return starts && starts < due ? starts : due;
}
// A local "YYYY-MM-DD HH:MM" as the Format writes it: { 'due-date', 'due-time' }, the time only when there is one.
function dueFields(v) { const m = {}; C.setDue(m, v); return m; }

// What a candidate on a Meeting's thread means for it. Work the Meeting needs, or a material change to it, is a Task of its own,
// due before it starts; a new place is a Comment to acknowledge, and a new attendee a Relationship or a new person to propose;
// its time and cancellation come from the calendar.
function meetingRule(ids, meetings) {
  const id = ids.join(', '), due = ids.length === 1 ? meetings.get(ids[0]) : '';
  return { task: `a new Task related to ${id}, due before it starts${due ? ` (${due})` : ''}`,
    rest: `a new place is a Comment to acknowledge on ${id}; a new attendee is an involves Relationship to propose with ${id}, or a new person; a new time or a cancellation needs nothing: the calendar keeps ${id} in step` };
}
const meetingAction = (ids, meetings) => { const m = meetingRule(ids, meetings); return `drop, unless it is an ask, a commitment or a material change (a new agenda, a pre-read): then assess it as ${m.task}; ${m.rest}`; };

// A Source skill writes its Comments as the lowercase word for its kind of source, which its scheme gives.
const AUTHOR = { mail: 'email', teams: 'teams', cal: 'calendar' };
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
function dMon(date) { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(date || ''); return m ? `${+m[2]} ${MONTHS[+m[1] - 1]}` : '<d Mon>'; }
const firstName = (name, or) => name ? name.split(/\s+/)[0] : or;
// The command that adds a Comment to the Item a candidate matched: one to acknowledge carries news from someone else.
const oneOf = ids => ids.length === 1 ? ids[0] : `<whichever of ${ids.join(', ')} it is about>`;
function commentCmd(ids, c, text, ack, done) {
  return `discern comment ${oneOf(ids)} --author ${c.author}${ack ? ' --to-acknowledge' : ''}${done ? ' --suggests done' : ''} "${text}"`;
}
// The command that applies news changing one of an Item's fields, with a Comment for the user to acknowledge.
function changeCmd(ids, c, field, to) {
  return `discern change ${oneOf(ids)} --author ${c.author} --field ${field || '<due-date, due-time, status or who>'} --to "${to || '<the new value>'}" "<why, in a sentence>"`;
}
const NEWS = '<the news, in a sentence>';

function actionFor(res, pass, c, meetings) {
  const id = res.ids && res.ids.length ? res.ids.join(', ') : '';
  const ask = pass === 'ask', onMeeting = res.ids && res.ids.length && res.ids.every(x => meetings.has(x)), onIds = res.ids || [];
  const news = `a new Due date, status or person is a change: ${changeCmd(onIds, c)}; news that it is finished: ${commentCmd(onIds, c, NEWS, true, true)}; other news, such as an answer, is a Comment to acknowledge: ${commentCmd(onIds, c, NEWS, true)}`;
  switch (res.outcome) {
    case 'drop': return 'drop';
    case 'new': return ask ? 'classify: ask, commitment or neither' : 'assess: capture it if actionable or FYI, otherwise ignore it';
    case 'ignored': return 'drop';
    case 'dismissed': return 'drop';
    case 'done': return ask ? 'drop' : `drop, unless it reopens the work: then capture it with "reopen": true and name ${id} in its description`;
    case 'inbox': return ask ? 'drop' : onMeeting ? meetingAction(onIds, meetings) : `drop, unless it adds a date or an ask: then apply the date with ${changeCmd(onIds, c, 'due-date', '<YYYY-MM-DD>')} (and its time with --field due-time, when it has one), or tell the user of the ask: ${commentCmd(onIds, c, NEWS, true)}`;
    case 'open': return ask ? `comment: ${commentCmd(onIds, c, `You replied on ${dMon(c.when)}.`)}` : onMeeting ? meetingAction(onIds, meetings) : `drop, unless it brings news: ${news}`;
    case 'waiting': return ask ? `comment: ${commentCmd(onIds, c, `Chased ${firstName(c.who, '<who>')} on ${dMon(c.when)}.`)}`
      : `if it is from the person ${id} waits on, comment: ${commentCmd(onIds, c, `${firstName(c.who, '<their first name>')} replied on ${dMon(c.when)}: <what they said, in a sentence>`, true)}; otherwise, drop it unless it brings news: ${news}`;
    case 'related': return ask ? (res.waiting ? `drop: ${id} already waits on this chat` : 'classify: ask, commitment or neither') : `same topic as ${id}: ${news}; another topic: assess it as new`;
    case 'ambiguous': {
      if (ask) return 'classify: ask, commitment or neither';
      const mtgIds = res.ids.filter(x => meetings.has(x)), mtg = mtgIds.join(', '), other = res.ids.filter(x => !meetings.has(x));
      if (!mtg) return `if it plainly continues one of ${id}, it is news on that item: a new Due date, status or person with ${changeCmd(res.ids, c)}, else a Comment to acknowledge; otherwise assess it as new and name ${id} in its description`;
      const onOther = other.length ? `if it plainly continues ${other.length > 1 ? `one of ${other.join(', ')}, it is news on that item` : `${other[0]}, it is news on it`}: a new Due date, status or person with ${changeCmd(other, c)}, else a Comment to acknowledge; ` : '';
      const m = meetingRule(mtgIds, meetings);
      return `${onOther}an ask, a commitment or a material change (a new agenda, a pre-read) about ${mtg} is assessed as ${m.task}: name ${id} in its description; ${m.rest}; otherwise assess it as new and name ${id} in its description`;
    }
    case 'moved': return `change: ${changeCmd(res.ids, c, 'due-date', res.to)}, and ${changeCmd(res.ids, c, 'due-time', '<its HH:MM, when known>')}; then run: discern ref ${res.ids[0]} "${res.newRef}"`;
    case 'cancelled': return `report: ${id} cancelled, consider closing`;
    case 'reply': return `propose a Task "${res.title}" due ${res['due-date']}${res['due-time'] ? ' ' + res['due-time'] : ''}`;
    default: return 'assess';
  }
}

// The Format version a data folder records in DISCERNY.md, against this app's, and the message
// to give when they differ (null when they are the same).
function formatStanding(dir) {
  const f = path.join(dir, 'DISCERNY.md');
  const folder = C.formatOf(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''), is = C.formatIs(folder);
  const problem = is === 'same' ? null : `the data folder is in Format ${folder}, ${is} than this app's ${C.FORMAT}`;
  return { format: { folder, app: C.FORMAT, is }, problem };
}
// What to do about a folder in a newer Format than this app's, which no Upgrade can fix.
function newerAdvice(format) {
  return format.folder === 'next'
    ? 'An unreleased build of the app upgraded it, so no released app can read it. Tell the user to restore the backup the upgrade made beside the folder'
    : 'Tell the user to get the newer app from https://github.com/StormSleeper/discerny-app before working on this folder';
}
// Why a command refuses a data folder in another Format, and what to do about it (null when it is in this app's).
function formatRefusal(dir) {
  const { format, problem } = formatStanding(dir);
  if (!problem) return null;
  return `${problem}. ` + (format.is === 'older'
    ? 'Tell the user, and offer to upgrade it: they can ask you to "upgrade my Discerny folder", or run: discern upgrade'
    : newerAdvice(format));
}
// Records a Format version in a data folder's DISCERNY.md, making the file if it is missing.
function recordFormat(dir, version) {
  const f = path.join(dir, 'DISCERNY.md'), t = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const comment = `<!-- format: ${version} -->`;
  fs.writeFileSync(f, !t ? `# Discerny data folder\n\n${comment}\n\nThis folder holds one person's Discerny data, a task tracker kept as Markdown files whose app lives at https://github.com/StormSleeper/discerny-app.\n`
    : /<!--\s*format:\s*\S+?\s*-->/.test(t) ? t.replace(/<!--\s*format:\s*\S+?\s*-->/, comment)
    : t.replace(/^(#.*\r?\n)?/, `$1\n${comment}\n`));
}

// ---------------------------------------------------------------- commands
const CMD = {};

CMD.connect = function () {
  const want = ARGS.slice(1).join(' ').trim();
  if (!want) {
    if (!DIR) fail(NOT_CONNECTED, 2);
    out({ folder: DIR, from: FROM, ok: isDataFolder(DIR) });
    return;
  }
  const d = path.resolve(want);
  if (!isDataFolder(d)) fail(notDataFolder(d, want));
  connectTo(d);
  const warnings = process.env.DISCERNY_DIR ? ['DISCERNY_DIR is set, and it overrides config.toml until it is unset'] : [];
  const { problem } = formatStanding(d);
  if (problem) warnings.push(problem);
  out({ connected: d, warnings });
};

CMD.new = function () {
  const want = ARGS.slice(1).join(' ').trim();
  if (!want) fail('usage: discern new <folder>   (makes a data folder from new_discerny_repo and connects to it)');
  const d = path.resolve(want);
  if (fs.existsSync(d) && fs.readdirSync(d).length) fail(`${d} is not empty: choose a new or empty folder, or run discern connect ${want} if it already holds Discerny data`);
  if (!isDataFolder(STARTER)) fail(`the starter folder ${STARTER} is missing`);
  fs.cpSync(STARTER, d, { recursive: true });
  recordFormat(d, C.FORMAT);
  connectTo(d);
  out({ created: d, connected: d });
};

CMD.state = function () {
  const name = ARGS[1];
  if (!name) fail('usage: discern state <source>');
  const S = sources(), D = defaults(S), b = S.blocks[name], tz = timezone(S);
  const warnings = [];
  if (!D || !val(D, 'timezone')) warnings.push('SOURCES.md has no "## defaults" block with a timezone; times are converted as UTC');
  let now = nowDate(), fixture = null;
  if (b && val(b, 'fixture')) {
    fixture = path.resolve(DIR, val(b, 'fixture'));
    const sc = path.join(fixture, 'scenario.json');
    if (!OPT.now && fs.existsSync(sc)) { const n = JSON.parse(fs.readFileSync(sc, 'utf8')).now; if (n) now = new Date(n); }
  }
  const P = people(), u = userRecord(P);
  const user = personView(u);
  const mgr = u && u.meta.manager ? P.find(p => p.name === u.meta.manager) : null;
  const prio = list(D, 'priority-people').map(id => P.find(p => p.meta.id === id) || { name: id, meta: {}, missing: true });
  if (mgr && !prio.includes(mgr)) prio.unshift(mgr);
  prio.filter(p => p.missing).forEach(p => warnings.push(`priority-people lists ${p.name}, which is not in PEOPLE.md`));
  // The keys that repeat a SOURCES.md setting are named as it is.
  const base = {
    source: name, run_start: iso(now), timezone: tz, local_now: local(now, tz), fixture,
    'page-cap': +(val(b, 'page-cap') || val(D, 'page-cap') || 10),
    user, mention_terms: user ? [user.name.split(/\s+/)[0], ...user.handles] : [],
    'priority-people': prio.filter(p => !p.missing).map(p => ({ id: p.meta.id || null, name: p.name, emails: csv(p.meta.emails) })),
    'personal-domains': list(D, 'personal-domains'),
    'log-runs': /^true$/i.test(val(D, 'log-runs')), warnings,
  };
  if (!b) { out({ ...base, exists: false, next: `No "## ${name}" block yet. Ask the user how far back to start, then run: discern commit ${name} watermark=<ISO time>` }); process.exit(2); }
  const settings = {};
  Object.keys(b.keys).forEach(k => { settings[k] = b.keys[k].list.length ? b.keys[k].list : b.keys[k].value; });
  const kind = val(b, 'kind') || (val(b, 'lookahead') ? 'horizon' : 'stream');
  const res = { ...base, exists: true, kind, settings };
  if (kind === 'horizon') {
    res.window = { after: iso(now), before: iso(now.getTime() + parseDuration(val(b, 'lookahead') || 'P7D')) };
    res.lookback = { after: val(b, 'last-run') || iso(now.getTime() - DAY), before: iso(now) };
    out(res); return;
  }
  const gap = val(b, 'gap');
  let from, windows, mode = 'normal';
  if (gap) {
    const [g1, g2] = gap.split('/').map(s => new Date(s.trim()));
    if (isNaN(g1) || isNaN(g2) || g2 <= g1) fail(`gap: ${gap} must be <ISO start>/<ISO end>`);
    from = g1; windows = dayWindows(g1.getTime(), g2.getTime()); mode = 'backfill';
  } else {
    const wm = val(b, 'watermark');
    if (!wm) { out({ ...res, next: `"${name}" has no watermark. Ask the user how far back to start, then run: discern commit ${name} watermark=<ISO time>` }); process.exit(2); }
    from = new Date(new Date(wm).getTime() - parseDuration(val(b, 'overlap') || 'PT0S')); windows = runWindows(b, now.getTime());
  }
  res.mode = mode; res.windows = windows; res.cutoff = iso(from);
  if (mode === 'normal' && val(b, 'waiting-min-age') && val(b, 'waiting-max-age')) {
    const after = Math.max(val(b, 'waiting-checked-through') ? new Date(val(b, 'waiting-checked-through')).getTime() : 0, now.getTime() - parseDuration(val(b, 'waiting-max-age')));
    const before = now.getTime() - parseDuration(val(b, 'waiting-min-age'));
    if (after < before) { res.ask_window = { after: iso(after), before: iso(before) }; res.ask_windows = dayWindows(after, before); }
  }
  out(res);
};

// Day-long windows from from to to, except the day from split (when given), which is cut into hours.
function dayWindows(from, to, split) {
  const windows = [];
  for (let t = from, end; t < to; t = end) {
    end = Math.min(to, t >= split && t < split + DAY ? t + HOUR : t < split ? Math.min(t + DAY, split) : t + DAY);
    windows.push({ after: iso(t), before: iso(end) });
  }
  return windows;
}
// The windows state hands a stream source's Run that starts at now: from its watermark less overlap, with the
// day a Run found too big in hours.
function runWindows(b, now) {
  const split = val(b, 'split') ? Date.parse(val(b, 'split')) : undefined;
  return dayWindows(Date.parse(val(b, 'watermark')) - parseDuration(val(b, 'overlap') || 'PT0S'), now, split);
}

CMD.who = function () {
  const q = ARGS.slice(1).join(' ');
  const p = findPerson(q);
  out(p ? { query: q, name: p.name, id: p.meta.id || null } : { query: q, name: null });
};

CMD.local = function () {
  const tz = timezone();
  const one = v => { const d = toInstant(v, OPT.zone); return { input: v, local: local(d, tz), date: local(d, tz).slice(0, 10), instant: iso(d) }; };
  if (ARGS[1]) { const a = ARGS.slice(1).join(' ').trim(); out(one(a.startsWith('{') ? JSON.parse(a) : a)); }
  else out(stdinJson().map(one));
};

CMD.match = function () {
  const items = stdinJson(), recs = loadIndex(), tz = timezone(), P = people(), u = userRecord(P);
  refuseOldKeys('match', items, 'item');
  const meetings = new Map(recs.filter(x => x.id && x.type === 'meeting').map(x => [x.id, x.due]));
  const mine = new Set((u ? csv(u.meta.emails) : []).map(e => e.toLowerCase()));
  const today = local(nowDate(), tz).slice(0, 10);
  out(items.map((it, i) => {
    const scheme = String(it.scheme || '').toLowerCase(), pass = it.pass === 'ask' ? 'ask' : 'inbound';
    const sender = String(it.sender || '').toLowerCase();
    // On the ask pass the sender is always the user, so who comes from the recipient (when given) and from_user is not reported.
    const r = { key: it.key !== undefined ? it.key : i, scheme, pass };
    if (pass === 'ask') {
      const to = String(it.recipient || '').toLowerCase();
      if (to || it['recipient-name']) { const p = findPerson(to, P) || findPerson(it['recipient-name'], P); r.who = p ? p.name : null; }
    } else {
      // A calendar event the user organises is still theirs to prepare for, so only a message can be the user's own.
      const own = !!sender && mine.has(sender);
      if (scheme !== 'cal') r.from_user = own;
      if (!own && (sender || it['sender-name'])) { const p = findPerson(sender, P) || findPerson(it['sender-name'], P); r.who = p ? p.name : null; }
    }
    const c = { when: it.when ? local(toInstant(it.when), tz).slice(0, 10) : '', author: AUTHOR[scheme] };
    let res = null;
    if (scheme === 'mail') {
      const n = normSubject(it.subject);
      c.norm = n.subject; r.ref = 'mail|' + n.subject; r.refs = [r.ref];
      if (n.notice) r.notice = n.notice;
      if (it['meeting-date']) r.refs.push(calRef(it['meeting-date'], n.subject));
      const invite = String(it.invite || n.notice || '').toLowerCase().replace('canceled', 'cancelled');
      if (invite) res = needsReply(invite, it) ? { outcome: 'reply', ids: [], title: `Reply to ${r.who || it['sender-name']}: ${n.subject}`, ...dueFields(replyDue(it.when, it['meeting-start'], tz)) } : { outcome: 'drop', ids: [] };
      else {
        res = matchMail(c, recs);
        if (!res && it['meeting-date']) res = matchExact(r.refs[1], recs);
      }
    } else if (scheme === 'teams') {
      if (!it.chat || !it.message) fail(`item ${r.key}: a teams item needs chat and message`);
      c.chatKey = chatKey(it.chat); c.message = String(it.message); r.ref = `teams|${c.chatKey}|${it.message}`; r.refs = [r.ref];
      if (it['meeting-date'] && it.subject) r.refs.push(calRef(it['meeting-date'], it.subject));
      res = matchTeams(c, recs) || (it['meeting-date'] && it.subject ? matchExact(r.refs[1], recs) : null);
    } else if (scheme === 'cal') {
      const date = it.date || (it.start ? local(toInstant(it.start), tz).slice(0, 10) : '');
      if (!date || !it.subject) fail(`item ${r.key}: a cal item needs subject and date (or start)`);
      r.ref = calRef(date, it.subject, it.suffix); r.refs = [r.ref];
      if (it['event-id'] && !it.suffix) r.refs.push(`calid|${it['event-id']}`);
      res = matchExact(r.ref, recs);
      if (!res && it['event-id'] && !it.suffix) {
        const same = recs.filter(x => x.ref === `calid|${it['event-id']}` && x.id);
        if (same.length) {
          const id = same[0].id;
          const old = recs.filter(x => x.id === id && /^cal\|\d{4}-\d{2}-\d{2}\|[^|]*$/.test(x.ref)).map(x => x.ref.split('|')[1]);
          const moved = old.length && !old.includes(date) && old.every(d => d >= today);
          res = moved ? { outcome: 'moved', ids: [id], from: old[0], to: date, newRef: r.ref } : pick(same);
        }
      }
      if (it.cancelled) res = res && res.ids && res.ids.length && !['ignored', 'dismissed', 'done'].includes(res.outcome) ? { outcome: 'cancelled', ids: res.ids } : { outcome: 'drop', ids: [] };
      // A free event is a Meeting only when it is tracked and the user declined it, and it never gets prep or an invite.
      // Nothing is written for it here: discern meetings adds the calid source key to a declined one.
      else if (it.free) {
        r.refs = [];
        res = !it.suffix && res && ['open', 'inbox', 'waiting'].includes(res.outcome) ? { ...res, free: true } : { outcome: 'drop', ids: [], free: true };
      }
    } else fail(`item ${r.key}: scheme must be mail, teams or cal`);
    res = res || { outcome: 'new', ids: [] };
    if (r.from_user) res = { outcome: 'drop', ids: [] };
    c.who = r.who;
    Object.assign(r, res); r.action = r.from_user ? "drop: the user's own message" : actionFor(res, pass, c, meetings);
    if (res.free) {
      delete r.free;
      r.action = res.ids.length
        ? 'free: read it once, within the budget; if the user declined it, send it to discern meetings with "declined": true; otherwise drop it from every pass: no Meeting, prep or invite'
        : 'drop: a free event that is not a tracked Meeting';
    }
    return r;
  }));
};

function itemLine(lines, id) { return lines.findIndex(l => new RegExp(`^- \\[( |x)\\] ${id} `).test(l)); }
// An Item's or Record's lines run on while they are indented, a Description's or Comment's indented empty lines among them.
function blockEnd(lines, i) { let j = i + 1; while (j < lines.length && /^ {2,}/.test(lines[j])) j++; return j; }
const RECORD_FILES = { P: 'PEOPLE.md', PRJ: 'PROJECTS.md', SYS: 'SYSTEMS.md' };
// Rewrites the sub-lines of one Item (in TASKS.md or INBOX.md) or Record in place, keeping its own line and every other
// line of the file as they are. change gets the parsed Item or Record, with its sub-lines' rank, and edits its subs;
// returning false leaves the file alone. With head, it may change the Item's or Person's own line too.
function editSubs(id, change, head) {
  const kind = id.split('-')[0], files = kind === 'T' ? ['TASKS.md', 'INBOX.md'] : [RECORD_FILES[kind]];
  if (!files[0]) fail(`${id} is not the ID of an Item, a Person, a Project or a System`);
  for (const f of files) {
    const t = read(f); if (!t) continue;
    const eol = eolOf(t), lines = t.split(/\r?\n/);
    const i = kind === 'T' ? itemLine(lines, id) : lines.findIndex(l => /^- /.test(l) && new RegExp(`[{;]\\s*id:\\s*${id}\\s*[;}]`).test(l));
    if (i < 0) continue;
    const j = blockEnd(lines, i), block = lines.slice(i, j).join('\n');
    const [x, rank] = kind === 'T' ? [C.parse(block).items[0], C.ITEM_RANK] : kind === 'P' ? [C.pParse(block).people[0], C.PERSON_RANK] : [C.eParse(block).ents[0], C.ENT_RANK];
    if (change(x, rank) === false) return { file: f, unchanged: true };
    lines.splice(i + 1, j - i - 1, ...x.subs.flatMap(b => C.serSub(b).split('\n')));
    if (head) lines[i] = kind === 'T' ? C.serItem({ ...x, subs: [] }) : C.pSerItem({ ...x, subs: [] });
    write(f, lines.join(eol));
    return { file: f };
  }
  fail(`${id} is not in ${files.join(' or ')}`);
}
// Adds a source key to an Item, after its others, unless it already has it.
function addRef(id, ref) {
  return editSubs(id, (it, rank) => {
    if (it.subs.some(b => b.k === 'source-key' && b.v.trim() === ref)) return false;
    C.placeSub(it, { k: 'source-key', v: ref }, rank);
  });
}

// Rewrites one item's line in TASKS.md or INBOX.md in place, keeping its sub-lines as they are.
function rewriteItem(id, change) {
  for (const f of ['TASKS.md', 'INBOX.md']) {
    const t = read(f); if (!t) continue;
    const eol = eolOf(t), lines = t.split(/\r?\n/);
    const i = itemLine(lines, id); if (i < 0) continue;
    const it = C.parse(lines[i]).items[0];
    if (change(it) === false) return;
    lines[i] = C.serItem({ ...it, subs: [] });
    write(f, lines.join(eol));
    return;
  }
  fail(`${id} is not in TASKS.md or INBOX.md`);
}

// A Comment from a Skill or an Agent, stamped now in the user's time zone and appended after the item's other Comments.
// --to-acknowledge marks news from someone else, which waits in the Inbox until the user acknowledges it, and --suggests done
// news that an Item is finished, which the user can mark done from there.
function checkAuthor(author) {
  if (!/^[a-z]+$/.test(author)) fail(`--author must be one lowercase word: the Skill's (email, calendar, teams), or agent for a request from the agent queue`);
  if (author === 'user') fail('only the user writes Comments as user, in the UI: give your Skill\'s word, or agent');
}
CMD.comment = function () {
  const [, id, ...rest] = ARGS, text = rest.join(' ').replace(/\r\n?/g, '\n').trim(), author = OPT.author.trim();
  if (!id || !/^(T|P|PRJ|SYS)-\d+$/.test(id) || !text || !author) fail('usage: discern comment <id> --author <word> [--to-acknowledge [--suggests done]] <text>');
  checkAuthor(author);
  if (OPT.suggests && (OPT.suggests !== 'done' || !OPT.ack || !/^T-/.test(id))) fail('--suggests takes only done, with --to-acknowledge, on an Item: news that it is finished, which the user marks done');
  const at = local(nowDate(), timezone()), fields = OPT.suggests ? { suggests: 'done' } : null;
  out({ id, author, 'added-datetime': at, acknowledge: OPT.ack, ...(fields || {}), ...editSubs(id, (x, rank) => { C.addComment(x, { at, author, ack: OPT.ack, text, fields }, rank); }) });
};

// A Skill applies news that changes one of an Item's or a Person's fields itself, with a Comment to acknowledge naming the field,
// its old value and its new one, so the user sees it in the Inbox and can Undo it. A Person's change gets a history line too.
// The fields are CHANGE_FIELDS; the rest are the user's own judgement and organising, and closing an Item stays the user's.
// A change the Item or Person already has a Comment for, to the same value, is not applied again: a message read twice,
// or re-read after the user's Undo, changes nothing.
const USERS_OWN = ['urgency', 'priority', 'projects', 'tags', 'dependencies', 'type'];
// the field names of older Formats, which are not read, and what each one is now
const OLD_FIELDS = { due: 'due-date or due-time', st: 'status', co: 'company', dept: 'department', mgr: 'manager', urg: 'urgency', p: 'priority',
  prj: 'projects', tg: 'tags', dep: 'dependencies', ty: 'type', done: 'done-date' };
CMD.change = function () {
  const [, id, ...rest] = ARGS, why = rest.join(' ').replace(/\r\n?/g, '\n').trim(), author = OPT.author.trim();
  if (!id || !why || !author || !OPT.field || OPT.to === null) fail('usage: discern change <id> --author <word> --field <field> --to <value> <why>');
  checkAuthor(author);
  const kind = id.split('-')[0], allowed = C.CHANGE_FIELDS[kind], field = OPT.field;
  if (!/^(T|P)-\d+$/.test(id)) fail(`${id} is not an Item or a Person: a Skill changes fields only on those. Give other news as a Comment: discern comment ${id} --author ${author} --to-acknowledge "<the news>"`);
  if (Object.hasOwn(OLD_FIELDS, field)) fail(`--field ${field} is an old name, not read: write ${OLD_FIELDS[field]}`);
  const done = `closing an Item stays the user's: tell them it is finished with discern comment ${id} --author ${author} --to-acknowledge --suggests done "<the news>"`;
  if (kind === 'T' && (field === 'done-date' || (field === 'status' && /^done$/i.test(OPT.to.trim())))) fail(done);
  if (kind === 'T' && USERS_OWN.includes(field)) fail(`${field} is the user's own judgement: a Skill never changes it on an existing Item. On an Item it changes ${allowed.join(', ')}`);
  if (!allowed.includes(field)) fail(`on ${kind === 'T' ? 'an Item' : 'a Person'} discern change takes --field ${allowed.join(', ')}, not ${field}`);
  let to = cleanMeta(OPT.to);
  const names = new Set(people().map(p => p.name));
  if (field === 'due-date' && !/^\d{4}-\d{2}-\d{2}$/.test(to)) fail('--to for due-date must be YYYY-MM-DD; a time goes in due-time');
  if (field === 'due-time' && to && !/^\d{2}:\d{2}$/.test(to)) fail('--to for due-time must be HH:MM, or "" to clear it');
  if (field === 'status') {
    to = to.toLowerCase();
    if (!['', 'waiting', 'in progress'].includes(to)) fail('--to for status must be waiting, in progress, or "" to clear it');
  }
  if (field === 'who' && !names.has(to)) fail(`--to for who must be a name in PEOPLE.md exactly: propose someone new with discern propose first`);
  if (field === 'manager' && to && !names.has(to)) fail(`--to for manager must be a name in PEOPLE.md exactly`);
  if (kind === 'T' && !itemAt(id, ['TASKS.md', 'INBOX.md']) && itemAt(id, ['DONE.md'])) fail(`${id} is done: a Skill never changes a done Item`);
  const tz = timezone(), at = local(nowDate(), tz), today = at.slice(0, 10);
  let from = '', skip = '', noDay = false;
  const res = editSubs(id, (x, rank) => {
    from = x.meta[field] || '';
    if (from === to) { skip = `${field} is already ${to ? `"${to}"` : 'empty'}`; return false; }
    if (field === 'due-time' && to && !x.meta['due-date']) { noDay = true; return false; }
    if (C.commentsOf(x).some(c => { const g = C.fieldChange(c); return g && g.field === field && g.to === to; })) { skip = `${id} already has a Comment changing ${field} to ${to ? `"${to}"` : 'empty'}: a change applies once`; return false; }
    if (to) x.meta[field] = to; else delete x.meta[field];
    if (kind === 'P') { C.addHistory(x, today, field, from, to); x.meta['checked-date'] = today; }
    C.addComment(x, { at, author, ack: true, text: why, fields: { changed: field, from, to } }, rank);
  }, true);
  if (noDay) fail(`${id} has no due-date, so it can't take a due-time: change its due-date first`);
  out(skip ? { id, field, unchanged: true, why: skip, file: res.file } : { id, field, from, to, author, 'added-datetime': at, file: res.file });
};
function itemAt(id, files) { return files.some(f => itemLine(read(f).split(/\r?\n/), id) >= 0); }

CMD.ref = function () {
  const [, id, ref] = ARGS;
  if (!id || !ref || !/^[a-z][a-z0-9-]*\|/i.test(ref)) fail('usage: discern ref <T-id> <scheme|key...>');
  if (!/^T-\d+$/.test(id)) fail(`${id} is not an Item: only Items carry source keys`);  out({ id, ref, ...addRef(id, ref) });
};

function listOf(v) { return [].concat(v === undefined || v === null ? [] : v).flatMap(x => String(x).split(',')).map(x => x.trim()).filter(Boolean); }
function cleanMeta(v) { return String(v).replace(/[\r\n]+/g, ' ').replace(/;/g, ',').replace(/[{}]/g, '').trim(); }
CMD.add = function () {
  const source = ARGS[1], S = sources();
  if (!source) fail('name the source the drafts come from: discern add <source>, as its "## <source>" block in SOURCES.md does');
  if (!S.blocks[source] || source === 'defaults') fail(`SOURCES.md has no "## ${source}" block: name the source as its block does`);
  const drafts = stdinJson(), tz = timezone(S), now = nowDate();
  refuseOldKeys('add', drafts, 'draft');
  const P = people(), names = new Set(P.map(p => p.name));
  const prjIds = new Set(C.eParse(read('PROJECTS.md')).ents.map(x => x.meta.id).filter(Boolean));
  const recs = loadIndex(), known = new Set(recs.map(r => r.ref.toLowerCase()));
  const errors = [], built = [], seen = new Set();
  drafts.forEach((d, i) => {
    const e = m => errors.push(`draft ${i} (${d.title || 'untitled'}): ${m}`);
    const title = String(d.title || '').replace(/[\r\n]+/g, ' ').replace(/[{}]/g, '').trim();
    const dueDate = d['due-date'] || '', dueTime = d['due-time'] || '';
    if (!title) e('title is empty');
    if (!C.TYPES.includes(d.type)) e(`type must be one of ${C.TYPES.join(', ')}`);
    if (!C.URG_ORDER.includes(d.urgency)) e(`urgency must be one of ${C.URG_ORDER.join(', ')}`);
    if (!C.PRIORITIES.includes(d.priority)) e(`priority must be one of ${C.PRIORITIES.join(', ')}`);
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) e('due-date must be YYYY-MM-DD; a time goes in due-time');
    if (dueTime && !/^\d{2}:\d{2}$/.test(dueTime)) e('due-time must be HH:MM');
    if (dueTime && !dueDate) e('due-time goes only beside a due-date');
    if (d.status && !['waiting', 'in progress'].includes(d.status)) e('status must be waiting or in progress, or left out for to do');
    if (d.who && !names.has(d.who)) e(`who "${d.who}" is not a name in PEOPLE.md: leave who out and name the person in the description (AGENTS.md requires an exact match)`);
    const prj = listOf(d.projects);
    prj.forEach(x => { if (!prjIds.has(x)) e(`projects: ${x} is not in PROJECTS.md`); });
    if (!d.origin) e('origin is required');
    const refs = [].concat(d['source-keys'] || []).map(s => String(s).trim()).filter(Boolean);
    if (d.notes !== undefined) e('notes is retired: give the item one description, its lines joined with \\n');
    if (d.description !== undefined && typeof d.description !== 'string') e('description must be a string, its lines joined with \\n');
    if (!refs.length) e('at least one source key is required, in source-keys');
    refs.forEach(r => {
      if (!/^[a-z][a-z0-9-]*\|/i.test(r)) e(`source key "${r}" must start with a scheme such as mail|`);
      if (isContainer(r) || /^calid\|/i.test(r)) return;
      const l = r.toLowerCase();
      if (known.has(l) && !(d.reopen && recs.some(x => x.ref.toLowerCase() === l && x.store === 'done'))) e(`source key "${r}" is already in the folder: this item is a duplicate`);
      if (seen.has(l)) e(`source key "${r}" appears twice in this batch`);
      seen.add(l);
    });
    if (d.type === 'meeting' && dueDate && !refs.some(r => /^cal\|/i.test(r))) {
      const subj = d['meeting-subject'] || (refs.find(r => /^mail\|/i.test(r)) || '').slice(5);
      if (subj) refs.push(calRef(dueDate, subj));
    }
    // received-datetime is the message time, ISO with Z or an offset, or a local YYYY-MM-DD HH:MM in the user's time zone
    let received = d['received-datetime'] || '';
    if (received && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(received)) received = local(toInstant(received), tz);
    if (!received) {
      if (d.derived) received = local(now, tz);
      else e('give received-datetime (the message time, ISO with Z), or derived: true for an item made from a schedule');
    }
    const meta = { type: d.type, who: d.who ? cleanMeta(d.who) : undefined, projects: prj.length ? prj.join(', ') : undefined,
      tags: listOf(d.tags).map(t => cleanMeta(t)).filter(Boolean).join(', ') || undefined,
      urgency: d.urgency, priority: d.priority, 'due-date': dueDate || undefined, 'due-time': dueTime || undefined, status: d.status || undefined,
      dependencies: listOf(d.dependencies).join(', ') || undefined, 'received-datetime': received, source };
    Object.keys(meta).forEach(k => { if (meta[k] === undefined || meta[k] === '') delete meta[k]; else meta[k] = cleanMeta(meta[k]); });
    const x = { subs: [{ k: 'origin', v: String(d.origin || '').replace(/[\r\n]+/g, ' ') }] };
    if (typeof d.description === 'string') C.setDesc(x, d.description, C.ITEM_RANK);
    [].concat(d.links || []).forEach(l => x.subs.push({ k: 'link', v: typeof l === 'string' ? l : `[${l.label || 'link'}](${l.url})` }));
    refs.forEach(r => x.subs.push({ k: 'source-key', v: r }));
    built.push({ title, meta, subs: x.subs });
  });
  if (errors.length) fail('nothing was written. ' + errors.join(' | '));
  if (!built.length) { out({ added: [] }); return; }
  if (OPT.dry) { out({ dry_run: true, would_add: built.map(b => C.serItem({ id: 'T-????', done: false, title: b.title, meta: b.meta, subs: b.subs })) }); return; }
  const { start, next } = raiseCounter(built.length);
  const added = built.map((b, k) => ({ id: 'T-' + String(start + k).padStart(4, '0'), ...b }));
  addToInbox(added.map(a => C.serItem({ id: a.id, done: false, title: a.title, meta: a.meta, subs: a.subs }).replace(/\n/g, eolOf(read('INBOX.md') || '\n'))), []);
  out({ added: added.map(a => ({ id: a.id, title: a.title, refs: a.subs.filter(s => s.k === 'source-key').map(s => s.v) })), counter: next });
};

// Changes to records go to INBOX.md under "## Changes", for the user to answer Yes or No: a Relationship, a new person,
// a new email address for a person, or a Priority person. One the folder already has, already proposed, or said No to is
// skipped, not an error; a No to a Priority person only for PRIORITY_PAUSE days.
const EMAIL = /^[^\s@,;{}]+@[^\s@,;{}]+\.[^\s@,;{}]+$/;
CMD.propose = function () {
  const source = ARGS[1], S = sources();
  if (!source) fail('name the source the Proposals come from: discern propose <source>, as its "## <source>" block in SOURCES.md does');
  if (!S.blocks[source] || source === 'defaults') fail(`SOURCES.md has no "## ${source}" block: name the source as its block does`);
  const rows = stdinJson(), tz = timezone(S), P = people();
  refuseOldKeys('propose', rows, 'proposal');
  const items = new Map(), done = new Set();
  [['TASKS.md', 'open'], ['INBOX.md', 'inbox'], ['DONE.md', 'done']].forEach(([f, w]) => C.parse(read(f)).items.forEach(it => { if (!items.has(it.id)) items.set(it.id, w); }));
  const records = new Set([...P, ...C.eParse(read('PROJECTS.md')).ents, ...C.eParse(read('SYSTEMS.md')).ents].map(x => x.meta.id).filter(Boolean));
  const exists = id => items.has(id) || records.has(id);
  const rels = new Set(read('RELATIONSHIPS.md').replace(/\r/g, '').split('\n').map(l => C.REL_RE.exec(l)).filter(Boolean).map(m => [m[1], m[3]].sort().join('|')));
  const ignored = new Set(loadIndex().filter(r => r.store === 'ignored').map(r => r.ref.toLowerCase()));
  const pending = new Set(C.changesOf(C.parse(read('INBOX.md')).post).filter(c => c.type).map(c => c.type === 'relationship' ? [c.a, c.b].sort().join('|') : C.changeKey(c)));
  const prio = new Set(list(defaults(S), 'priority-people')), ignoredText = read('IGNORED.md'), today = local(nowDate(), tz).slice(0, 10);
  const known = new Map(P.flatMap(p => csv(p.meta.emails).map(e => [e.toLowerCase(), p])));
  const errors = [], built = [], skipped = [], batch = new Set();
  const one = s => String(s || '').replace(/[\r\n\u2028\u2029\u0085]+/g, ' ').trim();
  const meta = s => one(s).replace(/;/g, ',').replace(/[{}]/g, '');
  rows.forEach((r, i) => {
    const e = m => errors.push(`proposal ${i}: ${m}`), skip = why => skipped.push({ proposal: i, why });
    const why = one(r.why), f = [];
    if (!why) e('why is required: one line saying what the source showed');
    let when = '';
    const ev = r['event-date'], got = r['received-datetime'];
    if (ev) { if (!/^\d{4}-\d{2}-\d{2}$/.test(ev)) e('event-date must be YYYY-MM-DD'); else when = `event-date: ${ev}`; }
    else if (got) when = `received-datetime: ${/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(got) ? got : local(toInstant(got), tz)}`;
    else e('give received-datetime (the message time, ISO with Z), or event-date for a horizon source');
    const tail = [`source: ${source}`, when];
    let line, key;
    if (r.change === 'relationship') {
      const [a, b] = listOf(r.ids);
      if (!a || !b || listOf(r.ids).length !== 2) { e('ids must name the two ends, such as ["T-0007", "T-0032"]'); return; }
      [a, b].forEach(x => { if (!exists(x)) e(`${x} is not in the folder: add a new item first, then propose its Relationship with the ID add gave it`); });
      const rl = C.relLine(a, b);
      if (rl.err) { e(rl.err); return; }
      const kind = C.REL_RE.exec(rl.line)[4];
      if (r.kind && r.kind !== kind) e(`${a} and ${b} can only be ${kind}, not ${r.kind}`);
      key = [a, b].sort().join('|');
      if (rels.has(key)) return skip(`${a} and ${b} are already related`);
      if (ignored.has(`rel|${a}|${b}`.toLowerCase()) || ignored.has(`rel|${b}|${a}`.toLowerCase())) return skip(`the user said no to relating ${a} and ${b}`);
      line = `- Relate ${a} and ${b} {${[`kind: ${kind}`, ...tail].join('; ')}}`;
    } else if (r.change === 'person' || r.change === 'email') {
      const addr = one(r.email);
      if (!EMAIL.test(addr)) { e(`email "${addr}" is not an email address`); return; }
      key = `person|${addr.toLowerCase()}`;
      const p = known.get(addr.toLowerCase());
      if (p) return skip(`${addr} is already ${p.name}'s (${p.meta.id})`);
      if (ignored.has(key)) return skip(`the user said no to ${addr}`);
      if (r.change === 'person') {
        const name = meta(r.name);
        if (!name) { e('name is required'); return; }
        const same = P.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (same) { e(`${name} is already in PEOPLE.md as ${same.meta.id}: propose the address as a new email for them, with "change": "email" and "person": "${same.meta.id}"`); return; }
        const on = listOf(r.items);
        on.forEach(x => { if (!/^T-\d+$/.test(x) || !items.has(x) || items.get(x) === 'done') e(`items: ${x} is not an open or inbox item`); });
        if (r.company) f.push(`company: ${meta(r.company)}`);
        if (r.title) f.push(`title: ${meta(r.title)}`);
        if (on.length) f.push(`items: ${on.join(', ')}`);
        line = `- New person ${name} {${[`email: ${addr}`, ...f, ...tail].join('; ')}}`;
      } else {
        const p2 = P.find(x => x.meta.id === r.person);
        if (!p2) { e(`person must be the P-id of someone in PEOPLE.md, not "${r.person || ''}"`); return; }
        line = `- Add email ${addr} to ${meta(p2.name)} (${p2.meta.id}) {${tail.join('; ')}}`;
      }
    } else if (r.change === 'priority') {
      const p3 = P.find(x => x.meta.id === r.person);
      if (!p3) { e(`person must be the P-id of someone in PEOPLE.md, not "${r.person || ''}"`); return; }
      if (p3.meta.id === C.USER_ID) { e(`${C.USER_ID} is the user: only someone else can be a Priority person`); return; }
      key = `priority|${p3.meta.id}`;
      if (prio.has(p3.meta.id)) return skip(`${p3.name} (${p3.meta.id}) is already a Priority person`);
      if (C.priorityPaused(ignoredText, p3.meta.id, today)) return skip(`the user said no to ${p3.name} (${p3.meta.id}) as a Priority person less than ${C.PRIORITY_PAUSE} days ago`);
      line = `- Make ${meta(p3.name)} (${p3.meta.id}) a Priority person {${tail.join('; ')}}`;
    } else { e('change must be relationship, person, email or priority'); return; }
    if (pending.has(key)) return skip(`already proposed in the Inbox`);
    if (batch.has(key)) return skip(`appears twice in this batch`);
    batch.add(key);
    built.push([line, `  - why: ${why}`]);
  });
  if (errors.length) fail('nothing was written. ' + errors.join(' | '));
  const lines = built.map(b => b[0]);
  if (OPT.dry) { out({ dry_run: true, would_propose: lines, skipped }); return; }
  if (built.length) addToInbox([], built.flat());
  out({ proposed: lines, skipped });
};

// Raise the counter first, so an interrupted run leaves a gap, never a duplicate ID.
function raiseCounter(count) {
  let tasks = read('TASKS.md');
  if (!tasks.trim()) fail('TASKS.md is missing or empty');
  const maxId = t => C.parse(t).items.reduce((m, it) => Math.max(m, parseInt(it.id.slice(2), 10) + 1), 0);
  const start = Math.max(C.nextId(C.parse(tasks)), maxId(read('INBOX.md')), maxId(read('DONE.md')));
  const next = start + count, eol = eolOf(tasks);
  if (/<!-- next-id: \d+ -->/.test(tasks)) tasks = tasks.replace(/<!-- next-id: \d+ -->/, `<!-- next-id: ${next} -->`);
  else { const ls = tasks.split(/\r?\n/); ls.splice(1, 0, `<!-- next-id: ${next} -->`); tasks = ls.join(eol); }
  write('TASKS.md', tasks);
  return { start, next };
}

// The calendar source skill mirrors every Meeting in its window: one not yet tracked goes straight into
// TASKS.md as an open Meeting Item, keyed on its cal and calid source keys.
CMD.meetings = function () {
  const events = stdinJson(), tz = timezone(), now = nowDate(), today = local(now, tz).slice(0, 10);
  refuseOldKeys('meetings', events, 'event');
  // Prep items once carried the Meeting's own cal source key, so they are never taken for the Meeting.
  const P = people(), u = userRecord(P), recs = loadIndex().filter(x => !/^Prepare for /.test(x.title || ''));
  const built = [], unchanged = [], moved = [], cancelled = [], dropped = [];
  events.forEach((ev, i) => {
    if (!ev.subject || !ev.start) fail(`event ${i}: an event needs subject and start`);
    const title = String(ev.subject).replace(/[\r\n]+/g, ' ').replace(/[{}]/g, '').trim();
    // A free event the user hasn't declined isn't one of their Meetings, even a tracked one, so nothing is written for it.
    if (ev.free && !ev.cancelled && !ev.declined) { dropped.push(title); return; }
    const due = local(toInstant(ev.start), tz), date = due.slice(0, 10);
    const cal = calRef(date, title), calid = ev['event-id'] ? `calid|${ev['event-id']}` : '';
    const gone = !!(ev.cancelled || ev.declined);
    const hits = recs.filter(x => x.ref.toLowerCase() === cal.toLowerCase() || (calid && x.ref === calid));
    if (hits.length) {
      const hit = hits.find(x => x.id);
      if (!hit) return;
      const id = hit.id, open = hit.store === 'tasks' || hit.store === 'inbox';
      if (calid && open && !hits.some(x => x.ref === calid)) addRef(id, calid);
      // News from the calendar is a Comment for the user to acknowledge, stamped with this Run's time.
      const tell = (text, fields) => editSubs(id, (it, rank) => { C.addComment(it, { at: local(now, tz), author: AUTHOR.cal, ack: true, text, fields }, rank); });
      // A cancelled or declined Meeting stays open for the user to deal with, and no Run closes it.
      if (open && gone) {
        let retitled = '';
        rewriteItem(id, it => { if (/^Cancelled: /.test(it.title)) return false; retitled = it.title = `Cancelled: ${it.title}`; });
        if (retitled) { tell('Found cancelled.'); cancelled.push({ id, title: retitled }); }
        else unchanged.push(id);
      // The calendar is the record for a mirrored Meeting's time and title: one moved or renamed takes both.
      } else if (open && (hit.due !== due || !hits.some(x => x.ref.toLowerCase() === cal.toLowerCase()))) {
        rewriteItem(id, it => { it.title = title; C.setDue(it.meta, due); });
        addRef(id, cal);
        // one field change for each of due-date and due-time that moved
        const was = dueFields(hit.due), to = dueFields(due);
        ['due-date', 'due-time'].forEach(k => { if ((was[k] || '') !== (to[k] || '')) tell('Moved in the calendar.', { changed: k, from: was[k] || '', to: to[k] || '' }); });
        moved.push({ id, title, from: hit.due, to: due });
      } else unchanged.push(id);
      return;
    }
    if (gone) return;
    const days = Math.round((Date.parse(date) - Date.parse(today)) / DAY);
    const p = findPerson(ev.organizer, P) || findPerson(ev['organizer-name'], P);
    const meta = { type: 'meeting', who: p && p !== u ? p.name : undefined, urgency: days <= 0 ? 'today' : days <= 7 ? 'this week' : days <= 14 ? 'soon' : 'later',
      priority: 'medium', ...dueFields(due), 'received-datetime': local(now, tz) };
    Object.keys(meta).forEach(k => { if (meta[k] === undefined) delete meta[k]; });
    const subs = [{ k: 'origin', v: `Calendar "${title}" organised by ${ev['organizer-name'] || (p && p.name) || ev.organizer || 'unknown'}` }];
    if (ev['web-link']) subs.push({ k: 'link', v: `[Outlook event](${ev['web-link']})` });
    subs.push({ k: 'source-key', v: cal });
    if (calid) subs.push({ k: 'source-key', v: calid });
    built.push({ title, meta, subs });
  });
  const added = [];
  if (built.length) {
    const { start } = raiseCounter(built.length);
    built.forEach((b, k) => added.push({ id: 'T-' + String(start + k).padStart(4, '0'), ...b }));
    appendLines('TASKS.md', added.map(a => C.serItem({ id: a.id, done: false, title: a.title, meta: a.meta, subs: a.subs })));
  }
  out({ added: added.map(a => ({ id: a.id, title: a.title, due: C.dueOf(a.meta) })), moved, cancelled, unchanged, dropped });
};

CMD.ignore = function () {
  const rows = stdinJson(), tz = timezone(), date = local(nowDate(), tz).slice(0, 10);
  refuseOldKeys('ignore', rows, 'row');
  const have = new Set(loadIndex().filter(r => r.store === 'ignored').map(r => r.ref.toLowerCase()));
  const lines = [], skipped = [];
  rows.forEach((r, i) => {
    const ref = String(r['source-key'] || '').replace(/[\r\n]+/g, ' ').trim();
    if (!/^[a-z][a-z0-9-]*\|/i.test(ref)) fail(`row ${i}: source-key must start with a scheme such as mail|`);
    if (isContainer(ref) && !r.container) fail(`row ${i}: ${ref} stands for a whole chat or thread; pass "container": true only when the whole of it is out of scope`);
    if (have.has(ref.toLowerCase())) { skipped.push(ref); return; }
    have.add(ref.toLowerCase());
    lines.push(C.ignoredLine(ref, date, String(r.reason || 'not actionable')));
  });
  if (lines.length) appendLines('IGNORED.md', lines, IGNORED_HEAD);
  out({ ignored: lines.length, skipped });
};

CMD.commit = function () {
  const name = ARGS[1];
  if (!name || ARGS.length < 3) fail('usage: discern commit <source> key=value [key=value ...]   (key= with no value removes the line)');
  const pairs = ARGS.slice(2).map(a => { const i = a.indexOf('='); if (i < 1) fail(`${a} is not key=value`); return [a.slice(0, i), a.slice(i + 1)]; });
  pairs.forEach(([k]) => { if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(k)) fail(`${k} is not a SOURCES.md key: keys are lowercase words joined by hyphens${k.includes('_') ? `, such as ${k.toLowerCase().replace(/_/g, '-')}` : ''}`); });
  let text = read('SOURCES.md');
  if (!text.trim()) text = '# Sources\n';
  const eol = eolOf(text);
  let S = parseSources(text), lines = S.lines;
  // A Run's watermark must stay where it was or be the end of one of the windows state handed it, so it can never
  // skip a day not yet read.
  const old = S.blocks[name], wm = (pairs.find(([k]) => k === 'watermark') || [])[1], lr = (pairs.find(([k]) => k === 'last-run') || [])[1];
  if (val(old, 'watermark') && wm && lr) {
    const ends = runWindows(old, Date.parse(lr)).map(w => w.before);
    if (![val(old, 'watermark'), ...ends].some(e => Date.parse(e) === Date.parse(wm))) fail(`watermark ${wm} is not the end of a window this Run was given, so it could skip days not yet read. Send the end of the last window every pass finished, or the watermark it has (${val(old, 'watermark')}) if none was: ${ends.join(', ')}`);
  }
  if (!S.blocks[name]) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push('', `## ${name}`);
    S = parseSources(lines.join('\n')); lines = S.lines;
  }
  const changed = [];
  pairs.forEach(([k, v]) => {
    const b = parseSources(lines.join('\n')).blocks[name], e = b.keys[k];
    v = v.replace(/[\r\n]+/g, ' ').trim();
    if (e) {
      const drop = [e.line, ...e.listLines].sort((a, z) => z - a);
      if (!v) drop.forEach(n => lines.splice(n, 1));
      else { e.listLines.sort((a, z) => z - a).forEach(n => lines.splice(n, 1)); lines[e.line] = `- ${k}: ${v}`; }
    } else if (v) lines.splice(b.end + 1, 0, `- ${k}: ${v}`);
    changed.push(k);
  });
  // The day a Run found too big is read in hours until the watermark is past it.
  const nb = parseSources(lines.join('\n')).blocks[name], split = nb.keys.split;
  if (split && Date.parse(val(nb, 'watermark')) >= Date.parse(split.value) + DAY) { lines.splice(split.line, 1); changed.push('split'); }
  write('SOURCES.md', lines.join(eol).replace(/(\r?\n)?$/, eol));
  const S2 = parseSources(lines.join('\n')), b = S2.blocks[name], res = { source: name, changed, forgotten: forget(S2) };
  if (changed.includes('last-run') && val(b, 'watermark')) res.behind = behind(name, b);
  out(res);
};

// Drops each DISMISSED.md line whose source can no longer read its message again: a stream source once its
// watermark less overlap is past the message, a horizon source once the event's date is before today, where its
// window starts. A line that names no source waits for every stream source. Returns how many lines went.
function forget(S) {
  const text = read('DISMISSED.md'), all = dismissals(text);
  if (!all.length) return 0;
  const tz = timezone(S), today = local(nowDate(), tz).slice(0, 10);
  const DUR = /^P(?=\d|T\d)(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/;
  const cursor = b => {
    const wm = Date.parse(val(b, 'watermark')), ov = val(b, 'overlap');
    return isNaN(wm) || (ov && !DUR.test(ov)) ? NaN : wm - (ov ? parseDuration(ov) : 0);
  };
  const streams = Object.values(S.blocks).filter(b => b.name !== 'defaults' && val(b, 'watermark'));
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const gone = new Set(all.filter(({ fields: f }) => {
    // A message came in before it was dismissed, so the end of the day it was dismissed bounds a line with no time.
    const at = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(f['received-datetime'] || '') ? wallToInstant(f['received-datetime'], tz).getTime()
      : DATE.test(f['dismissed-date'] || '') ? wallToInstant(f['dismissed-date'] + ' 23:59', tz).getTime() : NaN;
    const ev = DATE.test(f['event-date'] || '') ? f['event-date'] : '';
    const b = f.source ? S.blocks[f.source] : null;
    if (b && val(b, 'watermark')) return cursor(b) > at;
    if (b) return !!ev && ev < today;
    return streams.length > 0 && streams.every(s => cursor(s) > at) && (!ev || ev < today);
  }).map(d => d.line));
  if (!gone.size) return 0;
  write('DISMISSED.md', text.split(/\r?\n/).filter((l, i) => !gone.has(i)).join(eolOf(text)));
  return gone.size;
}

// How far a stream source is behind after a Run: the day-long windows of that Run still unread past its watermark,
// or past its ask cursor in the ask window, whichever is more.
function behind(name, b) {
  const end = Date.parse(val(b, 'last-run')), daysFrom = (a, z) => Math.max(0, Math.ceil((z - a) / DAY));
  let days = daysFrom(Date.parse(val(b, 'watermark')), end);
  if (val(b, 'waiting-min-age') && val(b, 'waiting-max-age') && val(b, 'waiting-checked-through')) {
    const asks = Math.max(Date.parse(val(b, 'waiting-checked-through')), end - parseDuration(val(b, 'waiting-max-age')));
    days = Math.max(days, daysFrom(asks, end - parseDuration(val(b, 'waiting-min-age'))));
  }
  return { days, report: days ? `${name}: ${days} day${days > 1 ? 's' : ''} still to read, run again` : `${name}: caught up` };
}

CMD.log = function () {
  const text = readStdin().trim();
  if (!text) fail('expected the report on stdin');
  const tz = timezone();
  appendLines('REFRESH-LOG.md', ['', `## ${local(nowDate(), tz)}`, '', text],
    '# Refresh log\n<!-- Append-only: one entry per source-skill run, newest last. Written by tools/discern.mjs log. -->');
  out({ logged: true });
};

// The field names and line shapes of older Formats, which are not read: discern check reports any left as an error.
const OLD_ITEM_KEYS = { ty: 'type', prj: 'projects', tg: 'tags', top: 'tags', urg: 'urgency', p: 'priority', due: 'due-date', st: 'status',
  dep: 'dependencies', done: 'done-date', asg: 'received-datetime' };
const OLD_RECORD_KEYS = { co: 'company', dept: 'department', mgr: 'manager', ext: 'external', st: 'status', chk: 'checked-date', em: 'emails', handle: 'handles' };
const OLD_SUBS = { src: 'origin', ref: 'source-key', hist: 'history' };
const OLD_SHAPES = {
  'RELATIONSHIPS.md': [/^- \S+ (~|->) \S+ \| /, '- A ~ B {kind: related}'],
  'IGNORED.md': [/^(- )?[a-z][a-z0-9-]*\|.* \| \d{4}-\d{2}-\d{2}( \||$)/i, '- <source key> {ignored-date: YYYY-MM-DD; reason: …}'],
  'ASK-AGENT.md': [/^- (T|P|PRJ|SYS)-\d+ \| \d{4}-\d{2}-\d{2}/, '- <ID> {requested-datetime: YYYY-MM-DD HH:MM}, the request on the lines below'],
  'ASK-AGENT-LOG.md': [/^- (actioned )?\d{4}-\d{2}-\d{2} \d{2}:\d{2} \| /, '- <ID> {requested-datetime: …; actioned-datetime: …}, with request: and result: sub-lines'],
};
CMD.check = function () {
  const errors = [], warnings = [];
  const files = ['TASKS.md', 'INBOX.md', 'DONE.md', 'PEOPLE.md', 'PROJECTS.md', 'SYSTEMS.md', 'SOURCES.md'];
  files.forEach(f => { if (fs.existsSync(fp(f)) && !read(f).trim()) errors.push(`${f} is empty`); });
  const sets = { 'TASKS.md': C.parse(read('TASKS.md')), 'INBOX.md': C.parse(read('INBOX.md')), 'DONE.md': C.parse(read('DONE.md')) };
  const seen = {}, all = new Set();
  let max = 0;
  const oldKeys = (where, meta, old) => Object.keys(meta).filter(k => Object.hasOwn(old, k)).forEach(k => errors.push(`${where}: ${k} is the name an older Format gave ${old[k]}, and is not read: run discern upgrade, or write ${old[k]}`));
  // a field's value that isn't one the Format allows
  const oneOf = (where, meta, k, allowed) => { if (meta[k] !== undefined && !allowed.includes(meta[k])) warnings.push(`${where}: ${k} is "${meta[k]}", not one of ${allowed.join(', ')}`); };
  Object.entries(sets).forEach(([f, m]) => m.items.forEach(it => {
    if (seen[it.id]) errors.push(`${it.id} appears in both ${seen[it.id]} and ${f}`);
    seen[it.id] = f; all.add(it.id); max = Math.max(max, parseInt(it.id.slice(2), 10));
    const where = `${f} ${it.id}`;
    oldKeys(where, it.meta, OLD_ITEM_KEYS);
    oneOf(where, it.meta, 'type', C.TYPES); oneOf(where, it.meta, 'urgency', C.URG_ORDER); oneOf(where, it.meta, 'priority', C.PRIORITIES);
    oneOf(where, it.meta, 'status', ['waiting', 'in progress']);
    if (it.meta['due-time'] && !it.meta['due-date']) warnings.push(`${where}: due-time goes only beside a due-date`);
    subLines(f, it.id, it);
    C.getSub(it, 'source-key').forEach(s => { if (!/^[a-z][a-z0-9-]*\|./i.test(s.v.trim())) errors.push(`${where}: source key "${s.v}" has no scheme`); });
  }));
  // Sub-lines the parser doesn't know, such as a note: or my: line from before Descriptions and Comments, and Comments without their fields.
  function subLines(f, id, x) {
    x.subs.filter(s => s.k === 'raw' && s.v.trim()).forEach(s => {
      const old = /^  - (src|ref|hist):/.exec(s.v);
      if (old) errors.push(`${f} ${id}: a ${old[1]}: line is the name an older Format gave ${OLD_SUBS[old[1]]}, and is not read: run discern upgrade`);
      else warnings.push(`${f} ${id}: unrecognised line "${s.v.trim().slice(0, 60)}"`);
    });
    C.getSub(x, 'comment').forEach(c => {
      const at = c.f['added-datetime'], said = `${f} ${id}: a Comment ("${c.v.split('\n')[0].slice(0, 40)}")`;
      if (!/^[a-z]+$/.test(c.f.author || '')) errors.push(`${said} has no author: give one lowercase word, such as user, email or agent`);
      if (at && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at)) errors.push(`${said} has added-datetime "${at}": write YYYY-MM-DD HH:MM`);
      if (c.f.acknowledged !== undefined && c.f.acknowledged !== 'no') errors.push(`${said} has acknowledged: ${c.f.acknowledged}: it is only ever no, and removed once acknowledged`);
      const kind = String(id).split('-')[0], g = C.fieldChange(c), old = kind === 'T' ? OLD_ITEM_KEYS : OLD_RECORD_KEYS;
      if (g && Object.hasOwn(old, g.field)) errors.push(`${said} has changed: ${g.field}, the name an older Format gave ${old[g.field]}, which is not read: run discern upgrade`);
      else if (g && !(C.CHANGE_FIELDS[kind] || []).includes(g.field)) warnings.push(`${said} has changed: ${g.field}, a field no Skill changes${C.CHANGE_FIELDS[kind] ? ` there: only ${C.CHANGE_FIELDS[kind].join(', ')}` : ''}`);
      if (c.f.suggests !== undefined && (c.f.suggests !== 'done' || kind !== 'T')) warnings.push(`${said} has suggests: ${c.f.suggests}: only an Item's Comment suggests, and only done`);
      if (!c.v.trim()) warnings.push(`${said} has no text`);
    });
  }
  const P = people(), names = new Set(P.map(p => p.name)), pids = new Set();
  P.forEach(p => { oldKeys(`PEOPLE.md ${p.meta.id || p.name}`, p.meta, OLD_RECORD_KEYS); subLines('PEOPLE.md', p.meta.id || p.name, p); });
  const ents = {};
  ['PROJECTS.md', 'SYSTEMS.md'].forEach(f => (ents[f] = C.eParse(read(f)).ents).forEach(e => { oldKeys(`${f} ${e.meta.id || e.name}`, e.meta, OLD_RECORD_KEYS); subLines(f, e.meta.id || e.name, e); }));
  const counter = (/<!-- next-id: (\d+) -->/.exec(read('TASKS.md')) || [])[1];
  if (!counter) errors.push('TASKS.md has no <!-- next-id: N --> counter');
  else if (+counter <= max) errors.push(`TASKS.md next-id is ${counter} but T-${String(max).padStart(4, '0')} exists: raise it to ${max + 1}`);
  P.forEach(p => { const id = p.meta.id; if (id) { if (pids.has(id)) errors.push(`PEOPLE.md: ${id} is used twice`); pids.add(id); } });
  const prj = new Set(ents['PROJECTS.md'].map(e => e.meta.id).filter(id => /^PRJ-\d+$/.test(id || '')));
  const sys = new Set(ents['SYSTEMS.md'].map(e => e.meta.id).filter(id => /^SYS-\d+$/.test(id || '')));
  Object.entries(sets).forEach(([f, m]) => m.items.forEach(it => {
    csv(it.meta.projects).forEach(x => { if (!prj.has(x)) errors.push(`${f} ${it.id}: projects names ${x}, which is not in PROJECTS.md`); });
    if (it.meta.who && !names.has(it.meta.who) && f !== 'DONE.md') warnings.push(`${f} ${it.id}: who "${it.meta.who}" is not a name in PEOPLE.md`);
  }));
  // Lines in the shapes of older Formats, in the files that hold one line (or entry) per thing
  Object.entries(OLD_SHAPES).forEach(([f, [re, now]]) => read(f).replace(/\r/g, '').split('\n').forEach(l => {
    if (re.test(l)) errors.push(`${f}: "${l.trim().slice(0, 60)}" is in the shape of an older Format, which is not read: run discern upgrade, or write ${now}`);
  }));
  const exists = id => all.has(id) || pids.has(id) || prj.has(id) || sys.has(id);
  const rels = new Set();
  read('RELATIONSHIPS.md').replace(/\r/g, '').split('\n').forEach(l => {
    const m = C.REL_RE.exec(l); if (!m) return;
    [m[1], m[3]].forEach(id => { if (!exists(id)) errors.push(`RELATIONSHIPS.md: ${id} does not exist (${l.trim()})`); });
    if (m[1] === m[3]) errors.push(`RELATIONSHIPS.md: self-link ${l.trim()}`);
    const k = m[2] === '~' ? [m[1], m[3]].sort().join('~') : m[1] + '->' + m[3];
    if (rels.has(k)) errors.push(`RELATIONSHIPS.md: duplicate ${l.trim()}`); rels.add(k);
  });
  C.changesOf(sets['INBOX.md'].post).forEach(c => {
    if (!c.type) warnings.push(`INBOX.md ${C.CHANGES_HEAD}: unrecognised line "${c.line.slice(0, 60)}"`);
    else if (c.type === 'relationship') [c.a, c.b].forEach(id => { if (!exists(id)) warnings.push(`INBOX.md: the Relationship proposed in "${c.text}" names ${id}, which does not exist`); });
    else if ((c.type === 'email' || c.type === 'priority') && !pids.has(c.id)) warnings.push(`INBOX.md: "${c.text}" names ${c.id}, who is not in PEOPLE.md`);
  });
  const S = sources();
  if (!S.blocks.defaults) warnings.push('SOURCES.md has no "## defaults" block');
  else if (!val(S.blocks.defaults, 'timezone')) warnings.push('SOURCES.md defaults has no timezone');
  Object.values(S.blocks).forEach(b => Object.keys(b.keys).filter(k => k.includes('_')).forEach(k => errors.push(`SOURCES.md ## ${b.name}: ${k} is the name an older Format gave it, and is not read: run discern upgrade, or write it with hyphens`)));
  const { format, problem } = formatStanding(DIR);
  if (problem) errors.push(problem);
  out({ ok: !errors.length, errors, warnings, format, items: all.size, next_id: counter ? +counter : null });
  if (errors.length) process.exit(1);
};

// ---------------------------------------------------------------- the Upgrade (see migrations/README.md)
// The Migrations newer than a Format version, oldest first, with next last, and what each one holds.
function pendingMigrations(format) {
  const names = fs.existsSync(MIGRATIONS) ? fs.readdirSync(MIGRATIONS).filter(n => (n === 'next' || /^\d+(\.\d+)*$/.test(n)) && fs.statSync(path.join(MIGRATIONS, n)).isDirectory()) : [];
  return names.filter(n => C.versionCmp(n, format) > 0).sort(C.versionCmp).map(version => {
    const d = path.join(MIGRATIONS, version), ins = path.join(d, 'INSTRUCTIONS.md');
    let instructions = null;
    if (fs.existsSync(ins)) {
      const m = /^Optional:\s*(yes|no)\s*$/mi.exec(fs.readFileSync(ins, 'utf8'));
      if (!m) fail(`migrations/${version}/INSTRUCTIONS.md does not say at the top whether it is optional (Optional: yes, or Optional: no)`);
      instructions = m[1].toLowerCase() === 'yes' ? 'optional' : 'required';
    }
    return { version, script: fs.existsSync(path.join(d, 'migrate.mjs')), instructions };
  });
}
// Runs a Migration's script on the data folder: a preview, or the changes themselves with write.
function runMigration(version, write) {
  const r = spawnSync(process.execPath, [path.join(MIGRATIONS, version, 'migrate.mjs'), DIR, ...(write ? ['--write'] : [])], { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

CMD.upgrade = function () {
  const { format, problem } = formatStanding(DIR);
  if (format.is === 'newer') fail(`${problem}. ${newerAdvice(format)}`, 2);
  const pending = pendingMigrations(format.folder);
  if (format.is === 'same') { out({ folder: format.folder, app: format.app, pending, message: `the data folder is up to date: it is in Format ${format.app}, the same as this app` }); return; }
  if (OPT.done) {
    if (!pending.length || pending[0].version !== OPT.done) fail(`${OPT.done} is not the next pending Migration: ${pending.length ? pending[0].version + ' is' : 'none is pending'}`);
    recordFormat(DIR, OPT.done);
    out({ folder: format.folder, app: format.app, recorded: OPT.done, pending: pending.slice(1) });
    return;
  }
  if (!OPT.write) {
    out({ folder: format.folder, app: format.app, pending, preview: pending[0] && pending[0].script ? runMigration(pending[0].version, false).out : null });
    return;
  }
  if (!pending.length) { out({ folder: format.folder, app: format.app, pending, applied: [] }); return; }
  const backup = path.join(path.dirname(DIR), `${path.basename(DIR)}.backup-${format.folder}`);
  if (!fs.existsSync(backup)) fs.cpSync(DIR, backup, { recursive: true });
  const res = { folder: format.folder, app: format.app, backup, applied: [], declined: [] };
  for (const m of OPT.one ? pending.slice(0, 1) : pending) {
    const r = m.script ? runMigration(m.version, true) : { ok: true };
    if (!r.ok) fail(`migrations/${m.version}/migrate.mjs failed, so the Upgrade stopped with the folder recorded as Format ${res.applied.at(-1) || format.folder}. Its backup is ${backup}. It said: ${r.out.trim()}`);
    if (OPT.one && m.instructions) {
      out({ ...res, ran: m.version, next: `carry out migrations/${m.version}/INSTRUCTIONS.md with the user${m.instructions === 'optional' ? ' (they may decline it)' : ''}, then run: discern upgrade --done ${m.version}` });
      return;
    }
    if (m.instructions === 'required') {
      out({ ...res, stopped: m.version, next: `Migration ${m.version} needs judgement: carry out migrations/${m.version}/INSTRUCTIONS.md with the user, then run: discern upgrade --done ${m.version}` });
      process.exit(2);
    }
    recordFormat(DIR, m.version);
    res.applied.push(m.version);
    if (m.instructions === 'optional') res.declined.push(m.version);
  }
  out(res);
};

// Serves the UI and the data folder to it on 127.0.0.1 until it is stopped, so the page works in any
// browser and an Agent can open it. Prints {url, folder, problem} once listening. It starts with no usable
// folder too, when it can switch to one, and then serves no data files until it has one.
CMD.serve = function () {
  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  // Only the files the page reads or writes, matched as written in the URL, so no name is ever resolved against the disk.
  const NAMES = new Set([...Object.values(C.FILES), ...C.WATCH]);
  const mtime = (f) => Math.floor(fs.statSync(f).mtimeMs);
  const MAX_PUT = 10 * 1024 * 1024;
  const bodyText = async (req) => { const chunks = []; let size = 0; for await (const c of req) { size += c.length; if (size <= 64e3) chunks.push(c); } return Buffer.concat(chunks).toString('utf8'); };
  // The folder being served, null when there is none, and the session the page must name so that a tab
  // still open on an earlier folder can't read or write this one. A new session each time a folder is opened.
  const open = { dir: null, session: null };
  const openFolder = (d) => { open.dir = d; open.session = d ? randomUUID() : null; };
  openFolder(SERVE_WITHOUT_FOLDER ? null : DIR);
  const fp = (f) => path.join(open.dir, f);
  // What stops the page using the folder: 'none', 'format', or undefined when nothing does.
  const problem = () => !open.dir ? 'none' : formatRefusal(open.dir) ? 'format' : undefined;
  const server = http.createServer(async (req, res) => {
    // A web page can reach 127.0.0.1 through DNS rebinding, but its requests then carry its own Host.
    const port = server.address().port;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return send(res, 403, 'forbidden');
    // A same-origin fetch always names the page's origin, so a PUT without it came from somewhere else.
    if (req.method === 'PUT' && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return send(res, 403, 'forbidden');
    if (req.method === 'GET' && req.url === '/') return send(res, 200, fs.readFileSync(path.join(REPO, 'discerny.html'), 'utf8'), { 'Content-Type': 'text/html; charset=utf-8' });
    // The app's icons, whatever the folder's state: a strict name, so nothing outside icons/ can be reached.
    const icon = /^\/icons\/([a-z0-9-]+\.(png|ico))$/.exec(req.url);
    if (req.method === 'GET' && icon) {
      const f = path.join(REPO, 'icons', icon[1]);
      if (!fs.existsSync(f)) return send(res, 404, 'not found');
      res.writeHead(200, { 'Content-Type': icon[2] === 'png' ? 'image/png' : 'image/x-icon', 'Cache-Control': 'max-age=3600' });
      return res.end(fs.readFileSync(f));
    }
    // The web manifest, for installing the UI as an app; like the icons, it doesn't need a folder.
    if (req.method === 'GET' && req.url === '/manifest.webmanifest') return send(res, 200, fs.readFileSync(path.join(REPO, 'manifest.webmanifest'), 'utf8'), { 'Content-Type': 'application/manifest+json' });
    if (req.method === 'GET' && req.url === '/api/info') {
      return send(res, 200, { folder: open.dir, name: open.dir && path.basename(open.dir), version: C.VERSION, session: open.session, problem: problem(), canSwitch: CAN_SWITCH });
    }
    // Suggestions for Change folder: the connected folder and the Example beside the App folder, when each is a data folder.
    if (req.method === 'GET' && req.url === '/api/folders') {
      let mine = '';
      try { [mine] = connected(); } catch (e) { /* a config.toml edited into something unreadable suggests nothing */ }
      const found = [...new Set([mine, path.resolve(REPO, '..', 'discerny-example')])].filter(d => d && isDataFolder(d));
      return send(res, 200, found.map(d => ({ folder: d, name: path.basename(d) })));
    }
    if (req.method === 'PUT' && req.url === '/api/folder') {
      let want;
      try { want = JSON.parse(await bodyText(req)).path; } catch (e) { /* answered below */ }
      if (!CAN_SWITCH) return send(res, 409, `this server was started with ${FROM === '--dir' ? '--dir' : 'DISCERNY_DIR set'}, which overrides config.toml, so it can't switch folders: stop it, run discern connect <folder>, and start it again${FROM === 'DISCERNY_DIR' ? ' with DISCERNY_DIR unset' : ''}`);
      if (typeof want !== 'string' || !want.trim()) return send(res, 400, 'send {"path": "<folder>"} as JSON');
      const d = path.resolve(REPO, want.trim());
      if (!isDataFolder(d)) return send(res, 400, notDataFolder(d, want.trim()));
      const refusal = formatRefusal(d);
      if (refusal) return send(res, 409, refusal);
      try { connectTo(d); } catch (e) { return send(res, 409, e.message); }
      openFolder(d);
      return send(res, 200, { folder: d, name: path.basename(d) });
    }
    // While the folder can't be used, nothing in it is read or written but DISCERNY.md, which the page's Format gate reads.
    const stop = problem();
    if (stop === 'none') return send(res, 409, 'no data folder is open: choose one with Change folder');
    if (stop === 'format' && !(req.method === 'GET' && req.url === '/api/file/DISCERNY.md')) return send(res, 409, formatRefusal(open.dir));
    if (req.headers['x-discerny-session'] !== open.session) return send(res, 412, 'the server now serves another folder: reload the page');
    if (req.method === 'GET' && req.url === '/api/mtimes') return send(res, 200, Object.fromEntries([...NAMES].map(n => [n, fs.existsSync(fp(n)) ? mtime(fp(n)) : 0])));
    if (req.method === 'GET' && req.url === '/api/drafts') {
      const dr = fp('drafts');
      const names = fs.existsSync(dr) ? fs.readdirSync(dr, { withFileTypes: true }).filter(e => e.isFile() && /\.(md|txt)$/i.test(e.name)).map(e => e.name) : [];
      return send(res, 200, names.sort().map(n => ({ name: n, text: fs.readFileSync(path.join(dr, n), 'utf8'), mod: mtime(path.join(dr, n)) })));
    }
    const file = /^\/api\/file\/([^/]+)$/.exec(req.url);
    if (!file || !NAMES.has(file[1])) return send(res, 404, 'not found');
    const f = fp(file[1]);
    if (req.method === 'GET') {
      if (!fs.existsSync(f)) return send(res, 404, 'not found');
      return send(res, 200, fs.readFileSync(f, 'utf8'), { 'X-Mtime': String(mtime(f)) });
    }
    if (req.method === 'PUT') {
      if (!/^text\/plain\s*(;|$)/i.test(req.headers['content-type'] || '')) return send(res, 415, 'send the file as text/plain');
      // The whole body is read even when it is too big, so the page gets the answer rather than a dropped connection.
      const chunks = [];
      let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size <= MAX_PUT) chunks.push(chunk); }
      if (size > MAX_PUT) return send(res, 413, `a file can be at most ${MAX_PUT} bytes`);
      const body = Buffer.concat(chunks).toString('utf8');
      // The page refuses to blank a file that has content, and so does the server.
      if (!body.trim() && fs.existsSync(f) && fs.readFileSync(f, 'utf8').trim()) return send(res, 400, 'refusing to write an empty file over one with content');
      const ifMtime = req.headers['if-mtime'];
      if (ifMtime !== undefined && Number(ifMtime) !== (fs.existsSync(f) ? mtime(f) : 0)) return send(res, 409, 'the file changed since it was read');
      const tmp = `${f}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, f);
      return send(res, 200, { mtime: mtime(f) });
    }
    send(res, 405, 'method not allowed');
  });
  server.listen(Number(OPT.port), '127.0.0.1', () => {
    process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, folder: open.dir,
      problem: problem() === 'none' ? `${NOT_CONNECTED}; or open the page and use Change folder` : formatRefusal(open.dir) || undefined }) + '\n');
  });
};

const cmd = ARGS[0];
if (cmd === '--version' || cmd === 'version') {
  process.stdout.write((C.VERSION || 'unknown') + '\n');
  process.exit(0);
}
if (!cmd || !CMD[cmd]) {
  process.stdout.write('usage: node tools/discern.mjs <connect|new|state|match|who|local|add|propose|meetings|ignore|comment|change|ref|commit|log|check|upgrade|serve> [args] [--dir <folder>] [--now <ISO>]\nSee SOURCE-SKILLS.md for what each command does.\n');
  process.exit(cmd ? 1 : 0);
}
// serve starts with no usable folder when it can switch to one, so the page can offer Change folder.
const CAN_SWITCH = FROM !== '--dir' && FROM !== 'DISCERNY_DIR';
const SERVE_WITHOUT_FOLDER = cmd === 'serve' && CAN_SWITCH && !(DIR && isDataFolder(DIR));
if (cmd === 'serve' && !CAN_SWITCH && !isDataFolder(DIR)) fail(`${DIR} (from ${FROM}) has no TASKS.md, so it is not a Discerny data folder`, 2);
if (cmd !== 'connect' && cmd !== 'new' && !SERVE_WITHOUT_FOLDER) {
  if (!DIR) fail(NOT_CONNECTED, 2);
  if (!isDataFolder(DIR)) fail(`${DIR} (from ${FROM}) has no TASKS.md, so it is not a Discerny data folder`);
}
// A folder in another Format is refused before any command reads or writes it, except those that show or fix that.
// serve starts on one too, and its page shows the Format gate.
if (!['connect', 'new', 'check', 'upgrade', 'serve'].includes(cmd)) {
  const refusal = formatRefusal(DIR);
  if (refusal) fail(refusal, 2);
}
CMD[cmd]();
