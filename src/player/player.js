// First-person controller: pointer-lock look, WASD with sprint/crouch,
// stamina, head-bob-driven footsteps, circle-vs-AABB collision against the
// wall grid, and the noise level the entity listens for.
import * as THREE from 'three';
import { clamp } from '../core/rng.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.02;
const RADIUS = 0.34;

const WALK_SPEED = 2.7;
const SPRINT_SPEED = 4.7;
const CROUCH_SPEED = 1.35;

export class Player {
  constructor(camera, world, sfx) {
    this.camera = camera;
    this.world = world;
    this.sfx = sfx;

    this.pos = new THREE.Vector3(2, 0, 2); // feet
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.sensitivity = 1;

    this.keys = Object.create(null);
    this.enabled = false;

    this.stamina = 1;
    this.staminaRegenDelay = 0;
    this.exhausted = false;
    this.crouched = false;
    this.crouchLerp = 0;
    this.sprinting = false;

    this.noise = 0.05;       // what the entity hears
    this.speedNow = 0;
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.breathTimer = 0;

    this.distanceWalked = 0;

    this._colliders = [];
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();

    this._onMouseMove = (e) => {
      if (!this.enabled || document.pointerLockElement === null) return;
      const s = 0.0022 * this.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = clamp(this.pitch, -1.45, 1.45);
    };
    this._onKeyDown = (e) => {
      this.keys[e.code] = true;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.keys[e.code] = false;
    };

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
  }

