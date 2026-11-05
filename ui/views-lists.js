// The views concern, part two: the focus lists, Today to Done, with the markup for change Proposals, from state alone.
// It uses model and links, and from files only Q and srv. It never changes state, never calls ops and never uses the DOM or fetch.
(function () {
'use strict';
var S = D.model.S;

/* ===================== focus lists ===================== */
function viewToday() {
  var open = D.model.openList().filter(function (i) { return i.meta.type !== 'fyi' && !D.model.isWaiting(i); });
  var overdue = D.model.sortItems(open.filter(function (i) { return isOverdue(i, D.model.todayStr()); }));
  var dueToday = D.model.sortByDue(open.filter(function (i) { var d = dueOf(i.meta); return D.model.isDay(d) && D.model.dd(d) === 0; }));
  var planned = D.model.sortItems(open.filter(function (i) { return !D.model.isDay(dueOf(i.meta)) && i.meta.urgency === 'today'; }));
  var horizon = D.model.addWorkdays(D.model.todayStr(), 3);
  var coming = D.model.sortByDue(open.filter(function (i) { var d = dueOf(i.meta); return D.model.isDay(d) && D.model.dd(d) > 0 && d.slice(0, 10) <= horizon; }));
  var b = '';
  if (overdue.length) b += D.views.vSec('overdue', 'Overdue', D.views.rowsOf(overdue, { snooze: true }));
  b += D.views.vSec('duetoday', 'Due today', D.views.rowsOf(dueToday, { timeFirst: true }), { empty: 'Nothing is due today.' });
  if (planned.length) b += D.views.vSec('planned', 'Planned for today', D.views.rowsOf(planned), { hint: 'marked Today, no date set' });
  b += D.views.vSec('coming', 'Coming up', D.views.rowsOf(coming), { hint: 'next 3 working days', empty: 'Nothing dated in the next 3 working days.', link: D.views.lk('See everything upcoming', 'go', { v: 'upcoming' }) });
  var sub = [D.model.fmtLong(D.model.todayStr())];
  if (overdue.length) sub.push(overdue.length + ' overdue');
  sub.push(dueToday.length + ' due today', coming.length + ' coming up');
  return { title: 'Today', sub: sub.join(' · '), qa: true, cards: true, body: '<div class="list">' + b + '</div>' };
}
function vCards() {
  var open = D.model.openList(), now = new Date(), hm = D.model.pad2(now.getHours()) + ':' + D.model.pad2(now.getMinutes());
  var meetings = open.filter(function (i) { return i.meta.type === 'meeting' && D.model.isDay(dueOf(i.meta)); });
  var meetToday = meetings.filter(function (i) { return D.model.dd(dueOf(i.meta)) === 0; });
  var nextM = D.model.sortByDue(meetings.filter(function (i) { var d = dueOf(i.meta), n = D.model.dd(d); return n > 0 || (n === 0 && (D.model.timeOf(d) || '23:59') >= hm); }))[0];
  var inbox = D.model.inboxCount();
  var waiting = open.filter(D.model.isWaiting).sort(function (a, b) { return D.model.age(b) - D.model.age(a); });
  var asks = S.m.asks.notes.length;
  var drafts = S.m.drafts.filter(function (d) { var id = D.model.draftId(d.name); return id && D.model.whereOf(id) === 'open'; }).length;
  var card = function (k, v, vcls, s, act, a) { return '<button type="button" class="card" data-act="' + act + '"' + D.views.dv(act === 'open' ? 'id' : 'v', a) + '><span class="k">' + D.views.esc(k) + '</span><span class="v' + (vcls ? ' ' + vcls : '') + '">' + D.views.esc(v) + '</span><span class="s">' + D.views.esc(s) + '</span></button>'; };
  return '<div class="cards" data-k="cards">' +
    card('Meetings', meetToday.length ? meetToday.length + ' today' : 'None today', '', nextM ? 'Next: ' + D.model.when(nextM).label + ', ' + D.model.clip(nextM.title, 60) : 'Nothing scheduled', nextM ? 'open' : 'go', nextM ? nextM.id : 'upcoming') +
    card('Inbox', inbox ? inbox + ' to clarify' : 'Clear', inbox ? 'accent' : '', 'Proposed by your source skills', 'go', 'inbox') +
    card('Waiting for', waiting.length + ' open', '', waiting.length ? 'Oldest: ' + (D.model.realWho(waiting[0]) || 'someone') + ', ' + D.model.plural(D.model.age(waiting[0]), 'day') : 'Nobody', 'go', 'waiting') +
    card('Agent', D.model.plural(asks, 'request') + ' queued', 'claude', drafts ? D.model.plural(drafts, 'draft') + ' ready to review' : 'No drafts waiting', 'go', 'claude') +
    '</div>';
}
function vQuick() {
  var text = S.qa || '', q = text.trim() ? D.model.parseQuick(text, S.qaType) : null;
  var h = '<div class="qa" data-k="qa"><label for="qa-in">Add an item</label><div class="qa-row">' +
    '<input id="qa-in" class="in" type="text" autocomplete="off" spellcheck="true" data-in="qa" data-kd="qa" value="' + D.views.esc(text) + '" placeholder="Call @Sam about the budget +launch #finance mon 10:00 !high" aria-describedby="qa-help">' +
    D.views.bt('More', 'qa-more', { attrs: ' aria-expanded="' + S.qaMore + '" aria-controls="qa-more"' }) + D.views.bt('Add', 'qa-add', { cls: 'primary' }) + '</div>';
  if (S.qaMore) {
    h += '<div class="qa-more" id="qa-more" data-k="qa-more"><label class="fl" for="qa-urg">Urgency<select id="qa-urg" class="in" data-ch="qa-urg">' +
      D.views.opts([['', 'From the due date']].concat(URG_ORDER.map(function (u) { return [u, URG[u]]; })), S.qaUrg) + '</select></label>' +
      '<label class="fl" for="qa-desc">Description<textarea id="qa-desc" class="in" rows="3" data-in="qaDesc" placeholder="What it is and anything worth knowing (optional)">' + D.views.esc(S.qaDesc) + '</textarea></label></div>';
  }
  if (q && q.title) {
    var chips = '';
    if (S.qaUrg) chips += D.views.badge(URG[S.qaUrg]);
    if (q.date) chips += D.views.badge('Due ' + D.model.fmt(q.date) + (q.time ? ' ' + q.time : ''));
    if (q.who) chips += D.views.badge(q.who + (q.whoNew ? ' (not in People)' : ''), q.whoNew ? 'warn' : '');
    q.prj.forEach(function (p) { var e = D.model.entById(p); chips += D.views.badge(e ? e.name : p, 'info'); });
    q.prjNew.forEach(function (x) { chips += D.views.badge('New project: ' + x, 'warn'); });
    q.tags.forEach(function (x) { chips += D.views.badge('#' + x); });
    if (q.p === 'high') chips += D.views.badge(PRIORITY_LABEL.high, 'flag');
    if (q.p === 'low') chips += D.views.badge(PRIORITY_LABEL.low, 'soft');
    h += '<div class="qa-prev" id="qa-help"><span class="hint">Will add</span><button type="button" class="qa-type" data-act="qa-type" title="Change the type" aria-label="Type: ' + D.views.esc(D.model.TYPE_WORD[q.ty]) + '. Click to change">' + D.views.esc(D.model.TYPE_WORD[q.ty]) + D.views.ic('chev', 's') + '</button>' + chips + '</div>' +
      '<div class="qa-title">Title: <strong>' + D.views.esc(q.title) + '</strong> <span class="hint">· press Enter to add</span></div>';
  } else {
    h += '<div class="hint" id="qa-help" style="margin-top:8px">Type a task in plain words. Add <strong>@person</strong>, <strong>+project</strong>, <strong>#tag</strong>, <strong>!high</strong> and a date such as fri, 14 Oct or tomorrow 10:00.</div>';
  }
  return h + '</div>';
}

/* ===================== change Proposals =====================
   A Relationship with an end still in the Inbox is asked on that Item; every other change has a card of its own. */
function recId(x) { return x.id || x.meta.id; }
function vAckEntry(x) {
  var id = recId(x), title = x.id ? x.title : x.name, cs = byTime(commentsOf(x).filter(toAck)), undos = D.model.undosOf(x), acts = '';
  var done = !!x.id && D.model.whereOf(id) !== 'done' && cs.some(function (c) { return c.f.suggests === 'done'; });
  undos.forEach(function (u) { acts += D.views.bt(undos.length > 1 ? 'Undo ' + (D.model.CHANGE_WORD[u.field] || u.field).toLowerCase() : 'Undo', 'chg-undo', { id: id, v: u.field, cls: 'sm', attrs: ' aria-label="Undo the ' + D.views.esc((D.model.CHANGE_WORD[u.field] || u.field).toLowerCase()) + ' change: ' + D.views.esc(D.model.clip(title, 60)) + '"' }); });
  if (done) acts += D.views.bt('Mark done', 'cmt-done', { id: id, cls: 'sm', attrs: ' aria-label="Mark done: ' + D.views.esc(D.model.clip(title, 60)) + '"' });
  return '<div class="row chg" data-k="ack-' + id + '"><div class="lead"><span class="pip" aria-hidden="true"></span></div><div class="body">' +
    (x.id ? '' : '<div class="meta">' + D.views.esc(D.model.KIND_WORD[kindOf(id)] || '') + '</div>') +
    '<button type="button" class="t" data-act="open" data-id="' + id + '">' + D.views.esc(title) + '</button>' +
    cs.map(function (c) {
      return '<div class="cmt"><div class="cmt-h"><span>' + D.views.esc(D.views.whenOf(c)) + ' · ' + D.views.esc(D.views.authorOf(c)) + '</span></div>' + D.views.vCmtText(c) +
        (fieldChange(c) && D.model.fromCalendar(x, c) ? '<div class="hint">Change it in your calendar.</div>' : '') + '</div>';
    }).join('') +
    '</div><div class="right">' + D.views.bt('Acknowledged', 'cmt-ack', { id: id, cls: 'primary sm', attrs: ' aria-label="Acknowledged: ' + D.views.esc(D.model.clip(title, 60)) + '"' }) + acts + '<span class="id">' + id + '</span></div></div>';
}
function relName(id) { return kindOf(id) === 'T' ? id : (D.model.labelOf(id) || id); }
function relQuestion(c) {
  var r = D.model.relOf(c);
  if (!r) return 'Relate ' + c.a + ' and ' + c.b + '?';
  var a = relName(r.from), b = relName(r.to);
  return { related: 'Are these 2 related?', concerns: 'Does ' + a + ' concern ' + b + '?', involves: 'Is ' + b + ' involved in ' + a + '?', owns: 'Does ' + a + ' own ' + b + '?', uses: 'Does ' + a + ' use ' + b + '?' }[r.type] || 'Relate ' + a + ' and ' + b + '?';
}
function vWhy(c) { return c.why ? '<div class="why">Why: ' + D.views.esc(c.why) + '</div>' : ''; }
function vSeen(c) {
  var f = c.fields, at = f['received-datetime'] || f['event-date'] || '';
  return f.source || at ? 'From ' + (f.source || 'a source') + (at ? ' on ' + D.model.fmtDT(at) : '') : '';
}
// one end of a Relationship: its type, ID, title or name, and Description; each opens its page
function vEnd(id) {
  var k = kindOf(id), label = D.model.labelOf(id), kind = D.model.KIND_WORD[k] || k, desc = '', sub = '';
  if (k === 'T') { var t = D.model.item(id); if (t) { kind = TYPE_NAME[t.meta.type] || TYPE_NAME.task; desc = D.model.firstLine(t); if (D.model.whereOf(id) === 'done') sub = 'done'; else if (D.model.whereOf(id) === 'inbox') sub = 'in the inbox'; } }
  else if (k === 'P') { var p = D.model.personById(id); if (p) { sub = [p.meta.title, p.meta.company].filter(Boolean).join(', '); desc = D.model.firstLine(p); } }
  else { var e = D.model.entById(id); if (e) desc = D.model.firstLine(e); }
  return '<div class="end" data-k="end-' + id + '"><div class="k">' + D.views.esc(kind) + (sub ? ' · ' + D.views.esc(sub) : '') + ' <span class="id">' + id + '</span></div>' +
    (label === null ? '<div class="hint">Not found in your files.</div>' : '<button type="button" class="t" data-act="open" data-id="' + id + '">' + D.views.esc(label) + '</button>') +
    (desc ? '<div class="meta">' + D.views.esc(D.model.clip(desc, 160)) + '</div>' : '') + '</div>';
}
function vChange(c) {
  var key = changeKey(c), body = '', acts = '', v = { v: c.line };
  if (c.type === 'relationship') {
    var ok = !!D.model.relOf(c) && D.model.exists(c.a) && D.model.exists(c.b);
    body = '<div class="q">' + D.views.esc(relQuestion(c)) + '</div>' + vWhy(c) + '<div class="ends">' + vEnd(c.a) + vEnd(c.b) + '</div>';
    acts = (ok ? D.views.bt('Yes', 'chg-yes', { v: c.line, cls: 'primary sm' }) : '') + D.views.bt('No', 'chg-no', { v: c.line, cls: 'sm' });
  } else if (c.type === 'person') {
    var items = csv(c.fields.items).filter(D.model.exists), who = [c.fields.title, c.fields.company].filter(Boolean).join(', '), cid = 'intro-' + D.views.slug(key);
    body = '<div class="q">New person: ' + D.views.esc(c.name) + '</div><div class="meta">' + D.views.esc([c.email, who].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="meta">' + D.views.esc(vSeen(c)) + '</div>' +
      (items.length ? '<div class="pills">' + items.map(function (x) { return '<button type="button" class="chipbtn" data-act="open" data-id="' + x + '"><span class="id">' + x + '</span> ' + D.views.esc(D.model.clip(D.model.labelOf(x), 60)) + '</button>'; }).join('') + '</div>' : '') + vWhy(c) +
      '<label class="hint intro" for="' + cid + '"><input type="checkbox" id="' + cid + '" data-ch="intro" data-v="' + D.views.esc(key) + '"' + (S.introOn[key] ? ' checked' : '') + '>Add a Task to set up an introduction meeting</label>';
    acts = D.views.bt('Add', 'person-add', { v: c.line, cls: 'primary sm' }) + D.views.bt('Add as Priority person', 'person-prio', { v: c.line, cls: 'sm' }) + D.views.bt('No', 'chg-no', { v: c.line, cls: 'sm' });
  } else if (c.type === 'priority') {
    var pp = D.model.personById(c.id);
    body = '<div class="q">Make ' + (pp ? '<button type="button" class="t inl" data-act="open" data-id="' + c.id + '">' + D.views.esc(pp.name) + '</button>' : D.views.esc(c.name)) + ' a Priority person?</div>' +
      '<div class="meta">' + D.views.esc(pp ? [pp.meta.title, pp.meta.company].filter(Boolean).join(', ') : c.id + ' is not in People') + '</div>' +
      '<div class="meta">' + D.views.esc(vSeen(c)) + '</div>' + vWhy(c);
    acts = (pp ? D.views.bt('Yes', 'prio-yes', { v: c.line, cls: 'primary sm' }) : '') + D.views.bt('No', 'chg-no', v);
  } else {
    var p = D.model.personById(c.id);
    body = '<div class="q">New email for ' + (p ? '<button type="button" class="t inl" data-act="open" data-id="' + c.id + '">' + D.views.esc(p.name) + '</button>' : D.views.esc(c.name)) + '</div>' +
      '<div class="meta">' + D.views.esc([c.email, p ? [p.meta.title, p.meta.company].filter(Boolean).join(', ') : c.id + ' is not in People'].filter(Boolean).join(' · ')) + '</div>' + vWhy(c);
    acts = (p ? D.views.bt('Yes', 'email-yes', { v: c.line, cls: 'primary sm' }) : '') + D.views.bt('No', 'chg-no', v);
  }
  return '<div class="row chg" data-k="c-' + D.views.esc(key) + '"><div class="lead"><span class="pip" aria-hidden="true"></span></div><div class="body">' + body + '</div><div class="right">' + acts + '</div></div>';
}
// the Relationship Proposals asked on an Item still in the Inbox: "Related to T-0012 title? Yes | No"
function vItemChanges(id) {
  return D.model.changesOn(S.m.inbox, id).map(function (c) {
    var r = D.model.relOf(c), other = c.a === id ? c.b : c.a, label = D.model.labelOf(other);
    if (!r || label === null) return '';
    var word = r.type === 'related' ? 'Related to' : D.model.relWord({ type: r.type, from: r.from === id });
    return '<div class="relq" data-k="rq-' + D.views.esc(changeKey(c)) + '"><span>' + D.views.esc(word) + ' <button type="button" class="link" data-act="open" data-id="' + other + '">' + (kindOf(other) === 'T' ? other + ' ' : '') + '<em>' + D.views.esc(D.model.clip(label, 60)) + '</em></button>?</span>' +
      D.views.bt('Yes', 'chg-yes', { v: c.line, cls: 'sm' }) + D.views.bt('No', 'chg-no', { v: c.line, cls: 'sm' }) + (c.why ? '<span class="why">' + D.views.esc(c.why) + '</span>' : '') + '</div>';
  }).join('');
}
function viewInbox() {
  var l = D.model.inboxList(), cs = D.model.changeCards(), ak = D.model.ackItems(), r = D.model.lastRefresh();
  var body = D.views.vSec('triage', 'To clarify', D.views.rowsOf(l), { hint: 'oldest first', empty: cs.length || ak.length ? 'No new items to clarify.' : 'Inbox zero. Nothing is waiting to be clarified.' });
  if (ak.length) body += D.views.vSec('acks', 'New comments', ak.map(vAckEntry), { hint: 'news on items you track' });
  if (cs.length) body += D.views.vSec('changes', 'Changes', cs.map(vChange), { hint: 'relationships, people and Priority people' });
  return {
    title: 'Inbox', sub: D.model.plural(l.length + cs.length, 'proposal') + (ak.length ? ' · ' + D.model.plural(ak.length, 'item') + ' with new comments' : '') + (r ? ' · last run ' + r : ''),
    body: '<div class="list">' + body + '</div>'
  };
}
function viewNext() {
  var all = D.model.nextList();
  var blocked = all.filter(function (i) { return D.model.openBlockers(i).length; });
  var ready = all.filter(function (i) { return !D.model.openBlockers(i).length; });
  var b = '';
  if (S.group === 'project') {
    D.model.entsOf('PRJ').filter(function (p) { return p.meta.id; }).sort(function (a, c) { return D.model.entPath(a.meta.id).localeCompare(D.model.entPath(c.meta.id)); }).forEach(function (p) {
      var rows = D.model.sortItems(ready.filter(function (i) { return prjOf(i).indexOf(p.meta.id) >= 0; }));
      if (rows.length) b += D.views.vSec('p-' + p.meta.id, D.model.entPath(p.meta.id), D.views.rowsOf(rows, { hideProject: true }), { link: D.views.lk('Open project', 'ent', { id: p.meta.id }) });
    });
    var none = D.model.sortItems(ready.filter(function (i) { return !prjOf(i).some(function (p) { return D.model.entById(p); }); }));
    if (none.length) b += D.views.vSec('noprj', 'Not in a project', D.views.rowsOf(none));
  } else if (S.group === 'kind') {
    [['task', 'Do'], ['document', 'Read or review'], ['process', 'Run a process']].forEach(function (k) {
      var rows = D.model.sortItems(ready.filter(function (i) { return (i.meta.type || 'task') === k[0]; }));
      if (rows.length) b += D.views.vSec('k-' + k[0], k[1], D.views.rowsOf(rows));
    });
    var other = D.model.sortItems(ready.filter(function (i) { return ['task', 'document', 'process'].indexOf(i.meta.type || 'task') < 0; }));
    if (other.length) b += D.views.vSec('k-other', 'Other', D.views.rowsOf(other));
  } else {
    b += D.views.vSec('all', 'All actions', D.views.rowsOf(D.model.sortItems(ready)), { empty: 'Nothing to do. Enjoy it.' });
  }
  if (blocked.length) b += D.views.vSec('blocked', 'Waiting on a dependency', D.views.rowsOf(D.model.sortItems(blocked)), { hint: 'each can start when its dependency is done' });
  if (!b) b = D.views.vSec('all', 'All actions', [], { empty: 'Nothing to do. Enjoy it.' });
  var tools = '<div class="seg" role="group" aria-label="Group by">' + [['project', 'By project'], ['kind', 'By kind'], ['none', 'One list']].map(function (g) {
    return '<button type="button" data-act="group" data-v="' + g[0] + '"' + D.views.pressed(S.group === g[0]) + '>' + g[1] + '</button>';
  }).join('') + '</div>';
  return { title: 'Next actions', sub: ready.length + ' you can do now · ' + blocked.length + ' waiting on a dependency', tools: tools, qa: true, body: '<div class="list">' + b + '</div>' };
}
function viewWaiting() {
  var list = D.model.openList().filter(D.model.isWaiting), by = {};
  list.forEach(function (i) { var w = D.model.realWho(i) || 'Someone'; (by[w] = by[w] || []).push(i); });
  var groups = Object.keys(by).map(function (w) { return { w: w, items: by[w].slice().sort(function (a, b) { return D.model.age(b) - D.model.age(a); }), max: Math.max.apply(null, by[w].map(D.model.age)) }; }).sort(function (a, b) { return b.max - a.max || a.w.localeCompare(b.w); });
  var b = groups.map(function (g) {
    var p = D.model.personByName(g.w);
    var sub = p ? [p.meta.title, p.meta.company, D.model.isExt(p) ? 'external' : ''].filter(Boolean).join(' · ') : '';
    return D.views.vSec('w-' + g.w, g.w, D.views.rowsOf(g.items, { waiting: true, hidePerson: true }), { count: '', sub: sub, link: p && p.meta.id ? D.views.lk('Open person', 'person', { id: p.meta.id }) : '' });
  }).join('');
  var inb = S.m.inbox.items.filter(D.model.isWaiting);
  if (inb.length) b += D.views.vSec('w-untracked', 'Not tracked yet', [], { count: '', hint: inb.length + ' more in your inbox. Accept to track it here.', link: D.views.lk('Open Inbox', 'go', { v: 'inbox' }) });
  if (!groups.length) b += D.views.vSec('w-none', 'Nobody', [], { count: '', empty: 'You are not waiting on anyone.' });
  var oldest = list.reduce(function (m, i) { return Math.max(m, D.model.age(i)); }, 0);
  return { title: 'Waiting for', sub: D.model.plural(list.length, 'request') + ' open' + (list.length ? ' · oldest ' + D.model.plural(oldest, 'day') : ''), body: '<div class="list">' + b + '</div>' };
}
function viewUpcoming() {
  var list = D.model.openList().filter(function (i) { return D.model.isDay(dueOf(i.meta)) && i.meta.type !== 'fyi'; });
  var overdue = D.model.sortByDue(list.filter(function (i) { return isOverdue(i, D.model.todayStr()); }));
  var days = {}, order = [];
  D.model.sortByDue(list.filter(function (i) { return D.model.dd(dueOf(i.meta)) >= 0; })).forEach(function (i) { var k = i.meta['due-date']; if (!days[k]) { days[k] = []; order.push(k); } days[k].push(i); });
  var b = '';
  if (overdue.length) b += D.views.vSec('u-overdue', 'Overdue', D.views.rowsOf(overdue, { snooze: true }));
  order.forEach(function (k) {
    var n = D.model.dd(k), t = (n === 0 ? 'Today, ' : (n === 1 ? 'Tomorrow, ' : '')) + D.model.fmtLong(k);
    b += D.views.vSec('u-' + k, t, days[k].map(function (i) { return D.views.vRow(i, { timeFirst: true, hideWhen: true, waiting: D.model.isWaiting(i) }); }), { count: '' });
  });
  var undated = D.model.nextList().filter(function (i) { return !D.model.isDay(dueOf(i.meta)); }).length;
  if (undated) b += D.views.vSec('u-nodate', 'No date', [], { count: '', hint: D.model.plural(undated, 'action') + ' with no due date', link: D.views.lk('Open Next actions', 'go', { v: 'next' }) });
  if (!b) b = D.views.vSec('u-none', 'Nothing dated', [], { count: '', empty: 'Nothing has a due date yet.' });
  var future = list.filter(function (i) { return D.model.dd(dueOf(i.meta)) >= 0; }).length;
  return { title: 'Upcoming', sub: D.model.plural(future, 'dated item') + ' and meetings, by day', body: '<div class="list">' + b + '</div>' };
}
function viewFyi() {
  var l = D.model.sortItems(D.model.openList().filter(function (i) { return i.meta.type === 'fyi'; }));
  return { title: 'FYI', sub: D.model.plural(l.length, 'thing') + ' to know. Acknowledge them to file them away.', body: '<div class="list">' + D.views.vSec('fyi', 'To read and file', D.views.rowsOf(l), { empty: 'Nothing to file.' }) + '</div>' };
}
var WB_GROUPS = [['urg', 'Urgency'], ['type', 'Type'], ['person', 'Person'], ['project', 'Project'], ['tag', 'Tag']];
var WB_SORTS = [['urg', 'Sort: urgency'], ['due', 'Sort: due date'], ['new', 'Sort: assigned, newest first'], ['old', 'Sort: assigned, oldest first']];
function viewAll() {
  var o = { group: S.wb.group, sort: S.wb.sort, tag: S.wb.tag, q: S.wq.trim(), prjName: D.model.prjName };
  var groups = workbench(D.model.openList(), o), ro = { showTags: true, hideProject: o.group === 'project', hidePerson: o.group === 'person' };
  var seen = {}, n = 0, extra = [], b = '';
  var also = function (key, title, list) {
    var l = list.filter(function (i) { return (!o.tag || tagsOf(i).indexOf(o.tag) >= 0) && itemMatch(i, o.q, D.model.prjName) !== null; });
    if (l.length) extra.push(l.length + ' ' + (key === 'wb-inbox' ? 'in the inbox' : 'done'));
    return l.length ? D.views.vSec(key, title, D.views.rowsOf(l, { showTags: true })) : '';
  };
  /* a search also looks in the inbox and in done, so that no match is hidden */
  if (o.q) b += also('wb-inbox', 'Inbox', D.model.inboxList());
  groups.forEach(function (g) { g.items.forEach(function (i) { if (!seen[i.id]) { seen[i.id] = 1; n++; } }); b += D.views.vSec('wb-' + g.key, g.label, D.views.rowsOf(g.items, ro)); });
  if (o.q) b += also('wb-done', 'Done', S.m.done.items.slice().reverse());
  if (!b) b = '<div class="empty">' + (o.q || o.tag ? 'Nothing matches.' : 'No open items.') + '</div>';
  var tags = D.model.allTags(); if (o.tag && tags.indexOf(o.tag) < 0) tags.push(o.tag);
  var tools = '<div class="seg" role="group" aria-label="Group by">' + WB_GROUPS.map(function (g) {
    return '<button type="button" data-act="wb-group" data-v="' + g[0] + '"' + D.views.pressed(o.group === g[0]) + '>' + g[1] + '</button>';
  }).join('') + '</div>';
  var bar = '<div class="toolbar" data-k="toolbar"><label class="sr" for="wb-q">Search items</label><input id="wb-q" class="in" type="search" autocomplete="off" data-in="wq" value="' + D.views.esc(S.wq) + '" placeholder="Search items, descriptions, comments, people…" style="min-width:min(320px,100%)">' +
    '<label class="sr" for="wb-sort">Sort within each group</label><select id="wb-sort" class="in" data-ch="wb-sort">' + D.views.opts(WB_SORTS, o.sort) + '</select>' +
    '<label class="sr" for="wb-tag">Show only one tag</label><select id="wb-tag" class="in" data-ch="wb-tag">' + D.views.opts([['', 'All tags']].concat(tags.map(function (t) { return [t, '#' + t]; })), o.tag) + '</select></div>';
  var sub = o.q || o.tag ? [D.model.plural(n, 'open item') + ' match' + (n === 1 ? 'es' : '')].concat(extra).join(' · ') : D.model.plural(n, 'open item');
  return { title: 'All items', sub: sub, tools: tools, qa: true, body: bar + '<div class="list">' + b + '</div>' };
}
function viewDone() {
  var list = S.m.done.items.slice().sort(function (a, b) { return String(b.meta['done-date'] || '').localeCompare(String(a.meta['done-date'] || '')) || (a.id < b.id ? 1 : -1); });
  var mon = D.model.mondayOf(D.model.todayStr()), last = D.model.addDays(mon, -7), groups = [], idx = {};
  list.slice(0, S.doneLimit).forEach(function (i) {
    var d = i.meta['done-date'] || '', k;
    if (!D.model.isDay(d)) k = 'Undated';
    else if (d >= mon) k = 'This week';
    else if (d >= last) k = 'Last week';
    else { var x = D.model.pd(d); k = D.model.MONL[x.getMonth()] + ' ' + x.getFullYear(); }
    if (!(k in idx)) { idx[k] = groups.length; groups.push({ k: k, items: [] }); }
    groups[idx[k]].items.push(i);
  });
  var b = groups.map(function (g) { return D.views.vSec('d-' + g.k, g.k, D.views.rowsOf(g.items)); }).join('');
  if (!list.length) b = D.views.vSec('d-none', 'Nothing yet', [], { count: '', empty: 'Completed tasks appear here.' });
  if (list.length > S.doneLimit) b += '<div class="toolbar">' + D.views.bt('Show ' + Math.min(60, list.length - S.doneLimit) + ' more', 'done-more') + '<span class="hint">' + (list.length - S.doneLimit) + ' older not shown</span></div>';
  return { title: 'Done', sub: D.model.plural(list.length, 'completed item') + ' · newest first · untick one to reopen it', body: '<div class="list">' + b + '</div>' };
}

Object.assign(D.views, {
  viewToday: viewToday, vCards: vCards, vQuick: vQuick, vItemChanges: vItemChanges, viewInbox: viewInbox,
  viewNext: viewNext, viewWaiting: viewWaiting, viewUpcoming: viewUpcoming, viewFyi: viewFyi, viewAll: viewAll,
  viewDone: viewDone
});
})();
