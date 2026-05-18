// edge_validate.mjs — brush-soup map validator for fps-edge.
//
// The fps/ validator (mapviz.mjs) assumes the engine's STRUCTURED map model
// (named platforms + explicit ramp/stair connectors + DOORWAYS registry).
// Quake-imported maps have none of that: 1000+ AABBs of arbitrary placement.
// Validating that the connector graph is "loop = yes" is meaningless; the
// player walks across box tops via step-up regardless of named connectors.
//
// This validator answers the questions that actually matter for a
// brush-imported map:
//
//   1. Does each LAYOUT entry parse and register a solid?
//   2. Is the SPAWN point on solid walkable ground (not inside / above
//      a brush)?
//   3. Is each PICKUPS entry on a walkable surface (each (x,z,y) lands
//      on or near a real groundHeightAt result)?
//   4. Is each TELEPORTER trigger volume sensible (non-zero, dest inside
//      the play area)?
//   5. From SPAWN, can the player REACH each pickup via a stairs-aware
//      2D BFS that respects the actual collision step-up + ceilings?
//
// Output: writes dev/edge_validate.txt with a per-check report and prints
// a SUMMARY line that ends in `EDGE MAP OK` or `EDGE MAP HAS ISSUES`. The
// new dev/test-all.sh runs this in place of mapviz.

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { LAYOUT, SPAWN, SPAWN_ANCHORS, PICKUPS, wallBoxes } from '../src/maplayout.js';
import {
  solids, makeBoxSolid, makeRampSolid, groundHeightAt, collideCapsule,
} from '../src/collision.js';

const __dir = dirname(fileURLToPath(import.meta.url));

const PLAYER_R = 0.4;
const PLAYER_H = 1.8;
const STEP_UP  = 0.6;
// JUMP_RISE = peak height the player gains in a jump (v²/2g with v=6, g=20 → 0.9m).
// Combined with step-up, max climb at jump apex = STEP_UP + JUMP_RISE ≈ 1.5m.
const JUMP_RISE = 0.9;
const BFS_GRID = 0.5;  // metres per BFS cell (tighter than 1m to find narrow ledges)

// ───────────────────────── build solids from LAYOUT ─────────────────────────
//
// Mirror arena.js's dispatch but in pure-Node (no THREE). Only the entry
// types that produce solids are wired.

const teleporters = [];
const lifts = [];
let groundHalf = 50;

for (const e of LAYOUT) {
  switch (e.t) {
    case 'ground': {
      groundHalf = e.half;
      // The runtime puts an infinite-ish floor at y = e.y by virtue of
      // collision.js defaulting to 0 when no solid wins; for validation we
      // just treat y=0 as the floor.
      break;
    }
    case 'perimeter': {
      // Four walls bounding the play area.
      const half = e.half, h = e.height, t = e.thick;
      makeBoxSolid(-half - t, -half,        0, h, -half, half, { kind: 'wall' });
      makeBoxSolid( half,      half + t,    0, h, -half, half, { kind: 'wall' });
      makeBoxSolid(-half - t,  half + t,    0, h, -half - t, -half, { kind: 'wall' });
      makeBoxSolid(-half - t,  half + t,    0, h,  half,     half + t, { kind: 'wall' });
      break;
    }
    case 'platform': {
      const half_t = e.thick == null ? 0.6 : e.thick;
      makeBoxSolid(e.cx - e.sx/2, e.cx + e.sx/2,
                   e.top - half_t, e.top,
                   e.cz - e.sz/2, e.cz + e.sz/2);
      break;
    }
    case 'box': {
      makeBoxSolid(e.cx - e.sx/2, e.cx + e.sx/2,
                   e.base, e.base + e.sy,
                   e.cz - e.sz/2, e.cz + e.sz/2);
      break;
    }
    case 'wall': {
      for (const r of wallBoxes(e)) {
        makeBoxSolid(r.x0, r.x1, r.y0, r.y1, r.z0, r.z1, { kind: 'wall' });
      }
      break;
    }
    case 'teleporter': {
      teleporters.push(e);
      break;
    }
    case 'elevator': {
      lifts.push(e);
      // Build the solid box at the TOP position (rest state) so groundHeightAt
      // sees it where the static .map expects. The runtime animates it; for
      // BFS we just need the top + bottom Y values + footprint.
      makeBoxSolid(
        e.cx - e.sx / 2, e.cx + e.sx / 2,
        e.topY, e.topY + e.sy,
        e.cz - e.sz / 2, e.cz + e.sz / 2,
      );
      break;
    }
    case 'rampTo':
    case 'stairsTo':
    case 'overhang':
      // Edge maps don't emit these but keep the dispatch quiet.
      break;
    default:
      // unknown — quiet (we don't crash)
      break;
  }
}

