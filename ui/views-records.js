// The views concern, part three: Record pages, with Weekly review and Agent, from state alone.
// It uses model and links, and from files only Q and srv. It never changes state, never calls ops and never uses the DOM or fetch.
(function () {
'use strict';
var S = D.model.S;

/* ===================== people, projects and systems ===================== */
function prioMark(p) { return D.model.isPrio(p) ? D.views.badge('Priority', 'flag prio-m') : ''; }
// A row's number and bar. The bar is out of the highest score anywhere, so that a filter doesn't change what it means.
function scoreCell(p) {
  if (!scoreable(p)) return '<div class="score"></div>';
  var n = D.model.scoreOf(p), top = D.model.scored().top, pct = top ? Math.round(n / top * 100) : 0;
  return '<div class="score"><span class="sr">Interaction score </span><span class="score-n">' + D.model.scoreText(n) + '</span><span class="score-bar" aria-hidden="true"><span style="width:' + pct + '%"></span></span></div>';
}
function scoreFact(p) {
  if (!scoreable(p)) return fact('Interaction score', [fv(D.model.isMe(p) ? 'Not scored: this is you' : p.meta.status === 'left' ? 'Not scored: they have left' : 'Not scored')]);
  return fact('Interaction score', [fv(D.model.scoreText(D.model.scoreOf(p))), '<span class="hint">' + D.views.esc(scoreExplanation(D.model.scored().events, p.meta.id, D.model.SET.values, D.model.todayStr())) + '</span>']);
}
// The Promote or Demote button: locked on the User's manager, and absent on the User, on anyone with no ID and on someone who has left, unless they're still listed
function prioToggle(p, cls) {
  var s = D.model.prioOf(p), c = (cls ? cls + ' ' : '') + 'prio-t';
  if (s === 'manager') return '<button type="button" class="btn ' + c + '" aria-disabled="true" aria-label="' + D.views.esc(p.name + ' is your manager, and always counts as a Priority person') + '" title="Your manager always counts as a Priority person">' + D.views.ic('lock', 's') + 'Always</button>';
  if (s === 'user' || !p.meta.id || (s === 'off' && p.meta.status === 'left')) return '';
  var label = s === 'on' ? 'Demote ' + p.name + ', so they are no longer a Priority person' : 'Promote ' + p.name + ' to a Priority person';
  return D.views.bt(s === 'on' ? 'Demote' : 'Promote', s === 'on' ? 'demote' : 'promote', { id: p.meta.id, cls: c, attrs: ' aria-label="' + D.views.esc(label) + '" title="' + D.views.esc(label) + '"' });
}

/* ===================== knowledge pages ===================== */
function fact(k, vals) { return '<div class="fact"><div class="k">' + D.views.esc(k) + '</div><div class="v">' + vals.join('') + '</div></div>'; }
function fv(text, act, id) { return act ? D.views.lk(text, act, { id: id }) : '<span>' + D.views.esc(text) + '</span>'; }
function vAsksBox(id) {
  var a = D.model.asksFor(id);
  if (!a.length) return '';
  return '<div class="note claude"><strong>Queued for the agent</strong>' + a.map(function (n) { return '<div style="white-space:pre-line;margin-top:4px">' + D.views.esc(n.text) + '</div>'; }).join('') + '</div>';
}
function entTools(id) {
  return D.views.bt('Edit details', 'edit-ent', { id: id, icon: 'edit' }) + D.views.bt('Ask agent', 'ask-ent', { id: id, icon: 'claude' });
}
function viewProject(id) {
  var e = D.model.entById(id);
  if (!e) return missingEntity('Projects', 'projects');
  var all = D.model.prjItems(id), open = all.filter(function (i) { return D.model.whereOf(i.id) === 'open'; });
  var dated = D.model.sortByDue(open.filter(function (i) { var d = dueOf(i.meta); return D.model.isDay(d) && D.model.dd(d) >= 0; }));
  var meeting = dated.filter(function (i) { return i.meta.type === 'meeting'; })[0];
  var people = [];
  all.filter(function (i) { return D.model.whereOf(i.id) !== 'done'; }).forEach(function (i) { var w = D.model.realWho(i); if (w && people.indexOf(w) < 0) people.push(w); });
  var uses = D.model.relsOf(id).filter(function (r) { return kindOf(r.other) === 'SYS'; }).map(function (r) { return r.other; });
  var hasNext = open.some(D.model.isNext), blocked = open.filter(function (i) { return D.model.openBlockers(i).length; }).length;
  var st = e.meta.status || 'active';
  var pills = D.views.badge(D.model.cap(st), D.model.ST_TONE[st]) + D.views.badge(D.model.cap(e.meta.type || 'project')) + (hasNext ? D.views.badge('Has a next action', 'ok') : D.views.badge('No next action', 'danger')) + (blocked ? D.views.badge(blocked + ' waiting on a dependency', 'danger') : '') + '<span class="sp">' + D.views.copyId(id) + '</span>';
  var parent = e.meta.parent ? D.model.entById(e.meta.parent) : null, kids = D.model.kidsOf(id);
  var facts = fact('Next date', [dated[0] ? fv(D.model.when(dated[0]).label + ', ' + dated[0].title, 'open', dated[0].id) : fv('Nothing dated')]) +
    fact('Key meeting', [meeting ? fv(D.model.when(meeting).label + ', ' + meeting.title, 'open', meeting.id) : fv('None scheduled')]) +
    fact('People involved', people.length ? people.map(function (n) { var p = D.model.personByName(n); return p && p.meta.id ? fv(n, 'person', p.meta.id) : fv(n); }) : [fv('Nobody yet')]) +
    fact('Uses', uses.length ? uses.map(function (x) { return fv(D.model.labelOf(x) || x, 'ent', x); }) : [fv('No systems related')]);
  if (parent) facts += fact('Part of', [fv(parent.name, 'ent', parent.meta.id)]);
  if (kids.length) facts += fact('Sub-projects', kids.map(function (k) { return fv(k.name, 'ent', k.meta.id); }));
  var ls = D.model.linksOf(e);
  var box = '<div class="entity" data-k="entity"><div class="pills">' + pills + '</div>' + D.views.vDescText(e) +
    '<div class="facts">' + facts + '</div>' + (ls.length ? '<div class="links">' + ls.map(D.views.linkA).join('') + '</div>' : '') + vAsksBox(id) + '</div>';
  var row = function (l, o) { return D.views.rowsOf(l, Object.assign({ hideProject: !kids.length }, o || {})); };
  var b = D.views.vSec('pn', 'Next actions', row(D.model.sortItems(open.filter(D.model.isNext))), { empty: 'No next action. This project is stuck until you add one.' });
  var w = open.filter(D.model.isWaiting);
  if (w.length) b += D.views.vSec('pw', 'Waiting for', row(w, { waiting: true }));
  var m = D.model.sortByDue(open.filter(function (i) { return i.meta.type === 'meeting' && !D.model.isWaiting(i); }));
  if (m.length) b += D.views.vSec('pm', 'Meetings', row(m, { timeFirst: true }));
  var f = open.filter(function (i) { return i.meta.type === 'fyi' && !D.model.isWaiting(i); });
  if (f.length) b += D.views.vSec('pf', 'FYI', row(f));
  var inb = all.filter(function (i) { return D.model.whereOf(i.id) === 'inbox'; });
  if (inb.length) b += D.views.vSec('pi', 'In your inbox', row(inb));
  var dn = all.filter(function (i) { return D.model.whereOf(i.id) === 'done'; });
  if (dn.length) b += D.views.vSec('pd', 'Done', row(dn));
  return { title: e.name, sub: [D.model.cap(e.meta.type || 'project'), parent ? 'part of ' + D.model.entPath(parent.meta.id) : ''].filter(Boolean).join(' · '), crumb: ['Projects', 'projects'], tools: entTools(id), body: box + '<div class="list">' + b + '</div>' };
}
function viewSystem(id) {
  var e = D.model.entById(id);
  if (!e) return missingEntity('Systems', 'systems');
  var owner = e.meta.owner ? D.model.personByName(e.meta.owner) : null;
  var parent = e.meta['part-of'] ? D.model.entById(e.meta['part-of']) : null;
  var parts = D.model.kidsOf(id);
  var projects = D.model.relsOf(id).filter(function (r) { return kindOf(r.other) === 'PRJ'; }).map(function (r) { return r.other; });
  var owners = D.model.relsOf(id).filter(function (r) { return r.type === 'owns' && kindOf(r.other) === 'P'; }).map(function (r) { return r.other; }).filter(function (pid) { var p = D.model.personById(pid); return !(p && owner && p === owner); });
  var st = e.meta.status || '';
  var facts = fact('Owner', [owner && owner.meta.id ? fv(owner.name, 'person', owner.meta.id) : fv(e.meta.owner || 'Not set')].concat(owners.map(function (x) { return fv((D.model.labelOf(x) || x) + ' (related)', 'person', x); }))) +
    fact('Part of', [parent ? fv(parent.name, 'ent', parent.meta.id) : fv('Stands alone')]) +
    fact('Parts', parts.length ? parts.map(function (x) { return fv(x.name, 'ent', x.meta.id); }) : [fv('None')]) +
    fact('Used by', projects.length ? projects.map(function (x) { return fv(D.model.labelOf(x) || x, 'ent', x); }) : [fv('No projects related')]);
  var ls = D.model.linksOf(e);
  var box = '<div class="entity" data-k="entity"><div class="pills">' + (st ? D.views.badge(D.model.cap(st), D.model.ST_TONE[st]) : D.views.badge('No status', 'soft')) + D.views.badge(D.model.cap(e.meta.type) || 'System') + '<span class="sp">' + D.views.copyId(id) + '</span></div>' +
    D.views.vDescText(e) + '<div class="facts">' + facts + '</div>' +
    (ls.length ? '<div class="links">' + ls.map(D.views.linkA).join('') + '</div>' : '') + vAsksBox(id) + '</div>';
  var items = D.model.sysItems(id);
  var b = D.views.vSec('so', 'Open items about this system', D.views.rowsOf(D.model.sortItems(items.filter(function (i) { return D.model.whereOf(i.id) === 'open'; }))), { empty: 'Nothing open about this system.' });
  var inb = items.filter(function (i) { return D.model.whereOf(i.id) === 'inbox'; });
  if (inb.length) b += D.views.vSec('si', 'In your inbox', D.views.rowsOf(inb));
  var dn = items.filter(function (i) { return D.model.whereOf(i.id) === 'done'; });
  if (dn.length) b += D.views.vSec('sd', 'Done', D.views.rowsOf(dn));
  return { title: e.name, sub: [D.model.cap(e.meta.type), e.meta.owner ? 'owned by ' + e.meta.owner : ''].filter(Boolean).join(' · '), crumb: ['Systems', 'systems'], tools: entTools(id), body: box + '<div class="list">' + b + '</div>' };
}
function viewPerson(id) {
  var p = D.model.personById(id);
  if (!p) return missingEntity('People', 'people');
  var chain = [], cur = p, guard = 0;
  while (cur && cur.meta.manager && guard++ < 6) {
    var m = D.model.personByName(cur.meta.manager);
    chain.push(m && m.meta.id ? fv(m.name + (D.model.isMe(m) ? ' (you)' : ''), 'person', m.meta.id) : fv(cur.meta.manager));
    if (m === p) break;
    cur = m;
  }
  var reports = S.m.people.people.filter(function (x) { return x.meta.manager === p.name && x.meta.status !== 'left'; });
  var owns = D.model.systemsOwnedBy(p), g = D.model.gaps(p);
  var pills = prioMark(p) + (D.model.isExt(p) ? D.views.badge('External', 'info') : '') + (p.meta.status === 'left' ? D.views.badge('Left') : '') +
    (g.length ? D.views.badge('Missing ' + g.map(function (k) { return D.model.GAP_LABEL[k]; }).join(', '), 'warn') : (p.meta.status === 'left' ? '' : D.views.badge('Details complete', 'ok'))) + (p.grp ? D.views.badge(p.grp, 'soft') : '') + '<span class="sp">' + D.views.copyId(id) + '</span>';
  var facts = fact('Organisation', [fv([p.meta.company, p.meta.department].filter(Boolean).join(' › ') || 'Not set')]) +
    fact('Reports to', chain.length ? chain : [fv(D.model.isExt(p) ? 'External' : 'Not set')]) +
    fact('Direct reports', reports.length ? reports.map(function (x) { return fv(x.name, x.meta.id ? 'person' : '', x.meta.id); }) : [fv('None')]) +
    fact('Owns', owns.length ? owns.map(function (x) { return fv(x.name, 'ent', x.meta.id); }) : [fv('No systems')]) +
    fact('Last checked', [fv(p.meta['checked-date'] ? D.model.fmtY(p.meta['checked-date']) : 'Never')]) + scoreFact(p);
  var hist = getSub(p, 'history');
  var box = '<div class="entity" data-k="entity"><div class="pills">' + pills + '</div>' + D.views.vDescText(p) +
    '<div class="facts">' + facts + '</div>' + vAsksBox(id) +
    (hist.length ? '<div><div class="h3">Change history</div>' + hist.map(function (h) { return '<div class="hint">' + D.views.esc(histText(h)) + '</div>'; }).join('') + '</div>' : '') + '</div>';
  var name = p.name, first = name.split(' ')[0];
  var all = D.model.allItems(), theirs = all.filter(function (i) { return i.meta.who === name; });
  var open = theirs.filter(function (i) { return D.model.whereOf(i.id) === 'open'; });
  var b = D.views.vSec('po', 'Open with ' + first, D.views.rowsOf(D.model.sortItems(open.filter(function (i) { return !D.model.isWaiting(i) && i.meta.type !== 'meeting'; })), { hidePerson: true }), { empty: 'Nothing open with ' + first + '.' });
  var waiting = theirs.filter(function (i) { return D.model.isWaiting(i) && D.model.whereOf(i.id) !== 'done'; });
  if (waiting.length) b += D.views.vSec('pw', 'Waiting on ' + first, waiting.map(function (i) { return D.views.vRow(i, { hidePerson: true, waiting: D.model.whereOf(i.id) === 'open' }); }));
  var meetings = D.model.sortByDue(open.filter(function (i) { return i.meta.type === 'meeting' && !D.model.isWaiting(i); }));
  if (meetings.length) b += D.views.vSec('pm', 'Meetings with ' + first, D.views.rowsOf(meetings, { hidePerson: true, timeFirst: true }));
  var inbox = theirs.filter(function (i) { return D.model.whereOf(i.id) === 'inbox' && !D.model.isWaiting(i); });
  if (inbox.length) b += D.views.vSec('pi', 'In your inbox', D.views.rowsOf(inbox, { hidePerson: true }));
  var linked = D.model.relsOf(id).filter(function (r) { return kindOf(r.other) === 'T'; }).map(function (r) { return D.model.item(r.other); }).filter(function (i) { return i && D.model.whereOf(i.id) === 'open' && i.meta.who !== name; });
  if (linked.length) b += D.views.vSec('pl', 'Related to ' + first, D.views.rowsOf(linked));
  var shown = {};
  theirs.concat(linked).forEach(function (i) { shown[i.id] = 1; });
  var re = new RegExp('\\b' + D.model.reEsc(first) + '\\b');
  var mentioned = D.model.openList().filter(function (i) { return !shown[i.id] && re.test(D.model.textOf(i)); });
  if (mentioned.length) b += D.views.vSec('pmn', 'Mentioned in', D.views.rowsOf(mentioned), { hint: 'name appears in notes or sub-tasks' });
  var dn = theirs.filter(function (i) { return D.model.whereOf(i.id) === 'done'; });
  if (dn.length) b += D.views.vSec('pd', 'Done with ' + first, D.views.rowsOf(dn, { hidePerson: true }));
  var tools = prioToggle(p) + entTools(id) + (p.meta.status === 'left' ? '' : D.views.bt('Mark details checked', 'check-person', { id: id, icon: 'check' }));
  return { title: name + (D.model.isMe(p) ? ' (you)' : ''), sub: [p.meta.title, [p.meta.company, p.meta.department].filter(Boolean).join(' › ')].filter(Boolean).join(' · '), crumb: ['People', 'people'], tools: tools, body: box + '<div class="list">' + b + '</div>' };
}
// a history line as the page shows it: "Mon 6 Oct 2026: Job title: Buyer → Senior buyer"
function histText(h) { var f = h.f || {}, d = f['changed-date'], w = f.changed ? (PLABEL[f.changed] || f.changed) + ': ' : ''; return (D.model.isDay(d) ? D.model.fmtY(d) + ': ' : '') + w + nl(h.v).replace(/\n/g, ' '); }
function missingEntity(label, view) {
  return { title: 'Not found', sub: 'It may have been deleted or renamed in the files.', crumb: [label, view], body: '<div class="empty">' + D.views.lk('Back to ' + label, 'go', { v: view }) + '</div>' };
}
function entMatch(e, q) { return !q || (e.name + ' ' + Object.keys(e.meta).map(function (k) { return e.meta[k]; }).join(' ') + ' ' + e.grp + ' ' + e.subs.map(function (b) { return b.v; }).join(' ')).toLowerCase().indexOf(q) >= 0; }
function treeOrder(kind, q) {
  var kindDef = D.model.EDEF[kind], out = [], seen = {};
  var ents = D.model.entsOf(kind).filter(function (e) { return e.meta.id; });
  var show = function (e, dep) { return dep < 9 && (entMatch(e, q) || D.model.kidsOf(e.meta.id).some(function (c) { return show(c, dep + 1); })); };
  var walk = function (e, dep) {
    if (seen[e.meta.id] || !show(e, dep)) return;
    seen[e.meta.id] = 1;
    out.push({ e: e, dep: dep });
    D.model.kidsOf(e.meta.id).slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (c) { walk(c, dep + 1); });
  };
  ents.filter(function (e) { var p = e.meta[kindDef.pk]; return !p || !D.model.entById(p) || p === e.meta.id; }).sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (e) { walk(e, 0); });
  ents.forEach(function (e) { if (!seen[e.meta.id] && entMatch(e, q)) { seen[e.meta.id] = 1; out.push({ e: e, dep: 0 }); } });
  return out;
}
function vAddForm(kind) {
  var kindDef = D.model.EDEF[kind];
  return '<form class="addform" data-sub="add-ent" data-v="' + kind + '" data-k="addform"><label class="fl" for="add-name">Name<input id="add-name" class="in" type="text" autocomplete="off" data-in="addName" value="' + D.views.esc(S.addName) + '" required></label>' +
    '<label class="fl" for="add-type">Type<select id="add-type" class="in" data-ch="addType">' + D.views.opts(kindDef.types, S.addType || kindDef.types[0]) + '</select></label>' +
    '<button type="submit" class="btn primary">Add ' + kindDef.word + '</button>' + D.views.bt('Cancel', 'add-cancel', { cls: 'quiet' }) + '</form>';
}
function entToolbar(kind) {
  var kindDef = D.model.EDEF[kind];
  return '<div class="toolbar" data-k="toolbar"><label class="sr" for="ent-q">Search ' + kindDef.word + 's</label><input id="ent-q" class="in" type="search" autocomplete="off" data-in="eq" value="' + D.views.esc(S.eq) + '" placeholder="Search ' + kindDef.word + 's…" style="min-width:min(320px,100%)">' +
    '<span class="sp"></span>' + (S.adding === kind ? '' : D.views.bt('Add ' + kindDef.word, 'add-open', { v: kind, cls: 'primary', icon: 'plus' })) + '</div>' + (S.adding === kind ? vAddForm(kind) : '');
}
function viewProjects() {
  var q = S.eq.trim().toLowerCase(), list = treeOrder('PRJ', q);
  var cards = list.map(function (o) {
    var e = o.e, id = e.meta.id, all = D.model.prjItems(id), open = all.filter(function (i) { return D.model.whereOf(i.id) === 'open'; });
    var next = open.filter(D.model.isNext), waiting = open.filter(D.model.isWaiting), meetings = open.filter(function (i) { return i.meta.type === 'meeting'; });
    var inbox = all.filter(function (i) { return D.model.whereOf(i.id) === 'inbox'; }), done = all.filter(function (i) { return D.model.whereOf(i.id) === 'done'; });
    var blocked = open.filter(function (i) { return D.model.openBlockers(i).length; }).length;
    var dated = D.model.sortByDue(open.filter(function (i) { var d = dueOf(i.meta); return D.model.isDay(d) && D.model.dd(d) >= 0; }));
    var st = e.meta.status || 'active', live = st === 'active';
    var badges = (live ? (next.length ? D.views.badge('Has a next action', 'ok') : D.views.badge('No next action', 'danger')) : '') + (blocked ? D.views.badge(blocked + ' waiting on a dependency', 'danger') : '') + (waiting.length ? D.views.badge(waiting.length + ' waiting', 'info') : '') + (inbox.length ? D.views.badge(inbox.length + ' in inbox') : '') + (D.model.asksFor(id).length ? D.views.badge(D.model.asksFor(id).length + ' for agent', 'claude') : '');
    return '<article class="ecard" data-k="c-' + id + '"' + (o.dep ? ' style="margin-left:' + Math.min(o.dep, 3) * 18 + 'px"' : '') + '><div class="pills">' + D.views.badge(D.model.cap(st), D.model.ST_TONE[st]) + D.views.badge(D.model.cap(e.meta.type || 'project')) + '<span class="sp id">' + id + '</span></div>' +
      (e.meta.parent && D.model.entById(e.meta.parent) ? '<div class="path">Part of ' + D.views.esc(D.model.entPath(e.meta.parent)) + '</div>' : '') +
      '<button type="button" class="nm" data-act="ent" data-id="' + id + '">' + D.views.esc(e.name) + '</button>' +
      (D.model.firstLine(e) ? '<div class="sum">' + D.views.esc(D.model.clip(D.model.firstLine(e), 150)) + '</div>' : '') + (badges ? '<div class="pills">' + badges + '</div>' : '') +
      '<div class="lines"><div><span class="k">Next date</span> ' + D.views.esc(dated[0] ? D.model.when(dated[0]).label + ', ' + D.model.clip(dated[0].title, 70) : 'Nothing dated') + '</div><div><span class="k">Open</span> ' + D.views.esc(D.model.plural(next.length, 'action') + ', ' + D.model.plural(meetings.length, 'meeting') + ', ' + done.length + ' done') + '</div></div></article>';
  });
  var active = D.model.entsOf('PRJ').filter(function (p) { return (p.meta.status || 'active') === 'active'; }).length;
  return { title: 'Projects', sub: active + ' active · ' + D.model.entsOf('PRJ').length + ' in all', body: entToolbar('PRJ') + (cards.length ? '<div class="grid-cards">' + cards.join('') + '</div>' : '<div class="empty">' + (q ? 'No project matches.' : 'No projects yet.') + '</div>') };
}
function viewSystems() {
  var q = S.eq.trim().toLowerCase(), list = treeOrder('SYS', q);
  var cards = list.map(function (o) {
    var e = o.e, id = e.meta.id, items = D.model.sysItems(id).filter(function (i) { return D.model.whereOf(i.id) === 'open'; });
    var parent = e.meta['part-of'] ? D.model.entById(e.meta['part-of']) : null, st = e.meta.status || '';
    var badges = (items.length ? D.views.badge(D.model.plural(items.length, 'open item')) : '') + (D.model.asksFor(id).length ? D.views.badge(D.model.asksFor(id).length + ' for agent', 'claude') : '');
    return '<article class="ecard" data-k="c-' + id + '"' + (o.dep ? ' style="margin-left:' + Math.min(o.dep, 3) * 18 + 'px"' : '') + '><div class="pills">' + (st ? D.views.badge(D.model.cap(st), D.model.ST_TONE[st]) : D.views.badge('No status', 'soft')) + D.views.badge(D.model.cap(e.meta.type) || 'System') + '<span class="sp id">' + id + '</span></div>' +
      '<button type="button" class="nm" data-act="ent" data-id="' + id + '">' + D.views.esc(e.name) + '</button>' +
      (D.model.firstLine(e) ? '<div class="sum">' + D.views.esc(D.model.clip(D.model.firstLine(e), 150)) + '</div>' : '') + (badges ? '<div class="pills">' + badges + '</div>' : '') +
      '<div class="lines"><div><span class="k">Owner</span> ' + D.views.esc(e.meta.owner || 'Not set') + '</div><div><span class="k">Part of</span> ' + D.views.esc(parent ? parent.name : 'Stands alone') + '</div></div></article>';
  });
  var notLive = D.model.entsOf('SYS').filter(function (x) { return (x.meta.status || '') !== 'live'; }).length;
  return { title: 'Systems', sub: D.model.plural(D.model.entsOf('SYS').length, 'system') + ' · ' + notLive + ' not live', body: entToolbar('SYS') + (cards.length ? '<div class="grid-cards">' + cards.join('') + '</div>' : '<div class="empty">' + (q ? 'No system matches.' : 'No systems yet.') + '</div>') };
}
function viewPeople() {
  var all = S.m.people.people, act = D.model.activePeople();
  var review = D.model.scored().lists, bySc = S.psort === 'score';
  var defs = [['all', 'All', act.length], ['internal', 'Internal', act.filter(function (p) { return !D.model.isExt(p); }).length], ['external', 'External', act.filter(D.model.isExt).length], ['priority', 'Priority', act.filter(D.model.isPrio).length], ['high', 'High score, not Priority', review.high.length], ['low', 'Priority, low score', review.low.length], ['gaps', 'Missing details', act.filter(function (p) { return D.model.gaps(p).length; }).length], ['left', 'Left', all.filter(function (p) { return p.meta.status === 'left'; }).length]];
  var list = S.pf === 'left' ? all.filter(function (p) { return p.meta.status === 'left'; }) : act;
  if (S.pf === 'internal') list = list.filter(function (p) { return !D.model.isExt(p); });
  if (S.pf === 'external') list = list.filter(D.model.isExt);
  if (S.pf === 'priority') list = list.filter(D.model.isPrio);
  if (S.pf === 'high') list = list.filter(function (p) { return review.high.indexOf(p.meta.id) >= 0; });
  if (S.pf === 'low') list = list.filter(function (p) { return review.low.indexOf(p.meta.id) >= 0; });
  if (S.pf === 'gaps') list = list.filter(function (p) { return D.model.gaps(p).length; });
  var q = S.pq.trim().toLowerCase();
  if (q) list = list.filter(function (p) { return (p.name + ' ' + Object.keys(p.meta).map(function (k) { return p.meta[k]; }).join(' ') + ' ' + p.grp + ' ' + D.model.wordsOf(p)).toLowerCase().indexOf(q) >= 0; });
  var tb = '<div class="toolbar" data-k="toolbar"><div class="pills" role="group" aria-label="Filter people">' + defs.map(function (f) { return '<button type="button" class="chipbtn" data-act="pf" data-v="' + f[0] + '"' + D.views.pressed(S.pf === f[0]) + '>' + f[1] + ' ' + f[2] + '</button>'; }).join('') + '</div>' +
    '<label class="sr" for="people-q">Search people</label><input id="people-q" class="in" type="search" autocomplete="off" data-in="pq" value="' + D.views.esc(S.pq) + '" placeholder="Search name, role, organisation…">' +
    '<label class="sr" for="people-g">Group people by</label><select id="people-g" class="in" data-ch="pgroup">' + D.views.opts([['none', 'No grouping'], ['co', 'By organisation'], ['dept', 'By department'], ['grp', 'By group']], S.pgroup) + '</select>' +
    '<label class="sr" for="people-s">Sort people by</label><select id="people-s" class="in" data-ch="psort">' + D.views.opts([['name', 'Sort by: Name'], ['score', 'Sort by: Interaction score']], S.psort) + '</select>' +
    '<span class="sp"></span>' + (S.adding === 'P' ? '' : D.views.bt('Add person', 'add-open', { v: 'P', cls: 'primary', icon: 'plus' })) + '</div>';
  if (S.adding === 'P') tb += '<form class="addform" data-sub="add-person" data-k="addform"><label class="fl" for="add-name">Full name<input id="add-name" class="in" type="text" autocomplete="off" data-in="addName" value="' + D.views.esc(S.addName) + '" required></label>' +
    '<label class="fl" for="add-grp">Group<input id="add-grp" class="in" type="text" list="dl-pgrp" autocomplete="off" data-in="addGrp" value="' + D.views.esc(S.addGrp) + '" placeholder="Other"></label><button type="submit" class="btn primary">Add person</button>' + D.views.bt('Cancel', 'add-cancel', { cls: 'quiet' }) + '</form>';
  var row = function (p) {
    var g = D.model.gaps(p), pid = p.meta.id || '';
    return '<div class="tr" role="listitem" data-k="p-' + D.views.esc(pid || p.name) + '"><div><button type="button" class="nm" data-act="person" data-id="' + D.views.esc(pid) + '"' + (pid ? '' : ' disabled') + '>' + D.views.esc(p.name + (D.model.isMe(p) ? ' (you)' : '')) + '</button>' + (D.model.isPrio(p) ? ' ' + prioMark(p) : '') + '<div class="hint">' + D.views.esc(p.meta.title || 'No job title') + '</div></div>' +
      '<div class="c2">' + D.views.esc([p.meta.company, p.meta.department].filter(Boolean).join(' › ') || 'Not set') + (D.model.isExt(p) ? ' ' + D.views.badge('External', 'info') : '') + '</div>' +
      '<div class="c3">' + D.views.esc(p.meta.manager || (D.model.isExt(p) ? 'External' : 'Not set')) + '</div>' + (bySc ? scoreCell(p) : '') +
      '<div class="r">' + (g.length ? D.views.badge('Missing ' + g.map(function (k) { return D.model.GAP_LABEL[k]; }).join(', '), 'warn') : '') + (p.meta.status === 'left' ? D.views.badge('Left') : '') + '<span class="hint">' + D.model.personOpenCount(p) + ' open</span>' + prioToggle(p, 'sm') + '</div></div>';
  };
  // By score, the User and anyone who has left come last, having no score
  var rank = function (p) { return scoreable(p) ? D.model.scoreOf(p) : -1; };
  var sorted = list.slice().sort(function (a, b) { return (bySc ? rank(b) - rank(a) : 0) || a.name.localeCompare(b.name); });
  var body = '';
  if (S.pgroup === 'none') body = sorted.map(row).join('');
  else {
    var kf = { co: function (p) { return p.meta.company || 'No organisation'; }, dept: function (p) { return p.meta.department || 'No department'; }, grp: function (p) { return p.grp || 'Other'; } }[S.pgroup];
    var groups = {}, order = [];
    sorted.forEach(function (p) { var k = kf(p); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(p); });
    order.sort(function (a, b) { return (/^No /.test(a) - /^No /.test(b)) || a.localeCompare(b); });
    body = order.map(function (k) { return '<div class="grp-h" role="presentation" data-k="g-' + D.views.esc(k) + '">' + D.views.esc(k) + ' <span class="hint">' + groups[k].length + '</span></div>' + groups[k].map(row).join(''); }).join('');
  }
  var short = (S.pf === 'high' || S.pf === 'low') && !review.enough;
  var none = short ? 'There isn\'t enough history yet to compare people. It takes ' + D.model.plural(review.needs, 'person', 'people') + ' with Interactions, and so far there ' + (review.scored === 1 ? 'is 1' : 'are ' + review.scored) + '.' : 'Nobody matches.';
  var tbl = '<div class="tbl' + (bySc ? ' by-score' : '') + '" data-k="tbl"><div class="tr th" aria-hidden="true"><span>Name and role</span><span class="c2">Organisation</span><span class="c3">Reports to</span>' + (bySc ? '<span class="score-h">Score</span>' : '') + '<span class="r">Open items</span></div><div role="list" aria-label="People">' + body + '</div>' + (sorted.length ? '' : '<div class="empty" style="padding:12px 14px">' + D.views.esc(none) + '</div>') + '</div>';
  var extra = '';
  var unk = (S.pf === 'all' || S.pf === 'gaps') && !q ? D.model.unknownWhos() : [];
  if (unk.length) extra = '<div class="list" style="margin-top:22px">' + D.views.vSec('unknown', 'On your tasks but not in People', unk.map(function (u) {
    return '<div class="row" data-k="u-' + D.views.esc(u.name) + '"><div class="lead"><span class="pip grey" aria-hidden="true"></span></div><div class="body"><strong>' + D.views.esc(u.name) + '</strong><div class="meta">' + D.model.plural(u.n, 'item') + '</div></div><div class="right">' +
      D.views.bt('Add to People', 'add-person', { v: u.name, cls: 'sm primary' }) + D.views.bt('Not a person', 'hide-who', { v: u.name, cls: 'sm' }) + '</div></div>';
  }), { hint: 'add them so their details can be filled in' }) + '</div>';
  var ext = act.filter(D.model.isExt).length;
  return { title: 'People', sub: D.model.plural(act.length, 'person', 'people') + ' · ' + ext + ' external · ' + act.filter(function (p) { return D.model.gaps(p).length; }).length + ' missing details', body: tb + tbl + extra };
}

