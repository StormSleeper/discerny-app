// A first Interaction log, inferred from the data folder's existing Items (see migrations/README.md).
//   node migrate.mjs <data folder>            previews the changes
//   node migrate.mjs <data folder> --write    makes them
// 1. INTERACTIONS.md is written if it's missing. Unless it already has lines, it gets one for each event and decision below, each marked inferred: yes.
//    - An open or done Item, by its origin with any quoted subject removed: a message from someone is message, "sent to" or "<user> asked" is reply,
//      "Transcript of" is linked, "Calendar" is nothing, and anything else with a who is linked. Dated by received-datetime or received-date.
//    - A done Item with a who is also done, dated by done-date.
//    - An acknowledged, dated Comment on an Item, by an author other than user, agent and calendar: a change of who is linked for its "to",
//      "You replied" or "Chased" is reply, and any other is comment. Dated by added-datetime.
//    - An involves Relationship between an Item and a Person is linked, dated by the Item's date.
//    - Someone in priority-people is decision start, with their score at the Migration's date. A priority|<P-id> line in IGNORED.md is decision no.
//    Credit goes to the Item's who unless that says otherwise, and never to the user, Unassigned or a who not in PEOPLE.md.
//    There's at most one message, linked and done for each Person on each Item. Items still in INBOX.md, Comments still to acknowledge, and undated ones are skipped.
// 2. A Proposal waiting in INBOX.md gets interaction, by the same origin rules, and a Comment still to acknowledge gets sender, from the Item's who.
//    A field already there is left alone.
// It stands alone: it reads the Format as it was before this Migration, never the app's parser.
// DISCERN_NOW, as for the helper, gives the Migration's date in place of today's.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2), WRITE = args.includes('--write'), DIR = args.find(a => a !== '--write');
if (!DIR || !fs.existsSync(path.join(DIR, 'TASKS.md'))) {
  console.error(`expected a Discerny data folder, holding TASKS.md, but got ${DIR || 'none'}`);
  process.exit(1);
}

const LOG = 'INTERACTIONS.md';
const HEAD = `# Interactions
<!-- The log the Interaction score is worked out from, keyed by P-ID. One line per event, written as it gets past the Inbox:
     \`- YYYY-MM-DD P-#### <kind> T-####\`, the kind being message, comment, linked, reply or done.
     One line per decision about a Priority person, with the score and breakdown at that moment:
     \`- YYYY-MM-DD P-#### decision <yes|no|promote|demote|start> {score: …; message: …; half-life-days: …}\`.
     \`{inferred: yes}\` marks a line an Upgrade inferred from older data. discerny.html and tools/discern.mjs write this file. -->

`;
const USER = 'P-0001', KINDS = ['message', 'comment', 'linked', 'reply', 'done'], ONCE = ['message', 'linked', 'done'];
const WEIGHTS = { message: 2, comment: 2, linked: 2, reply: 1, done: 1 };

