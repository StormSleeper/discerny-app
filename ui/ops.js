// The ops concern: every change to Items and Records, with undo, ending in a save; reading the folder into state; and
// toasts. It uses only core, files and model. It never builds markup, reads the DOM, navigates or moves focus: where a
// change has to redraw the page it fires the redraw hook. Everything it shares is on D.ops, and the rest stays private to this file.
(function () {
'use strict';
var S = D.model.S;

/* ===================== reading and writing one file's model ===================== */
var PARSE = { tasks: parse, inbox: parse, done: parse, people: pParse, projects: eParse, systems: eParse, rels: rParse, asks: aParse, asklog: function (t) { return { text: String(t || '') }; }, ignored: function (t) { return { text: String(t || '') }; }, dismissed: function (t) { return { text: String(t || '') }; }, settings: function (t) { return { text: String(t || '') }; }, interactions: function (t) { return { text: String(t || '').replace(/\r\n/g, '\n') }; } };
function serKey(k, m) {
  if (k === 'tasks' || k === 'inbox' || k === 'done') return serialize(m);
  if (k === 'people') { ensurePIds(m); return pSerialize(m); }
  if (k === 'projects') { ensureEIds(m, 'PRJ'); return eSerialize(m); }
  if (k === 'systems') { ensureEIds(m, 'SYS'); return eSerialize(m); }
  if (k === 'rels' || k === 'asks') return m.lines.length ? m.lines.join('\n') + '\n' : '';
  return m.text;
}

/* ===================== file input/output ===================== */
function parseSources(text) {
  var out = [], cur = null;
  String(text || '').replace(/\r/g, '').split('\n').forEach(function (ln) {
    var h = /^## (.+)$/.exec(ln);
    if (h) { cur = { name: h[1].trim(), lastRun: '' }; out.push(cur); return; }
    var m = /^- last-run:\s*(\S+)/.exec(ln);
    if (m && cur) cur.lastRun = m[1];
  });
  return out;
}
/* A file caught while another program rewrites it can read as empty or cut short. Saving on top of that
   would lose data, so such reads are retried until the file settles, and refused if it stays empty. */
var BASE = {};
function countOf(k, m) {
  if (k === 'tasks' || k === 'inbox' || k === 'done') return m.items.length;
  if (k === 'people') return m.people.length;
  if (k === 'projects' || k === 'systems') return m.ents.length;
  if (k === 'rels' || k === 'asks') return m.lines.length;
  var t = String(m.text || '');
  return t.trim() ? t.split('\n').length : 0;
}
function looksWrong(k, text, m) {
  var b = BASE[k];
  if (!b) return '';
  if (!String(text).trim()) return FILES[k] + ' is empty or missing';
  var n = countOf(k, m);
  if (b >= 4 && n < b / 2) return FILES[k] + ' suddenly has ' + n + ' records instead of ' + b;
  return '';
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function readStable(k, first) {
  var text = first != null ? first : await D.files.readText(FILES[k]), m = PARSE[k](text), why = looksWrong(k, text, m);
  for (var i = 0; why && i < 4; i++) {
    await sleep(300 * (i + 1));
    var t2 = await D.files.readText(FILES[k]), m2 = PARSE[k](t2), w2 = looksWrong(k, t2, m2);
    if (!w2) return { text: t2, m: m2 };
    if (t2 === text && t2.trim()) return { text: t2, m: m2 };
    text = t2; m = m2; why = w2;
  }
  if (why) { var e = new Error(why + '. Nothing was saved, so nothing was overwritten. If you emptied it on purpose, reload Discerny'); e.name = 'FileLooksWrong'; throw e; }
  return { text: text, m: m };
}
async function loadAll() {
  var t = {};
  for (var i = 0; i < WATCH.length; i++) t[WATCH[i]] = await D.files.readText(WATCH[i]);
  var keys = ['tasks', 'inbox', 'done', 'people', 'projects', 'systems', 'rels', 'asks'];
  for (var j = 0; j < keys.length; j++) { var k = keys[j]; if (looksWrong(k, t[FILES[k]], PARSE[k](t[FILES[k]]))) t[FILES[k]] = (await readStable(k, t[FILES[k]])).text; }
  var out = {
    tasks: parse(t['TASKS.md']), inbox: parse(t['INBOX.md']), done: parse(t['DONE.md']),
    people: pParse(t['PEOPLE.md']), projects: eParse(t['PROJECTS.md']), systems: eParse(t['SYSTEMS.md']),
    rels: rParse(t['RELATIONSHIPS.md']), asks: aParse(t['ASK-AGENT.md']),
    log: logParse(t['ASK-AGENT-LOG.md']), sources: parseSources(t['SOURCES.md']),
    drafts: await D.files.readDrafts(), asklog: { text: t['ASK-AGENT-LOG.md'] }, ignored: { text: '' }, dismissed: { text: '' }, settings: { text: t['SOURCES.md'] }, interactions: PARSE.interactions(t['INTERACTIONS.md'])
  };
  keys.forEach(function (k) { BASE[k] = countOf(k, out[k]); });
  return out;
}

/* ===================== operations =====================
   Every change is one operation: a function applied first to the in-memory model (so the
   screen updates at once) and then, in order, to a fresh read of the files on disk. Files are
   written only when the operation changed them. */
function op(label, keys, fn) { return { label: label, keys: keys, fn: fn }; }
var MERGE_KEYS = ['tasks', 'inbox', 'done', 'rels', 'asks', 'asklog', 'ignored', 'interactions'];
// What an operation that writes to the Interaction log also needs: who can get credit, and the log.
var LOG_KEYS = ['people', 'interactions'];
function insertById(items, it) { for (var k = 0; k < items.length; k++) { if (items[k].id > it.id) { items.splice(k, 0, it); return; } } items.push(it); }
function sortById(items) { items.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); }); }
function relRefresh(R) { R.rels = rParse(R.lines.join('\n')).rels; }
function askRefresh(A) { A.notes = aParse(A.lines.join('\n')).notes; }
function addLines(text, lines) {
  var t = String(text || ''), have = t.split('\n'), add = lines.filter(function (l, k) { return have.indexOf(l) < 0 && lines.indexOf(l) === k; });
  if (!add.length) return t;
  if (t && t.slice(-1) !== '\n') t += '\n';
  return t + add.map(function (l) { return l + '\n'; }).join('');
}
function dropLines(text, lines) {
  var arr = String(text || '').split('\n');
  for (var i = lines.length - 1; i >= 0; i--) { var k = arr.lastIndexOf(lines[i]); if (k >= 0) arr.splice(k, 1); }
  return arr.join('\n');
}
// Container refs stand for a whole chat or thread ("related" on a task), so they are never logged as a blanket ignore.
// New form: any scheme ending in |*; legacy form: a bare two-part teams|chat-prefix.
function ignorable(refs) { return refs.filter(function (r) { return !/\|\*$/.test(r) && !/^teams\|[^|]+$/.test(r); }); }
// A DISMISSED.md line: a dated cal source key is cleared by its event's date, any other by when the message came in.
function dismissLine(it, ref, why) {
  var ev = /^cal\|(\d{4}-\d{2}-\d{2})\|/i.exec(ref), f = [];
  if (it.meta.source) f.push('source: ' + it.meta.source);
  if (ev) f.push('event-date: ' + ev[1]);
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(it.meta['received-datetime'] || '')) f.push('received-datetime: ' + it.meta['received-datetime']);
  f.push('dismissed-date: ' + D.model.todayStr(), 'reason: ' + why);
  return '- ' + ref + ' {' + f.join('; ') + '}';
}
// A change Proposal's lines in the Inbox model's post: dropped once answered, put back by an undo. The heading goes with the last one.
function dropChange(m, line) {
  var p = m.post || [], k = p.indexOf(line), n = 1;
  if (k < 0) return false;
  while (k + n < p.length && /^ {2,}\S/.test(p[k + n])) n++;
  p.splice(k, n);
  if (!p.some(function (l) { return /^- /.test(l); })) m.post = [];
  return true;
}
function putChange(m, lines) {
  var p = m.post = m.post || [];
  if (p.indexOf(lines[0]) >= 0) return;
  if (!p.length) p.push(CHANGES_HEAD);
  while (p.length > 1 && !p[p.length - 1].trim()) p.pop();
  Array.prototype.push.apply(p, lines);
}
function noLine(c) { return ignoredLine(changeKey(c), D.model.todayStr(), 'the user said no'); }
// the same history line: its date, field and old → new
function sameHist(b, h) { var f = b.f || {}; return b.k === 'history' && b.v === h.v && f['changed-date'] === h.f['changed-date'] && (f.changed || '') === (h.f.changed || ''); }
function withEmail(p, addr, on) {
  var ems = csv(p.meta.emails), l = addr.toLowerCase(), has = ems.some(function (e) { return e.toLowerCase() === l; });
  if (on && !has) ems.push(addr);
  if (!on) ems = ems.filter(function (e) { return e.toLowerCase() !== l; });
  if (ems.length) p.meta.emails = ems.join(', '); else delete p.meta.emails;
}
function findSub(it, idx, text) {
  var subs = getSub(it, 'sub');
  if (subs[idx] && subs[idx].v === text) return subs[idx];
  return subs.filter(function (s) { return s.v === text; })[0] || null;
}
// the Comment at idx among an Item's or Record's Comments, or, when the files have moved it, the one with its text
function findComment(x, idx, text) {
  var list = commentsOf(x);
  if (list[idx] && list[idx].v === text) return list[idx];
  return list.filter(function (c) { return c.v === text; })[0] || null;
}
// which files an Item or Record lives in, and the Item or Record itself, with where its sub-lines go
function recKeys(id) { var k = kindOf(id); return k === 'T' ? D.model.ANY : k === 'P' ? ['people'] : [D.model.EDEF[k].key]; }
function maxTaskId(M) {
  var n = nextId(M.tasks);
  ['inbox', 'done'].forEach(function (k) { if (M[k]) M[k].items.forEach(function (i) { var v = parseInt(i.id.slice(2), 10); if (v >= n) n = v + 1; }); });
  return n;
}
function remapLine(line) { return String(line).replace(/\b(?:T|P|PRJ|SYS)-\d+\b/g, function (x) { return D.model.rid(x); }); }
function noteAlias(from, to) { if (from && to && from !== to && D.model.rid(from) !== to) { D.model.ALIAS[from] = to; D.model.aliasNews.push([from, to]); } }
function clash(id, a, b) { var e = new Error(id + ' is used by two different items (“' + a + '” and “' + b + '”). Give one of them a new number in the files, then try again'); e.name = 'IdClash'; return e; }
function lastGroup(m) { return m.ents.length ? m.ents[m.ents.length - 1].grp : ''; }
function ensureProject(m, name, wants) {
  var key = name.toLowerCase(), want = wants[key] ? D.model.rid(wants[key]) : null;
  var e = m.ents.filter(function (x) { return x.name.toLowerCase() === key; })[0];
  if (e) { if (want && want !== e.meta.id) noteAlias(want, e.meta.id); else if (!want) wants[key] = e.meta.id; return e.meta.id; }
  var n = eNextId(m, 'PRJ'), id;
  if (want && D.model.idNum(want) >= n && !m.ents.some(function (x) { return x.meta.id === want; })) id = want;
  else { id = fmtEId('PRJ', n); if (want) noteAlias(want, id); else wants[key] = id; }
  m.ents.push({ name: name, grp: lastGroup(m), meta: { id: id, type: 'project', status: 'active' }, subs: [] });
  eSetNextId(m, Math.max(n, D.model.idNum(id) + 1));
  return id;
}
/* The Interaction log. An operation writes its events here and keeps the lines it wrote in st.logged, so its undo takes back exactly
   those. Each run overwrites st.logged, so what stays is what the last run, the save, wrote to the files. */