  setSpawn(x, z, yaw = 0) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.stamina = 1;
    this.exhausted = false;
    this.crouched = false;
    this.crouchLerp = 0;
    this.distanceWalked = 0;
    this.bobPhase = 0;
    this.syncCamera(0);
  }

  get eyeHeight() {
    return EYE_STAND + (EYE_CROUCH - EYE_STAND) * this.crouchLerp;
  }

  update(dt, time, isWetAt) {
    if (!this.enabled) {
      this.noise = 0.02;
      return;
    }

    const k = this.keys;
    const fwdIn = (k['KeyW'] ? 1 : 0) - (k['KeyS'] ? 1 : 0);
    const rightIn = (k['KeyD'] ? 1 : 0) - (k['KeyA'] ? 1 : 0);

    // crouch (Ctrl or C)
    const wantCrouch = !!(k['ControlLeft'] || k['ControlRight'] || k['KeyC']);
    this.crouched = wantCrouch;
    this.crouchLerp += ((wantCrouch ? 1 : 0) - this.crouchLerp) * Math.min(1, dt * 9);

    // sprint requires stamina and actually moving forward-ish
    const wantSprint = !!(k['ShiftLeft'] || k['ShiftRight']) && fwdIn > 0 && !this.crouched;
    if (this.exhausted && this.stamina > 0.28) this.exhausted = false;
    this.sprinting = wantSprint && !this.exhausted && this.stamina > 0.01;

    if (this.sprinting) {
      this.stamina -= dt * 0.17;
      this.staminaRegenDelay = 1.1;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
      }
    } else {
      this.staminaRegenDelay -= dt;
      if (this.staminaRegenDelay <= 0) {
        this.stamina = clamp(this.stamina + dt * (this.crouched ? 0.10 : 0.15), 0, 1);
      }
    }

    // breathing when winded
    if (this.stamina < 0.4 || this.exhausted) {
      this.breathTimer -= dt;
      if (this.breathTimer <= 0) {
        this.breathTimer = 0.9 + this.stamina * 1.6;
        this.sfx.breath(1 - this.stamina);
      }
    }

    // movement
    const targetSpeed = this.crouched ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this._wish.set(0, 0, 0)
      .addScaledVector(this._fwd, fwdIn)
      .addScaledVector(this._right, rightIn);
    if (this._wish.lengthSq() > 0) this._wish.normalize().multiplyScalar(targetSpeed);

    const accel = this._wish.lengthSq() > 0 ? 11 : 13;
    this.vel.x += (this._wish.x - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (this._wish.z - this.vel.z) * Math.min(1, dt * accel);

    // collide & move, axis by axis
    const grid = this.world.grid;
    grid.collidersNear(this.pos.x, this.pos.z, this._colliders);
    const oldX = this.pos.x, oldZ = this.pos.z;

    this.pos.x += this.vel.x * dt;
    for (const b of this._colliders) {
      if (this.pos.x + RADIUS > b.x0 && this.pos.x - RADIUS < b.x1 &&
          this.pos.z + RADIUS > b.z0 && this.pos.z - RADIUS < b.z1) {
        this.pos.x = this.vel.x > 0 ? b.x0 - RADIUS : b.x1 + RADIUS;
        this.vel.x = 0;
      }
    }
    this.pos.z += this.vel.z * dt;
    for (const b of this._colliders) {
      if (this.pos.x + RADIUS > b.x0 && this.pos.x - RADIUS < b.x1 &&
          this.pos.z + RADIUS > b.z0 && this.pos.z - RADIUS < b.z1) {
        this.pos.z = this.vel.z > 0 ? b.z0 - RADIUS : b.z1 + RADIUS;
        this.vel.z = 0;
      }
    }

    const dx = this.pos.x - oldX, dz = this.pos.z - oldZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    this.distanceWalked += dist;
    this.speedNow = dist / Math.max(dt, 1e-5);

    // head bob + footsteps
    if (this.speedNow > 0.4) {
      const strideFreq = 1.55 + this.speedNow * 0.42;
      const prev = this.bobPhase;
      this.bobPhase += dt * strideFreq * Math.PI;
      this.bobAmp += (Math.min(1, this.speedNow / SPRINT_SPEED) - this.bobAmp) * Math.min(1, dt * 6);
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) {
        const intensity = this.crouched ? 0.18 : this.sprinting ? 1 : 0.5;
        this.sfx.footstep(intensity, isWetAt ? isWetAt(this.pos.x, this.pos.z) : false);
      }
    } else {
      this.bobAmp += (0 - this.bobAmp) * Math.min(1, dt * 8);
    }

    // noise the entity hears
    const targetNoise = this.speedNow < 0.3 ? 0.04
      : this.crouched ? 0.13
      : this.sprinting ? 1.0
      : 0.42;
    this.noise += (targetNoise - this.noise) * Math.min(1, dt * 5);

    this.syncCamera(time);
  }

  syncCamera(time) {
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.055 * this.bobAmp;
    const bobX = Math.sin(this.bobPhase) * 0.02 * this.bobAmp;
    // subtle idle sway — never perfectly still
    const sway = Math.sin(time * 0.45) * 0.006 + Math.sin(time * 1.13) * 0.003;
    this.camera.position.set(
      this.pos.x + Math.cos(this.yaw) * bobX,
      this.pos.y + this.eyeHeight + bobY + sway,
      this.pos.z - Math.sin(this.yaw) * bobX
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = Math.sin(this.bobPhase) * 0.0035 * this.bobAmp;
  }

  dispose() {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
  }
}

/** Sanity: drains in darkness and dread, recovers under steady light. */
export class Sanity {
  constructor() {
    this.value = 100;
  }

  reset() {
    this.value = 100;
  }

  hit(amount) {
    this.value = clamp(this.value - amount, 0, 100);
  }

  restore(amount) {
    this.value = clamp(this.value + amount, 0, 100);
  }

  update(dt, lightLevel, entityDistance, entityActive, moving) {
    let delta = 0;
    if (lightLevel < 0.18) delta -= 1.15;       // darkness gnaws
    else if (lightLevel < 0.4) delta -= 0.45;
    if (entityActive && entityDistance < 14) {
      delta -= (1 - entityDistance / 14) * 2.6; // presence
    }
    if (lightLevel > 0.55 && (!entityActive || entityDistance > 22)) {
      delta += moving ? 0.55 : 1.05;            // safe-feeling pool of light
    }
    this.value = clamp(this.value + delta * dt, 0, 100);
    return this.value;
  }
}
