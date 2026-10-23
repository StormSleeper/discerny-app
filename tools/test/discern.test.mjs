// Tests for tools/discern.mjs, run against a fresh copy of the Example for each test:
// discerny-example beside the app folder, or the folder in $DISCERNY_TEST_DATA.
//   node --test tools/test/discern.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO, 'tools', 'discern.mjs');
const DATA = path.resolve(process.env.DISCERNY_TEST_DATA || path.join(REPO, '..', 'discerny-example'));
const NOW = '2026-10-12T15:00:00Z';
const DATES = path.join('tools', 'refresh-dates.mjs');
const BASE = pinned(committed());

// The example folder doubles as a data folder the app can be connected to, so using the app
// changes it. The tests expect exact results (next IDs, inbox contents), so they read it as of
// its last git commit and ignore uncommitted edits. A folder named in $DISCERNY_TEST_DATA, or
// one that is not the top of its own git repository, is copied as it stands.
function committed() {
  if (process.env.DISCERNY_TEST_DATA) return DATA;
  const top = spawnSync('git', ['-C', DATA, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0 || fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(DATA)) return DATA;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'discerny-base-'));
  const tar = path.join(d, '..', path.basename(d) + '.tar');
  const a = spawnSync('git', ['-C', DATA, 'archive', '-o', tar, 'HEAD'], { encoding: 'utf8' });
  if (a.status !== 0) throw new Error(`git archive failed in ${DATA}: ${a.stderr}`);
  const x = spawnSync('tar', ['-xf', tar, '-C', d], { encoding: 'utf8' });
  fs.rmSync(tar, { force: true });
  if (x.status !== 0) throw new Error(`tar failed: ${x.stderr}`);
  return d;
}

// The tests expect the dates the Example had on Monday 12 October 2026, so its date tool shifts
// their copy back there first, however far the Example's own dates have been moved on.
function pinned(d) {
  if (!fs.existsSync(path.join(d, DATES))) return d;
  if (d === DATA) {
    const c = fs.mkdtempSync(path.join(os.tmpdir(), 'discerny-base-'));
    fs.cpSync(d, c, { recursive: true, filter: (f) => path.basename(f) !== '.git' });
    d = c;
  }
  const r = spawnSync(process.execPath, [path.join(d, DATES), '--to', '2026-10-12', d], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`the date tool failed on ${d}: ${r.stderr}`);
  return d;
}

function folder() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'discerny-'));
  fs.cpSync(BASE, d, { recursive: true });
  return d;
}
function run(dir, args, input, now = NOW) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--dir', dir, '--now', now], { input: input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { /* plain usage text */ }
  return { code: r.status, json, out: r.stdout };
}
const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');

test('--version prints the version from discerny.html', () => {
  const r = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  const m = /var VERSION='([^']+)'/.exec(fs.readFileSync(path.join(REPO, 'discerny.html'), 'utf8'));
  assert.ok(m, 'discerny.html declares VERSION');
  assert.equal(r.stdout.trim(), m[1]);
});

test('check passes on the Example', () => {
  const r = run(folder(), ['check']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.ok, true);
});

test('check reports a folder with no DISCERNY.md as Format 0.1.0.0, the same as the app', () => {
  const r = run(folder(), ['check']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.format, { folder: '0.1.0.0', app: '0.1.0.0', is: 'same' });
});

const folderInFormat = (format) => {
  const d = folder();
  fs.writeFileSync(path.join(d, 'DISCERNY.md'), `# Discerny data folder\n\n<!-- format: ${format} -->\n\nThis folder holds Discerny data.\n`);
  return d;
};

test('check reports a DISCERNY.md with no format comment as Format 0.1.0.0', () => {
  const d = folder();
  fs.writeFileSync(path.join(d, 'DISCERNY.md'), '# Discerny data folder\n\nThis folder holds Discerny data.\n');
  const r = run(d, ['check']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.format, { folder: '0.1.0.0', app: '0.1.0.0', is: 'same' });
});

test('the app\'s Format version is its newest Migration: next if there is one unlanded, else 0.1.0.0 with none', () => {
  const dir = path.join(REPO, 'migrations');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => fs.statSync(path.join(dir, n)).isDirectory()) : [];
  const built = names.filter(n => /^\d+(\.\d+)*$/.test(n))
    .sort((a, b) => { const x = a.split('.'), y = b.split('.'); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (+x[i] || 0) - (+y[i] || 0); if (d) return d; } return 0; });
  const newest = names.includes('next') ? 'next' : built.length ? built[built.length - 1] : '0.1.0.0';
  assert.equal(run(folder(), ['check']).json.format.app, newest);
});

test('check fails on a folder in an older or newer Format, or next', () => {
  for (const [format, is] of [['0.0.1.5', 'older'], ['0.2.0.1', 'newer'], ['next', 'newer']]) {
    const r = run(folderInFormat(format), ['check']);
    assert.equal(r.code, 1, `${format}: ${r.out}`);
    assert.equal(r.json.ok, false);
    assert.deepEqual(r.json.format, { folder: format, app: '0.1.0.0', is });
    assert.ok(r.json.errors.some(e => e.includes(format)), `${format}: ${r.json.errors}`);
  }
});

const snapshot = (d) => Object.fromEntries(fs.readdirSync(d, { recursive: true }).sort()
  .filter(f => fs.statSync(path.join(d, f)).isFile()).map(f => [f, read(d, f)]));

test('state refuses a folder in an older Format with exit 2, says how to Upgrade, and writes nothing', () => {
  const d = folderInFormat('0.0.1.5'), before = snapshot(d);
  const r = run(d, ['state', 'outlook-mail']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.json.error, /0\.0\.1\.5/);
  assert.match(r.json.error, /0\.1\.0\.0/);
  assert.match(r.json.error, /upgrade my Discerny folder/);
  assert.match(r.json.error, /discern upgrade/);
  assert.deepEqual(snapshot(d), before);
});

test('state refuses a folder in a newer Format with exit 2, says to get the newer app, and writes nothing', () => {
  const d = folderInFormat('0.2.0.1'), before = snapshot(d);
  const r = run(d, ['state', 'outlook-mail']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.json.error, /0\.2\.0\.1/);
  assert.match(r.json.error, /0\.1\.0\.0/);
  assert.match(r.json.error, /newer app/i);
  assert.doesNotMatch(r.json.error, /upgrade/i);
  assert.deepEqual(snapshot(d), before);
});

test('state refuses a folder upgraded by an unreleased build (next) with exit 2, says to restore its backup, and writes nothing', () => {
  const d = folderInFormat('next'), before = snapshot(d);
  const r = run(d, ['state', 'outlook-mail']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.json.error, /Format next/);
  assert.match(r.json.error, /0\.1\.0\.0/);
  assert.match(r.json.error, /backup/);
  assert.doesNotMatch(r.json.error, /newer app/i);
  assert.deepEqual(snapshot(d), before);
});

test('every source skill command refuses a folder in another Format with exit 2, and writes nothing', () => {
  const calls = [
    [['match'], [{ scheme: 'mail', subject: 'Review' }]],
    [['who', 'ihartley']],
    [['local', '2026-10-24T09:00:00Z']],
    [['add'], [draft()]],
    [['meetings'], [event()]],
    [['ignore'], [{ ref: 'mail|Bake-off Friday sign-up', reason: 'social' }]],
    [['note', 'T-0028', 'Print order moved']],
    [['ref', 'T-0020', 'cal|2026-10-23|fable range 2027 – go/no-go']],
    [['commit', 'outlook-mail', 'watermark=2026-10-10T13:05:41Z']],
    [['log'], 'outlook-mail · fetched 3'],
    [['migrate', '--write']],
  ];
  for (const format of ['0.0.1.5', '0.2.0.1', 'next']) {
    const d = folderInFormat(format), before = snapshot(d);
    for (const [args, input] of calls) {
      const r = run(d, args, input);
      assert.equal(r.code, 2, `${args[0]} on ${format}: ${r.out}`);
      assert.match(r.json.error, new RegExp(`Format ${format}`), `${args[0]} on ${format}`);
    }
    assert.deepEqual(snapshot(d), before, format);
  }
});

test('check, connect and --version still work on a folder in another Format', () => {
  for (const format of ['0.0.1.5', '0.2.0.1', 'next']) {
    const d = folderInFormat(format);
    const v = run(d, ['--version']);
    assert.equal(v.code, 0, `--version on ${format}: ${v.out}`);
    const c = run(d, ['connect']);
    assert.equal(c.code, 0, `connect on ${format}: ${c.out}`);
    assert.equal(c.json.ok, true);
    const k = run(d, ['check']);
    assert.equal(k.code, 1, `check on ${format}: ${k.out}`);
    assert.equal(k.json.format.folder, format);
  }
});

test('local converts to the user time zone across the clock change (E7, E22)', () => {
  const d = folder();
  const r = run(d, ['local'], ['2026-10-24T09:00:00Z', '2026-10-26T09:00:00Z',
    { dateTime: '2026-10-26T09:00:00.0000000', timeZone: 'GMT Standard Time' },
    { dateTime: '2026-10-24T08:00:00', timeZone: 'UTC' },
    { dateTime: '2026-10-20T10:30:00', timeZone: 'Europe/London' }]);
  assert.deepEqual(r.json.map(x => x.local), ['2026-10-24 10:00', '2026-10-26 09:00', '2026-10-26 09:00', '2026-10-24 09:00', '2026-10-20 10:30']);
  assert.equal(r.json[4].instant, '2026-10-20T09:30:00Z');
});

test('mail matching: short subjects, ambiguity, notices, waiting and replies (E1-E6)', () => {
  const d = folder();
  const r = run(d, ['match'], [
    { key: 'E1', scheme: 'mail', subject: 'Review', sender: 'rosa.kim@pennywhistle.example' },
    { key: 'E2', scheme: 'mail', subject: 'Re: Management review' },
    { key: 'E3', scheme: 'mail', subject: 'Cancelled: Weekly QA sync' },
    { key: 'E4', scheme: 'mail', subject: 'RE: Fable Range – retest of Owl and Dragon', sender: 'helena.sorensen@brightmark.example' },
    { key: 'E5', scheme: 'mail', pass: 'ask', subject: 'RE: SCAR-031 – colour variation in Russet felt, lot RF-2207', when: '2026-10-09T10:00:00Z' },
    { key: 'E6', scheme: 'mail', pass: 'ask', subject: 'RE: Load rig calibration certificate expiring 30 Sep', when: '2026-10-09T10:00:00Z' },
    { key: 'acc', scheme: 'mail', subject: 'Accepted: Imogen / Oliver 1:1' },
    { key: 'ign', scheme: 'mail', subject: "Puppeteers' Guild newsletter – September" },
    { key: 'self', scheme: 'mail', subject: 'Notes', sender: 'Imogen.Hartley@pennywhistle.example' },
    { key: 'askto', scheme: 'mail', pass: 'ask', subject: 'Samples for the Owl retest', sender: 'imogen.hartley@pennywhistle.example', recipient: 'helena.sorensen@brightmark.example' },
  ]);
  const by = Object.fromEntries(r.json.map(x => [x.key, x]));
  assert.equal(by.E1.outcome, 'new');
  assert.equal(by.E1.who, null);
  assert.equal(by.E2.outcome, 'ambiguous');
  assert.deepEqual(by.E2.ids.sort(), ['T-0013', 'T-0030']);
  assert.equal(by.E3.outcome, 'drop');
  assert.equal(by.E4.outcome, 'waiting');
  assert.deepEqual(by.E4.ids, ['T-0022']);
  assert.equal(by.E4.who, 'Helena Sørensen');
  assert.match(by.E5.action, /T-0007 chased 2026-10-09/);
  assert.match(by.E6.action, /you replied 2026-10-09, consider closing T-0009/);
  assert.equal(by.acc.outcome, 'drop');
  assert.equal(by.ign.outcome, 'ignored');
  assert.equal(by.self.from_user, true);
  assert.equal(by.self.outcome, 'drop');
  assert.equal(by.self.who, undefined);
  assert.equal(by.askto.from_user, undefined);
  assert.equal(by.askto.who, 'Helena Sørensen');
  assert.equal(by.askto.outcome, 'new');
});

