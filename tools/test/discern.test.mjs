// Tests for tools/discern.mjs, run against a fresh copy of the test data folder for each test:
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
const BASE = committed();

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

test('check passes on the test data folder', () => {
  const r = run(folder(), ['check']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.ok, true);
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
  assert.equal(by.E3.outcome, 'notice');
  assert.deepEqual(by.E3.ids, ['T-0031']);
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

test('commit creates a block and replaces list keys with a value', () => {
  const d = folder();
  run(d, ['commit', 'gmail', 'watermark=2026-10-05T00:00:00Z', 'overlap=PT2H']);
  run(d, ['commit', 'teams-chat', 'exclude_chat=19:lunch-club', 'last_result=fetched 3, inbox +1']);
  const t = read(d, 'SOURCES.md');
  assert.match(t, /## gmail\n- watermark: 2026-10-05T00:00:00Z\n- overlap: PT2H/);
  assert.match(t, /- exclude_chat: 19:lunch-club\n- exclude_text/);
  assert.match(t, /- last_result: fetched 3, inbox \+1/);
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

// connect and new write data-folder.txt, so they run in a throwaway copy of the app.
function app() {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'discerny-app-'));
  fs.mkdirSync(path.join(a, 'tools'));
  fs.copyFileSync(CLI, path.join(a, 'tools', 'discern.mjs'));
  fs.copyFileSync(path.join(REPO, 'discerny.html'), path.join(a, 'discerny.html'));
  fs.cpSync(path.join(REPO, 'new_discerny_repo'), path.join(a, 'new_discerny_repo'), { recursive: true });
  return a;
}
function runApp(a, args) {
  const r = spawnSync(process.execPath, [path.join(a, 'tools', 'discern.mjs'), ...args, '--now', NOW], { encoding: 'utf8', env: { ...process.env, DISCERNY_DIR: '' } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { /* plain usage text */ }
  return { code: r.status, json, out: r.stdout };
}

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
  assert.deepEqual(runApp(a, ['connect']).json, { folder: d, from: 'data-folder.txt', ok: true });
  assert.equal(runApp(a, ['state', 'outlook-mail']).json.user.name, 'Imogen Hartley');
  assert.equal(runApp(a, ['connect', path.join(a, 'tools')]).code, 1);
  assert.equal(runApp(a, ['connect']).json.folder, d);
});

test('transcript items share an event but not a calid ref', () => {
  const d = folder();
  const m = run(d, ['match'], [{ scheme: 'cal', subject: 'QA weekly', date: '2026-10-12', event_id: 'ev1', suffix: 'transcript-1' }]).json[0];
  assert.deepEqual(m.refs, ['cal|2026-10-12|qa weekly|transcript-1']);
  const t = (n) => draft({ title: `Action ${n}`, received: undefined, derived: true, refs: [`cal|2026-10-12|qa weekly|transcript-${n}`, 'calid|ev1'] });
  assert.equal(run(d, ['add'], [t(1), t(2)]).code, 0);
});