function logEvents(M, st, events) {
  if (!M.interactions || !events.length) return;
  var r = addInteractions(M.interactions.text, events);
  M.interactions.text = r.text;
  if (st) st.logged = (st.logged || []).concat(r.added);
}
function logBack(M, st) { if (st && st.logged && st.logged.length) M.interactions.text = dropInteractions(M.interactions.text, st.logged); }
// A decision about a Priority person, with the score and breakdown at this moment, before anything else this action writes.
function logDecision(M, st, pid, decision, today) {
  var line = decisionLine(today, pid, decision, interactionScore(M.interactions.text, pid, D.model.SET.values, today), D.model.SET.values.score['half-life-days']);
  M.interactions.text = interactionAdd(interactionText(M.interactions.text), line);
  st.logged = (st.logged || []).concat([line]);
}
// A new involves Relationship is the User tying a Person to an Item, once the Item is past the Inbox.
function involvesLine(line) { var m = REL_RE.exec(line); return !!m && m[4].trim() === 'involves'; }
function logInvolves(M, st, line, today) {
  var m = REL_RE.exec(remapLine(line));
  if (!m || m[4].trim() !== 'involves') return;
  var f = D.model.fItem(M, m[1]);
  if (f && f.k !== 'inbox') logEvents(M, st, linkedEvents(creditById(M.people.people, m[3]), f.it.id, today));
}
var OPS = {
  meta: function (id, patch) {
    var who = patch.who !== undefined, day = who ? D.model.todayStr() : '';
    return op('Edit ' + id, who ? D.model.ANY.concat(LOG_KEYS) : D.model.ANY, function (M) {
      var f = D.model.fItem(M, id);
      if (!f) return;
      var was = f.it.meta.who || '';
      Object.keys(patch).forEach(function (k) { var v = patch[k] == null ? '' : String(patch[k]).replace(/[{}]/g, '').trim(); if (v === '') delete f.it.meta[k]; else f.it.meta[k] = v; });
      // The User setting or changing who is linked for the new one, and the old one keeps their events. A Proposal counts when it's accepted.
      if (who && f.k === 'inbox') whoByUser(f.it, was);
      else if (who && (f.it.meta.who || '') !== was) logEvents(M, null, linkedEvents(creditByName(M.people.people, f.it.meta.who), f.it.id, day));
    });
  },
  title: function (id, t) { return op('Rename ' + id, D.model.ANY, function (M) { var f = D.model.fItem(M, id); if (f && t) f.it.title = t; }); },
  /* the Description and Comments of an Item or Record */
  desc: function (id, text) {
    return op('Description of ' + id, recKeys(id), function (M) { var r = D.model.recIn(M, id); if (r) setDesc(r.x, text, r.rank); });
  },
  // c: {at, author, ack, text}, stamped when the User added it, so applying it again to the files adds it once
  comment: function (id, c) {
    return op('Comment on ' + id, recKeys(id), function (M) {
      var r = D.model.recIn(M, id), t = cleanText(c.text);
      if (r && t && !commentsOf(r.x).some(function (b) { return b.f['added-datetime'] === c.at && b.f.author === c.author && b.v === t; })) addComment(r.x, c, r.rank);
    });
  },
  // idx and text pick the Comment, as findSub does for sub-tasks; the User edits only their own
  editComment: function (id, idx, text, now) {
    return op('Edit comment on ' + id, recKeys(id), function (M) {
      var r = D.model.recIn(M, id), c = r && findComment(r.x, idx, text), t = cleanText(now);
      if (c && c.f.author === 'user' && t) c.v = t;
    });
  },
  delComment: function (id, idx, text) {
    return op('Delete comment on ' + id, recKeys(id), function (M) {
      var r = D.model.recIn(M, id), c = r && findComment(r.x, idx, text);
      if (c) r.x.subs.splice(r.x.subs.indexOf(c), 1);
    });
  },
  // undoes delComment: the Comment goes back where it was among the others
  putComment: function (id, idx, c) {
    return op('Restore comment on ' + id, recKeys(id), function (M) {
      var r = D.model.recIn(M, id);
      if (!r || commentsOf(r.x).some(function (b) { return b.v === c.v && b.f['added-datetime'] === c.f['added-datetime'] && b.f.author === c.f.author; })) return;
      var list = commentsOf(r.x), b = { k: 'comment', f: Object.assign({}, c.f), v: c.v };
      if (list[idx]) r.x.subs.splice(r.x.subs.indexOf(list[idx]), 0, b); else placeSub(r.x, b, r.rank);
    });
  },
  // Acknowledged clears the Comments to acknowledge it names ([idx, text] each), and an Item's are logged once it's past the Inbox;
  // on, the undo, marks them again and takes back what that wrote, with the same st
  ack: function (id, which, on, st) {
    var isItem = kindOf(id) === 'T', day = D.model.todayStr();
    st = st || {};
    return op((on ? 'Undo acknowledge on ' : 'Acknowledge comments on ') + id, isItem ? recKeys(id).concat(LOG_KEYS) : recKeys(id), function (M) {
      var r = D.model.recIn(M, id);
      if (!on) st.logged = [];
      if (!r) return;
      var past = isItem && D.model.fItem(M, id).k !== 'inbox';
      which.forEach(function (w) {
        var c = findComment(r.x, w[0], w[1]);
        if (!c) return;
        if (on) { c.f.acknowledged = 'no'; return; }
        if (past && toAck(c)) logEvents(M, st, ackEvents(r.x, c, M.people.people, day));
        delete c.f.acknowledged;
      });
      if (on) logBack(M, st);
    });
  },
  // Undo of a Skill's field change: the field back to value, and the change Comments it names ([idx, text] each) acknowledged.
  // A Person's change gets a history line, as any change to their fields does. st keeps what it replaced, for the redo.
  fieldUndo: function (id, field, value, which, date, st) {
    return op('Undo the change to ' + field + ' on ' + id, recKeys(id), function (M) {
      var r = D.model.recIn(M, id);
      if (!r) return;
      var x = r.x, was = x.meta[field] || '';
      if (st.was === undefined) { st.was = was; st.chk = x.meta['checked-date']; }
      if (value) x.meta[field] = value; else delete x.meta[field];
      if (kindOf(id) === 'P' && st.was !== value) {
        st.hist = st.hist || histSub(date, field, st.was, value);
        if (!x.subs.some(function (b) { return sameHist(b, st.hist); })) addHistory(x, date, field, st.was, value);
        x.meta['checked-date'] = date;
      }
      which.forEach(function (w) { var c = findComment(x, w[0], w[1]); if (c) delete c.f.acknowledged; });
    });
  },
  fieldRedo: function (id, field, which, st) {
    return op('Redo the change to ' + field + ' on ' + id, recKeys(id), function (M) {
      var r = D.model.recIn(M, id);
      if (!r || st.was === undefined) return;
      var x = r.x;
      if (st.was) x.meta[field] = st.was; else delete x.meta[field];
      if (st.hist) { x.subs = x.subs.filter(function (b) { return !sameHist(b, st.hist); }); if (st.chk) x.meta['checked-date'] = st.chk; else delete x.meta['checked-date']; }
      which.forEach(function (w) { var c = findComment(x, w[0], w[1]); if (c) c.f.acknowledged = 'no'; });
    });
  },
  // Yes to a Priority person: their ID added to priority-people; st.had says it was there already, for the undo
  prioYes: function (c, st) {
    var day = D.model.todayStr();
    return op('Make ' + c.name + ' a Priority person', ['inbox', 'settings', 'interactions'], function (M) {
      st.logged = [];
      if (!dropChange(M.inbox, c.line)) return;
      var t = setPriority(M.settings.text, D.model.rid(c.id), true);
      if (st.had === undefined) st.had = t === M.settings.text;
      M.settings.text = t;
      logDecision(M, st, D.model.rid(c.id), 'yes', day);
    });
  },
  prioUnyes: function (c, st) {
    return op('Undo Priority person', ['inbox', 'settings', 'interactions'], function (M) {
      putChange(M.inbox, c.lines);
      if (st.had === false) M.settings.text = setPriority(M.settings.text, D.model.rid(c.id), false);
      logBack(M, st);
    });
  },
  // Promote by hand, which also answers a Priority person Proposal waiting for them. st keeps what the undo must put back;
  // each run overwrites it, so what stays is what the last run, the save, found in the files.
  promote: function (id, st) {
    var day = D.model.todayStr();
    return op('Promote ' + id, ['inbox', 'settings', 'interactions'], function (M) {
      var t = setPriority(M.settings.text, D.model.rid(id), true), cs = changesOf(M.inbox.post).filter(function (c) { return c.type === 'priority' && D.model.rid(c.id) === D.model.rid(id); });
      st.had = t === M.settings.text;
      M.settings.text = t;
      st.lines = cs.map(function (c) { return c.lines; });
      cs.forEach(function (c) { dropChange(M.inbox, c.line); });
      st.logged = [];
      logDecision(M, st, D.model.rid(id), 'promote', day);
    });
  },
  unpromote: function (id, st) {
    return op('Undo promote ' + id, ['inbox', 'settings', 'interactions'], function (M) {
      (st.lines || []).forEach(function (l) { putChange(M.inbox, l); });
      if (st.had === false) M.settings.text = setPriority(M.settings.text, D.model.rid(id), false);
      logBack(M, st);
    });
  },
  // Demote by hand starts a Priority pause, with the line a No writes. addLines won't repeat a line, so st.added says whether this one is ours to undo.
  demote: function (id, line, st) {
    var day = D.model.todayStr();
    return op('Demote ' + id, ['settings', 'ignored', 'interactions'], function (M) {
      var t = setPriority(M.settings.text, D.model.rid(id), false), g = addLines(M.ignored.text, [line]);
      st.had = t !== M.settings.text;
      st.added = g !== M.ignored.text;
      M.settings.text = t;
      M.ignored.text = g;
      st.logged = [];
      logDecision(M, st, D.model.rid(id), 'demote', day);
    });
  },
  undemote: function (id, line, st) {
    return op('Undo demote ' + id, ['settings', 'ignored', 'interactions'], function (M) {
      if (st.had) M.settings.text = setPriority(M.settings.text, D.model.rid(id), true);
      if (st.added) M.ignored.text = dropLines(M.ignored.text, [line]);
      logBack(M, st);
    });
  },
  addSub: function (id, text) {
    return op('Sub-task on ' + id, D.model.ANY, function (M) {
      var f = D.model.fItem(M, id);
      if (!f) return;
      var it = f.it, last = -1;
      it.subs.forEach(function (s, k) { if (s.k === 'sub') last = k; });
      var o = { k: 'sub', v: text, x: false };
      if (last < 0) it.subs.push(o); else it.subs.splice(last + 1, 0, o);
    });
  },
  setSub: function (id, idx, text, x) {
    return op('Sub-task on ' + id, D.model.ANY, function (M) { var f = D.model.fItem(M, id); if (!f) return; var s = findSub(f.it, idx, text); if (s) s.x = !!x; });
  },
  removeSub: function (id, idx, text) {
    return op('Remove sub-task', D.model.ANY, function (M) { var f = D.model.fItem(M, id); if (!f) return; var s = findSub(f.it, idx, text); if (s) f.it.subs.splice(f.it.subs.indexOf(s), 1); });
  },
  insertSub: function (id, idx, sub) {
    return op('Restore sub-task', D.model.ANY, function (M) {
      var f = D.model.fItem(M, id);
      if (!f) return;
      var it = f.it, subs = getSub(it, 'sub');
      if (subs.some(function (s) { return s.v === sub.v; })) return;
      var o = { k: 'sub', v: sub.v, x: !!sub.x };
      if (idx < subs.length) it.subs.splice(it.subs.indexOf(subs[idx]), 0, o);
      else if (subs.length) it.subs.splice(it.subs.indexOf(subs[subs.length - 1]) + 1, 0, o);
      else it.subs.push(o);
    });
  },
  addTag: function (id, t) {
    return op('Tag ' + id, D.model.ANY, function (M) { var f = D.model.fItem(M, id); if (!f) return; var tags = tagsOf(f.it); if (tags.indexOf(t) < 0) tags.push(t); f.it.meta.tags = tags.join(', '); });
  },
  removeTag: function (id, t) {
    return op('Untag ' + id, D.model.ANY, function (M) {
      var f = D.model.fItem(M, id);
      if (!f) return;
      var tags = tagsOf(f.it).filter(function (x) { return x !== t; });
      if (tags.length) f.it.meta.tags = tags.join(', '); else delete f.it.meta.tags;
    });
  },
  setPrj: function (id, p, on) {
    return op('Project on ' + id, D.model.ANY, function (M) {
      var f = D.model.fItem(M, id), q = D.model.rid(p);
      if (!f) return;
      var ps = prjOf(f.it).map(D.model.rid), k = ps.indexOf(q);
      if (on && k < 0) ps.push(q);
      if (!on && k >= 0) ps.splice(k, 1);
      if (ps.length) f.it.meta.projects = ps.join(', '); else delete f.it.meta.projects;
    });
  },
  addDep: function (id, d) {
    return op('Dependency on ' + id, D.model.ANY, function (M) { var f = D.model.fItem(M, id), q = D.model.rid(d); if (!f) return; var ds = depList(f.it); if (ds.indexOf(q) < 0) ds.push(q); f.it.meta.dependencies = ds.join(', '); });
  },
  removeDep: function (id, d) {
    return op('Dependency on ' + id, D.model.ANY, function (M) {
      var f = D.model.fItem(M, id), q = D.model.rid(d);
      if (!f) return;
      var ds = depList(f.it).filter(function (x) { return x !== q && x !== d; });
      if (ds.length) f.it.meta.dependencies = ds.join(', '); else delete f.it.meta.dependencies;
    });
  },
  // back, the undo of a reopen, puts back the done events that reopen took out, in place of writing one
  complete: function (id, date, back) {
    return op('Complete ' + id, ['done', 'tasks'].concat(LOG_KEYS), function (M) {
      var x = D.model.rid(id), k = M.tasks.items.findIndex(function (i) { return i.id === x; });
      if (k < 0) return;
      var it = M.tasks.items[k], dup = M.done.items.filter(function (i) { return i.id === x; })[0];
      if (dup && dup.title !== it.title) throw clash(x, dup.title, it.title);
      M.tasks.items.splice(k, 1);
      it.done = true; it.meta['done-date'] = date; delete it.meta.status;
      M.done.items = M.done.items.filter(function (i) { return i.id !== x; });
      M.done.items.push(it);
      if (back) M.interactions.text = restoreInteractions(M.interactions.text, back.removed);
      else logEvents(M, null, doneEvents(it, M.people.people, date));
    });
  },
  // Reopening an Item takes out its done events, which back keeps for the undo
  reopen: function (id, st, back) {
    return op('Reopen ' + id, ['tasks', 'done', 'interactions'], function (M) {
      var x = D.model.rid(id), k = M.done.items.findIndex(function (i) { return i.id === x; });
      if (k < 0) return;
      var gone = removeInteractions(M.interactions.text, function (e) { return e.kind === 'done' && e.item === x; });
      M.interactions.text = gone.text;
      if (back) back.removed = gone.removed;
      var it = M.done.items[k], dup = M.tasks.items.filter(function (i) { return i.id === x; })[0];
      if (dup && dup.title !== it.title) throw clash(x, dup.title, it.title);
      M.done.items.splice(k, 1);
      it.done = false; delete it.meta['done-date'];
      if (st) it.meta.status = st;
      M.tasks.items = M.tasks.items.filter(function (i) { return i.id !== x; });
      insertById(M.tasks.items, it);
    });
  },
  // st keeps the lines it logged, for unaccept. Getting past the Inbox is when the Proposal's interaction, and any involves Relationship it has, count.
  accept: function (id, relLines, st) {
    var day = D.model.todayStr();
    st = st || {};
    return op('Accept ' + id, ['tasks', 'inbox', 'rels'].concat(LOG_KEYS), function (M) {
      var k = M.inbox.items.findIndex(function (i) { return i.id === id; }), came = null;
      st.logged = [];
      if (k >= 0) {
        var it = M.inbox.items[k], dup = M.tasks.items.filter(function (i) { return i.id === id; })[0];
        if (dup && dup.title !== it.title) throw clash(id, dup.title, it.title);
        M.inbox.items.splice(k, 1);
        M.tasks.items = M.tasks.items.filter(function (i) { return i.id !== id; });
        insertById(M.tasks.items, it);
        var n = D.model.idNum(id) + 1;
        if (n > nextId(M.tasks)) setNextId(M.tasks, n);
        came = it;
      } else if (!M.tasks.items.some(function (i) { return i.id === id; })) return;
      var R = M.rels, added = false;
      relLines.map(remapLine).forEach(function (l) { if (R.lines.indexOf(l) < 0) { if (!R.lines.length) R.lines = REL_HEAD.slice(); R.lines.push(l); added = true; } });
      if (added) relRefresh(R);
      if (!came) return;
      logEvents(M, st, acceptEvents(came, M.people.people, day));
      R.rels.filter(function (r) { return r.a === id; }).forEach(function (r) { logInvolves(M, st, r.raw, day); });
    });
  },
  unaccept: function (id, relLines, st) {
    return op('Undo accept ' + id, ['inbox', 'tasks', 'rels', 'interactions'], function (M) {
      logBack(M, st);
      var k = M.tasks.items.findIndex(function (i) { return i.id === id; });
      if (k >= 0) {
        var it = M.tasks.items[k], dup = M.inbox.items.filter(function (i) { return i.id === id; })[0];
        if (dup && dup.title !== it.title) throw clash(id, dup.title, it.title);
        M.tasks.items.splice(k, 1);
        M.inbox.items = M.inbox.items.filter(function (i) { return i.id !== id; });
        insertById(M.inbox.items, it);
      }
      var R = M.rels, n = R.lines.length, drop = relLines.map(remapLine);
      R.lines = R.lines.filter(function (l) { return drop.indexOf(l) < 0; });
      if (R.lines.length !== n) relRefresh(R);
    });
  },
  dismiss: function (id, disLines) {
    return op('Dismiss ' + id, ['dismissed', 'inbox'], function (M) {
      var k = M.inbox.items.findIndex(function (i) { return i.id === id; });
      if (k < 0) return;
      M.inbox.items.splice(k, 1);
      D.model.changesOn(M.inbox, id).forEach(function (c) { dropChange(M.inbox, c.line); });
      if (disLines.length && !M.dismissed.text.trim()) M.dismissed.text = DIS_HEAD.join('\n');
      M.dismissed.text = addLines(M.dismissed.text, disLines);
    });
  },
  undismiss: function (text, disLines, changes) {
    return op('Undo dismiss', ['inbox', 'dismissed'], function (M) {
      var it = parse(text).items[0];
      if (!it) return;
      if (!M.inbox.items.some(function (i) { return i.id === it.id; })) insertById(M.inbox.items, it);
      (changes || []).forEach(function (c) { putChange(M.inbox, c.lines); });
      M.dismissed.text = dropLines(M.dismissed.text, disLines);
    });
  },
  /* change Proposals: each answer drops the Proposal from the Inbox and makes the change, or logs a No in IGNORED.md */
  relYes: function (c, line, st) {
    var day = D.model.todayStr(), logs = involvesLine(line);
    return op('Relate ' + c.a + ' and ' + c.b, logs ? ['inbox', 'rels', 'tasks', 'done'].concat(LOG_KEYS) : ['inbox', 'rels'], function (M) {
      st.logged = [];
      if (!dropChange(M.inbox, c.line)) return;
      var R = M.rels, l = remapLine(line);
      if (R.lines.indexOf(l) < 0) { if (!R.lines.length) R.lines = REL_HEAD.slice(); R.lines.push(l); relRefresh(R); if (logs) logInvolves(M, st, l, day); }
    });
  },
  relUnyes: function (c, line, st) {
    return op('Undo relate', involvesLine(line) ? ['inbox', 'rels', 'interactions'] : ['inbox', 'rels'], function (M) {
      putChange(M.inbox, c.lines);
      var R = M.rels, k = R.lines.indexOf(remapLine(line));
      if (k >= 0) { R.lines.splice(k, 1); relRefresh(R); }
      logBack(M, st);
    });
  },
  // A No to a Priority person is a decision, logged with the score at this moment
  changeNo: function (c, st) {
    var prio = c.type === 'priority', day = D.model.todayStr();
    return op('No to a change', prio ? ['inbox', 'ignored', 'interactions'] : ['inbox', 'ignored'], function (M) {
      st.logged = [];
      if (!dropChange(M.inbox, c.line)) return;
      M.ignored.text = addLines(M.ignored.text, [noLine(c)]);
      if (prio) logDecision(M, st, D.model.rid(c.id), 'no', day);
    });
  },
  changeUnno: function (c, line, st) {
    return op('Undo no', c.type === 'priority' ? ['inbox', 'ignored', 'interactions'] : ['inbox', 'ignored'], function (M) { putChange(M.inbox, c.lines); M.ignored.text = dropLines(M.ignored.text, [line]); logBack(M, st); });
  },
  // st keeps what the Person had before, for the undo
  emailYes: function (c, date, st) {
    return op('Add ' + c.email + ' to ' + c.name, ['inbox', 'people'], function (M) {
      var p = M.people.people.filter(function (x) { return x.meta.id === D.model.rid(c.id); })[0];
      if (!p || !dropChange(M.inbox, c.line)) return;
      var old = { em: p.meta.emails || '', chk: p.meta['checked-date'] || '' };
      if (!st.old) st.old = old;
      withEmail(p, c.email, true);
      if (p.meta.emails !== old.em) addHistory(p, date, 'emails', old.em, p.meta.emails);
      p.meta['checked-date'] = date;
    });
  },
  emailUnyes: function (c, st, date) {
    return op('Undo add email', ['inbox', 'people'], function (M) {
      putChange(M.inbox, c.lines);
      var p = M.people.people.filter(function (x) { return x.meta.id === D.model.rid(c.id); })[0];
      if (!p || !st.old) return;
      withEmail(p, c.email, false);
      p.subs = p.subs.filter(function (s) { var f = s.f || {}; return !(s.k === 'history' && f.changed === 'emails' && f['changed-date'] === date && s.v.slice(-c.email.length) === c.email); });
      if (st.old.chk) p.meta['checked-date'] = st.old.chk; else delete p.meta['checked-date'];
    });
  },
  // Add, or Add as Priority person: a new Person record, who on the Items that named them only in their Description, and an introduction Task if asked
  personAdd: function (c, o, st) {
    var ap = OPS.addPerson(c.name, 'Other'), spec = null, task = {};
    if (o.intro) spec = { title: 'Set up an introduction meeting with ' + c.name, meta: { type: 'task', who: c.name, urgency: 'this week', priority: 'medium', 'received-datetime': o.now }, description: '', newProjects: [], date: o.date };
    var at = spec ? OPS.addTask(spec, task) : null, items = csv(c.fields.items);
    st.whos = []; st.rels = [];
    var keys = ['inbox', 'people', 'tasks', 'done', 'rels', 'interactions'].concat(o.priority ? ['settings'] : []);
    return op('Add ' + c.name, keys, function (M) {
      st.logged = [];
      if (!dropChange(M.inbox, c.line)) return;
      var had = M.people.people.some(function (x) { return x.name.toLowerCase() === c.name.toLowerCase(); });
      ap.fn(M);
      var p = M.people.people.filter(function (x) { return x.name.toLowerCase() === c.name.toLowerCase(); })[0];
      if (!p) return;
      if (!had) st.created = true;
      st.pid = p.meta.id;
      withEmail(p, c.email, true);
      if (c.fields.company && !p.meta.company) p.meta.company = D.model.cleanName(c.fields.company);
      if (c.fields.title && !p.meta.title) p.meta.title = D.model.cleanName(c.fields.title);
      p.meta['checked-date'] = o.date;
      if (o.priority) logDecision(M, st, p.meta.id, 'yes', o.date);
      items.forEach(function (x) {
        var f = D.model.fItem(M, x);
        if (!f || f.k === 'done' || D.model.realWho(f.it)) return;
        var was = f.it.meta.who || '';
        f.it.meta.who = p.name;
        if (st.whos.indexOf(f.it.id) < 0) st.whos.push(f.it.id);
        // One still in the Inbox counts when it's accepted
        if (f.k === 'inbox') whoByUser(f.it, was);
        else logEvents(M, st, linkedEvents(creditById(M.people.people, p.meta.id), f.it.id, o.date));
      });
      if (o.priority) M.settings.text = setPriority(M.settings.text, p.meta.id, true);
      if (!at) return;
      at.fn(M);
      st.task = task.id;
      st.logged = st.logged.concat(task.logged || []);
      var R = M.rels, n = R.lines.length;
      items.forEach(function (x) { var f = D.model.fItem(M, x), r = f ? relLine(task.id, f.it.id) : {}; if (r.line && R.lines.indexOf(r.line) < 0) { if (!R.lines.length) R.lines = REL_HEAD.slice(); R.lines.push(r.line); if (st.rels.indexOf(r.line) < 0) st.rels.push(r.line); } });
      if (R.lines.length !== n) relRefresh(R);
    });
  },
  personUnadd: function (c, o, st) {
    var keys = ['inbox', 'people', 'tasks', 'done', 'rels', 'interactions'].concat(o.priority ? ['settings'] : []);
    return op('Undo add ' + c.name, keys, function (M) {
      putChange(M.inbox, c.lines);
      logBack(M, st);
      var pid = D.model.rid(st.pid), p = M.people.people.filter(function (x) { return x.meta.id === pid; })[0];
      if (p && st.created) {
        var hw = pNextId(M.people);
        M.people.people = M.people.people.filter(function (x) { return x !== p; });
        pSetNextId(M.people, hw);
      } else if (p) withEmail(p, c.email, false);
      st.whos.forEach(function (x) { var f = D.model.fItem(M, x); if (f && p && f.it.meta.who === p.name) { delete f.it.meta.who; if (f.k === 'inbox') whoByUser(f.it, p.name); } });
      if (o.priority && pid) M.settings.text = setPriority(M.settings.text, pid, false);
      if (st.task) { var t = D.model.rid(st.task); M.tasks.items = M.tasks.items.filter(function (i) { return !(i.id === t && getSub(i, 'origin').some(function (b) { return /^Added /.test(b.v); })); }); }
      var R = M.rels, n = R.lines.length, drop = st.rels.map(remapLine);
      R.lines = R.lines.filter(function (l) { return drop.indexOf(l) < 0; });
      if (R.lines.length !== n) relRefresh(R);
    });
  },
  del: function (id, igLines) {
    return op('Delete ' + id, ['ignored', 'tasks'], function (M) {
      var x = D.model.rid(id), k = M.tasks.items.findIndex(function (i) { return i.id === x; });
      if (k < 0) return;
      var hw = nextId(M.tasks);
      M.tasks.items.splice(k, 1);
      if (nextId(M.tasks) < hw) setNextId(M.tasks, hw);
      if (igLines.length) M.ignored.text = addLines(M.ignored.text, igLines);
    });
  },
  undel: function (text, igLines) {
    return op('Undo delete', ['tasks', 'ignored'], function (M) {
      var it = parse(text).items[0];
      if (!it) return;
      it.id = D.model.rid(it.id);
      if (!M.tasks.items.some(function (i) { return i.id === it.id; })) insertById(M.tasks.items, it);
      if (igLines.length) M.ignored.text = dropLines(M.ignored.text, igLines);
    });
  },
  // Merge: duplicate did folded into sid (mergeItem), and every reference to did made one to sid. st keeps what changed, for the undo.
  merge: function (sid, did, at, st) {
    return op('Merge ' + did + ' into ' + sid, MERGE_KEYS, function (M) {
      var s = D.model.fItem(M, sid), d = D.model.fItem(M, did);
      if (!s || !d || !canMerge(s.it, d.it)) return;
      var sx = s.it.id, dx = d.it.id;
      st.s = { k: s.k, text: serItem(s.it) }; st.d = { k: d.k, text: serItem(d.it) }; st.deps = []; st.swaps = {}; st.post = [];
      var hw = maxTaskId(M);
      M[d.k].items.splice(M[d.k].items.indexOf(d.it), 1);
      if (nextId(M.tasks) < hw) setNextId(M.tasks, hw);
      mergeItem(s.it, d.it, at);
      if (s.k === 'done' && !s.it.done) { M.done.items.splice(M.done.items.indexOf(s.it), 1); insertById(M.tasks.items, s.it); }
      // The events move with the rest. A survivor left open has no done event, as if it had been reopened.
      var L = M.interactions, lr = mergeRefs('interactions', String(L.text || '').split('\n'), dx, sx);
      if (!s.it.done) lr.lines = lr.lines.filter(function (ln, at) {
        var e = ln.slice(0, 2) === '- ' ? interactionOf(ln) : null;
        if (!e || e.kind !== 'done' || e.item !== sx) return true;
        var w = lr.swaps.filter(function (y) { return y[1] === ln; })[0];
        if (w) w[1] = null; else lr.swaps.push([ln, null, at]);
        return false;
      });
      if (lr.swaps.length) { L.text = lr.lines.join('\n'); st.swaps.interactions = lr.swaps; }
      D.model.ANY.forEach(function (k) {
        M[k].items.forEach(function (i) {
          var ds = depList(i);
          if (ds.indexOf(dx) < 0) return;
          var was = i.meta.dependencies, now = union(ds.map(function (x) { return x === dx ? sx : x; }), []).filter(function (x) { return x !== i.id; });
          if (now.length) i.meta.dependencies = now.join(', '); else delete i.meta.dependencies;
          st.deps.push([i.id, was, i.meta.dependencies || '']);
        });
      });
      [['rels', 'rels'], ['asks', 'asks']].forEach(function (p) {
        var A = M[p[0]], r = mergeRefs(p[1], A.lines, dx, sx);
        if (!r.swaps.length) return;
        A.lines = r.lines; st.swaps[p[0]] = r.swaps;
        if (p[0] === 'rels') relRefresh(A); else askRefresh(A);
      });
      [['asklog', 'log'], ['ignored', 'ignored']].forEach(function (p) {
        var T = M[p[0]];
        if (!T) return;
        var r = mergeRefs(p[1], String(T.text || '').split('\n'), dx, sx);
        if (r.swaps.length) { T.text = r.lines.join('\n'); st.swaps[p[0]] = r.swaps; if (p[0] === 'asklog' && M.log) M.log = logParse(T.text); }
      });
      // change Proposals in the Inbox naming did: a Relationship to sid itself goes
      changesOf(M.inbox.post).forEach(function (c) {
        if ((c.type !== 'relationship' && c.type !== 'person') || c.line.indexOf(dx) < 0) return;
        var line = c.line.replace(new RegExp('\\b' + dx + '\\b', 'g'), sx);
        if (c.type === 'relationship' && (c.a === dx ? c.b : c.a) === sx) { dropChange(M.inbox, c.line); st.post.push([c.lines, null]); return; }
        M.inbox.post[M.inbox.post.indexOf(c.line)] = line;
        st.post.push([c.lines, line]);
      });
    });
  },
  unmerge: function (sid, did, st) {
    return op('Undo merge', MERGE_KEYS, function (M) {
      if (!st.s) return;
      var was = parse(st.s.text).items[0], dup = parse(st.d.text).items[0], s = D.model.fItem(M, sid);
      if (!was || !dup) return;
      if (s) M[s.k].items.splice(M[s.k].items.indexOf(s.it), 1);
      insertById(M[st.s.k].items, was);
      if (!D.model.fItem(M, dup.id)) insertById(M[st.d.k].items, dup);
      st.deps.forEach(function (x) { var f = D.model.fItem(M, x[0]); if (f && (f.it.meta.dependencies || '') === x[2]) { if (x[1]) f.it.meta.dependencies = x[1]; else delete f.it.meta.dependencies; } });
      function back(lines, swaps) {
        swaps.forEach(function (w) {
          var k = w[1] === null ? -1 : lines.indexOf(w[1]);
          if (k >= 0) lines[k] = w[0];
          else if (lines.indexOf(w[0]) < 0) lines.splice(Math.min(w[2], lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length), 0, w[0]);
        });
        return lines;
      }
      if (st.swaps.rels) { M.rels.lines = back(M.rels.lines, st.swaps.rels); relRefresh(M.rels); }
      if (st.swaps.asks) { M.asks.lines = back(M.asks.lines, st.swaps.asks); askRefresh(M.asks); }
      ['asklog', 'ignored', 'interactions'].forEach(function (k) { if (st.swaps[k] && M[k]) M[k].text = back(String(M[k].text || '').split('\n'), st.swaps[k]).join('\n'); });
      if (st.swaps.asklog && M.log) M.log = logParse(M.asklog.text);
      st.post.forEach(function (w) { var p = M.inbox.post || [], k = w[1] === null ? -1 : p.indexOf(w[1]); if (k >= 0) p[k] = w[0][0]; else putChange(M.inbox, w[0]); });
    });
  },
  // An Item added by hand with a who ties that Person to it; out keeps the Item's ID, and the lines logged for removeAdded.
  addTask: function (spec, out) {
    var keys = (spec.newProjects.length ? ['projects', 'tasks', 'inbox', 'done'] : ['tasks', 'inbox', 'done']).concat(spec.meta.who ? LOG_KEYS : []);
    spec.prjWant = spec.prjWant || {};
    return op('Add task', keys, function (M) {
      if (out) out.logged = [];
      var prj = csv(spec.meta.projects).map(D.model.rid);
      spec.newProjects.forEach(function (name) { var pid = ensureProject(M.projects, name, spec.prjWant); if (prj.indexOf(pid) < 0) prj.push(pid); });
      var want = spec.want ? D.model.rid(spec.want) : null, f = want ? D.model.fItem(M, want) : null;
      if (f && f.it.title === spec.title) { if (out) out.id = want; return; }
      var n = maxTaskId(M), id;
      if (want && !f && D.model.idNum(want) >= n) id = want;
      else { id = fmtId(n); if (want) noteAlias(want, id); else spec.want = id; }
      var meta = Object.assign({}, spec.meta);
      if (prj.length) meta.projects = prj.join(', '); else delete meta.projects;
      var it = { id: id, done: false, title: spec.title, meta: meta, subs: [{ k: 'origin', v: 'Added ' + spec.date }] };
      if (spec.description) setDesc(it, spec.description, ITEM_RANK);
      M.tasks.items.push(it);
      setNextId(M.tasks, Math.max(n, D.model.idNum(id) + 1));
      if (out) out.id = id;
      if (meta.who) logEvents(M, out, linkedEvents(creditByName(M.people.people, meta.who), id, spec.date));
    });
  },
  removeAdded: function (id, out) {
    return op('Undo add', ['tasks', 'interactions'], function (M) {
      var x = D.model.rid(id);
      M.tasks.items = M.tasks.items.filter(function (i) { return !(i.id === x && getSub(i, 'origin').some(function (b) { return /^Added /.test(b.v); })); });
      logBack(M, out);
    });
  },
  // Given st, this is the User adding a Relationship, which an involves one logs; without it, the undo of taking one out, which logs nothing.
  addRel: function (line, st) {
    var logs = !!st && involvesLine(line), day = logs ? D.model.todayStr() : '';
    return op('Relate', logs ? ['rels'].concat(D.model.ANY, LOG_KEYS) : ['rels'], function (M) {
      if (st) st.logged = [];
      var R = M.rels, l = remapLine(line);
      if (R.lines.indexOf(l) >= 0) return;
      if (!R.lines.length) R.lines = REL_HEAD.slice();
      R.lines.push(l);
      relRefresh(R);
      if (logs) logInvolves(M, st, l, day);
    });
  },
  removeRel: function (line, st) {
    return op('Unlink', st ? ['rels', 'interactions'] : ['rels'], function (M) { var R = M.rels, k = R.lines.indexOf(remapLine(line)); if (k >= 0) { R.lines.splice(k, 1); relRefresh(R); } if (st) logBack(M, st); });
  },
  addAsk: function (line) {
    return op('Queue for the agent', ['asks'], function (M) { var A = M.asks, l = remapLine(line); if (A.lines.indexOf(l) >= 0) return; if (!A.lines.length) A.lines = ASK_HEAD.slice(); A.lines.push(l); askRefresh(A); });
  },
  removeAsk: function (line) {
    return op('Remove note for the agent', ['asks'], function (M) { var A = M.asks, k = A.lines.indexOf(remapLine(line)); if (k >= 0) { A.lines.splice(k, 1); askRefresh(A); } });
  },
  editAsk: function (oldLine, newLine) {
    return op('Edit note for the agent', ['asks'], function (M) { var A = M.asks, k = A.lines.indexOf(remapLine(oldLine)); if (k >= 0) { A.lines[k] = remapLine(newLine); askRefresh(A); } });
  },
  /* people */
  patchPerson: function (name, patch, date) {
    return op('Edit ' + name, ['people'], function (M) {
      var p = M.people.people.filter(function (x) { return x.name === name; })[0];
      if (!p) return;
      var touched = false;
      Object.keys(patch).forEach(function (k) {
        var nv = patch[k] == null ? '' : String(patch[k]).replace(/[;{}]/g, ' ').trim();
        if (k === 'group') { p.grp = nv || 'Other'; return; }
        var old = p.meta[k] || '';
        if (nv === old) return;
        if (nv === '') delete p.meta[k]; else p.meta[k] = nv;
        if (PFIELDS.indexOf(k) >= 0) { touched = true; if (old && nv) addHistory(p, date, k, old, nv); }
      });
      if (touched && patch['checked-date'] === undefined) p.meta['checked-date'] = date;
    });
  },
  addPerson: function (name, grp) {
    var st = { want: null };
    return op('Add ' + name, ['people'], function (M) {
      var ex = M.people.people.filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
      if (ex) { if (st.want && ex.meta.id && D.model.rid(st.want) !== ex.meta.id) noteAlias(D.model.rid(st.want), ex.meta.id); return; }
      var p = { name: name, grp: grp || 'Other', meta: {}, subs: [] }, n = pNextId(M.people), want = st.want ? D.model.rid(st.want) : null;
      if (want && D.model.idNum(want) >= n) p.meta.id = want;
      M.people.people.push(p);
      ensurePIds(M.people);
      if (!st.want) st.want = p.meta.id; else if (p.meta.id !== want) noteAlias(want, p.meta.id);
      pSetNextId(M.people, Math.max(pNextId(M.people), D.model.idNum(p.meta.id) + 1));
    });
  },
  // Add to People from an Item that names them: the User has tied them to that Item, so it's linked once it's past the Inbox. Undo is removePerson, which takes the line out.
  addPersonOn: function (name, id, today) {
    var ap = OPS.addPerson(name, 'Other');
    return op('Add ' + name, D.model.ANY.concat(LOG_KEYS), function (M) {
      ap.fn(M);
      var f = D.model.fItem(M, id);
      if (f && f.k !== 'inbox' && f.it.meta.who === name) logEvents(M, null, linkedEvents(creditByName(M.people.people, name), f.it.id, today));
    });
  },
  // Deleting a Person takes their lines out of the log, which st keeps for restorePerson
  removePerson: function (name, st) {
    return op('Remove ' + name, LOG_KEYS, function (M) {
      var hw = pNextId(M.people), who = M.people.people.filter(function (x) { return x.name === name; })[0], pid = who && who.meta.id;
      M.people.people = M.people.people.filter(function (x) { return x.name !== name; });
      if (pNextId(M.people) < hw || !M.people.pre.some(function (l) { return /next-id:/.test(l); })) pSetNextId(M.people, hw);
      var gone = removeInteractions(M.interactions.text, function (e) { return !!pid && e.person === pid; });
      M.interactions.text = gone.text;
      if (st) st.removed = gone.removed;
    });
  },
  restorePerson: function (text, grp, idx, st) {
    return op('Restore person', LOG_KEYS, function (M) {
      var p = pParse('## ' + grp + '\n' + text).people[0];
      if (!p || M.people.people.some(function (x) { return x.name === p.name; })) return;
      M.people.people.splice(Math.min(idx, M.people.people.length), 0, p);
      if (st) M.interactions.text = restoreInteractions(M.interactions.text, st.removed);
    });
  },
  /* projects and systems */
  createEnt: function (kind, name, meta, out) {
    var kindDef = D.model.EDEF[kind], st = { want: null };
    return op('Add ' + kindDef.word, [kindDef.key], function (M) {
      var m = M[kindDef.key], want = st.want ? D.model.rid(st.want) : null;
      var ex = m.ents.filter(function (e) { return e.name.toLowerCase() === name.toLowerCase(); })[0];
      if (ex) { if (want && want !== ex.meta.id) noteAlias(want, ex.meta.id); else if (!want) st.want = ex.meta.id; if (out) out.id = ex.meta.id; return; }
      var n = eNextId(m, kind), id;
      if (want && D.model.idNum(want) >= n && !m.ents.some(function (x) { return x.meta.id === want; })) id = want;
      else { id = fmtEId(kind, n); if (want) noteAlias(want, id); else st.want = id; }
      var mm = { id: id };
      Object.keys(meta).forEach(function (k) { if (meta[k]) mm[k] = meta[k]; });
      m.ents.push({ name: name, grp: lastGroup(m), meta: mm, subs: [] });
      eSetNextId(m, Math.max(n, D.model.idNum(id) + 1));
      if (out) out.id = id;
    });
  },
  patchEnt: function (kind, id, patch) {
    var kindDef = D.model.EDEF[kind];
    return op('Edit ' + id, [kindDef.key], function (M) {
      var e = D.model.entIn(M, kind, id);
      if (!e) return;
      Object.keys(patch).forEach(function (k) { var v = patch[k] == null ? '' : String(patch[k]).replace(/[{};]/g, ' ').trim(); if (k === kindDef.pk) v = D.model.rid(v); if (v === '') delete e.meta[k]; else e.meta[k] = v; });
    });
  },
  renameEnt: function (kind, id, name) { return op('Rename ' + id, [D.model.EDEF[kind].key], function (M) { var e = D.model.entIn(M, kind, id); if (e && name) e.name = name; }); },
  addEntLink: function (kind, id, v) {
    return op('Add URL to ' + id, recKeys(id), function (M) { var r = D.model.recIn(M, id); if (r && !r.x.subs.some(function (s) { return s.k === 'link' && s.v === v; })) placeSub(r.x, { k: 'link', v: v }, r.rank); });
  },
  removeEntLink: function (kind, id, v) {
    return op('Remove URL from ' + id, kind === 'T' ? D.model.ANY : [D.model.EDEF[kind].key], function (M) {
      var e = kind === 'T' ? (D.model.fItem(M, id) || {}).it : D.model.entIn(M, kind, id);
      if (!e) return;
      var k = e.subs.findIndex(function (s) { return s.k === 'link' && s.v === v; });
      if (k >= 0) e.subs.splice(k, 1);
    });
  },
  deleteEnt: function (kind, id) {
    var kindDef = D.model.EDEF[kind];
    return op('Delete ' + id, [kindDef.key, 'rels', 'tasks', 'inbox', 'done'], function (M) {
      var m = M[kindDef.key], x = D.model.rid(id), hw = eNextId(m, kind);
      m.ents = m.ents.filter(function (e) { return e.meta.id !== x; });
      eSetNextId(m, Math.max(hw, eNextId(m, kind)));
      m.ents.forEach(function (e) { if (e.meta[kindDef.pk] === x) delete e.meta[kindDef.pk]; });
      var R = M.rels, n = R.lines.length;
      R.lines = R.lines.filter(function (ln) { var r = REL_RE.exec(ln); return !(r && (r[1] === x || r[3] === x)); });
      if (R.lines.length !== n) relRefresh(R);
      if (kind === 'PRJ') D.model.ANY.forEach(function (k) {
        M[k].items.forEach(function (i) { var all = prjOf(i), p = all.filter(function (y) { return y !== x; }); if (p.length !== all.length) { if (p.length) i.meta.projects = p.join(', '); else delete i.meta.projects; } });
      });
    });
  },
  ensureIds: function () {
    return op('Assign IDs', ['people', 'projects', 'systems'], function (M) { ensurePIds(M.people); ensureEIds(M.projects, 'PRJ'); ensureEIds(M.systems, 'SYS'); });
  }
};
function needsIds(m) {
  return m.people.people.some(function (p) { return !/^P-\d+$/.test(p.meta.id || ''); }) ||
    m.projects.ents.some(function (e) { return !/^PRJ-\d+$/.test(e.meta.id || ''); }) ||
    m.systems.ents.some(function (e) { return !/^SYS-\d+$/.test(e.meta.id || ''); });
}

