// The Inbox now holds change Proposals too, under "## Changes" in INBOX.md, and a No to one is kept in IGNORED.md (see migrations/README.md).
//   node migrate.mjs <data folder>            previews the changes
//   node migrate.mjs <data folder> --write    makes them
// 1. The header comment of INBOX.md is reworded: it holds Proposals for new Items first, then changes under "## Changes".
// 2. The header comment of IGNORED.md is reworded: it also keeps a No to a proposed change, as rel|<id>|<id> or person|<address>.
// No data line changes: a folder has no change Proposals until a Source skill writes one.
// It stands alone: it reads the Format as it was before this Migration, never the app's parser.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2), WRITE = args.includes('--write'), DIR = args.find(a => a !== '--write');
if (!DIR || !fs.existsSync(path.join(DIR, 'TASKS.md'))) {
  console.error(`expected a Discerny data folder, holding TASKS.md, but got ${DIR || 'none'}`);
  process.exit(1);
}

// [the old wording, the new, and words only the new wording has, which mark a header already reworded]
const HEADERS = {
  'INBOX.md': ['Proposals for new items from the discern-* source skills, waiting for the user to clarify them. Accept',
    'Proposals from the discern-* source skills, waiting for the user to clarify them. New items come first: Accept', '## Changes'],
  'IGNORED.md': ['A Proposal the user dismisses goes in DISMISSED.md instead.',
    'A Proposal the user dismisses goes in DISMISSED.md instead. A No to a proposed change is kept here too, as rel|<id>|<id> (either order) or person|<address>.', 'rel|<id>'],
};
const INBOX_TAIL = ' Changes to records follow under "## Changes", one line each with a "- why:" sub-line: a Relationship, a new person or a new email address, which the user answers Yes or No.';

const changes = [];
function rewrite(f) {
  const file = path.join(DIR, f);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8'), eol = /\r\n/.test(text) ? '\r\n' : '\n', lines = text.split(/\r?\n/);
  const [was, now, mark] = HEADERS[f];
  // The header comment comes before the first item or line, in the first few lines.
  const i = lines.findIndex((l, k) => k < 5 && l.startsWith('<!--') && l.includes(was) && !l.includes(mark));
  if (i < 0) return;
  lines[i] = lines[i].replace(was, now);
  if (f === 'INBOX.md') lines[i] = lines[i].replace(/\s*-->\s*$/, INBOX_TAIL + ' -->');
  changes.push(f, '  header comment reworded');
  if (WRITE) fs.writeFileSync(file, lines.join(eol));
}

rewrite('INBOX.md');
rewrite('IGNORED.md');

if (!changes.length) console.log('Nothing to change: the Inbox already says it holds change Proposals.');
else console.log([WRITE ? 'Changed:' : 'Would change:', ...changes].join('\n'));