const file = f => path.join(DIR, f);
const read = f => fs.existsSync(file(f)) ? fs.readFileSync(file(f), 'utf8') : '';
const linesOf = t => t.split(/\r?\n/);
const eolOf = t => /\r\n/.test(t) ? '\r\n' : '\n';
// the braces at the end of a line, parsed from the final " {" -> {text, fields}
function braces(s) {
  const at = s.lastIndexOf(' {'), fields = {};
  if (at < 0 || !s.endsWith('}')) return { text: s, fields };
  s.slice(at + 2, -1).split(';').forEach(p => { const i = p.indexOf(':'); if (i > 0) fields[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return { text: s.slice(0, at), fields };
}
const dayOf = s => (/^\d{4}-\d{2}-\d{2}/.exec(String(s || '')) || [''])[0];

// PEOPLE.md: who can get credit, and the user's name
const people = [];
linesOf(read('PEOPLE.md')).forEach(l => {
  const m = /^- (.+)$/.exec(l);
  if (!m) return;
  const { text, fields } = braces(m[1]);
  if (/^P-\d+$/.test(fields.id || '')) people.push({ name: text.trim(), id: fields.id });
});
const byName = new Map(people.map(p => [p.name, p])), byId = new Map(people.map(p => [p.id, p]));
const userName = (byId.get(USER) || {}).name || '';
const creditable = id => id !== USER && byId.has(id);

// An Item file -> {lines, items: [{id, at, fields, origin, comments: [{at, fields, text}]}]}. INBOX.md's Changes come after its Items, and aren't Items.
function itemsOf(f) {
  const text = read(f), lines = linesOf(text), items = [];
  let cur = null, cm = null;
  for (let at = 0; at < lines.length; at++) {
    const l = lines[at];
    if (/^## /.test(l)) { cur = cm = null; if (f === 'INBOX.md') break; continue; }
    const m = /^- \[( |x)\] (T-\d+) (.*)$/.exec(l);
    if (m) { cur = { id: m[2], at, fields: braces(m[3]).fields, origin: '', comments: [] }; items.push(cur); cm = null; continue; }
    if (!cur) continue;
    if (cm && /^ {4}/.test(l)) { if (!cm.text) cm.text = l.slice(4); continue; }
    cm = null;
    const o = /^ {2}- origin: ?(.*)$/.exec(l);
    if (o) { if (!cur.origin) cur.origin = o[1]; continue; }
    const c = /^ {2}- comment: ?\{(.*)\}\s*$/.exec(l);
    if (c) { cm = { at, fields: braces(' {' + c[1] + '}').fields, text: '' }; cur.comments.push(cm); continue; }
    if (!/^ /.test(l) && l.trim()) cur = null;
  }
  return { text, lines, items };
}

// How an Item's origin counts, with any quoted subject out of the way so that a subject can't mislead the match.
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asked = userName ? new RegExp(`(^|[\\s—–-])(${esc(userName)}|${esc(userName.split(/\s+/)[0])}) asked\\b`, 'i') : null;
function originKind(origin) {
  const o = String(origin || '').replace(/"(.*)"/, '""').replace(/“(.*)”/, '""').trim();
  if (/^Calendar\b/i.test(o)) return 'none';
  if (/^Transcript of\b/i.test(o)) return 'linked';
  if (/\bsent to\b/i.test(o) || (asked && asked.test(o))) return 'reply';
  if (/\bfrom\b/i.test(o) || /^Teams\b/i.test(o)) return 'message';
  return 'linked';
}

const skipped = new Map();
const skip = (why, n = 1) => skipped.set(why, (skipped.get(why) || 0) + n);
const NOT_PERSON = 'Items or Comments crediting a who not in PEOPLE.md';

const tasks = itemsOf('TASKS.md'), done = itemsOf('DONE.md'), inbox = itemsOf('INBOX.md');
const placed = new Map();
[...tasks.items, ...done.items].forEach(i => placed.set(i.id, i));

// who, resolved -> a P-ID, or '' for no one. A name that's not in PEOPLE.md is counted as skipped; the user and Unassigned simply never count.
function credit(name) {
  if (!name || name === 'Unassigned') return '';
  const p = byName.get(name);
  if (!p) { skip(NOT_PERSON); return ''; }
  return p.id === USER ? '' : p.id;
}

const events = [], have = new Set();
function add(date, person, kind, item) {
  if (!person) return;
  const key = `${person}|${kind}|${item}`;
  if (ONCE.includes(kind)) { if (have.has(key)) return; have.add(key); }
  events.push({ date, person, kind, item });
}

skip('Items still in the Inbox', inbox.items.length);
for (const it of [...tasks.items, ...done.items]) {
  const f = it.fields, day = dayOf(f['received-datetime'] || f['received-date']), kind = originKind(it.origin);
  if (kind !== 'none' && f.who) {
    if (!day) skip('undated Items');
    else add(day, credit(f.who), kind, it.id);
  }
  if (done.items.includes(it) && f.who) {
    const when = dayOf(f['done-date']);
    if (!when) skip('undated Items');
    else add(when, credit(f.who), 'done', it.id);
  }
  for (const c of it.comments) {
    const cf = c.fields;
    if (['user', 'agent', 'calendar'].includes(cf.author)) continue;
    if (/^no$/i.test(cf.acknowledged || '')) { skip('Comments still to acknowledge'); continue; }
    const when = dayOf(cf['added-datetime']);
    if (!when) { skip('undated Comments'); continue; }
    if (cf.changed === 'who') add(when, credit(cf.to), 'linked', it.id);
    else if (/^(You replied|Chased)\b/.test(c.text)) add(when, credit(f.who), 'reply', it.id);
    else add(when, credit(f.who), 'comment', it.id);
  }
}
const inboxIds = new Set(inbox.items.map(i => i.id));
linesOf(read('RELATIONSHIPS.md')).forEach(l => {
  const m = /^- (T-\d+) -> (P-\d+) \{(?:[^{}]*?;\s*)?kind:\s*involves\s*(?:;[^{}]*)?\}\s*$/.exec(l);
  if (!m) return;
  if (inboxIds.has(m[1])) return skip('Items still in the Inbox');
  const it = placed.get(m[1]);
  if (!it) return;
  const day = dayOf(it.fields['received-datetime'] || it.fields['received-date']);
  if (!day) return skip('undated Items');
  if (creditable(m[2])) add(day, m[2], 'linked', m[1]);
  else if (m[2] !== USER) skip(NOT_PERSON);
});

// SOURCES.md's "## defaults", SETTINGS.toml, and today in the user's time zone
function defaultsKey(key) {
  const ls = linesOf(read('SOURCES.md'));
  let on = false;
  for (let i = 0; i < ls.length; i++) {
    if (/^## /.test(ls[i])) { if (on) break; on = /^## defaults\s*$/.test(ls[i]); continue; }
    const m = on && new RegExp(`^- ${key}:\\s*(.*?)\\s*$`).exec(ls[i]);
    if (!m) continue;
    const vals = m[1].split(',').map(s => s.trim()).filter(Boolean);
    if (!vals.length) for (i++; i < ls.length && /^ {2,}- /.test(ls[i]); i++) vals.push(ls[i].replace(/^ {2,}- /, '').trim());
    return vals;
  }
  return [];
}
function setting(table, key, fallback, least) {
  let on = false, val = fallback;
  linesOf(read('SETTINGS.toml')).forEach(l => {
    const h = /^\s*\[\s*([A-Za-z0-9_-]+)\s*\]/.exec(l);
    if (h) { on = h[1] === table; return; }
    const m = on && new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)\\s*(#.*)?$`).exec(l);
    if (m && +m[1] >= least) val = +m[1];
  });
  return val;
}
function today() {
  const given = dayOf(process.env.DISCERN_NOW);
  if (given) return given;
  const fmt = zone => {
    const p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return `${p.year}-${p.month}-${p.day}`;
  };
  try { return fmt(defaultsKey('timezone')[0]); } catch (e) { return fmt(undefined); }
}

// The score at the Migration's date, as the app works it out, to go on a decision start.
function scoreLine(person, date) {
  const half = setting('score', 'half-life-days', 30, 1), shares = Object.fromEntries(KINDS.map(k => [k, 0]));
  const ms = s => Date.parse(s + 'T00:00:00Z');
  events.filter(e => e.person === person).forEach(e => {
    const age = Math.max(Math.round((ms(date) - ms(e.date)) / 86400000), 0);
    if (!isNaN(age)) shares[e.kind] += setting('weights', e.kind, WEIGHTS[e.kind], 0) * Math.pow(0.5, age / half);
  });
  const tenths = n => Math.round(n * 10) / 10, total = KINDS.reduce((n, k) => n + shares[k], 0);
  return [`score: ${tenths(total)}`, ...KINDS.map(k => `${k}: ${tenths(shares[k])}`), `half-life-days: ${half}`].join('; ');
}

const NOW = today(), decisions = [];
defaultsKey('priority-people').filter(creditable).forEach(id => decisions.push({ date: NOW, line: `- ${NOW} ${id} decision start {${scoreLine(id, NOW)}; inferred: yes}` }));
linesOf(read('IGNORED.md')).forEach(l => {
  const m = /^- priority\|(P-\d+)( \{.*\})\s*$/.exec(l);
  if (!m) return;
  const when = dayOf(braces(m[2]).fields['ignored-date']);
  if (!when) return skip('undated No answers to a Priority person');
  if (creditable(m[1])) decisions.push({ date: when, line: `- ${when} ${m[1]} decision no {inferred: yes}` });
});

const changes = [], writes = [];

// The log
const logText = read(LOG), hasLines = linesOf(logText).some(l => /^- /.test(l));
if (!hasLines) {
  const all = [...events.map(e => ({ date: e.date, line: `- ${e.date} ${e.person} ${e.kind} ${e.item} {inferred: yes}` })), ...decisions];
  const sorted = all.map((x, k) => [x, k]).sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1])).map(x => x[0].line);
  if (sorted.length || !logText.trim()) {
    const base = logText.trim() ? logText : HEAD, eol = eolOf(base);
    const body = (base.endsWith('\n') ? base : base + eol) + sorted.map(l => l + eol).join('');
    writes.push([LOG, body]);
    const count = k => events.filter(e => e.kind === k).length;
    changes.push(LOG, `  ${logText.trim() ? 'gains' : 'written, with'} ${events.length} inferred event${events.length === 1 ? '' : 's'} and ${decisions.length} decision${decisions.length === 1 ? '' : 's'}`);
    changes.push(`  by kind: ${KINDS.map(k => `${k} ${count(k)}`).join(', ')}`);
    const by = new Map();
    events.forEach(e => by.set(e.person, (by.get(e.person) || 0) + 1));
    const top = [...by].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10);
    if (top.length) changes.push(`  most events: ${top.map(([id, n]) => `${byId.get(id).name} (${id}) ${n}`).join(', ')}`);
  }
}

// Fields on what's waiting. A field goes last in the braces, and one already there is left alone.
function withField(line, key, value) {
  if (line.endsWith('}') && line.includes(' {')) return `${line.slice(0, -1)}; ${key}: ${value}}`;
  return `${line} {${key}: ${value}}`;
}
for (const [f, set] of [['TASKS.md', tasks], ['INBOX.md', inbox], ['DONE.md', done]]) {
  let proposals = 0, senders = 0;
  const lines = set.lines.slice();
  for (const it of set.items) {
    if (f === 'INBOX.md' && !it.fields.interaction) {
      const k = originKind(it.origin);
      lines[it.at] = withField(lines[it.at], 'interaction', k);
      proposals++;
    }
    for (const c of it.comments) {
      const cf = c.fields;
      if (!/^no$/i.test(cf.acknowledged || '') || cf.sender || cf.changed === 'who' || ['user', 'agent', 'calendar'].includes(cf.author)) continue;
      const p = it.fields.who && it.fields.who !== 'Unassigned' ? byName.get(it.fields.who) : null;
      if (!p || p.id === USER) continue;
      lines[c.at] = lines[c.at].replace(/\}\s*$/, `; sender: ${p.id}}`);
      senders++;
    }
  }
  if (!proposals && !senders) continue;
  writes.push([f, lines.join(eolOf(set.text))]);
  changes.push(f);
  if (proposals) changes.push(`  interaction filled in on ${proposals} Proposal${proposals === 1 ? '' : 's'} waiting in the Inbox`);
  if (senders) changes.push(`  sender filled in on ${senders} Comment${senders === 1 ? '' : 's'} still to acknowledge`);
}

if (!changes.length) { console.log(`Nothing to change: the folder has ${LOG}, and what's waiting has its fields.`); process.exit(0); }
if (WRITE) writes.forEach(([f, t]) => fs.writeFileSync(file(f), t));
const said = [WRITE ? 'Changed:' : 'Would change:', ...changes];
if (hasLines) said.push(`${LOG} already has lines, so nothing is inferred.`);
if (!hasLines && skipped.size) said.push('Skipped, and not in the log:', ...[...skipped].filter(([, n]) => n).map(([why, n]) => `  ${n} ${why}`));
console.log(said.join('\n'));
