// The director: an invisible hand that meters dread.
// Tracks tension, sanity, and time-since-last-scare; schedules minor events
// (flickers, thumps, glimpses) and decides when the entity wakes up.
// Hard rules: big scares are never back to back, and after one the world
// goes quiet so dread can rebuild.
import * as THREE from 'three';
import { ESTATE } from '../entity/entity.js';
import { clamp } from '../core/rng.js';

const HINTS = [
  ['start', 6, 'find almond water. find the way out.'],
  ['water', 150, 'the bottles keep you sane. it keeps you here.'],
  ['exit', 300, 'somewhere, a room lets you fall out of this place.'],
  ['deep', 480, 'the lights go on forever. keep moving.']
];

export class Director {
  constructor(deps) {
    this.d = deps; // { world, entity, lights, ambience, sfx, player, sanity, camera, ui, postfx, stats }
    this.reset();
    this._v = new THREE.Vector3();
  }

  reset() {
    this.time = 0;
    this.tension = 0.08;
    this.lastBigScare = -999;
    this.calmUntil = 12;            // grace period at run start
    this.minBigInterval = 85;
    this.minorTimer = 9;
    this.entityCooldownUntil = 25;  // first stalk no earlier than this
    this.huntStartedAt = 0;
    this.silenceCutDone = false;
    this.glimpseCooldown = 0;
    this.hintsShown = new Set();
    this.shadowCooldown = 0;
  }

  /** Called by the game when the strike scare fires. */
  notifyBigScare() {
    this.lastBigScare = this.time;
    this.tension = 0;
    this.calmUntil = this.time + 55 + Math.random() * 35;
    this.entityCooldownUntil = this.time + 70 + Math.random() * 50;
    this.silenceCutDone = false;
  }

  update(dt, time) {
    this.time = time;
    const { world, entity, lights, ambience, sfx, player, sanity, camera, ui, stats } = this.d;
    const pp = player.pos;
    const light = world.lightLevelAt(pp.x, pp.z);
    const inCalm = time < this.calmUntil;

    // ---------- tension model ----------
    let build = 0.0085;
    if (light < 0.2) build += 0.022;
    if (sanity.value < 40) build += 0.012;
    if (entity.active) {
      const dist = entity.distanceTo(pp);
      build += 0.045 * clamp(1 - dist / 26, 0, 1);
    }
    if (inCalm) build *= 0.35;
    this.tension = clamp(this.tension + build * dt, 0, 1);

    // drone follows tension; a hunt overrides to near-max
    let droneLevel = this.tension;
    if (entity.state === ESTATE.HUNT) droneLevel = Math.max(droneLevel, 0.92);
    ambience.setTension(droneLevel);

    // ---------- pre-strike silence ----------
    if (entity.state === ESTATE.HUNT) {
      const dist = entity.distanceTo(pp);
      if (!this.silenceCutDone && dist < 5.5) {
        ambience.cut(2.4);
        this.silenceCutDone = true;
      }
      // mercy despawn: hunts that drag lose their teeth
      if (time - this.huntStartedAt > 50) {
        entity.despawn();
        stats.scares++;
        this.tension = 0.35;
        this.entityCooldownUntil = time + 45 + Math.random() * 30;
        this.silenceCutDone = false;
      }
    } else {
      this.silenceCutDone = false;
    }

    // ---------- entity lifecycle ----------
    if (!entity.active && entity.state !== ESTATE.GLIMPSE) {
      if (time > this.entityCooldownUntil && !inCalm && this.tension > 0.3) {
        // sanity death-spiral: low sanity wakes it sooner
        const wakeChance = (0.05 + (1 - sanity.value / 100) * 0.12) * dt;
        if (Math.random() < wakeChance) {
          entity.spawn(pp, ESTATE.STALK);
        }
      }
    } else if (entity.state === ESTATE.STALK) {
      // escalate an overdue stalk into a hunt — but never two big scares close together
      if (this.tension > 0.78 && time - this.lastBigScare > this.minBigInterval) {
        if (Math.random() < dt * 0.07) {
          entity.beginHunt();
        }
      }
      // stale stalks dissolve
      if (this.tension < 0.18 && Math.random() < dt * 0.02) {
        entity.despawn();
      }
    }
    // track hunt start
    if (entity.state === ESTATE.HUNT && this._prevEntityState !== ESTATE.HUNT) {
      this.huntStartedAt = time;
      this.silenceCutDone = false;
    }
    this._prevEntityState = entity.state;

    // ---------- minor events ----------
    this.minorTimer -= dt;
    this.glimpseCooldown -= dt;
    this.shadowCooldown -= dt;
    if (this.minorTimer <= 0) {
      this.minorTimer = inCalm
        ? 14 + Math.random() * 12
        : (6 + Math.random() * 10) * (1.15 - this.tension * 0.5);
      this._fireMinorEvent(inCalm, light);
    }

    // ---------- hints ----------
    for (const [id, at, text] of HINTS) {
      if (time > at && !this.hintsShown.has(id)) {
        this.hintsShown.add(id);
        ui.showHint(text);
        break;
      }
    }
  }

