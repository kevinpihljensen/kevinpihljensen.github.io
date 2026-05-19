// Verifies the S55i teleporter system: every `teleporter` LAYOUT entry
// has a valid `from` trigger AABB at open ground AND a `to` destination
// that lands on a real walkable surface (groundHeightAt within tolerance).
// Imports the REAL maplayout + the REAL collision so the assertion checks
// the shipped data, not a copy.

import { LAYOUT, wallBoxes } from '../src/maplayout.js';
import { makeBoxSolid, makeRampSolid, groundHeightAt } from '../src/collision.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Re-replicate the kit's solid-construction (same pattern as the other
// harnesses) so groundHeightAt sees the SHIPPED collision geometry.
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
    makeBoxSolid(x0, x1, base, base + e.sy, z0, z1);
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
  // teleporter / torch: no solids; skip.
}

let pass = 0, total = 0;
const ok = (n, c, d) => { total++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}  ${d || ''}`); if (c) pass++; };
const f = (v) => Number(v).toFixed(3);
const BIG = 1e6, R = 0.4;

const teles = LAYOUT.filter(e => e.t === 'teleporter');

// ---- 1. presence: at least one teleporter ----
ok('at least one teleporter present', teles.length > 0, `count=${teles.length}`);

// ---- 2. trigger Y: each `from.y` sits at-or-just-above ground level
//        ([0, 0.5]). A player standing on any walkable floor (open ground
//        OR a building interior at y=0) will then overlap the trigger AABB
//        and fire the portal. We can't groundHeightAt-check directly
//        because a trigger INSIDE a roofed building (e.g. VAULT interior)
//        returns the roof height — yet the player at y=0 inside still
//        triggers it. ----
for (const e of teles) {
  const f0 = e.from;
  ok(`teleporter ${e.id} from y=${f(f0.y)} is within ground-stand band [0, 0.5]`,
     f0.y >= 0 && f0.y <= 0.5);
}

// ---- 3. destination: each `to` lands on a real walkable surface ----
for (const e of teles) {
  const t = e.to;
  const g = groundHeightAt(t.x, t.z, BIG, R);
  ok(`teleporter ${e.id} to (${f(t.x)},${f(t.z)},${f(t.y)}) lands on a surface`,
     g !== null && Math.abs(g - t.y) < 0.15,
     `groundHeightAt=${g === null ? 'null' : f(g)}`);
}

// ---- 4. ids unique ----
const ids = new Set();
let dupes = 0;
for (const e of teles) {
  if (ids.has(e.id)) dupes++;
  ids.add(e.id);
}
ok('all teleporter ids unique', dupes === 0, `dupes=${dupes}`);

// ---- 5. trigger AABB sized for a standing capsule ----
for (const e of teles) {
  const f0 = e.from;
  ok(`teleporter ${e.id} trigger AABB ≥ player capsule (sx,sy,sz vs 0.8,1.7,0.8)`,
     f0.sx >= 0.8 && f0.sy >= 1.7 && f0.sz >= 0.8,
     `${f(f0.sx)}×${f(f0.sy)}×${f(f0.sz)}`);
}

// ---- 6. trigger and destination XZ are distinct (no degenerate self-teleport) ----
for (const e of teles) {
  const d = Math.hypot(e.from.cx - e.to.x, e.from.cz - e.to.z);
  ok(`teleporter ${e.id} from→to distance > 4 m (non-degenerate)`,
     d > 4, `d=${f(d)}`);
}

console.log(`\n================  ${pass}/${total} PASS  ================`);
if (pass !== total) process.exit(1);