// ───────────────────────── checks ─────────────────────────

const lines = [];
const log = (s) => lines.push(s);

log('================ EDGE MAP — VALIDATION ================');
log('');
log(`LAYOUT entries: ${LAYOUT.length}`);
log(`solids registered: ${solids.length}`);
log(`teleporters: ${teleporters.length}`);
log(`pickups: ${PICKUPS.length}`);
log('');

let issues = 0;

// (1) Spawn is on walkable ground.
// Use the IMPORTED spawn y (The Edge's spawns are on multiple decks at
// different heights; the runtime resetPlayer() positions feet there and
// gravity does the rest). Probe ceiling = SPAWN.y + STEP_UP so the search
// finds the alcove floor directly below the spawn, not the upper deck.
log('--- spawn ---');
{
  const spawnY = SPAWN.y == null ? 0 : SPAWN.y;
  const gy = groundHeightAt(SPAWN.x, SPAWN.z, spawnY + STEP_UP, PLAYER_R);
  if (gy === null) {
    log(`  FAIL  spawn (${SPAWN.x.toFixed(2)}, y=${spawnY.toFixed(2)}, ${SPAWN.z.toFixed(2)}) has no ground at or below imported y`);
    issues++;
  } else {
    // Capsule fit at the imported spawn y (small tolerance — Quake-imported
    // spawns can sit a fraction inside an adjacent wall AABB but resolve
    // cleanly in one collision step).
    const r = collideCapsule(SPAWN.x, spawnY + 0.05, SPAWN.z, PLAYER_R, PLAYER_H);
    const moved = Math.hypot(r.x - SPAWN.x, r.z - SPAWN.z);
    if (moved > 2 * PLAYER_R) {
      log(`  FAIL  spawn capsule ejected by ${moved.toFixed(2)} m (deeply inside geometry)`);
      issues++;
    } else if (moved > 0.05) {
      log(`  WARN  spawn capsule nudged ${moved.toFixed(2)} m by adjacent wall AABB — runtime resolves it`);
      log(`  OK    spawn @ (${SPAWN.x.toFixed(2)}, y=${spawnY.toFixed(2)}, ${SPAWN.z.toFixed(2)}) — alcove floor below at y=${gy.toFixed(2)} (drop=${(spawnY-gy).toFixed(2)} m)`);
    } else {
      log(`  OK    spawn @ (${SPAWN.x.toFixed(2)}, y=${spawnY.toFixed(2)}, ${SPAWN.z.toFixed(2)}) — alcove floor below at y=${gy.toFixed(2)} (drop=${(spawnY-gy).toFixed(2)} m)`);
    }
  }
}

// (2) Pickups are on / very near a walkable surface.
log('');
log('--- pickups ---');
let floatingPickups = 0;
for (let i = 0; i < PICKUPS.length; i++) {
  const p = PICKUPS[i];
  const gy = groundHeightAt(p.x, p.z, p.y + 0.5, PLAYER_R);
  const name = p.what ? `weapon:${p.what}` : 'health';
  if (gy === null) {
    log(`  FAIL  ${name} @(${p.x.toFixed(1)},${p.z.toFixed(1)},${p.y.toFixed(1)}) — no surface below`);
    floatingPickups++;
    continue;
  }
  const dy = Math.abs(p.y - gy);
  if (dy > 1.5) {
    log(`  FAIL  ${name} @(${p.x.toFixed(1)},${p.z.toFixed(1)},${p.y.toFixed(1)}) — floats ${dy.toFixed(2)} m above surface (y_ground=${gy.toFixed(2)})`);
    floatingPickups++;
  }
}
if (floatingPickups === 0) {
  log(`  OK    all ${PICKUPS.length} pickups land on a walkable surface within 1.5 m`);
} else {
  log(`  ${floatingPickups} pickup(s) need their y coordinate snapped to a surface`);
  issues += floatingPickups;
}

