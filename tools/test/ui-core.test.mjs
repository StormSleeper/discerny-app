// Tests for the pure functions in the //<core> block of discerny.html: the logic behind the UI's lists,
// search and quick add, loaded the same way tools/discern.mjs loads the parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadCore() {
  const html = fs.readFileSync(path.join(REPO, 'discerny.html'), 'utf8');
  const a = html.indexOf('//<core>'), b = html.indexOf('//</core>');
  const names = ['parse', 'serialize', 'pParse', 'changesOf', 'changeKey', 'setPriority', 'workbench', 'itemMatch', 'quickItem', 'snooze', 'isOverdue', 'REL_HEAD', 'ASK_HEAD',
    'descOf', 'setDesc', 'commentsOf', 'toAck', 'addComment', 'byTime', 'tzOf', 'stampIn', 'ITEM_RANK', 'PERSON_RANK',
    'serItem', 'canMerge', 'mergeItem', 'mergeRefs', 'fieldChange', 'changeUndo', 'priorityPaused'];
  const ret = '{' + names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ') + '}';
  return new Function(`'use strict';\n${html.slice(a + 8, b)}\n;return ${ret};`)();
}
const C = loadCore();

const items = text => C.parse('# Tasks\n' + text).items;
const ids = g => g.items.map(i => i.id);

test('the workbench groups by urgency in urgency order, with no urgency counting as Later', () => {
  const list = items([
    '- [ ] T-0001 Later one {urg:later}',
    '- [ ] T-0002 No urgency',
    '- [ ] T-0003 Today one {urg:today}',
    '- [ ] T-0004 FYI one {urg:fyi}',
    '- [ ] T-0005 Soon one {urg:soon}',
    '- [ ] T-0006 Week one {urg:week}',
  ].join('\n'));
  const groups = C.workbench(list, { group: 'urg', sort: 'urg' });
  assert.deepEqual(groups.map(g => g.label), ['Today', 'This week', 'Soon', 'Later', 'FYI']);
  assert.deepEqual(groups.map(ids), [['T-0003'], ['T-0006'], ['T-0005'], ['T-0001', 'T-0002'], ['T-0004']]);
});

test('grouped by tag, an item shows under each of its tags, biggest group first and untagged last', () => {
  const list = items([
    '- [ ] T-0001 Untagged',
    '- [ ] T-0002 Both {tg:Lab,Audit}',
    '- [ ] T-0003 Lab only {tg:Lab}',
  ].join('\n'));
  const groups = C.workbench(list, { group: 'tag', sort: 'urg' });
  assert.deepEqual(groups.map(g => g.label), ['Lab', 'Audit', 'Untagged']);
  assert.deepEqual(groups.map(ids), [['T-0002', 'T-0003'], ['T-0002'], ['T-0001']]);
});

test('grouped by type, groups follow Task, Meeting, Process, Document, FYI, with no type counting as Task', () => {
  const list = items([
    '- [ ] T-0001 Read the spec {ty:Document}',
    '- [ ] T-0002 Standup {ty:Meeting}',
    '- [ ] T-0003 No type',
  ].join('\n'));
  const groups = C.workbench(list, { group: 'type', sort: 'urg' });
  assert.deepEqual(groups.map(g => g.label), ['Tasks', 'Meetings', 'Documents to read']);
  assert.deepEqual(groups.map(ids), [['T-0003'], ['T-0002'], ['T-0001']]);
});

test('grouped by person, no who and who:Unassigned share the Unassigned group, which comes last', () => {
  const list = items([
    '- [ ] T-0001 Nobody',
    '- [ ] T-0002 Ask Ana {who:Ana Silva}',
    '- [ ] T-0003 Legacy {who:Unassigned}',
    '- [ ] T-0004 Ask Ben {who:Ben Okoro}',
    '- [ ] T-0005 Ana again {who:Ana Silva}',
  ].join('\n'));
  const groups = C.workbench(list, { group: 'person', sort: 'urg' });
  assert.deepEqual(groups.map(g => g.label), ['Ana Silva', 'Ben Okoro', 'Unassigned']);
  assert.deepEqual(groups.map(ids), [['T-0002', 'T-0005'], ['T-0004'], ['T-0001', 'T-0003']]);
});

test('grouped by project, an item shows under each project, named by the caller, in name order and loose items last', () => {
  const list = items([
    '- [ ] T-0001 Loose',
    '- [ ] T-0002 Both {prj:PRJ-0002,PRJ-0001}',
    '- [ ] T-0003 Zeta only {prj:PRJ-0001}',
  ].join('\n'));
  const names = { 'PRJ-0001': 'Zeta rollout', 'PRJ-0002': 'Alpha › Pilot' };
  const groups = C.workbench(list, { group: 'project', sort: 'urg', prjName: id => names[id] });
  assert.deepEqual(groups.map(g => g.label), ['Alpha › Pilot', 'Zeta rollout', 'Not in a project']);
  assert.deepEqual(groups.map(g => g.key), ['PRJ-0002', 'PRJ-0001', '']);
  assert.deepEqual(groups.map(ids), [['T-0002'], ['T-0002', 'T-0003'], ['T-0001']]);
});

