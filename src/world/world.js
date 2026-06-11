// Chunk streaming renderer: builds merged meshes per chunk, disposes far ones.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { WorldGrid, CS, CHUNK, CHUNK_M, WALL_H, WALL_T } from './grid.js';
import { hash2, rand2 } from '../core/rng.js';

const tmpMat4 = new THREE.Matrix4();
const tmpColor = new THREE.Color();

export class World {
  constructor(scene, seed, textures) {
    this.scene = scene;
    this.seed = seed;
    this.grid = new WorldGrid(seed);
    this.tex = textures;
    this.chunks = new Map();           // key -> chunk record
    this.buildQueue = [];
    this.radius = 2;                   // chunk view radius (quality-dependent)
    this.curX = Infinity;
    this.curZ = Infinity;
    this.visitedChunks = new Set();    // stats

    // carpet covers 4m per repeat; ceiling texture (4 tiles) covers 8m
    for (const t of this.tex.carpets) t.repeat.set(CHUNK_M / 4, CHUNK_M / 4);
    for (const t of this.tex.ceilings) t.repeat.set(CHUNK_M / 8, CHUNK_M / 8);

    // base materials (cloned per chunk with slight tint so nothing tiles obviously)
    this.wallMats = this.tex.wallpapers.map(t => new THREE.MeshLambertMaterial({ map: t }));
    this.floorMats = this.tex.carpets.map(t => new THREE.MeshLambertMaterial({ map: t }));
    this.ceilMats = this.tex.ceilings.map(t => new THREE.MeshLambertMaterial({ map: t }));
    this.fixtureMat = new THREE.MeshBasicMaterial({ map: this.tex.fixture });
    this.wetMat = new THREE.MeshBasicMaterial({
      color: 0x06050a, transparent: true, opacity: 0.4, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1
    });
    this.holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.chairMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1a });
    this.waterMats = {
      bottle: new THREE.MeshLambertMaterial({ color: 0xcfd8dc, emissive: 0x20262a, transparent: true, opacity: 0.85 }),
      cap: new THREE.MeshLambertMaterial({ color: 0x6d4c41 })
    };
    this.waterGeo = this._buildBottleGeometry();
    this.fixtureGeo = new THREE.PlaneGeometry(0.62, 1.24);
    this.fixtureGeo.rotateX(Math.PI / 2); // face down

    this.portalUniforms = { uTime: { value: 0 } };
    this.portalMat = new THREE.ShaderMaterial({
      uniforms: this.portalUniforms,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                     mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          vec2 p = vUv - 0.5;
          float r = length(p);
          float a = atan(p.y, p.x);
          float swirl = noise(vec2(a * 2.0 + uTime * 0.35, r * 6.0 - uTime * 0.8));
          float swirl2 = noise(vec2(a * 5.0 - uTime * 0.2, r * 12.0 + uTime * 0.5));
          float v = swirl * 0.7 + swirl2 * 0.3;
          float edge = smoothstep(0.5, 0.34, max(abs(p.x), abs(p.y)));
          vec3 col = mix(vec3(0.0), vec3(0.04, 0.02, 0.10), v);
          col += vec3(0.10, 0.04, 0.22) * pow(v, 3.0) * 1.6;
          col += vec3(0.5, 0.45, 0.7) * smoothstep(0.96, 1.0, v) * 0.6;
          gl_FragColor = vec4(col * edge, 1.0);
        }`,
      fog: false
    });
  }

  setRadius(r) {
    this.radius = r;
    this.curX = Infinity; // force refresh
  }

  chunkKey(X, Z) {
    return X + ':' + Z;
  }

  update(px, pz, dt) {
    this.portalUniforms.uTime.value += dt;
    // almond water bottles softly pulse so they read in dim light
    this._pulse = (this._pulse || 0) + dt;
    this.waterMats.bottle.emissiveIntensity = 0.7 + Math.sin(this._pulse * 2.1) * 0.45;
    const X = Math.floor(px / CHUNK_M), Z = Math.floor(pz / CHUNK_M);
    if (X !== this.curX || Z !== this.curZ) {
      this.curX = X;
      this.curZ = Z;
      this.visitedChunks.add(this.chunkKey(X, Z));
      // queue needed chunks, nearest first
      this.buildQueue.length = 0;
      for (let dz = -this.radius; dz <= this.radius; dz++) {
        for (let dx = -this.radius; dx <= this.radius; dx++) {
          const k = this.chunkKey(X + dx, Z + dz);
          if (!this.chunks.has(k)) this.buildQueue.push([X + dx, Z + dz, dx * dx + dz * dz]);
        }
      }
      this.buildQueue.sort((a, b) => b[2] - a[2]); // pop() takes nearest
      // dispose far chunks
      for (const [k, ch] of this.chunks) {
        if (Math.abs(ch.X - X) > this.radius + 1 || Math.abs(ch.Z - Z) > this.radius + 1) {
          this._disposeChunk(ch);
          this.chunks.delete(k);
        }
      }
      this.grid.pruneLayouts(X, Z, this.radius + 4);
    }
    // build at most one chunk per frame to avoid hitches
    if (this.buildQueue.length) {
      const [cx, cz] = this.buildQueue.pop();
      const k = this.chunkKey(cx, cz);
      if (!this.chunks.has(k)) this.chunks.set(k, this._buildChunk(cx, cz));
    }
  }

  /** Build everything inside the radius synchronously (used before fade-in). */
  buildAllNow(px, pz) {
    this.update(px, pz, 0);
    while (this.buildQueue.length) {
      const [cx, cz] = this.buildQueue.pop();
      const k = this.chunkKey(cx, cz);
      if (!this.chunks.has(k)) this.chunks.set(k, this._buildChunk(cx, cz));
    }
  }

  _buildBottleGeometry() {
    const body = new THREE.CylinderGeometry(0.07, 0.075, 0.26, 10);
    body.translate(0, 0.13, 0);
    const neck = new THREE.CylinderGeometry(0.028, 0.05, 0.07, 8);
    neck.translate(0, 0.295, 0);
    return BufferGeometryUtils.mergeGeometries([body, neck]);
  }

  _buildChunk(X, Z) {
    const L = this.grid.layout(X, Z);
    const group = new THREE.Group();
    const ox = X * CHUNK_M, oz = Z * CHUNK_M;
    group.position.set(ox, 0, oz);
    const variant = hash2(this.seed ^ 0x7777, X, Z) % 3;
    const tintAmt = (rand2(this.seed ^ 0x1234, X, Z) - 0.5) * 0.10;

    const geos = [];
    const pushBox = (w, h, d, x, y, z, uvScaleX = 1) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (uvScaleX !== 1) {
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * uvScaleX);
      }
      g.translate(x, y, z);
      geos.push(g);
    };

    const idx = (lx, lz) => lz * CHUNK + lx;
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const cx = lx * CS, cz = lz * CS;
        if (L.east[idx(lx, lz)]) {
          pushBox(WALL_T, WALL_H, CS + WALL_T, cx + CS, WALL_H / 2, cz + CS / 2, 1.7);
        }
        if (L.south[idx(lx, lz)]) {
          pushBox(CS + WALL_T, WALL_H, WALL_T, cx + CS / 2, WALL_H / 2, cz + CS, 1.7);
        }
        if (L.solid[idx(lx, lz)]) {
          pushBox(CS + WALL_T, WALL_H, CS + WALL_T, cx + CS / 2, WALL_H / 2, cz + CS / 2, 1.7);
        }
      }
    }
    for (const p of L.pillars) {
      pushBox(0.64, WALL_H, 0.64, p.lx * CS, WALL_H / 2, p.lz * CS, 0.4);
    }

    const wallMat = this.wallMats[variant].clone();
    wallMat.color.offsetHSL(0, tintAmt * 0.3, tintAmt);
    if (geos.length) {
      const merged = BufferGeometryUtils.mergeGeometries(geos);
      for (const g of geos) g.dispose();
      const walls = new THREE.Mesh(merged, wallMat);
      walls.matrixAutoUpdate = false;
      group.add(walls);
    }

    // floor
    const floorMat = this.floorMats[variant].clone();
    floorMat.color.offsetHSL(0, 0, tintAmt * 0.6);
    const floorGeo = new THREE.PlaneGeometry(CHUNK_M, CHUNK_M);
    floorGeo.rotateX(-Math.PI / 2);
    const rot = hash2(this.seed ^ 0xf100, X, Z) % 4;
    floorGeo.rotateY(rot * Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(CHUNK_M / 2, 0, CHUNK_M / 2);
    group.add(floor);

    // ceiling
    const ceilMat = this.ceilMats[variant].clone();
    ceilMat.color.offsetHSL(0, 0, tintAmt * 0.4);
    const ceilGeo = new THREE.PlaneGeometry(CHUNK_M, CHUNK_M);
    ceilGeo.rotateX(Math.PI / 2);
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.position.set(CHUNK_M / 2, WALL_H, CHUNK_M / 2);
    group.add(ceil);

    // fixtures (instanced, per-instance color drives flicker/dead states)
    const fixtures = [];
    let fixtureMesh = null;
    if (L.fixtures.length) {
      fixtureMesh = new THREE.InstancedMesh(this.fixtureGeo, this.fixtureMat, L.fixtures.length);
      L.fixtures.forEach((f, i) => {
        const wx = ox + f.lx * CS + CS / 2, wz = oz + f.lz * CS + CS / 2;
        tmpMat4.makeTranslation(f.lx * CS + CS / 2, WALL_H - 0.015, f.lz * CS + CS / 2);
        fixtureMesh.setMatrixAt(i, tmpMat4);
        fixtureMesh.setColorAt(i, this._fixtureColor(f.state, tmpColor));
        fixtures.push({
          x: wx, z: wz, baseState: f.state, state: f.state,
          phase: f.phase, index: i, level: f.state === 0 ? 1 : f.state === 1 ? 0.7 : 0
        });
      });
      fixtureMesh.instanceMatrix.needsUpdate = true;
      if (fixtureMesh.instanceColor) fixtureMesh.instanceColor.needsUpdate = true;
      fixtureMesh.frustumCulled = false; // instances span the chunk
      group.add(fixtureMesh);
    }

    // wet carpet decals
    if (L.wet.length) {
      const wetGeos = L.wet.map(w => {
        const g = new THREE.CircleGeometry(w.r, 14);
        g.rotateX(-Math.PI / 2);
        g.scale(1, 1, 0.55 + rand2(this.seed, w.lx * 97 | 0, w.lz * 131 | 0));
        g.translate(w.lx * CS, 0.015, w.lz * CS);
        return g;
      });
      const wet = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(wetGeos), this.wetMat);
      for (const g of wetGeos) g.dispose();
      group.add(wet);
    }

    // chair anomaly
    if (L.chair) {
      const chair = this._buildChair();
      chair.position.set(L.chair.lx * CS + CS / 2, 0, L.chair.lz * CS + CS / 2);
      chair.rotation.y = L.chair.rot;
      group.add(chair);
    }

    // hole in the wall — a black recess
    if (L.hole) {
      const g = new THREE.PlaneGeometry(0.9, 1.1);
      const m = new THREE.Mesh(g, this.holeMat);
      const hx = L.hole.lx * CS, hz = L.hole.lz * CS;
      if (L.hole.axis === 'e') {
        m.position.set(hx + CS - WALL_T / 2 - 0.012, 1.1, hz + CS * L.hole.t);
        m.rotation.y = -Math.PI / 2;
      } else {
        m.position.set(hx + CS * L.hole.t, 1.1, hz + CS - WALL_T / 2 - 0.012);
        m.rotation.y = Math.PI;
      }
      group.add(m);
    }

    // almond water
    let water = null;
    if (L.water) {
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(this.waterGeo, this.waterMats.bottle);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8), this.waterMats.cap);
      cap.position.y = 0.345;
      mesh.add(body, cap);
      const wx = L.water.lx * CS + CS / 2 + L.water.ox;
      const wz = L.water.lz * CS + CS / 2 + L.water.oz;
      mesh.position.set(wx, 0, wz);
      group.add(mesh);
      water = { x: ox + wx, z: oz + wz, mesh, taken: false };
    }

    // exit portal
    let portal = null;
    if (L.exit) {
      const pg = new THREE.PlaneGeometry(2.4, 2.2);
      const pm = new THREE.Mesh(pg, this.portalMat);
      const ex = L.exit.lx * CS, ez = L.exit.lz * CS;
      // room perimeter wall is 1.5 cells from the center cell's midpoint
      const off = CS * 1.5 - WALL_T / 2 - 0.05;
      let px = ex + CS / 2, pz = ez + CS / 2, ry = 0;
      if (L.exit.dir === 0) { px += off; ry = -Math.PI / 2; }
      else if (L.exit.dir === 2) { px -= off; ry = Math.PI / 2; }
      else if (L.exit.dir === 1) { pz += off; ry = Math.PI; }
      else { pz -= off; ry = 0; }
      pm.position.set(px, 1.34, pz);
      pm.rotation.y = ry;
      group.add(pm);
      portal = { x: ox + px, z: oz + pz };
    }

    this.scene.add(group);
    return {
      X, Z, group, layout: L, fixtures, fixtureMesh, water, portal,
      mats: [wallMat, floorMat, ceilMat],
      anomaly: L.anomaly
    };
  }

  _buildChair() {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.4), this.chairMat);
    seat.position.y = 0.45;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.05), this.chairMat);
    back.position.set(0, 0.72, -0.18);
    g.add(seat, back);
    for (const [dx, dz] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), this.chairMat);
      leg.position.set(dx, 0.225, dz);
      g.add(leg);
    }
    return g;
  }

  _fixtureColor(state, out) {
    if (state === 2) return out.setRGB(0.045, 0.042, 0.035); // dead
    if (state === 1) return out.setRGB(0.75, 0.73, 0.62);    // flicker (animated live)
    return out.setRGB(1, 1, 0.94);                            // lit
  }

  _disposeChunk(ch) {
    this.scene.remove(ch.group);
    ch.group.traverse(obj => {
      if (obj.geometry && obj.geometry !== this.fixtureGeo && obj.geometry !== this.waterGeo) {
        obj.geometry.dispose();
      }
    });
    for (const m of ch.mats) m.dispose();
  }

  /** Fixtures within r meters of (x, z), across loaded chunks. */
  fixturesNear(x, z, r, out) {
    out.length = 0;
    const r2 = r * r;
    const X = Math.floor(x / CHUNK_M), Z = Math.floor(z / CHUNK_M);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ch = this.chunks.get(this.chunkKey(X + dx, Z + dz));
        if (!ch) continue;
        for (const f of ch.fixtures) {
          const ddx = f.x - x, ddz = f.z - z;
          if (ddx * ddx + ddz * ddz < r2) out.push({ f, chunk: ch });
        }
      }
    }
    return out;
  }

  /** Ambient light level 0..1 at a world position (from live fixture levels). */
  lightLevelAt(x, z) {
    let best = 0;
    const X = Math.floor(x / CHUNK_M), Z = Math.floor(z / CHUNK_M);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ch = this.chunks.get(this.chunkKey(X + dx, Z + dz));
        if (!ch) continue;
        for (const f of ch.fixtures) {
          const ddx = f.x - x, ddz = f.z - z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 > 49) continue;
          const fall = 1 - Math.sqrt(d2) / 7;
          const v = f.level * fall;
          if (v > best) best = v;
        }
      }
    }
    return Math.min(1, best);
  }

  /** Is this world position on a wet carpet patch? */
  isWet(x, z) {
    const X = Math.floor(x / CHUNK_M), Z = Math.floor(z / CHUNK_M);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ch = this.chunks.get(this.chunkKey(X + dx, Z + dz));
        if (!ch) continue;
        const lx = x - (X + dx) * CHUNK_M, lz = z - (Z + dz) * CHUNK_M;
        for (const w of ch.layout.wet) {
          const ddx = w.lx * CS - lx, ddz = w.lz * CS - lz;
          if (ddx * ddx + ddz * ddz < w.r * w.r) return true;
        }
      }
    }
    return false;
  }

  /** Nearest untaken almond water within r. */
  waterNear(x, z, r) {
    const X = Math.floor(x / CHUNK_M), Z = Math.floor(z / CHUNK_M);
    let best = null, bd = r * r;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ch = this.chunks.get(this.chunkKey(X + dx, Z + dz));
        if (!ch || !ch.water || ch.water.taken) continue;
        const ddx = ch.water.x - x, ddz = ch.water.z - z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < bd) { bd = d2; best = ch.water; }
      }
    }
    return best;
  }

  /** Nearest exit portal within r. */
  portalNear(x, z, r) {
    const X = Math.floor(x / CHUNK_M), Z = Math.floor(z / CHUNK_M);
    let best = null, bd = r * r;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ch = this.chunks.get(this.chunkKey(X + dx, Z + dz));
        if (!ch || !ch.portal) continue;
        const ddx = ch.portal.x - x, ddz = ch.portal.z - z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < bd) { bd = d2; best = ch.portal; }
      }
    }
    return best;
  }

  dispose() {
    for (const [, ch] of this.chunks) this._disposeChunk(ch);
    this.chunks.clear();
    this.grid.layouts.clear();
  }
}
