// Brings the older Source key forms up to date (see migrations/README.md).
//   node migrate.mjs <data folder>            previews the changes
//   node migrate.mjs <data folder> --write    makes them
// 1. A whole-chat Teams Source key gains |*: teams|<chat> becomes teams|<chat>|*, on Items in
//    TASKS.md, INBOX.md and DONE.md, and in IGNORED.md.
// 2. An open Meeting in TASKS.md or INBOX.md with a dated due, a mail| Source key and no cal| one
//    gains cal|<date>|<subject>, the subject being the mail key's with its Re:/Fw:/Accepted: and
//    such prefixes taken off, its spaces collapsed and lower-cased.
// It stands alone: it reads the Format as it was before this Migration, never the app's parser.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2), WRITE = args.includes('--write'), DIR = args.find(a => a !== '--write');
if (!DIR || !fs.existsSync(path.join(DIR, 'TASKS.md'))) {
  console.error(`expected a Discerny data folder, holding TASKS.md, but got ${DIR || 'none'}`);
  process.exit(1);
}

const ITEM = /^- \[( |x)\] (T-\d+) (.*)$/;
const PREFIX = /^\s*(re|fw|fwd|accepted|tentative|declined|canceled|cancelled|updated)\s*:\s*/i;
const subject = s => { let t = String(s), m; while ((m = PREFIX.exec(t))) t = t.slice(m[0].length); return t.replace(/\s+/g, ' ').trim().toLowerCase(); };
const meta = rest => {
  const m = {}, b = rest.lastIndexOf(' {');
  if (b < 0 || !rest.endsWith('}')) return m;
  rest.slice(b + 2, -1).split(';').forEach(p => { const i = p.indexOf(':'); if (i > 0) m[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return m;
};

const changes = [];
function rewrite(f, fix) {
  const file = path.join(DIR, f);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8'), eol = /\r\n/.test(text) ? '\r\n' : '\n', lines = text.split(/\r?\n/);
  const said = fix(lines);
  if (!said.length) return;
  changes.push(f, ...said.map(s => `  ${s}`));
  if (WRITE) fs.writeFileSync(file, lines.join(eol));
}

// Fix 1 on the Items, then fix 2 on the open ones.
function items(meetings) {
  return lines => {
    const said = [];
    let id = '';
    lines.forEach((l, i) => {
      const it = ITEM.exec(l); if (it) id = it[2];
      const m = /^(\s+- ref: )(teams\|[^|]+)\s*$/.exec(l);
      if (m && id) { lines[i] = m[1] + m[2] + '|*'; said.push(`${id}: ${m[2]} becomes ${m[2]}|*`); }
    });
    if (meetings) {
      const gained = [];
      const starts = lines.map((l, i) => (ITEM.test(l) ? i : -1)).filter(i => i >= 0);
      // From the last Item up, so an added line never moves one still to come.
      starts.reverse().forEach((i, k) => {
        const [, x, id, rest] = ITEM.exec(lines[i]), m = meta(rest);
        if (x === 'x' || m.ty !== 'Meeting' || !/^\d{4}-\d{2}-\d{2}/.test(m.due || '')) return;
        const end = k ? starts[k - 1] : lines.length;
        const refs = lines.slice(i + 1, end).map(l => /^ {2}- ref: ?(.*)$/.exec(l)).filter(Boolean).map(r => r[1].trim());
        if (refs.some(r => /^cal\|/i.test(r))) return;
        const mail = refs.find(r => /^mail\|/i.test(r)); if (!mail) return;
        const ref = `cal|${m.due.slice(0, 10)}|${subject(mail.slice(5))}`;
        let j = i + 1; while (j < lines.length && /^ {2,}\S/.test(lines[j])) j++;
        let at = i; for (let n = i + 1; n < j; n++) if (lines[n].startsWith('  - ref:')) at = n;
        lines.splice(at + 1, 0, `  - ref: ${ref}`);
        gained.unshift(`${id}: gains ${ref}`);
      });
      said.push(...gained);
    }
    return said;
  };
}

rewrite('TASKS.md', items(true));
rewrite('INBOX.md', items(true));
rewrite('DONE.md', items(false));
rewrite('IGNORED.md', lines => {
  const said = [];
  lines.forEach((l, i) => {
    const m = /^(- )?(teams\|[^| ]+)( \| .*)$/.exec(l);
    if (m) { lines[i] = (m[1] || '') + m[2] + '|*' + m[3]; said.push(`${m[2]} becomes ${m[2]}|*`); }
  });
  return said;
});

if (!changes.length) console.log('Nothing to change: every Source key is already in the current form.');
else console.log([WRITE ? 'Changed:' : 'Would change:', ...changes].join('\n'));
