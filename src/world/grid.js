// Pure, deterministic world layout logic (no three.js, no DOM).
// Unit-testable in Node. The renderer (world.js) consumes layouts produced here.
//
// World = infinite grid of cells (CS meters square), grouped into CHUNK x CHUNK chunks.
// Walls live on cell edges: east[i] = wall on +X edge, south[i] = wall on +Z edge.
// Edges on chunk borders are ALWAYS open and border cells are never solid,
// which (together with a per-chunk connectivity repair pass) guarantees the
// entire infinite world is one connected space — no sealed pockets, ever.

import { hash2, rand2, mulberry32 } from '../core/rng.js';

export const CS = 4;        // cell size, meters
export const CHUNK = 8;     // cells per chunk side
export const CHUNK_M = CS * CHUNK;
export const WALL_H = 2.8;  // ceiling height
export const WALL_T = 0.26; // wall thickness

export const ANOMALY = {
  NONE: 0,
  DEAD_LIGHTS: 1,
  CHAIR: 2,
  WET: 3,
  LONG_HALL: 4,
  EXIT: 5,
  HOLE: 6
};

const idx = (lx, lz) => lz * CHUNK + lx;

export class WorldGrid {
  constructor(seed) {
    this.seed = seed | 0;
    this.layouts = new Map();
  }

  layoutKey(X, Z) {
    return X + ':' + Z;
  }

  /** Get (or generate) the layout for chunk (X, Z). Deterministic per (seed, X, Z). */
  layout(X, Z) {
    const k = this.layoutKey(X, Z);
    let L = this.layouts.get(k);
    if (!L) {
      L = this._generate(X, Z);
      this.layouts.set(k, L);
    }
    return L;
  }

