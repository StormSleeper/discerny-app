// Every field and line in the data files takes a readable name and layout (see migrations/README.md).
//   node migrate.mjs <data folder>            previews the changes
//   node migrate.mjs <data folder> --write    makes them
// 1. Braces on Items, People, Projects and Systems are written `key: value; key: value`, with the readable keys.
//    Items: ty → type, prj → projects, tg → tags (top joins them), urg → urgency, p → priority, due → due-date
//    and due-time, st → status, dep → dependencies, done → done-date, asg → received-datetime (received-date
//    when it has no time of day). Records: co → company, dept → department, mgr → manager, ext → external,
//    st → status, chk → checked-date, em → emails, handle → handles. Values go lowercase: a type (task,
//    project, platform…), a status (in progress, active, live…; To do goes, being none), urg:week → this week,
//    p 1, 2 and 3 → high, medium and low, ext:Y → external: yes. Lists are written `a, b`.
// 2. An Item's src: sub-line becomes origin:, and ref: becomes source-key:.
// 3. A Comment's changed: names the field by its new name, and a status in its from: and to: goes lowercase.
//    A change to due becomes one to due-date, or to due-time when only the time of day changed.
// 4. A Person's hist: line is laid out like a Comment: `  - history: {changed-date: …; changed: title}`, then
//    `    old → new` on the line below.
// 5. IGNORED.md lines become `- <source key> {ignored-date: …; reason: …}`, RELATIONSHIPS.md lines
//    `- A ~ B {kind: related}`, ASK-AGENT.md lines `- <ID> {requested-datetime: …}` with the request below them,
//    and ASK-AGENT-LOG.md lines `- <ID> {requested-datetime: …; actioned-datetime: …}` with `- request:` and
//    `- result:` sub-lines; text that went on with " ⏎ " goes on over lines indented 4 spaces instead.
// 6. SOURCES.md keys take hyphens for underscores; a list goes plural (personal-domains, watch-channels,
//    candidate-channels, chat-labels, prep-signals), and invite_count_cap and invite_check_cap are invite-check-cap.
// 7. Header comments that describe these lines are reworded to the new names, and long ones wrap, one sentence a line.
// Free text stays as written: Descriptions, Comment text, the request and result text, drafts and REFRESH-LOG.md.
// It stands alone: it reads the Format as it was before this Migration, never the app's parser.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2), WRITE = args.includes('--write'), DIR = args.find(a => a !== '--write');
const stop = msg => { console.error(msg); process.exit(1); };
if (!DIR || !fs.existsSync(path.join(DIR, 'TASKS.md'))) stop(`expected a Discerny data folder, holding TASKS.md, but got ${DIR || 'none'}`);

// The files this Migration rewrites, read once; each change is made here and written at the end.
const NAMES = ['TASKS.md', 'INBOX.md', 'DONE.md', 'PEOPLE.md', 'PROJECTS.md', 'SYSTEMS.md', 'RELATIONSHIPS.md',
  'IGNORED.md', 'ASK-AGENT.md', 'ASK-AGENT-LOG.md', 'SOURCES.md', 'DISMISSED.md'];
const files = new Map();
for (const f of NAMES) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, 'utf8');
  files.set(f, { text, eol: /\r\n/.test(text) ? '\r\n' : '\n', said: [] });
}
const linesOf = f => files.get(f).text.split(/\r?\n/);
const save = (f, lines) => { const x = files.get(f); x.text = lines.join(x.eol); };
const say = (f, s) => files.get(f).said.push(s);
const notice = [];

const ID = '(?:T|P|PRJ|SYS)-\\d+', DATE = /^\d{4}-\d{2}-\d{2}$/, DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const STAMP = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/;
const CONT = String.fromCharCode(32, 0x23ce, 32);
// a value as the braces hold it: one line, and no ; { or }
const clean = v => String(v).replace(/[;{}]/g, ',').replace(/\s+/g, ' ').trim();
const list = (v, sep) => String(v).split(sep).map(s => s.trim()).filter(Boolean);
const lower = v => String(v).toLowerCase();

