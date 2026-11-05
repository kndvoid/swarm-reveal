# swarm-reveal

**Rebuild a live web page in front of your visitor with a swarm of AI cursors — without breaking a single click.**

Elements are typed, drawn and swept into place by a swarm of coloured agents. But unlike a screenshot-overlay effect, this library animates the **real DOM**: every link, form, menu and scroll position keeps working exactly as it did before.

- No dependencies, no build step required — one `<script>` tag
- Works on any HTML page, including server-rendered and hydrated React/Vue sites
- ~64 KB unminified (~18 KB gzipped), zero network requests after load
- Respects `prefers-reduced-motion`
- MIT licensed

---

## Quick start

Drop the bundle in and it boots itself:

```html
<script defer src="/dist/swarm-reveal.js"></script>
```

That's it. On load, the page is briefly held, then rebuilt by the swarm.

### Or take manual control

```html
<script defer src="/dist/swarm-reveal.manual.js"></script>
<script>
  window.addEventListener('load', () => {
    window.__swarmReveal.bootReveal({ speed: 0.3 });
  });
</script>
```

The manual build exposes `window.__swarmReveal` with:

| Method | What it does |
|---|---|
| `bootReveal(opts)` | Starts a build. Returns a promise for the engine instance. |
| `start(opts)` | Alias kept for compatibility. |
| `stop(revealAll)` | Stops the engine. `true` restores the page to its final state. |
| `toggle()` | Start if idle, stop if running. |
| `isRunning()` | Boolean. |
| `rescuePage()` | Hard reset: removes every veil and clears inline hiding. Safe to call any time. |

## Options

```js
bootReveal({
  speed: 0.3,      // pacing divisor. Higher = faster. 0.3 is a deliberate build.
  maxItems: 1200   // hard cap on elements captured per page
});
```

`speed` divides every element's duration, so `0.6` is twice as fast as `0.3`.

## How it works

The obvious way to build this effect is to **copy** the page into an overlay and animate the copy. That approach breaks the moment a visitor tries to click: the copy sits on top of the real page, so clicks land at the copy's coordinates and hit the wrong element.

This library takes the opposite approach — **in-place reveal**:

1. **Scan** the live DOM and keep a reference to every real element. Each one is classed as `box` (paints something), `text` (an inline-only text host) or `media`.
2. **Hide** those elements in place with `opacity` / `clip-path`. Nothing is duplicated and nothing is moved.
3. **Reveal** them one at a time as agents reach them: text is typed into the real element, media is swept open, boxes are drawn with a growing wipe.
4. **Restore** each element to its exact original state as it completes.

Because the page *is* the page, clicks, hover, focus, forms, sticky headers, mobile menus and scroll all behave exactly as they did before the animation started.

## What you get on screen

- **Typewriter text** — real characters written into the real element, with a caret
- **Growing outlines** — every box traces itself as it is laid out
- **Media sweeps** — images and embeds open like a drawn panel
- **Alignment guides** — thin crosshair lines that track the drawing point on major regions
- **Action tags** — each cursor states what it is doing (`typing`, `layout`, `image`)
- **Section labels** — the current section is named once, as the AI "navigates"
- **Measurement badges** — dimensions shown on large regions while they are laid out
- **Ambient mode** — after the build, agents keep circling and periodically re-verify sections, so the page reads as continuously run rather than a one-off animation

## Measured performance

From a production deployment (1440 × 900, 30 agents, speed `0.3`):

| Metric | Result |
|---|---|
| Frame rate during build | **59.7 fps** average |
| Median / p95 / p99 frame | 16.7 ms / 16.8 ms / **16.9 ms** |
| Engine start (scan + hide) | **7–40 ms** |
| Console errors | **0** across a 391-page scan |

The work per frame is small and bounded: viewport-first scheduling means what the visitor can see is always built first, and the scan of a page-sized container is skipped so it can never clip the whole document.

## Mobile

The swarm sizes itself to the viewport — 30 agents on desktop, 16 on tablet, 10 on phones — and lowers its "major region" threshold so narrow columns still get guides and labels. Verified at 390 × 844 with touch, and under 4× CPU throttling plus Fast 3G.

## Accessibility & behaviour notes

- `prefers-reduced-motion: reduce` disables the engine entirely — the page renders normally.
- The animation never blocks input: the overlay layer is `pointer-events: none` and sits **below** your own fixed UI.
- If anything fails, a watchdog restores the page. A page is never left hidden.
- Audio is optional and starts only after the visitor's first interaction, per browser autoplay policy.

## Limitations

- Elements taller than 2.5 viewports are treated as containers and are not drawn themselves (their children still animate).
- Pages with more than `maxItems` elements animate only the first `maxItems`.
- The effect is intended for page **views**, not for every interaction.


## License

MIT — see [LICENSE](LICENSE). Use it, ship it, change it.
