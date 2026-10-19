#!/usr/bin/env node
// discern.mjs: the deterministic half of every Discerny source skill (see SOURCE-SKILLS.md).
// Node 18 or later, no dependencies. It reuses the file parser in discerny.html (the block between
// //<core> and //</core>), so the UI and this helper can never disagree about the format.
//
//   node tools/discern.mjs <command> [args] [--dir <folder>] [--now <ISO time>]
//   node tools/discern.mjs --version   prints the app's version (VERSION in discerny.html)
//
// Commands: connect, new, state, match, who, local, add, ignore, note, ref, commit, log, check, migrate, upgrade.
// Input for match, add, ignore and log comes on stdin (JSON, or text for log); output is JSON on stdout.
// Exit codes: 0 done, 1 invalid input (the message says what to fix), 2 the user must decide.
// Every command but connect, new, check, upgrade and --version refuses a data folder in another Format, with exit 2.
//
// The app (this helper, the UI, the skills) and the user's data live in separate folders. The data folder
// is --dir, else $DISCERNY_DIR, else the path in data-folder.txt in the app folder, which connect and new write.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const LINK = path.join(REPO, 'data-folder.txt');
const MIGRATIONS = path.join(REPO, 'migrations');
const STARTER = path.join(REPO, 'new_discerny_repo');
const DAY = 864e5;

// ---------------------------------------------------------------- arguments and output
const argv = process.argv.slice(2);
const OPT = { dir: '', now: process.env.DISCERN_NOW || '', write: false, dry: false, zone: '', one: false, done: '' };
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
  else ARGS.push(a);
}
function linked() { try { return fs.readFileSync(LINK, 'utf8').trim(); } catch (e) { return ''; } }
const [DIR, FROM] = OPT.dir ? [path.resolve(OPT.dir), '--dir']
  : process.env.DISCERNY_DIR ? [path.resolve(process.env.DISCERNY_DIR), 'DISCERNY_DIR']
  : linked() ? [path.resolve(REPO, linked()), 'data-folder.txt'] : ['', ''];
const NOT_CONNECTED = 'no data folder is connected. Ask the user which folder holds their Discerny data, then run: discern connect <folder>; or start one with: discern new <folder>';
function isDataFolder(d) { return fs.existsSync(path.join(d, 'TASKS.md')); }

function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
function fail(msg, code = 1) { out({ error: msg }); process.exit(code); }
function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; } }
function stdinJson() {
  const t = readStdin().trim();
  if (!t) fail('expected JSON on stdin');
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : [v]; } catch (e) { fail('stdin is not valid JSON: ' + e.message); }
}

