// A Dismiss now remembers only the message, in DISMISSED.md, until its source has moved past it (see migrations/README.md).
//   node migrate.mjs <data folder>            previews the changes
//   node migrate.mjs <data folder> --write    makes them
// 1. IGNORED.md loses the user's past Dismisses: lines whose reason is one of the four Dismiss reasons, or the
//    older "dismissed", followed by the Proposal's ID, such as "not actionable (T-0010)". A source skill's Ignores
//    and the user's deletes stay. Every watermark is already past those messages, so they aren't carried over.
// 2. DISMISSED.md is created, holding only its header.
// 3. The header comments of IGNORED.md, INBOX.md and SOURCES.md are reworded to match: IGNORED.md no longer holds
//    Dismisses, a Dismiss is remembered in DISMISSED.md, and SOURCES.md says its UTC times are the exception.
// It stands alone: it reads the Format as it was before this Migration, never the app's parser.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2), WRITE = args.includes('--write'), DIR = args.find(a => a !== '--write');
if (!DIR || !fs.existsSync(path.join(DIR, 'TASKS.md'))) {
  console.error(`expected a Discerny data folder, holding TASKS.md, but got ${DIR || 'none'}`);
  process.exit(1);
}

const DISMISS = /^(not actionable|already handled|duplicate|not mine|dismissed) \(T-\d+\)$/i;
const DISMISSED_HEAD = '# Dismissed\n<!-- One line per source key of a Proposal the user dismissed, kept until its source can no longer read the message again: `- <source key> {source: <source name>; received-datetime: YYYY-MM-DD HH:MM; dismissed-date: YYYY-MM-DD; reason: not actionable}`, local time in `timezone`. A line from a horizon source has `event-date: YYYY-MM-DD` in place of `received-datetime`. Parse the braces from the final " {". tools/discern.mjs removes a line on commit once its source has moved past it. -->\n';
const HEADERS = {
  'IGNORED.md': ['ignored by a source skill or dismissed by the user: ref | YYYY-MM-DD | reason. Parse from the right (the source key may contain " | ").',
    'ignored by a source skill or deleted by the user: ref | YYYY-MM-DD | reason. Parse from the right (the source key may contain " | "). A Proposal the user dismisses goes in DISMISSED.md instead.'],
  'INBOX.md': ['Dismiss logs it in IGNORED.md.', 'Dismiss remembers its message in DISMISSED.md.'],
  'SOURCES.md': ['Times are UTC (ISO 8601); durations are ISO 8601 (PT2H, P1D).',
    'Times here are UTC (ISO 8601, `2026-10-15T15:05:41Z`), unlike the other files, which use local time in `timezone` (`YYYY-MM-DD HH:MM`). Durations are ISO 8601 (PT2H, P1D).'],
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
// The old wording in a header comment, before the first item or record.
function header(f) {
  const [was, now] = HEADERS[f];
  return lines => {
    const i = lines.findIndex(l => l.startsWith('<!--') && l.includes(was));
    if (i < 0 || i > 5) return [];
    lines[i] = lines[i].replace(was, now);
    return ['header comment reworded'];
  };
}

rewrite('IGNORED.md', lines => {
  const said = header('IGNORED.md')(lines);
  for (let i = lines.length - 1; i >= 0; i--) {
    const segs = lines[i].replace(/^- /, '').trim().split(' | ');
    if (segs.length >= 3 && /^[a-z][a-z0-9-]*\|/i.test(segs[0]) && DISMISS.test(segs[segs.length - 1].trim())) {
      said.splice(1, 0, `removes the Dismiss ${lines[i].trim()}`);
      lines.splice(i, 1);
    }
  }
  return said;
});
rewrite('INBOX.md', header('INBOX.md'));
rewrite('SOURCES.md', header('SOURCES.md'));
if (!fs.existsSync(path.join(DIR, 'DISMISSED.md'))) {
  changes.push('DISMISSED.md', '  created, holding only its header');
  if (WRITE) fs.writeFileSync(path.join(DIR, 'DISMISSED.md'), DISMISSED_HEAD);
}

if (!changes.length) console.log('Nothing to change: Dismisses are already kept in DISMISSED.md.');
else console.log([WRITE ? 'Changed:' : 'Would change:', ...changes].join('\n'));
