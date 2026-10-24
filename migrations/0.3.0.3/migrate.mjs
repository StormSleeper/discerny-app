// Notes become a Description and Comments, and P-0001 becomes the user (see migrations/README.md).
//   node migrate.mjs <data folder>            previews the changes
//   node migrate.mjs <data folder> --write    makes them
// 1. The user is P-0001. Their Person is the one whose note says "The user of Discerny" (or "of this tracker"). When
//    that is another ID, the two IDs swap as whole tokens in every .md and .txt file of the folder, free text included.
//    The sentence is dropped from the note. INSTRUCTIONS.md runs this script again for a folder where no Person says it:
//    --user <P-id> names the user's Person, and --new-user "<name>" makes one, its ID then swapping with P-0001's.
// 2. On Items in TASKS.md, INBOX.md and DONE.md, the first note: becomes the Description, after src:. Each later note:
//    becomes a Comment by agent, and each run of consecutive my: lines one Comment by user, both undated, in the order
//    they were written; "Found cancelled by the calendar Run on <datetime>" becomes a Comment by calendar at that time.
//    The Comments go after the Item's src:, description, link: and ref: lines.
// 3. On People, Projects and Systems, every note: joins the Description, one line each, first under the record's line;
//    a my: line becomes a Comment by user as on an Item. A Person's hist: lines stay as they are.
// 4. apply_task_updates goes from SOURCES.md.
// It stands alone: it reads the Format as it was before this Migration, never the app's parser.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2), WRITE = args.includes('--write');
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || '' : null; };
const USER = opt('--user'), NEW_USER = opt('--new-user');
const DIR = args.find((a, i) => !a.startsWith('--') && !['--user', '--new-user'].includes(args[i - 1]));
const stop = msg => { console.error(msg); process.exit(1); };
if (!DIR || !fs.existsSync(path.join(DIR, 'TASKS.md'))) stop(`expected a Discerny data folder, holding TASKS.md, but got ${DIR || 'none'}`);
if (USER !== null && !/^P-\d+$/.test(USER)) stop(`--user takes a Person's ID, such as P-0007, not "${USER}"`);
if (NEW_USER !== null && !NEW_USER.trim()) stop('--new-user takes the name of the Person to make for the user');

// Every .md and .txt file in the folder, read once; each change is made here and written at the end.
const files = new Map();
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(md|txt)$/i.test(e.name)) {
      const text = fs.readFileSync(p, 'utf8');
      files.set(path.relative(DIR, p).split(path.sep).join('/'), { text, eol: /\r\n/.test(text) ? '\r\n' : '\n', said: [] });
    }
  }
})(DIR);
const linesOf = f => files.has(f) ? files.get(f).text.split(/\r?\n/) : null;
const save = (f, lines) => { const x = files.get(f), t = lines.join(x.eol); if (t !== x.text) x.text = t; };
const say = (f, s) => files.get(f).said.push(s);

const SENTENCE = /the user of (discerny|this tracker)/i;
const RECORD = /^- (.+?) \{(.*)\}\s*$/;
const idOf = l => { const m = RECORD.exec(l); return m && (/(?:^|;)\s*id:\s*(P-\d+|PRJ-\d+|SYS-\d+)\s*(?:;|$)/.exec(m[2]) || [])[1]; };
const nameOf = l => (RECORD.exec(l) || [])[1] || '';
const notice = [];

