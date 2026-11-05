/*
 * sound.js — synthesised in-browser, no audio files.
 * Kept deliberately quiet: a mechanical key for typing, a soft thock when a
 * box lands, a single glass note when a layer completes.
 */

export class Sound {
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
