// A Skill now applies a change to an Item's or a Person's field itself, with a Comment to acknowledge that names the field
// (changed, from, to), and news that an Item is finished is a Comment that suggests: done. A Priority person is proposed in
// the Inbox, and a No to one pauses them for 28 days (see migrations/README.md).
//   node migrate.mjs <data folder>            previews the changes
//   node migrate.mjs <data folder> --write    makes them
// 1. The header comment of INBOX.md is reworded: a Priority person is a change the user answers Yes or No.
// 2. The header comment of IGNORED.md is reworded: it keeps a No to a Priority person as priority|<P-id>, for 28 days only.
// No data line changes: an existing "Moved from … to …" Comment stays as it is, and a folder has no field change until a Skill makes one.
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
  'INBOX.md': ['a Relationship, a new person or a new email address, which the user answers Yes or No.',
    'a Relationship, a new person, a new email address or a Priority person, which the user answers Yes or No.', 'Priority person'],
  'IGNORED.md': ['as rel|<id>|<id> (either order) or person|<address>.',
    'as rel|<id>|<id> (either order) or person|<address>; a No to a Priority person is kept as priority|<P-id>, and pauses them for 28 days only.', 'priority|<P-id>'],
};

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
  changes.push(f, '  header comment reworded');
  if (WRITE) fs.writeFileSync(file, lines.join(eol));
}

rewrite('INBOX.md');
rewrite('IGNORED.md');

if (!changes.length) console.log('Nothing to change: the Inbox already says it holds Priority person Proposals.');
else console.log([WRITE ? 'Changed:' : 'Would change:', ...changes].join('\n'));