/* ===================== extra operations used by the panel ===================== */
OPS.entGroup = function (kind, id, grp) {
  return op('Group of ' + id, [D.model.EDEF[kind].key], function (M) { var e = D.model.entIn(M, kind, id); if (e) e.grp = grp; });
};
OPS.newPrjOnTask = function (id, name, out) {
  var wants = {};
  return op('New project on ' + id, ['projects', 'tasks', 'inbox', 'done'], function (M) {
    var pid = ensureProject(M.projects, name, wants), f = D.model.fItem(M, id);
    if (f) { var ps = prjOf(f.it).map(D.model.rid); if (ps.indexOf(pid) < 0) ps.push(pid); f.it.meta.projects = ps.join(', '); }
    if (out) out.id = pid;
  });
};
OPS.restoreEnt = function (kind, snap) {
  var kindDef = D.model.EDEF[kind];
  return op('Restore ' + snap.id, [kindDef.key, 'rels', 'tasks', 'inbox', 'done'], function (M) {
    var m = M[kindDef.key];
    if (!m.ents.some(function (x) { return x.meta.id === snap.id; })) {
      var e = eParse('## ' + snap.grp + '\n' + snap.text).ents[0];
      if (e) { e.grp = snap.grp; m.ents.splice(Math.min(snap.idx, m.ents.length), 0, e); }
    }
    snap.kids.forEach(function (kid) { var k = m.ents.filter(function (x) { return x.meta.id === kid; })[0]; if (k && !k.meta[kindDef.pk]) k.meta[kindDef.pk] = snap.id; });
    var R = M.rels, added = false;
    snap.rels.forEach(function (l) { if (R.lines.indexOf(l) < 0) { if (!R.lines.length) R.lines = REL_HEAD.slice(); R.lines.push(l); added = true; } });
    if (added) relRefresh(R);
    if (kind === 'PRJ') D.model.ANY.forEach(function (k) {
      M[k].items.forEach(function (i) { if (snap.tasks.indexOf(i.id) >= 0) { var ps = prjOf(i); if (ps.indexOf(snap.id) < 0) { ps.push(snap.id); i.meta.projects = ps.join(', '); } } });
    });
  });
};