// ---- the readable names: [new key, how its value is written], for an Item and for a Record
const ids = v => list(v, /[ ,]+/).join(', ');
const ITEM_KEYS = {
  ty: ['type', lower],
  prj: ['projects', ids],
  tg: ['tags', v => list(v, ',').join(', ')],
  urg: ['urgency', v => (lower(v) === 'week' ? 'this week' : lower(v))],
  p: ['priority', v => ({ 1: 'high', 2: 'medium', 3: 'low' })[v.trim()] || lower(v)],
  st: ['status', v => (/^to do$/i.test(v.trim()) ? '' : lower(v))],
  dep: ['dependencies', ids],
  done: ['done-date', v => (STAMP.exec(v.trim()) || [, v])[1]],
};
const RECORD_KEYS = {
  co: ['company', v => v],
  dept: ['department', v => v],
  mgr: ['manager', v => v],
  ext: ['external', v => (/^(y|yes|true|1)$/i.test(v.trim()) ? 'yes' : /^(n|no|false|0)$/i.test(v.trim()) ? 'no' : lower(v))],
  st: ['status', lower],
  chk: ['checked-date', v => v],
  em: ['emails', v => list(v, /[ ,]+/).join(', ')],
  handle: ['handles', v => list(v, /[ ,]+/).join(', ')],
};

// The braces at the end of a line, from the final " {" -> {head, parts: [[key, value] | [null, bare]]}, or null
function braces(line) {
  const i = line.lastIndexOf(' {');
  if (i < 0 || !line.endsWith('}')) return null;
  const parts = line.slice(i + 2, -1).split(';').map(p => {
    const k = p.indexOf(':');
    return k > 0 ? [p.slice(0, k).trim(), p.slice(k + 1).trim()] : [null, p.trim()];
  }).filter(([k, v]) => k || v);
  return { head: line.slice(0, i), parts };
}
const writeBraces = parts => '{' + parts.map(([k, v]) => (k ? `${k}: ${v}` : v)).join('; ') + '}';

// An Item's braces with the new keys and values -> [parts, what changed]
function itemParts(parts) {
  const out = [], did = [];
  let top = null;
  for (const [k, v] of parts) {
    if (k === 'top') { top = v; did.push('top joins tags'); continue; }
    if (k === 'due') {
      const m = STAMP.exec(v);
      if (!m) notice.push(`due:${v} is not a date: it is kept as due-date as written`);
      out.push(['due-date', m ? m[1] : v]);
      if (m && m[2]) out.push(['due-time', m[2]]);
      did.push(m && m[2] ? 'due → due-date and due-time' : 'due → due-date');
      continue;
    }
    if (k === 'asg') {
      const key = DATE.test(v) ? 'received-date' : 'received-datetime';
      out.push([key, v]); did.push(`asg → ${key}`); continue;
    }
    const r = k && ITEM_KEYS[k];
    if (!r) { out.push([k, v]); continue; }
    const nv = r[1](v);
    did.push(nv ? `${k} → ${r[0]}${nv !== v ? `: ${nv}` : ''}` : `${k}:${v} goes, being none`);
    if (nv) out.push([r[0], nv]);
  }
  if (top) {
    const t = out.find(([k]) => k === 'tags');
    if (!t) out.push(['tags', top]);
    else if (!list(t[1], ',').some(x => x.toLowerCase() === top.toLowerCase())) t[1] += ', ' + top;
  }
  return [out, did];
}
function recordParts(parts) {
  const out = [], did = [];
  for (const [k, v] of parts) {
    if (k === 'type' && v !== lower(v)) { out.push([k, lower(v)]); did.push(`type: ${lower(v)}`); continue; }
    const r = k && RECORD_KEYS[k];
    if (!r) { out.push([k, v]); continue; }
    const nv = r[1](v);
    out.push([r[0], nv]); did.push(`${k} → ${r[0]}${nv !== v ? `: ${nv}` : ''}`);
  }
  return [out, did];
}
// A line's braces rewritten, and the key: value spacing; null when nothing changes
function rebrace(line, fix) {
  const b = braces(line);
  if (!b) return null;
  const [parts, did] = fix(b.parts), now = b.head + ' ' + writeBraces(parts);
  return now === line ? null : { line: now, did: did.length ? did.join(', ') : 'key: value spacing' };
}

// ---- a Comment's changed: names the field by its new name
const CHANGED = { due: 'due-date', ...Object.fromEntries(Object.entries(ITEM_KEYS).map(([k, r]) => [k, r[0]])), asg: 'received-datetime',
  ...Object.fromEntries(Object.entries(RECORD_KEYS).map(([k, r]) => [k, r[0]])) };
