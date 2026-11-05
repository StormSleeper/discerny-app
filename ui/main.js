// The main concern: start-up, loaded last, so that the order things happen in at launch reads in one place. It sets the page's
// listeners, draws the first gate and hands the rest to D.input. It offers nothing, as no concern comes after it.
(function () {
'use strict';
var S = D.model.S;

async function boot() {
  D.render.measure();
  if (S.theme === 'light' || S.theme === 'dark') document.documentElement.setAttribute('data-theme', S.theme);
  document.addEventListener('click', function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!el || el.disabled) return;
    var a = el.getAttribute('data-act');
    if (a === 'dlg-bg' && ev.target !== el) return;
    if (D.input.ACT[a]) D.input.ACT[a](el, ev);
  });
  document.addEventListener('change', function (ev) { var el = ev.target, k = el && el.getAttribute ? el.getAttribute('data-ch') : null; if (k && D.input.CH[k]) D.input.CH[k](el, ev); });
  document.addEventListener('input', function (ev) { var el = ev.target, k = el && el.getAttribute ? el.getAttribute('data-in') : null; if (k && D.input.IN[k]) D.input.IN[k](el, ev); });
  document.addEventListener('submit', function (ev) { var f = ev.target, k = f.getAttribute('data-sub'); if (k && D.input.SUB[k]) { ev.preventDefault(); D.input.SUB[k](f, ev); } });
  document.addEventListener('keydown', D.input.onKey);
  document.addEventListener('scroll', function (ev) {
    var m = ev.target;
    if (!m || m.id !== 'main') return;
    var s = m.scrollTop > 4;
    if (s !== S.scrolled) { S.scrolled = s; var h = m.querySelector('.head'); if (h) h.classList.toggle('scrolled', s); }
  }, true);
  window.addEventListener('resize', function () { D.render.measure(); D.render.render(); });
  // Back, Forward, an edited address or a bookmark; before the folder is read, openFolder lands on the Link instead
  window.addEventListener('hashchange', function () { if (S.ready && S.m && location.hash !== D.links.nav.hashOwn) D.input.land(); });
  window.addEventListener('beforeunload', function (ev) { if (D.files.Q.jobs.some(function (j) { return !j.sync; })) { ev.preventDefault(); ev.returnValue = ''; } });
  // Served by node tools/discern.mjs serve: the server reads and writes the folder, so no picker or permission.
  if (location.protocol === 'http:' && (await D.files.serverInfo())) { D.input.openFolder(); return; }
  if (!('showDirectoryPicker' in window)) { S.gate = { mode: 'nosupport', msg: '' }; D.render.render(); return; }
  var h = await D.files.idbGet('dir');
  if (h && h.kind === 'directory') {
    D.files.useFolder(h); S.folder = h.name;
    var p = 'prompt';
    try { p = await h.queryPermission({ mode: 'readwrite' }); } catch (e) { /* treat as prompt */ }
    if (p === 'granted') { D.input.openFolder(); return; }
    S.gate = { mode: 'reconnect', msg: '' };
    D.render.render();
    return;
  }
  S.gate = { mode: 'pick', msg: '' };
  D.render.render();
}
boot();
})();