  _fireMinorEvent(inCalm, light) {
    const { world, entity, lights, ambience, sfx, player, sanity, camera, ui, postfx, stats } = this.d;
    const pp = player.pos;
    const now = this.time;

    // weighted pick, gated by state
    const events = [];
    const add = (w, fn) => events.push([w, fn]);

    add(26, () => { // light flicker near the player
      const ang = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 5;
      lights.forceFlicker(pp.x + Math.cos(ang) * r, pp.z + Math.sin(ang) * r, 6, 1.5 + Math.random() * 3, now);
      sanity.hit(1);
    });

    add(20, () => { // distant thump
      const ang = Math.random() * Math.PI * 2;
      const r = 16 + Math.random() * 22;
      sfx.distantThump(pp.x + Math.cos(ang) * r, pp.z + Math.sin(ang) * r, Math.random() < 0.3);
      sanity.hit(1);
    });

    if (!inCalm) {
      add(12, () => { // footsteps that are not yours — behind you
        camera.getWorldDirection(this._v);
        const bx = pp.x - this._v.x * (9 + Math.random() * 6);
        const bz = pp.z - this._v.z * (9 + Math.random() * 6);
        sfx.otherFootsteps(bx, bz, 3 + (Math.random() * 3 | 0));
        sanity.hit(2);
        stats.scares++;
      });

      add(8, () => { // knocking from inside a wall
        const ang = Math.random() * Math.PI * 2;
        const r = 7 + Math.random() * 7;
        sfx.knock(pp.x + Math.cos(ang) * r, pp.z + Math.sin(ang) * r, 2 + (Math.random() * 3 | 0));
        sanity.hit(2);
      });

      if (sanity.value < 65) {
        add(9, () => { // whisper just behind the ear
          camera.getWorldDirection(this._v);
          sfx.whisper(pp.x - this._v.x * 1.6, pp.z - this._v.z * 1.6);
          sanity.hit(3);
        });
      }

      if (this.shadowCooldown <= 0) {
        add(7, () => { // "did that shadow move?" — purely visual, no sound
          postfx.shadowPulse();
          this.shadowCooldown = 45;
        });
      }

      if (this.glimpseCooldown <= 0 && this.tension > 0.4 && entity.state === ESTATE.DORMANT) {
        add(10, () => { // glimpse at the end of a corridor
          camera.getWorldDirection(this._v);
          // probe forward for the farthest visible spot
          let gx = null, gz = null;
          for (let d = 19; d >= 9; d -= 2) {
            const tx = pp.x + this._v.x * d, tz = pp.z + this._v.z * d;
            if (world.grid.losClear(pp.x, pp.z, tx, tz) && !world.grid.isSolid(Math.floor(tx / 4), Math.floor(tz / 4))) {
              gx = tx; gz = tz;
              break;
            }
          }
          if (gx !== null && entity.showGlimpse(gx, gz, pp, 0.55 + Math.random() * 0.5)) {
            sfx.glimpseSting();
            ambience.cut(1.2); // the room holds its breath

            sanity.hit(6);
            stats.scares++;
            this.glimpseCooldown = 55 + Math.random() * 40;
            this.tension = clamp(this.tension + 0.12, 0, 1);
          }
        });
      }

      if (light > 0.4 && this.tension > 0.5) {
        add(6, () => { // the lights die in a wave around you
          lights.killLights(pp.x, pp.z, 13, 6 + Math.random() * 4, now);
          sanity.hit(4);
          stats.scares++;
          this.tension = clamp(this.tension + 0.08, 0, 1);
        });
      }
    }

    let total = 0;
    for (const [w] of events) total += w;
    let roll = Math.random() * total;
    for (const [w, fn] of events) {
      roll -= w;
      if (roll <= 0) {
        fn();
        return;
      }
    }
  }
}
