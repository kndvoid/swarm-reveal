/*
 * index.js — public entry point.
 *
 *   import { start, stop, toggle } from './src/index.js';
 *
 * The module never auto-starts: the host page decides when (a button click is
 * also the gesture browsers require before audio may play).
 */

import { Swarm } from './engine.js';
import { capture } from './snapshot.js';
import { Reveal } from './reveal.js';

let current = null;
let booting = false;
let revealing = null;

export function start(opts = {}) {
  if (current) return current;
  const swarm = new Swarm(opts);
  const realStop = swarm.stop.bind(swarm);
  swarm.stop = (reveal = true) => {
    realStop(reveal);
    if (current === swarm) current = null;
  };
  current = swarm;
  swarm.start();
  return swarm;
}

export function stop(reveal = true) {
  if (current) current.stop(reveal);
}

export function toggle(opts = {}) {
  if (current) stop(true);
  else start(opts);
}

export function isRunning() {
  return !!current;
}

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Works on phones too; the overlay scales its agent count down there.
export const supported = () => window.innerWidth >= 320;

// Convenience global for inline scripts and quick console poking.


// ------------------------------------------------------------ change watch
// Cheap signature of the live DOM: element count + text length. No layout.
function domSig() {
  const b = document.body;
  return b.getElementsByTagName('*').length + ':' + (b.textContent || '').length;
}

function layerKey(l) {
  return l.kind + '|' + Math.round(l.x) + ',' + Math.round(l.y) + ',' +
    Math.round(l.w) + ',' + Math.round(l.h) + '|' + (l.sig || '');
}

// A two-sided diff. Additions and removals need different engine modes:
// default mode appends new layers, 'current' mode tears down vanished ones.
function diffModel(oldModel, newModel) {
  const oldKeys = new Map();
  oldModel.layers.forEach((l, i) => { const k = layerKey(l); if (!oldKeys.has(k)) oldKeys.set(k, i); });
  const newKeys = new Set(newModel.layers.map(layerKey));
  const added = [];
  const removed = [];
  newModel.layers.forEach((l, i) => { if (!oldKeys.has(layerKey(l))) added.push(i); });
  oldModel.layers.forEach((l, i) => { if (!newKeys.has(layerKey(l))) removed.push(i); });
  return { added, removed };
}

function toRanges(indices, cap) {
  const out = [];
  for (const i of indices) {
    const last = out[out.length - 1];
    if (last && i <= last[1] + 2) last[1] = i + 1;
    else out.push([i, i + 1]);
    if (out.length >= (cap || 24)) break;
  }
  return out;
}

function watchChanges(swarm) {
  let sig = domSig();
  // The engine owns this.model; diff against a local copy instead of
  // overwriting it, or nodes[] and model.layers[] stop lining up.
  let lastModel = swarm.model;
  let timer = 0;
  let busy = false;

  const dbg = (window.__swarmWatch = window.__swarmWatch || { fired: 0, err: null, ranges: 0, sig: 0 });
  const run = async () => {
    dbg.fired++;
    if (busy || current !== swarm || swarm.dead) { dbg.err = 'guard'; return; }
    const now = domSig();
    if (now === sig) return;
    busy = true;
    try {
      const next = capture({ skipSelector: '#swarm-own-root' });
      const { added, removed } = diffModel(lastModel, next);
      dbg.ranges = added.length + removed.length;
      dbg.added = added.length;
      dbg.removed = removed.length;
      sig = now;
      if (!added.length && !removed.length) return;

      if (typeof swarm.rebuildRegion !== 'function') {
        swarm.stop(false);
        start({ instant: true, hud: false, speed: 3, ...(swarm.opts || {}) });
        return;
      }
      // Removals first (instant, no animation worth watching), then additions.
      // Chain them instead of using a timer: a region job is single-slot, so a
      // fixed delay could cancel the teardown before it finished.
      const addLater = () => {
        if (!swarm.dead && added.length) swarm.rebuildRegion(toRanges(added), { model: next, speed: 3 });
      };
      if (removed.length) {
        swarm.rebuildRegion(toRanges(removed), {
          rangesIn: 'current', model: next, speed: 8, onRegionDone: addLater,
        });
      } else if (added.length) {
        addLater();
      }
      lastModel = next;
    } catch (e) {
      dbg.err = String((e && e.message) || e);
    } finally {
      busy = false;
    }
  };

  // The engine mirrors typed values onto the REAL control and dispatches an
  // input event there. Without this guard that event re-enters the watcher on
  // every keystroke, re-capturing the whole page and fighting the caret.
  const isField = (t) => {
    try { return !!(t && t.closest && t.closest('input,textarea,select,[contenteditable]')); }
    catch (_) { return false; }
  };
  const schedule = (e) => {
    if (e && isField(e.target)) return;
    clearTimeout(timer);
    timer = setTimeout(run, 160);
  };

  document.addEventListener('click', schedule, true);
  document.addEventListener('change', schedule, true);
  document.addEventListener('input', schedule, true);
  let scrollT = 0;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollT);
    scrollT = setTimeout(run, 220);
  }, { passive: true });
  return () => {
    document.removeEventListener('click', schedule, true);
    document.removeEventListener('change', schedule, true);
    document.removeEventListener('input', schedule, true);
    clearTimeout(timer);
  };
}

