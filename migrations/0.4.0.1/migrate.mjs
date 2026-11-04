// The Priority pause and the Interaction score's settings now live in SETTINGS.toml in the data folder, which only the user edits
// (see migrations/README.md).
//   node migrate.mjs <data folder>            previews the changes
//   node migrate.mjs <data folder> --write    makes them
// 1. SETTINGS.toml is written with every default spelled out, so people can find it, unless the folder has one already.
// 2. The header comment of IGNORED.md is reworded: it said a No to a Priority person pauses them for 28 days.
// No data line changes.
// It stands alone: it reads the Format as it was before this Migration, never the app's parser.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2), WRITE = args.includes('--write'), DIR = args.find(a => a !== '--write');
if (!DIR || !fs.existsSync(path.join(DIR, 'TASKS.md'))) {
  console.error(`expected a Discerny data folder, holding TASKS.md, but got ${DIR || 'none'}`);
  process.exit(1);
}

const SETTINGS = `# Discerny's settings for this data folder. They're yours to edit by hand, and Discerny never writes this file.
# A change applies the next time you reload the page. A setting that's missing or invalid uses its default,
# which is what's written here, and discern check reports an invalid one.
# Every value is a whole number.

[priority]
pause-days = 28       # days someone isn't proposed as a Priority person after a No or a Demote; restarts on each

[score]
half-life-days = 30   # an Interaction counts half as much after this many days
high-percent = 20     # the top share of scored people counted as high
min-people = 10       # fewer scored people than this is not enough history to compare them

[weights]
message = 2           # something someone sent you
comment = 2           # news in a Comment you acknowledged
linked = 2            # you tied them to an Item yourself
reply = 1             # your effort, not their demand
done = 1              # a second event on an Item already counted
`;

const changes = [];

const settings = path.join(DIR, 'SETTINGS.toml');
if (!fs.existsSync(settings)) {
  changes.push('SETTINGS.toml', '  written, with every setting at its default');
  if (WRITE) fs.writeFileSync(settings, SETTINGS);
}

const ignored = path.join(DIR, 'IGNORED.md');
if (fs.existsSync(ignored)) {
  const text = fs.readFileSync(ignored, 'utf8');
  // The header comment comes first, before any line of data. An earlier Migration may have wrapped its lines anywhere.
  const end = text.indexOf('-->');
  if (text.lastIndexOf('<!--', end) >= 0 && end >= 0) {
    const head = text.slice(0, end);
    const now = head.replace(/and\s+pauses\s+them\s+for\s+28\s+days\s+only/, 'and starts a Priority pause: pause-days in SETTINGS.toml says how long');
    if (now !== head) {
      changes.push('IGNORED.md', '  header comment now refers to the Priority pause');
      if (WRITE) fs.writeFileSync(ignored, now + text.slice(end));
    }
  }
}

if (!changes.length) console.log('Nothing to change: the folder has SETTINGS.toml, and IGNORED.md refers to the Priority pause.');
else console.log([WRITE ? 'Changed:' : 'Would change:', ...changes].join('\n'));
