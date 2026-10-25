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
  const names = ['parse', 'serialize', 'pParse', 'pSerialize', 'eParse', 'eSerialize', 'changesOf', 'changeKey', 'setPriority', 'workbench', 'itemMatch', 'quickItem', 'snooze', 'isOverdue',
    'REL_HEAD', 'ASK_HEAD', 'DIS_HEAD', 'descOf', 'setDesc', 'commentsOf', 'toAck', 'addComment', 'byTime', 'tzOf', 'stampIn', 'ITEM_RANK', 'PERSON_RANK',
    'serItem', 'canMerge', 'mergeItem', 'mergeRefs', 'fieldChange', 'changeUndo', 'priorityPaused', 'dueOf', 'setDue', 'receivedOf',
    'aParse', 'aLine', 'logParse', 'rParse', 'relLine', 'ignoredOf', 'ignoredLine', 'addHistory'];
  const ret = '{' + names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ') + '}';
  return new Function(`'use strict';\n${html.slice(a + 8, b)}\n;return ${ret};`)();
}
const C = loadCore();

const items = text => C.parse('# Tasks\n' + text).items;
const ids = g => g.items.map(i => i.id);

test('the workbench groups by urgency in urgency order, with no urgency counting as Later', () => {
  const list = items([
    '- [ ] T-0001 Later one {urgency: later}',
    '- [ ] T-0002 No urgency',
    '- [ ] T-0003 Today one {urgency: today}',
    '- [ ] T-0004 FYI one {urgency: fyi}',
    '- [ ] T-0005 Soon one {urgency: soon}',
    '- [ ] T-0006 Week one {urgency: this week}',
  ].join('\n'));
  const groups = C.workbench(list, { group: 'urg', sort: 'urg' });
  assert.deepEqual(groups.map(g => g.label), ['Today', 'This week', 'Soon', 'Later', 'FYI']);
  assert.deepEqual(groups.map(ids), [['T-0003'], ['T-0006'], ['T-0005'], ['T-0001', 'T-0002'], ['T-0004']]);
});

test('grouped by tag, an item shows under each of its tags, biggest group first and untagged last', () => {
  const list = items([
    '- [ ] T-0001 Untagged',
    '- [ ] T-0002 Both {tags: Lab, Audit}',
    '- [ ] T-0003 Lab only {tags: Lab}',
  ].join('\n'));
  const groups = C.workbench(list, { group: 'tag', sort: 'urg' });
  assert.deepEqual(groups.map(g => g.label), ['Lab', 'Audit', 'Untagged']);
  assert.deepEqual(groups.map(ids), [['T-0002', 'T-0003'], ['T-0002'], ['T-0001']]);
});

test('grouped by type, groups follow task, meeting, process, document, fyi, with no type counting as a task', () => {
  const list = items([
    '- [ ] T-0001 Read the spec {type: document}',
    '- [ ] T-0002 Standup {type: meeting}',
    '- [ ] T-0003 No type',
  ].join('\n'));
  const groups = C.workbench(list, { group: 'type', sort: 'urg' });
  assert.deepEqual(groups.map(g => g.label), ['Tasks', 'Meetings', 'Documents to read']);
  assert.deepEqual(groups.map(ids), [['T-0003'], ['T-0002'], ['T-0001']]);
});

test('grouped by person, no who and who: Unassigned share the Unassigned group, which comes last', () => {
  const list = items([
    '- [ ] T-0001 Nobody',
    '- [ ] T-0002 Ask Ana {who: Ana Silva}',
    '- [ ] T-0003 Legacy {who: Unassigned}',
    '- [ ] T-0004 Ask Ben {who: Ben Okoro}',
    '- [ ] T-0005 Ana again {who: Ana Silva}',
  ].join('\n'));
  const groups = C.workbench(list, { group: 'person', sort: 'urg' });
  assert.deepEqual(groups.map(g => g.label), ['Ana Silva', 'Ben Okoro', 'Unassigned']);
  assert.deepEqual(groups.map(ids), [['T-0002', 'T-0005'], ['T-0004'], ['T-0001', 'T-0003']]);
});

test('grouped by project, an item shows under each project, named by the caller, in name order and loose items last', () => {
  const list = items([
    '- [ ] T-0001 Loose',
    '- [ ] T-0002 Both {projects: PRJ-0002, PRJ-0001}',
    '- [ ] T-0003 Zeta only {projects: PRJ-0001}',
  ].join('\n'));
  const names = { 'PRJ-0001': 'Zeta rollout', 'PRJ-0002': 'Alpha › Pilot' };
  const groups = C.workbench(list, { group: 'project', sort: 'urg', prjName: id => names[id] });
  assert.deepEqual(groups.map(g => g.label), ['Alpha › Pilot', 'Zeta rollout', 'Not in a project']);
  assert.deepEqual(groups.map(g => g.key), ['PRJ-0002', 'PRJ-0001', '']);
  assert.deepEqual(groups.map(ids), [['T-0002'], ['T-0002', 'T-0003'], ['T-0001']]);
});

test('sorted by urgency: urgency, then due date, then priority, then ID', () => {
  const list = items([
    '- [ ] T-0001 Later {urgency: later}',
    '- [ ] T-0002 Week, low {urgency: this week; priority: low}',
    '- [ ] T-0003 Week, due {urgency: this week; due-date: 2026-10-21}',
    '- [ ] T-0004 Week, high {urgency: this week; priority: high}',
    '- [ ] T-0005 Today {urgency: today}',
  ].join('\n'));
  const [all] = C.workbench(list, { group: 'type', sort: 'urg' });
  assert.deepEqual(ids(all), ['T-0005', 'T-0003', 'T-0004', 'T-0002', 'T-0001']);
});