// ------------------------------------------------------------- in-place boot
// The real DOM is revealed element by element: no copy, so every click,
// hover, form and menu behaves exactly as the page does.
// The site is a React app: clicking a link swaps <main> without a page load,
// so a boot that only runs on 'load' never fires again. Re-arm on every
// client-side route change.
let navWatching = false;
function watchNavigation() {
  if (navWatching) return;
  navWatching = true;
  let t = 0;
  const veilNow = () => {
    if (document.getElementById('swarm-nav-veil')) return;
    const st = document.createElement('style');
    st.id = 'swarm-nav-veil';
    st.textContent = 'body{visibility:hidden!important}';
    (document.head || document.documentElement).appendChild(st);
    // If the engine never gets there, never leave the page hidden.
    setTimeout(() => { try { st.remove(); } catch (_) { /* gone */ } }, 4000);
  };
  const kick = () => {
    // React Router calls replaceState while hydrating the page we are already
    // on. Treating that as a navigation tore the engine down and blanked the
    // page for a second after every load.
    const now = location.pathname + location.search;
    if (now === seenPath) return;
    seenPath = now;
    veilNow();
    clearTimeout(t);
    t = setTimeout(async () => {
      // Do NOT restore: the old DOM is being torn down, and React may reuse
      // those very nodes for the new page. Restoring wrote the previous page's
      // text back into them, which is how a page appeared to "stick".
      try { if (revealing) { revealing.stop(false); revealing = null; } } catch (_) { /* gone */ }
      try { const h = document.getElementById('swarm-reveal-root'); if (h) h.remove(); } catch (_) { /* gone */ }
      try { await waitForRouteRender(); } catch (_) { /* keep going */ }
      try { await waitForContent(); } catch (_) { /* keep going */ }
      if (!revealing) {
        try { bootReveal(); } catch (_) { /* never break the page */ }
      }
    }, 0);
  };
  // Restored from the back/forward cache: the DOM comes back exactly as it was
  // left, which can be mid-build with elements hidden and no engine running.
  // Restore, clear any veil, then build again.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    try { if (revealing) { revealing.stop(true); revealing = null; } } catch (_) { /* gone */ }
    for (const id of ['swarm-boot', 'swarm-veil', 'swarm-nav-veil']) {
      const v = document.getElementById(id);
      if (v) v.remove();
    }
    setTimeout(() => { if (!revealing) { try { bootReveal(); } catch (_) { /* never break the page */ } } }, 250);
  });

  window.addEventListener('popstate', kick);
  window.addEventListener('hashchange', kick);
  // Belt and braces: some routers swap the view without touching history.
  var seenPath = location.pathname + location.search;
  setInterval(() => {
    const now = location.pathname + location.search;
    if (now !== seenPath) kick();   // kick() updates seenPath itself
  }, 800);
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    if (typeof orig !== 'function') continue;
    history[m] = function (...args) {
      const r = orig.apply(this, args);
      kick();
      return r;
    };
  }
}

// Hard rescue: used when the engine cannot start. Removes every veil and
// clears the inline hiding we applied, so a failure can never leave a blank
// page. Cheap and idempotent.
export function rescuePage() {
  try {
    for (const id of ['swarm-boot', 'swarm-veil', 'swarm-nav-veil']) {
      const v = document.getElementById(id);
      if (v) v.remove();
    }
    const els = document.body.querySelectorAll('*');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.style && el.style.opacity === '0') el.style.opacity = '';
      if (el.style && el.style.clipPath) el.style.clipPath = '';
    }
    const st = document.getElementById('swarm-rescue');
    if (!st) {
      const s2 = document.createElement('style');
      s2.id = 'swarm-rescue';
      s2.textContent = 'body,body *{visibility:visible!important}';
      document.head.appendChild(s2);
    }
  } catch (_) { /* nothing left to try */ }
}

export function bootReveal(opts = {}) {
  if (revealing) return revealing;
  if (reducedMotion() || !supported()) return null;
  if (document.documentElement.hasAttribute('data-swarm-off')) return null;
  watchNavigation();
  const r = new Reveal(opts);
  revealing = r;
  const realStop = r.stop.bind(r);
  r.stop = (all = true) => {
    realStop(all);
    if (revealing === r) revealing = null;
  };
  // Wait for hydration to settle before scanning, so the captured page is
  // the finished one. The veil keeps it invisible while we wait.
  let tries = 0;
  const begin = async () => {
    if (revealing !== r || r.dead) return;
    // Hydration can leave the page momentarily empty; wait for real content,
    // but only as long as it actually takes.
    await waitForContent(60, 1600);
    if (revealing !== r || r.dead) return;
    let ok = false;
    try { ok = r.start(); } catch (err) { ok = false; }
    if (ok) return;
    // The scan caught the page mid-render; drop the stub and try again.
    r.stop(true);
    if (revealing === r) revealing = null;
    if (tries++ < 6) {
      setTimeout(() => { if (!revealing && !document.getElementById('swarm-boot')) bootReveal(opts); }, 350);
    } else {
      // Could not start: the page must be visible regardless.
      rescuePage();
    }
  };
  begin();
  return r;
}

