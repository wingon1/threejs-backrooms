// Fluorescent light behavior: flicker timing, dying tubes, dead zones,
// a small pool of real PointLights that follows the player, and director
// overrides (forced flickers, blackout waves).
import * as THREE from 'three';
import { noise1 } from '../core/rng.js';

const tmpColor = new THREE.Color();

export class LightSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    this.ambient = new THREE.AmbientLight(0x96928a, 0.42);
    this.hemi = new THREE.HemisphereLight(0xd8d5cc, 0x26231d, 0.35);
    scene.add(this.ambient, this.hemi);

    this.pool = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xfdf7e6, 0, 11, 1.7);
      l.position.y = 2.55;
      scene.add(l);
      this.pool.push(l);
    }

    this.nearFixtures = [];
    this.refreshTimer = 0;
    this.overrides = []; // {x, z, r, until, started, mode: 'flicker'|'kill'}
  }

  forceFlicker(x, z, r, duration, now) {
    this.overrides.push({ x, z, r, started: now, until: now + duration, mode: 'flicker' });
  }

  killLights(x, z, r, duration, now) {
    this.overrides.push({ x, z, r, started: now, until: now + duration, mode: 'kill' });
  }

  /** Strongest flickering fixture near a point (for the buzz audio source). */
  nearestFlicker(px, pz) {
    let best = null, bd = 13 * 13;
    for (const { f } of this.nearFixtures) {
      if (f.state !== 1) continue;
      const dx = f.x - px, dz = f.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = f; }
    }
    return best;
  }

  update(dt, now, px, pz) {
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0) {
      this.refreshTimer = 0.35;
      this.world.fixturesNear(px, pz, 20, this.nearFixtures);
      this.overrides = this.overrides.filter(o => now < o.until + 0.1);
    }

    const touched = new Set();
    for (const { f, chunk } of this.nearFixtures) {
      // resolve state with overrides
      let state = f.baseState;
      for (const o of this.overrides) {
        const dx = f.x - o.x, dz = f.z - o.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > o.r) continue;
        if (o.mode === 'flicker' && now < o.until) state = Math.max(state, 1) === 2 ? 2 : 1;
        if (o.mode === 'kill') {
          const onset = o.started + d * 0.12; // blackout sweeps outward
          if (now > onset && now < o.until - d * 0.05) state = 2;
        }
      }
      f.state = state;

      // compute level
      let level;
      if (state === 2) level = 0.0;
      else if (state === 1) level = this._flickerLevel(f.phase, now);
      else level = 0.985 + 0.015 * Math.sin(now * 7 + f.phase);

      if (Math.abs(level - f.level) > 0.01) {
        f.level = level;
        const mesh = chunk.fixtureMesh;
        if (mesh) {
          const r = 0.045 + level * 0.955;
          tmpColor.setRGB(r, r * 0.985, r * 0.94 + 0.02 * level);
          mesh.setColorAt(f.index, tmpColor);
          touched.add(mesh);
        }
      }
    }
    for (const mesh of touched) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // assign the point light pool to the brightest nearby fixtures
    const cands = [];
    for (const { f } of this.nearFixtures) {
      if (f.level < 0.05) continue;
      const dx = f.x - px, dz = f.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < 16 * 16) cands.push({ f, d2 });
    }
    cands.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i];
      if (i < cands.length) {
        const f = cands[i].f;
        l.position.set(f.x, 2.55, f.z);
        l.intensity = 16 * f.level;
        l.visible = true;
      } else {
        l.visible = false;
        l.intensity = 0;
      }
    }
  }

  /**
   * Realistic fluorescent misbehavior: mostly on, sudden dips, occasional
   * rapid double-flicks, sometimes a longer brown-out.
   */
  _flickerLevel(phase, now) {
    const slow = noise1(phase * 1000 | 0, now * 1.6 + phase);
    const fast = noise1((phase * 7919) | 0, now * 14 + phase * 3);
    let level = 0.92;
    if (slow > 0.78) level = 0.10 + fast * 0.25;          // brown-out window
    else if (fast > 0.86) level = 0.05;                    // hard flick
    else if (fast > 0.78) level = 0.5;                     // half flick
    if (slow < 0.12 && fast > 0.6) level = 0.3 + fast * 0.3; // sputter
    return level;
  }

  dispose() {
    this.scene.remove(this.ambient, this.hemi);
    for (const l of this.pool) this.scene.remove(l);
  }
}
