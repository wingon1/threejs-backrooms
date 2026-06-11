// All textures are generated procedurally on canvas — zero asset files.
import * as THREE from 'three';
import { mulberry32, fbm2 } from '../core/rng.js';

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function grain(ctx, size, rng, amount, alpha) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n * alpha;
  }
  ctx.putImageData(img, 0, 0);
}

function toTexture(canvas, repeat = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.repeat.set(repeat, repeat);
  return tex;
}

/** The infamous mono-yellow wallpaper: stripes, mottling, stains, seams, base grime. */
export function makeWallpaperTexture(seed) {
  const S = 512;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const rng = mulberry32(seed);

  // base — dirty off-white, plain (no stripe pattern)
  ctx.fillStyle = '#d6d2c8';
  ctx.fillRect(0, 0, S, S);

  // mottling via fbm (neutral, keeps the grime)
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm2(seed, x / 90, y / 90, 4);
      const m = (n - 0.5) * 42;
      const i = (y * S + x) * 4;
      d[i] += m;
      d[i + 1] += m * 0.98;
      d[i + 2] += m * 0.92;
    }
  }
  ctx.putImageData(img, 0, 0);

  // stains — irregular brown blotches
  const stains = 4 + (rng() * 5 | 0);
  for (let i = 0; i < stains; i++) {
    const x = rng() * S, y = rng() * S, r = 24 + rng() * 90;
    const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
    const a = 0.05 + rng() * 0.16;
    g.addColorStop(0, `rgba(70, 52, 18, ${a})`);
    g.addColorStop(0.7, `rgba(60, 45, 14, ${a * 0.5})`);
    g.addColorStop(1, 'rgba(60, 45, 14, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (0.7 + rng() * 0.6), r, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // drip streaks
  for (let i = 0; i < 6; i++) {
    const x = rng() * S, y0 = rng() * S * 0.5, len = 40 + rng() * 140;
    const g = ctx.createLinearGradient(x, y0, x, y0 + len);
    g.addColorStop(0, `rgba(74, 58, 20, ${0.08 + rng() * 0.1})`);
    g.addColorStop(1, 'rgba(74, 58, 20, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 1.5, y0, 3 + rng() * 3, len);
  }

  // wallpaper seams every 128px
  for (let x = 0; x <= S; x += 128) {
    ctx.fillStyle = 'rgba(60, 55, 45, 0.20)';
    ctx.fillRect(x - 1, 0, 2, S);
    ctx.fillStyle = 'rgba(245, 243, 235, 0.10)';
    ctx.fillRect(x + 1, 0, 1, S);
  }

  // grime gradient at the bottom (wall base)
  const g = ctx.createLinearGradient(0, S * 0.78, 0, S);
  g.addColorStop(0, 'rgba(30, 26, 18, 0)');
  g.addColorStop(1, 'rgba(26, 22, 15, 0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, S * 0.78, S, S * 0.22);

  grain(ctx, S, rng, 22, 0.5);
  return toTexture(c);
}

/** Damp office carpet: speckle, fiber direction, moisture blotches. */
export function makeCarpetTexture(seed) {
  const S = 512;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const rng = mulberry32(seed ^ 0x51ab);

  ctx.fillStyle = '#504f4b';
  ctx.fillRect(0, 0, S, S);

  // dense speckle
  for (let i = 0; i < 22000; i++) {
    const x = rng() * S, y = rng() * S;
    const v = rng();
    ctx.fillStyle = v > 0.66
      ? `rgba(${104 + rng() * 36 | 0}, ${102 + rng() * 34 | 0}, ${94 + rng() * 30 | 0}, 0.5)`
      : `rgba(${26 + rng() * 22 | 0}, ${25 + rng() * 21 | 0}, ${22 + rng() * 18 | 0}, 0.45)`;
    ctx.fillRect(x, y, 1 + rng(), 1 + rng());
  }

  // fiber streaks
  ctx.globalAlpha = 0.07;
  for (let i = 0; i < 240; i++) {
    const x = rng() * S, y = rng() * S;
    ctx.strokeStyle = rng() > 0.5 ? '#6f6e68' : '#312f2b';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 24, y + (rng() - 0.5) * 6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // moisture blotches — the damp
  for (let i = 0; i < 7; i++) {
    const x = rng() * S, y = rng() * S, r = 30 + rng() * 110;
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    const a = 0.10 + rng() * 0.22;
    g.addColorStop(0, `rgba(15, 15, 13, ${a})`);
    g.addColorStop(0.75, `rgba(17, 17, 15, ${a * 0.45})`);
    g.addColorStop(1, 'rgba(17, 17, 15, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rng() * 0.6), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  grain(ctx, S, rng, 18, 0.4);
  return toTexture(c);
}

/** Drop-ceiling tiles with discoloration and grid lines. */
export function makeCeilingTexture(seed) {
  const S = 512;
  const TILE = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const rng = mulberry32(seed ^ 0xcafe);

  ctx.fillStyle = '#8b8a84';
  ctx.fillRect(0, 0, S, S);

  // per-tile discoloration + pinhole texture
  for (let ty = 0; ty < S; ty += TILE) {
    for (let tx = 0; tx < S; tx += TILE) {
      const tint = (rng() - 0.5) * 26;
      ctx.fillStyle = `rgba(${142 + tint | 0}, ${141 + tint | 0}, ${135 + tint * 0.85 | 0}, 0.35)`;
      ctx.fillRect(tx, ty, TILE, TILE);
      // water stain on some tiles (faint brown — old leak damage)
      if (rng() < 0.3) {
        const x = tx + rng() * TILE, y = ty + rng() * TILE, r = 14 + rng() * 46;
        const g = ctx.createRadialGradient(x, y, 2, x, y, r);
        const a = 0.1 + rng() * 0.22;
        g.addColorStop(0, `rgba(82, 73, 56, ${a})`);
        g.addColorStop(0.8, `rgba(94, 85, 66, ${a * 0.5})`);
        g.addColorStop(1, 'rgba(94, 85, 66, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(tx, ty, TILE, TILE);
      }
      // pinholes
      ctx.fillStyle = 'rgba(52, 51, 46, 0.5)';
      for (let i = 0; i < 70; i++) {
        ctx.fillRect(tx + rng() * TILE, ty + rng() * TILE, 1, 1);
      }
    }
  }

  // grid lines (T-bar)
  for (let p = 0; p <= S; p += TILE) {
    ctx.fillStyle = 'rgba(44, 43, 39, 0.85)';
    ctx.fillRect(p - 2, 0, 4, S);
    ctx.fillRect(0, p - 2, S, 4);
    ctx.fillStyle = 'rgba(166, 165, 158, 0.4)';
    ctx.fillRect(p + 2, 0, 1, S);
    ctx.fillRect(0, p + 2, S, 1);
  }

  grain(ctx, S, rng, 14, 0.4);
  return toTexture(c);
}

/** Fluorescent fixture panel (emissive map): bright diffuser with tube hotspots. */
export function makeFixtureTexture() {
  const S = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#d7d2b8';
  ctx.fillRect(0, 0, S, S);

  // two tube hotspots
  for (const fy of [0.32, 0.68]) {
    const g = ctx.createLinearGradient(0, S * (fy - 0.13), 0, S * (fy + 0.13));
    g.addColorStop(0, 'rgba(255, 252, 230, 0)');
    g.addColorStop(0.5, 'rgba(255, 254, 240, 0.95)');
    g.addColorStop(1, 'rgba(255, 252, 230, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(4, S * (fy - 0.13), S - 8, S * 0.26);
  }

  // diffuser prismatic grid
  ctx.strokeStyle = 'rgba(120, 116, 90, 0.25)';
  for (let p = 0; p < S; p += 8) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }
  // frame
  ctx.strokeStyle = 'rgba(70, 64, 40, 0.9)';
  ctx.lineWidth = 5;
  ctx.strokeRect(2, 2, S - 4, S - 4);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The face. Drawn once, reused for the jumpscare overlay.
 * Implied horror: elongated pale smear with hollow eyes, heavy noise.
 */
export function drawScareFace(ctx, t = 0) {
  const S = 512;
  const rng = mulberry32(0xdead ^ (t * 1000 | 0));

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);

  const cx = S / 2 + (rng() - 0.5) * 14;
  const cy = S / 2 + (rng() - 0.5) * 14;

  // pale elongated head
  const hg = ctx.createRadialGradient(cx, cy - 30, 20, cx, cy, 240);
  hg.addColorStop(0, 'rgba(214, 200, 168, 0.92)');
  hg.addColorStop(0.45, 'rgba(160, 146, 116, 0.55)');
  hg.addColorStop(1, 'rgba(20, 16, 8, 0)');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 130, 215, 0, 0, Math.PI * 2);
  ctx.fill();

  // hollow eyes — uneven
  for (const [ex, ey, r] of [[cx - 52, cy - 58, 34], [cx + 48, cy - 64, 40]]) {
    const eg = ctx.createRadialGradient(ex, ey, 2, ex, ey, r);
    eg.addColorStop(0, 'rgba(0, 0, 0, 1)');
    eg.addColorStop(0.7, 'rgba(0, 0, 0, 0.95)');
    eg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.ellipse(ex + (rng() - 0.5) * 8, ey + (rng() - 0.5) * 8, r, r * 1.5, (rng() - 0.5) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // pin-prick glints deep in the sockets
  ctx.fillStyle = 'rgba(255, 244, 200, 0.85)';
  ctx.fillRect(cx - 54, cy - 52, 2, 2);
  ctx.fillRect(cx + 50, cy - 58, 2, 2);

  // gaping vertical mouth
  const mg = ctx.createRadialGradient(cx, cy + 92, 4, cx, cy + 92, 86);
  mg.addColorStop(0, 'rgba(0, 0, 0, 1)');
  mg.addColorStop(0.8, 'rgba(5, 2, 0, 0.9)');
  mg.addColorStop(1, 'rgba(5, 2, 0, 0)');
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.ellipse(cx + (rng() - 0.5) * 6, cy + 96, 38 + rng() * 10, 88, 0, 0, Math.PI * 2);
  ctx.fill();

  // smear streaks — like the image is being dragged
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 30; i++) {
    const y = rng() * S;
    const dx = (rng() - 0.5) * 70;
    ctx.drawImage(ctx.canvas, 0, y, S, 3, dx, y, S, 3);
  }
  ctx.globalAlpha = 1;

  // hard noise
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 70;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** Pre-built texture set used by the world. Variants prevent obvious tiling chunk to chunk. */
export function buildTextureSet(worldSeed) {
  const wallpapers = [], carpets = [], ceilings = [];
  for (let i = 0; i < 3; i++) {
    wallpapers.push(makeWallpaperTexture(worldSeed + i * 7919));
    carpets.push(makeCarpetTexture(worldSeed + i * 104729));
    ceilings.push(makeCeilingTexture(worldSeed + i * 1299709));
  }
  return { wallpapers, carpets, ceilings, fixture: makeFixtureTexture() };
}
