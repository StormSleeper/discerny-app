// The views concern, part one: the markup helpers, rows and sections, and the page's shell, from state alone.
// It uses model and links, and from files only Q and srv. It never changes state, never calls ops and never uses the DOM or fetch.
// This file creates D.views, the other views files add to it, and the rest stays private to each file.
(function () {
'use strict';
var S = D.model.S;

/* ===================== html helpers ===================== */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function badge(text, tone) { return '<span class="b' + (tone ? ' ' + tone : '') + '">' + esc(text) + '</span>'; }
function slug(s) { return String(s).replace(/[^A-Za-z0-9_-]+/g, '_'); }
function dv(k, v) { return v == null || v === '' ? '' : ' data-' + k + '="' + esc(v) + '"'; }
function bt(label, act, o) {
  o = o || {};
  return '<button type="button" class="btn' + (o.cls ? ' ' + o.cls : '') + '" data-act="' + act + '"' + dv('id', o.id) + dv('v', o.v) + (o.attrs || '') + '>' + (o.icon ? ic(o.icon, 's') : '') + esc(label) + '</button>';
}
function lk(label, act, o) { o = o || {}; return '<button type="button" class="link" data-act="' + act + '"' + dv('id', o.id) + dv('v', o.v) + (o.attrs || '') + '>' + esc(label) + '</button>'; }
function opts(list, cur) {
  return list.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('');
}
function pressed(on) { return ' aria-pressed="' + (on ? 'true' : 'false') + '"'; }
var ICONS = {
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  next: '<path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17M11 6h10M11 12h10M11 18h10"/>',
  waiting: '<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>',
  upcoming: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  fyi: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
  all: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  projects: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  systems: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
  review: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 14l2 2 4-4"/>',
  done: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  claude: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16v4M17 18h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/><path d="M9 13h6M12 10l3 3-3 3"/>',
  sideOpen: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M13 9l3 3-3 3"/>',
  sideClose: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M16 9l-3 3 3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  open: '<path d="M7 17 17 7M8 7h9v9"/>'
};
// The Discerny icon in the header's tile, by a path relative to the page so it loads served and opened as a file.
var LOGO = '<img src="icons/discerny-96.png" alt="" width="40" height="40">';
function ic(n, cls) { return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[n] || '') + '</svg>'; }
function linkA(l) {
  var u = D.model.safeUrl(l.url);
  return u ? '<a class="ext" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(l.label) + ic('ext', 's') + '</a>' : '<span class="ctx">' + esc(l.label) + '</span>';
}

/* ===================== rows and sections ===================== */
function vRow(i, o) {
  o = o || {};
  var w = D.model.whereOf(i.id), inbox = w === 'inbox', done = w === 'done', waiting = D.model.isWaiting(i), fyi = i.meta.type === 'fyi' && !done && !inbox, due = dueOf(i.meta);
  var meta = [];
  if (!o.hideProject) { var ps = prjOf(i).map(function (p) { var e = D.model.entById(p); return e ? D.model.short(e.name) : p; }); if (ps.length) meta.push(ps.join(', ')); }
  var who = D.model.realWho(i);
  if (!o.hidePerson && who) meta.push((waiting ? 'waiting on ' : (i.meta.type === 'meeting' ? 'with ' : '')) + who);
  var subs = D.model.subsOf(i);
  if (subs.length) meta.push(subs.filter(function (x) { return x.x; }).length + ' of ' + subs.length + ' sub-tasks');
  if (inbox) meta.push('from ' + D.model.srcKind(i));
  if (done && i.meta['done-date']) meta.push('done ' + D.model.fmt(i.meta['done-date']));
  var badges = '';
  if (S.fresh.has(i.id)) badges += badge('Updated', 'info');
  if (!done) {
    var bl = D.model.openBlockers(i);
    if (bl.length) badges += badge('Depends on ' + bl.join(', '), 'danger');
    if (waiting && !inbox) { var a = D.model.age(i); badges += badge('Waiting ' + D.model.plural(a, 'day'), a >= 14 ? 'warn' : 'info'); }
    if (i.meta.status === 'in progress') badges += badge(STATUS_LABEL['in progress']);
    if (i.meta.priority === 'high') badges += badge(PRIORITY_LABEL.high, 'flag');
    var n = D.model.asksFor(i.id).length;
    if (n) badges += badge(n + ' for agent', 'claude');
    if (D.model.draftsFor(i.id).length) badges += badge('Draft ready', 'claude');
  }
  var wh = D.model.when(i), whenLabel = wh.label;
  if (waiting && D.model.isDay(due)) whenLabel = 'Promised ' + D.model.fmt(due);
  var showWhen = !done && !o.hideWhen && !(waiting && !D.model.isDay(due)) && !(fyi && !D.model.isDay(due));
  var time = o.timeFirst ? D.model.timeOf(due) : '';
  var title = o.waiting ? D.model.waitTitle(i) : i.title;
  var lead = (inbox || fyi) ? '<span class="pip' + (fyi ? ' grey' : '') + '" aria-hidden="true"></span>'
    : '<input type="checkbox" data-ch="done" data-id="' + i.id + '"' + (done ? ' checked' : '') + ' aria-label="' + esc((done ? 'Reopen: ' : 'Mark done: ') + i.title) + '">';
  var acts = '';
  if (inbox) acts = bt('Accept', 'accept', { id: i.id, cls: 'primary sm' }) + doneBtn(i, 'sm') + bt('Dismiss…', 'dismiss-open', { id: i.id, cls: 'sm', attrs: ' aria-expanded="' + (S.dismissFor === i.id) + '"' });
  else if (o.snooze && D.model.canSnooze(i)) acts = bt('Snooze…', 'snooze-open', { id: i.id, cls: 'sm', attrs: ' aria-expanded="' + (S.snoozeFor === i.id) + '"' });
  else if (!done && o.waiting && waiting) acts = bt('Chase', 'chase', { id: i.id, cls: 'sm' }) + bt('Got it', 'gotit', { id: i.id, cls: 'sm' });
  else if (fyi) acts = bt('Acknowledge', 'ack', { id: i.id, cls: 'sm' }) + bt('Make it a task', 'maketask', { id: i.id, cls: 'sm quiet' });
  var reasons = inbox && S.dismissFor === i.id && S.dismissAt !== 'panel' ? vReasons(i.id) : (o.snooze && S.snoozeFor === i.id && D.model.canSnooze(i) ? '<div class="reasons">' + vSnooze(i.id) + lk('Cancel', 'snooze-cancel') + '</div>' : '');
  var sel = S.sel === i.id && S.panel;
  return '<div class="row' + (sel ? ' sel' : '') + (S.cur === i.id ? ' cur' : '') + (done ? ' done' : '') + '" data-k="r-' + i.id + '" data-row="' + i.id + '">' +
    '<div class="lead">' + lead + '</div>' +
    '<div class="body"><button type="button" class="t" data-act="open" data-id="' + i.id + '"' + (sel ? ' aria-current="true"' : '') + '>' + (time ? '<span class="tm">' + time + '</span>' : '') + esc(title) + '</button>' +
    (meta.length ? '<div class="meta">' + esc(meta.join(' · ')) + '</div>' : '') +
    (D.model.firstLine(i) ? '<div class="sum">' + esc(D.model.clip(D.model.firstLine(i), 140)) + '</div>' : '') +
    (o.showTags && tagsOf(i).length ? '<div class="pills">' + tagsOf(i).map(function (t) { return '<button type="button" class="chipbtn" data-act="wb-tag" data-v="' + esc(t) + '"' + pressed(S.wb.tag === t) + ' title="Show only #' + esc(t) + '">#' + esc(t) + '</button>'; }).join('') + '</div>' : '') + (inbox ? D.views.vItemChanges(i.id) : '') + reasons + '</div>' +
    '<div class="right">' + badges + (showWhen ? '<span class="b when' + (wh.tone ? ' ' + wh.tone : '') + '">' + esc(whenLabel) + '</span>' : '') + acts + '<span class="id">' + i.id + '</span></div></div>';
}
var REASONS = ['Not actionable', 'Already handled', 'Duplicate', 'Not mine'];
// Done: on an FYI it reads Acknowledge; on a Proposal it accepts and marks done in one step
function doneBtn(i, cls) { return bt(i.meta.type === 'fyi' ? 'Acknowledge' : 'Done', 'done-now', { id: i.id, cls: cls, attrs: D.model.whereOf(i.id) === 'inbox' ? ' title="Accept and mark done"' : '' }); }
var SNOOZE = [[1, '+1 day'], [3, '+3 days'], [7, '+1 week'], [28, '+4 weeks']];
function vSnooze(id) { return '<div class="seg" data-k="seg-snooze" role="group" aria-label="Snooze ' + id + ' from today">' + SNOOZE.map(function (x) { return '<button type="button" data-act="snooze" data-id="' + id + '" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>'; }
function vReasons(id) {
  if (S.dupFor === id) return '<div class="box" data-k="reasons-dup" style="margin-top:8px"><label class="h3" for="f-dupq" style="margin:0">Which item does ' + id + ' duplicate?</label>' +
    '<div class="hint">It is merged into the item you pick, which keeps its own ID and gains everything ' + id + ' holds.</div>' +
    '<input id="f-dupq" class="in" type="search" autocomplete="off" data-in="dupQ" data-kd="dupq" data-id="' + id + '" value="' + esc(S.dupQ) + '" placeholder="Find the item it duplicates">' +
    D.views.vPicks(D.views.mergeCands(id, S.dupQ), 'dup-pick', 'No match. Meetings never merge.') + '<div>' + lk('Cancel', 'dismiss-cancel') + '</div></div>';
  return '<div class="reasons" data-k="reasons" role="group" aria-label="Why are you dismissing ' + id + '?"><span class="hint">Why?</span>' +
    REASONS.map(function (r) { return '<button type="button" class="chipbtn" data-act="dismiss" data-id="' + id + '" data-v="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') +
    lk('Cancel', 'dismiss-cancel') + '</div>';
}
function vSec(key, title, rows, o) {
  o = o || {};
  var hid = 'h-' + slug(key);
  var count = o.count !== undefined ? o.count : rows.length;
  var h = '<section class="sec" data-k="s-' + esc(key) + '" aria-labelledby="' + hid + '"><div class="sech"><h2 id="' + hid + '">' + esc(title) + '</h2>';
  if (count !== '' && count != null) h += '<span class="n">' + esc(count) + '</span>';
  if (o.hint) h += '<span class="n">· ' + esc(o.hint) + '</span>';
  if (o.link) h += '<span class="sp"></span>' + o.link;
  h += '</div>';
  if (o.sub) h += '<div class="sec-sub">' + esc(o.sub) + '</div>';
  if (rows.length) h += '<div class="rows">' + rows.join('') + '</div>';
  else if (o.empty) h += '<div class="empty">' + esc(o.empty) + '</div>';
  return h + '</section>';
}
function rowsOf(list, o) { return list.map(function (i) { return vRow(i, o); }); }

/* ===================== shell ===================== */
var NAV = [
  ['Focus', [['today', 'Today'], ['inbox', 'Inbox'], ['next', 'Next actions'], ['waiting', 'Waiting for'], ['upcoming', 'Upcoming'], ['fyi', 'FYI'], ['all', 'All items']]],
  ['Knowledge base', [['projects', 'Projects'], ['people', 'People'], ['systems', 'Systems']]],
  ['Reflect', [['review', 'Weekly review'], ['done', 'Done'], ['claude', 'Agent']]]
];
function navName(v) { return NAV.reduce(function (a, g) { return a.concat(g[1]); }, []).filter(function (n) { return n[0] === v; })[0][1]; }
var NAV_COUNTS = { today: 1, inbox: 1, next: 1, waiting: 1, fyi: 1, review: 1, claude: 1 };
function navOn(k) { var v = S.view; return v === k || (k === 'projects' && v === 'project') || (k === 'people' && v === 'person') || (k === 'systems' && v === 'system'); }
function saveState() {
  if (S.moved) return { cls: 'err', text: 'Folder changed' };
  if (D.files.Q.blocked || S.lost) return { cls: 'err', text: S.lost ? (D.files.srv ? 'Server not running' : 'No folder access') : 'Not saved' };
  var n = D.files.Q.jobs.filter(function (j) { return !j.sync; }).length;
  if (n) return { cls: 'busy', text: 'Saving…' };
  return { cls: '', text: 'All changes saved' };
}
var THEME_WORD = { system: 'System', light: 'Light', dark: 'Dark' };
function vSide(c) {
  var rail = D.model.isRail();
  var h = '<nav class="side" data-k="side" aria-label="Lists and pages"><div class="brand"><span class="logo" aria-hidden="true"' + (rail ? ' title="Discerny, version ' + VERSION + '"' : '') + '>' + LOGO + '</span><span class="brand-t hide-rail"><b>Discerny</b><span title="' + esc(S.folder) + '">' + esc(S.folder) + '</span></span></div>' +
    '<button type="button" class="searchbtn" data-act="palette" aria-label="Search or jump to (Ctrl K)"' + (rail ? ' title="Search or jump to (Ctrl K)"' : '') + '>' + ic('search') + '<span class="hide-rail st" aria-hidden="true">Search…</span><span class="kbd hide-rail" aria-hidden="true">Ctrl K</span></button>';
  NAV.forEach(function (g) {
    h += '<div class="navh">' + g[0] + '</div>';
    g[1].forEach(function (n) {
      var on = navOn(n[0]), cnt = NAV_COUNTS[n[0]] && c[n[0]] ? String(c[n[0]]) : '';
      h += '<button type="button" class="nav" data-act="go" data-v="' + n[0] + '"' + (on ? ' aria-current="page"' : '') + ' aria-label="' + esc(n[1] + (cnt ? ', ' + cnt : '')) + '"' + (rail ? ' title="' + esc(n[1]) + '"' : '') + '>' + ic(n[0]) + '<span class="hide-rail">' + esc(n[1]) + '</span><span class="cnt" aria-hidden="true">' + cnt + '</span></button>';
    });
  });
  var st = saveState();
  h += '<div class="side-foot"><div class="status" role="status" aria-live="polite" title="' + esc(st.text) + '"><span class="dot' + (st.cls ? ' ' + st.cls : '') + '" aria-hidden="true"></span><span class="' + (rail ? 'sr' : '') + '">' + esc(st.text) + '</span></div>' +
    '<button type="button" class="foot-btn" data-act="folder" aria-label="Change folder"' + (rail ? ' title="Change folder"' : '') + '>' + ic('folder') + '<span class="hide-rail" aria-hidden="true">Change folder</span></button>' +
    '<button type="button" class="foot-btn" data-act="theme" aria-label="Theme: ' + THEME_WORD[S.theme] + '. Click to change"' + (rail ? ' title="Theme: ' + THEME_WORD[S.theme] + '"' : '') + '>' + ic(S.theme === 'dark' ? 'moon' : S.theme === 'light' ? 'sun' : 'auto') + '<span class="hide-rail" aria-hidden="true">Theme: ' + THEME_WORD[S.theme] + '</span></button>' +
    '<button type="button" class="foot-btn" data-act="side" aria-label="' + (rail ? 'Expand sidebar' : 'Collapse sidebar') + '"' + (rail ? ' title="Expand sidebar"' : '') + '>' + ic(rail ? 'sideOpen' : 'sideClose') + '<span class="hide-rail" aria-hidden="true">Collapse sidebar</span></button>' +
    '<button type="button" class="foot-btn" data-act="keys" aria-label="Keyboard shortcuts"' + (rail ? ' title="Keyboard shortcuts (?)"' : '') + '>' + ic('keys') + '<span class="hide-rail" aria-hidden="true">Keyboard shortcuts</span></button>' +
    '<span class="ver hide-rail">Version ' + VERSION + '</span></div></nav>';
  return h;
}
function vBanner() {
  if (S.moved) return '<div class="banner err" role="alert" data-k="banner"><span class="grow">The Discerny server now serves another folder, so this page no longer reads or saves “' + esc(S.folder) + '”. ' + (D.files.Q.jobs.filter(function (j) { return !j.sync; }).length ? 'Your unsaved changes are kept on screen, and were not written to the other folder. ' : '') + 'Reload to open the folder it serves now.</span>' + bt('Reload', 'reload', { cls: 'primary sm' }) + '</div>';
  if (S.lost && D.files.srv) return '<div class="banner err" role="alert" data-k="banner"><span class="grow">The Discerny server isn’t running. Nothing is lost. ' + (D.files.Q.jobs.filter(function (j) { return !j.sync; }).length ? 'Your unsaved changes are kept on screen. ' : '') + 'Start it again with node tools/discern.mjs serve, then retry.</span>' + bt('Retry', 'reconnect', { cls: 'primary sm' }) + '</div>';
  if (S.lost) return '<div class="banner err" role="alert" data-k="banner"><span class="grow">The browser no longer has permission to use the folder. Nothing is lost: ' + (D.files.Q.jobs.filter(function (j) { return !j.sync; }).length ? 'your unsaved changes are kept on screen until you reconnect.' : 'reconnect to carry on.') + '</span>' + bt('Reconnect', 'reconnect', { cls: 'primary sm' }) + '</div>';
  if (!D.files.Q.blocked) return '';
  var n = D.files.Q.jobs.filter(function (j) { return !j.sync; }).length;
  if (S.confirm === 'discard') return '<div class="banner err" role="alert" data-k="banner"><span class="grow">Discard ' + D.model.plural(n, 'unsaved change') + '? The screen will go back to what is in your files.</span>' + bt('Discard', 'discard-yes', { cls: 'danger sm' }) + bt('Keep them', 'discard-no', { cls: 'sm' }) + '</div>';
  return '<div class="banner err" role="alert" data-k="banner"><span class="grow">Couldn’t save “' + esc(D.files.Q.blocked.job.label || 'change') + '”: ' + esc(D.files.Q.blocked.msg) + '. ' + D.model.plural(n, 'change') + ' waiting, still shown on screen.</span>' + bt('Try again', 'retry', { cls: 'primary sm' }) + bt('Discard…', 'discard', { cls: 'sm' }) + '</div>';
}
// A setting SETTINGS.toml gets wrong costs the User its default and this notice, and nothing else.
function vSettingsNotice() {
  if (!D.model.SET.errors.length) return '';
  return '<div class="banner" role="status" data-k="settings-notice"><span class="grow"><strong>Discerny ignored ' + (D.model.SET.errors.length === 1 ? 'a line' : D.model.SET.errors.length + ' lines') + ' in ' + esc(SETTINGS_FILE) + ':</strong> ' + D.model.SET.errors.map(function (e) { return esc(e.message.replace(SETTINGS_FILE + ' ', '')); }).join('; ') + '. Correct the file, then reload.</span>' + bt('Reload', 'reload', { cls: 'sm' }) + '</div>';
}
function viewFor() {
  switch (S.view) {
    case 'today': return D.views.viewToday();
    case 'inbox': return D.views.viewInbox();
    case 'next': return D.views.viewNext();
    case 'waiting': return D.views.viewWaiting();
    case 'upcoming': return D.views.viewUpcoming();
    case 'fyi': return D.views.viewFyi();
    case 'all': return D.views.viewAll();
    case 'done': return D.views.viewDone();
    case 'projects': return D.views.viewProjects();
    case 'systems': return D.views.viewSystems();
    case 'people': return D.views.viewPeople();
    case 'project': return D.views.viewProject(S.entity);
    case 'system': return D.views.viewSystem(S.entity);
    case 'person': return D.views.viewPerson(S.entity);
    case 'review': return D.views.viewReview();
    case 'claude': return D.views.viewClaude();
  }
  return D.views.viewToday();
}
function vMain(c) {
  var v = viewFor();
  var head = '<header class="head' + (S.scrolled ? ' scrolled' : '') + '" data-k="head"><div class="head-in"><div style="min-width:0">' +
    (v.crumb ? '<button type="button" class="crumb" data-act="go" data-v="' + v.crumb[1] + '">' + ic('back', 's') + esc(v.crumb[0]) + '</button>' : '') +
    '<div class="titles"><h1 id="page-title" tabindex="-1">' + esc(v.title) + '</h1>' + (v.sub ? '<div class="sub">' + esc(v.sub) + '</div>' : '') + '</div></div>' +
    '<div class="head-tools">' + (v.tools || '') + '<button type="button" class="btn sm quiet" data-act="copy-link">' + ic('link', 's') + 'Copy link</button></div></div></header>';
  return '<main class="main" id="main" data-k="main" aria-labelledby="page-title">' + head + '<div class="wrap" data-k="wrap-' + S.view + '">' + vBanner() + vSettingsNotice() + (v.qa ? D.views.vQuick() : '') + (v.cards ? D.views.vCards() : '') + v.body + '</div></main>';
}
function vToasts() {
  return '<div class="toasts" data-k="toasts" role="region" aria-label="Messages" aria-live="polite">' + S.toasts.map(function (t) {
    return '<div class="toast" data-k="t-' + t.id + '"><span class="grow">' + esc(t.text) + '</span>' + (t.undo ? '<button type="button" class="undo" data-act="undo" data-v="' + t.id + '">Undo</button>' : '') +
      '<button type="button" class="xbtn" data-act="toast-x" data-v="' + t.id + '" aria-label="Dismiss message">' + ic('x', 's') + '</button></div>';
  }).join('') + '</div>';
}
function vPalette() {
  var groups = D.links.search(S.palQ), flat = D.model.flatResults(groups), idx = Math.min(S.palI, Math.max(flat.length - 1, 0)), k = 0;
  var body = groups.map(function (g) {
    return '<div role="group" aria-label="' + esc(g.title) + '"><div class="res-h" aria-hidden="true">' + esc(g.title) + (g.more > 0 ? ' · ' + g.more + ' more' : '') + '</div>' + g.items.map(function (it) {
      var n = k++;
      return '<div class="res" role="option" id="pal-i-' + n + '" aria-selected="' + (n === idx) + '" data-act="pal-pick" data-i="' + n + '"><span class="grow"><span>' + esc(it.label) + '</span><span class="sub">' + esc(it.sub) + '</span></span>' + (it.id ? '<span class="id">' + esc(it.id) + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }).join('');
  if (!flat.length) { var gone = D.links.missingId(S.palQ); body = '<div class="empty" style="padding:12px">' + (gone ? esc(gone) + ' isn’t in this Data folder.' : 'No matches.') + '</div>'; }
  return '<div class="dlg-scrim" data-k="dlg-pal" data-act="dlg-bg"><div class="dlg" role="dialog" aria-modal="true" aria-label="Search and commands"><div class="dlg-h">' + ic('search') +
    '<label class="sr" for="pal-q">Search tasks, people, projects and systems</label><input id="pal-q" class="in" type="text" autocomplete="off" spellcheck="false" data-in="palQ" data-kd="pal" value="' + esc(S.palQ) + '" placeholder="Search everything, or type a command" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list"' + (flat.length ? ' aria-activedescendant="pal-i-' + idx + '"' : '') + '>' +
    bt('Esc', 'dlg-close', { cls: 'sm', attrs: ' aria-label="Close search"' }) + '</div><div class="dlg-b" id="pal-list" role="listbox" aria-label="Results">' + body + '</div>' +
    '<div class="dlg-f" aria-hidden="true"><span>↑ ↓ to move</span><span>Enter to open</span><span>Esc to close</span></div></div></div>';
}
var KEYMAP = [['Ctrl K or /', 'Search everything and run commands'], ['N', 'Add an item (quick add)'], ['J  K', 'Move down and up the list'], ['Enter', 'Open the highlighted item'], ['X', 'Mark done or reopen (Undo appears)'], ['A  D', 'Accept or dismiss in the inbox'], ['C', 'Ask the agent about the open item'], ['G then T I N W U F A', 'Go to Today, Inbox, Next, Waiting, Upcoming, FYI, All items'], ['G then P E S R C', 'Go to Projects, People, Systems, Review, Agent'], ['Ctrl Z', 'Undo the last change (outside text boxes)'], ['Esc', 'Close the dialog, then the panel'], ['?', 'This list']];
function vKeys() {
  return '<div class="dlg-scrim" data-k="dlg-keys" data-act="dlg-bg"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="keys-h"><div class="dlg-h"><h2 id="keys-h" style="margin:0;flex:1;font-size:16px">Keyboard shortcuts</h2>' +
    '<button type="button" class="xbtn" data-act="dlg-close" aria-label="Close">' + ic('x') + '</button></div><div class="dlg-pad"><div class="kgrid">' +
    KEYMAP.map(function (k) { return '<span class="mono">' + esc(k[0]) + '</span><span>' + esc(k[1]) + '</span>'; }).join('') + '</div><p class="hint" style="margin:14px 0 0">Single-letter keys work when you are not typing in a box.</p></div></div></div>';
}
// When served, the folder is the server's. A server started on a folder of its own (--dir or DISCERNY_DIR) can't
// switch, so say how to restart it; otherwise the Change folder form asks the server to switch.
function srvSwitch() { return 'This server was started on a folder of its own, so it can’t switch. To open another folder, stop the server (Ctrl C where it runs), run node tools/discern.mjs connect <folder> in the Discerny app folder, and start it again with node tools/discern.mjs serve.'; }
function vFolderForm() {
  var sugs = S.folderSugs.filter(function (s) { return s.folder !== D.files.srv.folder; });
  return '<form class="fform" data-sub="folder-switch" data-k="fform">' +
    (D.files.srv.folder ? '<div><span class="hint">Open now</span><p class="mono" style="margin:2px 0 0;overflow-wrap:anywhere">' + esc(D.files.srv.folder) + '</p></div>' : '') +
    '<label class="fl" for="folder-path">Folder to open<input id="folder-path" class="in mono" type="text" autocomplete="off" spellcheck="false" data-in="folderPath" value="' + esc(S.folderPath) + '" placeholder="The full path of a folder with TASKS.md in it" required' + (S.folderErr ? ' aria-describedby="folder-err" aria-invalid="true"' : '') + '></label>' +
    (S.folderErr ? '<p class="err-t" id="folder-err" role="alert" style="margin:0">' + esc(S.folderErr) + '</p>' : '') +
    (sugs.length ? '<div class="fsugs"><span class="hint">Suggestions</span>' + sugs.map(function (s) { return '<button type="button" class="chipbtn" data-act="folder-sug" data-v="' + esc(s.folder) + '" title="' + esc(s.folder) + '">' + esc(s.name) + '</button>'; }).join('') + '</div>' : '') +
    '<p class="hint" style="margin:0">Your agent works on the folder you open here too.</p>' +
    '<div class="acts"><button type="submit" class="btn primary"' + (S.folderBusy ? ' disabled' : '') + '>' + (S.folderBusy ? 'Opening…' : 'Open folder') + '</button></div></form>';
}
function vFolder() {
  return '<div class="dlg-scrim" data-k="dlg-folder" data-act="dlg-bg"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="folder-h"><div class="dlg-h"><h2 id="folder-h" style="margin:0;flex:1;font-size:16px">' + (D.files.srv.canSwitch ? 'Change folder' : 'Your data folder') + '</h2>' +
    '<button type="button" class="xbtn" data-act="dlg-close" aria-label="Close">' + ic('x') + '</button></div><div class="dlg-pad">' +
    (D.files.srv.canSwitch ? vFolderForm() : '<p class="mono" style="margin:0 0 12px;overflow-wrap:anywhere">' + esc(D.files.srv.folder) + '</p><p class="hint" style="margin:0">' + esc(srvSwitch()) + '</p>') + '</div></div></div>';
}
function vDatalists() {
  var uniq = function (arr) { var o = {}, out = []; arr.forEach(function (v) { if (v && !o[v]) { o[v] = 1; out.push(v); } }); return out.sort(function (a, b) { return a.localeCompare(b); }); };
  var dl = function (id, vals) { return '<datalist id="' + id + '">' + vals.map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join('') + '</datalist>'; };
  var ppl = S.m.people.people;
  return '<div hidden data-k="dls">' + dl('dl-people', uniq(D.model.activePeople().map(function (p) { return p.name; }))) + dl('dl-tags', D.model.allTags()) + dl('dl-prj', D.model.entsOf('PRJ').filter(function (e) { return e.meta.id && (e.meta.status || 'active') !== 'done'; }).map(function (e) { return D.model.entPath(e.meta.id); }).sort()) +
    dl('dl-co', uniq(ppl.map(function (p) { return p.meta.company; }))) + dl('dl-dept', uniq(ppl.map(function (p) { return p.meta.department; }))) + dl('dl-title', uniq(ppl.map(function (p) { return p.meta.title; }))) +
    dl('dl-pgrp', uniq(ppl.map(function (p) { return p.grp; }))) + dl('dl-egrp-PRJ', uniq(D.model.entsOf('PRJ').map(function (e) { return e.grp; }))) + dl('dl-egrp-SYS', uniq(D.model.entsOf('SYS').map(function (e) { return e.grp; }))) + '</div>';
}
var GATE = {
  pick: ['Open your Discerny data folder', 'Choose the folder that holds your TASKS.md. Discerny reads and saves the Markdown files in it; nothing leaves your computer.', 'Choose folder…', 'pick'],
  reconnect: ['Reconnect to your Discerny data folder', 'The browser needs your permission again to use the folder “%s”.', 'Reconnect', 'regrant'],
  wrong: ['That folder has no TASKS.md', 'Pick your Discerny data folder: the one with TASKS.md and PEOPLE.md in it. To start a new one, copy the new_discerny_repo folder that comes with Discerny, and pick the copy.', 'Choose folder…', 'pick'],
  denied: ['Permission wasn’t given', 'Discerny can’t read or save your files without it. Try again and choose Allow.', 'Try again', 'regrant'],
  error: ['Something went wrong', '%s', 'Try again', 'pick'],
  fmtold: ['This folder needs an upgrade', '“%s” is in Format %f, older than the Format %a this version of Discerny reads and writes. Ask your agent to “upgrade my Discerny folder”, or run node tools/discern.mjs upgrade in the Discerny app folder. Then reload this page.', 'Choose a different folder', 'refolder'],
  fmtnew: ['This folder needs a newer Discerny', '“%s” is in Format %f, newer than the Format %a this version of Discerny reads and writes. Get the newer Discerny from github.com/StormSleeper/discerny-app and open the folder with that.', 'Choose a different folder', 'refolder'],
  fmtnext: ['This folder was upgraded by an unreleased Discerny', '“%s” is in Format next: a test build of Discerny upgraded it, so no released version can read it. This version reads and writes Format %a. Restore the backup copy the upgrade made beside the folder.', 'Choose a different folder', 'refolder'],
  nofolder: ['No folder connected', 'Choose the Discerny data folder to open: the one with TASKS.md and PEOPLE.md in it.', '', ''],
  srvdown: ['The Discerny server isn’t running', 'Start it again with node tools/discern.mjs serve in the Discerny app folder, then retry.', 'Retry', 'srvretry'],
  nosupport: ['Open this file in Chrome or Edge', 'This browser can’t edit files in a folder. Discerny needs Google Chrome or Microsoft Edge.', '', ''],
  loading: ['Opening your folder…', 'Reading your files.', '', '']
};
function vGate() {
  var g = GATE[S.gate.mode] || GATE.pick, msg = g[1].replace('%s', S.gate.mode === 'error' ? (S.gate.msg || 'Unknown error') : S.folder).replace('%f', S.gate.format).replace('%a', FORMAT);
  var h = '<div class="gate" data-k="gate"><main class="gate-c" aria-labelledby="gate-h"><div class="brand" style="padding:0"><span class="logo" aria-hidden="true">' + LOGO + '</span><span class="brand-t"><b>Discerny</b><span>Version ' + VERSION + '</span></span></div>' +
    '<h1 id="gate-h">' + esc(g[0]) + '</h1><p>' + esc(msg) + '</p>' + (S.gate.msg && S.gate.mode !== 'error' ? '<p class="err-t">' + esc(S.gate.msg) + '</p>' : '');
  if (D.files.srv && (g[3] === 'refolder' || S.gate.mode === 'nofolder')) h += D.files.srv.canSwitch ? vFolderForm() : '<p class="hint">' + esc(srvSwitch()) + '</p>';
  else if (g[2]) h += '<div class="acts">' + bt(g[2], g[3], { cls: 'primary lg' }) + (S.gate.mode === 'reconnect' || S.gate.mode === 'denied' ? bt('Choose a different folder', 'pick', { cls: 'lg' }) : '') + '</div>';
  if (S.gate.mode === 'pick' || S.gate.mode === 'reconnect') h += '<p class="hint">Your browser will ask to let this page view and edit files in the folder. If it offers <strong>Allow on every visit</strong>, choose that and Discerny will open straight in next time.</p>';
  return h + '</main></div>' + vToasts();
}
function vApp() {
  var c = D.model.counts(), open = D.model.panelOpen(), drawer = open && D.model.isDrawer();
  return '<div class="app' + (D.model.isRail() ? ' rail' : '') + (drawer ? ' drawer' : '') + '" data-k="app">' + vSide(c) + vMain(c) + D.views.vPanel() +
    (drawer ? '<div class="scrim" data-k="scrim" data-act="close" aria-hidden="true"></div>' : '') + '</div>' + vToasts() +
    (S.dialog === 'palette' ? vPalette() : S.dialog === 'keys' ? vKeys() : S.dialog === 'folder' ? vFolder() : '') + vDatalists();
}
// The whole page, or the gate until the folder has been read.
function page() { return S.ready && S.m ? vApp() : vGate(); }

D.views = {
  page: page, esc: esc, badge: badge, slug: slug, dv: dv, bt: bt, lk: lk, opts: opts, pressed: pressed, ic: ic,
  linkA: linkA, vRow: vRow, doneBtn: doneBtn, vSnooze: vSnooze, vReasons: vReasons, vSec: vSec, rowsOf: rowsOf,
  navName: navName, viewFor: viewFor
};
})();
