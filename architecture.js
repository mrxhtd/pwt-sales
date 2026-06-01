// ─── CSP-SAFE EVENT DELEGATION ──────────────────────────
// Inline on*= handlers were removed so the CSP can drop 'unsafe-inline'.
// Markup declares behaviour via data-<event>="fnName" + optional
// data-<event>-args (a JSON array). Arg tokens: "$el" -> the element,
// "$value" -> el.value, "$event" -> the event. Bare data-stop / data-prevent
// map to stopPropagation() / preventDefault().
(function () {
  var EVENTS = { click: 'data-click', input: 'data-input', change: 'data-change', submit: 'data-submit' };
  function resolveArg(a, el, e) {
    if (a === '$el') return el;
    if (a === '$value') return el.value;
    if (a === '$event') return e;
    return a;
  }
  Object.keys(EVENTS).forEach(function (evt) {
    var attr = EVENTS[evt];
    document.addEventListener(evt, function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var el = t.closest('[' + attr + ']');
      if (!el) return;
      if (el.hasAttribute('data-prevent')) e.preventDefault();
      if (el.hasAttribute('data-stop')) e.stopPropagation();
      var name = el.getAttribute(attr);
      if (!name) return;
      var fn = window[name];
      if (typeof fn !== 'function') return;
      var raw = el.getAttribute(attr + '-args');
      var args = raw ? JSON.parse(raw).map(function (a) { return resolveArg(a, el, e); }) : [];
      fn.apply(el, args);
    });
  });
})();

// Helper for handlers that just click another element (e.g. hidden file inputs).
function clickEl(id) { var el = document.getElementById(id); if (el) el.click(); }

function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('sec-' + id).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  this.classList.add('active');
  window.scrollTo({ top: document.querySelector('.nav').offsetTop, behavior: 'smooth' });
}