test('sorted by urgency: urgency, then due date, then priority, then ID', () => {
  const list = items([
    '- [ ] T-0001 Later {urg:later}',
    '- [ ] T-0002 Week, low {urg:week; p:3}',
    '- [ ] T-0003 Week, due {urg:week; due:2026-10-21}',
    '- [ ] T-0004 Week, high {urg:week; p:1}',
    '- [ ] T-0005 Today {urg:today}',
  ].join('\n'));
  const [all] = C.workbench(list, { group: 'type', sort: 'urg' });
  assert.deepEqual(ids(all), ['T-0005', 'T-0003', 'T-0004', 'T-0002', 'T-0001']);
});

test('sorted by due date: earliest first, a time after a bare date, undated last by urgency', () => {
  const list = items([
    '- [ ] T-0001 Undated, today {urg:today}',
    '- [ ] T-0002 Later date {urg:today; due:2026-11-02}',
    '- [ ] T-0003 Same day with time {due:2026-10-21 09:30}',
    '- [ ] T-0004 Same day {urg:fyi; due:2026-10-21}',
    '- [ ] T-0005 Undated, later {urg:later}',
  ].join('\n'));
  const [all] = C.workbench(list, { group: 'type', sort: 'due' });
  assert.deepEqual(ids(all), ['T-0004', 'T-0003', 'T-0002', 'T-0001', 'T-0005']);
});

test('sorted by assigned, newest or oldest first, with items never assigned last either way', () => {
  const list = items([
    '- [ ] T-0001 Never assigned',
    '- [ ] T-0002 October {asg:2026-10-02 12:00}',
    '- [ ] T-0003 September {asg:2026-09-30 08:15}',
    '- [ ] T-0004 October, later that day {asg:2026-10-02 16:40}',
  ].join('\n'));
  assert.deepEqual(ids(C.workbench(list, { group: 'type', sort: 'new' })[0]), ['T-0004', 'T-0002', 'T-0003', 'T-0001']);
  assert.deepEqual(ids(C.workbench(list, { group: 'type', sort: 'old' })[0]), ['T-0003', 'T-0002', 'T-0004', 'T-0001']);
});

test('a tag filter keeps only items carrying that exact tag', () => {
  const list = items([
    '- [ ] T-0001 Lab {tg:Lab}',
    '- [ ] T-0002 Lab work {tg:Lab work}',
    '- [ ] T-0003 Both {ty:Meeting; tg:Audit,Lab}',
    '- [ ] T-0004 None',
  ].join('\n'));
  const groups = C.workbench(list, { group: 'type', sort: 'urg', tag: 'Lab' });
  assert.deepEqual(groups.map(ids), [['T-0001'], ['T-0003']]);
});

test('search: every word must start a word somewhere in the item, and says where it matched', () => {
  const [it] = items([
    '- [ ] T-0042 Order reagents {who:Ana Silva; tg:Lab; prj:PRJ-0003}',
    '  - src: mail from Ben',
    '  - description: supplier is Fisher',
    '    usually in stock',
    '  - comment: {added-datetime: 2026-10-20 09:00; author: user}',
    '    check the cold room first',
    '  - [ ] get a quote',
  ].join('\n'));
  const prjName = id => ({ 'PRJ-0003': 'Pilot plant' })[id];
  const where = q => C.itemMatch(it, q, prjName);
  assert.equal(where('order rea'), '');
  assert.equal(where('t-0042'), '');
  assert.equal(where('ana lab'), '');
  assert.equal(where('pilot'), 'project');
  assert.equal(where('fisher'), 'the description');
  assert.equal(where('stock'), 'the description');
  assert.equal(where('cold'), 'comments');
  assert.equal(where('quote'), 'sub-tasks');
  assert.equal(where('ben'), 'the source');
  assert.equal(where('order fisher'), 'the description');
  assert.equal(where('agents'), null);
  assert.equal(where('order zebra'), null);
});

test('a text filter on the workbench keeps every matching item, with no cap, alongside the tag filter', () => {
  const lines = [];
  for (let n = 1; n <= 12; n++) lines.push(`- [ ] T-${String(n).padStart(4, '0')} Call supplier ${n} {tg:${n % 2 ? 'Lab' : 'Office'}}`);
  lines.push('- [ ] T-0013 Something else {tg:Lab}');
  const list = items(lines.join('\n'));
  const count = o => C.workbench(list, { group: 'type', sort: 'urg', ...o }).reduce((s, g) => s + g.items.length, 0);
  assert.equal(count({ q: 'supp' }), 12);
  assert.equal(count({ q: 'supp', tag: 'Lab' }), 6);
  assert.equal(count({ q: 'nothing like it' }), 0);
});

