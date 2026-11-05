// Small helpers shared by the engine.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (a) => a[(Math.random() * a.length) | 0];
export const now = () => performance.now();

export function mk(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

// Apply a {property: value} map, skipping empties so we don't clobber defaults.
// Keys may be camelCase or kebab-case: style.setProperty only accepts the
// latter, so convert first (a silent failure otherwise).
export function applyStyles(el, obj) {
  for (const k in obj) {
    const v = obj[k];
    if (v == null || v === '' || v === 'none' || v === 'normal') continue;
    const prop = k.includes('-') ? k : k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    try { el.style.setProperty(prop, v); } catch (_) { /* ignore invalid */ }
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