/* ===================== saving a change ===================== */
function commit(job, opts) {
  opts = opts || {};
  try { job.fn(S.m); } catch (e) { console.error('Could not apply change on screen', e); }
  S.ver++;
  applyAliasNews();
  D.files.Q.jobs.push(job);
  if (opts.toast) toastShow(opts.toast, opts.undo || null);
  D.files.fire('redraw');
  D.files.kick();
}
// One job from the queue: a change to save, or a sync, which reads the folder again.
async function runJob(job) {
  if (!job.sync) return persist(job);
  var m = await loadAll();
  applyLoaded(m);
  S.lastSync = Date.now();
}
async function persist(job) {
  for (var attempt = 0; attempt < 3; attempt++) {
    var M = {}, snap = {}, mods = {}, i, k;
    for (i = 0; i < job.keys.length; i++) {
      k = job.keys[i];
      M[k] = (await readStable(k)).m;
      snap[k] = JSON.stringify(M[k]);
      mods[k] = D.files.lastMod[FILES[k]];
    }
    job.fn(M);
    var changed = job.keys.filter(function (x) { return JSON.stringify(M[x]) !== snap[x]; }), moved = false;
    for (i = 0; i < changed.length && !moved; i++) if ((await D.files.modOf(FILES[changed[i]])) !== mods[changed[i]]) moved = true;
    if (moved) continue;
    var wrote = 0;
    try { for (i = 0; i < changed.length; i++) { await D.files.writeText(FILES[changed[i]], serKey(changed[i], M[changed[i]])); wrote++; } }
    catch (e) { if (e && e.name === 'ConflictError' && !wrote) continue; throw e; }
    job.keys.forEach(function (x) { BASE[x] = countOf(x, M[x]); });
    return;
  }
  throw new Error('another program kept changing the files while this was being saved');
}

