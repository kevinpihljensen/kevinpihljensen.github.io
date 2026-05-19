// textures.js — procedural textures via 2D canvas, wrapped as THREE.CanvasTexture.
//
// No external assets required (project rule). All textures generated at
// import time. Most use a 512x512 canvas which gives crisp detail at the
// distances the player will see surfaces from. Repeat is set in kit.js at
// the point of use (since repeat depends on the surface dimensions).
//
// S55: realism pass. Multi-octave value noise + targeted stain layers,
// authored brick + wood + concrete patterns. Replaces the flat-color
// industrial palette with material-y surfaces:
//   * makeFloorTexture     — weathered concrete floor (4×4 panels, hairline
//                             cracks, oil + dirt stains, grout grooves)
//   * makeBrickTexture     — running-bond brick (random per-brick tint, deep
//                             mortar grooves, weathering streaks)
//   * makeWoodTexture      — vertical planks with grain + knots
//   * makeConcreteTexture  — smooth poured concrete (decks, ramps)
//   * makeMetalTexture     — stair/ramp brushed steel
//   * makeWallTexture / makeInteriorWallTexture / makeCoverTexture /
//     makePillarTexture     — legacy entry points, kept for compatibility

import * as THREE from 'three';

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

// --- NOISE HELPERS ---
// Cheap 2D value noise built on a hashed integer grid + bilinear interp.
// Deterministic per (ix, iy, seed) so a single texture is reproducible.
function hash2(ix, iy, seed) {
  // 32-bit-ish mix; we only use the low 24 bits (Math.imul mixes well enough).
  let h = (ix * 374761393 + iy * 668265263 + seed * 982451653) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000) / 1000;            // [0, 1)
}
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }
function noise2D(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash2(ix,     iy,     seed);
  const b = hash2(ix + 1, iy,     seed);
  const c = hash2(ix,     iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}
// Multi-octave (fBm) noise — large features + medium + small detail.
function fbm(x, y, octaves, seed) {
  let sum = 0, amp = 1, total = 0, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise2D(x * freq, y * freq, seed + i * 17) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}

// Tint a [0..255] grey by an (r,g,b) shade. Used to add subtle color cast to
// otherwise-grey noise (warm concrete, cool steel etc.).
function tinted(grey, rTint, gTint, bTint) {
  return [
    Math.max(0, Math.min(255, grey * rTint)),
    Math.max(0, Math.min(255, grey * gTint)),
    Math.max(0, Math.min(255, grey * bTint)),
  ];
}

// Splotchy stain — paints semi-transparent dark blobs to break up flat color.
// Kept for legacy textures; the new ones use noise-driven shading directly.
function addStains(ctx, w, h, count, maxR, color) {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = (0.3 + Math.random() * 0.7) * maxR;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

function drawBolt(ctx, x, y, r) {
  ctx.fillStyle = '#1d1f23';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a3e44';
  ctx.beginPath(); ctx.arc(x, y, r - 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#171a1d';
  ctx.fillRect(x - 1, y - r + 1, 2, r * 2 - 2);
}

// Common finalize: wrap, mipmap-friendly filtering, anisotropy.
function finalize(canvas, repeatable = true) {
  const tex = new THREE.CanvasTexture(canvas);
  if (repeatable) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 8;
  return tex;
}

// --- FLOOR (concrete floor, 4×4 panels) -----------------------------------
// Realism: warm-grey base, multi-octave shading via fbm, oil stains, hairline
// cracks, mortar grooves between panels.
export function makeFloorTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(N, N);
  const d = id.data;
  // Multi-octave concrete shading. Tint slightly warm.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(x / 48, y / 48, 5, 7);    // 0..1
      const base = 70 + n * 60;                // 70..130
      const [r, g, b] = tinted(base, 1.04, 1.00, 0.95);
      const i = (y * N + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  // Oil stains (irregular dark blobs via noise-shaped fade).
  for (let s = 0; s < 5; s++) {
    const sx = Math.random() * N, sy = Math.random() * N;
    const sr = 30 + Math.random() * 60;
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    grad.addColorStop(0, 'rgba(18,16,12,0.55)');
    grad.addColorStop(0.6, 'rgba(28,24,20,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }
  // Hairline cracks — short randomly-walked dark lines.
  ctx.strokeStyle = 'rgba(18,18,22,0.55)';
  ctx.lineWidth = 1;
  for (let k = 0; k < 14; k++) {
    let x = Math.random() * N, y = Math.random() * N;
    const len = 30 + Math.random() * 80;
    let ang = Math.random() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < len; s += 4) {
      ang += (Math.random() - 0.5) * 0.6;
      x += Math.cos(ang) * 4;
      y += Math.sin(ang) * 4;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Mortar/panel grooves — 4 panels each direction.
  ctx.strokeStyle = 'rgba(20,20,24,0.85)';
  ctx.lineWidth = 3;
  const step = N / 4;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0); ctx.lineTo(i * step, N); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step); ctx.lineTo(N, i * step); ctx.stroke();
  }
  // Highlight along the panel-groove tops (faint lighter pixel) for depth.
  ctx.strokeStyle = 'rgba(180,180,190,0.10)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step + 2, 0); ctx.lineTo(i * step + 2, N); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step + 2); ctx.lineTo(N, i * step + 2); ctx.stroke();
  }
  return finalize(c);
}

// --- BRICK (running-bond, mortar grooves, per-brick color variation) ------
export function makeBrickTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  // Mortar base.
  ctx.fillStyle = '#3c382f';
  ctx.fillRect(0, 0, N, N);
  // Multi-octave noise overlay for mortar grit.
  const id = ctx.getImageData(0, 0, N, N);
  const d = id.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(x / 22, y / 22, 4, 19) * 0.5 + 0.25;
      const i = (y * N + x) * 4;
      d[i]     = d[i]     * (0.6 + n * 0.4);
      d[i + 1] = d[i + 1] * (0.6 + n * 0.4);
      d[i + 2] = d[i + 2] * (0.6 + n * 0.4);
    }
  }
  ctx.putImageData(id, 0, 0);
  // Brick courses. 8 courses, each 64 px tall, brick width 96 px, mortar gap 4 px.
  const ROWS = 8;
  const ROW_H = N / ROWS;
  const BR_W = 96, GAP = 4;
  for (let row = 0; row < ROWS; row++) {
    const offset = (row % 2 === 0) ? 0 : BR_W / 2;
    for (let bx = -BR_W; bx < N + BR_W; bx += BR_W) {
      const x0 = bx + offset + GAP / 2;
      const x1 = x0 + BR_W - GAP;
      const y0 = row * ROW_H + GAP / 2;
      const y1 = (row + 1) * ROW_H - GAP / 2;
      // Per-brick base color: varies in red/brown range.
      const tint = 0.78 + Math.random() * 0.36;
      const r = Math.floor(124 * tint);
      const g = Math.floor(58 * tint);
      const b = Math.floor(38 * tint);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      const x = Math.max(0, x0), w = Math.min(N, x1) - x;
      if (w <= 0) continue;
      ctx.fillRect(x, y0, w, y1 - y0);
      // Per-brick noise overlay (tiny stipple via random dots).
      ctx.fillStyle = 'rgba(40,28,20,0.18)';
      for (let k = 0; k < 12; k++) {
        const px = x + Math.random() * w;
        const py = y0 + Math.random() * (y1 - y0);
        ctx.fillRect(px, py, 1, 1);
      }
      // Subtle highlight along the brick's top edge for 3D-ish read.
      ctx.fillStyle = 'rgba(230,210,190,0.18)';
      ctx.fillRect(x, y0, w, 1);
      // Shadow along the bottom edge.
      ctx.fillStyle = 'rgba(20,12,8,0.40)';
      ctx.fillRect(x, y1 - 1, w, 1);
    }
  }
  // A few darker weathering streaks running down the wall.
  for (let s = 0; s < 4; s++) {
    const sx = Math.random() * N;
    const sw = 2 + Math.random() * 4;
    ctx.fillStyle = `rgba(20,15,10,${0.12 + Math.random() * 0.10})`;
    ctx.fillRect(sx, 0, sw, N);
  }
  return finalize(c);
}

