// Node test for the pure world logic: determinism, connectivity (no sealed
// pockets), pathfinding, LOS. Run with `npm test`.
import { WorldGrid, CHUNK, CS, ANOMALY } from '../src/world/grid.js';

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error('  FAIL:', msg);
  }
}

// ---------- determinism ----------
{
  const a = new WorldGrid(12345);
  const b = new WorldGrid(12345);
  const c = new WorldGrid(54321);
  let identical = true, differs = false;
  for (const [X, Z] of [[0, 0], [3, -2], [-7, 11], [100, -100]]) {
    const la = a.layout(X, Z), lb = b.layout(X, Z), lc = c.layout(X, Z);
    if (Buffer.compare(Buffer.from(la.east), Buffer.from(lb.east)) !== 0) identical = false;
    if (Buffer.compare(Buffer.from(la.south), Buffer.from(lb.south)) !== 0) identical = false;
    if (Buffer.compare(Buffer.from(la.solid), Buffer.from(lb.solid)) !== 0) identical = false;
    if (Buffer.compare(Buffer.from(la.east), Buffer.from(lc.east)) !== 0) differs = true;
  }
  check(identical, 'same seed must produce identical chunks');
  check(differs, 'different seeds must produce different chunks');
  console.log('determinism: ok');
}

// ---------- per-chunk connectivity: every open cell in one component ----------
{
  const g = new WorldGrid(777);
  let bad = 0, chunksTested = 0;
  for (let Z = -8; Z <= 8; Z += 2) {
    for (let X = -8; X <= 8; X += 2) {
      chunksTested++;
      const L = g.layout(X, Z);
      const open = [];
      for (let lz = 0; lz < CHUNK; lz++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          if (!L.solid[lz * CHUNK + lx]) open.push([lx, lz]);
        }
      }
      // intra-chunk flood from first open cell
      const seen = new Set();
      const stack = [open[0]];
      seen.add(open[0][0] + ',' + open[0][1]);
      while (stack.length) {
        const [lx, lz] = stack.pop();
        const gx = X * CHUNK + lx, gz = Z * CHUNK + lz;
        const moves = [
          [1, 0, 0], [0, 1, 1], [-1, 0, 2], [0, -1, 3]
        ];
        for (const [dx, dz, dir] of moves) {
          const nx = lx + dx, nz = lz + dz;
          if (nx < 0 || nz < 0 || nx >= CHUNK || nz >= CHUNK) continue;
          if (!g.passable(gx, gz, dir)) continue;
          const k = nx + ',' + nz;
          if (!seen.has(k)) {
            seen.add(k);
            stack.push([nx, nz]);
          }
        }
      }
      if (seen.size !== open.length) bad++;
      // border cells must never be solid
      for (let i = 0; i < CHUNK; i++) {
        check(!L.solid[i], `border cell solid (top) in ${X},${Z}`);
        check(!L.solid[(CHUNK - 1) * CHUNK + i], `border cell solid (bottom) in ${X},${Z}`);
        check(!L.solid[i * CHUNK], `border cell solid (left) in ${X},${Z}`);
        check(!L.solid[i * CHUNK + CHUNK - 1], `border cell solid (right) in ${X},${Z}`);
      }
    }
  }
  check(bad === 0, `${bad}/${chunksTested} chunks have sealed pockets`);
  console.log(`per-chunk connectivity: ${chunksTested - bad}/${chunksTested} ok`);
}

// ---------- global connectivity across a 5x5 chunk region ----------
{
  const g = new WorldGrid(424242);
  const R = 2; // chunks -R..R
  const lo = -R * CHUNK, hi = (R + 1) * CHUNK - 1;
  let openCount = 0;
  for (let cz = lo; cz <= hi; cz++) {
    for (let cx = lo; cx <= hi; cx++) {
      if (!g.isSolid(cx, cz)) openCount++;
    }
  }
  const seen = new Set();
  const stack = [[lo, lo]];
  check(!g.isSolid(lo, lo), 'corner start cell should be open (border cell)');
  seen.add(lo + ',' + lo);
  const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
  while (stack.length) {
    const [cx, cz] = stack.pop();
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], nz = cz + DZ[d];
      if (nx < lo || nz < lo || nx > hi || nz > hi) continue;
      if (!g.passable(cx, cz, d)) continue;
      const k = nx + ',' + nz;
      if (!seen.has(k)) {
        seen.add(k);
        stack.push([nx, nz]);
      }
    }
  }
  check(seen.size === openCount, `global flood reached ${seen.size}/${openCount} open cells`);
  console.log(`global connectivity (5x5 chunks): ${seen.size}/${openCount} cells reachable`);
}

// ---------- pathfinding between random cells ----------
{
  const g = new WorldGrid(999);
  let okPaths = 0;
  const tries = 60;
  for (let i = 0; i < tries; i++) {
    const sx = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) * 20 | 0;
    const sz = ((Math.sin(i * 78.233) * 12578.1459) % 1 + 1) * 20 | 0;
    const tx = sx + ((i * 7) % 13) - 6, tz = sz + ((i * 11) % 13) - 6;
    if (g.isSolid(sx, sz) || g.isSolid(tx, tz)) { okPaths++; continue; }
    const path = g.findPath(sx, sz, tx, tz, 2000);
    if (path !== null) {
      // validate each step is passable
      let valid = true, cx = sx, cz = sz;
      for (const [nx, nz] of path) {
        const dx = nx - cx, dz = nz - cz;
        const dir = dx === 1 ? 0 : dz === 1 ? 1 : dx === -1 ? 2 : 3;
        if (Math.abs(dx) + Math.abs(dz) !== 1 || !g.passable(cx, cz, dir)) { valid = false; break; }
        cx = nx; cz = nz;
      }
      if (valid && cx === tx && cz === tz) okPaths++;
    }
  }
  check(okPaths === tries, `pathfinding: ${okPaths}/${tries} valid`);
  console.log(`pathfinding: ${okPaths}/${tries} ok`);
}

// ---------- LOS blocked by a known wall ----------
{
  const g = new WorldGrid(31337);
  // find a cell with an east wall and verify LOS through it is blocked
  let tested = false;
  outer:
  for (let cz = 0; cz < 32; cz++) {
    for (let cx = 0; cx < 32; cx++) {
      if (g.wallEast(cx, cz)) {
        const ax = cx * CS + CS / 2, az = cz * CS + CS / 2;
        const bx = (cx + 1) * CS + CS / 2, bz = az;
        check(!g.losClear(ax, az, bx, bz), 'LOS should be blocked by east wall');
        tested = true;
        break outer;
      }
    }
  }
  check(tested, 'found no wall to test LOS against (suspicious)');
  console.log('LOS: ok');
}

// ---------- content stats over many chunks ----------
{
  const g = new WorldGrid(2026);
  let exits = 0, waters = 0, anomalies = 0, total = 0;
  for (let Z = -12; Z <= 12; Z++) {
    for (let X = -12; X <= 12; X++) {
      const L = g.layout(X, Z);
      total++;
      if (L.exit) exits++;
      if (L.water) waters++;
      if (L.anomaly !== ANOMALY.NONE) anomalies++;
      g.layouts.clear(); // keep memory flat
    }
  }
  console.log(`content over ${total} chunks: exits=${exits} waters=${waters} anomalies=${anomalies}`);
  check(exits > 0, 'there must be at least one exit in a 25x25 chunk area');
  check(waters > total * 0.08, 'almond water too rare');
}

if (failures > 0) {
  console.error(`\n${failures} FAILURES`);
  process.exit(1);
}
console.log('\nall world tests passed');
