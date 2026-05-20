// Verifies the S55j arena-spawn-distribution feature: ENEMY_SPAWN_POINTS
// is well-formed AND distributed across the map AND every point is on
// real walkable ground (not inside a building / on top of a wall). The
// runtime picker (pickArenaSpawnPoint) is exercised by exporting the
// helpers it depends on — here we just verify the DATA invariants.

import { LAYOUT, ENEMY_SPAWN_POINTS, wallBoxes } from '../src/maplayout.js';
import { makeBoxSolid, makeRampSolid, groundHeightAt } from '../src/collision.js';
import { ARENA_PLAYABLE_HALF } from '../src/constants.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function solve(P, side, run, width, fromY) {
  const hiY = P.top, loY = fromY, half = width / 2;
  let axis, loPos, hiPos, c0, c1;
  if (side === '-z' || side === '+z') {
    axis = 'z';
    if (side === '-z') { hiPos = P.z0; loPos = P.z0 - run; }
    else               { hiPos = P.z1; loPos = P.z1 + run; }
    c0 = clamp(P.cx - half, P.x0, P.x1);
    c1 = clamp(P.cx + half, P.x0, P.x1);
  } else {
    axis = 'x';
    if (side === '-x') { hiPos = P.x0; loPos = P.x0 - run; }
    else               { hiPos = P.x1; loPos = P.x1 + run; }
    c0 = clamp(P.cz - half, P.z0, P.z1);
    c1 = clamp(P.cz + half, P.z0, P.z1);
  }
  return { axis, loPos, hiPos, loY, hiY, c0, c1 };
}

// Build real solids so groundHeightAt is meaningful.
const H = {};
for (const e of LAYOUT) {
  if (e.t === 'ground') {
    makeBoxSolid(-e.half, e.half, (e.y || 0) - 2, e.y || 0, -e.half, e.half);
  } else if (e.t === 'perimeter') {
    const t = e.thick == null ? 1.0 : e.thick, h = e.half, H2 = e.height;
    for (const [x0, x1, z0, z1] of [
      [-h - t,  h + t,  h,      h + t],
      [-h - t,  h + t, -h - t, -h],
      [ h,      h + t, -h - t,  h + t],
      [-h - t, -h,     -h - t,  h + t],
    ]) makeBoxSolid(x0, x1, 0, H2, z0, z1, { noWalk: true });
  } else if (e.t === 'platform') {
    const th = e.thick == null ? 0.6 : e.thick;
    const x0 = e.cx - e.sx / 2, x1 = e.cx + e.sx / 2;
    const z0 = e.cz - e.sz / 2, z1 = e.cz + e.sz / 2;
    makeBoxSolid(x0, x1, e.top - th, e.top, z0, z1);
    if (e.id) H[e.id] = { top: e.top, x0, x1, z0, z1, cx: e.cx, cz: e.cz };
  } else if (e.t === 'box') {
    const base = e.base || 0;
    const x0 = e.cx - e.sx / 2, x1 = e.cx + e.sx / 2;
    const z0 = e.cz - e.sz / 2, z1 = e.cz + e.sz / 2;
    makeBoxSolid(x0, x1, base, base + e.sy, z0, z1, e.ceiling ? { ceiling: true } : undefined);
    if (e.id) H[e.id] = { top: base + e.sy, x0, x1, z0, z1, cx: e.cx, cz: e.cz };
  } else if (e.t === 'wall') {
    for (const r of wallBoxes(e)) makeBoxSolid(r.x0, r.x1, r.y0, r.y1, r.z0, r.z1, { noWalk: true });
  } else if (e.t === 'rampTo' || e.t === 'stairsTo') {
    const P = H[e.to];
    const c = solve(P, e.side, e.run, e.width, e.fromY || 0);
    makeRampSolid(c.axis, c.loPos, c.hiPos, c.loY, c.hiY, c.c0, c.c1,
                  e.thick == null ? 0.6 : e.thick, { skirtSolid: true });
  } else if (e.t === 'overhang') {
    makeRampSolid(e.axis, e.loPos, e.hiPos, e.loY, e.hiY, e.c0, e.c1,
                  e.thick == null ? 0.6 : e.thick);
  }
}