test('a mail on a tracked Meeting\'s thread that asks for or promises work is a new Task related to the Meeting, not an update to it', () => {
  const r = run(folder(), ['match'], [{ key: 'm', scheme: 'mail', subject: 'Re: Management review – Q3 2026', sender: 'oliver.pemberton@pennywhistle.example' }]);
  const m = r.json[0];
  assert.equal(m.outcome, 'open');
  assert.deepEqual(m.ids, ['T-0013']);
  assert.match(m.action, /ask, a commitment or a material change \(a new agenda, a pre-read\)[^;]*new Task related to T-0013, due before it starts \(2026-10-22 10:00\)/);
  assert.match(m.action, /new place or attendance[^;]*update to T-0013/);
  assert.match(m.action, /new time or a cancellation[^;]*nothing: the calendar keeps T-0013 in step/);
  assert.doesNotMatch(m.action, /unless it adds an ask/);
});

test('an ask ambiguous between a Meeting and another Item may update the other Item, but about the Meeting it is a new Task related to it (E2)', () => {
  const r = run(folder(), ['match'], [{ key: 'E2', scheme: 'mail', subject: 'Re: Management review', sender: 'oliver.pemberton@pennywhistle.example' }]);
  const e2 = r.json[0];
  assert.equal(e2.outcome, 'ambiguous');
  assert.match(e2.action, /plainly continues T-0030, propose an update to it/);
  assert.match(e2.action, /about T-0013 is assessed as a new Task related to T-0013[^;]*name T-0013, T-0030 in its note/);
  assert.doesNotMatch(e2.action, /one of T-00\d\d, T-00\d\d/);
});

test('an ask on the thread of a Meeting still in the Inbox is a new Task related to it, not an update to it', () => {
  const r = run(folder(), ['match'], [{ key: 'm', scheme: 'mail', subject: 'RE: Mk4 FAI – Tue 20 Oct', sender: 'declan.moss@stageworks.example' }]);
  const m = r.json[0];
  assert.equal(m.outcome, 'inbox');
  assert.deepEqual(m.ids, ['T-0029']);
  assert.match(m.action, /ask, a commitment or a material change[^;]*new Task related to T-0029, due before it starts \(2026-10-20 10:30\)/);
  assert.doesNotMatch(m.action, /unless it adds an ask/);
});

test('a calendar candidate is never the user\'s own message, even when the user organises the event and is passed as its sender', () => {
  const r = run(folder(), ['match'], [
    { key: 'prep', scheme: 'cal', subject: 'Supplier quality day', date: '2026-10-28', suffix: 'prep', sender: 'imogen.hartley@pennywhistle.example' },
    { key: 'event', scheme: 'cal', subject: 'Supplier quality day', date: '2026-10-28', event_id: 'AAMk-sqd', sender: 'imogen.hartley@pennywhistle.example' },
  ]);
  for (const x of r.json) {
    assert.equal(x.from_user, undefined, x.key);
    assert.equal(x.outcome, 'new', x.key);
    assert.doesNotMatch(x.action, /^drop/, x.key);
  }
  assert.equal(r.json[0].ref, 'cal|2026-10-28|supplier quality day|prep');
});

test('a decline for a Meeting with 4 people invited is a Task to reply to the sender, due a day after it was received', () => {
  const r = run(folder(), ['match'], [
    { key: 'dec', scheme: 'mail', subject: 'Declined: Goods-in walkthrough', sender: 'meera.ilangovan@pennywhistle.example',
      when: '2026-10-13T12:00:00Z', invited: 4, meeting_start: { dateTime: '2026-10-20T10:00:00', timeZone: 'Europe/London' } },
  ]);
  assert.equal(r.code, 0, r.out);
  const [dec] = r.json;
  assert.equal(dec.outcome, 'reply');
  assert.equal(dec.title, 'Reply to Meera Ilangovan: Goods-in walkthrough');
  assert.equal(dec.who, 'Meera Ilangovan');
  assert.equal(dec.due, '2026-10-14 13:00');
});

test('a decline for a Meeting with 5 people invited, and a cancellation, are dropped even when they match a tracked Item', () => {
  const r = run(folder(), ['match'], [
    { key: 'dec5', scheme: 'mail', subject: 'Declined: Weekly QA sync', sender: 'meera.ilangovan@pennywhistle.example', when: '2026-10-13T12:00:00Z', invited: 5 },
    { key: 'cxl', scheme: 'mail', subject: 'Cancelled: Weekly QA sync', sender: 'meera.ilangovan@pennywhistle.example', when: '2026-10-13T12:00:00Z' },
  ]);
  assert.equal(r.code, 0, r.out);
  const by = Object.fromEntries(r.json.map(x => [x.key, x]));
  assert.equal(by.dec5.outcome, 'drop');
  assert.equal(by.cxl.outcome, 'drop');
});

test('a decline whose event the agent could not find, a tentative proposing a new time and a reply that asks something are Tasks; an Accepted reply and an invitation are dropped', () => {
  const from = { sender: 'declan.moss@pennywhistle.example', when: '2026-10-13T12:00:00Z' };
  const r = run(folder(), ['match'], [
    { key: 'unknown', scheme: 'mail', subject: 'Declined: Rig design review', ...from },
    { key: 'newtime', scheme: 'mail', subject: 'Tentative: Rig design review', new_time: true, invited: 9, ...from },
    { key: 'tent', scheme: 'mail', subject: 'Tentative: Rig design review', invited: 9, ...from },
    { key: 'asks', scheme: 'mail', subject: 'Accepted: Rig design review', asks: true, invited: 9, ...from },
    { key: 'acc', scheme: 'mail', subject: 'Accepted: Rig design review', invited: 2, ...from },
    { key: 'plainasks', scheme: 'mail', subject: 'RE: Rig design review', invite: 'reply', asks: true, ...from },
    { key: 'req', scheme: 'mail', subject: 'Rig design review', invite: 'request', ...from },
    { key: 'upd', scheme: 'mail', subject: 'Updated: Rig design review', asks: true, ...from },
  ]);
  assert.equal(r.code, 0, r.out);
  const by = Object.fromEntries(r.json.map(x => [x.key, x]));
  for (const k of ['unknown', 'newtime', 'asks', 'plainasks']) {
    assert.equal(by[k].outcome, 'reply', k);
    assert.equal(by[k].title, 'Reply to Declan Moss: Rig design review', k);
    assert.equal(by[k].who, 'Declan Moss', k);
  }
  for (const k of ['tent', 'acc', 'req', 'upd']) assert.equal(by[k].outcome, 'drop', k);
});

test('a reply Task due on a Saturday or Sunday is due on the Monday at the same time instead', () => {
  const dec = when => ({ key: when, scheme: 'mail', subject: 'Declined: Goods-in walkthrough', sender: 'meera.ilangovan@pennywhistle.example', when, invited: 3 });
  const r = run(folder(), ['match'], [dec('2026-10-15T12:00:00Z'), dec('2026-10-16T12:00:00Z'), dec('2026-10-17T08:30:00Z')]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.map(x => x.due), ['2026-10-16 13:00', '2026-10-19 13:00', '2026-10-19 09:30']);
});

test('a reply Task is due at the Meeting\'s start when the Meeting starts before the day is up', () => {
  const r = run(folder(), ['match'], [
    { key: 'soon', scheme: 'mail', subject: 'Declined: Goods-in walkthrough', sender: 'meera.ilangovan@pennywhistle.example',
      when: '2026-10-16T12:00:00Z', invited: 3, meeting_start: { dateTime: '2026-10-19T08:00:00', timeZone: 'UTC' } },
  ]);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json[0].due, '2026-10-19 09:00');
});

test('teams matching: legacy and new refs, containers by prefix (E19)', () => {
  const d = folder();
  const r = run(d, ['match'], [
    { key: 'related', scheme: 'teams', chat: '19:b77d02f3a9@thread.v2', message: '1760000000001' },
    { key: 'exact', scheme: 'teams', chat: '19:c40e9a77@thread.v2', message: '1758532500211' },
    { key: 'ignored', scheme: 'teams', chat: '19:c40e9a77@thread.v2', message: '1758962400456' },
    { key: 'new', scheme: 'teams', chat: '19:ffff@unq.gbl.spaces', message: '1' },
  ]);
  const by = Object.fromEntries(r.json.map(x => [x.key, x]));
  assert.equal(by.related.outcome, 'related');
  assert.deepEqual(by.related.ids, ['T-0021']);
  assert.equal(by.related.ref, 'teams|b77d02f3a9@thread.v2|1760000000001');
  assert.equal(by.exact.outcome, 'open');
  assert.equal(by.ignored.outcome, 'ignored');
  assert.equal(by.new.outcome, 'new');
});

test('calendar matching: tracked, moved, cancelled (E20, E21)', () => {
  const d = folder();
  const r = run(d, ['match'], [
    { key: 'E20', scheme: 'cal', subject: 'Mk4 FAI – Tue 20 Oct', start: { dateTime: '2026-10-20T10:30:00', timeZone: 'Europe/London' } },
    { key: 'E21', scheme: 'cal', subject: 'Fable Range 2027 – go/no-go', date: '2026-10-23', event_id: 'AAMkAGI-fable-gonogo-1021' },
    { key: 'cancel', scheme: 'cal', subject: 'Canceled: Management review – Q3 2026', date: '2026-10-22', cancelled: true },
    { key: 'new', scheme: 'cal', subject: 'Calibration review', date: '2026-10-26' },
  ]);
  const by = Object.fromEntries(r.json.map(x => [x.key, x]));
  assert.equal(by.E20.outcome, 'inbox');
  assert.deepEqual(by.E20.ids, ['T-0029']);
  assert.equal(by.E21.outcome, 'moved');
  assert.equal(by.E21.to, '2026-10-23');
  assert.match(by.E21.action, /discern ref T-0020 "cal\|2026-10-23\|fable range 2027 – go\/no-go"/);
  assert.equal(by.cancel.outcome, 'cancelled');
  assert.deepEqual(by.cancel.ids, ['T-0013']);
  assert.equal(by.new.outcome, 'new');
});

test('calendar matching: a free event is a Meeting only when tracked and declined, and never gets prep or an invite (E26)', () => {
  const d = folder();
  const r = run(d, ['match'], [
    { key: 'tracked', scheme: 'cal', subject: 'Imogen / Oliver 1:1', start: { dateTime: '2026-10-13T16:00:00', timeZone: 'Europe/London' }, event_id: 'AAMkAGI-imogen-oliver-1013', free: true },
    { key: 'untracked', scheme: 'cal', subject: 'Lunch and learn: laser cutter safety', date: '2026-10-14', event_id: 'AAMkAGI-lunch-learn-1014', free: true },
    { key: 'prep', scheme: 'cal', subject: 'Imogen / Oliver 1:1', date: '2026-10-13', suffix: 'prep', free: true },
    { key: 'invite', scheme: 'cal', subject: 'Lunch and learn: laser cutter safety', date: '2026-10-14', suffix: 'invite', free: true },
  ]);
  assert.equal(r.code, 0, r.out);
  const by = Object.fromEntries(r.json.map(x => [x.key, x]));
  assert.equal(by.tracked.outcome, 'open');
  assert.deepEqual(by.tracked.ids, ['T-0018']);
  assert.deepEqual(by.tracked.refs, [], 'nothing to write for a free event');
  assert.match(by.tracked.action, /declined/);
  assert.match(by.tracked.action, /every pass/);
  for (const k of ['untracked', 'prep', 'invite']) {
    assert.equal(by[k].outcome, 'drop', k);
    assert.deepEqual(by[k].refs, [], k);
    assert.match(by[k].action, /^drop/, k);
  }
});