test('sorted by due date: earliest first, a time after a bare date, undated last by urgency', () => {
  const list = items([
    '- [ ] T-0001 Undated, today {urgency: today}',
    '- [ ] T-0002 Later date {urgency: today; due-date: 2026-11-02}',
    '- [ ] T-0003 Same day with time {due-date: 2026-10-21; due-time: 09:30}',
    '- [ ] T-0004 Same day {urgency: fyi; due-date: 2026-10-21}',
    '- [ ] T-0005 Undated, later {urgency: later}',
  ].join('\n'));
  const [all] = C.workbench(list, { group: 'type', sort: 'due' });
  assert.deepEqual(ids(all), ['T-0004', 'T-0003', 'T-0002', 'T-0001', 'T-0005']);
});

test('sorted by when received, newest or oldest first, a day alone before that day\'s times, and items never received last either way', () => {
  const list = items([
    '- [ ] T-0001 Never received',
    '- [ ] T-0002 October {received-datetime: 2026-10-02 12:00}',
    '- [ ] T-0003 September {received-datetime: 2026-09-30 08:15}',
    '- [ ] T-0004 October, later that day {received-datetime: 2026-10-02 16:40}',
    '- [ ] T-0005 October, the day only {received-date: 2026-10-02}',
  ].join('\n'));
  assert.deepEqual(ids(C.workbench(list, { group: 'type', sort: 'new' })[0]), ['T-0004', 'T-0002', 'T-0005', 'T-0003', 'T-0001']);
  assert.deepEqual(ids(C.workbench(list, { group: 'type', sort: 'old' })[0]), ['T-0003', 'T-0005', 'T-0002', 'T-0004', 'T-0001']);
});

test('a tag filter keeps only items carrying that exact tag', () => {
  const list = items([
    '- [ ] T-0001 Lab {tags: Lab}',
    '- [ ] T-0002 Lab work {tags: Lab work}',
    '- [ ] T-0003 Both {type: meeting; tags: Audit, Lab}',
    '- [ ] T-0004 None',
  ].join('\n'));
  const groups = C.workbench(list, { group: 'type', sort: 'urg', tag: 'Lab' });
  assert.deepEqual(groups.map(ids), [['T-0001'], ['T-0003']]);
});