/* ===================== taking in a fresh read ===================== */
/* After reading the files again: keep unsaved changes, and mark what changed outside Discerny. */
function sigs(m) {
  var s = new Map();
  D.model.ANY.forEach(function (k) { m[k].items.forEach(function (i) { s.set(i.id, k + '\u0001' + serItem(i)); }); });
  m.people.people.forEach(function (p) { if (p.meta.id) s.set(p.meta.id, p.grp + '\u0001' + pSerItem(p)); });
  m.projects.ents.concat(m.systems.ents).forEach(function (e) { if (e.meta.id) s.set(e.meta.id, e.grp + '\u0001' + eSerItem(e)); });
  var ask = {};
  m.asks.notes.forEach(function (n) { ask[n.id] = (ask[n.id] || '') + n.raw + '\n'; });
  Object.keys(ask).forEach(function (id) { s.set('ask:' + id, ask[id]); });
  m.log.forEach(function (l) { s.set('log:' + l.id + ':' + l.raw, '1'); });
  m.drafts.forEach(function (d) { var id = D.model.draftId(d.name); if (id) s.set('draft:' + id + ':' + d.name, String(d.mod)); });
  m.rels.rels.forEach(function (r) { s.set('rel:' + r.a + ':' + r.raw, '1'); s.set('rel:' + r.b + ':' + r.raw, '1'); });
  return s;
}
function applyLoaded(m) {
  var prev = S.m;
  var before = prev ? sigs(prev) : null;
  S.m = m;
  for (var i = 1; i < D.files.Q.jobs.length; i++) { var j = D.files.Q.jobs[i]; if (!j.sync) { try { j.fn(S.m); } catch (e) { /* replay best effort */ } } }
  S.ver++;
  if (before) {
    var ids = new Set();
    sigs(S.m).forEach(function (v, k) {
      if (before.get(k) === v) return;
      var id = /^(ask|log|draft|rel):/.test(k) ? k.split(':')[1] : k;
      if (id && D.model.labelOf(id) !== null) ids.add(id);
    });
    if (ids.size) {
      ids.forEach(function (id) { S.fresh.add(id); });
      toastShow('Updated from your files: ' + ids.size + (ids.size === 1 ? ' item changed.' : ' items changed.'));
    }
  }
  if (needsIds(S.m) && !D.files.Q.jobs.some(function (j) { return j.label === 'Assign IDs'; })) { var job = OPS.ensureIds(); job.fn(S.m); S.ver++; D.files.Q.jobs.push(job); }
  applyAliasNews();
}
/* A record saved under a different number than the screen showed: rename it on screen and follow it. */
function applyAliasNews() {
  if (!D.model.aliasNews.length) return;
  D.model.aliasNews.splice(0).forEach(function (a) {
    var from = a[0], to = a[1];
    if (S.m) {
      D.model.ANY.forEach(function (k) { S.m[k].items.forEach(function (i) { if (i.id === from) i.id = to; }); });
      S.m.people.people.forEach(function (p) { if (p.meta.id === from) p.meta.id = to; });
      S.m.projects.ents.concat(S.m.systems.ents).forEach(function (e) { if (e.meta.id === from) e.meta.id = to; });
      S.ver++;
    }
    if (S.sel === from) S.sel = to;
    if (S.cur === from) S.cur = to;
    if (S.entity === from) S.entity = to;
    if (S.composer[from] != null) { S.composer[to] = S.composer[from]; delete S.composer[from]; }
    if (S.fresh.has(from)) { S.fresh.delete(from); S.fresh.add(to); }
    toastShow('Saved as ' + to + ': ' + from + ' had just been used in your files for something else.');
  });
  D.files.requestSync(false);
}