const event = (o = {}) => ({ subject: 'Calibration review', start: { dateTime: '2026-10-14T09:00:00', timeZone: 'UTC' },
  event_id: 'AAMkAGI-calibration-1014', organizer: 'declan.moss@pennywhistle.example', organizer_name: 'Declan Moss', ...o });

test('meetings drops a free event the user hasn\'t declined, writing nothing, and keeps a free declined one in step (E26)', () => {
  const d = folder();
  const before = read(d, 'TASKS.md');
  const evs = [
    event({ subject: 'Imogen / Oliver 1:1', start: { dateTime: '2026-10-13T16:00:00', timeZone: 'Europe/London' }, event_id: 'AAMkAGI-imogen-oliver-1013', free: true }),
    event({ subject: 'Lunch and learn: laser cutter safety', event_id: 'AAMkAGI-lunch-learn-1014', free: true }),
  ];
  const r = run(d, ['meetings'], evs);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json, { added: [], moved: [], cancelled: [], unchanged: [], dropped: ['Imogen / Oliver 1:1', 'Lunch and learn: laser cutter safety'] });
  assert.equal(read(d, 'TASKS.md'), before, 'no calid source key, no new item, no counter change');
  const declined = run(d, ['meetings'], [event({ subject: 'Weekly QA sync', start: { dateTime: '2026-10-15T09:00:00', timeZone: 'Europe/London' }, event_id: 'AAMkAGI-weekly-qa-sync-1015', free: true, declined: true })]);
  assert.deepEqual(declined.json.cancelled, [{ id: 'T-0031', title: 'Cancelled: Weekly QA sync' }]);
  assert.deepEqual(declined.json.dropped, []);
  assert.equal(run(d, ['check']).code, 0);
});

test('meetings puts a new event straight into TASKS.md as an open Meeting, due at its local start', () => {
  const d = folder();
  const r = run(d, ['meetings'], [event()]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.added, [{ id: 'T-0032', title: 'Calibration review', due: '2026-10-14 10:00' }]);
  const tasks = read(d, 'TASKS.md');
  assert.match(tasks, /^- \[ \] T-0032 Calibration review \{ty:Meeting; who:Declan Moss; urg:week; p:2; due:2026-10-14 10:00; asg:2026-10-12 16:00\}\r?$/m);
  assert.match(tasks, /  - ref: cal\|2026-10-14\|calibration review\r?\n  - ref: calid\|AAMkAGI-calibration-1014/);
  assert.match(tasks, /<!-- next-id: 33 -->/);
  assert.doesNotMatch(read(d, 'INBOX.md'), /Calibration review/);
  assert.equal(run(d, ['check']).code, 0);
});

test('meetings matches a Meeting already tracked by its cal source key, and a second run adds and changes nothing', () => {
  const d = folder();
  const qa = event({ subject: 'Weekly QA sync', start: { dateTime: '2026-10-15T09:00:00', timeZone: 'GMT Standard Time' }, event_id: 'AAMkAGI-weekly-qa-sync-1015' });
  const first = run(d, ['meetings'], [event(), qa]);
  assert.equal(first.code, 0, first.out);
  assert.deepEqual(first.json.added.map(a => a.id), ['T-0032']);
  assert.deepEqual(first.json.unchanged, ['T-0031']);
  const after = read(d, 'TASKS.md');
  const again = run(d, ['meetings'], [event(), qa]);
  assert.equal(again.code, 0, again.out);
  assert.deepEqual(again.json, { added: [], moved: [], cancelled: [], unchanged: ['T-0032', 'T-0031'], dropped: [] });
  assert.equal(read(d, 'TASKS.md'), after);
});

test('meetings gives a moved Meeting its new Due date and title, and a second run leaves it be', () => {
  const d = folder();
  const moved = event({ subject: 'Fable Range 2027 – go/no-go', start: { dateTime: '2026-10-23T14:00:00', timeZone: 'Europe/London' }, event_id: 'AAMkAGI-fable-gonogo-1021' });
  const r = run(d, ['meetings'], [moved]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.moved, [{ id: 'T-0020', title: 'Fable Range 2027 – go/no-go', from: '2026-10-21 14:00', to: '2026-10-23 14:00' }]);
  assert.deepEqual(r.json.added, []);
  const tasks = read(d, 'TASKS.md');
  assert.match(tasks, /^- \[ \] T-0020 Fable Range 2027 – go\/no-go \{ty:Meeting; who:Hattie Lindqvist; prj:PRJ-0001; tg:Product Safety; urg:soon; p:1; due:2026-10-23 14:00; dep:T-0019; asg:2026-10-05 09:10\}\r?$/m);
  assert.match(tasks, /  - ref: cal\|2026-10-23\|fable range 2027 – go\/no-go/);
  const again = run(d, ['meetings'], [moved]);
  assert.deepEqual(again.json.unchanged, ['T-0020']);
  assert.equal(read(d, 'TASKS.md'), tasks);
  assert.equal(run(d, ['check']).code, 0);
});

test('meetings keeps a cancelled or declined Meeting open, retitled "Cancelled: …" with a note of when, and adds no untracked cancelled one', () => {
  const d = folder();
  const evs = [
    event({ subject: 'Canceled: Weekly QA sync', start: { dateTime: '2026-10-15T09:00:00', timeZone: 'Europe/London' }, event_id: 'AAMkAGI-weekly-qa-sync-1015', cancelled: true }),
    event({ subject: 'Imogen / Oliver 1:1', start: { dateTime: '2026-10-13T16:00:00', timeZone: 'Europe/London' }, event_id: 'AAMkAGI-imogen-oliver-1013', declined: true }),
    event({ cancelled: true }),
  ];
  const r = run(d, ['meetings'], evs);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.cancelled, [{ id: 'T-0031', title: 'Cancelled: Weekly QA sync' }, { id: 'T-0018', title: 'Cancelled: 1:1 with Oliver' }]);
  assert.deepEqual(r.json.added, []);
  const tasks = read(d, 'TASKS.md');
  assert.match(tasks, /^- \[ \] T-0031 Cancelled: Weekly QA sync \{ty:Meeting; [^}]*due:2026-10-15 09:00;/m);
  assert.match(tasks, /^- \[ \] T-0018 Cancelled: 1:1 with Oliver \{/m);
  assert.equal(tasks.match(/  - note: Found cancelled by the calendar Run on 2026-10-12 16:00/g).length, 2);
  assert.doesNotMatch(tasks, /Calibration review/);
  assert.doesNotMatch(read(d, 'DONE.md'), /T-0031|T-0018/);
  const again = run(d, ['meetings'], evs);
  assert.deepEqual(again.json, { added: [], moved: [], cancelled: [], unchanged: ['T-0031', 'T-0018'], dropped: [] });
  assert.equal(read(d, 'TASKS.md'), tasks);
});

