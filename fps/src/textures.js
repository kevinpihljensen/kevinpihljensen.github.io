// textures.js — procedural textures via 2D canvas, wrapped as THREE.CanvasTexture.
//
// No external assets required (project rule). All textures generated at
// import time. Most use a 512x512 canvas which gives crisp detail at the
// distances the player will see surfaces from. Repeat is set in arena.js
// at the point of use (since repeat depends on the surface dimensions).
//
// Style: industrial / brutalist. Concrete floors with grid grooves, painted
// metal walls with subtle vertical streaks, dark concrete cover with bolted
// metal bands. Pillars get a hazard-stripe stencil. Color palette is
// intentionally cool/desaturated so neon enemy accents pop against it.

import * as THREE from 'three';

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

// Cheap noise: write random grey pixels with a given intensity range.
function addNoise(ctx, w, h, minVal, maxVal, alpha) {
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = minVal + Math.random() * (maxVal - minVal);
    d[i]     = (d[i]     * (1 - alpha)) + (v * alpha);
    d[i + 1] = (d[i + 1] * (1 - alpha)) + (v * alpha);
    d[i + 2] = (d[i + 2] * (1 - alpha)) + (v * alpha);
  }
  ctx.putImageData(id, 0, 0);
}

// Splotchy stain — paints semi-transparent dark blobs to break up flat color.
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

// --- FLOOR ---
// Tiled concrete with grid lines. The grid gives depth cues so the player
// can gauge speed across the open arena.
export function makeFloorTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  // Base concrete fill
  ctx.fillStyle = '#3a3f47';
  ctx.fillRect(0, 0, N, N);
  // Subtle noise
  addNoise(ctx, N, N, 50, 90, 0.55);
  // Stains
  addStains(ctx, N, N, 18, N * 0.18, 'rgba(20,22,26,0.45)');
  addStains(ctx, N, N, 6, N * 0.25, 'rgba(70,75,82,0.20)');
  // Grid lines — 4 cells per tile
  ctx.strokeStyle = 'rgba(20,22,26,0.55)';
  ctx.lineWidth = 2;
  const step = N / 4;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0); ctx.lineTo(i * step, N); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step); ctx.lineTo(N, i * step); ctx.stroke();
  }
  // Cross marks at intersections — small + signs
  ctx.strokeStyle = 'rgba(170,180,195,0.10)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    for (let j = 1; j < 4; j++) {
      const x = i * step, y = j * step;
      ctx.beginPath();
      ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y);
      ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// --- PERIMETER WALL ---
// Painted industrial steel. Vertical streaks suggest wear/drip.
export function makeWallTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6e757f';
  ctx.fillRect(0, 0, N, N);
  addNoise(ctx, N, N, 80, 130, 0.35);
  // Vertical streaks
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * N;
    const w = 1 + Math.random() * 3;
    const alpha = 0.05 + Math.random() * 0.12;
    ctx.fillStyle = `rgba(35, 38, 42, ${alpha})`;
    ctx.fillRect(x, 0, w, N);
  }
  // Horizontal seam (one panel break)
  ctx.fillStyle = 'rgba(20, 22, 26, 0.6)';
  ctx.fillRect(0, N * 0.5 - 2, N, 3);
  ctx.fillStyle = 'rgba(210, 215, 222, 0.10)';
  ctx.fillRect(0, N * 0.5 + 1, N, 1);
  // Bolts at the corners + along the seam
  ctx.fillStyle = '#23262a';
  for (let i = 0; i < 4; i++) {
    const px = (i + 0.5) * (N / 4);
    drawBolt(ctx, px, N * 0.5 - 12, 5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function drawBolt(ctx, x, y, r) {
  ctx.fillStyle = '#1d1f23';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a3e44';
  ctx.beginPath(); ctx.arc(x, y, r - 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#171a1d';
  ctx.fillRect(x - 1, y - r + 1, 2, r * 2 - 2);
}

// --- INTERIOR WALL ---
// Darker, plain concrete panels.
export function makeInteriorWallTexture() {
  const N = 512;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4d525a';
  ctx.fillRect(0, 0, N, N);
  addNoise(ctx, N, N, 65, 100, 0.45);
  addStains(ctx, N, N, 12, N * 0.20, 'rgba(20,22,26,0.40)');
  // Two vertical seams — panel breaks
  ctx.fillStyle = 'rgba(20, 22, 26, 0.55)';
  ctx.fillRect(N / 3 - 1, 0, 2, N);
  ctx.fillRect((2 * N) / 3 - 1, 0, 2, N);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// --- COVER BOX ---
// Riveted dark metal crates. A border + bolts at corners + a hazard stripe.
export function makeCoverTexture() {
  const N = 256;
  const c = makeCanvas(N);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#383d44';
  ctx.fillRect(0, 0, N, N);
  addNoise(ctx, N, N, 45, 80, 0.5);
  // Border / frame
  ctx.fillStyle = '#23262b';
  ctx.fillRect(0, 0, N, 8);
  ctx.fillRect(0, N - 8, N, 8);
  ctx.fillRect(0, 0, 8, N);
  ctx.fillRect(N - 8, 0, 8, N);
  // Bolt at each corner
  drawBolt(ctx, 14, 14, 4);
  drawBolt(ctx, N - 14, 14, 4);
  drawBolt(ctx, 14, N - 14, 4);
  drawBolt(ctx, N - 14, N - 14, 4);
  // Hazard chevron strip across the middle
  ctx.save();
  ctx.translate(0, N * 0.5 - 10);
  ctx.fillStyle = '#d4a017';
  ctx.fillRect(8, 0, N - 16, 20);
  ctx.strokeStyle = '#1a1d22';
  ctx.lineWidth = 6;
  for (let x = -20; x < N + 20; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + 18, 20); ctx.stroke();
  }
  ctx.restore();
  // Border over the stripe to clean it up
  ctx.fillStyle = '#23262b';
  ctx.fillRect(0, N * 0.5 - 11, N, 2);
  ctx.fillRect(0, N * 0.5 + 9, N, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

// --- PILLAR ---
// Tall thin support column — alternating dark / hazard-yellow bands.
export function makePillarTexture() {
  const N = 128;
  const M = 512;  // tall texture for vertical pillar
  const c = document.createElement('canvas');
  c.width = N; c.height = M;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#262a30';
  ctx.fillRect(0, 0, N, M);
  addNoise(ctx, N, M, 30, 60, 0.4);
  // Hazard bands at top, middle, bottom
  ctx.fillStyle = '#d4a017';
  ctx.fillRect(0, M * 0.10, N, 24);
  ctx.fillRect(0, M * 0.50 - 12, N, 24);
  ctx.fillRect(0, M * 0.90 - 24, N, 24);
  // Black chevrons over the bands
  ctx.strokeStyle = '#1a1d22';
  ctx.lineWidth = 5;
  const bandYs = [M * 0.10, M * 0.50 - 12, M * 0.90 - 24];
  for (let i = 0; i < bandYs.length; i++) {
    const by = bandYs[i];
    for (let x = -10; x < N + 10; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, by); ctx.lineTo(x + 14, by + 24); ctx.stroke();
    }
  }
  // Center bolt line
  for (let y = 30; y < M; y += 60) {
    drawBolt(ctx, N * 0.5, y, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