// ---------------------------------------------------------------- the shared parser from the UI
function loadCore() {
  for (const name of ['discerny.html', 'discerny-old.html']) {
    const p = path.join(REPO, name);
    if (!fs.existsSync(p)) continue;
    const html = fs.readFileSync(p, 'utf8');
    const a = html.indexOf('//<core>'), b = html.indexOf('//</core>');
    if (a < 0 || b < a) continue;
    const names = ['VERSION', 'FORMAT', 'versionCmp', 'formatOf', 'formatIs', 'parse','serItem', 'nextId', 'getSub', 'pParse', 'TYPES', 'URG_ORDER', 'STATUS'];
    const ret = '{' + names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ') + '}';
    try { return new Function(`'use strict';\n${html.slice(a + 8, b)}\n;return ${ret};`)(); }
    catch (e) { fail(`the //<core> block in ${name} did not load: ${e.message}`); }
  }
  fail('no //<core> ... //</core> block found in discerny.html or discerny-old.html next to tools/');
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
    const k = /^- ([A-Za-z0-9_]+):\s?(.*)$/.exec(ln);
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
  P = P || people();
  return P.find(p => p.subs.some(b => b.k === 'note' && /the user of (discerny|this tracker)/i.test(b.v)))
    || P.find(p => p.meta.id === 'P-0001') || null;
}
function personView(p) { return p ? { id: p.meta.id || null, name: p.name, em: csv(p.meta.em), handle: csv(p.meta.handle), mgr: p.meta.mgr || null } : null; }
function findPerson(q, P) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return null;
  P = P || people();
  return P.find(p => csv(p.meta.em).some(e => e.toLowerCase() === s))
    || P.find(p => csv(p.meta.handle).some(h => h.toLowerCase() === s))
    || P.find(p => p.name.toLowerCase() === s) || null;
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
    const st = it.meta.st || '';
    C.getSub(it, 'ref').forEach(b => recs.push({ store, id: it.id, st, ty: it.meta.ty || '', due: it.meta.due || '', ref: b.v.trim() }));
  };
  C.parse(read('TASKS.md')).items.forEach(it => add(it.done ? 'done' : 'tasks', it));
  C.parse(read('INBOX.md')).items.forEach(it => add('inbox', it));
  C.parse(read('DONE.md')).items.forEach(it => add('done', it));
  read('IGNORED.md').replace(/\r/g, '').split('\n').forEach(ln => {
    const t = ln.replace(/^- /, '').trim();
    if (!/^[a-z][a-z0-9-]*\|/i.test(t)) return;
    const segs = t.split(' | ');
    const ref = segs.length >= 3 ? segs.slice(0, -2).join(' | ') : segs[0];
    recs.push({ store: 'ignored', id: null, st: '', ref: ref.trim(), reason: segs.length >= 3 ? segs[segs.length - 1] : '' });
  });
  return recs;
}
const RANK = { tasks: 0, inbox: 1, done: 2, ignored: 3 };
function storeOutcome(r) { return r.store === 'tasks' ? (/^waiting$/i.test(r.st) ? 'waiting' : 'open') : r.store; }
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
  const items = new Set(contain.map(r => r.id || 'ignored:' + r.ref));
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
  if (rel.length) return { outcome: 'related', ids: [...new Set(rel.map(r => r.id))], waiting: rel.some(r => /^waiting$/i.test(r.st)) };
  return null;
}