// ---- 1. the user is P-0001
const people = linesOf('PEOPLE.md') || [];
const records = people.map((l, i) => ({ i, id: idOf(l), name: nameOf(l) })).filter(r => r.id);
const notesOf = r => { const out = []; for (let k = r.i + 1; k < people.length && /^ {2,}\S/.test(people[k]); k++) { const m = /^  - note: ?(.*)$/.exec(people[k]); if (m) out.push(m[1]); } return out; };
let user = null, by = '';
if (USER !== null) {
  user = records.find(r => r.id === USER);
  if (!user) stop(`--user ${USER}: PEOPLE.md has no Person with that ID`);
  by = 'named with --user';
} else if (NEW_USER !== null) {
  const name = NEW_USER.trim().replace(/[{};\r\n]/g, ' ').replace(/\s+/g, ' ');
  const same = records.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (same) stop(`${name} is already in PEOPLE.md as ${same.id}: run this with --user ${same.id} instead`);
  const counter = people.findIndex(l => /<!-- next-id: \d+ -->/.test(l));
  const n = Math.max(counter >= 0 ? +/next-id: (\d+)/.exec(people[counter])[1] : 1, ...records.map(r => +r.id.slice(2) + 1));
  const id = 'P-' + String(n).padStart(4, '0');
  if (counter >= 0) people[counter] = people[counter].replace(/next-id: \d+/, `next-id: ${n + 1}`);
  // A group of their own above the others, the way a new data folder starts.
  let at = people.findIndex(l => /^## /.test(l));
  if (at < 0) at = people.length;
  people.splice(at, 0, '## Me', `- ${name} {id:${id}}`, '');
  save('PEOPLE.md', people);
  say('PEOPLE.md', `${name} is added as ${id}, the user, made with --new-user`);
  user = { id, name };
  by = 'made with --new-user';
} else {
  const found = records.filter(r => notesOf(r).some(n => SENTENCE.test(n)));
  if (found.length === 1) { user = found[0]; by = 'found by the note saying so'; }
  else if (found.length > 1) notice.push(`Several People say they are the user of Discerny (${found.map(r => `${r.id} ${r.name}`).join(', ')}), so none was made P-0001: INSTRUCTIONS.md asks the user which is them.`);
  else notice.push(`No Person's note says they are the user of Discerny, so the user stays as P-0001${records.some(r => r.id === 'P-0001') ? ` (${records.find(r => r.id === 'P-0001').name})` : ', which no Person has yet'}: INSTRUCTIONS.md asks the user whether that is them.`);
}
if (user && user.id === 'P-0001') notice.push(`The user is P-0001, ${user.name} (${by}).`);
if (user && user.id !== 'P-0001') {
  const other = user.id, swap = new RegExp(`\\b(P-0001|${other})\\b`, 'g');
  notice.push(`The user is ${other}, ${user.name} (${by}): ${other} and P-0001 swap IDs, so the user becomes P-0001.`);
  for (const [f, x] of files) {
    let n = 0;
    const t = x.text.replace(swap, m => { n++; return m === 'P-0001' ? other : 'P-0001'; });
    if (n) { x.text = t; say(f, `${n} mention${n > 1 ? 's' : ''} of P-0001 and ${other} swapped`); }
  }
}
// The sentence goes from the user's note, and the note with it when nothing else is left.
if (user) {
  const ls = linesOf('PEOPLE.md'), i = ls.findIndex(l => idOf(l) === 'P-0001');
  for (let k = i + 1; i >= 0 && k < ls.length && /^ {2,}\S/.test(ls[k]); k++) {
    const m = /^  - note: ?(.*)$/.exec(ls[k]);
    if (!m || !SENTENCE.test(m[1])) continue;
    const rest = m[1].replace(/\s*the user of (discerny|this tracker)\b[^.]*\.?\s*/i, ' ').trim();
    if (rest) ls[k] = `  - note: ${rest}`; else ls.splice(k--, 1);
    say('PEOPLE.md', `P-0001: "${m[1].trim()}" loses its sentence saying they are the user`);
  }
  save('PEOPLE.md', ls);
}

// ---- 2 and 3. notes become a Description and Comments
const CANCELLED = /^Found cancelled by the calendar Run on (\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/;
const comment = c => [`  - comment: {${c.at ? `added-datetime: ${c.at}; ` : ''}author: ${c.author}}`, ...c.lines.map(l => `    ${l}`)];
// The index after the last sub-line of one of these kinds, and the lines that carry its text on.
function after(subs, kinds) {
  let at = 0;
  subs.forEach((l, k) => { const m = /^  - ([a-z-]+):/.exec(l); if (m && kinds.includes(m[1])) at = k + 1; });
  while (at < subs.length && /^ {4}/.test(subs[at])) at++;
  return at;
}
function convert(subs, item) {
  const kept = [], undated = [], dated = [], desc = [];
  let run = null, mine = 0, more = 0;
  const hasDesc = subs.some(l => /^  - description:/.test(l));
  subs.forEach(l => {
    const m = /^  - (note|my): ?(.*)$/.exec(l), text = m ? m[2].trim() : '';
    if (!m) { kept.push(l); run = null; return; }
    if (m[1] === 'my') {
      if (!text) return;
      if (run) run.push(text); else { run = [text]; undated.push({ author: 'user', lines: run }); mine++; }
      return;
    }
    run = null;
    if (!text) return;
    const c = item && CANCELLED.exec(text);
    if (c) dated.push({ at: c[1], author: 'calendar', lines: ['Found cancelled.'] });
    else if (!item || (!desc.length && !hasDesc)) desc.push(text);
    else { undated.push({ author: 'agent', lines: [text] }); more++; }
  });
  if (kept.length === subs.length) return null;
  const out = kept.slice();
  if (desc.length) {
    // An Item's Description goes after its src: lines, a Record's first; one already there takes the notes on its end.
    const d = out.findIndex(l => /^  - description:/.test(l));
    if (d >= 0) { let e = d + 1; while (e < out.length && /^ {4}/.test(out[e])) e++; out.splice(e, 0, ...desc.map(t => `    ${t}`)); }
    else out.splice(item ? after(out, ['src']) : 0, 0, `  - description: ${desc[0]}`, ...desc.slice(1).map(t => `    ${t}`));
  }
  const comments = undated.concat(dated.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  if (comments.length) out.splice(after(out, item ? ['src', 'description', 'link', 'ref', 'comment'] : ['description', 'link', 'hist', 'comment']), 0, ...comments.flatMap(comment));
  const said = [];
  if (desc.length) said.push(item ? 'the first note becomes the Description' : `${desc.length === 1 ? 'the note becomes' : `${desc.length} notes become`} the Description`);
  if (more) said.push(`${more} more note${more > 1 ? 's' : ''} become${more > 1 ? '' : 's'} ${more > 1 ? 'Comments' : 'a Comment'} by agent`);
  if (mine) said.push(`${mine} run${mine > 1 ? 's' : ''} of my: lines become${mine > 1 ? '' : 's'} ${mine > 1 ? 'Comments' : 'a Comment'} by user`);
  if (dated.length) said.push(`the note of when the calendar found it cancelled becomes a Comment by calendar`);
  if (!said.length) said.push('empty note: and my: lines go');
  return { out, said: said.join('; ') };
}
function blocks(f, head) {
  const ls = linesOf(f);
  if (!ls) return;
  // From the last block up, so a changed block never moves one still to come.
  const starts = ls.map((l, i) => (head(l) ? i : -1)).filter(i => i >= 0).reverse(), said = [];
  for (const i of starts) {
    let j = i + 1; while (j < ls.length && /^ {2,}/.test(ls[j])) j++;
    const r = convert(ls.slice(i + 1, j), f !== 'PEOPLE.md' && f !== 'PROJECTS.md' && f !== 'SYSTEMS.md');
    if (!r) continue;
    ls.splice(i + 1, j - i - 1, ...r.out);
    said.unshift(`${head(ls[i])}: ${r.said}`);
  }
  save(f, ls);
  said.forEach(s => say(f, s));
}
const ITEM = /^- \[( |x)\] (T-\d+) /;
['TASKS.md', 'INBOX.md', 'DONE.md'].forEach(f => blocks(f, l => (ITEM.exec(l) || [])[2]));
['PEOPLE.md', 'PROJECTS.md', 'SYSTEMS.md'].forEach(f => blocks(f, l => { const id = idOf(l); return id ? `${id} ${nameOf(l)}` : null; }));

// ---- 4. apply_task_updates is retired
const sources = linesOf('SOURCES.md');
if (sources) {
  const k = sources.findIndex(l => /^- apply_task_updates:/.test(l));
  if (k >= 0) { sources.splice(k, 1); save('SOURCES.md', sources); say('SOURCES.md', 'apply_task_updates goes: Skills now add Comments without it'); }
}

const changed = [...files].filter(([, x]) => x.said.length);
for (const [f, x] of changed) if (!x.text.trim()) stop(`refusing to leave ${f} empty`);
if (WRITE) for (const [f, x] of changed) fs.writeFileSync(path.join(DIR, f), x.text);
console.log([...notice, ...(changed.length
  ? [WRITE ? 'Changed:' : 'Would change:', ...changed.flatMap(([f, x]) => [f, ...x.said.map(s => `  ${s}`)])]
  : ['Nothing to change: no note: or my: lines are left.'])].join('\n'));
