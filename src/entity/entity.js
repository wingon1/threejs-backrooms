// The entity. A wrong silhouette — implied, not shown.
// Real state machine: DORMANT -> STALK (heard, not seen) -> HUNT (pursuit) -> STRIKE.
import * as THREE from 'three';
import { CS } from '../world/grid.js';
import { clamp } from '../core/rng.js';

export const ESTATE = {
  DORMANT: 0,
  STALK: 1,
  HUNT: 2,
  STRIKE: 3,
  GLIMPSE: 4 // director-driven apparition, no AI
};

export class Entity {
  constructor(scene, world, sfx) {
    this.scene = scene;
    this.world = world;
    this.sfx = sfx;

    this.state = ESTATE.DORMANT;
    this.pos = new THREE.Vector3();
    this.awareness = 0;       // 0..1+, noise-driven
    this.path = null;
    this.pathIndex = 0;
    this.repathTimer = 0;
    this.soundTimer = 2;
    this.stepDist = 0;
    this.seenTimer = 0;
    this.lostTimer = 0;
    this.glimpseTimer = 0;
    this.speed = 0;

    this.onStrike = null;     // set by game
    this.onVanish = null;     // entity slipped away after being stared at

    this.mesh = this._buildMesh();
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  _buildMesh() {
    this.uniforms = {
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color(0x0d0b04) },
      uFogDensity: { value: 0.06 },
      uAgitation: { value: 0 }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        uniform float uTime;
        uniform float uAgitation;
        varying vec3 vNormalW;
        varying float vFogDepth;
        varying vec3 vPosW;
        void main() {
          vec3 p = position;
          float n = sin(p.y * 9.0 + uTime * 3.1) * 0.5 + sin(p.y * 23.0 - uTime * 5.7) * 0.5;
          p += normal * n * (0.015 + uAgitation * 0.05);
          p.x += sin(uTime * 1.7 + p.y * 2.0) * 0.02;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vFogDepth = -mv.z;
          vNormalW = normalize(normalMatrix * normal);
          vPosW = (modelMatrix * vec4(p, 1.0)).xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uTime;
        varying vec3 vNormalW;
        varying float vFogDepth;
        varying vec3 vPosW;
        void main() {
          // near-black body with a faint sickly rim that crawls
          float rim = pow(1.0 - abs(vNormalW.z), 3.0);
          float crawl = sin(vPosW.y * 14.0 + uTime * 7.0) * 0.5 + 0.5;
          vec3 col = vec3(0.012, 0.010, 0.008);
          col += vec3(0.05, 0.045, 0.02) * rim * (0.4 + crawl * 0.6);
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
          col = mix(col, uFogColor, fogFactor);
          gl_FragColor = vec4(col, 1.0);
        }`
    });

    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.20, 1.35, 8, 6), mat);
    torso.position.y = 1.05;
    torso.scale.x = 1.35;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), mat);
    head.position.y = 1.93;
    head.scale.set(0.9, 1.7, 0.9);
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.25, 6, 4), mat);
    armL.position.set(-0.28, 1.18, 0);
    armL.rotation.z = 0.12;
    const armR = armL.clone();
    armR.position.x = 0.28;
    armR.rotation.z = -0.12;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.05, 0.85, 6, 4), mat);
    legs.position.y = 0.42;
    g.add(torso, head, armL, armR, legs);
    g.scale.setScalar(1.12); // slightly too tall
    this.material = mat;
    this.headMesh = head;
    this.armL = armL;
    this.armR = armR;
    return g;
  }

  get active() {
    return this.state === ESTATE.STALK || this.state === ESTATE.HUNT || this.state === ESTATE.STRIKE;
  }

  distanceTo(p) {
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Find a spawn cell ring-distance from the player, preferably without LOS. */
  spawn(playerPos, mode = ESTATE.STALK, minD = 13, maxD = 22) {
    const pcx = Math.floor(playerPos.x / CS), pcz = Math.floor(playerPos.z / CS);
    let best = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const d = (minD + Math.random() * (maxD - minD)) / CS;
      const cx = Math.round(pcx + Math.cos(ang) * d);
      const cz = Math.round(pcz + Math.sin(ang) * d);
      if (this.world.grid.isSolid(cx, cz)) continue;
      const wx = cx * CS + CS / 2, wz = cz * CS + CS / 2;
      const los = this.world.grid.losClear(playerPos.x, playerPos.z, wx, wz);
      if (!los) { best = { wx, wz }; break; }
      if (!best) best = { wx, wz };
    }
    if (!best) return false;
    this.pos.set(best.wx, 0, best.wz);
    this.state = mode;
    this.awareness = mode === ESTATE.HUNT ? 1 : 0.25;
    this.path = null;
    this.repathTimer = 0;
    this.seenTimer = 0;
    this.lostTimer = 0;
    this.soundTimer = 1 + Math.random() * 2;
    this.mesh.visible = true;
    return true;
  }

  /** Director-driven apparition at a specific spot; freezes, then vanishes. */
  showGlimpse(x, z, facePos, duration = 0.8) {
    if (this.active) return false;
    this.pos.set(x, 0, z);
    this.state = ESTATE.GLIMPSE;
    this.glimpseTimer = duration;
    this.mesh.visible = true;
    this.mesh.position.copy(this.pos);
    this.mesh.lookAt(facePos.x, 0, facePos.z);
    return true;
  }

  despawn() {
    this.state = ESTATE.DORMANT;
    this.mesh.visible = false;
    this.path = null;
    this.awareness = 0;
  }

  /** Force pursuit (director escalation). */
  beginHunt() {
    if (this.state === ESTATE.STALK) {
      this.state = ESTATE.HUNT;
      this.awareness = 1;
      this.sfx.entityGroan(this.pos.x, this.pos.z, 1);
    }
  }

  update(dt, time, player, camera, fog) {
    this.uniforms.uTime.value = time;
    if (fog) {
      this.uniforms.uFogColor.value.copy(fog.color);
      this.uniforms.uFogDensity.value = fog.density;
    }

    if (this.state === ESTATE.DORMANT) return;

    if (this.state === ESTATE.GLIMPSE) {
      this.glimpseTimer -= dt;
      this.uniforms.uAgitation.value = 0.3;
      if (this.glimpseTimer <= 0) this.despawn();
      return;
    }

    const grid = this.world.grid;
    const pp = player.pos;
    const dist = this.distanceTo(pp);
    const los = dist < 30 && grid.losClear(this.pos.x, this.pos.z, pp.x, pp.z);

    // ---- hearing ----
    if (this.state === ESTATE.STALK) {
      const hear = player.noise * clamp(1 - dist / 26, 0, 1);
      this.awareness = clamp(this.awareness + hear * dt * 0.9 - dt * 0.015, 0, 1.2);
    }

    // ---- being watched (stalk only): it does not like to be seen ----
    if (this.state === ESTATE.STALK && los) {
      const toE = new THREE.Vector3(this.pos.x - pp.x, 0, this.pos.z - pp.z).normalize();
      const look = new THREE.Vector3();
      camera.getWorldDirection(look);
      look.y = 0;
      look.normalize();
      if (toE.dot(look) > 0.72) {
        this.seenTimer += dt;
        if (this.seenTimer > 0.55) {
          // it slips away — or decides it's done hiding
          if (this.awareness > 0.75 && Math.random() < 0.4) {
            this.beginHunt();
          } else {
            this.despawn();
            if (this.onVanish) this.onVanish(dist);
          }
          this.seenTimer = 0;
          return;
        }
      } else {
        this.seenTimer = Math.max(0, this.seenTimer - dt * 2);
      }
    }

    // ---- state transitions ----
    if (this.state === ESTATE.STALK && this.awareness >= 1) {
      this.beginHunt();
    }
    if (this.state === ESTATE.HUNT) {
      if (!los && dist > 26) {
        this.lostTimer += dt;
        if (this.lostTimer > 11) {
          this.state = ESTATE.STALK;
          this.awareness = 0.35;
          this.lostTimer = 0;
        }
      } else {
        this.lostTimer = 0;
      }
      if (dist < 1.35 && this.onStrike) {
        this.state = ESTATE.STRIKE;
        this.onStrike();
        return;
      }
    }

    // ---- movement ----
    let targetSpeed = 0;
    if (this.state === ESTATE.STALK) {
      targetSpeed = 1.5;
      this._stalkMove(dt, pp, dist, los);
    } else if (this.state === ESTATE.HUNT) {
      targetSpeed = 3.55 + (player.sprinting ? 0.45 : 0) + this.awareness * 0.2;
      this._huntMove(dt, pp, dist, los);
    }
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 4);

    this._followPath(dt, pp, los, dist);

    // ---- sounds ----
    this.soundTimer -= dt;
    if (this.soundTimer <= 0) {
      if (this.state === ESTATE.STALK) {
        Math.random() < 0.75
          ? this.sfx.entityShuffle(this.pos.x, this.pos.z)
          : this.sfx.entityGroan(this.pos.x, this.pos.z, 0.4);
        this.soundTimer = 3.5 + Math.random() * 4;
      } else if (this.state === ESTATE.HUNT) {
        this.sfx.entityGroan(this.pos.x, this.pos.z, 0.9);
        this.soundTimer = 4 + Math.random() * 3;
      }
    }

    // ---- visuals ----
    this.uniforms.uAgitation.value = this.state === ESTATE.HUNT ? 1 : this.awareness * 0.5;
    this.mesh.position.copy(this.pos);
    if (dist < 40) {
      this.mesh.lookAt(pp.x, 0, pp.z);
    }
    // hunting lurch
    const lurch = this.state === ESTATE.HUNT ? Math.sin(time * 9) * 0.08 : Math.sin(time * 2.2) * 0.02;
    this.mesh.rotation.z = lurch;
    this.armL.rotation.x = Math.sin(time * (this.state === ESTATE.HUNT ? 11 : 1.3)) * 0.3;
    this.armR.rotation.x = -this.armL.rotation.x * 0.8;
  }

  _stalkMove(dt, pp, dist, los) {
    this.repathTimer -= dt;
    if (this.repathTimer > 0) return;
    this.repathTimer = 1.4 + Math.random() * 0.8;

    // hold a ring around the player: close in if far, back off if close
    const want = 10 + (1 - this.awareness) * 5;
    const grid = this.world.grid;
    const scx = Math.floor(this.pos.x / CS), scz = Math.floor(this.pos.z / CS);
    let target = null;
    for (let attempt = 0; attempt < 14; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const tx = Math.round((pp.x + Math.cos(ang) * want) / CS);
      const tz = Math.round((pp.z + Math.sin(ang) * want) / CS);
      if (grid.isSolid(tx, tz)) continue;
      // prefer spots the player can't see
      if (!grid.losClear(pp.x, pp.z, tx * CS + CS / 2, tz * CS + CS / 2)) {
        target = [tx, tz];
        break;
      }
      if (!target) target = [tx, tz];
    }
    if (target) {
      this.path = grid.findPath(scx, scz, target[0], target[1], 400);
      this.pathIndex = 0;
    }
  }

  _huntMove(dt, pp, dist, los) {
    this.repathTimer -= dt;
    if (this.repathTimer > 0) return;
    this.repathTimer = 0.65;
    const grid = this.world.grid;
    const scx = Math.floor(this.pos.x / CS), scz = Math.floor(this.pos.z / CS);
    const tcx = Math.floor(pp.x / CS), tcz = Math.floor(pp.z / CS);
    this.path = grid.findPath(scx, scz, tcx, tcz, 700);
    this.pathIndex = 0;
  }

  _followPath(dt, pp, los, dist) {
    let tx, tz;
    // direct steering when close with clear line
    if (this.state === ESTATE.HUNT && los && dist < 7) {
      tx = pp.x;
      tz = pp.z;
    } else if (this.path && this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex];
      tx = wp[0] * CS + CS / 2;
      tz = wp[1] * CS + CS / 2;
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      if (dx * dx + dz * dz < 0.6) {
        this.pathIndex++;
        return;
      }
    } else {
      return;
    }
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.001) return;
    const step = Math.min(this.speed * dt, d);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;

    // hunting footfalls
    this.stepDist += step;
    const stride = this.state === ESTATE.HUNT ? 1.45 : 1.1;
    if (this.stepDist > stride) {
      this.stepDist = 0;
      if (this.state === ESTATE.HUNT) {
        this.sfx.entityRunStep(this.pos.x, this.pos.z);
      } else if (dist < 18 && Math.random() < 0.5) {
        this.sfx.entityShuffle(this.pos.x, this.pos.z);
      }
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}