function actionFor(res, pass, c) {
  const id = res.ids && res.ids.length ? res.ids.join(', ') : '';
  const ask = pass === 'ask';
  switch (res.outcome) {
    case 'drop': return 'drop';
    case 'new': return ask ? 'classify: ask, commitment or neither' : 'clarify: capture it if actionable or FYI, otherwise ignore it';
    case 'ignored': return 'drop';
    case 'done': return ask ? 'drop' : `drop, unless it reopens the work: then capture it with reopen:true and name ${id} in a note`;
    case 'inbox': return ask ? 'drop' : `drop, unless it adds an ask or a date: then propose an update to ${id}`;
    case 'open': return ask ? `report: you replied ${c.when || '<date>'}, consider closing ${id}` : `drop, unless it adds an ask, a date or an answer: then propose an update to ${id}`;
    case 'waiting': return ask ? `report: ${id} chased ${c.when || '<date>'}` : `if it is from the person ${id} waits on: report "reply received, consider closing ${id}"; otherwise treat it as an update to an open task`;
    case 'related': return ask ? (res.waiting ? `drop: ${id} already waits on this chat` : 'classify: ask, commitment or neither') : `same topic as ${id}: propose an update; another topic: clarify as new`;
    case 'ambiguous': return ask ? 'classify: ask, commitment or neither' : `if it plainly continues one of ${id}, propose an update to that item; otherwise clarify it as new and name ${id} in a note`;
    case 'moved': return `report: ${id} moved to ${res.to}; propose that due; then run: discern ref ${res.ids[0]} "${res.newRef}"`;
    case 'cancelled': return `report: ${id} cancelled, consider closing`;
    case 'notice': return `propose an update to ${id}: ${res.notice}`;
    default: return 'clarify';
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
  if (!isDataFolder(d)) fail(`${d} has no TASKS.md, so it is not a Discerny data folder. To start a new one there, run: discern new ${want}`);
  fs.writeFileSync(LINK, d + '\n');
  const warnings = process.env.DISCERNY_DIR ? ['DISCERNY_DIR is set, and it overrides data-folder.txt until it is unset'] : [];
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
  fs.writeFileSync(LINK, d + '\n');
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
  const mgr = u && u.meta.mgr ? P.find(p => p.name === u.meta.mgr) : null;
  const prio = list(D, 'priority_people').map(id => P.find(p => p.meta.id === id) || { name: id, meta: {}, missing: true });
  if (mgr && !prio.includes(mgr)) prio.unshift(mgr);
  prio.filter(p => p.missing).forEach(p => warnings.push(`priority_people lists ${p.name}, which is not in PEOPLE.md`));
  const base = {
    source: name, run_start: iso(now), timezone: tz, local_now: local(now, tz), fixture,
    page_cap: +(val(b, 'page_cap') || val(D, 'page_cap') || 10),
    user, mention_terms: user ? [user.name.split(/\s+/)[0], ...user.handle] : [],
    priority_people: prio.filter(p => !p.missing).map(p => ({ id: p.meta.id || null, name: p.name, em: csv(p.meta.em) })),
    personal_domains: list(D, 'personal_domains'),
    apply_task_updates: /^true$/i.test(val(D, 'apply_task_updates')),
    log_runs: /^true$/i.test(val(D, 'log_runs')), warnings,
  };
  if (!b) { out({ ...base, exists: false, next: `No "## ${name}" block yet. Ask the user how far back to start, then run: discern commit ${name} watermark=<ISO time>` }); process.exit(2); }
  const settings = {};
  Object.keys(b.keys).forEach(k => { settings[k] = b.keys[k].list.length ? b.keys[k].list : b.keys[k].value; });
  const kind = val(b, 'kind') || (val(b, 'lookahead') ? 'horizon' : 'stream');
  const res = { ...base, exists: true, kind, settings };
  if (kind === 'horizon') {
    res.window = { after: iso(now), before: iso(now.getTime() + parseDuration(val(b, 'lookahead') || 'P7D')) };
    res.lookback = { after: val(b, 'last_run') || iso(now.getTime() - DAY), before: iso(now) };
    out(res); return;
  }
  const gap = val(b, 'gap');
  let from, to, mode = 'normal';
  if (gap) {
    const [g1, g2] = gap.split('/').map(s => new Date(s.trim()));
    if (isNaN(g1) || isNaN(g2) || g2 <= g1) fail(`gap: ${gap} must be <ISO start>/<ISO end>`);
    from = g1; to = g2; mode = 'backfill';
  } else {
    const wm = val(b, 'watermark');
    if (!wm) { out({ ...res, next: `"${name}" has no watermark. Ask the user how far back to start, then run: discern commit ${name} watermark=<ISO time>` }); process.exit(2); }
    from = new Date(new Date(wm).getTime() - parseDuration(val(b, 'overlap') || 'PT0S')); to = now;
  }
  const windows = [];
  for (let t = from.getTime(); t < to.getTime(); t += DAY) windows.push({ after: iso(t), before: iso(Math.min(t + DAY, to.getTime())) });
  res.mode = mode; res.windows = windows; res.cutoff = iso(from);
  if (mode === 'normal' && val(b, 'waiting_min_age') && val(b, 'waiting_max_age')) {
    const after = Math.max(val(b, 'waiting_checked_through') ? new Date(val(b, 'waiting_checked_through')).getTime() : 0, now.getTime() - parseDuration(val(b, 'waiting_max_age')));
    const before = now.getTime() - parseDuration(val(b, 'waiting_min_age'));
    if (after < before) res.ask_window = { after: iso(after), before: iso(before) };
  }
  out(res);
};

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
  const mine = new Set((u ? csv(u.meta.em) : []).map(e => e.toLowerCase()));
  const today = local(nowDate(), tz).slice(0, 10);
  out(items.map((it, i) => {
    const scheme = String(it.scheme || '').toLowerCase(), pass = it.pass === 'ask' ? 'ask' : 'inbound';
    const sender = String(it.sender || '').toLowerCase();
    // On the ask pass the sender is always the user, so who comes from the recipient (when given) and from_user is not reported.
    const r = { key: it.key !== undefined ? it.key : i, scheme, pass };
    if (pass === 'ask') {
      const to = String(it.recipient || '').toLowerCase();
      if (to || it.recipient_name) { const p = findPerson(to, P) || findPerson(it.recipient_name, P); r.who = p ? p.name : null; }
    } else {
      r.from_user = !!sender && mine.has(sender);
      if (!r.from_user && (sender || it.sender_name)) { const p = findPerson(sender, P) || findPerson(it.sender_name, P); r.who = p ? p.name : null; }
    }
    const c = { when: it.when ? local(toInstant(it.when), tz).slice(0, 10) : '' };
    let res = null;
    if (scheme === 'mail') {
      const n = normSubject(it.subject);
      c.norm = n.subject; r.ref = 'mail|' + n.subject; r.refs = [r.ref];
      if (n.notice) r.notice = n.notice;
      if (it.meeting_date) r.refs.push(calRef(it.meeting_date, n.subject));
      if (n.notice === 'Accepted' || n.notice === 'Tentative') res = { outcome: 'drop', ids: [] };
      else {
        res = matchMail(c, recs);
        if (!res && it.meeting_date) res = matchExact(r.refs[1], recs);
        if (n.notice === 'Declined' || n.notice === 'Canceled') res = res && res.outcome !== 'ignored' && res.ids.length ? { outcome: 'notice', ids: res.ids, notice: n.notice } : { outcome: 'drop', ids: [] };
      }
    } else if (scheme === 'teams') {
      if (!it.chat || !it.message) fail(`item ${r.key}: a teams item needs chat and message`);
      c.chatKey = chatKey(it.chat); c.message = String(it.message); r.ref = `teams|${c.chatKey}|${it.message}`; r.refs = [r.ref];
      if (it.meeting_date && it.subject) r.refs.push(calRef(it.meeting_date, it.subject));
      res = matchTeams(c, recs) || (it.meeting_date && it.subject ? matchExact(r.refs[1], recs) : null);
    } else if (scheme === 'cal') {
      const date = it.date || (it.start ? local(toInstant(it.start), tz).slice(0, 10) : '');
      if (!date || !it.subject) fail(`item ${r.key}: a cal item needs subject and date (or start)`);
      r.ref = calRef(date, it.subject, it.suffix); r.refs = [r.ref];
      if (it.event_id && !it.suffix) r.refs.push(`calid|${it.event_id}`);
      res = matchExact(r.ref, recs);
      if (!res && it.event_id && !it.suffix) {
        const same = recs.filter(x => x.ref === `calid|${it.event_id}` && x.id);
        if (same.length) {
          const id = same[0].id;
          const old = recs.filter(x => x.id === id && /^cal\|\d{4}-\d{2}-\d{2}\|[^|]*$/.test(x.ref)).map(x => x.ref.split('|')[1]);
          const moved = old.length && !old.includes(date) && old.every(d => d >= today);
          res = moved ? { outcome: 'moved', ids: [id], from: old[0], to: date, newRef: r.ref } : pick(same);
        }
      }
      if (it.cancelled) res = res && res.ids && res.ids.length && res.outcome !== 'ignored' && res.outcome !== 'done' ? { outcome: 'cancelled', ids: res.ids } : { outcome: 'drop', ids: [] };
    } else fail(`item ${r.key}: scheme must be mail, teams or cal`);
    res = res || { outcome: 'new', ids: [] };
    if (r.from_user) res = { outcome: 'drop', ids: [] };
    Object.assign(r, res); r.action = r.from_user ? "drop: the user's own message" : actionFor(res, pass, c);
    return r;
  }));
};

