// The links concern: turns a Link into a View, an Item and View state and back, holds the two-way table of View names, and
// reads and writes the hash. It uses only core and model. It never changes Items, never navigates and never builds markup:
// acting on a Link, which navigates, is left to input. Everything it shares is on D.links, and the rest stays private to this file.
(function () {
'use strict';
var S = D.model.S;

// A Link is the page's hash after "#/": a View's Link name, or a Record's ID for its page, then "/" and the ID of
// the Item open in the Side panel, if the User opened one, then the View's state after "?" as key=value pairs. Link names
// last across versions, so they are kept apart from the code's own View names by this two-way table.
var LINK_VIEW = { today: 'today', inbox: 'inbox', 'next-actions': 'next', 'waiting-for': 'waiting', upcoming: 'upcoming', fyi: 'fyi', 'all-items': 'all', done: 'done', projects: 'projects', people: 'people', systems: 'systems', 'weekly-review': 'review', agent: 'claude' };
var VIEW_LINK = {};
Object.keys(LINK_VIEW).forEach(function (k) { VIEW_LINK[LINK_VIEW[k]] = k; });
var RECORD_VIEW = { P: 'person', PRJ: 'project', SYS: 'system' };
// A View's state in its Link: search or filter text, and grouping, each key written only when it differs from its default,
// so a Link without one opens with the default. Where a key has a vals table, Link values map to the code's own like Link names.
// Scroll position and how many done Items are loaded stay out.
function stateKey(get, set, def, vals) { return { get: get, set: set, def: def, vals: vals || null }; }
var ENT_Q = stateKey(function () { return S.eq; }, function (v) { S.eq = v; D.model.forceClear('ent-q'); }, '');
var LINK_STATE = {
  next: { group: stateKey(function () { return S.group; }, function (v) { S.group = v; }, 'project', { project: 'project', kind: 'kind', 'one-list': 'none' }) },
  all: {
    q: stateKey(function () { return S.wq; }, function (v) { S.wq = v; D.model.forceClear('wb-q'); }, ''),
    group: stateKey(function () { return S.wb.group; }, function (v) { S.wb.group = v; }, 'urg', { urgency: 'urg', type: 'type', person: 'person', project: 'project', tag: 'tag' }),
    sort: stateKey(function () { return S.wb.sort; }, function (v) { S.wb.sort = v; }, 'urg', { urgency: 'urg', 'due-date': 'due', newest: 'new', oldest: 'old' }),
    tag: stateKey(function () { return S.wb.tag; }, function (v) { S.wb.tag = v; }, '')
  },
  people: {
    q: stateKey(function () { return S.pq; }, function (v) { S.pq = v; D.model.forceClear('people-q'); }, ''),
    show: stateKey(function () { return S.pf; }, function (v) { S.pf = v; }, 'all', { all: 'all', internal: 'internal', external: 'external', priority: 'priority', 'high-score': 'high', 'low-score': 'low', 'missing-details': 'gaps', left: 'left' }),
    group: stateKey(function () { return S.pgroup; }, function (v) { S.pgroup = v; }, 'none', { none: 'none', organisation: 'co', department: 'dept', group: 'grp' }),
    sort: stateKey(function () { return S.psort; }, function (v) { S.psort = v; }, 'name', { name: 'name', 'interaction-score': 'score' })
  },
  projects: { q: ENT_Q },
  systems: { q: ENT_Q }
};
// the Side panel's tab, written beside an Item the Link names
var TAB_LINK = { details: 'details', relationships: 'links', agent: 'claude' };
function linkValue(vals, v) { return Object.keys(vals).filter(function (k) { return vals[k] === v; })[0]; }
function linkQuery(it) {
  var keys = LINK_STATE[S.view] || {}, out = [];
  Object.keys(keys).forEach(function (k) {
    var d = keys[k], v = d.get();
    if (v === d.def) return;
    if (d.vals) v = linkValue(d.vals, v);
    if (v) out.push(k + '=' + encodeURIComponent(v));
  });
  if (it && S.tab !== 'details') out.push('tab=' + linkValue(TAB_LINK, S.tab));
  return out.length ? '?' + out.join('&') : '';
}
// the hash's state as [[key, value]], in the order written
function stateOfHash(h) {
  var s = String(h || ''), at = s.indexOf('?');
  if (at < 0) return [];
  var dec = function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } };
  return s.slice(at + 1).split('&').filter(Boolean).map(function (p) {
    var e = p.indexOf('=');
    return e < 0 ? [dec(p), ''] : [dec(p.slice(0, e)), dec(p.slice(e + 1))];
  });
}
// linkPush: the next hash write adds a history entry; hashOwn: the hash the UI wrote last, whose hashchange it ignores;
// autoOpen: the Item the Inbox opened by itself, which the Link leaves out; offView: the Item a Link opened on a View it isn't on
var nav = { linkPush: false, hashOwn: '', landing: false, autoOpen: null, offView: null };
// the Item the Link and the document title name: one open in the Side panel that the User opened
function linkItem() { return S.panel && S.sel && kindOf(S.sel) === 'T' && S.sel !== nav.autoOpen && D.model.item(S.sel) ? S.sel : null; }
function linkNow(it) {
  var v = S.entity || VIEW_LINK[S.view] || 'today';
  return it ? v + '/' + it : v;
}
function linkOfHash(h) {
  var s = String(h || '').replace(/^#\/?/, '');
  s = s.split('?')[0];
  try { s = decodeURIComponent(s); } catch (e) { /* keep it as typed */ }
  return s.trim();
}
// the Item an ID was merged into, found by its Comment
function mergedInto(id) {
  var said = 'Merged ' + id + ' into this.', s = D.model.allItems().filter(function (i) { return commentsOf(i).some(function (c) { return c.v.trim() === said; }); })[0];
  return s ? s.id : null;
}
function idShaped(s) { return /^(T|P|PRJ|SYS)-\d+$/.test(s); }
// the Link in text in Ctrl K: the text itself, or what follows the #/ of a whole address
function linkText(text) {
  var s = String(text || '').trim(), at = s.indexOf('#/');
  return at >= 0 ? s.slice(at + 2).trim() : s;
}
// the ID to name when Ctrl K finds nothing for an ID, or a whole address holding one; otherwise null
function missingId(text) {
  var id = linkOfHash(linkText(text)).toUpperCase();
  return idShaped(id) ? id : null;
}
// "Go to …" for text in Ctrl K that is a Link, or a whole address holding one, when the View it names is here; otherwise null.
// A bare ID with nothing behind it stays a search: it may be an ID half typed.
function linkResult(text) {
  var s = linkText(text);
  var parts = linkOfHash(s).split('/'), head = parts[0], id = head.toUpperCase(), it = (parts[1] || '').toUpperCase(), sub;
  if (parts.length > 2) return null;
  var itemSub = function (i) { var to = D.model.whereOf(i) ? i : mergedInto(i); return to && D.model.labelOf(to); };
  if (!it && /^T-\d+$/.test(id)) sub = itemSub(id);
  else {
    var isView = Object.prototype.hasOwnProperty.call(LINK_VIEW, head.toLowerCase()), isRec = RECORD_VIEW[kindOf(id)] && /^[A-Z]+-\d+$/.test(id) && D.model.exists(id);
    if (!isView && !isRec) return null;
    sub = it ? itemSub(it) || (idShaped(it) && !D.model.exists(it) && it + ' isn’t in this Data folder') : isRec ? D.model.labelOf(id) : 'View';
  }
  return sub ? { label: 'Go to ' + s, sub: sub, id: '', act: 'link', arg: s } : null;
}
function syncLink() {
  // the User has just gone somewhere and its hashchange is still on the way: that lands on it, so a frame before it mustn't write over it
  if (location.hash !== nav.hashOwn) return;
  var it = linkItem(), h = '#/' + linkNow(it) + linkQuery(it), push = nav.linkPush;
  nav.linkPush = false; nav.hashOwn = h;
  if (location.hash === h) return;
  if (push) location.hash = h; else location.replace(h);
}

/* ===================== the Link row in search ===================== */
function search(qs) {
  var groups = D.model.searchAll(qs), link = linkResult(qs);
  if (link) groups.unshift({ title: 'Link', items: [link] });
  return groups;
}

D.links = {
  LINK_VIEW: LINK_VIEW, VIEW_LINK: VIEW_LINK, RECORD_VIEW: RECORD_VIEW, LINK_STATE: LINK_STATE, TAB_LINK: TAB_LINK,
  linkQuery: linkQuery, stateOfHash: stateOfHash, linkItem: linkItem, linkNow: linkNow, linkOfHash: linkOfHash,
  mergedInto: mergedInto, missingId: missingId, syncLink: syncLink, search: search, nav: nav
};
})();