test('meetings never takes an older prep item carrying the Meeting\'s plain cal source key for the Meeting itself', () => {
  const d = folder();
  const prep = { title: 'Prepare for Calibration review (14 Oct 10:00)', ty: 'Meeting', urg: 'week', p: 2, due: '2026-10-14 10:00', derived: true,
    src: 'Calendar "Calibration review" organised by Declan Moss', refs: ['cal|2026-10-14|calibration review'] };
  assert.equal(run(d, ['add'], [prep]).code, 0);
  const r = run(d, ['meetings'], [event({ event_id: undefined })]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.added.map(a => a.title), ['Calibration review']);
  assert.deepEqual(r.json.unchanged, []);
  assert.match(read(d, 'INBOX.md'), /T-0032 Prepare for Calibration review \(14 Oct 10:00\) \{/);
  assert.equal(run(d, ['check']).code, 0);
});

const draft = (o = {}) => ({ title: 'Review the supplier sampling plan', ty: 'Task', who: 'Meera Ilangovan', urg: 'week', p: 2,
  received: '2026-10-24T09:00:00Z', src: 'Email "Sampling plan" from Meera Ilangovan (24 Oct)', refs: ['mail|Sampling plan'], notes: ['Asks for comments by Fri.'], ...o });

test('add raises the counter first, writes the inbox and refuses duplicates (E10)', () => {
  const d = folder();
  const r = run(d, ['add'], [draft(), draft({ title: 'Prepare for supplier review', ty: 'Meeting', due: '2026-11-03 14:00', refs: ['mail|Supplier review – Feltcraft'] })]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.added.map(a => a.id), ['T-0032', 'T-0033']);
  assert.ok(r.json.added[1].refs.includes('cal|2026-11-03|supplier review – feltcraft'));
  assert.match(read(d, 'TASKS.md'), /<!-- next-id: 34 -->/);
  assert.match(read(d, 'INBOX.md'), /T-0032 Review the supplier sampling plan \{ty:Task; who:Meera Ilangovan; urg:week; p:2; asg:2026-10-24 10:00\}/);
  const again = run(d, ['add'], [draft()]);
  assert.equal(again.code, 1);
  assert.match(again.json.error, /duplicate/);
  assert.equal(run(d, ['check']).code, 0);
});

test('add enforces the who rule and derives asg for derived items', () => {
  const d = folder();
  const bad = run(d, ['add'], [draft({ who: 'Ilangovan, Meera' })]);
  assert.equal(bad.code, 1);
  assert.match(bad.json.error, /not a name in PEOPLE.md/);
  const ok = run(d, ['add'], [draft({ received: undefined, derived: true, refs: ['cal|2026-10-20|mk4 fai – tue 20 oct|invite'] })]);
  assert.equal(ok.code, 0, ok.out);
  assert.match(read(d, 'INBOX.md'), /asg:2026-10-12 16:00/);
});

test('an interrupted run leaves a gap, never a duplicate ID (E14)', () => {
  const d = folder();
  fs.writeFileSync(path.join(d, 'TASKS.md'), read(d, 'TASKS.md').replace('<!-- next-id: 32 -->', '<!-- next-id: 34 -->'));
  const r = run(d, ['add'], [draft()]);
  assert.deepEqual(r.json.added.map(a => a.id), ['T-0034']);
  assert.equal(run(d, ['check']).code, 0);
});

test('ignore refuses containers unless asked and skips repeats', () => {
  const d = folder();
  assert.equal(run(d, ['ignore'], [{ ref: 'teams|lunchclub|*', reason: 'personal' }]).code, 1);
  const r = run(d, ['ignore'], [{ ref: 'teams|lunchclub|*', reason: 'personal', container: true }, { ref: 'mail|Bake-off Friday sign-up', reason: 'social' }]);
  assert.equal(r.json.ignored, 1);
  assert.match(read(d, 'IGNORED.md'), /teams\|lunchclub\|\* \| 2026-10-12 \| personal/);
});

test('add and ignore create a missing INBOX.md or IGNORED.md with the starter file\'s header', () => {
  const header = (t) => t.split(/\r?\n/).slice(0, t.split(/\r?\n/).findIndex(l => !l.trim())).join('\n');
  const starter = (f) => header(fs.readFileSync(path.join(REPO, 'new_discerny_repo', f), 'utf8'));
  const d = folder();
  fs.rmSync(path.join(d, 'INBOX.md'));
  fs.rmSync(path.join(d, 'IGNORED.md'));
  assert.equal(run(d, ['add'], [draft()]).code, 0);
  assert.equal(run(d, ['ignore'], [{ ref: 'mail|Bake-off Friday sign-up', reason: 'social' }]).code, 0);
  assert.equal(header(read(d, 'INBOX.md')), starter('INBOX.md'));
  assert.equal(header(read(d, 'IGNORED.md')), starter('IGNORED.md'));
});

test('state: day windows from the cursor minus overlap, ask window, horizon and backfill (E9, E17)', () => {
  const d = folder();
  const s = run(d, ['state', 'outlook-mail']).json;
  assert.equal(s.kind, 'stream');
  assert.equal(s.windows[0].after, '2026-10-08T13:05:41Z');
  assert.equal(s.windows.at(-1).before, NOW);
  assert.deepEqual(s.ask_window, { after: '2026-10-07T21:14:03Z', before: '2026-10-11T15:00:00Z' });
  assert.equal(s.user.name, 'Imogen Hartley');
  assert.equal(s.priority_people[0].name, 'Oliver Pemberton');
  run(d, ['commit', 'outlook-mail', 'watermark=2026-10-10T13:05:41Z']);
  assert.equal(run(d, ['state', 'outlook-mail']).json.windows[0].after, '2026-10-10T11:05:41Z');
  const h = run(d, ['state', 'outlook-calendar']).json;
  assert.equal(h.kind, 'horizon');
  assert.deepEqual(h.window, { after: NOW, before: '2026-10-26T15:00:00Z' });
  run(d, ['commit', 'teams-chat', 'gap=2026-09-28T00:00:00Z/2026-09-30T10:46:00Z']);
  const b = run(d, ['state', 'teams-chat']).json;
  assert.equal(b.mode, 'backfill');
  assert.equal(b.windows.length, 3);
  assert.equal(b.ask_window, undefined);
  run(d, ['commit', 'teams-chat', 'gap=']);
  assert.doesNotMatch(read(d, 'SOURCES.md'), /gap:/);
  const none = run(d, ['state', 'gmail']);
  assert.equal(none.code, 2);
});

test('state hands out the ask window as day-long ask windows, oldest first, so an ask pass can finish one day at a time', () => {
  const s = run(folder(), ['state', 'outlook-mail']).json;
  assert.deepEqual(s.ask_windows, [
    { after: '2026-10-07T21:14:03Z', before: '2026-10-08T21:14:03Z' },
    { after: '2026-10-08T21:14:03Z', before: '2026-10-09T21:14:03Z' },
    { after: '2026-10-09T21:14:03Z', before: '2026-10-10T21:14:03Z' },
    { after: '2026-10-10T21:14:03Z', before: '2026-10-11T15:00:00Z' },
  ]);
});

// A Run that read two windows and then spent page_cap inside the third commits that window's start as split.
const tooBig = ['commit', 'outlook-mail', 'watermark=2026-10-10T13:05:41Z', 'split=2026-10-10T13:05:41Z', 'waiting_checked_through=2026-10-11T15:00:00Z', `last_run=${NOW}`];

test('state hands out the day a Run found too big as hour-long windows, and the days either side a day long', () => {
  const d = folder();
  assert.equal(run(d, tooBig).code, 0);
  const w = run(d, ['state', 'outlook-mail'], undefined, '2026-10-12T18:00:00Z').json.windows;
  assert.equal(w.length, 27);
  assert.deepEqual(w[0], { after: '2026-10-10T11:05:41Z', before: '2026-10-10T13:05:41Z' });
  assert.deepEqual(w[1], { after: '2026-10-10T13:05:41Z', before: '2026-10-10T14:05:41Z' });
  assert.deepEqual(w[24], { after: '2026-10-11T12:05:41Z', before: '2026-10-11T13:05:41Z' });
  assert.deepEqual(w[25], { after: '2026-10-11T13:05:41Z', before: '2026-10-12T13:05:41Z' });
  assert.deepEqual(w[26], { after: '2026-10-12T13:05:41Z', before: '2026-10-12T18:00:00Z' });
});

test('commit takes the end of an hour in the split day as a watermark, keeps split while inside that day, and drops it once past', () => {
  const d = folder();
  assert.equal(run(d, tooBig).code, 0);
  const later = '2026-10-12T18:00:00Z';
  const inside = run(d, ['commit', 'outlook-mail', 'watermark=2026-10-10T18:05:41Z', `last_run=${later}`]);
  assert.equal(inside.code, 0, inside.out);
  assert.match(read(d, 'SOURCES.md'), /- split: 2026-10-10T13:05:41Z/);
  const past = run(d, ['commit', 'outlook-mail', 'watermark=2026-10-11T13:05:41Z', `last_run=${later}`]);
  assert.equal(past.code, 0, past.out);
  assert.doesNotMatch(read(d, 'SOURCES.md'), /split:/);
});

test('commit creates a block and replaces list keys with a value', () => {
  const d = folder();
  run(d, ['commit', 'gmail', 'watermark=2026-10-05T00:00:00Z', 'overlap=PT2H']);
  run(d, ['commit', 'teams-chat', 'exclude_chat=19:lunch-club', 'last_result=fetched 3, inbox +1']);
  const t = read(d, 'SOURCES.md');
  assert.match(t, /## gmail\n- watermark: 2026-10-05T00:00:00Z\n- overlap: PT2H/);
  assert.match(t, /- exclude_chat: 19:lunch-club\n- exclude_text/);
  assert.match(t, /- last_result: fetched 3, inbox \+1/);
});

// The Example's outlook-mail Run at NOW reads from 8 Oct 13:05:41 (the watermark less 2 hours) in five windows:
// four a day long, then 12 Oct 13:05:41 to 15:00. Its ask window runs from 7 Oct 21:14:03 to 11 Oct 15:00.
test('commit after a Run reports a source caught up when its watermark and ask cursor reach the ends of their windows', () => {
  const d = folder();
  const r = run(d, ['commit', 'outlook-mail', `watermark=${NOW}`, 'waiting_checked_through=2026-10-11T15:00:00Z', `last_run=${NOW}`]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.behind, { days: 0, report: 'outlook-mail: caught up' });
});

test('commit after a Run that stopped one window short reports one day still to read', () => {
  const d = folder();
  const r = run(d, ['commit', 'outlook-mail', 'watermark=2026-10-12T13:05:41Z', 'waiting_checked_through=2026-10-11T15:00:00Z', `last_run=${NOW}`]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.behind, { days: 1, report: 'outlook-mail: 1 day still to read, run again' });
});

test('commit after a Run that read two of its five windows reports three days still to read', () => {
  const d = folder();
  const r = run(d, ['commit', 'outlook-mail', 'watermark=2026-10-10T13:05:41Z', 'waiting_checked_through=2026-10-11T15:00:00Z', `last_run=${NOW}`]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.behind, { days: 3, report: 'outlook-mail: 3 days still to read, run again' });
});

test('commit refuses a watermark that is not the end of one of the Run\'s windows with exit 1, names the ends, and writes nothing', () => {
  const d = folder();
  const before = read(d, 'SOURCES.md');
  const r = run(d, ['commit', 'outlook-mail', 'watermark=2026-10-11T09:30:00Z', `last_run=${NOW}`, 'last_result=fetched 40']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.json.error, /watermark 2026-10-11T09:30:00Z/);
  assert.match(r.json.error, /2026-10-09T13:05:41Z, 2026-10-10T13:05:41Z, 2026-10-11T13:05:41Z, 2026-10-12T13:05:41Z, 2026-10-12T15:00:00Z/);
  assert.equal(read(d, 'SOURCES.md'), before);
});

test('commit takes the watermark a source already has, from a Run that spent page_cap inside its first window', () => {
  const d = folder();
  const r = run(d, ['commit', 'outlook-mail', 'watermark=2026-10-08T15:05:41Z', 'split=2026-10-08T13:05:41Z', `last_run=${NOW}`]);
  assert.equal(r.code, 0, r.out);
  assert.match(read(d, 'SOURCES.md'), /- watermark: 2026-10-08T15:05:41Z[^]*- split: 2026-10-08T13:05:41Z/);
});

test('commit takes any watermark when it is not a Run\'s: a start set with no last_run, or a source\'s first', () => {
  const d = folder();
  assert.equal(run(d, ['commit', 'outlook-mail', 'watermark=2026-10-11T09:30:00Z']).code, 0);
  assert.match(read(d, 'SOURCES.md'), /- watermark: 2026-10-11T09:30:00Z/);
  const first = run(d, ['commit', 'gmail', 'watermark=2026-10-11T09:30:00Z', `last_run=${NOW}`]);
  assert.equal(first.code, 0, first.out);
  assert.match(read(d, 'SOURCES.md'), /## gmail\r?\n- watermark: 2026-10-11T09:30:00Z/);
});

test('commit counts asks still to check only from waiting_max_age before the Run, since older ones have aged out', () => {
  const d = folder();
  const r = run(d, ['commit', 'outlook-mail', `watermark=${NOW}`, 'waiting_checked_through=2026-09-01T00:00:00Z', `last_run=${NOW}`]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.behind, { days: 20, report: 'outlook-mail: 20 days still to read, run again' });
});

test('commit after a Run that left an ask unclassified on 9 Oct reports the days of asks still to check, though its watermark caught up', () => {
  const d = folder();
  const r = run(d, ['commit', 'outlook-mail', `watermark=${NOW}`, 'waiting_checked_through=2026-10-09T09:59:59Z', `last_run=${NOW}`]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.behind, { days: 3, report: 'outlook-mail: 3 days still to read, run again' });
});

test('ref is always allowed; note only with apply_task_updates', () => {
  const d = folder();
  assert.equal(run(d, ['ref', 'T-0020', 'cal|2026-10-23|fable range 2027 – go/no-go']).code, 0);
  assert.match(read(d, 'TASKS.md'), /calid\|AAMkAGI-fable-gonogo-1021\n {2}- ref: cal\|2026-10-21\|fable range 2027 – go\/no-go\n {2}- ref: cal\|2026-10-23/);
  assert.equal(run(d, ['note', 'T-0020', 'Moved to 23 Oct']).code, 2);
  run(d, ['commit', 'defaults', 'apply_task_updates=true']);
  assert.equal(run(d, ['note', 'T-0028', 'Print order moved to Thu 15 Oct']).code, 0);
  assert.match(read(d, 'INBOX.md'), /- note: Print order moved to Thu 15 Oct/);
});

test('a first name finds the one person who has it, and no one when two do, on its own and as an ask\'s recipient', () => {
  const d = folder();
  assert.equal(run(d, ['who', 'Gus']).json.name, 'Gus Whitfield');
  const ask = [{ key: 'g', scheme: 'teams', pass: 'ask', chat: '19:gus-imogen_cd34ef@unq.gbl.spaces', message: '1759914000000', recipient_name: 'Gus' }];
  assert.equal(run(d, ['match'], ask).json[0].who, 'Gus Whitfield');
  fs.appendFileSync(path.join(d, 'PEOPLE.md'), '- Gus Ortega {id:P-0099; co:Feltcraft}\n');
  assert.equal(run(d, ['who', 'Gus']).json.name, null);
  assert.equal(run(d, ['match'], ask).json[0].who, null);
});

test('who, log and migrate', () => {
  const d = folder();
  assert.equal(run(d, ['who', 'ihartley']).json.name, 'Imogen Hartley');
  assert.equal(run(d, ['who', 'MEERA.ILANGOVAN@pennywhistle.example']).json.name, 'Meera Ilangovan');
  run(d, ['log'], 'outlook-mail · fetched 3 · inbox +1');
  assert.match(read(d, 'REFRESH-LOG.md'), /## 2026-10-12 16:00\n\noutlook-mail · fetched 3/);
  assert.deepEqual(run(d, ['migrate']).json.changes, []);
});

test('add takes lists as arrays or comma-separated strings, and has a dry run', () => {
  const d = folder();
  const dry = run(d, ['add', '--dry-run'], [draft({ tg: 'Supplier Quality, Document Control', notes: 'One note.' })]);
  assert.match(dry.json.would_add[0], /tg:Supplier Quality,Document Control/);
  assert.doesNotMatch(read(d, 'INBOX.md'), /Review the supplier sampling plan/);
  const r = run(d, ['add'], [draft({ tg: ['Supplier Quality', 'Document Control'], prj: 'PRJ-0001' })]);
  assert.equal(r.code, 0, r.out);
  assert.match(read(d, 'INBOX.md'), /prj:PRJ-0001; tg:Supplier Quality,Document Control/);
});

// connect and new write config.toml in the app folder, so they run in a throwaway copy of the app.
function app() {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'discerny-app-'));
  fs.mkdirSync(path.join(a, 'tools'));
  fs.copyFileSync(CLI, path.join(a, 'tools', 'discern.mjs'));
  fs.copyFileSync(path.join(REPO, 'discerny.html'), path.join(a, 'discerny.html'));
  fs.cpSync(path.join(REPO, 'new_discerny_repo'), path.join(a, 'new_discerny_repo'), { recursive: true });
  return a;
}
function runApp(a, args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(a, 'tools', 'discern.mjs'), ...args, '--now', NOW], { encoding: 'utf8', env: { ...process.env, DISCERNY_DIR: '', ...env } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { /* plain usage text */ }
  return { code: r.status, json, out: r.stdout };
}

test('the helper reads its parser from discerny.html only', () => {
  const a = app();
  fs.renameSync(path.join(a, 'discerny.html'), path.join(a, 'discerny-old.html'));
  const r = runApp(a, ['--version']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.json.error, /discerny\.html/);
  assert.doesNotMatch(r.json.error, /discerny-old/);
});

test('new makes a data folder from the starter and connects to it; connect switches folders', () => {
  const a = app(), mine = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'discerny-new-')), 'mine');
  assert.equal(runApp(a, ['check']).code, 2);
  assert.equal(runApp(a, ['connect']).code, 2);
  const n = runApp(a, ['new', mine]);
  assert.equal(n.code, 0, n.out);
  assert.equal(read(mine, 'TASKS.md'), read(path.join(REPO, 'new_discerny_repo'), 'TASKS.md'));
  assert.equal(runApp(a, ['check']).json.ok, true);
  assert.equal(runApp(a, ['new', mine]).code, 1);
  const d = folder();
  assert.equal(runApp(a, ['connect', d]).code, 0);
  assert.deepEqual(runApp(a, ['connect']).json, { folder: d, from: 'config.toml', ok: true });
  assert.equal(runApp(a, ['state', 'outlook-mail']).json.user.name, 'Imogen Hartley');
  assert.equal(runApp(a, ['connect', path.join(a, 'tools')]).code, 1);
  assert.equal(runApp(a, ['connect']).json.folder, d);
});

