// The files concern: reaches the Data folder, through a folder handle or the server, and runs the job queue. It knows
// nothing of Items, app state or the DOM, so both ways of reaching a folder sit behind one interface. It uses only core.
// It also owns the hook registry: a lower concern never calls a higher one, so where it must set something off it fires
// a hook, and the higher concern installs the handler. A hook says something has happened or hands over a job; it
// never fetches a value from above. Each has one installer, and firing one with none installed throws.
(function () {
'use strict';

/* ===================== hooks ===================== */
var HOOKS = { redraw: 1, toast: 1, runJob: 1, afterJob: 1, folderState: 1, afterDraw: 1 }, on = {};
function install(name, fn) { if (!HOOKS[name] || on[name]) throw new Error('bad hook install: ' + name); on[name] = fn; }
function fire(name, arg) { if (!on[name]) throw new Error('no hook installed: ' + name); return on[name](arg); }

/* ===================== folder handle ===================== */
var dir = null;
function idb() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open('discerny', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('h'); };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}
async function idbGet(k) {
  try {
    var d = await idb();
    return await new Promise(function (res) { var q = d.transaction('h').objectStore('h').get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { res(null); }; });
  } catch (e) { return null; }
}
async function idbSet(k, v) {
  try {
    var d = await idb();
    await new Promise(function (res, rej) { var t = d.transaction('h', 'readwrite'); t.objectStore('h').put(v, k); t.oncomplete = res; t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error); }; });
    return true;
  } catch (e) { return false; }
}
function useFolder(h) { dir = h; }

/* ===================== file input/output ===================== */
var lastMod = {};
// Set when the page is served by node tools/discern.mjs serve: {folder, name, version, session, problem, canSwitch}
// from /api/info. The four functions below then go through the server instead of the folder handle.
var srv = null;
// Every request names the folder this page opened, so a server since switched to another folder refuses it (412).
async function api(path, opts) {
  opts = Object.assign({}, opts);
  if (srv && srv.session) opts.headers = Object.assign({ 'X-Discerny-Session': srv.session }, opts.headers);
  try { return await fetch(path, opts); }
  catch (e) { var err = new Error('the Discerny server isn’t running'); err.name = 'ServerDown'; throw err; }
}
async function apiError(r) {
  var e = new Error((await r.text()) || 'the server answered ' + r.status);
  e.name = r.status === 409 ? 'ConflictError' : r.status === 412 ? 'FolderChanged' : 'ServerError';
  return e;
}
async function serverInfo() {
  try { var r = await fetch('/api/info'); if (!r.ok) return false; srv = await r.json(); return true; } catch (e) { return false; }
}
async function serverMtimes() {
  var r = await api('/api/mtimes');
  if (!r.ok) throw await apiError(r);
  return await r.json();
}
async function readText(name) {
  if (srv) {
    var r = await api('/api/file/' + name);
    if (r.status === 404) { lastMod[name] = 0; return ''; }
    if (!r.ok) throw await apiError(r);
    lastMod[name] = Number(r.headers.get('X-Mtime'));
    return await r.text();
  }
  try { var h = await dir.getFileHandle(name); var f = await h.getFile(); lastMod[name] = f.lastModified; return await f.text(); }
  catch (e) { if (e && e.name === 'NotFoundError') { lastMod[name] = 0; return ''; } throw e; }
}
async function writeText(name, text) {
  if (srv) {
    var hd = { 'Content-Type': 'text/plain; charset=utf-8' };
    if (lastMod[name] !== undefined) hd['If-Mtime'] = String(lastMod[name]);
    var r = await api('/api/file/' + name, { method: 'PUT', headers: hd, body: text });
    if (!r.ok) throw await apiError(r);
    lastMod[name] = (await r.json()).mtime;
    return;
  }
  var h = await dir.getFileHandle(name, { create: true });
  var w = await h.createWritable();
  try { await w.write(text); await w.close(); } catch (e) { try { await w.abort(); } catch (e2) { /* ignore */ } throw e; }
  var f = await h.getFile();
  lastMod[name] = f.lastModified;
}
async function modOf(name) {
  if (srv) return (await serverMtimes())[name] || 0;
  try { var h = await dir.getFileHandle(name); return (await h.getFile()).lastModified; }
  catch (e) { if (e && e.name === 'NotFoundError') return 0; throw e; }
}
async function readDrafts() {
  if (srv) { var r = await api('/api/drafts'); if (!r.ok) throw await apiError(r); return await r.json(); }
  var out = [];
  var d;
  try { d = await dir.getDirectoryHandle('drafts'); } catch (e) { return out; }
  for await (var entry of d.entries()) {
    var name = entry[0], h = entry[1];
    if (h.kind !== 'file' || !/\.(md|txt)$/i.test(name)) continue;
    try { var f = await h.getFile(); out.push({ name: name, text: await f.text(), mod: f.lastModified }); } catch (e) { /* skip unreadable */ }
  }
  out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return out;
}