export function revealRunning() { return !!revealing; }

// ---------------------------------------------------------------- site boot
// Runs the effect on a normal page: cover it, let lazy content and
// reveal-on-scroll settle, then rebuild it from blank.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve once the element count has been unchanged for 300 ms (or timeout).
async function settleDom(timeout = 3000) {
  const t0 = Date.now();
  let last = -1;
  let stableAt = Date.now();
  while (Date.now() - t0 < timeout) {
    const n = document.body.getElementsByTagName('*').length;
    if (n !== last) { last = n; stableAt = Date.now(); }
    else if (Date.now() - stableAt > 200) return;
    await wait(100);
  }
}

// Poll for real content instead of sleeping a fixed time: the engine starts
// the moment React has rendered the page.
// A route change fires pushState BEFORE React renders the new page. Scanning
// at that moment captures the page we are leaving, which then sits on screen
// while the new one replaces it. Wait for the main region to actually change.
function waitForRouteRender(timeout = 900) {
  return new Promise((resolve) => {
    const root = document.querySelector('main') || document.body;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { obs.disconnect(); } catch (_) { /* gone */ }
      setTimeout(resolve, 40);
    };
    let obs = null;
    try {
      obs = new MutationObserver(finish);
      obs.observe(root, { childList: true, subtree: true, characterData: true });
    } catch (_) { /* no observer: fall through to the timeout */ }
    setTimeout(finish, timeout);
  });
}

async function waitForContent(min = 60, timeout = 1200) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (document.body && document.body.getElementsByTagName('*').length >= min) return true;
    await wait(50);
  }
  return false;
}

async function lazyPass() {
  const vh = window.innerHeight;
  const h = Math.min(document.documentElement.scrollHeight, 40000);
  if (h <= vh * 1.2) return;
  const step = Math.round(vh * 0.85);
  const max = Math.min(28, Math.ceil((h - vh) / step) + 1);
  for (let i = 1; i <= max; i++) {
    window.scrollTo(0, Math.min(h, i * step));
    await wait(30);
  }
  window.scrollTo(0, 0);
  await wait(120);
}

export async function boot(opts = {}) {
  if (current || booting) return null;
  if (reducedMotion() || !supported()) return null;
  if (document.documentElement.hasAttribute('data-swarm-off')) return null;

  const bg = getComputedStyle(document.body).backgroundColor || '#fff';
  const cover = document.createElement('div');
  cover.setAttribute('aria-hidden', 'true');
  cover.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;background:' + bg +
    ';transition:opacity .2s ease;pointer-events:none';   // never trap a click
  // Hard failsafe: whatever happens, the cover cannot outlive 6 s.
  setTimeout(() => { try { cover.remove(); } catch (_) {} }, 6000);
  document.documentElement.appendChild(cover);
  booting = true;

  try {
    if (document.readyState !== 'complete') {
      await Promise.race([
        new Promise((r) => window.addEventListener('load', r, { once: true })),
        wait(2500),
      ]);
    }
    if (document.fonts && document.fonts.ready) {
      await Promise.race([document.fonts.ready, wait(1500)]);
    }
    // Wait for the DOM to stop changing. On a hydrated React page the first
    // frames after 'load' are still settling, and capturing then produced
    // wildly different layer counts run to run (53 vs 171 on the same page).
    await settleDom();
    await lazyPass();
    await new Promise((r) => requestAnimationFrame(r));
    const swarm = start({ instant: true, hud: false, speed: 2, ...opts });
    // Keep the build bounded: a content-heavy page can carry 2,000+ layers,
    // which at a fixed pace would run for a minute. Scale the pace with the
    // work so every page finishes in roughly the same window.
    const n = (swarm.tasks && swarm.tasks.length) || 0;
    if (n > 400) swarm.speed = Math.min(8, Math.max(2, n / 150));
    watchChanges(swarm);
    // The overlay paints its own opaque background on the first frame.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      cover.style.opacity = '0';
      setTimeout(() => cover.remove(), 220);
    }));
    return swarm;
  } catch (err) {
    cover.remove();
    try { rescuePage(); } catch (_) { /* nothing left */ }
    return null;
  } finally {
    booting = false;
  }
}

window.__swarmOwn = {
  start,
  stop,
  toggle,
  boot,
  bootReveal,
  isRunning,
  get reveal() {
    return revealing && revealing.tasks && revealing.tasks.length ? revealing : null;
  },
  reducedMotion,
  supported,
  get app() { return current; },
};