test('new writes DISCERNY.md with the app\'s Format version, and check finds it the same', () => {
  const a = app(), mine = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'discerny-new-')), 'mine');
  assert.equal(fs.existsSync(path.join(a, 'new_discerny_repo', 'DISCERNY.md')), false, 'the starter carries no DISCERNY.md');
  assert.equal(runApp(a, ['new', mine]).code, 0);
  const text = read(mine, 'DISCERNY.md');
  assert.match(text, /^# /);
  assert.match(text, /<!-- format: 0\.1\.0\.0 -->/);
  const c = runApp(a, ['check']);
  assert.equal(c.code, 0, c.out);
  assert.deepEqual(c.json.format, { folder: '0.1.0.0', app: '0.1.0.0', is: 'same' });
});

const appFile = (a, f) => path.join(a, f);

test('connect writes data_folder in config.toml, and commands then use it with no --dir', () => {
  const a = app(), d = folder();
  assert.equal(runApp(a, ['connect', d]).code, 0);
  const toml = read(a, 'config.toml');
  assert.match(toml, /^# /);
  assert.ok(toml.includes(`data_folder = '${d}'`), toml);
  assert.equal(fs.existsSync(appFile(a, 'data-folder.txt')), false);
  assert.deepEqual(runApp(a, ['connect']).json, { folder: d, from: 'config.toml', ok: true });
  assert.equal(runApp(a, ['state', 'outlook-mail']).json.user.name, 'Imogen Hartley');
});

test('a folder path with backslashes, spaces and a quote round-trips through config.toml', () => {
  const a = app(), d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'discerny path ')), "Imogen's data");
  fs.cpSync(BASE, d, { recursive: true });
  assert.equal(runApp(a, ['connect', d]).code, 0);
  assert.deepEqual(runApp(a, ['connect']).json, { folder: d, from: 'config.toml', ok: true });
  assert.equal(runApp(a, ['state', 'outlook-mail']).json.user.name, 'Imogen Hartley');
});

test('connect changes only data_folder in config.toml, keeping other keys, tables and comments as they were', () => {
  const a = app(), d = folder();
  const head = '# My settings\r\n\r\ntheme = "dark"   # a comment after a value\r\n';
  const tail = '\r\n[ui]\r\nfont_size = 14\r\nwide = true\r\nlabel = \'Work\'\r\n';
  fs.writeFileSync(appFile(a, 'config.toml'), `${head}data_folder = 'C:\\old\\place'\r\n${tail}`);
  assert.equal(runApp(a, ['connect', d]).code, 0);
  assert.equal(read(a, 'config.toml'), `${head}data_folder = '${d}'\r\n${tail}`);
  const t = '# Only a comment\n[ui]\ndata_folder = \'not this one\'\n';
  fs.writeFileSync(appFile(a, 'config.toml'), t);
  assert.equal(runApp(a, ['connect', d]).code, 0);
  assert.equal(read(a, 'config.toml'), `# Only a comment\ndata_folder = '${d}'\n[ui]\ndata_folder = 'not this one'\n`);
  assert.deepEqual(runApp(a, ['connect']).json, { folder: d, from: 'config.toml', ok: true });
});

test('a config.toml outside the subset the helper reads is exit 1 naming the line, and nothing is written', () => {
  const a = app(), d = folder();
  for (const [bad, line] of [['data_folder = [1, 2]', 2], ['ports = 1.5', 2], ['data_folder = "C:\\Users"', 2], ['a.b = 1', 2], ["x = 'open", 2], ['[ui]\n[ui]', 3], ['k = 1\nk = 2', 3], ['just words', 2]]) {
    const text = `# settings\n${bad}\n`;
    fs.writeFileSync(appFile(a, 'config.toml'), text);
    for (const args of [['connect', d], ['connect'], ['state', 'outlook-mail']]) {
      const r = runApp(a, args);
      assert.equal(r.code, 1, `${bad} / ${args[0]}: ${r.out}`);
      assert.match(r.json.error, new RegExp(`config\\.toml line ${line}\\b`), `${bad} / ${args[0]}`);
    }
    assert.equal(read(a, 'config.toml'), text);
  }
});

test('an App folder upgraded with only data-folder.txt still finds its folder, and the next connect or new moves it to config.toml', () => {
  for (const how of ['connect', 'new']) {
    const a = app(), d = folder();
    fs.writeFileSync(appFile(a, 'data-folder.txt'), d + '\n');
    assert.deepEqual(runApp(a, ['connect']).json, { folder: d, from: 'data-folder.txt', ok: true });
    assert.equal(runApp(a, ['state', 'outlook-mail']).json.user.name, 'Imogen Hartley');
    fs.writeFileSync(appFile(a, 'config.toml'), '# no folder yet\n[ui]\nwide = true\n');
    assert.equal(runApp(a, ['connect']).json.from, 'data-folder.txt');
    const e = how === 'new' ? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'discerny-new-')), 'mine') : folder();
    assert.equal(runApp(a, [how, e]).code, 0, how);
    assert.equal(fs.existsSync(appFile(a, 'data-folder.txt')), false, how);
    assert.equal(read(a, 'config.toml'), `# no folder yet\ndata_folder = '${e}'\n[ui]\nwide = true\n`, how);
    assert.deepEqual(runApp(a, ['connect']).json, { folder: e, from: 'config.toml', ok: true }, how);
  }
});

test('--dir and $DISCERNY_DIR still win over config.toml, and connect warns that $DISCERNY_DIR does', () => {
  const a = app(), d = folder(), e = folder(), f = folder();
  assert.equal(runApp(a, ['connect', d]).code, 0);
  assert.deepEqual(runApp(a, ['connect', '--dir', e]).json, { folder: e, from: '--dir', ok: true });
  assert.deepEqual(runApp(a, ['connect'], { DISCERNY_DIR: e }).json, { folder: e, from: 'DISCERNY_DIR', ok: true });
  assert.deepEqual(runApp(a, ['connect', '--dir', f], { DISCERNY_DIR: e }).json.from, '--dir');
  const w = runApp(a, ['connect', f], { DISCERNY_DIR: e });
  assert.deepEqual(w.json.warnings, ['DISCERNY_DIR is set, and it overrides config.toml until it is unset']);
});

test('connect connects to a folder in another Format, and warns', () => {
  const a = app(), d = folderInFormat('0.2.0.1');
  const r = runApp(a, ['connect', d]);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.connected, d);
  assert.ok(r.json.warnings.some(w => w.includes('0.2.0.1')), r.out);
  assert.deepEqual(runApp(a, ['connect', folder()]).json.warnings, []);
});

// A made-up Migration script: it adds its version as a line of MIGRATED.txt, so the order they ran in shows.
const script = (v, extra = '') => `import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv.slice(2).find(a => a !== '--write'), f = path.join(dir, 'MIGRATED.txt');
const had = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
${extra}
if (had.split('\\n').includes('${v}')) console.log('nothing to change');
else if (process.argv.includes('--write')) fs.writeFileSync(f, had + '${v}\\n');
else console.log('would add ${v} to MIGRATED.txt');
`;
const failing = 'console.error("broken"); process.exit(1);';

// A throwaway app whose migrations folder holds the given made-up Migrations, { version: { script, instructions } },
// and whose Format version is the newest of them, as the release helper would leave it.
function appWith(migrations) {
  const a = app(), names = Object.keys(migrations);
  for (const [v, m] of Object.entries(migrations)) {
    const d = path.join(a, 'migrations', v);
    fs.mkdirSync(d, { recursive: true });
    if (m.script !== undefined) fs.writeFileSync(path.join(d, 'migrate.mjs'), m.script);
    if (m.instructions !== undefined) fs.writeFileSync(path.join(d, 'INSTRUCTIONS.md'), m.instructions);
  }
  const newest = names.includes('next') ? 'next' : names.sort((x, y) => x.localeCompare(y, 'en', { numeric: true })).at(-1);
  const html = path.join(a, 'discerny.html');
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace(/var FORMAT='[^']*'/, `var FORMAT='${newest}'`));
  return a;
}

test('upgrade lists the pending Migrations and previews the next, and changes nothing', () => {
  const a = appWith({
    '0.1.0.0': { script: script('0.1.0.0') },
    '0.1.0.7': { script: script('0.1.0.7') },
    '0.2.0.1': { script: script('0.2.0.1'), instructions: '# Fill in urgency\n\nOptional: yes\n\nSet urg on open Items.\n' },
    '0.2.0.4': { instructions: '# Split owners\n\nOptional: no\n\nSplit each owner.\n' },
  });
  const d = folder(), before = snapshot(d);
  const r = runApp(a, ['upgrade', '--dir', d]);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.folder, '0.1.0.0');
  assert.equal(r.json.app, '0.2.0.4');
  assert.deepEqual(r.json.pending, [
    { version: '0.1.0.7', script: true, instructions: null },
    { version: '0.2.0.1', script: true, instructions: 'optional' },
    { version: '0.2.0.4', script: false, instructions: 'required' },
  ]);
  assert.match(r.json.preview, /would add 0\.1\.0\.7 to MIGRATED\.txt/);
  assert.deepEqual(snapshot(d), before);
});

// A copy of the Example alone in a fresh folder, so the backups an Upgrade makes beside it can be seen.
function lone() {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'discerny-up-')), 'mine');
  fs.cpSync(BASE, d, { recursive: true });
  return d;
}
const beside = (d) => fs.readdirSync(path.dirname(d)).sort();