let pass = 0, total = 0;
const ok = (n, c, d) => { total++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}  ${d || ''}`); if (c) pass++; };
const f = (v) => Number(v).toFixed(2);
const BIG = 1e6, R = 0.4;

// ---- 1. presence + count: at least 8 spawn points spread across map ----
ok('ENEMY_SPAWN_POINTS exists',
   Array.isArray(ENEMY_SPAWN_POINTS),
   `type=${typeof ENEMY_SPAWN_POINTS}`);
ok('at least 8 enemy spawn points (for distribution coverage)',
   ENEMY_SPAWN_POINTS.length >= 8,
   `count=${ENEMY_SPAWN_POINTS.length}`);

// ---- 2. every point on open ground (y=0) ----
let badGround = 0;
for (const p of ENEMY_SPAWN_POINTS) {
  const g = groundHeightAt(p.x, p.z, BIG, R);
  if (g === null || Math.abs(g) > 0.15) badGround++;
}
ok('all spawn points on open ground (groundHeightAt ≈ 0)',
   badGround === 0,
   `${badGround} off-ground`);

// ---- 3. all within playable arena ----
let outOfBounds = 0;
for (const p of ENEMY_SPAWN_POINTS) {
  if (Math.abs(p.x) > ARENA_PLAYABLE_HALF || Math.abs(p.z) > ARENA_PLAYABLE_HALF) outOfBounds++;
}
ok(`all spawn points within ±${ARENA_PLAYABLE_HALF} playable bound`,
   outOfBounds === 0,
   `${outOfBounds} out of bounds`);

// ---- 4. distribution: at least one point in each of the 4 quadrants ----
// (NE, NW, SE, SW relative to map origin; the player at SPAWN/anchors
// gets enemies from every direction over a long run.)
let ne = 0, nw = 0, se = 0, sw = 0;
for (const p of ENEMY_SPAWN_POINTS) {
  if (p.x > 5 && p.z < -5) ne++;
  if (p.x < -5 && p.z < -5) nw++;
  if (p.x > 5 && p.z > 5) se++;
  if (p.x < -5 && p.z > 5) sw++;
}
ok('at least one spawn point in NE quadrant', ne >= 1, `ne=${ne}`);
ok('at least one spawn point in NW quadrant', nw >= 1, `nw=${nw}`);
ok('at least one spawn point in SE quadrant', se >= 1, `se=${se}`);
ok('at least one spawn point in SW quadrant', sw >= 1, `sw=${sw}`);

// ---- 5. spacing: every pair of points ≥ 14 m apart (avoid clustering) ----
let tooClose = 0;
for (let i = 0; i < ENEMY_SPAWN_POINTS.length; i++) {
  for (let j = i + 1; j < ENEMY_SPAWN_POINTS.length; j++) {
    const a = ENEMY_SPAWN_POINTS[i], b = ENEMY_SPAWN_POINTS[j];
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < 14) tooClose++;
  }
}
ok('all spawn points ≥ 14 m apart from each other',
   tooClose === 0,
   `${tooClose} pairs too close`);

// ---- 6. spawn points clear of SPAWN (player) ----
let nearSpawn = 0;
for (const p of ENEMY_SPAWN_POINTS) {
  const d = Math.hypot(p.x - 0, p.z - 6);  // SPAWN is (0, 6) in maplayout
  if (d < 16) nearSpawn++;
}
ok('all spawn points ≥ 16 m from player SPAWN at (0,6)',
   nearSpawn === 0,
   `${nearSpawn} too close to SPAWN`);

console.log(`\n================  ${pass}/${total} PASS  ================`);
if (pass !== total) process.exit(1);