// what parseQuick hands to quick add, for a plain title with nothing else
const parsed = o => ({ title: 'Book the lab', ty: 'Task', who: '', prj: [], tags: [], p: '', date: '', time: '', ...o });
const at = { today: '2026-10-19', now: '2026-10-19 14:05' };

test('quick add: an Urgency the User picks wins over the one worked out from the due date', () => {
  const picked = C.quickItem(parsed({ date: '2026-10-20' }), { ...at, urg: 'later' });
  assert.equal(picked.meta.urg, 'later');
  assert.equal(picked.meta.due, '2026-10-20');
  const fyi = C.quickItem(parsed({ ty: 'FYI' }), { ...at, urg: 'today' });
  assert.equal(fyi.meta.urg, 'today');
});

test('quick add: the Description keeps its lines and blank lines, without the blank ones at either end', () => {
  const it = C.quickItem(parsed(), { ...at, description: '\n  Room 4 is free 9-12 on Tuesdays  \r\n\r\nAsk facilities for the key\n  ' });
  assert.equal(it.description, '  Room 4 is free 9-12 on Tuesdays\n\nAsk facilities for the key');
  assert.equal(C.quickItem(parsed(), { ...at, description: '  \n ' }).description, '');
  assert.equal(C.quickItem(parsed(), at).description, '');
});

const ITEM_TEXT = [
  '# Tasks',
  '<!-- next-id: 3 -->',
  '',
  '- [ ] T-0001 Close the CAPA {ty:Task}',
  '  - src: Email from Meera',
  '  - description: Two returns reported.',
  '    Root cause found.',
  '    ',
  '    Effectiveness check left.',
  '  - ref: mail|CAPA',
  '  - comment: {author: agent}',
  '    From before the Migration.',
  '  - comment: {added-datetime: 2026-10-22 09:12; author: email; acknowledged: no}',
  '    Meera replied: the fixture passed.',
  '  - [ ] Close it in the log',
  '- [ ] T-0002 Nothing more {ty:Task}',
  '',
  '## Changes',
  '- Relate T-0001 and T-0002 {kind: related; source: outlook-mail; received-datetime: 2026-10-22 09:14}',
  '    - why: indented like a text line, but past the heading',
  '',
].join('\n');

test('a Description and Comments carry on over the lines indented 4 spaces below them, and are written back as they were', () => {
  const m = C.parse(ITEM_TEXT), [a, b] = m.items;
  assert.equal(C.descOf(a), 'Two returns reported.\nRoot cause found.\n\nEffectiveness check left.');
  assert.deepEqual(C.commentsOf(a).map(c => [c.f, c.v]), [
    [{ author: 'agent' }, 'From before the Migration.'],
    [{ 'added-datetime': '2026-10-22 09:12', author: 'email', acknowledged: 'no' }, 'Meera replied: the fixture passed.'],
  ]);
  assert.deepEqual(C.commentsOf(a).map(C.toAck), [false, true]);
  assert.deepEqual(a.subs.map(s => s.k), ['src', 'description', 'ref', 'comment', 'comment', 'sub']);
  assert.equal(C.descOf(b), '');
  assert.equal(m.post[2], '    - why: indented like a text line, but past the heading');
  assert.equal(C.serialize(m), ITEM_TEXT);
});

test('a truly empty line inside a Description stays in it when more of it follows, and is written back as an indented one', () => {
  const m = C.parse('# Tasks\n- [ ] T-0001 A\n  - description: one\n\n    two\n\n- [ ] T-0002 B\n');
  assert.equal(C.descOf(m.items[0]), 'one\n\ntwo');
  assert.equal(C.serialize(m), '# Tasks\n- [ ] T-0001 A\n  - description: one\n    \n    two\n\n- [ ] T-0002 B\n');
});

test('setting a Description puts it after src, keeps it in place when it changes, and removes it when empty', () => {
  const [it] = C.parse('# T\n- [ ] T-0001 A\n  - link: [x](https://x)\n  - src: mail\n  - [ ] sub\n').items;
  C.setDesc(it, '\n What it is \r\nmore\n\n', C.ITEM_RANK);
  assert.deepEqual(it.subs.map(s => s.k), ['link', 'src', 'description', 'sub']);
  assert.equal(C.descOf(it), ' What it is\nmore');
  C.setDesc(it, 'Changed', C.ITEM_RANK);
  assert.deepEqual(it.subs.map(s => [s.k, s.v]).slice(1, 3), [['src', 'mail'], ['description', 'Changed']]);
  C.setDesc(it, '  ', C.ITEM_RANK);
  assert.deepEqual(it.subs.map(s => s.k), ['link', 'src', 'sub']);
});