function itemLine(lines, id) { return lines.findIndex(l => new RegExp(`^- \\[( |x)\\] ${id} `).test(l)); }
function blockEnd(lines, i) { let j = i + 1; while (j < lines.length && /^ {2,}\S/.test(lines[j])) j++; return j; }
function lastOf(lines, i, j, kinds) { let at = -1; for (let k = i + 1; k < j; k++) if (kinds.some(x => lines[k].startsWith(`  - ${x}:`))) at = k; return at; }
function insertSub(id, kind, text, after) {
  for (const f of ['TASKS.md', 'INBOX.md']) {
    const t = read(f); if (!t) continue;
    const eol = eolOf(t), lines = t.split(/\r?\n/);
    const i = itemLine(lines, id); if (i < 0) continue;
    const j = blockEnd(lines, i);
    if (kind === 'ref' && lines.slice(i + 1, j).some(l => l.trim() === `- ref: ${text}`)) return { file: f, unchanged: true };
    let at = -1;
    for (const ks of after) { at = lastOf(lines, i, j, ks); if (at >= 0) break; }
    lines.splice((at >= 0 ? at : i) + 1, 0, `  - ${kind}: ${text.replace(/[\r\n]+/g, ' ')}`);
    write(f, lines.join(eol));
    return { file: f };
  }
  fail(`${id} is not in TASKS.md or INBOX.md`);
}