test('upgrade --write backs the folder up, runs the Migrations oldest first and records the newest; again, it does nothing', () => {
  const a = appWith({ '0.1.0.7': { script: script('0.1.0.7') }, '0.2.0.1': { script: script('0.2.0.1') }, '0.10.0.1': { script: script('0.10.0.1') } });
  const d = lone(), before = snapshot(d);
  const r = runApp(a, ['upgrade', '--write', '--dir', d]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(beside(d), ['mine', 'mine.backup-0.1.0.0']);
  assert.deepEqual(snapshot(path.join(path.dirname(d), 'mine.backup-0.1.0.0')), before);
  assert.equal(read(d, 'MIGRATED.txt'), '0.1.0.7\n0.2.0.1\n0.10.0.1\n');
  assert.match(read(d, 'DISCERNY.md'), /<!-- format: 0\.10\.0\.1 -->/);
  assert.equal(runApp(a, ['check', '--dir', d]).code, 0);
  const again = runApp(a, ['upgrade', '--write', '--dir', d]);
  assert.equal(again.code, 0, again.out);
  assert.deepEqual(again.json.pending, []);
  assert.deepEqual(beside(d), ['mine', 'mine.backup-0.1.0.0']);
  assert.equal(read(d, 'MIGRATED.txt'), '0.1.0.7\n0.2.0.1\n0.10.0.1\n');
});

test('upgrade --write never overwrites an existing backup', () => {
  const a = appWith({ '0.1.0.7': { script: script('0.1.0.7') } });
  const d = lone(), old = path.join(path.dirname(d), 'mine.backup-0.1.0.0');
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'TASKS.md'), 'an older backup\n');
  assert.equal(runApp(a, ['upgrade', '--write', '--dir', d]).code, 0);
  assert.deepEqual(snapshot(old), { 'TASKS.md': 'an older backup\n' });
  assert.equal(read(d, 'MIGRATED.txt'), '0.1.0.7\n');
});

const OPTIONAL = '# Fill in urgency\n\nOptional: yes\n\nSet urg on open Items from what they say.\n';
const REQUIRED = '# Split owners\n\nOptional: no\n\nSplit each shared owner into one person.\n';

test('upgrade --write declines optional instructions and records them, and stops with exit 2 at required ones after their script', () => {
  const a = appWith({
    '0.1.0.7': { script: script('0.1.0.7') },
    '0.2.0.1': { script: script('0.2.0.1'), instructions: OPTIONAL },
    '0.2.0.4': { script: script('0.2.0.4'), instructions: REQUIRED },
    '0.3.0.1': { script: script('0.3.0.1') },
  });
  const d = lone();
  const r = runApp(a, ['upgrade', '--write', '--dir', d]);
  assert.equal(r.code, 2, r.out);
  assert.deepEqual(r.json.declined, ['0.2.0.1']);
  assert.equal(r.json.stopped, '0.2.0.4');
  assert.match(r.json.next, /migrations\/0\.2\.0\.4\/INSTRUCTIONS\.md/);
  assert.match(r.json.next, /discern upgrade --done 0\.2\.0\.4/);
  assert.equal(read(d, 'MIGRATED.txt'), '0.1.0.7\n0.2.0.1\n0.2.0.4\n');
  assert.match(read(d, 'DISCERNY.md'), /<!-- format: 0\.2\.0\.1 -->/);
});

test('upgrade --write stops with exit 1 at a failing script, names it, and keeps what is already recorded', () => {
  const a = appWith({ '0.1.0.7': { script: script('0.1.0.7') }, '0.2.0.1': { script: script('0.2.0.1', failing) }, '0.3.0.1': { script: script('0.3.0.1') } });
  const d = lone();
  const r = runApp(a, ['upgrade', '--write', '--dir', d]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.json.error, /migrations\/0\.2\.0\.1\/migrate\.mjs/);
  assert.match(r.json.error, /broken/);
  assert.equal(read(d, 'MIGRATED.txt'), '0.1.0.7\n');
  assert.match(read(d, 'DISCERNY.md'), /<!-- format: 0\.1\.0\.7 -->/);
});

test('an Upgrade taken one Migration at a time with --one and --done ends as --write does, with a backup per step', () => {
  const a = appWith({ '0.1.0.7': { script: script('0.1.0.7') }, '0.2.0.1': { script: script('0.2.0.1'), instructions: OPTIONAL }, '0.3.0.1': { script: script('0.3.0.1') } });
  const whole = lone();
  assert.equal(runApp(a, ['upgrade', '--write', '--dir', whole]).code, 0);
  const d = lone();
  assert.equal(runApp(a, ['upgrade', '--write', '--one', '--dir', d]).code, 0);
  assert.match(read(d, 'DISCERNY.md'), /<!-- format: 0\.1\.0\.7 -->/);
  const step = runApp(a, ['upgrade', '--write', '--one', '--dir', d]);
  assert.equal(step.code, 0, step.out);
  assert.match(step.json.next, /discern upgrade --done 0\.2\.0\.1/);
  assert.match(read(d, 'DISCERNY.md'), /<!-- format: 0\.1\.0\.7 -->/);
  assert.equal(runApp(a, ['upgrade', '--done', '0.3.0.1', '--dir', d]).code, 1);
  assert.equal(runApp(a, ['upgrade', '--done', '0.2.0.1', '--dir', d]).code, 0);
  assert.match(read(d, 'DISCERNY.md'), /<!-- format: 0\.2\.0\.1 -->/);
  assert.equal(runApp(a, ['upgrade', '--write', '--one', '--dir', d]).code, 0);
  assert.deepEqual(runApp(a, ['upgrade', '--dir', d]).json.pending, []);
  assert.deepEqual(snapshot(d), snapshot(whole));
  assert.deepEqual(beside(d), ['mine', 'mine.backup-0.1.0.0', 'mine.backup-0.1.0.7', 'mine.backup-0.2.0.1']);
});

test('upgrade --write runs next after every numbered Migration, and the folder then records next', () => {
  const a = appWith({ next: { script: script('next') }, '0.1.0.7': { script: script('0.1.0.7') }, '0.2.0.1': { script: script('0.2.0.1') } });
  const d = lone();
  assert.deepEqual(runApp(a, ['upgrade', '--dir', d]).json.pending.map(m => m.version), ['0.1.0.7', '0.2.0.1', 'next']);
  assert.equal(runApp(a, ['upgrade', '--write', '--dir', d]).code, 0);
  assert.equal(read(d, 'MIGRATED.txt'), '0.1.0.7\n0.2.0.1\nnext\n');
  assert.match(read(d, 'DISCERNY.md'), /<!-- format: next -->/);
  assert.equal(runApp(a, ['check', '--dir', d]).code, 0);
});

test('upgrade on a folder already in the app\'s Format says it is up to date, and --write changes nothing', () => {
  const d = lone(), before = snapshot(d);
  const r = run(d, ['upgrade']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.pending, []);
  assert.match(r.json.message, /up to date/);
  assert.equal(run(d, ['upgrade', '--write']).code, 0);
  assert.deepEqual(snapshot(d), before);
  assert.deepEqual(beside(d), ['mine']);
});

test('upgrade on a folder in a newer Format, or next, refuses with exit 2 and says what to do instead', () => {
  for (const [format, says] of [['0.2.0.1', /newer app/], ['next', /backup/]]) {
    const d = folderInFormat(format), before = snapshot(d);
    for (const args of [['upgrade'], ['upgrade', '--write']]) {
      const r = run(d, args);
      assert.equal(r.code, 2, `${args} on ${format}: ${r.out}`);
      assert.match(r.json.error, says);
    }
    assert.deepEqual(snapshot(d), before);
  }
});

test('transcript items share an event but not a calid ref', () => {
  const d = folder();
  const m = run(d, ['match'], [{ scheme: 'cal', subject: 'QA weekly', date: '2026-10-12', event_id: 'ev1', suffix: 'transcript-1' }]).json[0];
  assert.deepEqual(m.refs, ['cal|2026-10-12|qa weekly|transcript-1']);
  const t = (n) => draft({ title: `Action ${n}`, received: undefined, derived: true, refs: [`cal|2026-10-12|qa weekly|transcript-${n}`, 'calid|ev1'] });
  assert.equal(run(d, ['add'], [t(1), t(2)]).code, 0);
});


// The Example's date tool, run from the copy it shifts. A folder without the tool skips these.
const hasDates = fs.existsSync(path.join(BASE, DATES));
function shift(d, ...args) {
  const r = spawnSync(process.execPath, [path.join(d, DATES), ...args, d], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('refresh-dates --to a week later moves the dates and records the new as-of date', { skip: !hasDates }, () => {
  const d = folder();
  const r = shift(d, '--to', '2026-10-19');
  assert.equal(r.code, 0, r.out);
  assert.match(read(d, 'TASKS.md'), /T-0001 .*due:2026-10-21; st:In progress; asg:2026-08-10 09:12\}/);
  assert.match(read(d, 'README.md'), /\*\*As of:\*\* Monday 19 October 2026/);
});

test('refresh-dates moves every kind of date, in prose too, and leaves times of day as written', { skip: !hasDates }, () => {
  const d = folder();
  assert.equal(shift(d, '--to', '2026-11-02').code, 0);
  const tasks = read(d, 'TASKS.md'), inbox = read(d, 'INBOX.md');
  assert.match(tasks, /due:2026-12-08 09:30; asg:2026-09-02 14:20\}/);
  assert.match(tasks, /from Meera Ilangovan \(24 Aug\)/);
  assert.match(tasks, /the ISO 9001 audit on 8 Dec\./);
  assert.match(tasks, /Three-day recertification audit, 8–10 Dec,/);
  assert.match(tasks, /ref: cal\|2026-12-08\|pennywhistle recertification audit/);
  assert.match(inbox, /"Mk4 FAI – Tue 10 Nov"/);
  assert.match(inbox, /ref: cal\|2026-11-10\|mk4 fai – tue 10 nov/);
  assert.match(read(d, 'PEOPLE.md'), /hist: 2026-07-22 \| Job title/);
  assert.match(read(d, 'PEOPLE.md'), /Left Pennywhistle on 3 Oct 2026\./);
  assert.match(read(d, 'PROJECTS.md'), /Current certificate expires 21 Jan 2027\./);
  assert.match(read(d, 'SOURCES.md'), /watermark: 2026-10-29T15:05:41Z/);
  assert.match(read(d, 'ASK-AGENT-LOG.md'), /- 2026-10-23 09:05 \| T-0007 \| queued 2026-10-22 16:48 \|.*promised for 6 Nov/);
  assert.match(read(d, 'IGNORED.md'), /scheduled maintenance Sat 3 Oct \| 2026-09-29 \|/);
  const draft = read(d, path.join('drafts', 'T-0007-scar-031-chaser.md'));
  assert.match(draft, /Requested: 2026-10-22 16:48/);
  assert.match(draft, /by 6 November\./);
});

test('refresh-dates forward and back with --to gives byte-identical files', { skip: !hasDates }, () => {
  const d = folder(), before = snapshot(d);
  assert.equal(shift(d, '--to', '2027-01-11').code, 0);
  assert.match(read(d, 'TASKS.md'), /load tests were run on 31 Dec–2 Jan/);
  const back = shift(d, '--to', '2026-10-12');
  assert.equal(back.code, 0, back.out);
  assert.deepEqual(snapshot(d), before);
});

test('refresh-dates run a second time changes nothing', { skip: !hasDates }, () => {
  for (const args of [[], ['--to', '2026-11-30']]) {
    const d = folder();
    assert.equal(shift(d, ...args).code, 0);
    const once = snapshot(d);
    const again = shift(d, ...args);
    assert.equal(again.code, 0, again.out);
    assert.deepEqual(snapshot(d), once, args.join(' '));
  }
});

test('refresh-dates refuses a --to date that is not a whole number of weeks away, and changes nothing', { skip: !hasDates }, () => {
  const d = folder(), before = snapshot(d);
  const r = shift(d, '--to', '2026-10-15');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /whole number of weeks/);
  assert.deepEqual(snapshot(d), before);
});

test('a copy shifted by refresh-dates passes check', { skip: !hasDates }, () => {
  const d = folder();
  assert.equal(shift(d, '--to', '2026-12-07').code, 0);
  const r = run(d, ['check']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.ok, true);
});

test('the tests\' copy of the Example is as of Monday 12 October 2026, however far its dates have been moved on', { skip: !hasDates }, () => {
  assert.match(read(folder(), 'README.md'), /\*\*As of:\*\* Monday 12 October 2026/);
});

