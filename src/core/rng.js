// Deterministic hashing / RNG / noise utilities.
// Everything in the world derives from these + a single world seed.

export function hash2(seed, x, y) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hash3(seed, x, y, z) {
  return hash2(hash2(seed, x, y), z | 0, 0x5bd1e995);
}

/** Uniform [0,1) from integer coords. */
export function rand2(seed, x, y) {
  return hash2(seed, x, y) / 4294967296;
}

export function rand3(seed, x, y, z) {
  return hash3(seed, x, y, z) / 4294967296;
}

/** Fast seeded PRNG stream. */
export function mulberry32(a) {
  a |= 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise, ~[0,1]. */
export function valueNoise2(seed, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = rand2(seed, xi, yi);
  const b = rand2(seed, xi + 1, yi);
  const c = rand2(seed, xi, yi + 1);
  const d = rand2(seed, xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise, ~[0,1]. */
export function fbm2(seed, x, y, octaves = 4) {
  let total = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise2(seed + i * 1013, x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / norm;
}

/** Cheap 1D noise for flicker timing etc. ~[0,1]. */
export function noise1(seed, t) {
  const ti = Math.floor(t);
  const tf = smooth(t - ti);
  const a = rand2(seed, ti, 0);
  const b = rand2(seed, ti + 1, 0);
  return a + (b - a) * tf;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
