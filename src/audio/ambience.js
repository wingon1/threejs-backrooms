// The ambient bed: fluorescent hum (60 Hz + harmonics with slow drift),
// HVAC rumble, faint air hiss, positional fixture buzz, and the dynamic
// tension drone that the director rides like a fader.

export class Ambience {
  constructor(engine) {
    this.e = engine;
    this.started = false;
    this.tensionLevel = 0;
    this.tensionCutUntil = 0;
    this.sanityWarp = 0;
  }

  start() {
    if (this.started || !this.e.ready) return;
    this.started = true;
    const e = this.e, ctx = e.ctx, t = ctx.currentTime;

    // ---- fluorescent hum: 60 Hz fundamental + harmonics ----
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(e.amb);
    this.humOscs = [];
    const humParts = [
      ['sine', 60, 0.055], ['sine', 120, 0.035], ['triangle', 180, 0.014], ['sawtooth', 240, 0.005]
    ];
    for (const [type, freq, gain] of humParts) {
      const o = e.osc(type, freq);
      const g = ctx.createGain();
      g.gain.value = gain;
      const lp = e.filter('lowpass', 900);
      o.connect(g).connect(lp).connect(this.humGain);
      o.start(t);
      this.humOscs.push(o);
    }
    this.humGain.gain.linearRampToValueAtTime(1, t + 3);

    // ---- HVAC rumble: looped noise through a wandering lowpass ----
    this.hvacSrc = e.noiseSource(true);
    this.hvacFilter = e.filter('lowpass', 105, 0.8);
    this.hvacGain = ctx.createGain();
    this.hvacGain.gain.value = 0;
    this.hvacSrc.connect(this.hvacFilter).connect(this.hvacGain).connect(e.amb);
    this.hvacSrc.start(t);
    this.hvacGain.gain.linearRampToValueAtTime(0.5, t + 5);
    const deep = e.osc('sine', 29);
    this.deepGain = ctx.createGain();
    this.deepGain.gain.value = 0.018;
    deep.connect(this.deepGain).connect(e.amb);
    deep.start(t);
    this.deepOsc = deep;

    // ---- faint air hiss ----
    this.hissSrc = e.noiseSource(true);
    const hissBp = e.filter('bandpass', 3400, 0.6);
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0.0045;
    this.hissSrc.connect(hissBp).connect(this.hissGain).connect(e.amb);
    this.hissSrc.start(t);

    // ---- positional buzz for the nearest flickering fixture ----
    this.buzzPanner = e.panner(0, 2.5, 0, 1.2, 18, 2.2);
    this.buzzGain = ctx.createGain();
    this.buzzGain.gain.value = 0;
    const buzzSrc = e.noiseSource(true);
    const buzzBp = e.filter('bandpass', 8200, 14);
    const buzzBp2 = e.filter('bandpass', 4100, 8);
    const buzz120 = e.osc('square', 120);
    const buzz120g = ctx.createGain();
    buzz120g.gain.value = 0.012;
    buzzSrc.connect(buzzBp).connect(this.buzzGain);
    buzzSrc.connect(buzzBp2).connect(this.buzzGain);
    buzz120.connect(buzz120g).connect(this.buzzGain);
    this.buzzGain.connect(this.buzzPanner).connect(e.amb);
    buzzSrc.start(t);
    buzz120.start(t);
    this.buzzSrc = buzzSrc;
    this.buzz120 = buzz120;

    // ---- tension drone: detuned subs + dark noise swell ----
    this.tensionGain = ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionGain.connect(e.tension);
    this.droneA = e.osc('sine', 38);
    this.droneB = e.osc('sine', 41.7);
    const dg = ctx.createGain();
    dg.gain.value = 0.5;
    this.droneA.connect(dg);
    this.droneB.connect(dg);
    dg.connect(this.tensionGain);
    const dn = e.noiseSource(true);
    this.droneNoiseFilter = e.filter('lowpass', 240, 2.5);
    const dng = ctx.createGain();
    dng.gain.value = 0.32;
    dn.connect(this.droneNoiseFilter).connect(dng).connect(this.tensionGain);
    this.droneA.start(t);
    this.droneB.start(t);
    dn.start(t);
    this.droneNoise = dn;

    // shimmer on top of the drone at high tension — barely-there dissonance
    this.shimmer = e.osc('sawtooth', 1244);
    this.shimmerGain = ctx.createGain();
    this.shimmerGain.gain.value = 0;
    const shimBp = e.filter('bandpass', 1244, 18);
    this.shimmer.connect(shimBp).connect(this.shimmerGain).connect(e.tension);
    this.shimmer.start(t);
  }

