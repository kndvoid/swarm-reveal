/*! swarm-reveal — MIT licensed. https://github.com/kndvoid/swarm-reveal */
(function () {
'use strict';

/* ---- util.js ---- */
// Small helpers shared by the engine.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const now = () => performance.now();

function mk(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

// Apply a {property: value} map, skipping empties so we don't clobber defaults.
// Keys may be camelCase or kebab-case: style.setProperty only accepts the
// latter, so convert first (a silent failure otherwise).
function applyStyles(el, obj) {
  for (const k in obj) {
    const v = obj[k];
    if (v == null || v === '' || v === 'none' || v === 'normal') continue;
    const prop = k.includes('-') ? k : k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    try { el.style.setProperty(prop, v); } catch (_) { /* ignore invalid */ }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}


/* ---- sound.js ---- */
/*
 * sound.js — synthesised in-browser, no audio files.
 * Kept deliberately quiet: a mechanical key for typing, a soft thock when a
 * box lands, a single glass note when a layer completes.
 */

class Sound {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.volume = 0.5;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch (_) { this.ctx = null; }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setOn(v) {
    this.on = v;
    if (this.master) this.master.gain.value = v ? this.volume : 0;
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  // Pan by horizontal cursor position, -1..1.
  out(pan = 0) {
    if (!this.ctx) return null;
    if (!this.panner) {
      this.panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (this.panner) this.panner.connect(this.master);
    }
    if (!this.panner) return this.master;
    this.panner.pan.value = Math.max(-1, Math.min(1, pan));
    return this.panner;
  }

  noise(dur = 0.04) {
    const n = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  // Short mechanical click — used per typed character.
  key(pan = 0, pitch = 1) {
    if (!this.on || !this.ctx) return;
    const t = this.t;
    const src = this.noise(0.03);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 * pitch;
    bp.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    src.connect(bp).connect(g).connect(this.out(pan));
    src.start(t);
    src.stop(t + 0.05);
  }

  // Soft low thock when a box finishes drawing.
  thock(pan = 0, freq = 180) {
    if (!this.on || !this.ctx) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.09);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + 0.16);
  }

  // Single glass note from an E major pentatonic, panned to the cursor.
  chime(pan = 0, index = 0) {
    if (!this.on || !this.ctx) return;
    const scale = [329.63, 369.99, 415.30, 493.88, 554.37, 659.25, 739.99, 830.61];
    const f = scale[Math.min(scale.length - 1, Math.abs(index) % scale.length)];
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + 0.55);
  }

  // Airy swell as the page dissolves.
  swell() {
    if (!this.on || !this.ctx) return;
    const t = this.t;
    const src = this.noise(0.7);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.linearRampToValueAtTime(1600, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.18);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.7);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
  }

  // Small arpeggio when the swarm fans out.
  fanfare() {
    if (!this.on || !this.ctx) return;
    [0, 2, 4].forEach((n, i) => setTimeout(() => this.chime(0, n), i * 90));
  }

  close() {
    if (!this.ctx) return;
    try { this.ctx.close(); } catch (_) {}
    this.ctx = null;
  }
}


/* ---- scan.js ---- */
/*
 * scan.js — find the real elements the swarm will reveal, in build order.
 *
 * Unlike snapshot.js (which copies a page into layers), this keeps a live
 * reference to every element. The engine hides those elements and reveals
 * them one by one, so the page being animated IS the page — clicks, hover,
 * forms, menus and scrolling are never approximated.
 *
 * Item kinds:
 *   box   — paints something (background, border, shadow); revealed by wipe
 *   text  — an inline-only text host; typed if it has no element children,
 *           otherwise revealed as a block
 *   media — img / svg / video / canvas / iframe; revealed by a sweep
 */

const SKIP = new Set([
  'SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'BASE',
]);

const MEDIA = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'PICTURE', 'SVG']);

const INLINE_DISPLAY = /^inline(?!-block|-flex|-grid)/;

function isInline(d) {
  return INLINE_DISPLAY.test(d);
}

function paintsBox(cs) {
  const bg = cs.backgroundColor;
  const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  const hasImg = cs.backgroundImage && cs.backgroundImage !== 'none';
  const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((s) => {
    const w = parseFloat(cs[`border${s}Width`]) || 0;
    const st = cs[`border${s}Style`];
    return w > 0 && st !== 'none' && st !== 'hidden';
  });
  const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
  return hasBg || hasImg || hasBorder || hasShadow;
}

function scan(root = document.body, opts = {}) {
  const items = [];
  const max = opts.max || 1200;   // hard cap: bounds memory on huge pages
  const skipSel = opts.skipSelector || null;

  const walk = (el) => {
    if (!el || el.nodeType !== 1 || items.length >= max) return;
    const tag = el.tagName ? el.tagName.toUpperCase() : '';
    if (!tag || SKIP.has(tag)) return;
    if (skipSel) {
      try { if (el.matches(skipSel)) return; } catch (_) { /* bad selector */ }
    }

    // Never treat the document root as an element to draw: clipping <body>
    // clips the entire page and leaves everything below it invisible.
    if (el === document.body || el === document.documentElement) {
      for (const c of el.children) walk(c);
      return;
    }

    // A container taller than a couple of screens is page scaffolding, not
    // content. Drawing it with a clip hides everything inside it for seconds
    // (on a phone the page-level wrapper is 10,000px tall), so walk into it.
    try {
      const rr = el.getBoundingClientRect();
      if (rr.height > window.innerHeight * 2.5 && el.children.length) {
        for (const c of el.children) walk(c);
        return;
      }
    } catch (_) { /* keep going */ }

    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const wasHidden = parseFloat(cs.opacity) === 0;
    if (cs.contentVisibility === 'hidden') return;

    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;

    const rect = {
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      w: r.width,
      h: r.height,
    };

    if (MEDIA.has(tag)) {
      items.push({ el, kind: 'media', wasHidden, ...rect });
      return;
    }

    const kids = [...el.children];
    const inlineOnly = kids.every((c) => {
      const ccs = getComputedStyle(c);
      return ccs.display !== 'none' && isInline(ccs.display);
    });
    const hasText = !!(el.textContent && el.textContent.trim());

    if (hasText && inlineOnly) {
      items.push({
        el,
        kind: 'text',
        wasHidden,
        typing: kids.length === 0,     // only a leaf can be typed into safely
        text: kids.length === 0 ? el.textContent : null,
        ...rect,
      });
      return;
    }

    if (paintsBox(cs)) items.push({ el, kind: 'box', wasHidden, ...rect });
    for (const c of kids) walk(c);
  };

  walk(root);

  // Build order: top-down, then left-right. Revealing a parent before its
  // children matters because a hidden parent hides the subtree.
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  items.forEach((it, i) => { it.i = i; });
  return items;
}