/* ===================== reflect ===================== */
function viewReview() {
  var steps = D.model.reviewSteps(), done = steps.filter(function (x) { return x.done; }).length, att = steps.filter(function (x) { return x.attention && !x.done; }).length;
  var pct = Math.round(done / steps.length * 100);
  var b = '<div class="hint" data-k="rv-h">' + done + ' of ' + steps.length + ' steps done · ' + (att ? att + ' need attention' : 'nothing needs attention') + '</div>' +
    '<div class="progress" aria-hidden="true" data-k="rv-p"><span style="width:' + pct + '%"></span></div><ol class="steps" data-k="rv-s">' +
    steps.map(function (x) {
      return '<li class="step' + (x.done ? ' done' : '') + '" data-k="rv-' + x.key + '"><input type="checkbox" id="rv-' + x.key + '" data-ch="review" data-v="' + x.key + '"' + (x.done ? ' checked' : '') + '>' +
        '<div class="grow"><label for="rv-' + x.key + '">' + x.n + '. ' + D.views.esc(x.title) + '</label><div class="hint">' + D.views.esc(x.help) + '</div></div>' + D.views.badge(x.count, x.tone) + D.views.bt(x.action, 'go', { v: x.go, cls: 'sm' }) + '</li>';
    }).join('') + '</ol>';
  return { title: 'Weekly review', sub: D.model.fmtLong(D.model.todayStr()) + ' · week ' + D.model.isoWeek(D.model.todayStr()).slice(6), tools: done ? D.views.bt('Start again', 'review-reset', { cls: 'quiet' }) : '', body: b };
}
function vAskItem(n, withTarget) {
  var editing = S.editAsk === n.raw;
  var head = '';
  if (withTarget) {
    var lab = D.model.labelOf(n.id);
    head = '<div class="pills">' + D.views.badge(D.model.KIND_WORD[kindOf(n.id)] || 'Item') + (lab !== null ? D.views.lk(lab, 'any', { id: n.id }) : '<span class="hint">' + D.views.esc(n.id) + ' (not found)</span>') + '<span class="sp id">' + n.id + '</span></div>';
  }
  if (editing) {
    return '<div class="ask" data-k="a-' + D.views.esc(n.raw) + '">' + head + '<label class="sr" for="ask-edit">Edit note</label><textarea id="ask-edit" class="in" rows="4" data-in="editAskText">' + D.views.esc(S.editAskText) + '</textarea>' +
      '<div class="ts">' + D.views.bt('Save', 'ask-save', { cls: 'primary sm' }) + D.views.bt('Cancel', 'ask-cancel', { cls: 'sm quiet' }) + '</div></div>';
  }
  return '<div class="ask" data-k="a-' + D.views.esc(n.raw) + '">' + head + '<div class="txt">' + D.views.esc(n.text) + '</div><div class="ts"><span>Queued ' + D.views.esc(D.model.fmtDT(n.ts)) + '</span>' +
    D.views.lk('Edit', 'ask-edit', { v: n.raw }) + D.views.lk('Remove', 'ask-del', { v: n.raw }) + '</div></div>';
}
function viewClaude() {
  var q = S.m.asks.notes, drafts = S.m.drafts, log = S.m.log.slice().reverse();
  var b = D.views.vSec('cq', 'Queued for the agent', q.map(function (n) { return vAskItem(n, true); }), { hint: 'Your agent works through these when you run discern-ask-agent', empty: 'Nothing queued. Use the Agent tab on any item to leave a note.' });
  b += D.views.vSec('cd', 'Drafts the agent wrote', drafts.map(function (d) {
    var id = D.model.draftId(d.name);
    return '<div class="card-l" data-k="d-' + D.views.esc(d.name) + '"><div class="pills"><span class="mono hint">drafts/' + D.views.esc(d.name) + '</span><span class="sp"></span>' + (id && D.model.exists(id) ? D.views.bt('Open ' + id, 'draft-open', { id: id, cls: 'sm' }) : '') + '</div><div class="draft">' + D.views.esc(D.model.clip(d.text, 420)) + '</div></div>';
  }), { empty: 'No drafts in the drafts folder.' });
  b += D.views.vSec('cl', 'Done by the agent', log.length ? ['<div class="tbl">' + log.map(function (l) {
    return '<div class="logrow" data-k="l-' + D.views.esc(l.raw) + '"><span class="when">' + D.views.esc(D.model.fmtDT(l.at)) + '</span><div class="grow" style="flex:1 1 260px;min-width:0"><div>' + D.views.esc(l.did) + '</div><div class="hint">You asked: ' + D.views.esc(l.note) + '</div></div>' + (D.model.exists(l.id) ? D.views.lk(l.id, 'any', { id: l.id }) : '<span class="id">' + D.views.esc(l.id) + '</span>') + '</div>';
  }).join('') + '</div>'] : [], { count: log.length, empty: 'Nothing yet.' });
  var r = D.model.lastClaudeRun();
  return { title: 'Agent', sub: D.model.plural(q.length, 'request') + ' queued' + (r ? ' · last actioned ' + r : ''), body: '<div class="list">' + b + '</div>' };
}

Object.assign(D.views, {
  viewProject: viewProject, viewSystem: viewSystem, viewPerson: viewPerson, histText: histText,
  viewProjects: viewProjects, viewSystems: viewSystems, viewPeople: viewPeople, viewReview: viewReview,
  vAskItem: vAskItem, viewClaude: viewClaude
});
})();
