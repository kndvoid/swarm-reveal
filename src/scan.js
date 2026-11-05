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

export function scan(root = document.body, opts = {}) {
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