CMD.note = function () {
  const [, id, ...rest] = ARGS, text = rest.join(' ').trim();
  if (!id || !text) fail('usage: discern note <T-id> <text>');
  if (!/^true$/i.test(val(defaults(), 'apply_task_updates'))) fail('apply_task_updates is not true in SOURCES.md defaults: put this update in the report as a proposal instead', 2);
  out({ id, ...insertSub(id, 'note', text, [['note'], ['src']]) });
};

CMD.ref = function () {
  const [, id, ref] = ARGS;
  if (!id || !ref || !/^[a-z][a-z0-9-]*\|/i.test(ref)) fail('usage: discern ref <T-id> <scheme|key...>');
  out({ id, ref, ...insertSub(id, 'ref', ref, [['ref'], ['link', 'note', 'src']]) });
};

function listOf(v) { return [].concat(v === undefined || v === null ? [] : v).flatMap(x => String(x).split(',')).map(x => x.trim()).filter(Boolean); }
function cleanMeta(v) { return String(v).replace(/[\r\n]+/g, ' ').replace(/;/g, ',').replace(/[{}]/g, '').trim(); }
CMD.add = function () {
  const drafts = stdinJson(), tz = timezone(), now = nowDate();
  const P = people(), names = new Set(P.map(p => p.name));
  const prjText = read('PROJECTS.md');
  const recs = loadIndex(), known = new Set(recs.map(r => r.ref.toLowerCase()));
  const errors = [], built = [], seen = new Set();
  drafts.forEach((d, i) => {
    const e = m => errors.push(`draft ${i} (${d.title || 'untitled'}): ${m}`);
    const title = String(d.title || '').replace(/[\r\n]+/g, ' ').replace(/[{}]/g, '').trim();
    if (!title) e('title is empty');
    if (!C.TYPES.includes(d.ty)) e(`ty must be one of ${C.TYPES.join(', ')}`);
    if (!C.URG_ORDER.includes(d.urg)) e(`urg must be one of ${C.URG_ORDER.join(', ')}`);
    if (!['1', '2', '3'].includes(String(d.p))) e('p must be 1, 2 or 3');
    if (d.due && !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(d.due)) e('due must be YYYY-MM-DD or YYYY-MM-DD HH:MM');
    if (d.st && !['Waiting', 'In progress'].includes(d.st)) e('st must be Waiting or In progress');
    if (d.who && !names.has(d.who)) e(`who "${d.who}" is not a name in PEOPLE.md: leave who out and name the person in a note (AGENTS.md requires an exact match)`);
    const prj = listOf(d.prj);
    prj.forEach(x => { if (!new RegExp(`id:${x}[;}]`).test(prjText)) e(`prj ${x} is not in PROJECTS.md`); });
    if (!d.src) e('src is required');
    const refs = [].concat(d.refs || []).map(s => String(s).trim()).filter(Boolean);
    const notes = [].concat(d.notes || []).map(n => String(n).trim()).filter(Boolean);
    if (!refs.length) e('at least one ref is required');
    refs.forEach(r => {
      if (!/^[a-z][a-z0-9-]*\|/i.test(r)) e(`ref "${r}" must start with a scheme such as mail|`);
      if (isContainer(r) || /^calid\|/i.test(r)) return;
      const l = r.toLowerCase();
      if (known.has(l) && !(d.reopen && recs.some(x => x.ref.toLowerCase() === l && x.store === 'done'))) e(`ref "${r}" is already in the folder: this item is a duplicate`);
      if (seen.has(l)) e(`ref "${r}" appears twice in this batch`);
      seen.add(l);
    });
    if (d.ty === 'Meeting' && d.due && !refs.some(r => /^cal\|/i.test(r))) {
      const subj = d.meeting_subject || (refs.find(r => /^mail\|/i.test(r)) || '').slice(5);
      if (subj) refs.push(calRef(d.due.slice(0, 10), subj));
    }
    let asg = d.asg;
    if (asg && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(asg)) e('asg must be YYYY-MM-DD HH:MM');
    if (!asg) {
      if (d.derived) asg = local(now, tz);
      else if (d.received) asg = local(toInstant(d.received), tz);
      else e('give received (the message time, ISO with Z), or derived: true for an item made from a schedule');
    }
    const meta = { ty: d.ty, who: d.who ? cleanMeta(d.who) : undefined, prj: prj.length ? prj.join(',') : undefined,
      tg: listOf(d.tg).map(t => cleanMeta(t)).filter(Boolean).join(',') || undefined,
      urg: d.urg, p: String(d.p), due: d.due || undefined, st: d.st || undefined,
      dep: listOf(d.dep).join(',') || undefined, asg };
    Object.keys(meta).forEach(k => { if (meta[k] === undefined || meta[k] === '') delete meta[k]; else meta[k] = cleanMeta(meta[k]); });
    const subs = [{ k: 'src', v: String(d.src || '').replace(/[\r\n]+/g, ' ') }];
    notes.forEach(n => subs.push({ k: 'note', v: n.replace(/[\r\n]+/g, ' ') }));
    [].concat(d.links || []).forEach(l => subs.push({ k: 'link', v: typeof l === 'string' ? l : `[${l.label || 'link'}](${l.url})` }));
    refs.forEach(r => subs.push({ k: 'ref', v: r }));
    built.push({ title, meta, subs });
  });
  if (errors.length) fail('nothing was written. ' + errors.join(' | '));
  if (!built.length) { out({ added: [] }); return; }
  if (OPT.dry) { out({ dry_run: true, would_add: built.map(b => C.serItem({ id: 'T-????', done: false, title: b.title, meta: b.meta, subs: b.subs })) }); return; }
  // Raise the counter first, so an interrupted run leaves a gap, never a duplicate ID.
  let tasks = read('TASKS.md');
  if (!tasks.trim()) fail('TASKS.md is missing or empty');
  const maxId = t => C.parse(t).items.reduce((m, it) => Math.max(m, parseInt(it.id.slice(2), 10) + 1), 0);
  const start = Math.max(C.nextId(C.parse(tasks)), maxId(read('INBOX.md')), maxId(read('DONE.md')));
  const next = start + built.length, eol = eolOf(tasks);
  if (/<!-- next-id: \d+ -->/.test(tasks)) tasks = tasks.replace(/<!-- next-id: \d+ -->/, `<!-- next-id: ${next} -->`);
  else { const ls = tasks.split(/\r?\n/); ls.splice(1, 0, `<!-- next-id: ${next} -->`); tasks = ls.join(eol); }
  write('TASKS.md', tasks);
  const added = built.map((b, k) => ({ id: 'T-' + String(start + k).padStart(4, '0'), ...b }));
  appendLines('INBOX.md', added.map(a => C.serItem({ id: a.id, done: false, title: a.title, meta: a.meta, subs: a.subs })),
    '# Inbox\n<!-- Candidates proposed by the discern-* source skills. Accept moves an item to TASKS.md; Dismiss logs it in IGNORED.md. IDs come from the next-id counter in TASKS.md. -->\n');
  out({ added: added.map(a => ({ id: a.id, title: a.title, refs: a.subs.filter(s => s.k === 'ref').map(s => s.v) })), counter: next });
};