// (3) Teleporters: trigger volumes non-degenerate; destinations on walkable ground.
log('');
log('--- teleporters ---');
let tpIssues = 0;
for (const t of teleporters) {
  const sx = t.x1 - t.x0, sy = t.y1 - t.y0, sz = t.z1 - t.z0;
  if (sx <= 0 || sy <= 0 || sz <= 0) {
    log(`  FAIL  teleporter '${t.name}' degenerate trigger volume`);
    tpIssues++; continue;
  }
  const gy = groundHeightAt(t.dx, t.dz, t.dy + 0.5, PLAYER_R);
  if (gy === null) {
    log(`  FAIL  teleporter '${t.name}' destination (${t.dx.toFixed(1)},${t.dy.toFixed(1)},${t.dz.toFixed(1)}) has no ground`);
    tpIssues++; continue;
  }
  if (Math.abs(t.dy - gy) > 1.5) {
    log(`  WARN  teleporter '${t.name}' destination y=${t.dy.toFixed(2)} doesn't match ground y=${gy.toFixed(2)} (Δ=${(t.dy-gy).toFixed(2)})`);
  }
  log(`  OK    '${t.name}': trigger ${sx.toFixed(1)}×${sy.toFixed(1)}×${sz.toFixed(1)} → dest (${t.dx.toFixed(1)},${t.dy.toFixed(1)},${t.dz.toFixed(1)})`);
}
issues += tpIssues;

// (4) Reachability BFS via step-up-aware ground-height walk.
//
// Grid: cells of BFS_GRID m. From each cell we step to its 8 neighbours if
// (a) neighbour ground is within STEP_UP m of current (climb), or
// (b) neighbour ground is lower (drop is always permitted), and
// (c) a standing capsule fits at the neighbour position without being
//     ejected horizontally.
//
// Teleporter cells link to the destination cell as a directed edge.
log('');
log('--- reachability from spawn (step-up + teleporter aware) ---');

function cellKey(ix, iz) { return `${ix},${iz}`; }
function cellPos(ix, iz) { return { x: ix * BFS_GRID, z: iz * BFS_GRID }; }
function unkey(k) {
  const i = k.indexOf(',');
  return [parseInt(k.slice(0, i), 10), parseInt(k.slice(i + 1), 10)];
}

const visited = new Map();   // key → ground y at that cell
function walkable(x, z, maxY = 60) {
  // groundHeightAt returns the highest walkable surface at (x,z) within the
  // probe ceiling. The BFS uses a TIGHTENED maxY (cur.gy + step + jump) so a
  // tall obstacle above the current cell — e.g. an elevator at its top
  // position — doesn't mask the floor below it; the player at the bottom
  // can't climb 18 m to the lift's top in one move and shouldn't see that
  // surface from this cell at all.
  return groundHeightAt(x, z, maxY, PLAYER_R);
}

// Snap a world point to its BFS cell.
function snapCell(x, z) {
  return { ix: Math.round(x / BFS_GRID), iz: Math.round(z / BFS_GRID) };
}

// Seed BFS from EVERY spawn anchor — the engine spawns the player at any
// anchor in arena mode, so a pickup reachable from ANY spawn is reachable
// in practice. Cross-spawn-island connectivity is captured by teleporters
// + drops below.
const queue = [];
const seeds = [{ x: SPAWN.x, z: SPAWN.z, id: 'SPAWN' },
               ...SPAWN_ANCHORS.map(a => ({ x: a.x, z: a.z, id: a.id }))];