function comment(line, record) {
  const m = /^(  - comment: )(\{.*\})\s*$/.exec(line), b = m && braces(' ' + m[2]);
  if (!b) return null;
  const f = Object.fromEntries(b.parts.filter(([k]) => k)), old = f.changed;
  if (!old || !CHANGED[old]) return null;
  // the old value and the new written as the field now is: an Item's and a Record's keys differ (st on either is status)
  let now = CHANGED[old], from = f.from, to = f.to;
  if (old === 'due') {
    const a = STAMP.exec(from || '') || [, from || '', ''], z = STAMP.exec(to || '') || [, to || '', ''];
    if (a[1] === z[1] && (a[2] || '') !== (z[2] || '')) { now = 'due-time'; from = a[2] || ''; to = z[2] || ''; }
    else { from = a[1]; to = z[1]; }
    if (now === 'due-date' && (a[2] || z[2]) && (a[2] || '') !== (z[2] || '')) notice.push(`A Comment's change to due moved both the day and the time (${f.from} to ${f.to}): it now names due-date only.`);
  } else {
    const r = (record ? RECORD_KEYS : ITEM_KEYS)[old] || ITEM_KEYS[old] || RECORD_KEYS[old];
    if (r && from) from = r[1](from);
    if (r && to) to = r[1](to);
  }
  const parts = b.parts.map(([k, v]) => [k, k === 'changed' ? now : k === 'from' ? from : k === 'to' ? to : v]);
  return { line: m[1] + writeBraces(parts), did: `a Comment's changed: ${old} becomes ${now}` };
}

// ---- 1, 2 and 3. Items: braces, sub-lines and Comments
const ITEM = /^- \[( |x)\] (T-\d+) /;
for (const f of ['TASKS.md', 'INBOX.md', 'DONE.md']) {
  if (!files.has(f)) continue;
  const ls = linesOf(f);
  let cur = null, n = { src: 0, ref: 0 };
  for (let i = 0; i < ls.length; i++) {
    if (ls[i] === '## Changes') break;
    const it = ITEM.exec(ls[i]);
    if (it) {
      cur = it[2];
      const r = rebrace(ls[i], itemParts);
      if (r) { ls[i] = r.line; say(f, `${cur}: ${r.did}`); }
      continue;
    }
    if (!cur) continue;
    const s = /^  - (src|ref):(.*)$/.exec(ls[i]);
    if (s) { ls[i] = `  - ${s[1] === 'src' ? 'origin' : 'source-key'}:${s[2]}`; n[s[1]]++; continue; }
    const c = comment(ls[i], false);
    if (c) { ls[i] = c.line; say(f, `${cur}: ${c.did}`); }
  }
  if (n.src) say(f, `${n.src} src: line${n.src > 1 ? 's become' : ' becomes'} origin:`);
  if (n.ref) say(f, `${n.ref} ref: line${n.ref > 1 ? 's become' : ' becomes'} source-key:`);
  save(f, ls);
}

// ---- 1, 3 and 4. Records: braces, Comments and a Person's history
const LABELS = { 'job title': 'title', company: 'company', department: 'department', 'reports to': 'manager', group: 'group',
  email: 'emails', emails: 'emails', status: 'status' };