// ---------------------------------------------------------------- serve
// Starts `serve` on any free port and resolves once it prints where it is listening.
// Every server is stopped when its test ends.
// With an app copy `a`, it runs that copy's helper on its connected folder; otherwise it serves `dir` with --dir.
async function serve(t, dir, { a, env = {} } = {}) {
  const { spawn } = await import('node:child_process');
  const args = a ? [path.join(a, 'tools', 'discern.mjs'), 'serve', '--port', '0'] : [CLI, 'serve', '--dir', dir, '--port', '0'];
  const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DISCERNY_DIR: '', ...env } });
  t.after(() => p.kill());
  let outText = '';
  const said = await new Promise((resolve, reject) => {
    p.stdout.on('data', (b) => { outText += b; if (outText.includes('\n')) resolve(JSON.parse(outText.split('\n')[0])); });
    p.on('exit', (code) => reject(new Error(`serve exited ${code} before listening: ${outText}`)));
  });
  return withSession(said);
}
// Adds the folder's current session, and api(path, init), a fetch that names it and the page's Origin as the page does.
async function withSession(said) {
  const { session } = await (await fetch(new URL('api/info', said.url))).json();
  const api = (p, init = {}) => fetch(new URL(p, said.url), { ...init, headers: { 'X-Discerny-Session': session, Origin: new URL(said.url).origin, ...init.headers } });
  return { ...said, session, api };
}

test('serve prints its URL and folder, and /api/info names the folder and the app version', async (t) => {
  const d = folder();
  const said = await serve(t, d);
  assert.match(said.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal(said.folder, d);
  const r = await fetch(new URL('api/info', said.url));
  assert.equal(r.status, 200);
  const version = /var VERSION='([^']+)'/.exec(fs.readFileSync(path.join(REPO, 'discerny.html'), 'utf8'))[1];
  const info = await r.json();
  assert.deepEqual({ ...info, session: undefined }, { folder: d, name: path.basename(d), version, session: undefined, canSwitch: false });
  assert.equal(info.problem, undefined);
});

test('serve reads a file with its mtime, and a PUT writes it and returns the new mtime', async (t) => {
  const d = folder();
  const { url, api, session } = await serve(t, d);
  const got = await api('api/file/TASKS.md');
  assert.equal(got.status, 200);
  assert.equal(await got.text(), read(d, 'TASKS.md'));
  const before = Number(got.headers.get('X-Mtime'));
  assert.equal(before, Math.floor(fs.statSync(path.join(d, 'TASKS.md')).mtimeMs));
  fs.utimesSync(path.join(d, 'TASKS.md'), new Date(before - 60e3), new Date(before - 60e3));
  const text = read(d, 'TASKS.md') + '- [ ] T-9999 Written through the server\n';
  const put = await api('api/file/TASKS.md', { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: text });
  assert.equal(put.status, 200);
  const { mtime } = await put.json();
  assert.equal(read(d, 'TASKS.md'), text);
  assert.equal(mtime, Math.floor(fs.statSync(path.join(d, 'TASKS.md')).mtimeMs));
  assert.notEqual(mtime, before - 60e3);
  const again = await api('api/file/TASKS.md');
  assert.equal(await again.text(), text);
  assert.equal(Number(again.headers.get('X-Mtime')), mtime);
});

test('serve answers 404 for a known file that is missing', async (t) => {
  const d = folder();
  fs.rmSync(path.join(d, 'IGNORED.md'), { force: true });
  const { url, api, session } = await serve(t, d);
  assert.equal((await api('api/file/IGNORED.md')).status, 404);
});

test('serve refuses a PUT whose If-Mtime is stale with 409, and leaves the file as it was', async (t) => {
  const d = folder();
  const { url, api, session } = await serve(t, d);
  const got = await api('api/file/TASKS.md');
  const seen = Number(got.headers.get('X-Mtime')), before = await got.text();
  const put = (ifMtime) => api('api/file/TASKS.md', { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'If-Mtime': String(ifMtime) }, body: before + '- [ ] T-9999 Overwrites\n' });
  const stale = await put(seen - 1000);
  assert.equal(stale.status, 409);
  assert.equal(read(d, 'TASKS.md'), before);
  assert.equal(Math.floor(fs.statSync(path.join(d, 'TASKS.md')).mtimeMs), seen);
  assert.equal((await put(seen)).status, 200);
});

// A request sent exactly as written: fetch would tidy away `..` and never sends a Host of our choosing.
async function raw(url, reqPath, { method = 'GET', headers = {}, body } = {}) {
  const http = await import('node:http');
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method, path: reqPath, headers }, (res) => {
      let text = '';
      res.on('data', (b) => { text += b; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('serve refuses unknown names, paths out of the folder and a Host that is not its own', async (t) => {
  const d = folder();
  const { url, api, session } = await serve(t, d);
  for (const p of ['/api/file/README.md', '/api/file/../TASKS.md', '/api/file/..%2fTASKS.md', '/api/file/%2e%2e%2fTASKS.md', '/api/file/drafts%2fx.md', '/api/file/..%5cTASKS.md', '/api/file/TASKS.md/']) {
    assert.equal((await raw(url, p, { headers: { 'X-Discerny-Session': session } })).status, 404, p);
  }
  const port = new URL(url).port;
  for (const host of ['evil.example', `evil.example:${port}`, '127.0.0.1:1', `127.0.0.2:${port}`]) {
    const r = await raw(url, '/api/file/TASKS.md', { headers: { Host: host, 'X-Discerny-Session': session } });
    assert.equal(r.status, 403, host);
    assert.equal(r.text.includes('# Tasks'), false, host);
  }
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
    assert.equal((await raw(url, '/api/file/TASKS.md', { headers: { Host: host, 'X-Discerny-Session': session } })).status, 200, host);
  }
  const ok = await raw(url, '/api/info');
  assert.equal(Object.keys(ok.headers).some(h => h.startsWith('access-control-')), false);
});

test('serve gives the app\'s icons as they are on disk, and nothing else under /icons/', async (t) => {
  const { url } = await serve(t, folder());
  for (const [name, type] of [['favicon.ico', 'image/x-icon'], ['discerny-32.png', 'image/png'], ['apple-touch-icon.png', 'image/png']]) {
    const r = await fetch(new URL(`icons/${name}`, url));
    assert.equal(r.status, 200, name);
    assert.equal(r.headers.get('content-type'), type, name);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), fs.readFileSync(path.join(REPO, 'icons', name)), name);
  }
  assert.equal((await raw(url, '/icons/missing.png')).status, 404);
  for (const p of ['/icons/../discerny.html', '/icons/..%2fdiscerny.html', '/icons/%2e%2e%2fconfig.toml', '/icons/..%5cdiscerny.html', '/icons/Favicon.ico', '/icons/favicon.ico/', '/icons/x.svg', '/icons/']) {
    const r = await raw(url, p);
    assert.ok(r.status >= 400, `${p} ${r.status}`);
    assert.equal(r.headers['content-type'].startsWith('text/plain'), true, p);
  }
});

test('serve gives the icons with no folder usable', async (t) => {
  const said = await serve(t, folderInFormat('0.2.0.1'));
  assert.match(said.problem, /Format/);
  assert.equal((await fetch(new URL('icons/favicon.ico', said.url))).status, 200);
});

test('serve gives the web manifest as it is on disk, with no folder usable', async (t) => {
  const said = await serve(t, folderInFormat('0.2.0.1'));
  assert.match(said.problem, /Format/);
  const r = await fetch(new URL('manifest.webmanifest', said.url));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/manifest+json');
  assert.equal(await r.text(), fs.readFileSync(path.join(REPO, 'manifest.webmanifest'), 'utf8'));
});

test('the web manifest installs Discerny standalone, with icons that serve gives at the sizes it says', async (t) => {
  const { url } = await serve(t, folder());
  const at = new URL('manifest.webmanifest', url);
  const m = await (await fetch(at)).json();
  assert.equal(m.name, 'Discerny');
  assert.equal(m.short_name, 'Discerny');
  assert.equal(m.description, 'A task tracker and knowledge base you run together with an AI agent.');
  for (const k of ['id', 'start_url', 'scope']) assert.equal(new URL(m[k], at).href, new URL('/', url).href, k);
  assert.equal(m.display, 'standalone');
  assert.equal(m.background_color, '#F6F5F2');
  assert.equal(m.theme_color, '#F6F5F2');
  const got = [];
  for (const icon of m.icons) {
    const r = await fetch(new URL(icon.src, at));
    assert.equal(r.status, 200, icon.src);
    assert.equal(r.headers.get('content-type'), 'image/png', icon.src);
    const png = Buffer.from(await r.arrayBuffer());
    assert.equal(icon.sizes, `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src);
    got.push(`${icon.sizes} ${icon.purpose ?? 'any'}`);
  }
  assert.deepEqual(got.sort(), ['192x192 any', '192x192 maskable', '256x256 any', '512x512 any', '512x512 maskable']);
});

test('serve refuses a PUT that is empty over a file with content, not text/plain, or over 10 MB, and writes nothing', async (t) => {
  const d = folder();
  const { url, api, session } = await serve(t, d);
  const before = read(d, 'TASKS.md');
  const put = (body, type = 'text/plain') => api('api/file/TASKS.md', { method: 'PUT', headers: { 'Content-Type': type }, body });
  assert.equal((await put('')).status, 400);
  assert.equal((await put(before + '- [ ] T-9999 Sent as JSON\n', 'application/json')).status, 415);
  assert.equal((await put(before + 'x'.repeat(10 * 1024 * 1024))).status, 413);
  assert.equal(read(d, 'TASKS.md'), before);
  assert.deepEqual(fs.readdirSync(d).filter(f => f.endsWith('.tmp')), []);
});

test('serve gives the mtime of every file the page reads in one answer, 0 for a missing one', async (t) => {
  const d = folder();
  fs.utimesSync(path.join(d, 'PEOPLE.md'), new Date('2026-10-01T09:00:00Z'), new Date('2026-10-01T09:00:00Z'));
  fs.rmSync(path.join(d, 'IGNORED.md'), { force: true });
  const { url, api, session } = await serve(t, d);
  const m = await (await api('api/mtimes')).json();
  assert.equal(m['PEOPLE.md'], Date.parse('2026-10-01T09:00:00Z'));
  assert.equal(m['IGNORED.md'], 0);
  for (const f of ['TASKS.md', 'INBOX.md', 'DONE.md', 'PROJECTS.md', 'SYSTEMS.md', 'RELATIONSHIPS.md', 'ASK-AGENT.md', 'ASK-AGENT-LOG.md', 'SOURCES.md', 'DISCERNY.md']) {
    assert.equal(m[f], fs.existsSync(path.join(d, f)) ? Math.floor(fs.statSync(path.join(d, f)).mtimeMs) : 0, f);
  }
  assert.equal(Object.keys(m).length, 12);
});

test('serve lists the Drafts, .md and .txt only, by name, and none when there is no drafts folder', async (t) => {
  const d = folder(), dr = path.join(d, 'drafts');
  fs.rmSync(dr, { recursive: true, force: true });
  const { url, api, session } = await serve(t, d);
  assert.deepEqual(await (await api('api/drafts')).json(), []);
  fs.mkdirSync(path.join(dr, 'sub.md'), { recursive: true });
  fs.writeFileSync(path.join(dr, 'b-reply.md'), 'Hi Ana,\n');
  fs.writeFileSync(path.join(dr, 'a-note.TXT'), 'Plain text\n');
  fs.writeFileSync(path.join(dr, 'c.json'), '{}');
  fs.utimesSync(path.join(dr, 'b-reply.md'), new Date('2026-10-02T08:00:00Z'), new Date('2026-10-02T08:00:00Z'));
  const list = await (await api('api/drafts')).json();
  assert.deepEqual(list.map(x => x.name), ['a-note.TXT', 'b-reply.md']);
  assert.deepEqual(list[1], { name: 'b-reply.md', text: 'Hi Ana,\n', mod: Date.parse('2026-10-02T08:00:00Z') });
});

test('serve on a folder in another Format listens, says so, gives only DISCERNY.md and refuses every other read and write with 409', async (t) => {
  for (const format of ['0.0.1.5', '0.2.0.1', 'next']) {
    const d = folderInFormat(format), before = snapshot(d);
    const said = await serve(t, d);
    assert.equal(said.folder, d);
    assert.match(said.problem, new RegExp(`Format ${format}`));
    const info = await (await fetch(new URL('api/info', said.url))).json();
    assert.equal(info.problem, 'format', format);
    assert.equal(info.folder, d);
    const h = { 'X-Discerny-Session': info.session };
    const disc = await fetch(new URL('api/file/DISCERNY.md', said.url), { headers: h });
    assert.equal(disc.status, 200, format);
    assert.match(await disc.text(), new RegExp(`format: ${format}`));
    for (const p of ['api/file/TASKS.md', 'api/mtimes', 'api/drafts']) {
      assert.equal((await fetch(new URL(p, said.url), { headers: h })).status, 409, `${format} ${p}`);
    }
    for (const f of ['TASKS.md', 'DISCERNY.md']) {
      const put = await said.api(`api/file/${f}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'changed\n' });
      assert.equal(put.status, 409, `${format} PUT ${f}`);
    }
    assert.deepEqual(snapshot(d), before, format);
  }
});

