// One-shot and positional sound effects — footsteps, distant activity,
// entity vocalizations, and the jumpscare stingers. All synthesized.

export class Sfx {
  constructor(engine) {
    this.e = engine;
  }

  // ============ player ============

  /** Carpet-muffled footstep. intensity 0..1 (crouch..sprint), wet adds squish. */
  footstep(intensity = 0.5, wet = false) {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t = ctx.currentTime;
    const jitter = 0.85 + Math.random() * 0.3;

    // thud body
    const o = e.osc('sine', (52 + Math.random() * 14) * jitter);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.09);
    const og = e.env(t, 0.004, 0, 0.1, 0.16 * (0.4 + intensity * 0.8));
    o.connect(og).connect(e.sfx);
    o.start(t);
    o.stop(t + 0.16);

    // carpet scuff
    const n = e.noiseSource(false);
    const f = e.filter('lowpass', 380 + intensity * 320 + Math.random() * 120);
    const ng = e.env(t, 0.003, 0, 0.07 + Math.random() * 0.03, 0.07 * (0.35 + intensity));
    n.connect(f).connect(ng).connect(e.sfx);
    n.start(t, Math.random() * 1.5);
    n.stop(t + 0.14);

    if (wet) {
      const ws = e.noiseSource(false);
      const wf = e.filter('bandpass', 1500 + Math.random() * 700, 3);
      const wg = e.env(t + 0.015, 0.008, 0, 0.06, 0.035 * (0.4 + intensity));
      ws.connect(wf).connect(wg).connect(e.sfx);
      ws.start(t, Math.random());
      ws.stop(t + 0.12);
    }
  }

  breath(exhausted = 0.5) {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t = ctx.currentTime;
    const n = e.noiseSource(false);
    const f = e.filter('bandpass', 700 + exhausted * 300, 1.2);
    const g = e.env(t, 0.12, 0.05, 0.32, 0.018 + exhausted * 0.03);
    n.connect(f).connect(g).connect(e.sfx);
    n.start(t, Math.random());
    n.stop(t + 0.6);
  }

  drink() {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.22;
      const o = e.osc('sine', 300 - i * 40);
      o.frequency.exponentialRampToValueAtTime(120 - i * 14, tt + 0.12);
      const g = e.env(tt, 0.02, 0, 0.14, 0.06);
      o.connect(g).connect(e.sfx);
      o.start(tt);
      o.stop(tt + 0.2);
      const n = e.noiseSource(false);
      const f = e.filter('bandpass', 900, 2);
      const ng = e.env(tt + 0.04, 0.01, 0, 0.08, 0.025);
      n.connect(f).connect(ng).connect(e.sfx);
      n.start(tt, Math.random());
      n.stop(tt + 0.15);
    }
  }

  uiClick() {
    const e = this.e;
    if (!e.ready) return;
    const t = e.ctx.currentTime;
    const o = e.osc('square', 1800);
    const g = e.env(t, 0.001, 0, 0.03, 0.02);
    o.connect(g).connect(e.sfx);
    o.start(t);
    o.stop(t + 0.05);
  }

  // ============ the building ============

  /** Deep positional thump — something far away, through many walls. */
  distantThump(x, z, big = false) {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t = ctx.currentTime;
    const p = e.panner(x, 1.2, z, 3, 60, 1.1);
    p.connect(e.sfx);
    const o = e.osc('sine', big ? 38 : 52);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.5);
    const g = e.env(t, 0.01, 0.04, big ? 0.9 : 0.5, big ? 0.7 : 0.4);
    o.connect(g).connect(p);
    o.start(t);
    o.stop(t + 1.6);
    const n = e.noiseSource(false);
    const f = e.filter('lowpass', 140);
    const ng = e.env(t, 0.005, 0, 0.35, 0.3);
    n.connect(f).connect(ng).connect(p);
    n.start(t, Math.random());
    n.stop(t + 0.5);
  }

  /** Footsteps that are not yours. */
  otherFootsteps(x, z, count = 4, interval = 0.42) {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx;
    const p = e.panner(x, 1, z, 2.5, 50, 1.2);
    p.connect(e.sfx);
    const t0 = ctx.currentTime;
    for (let i = 0; i < count; i++) {
      const t = t0 + i * (interval + Math.random() * 0.06);
      const o = e.osc('sine', 48 + Math.random() * 10);
      o.frequency.exponentialRampToValueAtTime(30, t + 0.1);
      const g = e.env(t, 0.004, 0, 0.12, 0.5);
      o.connect(g).connect(p);
      o.start(t);
      o.stop(t + 0.2);
      const n = e.noiseSource(false);
      const f = e.filter('lowpass', 260);
      const ng = e.env(t, 0.004, 0, 0.08, 0.22);
      n.connect(f).connect(ng).connect(p);
      n.start(t, Math.random());
      n.stop(t + 0.12);
    }
  }

  knock(x, z, count = 3) {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx;
    const p = e.panner(x, 1.4, z, 2, 40, 1.4);
    p.connect(e.sfx);
    const t0 = ctx.currentTime;
    for (let i = 0; i < count; i++) {
      const t = t0 + i * (0.16 + Math.random() * 0.05);
      const o = e.osc('triangle', 180 + Math.random() * 40);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.04);
      const g = e.env(t, 0.002, 0, 0.07, 0.4);
      o.connect(g).connect(p);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  /** Indistinct whisper, very quiet, from a direction. */
  whisper(x, z) {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t0 = ctx.currentTime;
    const p = e.panner(x, 1.6, z, 1, 20, 1.8);
    p.connect(e.sfx);
    const n = e.noiseSource(true);
    const f1 = e.filter('bandpass', 1700, 4);
    const f2 = e.filter('bandpass', 3100, 6);
    const g = ctx.createGain();
    g.gain.value = 0;
    n.connect(f1).connect(g);
    n.connect(f2).connect(g);
    g.connect(p);
    n.start(t0);
    // syllable-like AM envelopes
    let t = t0 + 0.1;
    for (let i = 0; i < 6 + Math.random() * 5; i++) {
      const dur = 0.06 + Math.random() * 0.13;
      g.gain.setTargetAtTime(0.025 + Math.random() * 0.02, t, 0.02);
      g.gain.setTargetAtTime(0.001, t + dur, 0.03);
      f1.frequency.setValueAtTime(1300 + Math.random() * 1200, t);
      t += dur + 0.03 + Math.random() * 0.09;
    }
    n.stop(t + 0.4);
  }

  // ============ entity ============

  /** Wet dragging shuffle — the stalking sound. */
  entityShuffle(x, z) {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t = ctx.currentTime;
    const p = e.panner(x, 0.6, z, 2, 40, 1.5);
    p.connect(e.sfx);
    const n = e.noiseSource(false);
    const f = e.filter('bandpass', 480 + Math.random() * 200, 1.6);
    const g = ctx.createGain();
    g.gain.value = 0;
    n.connect(f).connect(g).connect(p);
    n.start(t, Math.random());
    const dur = 0.5 + Math.random() * 0.5;
    const steps = 3 + (Math.random() * 3 | 0);
    for (let i = 0; i < steps; i++) {
      const tt = t + (i / steps) * dur;
      g.gain.setTargetAtTime(0.10 + Math.random() * 0.08, tt, 0.03);
      g.gain.setTargetAtTime(0.004, tt + dur / steps * 0.55, 0.04);
    }
    n.stop(t + dur + 0.3);
  }

  /** Low wrong-throat groan. */
  entityGroan(x, z, intensity = 0.5) {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t = ctx.currentTime;
    const p = e.panner(x, 1.5, z, 2, 45, 1.4);
    p.connect(e.sfx);
    const o = e.osc('sawtooth', 64 + Math.random() * 18);
    o.frequency.setTargetAtTime(46, t + 0.3, 0.4);
    const lfo = e.osc('sine', 6 + Math.random() * 4);
    const lfoG = ctx.createGain();
    lfoG.gain.value = 14;
    lfo.connect(lfoG).connect(o.detune);
    const f1 = e.filter('bandpass', 210, 3);
    const f2 = e.filter('bandpass', 540, 4);
    f2.frequency.exponentialRampToValueAtTime(330, t + 1.0);
    const g = e.env(t, 0.25, 0.4, 0.6, 0.14 * (0.5 + intensity));
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(p);
    o.start(t);
    lfo.start(t);
    o.stop(t + 1.5);
    lfo.stop(t + 1.5);
  }

  /** Fast pursuit footfalls, heavier than the player's. */
  entityRunStep(x, z) {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t = ctx.currentTime;
    const p = e.panner(x, 0.4, z, 2, 45, 1.3);
    p.connect(e.sfx);
    const o = e.osc('sine', 60 + Math.random() * 16);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.08);
    const g = e.env(t, 0.003, 0, 0.12, 0.55);
    o.connect(g).connect(p);
    o.start(t);
    o.stop(t + 0.18);
    const n = e.noiseSource(false);
    const f = e.filter('lowpass', 420);
    const ng = e.env(t, 0.002, 0, 0.06, 0.3);
    n.connect(f).connect(ng).connect(p);
    n.start(t, Math.random());
    n.stop(t + 0.1);
  }

  // ============ stingers ============

  /** Quiet dissonant sting for glimpses — a violin scrape from nowhere. */
  glimpseSting() {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t = ctx.currentTime;
    for (const [freq, det] of [[1380, 0], [1462, 9]]) {
      const o = e.osc('sawtooth', freq);
      o.detune.value = det;
      o.frequency.linearRampToValueAtTime(freq * 1.06, t + 0.7);
      const f = e.filter('bandpass', freq, 9);
      const g = e.env(t, 0.3, 0.05, 0.5, 0.018);
      o.connect(f).connect(g).connect(e.sting);
      o.start(t);
      o.stop(t + 1.0);
    }
    const sub = e.osc('sine', 44);
    const sg = e.env(t, 0.2, 0.1, 0.5, 0.10);
    sub.connect(sg).connect(e.sting);
    sub.start(t);
    sub.stop(t + 0.9);
  }

  /** THE stinger. Sub impact + noise burst + synthesized scream. */
  scream() {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t = ctx.currentTime;

    // sub-bass impact
    const sub = e.osc('sine', 95);
    sub.frequency.exponentialRampToValueAtTime(26, t + 0.9);
    const subG = e.env(t, 0.004, 0.12, 0.9, 0.95);
    sub.connect(subG).connect(e.sting);
    sub.start(t);
    sub.stop(t + 1.3);

    // noise burst with falling sweep
    const n = e.noiseSource(false);
    const nf = e.filter('bandpass', 2900, 1.4);
    nf.frequency.exponentialRampToValueAtTime(320, t + 0.8);
    const ng = e.env(t, 0.003, 0.05, 0.75, 0.6);
    n.connect(nf).connect(ng).connect(e.sting);
    n.start(t, Math.random());
    n.stop(t + 1.0);

    // scream: detuned saw cluster, violent vibrato, distorted
    const dist = e.distortion(22);
    const screamBus = ctx.createGain();
    screamBus.gain.value = 0.5;
    const sf = e.filter('bandpass', 1150, 1.1);
    dist.connect(sf).connect(screamBus).connect(e.sting);
    for (const base of [590, 745, 985]) {
      const o = e.osc('sawtooth', base * (0.97 + Math.random() * 0.06));
      o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.18);
      o.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.95);
      const v = e.osc('sine', 26 + Math.random() * 8);
      const vg = ctx.createGain();
      vg.gain.value = 90;
      v.connect(vg).connect(o.detune);
      const g = e.env(t + 0.01, 0.012, 0.25, 0.65, 0.5);
      o.connect(g).connect(dist);
      o.start(t);
      v.start(t);
      o.stop(t + 1.1);
      v.stop(t + 1.1);
    }

    // metallic screech layer
    const m = e.osc('square', 2300);
    const ring = e.osc('sine', 137);
    const rg = ctx.createGain();
    rg.gain.value = 0;
    ring.connect(rg.gain);
    const mg = e.env(t + 0.02, 0.01, 0.1, 0.5, 0.12);
    m.connect(rg).connect(mg).connect(e.sting);
    m.start(t);
    ring.start(t);
    m.stop(t + 0.8);
    ring.stop(t + 0.8);
  }

  /** No-clip out: rising unreality, then release. ~3s. */
  noclip() {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t = ctx.currentTime;
    const n = e.noiseSource(true);
    const f = e.filter('bandpass', 380, 2.2);
    f.frequency.exponentialRampToValueAtTime(5200, t + 2.6);
    const g = e.env(t, 1.8, 0.4, 0.8, 0.30);
    n.connect(f).connect(g).connect(e.sting);
    n.start(t);
    n.stop(t + 3.4);
    const o = e.osc('sine', 110);
    o.frequency.exponentialRampToValueAtTime(880, t + 2.6);
    const og = e.env(t, 2.0, 0.2, 0.7, 0.10);
    o.connect(og).connect(e.sting);
    o.start(t);
    o.stop(t + 3.2);
    const boom = e.osc('sine', 60);
    boom.frequency.exponentialRampToValueAtTime(24, t + 4.0);
    const bg = e.env(t + 2.7, 0.01, 0.2, 1.3, 0.7);
    boom.connect(bg).connect(e.sting);
    boom.start(t + 2.7);
    boom.stop(t + 4.4);
  }

  /** The exit's call: a consonant two-note tone that doesn't belong here. */
  portalTone(x, z) {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t = ctx.currentTime;
    const p = e.panner(x, 1.4, z, 4, 55, 1.1);
    p.connect(e.sfx);
    for (const [freq, gain] of [[220, 0.05], [331, 0.032]]) {
      const o = e.osc('sine', freq);
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = e.env(t, 1.1, 0.5, 1.4, gain);
      o.connect(g).connect(p);
      o.start(t);
      o.stop(t + 3.2);
    }
  }

  heartbeat(intensity = 0.5) {
    const e = this.e;
    if (!e.ready) return;
    const ctx = e.ctx, t = ctx.currentTime;
    for (const [dt, vol] of [[0, 1], [0.14, 0.6]]) {
      const o = e.osc('sine', 58);
      o.frequency.exponentialRampToValueAtTime(36, t + dt + 0.1);
      const g = e.env(t + dt, 0.008, 0, 0.12, 0.16 * intensity * vol);
      o.connect(g).connect(e.sfx);
      o.start(t + dt);
      o.stop(t + dt + 0.25);
    }
  }
}