CMD.ignore = function () {
  const rows = stdinJson(), tz = timezone(), date = local(nowDate(), tz).slice(0, 10);
  const have = new Set(loadIndex().filter(r => r.store === 'ignored').map(r => r.ref.toLowerCase()));
  const lines = [], skipped = [];
  rows.forEach((r, i) => {
    const ref = String(r.ref || '').trim();
    if (!/^[a-z][a-z0-9-]*\|/i.test(ref)) fail(`row ${i}: ref must start with a scheme such as mail|`);
    if (isContainer(ref) && !r.container) fail(`row ${i}: ${ref} stands for a whole chat or thread; pass "container": true only when the whole of it is out of scope`);
    if (have.has(ref.toLowerCase())) { skipped.push(ref); return; }
    have.add(ref.toLowerCase());
    lines.push(`${ref} | ${date} | ${String(r.reason || 'not actionable').replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim()}`);
  });
  if (lines.length) appendLines('IGNORED.md', lines, '# Ignored\n<!-- One line per thread judged non-actionable: ref | YYYY-MM-DD | reason. Parse from the right (the ref may contain " | "). -->\n');
  out({ ignored: lines.length, skipped });
};

CMD.commit = function () {
  const name = ARGS[1];
  if (!name || ARGS.length < 3) fail('usage: discern commit <source> key=value [key=value ...]   (key= with no value removes the line)');
  const pairs = ARGS.slice(2).map(a => { const i = a.indexOf('='); if (i < 1) fail(`${a} is not key=value`); return [a.slice(0, i), a.slice(i + 1)]; });
  let text = read('SOURCES.md');
  if (!text.trim()) text = '# Sources\n';
  const eol = eolOf(text);
  let S = parseSources(text), lines = S.lines;
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
  write('SOURCES.md', lines.join(eol).replace(/(\r?\n)?$/, eol));
  out({ source: name, changed });
};

