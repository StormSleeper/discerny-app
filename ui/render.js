// The render concern: puts markup on the page, by the morph, and keeps layout and focus. It never knows what a View means: it draws
// D.views.page() and fires afterDraw for whatever follows. Everything it shares is on D.render, and the rest stays private to this file.
(function () {
'use strict';
var S = D.model.S;

/* ===================== DOM morphing: update the page in place so focus, caret and scroll survive ===================== */
function keyOf(n) { if (n.nodeType !== 1) return null; return n.getAttribute('data-k') || (n.id ? '#' + n.id : null); }
function sameNode(a, b) { return a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && a.namespaceURI === b.namespaceURI)); }
function morphAttrs(a, b) {
  var ba = b.attributes, i;
  for (i = 0; i < ba.length; i++) { var at = ba[i]; if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value); }
  var aa = a.attributes;
  for (i = aa.length - 1; i >= 0; i--) { var n = aa[i].name; if (!b.hasAttribute(n)) a.removeAttribute(n); }
}
function morphNode(a, b) {
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  morphAttrs(a, b);
  var tag = a.tagName, focused = a === document.activeElement && !D.model.forced.has(a.id);
  if (tag === 'INPUT') {
    if (a.type === 'checkbox' || a.type === 'radio') { var c = b.hasAttribute('checked'); if (a.checked !== c) a.checked = c; }
    else if (!focused) { var v = b.getAttribute('value') || ''; if (a.value !== v) a.value = v; }
    return;
  }
  if (tag === 'TEXTAREA') {
    var tv = b.textContent;
    if (a.defaultValue !== tv) a.defaultValue = tv;
    if (!focused && a.value !== tv) a.value = tv;
    return;
  }
  morphChildren(a, b);
  if (tag === 'SELECT') { var so = b.querySelector('option[selected]'), sv = so ? so.getAttribute('value') : (a.options[0] ? a.options[0].value : ''); if (a.value !== sv) a.value = sv; }
}
function morphChildren(a, b) {
  var old = new Map(), c;
  for (c = a.firstChild; c; c = c.nextSibling) { var k0 = keyOf(c); if (k0) old.set(k0, c); }
  var cur = a.firstChild, kids = Array.prototype.slice.call(b.childNodes);
  for (var i = 0; i < kids.length; i++) {
    var n = kids[i], k = keyOf(n), m = null;
    if (k) { m = old.get(k) || null; if (m && !sameNode(m, n)) m = null; if (m) old.delete(k); }
    else if (cur && !keyOf(cur) && sameNode(cur, n)) m = cur;
    if (m) { if (m === cur) cur = cur.nextSibling; else a.insertBefore(m, cur); morphNode(m, n); }
    else a.insertBefore(n, cur);
  }
  while (cur) { var nx = cur.nextSibling; a.removeChild(cur); cur = nx; }
}

/* ===================== render ===================== */
var renderQ = false;
// The window's width, for layout: model reads it from S.width, as it can't ask the DOM.
function measure() { S.width = window.innerWidth; }
function render() { if (renderQ) return; renderQ = true; requestAnimationFrame(renderNow); }
function renderNow() {
  measure();
  renderQ = false;
  var root = document.getElementById('app');
  var html;
  try { html = D.views.page(); }
  catch (e) { console.error(e); html = '<div class="gate"><main class="gate-c"><h1>Something went wrong drawing the page</h1><p>' + D.views.esc(D.files.errText(e)) + '</p><p class="hint">Your files are not affected. Reload the page to try again.</p></main></div>'; }
  var t = document.createElement('template');
  t.innerHTML = html;
  var ae = document.activeElement, ss = null, se = null;
  try { if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && typeof ae.selectionStart === 'number') { ss = ae.selectionStart; se = ae.selectionEnd; } } catch (e) { /* some inputs have no selection */ }
  morphChildren(root, t.content);
  D.model.forced.clear();
  if (ae && ae !== document.body && document.activeElement !== ae) {
    if (document.contains(ae)) { ae.focus({ preventScroll: true }); try { if (ss != null) ae.setSelectionRange(ss, se); } catch (e) { /* ignore */ } }
    else if (ae.id && document.getElementById(ae.id)) document.getElementById(ae.id).focus({ preventScroll: true });
  }
  afterRender();
}
function afterRender() {
  if (S.focusSel) {
    var el = document.querySelector(S.focusSel);
    S.focusSel = null;
    if (el) el.focus({ preventScroll: true });
  }
  D.files.fire('afterDraw');
}
function focusLater(sel) {
  S.focusSel = sel;
  var el = document.querySelector(sel);
  if (!el) { renderNow(); return; }
  try { el.focus({ preventScroll: true }); } catch (e) { /* not focusable yet */ }
  render();
}

D.render = {
  get renderQ() { return renderQ; },
  render: render, renderNow: renderNow, focusLater: focusLater, measure: measure
};
D.files.install('redraw', function () { render(); });
})();