test('a new Comment goes after the others and before sub-tasks; on a Person after their hist lines', () => {
  const m = C.parse(ITEM_TEXT), [a, b] = m.items;
  C.addComment(a, { at: '2026-10-24 10:00', author: 'user', text: 'Done:\nlogged it' }, C.ITEM_RANK);
  assert.deepEqual(a.subs.map(s => s.k), ['src', 'description', 'ref', 'comment', 'comment', 'comment', 'sub']);
  C.addComment(b, { at: '2026-10-24 10:01', author: 'email', ack: true, text: 'News' }, C.ITEM_RANK);
  assert.match(C.serialize(m), /    Meera replied: the fixture passed\.\n  - comment: \{added-datetime: 2026-10-24 10:00; author: user\}\n    Done:\n    logged it\n  - \[ \] Close it in the log\n- \[ \] T-0002 Nothing more \{ty:Task\}\n  - comment: \{added-datetime: 2026-10-24 10:01; author: email; acknowledged: no\}\n    News\n/);
  const P = C.pParse('# People\n\n## G\n- Ann {id:P-0001}\n  - description: me\n  - hist: 2026-01-01 | Job title: a → b\n');
  C.addComment(P.people[0], { at: '2026-10-24 10:00', author: 'agent', text: 'Moved team' }, C.PERSON_RANK);
  assert.deepEqual(P.people[0].subs.map(s => s.k), ['description', 'hist', 'comment']);
});

test('Comments in time order put the undated ones first, keeping the order they were written in', () => {
  const c = (at, v) => ({ k: 'comment', f: at ? { 'added-datetime': at } : {}, v });
  assert.deepEqual(C.byTime([c('2026-10-22 09:00', 'b'), c('', 'a1'), c('2026-10-21 09:00', 'x'), c('', 'a2')]).map(x => x.v), ['a1', 'a2', 'x', 'b']);
});

