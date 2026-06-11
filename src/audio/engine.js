// Web Audio core: context, master bus with compression, sub-buses, helpers.
// Every sound in the game is synthesized — there are no audio files.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volumes = { master: 0.8, amb: 0.8, sfx: 0.8 };
  }

  /** Must be called from a user gesture (autoplay policy). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 7;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.22;

    this.master = ctx.createGain();
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.amb = ctx.createGain();
    this.sfx = ctx.createGain();
    this.tension = ctx.createGain();
    this.sting = ctx.createGain();
    for (const b of [this.amb, this.sfx, this.tension, this.sting]) b.connect(this.master);

    this._applyVolumes();

    // shared noise buffer (2 s, looped where needed)
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    if (this.ready) this._applyVolumes();
  }

  _applyVolumes() {
    const t = this.ctx.currentTime + 0.05;
    this.master.gain.setTargetAtTime(this.volumes.master * this.volumes.master, t, 0.05);
    this.amb.gain.setTargetAtTime(this.volumes.amb, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.tension.gain.setTargetAtTime(this.volumes.amb, t, 0.05);
    this.sting.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
  }

  updateListener(pos, fwd, up) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime + 0.04;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.03);
      l.positionY.setTargetAtTime(pos.y, t, 0.03);
      l.positionZ.setTargetAtTime(pos.z, t, 0.03);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.03);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.03);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.03);
      l.upX.setTargetAtTime(up.x, t, 0.03);
      l.upY.setTargetAtTime(up.y, t, 0.03);
      l.upZ.setTargetAtTime(up.z, t, 0.03);
    } else if (l.setPosition) {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /** Positional source node (HRTF). Connect things INTO the returned panner. */
  panner(x, y, z, refDist = 1.5, maxDist = 40, rolloff = 1.4) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.maxDistance = maxDist;
    p.rolloffFactor = rolloff;
    p.positionX !== undefined
      ? (p.positionX.value = x, p.positionY.value = y, p.positionZ.value = z)
      : p.setPosition(x, y, z);
    return p;
  }

  setPannerPos(p, x, y, z, smooth = 0.05) {
    if (p.positionX) {
      const t = this.ctx.currentTime;
      p.positionX.setTargetAtTime(x, t, smooth);
      p.positionY.setTargetAtTime(y, t, smooth);
      p.positionZ.setTargetAtTime(z, t, smooth);
    } else {
      p.setPosition(x, y, z);
    }
  }

  noiseSource(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    return s;
  }

  /** gain node with simple attack/decay envelope, auto-scheduled. */
  env(t0, attack, hold, release, peak = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, t0 + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
    return g;
  }

  osc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  distortion(amount = 30) {
    const ws = this.ctx.createWaveShaper();
    const n = 256, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount * 0.6);
    }
    ws.curve = curve;
    ws.oversample = '2x';
    return ws;
  }
}