CMD.log = function () {
  const text = readStdin().trim();
  if (!text) fail('expected the report on stdin');
  const tz = timezone();
  appendLines('REFRESH-LOG.md', ['', `## ${local(nowDate(), tz)}`, '', text],
    '# Refresh log\n<!-- Append-only: one entry per source-skill run, newest last. Written by tools/discern.mjs log. -->');
  out({ logged: true });
};

CMD.check = function () {
  const errors = [], warnings = [];
  const files = ['TASKS.md', 'INBOX.md', 'DONE.md', 'PEOPLE.md', 'PROJECTS.md', 'SYSTEMS.md', 'SOURCES.md'];
  files.forEach(f => { if (fs.existsSync(fp(f)) && !read(f).trim()) errors.push(`${f} is empty`); });
  const sets = { 'TASKS.md': C.parse(read('TASKS.md')), 'INBOX.md': C.parse(read('INBOX.md')), 'DONE.md': C.parse(read('DONE.md')) };
  const seen = {}, all = new Set();
  let max = 0;
  Object.entries(sets).forEach(([f, m]) => m.items.forEach(it => {
    if (seen[it.id]) errors.push(`${it.id} appears in both ${seen[it.id]} and ${f}`);
    seen[it.id] = f; all.add(it.id); max = Math.max(max, parseInt(it.id.slice(2), 10));
    it.subs.filter(s => s.k === 'raw' && s.v.trim()).forEach(s => warnings.push(`${f} ${it.id}: unrecognised line "${s.v.trim().slice(0, 60)}"`));
    C.getSub(it, 'ref').forEach(s => { if (!/^[a-z][a-z0-9-]*\|./i.test(s.v.trim())) errors.push(`${f} ${it.id}: ref "${s.v}" has no scheme`); });
  }));
  const counter = (/<!-- next-id: (\d+) -->/.exec(read('TASKS.md')) || [])[1];
  if (!counter) errors.push('TASKS.md has no <!-- next-id: N --> counter');
  else if (+counter <= max) errors.push(`TASKS.md next-id is ${counter} but T-${String(max).padStart(4, '0')} exists: raise it to ${max + 1}`);
  const P = people(), names = new Set(P.map(p => p.name)), pids = new Set();
  P.forEach(p => { const id = p.meta.id; if (id) { if (pids.has(id)) errors.push(`PEOPLE.md: ${id} is used twice`); pids.add(id); } });
  const prj = new Set((read('PROJECTS.md').match(/id:PRJ-\d+/g) || []).map(s => s.slice(3)));
  const sys = new Set((read('SYSTEMS.md').match(/id:SYS-\d+/g) || []).map(s => s.slice(3)));
  Object.entries(sets).forEach(([f, m]) => m.items.forEach(it => {
    String(it.meta.prj || '').split(',').map(s => s.trim()).filter(Boolean).forEach(x => { if (!prj.has(x)) errors.push(`${f} ${it.id}: prj ${x} is not in PROJECTS.md`); });
    if (it.meta.who && !names.has(it.meta.who) && f !== 'DONE.md') warnings.push(`${f} ${it.id}: who "${it.meta.who}" is not a name in PEOPLE.md`);
  }));
  const exists = id => all.has(id) || pids.has(id) || prj.has(id) || sys.has(id);
  const rels = new Set();
  read('RELATIONSHIPS.md').replace(/\r/g, '').split('\n').forEach(l => {
    const m = /^- (\S+) (~|->) (\S+) \| (.+)$/.exec(l); if (!m) return;
    [m[1], m[3]].forEach(id => { if (!exists(id)) errors.push(`RELATIONSHIPS.md: ${id} does not exist (${l.trim()})`); });
    if (m[1] === m[3]) errors.push(`RELATIONSHIPS.md: self-link ${l.trim()}`);
    const k = m[2] === '~' ? [m[1], m[3]].sort().join('~') : m[1] + '->' + m[3];
    if (rels.has(k)) errors.push(`RELATIONSHIPS.md: duplicate ${l.trim()}`); rels.add(k);
  });
  const S = sources();
  if (!S.blocks.defaults) warnings.push('SOURCES.md has no "## defaults" block');
  else if (!val(S.blocks.defaults, 'timezone')) warnings.push('SOURCES.md defaults has no timezone');
  const { format, problem } = formatStanding(DIR);
  if (problem) errors.push(problem);
  out({ ok: !errors.length, errors, warnings, format, items: all.size, next_id: counter ? +counter : null });
  if (errors.length) process.exit(1);
};