/* ---- reveal.js ---- */
/*
 * reveal.js — the in-place swarm.
 *
 * The real page is hidden element by element and then revealed by the
 * cursors. There is no copy of the page: what the visitor clicks is the
 * page itself, so links, hover, forms, menus and scrolling are exact.
 *
 * Only two things are drawn on top, both pointer-events:none:
 *   - the cursor agents
 *   - transient annotations (drag outlines, size badges, carets)
 */



const RV_NAMES = ['Ada', 'Grace', 'Alan', 'Radia', 'Ken', 'Barbara', 'Linus', 'Margaret', 'Hedy', 'Guido', 'Katherine', 'Dennis', 'Frances', 'Tim', 'Joan', 'Bjarne'];
const RV_COLORS = ['#5060F0', '#F01010', '#F0C000'];   // the emblem's own blue, red, yellow

const RV_POINTER = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
  <path d="M5.5 3.2 19 12.1l-6.1 1.2-3.2 5.4z" fill="currentColor" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>
</svg>`;

const RV_CROSSHAIR = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
  <path d="M12 3v6M12 15v6M3 12h6M15 12h6" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M12 3v6M12 15v6M3 12h6M15 12h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

class Reveal {
  constructor(opts = {}) {
    this.opts = opts;
    this.speed = opts.speed || 0.3;   // doubled   // deliberate pace
    this.dead = false;
    this.tasks = [];
    this.agents = [];
    this.ptr = 0;
    this.done = 0;
    this.mouse = null;
    this.orbitPhase = 0;
    this.raf = 0;
    this.last = 0;
    this._prevT = 0;
    this.perf = { frames: 0, sum: 0, worst: 0, samples: [], jsSum: 0, jsFrames: 0, jsWorst: 0 };
    this.onState = opts.onState || (() => {});
  }

  /* ---------------------------------------------------------------- start */

  start() {
    if (this.tasks.length) return true;
    const tStart = performance.now();
    // Drop the boot veil first: it hides <body>, and the scanner skips
    // hidden elements. scan() and hideAll() run synchronously below, so the
    // browser never paints the page in between.
    // Every veil the page may carry must go before scanning, or the scanner
    // sees a hidden document, captures nothing and gives up — a white screen.
    for (const id of ['swarm-boot', 'swarm-nav-veil', 'swarm-veil']) {
      const v = document.getElementById(id);
      if (v) v.remove();
    }
    this.sound = new Sound();
    this.sound.init();
    this.sound.setOn(this.opts.sound !== false);

    this.items = scan(document.body, { skipSelector: '#swarm-reveal-root' });
    const tScan = performance.now();
    this.headings = this.collectHeadings();
    // A scan that lands while React is swapping <main> sees almost nothing.
    // Refuse that result so the caller retries instead of animating 5 elements
    // and leaving the rest of the page static.
    const bodyEls = document.body.getElementsByTagName('*').length;
    if (!this.items.length) return false;
    // A real page has many more items than this; anything less means the scan
    // caught hydration mid-flight and the page would render with no animation.
    if (this.items.length < 25 && bodyEls > 40) return false;

    this.hideAll();
    const tHide = performance.now();
    this.armWatchdog();
    this.buildChrome();
    this.buildAgents();

    this.tasks = this.items.map((it) => ({
      it,
      state: 'pending',
      p: 0,
      agent: null,
      t0: 0,
      dur: 0,
      typed: 0,
      total: it.kind === 'text' && it.typing ? (it.text || '').length : 0,
      outline: null,
      caret: null,
    }));

    // Failsafe: restore only if there is work available and no progress.
    // A flat timeout fired mid-build on long mobile pages and dumped the
    // whole page in at once.
    this._lastDone = -1;
    this._stall = 0;
    this._fail = setInterval(() => {
      if (this.dead) return;
      if (document.hidden || performance.now() - (this._lastFrame || 0) > 2000) return;
      // Nothing drawn and nothing on screen: treat as a stall, not a state.
      if (this.done === 0 && this.unlockedPending() &&
          performance.now() - (this._t0 || 0) > 5000) { this.stop(true); return; }
      const unlocked = this.tasks.filter((t) =>
        t.state === 'pending' && t.it.y <= window.scrollY + window.innerHeight * 1.05).length;
      if (this.done !== this._lastDone) { this._lastDone = this.done; this._stall = 0; return; }
      if (!unlocked) { this._stall = 0; return; }      // waiting for a scroll
      this._stall += 5000;
      if (this._stall >= 30000) this.stop(true);
    }, 5000);
    this._t0 = performance.now();
    this.showStatus();
    this._shownLabels = new Set();
    this._byEl = new Map();
    for (const t of this.tasks) this._byEl.set(t.it.el, t);
    this.bind();
    this.watchDom();
    this.last = performance.now();
    this.loop();
    this.timing = {
      scanMs: +(tScan - tStart).toFixed(1),
      hideMs: +(tHide - tScan).toFixed(1),
      startMs: +(performance.now() - tStart).toFixed(1),
      items: this.items.length,
    };
    this.onState('running');
    return true;
  }

  /* ------------------------------------------------------------- hiding */

  applyVisible(it) {
    const el = it.el;
    if (it.wasHidden) {
      // The page's own CSS keeps these at opacity 0; a class is what its
      // observer would have added, and the inline value is the fallback.
      if (el.classList && el.classList.contains('reveal')) el.classList.add('in');
      el.style.opacity = '1';
    } else {
      el.style.opacity = it.save ? it.save.opacity : '';
    }
  }

  // Absolute safety: if anything is still hidden after this, put it back.
  // Rescues the page only if the build STOPS progressing. A long page that is
  // still drawing must never be interrupted, or the site restores itself
  // mid-build (which looked like the whole page flashing back in).
  // Work that is on screen but still pending. If there is none, the engine is
  // idle because everything left is below the fold — that is not a stall.
  unlockedPending() {
    const bot = window.scrollY + window.innerHeight * 1.05;
    for (let i = this.ptr; i < this.tasks.length && i < this.ptr + 500; i++) {
      const t = this.tasks[i];
      if (t.state === 'pending' && t.it.y <= bot) return true;
      if (t.it.y > bot) break;
    }
    return false;
  }

  armWatchdog(ms = 6000) {
    clearTimeout(this._wd);
    this._wdDone = this.done;
    this._wd = setTimeout(() => {
      if (this.dead) return;
      // Chrome pauses rAF for hidden/occluded windows. No frames means the
      // page is paused, not stuck — never shut the engine down for that.
      if (document.hidden || performance.now() - (this._lastFrame || 0) > 2000) {
        this.armWatchdog(ms);
        return;
      }
      if (this.done !== this._wdDone) { this.armWatchdog(ms); return; }  // still working
      if (!this.unlockedPending()) { this.armWatchdog(ms); return; }     // nothing to do yet
      try { this.stop(true); } catch (_) { /* fall through */ }
      try {
        const st = document.createElement('style');
        st.id = 'swarm-rescue';
        st.textContent = 'body,body *{visibility:visible!important}';
        document.head.appendChild(st);
        setTimeout(() => { try { st.remove(); } catch (_) { /* gone */ } }, 4000);
      } catch (_) { /* nothing left to try */ }
    }, ms);
  }

  hideAll() {
    for (const it of this.items) {
      const el = it.el;
      it.save = {
        opacity: el.style.opacity,
        clip: el.style.clipPath,
        transition: el.style.transition,
        text: it.typing ? el.textContent : null,
      };
      el.style.opacity = '0';
    }
  }

  restoreAll() {
    for (const it of this.items) {
      const el = it.el;
      if (!it.save) continue;
      el.style.opacity = it.save.opacity;
      el.style.clipPath = it.save.clip;
      el.style.transition = it.save.transition;
      if (it.save.text != null) el.textContent = it.save.text;
    }
  }

  /* -------------------------------------------------------------- chrome */

  buildChrome() {
    const host = document.createElement('div');
    host.id = 'swarm-reveal-root';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147482000;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host{all:initial}
      .layer{position:fixed;inset:0;pointer-events:none;overflow:hidden}
      .world{position:absolute;inset:0;will-change:transform}
      .cursor{position:absolute;left:0;top:0;will-change:transform;pointer-events:none}
      .cursor svg{display:block;width:22px;height:22px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.25))}
      .cursor .cross{display:none}
      .cursor.cross .cross{display:block}
      .cursor.cross .ptr{display:none}
      .outline{position:absolute;box-sizing:border-box;border:1.5px solid #0D99FF;pointer-events:none}
      .outline.dashed{border-style:dashed}
      .guide{position:absolute;background:rgba(80,96,240,.28);pointer-events:none}
      .guide.h{left:0;right:0;height:1px}
      .guide.v{top:0;bottom:0;width:1px}
      .act{position:absolute;left:10px;top:-18px;padding:1px 5px;border-radius:4px;background:#0b1220;
        color:#fff;font:600 9px/1.5 ui-monospace,Menlo,monospace;letter-spacing:.04em;
        text-transform:uppercase;opacity:.85;white-space:nowrap;pointer-events:none}
      .badge{position:absolute;padding:2px 5px;border-radius:4px;background:#0D99FF;color:#fff;
        font:600 10px/1.4 ui-monospace,Menlo,monospace;white-space:nowrap;pointer-events:none}
      .sect{position:absolute;padding:2px 7px;border-radius:5px;background:#0b1220;color:#fff;
        font:600 10px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.04em;white-space:nowrap;
        pointer-events:none;opacity:.92;text-transform:uppercase;max-width:240px;
        overflow:hidden;text-overflow:ellipsis}
      .ring{position:absolute;left:0;top:0;pointer-events:none}
      .caret{position:absolute;width:2px;background:#0D99FF;pointer-events:none;
        animation:blink .9s steps(1) infinite}
      @keyframes blink{50%{opacity:0}}
      @keyframes swarm-ping{0%{box-shadow:0 0 0 0 rgba(10,207,131,.65)}70%{box-shadow:0 0 0 6px rgba(10,207,131,0)}100%{box-shadow:0 0 0 0 rgba(10,207,131,0)}}
    `;
    root.appendChild(style);
    this.cursorLayer = mk('div', 'layer live');
    this.anno = mk('div', 'layer');
    this.world = mk('div', 'world');
    this.anno.appendChild(this.world);
    root.append(this.cursorLayer, this.anno);
    document.documentElement.appendChild(host);
    this.host = host;
    this.root = root;
  }

  buildAgents() {
    const w = window.innerWidth;
    const count = w < 480 ? 10 : w < 768 ? 12 : w < 1024 ? 16 : 30;   // desktop: 30 agents
    const per = Math.max(1, Math.ceil(count / RV_COLORS.length));
    for (let i = 0; i < count; i++) {
      const el = mk('div', 'cursor');
      el.innerHTML = `<svg class="ring" width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
          <circle cx="17" cy="17" r="14" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="2"/>
          <circle class="arc" cx="17" cy="17" r="14" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-dasharray="88" stroke-dashoffset="88"
            transform="rotate(-90 17 17)" opacity="0"/>
        </svg><span class="ptr">${RV_POINTER}</span><span class="cross">${RV_CROSSHAIR}</span><span class="act"></span>`;
      const group = i % RV_COLORS.length;         // same colour -> same arc
      const gi = Math.floor(i / RV_COLORS.length);
      el.style.color = RV_COLORS[group];
      el.style.setProperty('--c', RV_COLORS[group]);
      this.cursorLayer.appendChild(el);
      const arcEl = el.querySelector('.arc');
      const actEl = el.querySelector('.act');
      if (actEl) actEl.style.opacity = '0';
      this.agents.push({
        i, el, group, arc: arcEl, actEl,
        x: rand(0, w), y: rand(window.innerHeight * 0.5, window.innerHeight),
        vx: 0, vy: 0, task: null,
        // each colour owns a 120-degree sector; members fan out inside it
        angle: group * (Math.PI * 2 / RV_COLORS.length) +
               ((gi + 0.5) / per - 0.5) * 0.9,
        radius: 44 + (gi % 3) * 13,
        wanderT: rand(0, 6),
      });
    }
  }

  /* ------------------------------------------------- late-rendered nodes */
  // React renders some components after the initial scan. Without this they
  // appear fully formed, which reads as "the swarm skipped this component".
  watchDom() {
    if (typeof MutationObserver !== 'function') return;
    this._known = new Set(this.items.map((i) => i.el));
    this._late = [];
    this._lateScheduled = false;

    // Reading layout and then writing a style, once per node, forces a full
    // reflow every time. On a scroll that triggers lazy sections this froze
    // the page. Collect first, then read in one batch, then write in one batch.
    this._mo = new MutationObserver((muts) => {
      if (this.dead) return;
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (!n || n.nodeType !== 1) continue;
          if (n.id === 'swarm-reveal-root') continue;
          try { if (n.closest && n.closest('#swarm-reveal-root')) continue; } catch (_) { /* detached */ }
          if (this._known.has(n)) continue;
          this._known.add(n);
          this._late.push(n);
        }
      }
      if (this._late.length && !this._lateScheduled) {
        this._lateScheduled = true;
        setTimeout(() => { this._lateScheduled = false; this.drainLate(); }, 60);
      }
    });
    this._mo.observe(document.body, { childList: true, subtree: true });
  }

  drainLate() {
    if (this.dead || !this._late.length) return;
    const batch = this._late.splice(0, 80);
    if (this.tasks.length >= 1400) { this._late.length = 0; return; }

    // ---- read phase: no writes, so layout is computed once ----
    const picks = [];
    for (const n of batch) {
      if (!n.isConnected) continue;
      let covered = false;
      for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
        if (this._byEl && this._byEl.has(p)) { covered = true; break; }
      }
      if (covered) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (!n.textContent.trim() && cs.backgroundColor === 'rgba(0, 0, 0, 0)' &&
          cs.backgroundImage === 'none' && (!cs.boxShadow || cs.boxShadow === 'none')) continue;
      picks.push({ n, x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height });
    }

    // ---- write phase ----
    let added = 0;
    for (const p of picks) {
      if (this.tasks.length >= 1400) break;
      p.n.style.opacity = '0';
      const it = {
        el: p.n, kind: 'box', wasHidden: false,
        x: p.x, y: p.y, w: p.w, h: p.h,
        save: { opacity: '', clip: '', transition: '', text: null },
      };
      this.items.push(it);
      const lateTask = {
        it, state: 'pending', p: 0, agent: null, t0: 0, dur: 0,
        typed: 0, total: 0, outline: null, caret: null,
      };
      this.tasks.push(lateTask);
      if (this._byEl) this._byEl.set(p.n, lateTask);
      added++;
    }
    if (added) {
      this.tasks.sort((a, b) => a.it.y - b.it.y);
      this.ptr = 0;
      this.finished = false;
    }
    if (this._late.length) {
      this._lateScheduled = true;
      setTimeout(() => { this._lateScheduled = false; this.drainLate(); }, 60);
    }
  }

  /* -------------------------------------------------------------- events */

  bind() {
    // Browsers suspend audio until a real gesture. Without this the context
    // stays suspended after every refresh and the build is silent.
    const unlock = () => {
      try { this.sound.resume(); } catch (_) { /* no audio */ }
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('touchstart', unlock, true);

    this.onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.stop(true); }
    };
    this.onMove = (e) => { this.mouse = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('pointermove', this.onMove, { passive: true });
  }

  stop(revealAll) {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this._fail);
    clearInterval(this._amb);
    clearTimeout(this._wd);
    clearInterval(this._act);
    if (this._mo) { try { this._mo.disconnect(); } catch (_) { /* gone */ } }
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('pointermove', this.onMove);
    if (revealAll !== false) this.restoreAll();
    if (this.host) this.host.remove();
    // Drop every reference the engine holds; on SPA navigation the old
    // instance must be collectable immediately.
    this.host = null; this.root = null; this.world = null;
    this.cursorLayer = null; this.anno = null;
    this.items = []; this.tasks = []; this.agents = []; this.headings = [];
    if (this.sound) this.sound.close();
    this.onState('stopped');
  }

  /* ---------------------------------------------------------------- loop */

  // Chrome can withhold requestAnimationFrame for seconds while a page is
  // still loading. Driving the build only from rAF therefore left the page
  // blank until the browser got around to it. Schedule both: whichever fires
  // first runs the frame, and the other is cancelled.
  loop() {
    if (this.dead) return;
    const slot = { done: false, raf: 0, timer: 0 };
    const run = (t) => {
      if (this.dead || slot.done) return;
      slot.done = true;
      if (slot.raf) cancelAnimationFrame(slot.raf);
      if (slot.timer) clearTimeout(slot.timer);
      this.frame(t);
    };
    slot.raf = requestAnimationFrame(run);
    slot.timer = setTimeout(() => run(performance.now()), 32);
    this.raf = slot.raf;
  }

  frame(t) {
    if (this.dead) return;
    this._lastFrame = performance.now();
    const t0 = performance.now();
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;

    this.world.style.transform = `translate3d(0,${-window.scrollY}px,0)`;

    this.updateBuild(t);
    this.updateAgents(t, dt);

    const cost = performance.now() - t0;
    this.perf.jsSum += cost;
    this.perf.jsFrames++;
    if (cost > this.perf.jsWorst) this.perf.jsWorst = cost;
    this.perf.frames++;
    this.loop();
  }

  // Reveal anything that sits past the end of the document without waiting
  // for a scroll that can never happen.
  sweepUnreachable() {
    const docH = document.documentElement.scrollHeight;
    const past = window.scrollY - 80;   // anything fully above the viewport
    // Bounded: a large scroll can put hundreds of elements behind the visitor
    // at once. Revealing them all in one frame blocked the main thread and
    // froze the page, so spread the work across frames instead.
    let budget = 6;
    for (let i = this.ptr; i < this.tasks.length && budget > 0; i++) {
      const task = this.tasks[i];
      if (task.state !== 'pending') continue;
      const it = task.it;
      if (it.y > docH || it.y + it.h < past) { this.finishSilently(task); budget--; }
    }
  }

  finishSilently(task) {
    const it = task.it;
    if (task.state === 'done') return;          // never double-count
    task.state = 'done';
    this.done++;
    this.applyVisible(it);
    it.el.style.clipPath = it.save ? it.save.clip : '';
    if (it.typing && it.text != null) it.el.textContent = it.text;
    if (task.outline) { task.outline.frame.remove(); task.outline.badge.remove(); task.outline = null; }
    if (task.guides) { task.guides.h.remove(); task.guides.v.remove(); task.guides = null; }
    if (task.agent && task.agent.actEl) task.agent.actEl.style.opacity = '0';
    if (task.caret) { task.caret.remove(); task.caret = null; }
    if (task.sect) { task.sect.remove(); task.sect = null; }
    if (task.agent) { task.agent.task = null; task.agent.tx = null; task.agent.ty = null; task.agent = null; }
  }

  nextTask() {
    while (this.ptr < this.tasks.length && this.tasks[this.ptr].state !== 'pending') this.ptr++;
    if (this.ptr >= this.tasks.length) return null;

    // What the visitor can see must be built first, even if the document
    // order puts other unlocked work ahead of it.
    const top = window.scrollY;
    const bot = top + window.innerHeight * 1.05;
    const limit = Math.min(this.tasks.length, this.ptr + 400);
    for (let i = this.ptr; i < limit; i++) {
      const t = this.tasks[i];
      if (t.state !== 'pending') continue;
      if (t.it.y >= top - 40 && t.it.y <= bot) return t;
      if (t.it.y > bot) break;          // sorted by y: nothing further qualifies
    }

    const task = this.tasks[this.ptr];
    if (task.it.y > bot) return null;
    return task;
  }

  updateBuild(t) {
    this._textBudget = 3;
    this.sweepUnreachable();

    for (const a of this.agents) {
      if (a.task) continue;
      const task = this.nextTask();
      if (!task) break;
      this.assign(a, task, t);
    }

    for (const a of this.agents) {
      const task = a.task;
      if (!task) continue;
      const p = clamp((t - task.t0) / task.dur, 0, 1);
      task.p = p;
      this.renderTask(task, p, a);
      if (p >= 1) this.complete(task, a);
    }

    if (this.done >= this.tasks.length && this.tasks.length) {
      if (!this.finished) {
        this.finished = true;
        if (this.cursorLayer) this.cursorLayer.classList.remove('live');
        this.showSummary();
        this.onState('done');
        // The page is real now, but the AI stays: agents keep circling the
        // pointer and periodically verify sections, so the site reads as
        // continuously run by an AI rather than a one-off animation.
        setTimeout(() => { if (!this.dead) this.startAmbient(); }, 4200);
      }
    }
  }

  assign(agent, task, t) {
    const it = task.it;
    if (it.el === document.body || it.el === document.documentElement) {
      // Belt and braces: a root element must never be clipped or hidden.
      task.state = 'done';
      this.done++;
      agent.task = null;
      return;
    }
    task.state = 'active';
    task.agent = agent;
    task.t0 = t;
    agent.task = task;

    const area = it.w * it.h;
    // Durations are deliberately short: with everything hidden, a slow task
    // means a blank page. A 40-character line lands in ~0.5 s.
    if (it.kind === 'text' && it.typing) {
      task.dur = clamp(110 + task.total * 8, 180, 1400) / this.speed;
    } else if (it.kind === 'media') {
      task.dur = clamp(150 + Math.sqrt(area) * 1.1, 200, 700) / this.speed;
    } else {
      task.dur = clamp(120 + Math.sqrt(area) * 0.9, 160, 600) / this.speed;
    }

    if (it.wasHidden) this.applyVisible(it);
    if (it.kind === 'text' && it.typing) {
      it.el.textContent = '';
      it.el.style.opacity = it.wasHidden ? '1' : '';
    } else if (it.kind === 'media') {
      it.el.style.opacity = it.wasHidden ? '1' : '';
      it.el.style.clipPath = 'inset(0 0 100% 0)';
    } else if (it.kind === 'text') {
      it.el.style.opacity = it.wasHidden ? '1' : '';
      it.el.style.clipPath = 'inset(0 100% 0 0)';
    } else {
      it.el.style.opacity = it.wasHidden ? '1' : '';
      it.el.style.clipPath = 'inset(0 100% 100% 0)';
    }

    if (it.kind !== 'text' || !it.typing) {
      task.outline = this.makeOutline(it);
      // Phones have narrow columns: a smaller area still counts as a region
      // worth annotating with alignment guides.
      const big = window.innerWidth < 768 ? 25000 : 60000;
      if (it.w * it.h >= big) task.guides = this.makeGuides();
      this.attachLabel(it, task);
    }
    if (it.kind === 'text' && it.typing) {
      task.caret = this.makeCaret();
      this.attachLabel(it, task);
    }
  }

  // Label each element by the heading it sits under. Works regardless of
  // whether the page uses <section> wrappers.
  collectHeadings() {
    const out = [];
    let els = [];
    try { els = [...document.querySelectorAll('h1,h2,h3')]; } catch (_) { return out; }
    for (const h of els) {
      const txt = (h.textContent || '').trim();
      if (!txt) continue;
      const r = h.getBoundingClientRect();
      if (r.width < 10) continue;
      out.push({ y: r.top + window.scrollY, t: txt.slice(0, 60) });   // CSS ellipsis trims visually
    }
    out.sort((a, b) => a.y - b.y);
    return out;
  }

  // A section name is announced once, at its first element, clamped so it can
  // never run off the edge of the screen.
  attachLabel(it, task) {
    const label = this.sectionLabel(it);
    if (!label || this._shownLabels.has(label)) return;
    this._shownLabels.add(label);
    const tag = mk('div', 'sect');
    tag.textContent = label;
    const maxX = Math.max(8, window.innerWidth - 250);
    const x = Math.max(8, Math.min(it.x, maxX));
    const y = Math.max(8, it.y - 20);
    tag.style.transform = `translate3d(${x}px,${y}px,0)`;
    this.world.appendChild(tag);
    task.sect = tag;
  }

  sectionLabel(it) {
    if (it.y < 90 || !this.headings || !this.headings.length) return null;
    let best = null;
    for (const h of this.headings) {
      if (h.y <= it.y - 6) best = h;
      else break;
    }
    return best ? best.t : null;
  }

  makeOutline(it) {
    const d = mk('div', 'outline' + (it.kind === 'text' ? ' dashed' : ''));
    d.style.cssText = `left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;opacity:1`;
    const badge = mk('div', 'badge');
    badge.style.transform = `translate3d(${it.x + it.w}px,${it.y + it.h}px,0)`;
    badge.textContent = `${Math.round(it.w)} \u00d7 ${Math.round(it.h)}`;
    const tagName = (it.el.tagName || '').toUpperCase();
    // Only annotate genuinely large regions. A badge on every box reads as
    // debug output rather than an AI at work.
    const big = it.kind !== 'text' && it.w >= 320 && it.h >= 120 && it.w * it.h >= 60000;
    if (!big || tagName === 'BODY' || tagName === 'HTML' ||
        tagName === 'HEADER' || tagName === 'FOOTER') {
      badge.style.display = 'none';
    }
    this.world.append(d, badge);
    return { frame: d, badge };
  }

  makeGuides() {
    const h = mk('div', 'guide h');
    const v = mk('div', 'guide v');
    h.style.opacity = '0';
    v.style.opacity = '0';
    this.world.append(h, v);
    return { h, v };
  }

  makeCaret() {
    const c = mk('div', 'caret');
    c.style.cssText = 'height:1.2em;left:0;top:0;opacity:0';
    this.world.appendChild(c);
    return c;
  }

  renderTask(task, p, agent) {
    const it = task.it;
    const el = it.el;
    const sx = window.scrollX;
    const sy = window.scrollY;

    if (it.kind === 'text' && it.typing) {
      if (agent.actEl) {
        if (it.w * it.h >= (window.innerWidth < 768 ? 25000 : 60000)) { agent.actEl.textContent = 'typing'; agent.actEl.style.opacity = '0.85'; }
        else agent.actEl.style.opacity = '0';
      }
      const n = Math.floor(clamp(p / 0.95, 0, 1) * task.total);
      if (n !== task.typed && this._textBudget > 0) {
        this._textBudget--;
        task.typed = n;
        el.textContent = (it.text || '').slice(0, n);
        this.sound.key(this.pan(it), 1 + (n % 7) * 0.04);
        const r = this.caretRect(el);
        if (r) {
          task.caret.style.left = r.left + sx + 'px';
          task.caret.style.top = r.top + sy + 'px';
          task.caret.style.height = r.height + 'px';
          task.caret.style.opacity = '1';
          task.cx = r.left;
          task.cy = r.top;
        }
      }
      agent.tx = task.cx != null ? task.cx : it.x - sx;
      agent.ty = task.cy != null ? task.cy + 10 : it.y - sy;
      return;
    }

    const e = easeInOut(clamp(p / 0.8, 0, 1));
    if (task.guides) {
      const gx = it.x + it.w * e;
      const gy = it.y + it.h * e;
      task.guides.h.style.transform = `translate3d(0,${gy}px,0)`;
      task.guides.v.style.transform = `translate3d(${gx}px,0,0)`;
      task.guides.h.style.opacity = '1';
      task.guides.v.style.opacity = '1';
    }
    if (agent.actEl) {
      if (it.w * it.h >= (window.innerWidth < 768 ? 25000 : 60000)) {
        agent.actEl.textContent = it.kind === 'media' ? 'image' : 'layout';
        agent.actEl.style.opacity = '0.85';
      } else {
        agent.actEl.style.opacity = '0';
      }
    }
    if (task.outline) {
      task.outline.frame.style.clipPath = `inset(0 ${(1 - e) * 100}% ${(1 - e) * 100}% 0)`;
      task.outline.badge.style.transform = `translate3d(${it.x + it.w * e}px,${it.y + it.h * e}px,0)`;
    }

    if (it.kind === 'media') {
      el.style.clipPath = `inset(0 0 ${(1 - e) * 100}% 0)`;
    } else if (it.kind === 'text') {
      el.style.clipPath = `inset(0 ${(1 - e) * 100}% 0 0)`;
    } else {
      el.style.clipPath = `inset(0 ${(1 - e) * 100}% ${(1 - e) * 100}% 0)`;
    }

    agent.tx = it.x + it.w * e - sx;
    agent.ty = it.y + it.h * e - sy;
  }

  caretRect(el) {
    try {
      const node = el.firstChild;
      if (!node || node.nodeType !== 3) return null;
      const r = document.createRange();
      r.setStart(node, node.nodeValue.length);
      r.setEnd(node, node.nodeValue.length);
      const rects = r.getClientRects();
      const b = rects.length ? rects[rects.length - 1] : r.getBoundingClientRect();
      if (!b || (!b.width && !b.height)) return null;
      return { left: b.left, top: b.top, height: b.height || parseFloat(getComputedStyle(el).fontSize) || 16 };
    } catch (_) { return null; }
  }

  complete(task, agent) {
    if (task.state === 'done') { if (agent) agent.task = null; return; }
    const it = task.it;
    // A drawn element must never sit over hidden children: if anything inside
    // it is still pending, finish those first or the region reads as blank.
    if (this._byEl && it.el.querySelectorAll) {
      const sub = it.el.querySelectorAll('*');
      for (let i = 0; i < sub.length; i++) {
        const t = this._byEl.get(sub[i]);
        if (t && t.state === 'pending') this.finishSilently(t);
      }
    }
    task.state = 'done';
    this.done++;
    agent.task = null;
    // Drop the task's coordinates, or the agent keeps flying to the last
    // element it drew instead of returning to the pointer.
    agent.tx = null;
    agent.ty = null;

    it.el.style.clipPath = it.save ? it.save.clip : '';
    this.applyVisible(it);

    if (task.typed !== undefined && it.typing) {
      it.el.textContent = it.text;         // exact original, including whitespace
      it.el.style.opacity = it.save ? it.save.opacity : '';
    }
    if (task.outline) { task.outline.frame.remove(); task.outline.badge.remove(); }
    if (task.sect) { task.sect.remove(); task.sect = null; }
    if (task.caret) task.caret.remove();

    if (this.done % 10 === 0) this.armWatchdog();
    try { this.sound.resume(); } catch (_) { /* no audio */ }
    this.sound.thock(this.pan(it), 150 + rand(0, 60));
    if (this.done % 9 === 0) this.sound.chime(this.pan(it), Math.floor(it.y / 120));
  }

  pan(it) {
    return ((it.x + it.w / 2) / Math.max(1, window.innerWidth)) * 2 - 1;
  }

  updateAgents(t, dt) {
    this.orbitPhase += dt * 0.5;
    for (const a of this.agents) {
      let tx = a.tx;
      let ty = a.ty;
      if (tx == null || ty == null) {
        // Idle agents orbit the visitor's pointer, the way a design tool's
        // collaborators gather around it. Without a pointer, drift slowly
        // around the middle of the viewport.
        const cx = this.mouse ? this.mouse.x : window.innerWidth / 2;
        const cy = this.mouse ? this.mouse.y : window.innerHeight * 0.45;
        tx = cx + Math.cos(a.angle + this.orbitPhase) * a.radius;
        ty = cy + Math.sin(a.angle + this.orbitPhase) * a.radius * 0.82;
      }
      if (a.task) {
        a.vx += (tx - a.x) * 14 * dt * 6;
        a.vy += (ty - a.y) * 14 * dt * 6;
        a.vx *= 0.86;
        a.vy *= 0.86;
        a.x += a.vx * dt * 6;
        a.y += a.vy * dt * 6;
      } else {
        // Idle: settle onto the orbit arc quickly, or the groups smear.
        const s = 1 - Math.pow(0.015, dt);
        a.x += (tx - a.x) * s;
        a.y += (ty - a.y) * s;
        a.vx = 0;
        a.vy = 0;
      }
      a.el.style.transform = `translate3d(${a.x}px,${a.y}px,0)`;
      const busy = !!a.task;
      if (a.busy !== busy) { a.busy = busy; a.el.classList.toggle('busy', busy); }
      if (a.arc) {
        const p = a.task ? clamp(a.task.p || 0, 0, 1) : 0;
        a.arc.setAttribute('stroke-dashoffset', String(88 - 88 * p));
        a.arc.setAttribute('opacity', a.task ? '0.95' : '0');
      }
      const mode = a.task && a.task.it.kind !== 'text' ? 'cross' : 'ptr';
      if (a.mode !== mode) {
        a.mode = mode;
        a.el.classList.toggle('cross', mode === 'cross');
      }
    }
  }

  // A short card that states what just happened. It is transient and sits in
  // the pointer-transparent layer, so it never blocks the page.
  showSummary() {
    if (!this.root) return;
    const secs = ((performance.now() - (this._t0 || performance.now())) / 1000).toFixed(1);
    const el = mk('div', 'summary');
    el.innerHTML =
      `<b>${this.agents.length} agents</b> rebuilt this page` +
      `<span>${this.tasks.length} elements · ${secs}s · AI-generated</span>`;
    el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);' +
      'padding:10px 16px;border-radius:12px;background:rgba(12,16,28,.92);color:#fff;' +
      'font:500 12px/1.5 ui-monospace,Menlo,monospace;text-align:center;pointer-events:none;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.28);opacity:0;transition:opacity .35s ease;' +
      'letter-spacing:.01em;z-index:5';
    el.querySelector('b').style.cssText = 'display:block;font-size:13px;font-weight:700;margin-bottom:2px';
    el.querySelector('span').style.cssText = 'opacity:.72';
    this.root.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => { el.style.opacity = '0'; }, 2800);
    setTimeout(() => { el.remove(); }, 3400);
  }

  startAmbient() {
    if (this.dead || this.ambient) return;
    this.ambient = true;
    clearInterval(this._fail);
    if (this.cursorLayer) this.cursorLayer.classList.add('live');
    this._amb = setInterval(() => this.ambientPulse(), 6500);
    this.ambientPulse();
  }

  showStatus() {
    if (!this.root || this.statusEl) return;
    const el = mk('div', 'status');
    el.innerHTML = '<i></i><span class="txt">AI online \u00b7 ' + this.agents.length + ' agents</span>';
    const small = window.innerWidth < 768;
    el.style.cssText = 'position:fixed;left:' + (small ? 12 : 18) + 'px;bottom:' + (small ? 132 : 18) + 'px;' +
      'display:flex;align-items:center;gap:7px;' +
      'padding:6px 11px;border-radius:999px;background:rgba(12,16,28,.82);color:#fff;' +
      'font:600 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.03em;pointer-events:none;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.22);opacity:0;transition:opacity .5s ease;z-index:5';
    el.querySelector('i').style.cssText = 'width:6px;height:6px;border-radius:50%;background:#0ACF83;' +
      'box-shadow:0 0 0 0 rgba(10,207,131,.7);animation:swarm-ping 2.2s ease-out infinite';
    this.root.appendChild(el);
    this.statusEl = el;
    this._act = setInterval(() => {
      if (this.dead || !this.statusEl) return;
      const t = this.statusEl.querySelector('.txt');
      if (!t) return;
      const active = this.agents.filter((a) => a.task).length;
      const kinds = { text: 'writing copy', box: 'laying out', media: 'rendering media' };
      const k = this.agents.map((a) => a.task && a.task.it.kind).filter(Boolean)[0];
      t.textContent = this.ambient
        ? 'AI online \u00b7 verifying sections'
        : 'AI online \u00b7 ' + (active || this.agents.length) + ' agents \u00b7 ' + (kinds[k] || 'scanning');
    }, 1800);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
  }

  // A passing "check" on a random visible section: the AI is still reading.
  ambientPulse() {
    if (this.dead) return;
    const vh = window.innerHeight;
    const pool = this.items.filter((i) => {
      const r = i.el.getBoundingClientRect();
      return r.top > 60 && r.bottom < vh - 60 && r.width > 80 && r.height > 20;
    });
    if (!pool.length) return;
    const it = pool[Math.floor(Math.random() * pool.length)];
    const r = it.el.getBoundingClientRect();
    const box = mk('div', 'outline');
    box.style.cssText = `left:${r.left + window.scrollX}px;top:${r.top + window.scrollY}px;` +
      `width:${r.width}px;height:${r.height}px;opacity:0;transition:opacity .35s ease`;
    const tag = mk('div', 'badge');
    tag.textContent = 'AI verified';
    tag.style.transform = `translate3d(${r.left + window.scrollX}px,${r.top + window.scrollY - 16}px,0)`;
    tag.style.opacity = '0';
    tag.style.transition = 'opacity .35s ease';
    this.world.append(box, tag);
    requestAnimationFrame(() => { box.style.opacity = '0.85'; tag.style.opacity = '1'; });
    setTimeout(() => { box.style.opacity = '0'; tag.style.opacity = '0'; }, 1100);
    setTimeout(() => { box.remove(); tag.remove(); }, 1600);
    // Once the visitor has interacted, the ambient checks are audible, so the
    // site keeps a sound presence after the build has finished.
    try { this.sound.chime(this.pan(it), 8); } catch (_) { /* no audio */ }
  }

  perfStats() {
    const p = this.perf;
    if (!p.frames) return null;
    const avg = p.sum / Math.max(1, p.frames);
    return {
      frames: p.frames,
      jsAvgMs: +(p.jsSum / Math.max(1, p.jsFrames)).toFixed(2),
      jsWorstMs: +p.jsWorst.toFixed(2),
      budget120Pct: +(((p.jsSum / Math.max(1, p.jsFrames)) / 8.33) * 100).toFixed(1),
      timing: this.timing || null,
      done: this.done,
      total: this.tasks.length,
    };
  }
}


/* ---- index.js ---- */
/*
 * index.js — public entry point.
 *
 *   import { start, stop, toggle } from './src/index.js';
 *
 * The module never auto-starts: the host page decides when (a button click is
 * also the gesture browsers require before audio may play).
 */



let current = null;
let booting = false;
let revealing = null;

function start(opts = {}) {
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

function stop(reveal = true) {
  if (current) current.stop(reveal);
}

function toggle(opts = {}) {
  if (current) stop(true);
  else start(opts);
}

function isRunning() {
  return !!current;
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Works on phones too; the overlay scales its agent count down there.
const supported = () => window.innerWidth >= 320;

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
function rescuePage() {
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

function bootReveal(opts = {}) {
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

function revealRunning() { return !!revealing; }

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

async function boot(opts = {}) {
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


})();