// --- WOOD (vertical planks with grain + knots) ---------------------------
export function makeWoodTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  // 6 planks vertically.
  const PLANKS = 6, PW = N / PLANKS;
  for (let p = 0; p < PLANKS; p++) {
    const baseTint = 0.85 + Math.random() * 0.30;
    const x0 = p * PW, x1 = (p + 1) * PW - 2;
    // Plank base color (warm brown).
    ctx.fillStyle = `rgb(${Math.floor(110 * baseTint)},${Math.floor(70 * baseTint)},${Math.floor(38 * baseTint)})`;
    ctx.fillRect(x0, 0, x1 - x0, N);
    // Grain stripes — multiple slightly darker vertical stripes with noise.
    for (let gx = x0 + 2; gx < x1; gx += 3) {
      const a = 0.10 + Math.random() * 0.15;
      ctx.fillStyle = `rgba(50,30,15,${a.toFixed(2)})`;
      // sinusoidal-ish drift in x
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      for (let y = 0; y < N; y += 8) {
        const drift = Math.sin((y / N) * Math.PI * 3 + p) * 1.5;
        ctx.lineTo(gx + drift, y);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(50,30,15,${a.toFixed(2)})`;
      ctx.stroke();
    }
    // A knot every ~2 planks.
    if (Math.random() < 0.5) {
      const kx = x0 + PW * 0.5, ky = Math.random() * N;
      const kr = 6 + Math.random() * 8;
      const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
      g.addColorStop(0, '#26170a');
      g.addColorStop(0.6, 'rgba(40,24,12,0.8)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(kx - kr, ky - kr, kr * 2, kr * 2);
    }
    // Plank shadow strip on the right edge.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x1, 0, 2, N);
  }
  return finalize(c);
}

// --- POURED CONCRETE (smooth deck / ramp surface) -------------------------
export function makeConcreteTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(N, N);
  const d = id.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(x / 38, y / 38, 5, 31);   // 0..1
      const fine = fbm(x / 6, y / 6, 3, 47) * 0.25;
      const base = 95 + (n + fine) * 35;
      const i = (y * N + x) * 4;
      const [r, g, b] = tinted(base, 1.00, 1.00, 1.03);
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  // A few wide stains for water marks.
  for (let s = 0; s < 6; s++) {
    const sx = Math.random() * N, sy = Math.random() * N;
    const sr = 40 + Math.random() * 80;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    g.addColorStop(0, 'rgba(60,60,68,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }
  // Faint expansion-joint line (one per axis).
  ctx.strokeStyle = 'rgba(40,40,44,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(N / 2, 0); ctx.lineTo(N / 2, N); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, N / 2); ctx.lineTo(N, N / 2); ctx.stroke();
  return finalize(c);
}

// --- BRUSHED METAL (stairs / metal ramps) ---------------------------------
export function makeMetalTexture() {
  const N = 256;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  // Cool blue-grey base.
  ctx.fillStyle = '#4a5058';
  ctx.fillRect(0, 0, N, N);
  // Horizontal brush stripes.
  for (let y = 0; y < N; y++) {
    const v = Math.floor(40 + Math.random() * 80);
    const alpha = 0.05 + Math.random() * 0.18;
    ctx.fillStyle = `rgba(${v},${v + 4},${v + 10},${alpha.toFixed(2)})`;
    ctx.fillRect(0, y, N, 1);
  }
  // Diagonal scratches.
  for (let k = 0; k < 24; k++) {
    const sx = Math.random() * N, sy = Math.random() * N;
    const len = 6 + Math.random() * 28;
    const ang = (Math.random() - 0.5) * 0.4;
    ctx.strokeStyle = 'rgba(180,190,200,0.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
    ctx.stroke();
  }
  // Tread-plate style perforations (subtle dot grid).
  for (let y = 8; y < N; y += 16) {
    for (let x = 8 + (y / 16 % 2 === 0 ? 0 : 8); x < N; x += 16) {
      ctx.fillStyle = 'rgba(30,32,36,0.55)';
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(200,205,212,0.18)';
      ctx.beginPath(); ctx.arc(x - 0.5, y - 0.5, 1, 0, Math.PI * 2); ctx.fill();
    }
  }
  return finalize(c);
}

// =============================================================================
// THEMED TEXTURES (S55g — RIDGEPOINT CITADEL redesign).
//
// Five additional procedural textures, each tied to a zone of the map:
//   makeSlateStoneTexture  — large hewn dark slate blocks. Wraps the CITADEL.
//   makeIronPlateTexture   — riveted iron plating with rust streaks. FOUNDRY.
//   makeMarbleSlabTexture  — polished cream marble with veining. HILLTOP deck.
//   makeSandstoneTexture   — warm porous sandstone. COLONNADE + WEST_RAMPART.
//   makeRuneSlabTexture    — dark stone with glowing chiseled rune accents.
//                            For signpost slabs at key landmarks.
//
// Each texture is generated at import time onto a 512×512 (or 256×256) canvas.
// Repeat is set in kit.js depending on the surface size. All are seamless via
// RepeatWrapping.
// =============================================================================

// --- SLATE STONE (citadel keep) -------------------------------------------
// Large hewn dark slate blocks. Cool grey with a faint blue cast, deep mortar
// grooves wider than the brick texture, sharp bevel highlights. Reads as
// "fortress masonry" at any distance. 4 courses of ~128 px wide blocks with
// horizontal-running-bond offset every other row.
export function makeSlateStoneTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  // Mortar base (deep slate-shadow).
  ctx.fillStyle = '#1c1f24';
  ctx.fillRect(0, 0, N, N);
  // Block layout: 4 rows × variable column. Tall blocks (128 high).
  const ROWS = 4;
  const ROW_H = N / ROWS;
  const BLK_W = 132, GAP = 6;
  for (let row = 0; row < ROWS; row++) {
    const offset = (row % 2 === 0) ? 0 : BLK_W / 2;
    for (let bx = -BLK_W; bx < N + BLK_W; bx += BLK_W) {
      const x0 = bx + offset + GAP / 2;
      const x1 = x0 + BLK_W - GAP;
      const y0 = row * ROW_H + GAP / 2;
      const y1 = (row + 1) * ROW_H - GAP / 2;
      const x = Math.max(0, x0), w = Math.min(N, x1) - x;
      if (w <= 0) continue;
      const h = y1 - y0;
      // Per-block tint variance (slate-grey with faint blue).
      const tint = 0.88 + Math.random() * 0.30;
      const r = Math.floor(74 * tint);
      const g = Math.floor(80 * tint);
      const b = Math.floor(92 * tint);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y0, w, h);
      // Noise texture on the block face.
      for (let py = y0; py < y1; py += 2) {
        for (let px = x; px < x + w; px += 2) {
          const n = fbm((px - x0) / 18, (py - y0) / 18, 4, row * 73 + bx * 11) - 0.5;
          const a = Math.abs(n) * 0.35;
          ctx.fillStyle = n < 0 ? `rgba(20,22,26,${a.toFixed(2)})` : `rgba(170,176,188,${a.toFixed(2)})`;
          ctx.fillRect(px, py, 2, 2);
        }
      }
      // Hewn-edge bevel highlight (top + left).
      ctx.fillStyle = 'rgba(200,210,225,0.20)';
      ctx.fillRect(x, y0, w, 1);
      ctx.fillRect(x, y0, 1, h);
      // Shadow (bottom + right).
      ctx.fillStyle = 'rgba(8,10,14,0.55)';
      ctx.fillRect(x, y1 - 1, w, 1);
      ctx.fillRect(x + w - 1, y0, 1, h);
      // Occasional deep crack streak on a block face.
      if (Math.random() < 0.30) {
        ctx.strokeStyle = 'rgba(10,12,16,0.55)';
        ctx.lineWidth = 1;
        const cx0 = x + 6 + Math.random() * (w - 12);
        let cy0 = y0 + 4, cy1 = y1 - 4;
        ctx.beginPath();
        ctx.moveTo(cx0, cy0);
        const segs = 6;
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const cy = cy0 + (cy1 - cy0) * t;
          const dx = (Math.random() - 0.5) * 6;
          ctx.lineTo(cx0 + dx, cy);
        }
        ctx.stroke();
      }
    }
  }
  // Vertical weathering streaks running down the courses.
  for (let s = 0; s < 5; s++) {
    const sx = Math.random() * N;
    const sw = 2 + Math.random() * 5;
    ctx.fillStyle = `rgba(8,10,14,${(0.10 + Math.random() * 0.12).toFixed(2)})`;
    ctx.fillRect(sx, 0, sw, N);
  }
  return finalize(c);
}

// --- IRON PLATE (foundry) -------------------------------------------------
// Riveted iron plating with rust streaks. Two-tone — cool steel base with
// warm rust bleeds beneath each rivet. 4×4 plate grid with bold rivet rows.
export function makeIronPlateTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  // Steel base — warm-grey with noise.
  const id = ctx.createImageData(N, N);
  const d = id.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(x / 32, y / 32, 5, 41);
      const fine = fbm(x / 5, y / 5, 3, 53) * 0.18;
      const base = 96 + (n + fine) * 50;
      const [r, g, b] = tinted(base, 1.02, 0.98, 0.94);
      const i = (y * N + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  // Plate seams: 4×4 plate grid.
  const PLATES = 4;
  const PS = N / PLATES;
  ctx.strokeStyle = 'rgba(18,20,24,0.85)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= PLATES; i++) {
    ctx.beginPath(); ctx.moveTo(i * PS, 0); ctx.lineTo(i * PS, N); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * PS); ctx.lineTo(N, i * PS); ctx.stroke();
  }
  // Highlight along the seams.
  ctx.strokeStyle = 'rgba(190,200,210,0.18)';
  ctx.lineWidth = 1;
  for (let i = 1; i < PLATES; i++) {
    ctx.beginPath(); ctx.moveTo(i * PS + 2, 0); ctx.lineTo(i * PS + 2, N); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * PS + 2); ctx.lineTo(N, i * PS + 2); ctx.stroke();
  }
  // Rivets along the seams (every 32 px).
  for (let i = 0; i <= PLATES; i++) {
    for (let p = 16; p < N; p += 32) {
      drawBolt(ctx, i * PS, p, 4);
      drawBolt(ctx, p, i * PS, 4);
    }
  }
  // Rust streaks bleeding from random rivets.
  for (let r = 0; r < 10; r++) {
    const rx = Math.random() * N;
    const ry = Math.random() * N;
    const grad = ctx.createLinearGradient(rx, ry, rx + (Math.random() - 0.5) * 18, ry + 30 + Math.random() * 60);
    grad.addColorStop(0, 'rgba(120,55,28,0.55)');
    grad.addColorStop(0.5, 'rgba(90,40,20,0.30)');
    grad.addColorStop(1, 'rgba(60,30,18,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(rx, ry + 35, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(rx - 4, ry, 8, 60);
  }
  // A faint oily sheen blob or two for variety.
  for (let s = 0; s < 2; s++) {
    const sx = Math.random() * N, sy = Math.random() * N;
    const sr = 50 + Math.random() * 60;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    g.addColorStop(0, 'rgba(90,80,70,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }
  return finalize(c);
}

// --- MARBLE SLAB (HILLTOP "sacred" perch) ---------------------------------
// Polished cream marble with subtle veining and tiled seams. The most ornate
// surface — reserved for the HILLTOP top deck where the sniper lives.
export function makeMarbleSlabTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  // Cream base with smooth fbm shading.
  const id = ctx.createImageData(N, N);
  const d = id.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(x / 64, y / 64, 5, 19);
      const base = 200 + n * 36;
      const [r, g, b] = tinted(base, 1.02, 1.00, 0.94);
      const i = (y * N + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  // Veining — thin meandering dark lines.
  ctx.strokeStyle = 'rgba(110,100,90,0.50)';
  ctx.lineWidth = 1.4;
  for (let v = 0; v < 8; v++) {
    let x = Math.random() * N, y = Math.random() * N;
    const len = 100 + Math.random() * 220;
    let ang = Math.random() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < len; s += 6) {
      ang += (Math.random() - 0.5) * 0.35;
      x += Math.cos(ang) * 6;
      y += Math.sin(ang) * 6;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Secondary thinner veining.
  ctx.strokeStyle = 'rgba(150,140,128,0.30)';
  ctx.lineWidth = 0.6;
  for (let v = 0; v < 14; v++) {
    let x = Math.random() * N, y = Math.random() * N;
    const len = 40 + Math.random() * 120;
    let ang = Math.random() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < len; s += 4) {
      ang += (Math.random() - 0.5) * 0.4;
      x += Math.cos(ang) * 4;
      y += Math.sin(ang) * 4;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Tile seams — 4×4 grid, thin lines.
  ctx.strokeStyle = 'rgba(90,82,70,0.55)';
  ctx.lineWidth = 2;
  const tile = N / 4;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * tile, 0); ctx.lineTo(i * tile, N); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * tile); ctx.lineTo(N, i * tile); ctx.stroke();
  }
  // Tile highlight just under the seam — gives a soft polished edge.
  ctx.strokeStyle = 'rgba(255,250,240,0.20)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * tile + 1.5, 0); ctx.lineTo(i * tile + 1.5, N); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * tile + 1.5); ctx.lineTo(N, i * tile + 1.5); ctx.stroke();
  }
  return finalize(c);
}

// --- SANDSTONE (colonnade columns + west rampart) -------------------------
// Warm porous sandstone. Distinctly different palette from the cool slate —
// reads as the "old / weathered" zone of the map. Subtle horizontal banding
// from sediment layers.
export function makeSandstoneTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(N, N);
  const d = id.data;
  for (let y = 0; y < N; y++) {
    // Horizontal layered noise for sediment bands.
    const bandN = fbm(0, y / 22, 4, 67);
    for (let x = 0; x < N; x++) {
      const n = fbm(x / 36, y / 36, 5, 67);
      const fine = fbm(x / 4, y / 4, 3, 89) * 0.22;
      const layer = bandN * 0.25;
      const base = 156 + (n + fine + layer) * 40;
      const [r, g, b] = tinted(base, 1.10, 0.94, 0.78);
      const i = (y * N + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  // Subtle horizontal sediment-line emphasis every ~64 px.
  for (let y = 32; y < N; y += 64) {
    const dy = y + (Math.random() - 0.5) * 8;
    ctx.strokeStyle = `rgba(80,55,30,${(0.10 + Math.random() * 0.10).toFixed(2)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let cx2 = 0, cy = dy;
    ctx.moveTo(cx2, cy);
    for (cx2 = 0; cx2 < N; cx2 += 12) {
      cy = dy + (Math.random() - 0.5) * 2;
      ctx.lineTo(cx2, cy);
    }
    ctx.stroke();
  }
  // A few faint stain blobs.
  for (let s = 0; s < 5; s++) {
    const sx = Math.random() * N, sy = Math.random() * N;
    const sr = 35 + Math.random() * 60;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    g.addColorStop(0, 'rgba(70,45,20,0.30)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }
  // Pock marks (carved-out spots that read as weathering).
  for (let p = 0; p < 16; p++) {
    const px = Math.random() * N, py = Math.random() * N;
    const pr = 2 + Math.random() * 4;
    ctx.fillStyle = 'rgba(40,28,12,0.45)';
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(220,200,170,0.18)';
    ctx.beginPath(); ctx.arc(px - 0.5, py - 0.5, pr * 0.5, 0, Math.PI * 2); ctx.fill();
  }
  return finalize(c);
}

// --- RUNE SLAB (signpost accent) ------------------------------------------
// Dark stone with glowing chiseled rune markings. The "emissive accent"
// surface — used at landmark approaches (citadel doorways, sniper perch).
// Built atop the slate base with a bright amber rune pattern carved into
// it. The MeshStandardMaterial that uses this should ALSO set emissiveMap.
export function makeRuneSlabTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  // Slate base.
  ctx.fillStyle = '#22252b';
  ctx.fillRect(0, 0, N, N);
  // Noise overlay.
  const id = ctx.getImageData(0, 0, N, N);
  const d = id.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(x / 26, y / 26, 4, 113);
      const v = 32 + n * 40;
      const i = (y * N + x) * 4;
      d[i]     = d[i]     + v * 0.6;
      d[i + 1] = d[i + 1] + v * 0.6;
      d[i + 2] = d[i + 2] + v * 0.7;
    }
  }
  ctx.putImageData(id, 0, 0);
  // Rune marks — Norse-runic-inspired straight-stroke glyphs in a vertical
  // column down the middle of the tile. Each rune is built from 2-4 strokes.
  const cx = N / 2;
  const runeXJitter = 18;
  const glyphCount = 4;
  const glyphH = N / (glyphCount + 1);
  for (let g = 0; g < glyphCount; g++) {
    const gy = (g + 0.5) * glyphH + glyphH * 0.5;
    const sx = cx + (Math.random() - 0.5) * runeXJitter;
    const strokes = 2 + Math.floor(Math.random() * 3);
    for (let st = 0; st < strokes; st++) {
      const a0 = Math.random() * Math.PI * 2;
      const a1 = a0 + (Math.random() > 0.5 ? Math.PI : Math.PI * 0.6);
      const len = 22 + Math.random() * 18;
      const x0 = sx + Math.cos(a0) * len;
      const y0 = gy + Math.sin(a0) * len;
      const x1 = sx + Math.cos(a1) * len;
      const y1 = gy + Math.sin(a1) * len;
      ctx.strokeStyle = '#ffb944';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = '#fff2c0';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }
  return finalize(c);
}

// --- PORTAL (teleporter glyph) ----------------------------------------------
// Magenta-cyan swirling vortex with bright sparks. Animated at runtime by
// scrolling texture.offset (teleporters.js). Used with AdditiveBlending so
// the portal glows against dark surfaces. Radial swirl plus fbm chaos.
export function makePortalTexture() {
  const N = 256;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(N, N);
  const d = id.data;
  const cx = N / 2, cy = N / 2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy) / N;
      const ang = Math.atan2(dy, dx);
      const n = fbm(x / 22 + ang * 1.5, y / 22 - r * 6, 4, 71);
      const swirl = (Math.sin(ang * 4 + r * 14) + 1) * 0.5;
      const v = n * 0.55 + swirl * 0.45;
      const i = (y * N + x) * 4;
      // Magenta core fading to cyan edges.
      d[i]     = Math.min(255, 60  + v * 200);                 // R
      d[i + 1] = Math.min(255, 30  + v * 100 + (1 - r) * 80);  // G
      d[i + 2] = Math.min(255, 150 + v * 105);                 // B
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  // Bright spark sprinkles for "energy".
  for (let s = 0; s < 36; s++) {
    const sx = Math.random() * N, sy = Math.random() * N;
    ctx.fillStyle = `rgba(255,${180 + Math.random() * 75 | 0},255,${0.45 + Math.random() * 0.45})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 1 + Math.random() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  return finalize(c);
}

// --- JUMP PAD (launch tile) ---------------------------------------------
// Radial chevron glow — concentric rings of arrows pointing UP. Animated
// at runtime by `updateJumpPads` (alpha pulse only — the texture itself
// is static). Bright cyan/green to differentiate from portal magenta.
export function makeJumpPadTexture() {
  const N = 256;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  // Transparent base — pad is alpha-blended over the floor.
  ctx.clearRect(0, 0, N, N);
  const cx = N / 2, cy = N / 2;
  // Outer ring soft glow.
  for (let r = N / 2; r > 0; r -= 2) {
    const t = 1 - r / (N / 2);
    const a = Math.max(0, 0.30 * t - 0.05);
    ctx.fillStyle = `rgba(80,255,180,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Three concentric chevron rings (arrows pointing toward center / up).
  ctx.strokeStyle = '#a8ffd6';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let ring = 0; ring < 3; ring++) {
    const rr = 30 + ring * 28;
    const wedges = 8;
    for (let w = 0; w < wedges; w++) {
      const a = (w / wedges) * Math.PI * 2 + ring * 0.18;
      const x0 = cx + Math.cos(a) * rr;
      const y0 = cy + Math.sin(a) * rr;
      const x1 = cx + Math.cos(a) * (rr - 14);
      const y1 = cy + Math.sin(a) * (rr - 14);
      const x2 = cx + Math.cos(a + 0.22) * (rr - 8);
      const y2 = cy + Math.sin(a + 0.22) * (rr - 8);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  // Bright center dot — focal point.
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 24);
  grad.addColorStop(0, 'rgba(220,255,235,0.95)');
  grad.addColorStop(0.5, 'rgba(80,255,180,0.40)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, 24, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

// --- BANNER (hanging fabric) ----------------------------------------------
// Vertical stripe pattern with a procedural emblem in the middle band.
// Used by kit.banner() — hung from building parapets as visual flourish.
// Three color schemes (returned via `tone` arg): 'crimson' (slate-house
// red), 'azure' (foundry-iron blue), 'gold' (citadel-marble amber).
export function makeBannerTexture(tone) {
  const N = 256;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  // Palette per tone.
  let bg, edge, emblem;
  if (tone === 'azure') {        bg = '#1c2d4a'; edge = '#0a1530'; emblem = '#a4c8f0'; }
  else if (tone === 'gold') {    bg = '#5a3f10'; edge = '#1f1306'; emblem = '#f0c850'; }
  else                       {   bg = '#5a141c'; edge = '#1d0608'; emblem = '#f0c4b8'; }   // crimson default
  // Base fabric.
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, N, N);
  // Weave noise overlay.
  const id = ctx.getImageData(0, 0, N, N);
  const d = id.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(x / 14, y / 14, 4, 31) - 0.5;
      const i = (y * N + x) * 4;
      const k = 1 + n * 0.30;
      d[i]     = Math.max(0, Math.min(255, d[i]     * k));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] * k));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] * k));
    }
  }
  ctx.putImageData(id, 0, 0);
  // Edge trim (top + bottom bands).
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, N, 14);
  ctx.fillRect(0, N - 14, N, 14);
  // Vertical pinstripe accents (3 stripes).
  for (let s = 0; s < 3; s++) {
    const sx = N * (0.20 + s * 0.30);
    ctx.fillStyle = `rgba(255,255,255,0.10)`;
    ctx.fillRect(sx, 14, 2, N - 28);
  }
  // Central emblem — a chevron / star approximation.
  ctx.strokeStyle = emblem;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = N / 2, cy = N / 2;
  ctx.beginPath();
  // Star-of-light: 4 strokes radiating from center.
  for (let arm = 0; arm < 8; arm++) {
    const a = (arm / 8) * Math.PI * 2;
    const r = 38 + (arm % 2) * 18;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.stroke();
  // Center disc.
  ctx.fillStyle = emblem;
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fill();
  return finalize(c, false);    // banner is not seamless-repeating
}