test('search: every word must start a word somewhere in the item, and says where it matched', () => {
  const [it] = items([
    '- [ ] T-0042 Order reagents {who: Ana Silva; tags: Lab; projects: PRJ-0003}',
    '  - origin: mail from Ben',
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
  for (let n = 1; n <= 12; n++) lines.push(`- [ ] T-${String(n).padStart(4, '0')} Call supplier ${n} {tags: ${n % 2 ? 'Lab' : 'Office'}}`);
  lines.push('- [ ] T-0013 Something else {tags: Lab}');
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
  assert.equal(picked.meta.urgency, 'later');
  assert.equal(picked.meta['due-date'], '2026-10-20');
  assert.equal(picked.meta['due-time'], undefined);
  const fyi = C.quickItem(parsed({ ty: 'FYI' }), { ...at, urg: 'today' });
  assert.equal(fyi.meta.urgency, 'today');
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
  '- [ ] T-0001 Close the CAPA {type: task}',
  '  - origin: Email from Meera',
  '  - description: Two returns reported.',
  '    Root cause found.',
  '    ',
  '    Effectiveness check left.',
  '  - source-key: mail|CAPA',
  '  - comment: {author: agent}',
  '    From before the Migration.',
  '  - comment: {added-datetime: 2026-10-22 09:12; author: email; acknowledged: no}',
  '    Meera replied: the fixture passed.',
  '  - [ ] Close it in the log',
  '- [ ] T-0002 Nothing more {type: task}',
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
  assert.deepEqual(a.subs.map(s => s.k), ['origin', 'description', 'source-key', 'comment', 'comment', 'sub']);
  assert.equal(C.descOf(b), '');
  assert.equal(m.post[2], '    - why: indented like a text line, but past the heading');
  assert.equal(C.serialize(m), ITEM_TEXT);
});

test('a truly empty line inside a Description stays in it when more of it follows, and is written back as an indented one', () => {
  const m = C.parse('# Tasks\n- [ ] T-0001 A\n  - description: one\n\n    two\n\n- [ ] T-0002 B\n');
  assert.equal(C.descOf(m.items[0]), 'one\n\ntwo');
  assert.equal(C.serialize(m), '# Tasks\n- [ ] T-0001 A\n  - description: one\n    \n    two\n\n- [ ] T-0002 B\n');
});

test('setting a Description puts it after origin, keeps it in place when it changes, and removes it when empty', () => {
  const [it] = C.parse('# T\n- [ ] T-0001 A\n  - link: [x](https://x)\n  - origin: mail\n  - [ ] sub\n').items;
  C.setDesc(it, '\n What it is \r\nmore\n\n', C.ITEM_RANK);
  assert.deepEqual(it.subs.map(s => s.k), ['link', 'origin', 'description', 'sub']);
  assert.equal(C.descOf(it), ' What it is\nmore');
  C.setDesc(it, 'Changed', C.ITEM_RANK);
  assert.deepEqual(it.subs.map(s => [s.k, s.v]).slice(1, 3), [['origin', 'mail'], ['description', 'Changed']]);
  C.setDesc(it, '  ', C.ITEM_RANK);
  assert.deepEqual(it.subs.map(s => s.k), ['link', 'origin', 'sub']);
});

test('a new Comment goes after the others and before sub-tasks; on a Person after their history lines', () => {
  const m = C.parse(ITEM_TEXT), [a, b] = m.items;
  C.addComment(a, { at: '2026-10-24 10:00', author: 'user', text: 'Done:\nlogged it' }, C.ITEM_RANK);
  assert.deepEqual(a.subs.map(s => s.k), ['origin', 'description', 'source-key', 'comment', 'comment', 'comment', 'sub']);
  C.addComment(b, { at: '2026-10-24 10:01', author: 'email', ack: true, text: 'News' }, C.ITEM_RANK);
  assert.match(C.serialize(m), /    Meera replied: the fixture passed\.\n  - comment: \{added-datetime: 2026-10-24 10:00; author: user\}\n    Done:\n    logged it\n  - \[ \] Close it in the log\n- \[ \] T-0002 Nothing more \{type: task\}\n  - comment: \{added-datetime: 2026-10-24 10:01; author: email; acknowledged: no\}\n    News\n/);
  const P = C.pParse('# People\n\n## G\n- Ann {id: P-0001}\n  - description: me\n  - history: {changed-date: 2026-01-01; changed: title}\n    a → b\n');
  C.addComment(P.people[0], { at: '2026-10-24 10:00', author: 'agent', text: 'Moved team' }, C.PERSON_RANK);
  assert.deepEqual(P.people[0].subs.map(s => s.k), ['description', 'history', 'comment']);
});

test('Comments in time order put the undated ones first, keeping the order they were written in', () => {
  const c = (at, v) => ({ k: 'comment', f: at ? { 'added-datetime': at } : {}, v });
  assert.deepEqual(C.byTime([c('2026-10-22 09:00', 'b'), c('', 'a1'), c('2026-10-21 09:00', 'x'), c('', 'a2')]).map(x => x.v), ['a1', 'a2', 'x', 'b']);
});

test('times are stamped in the timezone setting, like the helper\'s', () => {
  const sources = '# Sources\n## outlook-mail\n- timezone: Asia/Tokyo\n\n## defaults\n- timezone: Europe/London\n- page-cap: 10\n';
  assert.equal(C.tzOf(sources), 'Europe/London');
  assert.equal(C.tzOf('# Sources\n'), '');
  assert.equal(C.stampIn('Europe/London', Date.parse('2026-10-24T09:05:00Z')), '2026-10-24 10:05');
  assert.equal(C.stampIn('Europe/London', Date.parse('2026-10-26T09:05:00Z')), '2026-10-26 09:05');
  assert.match(C.stampIn('Not/A_Zone', Date.parse('2026-10-26T09:05:00Z')), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('quick add: with no Urgency picked, a due date sets it, no date means this week, and an FYI is fyi', () => {
  const urg = (q, o = {}) => C.quickItem(parsed(q), { ...at, ...o }).meta.urgency;
  assert.equal(urg({ date: '2026-10-19', time: '15:00' }), 'today');
  assert.equal(urg({ date: '2026-10-15' }), 'today');
  assert.equal(urg({ date: '2026-10-26' }), 'this week');
  assert.equal(urg({ date: '2026-11-02' }), 'soon');
  assert.equal(urg({ date: '2026-11-03' }), 'later');
  assert.equal(urg({}), 'this week');
  assert.equal(urg({ ty: 'FYI', date: '2026-10-20' }), 'fyi');
  assert.equal(urg({ date: '2026-10-26' }, { urg: '' }), 'this week');
});

test('quick add keeps its shortcuts: person, projects, tags, priority, due date and time, and when it was received', () => {
  const it = C.quickItem(parsed({ ty: 'Meeting', who: 'Ana Silva', prj: ['PRJ-0003'], tags: ['Lab', 'Audit'], p: '1', date: '2026-10-21', time: '09:30' }), at);
  assert.deepEqual(it.meta, { type: 'meeting', who: 'Ana Silva', projects: 'PRJ-0003', tags: 'Lab, Audit', urgency: 'this week', priority: 'high',
    'due-date': '2026-10-21', 'due-time': '09:30', 'received-datetime': '2026-10-19 14:05' });
  assert.equal(it.title, 'Book the lab');
  assert.deepEqual(C.quickItem(parsed(), at).meta, { type: 'task', urgency: 'this week', priority: 'medium', 'received-datetime': '2026-10-19 14:05' });
  assert.equal(C.quickItem(parsed({ p: 'low' }), at).meta.priority, 'low');
  assert.equal(C.serItem({ id: 'T-0001', done: false, title: it.title, meta: it.meta, subs: [] }),
    '- [ ] T-0001 Book the lab {type: meeting; who: Ana Silva; projects: PRJ-0003; tags: Lab, Audit; urgency: this week; priority: high; due-date: 2026-10-21; due-time: 09:30; received-datetime: 2026-10-19 14:05}');
});

test('a Relationships, Dismissed or Agent queue file the page creates starts with the starter file\'s header', () => {
  const header = file => {
    const lines = fs.readFileSync(path.join(REPO, 'new_discerny_repo', file), 'utf8').split(/\r?\n/);
    return lines.slice(0, lines.indexOf('') + 1);
  };
  assert.deepEqual(C.REL_HEAD, header('RELATIONSHIPS.md'));
  assert.deepEqual(C.ASK_HEAD, header('ASK-AGENT.md'));
  assert.deepEqual(C.DIS_HEAD, fs.readFileSync(path.join(REPO, 'new_discerny_repo', 'DISMISSED.md'), 'utf8').split(/\r?\n/));
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

test('due-date and due-time read and write as one due value, the time only beside a date', () => {
  const m = {};
  C.setDue(m, '2026-10-21 09:30');
  assert.deepEqual(m, { 'due-date': '2026-10-21', 'due-time': '09:30' });
  assert.equal(C.dueOf(m), '2026-10-21 09:30');
  C.setDue(m, '2026-10-22');
  assert.deepEqual(m, { 'due-date': '2026-10-22' });
  assert.equal(C.dueOf({ 'due-time': '09:30' }), '', 'a time alone is no due date');
  C.setDue(m, '');
  assert.deepEqual(m, {});
  assert.equal(C.receivedOf({ 'received-date': '2026-10-02' }), '2026-10-02');
  assert.equal(C.receivedOf({ 'received-datetime': '2026-10-02 09:00', 'received-date': '2026-10-01' }), '2026-10-02 09:00');
});

test('a Meeting is overdue from the day after it takes place, not from its start time', () => {
  const [m] = items('- [ ] T-0001 Standup {type: meeting; due-date: 2026-10-20; due-time: 09:00}');
  assert.equal(C.isOverdue(m, '2026-10-20'), false);
  assert.equal(C.isOverdue(m, '2026-10-21'), true);
});

test('a Meeting stays overdue until it is marked done, and an item with no due date is never overdue', () => {
  const [open, done, undated] = items([
    '- [ ] T-0001 Standup {type: meeting; due-date: 2026-10-01; due-time: 09:00}',
    '- [x] T-0002 Standup {type: meeting; due-date: 2026-10-01; due-time: 09:00; done-date: 2026-10-02}',
    '- [ ] T-0003 Someday',
  ].join('\n'));
  assert.equal(C.isOverdue(open, '2026-10-20'), true);
  assert.equal(C.isOverdue(done, '2026-10-20'), false);
  assert.equal(C.isOverdue(undated, '2026-10-20'), false);
});

test('the short field names of older Formats are unknown fields: kept as written, read as nothing', () => {
  const text = '# Tasks\n- [ ] T-0001 Old {ty:Task; urg:week; p:1; due:2026-10-01; st:Waiting; asg:2026-09-30 09:00}\n  - src: mail\n  - ref: mail|old\n';
  const [it] = C.parse(text).items;
  assert.deepEqual([it.meta.type, it.meta.urgency, it.meta.priority, C.dueOf(it.meta), it.meta.status, C.receivedOf(it.meta)], [undefined, undefined, undefined, '', undefined, '']);
  assert.equal(C.isOverdue(it, '2026-10-20'), false);
  assert.deepEqual(it.subs.map(s => s.k), ['raw', 'raw']);
  assert.equal(C.serialize(C.parse(text)), text.replace('{ty:Task; urg:week; p:1; due:2026-10-01; st:Waiting; asg:2026-09-30 09:00}', '{ty: Task; urg: week; p: 1; due: 2026-10-01; st: Waiting; asg: 2026-09-30 09:00}'));
  const [old] = C.workbench([it], { group: 'urg', sort: 'urg' });
  assert.equal(old.key, 'later', 'no urgency it can read');
});

test('an Item\'s braces keep the fields they don\'t know, after the ones they do, and read the old key:value spacing', () => {
  const [it] = items('- [ ] T-0001 A {colour: red; type: task; source: outlook-mail; priority:low}');
  assert.equal(it.meta.priority, 'low');
  assert.equal(C.serItem(it), '- [ ] T-0001 A {type: task; priority: low; colour: red; source: outlook-mail}');
});

const INBOX = [
  '# Inbox',
  '<!-- header -->',
  '',
  '- [ ] T-0050 Review the plan {type: task; urgency: this week; priority: medium}',
  '  - origin: Email "Plan"',
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
  assert.deepEqual(m.items[0].subs.map(s => s.k), ['origin'], 'the blank line and the Changes are not lines of the last Item');
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

test('setPriority adds a Person to priority-people in "## defaults" and takes them out, leaving every other line as it was', () => {
  const src = '# Sources\n<!-- h -->\n\n## defaults\n- timezone: Europe/London\n- priority-people: P-0007, P-0010\n- page-cap: 10\n\n## outlook-mail\n- priority-people: P-0099\n';
  const on = C.setPriority(src, 'P-0012', true);
  assert.equal(on, src.replace('P-0007, P-0010', 'P-0007, P-0010, P-0012'));
  assert.equal(C.setPriority(on, 'P-0012', true), on, 'once only');
  assert.equal(C.setPriority(on, 'P-0012', false), src);
  const none = '## defaults\n- timezone: Europe/London\n\n## outlook-mail\n- watermark: x\n';
  assert.equal(C.setPriority(none, 'P-0012', true), '## defaults\n- timezone: Europe/London\n- priority-people: P-0012\n\n## outlook-mail\n- watermark: x\n');
  const list = '## defaults\r\n- priority-people:\r\n  - P-0007\r\n- page-cap: 10\r\n';
  assert.equal(C.setPriority(list, 'P-0012', true), '## defaults\r\n- priority-people:\r\n  - P-0007\r\n  - P-0012\r\n- page-cap: 10\r\n');
  assert.equal(C.setPriority(C.setPriority(list, 'P-0012', true), 'P-0012', false), list);
  assert.equal(C.setPriority('# Sources\n\n## outlook-mail\n- watermark: x\n', 'P-0012', true), '# Sources\n\n## defaults\n- priority-people: P-0012\n\n## outlook-mail\n- watermark: x\n');
  const old = '## defaults\n- priority_people: P-0007\n';
  assert.equal(C.setPriority(old, 'P-0012', true), '## defaults\n- priority_people: P-0007\n- priority-people: P-0012\n', 'the old key is not read');
});

// Merge: the duplicate folded into the Item it duplicates
const one = text => C.parse('# Tasks\n' + text + '\n').items[0];

test('a Merge keeps the higher priority, the sooner urgency and the earlier due date, and the survivor\'s title, type and who', () => {
  const s = one('- [ ] T-0001 Survivor {type: task; who: Ann Lee; urgency: later; priority: low; due-date: 2026-11-10}');
  const d = one('- [ ] T-0002 Duplicate {type: document; who: Bo Chan; urgency: this week; priority: high; due-date: 2026-11-03; due-time: 09:00; received-datetime: 2026-10-01 12:00}');
  C.mergeItem(s, d, '2026-10-24 10:00');
  assert.equal(s.id, 'T-0001');
  assert.equal(s.title, 'Survivor');
  assert.deepEqual([s.meta.type, s.meta.who, s.meta.urgency, s.meta.priority, s.meta['due-date'], s.meta['due-time'], s.meta['received-datetime']],
    ['task', 'Ann Lee', 'this week', 'high', '2026-11-03', '09:00', '2026-10-01 12:00']);
  const t = one('- [ ] T-0003 No one {who: Unassigned; due-date: 2026-11-03}');
  C.mergeItem(t, one('- [ ] T-0004 Someone {who: Bo Chan; due-date: 2026-11-03; due-time: 14:00; received-date: 2026-10-02}'), '2026-10-24 10:00');
  assert.deepEqual([t.meta.who, C.dueOf(t.meta), C.receivedOf(t.meta)], ['Bo Chan', '2026-11-03 14:00', '2026-10-02'], 'on the same day, a time is the earlier');
});

test('a Merge combines Projects, tags, Dependencies, URLs, Source keys and sub-tasks without repeats', () => {
  const s = one([
    '- [ ] T-0001 S {projects: PRJ-0001; tags: Lab; dependencies: T-0009, T-0002}',
    '  - origin: mail',
    '  - link: [Spec](https://a.example)',
    '  - source-key: mail|spec',
    '  - [ ] Draft',
    '  - [ ] Send'].join('\n'));
  const d = one([
    '- [ ] T-0002 D {projects: PRJ-0001, PRJ-0002; tags: Lab, Audit; dependencies: T-0009, T-0001, T-0008}',
    '  - origin: teams',
    '  - link: [Spec](https://a.example)',
    '  - link: [Notes](https://b.example)',
    '  - source-key: teams|chat|42',
    '  - source-key: mail|spec',
    '  - [x] Draft',
    '  - [ ] Review'].join('\n'));
  C.mergeItem(s, d, '2026-10-24 10:00');
  assert.deepEqual([s.meta.projects, s.meta.tags, s.meta.dependencies], ['PRJ-0001, PRJ-0002', 'Lab, Audit', 'T-0009, T-0008']);
  const subs = k => s.subs.filter(b => b.k === k).map(b => k === 'sub' ? (b.x ? 'x ' : '  ') + b.v : b.v);
  assert.deepEqual(subs('origin'), ['mail', 'teams']);
  assert.deepEqual(subs('link'), ['[Spec](https://a.example)', '[Notes](https://b.example)']);
  assert.deepEqual(subs('source-key'), ['mail|spec', 'teams|chat|42']);
  assert.deepEqual(subs('sub'), ['x Draft', '  Send', '  Review']);
  assert.deepEqual(s.subs.map(b => b.k), ['origin', 'origin', 'link', 'link', 'source-key', 'source-key', 'comment', 'sub', 'sub', 'sub'], 'sub-lines stay in their order');
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
  const st = (a, b) => { const s = one(a), d = one(b); C.mergeItem(s, d, '2026-10-24 10:00'); return [s.done, s.meta.status || '', s.meta['done-date'] || '']; };
  assert.deepEqual(st('- [ ] T-0001 S', '- [ ] T-0002 D {status: waiting}'), [false, 'waiting', '']);
  assert.deepEqual(st('- [ ] T-0001 S {status: in progress}', '- [ ] T-0002 D {status: waiting}'), [false, 'in progress', ''], 'both set: the survivor\'s');
  assert.deepEqual(st('- [ ] T-0001 S {status: waiting}', '- [x] T-0002 D {done-date: 2026-10-01}'), [false, 'in progress', ''], 'one done: open and in progress');
  assert.deepEqual(st('- [x] T-0001 S {done-date: 2026-10-02}', '- [ ] T-0002 D'), [false, 'in progress', '']);
  assert.deepEqual(st('- [x] T-0001 S {done-date: 2026-10-02}', '- [x] T-0002 D {done-date: 2026-10-01}'), [true, '', '2026-10-02'], 'both done: stays done');
});

test('Meetings never merge, and nothing merges with itself', () => {
  const t = one('- [ ] T-0001 A'), m = one('- [ ] T-0002 B {type: meeting}');
  assert.equal(C.canMerge(t, m), false);
  assert.equal(C.canMerge(m, t), false);
  assert.equal(C.canMerge(t, t), false);
  assert.equal(C.canMerge(t, one('- [x] T-0003 C {type: fyi}')), true);
});

test('mergeRefs moves Relationships to the survivor, dropping repeats and any to itself', () => {
  const r = C.mergeRefs('rels', [
    '# Relationships',
    '- T-0001 ~ T-0009 {kind: related}',
    '- T-0002 ~ T-0009 {kind: related}',
    '- T-0001 ~ T-0002 {kind: related}',
    '- T-0002 -> SYS-0001 {kind: concerns}',
    '- T-0002 ~ T-0010 {kind: related}',
    '- T-0003 ~ T-0004 {kind: related}'], 'T-0010', 'T-0002');
  assert.deepEqual(r.lines, ['# Relationships', '- T-0001 ~ T-0009 {kind: related}', '- T-0002 ~ T-0009 {kind: related}', '- T-0001 ~ T-0002 {kind: related}', '- T-0002 -> SYS-0001 {kind: concerns}', '- T-0003 ~ T-0004 {kind: related}']);
  const m = C.mergeRefs('rels', ['- T-0001 ~ T-0009 {kind: related}', '- T-0002 ~ T-0009 {kind: related}', '- T-0001 ~ T-0002 {kind: related}', '- T-0002 -> SYS-0001 {kind: concerns}'], 'T-0001', 'T-0005');
  assert.deepEqual(m.lines, ['- T-0005 ~ T-0009 {kind: related}', '- T-0002 ~ T-0009 {kind: related}', '- T-0002 ~ T-0005 {kind: related}', '- T-0002 -> SYS-0001 {kind: concerns}'], 'each line keeps its place, the ends of ~ in order');
  const x = C.mergeRefs('rels', ['- T-0001 ~ T-0009 {kind: related}', '- T-0002 ~ T-0009 {kind: related}', '- T-0001 ~ T-0002 {kind: related}'], 'T-0002', 'T-0001');
  assert.deepEqual(x.lines, ['- T-0001 ~ T-0009 {kind: related}']);
  assert.deepEqual(x.swaps, [['- T-0002 ~ T-0009 {kind: related}', null, 1], ['- T-0001 ~ T-0002 {kind: related}', null, 2]]);
});

test('mergeRefs moves agent requests, the log and Noes to Relationships, and leaves other lines alone', () => {
  const A = C.aParse('# Ask\n- T-0002 {requested-datetime: 2026-10-08 18:02}\n    ask about T-0002\n    and more\n- T-0020 {requested-datetime: 2026-10-08 18:03}\n    other\n');
  assert.deepEqual(C.mergeRefs('asks', A.lines, 'T-0002', 'T-0001').lines,
    ['# Ask', '- T-0001 {requested-datetime: 2026-10-08 18:02}\n    ask about T-0002\n    and more', '- T-0020 {requested-datetime: 2026-10-08 18:03}\n    other']);
  const log = ['- T-0002 {requested-datetime: 2026-10-05 17:15; actioned-datetime: 2026-10-06 08:41}', '  - request: about T-0002', '  - result: b',
    '- T-0021 {requested-datetime: 2026-10-05 17:15; actioned-datetime: 2026-10-06 08:41}', '  - request: e', '  - result: f'];
  assert.deepEqual(C.mergeRefs('log', log, 'T-0002', 'T-0001').lines, ['- T-0001 {requested-datetime: 2026-10-05 17:15; actioned-datetime: 2026-10-06 08:41}', ...log.slice(1)]);
  assert.deepEqual(C.mergeRefs('ignored', [
    '- mail|T-0002 thread {ignored-date: 2026-09-10; reason: newsletter}',
    '- rel|T-0002|T-0009 {ignored-date: 2026-10-01; reason: the user said no}',
    '- rel|T-0009|T-0001 {ignored-date: 2026-10-01; reason: the user said no}',
    '- rel|T-0001|T-0002 {ignored-date: 2026-10-01; reason: the user said no}',
    '- rel|T-0002|T-0007 {ignored-date: 2026-10-01; reason: the user said no}'], 'T-0002', 'T-0001').lines,
    ['- mail|T-0002 thread {ignored-date: 2026-09-10; reason: newsletter}', '- rel|T-0009|T-0001 {ignored-date: 2026-10-01; reason: the user said no}', '- rel|T-0001|T-0007 {ignored-date: 2026-10-01; reason: the user said no}']);
});

const changed = (at, from, to, ack = true) => `  - comment: {added-datetime: ${at}; author: email${ack ? '; acknowledged: no' : ''}; changed: due-date; from: ${from}; to: ${to}}\n    moved`;

test('a field change Comment keeps an empty from or to as it is written, and reads back as the change', () => {
  const it = items('- [ ] T-0001 A {due-date: 2026-11-06}\n' + changed('2026-10-25 09:14', '', '2026-11-06'))[0];
  const c = C.commentsOf(it)[0];
  assert.deepEqual(C.fieldChange(c), { field: 'due-date', from: '', to: '2026-11-06' });
  assert.equal(C.serItem(it).split('\n')[1], '  - comment: {added-datetime: 2026-10-25 09:14; author: email; acknowledged: no; changed: due-date; from: ; to: 2026-11-06}');
  assert.equal(C.fieldChange(C.commentsOf(items('- [ ] T-0001 A\n  - comment: {added-datetime: 2026-10-25 09:14; author: email}\n    x')[0])[0]), null);
});

test('Undo is on the latest unacknowledged change to a field only, back to the value from before the first, acknowledging them all', () => {
  const it = items(['- [ ] T-0001 A {due-date: 2026-11-20}',
    changed('2026-10-20 09:00', '2026-10-01', '2026-10-30', false),
    changed('2026-10-25 09:00', '2026-11-06', '2026-11-20'),
    changed('2026-10-22 09:00', '2026-10-30', '2026-11-06'),
  ].join('\n'))[0];
  const [old, last, first] = C.commentsOf(it);
  assert.equal(C.changeUndo(it, old), null, 'an acknowledged change has none');
  assert.equal(C.changeUndo(it, first), null, 'an earlier change has none');
  assert.deepEqual(C.changeUndo(it, last), { field: 'due-date', value: '2026-10-30', which: [[2, 'moved'], [1, 'moved']] });
});

test('a Priority person Proposal parses with its P-id, and a No to one pauses them for 28 days from its ignored-date', () => {
  const [c] = C.changesOf(['## Changes', '- Make Jo Bloggs (P-0012) a Priority person {source: teams; received-datetime: 2026-10-22 09:14}', '  - why: Sent four actionable messages this week.']);
  assert.deepEqual([c.type, c.name, c.id, c.why], ['priority', 'Jo Bloggs', 'P-0012', 'Sent four actionable messages this week.']);
  assert.equal(C.changeKey(c), 'priority|P-0012');
  const ign = '- mail|x {ignored-date: 2026-10-01; reason: newsletter}\n' + C.ignoredLine('priority|P-0012', '2026-10-01', 'the user said no') + '\n';
  assert.equal(C.priorityPaused(ign, 'P-0012', '2026-10-28'), true);
  assert.equal(C.priorityPaused(ign, 'P-0012', '2026-10-29'), false);
  assert.equal(C.priorityPaused(ign, 'P-0013', '2026-10-02'), false);
  assert.equal(C.priorityPaused('priority|P-0012 | 2026-10-01 | the user said no\n', 'P-0012', '2026-10-02'), false, 'the old shape is not read');
});

// ---------------------------------------------------------------- the line shapes of the other files
test('IGNORED.md lines read their source key and fields from the final " {", and are written back that way', () => {
  const text = ['# Ignored', '<!-- header -->', '',
    '- mail|Re: {braces} and | pipes {ignored-date: 2026-10-25; reason: not actionable}',
    '- teams|19:c40e9a|* {ignored-date: 2026-10-02}',
    '- person|jo@acme.example {ignored-date: 2026-10-03; reason: the user said no; by: user}', ''].join('\n');
  const got = C.ignoredOf(text);
  assert.deepEqual(got.map(g => [g.key, g.fields]), [
    ['mail|Re: {braces} and | pipes', { 'ignored-date': '2026-10-25', reason: 'not actionable' }],
    ['teams|19:c40e9a|*', { 'ignored-date': '2026-10-02' }],
    ['person|jo@acme.example', { 'ignored-date': '2026-10-03', reason: 'the user said no', by: 'user' }]]);
  assert.deepEqual(got.map(g => g.at), [3, 4, 5]);
  assert.equal(C.ignoredLine('mail|Re: {braces} and | pipes', '2026-10-25', 'not actionable'), text.split('\n')[3]);
  assert.equal(C.ignoredLine('teams|19:c40e9a|*', '2026-10-02', ''), text.split('\n')[4]);
  assert.equal(C.ignoredLine('mail|x', '2026-10-25', 'deleted; by {user}'), '- mail|x {ignored-date: 2026-10-25; reason: deleted, by ,user,}');
  assert.deepEqual(C.ignoredOf('mail|old | 2026-10-01 | newsletter\n- notakey\n'), [], 'the old shape and a line with no scheme are not source keys');
});

test('RELATIONSHIPS.md lines read A, B and the kind from their braces, and relLine writes each kind that way', () => {
  const text = ['# Relationships', '<!-- header -->', '', '- T-0007 ~ T-0017 {kind: related}', '- T-0001 -> SYS-0002 {kind: concerns}', '- P-0003 -> SYS-0001 {source: user; kind: owns}', '- T-0002 ~ T-0003 | related', ''].join('\n');
  const R = C.rParse(text);
  assert.deepEqual(R.rels.map(r => [r.a, r.op, r.b, r.type]), [['T-0007', '~', 'T-0017', 'related'], ['T-0001', '->', 'SYS-0002', 'concerns'], ['P-0003', '->', 'SYS-0001', 'owns']]);
  assert.equal(R.lines.join('\n') + '\n', text, 'every line kept');
  assert.deepEqual(C.relLine('T-0017', 'T-0007'), { line: '- T-0007 ~ T-0017 {kind: related}' });
  assert.deepEqual(C.relLine('SYS-0002', 'T-0001'), { line: '- T-0001 -> SYS-0002 {kind: concerns}' });
  assert.deepEqual(C.relLine('T-0001', 'P-0003'), { line: '- T-0001 -> P-0003 {kind: involves}' });
  assert.deepEqual(C.relLine('PRJ-0001', 'SYS-0001'), { line: '- PRJ-0001 -> SYS-0001 {kind: uses}' });
  for (const l of ['T-0007 ~ T-0017', 'T-0001 -> SYS-0002', 'T-0001 -> P-0003', 'PRJ-0001 -> SYS-0001'].map(p => C.relLine(...p.split(/ ~ | -> /)).line))
    assert.equal(C.rParse(l).rels.length, 1, l);
});

test('a Person\'s history line is laid out like a Comment, read and written back as it was', () => {
  const text = ['# People', '<!-- header -->', '', '## QA',
    '- Meera Ilangovan {id: P-0003; company: Central Functions; department: Quality Assurance; title: QA Manager; manager: Imogen Hartley; external: no; checked-date: 2026-10-07; emails: meera@x.example, m.i@x.example; handles: milangovan}',
    '  - description: Leads EN 71 testing.',
    '  - history: {changed-date: 2026-07-08; changed: title}',
    '    Senior Quality Engineer → QA Manager',
    '  - history: {}',
    '    Joined from Feltcraft',
    '  - comment: {added-datetime: 2026-10-07 09:00; author: agent}',
    '    Checked.', ''].join('\n');
  const P = C.pParse(text), [p] = P.people;
  assert.deepEqual([p.meta.company, p.meta.department, p.meta.manager, p.meta.external, p.meta['checked-date'], p.meta.emails, p.meta.handles],
    ['Central Functions', 'Quality Assurance', 'Imogen Hartley', 'no', '2026-10-07', 'meera@x.example, m.i@x.example', 'milangovan']);
  assert.deepEqual(p.subs.map(s => [s.k, s.f, s.v]), [
    ['description', undefined, 'Leads EN 71 testing.'],
    ['history', { 'changed-date': '2026-07-08', changed: 'title' }, 'Senior Quality Engineer → QA Manager'],
    ['history', {}, 'Joined from Feltcraft'],
    ['comment', { 'added-datetime': '2026-10-07 09:00', author: 'agent' }, 'Checked.']]);
  assert.equal(C.pSerialize(P), text);
  C.addHistory(p, '2026-10-25', 'manager', 'Imogen Hartley', 'Oliver Pemberton');
  C.addHistory(p, '2026-10-25', 'emails', '', 'meera@x.example');
  assert.match(C.pSerialize(P), /    Joined from Feltcraft\n  - history: \{changed-date: 2026-10-25; changed: manager\}\n    Imogen Hartley → Oliver Pemberton\n  - history: \{changed-date: 2026-10-25; changed: emails\}\n    \(none\) → meera@x\.example\n  - comment:/);
  assert.equal(C.pParse('# People\n\n## G\n- Ann {id: P-0001}\n  - hist: 2026-01-01 | Job title: a → b\n').people[0].subs[0].k, 'raw', 'the old hist: line is not a history line');
});

test('Projects and Systems keep their fields, status among them, in order, and the fields they don\'t know', () => {
  const text = ['# Systems', '<!-- next-id: 3 -->', '', '- QualiTrack {id: SYS-0001; type: platform; owner: Imogen Hartley; status: in build; vendor: Acme}', '- Loomwise {id: SYS-0002; type: application; part-of: SYS-0001; status: live}', ''].join('\n');
  const E = C.eParse(text);
  assert.deepEqual(E.ents.map(e => [e.meta.type, e.meta.status]), [['platform', 'in build'], ['application', 'live']]);
  assert.equal(C.eSerialize(E), text);
});

test('the Agent queue reads each request with the lines below it, and aLine writes one that reads back the same', () => {
  const text = ['# Ask agent queue', '<!-- The agent queue. One entry per agent request:', '     `- <ID> {requested-datetime: YYYY-MM-DD HH:MM}`, then the request below it. -->', '',
    '- T-0025 {requested-datetime: 2026-10-15 18:02}', '    Draft an acknowledgement.', '    ', '    Under 150 words.',
    '- P-0001 {requested-date: 2026-10-11}', '    Ask me for my name.',
    '- T-0011 {requested-datetime: 2026-10-15 18:10}', ''].join('\n');
  const A = C.aParse(text);
  assert.deepEqual(A.notes.map(n => [n.id, n.ts, n.text]), [['T-0025', '2026-10-15 18:02', 'Draft an acknowledgement.\n\nUnder 150 words.'], ['P-0001', '2026-10-11', 'Ask me for my name.'], ['T-0011', '2026-10-15 18:10', '']]);
  assert.equal(A.lines.join('\n') + '\n', text, 'every line kept');
  assert.equal(A.notes[0].raw, A.lines[4], 'an entry is one element of lines, its raw');
  const line = C.aLine('T-0025', '2026-10-15 18:02', '\nDraft an acknowledgement.  \r\n\r\nUnder 150 words.\n\n');
  assert.equal(line, A.notes[0].raw);
  assert.equal(C.aLine('P-0001', '2026-10-11', 'Ask me for my name.'), A.notes[1].raw);
  assert.deepEqual(C.aParse('# Ask\n- T-0001 | 2026-10-11 09:00 | old shape\n').notes, [], 'the old shape is not read');
});

test('the Agent log reads each entry\'s ID, its times, the request and the result, each going on over lines indented 4 spaces', () => {
  const text = ['# Ask agent log', '<!-- header -->', '',
    '- T-0013 {requested-datetime: 2026-10-05 17:15; actioned-datetime: 2026-10-06 08:41}', '  - request: Add sub-tasks', '    for the KPI pack', '  - result: Added 2 sub-tasks to T-0013',
    '- P-0001 {requested-date: 2026-10-01; actioned-datetime: 2026-10-02 09:00}', '  - request: Ask me my name', '  - result: Asked', '    and updated the record', '- 2026-10-06 08:41 | T-0002 | queued x | a | b', ''].join('\n');
  const L = C.logParse(text);
  assert.deepEqual(L.map(l => [l.id, l.queued, l.at, l.note, l.did]), [
    ['T-0013', '2026-10-05 17:15', '2026-10-06 08:41', 'Add sub-tasks\nfor the KPI pack', 'Added 2 sub-tasks to T-0013'],
    ['P-0001', '2026-10-01', '2026-10-02 09:00', 'Ask me my name', 'Asked\nand updated the record']]);
  assert.equal(L[0].raw, text.split('\n').slice(3, 7).join('\n'));
});
