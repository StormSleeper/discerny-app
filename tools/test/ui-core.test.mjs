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
  const names = ['parse', 'workbench', 'itemMatch', 'quickItem', 'REL_HEAD', 'ASK_HEAD'];
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
    '  - note: supplier is Fisher',
    '  - my: check the cold room first',
    '  - [ ] get a quote',
    '  - src: mail from Ben',
  ].join('\n'));
  const prjName = id => ({ 'PRJ-0003': 'Pilot plant' })[id];
  const where = q => C.itemMatch(it, q, prjName);
  assert.equal(where('order rea'), '');
  assert.equal(where('t-0042'), '');
  assert.equal(where('ana lab'), '');
  assert.equal(where('pilot'), 'project');
  assert.equal(where('fisher'), 'notes');
  assert.equal(where('cold'), 'your notes');
  assert.equal(where('quote'), 'sub-tasks');
  assert.equal(where('ben'), 'the source');
  assert.equal(where('order fisher'), 'notes');
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

test('quick add: the Description is saved as note lines, one per non-blank line', () => {
  const it = C.quickItem(parsed(), { ...at, description: '  Room 4 is free 9-12 on Tuesdays \r\n\r\nAsk facilities for the key\n  ' });
  assert.deepEqual(it.notes, ['Room 4 is free 9-12 on Tuesdays', 'Ask facilities for the key']);
  assert.deepEqual(C.quickItem(parsed(), { ...at, description: '  \n ' }).notes, []);
  assert.deepEqual(C.quickItem(parsed(), at).notes, []);
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