// --- LEGACY ENTRY POINTS (kept so any external import still works) --------

export function makeWallTexture() {
  // Painted industrial steel — kept for compatibility.
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6e757f';
  ctx.fillRect(0, 0, N, N);
  const id = ctx.getImageData(0, 0, N, N);
  const d = id.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(x / 26, y / 26, 4, 91);
      const v = 100 + n * 60;
      const i = (y * N + x) * 4;
      d[i] = v; d[i + 1] = v + 4; d[i + 2] = v + 10;
    }
  }
  ctx.putImageData(id, 0, 0);
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * N;
    const w = 1 + Math.random() * 3;
    const alpha = 0.05 + Math.random() * 0.12;
    ctx.fillStyle = `rgba(35, 38, 42, ${alpha})`;
    ctx.fillRect(x, 0, w, N);
  }
  ctx.fillStyle = 'rgba(20, 22, 26, 0.6)';
  ctx.fillRect(0, N * 0.5 - 2, N, 3);
  for (let i = 0; i < 4; i++) drawBolt(ctx, (i + 0.5) * (N / 4), N * 0.5 - 12, 5);
  return finalize(c);
}

export function makeInteriorWallTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4d525a';
  ctx.fillRect(0, 0, N, N);
  const id = ctx.getImageData(0, 0, N, N);
  const d = id.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(x / 34, y / 34, 4, 113);
      const v = 75 + n * 55;
      const i = (y * N + x) * 4;
      d[i] = v; d[i + 1] = v + 2; d[i + 2] = v + 8;
    }
  }
  ctx.putImageData(id, 0, 0);
  addStains(ctx, N, N, 10, N * 0.20, 'rgba(20,22,26,0.35)');
  ctx.fillStyle = 'rgba(20, 22, 26, 0.55)';
  ctx.fillRect(N / 3 - 1, 0, 2, N);
  ctx.fillRect((2 * N) / 3 - 1, 0, 2, N);
  return finalize(c);
}