/* ===================== the save queue =====================
   Operations are saved strictly one after another. Nothing is ever dropped: if a save fails the
   queue stops, the screen says so, and Retry carries on from the failed change. */
var Q = { jobs: [], running: false, blocked: null, wrote: false, lastSaved: 0, syncT: 0 };
function requestSync(external) {
  var pend = Q.jobs.filter(function (j) { return j.sync; })[0];
  if (pend) { if (external) pend.external = true; return; }
  Q.jobs.push({ sync: true, external: !!external });
  kick();
}
function scheduleSync(ms) { clearTimeout(Q.syncT); Q.syncT = setTimeout(function () { requestSync(false); }, ms || 600); }
// Lost access to the folder: the browser's permission, or the server that was serving it.
function isPermErr(e) { return !!e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'ServerDown'); }
// The server now serves another folder than the one this page opened: nothing more is read or saved, and the page offers to reload.
function isMoved(e) { return !!e && e.name === 'FolderChanged'; }
function errText(e) { return (e && (e.message || e.name)) || 'unknown error'; }
// The gate for a folder whose DISCERNY.md records a Format other than this app's, or null when they match.
async function formatGate() {
  var v = formatOf(await readText('DISCERNY.md')), is = formatIs(v);
  return is === 'same' ? null : { mode: v === 'next' ? 'fmtnext' : is === 'older' ? 'fmtold' : 'fmtnew', msg: '', format: v };
}
// An open folder whose Format changed (an Upgrade ran while the page was open) is refused, not written to.
function refuseFormat(g) {
  if (Q.jobs.some(function (j) { return !j.sync; })) g.msg = 'Changes you had not saved yet were not written to it.';
  Q.jobs = []; Q.blocked = null; fire('folderState', { ready: false, gate: g });
}
async function kick() {
  if (Q.running || Q.blocked) return;
  Q.running = true;
  fire('redraw');
  while (Q.jobs.length && !Q.blocked) {
    var job = Q.jobs[0];
    try {
      var g = await formatGate();
      if (g) { refuseFormat(g); break; }
      await fire('runJob', job);
      if (!job.sync) { Q.wrote = true; Q.lastSaved = Date.now(); }
      Q.jobs.shift();
      fire('afterJob');
    } catch (e) {
      console.error(e);
      if (isMoved(e)) { fire('folderState', { moved: true }); Q.blocked = { job: job, msg: errText(e) }; }
      else if (isPermErr(e)) { fire('folderState', { lost: true }); Q.blocked = { job: job, msg: 'The browser no longer has permission to use the folder.' }; }
      else if (job.sync) { Q.jobs.shift(); fire('toast', 'Couldn’t read the folder: ' + errText(e)); }
      else Q.blocked = { job: job, msg: errText(e) };
    }
  }
  Q.running = false;
  if (!Q.jobs.length && !Q.blocked && Q.wrote) { Q.wrote = false; scheduleSync(500); }
  fire('redraw');
}
function discardPending() { Q.jobs = []; Q.blocked = null; requestSync(false); }

// dir and srv get reassigned, so they're read-only accessors; useFolder and serverInfo set them.
D.files = {
  get dir() { return dir; }, useFolder: useFolder, get srv() { return srv; }, serverInfo: serverInfo, serverMtimes: serverMtimes,
  api: api, lastMod: lastMod, readText: readText, writeText: writeText, modOf: modOf, readDrafts: readDrafts, idbGet: idbGet, idbSet: idbSet,
  Q: Q, requestSync: requestSync, scheduleSync: scheduleSync, kick: kick, discardPending: discardPending,
  isPermErr: isPermErr, isMoved: isMoved, errText: errText, formatGate: formatGate, install: install, fire: fire
};
})();