function history(v) {
  const m = /^(\d{4}-\d{2}-\d{2}) \| (?:([^:|]+?): )?(.*)$/.exec(v.trim());
  if (!m) return ['  - history: {}', `    ${v.trim()}`];
  const field = m[2] && (LABELS[m[2].trim().toLowerCase()] || m[2].trim().toLowerCase().replace(/\s+/g, '-'));
  return [`  - history: {changed-date: ${m[1]}${field ? `; changed: ${field}` : ''}}`, `    ${m[3].trim()}`];
}
for (const f of ['PEOPLE.md', 'PROJECTS.md', 'SYSTEMS.md']) {
  if (!files.has(f)) continue;
  const ls = linesOf(f);
  let cur = null, started = false, hist = 0;
  for (let i = 0; i < ls.length; i++) {
    if (/^## /.test(ls[i])) { started = true; cur = null; continue; }
    const m = /^- (.+)$/.exec(ls[i]);
    if (m) {
      started = true;
      const b = braces(ls[i]), id = b && (b.parts.find(([k]) => k === 'id') || [])[1];
      cur = id || (b ? b.head.slice(2) : m[1]);
      const r = rebrace(ls[i], recordParts);
      if (r) { ls[i] = r.line; say(f, `${cur}: ${r.did}`); }
      continue;
    }
    if (!started || !cur) continue;
    const h = f === 'PEOPLE.md' && /^  - hist: ?(.*)$/.exec(ls[i]);
    if (h) { ls.splice(i, 1, ...history(h[1])); i++; hist++; continue; }
    const c = comment(ls[i], true);
    if (c) { ls[i] = c.line; say(f, `${cur}: ${c.did}`); }
  }
  if (hist) say(f, `${hist} hist: line${hist > 1 ? 's are' : ' is'} laid out like a Comment, as history:`);
  save(f, ls);
}

// ---- 5. IGNORED.md, RELATIONSHIPS.md, ASK-AGENT.md and ASK-AGENT-LOG.md take the new line shapes
function lines(f, each, what) {
  if (!files.has(f)) return;
  const ls = linesOf(f), out = [];
  let n = 0;
  ls.forEach(l => { const r = each(l); if (r) { out.push(...r); n++; } else out.push(l); });
  if (n) { save(f, out); say(f, `${n} line${n > 1 ? 's' : ''} now read${n > 1 ? '' : 's'} ${what}`); }
}
lines('IGNORED.md', l => {
  const m = /^(?:- )?([a-z][a-z0-9-]*\|.*?) \| (\d{4}-\d{2}-\d{2})(?: \| ([^|]*))?$/i.exec(l);
  if (!m) return null;
  const reason = clean(m[3] || '');
  return [`- ${m[1].trim()} {ignored-date: ${m[2]}${reason ? `; reason: ${reason}` : ''}}`];
}, '`- <source key> {ignored-date: …; reason: …}`');
lines('RELATIONSHIPS.md', l => {
  const m = new RegExp(`^- (${ID}) (~|->) (${ID}) \\| (.+)$`).exec(l);
  return m && [`- ${m[1]} ${m[2]} ${m[3]} {kind: ${clean(lower(m[4]))}}`];
}, '`- A ~ B {kind: …}` or `- A -> B {kind: …}`');
// a time as a field named after its event: -datetime for a date and time, -date for a day
const when = (event, v) => (DATETIME.test(v) ? `${event}-datetime: ${v}` : DATE.test(v) ? `${event}-date: ${v}` : null);
const textLines = t => String(t).split(CONT.trim()).map(s => s.trim()).filter(Boolean);
lines('ASK-AGENT.md', l => {
  const m = new RegExp(`^- (${ID}) \\| (\\d{4}-\\d{2}-\\d{2}(?: \\d{2}:\\d{2})?) \\| (.*)$`).exec(l);
  return m && [`- ${m[1]} {${when('requested', m[2])}}`, ...textLines(m[3]).map(t => `    ${t}`)];
}, '`- <ID> {requested-datetime: …}`, with the request on the lines below');
lines('ASK-AGENT-LOG.md', l => {
  const m = new RegExp(`^- (?:actioned )?(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}) \\| (${ID}) \\| queued (.+?) \\| (.*)$`).exec(l);
  if (!m) return null;
  const asked = when('requested', m[3].trim());
  if (!asked) { notice.push(`ASK-AGENT-LOG.md: "${l}" is left as it is: its queued time is not a date.`); return null; }
  const k = m[4].indexOf(' | '), request = k < 0 ? m[4] : m[4].slice(0, k), result = k < 0 ? '' : m[4].slice(k + 3);
  const sub = (name, t) => { const ts = textLines(t); return ts.length ? [`  - ${name}: ${ts[0]}`, ...ts.slice(1).map(x => `    ${x}`)] : []; };
  return [`- ${m[2]} {${asked}; actioned-datetime: ${m[1]}}`, ...sub('request', request), ...sub('result', result)];
}, '`- <ID> {requested-datetime: …; actioned-datetime: …}` with request: and result: sub-lines');

// ---- 6. SOURCES.md keys
const PLURAL = { personal_domains: 'personal-domains', watch_channels: 'watch-channels', candidate_channels: 'candidate-channels',
  chat_labels: 'chat-labels', prep_signals: 'prep-signals', invite_count_cap: 'invite-check-cap', invite_check_cap: 'invite-check-cap' };
if (files.has('SOURCES.md')) {
  const ls = linesOf('SOURCES.md'), did = [];
  ls.forEach((l, i) => {
    const m = /^- ([A-Za-z0-9]+(?:_[A-Za-z0-9]+)+):(.*)$/.exec(l);
    if (!m) return;
    const key = PLURAL[m[1]] || m[1].replace(/_/g, '-');
    ls[i] = `- ${key}:${m[2]}`;
    did.push(`${m[1]} → ${key}`);
  });
  if (did.length) { save('SOURCES.md', ls); say('SOURCES.md', `keys take hyphens: ${[...new Set(did)].join(', ')}`); }
}

// ---- 7. header comments
// [words only the old header has, the new header] for a file whose lines changed shape
const HEADERS = {
  'IGNORED.md': ['ref | YYYY-MM-DD | reason', [
    'One line per source key never to be proposed again, ignored by a source skill or deleted by the user:',
    '`- <source key> {ignored-date: YYYY-MM-DD; reason: not actionable}`. Parse the braces from the final " {".',
    'A Proposal the user dismisses goes in DISMISSED.md instead.',
    'A No to a proposed change is kept here too, as rel|<id>|<id> (either order) or person|<address>;',
    'a No to a Priority person is kept as priority|<P-id>, and pauses them for 28 days only.']],
  'RELATIONSHIPS.md': ['`- A ~ B | related`', [
    'One line per Relationship, stored once (shown on both):',
    '`- A ~ B {kind: related}` (symmetric) or `- A -> B {kind: <kind>}` (involves, concerns, owns, uses).',
    'Validate: both IDs exist, no duplicates, nothing related to itself.',
    '`dependencies` on Items are separate.']],
  'ASK-AGENT.md': ['- ID | YYYY-MM-DD HH:MM | text', [
    'The agent queue, written by discerny.html. One entry per agent request:',
    '`- <ID> {requested-datetime: YYYY-MM-DD HH:MM}`, then the request on the lines below it, indented 4 spaces.',
    'The agent removes an entry once it is actioned (skill: discern-ask-agent) and records it in ASK-AGENT-LOG.md.']],
  'ASK-AGENT-LOG.md': ['| queued YYYY-MM-DD HH:MM |', [
    'Append-only. One entry per actioned agent request:',
    '`- <ID> {requested-datetime: YYYY-MM-DD HH:MM; actioned-datetime: YYYY-MM-DD HH:MM}`,',
    'then `  - request: <the request>` and `  - result: <what the agent did>`, each going on over lines indented 4 spaces.']],
  'DONE.md': ['with done:YYYY-MM-DD', [
    'Completed Items, moved here from TASKS.md as [x] with done-date: YYYY-MM-DD.',
    'Read only when asked.']],
};
// the old names a header uses in passing, and the new
const WORDS = [[/\bwho: on items\b/g, '`who` on Items'], [/\bco = /g, '`company` = '], [/\bext:Y\b/g, '`external: yes`']];
// one sentence a line, a sentence longer than WIDTH going on over the next lines, never breaking inside "quotes"
const WIDTH = 100;
const wrap = body => body.split(/(?<=\.) (?=\S)/).flatMap(s => {
  const out = [];
  for (const w of s.match(/(?:"[^"]*"|\S)+/g)) {
    if (out.length && (out[out.length - 1] + ' ' + w).length <= WIDTH) out[out.length - 1] += ' ' + w;
    else out.push(w);
  }
  return out;
});
// the lines of a comment, each after the first lined up under the first's text
const asComment = ls => ls.map((l, k) => (k ? '     ' : '<!-- ') + l + (k === ls.length - 1 ? ' -->' : ''));
for (const [f, x] of files) {
  const ls = linesOf(f);
  // A header comment is on one line, before the first record, heading or item, and isn't the next-id counter.
  const i = ls.findIndex((l, k) => k < 6 && /^<!-- .* -->$/.test(l) && !/^<!--\s*(next-id|format):/.test(l));
  if (i < 0) continue;
  const body = ls[i].slice(5, -4), h = HEADERS[f];
  let now;
  if (h && body.includes(h[0])) now = h[1];
  else {
    const swapped = WORDS.reduce((b, [re, to]) => b.replace(re, to), body);
    if (swapped === body && body.length <= 100) continue;
    now = wrap(swapped);
    if (now.length < 2 && swapped === body) continue;
  }
  ls.splice(i, 1, ...asComment(now));
  save(f, ls);
  say(f, h && body.includes(h[0]) ? 'header comment reworded to the new line shape' : 'header comment wraps, one sentence a line' + (WORDS.some(([re]) => new RegExp(re.source).test(body)) ? ', with the new names' : ''));
}

const changed = [...files].filter(([, x]) => x.said.length);
for (const [f, x] of changed) if (!x.text.trim()) stop(`refusing to leave ${f} empty`);
if (WRITE) for (const [f, x] of changed) fs.writeFileSync(path.join(DIR, f), x.text);
console.log([...new Set(notice), ...(changed.length
  ? [WRITE ? 'Changed:' : 'Would change:', ...changed.flatMap(([f, x]) => [f, ...x.said.map(s => `  ${s}`)])]
  : ['Nothing to change: every field and line already has its readable name.'])].join('\n'));