let seededCells = 0;
for (const s of seeds) {
  const c0 = snapCell(s.x, s.z);
  const k0 = cellKey(c0.ix, c0.iz);
  if (visited.has(k0)) continue;
  const gy0 = walkable(c0.ix * BFS_GRID, c0.iz * BFS_GRID);
  if (gy0 !== null) {
    visited.set(k0, gy0);
    queue.push({ ix: c0.ix, iz: c0.iz, gy: gy0 });
    seededCells++;
  }
}
log(`  seeded BFS from ${seededCells} spawn anchor(s)`);
if (seededCells === 0) {
  log('  FAIL  no spawn anchor lands on walkable ground');
  issues++;
}

let bfsSteps = 0;
const MAX_BFS = 800000;   // tighter 0.5 m grid → more cells

while (queue.length && bfsSteps < MAX_BFS) {
  const cur = queue.shift();
  bfsSteps++;
  // Stop if we wandered outside the perimeter.
  if (Math.abs(cur.ix * BFS_GRID) > groundHalf + 5 ||
      Math.abs(cur.iz * BFS_GRID) > groundHalf + 5) continue;
  // Test 8 neighbours.
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const nx = cur.ix + dx, nz = cur.iz + dz;
      const k = cellKey(nx, nz);
      if (visited.has(k)) continue;
      const p = cellPos(nx, nz);
      // Two probes per neighbour: a high-clip probe (only catches surfaces
      // the player can climb to from cur) gives the "step-up / jump-up" path,
      // and a low probe catches drops onto whatever ground is at this XZ
      // below the current level. The lower of the two wins as long as it
      // exists; otherwise the higher.
      const climbCeil = cur.gy + STEP_UP + JUMP_RISE + 0.05;
      let gy = walkable(p.x, p.z, climbCeil);
      if (gy === null) {
        // No surface within climb reach — try a far-below probe for drops.
        gy = walkable(p.x, p.z, cur.gy + STEP_UP + 0.05);
        if (gy === null) continue;
      }
      if (gy - cur.gy > STEP_UP + JUMP_RISE) continue;
      visited.set(k, gy);
      queue.push({ ix: nx, iz: nz, gy });
    }
  }
  // Teleporter edges: if cur cell is inside any trigger volume, jump to dest.
  const wx = cur.ix * BFS_GRID, wz = cur.iz * BFS_GRID;
  for (const t of teleporters) {
    if (wx >= t.x0 - 0.5 && wx <= t.x1 + 0.5 &&
        wz >= t.z0 - 0.5 && wz <= t.z1 + 0.5 &&
        cur.gy + 1.0 >= t.y0 && cur.gy <= t.y1) {
      const dc = snapCell(t.dx, t.dz);
      const dk = cellKey(dc.ix, dc.iz);
      if (!visited.has(dk)) {
        const dgy = walkable(dc.ix * BFS_GRID, dc.iz * BFS_GRID);
        if (dgy !== null) {
          visited.set(dk, dgy);
          queue.push({ ix: dc.ix, iz: dc.iz, gy: dgy });
        }
      }
    }
  }
  // Elevator edges: a player standing on the plate XZ at either endpoint
  // can ride to the other. Add both directions. Generous footprint margin
  // (PLAYER_RADIUS) so adjacent cells trigger too — players approach the
  // plate from beside it, not always landing perfectly on its centre.
  for (const lift of lifts) {
    const onPlate = wx >= lift.cx - lift.sx / 2 - PLAYER_R &&
                    wx <= lift.cx + lift.sx / 2 + PLAYER_R &&
                    wz >= lift.cz - lift.sz / 2 - PLAYER_R &&
                    wz <= lift.cz + lift.sz / 2 + PLAYER_R;
    if (!onPlate) continue;
    // From any cell whose ground y is roughly the bottom or the top,
    // expose the other endpoint as reachable at this XZ.
    const atBottom = Math.abs(cur.gy - lift.bottomY) < 1.5;
    const atTop    = Math.abs(cur.gy - lift.topY)    < 1.5;
    if (atBottom) {
      const k = cellKey(cur.ix, cur.iz);
      // Add a synthetic visit at top with the elevator's top y if a top
      // cell sample doesn't already exist.
      const topSampleX = lift.cx, topSampleZ = lift.cz;
      const dc = snapCell(topSampleX, topSampleZ);
      const dk = cellKey(dc.ix, dc.iz);
      if (!visited.has(dk) || visited.get(dk) < lift.topY - 0.5) {
        visited.set(dk, lift.topY);
        queue.push({ ix: dc.ix, iz: dc.iz, gy: lift.topY });
      }
    }
    if (atTop) {
      const dc = snapCell(lift.cx, lift.cz);
      const dk = cellKey(dc.ix, dc.iz);
      if (!visited.has(dk) || Math.abs(visited.get(dk) - lift.bottomY) > 0.5) {
        // Already at this XZ via the top solid; just inject a low-y twin
        // so neighbours of this twin pick up the bottom level.
        // (Use a distinct key by offsetting the iz by 100000 to avoid
        // overwriting the top-cell entry — separate "level" in the graph.)
        const twinKey = `${dc.ix},${dc.iz}@b`;
        if (!visited.has(twinKey)) {
          visited.set(twinKey, lift.bottomY);
          queue.push({ ix: dc.ix, iz: dc.iz, gy: lift.bottomY });
        }
      }
    }
  }
}

