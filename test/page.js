// Loads the page's own script outside a browser so its logic can be tested: tracing, naming, the port register, CSV.
// The page is given a snapshot, exactly as an offline snapshot file would give it, and a stand-in for the browser
// that accepts anything and draws nothing. The page hands its functions over through window.VENUE_TEST.
const fs = require('fs'), path = require('path'), vm = require('vm');

function standIn() {
  const data = {}, classes = { toggle() {}, add() {}, remove() {}, contains: () => false };
  const fn = function () {};
  const el = new Proxy(fn, {
    get(_, k) {
      if (k === 'dataset') return data;
      if (k === 'classList') return classes;
      if (k === 'textContent' || k === 'innerHTML' || k === 'value' || k === 'id') return '';
      if (k === 'checked' || k === 'hidden') return false;
      if (k === 'files' || k === 'then') return undefined;
      if (k === Symbol.toPrimitive) return () => '';
      return el;
    },
    set: () => true,
    apply: () => el,
  });
  return el;
}

function loadPage(snapshot) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'venue-router.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const code = scripts[scripts.length - 1];
  const el = standIn();
  let api = null;
  const window = { addEventListener() {}, scrollTo() {}, innerHeight: 800, VENUE_TEST: a => { api = a; } };
  const document = {
    getElementById: id => (id === 'snap' ? { textContent: JSON.stringify(snapshot) } : el),
    querySelector: () => el, querySelectorAll: () => [], addEventListener() {}, createElement: () => el, activeElement: null, body: el,
  };
  const store = {};
  const sandbox = {
    window, document, console, setTimeout, clearTimeout, JSON, Date, Math, RegExp, URL,
    location: { hash: '' }, navigator: { userAgent: 'test' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    fetch: () => Promise.reject(new Error('The tests have no server behind the page.')),
    EventSource: function () { this.close = () => {}; },
  };
  vm.runInNewContext(code, sandbox, { filename: 'venue-router.html' });
  if (!api) throw new Error('The page did not hand over its functions. Is the VENUE_TEST hook still at the end of the script?');
  return api;
}

module.exports = { loadPage };
