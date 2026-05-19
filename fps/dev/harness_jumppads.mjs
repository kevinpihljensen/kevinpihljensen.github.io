// Verifies the S55k jump-pad system: every `jumppad` LAYOUT entry has
// a sensible position (on open ground), a valid launch velocity, an
// adequate trigger AABB, and a unique id. Also verifies the launch
// physics give a peak height within the playable range (≤ 12 m so the
// player doesn't overshoot the playable Y band catastrophically).

import { LAYOUT, wallBoxes } from '../src/maplayout.js';
import { makeBoxSolid, makeRampSolid, groundHeightAt } from '../src/collision.js';
import { GRAVITY } from '../src/constants.js';

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
}

let pass = 0, total = 0;
const ok = (n, c, d) => { total++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}  ${d || ''}`); if (c) pass++; };
const f = (v) => Number(v).toFixed(2);
const BIG = 1e6, R = 0.4;

const pads = LAYOUT.filter(e => e.t === 'jumppad');

// ---- 1. presence: at least 2 pads (mechanic-coverage minimum) ----
ok('at least 2 jump pads present', pads.length >= 2, `count=${pads.length}`);

// ---- 2. each pad sits on open ground (so the launched player has a
//        consistent baseline takeoff height) ----
for (const p of pads) {
  const g = groundHeightAt(p.cx, p.cz, BIG, R);
  ok(`jumppad ${p.id} at (${f(p.cx)},${f(p.cz)}) on open ground`,
     g !== null && Math.abs(g) < 0.15,
     `groundHeightAt=${g === null ? 'null' : f(g)}`);
}

// ---- 3. launch physics: peak height vy²/(2g) in [3, 12] m ----
for (const p of pads) {
  const vy = p.launchVy === undefined ? 14 : p.launchVy;
  const peak = (vy * vy) / (2 * GRAVITY);
  ok(`jumppad ${p.id} peak height ${f(peak)} m within [3, 12]`,
     peak >= 3 && peak <= 12,
     `vy=${f(vy)}`);
}

// ---- 4. trigger AABB ≥ player capsule footprint ----
for (const p of pads) {
  const sx = p.sx === undefined ? 3 : p.sx;
  const sz = p.sz === undefined ? 3 : p.sz;
  ok(`jumppad ${p.id} pad ≥ player capsule footprint (≥ 1.0 × 1.0)`,
     sx >= 1 && sz >= 1,
     `${f(sx)} × ${f(sz)}`);
}

// ---- 5. ids unique ----
const ids = new Set();
let dupes = 0;
for (const p of pads) {
  if (ids.has(p.id)) dupes++;
  ids.add(p.id);
}
ok('all jumppad ids unique', dupes === 0, `dupes=${dupes}`);

// ---- 6. spacing: no two pads within 4 m (would create double-launch
//        loops where landing puts the player back on a pad). ----
let tooClose = 0;
for (let i = 0; i < pads.length; i++) {
  for (let j = i + 1; j < pads.length; j++) {
    const d = Math.hypot(pads[i].cx - pads[j].cx, pads[i].cz - pads[j].cz);
    if (d < 4) tooClose++;
  }
}
ok('all jumppads ≥ 4 m apart from each other (no double-launch loops)',
   tooClose === 0,
   `${tooClose} pairs too close`);

console.log(`\n================  ${pass}/${total} PASS  ================`);
if (pass !== total) process.exit(1);