test('serve refuses a data request with no X-Discerny-Session, or the wrong one, with 412, and writes nothing', async (t) => {
  const d = folder(), before = read(d, 'TASKS.md');
  const { url } = await serve(t, d);
  const { session } = await (await fetch(new URL('api/info', url))).json();
  assert.equal(typeof session, 'string');
  assert.ok(session.length >= 16, session);
  for (const h of [{}, { 'X-Discerny-Session': 'not-the-session' }]) {
    for (const p of ['api/file/TASKS.md', 'api/mtimes', 'api/drafts']) assert.equal((await fetch(new URL(p, url), { headers: h })).status, 412, p);
    const put = await fetch(new URL('api/file/TASKS.md', url), { method: 'PUT', headers: { ...h, Origin: new URL(url).origin, 'Content-Type': 'text/plain' }, body: before + '- [ ] T-9999 From a stale tab\n' });
    assert.equal(put.status, 412);
  }
  assert.equal(read(d, 'TASKS.md'), before);
  assert.equal((await fetch(new URL('api/file/TASKS.md', url), { headers: { 'X-Discerny-Session': session } })).status, 200);
});

test('serve refuses a PUT with no Origin, or another site\'s, with 403, and writes nothing', async (t) => {
  const d = folder(), before = read(d, 'TASKS.md');
  const { url, session } = await serve(t, d);
  const port = new URL(url).port;
  const put = (origin) => raw(url, '/api/file/TASKS.md', { method: 'PUT', body: before + '- [ ] T-9999 Cross-site\n',
    headers: { 'Content-Type': 'text/plain', 'X-Discerny-Session': session, ...(origin ? { Origin: origin } : {}) } });
  for (const origin of [null, 'http://evil.example', `http://evil.example:${port}`, `http://127.0.0.1:${Number(port) + 1}`, `https://127.0.0.1:${port}`, 'null']) {
    assert.equal((await put(origin)).status, 403, String(origin));
  }
  assert.equal(read(d, 'TASKS.md'), before);
  for (const origin of [`http://127.0.0.1:${port}`, `http://localhost:${port}`]) assert.equal((await put(origin)).status, 200, origin);
});

// Asks the server to switch folders, as the page's Change folder form does.
const switchTo = (url, folderPath, headers = { Origin: new URL(url).origin }) =>
  fetch(new URL('api/folder', url), { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ path: folderPath }) });

test('serve switches to another data folder, serves it, and records it in config.toml as connect does', async (t) => {
  const a = app(), d = folder(), e = folder();
  assert.equal(runApp(a, ['connect', d]).code, 0);
  const { url } = await serve(t, null, { a });
  fs.writeFileSync(path.join(e, 'TASKS.md'), read(e, 'TASKS.md') + '- [ ] T-9998 Only in the second folder\n');
  const r = await switchTo(url, e);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { folder: e, name: path.basename(e) });
  const info = await (await fetch(new URL('api/info', url))).json();
  assert.equal(info.folder, e);
  assert.equal(info.problem, undefined);
  const got = await fetch(new URL('api/file/TASKS.md', url), { headers: { 'X-Discerny-Session': info.session } });
  assert.match(await got.text(), /T-9998 Only in the second folder/);
  assert.ok(read(a, 'config.toml').includes(`data_folder = '${e}'`));
  assert.deepEqual(runApp(a, ['connect']).json, { folder: e, from: 'config.toml', ok: true });
});

test('serve refuses to switch to a folder with no TASKS.md or in another Format, or without its own Origin, and stays where it was', async (t) => {
  const a = app(), d = folder();
  assert.equal(runApp(a, ['connect', d]).code, 0);
  const { url, session } = await serve(t, null, { a });
  const toml = read(a, 'config.toml');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'discerny-empty-'));
  const none = await switchTo(url, empty);
  assert.equal(none.status, 400);
  assert.match(await none.text(), /has no TASKS\.md, so it is not a Discerny data folder/);
  for (const format of ['0.0.1.5', '0.2.0.1', 'next']) {
    const r = await switchTo(url, folderInFormat(format));
    assert.equal(r.status, 409, format);
    assert.match(await r.text(), new RegExp(`Format ${format}`));
  }
  for (const headers of [{}, { Origin: 'http://evil.example' }]) assert.equal((await switchTo(url, folder(), headers)).status, 403);
  const info = await (await fetch(new URL('api/info', url))).json();
  assert.equal(info.folder, d);
  assert.equal(info.session, session);
  assert.equal(read(a, 'config.toml'), toml);
});

test('serve started with --dir or $DISCERNY_DIR refuses to switch with 409 and says why', async (t) => {
  for (const how of ['--dir', 'DISCERNY_DIR']) {
    const d = folder(), a = app();
    const said = how === '--dir' ? await serve(t, d) : await serve(t, null, { a, env: { DISCERNY_DIR: d } });
    assert.equal((await (await fetch(new URL('api/info', said.url))).json()).canSwitch, false);
    const r = await switchTo(said.url, folder());
    assert.equal(r.status, 409, how);
    assert.match(await r.text(), new RegExp(how === '--dir' ? '--dir' : 'DISCERNY_DIR'));
    assert.equal((await (await fetch(new URL('api/info', said.url))).json()).folder, d);
    assert.equal(fs.existsSync(appFile(a, 'config.toml')), false);
  }
});

test('serve switches from no folder, and from one in another Format, the same way', async (t) => {
  for (const start of ['none', 'format']) {
    const a = app(), e = folder();
    if (start === 'format') assert.equal(runApp(a, ['connect', folderInFormat('0.0.1.5')]).code, 0);
    const { url } = await serve(t, null, { a });
    assert.equal((await (await fetch(new URL('api/info', url))).json()).problem, start);
    assert.equal((await switchTo(url, e)).status, 200, start);
    const info = await (await fetch(new URL('api/info', url))).json();
    assert.equal(info.folder, e, start);
    assert.equal(info.problem, undefined, start);
    assert.equal((await fetch(new URL('api/file/TASKS.md', url), { headers: { 'X-Discerny-Session': info.session } })).status, 200, start);
  }
});

test('after a switch, a request naming the old session is refused with 412 and writes nothing to the new folder', async (t) => {
  const a = app(), d = folder(), e = folder();
  assert.equal(runApp(a, ['connect', d]).code, 0);
  const { url, api, session } = await serve(t, null, { a });
  const tasks = read(e, 'TASKS.md');
  assert.equal((await switchTo(url, e)).status, 200);
  assert.notEqual((await (await fetch(new URL('api/info', url))).json()).session, session);
  assert.equal((await api('api/file/TASKS.md')).status, 412);
  assert.equal((await api('api/mtimes')).status, 412);
  const put = await api('api/file/TASKS.md', { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: read(d, 'TASKS.md') + '- [ ] T-9999 From the old tab\n' });
  assert.equal(put.status, 412);
  assert.equal(read(e, 'TASKS.md'), tasks);
});

test('serve suggests the connected folder and the Example beside the App folder, when each is a data folder', async (t) => {
  // The App copy sits alone in its own parent folder, so the Example beside it is one the test puts there.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'discerny-side-')), a = path.join(parent, 'discerny-app');
  fs.cpSync(app(), a, { recursive: true });
  const d = folder(), example = path.join(parent, 'discerny-example');
  assert.equal(runApp(a, ['connect', d]).code, 0);
  const { url } = await serve(t, null, { a });
  const list = async () => (await fetch(new URL('api/folders', url))).json();
  assert.deepEqual(await list(), [{ folder: d, name: path.basename(d) }]);
  fs.cpSync(BASE, example, { recursive: true });
  assert.deepEqual(await list(), [{ folder: d, name: path.basename(d) }, { folder: example, name: 'discerny-example' }]);
  assert.equal((await switchTo(url, example)).status, 200);
  assert.deepEqual(await list(), [{ folder: example, name: 'discerny-example' }]);
  fs.rmSync(path.join(example, 'TASKS.md'));
  assert.deepEqual(await list(), []);
});

test('serve opens a folder normally once it is upgraded on disk, with no restart', async (t) => {
  const d = folderInFormat('0.0.1.5');
  const { url } = await serve(t, d);
  assert.equal((await (await fetch(new URL('api/info', url))).json()).problem, 'format');
  fs.writeFileSync(path.join(d, 'DISCERNY.md'), '# Discerny data folder\n\n<!-- format: 0.1.0.0 -->\n');
  const info = await (await fetch(new URL('api/info', url))).json();
  assert.equal(info.problem, undefined);
  const got = await fetch(new URL('api/file/TASKS.md', url), { headers: { 'X-Discerny-Session': info.session } });
  assert.equal(got.status, 200);
  assert.equal(await got.text(), read(d, 'TASKS.md'));
});

test('serve with --dir or $DISCERNY_DIR on a folder with no TASKS.md exits 2 and never listens', () => {
  const opts = { encoding: 'utf8', timeout: 10e3 };
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'discerny-empty-'));
  const r = spawnSync(process.execPath, [CLI, 'serve', '--dir', empty, '--port', '0'], opts);
  assert.equal(r.status, 2, r.stdout);
  assert.match(JSON.parse(r.stdout).error, /has no TASKS\.md/);
  const e = spawnSync(process.execPath, [CLI, 'serve', '--port', '0'], { ...opts, env: { ...process.env, DISCERNY_DIR: empty } });
  assert.equal(e.status, 2, e.stdout);
});

test('serve with no folder connected listens, says so, and answers every file request with 409', async (t) => {
  const a = app();
  const said = await serve(t, null, { a });
  assert.equal(said.folder, null);
  assert.match(said.problem, /no data folder is connected/);
  const info = await (await fetch(new URL('api/info', said.url))).json();
  assert.equal(info.problem, 'none');
  assert.equal(info.folder, null);
  assert.equal(info.session, null);
  assert.equal(info.canSwitch, true);
  for (const p of ['api/file/TASKS.md', 'api/file/DISCERNY.md', 'api/mtimes', 'api/drafts']) {
    assert.equal((await fetch(new URL(p, said.url))).status, 409, p);
  }
  // A connected folder that has lost its TASKS.md is the same as none.
  const b = app(), gone = folder();
  assert.equal(runApp(b, ['connect', gone]).code, 0);
  fs.rmSync(path.join(gone, 'TASKS.md'));
  const g = await serve(t, null, { a: b });
  assert.equal((await (await fetch(new URL('api/info', g.url))).json()).problem, 'none');
});

test('serve gives the UI at /', async (t) => {
  const { url } = await serve(t, folder());
  const r = await fetch(url);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Type'), /^text\/html/);
  assert.equal(await r.text(), fs.readFileSync(path.join(REPO, 'discerny.html'), 'utf8'));
});