CMD.migrate = function () {
  const changes = [];
  for (const f of ['TASKS.md', 'INBOX.md', 'DONE.md']) {
    const t = read(f); if (!t) continue;
    const eol = eolOf(t), lines = t.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s+- ref: )(teams\|[^|]+)\s*$/.exec(lines[i]);
      if (m) { changes.push(`${f}: ${m[2]} -> ${m[2]}|*`); lines[i] = m[1] + m[2] + '|*'; }
    }
    if (f !== 'DONE.md') {
      C.parse(lines.join('\n')).items.forEach(it => {
        if (it.done || it.meta.ty !== 'Meeting' || !/^\d{4}-\d{2}-\d{2}/.test(it.meta.due || '')) return;
        const refs = C.getSub(it, 'ref').map(b => b.v.trim());
        if (refs.some(r => /^cal\|/i.test(r))) return;
        const mail = refs.find(r => /^mail\|/i.test(r)); if (!mail) return;
        const ref = calRef(it.meta.due.slice(0, 10), mail.slice(5));
        const i = itemLine(lines, it.id), j = blockEnd(lines, i), at = lastOf(lines, i, j, ['ref']);
        lines.splice((at >= 0 ? at : i) + 1, 0, `  - ref: ${ref}`);
        changes.push(`${f}: ${it.id} + ${ref}`);
      });
    }
    if (OPT.write) write(f, lines.join(eol));
  }
  const ig = read('IGNORED.md');
  if (ig) {
    const eol = eolOf(ig), lines = ig.split(/\r?\n/);
    lines.forEach((l, i) => { const m = /^(- )?(teams\|[^| ]+)( \| .*)$/.exec(l); if (m) { changes.push(`IGNORED.md: ${m[2]} -> ${m[2]}|*`); lines[i] = (m[1] || '') + m[2] + '|*' + m[3]; } });
    if (OPT.write) write('IGNORED.md', lines.join(eol));
  }
  out({ written: OPT.write, changes, next: OPT.write || !changes.length ? undefined : 'run again with --write to apply' });
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

const cmd = ARGS[0];
if (cmd === '--version' || cmd === 'version') {
  process.stdout.write((C.VERSION || 'unknown') + '\n');
  process.exit(0);
}
if (!cmd || !CMD[cmd]) {
  process.stdout.write('usage: node tools/discern.mjs <connect|new|state|match|who|local|add|ignore|note|ref|commit|log|check|migrate|upgrade> [args] [--dir <folder>] [--now <ISO>]\nSee SOURCE-SKILLS.md for what each command does.\n');
  process.exit(cmd ? 1 : 0);
}
if (cmd !== 'connect' && cmd !== 'new') {
  if (!DIR) fail(NOT_CONNECTED, 2);
  if (!isDataFolder(DIR)) fail(`${DIR} (from ${FROM}) has no TASKS.md, so it is not a Discerny data folder`);
}
// A folder in another Format is refused before any command reads or writes it, except those that show or fix that.
if (!['connect', 'new', 'check', 'upgrade'].includes(cmd)) {
  const { format, problem } = formatStanding(DIR);
  if (problem) fail(`${problem}. ` + (format.is === 'older'
    ? 'Tell the user, and offer to upgrade it: they can ask you to "upgrade my Discerny folder", or run: discern upgrade'
    : newerAdvice(format)), 2);
}
CMD[cmd]();