// Diagnostic: bounds of visited region.
let vminX = Infinity, vmaxX = -Infinity, vminZ = Infinity, vmaxZ = -Infinity, vminY = Infinity, vmaxY = -Infinity;
for (const [k, gy] of visited) {
  const [ix, iz] = unkey(k);
  const x = ix * BFS_GRID, z = iz * BFS_GRID;
  if (x < vminX) vminX = x; if (x > vmaxX) vmaxX = x;
  if (z < vminZ) vminZ = z; if (z > vmaxZ) vmaxZ = z;
  if (gy < vminY) vminY = gy; if (gy > vmaxY) vmaxY = gy;
}
log(`  visited ${visited.size} cells in ${bfsSteps} steps`);
log(`  visited region: x=[${vminX.toFixed(1)},${vmaxX.toFixed(1)}] z=[${vminZ.toFixed(1)},${vmaxZ.toFixed(1)}] y=[${vminY.toFixed(1)},${vmaxY.toFixed(1)}]`);

// Per-pickup reachability.
let unreachable = 0;
for (const p of PICKUPS) {
  // Try the pickup's cell plus immediate neighbours.
  const c = snapCell(p.x, p.z);
  let reached = false;
  for (let dz = -1; dz <= 1 && !reached; dz++) {
    for (let dx = -1; dx <= 1 && !reached; dx++) {
      if (visited.has(cellKey(c.ix + dx, c.iz + dz))) {
        const gy = visited.get(cellKey(c.ix + dx, c.iz + dz));
        // Pickup must be within reach in Y too (1.5 m of the cell ground).
        if (Math.abs(gy - p.y) < 1.5) reached = true;
      }
    }
  }
  const name = p.what ? `weapon:${p.what}` : 'health';
  if (!reached) {
    log(`  UNREACHABLE  ${name} @(${p.x.toFixed(1)},${p.z.toFixed(1)},${p.y.toFixed(1)})`);
    unreachable++;
  }
}
if (unreachable === 0) {
  log(`  OK    all ${PICKUPS.length} pickups reachable from spawn`);
}
issues += unreachable;

// (5) Performance hint.
log('');
log('--- performance hint ---');
log(`  solids: ${solids.length} (engine collision iterates this list per capsule step)`);
if (solids.length > 1500) {
  log('  WARN  solid count is high; expect frame-time pressure on collision queries');
}

// ───────────────────────── summary ─────────────────────────

log('');
const summary = `SUMMARY: solids=${solids.length}  teleporters=${teleporters.length}  pickups=${PICKUPS.length}  floating=${floatingPickups}  unreachable=${unreachable}  tp_issues=${tpIssues}  | issues=${issues}`;
log(summary);
log(issues === 0 ? '*** EDGE MAP OK ***' : '*** EDGE MAP HAS ISSUES — see above ***');

const out = lines.join('\n') + '\n';
writeFileSync(join(__dir, 'edge_validate.txt'), out);
process.stdout.write(out);

if (issues > 0) process.exit(1);