  /** 0..1 — set by the director every frame. */
  setTension(v) {
    this.tensionLevel = v;
  }

  /** Hard-cut the drone to silence for `duration` seconds. Silence is a weapon. */
  cut(duration = 2) {
    if (!this.started) return;
    const t = this.e.ctx.currentTime;
    this.tensionCutUntil = t + duration;
    this.tensionGain.gain.cancelScheduledValues(t);
    this.tensionGain.gain.setValueAtTime(this.tensionGain.gain.value, t);
    this.tensionGain.gain.linearRampToValueAtTime(0, t + 0.35);
    // the bed dips too — the room "holds its breath"
    this.humGain.gain.cancelScheduledValues(t);
    this.humGain.gain.setValueAtTime(this.humGain.gain.value, t);
    this.humGain.gain.linearRampToValueAtTime(0.25, t + 0.5);
    this.humGain.gain.setValueAtTime(0.25, t + duration);
    this.humGain.gain.linearRampToValueAtTime(1, t + duration + 2.5);
    this.hvacGain.gain.cancelScheduledValues(t);
    this.hvacGain.gain.setValueAtTime(this.hvacGain.gain.value, t);
    this.hvacGain.gain.linearRampToValueAtTime(0.06, t + 0.5);
    this.hvacGain.gain.setValueAtTime(0.06, t + duration);
    this.hvacGain.gain.linearRampToValueAtTime(0.5, t + duration + 3);
  }

  /** sanity 0..100 — warps the bed as the mind goes. */
  setSanity(sanity) {
    this.sanityWarp = 1 - sanity / 100;
  }

  /** Buzz follows the nearest flickering fixture; level tracks its misbehavior. */
  setBuzz(fixture) {
    if (!this.started) return;
    if (fixture) {
      this.e.setPannerPos(this.buzzPanner, fixture.x, 2.5, fixture.z);
      const target = 0.05 + (1 - fixture.level) * 0.16;
      this.buzzGain.gain.setTargetAtTime(target, this.e.now, 0.06);
    } else {
      this.buzzGain.gain.setTargetAtTime(0, this.e.now, 0.3);
    }
  }

  update(dt, time) {
    if (!this.started) return;
    const ctx = this.e.ctx, t = ctx.currentTime;

    // slow mains drift on the hum + sanity detune
    const drift = Math.sin(time * 0.11) * 4 + Math.sin(time * 0.031) * 3;
    const warpCents = this.sanityWarp * (Math.sin(time * 0.9) * 18 + 10);
    for (const o of this.humOscs) {
      o.detune.setTargetAtTime(drift + warpCents, t, 0.5);
    }
    this.deepOsc.detune.setTargetAtTime(this.sanityWarp * Math.sin(time * 0.5) * 30, t, 0.5);

    // HVAC wandering
    this.hvacFilter.frequency.setTargetAtTime(105 + Math.sin(time * 0.07) * 28, t, 0.8);

    // tension drone gain (respect cut window)
    let target = 0;
    if (t > this.tensionCutUntil) {
      const v = this.tensionLevel;
      target = v < 0.12 ? 0 : Math.pow((v - 0.12) / 0.88, 1.6) * 0.55;
    }
    this.tensionGain.gain.setTargetAtTime(target, t, 0.9);
    this.droneB.detune.setTargetAtTime(Math.sin(time * 0.23) * 14, t, 0.4);
    this.droneNoiseFilter.frequency.setTargetAtTime(240 + this.tensionLevel * 320 + this.sanityWarp * 120, t, 0.8);
    this.shimmerGain.gain.setTargetAtTime(
      t > this.tensionCutUntil ? Math.max(0, this.tensionLevel - 0.65) * 0.02 : 0, t, 1.2
    );
  }
}
