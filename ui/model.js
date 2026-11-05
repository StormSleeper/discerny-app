// The model concern: app state, lookups, dates, Item and Record helpers, and search. It uses only core, reads the folder's
// contents from S.m and never changes a file or the DOM. Everything it shares is on D.model, and the rest stays private to this file.
(function () {
'use strict';

/* ===================== constants ===================== */
var EDEF = {
  PRJ: { file: 'PROJECTS.md', key: 'projects', word: 'project', Word: 'Project', types: ['project', 'workstream', 'pod'], sts: ['active', 'on hold', 'done'], pk: 'parent' },
  SYS: { file: 'SYSTEMS.md', key: 'systems', word: 'system', Word: 'System', types: ['platform', 'pipeline', 'registry', 'application', 'instrument', 'other'], sts: ['live', 'in build', 'delayed', 'retired'], pk: 'part-of' }
};
// a Record's type or status as the page shows it: the file's lowercase value with a capital first letter
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

/* ===================== small utilities ===================== */
function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
// today and now in the User's time zone, the timezone setting in SOURCES.md, so the page's stamps match the helper's
function userZone() { return S.m && S.m.settings ? tzOf(S.m.settings.text) : ''; }
function todayStr() { return stampIn(userZone(), Date.now()).slice(0, 10) || ymd(new Date()); }
function nowStamp() { var d = new Date(); return stampIn(userZone(), d.getTime()) || ymd(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } }
function lsJson(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }

/* ===================== app state ===================== */
var S = {
  m: null, ver: 0, ready: false, lost: false, moved: false, lastSync: 0, fresh: new Set(), folder: '',
  folderPath: '', folderErr: '', folderSugs: [], folderBusy: false,
  view: 'today', entity: null, sel: null, panel: false, tab: 'details',
  group: lsGet('discerny-group', 'project'), pf: 'all', pq: '', psort: 'name', pgroup: lsGet('discerny-pgroup', 'none'),
  wb: Object.assign({ group: 'urg', sort: 'urg', tag: '' }, lsJson('discerny-wb', {})), wq: '',
  qa: '', qaType: null, qaMore: false, qaUrg: '', qaDesc: '', palette: false, palQ: '', palI: 0, dialog: null,
  composer: {}, introOn: {}, subDraft: '', cmtDraft: '', cmtEdit: null, cmtEditText: '', tagDraft: '', newPrj: '', linkQ: '', linkMode: 'related', linkKind: 'All', linkDone: false, sysQ: '', suggestOn: {},
  dismissFor: null, dupFor: null, dupQ: '', mergeFor: null, mergeQ: '', snoozeFor: null, confirm: null, editAsk: null, editAskText: '', adding: null, addName: '', addGrp: '', addType: '',
  linkLabel: '', linkUrl: '', toasts: [], doneLimit: 60, copied: null, width: 0,
  gate: { mode: 'pick', msg: '' }, side: lsGet('discerny-side', 'auto'), theme: lsGet('discerny-theme', 'system')
};

/* ===================== settings ===================== */
// SETTINGS.toml as it was when the page opened the folder: a change to the file applies on the next reload. The page never writes it.
var SET = readSettings('');
function setSettings(s) { SET = s; }
function pauseDays() { return SET.values.priority['pause-days']; }

/* ===================== finding an Item or Record, whichever files hold it ===================== */
var ANY = ['tasks', 'inbox', 'done'];
function fItem(M, id) {
  id = rid(id);
  for (var a = 0; a < ANY.length; a++) {
    var k = ANY[a];
    if (!M[k]) continue;
    var items = M[k].items;
    for (var j = 0; j < items.length; j++) if (items[j].id === id) return { it: items[j], k: k, idx: j };
  }
  return null;
}
function recIn(M, id) {
  var k = kindOf(id), x = rid(id);
  if (k === 'T') { var f = fItem(M, id); return f ? { x: f.it, rank: ITEM_RANK } : null; }
  if (k === 'P') { var p = M.people.people.filter(function (q) { return q.meta.id === x; })[0]; return p ? { x: p, rank: PERSON_RANK } : null; }
  var e = EDEF[k] ? entIn(M, k, id) : null;
  return e ? { x: e, rank: ENT_RANK } : null;
}
/* IDs: an operation picks a number once and keeps it. If the files have meanwhile given that number to
   something else, the new record takes the next free number and every later change follows it (ALIAS). */
var ALIAS = {}, aliasNews = [];
function rid(id) { var n = 0; while (id && ALIAS[id] && n++ < 20) id = ALIAS[id]; return id; }
function entIn(M, kind, id) { var x = rid(id); return M[EDEF[kind].key].ents.filter(function (e) { return e.meta.id === x; })[0]; }

function idNum(id) { return parseInt(String(id).replace(/^[A-Z]+-/, ''), 10) || 0; }

/* ===================== dates (always local time) ===================== */
var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function isDay(s) { return /^\d{4}-\d{2}-\d{2}/.test(String(s || '')); }
function pd(s) { var p = String(s).slice(0, 10).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function addDays(s, n) { var d = pd(s); d.setDate(d.getDate() + n); return ymd(d); }
function addWorkdays(s, n) { var d = s, k = 0; while (k < n) { d = addDays(d, 1); var w = pd(d).getDay(); if (w !== 0 && w !== 6) k++; } return d; }
function dd(s) { return Math.round((pd(s) - pd(todayStr())) / 86400000); }
function timeOf(s) { s = String(s || ''); return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.slice(11, 16) : ''; }
function yearTail(d) { return d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''; }
function fmt(s) { if (!isDay(s)) return String(s || ''); var d = pd(s); return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + yearTail(d); }
function fmtY(s) { if (!isDay(s)) return String(s || ''); var d = pd(s); return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); }
function fmtLong(s) { var d = pd(s); return DOWL[d.getDay()] + ' ' + d.getDate() + ' ' + MONL[d.getMonth()] + yearTail(d); }
function fmtDT(s) { s = String(s || ''); if (!isDay(s)) return s; return fmt(s) + (timeOf(s) ? ', ' + timeOf(s) : ''); }
function fmtIso(iso) { var d = new Date(iso); if (isNaN(d)) return ''; return fmt(ymd(d)) + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function relDays(n) { if (n < -1) return (-n) + ' days overdue'; if (n === -1) return '1 day overdue'; if (n === 0) return 'today'; if (n === 1) return 'tomorrow'; return 'in ' + n + ' days'; }
function nextDow(di) { var cur = pd(todayStr()).getDay(); var ahead = ((di - cur + 7) % 7) || 7; return addDays(todayStr(), ahead); }
function mondayOf(s) { return addDays(s, -((pd(s).getDay() + 6) % 7)); }
function isoWeek(s) {
  var d = pd(s), t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7));
  var w1 = new Date(t.getFullYear(), 0, 4);
  return t.getFullYear() + '-W' + pad2(1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7));
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/* ===================== lookups (rebuilt whenever the model changes) ===================== */
var IX = null;
function mpush(map, k, v) { var a = map.get(k); if (!a) map.set(k, a = []); a.push(v); }
function ix() {
  if (IX && IX.ver === S.ver && IX.m === S.m) return IX;
  var m = S.m, I = { ver: S.ver, m: m, item: new Map(), where: new Map(), person: new Map(), pname: new Map(), ent: new Map(), rels: new Map(), asks: new Map(), drafts: new Map(), log: new Map(), blocks: new Map(), kids: new Map() };
  [['tasks', 'open'], ['inbox', 'inbox'], ['done', 'done']].forEach(function (p) {
    m[p[0]].items.forEach(function (i) { if (!I.item.has(i.id)) { I.item.set(i.id, i); I.where.set(i.id, p[1]); } });
  });
  m.tasks.items.forEach(function (i) { depList(i).forEach(function (d) { mpush(I.blocks, d, i); }); });
  m.people.people.forEach(function (p) { if (p.meta.id) I.person.set(p.meta.id, p); if (!I.pname.has(p.name)) I.pname.set(p.name, p); });
  ['PRJ', 'SYS'].forEach(function (kind) {
    var kindDef = EDEF[kind];
    m[kindDef.key].ents.forEach(function (e) { if (e.meta.id) I.ent.set(e.meta.id, e); });
    m[kindDef.key].ents.forEach(function (e) { if (e.meta[kindDef.pk] && e.meta[kindDef.pk] !== e.meta.id) mpush(I.kids, e.meta[kindDef.pk], e); });
  });
  m.rels.rels.forEach(function (r) {
    mpush(I.rels, r.a, { other: r.b, type: r.type, from: true, raw: r.raw });
    if (r.b !== r.a) mpush(I.rels, r.b, { other: r.a, type: r.type, from: false, raw: r.raw });
  });
  m.asks.notes.forEach(function (n) { mpush(I.asks, n.id, n); });
  m.drafts.forEach(function (d) { var id = draftId(d.name); if (id) mpush(I.drafts, id, d); });
  m.log.forEach(function (l) { mpush(I.log, l.id, l); });
  IX = I;
  return I;
}
function item(id) { return ix().item.get(id) || null; }
function whereOf(id) { return ix().where.get(id) || null; }
function personById(id) { return ix().person.get(id) || null; }
function personByName(n) { return ix().pname.get(n) || null; }
function entById(id) { return ix().ent.get(id) || null; }
function relsOf(id) { return ix().rels.get(id) || []; }
function asksFor(id) { return ix().asks.get(id) || []; }
function draftsFor(id) { return ix().drafts.get(id) || []; }
function logFor(id) { return ix().log.get(id) || []; }
function kidsOf(id) { return ix().kids.get(id) || []; }
function blocksOf(id) { return ix().blocks.get(id) || []; }
function draftId(name) { var m = /^((?:T|P|PRJ|SYS)-\d+)/.exec(String(name || '')); return m ? m[1] : null; }
function labelOf(id) {
  var k = kindOf(id);
  if (k === 'T') { var t = item(id); return t ? t.title : null; }
  if (k === 'P') { var p = personById(id); return p ? p.name : null; }
  var e = entById(id);
  return e ? e.name : null;
}
var KIND_WORD = { T: 'Task', P: 'Person', PRJ: 'Project', SYS: 'System' };
function exists(id) { return labelOf(id) !== null; }

/* ===================== item helpers ===================== */
function subVals(x, k) { return getSub(x, k).map(function (b) { return b.v; }); }
// the Description's first line, which list rows show, and the text search reads: the Description and the Comments
function firstLine(x) { return descOf(x).split('\n').filter(function (l) { return l.trim(); })[0] || ''; }
function wordsOf(x) { return [descOf(x)].concat(subVals(x, 'comment')).join(' '); }
function srcOf(x) { return subVals(x, 'origin'); }
function subsOf(x) { return getSub(x, 'sub'); }
function parseLink(v) { var m = /\[(.*?)\]\((.*?)\)/.exec(String(v || '')); return m ? { label: m[1] || m[2], url: m[2], raw: v } : { label: String(v || ''), url: '', raw: v }; }
function linksOf(x) { return getSub(x, 'link').map(function (b) { return parseLink(b.v); }); }
function safeUrl(u) { u = String(u || '').trim(); return /^(https?:|mailto:|file:)/i.test(u) ? u : ''; }
function allItems() { return S.m.tasks.items.concat(S.m.inbox.items, S.m.done.items); }
function openList() { return S.m.tasks.items; }
function isWaiting(i) { return i.meta.status === 'waiting'; }
function isNext(i) { return whereOf(i.id) === 'open' && !isWaiting(i) && i.meta.type !== 'meeting' && i.meta.type !== 'fyi'; }
function nextList() { return openList().filter(isNext); }
function inboxList() {
  return S.m.inbox.items.slice().sort(function (a, b) { var x = receivedOf(a.meta) || '9999', y = receivedOf(b.meta) || '9999'; return x < y ? -1 : (x > y ? 1 : (a.id < b.id ? -1 : 1)); });
}
function openBlockers(i) { return depList(i).filter(function (d) { return whereOf(d) === 'open'; }); }
function dependsOn(a, b, seen) {
  seen = seen || {};
  if (a === b) return true;
  if (seen[a]) return false;
  seen[a] = 1;
  var t = item(a);
  return !!t && depList(t).some(function (x) { return dependsOn(x, b, seen); });
}
function age(i) { var r = receivedOf(i.meta); return isDay(r) ? Math.max(0, -dd(r)) : 0; }
function listName(i) {
  var w = whereOf(i.id);
  if (w === 'inbox') return 'Inbox';
  if (w === 'done') return 'Done';
  if (isWaiting(i)) return 'Waiting for';
  if (i.meta.type === 'meeting') return 'Upcoming';
  if (i.meta.type === 'fyi') return 'FYI';
  return 'Next actions';
}
// the View a bare Item ID opens on: a Meeting or FYI that is also waiting goes to its own View
function homeView(i) {
  var w = whereOf(i.id);
  if (w === 'inbox') return 'inbox';
  if (w === 'done') return 'done';
  if (i.meta.type === 'meeting') return 'upcoming';
  if (i.meta.type === 'fyi') return 'fyi';
  return isWaiting(i) ? 'waiting' : 'next';
}
function srcKind(i) {
  var s = srcOf(i)[0] || '';
  if (/^Email .* sent to /.test(s)) return 'an email you sent';
  if (/^Email/.test(s)) return 'email';
  if (/^Teams/.test(s)) return 'Teams chat';
  if (/^Calendar/.test(s)) return 'a calendar invite';
  if (/^Added/.test(s)) return 'added by you';
  return 'a source';
}
function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function waitTitle(i) {
  var t = i.title.replace(/^Waiting:\s*/i, '');
  if (i.meta.who) t = t.replace(new RegExp('\\s+from\\s+' + reEsc(i.meta.who) + '$', 'i'), '');
  return t;
}
function short(name, n) {
  n = n || 28;
  var s = String(name).split(' – ')[0];
  if (s.length > n) { var cut = s.lastIndexOf(' ', n); s = s.slice(0, cut > 10 ? cut : n) + '…'; }
  return s;
}
function clip(t, n) { t = String(t || ''); if (t.length <= n) return t; var cut = t.lastIndexOf(' ', n); return t.slice(0, cut > n - 30 ? cut : n) + '…'; }
function allTags() { var o = {}; allItems().forEach(function (i) { tagsOf(i).forEach(function (t) { o[t] = 1; }); }); return Object.keys(o).sort(function (a, b) { return a.localeCompare(b); }); }
function whoLabel(i) { return isWaiting(i) ? 'Waiting on' : (i.meta.type === 'meeting' ? 'With' : 'Person'); }
function realWho(i) { var w = i.meta.who || ''; return w === 'Unassigned' ? '' : w; }
/* "When" is worked out from the due date; urgency only matters when there is none. */
var URGW = { today: ['Today, no date', 'warn', 1], 'this week': ['This week', 'soft', 2], soon: ['Soon', 'soft', 3], later: ['Later', 'soft', 5], fyi: ['FYI', 'soft', 6] };
function when(i) {
  var due = dueOf(i.meta);
  if (isDay(due)) {
    var n = dd(due), t = timeOf(due), tail = t ? ' ' + t : '';
    if (n < 0) return { label: 'Overdue ' + (-n) + 'd', tone: 'danger', bucket: 0, key: due };
    if (n === 0) return { label: 'Today' + tail, tone: 'warn', bucket: 1, key: due };
    if (n === 1) return { label: 'Tomorrow' + tail, tone: '', bucket: 2, key: due };
    return { label: fmt(due) + tail, tone: '', bucket: n <= 7 ? 2 : (n <= 14 ? 3 : 4), key: due };
  }
  var u = URGW[i.meta.urgency] || URGW.later;
  return { label: u[0], tone: u[1], bucket: u[2], key: '9999-' + u[2] };
}
function urgFor(due) { return urgForDue(due, todayStr()); }
function sortItems(list) {
  return list.slice().sort(function (a, b) {
    var wa = when(a), wb = when(b);
    return (wa.bucket - wb.bucket) || (wa.key < wb.key ? -1 : (wa.key > wb.key ? 1 : 0)) || (prioRank(a.meta.priority) - prioRank(b.meta.priority)) || (a.id < b.id ? -1 : 1);
  });
}
function sortByDue(list) { return list.slice().sort(function (a, b) { return String(dueOf(a.meta) || '9999').localeCompare(String(dueOf(b.meta) || '9999')) || (a.id < b.id ? -1 : 1); }); }
function todayItems() {
  return openList().filter(function (i) {
    var due = dueOf(i.meta);
    return i.meta.type !== 'fyi' && !isWaiting(i) && ((isDay(due) && dd(due) <= 0) || (!isDay(due) && i.meta.urgency === 'today'));
  });
}

/* ===================== people, projects and systems ===================== */
function isExt(p) { return p.meta.external === 'yes'; }
function isMe(p) { return p.meta.id === USER_ID; }
function prioOf(p) { return priorityStatus(S.m.people.people, priorityIds(S.m.settings.text), p); }
function isPrio(p) { var s = prioOf(p); return s === 'on' || s === 'manager'; }
// The Interaction scores and the review filters, worked out from the log once for each version of the model and each day.
var SCORED = null;
function scored() {
  var today = todayStr();
  if (SCORED && SCORED.ver === S.ver && SCORED.m === S.m && SCORED.today === today) return SCORED;
  var events = interactionsOf(S.m.interactions.text), scores = interactionScores(events, SET.values, today), top = 0;
  S.m.people.people.forEach(function (p) { var s = scores[p.meta.id]; if (s && scoreable(p) && s.total > top) top = s.total; });
  SCORED = { ver: S.ver, m: S.m, today: today, events: events, scores: scores, top: top, lists: reviewLists(S.m.people.people, priorityIds(S.m.settings.text), scores, SET.values) };
  return SCORED;
}
function scoreOf(p) { var s = scored().scores[p.meta.id]; return s ? s.total : 0; }
function scoreText(n) { return tenths(n).toFixed(1); }
function gaps(p) {
  if (p.meta.status === 'left') return [];
  var need = isExt(p) ? ['company', 'title'] : ['company', 'department', 'title', 'manager'];
  return need.filter(function (k) { return !p.meta[k]; });
}
var GAP_LABEL = { company: 'organisation', department: 'department', title: 'job title', manager: 'manager' };
function activePeople() { return S.m.people.people.filter(function (p) { return p.meta.status !== 'left'; }); }
function entsOf(kind) { return S.m[EDEF[kind].key].ents; }
function entDesc(id, seen) {
  seen = seen || {};
  var out = [id];
  if (seen[id]) return out;
  seen[id] = 1;
  kidsOf(id).forEach(function (c) { if (c.meta.id && !seen[c.meta.id]) out = out.concat(entDesc(c.meta.id, seen)); });
  return out;
}
function entAnc(id) {
  var out = [], kindDef = EDEF[kindOf(id)], e = entById(id), n = 0;
  while (kindDef && e && e.meta[kindDef.pk] && n++ < 20) { if (out.indexOf(e.meta[kindDef.pk]) >= 0) break; out.push(e.meta[kindDef.pk]); e = entById(e.meta[kindDef.pk]); }
  return out;
}
function entPath(id) { return entAnc(id).reverse().concat([id]).map(function (x) { var e = entById(x); return e ? e.name : x; }).join(' › '); }
function resolvePrj(t) {
  t = String(t || '').trim();
  if (!t) return null;
  var lo = t.toLowerCase(), ps = entsOf('PRJ').filter(function (p) { return p.meta.id; });
  var m = /PRJ-\d+/i.exec(t);
  if (m) { var e = entById(m[0].toUpperCase()); if (e) return e; }
  var ex = ps.filter(function (p) { return p.name.toLowerCase() === lo || entPath(p.meta.id).toLowerCase() === lo; })[0];
  if (ex) return ex;
  var part = ps.filter(function (p) { return p.name.toLowerCase().indexOf(lo) >= 0; });
  return part.length === 1 ? part[0] : null;
}
function prjItems(id) { var ids = entDesc(id); return allItems().filter(function (i) { return prjOf(i).some(function (p) { return ids.indexOf(p) >= 0; }); }); }
function sysItems(id) { return relsOf(id).filter(function (r) { return kindOf(r.other) === 'T'; }).map(function (r) { return item(r.other); }).filter(Boolean); }
function systemsOwnedBy(p) {
  var out = entsOf('SYS').filter(function (s) { return s.meta.owner === p.name; });
  if (p.meta.id) relsOf(p.meta.id).forEach(function (r) { if (r.type === 'owns' && r.from) { var s = entById(r.other); if (s && out.indexOf(s) < 0) out.push(s); } });
  return out;
}
function personOpenCount(p) {
  var ids = {};
  S.m.tasks.items.concat(S.m.inbox.items).forEach(function (i) { if (i.meta.who === p.name) ids[i.id] = 1; });
  if (p.meta.id) relsOf(p.meta.id).forEach(function (r) { if (whereOf(r.other) === 'open') ids[r.other] = 1; });
  return Object.keys(ids).length;
}
var ST_TONE = { active: 'ok', live: 'ok', 'on hold': 'warn', delayed: 'warn', 'in build': 'info', done: '', retired: '' };
var REL_WORDS = { concerns: ['Concerns', 'Concerned by'], involves: ['Involves', 'Involved in'], owns: ['Owns', 'Owned by'], uses: ['Uses', 'Used by'] };
function relWord(r) { if (r.type === 'related') return 'Related'; var m = REL_WORDS[r.type]; return m ? m[r.from ? 0 : 1] : r.type; }
function unknownWhos() {
  var known = {}, out = {}, hid = lsJson('discerny-hide-who', []);
  S.m.people.people.forEach(function (p) { known[p.name.toLowerCase()] = 1; });
  S.m.tasks.items.concat(S.m.inbox.items).forEach(function (i) {
    var w = realWho(i);
    if (w && !known[w.toLowerCase()] && hid.indexOf(w) < 0) out[w] = (out[w] || 0) + 1;
  });
  return Object.keys(out).sort().map(function (w) { return { name: w, n: out[w] }; });
}

/* ===================== Claude ===================== */
function lastRefresh() {
  var best = '';
  S.m.sources.forEach(function (s) { if (s.lastRun && s.lastRun > best) best = s.lastRun; });
  return best ? fmtIso(best) : '';
}
function lastClaudeRun() { var l = S.m.log; return l.length ? fmtDT(l[l.length - 1].at) : ''; }
var PROMPTS = {
  waiting: ['Draft a chaser', 'Summarise where this stands'],
  meeting: ['Prepare an agenda', 'Draft a pre-read email'],
  document: ['Summarise it for me', 'List questions to raise'],
  task: ['Draft a reply', 'Split into sub-tasks', 'Suggest next steps'],
  P: ['Update their details', 'Note a change of role'],
  PRJ: ['Summarise where this project stands', 'List what is blocking it'],
  SYS: ['Update the status', 'Add a note']
};
function promptsFor(id) {
  var k = kindOf(id);
  if (k !== 'T') return PROMPTS[k] || [];
  var i = item(id);
  if (!i) return [];
  if (isWaiting(i)) return PROMPTS.waiting;
  return PROMPTS[i.meta.type] || PROMPTS.task;
}

/* ===================== related-item suggestions for triage =====================
   Open tasks that share at least two unusual words with the proposal. */
var STOP = null;
function stopWords() {
  if (STOP && STOP.ver === S.ver && STOP.m === S.m) return STOP.o;
  var o = {};
  ('the and for from with that this are was were will before after into onto any all now new two one three four still needs need needed also has have had our your you they them their which what when who why how can could should would may might must not yes per via out over under more most less than then there here but about both each other same such only own just does done get got set see use used using make made wants want sent send asked ask once its week weeks today day days due by at on in of to an a is be it as or so if up no oct sep aug nov dec jan feb mar apr jun jul mon tue wed thu fri sat sun qa waiting reply seen position production fixes ahead').split(' ').forEach(function (w) { o[w] = 1; });
  S.m.people.people.forEach(function (p) { p.name.toLowerCase().split(/\s+/).forEach(function (w) { o[w] = 1; }); });
  STOP = { ver: S.ver, m: S.m, o: o };
  return o;
}
function words(text) {
  var stop = stopWords();
  return String(text).toLowerCase().replace(/[“”"'’(),.:;!?/]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 3 && !stop[w] && !/^\d+$/.test(w); });
}
function textOf(i) { return [i.title, wordsOf(i)].concat(subsOf(i).map(function (x) { return x.v; })).join(' '); }
function suggestions(i) {
  var pool = openList().filter(function (x) { return x.id !== i.id; });
  var df = {};
  pool.concat([i]).forEach(function (x) { var seen = {}; words(textOf(x)).forEach(function (w) { if (!seen[w]) { seen[w] = 1; df[w] = (df[w] || 0) + 1; } }); });
  var mine = {};
  words(textOf(i)).forEach(function (w) { mine[w] = 1; });
  var linked = {};
  relsOf(i.id).forEach(function (r) { linked[r.other] = 1; });
  depList(i).forEach(function (d) { linked[d] = 1; });
  return pool.map(function (x) {
    var score = 0, shared = [], seen = {};
    words(textOf(x)).forEach(function (w) { if (mine[w] && !seen[w] && df[w] <= 4) { seen[w] = 1; score += 1 / df[w]; shared.push(w); } });
    var same = prjOf(x).some(function (p) { return prjOf(i).indexOf(p) >= 0; });
    if (same) score += 0.25;
    return { x: x, score: score, shared: shared, same: same };
  }).filter(function (o) { return o.shared.length >= 2 && o.score >= 0.7 && !linked[o.x.id] && !relLine(i.id, o.x.id).err; })
    .sort(function (a, b) { return (b.score - a.score) || (a.x.id < b.x.id ? -1 : 1); })
    .slice(0, 2)
    .map(function (o) { return { id: o.x.id, title: o.x.title, why: 'shares ' + o.shared.slice(0, 3).join(', ') + (o.same ? ', same project' : '') }; });
}

/* ===================== quick add: one line, tokens resolved against what exists ===================== */
function cleanTitle(t) { return String(t || '').replace(/\s*[\r\n\u2028\u2029\u0085]\s*/g, ' ').replace(/[{}]/g, function (c) { return c === '{' ? '(' : ')'; }).trim(); }
function cleanName(t) { return String(t || '').replace(/[{};\r\n\u2028\u2029\u0085]/g, ' ').replace(/^\s*-\s+/, '').replace(/\s+/g, ' ').trim(); }
function parseQuick(text, typeOverride) {
  var toks = String(text).trim().split(/\s+/).filter(Boolean);
  var out = { words: [], who: '', whoNew: false, prj: [], prjNew: [], tags: [], p: '', date: '', time: '', ty: 'task' };
  var dows = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var mons = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var tags = allTags(), active = activePeople(), today = todayStr();
  for (var k = 0; k < toks.length; k++) {
    var t = toks[k], low = t.toLowerCase();
    if (t.charAt(0) === '@' && t.length > 1) {
      var base = t.slice(1).replace(/[.,;:!?]+$/, ''), b = base.toLowerCase();
      var two = toks[k + 1] ? (base + ' ' + toks[k + 1].replace(/[.,;:!?]+$/, '')).toLowerCase() : '';
      var p = two ? active.filter(function (x) { return x.name.toLowerCase() === two; })[0] : null;
      if (p) k++;
      else p = active.filter(function (x) { return x.name.toLowerCase().split(' ').indexOf(b) >= 0; })[0] || active.filter(function (x) { return x.name.toLowerCase().indexOf(b) === 0; })[0] || null;
      if (p) { out.who = p.name; out.words.push(p.name.split(' ')[0]); } else { out.who = cleanName(base); out.whoNew = true; out.words.push(base); }
      continue;
    }
    if (t.charAt(0) === '+' && t.length > 1) {
      var q = t.slice(1).toLowerCase();
      var e = entsOf('PRJ').filter(function (x) { return x.name.toLowerCase().split(/[\s–-]+/).some(function (w) { return w.indexOf(q) === 0; }); })[0] || entsOf('PRJ').filter(function (x) { return x.name.toLowerCase().indexOf(q) >= 0; })[0];
      if (e && e.meta.id) { if (out.prj.indexOf(e.meta.id) < 0) out.prj.push(e.meta.id); } else { var nm = cleanName(t.slice(1).replace(/_/g, ' ')); if (nm && out.prjNew.indexOf(nm) < 0) out.prjNew.push(nm); }
      continue;
    }
    if (t.charAt(0) === '#' && t.length > 1) {
      var tq = t.slice(1).toLowerCase();
      var tag = tags.filter(function (x) { return x.toLowerCase().indexOf(tq) === 0; })[0] || tags.filter(function (x) { return x.toLowerCase().indexOf(tq) >= 0; })[0];
      var ct = tag || cleanTag(t.slice(1).replace(/_/g, ' '));
      if (ct && out.tags.indexOf(ct) < 0) out.tags.push(ct);
      continue;
    }
    if (/^!(high|h|1|urgent)$/i.test(t)) { out.p = 'high'; continue; }
    if (/^!(low|l|3)$/i.test(t)) { out.p = 'low'; continue; }
    if (low === 'today') { out.date = today; continue; }
    if (low === 'tomorrow' || low === 'tmrw') { out.date = addDays(today, 1); continue; }
    if (/^(mon|tue|wed|thu|fri|sat|sun)(day|sday|nesday|rsday|urday)?$/.test(low)) { out.date = nextDow(dows.indexOf(low.slice(0, 3))); continue; }
    if (/^\d{1,2}:\d{2}$/.test(t) && parseInt(t, 10) < 24) { out.time = t.padStart(5, '0'); continue; }
    if (/^\d{1,2}(:\d{2})?(am|pm)$/i.test(t)) {
      var h = parseInt(t, 10) % 12, mm = /:(\d{2})/.exec(t);
      if (/pm/i.test(t)) h += 12;
      out.time = pad2(h) + ':' + (mm ? mm[1] : '00');
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { out.date = t; continue; }
    if (/^\d{1,2}$/.test(t) && toks[k + 1] && mons.indexOf(toks[k + 1].toLowerCase().slice(0, 3)) >= 0 && /^[a-z]+$/i.test(toks[k + 1])) {
      var mo = mons.indexOf(toks[k + 1].toLowerCase().slice(0, 3)), y = new Date().getFullYear();
      var cand = y + '-' + pad2(mo + 1) + '-' + pad2(parseInt(t, 10));
      if (dd(cand) < -60) cand = (y + 1) + cand.slice(4);
      out.date = cand;
      k++;
      continue;
    }
    out.words.push(t);
  }
  if (out.time && !out.date) out.date = today;
  out.title = cleanTitle(out.words.join(' '));
  var ty = 'task';
  if (/^read\b/i.test(out.title)) ty = 'document';
  if (out.time && /\b(meeting|call|1:1|review|catch-up|sync|workshop|inspection|interview|demo)\b/i.test(out.title)) ty = 'meeting';
  out.ty = typeOverride || ty;
  return out;
}
var TYPE_WORD = Object.assign({}, TYPE_NAME, { document: 'Read or review' });
var QA_TYPES = ['task', 'meeting', 'document', 'process', 'fyi'];

/* ===================== counts, review ===================== */
function counts() {
  var open = openList();
  return {
    today: todayItems().length,
    inbox: inboxCount(),
    next: nextList().length,
    waiting: open.filter(isWaiting).length,
    upcoming: open.filter(function (i) { var d = dueOf(i.meta); return isDay(d) && dd(d) > 0 && i.meta.type !== 'fyi'; }).length,
    fyi: open.filter(function (i) { return i.meta.type === 'fyi'; }).length,
    projects: entsOf('PRJ').filter(function (p) { return (p.meta.status || 'active') === 'active'; }).length,
    people: activePeople().length,
    systems: entsOf('SYS').length,
    review: reviewSteps().filter(function (x) { return x.attention && !x.done; }).length,
    done: S.m.done.items.length,
    claude: S.m.asks.notes.length
  };
}
function reviewState() {
  var wk = isoWeek(todayStr()), st = lsJson('discerny-review', null);
  if (!st || st.week !== wk) st = { week: wk, done: {} };
  return st;
}
function reviewSteps() {
  var rs = reviewState().done, open = openList();
  var inbox = S.m.inbox.items.length;
  var overdue = open.filter(function (i) { return isOverdue(i, todayStr()) && i.meta.type !== 'fyi'; }).length;
  var dueToday = todayItems().length;
  var waiting = open.filter(isWaiting), long = waiting.filter(function (i) { return age(i) >= 14; }).length;
  var active = entsOf('PRJ').filter(function (p) { return (p.meta.status || 'active') === 'active'; });
  var stuck = active.filter(function (p) { var ids = entDesc(p.meta.id); return !open.some(function (i) { return isNext(i) && prjOf(i).some(function (x) { return ids.indexOf(x) >= 0; }); }); }).length;
  var undated = nextList().filter(function (i) { return !isDay(dueOf(i.meta)) && i.meta.urgency !== 'later'; }).length;
  var fyi = open.filter(function (i) { return i.meta.type === 'fyi'; }).length;
  var gp = activePeople().filter(function (p) { return gaps(p).length; }).length;
  var asks = S.m.asks.notes.length;
  var defs = [
    ['inbox', 'Empty the inbox', 'Accept, correct or dismiss everything the agent proposed.', inbox ? inbox + ' to clarify' : 'Clear', inbox ? 'warn' : 'ok', 'Open Inbox', 'inbox'],
    ['today', 'Deal with overdue items', 'Re-date anything that slipped. Nothing should stay overdue.', overdue ? overdue + ' overdue' : 'None overdue · ' + dueToday + ' due today', overdue ? 'danger' : 'ok', 'Open Today', 'today'],
    ['waiting', 'Chase what you are waiting for', 'Anything waiting more than two weeks probably needs a nudge.', waiting.length + ' waiting · ' + long + ' over 14 days', long ? 'warn' : 'ok', 'Open Waiting for', 'waiting'],
    ['projects', 'Give every project a next action', 'A project without a next action is stuck.', stuck ? plural(stuck, 'project') + ' without a next action' : 'All ' + active.length + ' have one', stuck ? 'danger' : 'ok', 'Open Projects', 'projects'],
    ['undated', 'Date or park undated actions', 'Give each one a due date, or set it to Later to park it.', undated ? undated + ' without a date' : 'All dated or parked', undated ? 'warn' : 'ok', 'Open Next actions', 'next'],
    ['fyi', 'File the FYIs', 'Read them, then acknowledge so they leave your lists.', fyi ? fyi + ' to file' : 'Nothing to file', fyi ? 'warn' : 'ok', 'Open FYI', 'fyi'],
    ['people', 'Fill in missing people details', 'Colleagues need organisation, department, job title and manager.', gp ? gp + ' missing details' : 'All complete', gp ? 'warn' : 'ok', 'Open People', 'people-gaps'],
    ['claude', 'Clear the agent queue', 'Run discern-ask-agent so the agent works through your requests.', asks ? plural(asks, 'request') + ' queued' : 'Queue empty', asks ? 'warn' : 'ok', 'Open Agent', 'claude']
  ];
  return defs.map(function (x, k) { return { key: x[0], n: k + 1, title: x[1], help: x[2], count: x[3], tone: x[4], attention: x[4] !== 'ok', done: !!rs[x[0]], action: x[5], go: x[6] }; });
}

/* ===================== change Proposals =====================
   A Relationship with an end still in the Inbox is asked on that Item; every other change has a card of its own. */
function inboxChanges() { return changesOf(S.m.inbox.post).filter(function (c) { return c.type; }); }
function onInboxItem(c) { return c.type === 'relationship' && (whereOf(c.a) === 'inbox' || whereOf(c.b) === 'inbox'); }
function changeCards() { return inboxChanges().filter(function (c) { return !onInboxItem(c); }); }
function inboxCount() { return S.m.inbox.items.length + changeCards().length + ackItems().length; }
// the Items and Records with Comments to acknowledge: news a Skill added, waiting in the Inbox under New comments until the User acknowledges it
function ackItems() { return allItems().concat(S.m.people.people, entsOf('PRJ'), entsOf('SYS')).filter(function (x) { return commentsOf(x).some(toAck); }); }
// The calendar is the record for a Meeting it mirrors, so a change to one is made there, not undone here.
function fromCalendar(x, c) { return !!x.id && x.meta.type === 'meeting' && c.f.author === 'calendar'; }
// the latest unacknowledged change to each field, which alone shows Undo -> [{field, value, which}]
function undosOf(x) {
  var seen = {};
  return byTime(commentsOf(x)).reverse().map(function (c) {
    var u = changeUndo(x, c);
    if (!u || seen[u.field] || fromCalendar(x, c)) return null;
    seen[u.field] = 1; return u;
  }).filter(Boolean).reverse();
}
function changeByLine(line) { return inboxChanges().filter(function (c) { return c.line === line; })[0] || null; }
// the line Yes writes to RELATIONSHIPS.md, with its ends in the order it stores them
function relOf(c) { var r = relLine(c.a, c.b), m = r.line ? REL_RE.exec(r.line) : null; return m ? { line: r.line, from: m[1], to: m[3], type: m[4] } : null; }
// a Comment's text, under the field change it made, if it made one: "Due date: 30 Oct → 6 Nov"
var CHANGE_WORD = { 'due-date': 'Due date', 'due-time': 'Due time', status: 'Status', who: 'Person', title: 'Job title', company: 'Company', department: 'Department', manager: 'Reports to' };
function changeVal(field, v) {
  if (field === 'status') return STATUS_LABEL[v || ''] || v;
  if (!v) return 'none';
  if (field !== 'due-date' || !isDay(v)) return v;
  var d = pd(v); return d.getDate() + ' ' + MON[d.getMonth()] + yearTail(d) + (timeOf(v) ? ' ' + timeOf(v) : '');
}

// The Relationship Proposals with an end on this Item, which go when the Item is dismissed.
function changesOn(m, id) { return changesOf(m.post).filter(function (c) { return c.type === 'relationship' && (c.a === id || c.b === id); }); }

/* ===================== helpers for an Item or Record on screen ===================== */
function canSnooze(i) { return whereOf(i.id) === 'open' && isDay(dueOf(i.meta)) && i.meta.type !== 'meeting'; }
function prjName(id) { return entById(id) ? entPath(id) : id; }
function cur(id) { return item(id); }
// the Item or Record an ID names, and the Comment at k among its Comments
function recOf(id) { var r = recIn(S.m, id); return r ? r.x : null; }
function commentAt(id, k) { var x = recOf(id); return x ? commentsOf(x)[k] || null : null; }
function personOf(id) { return personById(id); }
function entSnapshot(id) {
  var kind = kindOf(id), kindDef = EDEF[kind], ents = entsOf(kind), e = entById(id);
  return {
    id: id, grp: e.grp, idx: ents.indexOf(e), text: eSerItem(e),
    kids: ents.filter(function (x) { return x.meta[kindDef.pk] === id; }).map(function (x) { return x.meta.id; }),
    rels: S.m.rels.rels.filter(function (r) { return r.a === id || r.b === id; }).map(function (r) { return r.raw; }),
    tasks: kind === 'PRJ' ? allItems().filter(function (i) { return prjOf(i).indexOf(id) >= 0; }).map(function (i) { return i.id; }) : []
  };
}

/* ===================== layout, from S.width ===================== */
function isRail() { return S.side === 'rail' || (S.side !== 'full' && S.width < 1440); }
function panelOpen() { return !!(S.panel && S.sel && S.m && labelOf(S.sel) !== null); }
function isDrawer() {
  var W = S.width, side = isRail() ? 56 : 232, pw = Math.min(440, Math.max(380, 0.3 * W));
  return W - side - pw < 560;
}

/* ===================== fields to clear on the next draw ===================== */
var forced = new Set();
function forceClear(id) { forced.add(id); }

/* ===================== search everything ===================== */
var CMDS = [
  ['Go to Today', 'go', 'today'], ['Go to Inbox', 'go', 'inbox'], ['Go to Next actions', 'go', 'next'], ['Go to Waiting for', 'go', 'waiting'],
  ['Go to Upcoming', 'go', 'upcoming'], ['Go to FYI', 'go', 'fyi'], ['Go to All items', 'go', 'all'], ['Go to Projects', 'go', 'projects'], ['Go to People', 'go', 'people'],
  ['Go to Systems', 'go', 'systems'], ['Start the weekly review', 'go', 'review'], ['Go to Done', 'go', 'done'], ['Open the agent queue', 'go', 'claude'],
  ['Add an item', 'cmd', 'quickadd'], ['Appearance: follow Windows', 'cmd', 'theme-system'], ['Appearance: light', 'cmd', 'theme-light'], ['Appearance: dark', 'cmd', 'theme-dark'],
  ['Sidebar: expand or collapse', 'cmd', 'side'], ['Keyboard shortcuts', 'cmd', 'keys'], ['Read the folder again', 'cmd', 'sync']
];
function searchAll(qs) {
  var words = String(qs || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  var groups = [];
  var cmds = CMDS.map(function (c) { return { label: c[0], sub: 'Command', id: '', act: c[1], arg: c[2] }; });
  if (!words.length) { groups.push({ title: 'Jump to', items: cmds.slice(0, 12) }); return groups; }
  var has = function (hay) { var toks = tokensOf(hay); return words.every(function (w) { return toks.some(function (t) { return t.indexOf(w) === 0; }); }); };
  var tasks = [];
  [['open', S.m.tasks.items], ['inbox', S.m.inbox.items], ['done', S.m.done.items]].forEach(function (src) {
    src[1].forEach(function (i) {
      var where = itemMatch(i, qs, prjName);
      if (where === null) return;
      var lab = has(i.id + ' ' + i.title);
      var bits = [listName(i)];
      if (src[0] === 'open') bits.push(when(i).label);
      if (src[0] === 'done' && i.meta['done-date']) bits.push('done ' + fmt(i.meta['done-date']));
      if (where) bits.push('matched in ' + where);
      tasks.push({ label: i.title, sub: bits.join(' · '), id: i.id, act: 'open', arg: i.id, lab: lab, rank: (src[0] === 'open' ? 0 : src[0] === 'inbox' ? 1 : 2) + (lab ? 0 : 3) });
    });
  });
  tasks.sort(function (a, b) { return a.rank - b.rank || (a.id < b.id ? -1 : 1); });
  if (tasks.length) groups.push({ title: 'Tasks', items: tasks.slice(0, 8).concat(tasks.length > 8 ? [{ label: 'Show all ' + tasks.length + ' matching items', sub: 'On All items, with inbox and done', id: '', act: 'all', arg: String(qs).trim() }] : []), more: tasks.length - 8, lab: tasks[0].lab });
  var people = S.m.people.people.filter(function (p) { return has(p.name + ' ' + Object.keys(p.meta).map(function (k) { return p.meta[k]; }).join(' ') + ' ' + p.grp + ' ' + wordsOf(p)); })
    .map(function (p) { return { label: p.name, sub: [p.meta.title, p.meta.company, p.meta.status === 'left' ? 'left' : ''].filter(Boolean).join(' · ') || 'Person', id: p.meta.id || '', act: 'person', arg: p.meta.id || '', lab: has(p.name) }; })
    .sort(function (a, b) { return (b.lab - a.lab) || a.label.localeCompare(b.label); });
  if (people.length) groups.push({ title: 'People', items: people.slice(0, 5), more: people.length - 5, lab: people[0].lab });
  var ents = entsOf('PRJ').concat(entsOf('SYS')).filter(function (e) { return e.meta.id && has(e.meta.id + ' ' + e.name + ' ' + wordsOf(e) + ' ' + linksOf(e).map(function (l) { return l.label; }).join(' ')); })
    .map(function (e) { return { label: e.name, sub: [KIND_WORD[kindOf(e.meta.id)], e.meta.type !== KIND_WORD[kindOf(e.meta.id)].toLowerCase() ? cap(e.meta.type) : '', cap(e.meta.status)].filter(Boolean).join(' · '), id: e.meta.id, act: 'ent', arg: e.meta.id, lab: has(e.meta.id + ' ' + e.name) }; })
    .sort(function (a, b) { return (b.lab - a.lab); });
  if (ents.length) groups.push({ title: 'Projects and systems', items: ents.slice(0, 5), more: ents.length - 5, lab: ents[0].lab });
  var c = cmds.filter(function (x) { return has(x.label); });
  if (c.length) groups.push({ title: 'Commands', items: c, lab: true });
  /* whichever group matched on its name or title comes first, after a Link */
  groups = groups.map(function (g, k) { return { g: g, k: k }; }).sort(function (a, b) { return (b.g.lab - a.g.lab) || (a.k - b.k); }).map(function (x) { return x.g; });
  return groups;
}
function flatResults(groups) { var out = []; groups.forEach(function (g) { g.items.forEach(function (it) { out.push(it); }); }); return out; }

// SET gets reassigned, so it's a read-only accessor; setSettings sets it.
D.model = {
  EDEF: EDEF, cap: cap,
  pad2: pad2, todayStr: todayStr, nowStamp: nowStamp, lsSet: lsSet, lsJson: lsJson,
  S: S,
  get SET() { return SET; }, setSettings: setSettings, pauseDays: pauseDays,
  ANY: ANY, fItem: fItem, recIn: recIn, ALIAS: ALIAS, aliasNews: aliasNews, rid: rid, entIn: entIn, idNum: idNum,
  MONL: MONL, isDay: isDay, pd: pd, addDays: addDays, addWorkdays: addWorkdays, dd: dd, timeOf: timeOf, fmt: fmt,
  fmtY: fmtY, fmtLong: fmtLong, fmtDT: fmtDT, relDays: relDays, mondayOf: mondayOf, isoWeek: isoWeek, plural: plural,
  ix: ix, item: item, whereOf: whereOf, personById: personById, personByName: personByName, entById: entById, relsOf: relsOf,
  asksFor: asksFor, draftsFor: draftsFor, logFor: logFor, kidsOf: kidsOf, blocksOf: blocksOf, draftId: draftId,
  labelOf: labelOf, KIND_WORD: KIND_WORD, exists: exists,
  firstLine: firstLine, wordsOf: wordsOf, srcOf: srcOf, subsOf: subsOf, linksOf: linksOf, safeUrl: safeUrl,
  allItems: allItems, openList: openList, isWaiting: isWaiting, isNext: isNext, nextList: nextList,
  inboxList: inboxList, openBlockers: openBlockers, dependsOn: dependsOn, age: age, listName: listName,
  homeView: homeView, srcKind: srcKind, reEsc: reEsc, waitTitle: waitTitle, short: short, clip: clip, allTags: allTags,
  whoLabel: whoLabel, realWho: realWho, when: when, urgFor: urgFor, sortItems: sortItems, sortByDue: sortByDue,
  isExt: isExt, isMe: isMe, prioOf: prioOf, isPrio: isPrio, scored: scored, scoreOf: scoreOf, scoreText: scoreText,
  gaps: gaps, GAP_LABEL: GAP_LABEL, activePeople: activePeople, entsOf: entsOf, entDesc: entDesc, entPath: entPath,
  resolvePrj: resolvePrj, prjItems: prjItems, sysItems: sysItems, systemsOwnedBy: systemsOwnedBy,
  personOpenCount: personOpenCount, ST_TONE: ST_TONE, relWord: relWord, unknownWhos: unknownWhos,
  lastRefresh: lastRefresh, lastClaudeRun: lastClaudeRun, promptsFor: promptsFor,
  textOf: textOf, suggestions: suggestions,
  cleanTitle: cleanTitle, cleanName: cleanName, parseQuick: parseQuick, TYPE_WORD: TYPE_WORD, QA_TYPES: QA_TYPES,
  counts: counts, reviewState: reviewState, reviewSteps: reviewSteps,
  changeCards: changeCards, inboxCount: inboxCount, ackItems: ackItems, fromCalendar: fromCalendar, undosOf: undosOf,
  changesOn: changesOn, changeByLine: changeByLine, relOf: relOf, CHANGE_WORD: CHANGE_WORD, changeVal: changeVal,
  canSnooze: canSnooze, prjName: prjName, cur: cur, recOf: recOf, commentAt: commentAt, personOf: personOf,
  entSnapshot: entSnapshot,
  isRail: isRail, panelOpen: panelOpen, isDrawer: isDrawer,
  forced: forced, forceClear: forceClear,
  searchAll: searchAll, flatResults: flatResults
};
D.files.install('folderState', function (patch) { Object.assign(S, patch); });
})();