/* ===================== toasts and undo ===================== */
var toastSeq = 0, undoFns = {};
function toastShow(text, undo) {
  var id = ++toastSeq;
  if (undo) undoFns[id] = undo;
  S.toasts = S.toasts.concat([{ id: id, text: text, undo: !!undo }]).slice(-3);
  setTimeout(function () { toastDrop(id); }, undo ? 9000 : 5000);
  D.files.fire('redraw');
  return id;
}
function toastDrop(id) {
  delete undoFns[id];
  var n = S.toasts.length;
  S.toasts = S.toasts.filter(function (t) { return t.id !== id; });
  if (S.toasts.length !== n) D.files.fire('redraw');
}
function toastUndo(id) {
  var u = undoFns[id];
  toastDrop(id);
  if (!u) return;
  var job = typeof u === 'function' ? u() : u;
  if (job) commit(job, { toast: 'Undone.' });
}
function undoLast() {
  for (var i = S.toasts.length - 1; i >= 0; i--) if (S.toasts[i].undo) { toastUndo(S.toasts[i].id); return true; }
  return false;
}

/* ===================== answers and actions that only commit ===================== */
function patch(id, p, toast, undo) { commit(OPS.meta(id, p), toast ? { toast: toast, undo: undo } : null); }
// a patch that sets an Item's due date and time from one value, as dueOf gives it ('' clears both)
function duePatch(v) { var m = {}; setDue(m, v); return { 'due-date': m['due-date'] || '', 'due-time': m['due-time'] || '' }; }
function snoozeItem(id, days) {
  var i = D.model.item(id);
  if (!i || !D.model.canSnooze(i) || !days) return;
  var was = dueOf(i.meta), due = snooze(was, days, D.model.todayStr());
  S.snoozeFor = null;
  patch(id, duePatch(due), 'Snoozed ' + id + ' to ' + D.model.fmtDT(due) + '.', OPS.meta(id, duePatch(was)));
}
// Answers to change Proposals. Each says what it did, with an undo; a No is for good.
function relYes(line) {
  var c = D.model.changeByLine(line), r = c && D.model.relOf(c);
  if (!r || !D.model.exists(c.a) || !D.model.exists(c.b)) return;
  var st = {};
  commit(OPS.relYes(c, r.line, st), { toast: 'Related ' + c.a + ' and ' + c.b + '.', undo: OPS.relUnyes(c, r.line, st) });
}
function changeNo(line) {
  var c = D.model.changeByLine(line);
  if (!c) return;
  var what = c.type === 'relationship' ? c.a + ' and ' + c.b + ' won’t be proposed as related again.' : c.type === 'priority' ? c.name + ' won’t be proposed as a Priority person for ' + D.model.plural(D.model.pauseDays(), 'day') + '.' : c.email + ' won’t be proposed again.';
  var st = {};
  commit(OPS.changeNo(c, st), { toast: 'No: ' + what, undo: OPS.changeUnno(c, noLine(c), st) });
}
function emailYes(line) {
  var c = D.model.changeByLine(line), st = {};
  if (!c || c.type !== 'email' || !D.model.personById(c.id)) return;
  commit(OPS.emailYes(c, D.model.todayStr(), st), { toast: 'Added ' + c.email + ' to ' + c.name + '.', undo: OPS.emailUnyes(c, st, D.model.todayStr()) });
}
function prioYes(line) {
  var c = D.model.changeByLine(line), st = {};
  if (!c || c.type !== 'priority' || !D.model.personById(c.id)) return;
  commit(OPS.prioYes(c, st), { toast: c.name + ' is a Priority person now.', undo: OPS.prioUnyes(c, st) });
}
function promotePerson(id) {
  var p = D.model.personById(id), st = {};
  if (!p || D.model.prioOf(p) !== 'off') return;
  commit(OPS.promote(id, st), { toast: p.name + ' is a Priority person now.', undo: OPS.unpromote(id, st) });
}
function demotePerson(id) {
  var p = D.model.personById(id), st = {};
  if (!p || D.model.prioOf(p) !== 'on') return;
  var line = noLine({ type: 'priority', id: D.model.rid(id) });
  commit(OPS.demote(id, line, st), { toast: p.name + ' is no longer a Priority person, and won’t be proposed as one for ' + D.model.plural(D.model.pauseDays(), 'day') + '.', undo: OPS.undemote(id, line, st) });
}
// Undo on a Skill's latest change to a field puts back the value from before its first unacknowledged change, and acknowledges them all
function undoChange(id, field) {
  var x = D.model.recOf(id), u = x ? D.model.undosOf(x).filter(function (y) { return y.field === field; })[0] : null;
  if (!u) return;
  var st = {}, word = D.model.CHANGE_WORD[field] || field;
  commit(OPS.fieldUndo(id, field, u.value, u.which, D.model.todayStr(), st), { toast: word + ' on ' + id + ' is ' + D.model.changeVal(field, u.value) + ' again.', undo: OPS.fieldRedo(id, field, u.which, st) });
}
// Mark done on news that an Item is finished: it is completed as Done does, and its Comments to acknowledge are acknowledged
function markDoneAck(id) {
  var i = D.model.item(id), w = D.model.whereOf(id);
  if (!i || (w !== 'open' && w !== 'inbox')) return;
  var list = commentsOf(i), which = list.filter(toAck).map(function (c) { return [list.indexOf(c), c.v]; }), keys = ['tasks', 'inbox', 'done', 'rels'].concat(LOG_KEYS), st = {}, sa = {};
  var steps = (w === 'inbox' ? [OPS.accept(id, [], st)] : []).concat([OPS.complete(id, D.model.todayStr()), OPS.ack(id, which, false, sa)]);
  var back = [OPS.ack(id, which, true, sa), OPS.reopen(id, i.meta.status || '')].concat(w === 'inbox' ? [OPS.unaccept(id, [], st)] : []);
  commit(op('Mark done ' + id, keys, function (M) { steps.forEach(function (s) { s.fn(M); }); }),
    { toast: 'Done: ' + D.model.clip(i.title, 60), undo: op('Undo done ' + id, keys, function (M) { back.forEach(function (s) { s.fn(M); }); }) });
}
function personAdd(line, priority) {
  var c = D.model.changeByLine(line), st = {};
  if (!c || c.type !== 'person') return;
  var o = { priority: priority, intro: !!S.introOn[changeKey(c)], date: D.model.todayStr(), now: D.model.nowStamp() };
  commit(OPS.personAdd(c, o, st));
  delete S.introOn[changeKey(c)];
  toastShow('Added ' + c.name + ' to People' + (priority ? ' as a Priority person' : '') + (st.task ? ', with ' + st.task + ' to set up an introduction meeting' : '') + '.', OPS.personUnadd(c, o, st));
}
function chase(id) {
  var i = D.model.item(id);
  if (!i) return;
  if (D.model.asksFor(id).some(function (n) { return /^Draft a short, polite chaser/.test(n.text); })) { toastShow('A chaser for ' + id + ' is already queued for the agent.'); return; }
  var who = D.model.realWho(i) || 'them';
  var line = aLine(id, D.model.nowStamp(), 'Draft a short, polite chaser to ' + who + ' about: ' + D.model.waitTitle(i) + '. Ask for an update or a firm date.');
  commit(OPS.addAsk(line), { toast: 'Queued for the agent: a chaser to ' + who + '.', undo: OPS.removeAsk(line) });
}
function gotIt(id) { var i = D.model.item(id); if (!i) return; patch(id, { status: '' }, 'Marked as received. ' + id + ' is back in ' + (i.meta.type === 'meeting' ? 'Upcoming' : i.meta.type === 'fyi' ? 'FYI' : 'Next actions') + '.', OPS.meta(id, { status: 'waiting' })); }
function acknowledge(id) { var i = D.model.item(id); if (!i) return; commit(OPS.complete(id, D.model.todayStr()), { toast: 'Filed ' + id + ' as read.', undo: OPS.reopen(id, i.meta.status || '') }); }
function makeTask(id) {
  var i = D.model.item(id);
  if (!i) return;
  var prev = { type: i.meta.type || '', urgency: i.meta.urgency || '', priority: i.meta.priority || '' }, due = dueOf(i.meta);
  patch(id, { type: 'task', urgency: D.model.isDay(due) ? D.model.urgFor(due) : 'this week', priority: i.meta.priority && i.meta.priority !== 'low' ? i.meta.priority : 'medium' }, id + ' is now a task in Next actions.', OPS.meta(id, prev));
}
function setItemDue(id, date, time) {
  var i = D.model.item(id);
  if (!i) return;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  if (date && parseInt(date, 10) < 1990) return;
  var p = duePatch(date ? date + (time ? ' ' + time : '') : '');
  if (date && i.meta.type !== 'fyi') p.urgency = D.model.urgFor(date);
  patch(id, p);
}
function saveComment(id, k) {
  var c = D.model.commentAt(id, k), text = cleanText(S.cmtEditText);
  S.cmtEdit = null;
  if (!c || !text || text === c.v) { D.files.fire('redraw'); return; }
  commit(OPS.editComment(id, k, c.v, text), { toast: 'Comment updated.', undo: OPS.editComment(id, k, text, c.v) });
}

D.ops = {
  loadAll: loadAll,
  op: op, LOG_KEYS: LOG_KEYS, ignorable: ignorable, dismissLine: dismissLine, OPS: OPS,
  commit: commit,
  applyLoaded: applyLoaded,
  toastShow: toastShow, toastDrop: toastDrop, toastUndo: toastUndo, undoLast: undoLast,
  patch: patch, snoozeItem: snoozeItem, relYes: relYes, changeNo: changeNo, emailYes: emailYes, prioYes: prioYes,
  promotePerson: promotePerson, demotePerson: demotePerson, undoChange: undoChange, markDoneAck: markDoneAck,
  personAdd: personAdd, chase: chase, gotIt: gotIt, acknowledge: acknowledge, makeTask: makeTask,
  setItemDue: setItemDue, saveComment: saveComment
};
D.files.install('toast', function (text) { toastShow(text); });
D.files.install('runJob', runJob);
D.files.install('afterJob', function () { applyAliasNews(); });
})();
