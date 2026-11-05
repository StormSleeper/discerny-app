// The views concern, part four: the Side panel, from state alone.
// It uses model and links, and from files only Q and srv. It never changes state, never calls ops and never uses the DOM or fetch.
(function () {
'use strict';
var S = D.model.S;

/* ===================== the details panel ===================== */
function copyId(id) { var copied = S.copied === id; return '<button type="button" class="idbtn" data-act="copy" data-id="' + D.views.esc(id) + '" aria-label="' + (copied ? 'Copied ' : 'Copy ID ') + D.views.esc(id) + '">' + D.views.ic(copied ? 'check' : 'copy', 's') + (copied ? 'Copied' : D.views.esc(id)) + '</button>'; }
function panelHead(id, kindText, openPage) {
  return '<div class="ph">' + copyId(id) +
    '<span class="hint" style="flex:1;min-width:0">' + D.views.esc(kindText) + '</span>' + (S.fresh.has(id) ? D.views.badge('Updated', 'info') : '') +
    (openPage ? '<button type="button" class="btn sm quiet" data-act="any-page" data-id="' + D.views.esc(id) + '">Open page</button>' : '') +
    '<button type="button" class="xbtn" data-act="copy-link" data-id="' + D.views.esc(id) + '" aria-label="Copy link" title="Copy link">' + D.views.ic('link') + '</button>' +
    '<button type="button" class="xbtn" data-act="close" aria-label="Close details" title="Close (Esc)">' + D.views.ic('x') + '</button></div>';
}
function vTabs(id, nLinks, nAsks) {
  return '<div class="tabs" data-k="tabs" role="tablist" aria-label="Sections">' + [['details', 'Details'], ['links', 'Relationships' + (nLinks ? ' (' + nLinks + ')' : '')], ['claude', 'Agent' + (nAsks ? ' (' + nAsks + ')' : '')]].map(function (t) {
    var on = S.tab === t[0];
    return '<button type="button" role="tab" class="tab" id="tab-' + t[0] + '"' + (on ? ' aria-controls="tp-' + t[0] + '"' : '') + ' aria-selected="' + on + '" tabindex="' + (on ? '0' : '-1') + '" data-act="tab" data-v="' + t[0] + '">' + D.views.esc(t[1]) + '</button>';
  }).join('') + '</div>';
}
function tabPanel(name, html) { return '<div role="tabpanel" id="tp-' + name + '" aria-labelledby="tab-' + name + '" class="fields" data-k="tp-' + name + '">' + html + '</div>'; }
function fRow(label, forId, ctl, top) { return '<div class="f' + (top ? ' top' : '') + '" data-k="row-' + D.views.slug(forId || label) + '">' + (forId ? '<label class="lbl" for="' + forId + '">' + D.views.esc(label) + '</label>' : '<span class="lbl">' + D.views.esc(label) + '</span>') + '<div class="ctl">' + ctl + '</div></div>'; }
function vLinked(id) {
  var rels = D.model.relsOf(id);
  return '<section data-k="sec-linked"><h3 class="h3">Related</h3>' + (rels.length ? rels.map(function (r) {
    var lab = D.model.labelOf(r.other);
    return '<div class="lrow" data-k="l-' + D.views.esc(r.raw) + '"><span class="kind">' + D.views.esc(D.model.relWord(r)) + '</span><button type="button" class="grow" data-act="any" data-id="' + r.other + '">' + D.views.esc(lab === null ? r.other + ' (not found)' : lab) + '</button><span class="id">' + r.other + '</span>' +
      '<button type="button" class="xbtn" data-act="rel-del" data-v="' + D.views.esc(r.raw) + '" aria-label="Remove relationship with ' + r.other + '">' + D.views.ic('x', 's') + '</button></div>';
  }).join('') : '<div class="empty">No relationships yet.</div>') + '</section>';
}
// the relate search: o.kind ('All', an Item type, 'Person', 'Project' or 'System') and o.done (search DONE.md too) -> {list, more} or null
var LINK_KINDS = ['All', 'Task', 'Meeting', 'Process', 'Document', 'FYI', 'Person', 'Project', 'System'], LINK_MAX = 50;
function linkCands(id, mode, q, o) {
  o = o || {};
  q = String(q || '').trim().toLowerCase();
  if (!q) return null;
  var linked = {}, blocked = mode === 'blocked', kind = o.kind || 'All';
  D.model.relsOf(id).forEach(function (r) { linked[r.other] = 1; });
  var t = kindOf(id) === 'T' ? D.model.item(id) : null;
  if (t) depList(t).forEach(function (x) { linked[x] = 1; });
  var c = [];
  function addItem(x, done) { if (x.id !== id && !linked[x.id] && (!blocked || !D.model.dependsOn(x.id, id))) c.push({ id: x.id, label: x.title, kind: TYPE_NAME[x.meta.type] || TYPE_NAME.task, done: done, at: String((done ? x.meta['done-date'] : receivedOf(x.meta)) || ''), hay: x.id + ' ' + x.title }); }
  D.model.openList().concat(S.m.inbox.items).forEach(function (x) { addItem(x, false); });
  if (!blocked && o.done) S.m.done.items.forEach(function (x) { addItem(x, true); });
  if (!blocked) {
    D.model.activePeople().forEach(function (p) { if (p.meta.id && !linked[p.meta.id]) c.push({ id: p.meta.id, label: p.name, kind: 'Person', at: '', hay: p.meta.id + ' ' + p.name + ' ' + (p.meta.title || '') }); });
    D.model.entsOf('PRJ').concat(D.model.entsOf('SYS')).forEach(function (x) { if (x.meta.id && !linked[x.meta.id]) c.push({ id: x.meta.id, label: x.name, kind: D.model.KIND_WORD[kindOf(x.meta.id)], at: '', hay: x.meta.id + ' ' + x.name }); });
  }
  var words = q.split(/\s+/);
  c = c.filter(function (x) {
    return x.id !== id && (blocked || !relLine(id, x.id).err) && (kind === 'All' || x.kind === kind) &&
      words.every(function (w) { return x.hay.toLowerCase().indexOf(w) >= 0; });
  });
  function rank(x) { return x.id.toLowerCase() === q ? 0 : (x.label.toLowerCase().indexOf(q) === 0 ? 1 : 2); }
  function num(x) { return parseInt(x.id.split('-')[1], 10) || 0; }
  c.sort(function (a, b) { return rank(a) - rank(b) || (!!a.done - !!b.done) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || num(b) - num(a); });
  return { list: c.slice(0, LINK_MAX), more: Math.max(0, c.length - LINK_MAX) };
}
function vPicks(res, act, none) {
  if (!res) return '';
  if (!res.list.length) return '<div class="hint">' + none + '</div>';
  return '<div class="picks" data-k="picks">' + res.list.map(function (x) {
    return '<button type="button" class="pick" data-act="' + act + '" data-v="' + x.id + '"><span class="kind hint">' + D.views.esc(x.kind) + '</span><span style="flex:1;min-width:0">' + D.views.esc(x.label) + '</span>' + (x.done ? D.views.badge('Done', 'ok') : '') + '<span class="id">' + x.id + '</span></button>';
  }).join('') + '</div>' + (res.more ? '<div class="hint">' + res.more + ' more, refine your search.</div>' : '');
}
// the Items that can merge with id (not itself, never a Meeting), matching every word of q in their ID or title -> {list, more} or null
function mergeCands(id, q) {
  q = String(q || '').trim().toLowerCase();
  var me = D.model.item(id);
  if (!q || !me) return null;
  var words = q.split(/\s+/), c = [];
  D.model.allItems().forEach(function (x) {
    var hay = (x.id + ' ' + x.title).toLowerCase(), w = D.model.whereOf(x.id);
    if (canMerge(me, x) && words.every(function (v) { return hay.indexOf(v) >= 0; })) c.push({ id: x.id, label: x.title, kind: w === 'inbox' ? 'Proposal' : D.model.TYPE_WORD[x.meta.type || 'task'] || x.meta.type, done: w === 'done', at: String((w === 'done' ? x.meta['done-date'] : receivedOf(x.meta)) || '') });
  });
  function rank(x) { return x.id.toLowerCase() === q ? 0 : (x.label.toLowerCase().indexOf(q) === 0 ? 1 : 2); }
  c.sort(function (a, b) { return rank(a) - rank(b) || (!!a.done - !!b.done) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || D.model.idNum(b.id) - D.model.idNum(a.id); });
  return { list: c.slice(0, LINK_MAX), more: Math.max(0, c.length - LINK_MAX) };
}
// on an Item's page: find the duplicate to merge into it
function vMerge(id) {
  if (S.mergeFor !== id) return '';
  return '<section class="box" data-k="sec-merge"><label class="h3" for="f-mergeq" style="margin:0">Merge a duplicate into this</label>' +
    '<div class="hint">The duplicate goes. Its fields, Description, Comments, URLs and links join this item, which keeps ' + id + '.</div>' +
    '<input id="f-mergeq" class="in" type="search" autocomplete="off" data-in="mergeQ" data-kd="mergeq" data-id="' + id + '" value="' + D.views.esc(S.mergeQ) + '" placeholder="Find the duplicate">' +
    vPicks(mergeCands(id, S.mergeQ), 'merge-pick', 'No match. Meetings never merge.') + '<div>' + D.views.lk('Cancel', 'merge-cancel') + '</div></section>';
}
function vLinkAdd(id, allowBlocked) {
  var mode = allowBlocked ? S.linkMode : 'related', blocked = mode === 'blocked';
  var kinds = blocked ? LINK_KINDS.slice(0, 6) : LINK_KINDS, kind = kinds.indexOf(S.linkKind) >= 0 ? S.linkKind : 'All';
  var res = linkCands(id, mode, S.linkQ, { kind: kind, done: S.linkDone });
  var h = '<section class="box" data-k="sec-linkadd"><div class="ctl" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span class="lbl" style="font-weight:600">Add</span>';
  if (allowBlocked) h += '<div class="seg" role="group" aria-label="Kind of relationship">' + [['related', 'Relate to item'], ['blocked', 'Depends on']].map(function (m) { return '<button type="button" data-act="link-mode" data-v="' + m[0] + '"' + D.views.pressed(mode === m[0]) + '>' + m[1] + '</button>'; }).join('') + '</div>';
  h += '</div><div class="pills" role="group" aria-label="Search only">' + kinds.map(function (k) { return '<button type="button" class="chipbtn" data-act="link-kind" data-v="' + k + '"' + D.views.pressed(kind === k) + '>' + k + '</button>'; }).join('') +
    (blocked ? '' : '<label class="hint" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-ch="link-done"' + (S.linkDone ? ' checked' : '') + '>Include done</label>') + '</div>';
  h += '<label class="sr" for="f-linkq">Find an item to relate</label><input id="f-linkq" class="in" type="search" autocomplete="off" data-in="linkQ" data-kd="linkq" value="' + D.views.esc(S.linkQ) + '" placeholder="' + (blocked ? 'Find the item this depends on' : 'Find an item, person, project or system') + '">';
  h += vPicks(res, 'link-add', 'No match' + (blocked ? ' (open items that already depend on this one are left out, to avoid a loop)' : '') + '.');
  return h + '</section>';
}
// the URLs on an Item or Record (link: lines), each removable, and a form to add one
function vUrls(id, ls) {
  return '<section data-k="sec-weblinks"><h3 class="h3">URLs</h3>' + ls.map(function (l) { return '<div class="lrow" data-k="wl-' + D.views.esc(l.raw) + '">' + D.views.linkA(l) + '<span style="flex:1"></span><button type="button" class="xbtn" data-act="e-link-del" data-id="' + id + '" data-v="' + D.views.esc(l.raw) + '" aria-label="Remove URL ' + D.views.esc(l.label) + '">' + D.views.ic('x', 's') + '</button></div>'; }).join('') +
    '<div class="pills" style="margin-top:6px"><label class="sr" for="ef-ll">URL label</label><input id="ef-ll" class="in" type="text" data-in="linkLabel" data-kd="e-link" data-id="' + id + '" value="' + D.views.esc(S.linkLabel) + '" placeholder="Label" style="width:120px"><label class="sr" for="ef-lu">URL</label><input id="ef-lu" class="in" type="url" data-in="linkUrl" data-kd="e-link" data-id="' + id + '" value="' + D.views.esc(S.linkUrl) + '" placeholder="https://…" style="flex:1;min-width:140px">' + D.views.bt('Add URL', 'e-link-add', { id: id, cls: 'sm' }) + '</div></section>';
}
/* Descriptions and Comments */
var AUTHOR_WORD = { user: 'You', agent: 'Agent' };
// who wrote a Comment: You, Agent, or the Skill's word with a capital (Email, Calendar)
function authorOf(c) { var a = c.f.author || ''; return AUTHOR_WORD[a] || (a ? a.charAt(0).toUpperCase() + a.slice(1) : 'Unknown'); }
function whenOf(c) { var at = c.f['added-datetime']; return at ? D.model.fmtDT(at) : 'Earlier'; }
function changeText(g) { return (D.model.CHANGE_WORD[g.field] || g.field) + ': ' + D.model.changeVal(g.field, g.from) + ' → ' + D.model.changeVal(g.field, g.to); }
function vCmtText(c) { var g = fieldChange(c); return (g ? '<div class="cmt-chg">' + D.views.esc(changeText(g)) + '</div>' : '') + '<div class="cmt-t">' + D.views.esc(c.v) + '</div>'; }
// the Description on a Project's, System's or Person's page, a paragraph to each block of lines
function vDescText(x) { return descOf(x).split(/\n\s*\n/).filter(function (p) { return p.trim(); }).map(function (p) { return '<div class="ent-note pre">' + D.views.esc(p) + '</div>'; }).join(''); }
// the Details tab's Description box and Comments, oldest first, the undated ones shown as Earlier. Edit on the User's own, Delete on any.
function vDescComments(id, x, hint) {
  var list = commentsOf(x);
  var d = '<section data-k="sec-desc"><label class="h3" for="f-desc" style="display:block">Description</label><textarea id="f-desc" class="in" rows="4" data-ch="desc" data-id="' + id + '" placeholder="' + D.views.esc(hint) + '">' + D.views.esc(descOf(x)) + '</textarea></section>';
  var rows = byTime(list).map(function (c) {
    var k = list.indexOf(c), editing = S.cmtEdit === id + '|' + k && c.f.author === 'user';
    var head = '<div class="cmt-h"><span>' + D.views.esc(whenOf(c)) + ' · ' + D.views.esc(authorOf(c)) + '</span>' + (toAck(c) ? D.views.badge('New', 'info') : '') +
      (editing ? '' : '<span class="cmt-a">' + (c.f.author === 'user' ? D.views.lk('Edit', 'cmt-edit', { id: id, v: k }) : '') + D.views.lk('Delete', 'cmt-del', { id: id, v: k, attrs: ' aria-label="Delete the comment from ' + D.views.esc(whenOf(c)) + '"' }) + '</span>') + '</div>';
    var body = editing ? '<label class="sr" for="cmt-edit">Edit your comment</label><textarea id="cmt-edit" class="in" rows="3" data-in="cmtEditText" data-kd="cmt-edit" data-id="' + id + '" style="width:100%">' + D.views.esc(S.cmtEditText) + '</textarea>' +
      '<div class="reasons">' + D.views.bt('Save', 'cmt-save', { id: id, v: k, cls: 'primary sm' }) + D.views.lk('Cancel', 'cmt-cancel') + '</div>' : vCmtText(c);
    return '<div class="cmt" data-k="cmt-' + k + '-' + D.views.esc(c.f['added-datetime'] || '') + '">' + head + body + '</div>';
  }).join('');
  var add = '<label class="sr" for="f-cmt">Add a comment</label><textarea id="f-cmt" class="in" rows="2" data-in="cmtDraft" data-kd="cmt" data-id="' + id + '" placeholder="Add a comment" style="width:100%">' + D.views.esc(S.cmtDraft) + '</textarea>' +
    '<div class="pills">' + D.views.bt('Add a comment', 'cmt-add', { id: id, cls: 'sm' }) + '<span class="hint">Ctrl Enter also adds it.</span></div>';
  return d + '<section data-k="sec-cmts"><h3 class="h3">Comments' + (list.length ? ' <span class="n">' + list.length + '</span>' : '') + '</h3>' + rows + add + '</section>';
}
function vClaudeTab(id) {
  var asks = D.model.asksFor(id), drafts = D.model.draftsFor(id), log = D.model.logFor(id);
  var h = '<section data-k="sec-queued"><h3 class="h3">Queued for the agent</h3>' + (asks.length ? asks.map(function (n) { return D.views.vAskItem(n, false); }).join('') : '<div class="empty">Nothing queued for this ' + (D.model.KIND_WORD[kindOf(id)] || 'item').toLowerCase() + '.</div>') + '</section>';
  h += '<section class="box" data-k="sec-ask"><label class="h3" for="f-composer" style="margin:0">Ask the agent about this</label><div class="pills">' + D.model.promptsFor(id).map(function (p) { return '<button type="button" class="chipbtn" data-act="prompt" data-v="' + D.views.esc(p) + '">' + D.views.esc(p) + '</button>'; }).join('') + '</div>' +
    '<textarea id="f-composer" class="in" rows="4" data-in="composer" data-kd="composer" placeholder="A correction, a question, ‘split this up’, ‘draft a reply’…">' + D.views.esc(S.composer[id] || '') + '</textarea>' +
    '<div class="pills">' + D.views.bt('Queue for the agent', 'ask-add', { cls: 'primary' }) + '<span class="hint">Your agent picks it up the next time you run discern-ask-agent. Ctrl Enter also queues.</span></div></section>';
  drafts.forEach(function (d) { h += '<section data-k="dr-' + D.views.esc(d.name) + '"><h3 class="h3">Draft from the agent</h3><div class="hint">drafts/' + D.views.esc(d.name) + ' · not sent</div><div class="draft">' + D.views.esc(d.text) + '</div></section>'; });
  if (log.length) h += '<section data-k="sec-log"><h3 class="h3">Done by the agent</h3>' + log.slice().reverse().map(function (l) { return '<div class="ctx"><span class="hint">' + D.views.esc(D.model.fmtDT(l.at)) + '</span> · ' + D.views.esc(l.did) + '</div>'; }).join('') + '</section>';
  return h;
}
function panelTask(i) {
  var id = i.id, w = D.model.whereOf(id), inbox = w === 'inbox', done = w === 'done';
  var due = dueOf(i.meta), got = receivedOf(i.meta), rels = D.model.relsOf(id), deps = depList(i), blocks = D.model.blocksOf(id), asks = D.model.asksFor(id);
  var h = panelHead(id, (inbox ? 'Proposal · ' : '') + (D.model.TYPE_WORD[i.meta.type || 'task'] || i.meta.type) + ' · ' + D.model.listName(i), false);
  if (inbox) h += '<div class="note" data-k="note-inbox">Proposed by the agent from ' + D.views.esc(D.model.srcKind(i)) + (got ? ' on ' + D.views.esc(D.model.fmtDT(got)) : '') + '. Correct anything below, then accept or dismiss.</div>';
  if (done) h += '<div class="note ok" data-k="note-done" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span style="flex:1">Done on ' + D.views.esc(i.meta['done-date'] ? D.model.fmt(i.meta['done-date']) : 'an earlier date') + '.</span>' + D.views.bt('Reopen', 'reopen', { id: id, cls: 'sm' }) + '</div>';
  if (D.links.nav.offView === id) h += '<div class="note warn" data-k="note-off-view" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span style="flex:1">' + id + ' isn’t on this View.</span>' + D.views.bt('Go to ' + D.views.navName(D.model.homeView(i)), 'home-view', { id: id, cls: 'sm' }) + '</div>';
  h += '<label class="sr" for="f-title">Title</label><textarea id="f-title" class="title-in" rows="2" data-ch="title" data-kd="title" data-id="' + id + '">' + D.views.esc(i.title) + '</textarea>';
  if (!done) h += '<div class="pills" data-k="row-status"><div class="seg" data-k="seg-status" role="group" aria-label="Status">' + STATUS.map(function (x) { return '<button type="button" data-act="status" data-id="' + id + '" data-v="' + D.views.esc(x) + '"' + D.views.pressed((i.meta.status || '') === x) + '>' + D.views.esc(STATUS_LABEL[x]) + '</button>'; }).join('') + '</div>' + D.views.doneBtn(i, '') + '</div>';
  h += vTabs(id, rels.length + deps.length, asks.length);
  if (S.tab === 'links') {
    var x = '<section data-k="sec-blockers"><h3 class="h3">Depends on</h3>' + (deps.length ? deps.map(function (d) {
      var t = D.model.item(d), op = D.model.whereOf(d) === 'open';
      return '<div class="lrow" data-k="dep-' + d + '">' + D.views.badge(t ? (op ? 'Open' : (D.model.whereOf(d) === 'done' ? 'Done' : 'In inbox')) : 'Not found', op ? 'danger' : 'ok') + '<button type="button" class="grow" data-act="open" data-id="' + d + '">' + D.views.esc(t ? t.title : d) + '</button><span class="id">' + d + '</span>' +
        '<button type="button" class="xbtn" data-act="dep-del" data-id="' + id + '" data-v="' + d + '" aria-label="Remove dependency on ' + d + '">' + D.views.ic('x', 's') + '</button></div>';
    }).join('') : '<div class="empty">Nothing. This can start now.</div>') + '</section>';
    x += '<section data-k="sec-blocks"><h3 class="h3">Needed by</h3>' + (blocks.length ? blocks.map(function (b) { return '<div class="lrow" data-k="blk-' + b.id + '"><button type="button" class="grow" data-act="open" data-id="' + b.id + '">' + D.views.esc(b.title) + '</button><span class="id">' + b.id + '</span></div>'; }).join('') : '<div class="empty">Nothing depends on this one.</div>') + '</section>';
    x += vLinked(id) + vLinkAdd(id, true);
    h += tabPanel('links', x);
  } else if (S.tab === 'claude') {
    h += tabPanel('claude', vClaudeTab(id));
  } else {
    var who = D.model.realWho(i), known = !who || !!D.model.personByName(who);
    var whenText = 'No due date';
    if (D.model.isDay(due)) whenText = D.model.fmt(due) + ', ' + D.model.relDays(D.model.dd(due));
    var f = fRow('Due', 'f-due', '<input id="f-due" class="in" type="date" data-ch="due" data-id="' + id + '" value="' + D.views.esc(due.slice(0, 10)) + '"><label class="sr" for="f-time">Due time</label><input id="f-time" class="in" type="time" data-ch="due-time" data-id="' + id + '" value="' + D.views.esc(D.model.timeOf(due)) + '"><span class="hint">' + D.views.esc(whenText) + '</span>' + (D.model.canSnooze(i) ? '<div style="flex-basis:100%">' + D.views.vSnooze(id) + '</div>' : ''));
    if (!D.model.isDay(due)) f += fRow('Urgency', 'f-urg', '<select id="f-urg" class="in" data-ch="urg" data-id="' + id + '">' + D.views.opts(URG_ORDER.map(function (u) { return [u, URG[u]]; }), i.meta.urgency || 'later') + '</select>');
    f += fRow('Priority', 'f-p', '<select id="f-p" class="in" data-ch="p" data-id="' + id + '">' + D.views.opts([['high', PRIORITY_LABEL.high], ['medium', 'Normal'], ['low', PRIORITY_LABEL.low]], i.meta.priority || 'medium') + '</select>');
    var ty = i.meta.type || 'task', tyl = D.model.QA_TYPES.map(function (t) { return [t, D.model.TYPE_WORD[t]]; });
    if (TYPES.indexOf(ty) < 0) tyl.push([ty, ty]);
    f += fRow('Type', 'f-ty', '<select id="f-ty" class="in" data-ch="ty" data-id="' + id + '">' + D.views.opts(tyl, ty) + '</select>');
    f += fRow(D.model.whoLabel(i), 'f-who', '<input id="f-who" class="in" type="text" list="dl-people" autocomplete="off" data-ch="who" data-id="' + id + '" value="' + D.views.esc(who) + '">' +
      (known ? '' : '<div class="hint" style="flex-basis:100%">Not in People yet. ' + D.views.lk('Add ' + who + ' to People', 'add-person', { v: who, id: id }) + '</div>'), !known);
    var ps = prjOf(i), pq = S.newPrj.trim(), hit = pq ? D.model.resolvePrj(pq) : null;
    var chips = ps.map(function (p) {
      var e = D.model.entById(p);
      return '<span class="tag prj">' + (e ? '<button type="button" class="tl" data-act="ent" data-id="' + p + '" title="Open ' + D.views.esc(D.model.entPath(p)) + '">' + D.views.esc(D.model.short(e.name, 34)) + '</button>' : D.views.esc(p) + ' (missing)') +
        '<button type="button" class="xbtn" data-act="prj-del" data-id="' + id + '" data-v="' + D.views.esc(p) + '" aria-label="Remove from ' + D.views.esc(e ? e.name : p) + '">' + D.views.ic('x', 's') + '</button></span>';
    }).join('');
    f += fRow('Projects', 'f-prj', chips + '<input id="f-prj" class="in" type="text" list="dl-prj" autocomplete="off" data-in="newPrj" data-kd="prj" data-id="' + id + '" value="' + D.views.esc(S.newPrj) + '" placeholder="Add to a project, Enter" style="width:100%">' +
      (pq ? '<div class="hint" style="flex-basis:100%">' + (hit ? (ps.indexOf(hit.meta.id) >= 0 ? 'Already in “' + D.views.esc(hit.name) + '”.' : 'Enter adds it to “' + D.views.esc(hit.name) + '”.') : 'Enter creates a new project “' + D.views.esc(D.model.cleanName(pq)) + '”.') + '</div>' : ''), true);
    var sysRels = rels.filter(function (r) { return kindOf(r.other) === 'SYS'; });
    f += fRow('Systems', 'f-sys', sysRels.map(function (r) {
      var e = D.model.entById(r.other);
      return '<span class="tag">' + (e ? '<button type="button" class="tl" data-act="ent" data-id="' + r.other + '" title="Open ' + D.views.esc(e.name) + '">' + D.views.esc(D.model.short(e.name, 34)) + '</button>' : D.views.esc(r.other) + ' (missing)') +
        '<button type="button" class="xbtn" data-act="rel-del" data-v="' + D.views.esc(r.raw) + '" aria-label="Remove ' + D.views.esc(e ? e.name : r.other) + '">' + D.views.ic('x', 's') + '</button></span>';
    }).join('') + '<input id="f-sys" class="in" type="search" autocomplete="off" data-in="sysQ" data-kd="sys" data-id="' + id + '" value="' + D.views.esc(S.sysQ) + '" placeholder="Find a system" style="width:100%">' +
      '<div style="flex-basis:100%">' + vPicks(linkCands(id, 'related', S.sysQ, { kind: 'System' }), 'sys-add', 'No system matches.') + '</div>', true);
    f += fRow('Tags', 'f-tag', tagsOf(i).map(function (t) { return '<span class="tag">' + D.views.esc(t) + '<button type="button" class="xbtn" data-act="tag-del" data-id="' + id + '" data-v="' + D.views.esc(t) + '" aria-label="Remove tag ' + D.views.esc(t) + '">' + D.views.ic('x', 's') + '</button></span>'; }).join('') +
      '<input id="f-tag" class="in" type="text" list="dl-tags" autocomplete="off" data-in="tagDraft" data-kd="tag" data-id="' + id + '" value="' + D.views.esc(S.tagDraft) + '" placeholder="Add tag, Enter" style="width:150px">', true);
    f += fRow('Assigned', 'f-asg', '<input id="f-asg" class="in" type="datetime-local" data-ch="asg" data-id="' + id + '" value="' + D.views.esc(D.model.isDay(got) ? got.slice(0, 16).replace(' ', 'T') : '') + '"><span class="hint">from ' + D.views.esc(D.model.srcKind(i)) + '</span>');
    var subs = D.model.subsOf(i), nd = subs.filter(function (s) { return s.x; }).length;
    var sb = '<section data-k="sec-subs"><h3 class="h3">Sub-tasks' + (subs.length ? ' <span class="n">' + nd + ' of ' + subs.length + ' done</span>' : '') + '</h3>' + subs.map(function (s, k) {
      var cid = 'sub-' + k;
      return '<div class="subrow' + (s.x ? ' x' : '') + '" data-k="sub-' + k + '-' + D.views.esc(s.v) + '"><input type="checkbox" id="' + cid + '" data-ch="sub" data-id="' + id + '" data-i="' + k + '"' + (s.x ? ' checked' : '') + '><label for="' + cid + '">' + D.views.esc(s.v) + '</label>' +
        '<button type="button" class="xbtn" data-act="sub-del" data-id="' + id + '" data-i="' + k + '" aria-label="Remove sub-task: ' + D.views.esc(s.v) + '">' + D.views.ic('x', 's') + '</button></div>';
    }).join('') + '<label class="sr" for="f-sub">New sub-task</label><input id="f-sub" class="in" type="text" autocomplete="off" data-in="subDraft" data-kd="sub" data-id="' + id + '" value="' + D.views.esc(S.subDraft) + '" placeholder="Add a sub-task and press Enter" style="width:100%"></section>';
    var src = D.model.srcOf(i), ls = D.model.linksOf(i);
    var ctx = (src.length ? '<section data-k="sec-ctx">' + src.map(function (t) { return '<div class="ctx src">Source: ' + D.views.esc(t) + '</div>'; }).join('') + '</section>' : '') +
      vDescComments(id, i, 'What this is and anything worth knowing') + vUrls(id, ls);
    var tail = '';
    if (inbox) {
      var sg = D.model.suggestions(i), il = D.model.inboxList(), pos = il.map(function (x) { return x.id; }).indexOf(id), rq = D.views.vItemChanges(id);
      if (rq) tail += '<div class="box" data-k="rq"><div class="h3" style="margin:0">Proposed relationships</div>' + rq + '</div>';
      if (sg.length) tail += '<div class="box" data-k="sug"><div class="h3" style="margin:0">Looks related</div>' + sg.map(function (g) {
        var cid = 'sg-' + g.id, on = !!S.suggestOn[id + '|' + g.id];
        return '<div class="subrow"><input type="checkbox" id="' + cid + '" data-ch="suggest" data-id="' + id + '" data-v="' + g.id + '"' + (on ? ' checked' : '') + '><label for="' + cid + '"><span class="id">' + g.id + '</span> ' + D.views.esc(g.title) + ' <span class="hint">· ' + D.views.esc(g.why) + '</span></label></div>';
      }).join('') + '<div class="hint">Tick an item to relate it when you accept.</div></div>';
      tail += '<div class="foot" data-k="foot-inbox">' + D.views.bt('Accept', 'accept', { id: id, cls: 'primary' }) + D.views.bt('Dismiss…', 'dismiss-open', { id: id, attrs: ' aria-expanded="' + (S.dismissFor === id) + '"' }) + (pos >= 0 ? '<span class="hint">' + (pos + 1) + ' of ' + il.length + ' in the inbox</span>' : '') + '</div>';
      if (S.dismissFor === id && S.dismissAt === 'panel') tail += D.views.vReasons(id);
    } else {
      var canM = i.meta.type !== 'meeting';
      if (!done || canM) tail += '<div class="foot" data-k="foot-del">' + (canM ? D.views.bt('Merge a duplicate into this…', 'merge-open', { id: id, cls: 'sm', attrs: ' aria-expanded="' + (S.mergeFor === id) + '"' }) : '') +
        (done ? '' : D.views.bt('Delete task', 'del', { id: id, cls: 'danger sm' }) + '<span class="hint">You can undo for a few seconds.</span>') + '</div>';
      if (canM) tail += vMerge(id);
    }
    h += tabPanel('details', f + sb + ctx + tail);
  }
  return h;
}
function panelPerson(p) {
  var id = p.meta.id, rels = D.model.relsOf(id), asks = D.model.asksFor(id);
  var h = panelHead(id, 'Person' + (p.meta.status === 'left' ? ' · left' : ''), !(S.view === 'person' && S.entity === id));
  h += '<h2 data-k="pname" style="margin:0;font:600 18px/1.3 var(--font-d)">' + D.views.esc(p.name) + (D.model.isMe(p) ? ' <span class="hint">(you)</span>' : '') + '</h2>';
  h += vTabs(id, rels.length, asks.length);
  if (S.tab === 'links') h += tabPanel('links', vLinked(id) + vLinkAdd(id, false));
  else if (S.tab === 'claude') h += tabPanel('claude', vClaudeTab(id));
  else {
    var field = function (k, label, list) { return fRow(label, 'pf-' + k, '<input id="pf-' + k + '" class="in" type="text" autocomplete="off"' + (list ? ' list="' + list + '"' : '') + ' data-ch="pf" data-id="' + id + '" data-f="' + k + '" value="' + D.views.esc(k === 'group' ? p.grp : (p.meta[k] || '')) + '" style="width:100%">'); };
    var g = D.model.gaps(p);
    var f = (g.length ? '<div class="note warn" data-k="gapnote">Missing ' + D.views.esc(g.map(function (k) { return D.model.GAP_LABEL[k]; }).join(', ')) + '.</div>' : '') +
      field('company', 'Organisation', 'dl-co') + field('department', 'Department', 'dl-dept') + field('title', 'Job title', 'dl-title') + field('manager', 'Reports to', 'dl-people') + field('group', 'Group', 'dl-pgrp') +
      fRow('External', 'pf-ext', '<input type="checkbox" id="pf-ext" data-ch="p-ext" data-id="' + id + '"' + (D.model.isExt(p) ? ' checked' : '') + '><span class="hint">Outside the company (needs only organisation and job title)</span>') +
      '<div class="f" data-k="row-pst"><span class="lbl" id="l-pst">Status</span><div class="ctl"><div class="seg" role="group" aria-labelledby="l-pst">' + [['', 'Active'], ['left', 'Left']].map(function (s) { return '<button type="button" data-act="p-st" data-id="' + id + '" data-v="' + s[0] + '"' + D.views.pressed((p.meta.status === 'left' ? 'left' : '') === s[0]) + '>' + s[1] + '</button>'; }).join('') + '</div></div></div>' +
      fRow('Last checked', '', '<span>' + D.views.esc(p.meta['checked-date'] ? D.model.fmtY(p.meta['checked-date']) : 'Never') + '</span>' + D.views.bt('Mark checked today', 'check-person', { id: id, cls: 'sm' }));
    f += vDescComments(id, p, 'Who they are and anything worth knowing');
    var hist = getSub(p, 'history');
    if (hist.length) f += '<section data-k="sec-hist"><h3 class="h3">Change history</h3>' + hist.map(function (x) { return '<div class="ctx src">' + D.views.esc(D.views.histText(x)) + '</div>'; }).join('') + '</section>';
    f += '<div class="hint" data-k="hint-names">Names can’t be changed here, because tasks refer to people by name. Edit PEOPLE.md and the tasks together if a name is wrong.</div>';
    f += '<div class="foot" data-k="foot-p">' + D.views.bt('Remove from People', 'p-remove', { id: id, cls: 'danger sm' }) + '<span class="hint">Tasks keep the name. You can undo.</span></div>';
    h += tabPanel('details', f);
  }
  return h;
}
function panelEnt(e) {
  var id = e.meta.id, kind = kindOf(id), kindDef = D.model.EDEF[kind], rels = D.model.relsOf(id), asks = D.model.asksFor(id);
  var h = panelHead(id, kindDef.Word, !(S.entity === id && (S.view === 'project' || S.view === 'system')));
  h += '<label class="sr" for="ef-name">Name</label><input id="ef-name" class="title-in" type="text" data-ch="e-name" data-id="' + id + '" value="' + D.views.esc(e.name) + '">';
  h += vTabs(id, rels.length, asks.length);
  if (S.tab === 'links') h += tabPanel('links', vLinked(id) + vLinkAdd(id, false));
  else if (S.tab === 'claude') h += tabPanel('claude', vClaudeTab(id));
  else {
    var types = kindDef.types.slice(); if (e.meta.type && types.indexOf(e.meta.type) < 0) types.push(e.meta.type);
    var sts = kindDef.sts.slice(); if (e.meta.status && sts.indexOf(e.meta.status) < 0) sts.push(e.meta.status);
    var ex = D.model.entDesc(id);
    var parents = [['', kind === 'PRJ' ? '(no parent project)' : '(not part of another system)']].concat(D.model.entsOf(kind).filter(function (x) { return x.meta.id && ex.indexOf(x.meta.id) < 0; }).map(function (x) { return [x.meta.id, kind === 'PRJ' ? D.model.entPath(x.meta.id) : x.name]; }));
    var f = fRow('Type', 'ef-type', '<select id="ef-type" class="in" data-ch="e-type" data-id="' + id + '">' + D.views.opts([['', '(no type)']].concat(types.map(function (t) { return [t, D.model.cap(t)]; })), e.meta.type || '') + '</select>') +
      fRow('Status', 'ef-st', '<select id="ef-st" class="in" data-ch="e-st" data-id="' + id + '">' + D.views.opts([['', '(no status)']].concat(sts.map(function (t) { return [t, D.model.cap(t)]; })), e.meta.status || '') + '</select>') +
      fRow(kind === 'PRJ' ? 'Parent' : 'Part of', 'ef-parent', '<select id="ef-parent" class="in" data-ch="e-parent" data-id="' + id + '" style="max-width:100%">' + D.views.opts(parents, e.meta[kindDef.pk] || '') + '</select>');
    if (kind === 'SYS') f += fRow('Owner', 'ef-owner', '<input id="ef-owner" class="in" type="text" list="dl-people" autocomplete="off" data-ch="e-owner" data-id="' + id + '" value="' + D.views.esc(e.meta.owner || '') + '" style="width:100%">');
    f += fRow('Group', 'ef-grp', '<input id="ef-grp" class="in" type="text" list="dl-egrp-' + kind + '" autocomplete="off" data-ch="e-grp" data-id="' + id + '" value="' + D.views.esc(e.grp) + '" style="width:100%">');
    var ls = D.model.linksOf(e);
    f += vUrls(id, ls) + vDescComments(id, e, 'What this ' + kindDef.word + ' is and anything worth knowing');
    if (S.confirm === 'del:' + id) {
      var nt = kind === 'PRJ' ? D.model.allItems().filter(function (i) { return prjOf(i).indexOf(id) >= 0; }).length : 0;
      f += '<div class="confirm" data-k="confirm" role="alert"><span style="flex:1;min-width:200px">Delete ' + id + '? Its ' + D.model.plural(rels.length, 'relationship') + ' will be removed' + (nt ? ' and ' + D.model.plural(nt, 'task') + ' will lose this project' : '') + '. You can undo straight after.</span>' + D.views.bt('Delete', 'e-del-yes', { id: id, cls: 'danger sm' }) + D.views.bt('Cancel', 'e-del-no', { cls: 'sm' }) + '</div>';
    } else f += '<div class="foot" data-k="foot-e">' + D.views.bt('Delete ' + kindDef.word, 'e-del', { id: id, cls: 'danger sm' }) + '</div>';
    h += tabPanel('details', f);
  }
  return h;
}
function vPanel() {
  if (!S.panel || !S.sel) return '';
  var k = kindOf(S.sel), body = '', label = D.model.labelOf(S.sel);
  if (label === null) return '';
  if (k === 'T') body = panelTask(D.model.item(S.sel));
  else if (k === 'P') body = panelPerson(D.model.personById(S.sel));
  else body = panelEnt(D.model.entById(S.sel));
  return '<aside class="panel" data-k="panel" aria-label="Details: ' + D.views.esc(D.model.clip(label, 60)) + '"><div class="pin" id="panel-top" tabindex="-1" data-k="pin-' + D.views.esc(S.sel) + '">' + body + '</div></aside>';
}

Object.assign(D.views, {
  copyId: copyId, linkCands: linkCands, vPicks: vPicks, mergeCands: mergeCands, authorOf: authorOf, whenOf: whenOf,
  vCmtText: vCmtText, vDescText: vDescText, vPanel: vPanel
});
})();