export function makeCoverTexture() {
  const N = 256;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#383d44';
  ctx.fillRect(0, 0, N, N);
  const id = ctx.getImageData(0, 0, N, N);
  const d = id.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(x / 18, y / 18, 3, 131);
      const v = 55 + n * 45;
      const i = (y * N + x) * 4;
      d[i] = v; d[i + 1] = v + 3; d[i + 2] = v + 9;
    }
  }
  ctx.putImageData(id, 0, 0);
  ctx.fillStyle = '#23262b';
  ctx.fillRect(0, 0, N, 8);
  ctx.fillRect(0, N - 8, N, 8);
  ctx.fillRect(0, 0, 8, N);
  ctx.fillRect(N - 8, 0, 8, N);
  drawBolt(ctx, 14, 14, 4);
  drawBolt(ctx, N - 14, 14, 4);
  drawBolt(ctx, 14, N - 14, 4);
  drawBolt(ctx, N - 14, N - 14, 4);
  ctx.save();
  ctx.translate(0, N * 0.5 - 10);
  ctx.fillStyle = '#d4a017';
  ctx.fillRect(8, 0, N - 16, 20);
  ctx.strokeStyle = '#1a1d22'; ctx.lineWidth = 6;
  for (let x = -20; x < N + 20; x += 16) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 18, 20); ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#23262b';
  ctx.fillRect(0, N * 0.5 - 11, N, 2);
  ctx.fillRect(0, N * 0.5 + 9, N, 2);
  return finalize(c);
}

export function makePillarTexture() {
  const N = 128, M = 512;
  const c = document.createElement('canvas');
  c.width = N; c.height = M;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#262a30';
  ctx.fillRect(0, 0, N, M);
  ctx.fillStyle = '#d4a017';
  ctx.fillRect(0, M * 0.10, N, 24);
  ctx.fillRect(0, M * 0.50 - 12, N, 24);
  ctx.fillRect(0, M * 0.90 - 24, N, 24);
  ctx.strokeStyle = '#1a1d22'; ctx.lineWidth = 5;
  const bandYs = [M * 0.10, M * 0.50 - 12, M * 0.90 - 24];
  for (const by of bandYs) {
    for (let x = -10; x < N + 10; x += 12) {
      ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + 14, by + 24); ctx.stroke();
    }
  }
  for (let y = 30; y < M; y += 60) drawBolt(ctx, N * 0.5, y, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
