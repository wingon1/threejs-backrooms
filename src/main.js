// Entry point and game orchestration: app states, the render loop, and the
// wiring between world, player, entity, director, audio, post FX, and UI.
import * as THREE from 'three';
import { buildTextureSet } from './world/textures.js';
import { World } from './world/world.js';
import { LightSystem } from './world/lights.js';
import { CS } from './world/grid.js';
import { AudioEngine } from './audio/engine.js';
import { Ambience } from './audio/ambience.js';
import { Sfx } from './audio/sfx.js';
import { Player, Sanity } from './player/player.js';
import { Entity } from './entity/entity.js';
import { Director } from './director/director.js';
import { PostFX } from './fx/post.js';
import { UI } from './ui/ui.js';

const APP = {
  TITLE: 0, ENTERING: 1, PLAYING: 2, PAUSED: 3, DYING: 4, DEAD: 5, WINNING: 6, WON: 7
};

class Game {
  constructor() {
    this.ui = new UI();
    this.canvas = document.getElementById('game-canvas');

    // ---- capability checks ----
    if (!window.WebGLRenderingContext) {
      this.ui.compatWarning('this browser cannot render the backrooms (no WebGL).');
      return;
    }
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas, antialias: false, powerPreference: 'high-performance'
      });
    } catch (e) {
      this.ui.compatWarning('failed to start WebGL. try another browser.');
      return;
    }
    if (!('pointerLockElement' in document)) {
      this.ui.compatWarning('pointer lock is not supported here — mouse look will not work. use a desktop browser.');
    }

    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.fogColor = new THREE.Color(0x121110);
    this.scene.background = this.fogColor;
    this.scene.fog = new THREE.FogExp2(this.fogColor, 0.055);
    this.baseFogDensity = 0.055;

    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 90);

    // ---- audio ----
    this.audio = new AudioEngine();
    this.ambience = new Ambience(this.audio);
    this.sfx = new Sfx(this.audio);

    // ---- visuals ----
    this.textures = buildTextureSet(1337);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    this.postfx.setSize(window.innerWidth, window.innerHeight);

    // ---- run state ----
    this.state = APP.TITLE;
    this.time = 0;
    this.clock = new THREE.Clock();
    this.stats = { time: 0, distance: 0, scares: 0, waters: 0, chunks: 0 };
    this.hbTimer = 0;
    this.titleYaw = 0;
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    this.seed = this._initialSeed();
    this._createRun(this.seed, true);

    this._bindUI();
    this._bindPointerLock();
    window.addEventListener('resize', () => this._onResize());

    // title backdrop is ready — fade in
    this.ui.showScreen('title');
    requestAnimationFrame(() => this.ui.fadeIn(true));

    this.renderer.setAnimationLoop(() => this._frame());
  }

  _initialSeed() {
    const p = new URLSearchParams(location.search).get('seed');
    if (p && !isNaN(+p)) return +p | 0;
    return (Math.random() * 0x7fffffff) | 0;
  }

  // ================= run lifecycle =================

  _createRun(seed, keepCamera = false) {
    if (this.world) this.world.dispose();
    if (this.lights) this.lights.dispose();
    if (this.entity) this.entity.dispose();
    if (this.player) this.player.dispose();

    this.world = new World(this.scene, seed, this.textures);
    this.lights = new LightSystem(this.scene, this.world);
    this.player = new Player(this.camera, this.world, this.sfx);
    this.sanity = new Sanity();
    this.entity = new Entity(this.scene, this.world, this.sfx);
    this.entity.onStrike = () => this._onCaught();
    this.entity.onVanish = (dist) => {
      this.stats.scares++;
      this.sanity.hit(dist < 10 ? 8 : 4);
      // a vanish is a release valve: cool down so dread can rebuild
      this.director.entityCooldownUntil = this.director.time + 40 + Math.random() * 30;
      this.director.tension *= 0.55;
    };
    this.director = new Director({
      world: this.world, entity: this.entity, lights: this.lights,
      ambience: this.ambience, sfx: this.sfx, player: this.player,
      sanity: this.sanity, camera: this.camera, ui: this.ui,
      postfx: this.postfx, stats: this.stats
    });

    const [spawnX, spawnZ] = this._findSpawn();
    this.spawnX = spawnX;
    this.spawnZ = spawnZ;
    this.player.setSpawn(spawnX, spawnZ, Math.random() * Math.PI * 2);
    this.world.buildAllNow(spawnX, spawnZ);
    if (!keepCamera) this.player.syncCamera(0);
  }

  /** Nearest non-solid cell to (1,1) — never spawn inside a block. */
  _findSpawn() {
    const grid = this.world.grid;
    for (let r = 0; r < 6; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const cx = 1 + dx, cz = 1 + dz;
          if (!grid.isSolid(cx, cz)) {
            return [cx * CS + CS / 2, cz * CS + CS / 2];
          }
        }
      }
    }
    return [CS * 1.5, CS * 1.5];
  }

  _startRun() {
    this.audio.init();
    this.audio.resume();
    this.ambience.start();
    this.sfx.uiClick();

    this.state = APP.ENTERING;
    this.ui.fadeToBlack(false);
    this.ui.showNoclipText(true);
    this.ui.hideAllScreens();

    setTimeout(() => {
      // fresh world every run (first run keeps the title-backdrop world)
      if (this._hadRun) {
        this.seed = (Math.random() * 0x7fffffff) | 0;
        this._createRun(this.seed);
      }
      this._hadRun = true;
      this.stats = { time: 0, distance: 0, scares: 0, waters: 0, chunks: 0 };
      this.director.d.stats = this.stats;
      this.sanity.reset();
      this.hbTimer = 0;
      this.postfx.glitch = 0;

      this.ui.showNoclipText(false);
      this.ui.showHUD(true);
      this.ui.fadeIn(false);
      this.state = APP.PLAYING;
      this.player.enabled = true;
      this._requestLock();
    }, 1700);
  }

  _onCaught() {
    if (this.state !== APP.PLAYING) return;
    this.state = APP.DYING;
    this.player.enabled = false;
    this.stats.scares++;

    // snap the view to it
    const dx = this.entity.pos.x - this.player.pos.x;
    const dz = this.entity.pos.z - this.player.pos.z;
    this.player.yaw = Math.atan2(-dx, -dz);
    this.player.pitch = 0.12;
    this.player.syncCamera(this.time);

    this.sfx.scream();
    this.ambience.setTension(0);
    this.postfx.glitchPulse(1.6, 1.2);
    document.exitPointerLock && document.exitPointerLock();

    // go black behind the (opaque) scare overlay so nothing flashes after it
    this.ui.fadeToBlack(false);
    this.ui.playScare(1.05, () => {
      this.state = APP.DEAD;
      this.entity.despawn();
      this.ui.showHUD(false);
      this.stats.chunks = this.world.visitedChunks.size;
      this.ui.renderStats(this.ui.el.deathStats, this.stats);
      this.ui.showScreen('death');
      requestAnimationFrame(() => this.ui.fadeIn(true));
    });
  }

  _onWin() {
    if (this.state !== APP.PLAYING) return;
    this.state = APP.WINNING;
    this.player.enabled = false;
    this.sfx.noclip();
    this.ambience.cut(5);
    document.exitPointerLock && document.exitPointerLock();

    let t = 0;
    const ramp = setInterval(() => {
      t += 0.1;
      this.postfx.glitchPulse(Math.min(1.8, t), 0.3);
    }, 100);

    setTimeout(() => {
      clearInterval(ramp);
      this.ui.fadeToBlack(false);
      setTimeout(() => {
        this.state = APP.WON;
        this.ui.showHUD(false);
        this.postfx.glitch = 0;
        this.stats.chunks = this.world.visitedChunks.size;
        this.ui.renderStats(this.ui.el.winStats, this.stats);
        this.ui.showScreen('win');
        this.ui.fadeIn(true);
      }, 900);
    }, 2800);
  }

  _pause() {
    if (this.state !== APP.PLAYING) return;
    this.state = APP.PAUSED;
    this._pausedAt = performance.now();
    this.player.enabled = false;
    this.audio.suspend();
    this.ui.showScreen('pause');
  }

  _resume() {
    if (this.state !== APP.PAUSED) return;
    this.ui.hideAllScreens();
    this.audio.resume();
    this.state = APP.PLAYING;
    this.player.enabled = true;
    this._requestLock();
  }

  _quitToTitle() {
    this.state = APP.TITLE;
    this.player.enabled = false;
    this.entity.despawn();
    this.ui.showHUD(false);
    this.ui.hideScare();
    this.ui.showScreen('title');
    this.audio.resume();
  }

  // ================= input & UI =================

  _bindUI() {
    const ui = this.ui;
    ui.bindSettings((s) => {
      this.audio.setVolumes({ master: s.master / 100, amb: s.amb / 100, sfx: s.sfx / 100 });
      if (this.player) this.player.sensitivity = s.sens / 100;
      this._applyQuality(s.quality);
    });

    const btn = (id, fn) => document.getElementById(id).addEventListener('click', () => {
      this.sfx.uiClick();
      fn();
    });

    btn('btn-start', () => this._startRun());
    btn('btn-settings', () => {
      ui.settingsReturnTo = 'title';
      ui.showScreen('settings');
    });
    btn('btn-settings-back', () => ui.showScreen(ui.settingsReturnTo));
    btn('btn-resume', () => this._resume());
    btn('btn-pause-settings', () => {
      ui.settingsReturnTo = 'pause';
      ui.showScreen('settings');
    });
    btn('btn-quit', () => this._quitToTitle());
    btn('btn-retry', () => this._startRun());
    btn('btn-death-title', () => this._quitToTitle());
    btn('btn-win-again', () => this._startRun());
    btn('btn-win-title', () => this._quitToTitle());

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && this.state === APP.PLAYING) this._tryInteract();
      // guard against the same Esc press that triggered the pause
      if (e.code === 'Escape' && this.state === APP.PAUSED &&
          performance.now() - (this._pausedAt || 0) > 500) this._resume();
    });
  }

  _bindPointerLock() {
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (!locked && this.state === APP.PLAYING) this._pause();
    });
    document.addEventListener('pointerlockerror', () => {
      if (this.state === APP.PLAYING) {
        this.ui.showHint('click the screen to capture the mouse');
      }
    });
    this.canvas.addEventListener('click', () => {
      if (this.state === APP.PLAYING && document.pointerLockElement !== this.canvas) {
        this._requestLock();
      }
    });
  }

  _requestLock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* unsupported */ }
  }

  _applyQuality(q) {
    const dpr = window.devicePixelRatio || 1;
    if (q === 'low') {
      this.renderer.setPixelRatio(Math.min(dpr, 1));
      this.postfx.enabled = false;
      this.baseFogDensity = 0.07;
      if (this.world) this.world.setRadius(2);
    } else if (q === 'high') {
      this.renderer.setPixelRatio(Math.min(dpr, 2));
      this.postfx.enabled = true;
      this.baseFogDensity = 0.05;
      if (this.world) this.world.setRadius(3);
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 1.5));
      this.postfx.enabled = true;
      this.baseFogDensity = 0.055;
      if (this.world) this.world.setRadius(2);
    }
    this._onResize();
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postfx.setSize(w, h);
  }

  _tryInteract() {
    const p = this.player.pos;
    const water = this.world.waterNear(p.x, p.z, 1.9);
    if (water) {
      water.taken = true;
      water.mesh.visible = false;
      this.sanity.restore(38);
      this.stats.waters++;
      this.sfx.drink();
      this.ui.showHint('the water tastes like almonds. you feel real again.');
    }
  }

  // ================= frame =================

  _frame() {
    let dt = this.clock.getDelta();
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    const t = this.time;

    switch (this.state) {
      case APP.TITLE:
        this._titleFrame(dt, t);
        break;
      case APP.PLAYING:
      case APP.DYING:
      case APP.WINNING:
        this._playFrame(dt, t);
        break;
      case APP.ENTERING:
      case APP.DEAD:
      case APP.WON:
      case APP.PAUSED:
        // frozen world behind menus
        break;
    }

    this.postfx.update(dt, t, this.state === APP.TITLE ? 100 : this.sanity.value);
    this.postfx.render(dt);
  }

  _titleFrame(dt, t) {
    // slow, uneasy rotation at the spawn point
    this.titleYaw += dt * 0.055;
    const px = this.spawnX + Math.sin(t * 0.05) * 0.8;
    const pz = this.spawnZ + Math.cos(t * 0.037) * 0.8;
    this.camera.position.set(px, 1.58 + Math.sin(t * 0.4) * 0.02, pz);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.titleYaw;
    this.camera.rotation.x = Math.sin(t * 0.11) * 0.03;
    this.camera.rotation.z = 0;

    this.world.update(px, pz, dt);
    this.lights.update(dt, t, px, pz);
    if (this.audio.ready) {
      this.ambience.update(dt, t);
      this.ambience.setTension(0.0);
      this.camera.getWorldDirection(this._fwd);
      this.audio.updateListener(this.camera.position, this._fwd, this._up);
    }
  }

  _playFrame(dt, t) {
    const player = this.player, world = this.world;

    player.update(dt, t, (x, z) => world.isWet(x, z));
    const p = player.pos;

    world.update(p.x, p.z, dt);
    this.lights.update(dt, t, p.x, p.z);

    const light = world.lightLevelAt(p.x, p.z);
    const entityActive = this.entity.active;
    const entityDist = entityActive ? this.entity.distanceTo(p) : 999;

    if (this.state === APP.PLAYING) {
      this.stats.time += dt;
      this.stats.distance = player.distanceWalked;

      this.sanity.update(dt, light, entityDist, entityActive, player.speedNow > 0.5);
      this.director.update(dt, t);
    }

    this.entity.update(dt, t, player, this.camera, this.scene.fog);

    // ---- audio frame ----
    if (this.audio.ready) {
      this.ambience.update(dt, t);
      this.ambience.setSanity(this.sanity.value);
      this.ambience.setBuzz(this.lights.nearestFlicker(p.x, p.z));
      this.camera.getWorldDirection(this._fwd);
      this.audio.updateListener(this.camera.position, this._fwd, this._up);
    }

    // the lights misbehave around it — a readable tell when it closes in
    if (entityActive && entityDist < 13) {
      this._entityFlickTimer = (this._entityFlickTimer || 0) - dt;
      if (this._entityFlickTimer <= 0) {
        this._entityFlickTimer = 0.9 + Math.random() * 0.8;
        this.lights.forceFlicker(this.entity.pos.x, this.entity.pos.z, 4.5, 0.6, t);
      }
    }

    // the exit calls softly when it's near
    this._portalPingTimer = (this._portalPingTimer || 0) - dt;
    if (this._portalPingTimer <= 0) {
      this._portalPingTimer = 6.5 + Math.random() * 3;
      const farPortal = world.portalNear(p.x, p.z, 48);
      if (farPortal) this.sfx.portalTone(farPortal.x, farPortal.z);
    }

    // heartbeat at the bottom of the spiral
    if (this.state === APP.PLAYING && (this.sanity.value < 28 || (entityActive && entityDist < 7))) {
      this.hbTimer -= dt;
      if (this.hbTimer <= 0) {
        const fear = Math.max(1 - this.sanity.value / 28, entityActive ? 1 - entityDist / 7 : 0);
        this.hbTimer = 1.05 - fear * 0.4;
        this.sfx.heartbeat(0.4 + fear * 0.6);
      }
    }

    // fog breathes with sanity
    const warp = 1 - this.sanity.value / 100;
    this.scene.fog.density = this.baseFogDensity * (1 + warp * 0.3 + Math.sin(t * 0.5) * 0.02 * warp);

    // ---- HUD ----
    this.ui.setStamina(player.stamina, this.state === APP.PLAYING);
    this.ui.setSanityVignette(this.sanity.value);

    if (this.state === APP.PLAYING) {
      const water = world.waterNear(p.x, p.z, 1.9);
      const portal = world.portalNear(p.x, p.z, 6);
      if (water) this.ui.setPrompt('E — take the almond water');
      else if (portal) this.ui.setPrompt('');
      else this.ui.setPrompt('');
      if (portal && !this._portalHinted) {
        this._portalHinted = true;
        this.ui.showHint('this room is wrong. walk into the dark.');
      }

      // win check
      const exit = world.portalNear(p.x, p.z, 1.25);
      if (exit) this._onWin();
    }
  }
}

new Game();