test('times are stamped in the timezone setting, like the helper\'s', () => {
  const sources = '# Sources\n## outlook-mail\n- timezone: Asia/Tokyo\n\n## defaults\n- timezone: Europe/London\n- page_cap: 10\n';
  assert.equal(C.tzOf(sources), 'Europe/London');
  assert.equal(C.tzOf('# Sources\n'), '');
  assert.equal(C.stampIn('Europe/London', Date.parse('2026-10-24T09:05:00Z')), '2026-10-24 10:05');
  assert.equal(C.stampIn('Europe/London', Date.parse('2026-10-26T09:05:00Z')), '2026-10-26 09:05');
  assert.match(C.stampIn('Not/A_Zone', Date.parse('2026-10-26T09:05:00Z')), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('quick add: with no Urgency picked, a due date sets it, no date means This week, and an FYI is FYI', () => {
  const urg = (q, o = {}) => C.quickItem(parsed(q), { ...at, ...o }).meta.urg;
  assert.equal(urg({ date: '2026-10-19', time: '15:00' }), 'today');
  assert.equal(urg({ date: '2026-10-15' }), 'today');
  assert.equal(urg({ date: '2026-10-26' }), 'week');
  assert.equal(urg({ date: '2026-11-02' }), 'soon');
  assert.equal(urg({ date: '2026-11-03' }), 'later');
  assert.equal(urg({}), 'week');
  assert.equal(urg({ ty: 'FYI', date: '2026-10-20' }), 'fyi');
  assert.equal(urg({ date: '2026-10-26' }, { urg: '' }), 'week');
});

test('quick add keeps its shortcuts: person, projects, tags, priority, due date and time, and when it was assigned', () => {
  const it = C.quickItem(parsed({ ty: 'Meeting', who: 'Ana Silva', prj: ['PRJ-0003'], tags: ['Lab', 'Audit'], p: '1', date: '2026-10-21', time: '09:30' }), at);
  assert.deepEqual(it.meta, { ty: 'Meeting', who: 'Ana Silva', prj: 'PRJ-0003', tg: 'Lab,Audit', urg: 'week', p: '1', due: '2026-10-21 09:30', asg: '2026-10-19 14:05' });
  assert.equal(it.title, 'Book the lab');
  assert.deepEqual(C.quickItem(parsed(), at).meta, { ty: 'Task', urg: 'week', p: '2', asg: '2026-10-19 14:05' });
});

test('a Relationships or Agent queue file the page creates starts with the starter file\'s header', () => {
  const header = file => {
    const lines = fs.readFileSync(path.join(REPO, 'new_discerny_repo', file), 'utf8').split(/\r?\n/);
    return lines.slice(0, lines.indexOf('') + 1);
  };
  assert.deepEqual(C.REL_HEAD, header('RELATIONSHIPS.md'));
  assert.deepEqual(C.ASK_HEAD, header('ASK-AGENT.md'));
});

// 2026-10-20 is a Tuesday.
test('snooze counts its step from today, not from the old due date, and keeps the time of day', () => {
  assert.equal(C.snooze('2026-10-15 14:30', 1, '2026-10-20'), '2026-10-21 14:30');
});

test('a snooze that lands on a Saturday or Sunday moves to the Monday', () => {
  assert.equal(C.snooze('2026-10-20 09:00', 3, '2026-10-22'), '2026-10-26 09:00'); // Thursday + 3 = Sunday
  assert.equal(C.snooze('2026-10-20 09:00', 1, '2026-10-23'), '2026-10-26 09:00'); // Friday + 1 = Saturday
});

test('a snooze from a weekend day counts from that day, and a due date with no time stays without one', () => {
  assert.equal(C.snooze('2026-10-20 09:00', 1, '2026-10-24'), '2026-10-26 09:00'); // Saturday + 1 = Sunday
  assert.equal(C.snooze('2026-10-20', 7, '2026-10-25'), '2026-11-02'); // Sunday + 1 week = Sunday
  assert.equal(C.snooze('2026-10-20', 28, '2026-10-24'), '2026-11-23'); // Saturday + 4 weeks = Saturday, across the clock change
});

test('a Meeting is overdue from the day after it takes place, not from its start time', () => {
  const [m] = items('- [ ] T-0001 Standup {ty:Meeting; due:2026-10-20 09:00}');
  assert.equal(C.isOverdue(m, '2026-10-20'), false);
  assert.equal(C.isOverdue(m, '2026-10-21'), true);
});

test('a Meeting stays overdue until it is marked done, and an item with no due date is never overdue', () => {
  const [open, done, undated] = items([
    '- [ ] T-0001 Standup {ty:Meeting; due:2026-10-01 09:00}',
    '- [x] T-0002 Standup {ty:Meeting; due:2026-10-01 09:00; done:2026-10-02}',
    '- [ ] T-0003 Someday',
  ].join('\n'));
  assert.equal(C.isOverdue(open, '2026-10-20'), true);
  assert.equal(C.isOverdue(done, '2026-10-20'), false);
  assert.equal(C.isOverdue(undated, '2026-10-20'), false);
});

const INBOX = [
  '# Inbox',
  '<!-- header -->',
  '',
  '- [ ] T-0050 Review the plan {ty:Task; urg:week; p:2}',
  '  - src: Email "Plan"',
  '',
  '## Changes',
  '- Relate T-0007 and T-0032 {kind: related; source: outlook-mail; received-datetime: 2026-10-22 09:14}',
  '  - why: Both chase the SCAR-031 8D report.',
  '- New person Jo Bloggs {email: jo@acme.com; company: Acme; title: Buyer; items: T-0050, T-0051; source: outlook-mail; received-datetime: 2026-10-22 09:14}',
  '  - why: Signs the mail as buyer at Acme.',
  '- Add email jo.b@acme.com to Jo Bloggs (P-0012) {source:outlook-mail; received-datetime:2026-10-22 09:14}',
  '  - why: Writes from a second address.',
  '',
].join('\n');

test('the Inbox\'s "## Changes" lines are kept apart from its Items, and written back as they were', () => {
  const m = C.parse(INBOX);
  assert.deepEqual(m.items.map(i => i.id), ['T-0050']);
  assert.deepEqual(m.items[0].subs.map(s => s.k), ['src'], 'the blank line and the Changes are not lines of the last Item');
  assert.equal(m.post[0], '## Changes');
  assert.equal(C.serialize(m), INBOX);
  const none = C.parse('# Inbox\n<!-- header -->\n\n## Changes\n- Relate T-0001 and T-0002 {kind: related}\n  - why: x\n');
  assert.deepEqual(none.items, []);
  assert.equal(C.serialize(none), '# Inbox\n<!-- header -->\n\n## Changes\n- Relate T-0001 and T-0002 {kind: related}\n  - why: x\n');
  assert.equal(C.serialize(C.parse('# Tasks\n- [ ] T-0001 A\n')), '# Tasks\n- [ ] T-0001 A\n', 'a file with no Changes is as before');
});

test('changesOf reads each kind of change Proposal, its fields, either spacing, and its why', () => {
  const cs = C.changesOf(C.parse(INBOX).post);
  assert.deepEqual(cs.map(c => c.type), ['relationship', 'person', 'email']);
  assert.deepEqual([cs[0].a, cs[0].b, cs[0].fields.kind, cs[0].why], ['T-0007', 'T-0032', 'related', 'Both chase the SCAR-031 8D report.']);
  assert.deepEqual([cs[1].name, cs[1].email, cs[1].fields.items, cs[1].fields.company], ['Jo Bloggs', 'jo@acme.com', 'T-0050, T-0051', 'Acme']);
  assert.deepEqual([cs[2].email, cs[2].name, cs[2].id, cs[2].fields.source], ['jo.b@acme.com', 'Jo Bloggs', 'P-0012', 'outlook-mail']);
  assert.deepEqual(cs.map(c => c.lines.length), [2, 2, 2]);
  assert.deepEqual(cs.map(C.changeKey), ['rel|T-0007|T-0032', 'person|jo@acme.com', 'person|jo.b@acme.com']);
  assert.equal(C.changesOf(['## Changes', '- Rename T-0001 {source: x}'])[0].type, '');
});

test('setPriority adds a Person to priority_people in "## defaults" and takes them out, leaving every other line as it was', () => {
  const src = '# Sources\n<!-- h -->\n\n## defaults\n- timezone: Europe/London\n- priority_people: P-0007, P-0010\n- page_cap: 10\n\n## outlook-mail\n- priority_people: P-0099\n';
  const on = C.setPriority(src, 'P-0012', true);
  assert.equal(on, src.replace('P-0007, P-0010', 'P-0007, P-0010, P-0012'));
  assert.equal(C.setPriority(on, 'P-0012', true), on, 'once only');
  assert.equal(C.setPriority(on, 'P-0012', false), src);
  const none = '## defaults\n- timezone: Europe/London\n\n## outlook-mail\n- watermark: x\n';
  assert.equal(C.setPriority(none, 'P-0012', true), '## defaults\n- timezone: Europe/London\n- priority_people: P-0012\n\n## outlook-mail\n- watermark: x\n');
  const list = '## defaults\r\n- priority_people:\r\n  - P-0007\r\n- page_cap: 10\r\n';
  assert.equal(C.setPriority(list, 'P-0012', true), '## defaults\r\n- priority_people:\r\n  - P-0007\r\n  - P-0012\r\n- page_cap: 10\r\n');
  assert.equal(C.setPriority(C.setPriority(list, 'P-0012', true), 'P-0012', false), list);
  assert.equal(C.setPriority('# Sources\n\n## outlook-mail\n- watermark: x\n', 'P-0012', true), '# Sources\n\n## defaults\n- priority_people: P-0012\n\n## outlook-mail\n- watermark: x\n');
});

// Merge: the duplicate folded into the Item it duplicates
const one = text => C.parse('# Tasks\n' + text + '\n').items[0];

test('a Merge keeps the higher priority, the sooner urgency and the earlier due date, and the survivor\'s title, type and who', () => {
  const s = one('- [ ] T-0001 Survivor {ty:Task; who:Ann Lee; urg:later; p:3; due:2026-11-10}');
  const d = one('- [ ] T-0002 Duplicate {ty:Document; who:Bo Chan; urg:week; p:1; due:2026-11-03 09:00; asg:2026-10-01 12:00}');
  C.mergeItem(s, d, '2026-10-24 10:00');
  assert.equal(s.id, 'T-0001');
  assert.equal(s.title, 'Survivor');
  assert.deepEqual([s.meta.ty, s.meta.who, s.meta.urg, s.meta.p, s.meta.due, s.meta.asg], ['Task', 'Ann Lee', 'week', '1', '2026-11-03 09:00', '2026-10-01 12:00']);
  const t = one('- [ ] T-0003 No one {who:Unassigned; due:2026-11-03}');
  C.mergeItem(t, one('- [ ] T-0004 Someone {who:Bo Chan; due:2026-11-03 14:00}'), '2026-10-24 10:00');
  assert.deepEqual([t.meta.who, t.meta.due], ['Bo Chan', '2026-11-03 14:00'], 'on the same day, a time is the earlier');
});

test('a Merge combines Projects, tags, Dependencies, URLs, Source keys and sub-tasks without repeats', () => {
  const s = one([
    '- [ ] T-0001 S {prj:PRJ-0001; tg:Lab; dep:T-0009,T-0002}',
    '  - src: mail',
    '  - link: [Spec](https://a.example)',
    '  - ref: mail|spec',
    '  - [ ] Draft',
    '  - [ ] Send'].join('\n'));
  const d = one([
    '- [ ] T-0002 D {prj:PRJ-0001,PRJ-0002; tg:Lab,Audit; dep:T-0009,T-0001,T-0008}',
    '  - src: teams',
    '  - link: [Spec](https://a.example)',
    '  - link: [Notes](https://b.example)',
    '  - ref: teams|chat|42',
    '  - ref: mail|spec',
    '  - [x] Draft',
    '  - [ ] Review'].join('\n'));
  C.mergeItem(s, d, '2026-10-24 10:00');
  assert.deepEqual([s.meta.prj, s.meta.tg, s.meta.dep], ['PRJ-0001,PRJ-0002', 'Lab,Audit', 'T-0009,T-0008']);
  const subs = k => s.subs.filter(b => b.k === k).map(b => k === 'sub' ? (b.x ? 'x ' : '  ') + b.v : b.v);
  assert.deepEqual(subs('src'), ['mail', 'teams']);
  assert.deepEqual(subs('link'), ['[Spec](https://a.example)', '[Notes](https://b.example)']);
  assert.deepEqual(subs('ref'), ['mail|spec', 'teams|chat|42']);
  assert.deepEqual(subs('sub'), ['x Draft', '  Send', '  Review']);
  assert.deepEqual(s.subs.map(b => b.k), ['src', 'src', 'link', 'link', 'ref', 'ref', 'comment', 'sub', 'sub', 'sub'], 'sub-lines stay in their order');
});

test('a Merge adds the duplicate\'s Description under "From <id>:", combines the Comments in time order and says so in a Comment', () => {
  const s = one([
    '- [ ] T-0001 S',
    '  - description: What it is.',
    '  - comment: {added-datetime: 2026-10-20 09:00; author: user}',
    '    Later one',
    '  - comment: {author: agent}',
    '    Undated on S'].join('\n'));
  const d = one([
    '- [ ] T-0002 D',
    '  - description: The other view.',
    '    Second line.',
    '  - comment: {author: user}',
    '    Undated on D',
    '  - comment: {added-datetime: 2026-10-18 15:30; author: email; acknowledged: no}',
    '    Reply came'].join('\n'));
  C.mergeItem(s, d, '2026-10-24 10:00');
  assert.equal(C.descOf(s), 'What it is.\n\nFrom T-0002:\nThe other view.\nSecond line.');
  const cs = C.commentsOf(s);
  assert.deepEqual(cs.map(c => c.v), ['Undated on S', 'Undated on D', 'Reply came', 'Later one', 'Merged T-0002 into this.']);
  assert.ok(C.toAck(cs[2]), 'a Comment still to acknowledge stays so');
  assert.deepEqual(cs[4].f, { 'added-datetime': '2026-10-24 10:00', author: 'user' });
  assert.match(C.serItem(s), /\n  - comment: \{added-datetime: 2026-10-24 10:00; author: user\}\n    Merged T-0002 into this\.$/);
  const bare = one('- [ ] T-0003 Bare');
  C.mergeItem(bare, one('- [ ] T-0004 D\n  - description: Only here.'), '2026-10-24 10:00');
  assert.equal(C.descOf(bare), 'From T-0004:\nOnly here.');
});

test('a Merge sets the status and Done as the rules say', () => {
  const st = (a, b) => { const s = one(a), d = one(b); C.mergeItem(s, d, '2026-10-24 10:00'); return [s.done, s.meta.st || '', s.meta.done || '']; };
  assert.deepEqual(st('- [ ] T-0001 S', '- [ ] T-0002 D {st:Waiting}'), [false, 'Waiting', '']);
  assert.deepEqual(st('- [ ] T-0001 S {st:In progress}', '- [ ] T-0002 D {st:Waiting}'), [false, 'In progress', ''], 'both set: the survivor\'s');
  assert.deepEqual(st('- [ ] T-0001 S {st:Waiting}', '- [x] T-0002 D {done:2026-10-01}'), [false, 'In progress', ''], 'one done: open and In progress');
  assert.deepEqual(st('- [x] T-0001 S {done:2026-10-02}', '- [ ] T-0002 D'), [false, 'In progress', '']);
  assert.deepEqual(st('- [x] T-0001 S {done:2026-10-02}', '- [x] T-0002 D {done:2026-10-01}'), [true, '', '2026-10-02'], 'both done: stays done');
});

test('Meetings never merge, and nothing merges with itself', () => {
  const t = one('- [ ] T-0001 A'), m = one('- [ ] T-0002 B {ty:Meeting}');
  assert.equal(C.canMerge(t, m), false);
  assert.equal(C.canMerge(m, t), false);
  assert.equal(C.canMerge(t, t), false);
  assert.equal(C.canMerge(t, one('- [x] T-0003 C {ty:FYI}')), true);
});

test('mergeRefs moves Relationships to the survivor, dropping repeats and any to itself', () => {
  const r = C.mergeRefs('rels', [
    '# Relationships',
    '- T-0001 ~ T-0009 | related',
    '- T-0002 ~ T-0009 | related',
    '- T-0001 ~ T-0002 | related',
    '- T-0002 -> SYS-0001 | concerns',
    '- T-0002 ~ T-0010 | related',
    '- T-0003 ~ T-0004 | related'], 'T-0010', 'T-0002');
  assert.deepEqual(r.lines, ['# Relationships', '- T-0001 ~ T-0009 | related', '- T-0002 ~ T-0009 | related', '- T-0001 ~ T-0002 | related', '- T-0002 -> SYS-0001 | concerns', '- T-0003 ~ T-0004 | related']);
  const m = C.mergeRefs('rels', ['- T-0001 ~ T-0009 | related', '- T-0002 ~ T-0009 | related', '- T-0001 ~ T-0002 | related', '- T-0002 -> SYS-0001 | concerns'], 'T-0001', 'T-0005');
  assert.deepEqual(m.lines, ['- T-0005 ~ T-0009 | related', '- T-0002 ~ T-0009 | related', '- T-0002 ~ T-0005 | related', '- T-0002 -> SYS-0001 | concerns'], 'each line keeps its place, the ends of ~ in order');
  const x = C.mergeRefs('rels', ['- T-0001 ~ T-0009 | related', '- T-0002 ~ T-0009 | related', '- T-0001 ~ T-0002 | related'], 'T-0002', 'T-0001');
  assert.deepEqual(x.lines, ['- T-0001 ~ T-0009 | related']);
  assert.deepEqual(x.swaps, [['- T-0002 ~ T-0009 | related', null, 1], ['- T-0001 ~ T-0002 | related', null, 2]]);
});

test('mergeRefs moves agent requests, the log and Noes to Relationships, and leaves other lines alone', () => {
  assert.deepEqual(C.mergeRefs('asks', ['# Ask', '- T-0002 | 2026-10-08 18:02 | ask about T-0002', '- T-0020 | 2026-10-08 18:03 | other'], 'T-0002', 'T-0001').lines,
    ['# Ask', '- T-0001 | 2026-10-08 18:02 | ask about T-0002', '- T-0020 | 2026-10-08 18:03 | other']);
  assert.deepEqual(C.mergeRefs('log', ['- 2026-10-06 08:41 | T-0002 | queued 2026-10-05 17:15 | a | b', '- actioned 2026-10-07 08:41 | T-0002 | queued x | c | d', '- 2026-10-06 08:41 | T-0021 | queued x | e | f'], 'T-0002', 'T-0001').lines,
    ['- 2026-10-06 08:41 | T-0001 | queued 2026-10-05 17:15 | a | b', '- actioned 2026-10-07 08:41 | T-0001 | queued x | c | d', '- 2026-10-06 08:41 | T-0021 | queued x | e | f']);
  assert.deepEqual(C.mergeRefs('ignored', [
    'mail|T-0002 thread | 2026-09-10 | newsletter',
    'rel|T-0002|T-0009 | 2026-10-01 | the user said no',
    'rel|T-0009|T-0001 | 2026-10-01 | the user said no',
    'rel|T-0001|T-0002 | 2026-10-01 | the user said no',
    'rel|T-0002|T-0007 | 2026-10-01 | the user said no'], 'T-0002', 'T-0001').lines,
    ['mail|T-0002 thread | 2026-09-10 | newsletter', 'rel|T-0009|T-0001 | 2026-10-01 | the user said no', 'rel|T-0001|T-0007 | 2026-10-01 | the user said no']);
});

const changed = (at, from, to, ack = true) => `  - comment: {added-datetime: ${at}; author: email${ack ? '; acknowledged: no' : ''}; changed: due; from: ${from}; to: ${to}}\n    moved`;

test('a field change Comment keeps an empty from or to as it is written, and reads back as the change', () => {
  const it = items('- [ ] T-0001 A {due:2026-11-06}\n' + changed('2026-10-25 09:14', '', '2026-11-06'))[0];
  const c = C.commentsOf(it)[0];
  assert.deepEqual(C.fieldChange(c), { field: 'due', from: '', to: '2026-11-06' });
  assert.equal(C.serItem(it).split('\n')[1], '  - comment: {added-datetime: 2026-10-25 09:14; author: email; acknowledged: no; changed: due; from: ; to: 2026-11-06}');
  assert.equal(C.fieldChange(C.commentsOf(items('- [ ] T-0001 A\n  - comment: {added-datetime: 2026-10-25 09:14; author: email}\n    x')[0])[0]), null);
});

test('Undo is on the latest unacknowledged change to a field only, back to the value from before the first, acknowledging them all', () => {
  const it = items(['- [ ] T-0001 A {due:2026-11-20}',
    changed('2026-10-20 09:00', '2026-10-01', '2026-10-30', false),
    changed('2026-10-25 09:00', '2026-11-06', '2026-11-20'),
    changed('2026-10-22 09:00', '2026-10-30', '2026-11-06'),
  ].join('\n'))[0];
  const [old, last, first] = C.commentsOf(it);
  assert.equal(C.changeUndo(it, old), null, 'an acknowledged change has none');
  assert.equal(C.changeUndo(it, first), null, 'an earlier change has none');
  assert.deepEqual(C.changeUndo(it, last), { field: 'due', value: '2026-10-30', which: [[2, 'moved'], [1, 'moved']] });
});

test('a Priority person Proposal parses with its P-id, and a No to one pauses them for 28 days from its date', () => {
  const [c] = C.changesOf(['## Changes', '- Make Jo Bloggs (P-0012) a Priority person {source: teams; received-datetime: 2026-10-22 09:14}', '  - why: Sent four actionable messages this week.']);
  assert.deepEqual([c.type, c.name, c.id, c.why], ['priority', 'Jo Bloggs', 'P-0012', 'Sent four actionable messages this week.']);
  assert.equal(C.changeKey(c), 'priority|P-0012');
  const ign = 'mail|x | 2026-10-01 | newsletter\npriority|P-0012 | 2026-10-01 | the user said no\n';
  assert.equal(C.priorityPaused(ign, 'P-0012', '2026-10-28'), true);
  assert.equal(C.priorityPaused(ign, 'P-0012', '2026-10-29'), false);
  assert.equal(C.priorityPaused(ign, 'P-0013', '2026-10-02'), false);
});