  _generate(X, Z) {
    const seed = this.seed;
    const rng = mulberry32(hash2(seed, X, Z));
    const east = new Uint8Array(CHUNK * CHUNK);
    const south = new Uint8Array(CHUNK * CHUNK);
    const solid = new Uint8Array(CHUNK * CHUNK);

    // ---- anomaly selection ----
    let anomaly = ANOMALY.NONE;
    const distChunks = Math.abs(X) + Math.abs(Z);
    const exitRoll = rand2(seed ^ 0xe71700, X, Z);
    if (exitRoll < 0.016 && distChunks >= 5) {
      anomaly = ANOMALY.EXIT;
    } else {
      const r = rand2(seed ^ 0xa0a0a, X, Z);
      if (r < 0.055) anomaly = ANOMALY.DEAD_LIGHTS;
      else if (r < 0.115) anomaly = ANOMALY.CHAIR;
      else if (r < 0.23) anomaly = ANOMALY.WET;
      else if (r < 0.31) anomaly = ANOMALY.LONG_HALL;
      else if (r < 0.36) anomaly = ANOMALY.HOLE;
    }

    // ---- base maze walls (interior edges only; chunk borders stay open) ----
    let pWall = 0.30 + rng() * 0.14;
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        if (lx < CHUNK - 1 && rng() < pWall) east[idx(lx, lz)] = 1;
        if (lz < CHUNK - 1 && rng() < pWall) south[idx(lx, lz)] = 1;
      }
    }

    // long, slightly-too-long corridors: strip walls along bands
    if (anomaly === ANOMALY.LONG_HALL) {
      const alongX = rng() < 0.5;
      const band = 1 + (rng() * (CHUNK - 3) | 0);
      for (let i = 0; i < CHUNK; i++) {
        if (alongX) {
          if (i < CHUNK - 1) east[idx(i, band)] = 0;
          south[idx(i, band)] = 1;           // wall it in so it reads as a corridor
          if (band > 0) south[idx(i, band - 1)] = 1;
        } else {
          if (i < CHUNK - 1) south[idx(band, i)] = 0;
          east[idx(band, i)] = 1;
          if (band > 0) east[idx(band - 1, i)] = 1;
        }
      }
    }

    // ---- solid full-cell blocks (never on the border) ----
    for (let lz = 1; lz < CHUNK - 1; lz++) {
      for (let lx = 1; lx < CHUNK - 1; lx++) {
        if (rng() < 0.05) solid[idx(lx, lz)] = 1;
      }
    }

    // ---- chair shrine: a sealed cell the repair pass will open exactly once ----
    let chair = null;
    if (anomaly === ANOMALY.CHAIR) {
      const cx = 2 + (rng() * 4 | 0), cz = 2 + (rng() * 4 | 0);
      solid[idx(cx, cz)] = 0;
      east[idx(cx, cz)] = 1;
      east[idx(cx - 1, cz)] = 1;
      south[idx(cx, cz)] = 1;
      south[idx(cx, cz - 1)] = 1;
      chair = {
        lx: cx, lz: cz,
        rot: rng() * Math.PI * 2
      };
    }

    // ---- exit room: 3x3 chamber with the no-clip portal ----
    let exit = null;
    if (anomaly === ANOMALY.EXIT) {
      for (let lz = 2; lz <= 4; lz++) {
        for (let lx = 2; lx <= 4; lx++) {
          solid[idx(lx, lz)] = 0;
          if (lx < 4) east[idx(lx, lz)] = 0;
          if (lz < 4) south[idx(lx, lz)] = 0;
        }
      }
      for (let i = 2; i <= 4; i++) {
        east[idx(1, i)] = 1;   // west perimeter
        east[idx(4, i)] = 1;   // east perimeter
        south[idx(i, 1)] = 1;  // north perimeter
        south[idx(i, 4)] = 1;  // south perimeter
      }
      // one entrance
      const side = rng() * 4 | 0;
      if (side === 0) east[idx(1, 3)] = 0;
      else if (side === 1) east[idx(4, 3)] = 0;
      else if (side === 2) south[idx(3, 1)] = 0;
      else south[idx(3, 4)] = 0;
      // portal sits on the room wall opposite the entrance
      // side: 0 entrance-west, 1 entrance-east, 2 entrance-north, 3 entrance-south
      const dirs = [0, 2, 1, 3]; // -> portal on east / west / south / north wall
      exit = { lx: 3, lz: 3, dir: dirs[side] };
    }

    // ---- connectivity repair: merge every open region into one ----
    this._repairConnectivity(east, south, solid);

    // ---- pillars on interior corners (decorative, never sealing) ----
    const pillars = [];
    for (let lz = 1; lz < CHUNK; lz++) {
      for (let lx = 1; lx < CHUNK; lx++) {
        if (rand2(seed ^ 0x9111a7, X * CHUNK + lx, Z * CHUNK + lz) < 0.07) {
          pillars.push({ lx, lz });
        }
      }
    }

    // ---- ceiling fixtures: global parity pattern so it reads as one building ----
    const fixtures = [];
    const inExitRoom = (lx, lz) => anomaly === ANOMALY.EXIT && lx >= 2 && lx <= 4 && lz >= 2 && lz <= 4;
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const gx = X * CHUNK + lx, gz = Z * CHUNK + lz;
        if (((gx + gz) & 1) !== 0) continue;
        if (solid[idx(lx, lz)]) continue;
        let state = 0; // 0 lit, 1 flicker, 2 dead
        const fr = rand2(seed ^ 0xf1c5, gx, gz);
        if (anomaly === ANOMALY.DEAD_LIGHTS) state = 2;
        else if (inExitRoom(lx, lz)) state = 0;
        else if (fr < 0.09) state = 2;
        else if (fr < 0.22) state = 1;
        fixtures.push({ lx, lz, state, phase: rand2(seed ^ 0x9fa3, gx, gz) * 100 });
      }
    }

    // ---- wet carpet patches ----
    const wet = [];
    const wetCount = anomaly === ANOMALY.WET ? 3 + (rng() * 3 | 0) : (rng() < 0.25 ? 1 : 0);
    for (let i = 0; i < wetCount; i++) {
      wet.push({
        lx: rng() * CHUNK, lz: rng() * CHUNK,
        r: 1.2 + rng() * 2.4
      });
    }

    // ---- hole in the wall ----
    let hole = null;
    if (anomaly === ANOMALY.HOLE) {
      for (let tries = 0; tries < 20 && !hole; tries++) {
        const lx = rng() * (CHUNK - 1) | 0, lz = rng() * (CHUNK - 1) | 0;
        if (east[idx(lx, lz)]) hole = { lx, lz, axis: 'e', t: 0.25 + rng() * 0.5 };
        else if (south[idx(lx, lz)]) hole = { lx, lz, axis: 's', t: 0.25 + rng() * 0.5 };
      }
    }

    // ---- almond water ----
    let water = null;
    if (rand2(seed ^ 0xa1404d, X, Z) < 0.16 && anomaly !== ANOMALY.EXIT) {
      for (let tries = 0; tries < 20; tries++) {
        const lx = rng() * CHUNK | 0, lz = rng() * CHUNK | 0;
        if (!solid[idx(lx, lz)]) {
          water = {
            lx, lz,
            ox: (rng() - 0.5) * 1.6, oz: (rng() - 0.5) * 1.6
          };
          break;
        }
      }
    }

    return { X, Z, east, south, solid, anomaly, pillars, fixtures, wet, chair, hole, exit, water };
  }

  /**
   * Flood-fill from the first open border cell; knock down a wall (or clear a
   * solid) to merge every other region in. Result: each chunk's open cells form
   * exactly one connected component that includes all 28 border cells.
   */
  _repairConnectivity(east, south, solid) {
    const N = CHUNK;
    const comp = new Int16Array(N * N).fill(-1);
    const queue = [];

    const openNeighbors = (lx, lz, cb) => {
      if (lx < N - 1 && !east[idx(lx, lz)] && !solid[idx(lx + 1, lz)]) cb(lx + 1, lz);
      if (lx > 0 && !east[idx(lx - 1, lz)] && !solid[idx(lx - 1, lz)]) cb(lx - 1, lz);
      if (lz < N - 1 && !south[idx(lx, lz)] && !solid[idx(lx, lz + 1)]) cb(lx, lz + 1);
      if (lz > 0 && !south[idx(lx, lz - 1)] && !solid[idx(lx, lz - 1)]) cb(lx, lz - 1);
    };

    const flood = (sx, sz, id) => {
      queue.length = 0;
      queue.push(sx, sz);
      comp[idx(sx, sz)] = id;
      while (queue.length) {
        const z = queue.pop(), x = queue.pop();
        openNeighbors(x, z, (nx, nz) => {
          if (comp[idx(nx, nz)] === -1) {
            comp[idx(nx, nz)] = id;
            queue.push(nx, nz);
          }
        });
      }
    };

    // Repeat until a single component remains: re-flood from scratch each pass
    // (cheap at 8x8), find an unreached open cell, splice its component in.
    for (let guard = 0; guard < 64; guard++) {
      comp.fill(-1);
      flood(0, 0, 0); // (0,0) is a border cell, never solid

      let fx = -1, fz = -1;
      for (let lz = 0; lz < N && fx < 0; lz++) {
        for (let lx = 0; lx < N; lx++) {
          if (!solid[idx(lx, lz)] && comp[idx(lx, lz)] === -1) { fx = lx; fz = lz; break; }
        }
      }
      if (fx < 0) break; // fully connected
      flood(fx, fz, 1);

      // find a boundary between comp 1 and comp 0: prefer removing a wall
      let joined = false;
      for (let lz = 0; lz < N && !joined; lz++) {
        for (let lx = 0; lx < N && !joined; lx++) {
          if (comp[idx(lx, lz)] !== 1) continue;
          // east edge
          if (lx < N - 1 && east[idx(lx, lz)] && !solid[idx(lx + 1, lz)] && comp[idx(lx + 1, lz)] === 0) {
            east[idx(lx, lz)] = 0; joined = true;
          } else if (lx > 0 && east[idx(lx - 1, lz)] && !solid[idx(lx - 1, lz)] && comp[idx(lx - 1, lz)] === 0) {
            east[idx(lx - 1, lz)] = 0; joined = true;
          } else if (lz < N - 1 && south[idx(lx, lz)] && !solid[idx(lx, lz + 1)] && comp[idx(lx, lz + 1)] === 0) {
            south[idx(lx, lz)] = 0; joined = true;
          } else if (lz > 0 && south[idx(lx, lz - 1)] && !solid[idx(lx, lz - 1)] && comp[idx(lx, lz - 1)] === 0) {
            south[idx(lx, lz - 1)] = 0; joined = true;
          }
        }
      }
      if (!joined) {
        // separated only by solid cells: clear one solid adjacent to both comps
        for (let lz = 0; lz < N && !joined; lz++) {
          for (let lx = 0; lx < N && !joined; lx++) {
            if (!solid[idx(lx, lz)]) continue;
            let touches0 = false, touches1 = false;
            if (lx > 0 && comp[idx(lx - 1, lz)] === 0 && !east[idx(lx - 1, lz)]) touches0 = true;
            if (lx > 0 && comp[idx(lx - 1, lz)] === 1 && !east[idx(lx - 1, lz)]) touches1 = true;
            if (lx < N - 1 && comp[idx(lx + 1, lz)] === 0 && !east[idx(lx, lz)]) touches0 = true;
            if (lx < N - 1 && comp[idx(lx + 1, lz)] === 1 && !east[idx(lx, lz)]) touches1 = true;
            if (lz > 0 && comp[idx(lx, lz - 1)] === 0 && !south[idx(lx, lz - 1)]) touches0 = true;
            if (lz > 0 && comp[idx(lx, lz - 1)] === 1 && !south[idx(lx, lz - 1)]) touches1 = true;
            if (lz < N - 1 && comp[idx(lx, lz + 1)] === 0 && !south[idx(lx, lz)]) touches0 = true;
            if (lz < N - 1 && comp[idx(lx, lz + 1)] === 1 && !south[idx(lx, lz)]) touches1 = true;
            if (touches0 && touches1) { solid[idx(lx, lz)] = 0; joined = true; }
          }
        }
      }
      if (!joined) {
        // last resort: clear any solid neighbor of comp 1 (walls around it too)
        outer:
        for (let lz = 0; lz < N; lz++) {
          for (let lx = 0; lx < N; lx++) {
            if (comp[idx(lx, lz)] !== 1) continue;
            if (lx < N - 1 && solid[idx(lx + 1, lz)]) { solid[idx(lx + 1, lz)] = 0; east[idx(lx, lz)] = 0; joined = true; break outer; }
            if (lz < N - 1 && solid[idx(lx, lz + 1)]) { solid[idx(lx, lz + 1)] = 0; south[idx(lx, lz)] = 0; joined = true; break outer; }
            if (lx > 0 && solid[idx(lx - 1, lz)]) { solid[idx(lx - 1, lz)] = 0; east[idx(lx - 1, lz)] = 0; joined = true; break outer; }
            if (lz > 0 && solid[idx(lx, lz - 1)]) { solid[idx(lx, lz - 1)] = 0; south[idx(lx, lz - 1)] = 0; joined = true; break outer; }
          }
        }
      }
      // next pass re-floods from scratch and checks again
    }
  }

  // ============ global queries (world cell coordinates) ============

  _local(cx, cz) {
    const X = Math.floor(cx / CHUNK), Z = Math.floor(cz / CHUNK);
    return [this.layout(X, Z), cx - X * CHUNK, cz - Z * CHUNK];
  }

  isSolid(cx, cz) {
    const [L, lx, lz] = this._local(cx, cz);
    return L.solid[idx(lx, lz)] === 1;
  }

  /** Wall on the +X edge of cell (cx, cz)? Chunk border edges are always open. */
  wallEast(cx, cz) {
    const [L, lx, lz] = this._local(cx, cz);
    if (lx === CHUNK - 1) return false;
    return L.east[idx(lx, lz)] === 1;
  }

  /** Wall on the +Z edge of cell (cx, cz)? */
  wallSouth(cx, cz) {
    const [L, lx, lz] = this._local(cx, cz);
    if (lz === CHUNK - 1) return false;
    return L.south[idx(lx, lz)] === 1;
  }

  /** Can you move from (cx,cz) one cell in dir? 0:+X 1:+Z 2:-X 3:-Z */
  passable(cx, cz, dir) {
    switch (dir) {
      case 0: return !this.wallEast(cx, cz) && !this.isSolid(cx + 1, cz);
      case 1: return !this.wallSouth(cx, cz) && !this.isSolid(cx, cz + 1);
      case 2: return !this.wallEast(cx - 1, cz) && !this.isSolid(cx - 1, cz);
      case 3: return !this.wallSouth(cx, cz - 1) && !this.isSolid(cx, cz - 1);
    }
    return false;
  }

  /**
   * Collect collision AABBs (xz only) near a world position into `out`.
   * Each entry: {x0, z0, x1, z1}.
   */
  collidersNear(x, z, out) {
    out.length = 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const ht = WALL_T / 2;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ccx = cx + dx, ccz = cz + dz;
        if (this.isSolid(ccx, ccz)) {
          out.push({ x0: ccx * CS, z0: ccz * CS, x1: (ccx + 1) * CS, z1: (ccz + 1) * CS });
        }
        if (this.wallEast(ccx, ccz)) {
          const wx = (ccx + 1) * CS;
          out.push({ x0: wx - ht, z0: ccz * CS - ht, x1: wx + ht, z1: (ccz + 1) * CS + ht });
        }
        if (this.wallSouth(ccx, ccz)) {
          const wz = (ccz + 1) * CS;
          out.push({ x0: ccx * CS - ht, z0: wz - ht, x1: (ccx + 1) * CS + ht, z1: wz + ht });
        }
      }
    }
    // pillars (corner posts) from the chunks overlapping the 3x3 cell area
    const X0 = Math.floor((cx - 1) / CHUNK), X1 = Math.floor((cx + 1) / CHUNK);
    const Z0 = Math.floor((cz - 1) / CHUNK), Z1 = Math.floor((cz + 1) / CHUNK);
    const PR = 0.32;
    for (let Zc = Z0; Zc <= Z1; Zc++) {
      for (let Xc = X0; Xc <= X1; Xc++) {
        const L = this.layout(Xc, Zc);
        for (const p of L.pillars) {
          const px = (Xc * CHUNK + p.lx) * CS, pz = (Zc * CHUNK + p.lz) * CS;
          if (Math.abs(px - x) < 6 && Math.abs(pz - z) < 6) {
            out.push({ x0: px - PR, z0: pz - PR, x1: px + PR, z1: pz + PR });
          }
        }
      }
    }
    return out;
  }

  /** Grid DDA line-of-sight test between two world points (xz plane). */
  losClear(ax, az, bx, bz) {
    let cx = Math.floor(ax / CS), cz = Math.floor(az / CS);
    const ex = Math.floor(bx / CS), ez = Math.floor(bz / CS);
    const dx = bx - ax, dz = bz - az;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    let tMaxX = dx !== 0 ? ((cx + (dx > 0 ? 1 : 0)) * CS - ax) / dx : Infinity;
    let tMaxZ = dz !== 0 ? ((cz + (dz > 0 ? 1 : 0)) * CS - az) / dz : Infinity;
    const tDeltaX = dx !== 0 ? Math.abs(CS / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(CS / dz) : Infinity;

    for (let i = 0; i < 80; i++) {
      if (cx === ex && cz === ez) return true;
      if (tMaxX < tMaxZ) {
        if (stepX > 0 ? this.wallEast(cx, cz) : this.wallEast(cx - 1, cz)) return false;
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        if (stepZ > 0 ? this.wallSouth(cx, cz) : this.wallSouth(cx, cz - 1)) return false;
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (this.isSolid(cx, cz)) return false;
      if (tMaxX > 1 && tMaxZ > 1 && (cx === ex && cz === ez)) return true;
    }
    return false;
  }

  /**
   * A* over cells from (sx,sz) to (tx,tz) world cells. Returns array of
   * [cx,cz] including target, or null. Limited search radius keeps it cheap.
   */
  findPath(sx, sz, tx, tz, maxNodes = 600) {
    if (sx === tx && sz === tz) return [];
    const open = [];
    const came = new Map();
    const gScore = new Map();
    const key = (x, z) => x + ',' + z;
    const h = (x, z) => Math.abs(x - tx) + Math.abs(z - tz);
    open.push({ x: sx, z: sz, f: h(sx, sz) });
    gScore.set(key(sx, sz), 0);
    const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
    let visited = 0;

    while (open.length && visited < maxNodes) {
      // smallest f (linear scan is fine at this scale)
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      visited++;
      if (cur.x === tx && cur.z === tz) {
        const path = [];
        let k = key(cur.x, cur.z);
        let node = [cur.x, cur.z];
        while (node) {
          path.push(node);
          node = came.get(k);
          if (node) k = key(node[0], node[1]);
        }
        path.reverse();
        path.shift(); // drop start
        return path;
      }
      const cg = gScore.get(key(cur.x, cur.z));
      for (let d = 0; d < 4; d++) {
        if (!this.passable(cur.x, cur.z, d)) continue;
        const nx = cur.x + DX[d], nz = cur.z + DZ[d];
        const nk = key(nx, nz);
        const ng = cg + 1;
        if (gScore.has(nk) && gScore.get(nk) <= ng) continue;
        gScore.set(nk, ng);
        came.set(nk, [cur.x, cur.z]);
        open.push({ x: nx, z: nz, f: ng + h(nx, nz) });
      }
    }
    return null;
  }

  /** Drop layout cache entries for chunks far from (X,Z) to bound memory. */
  pruneLayouts(X, Z, keepRadius = 6) {
    for (const [k, L] of this.layouts) {
      if (Math.abs(L.X - X) > keepRadius || Math.abs(L.Z - Z) > keepRadius) {
        this.layouts.delete(k);
      }
    }
  }
}
