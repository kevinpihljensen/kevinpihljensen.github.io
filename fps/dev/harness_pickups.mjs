// Verifies the M15 Stage 3 pickup system against the REAL data sources:
//   * Every PICKUPS position in maplayout.js sits on a real walkable surface
//     (groundHeightAt returns ≈ the entry's y), built from the REAL LAYOUT
//     via the same kit math arena.js uses.
//   * Replicates the runtime collect gate (PICKUP_RADIUS horizontal +
//     PICKUP_VERT_TOL vertical), respawn timer, weapon-pickup state machine
//     (lock → unlock + mag/reserve top-up) and health cap.
//
// Mirrors the harness_arena.mjs pattern for solid construction so the floor
// queries use the SHIPPED collision.js (no parallel implementation drift).

import { LAYOUT, SPAWN, PICKUPS, wallBoxes } from '../src/maplayout.js';
import { makeBoxSolid, makeRampSolid, groundHeightAt } from '../src/collision.js';
import {
  PICKUP_RADIUS, PICKUP_VERT_TOL, PICKUP_RESPAWN,
  PICKUP_HOVER_HEIGHT, HEALTH_PICKUP_AMOUNT, PLAYER_MAX_HEALTH,
} from '../src/constants.js';

// ---- replica of kit.solveConnection (verbatim — same as harness_arena.mjs) ----
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

// ---- build REAL solids from LAYOUT so groundHeightAt is meaningful ----
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
const f = (v, p = 3) => Number(v).toFixed(p);

// ---- 1. every pickup sits on a real floor at its declared y ----
console.log('--- pickup positions vs the real arena floor ---');
const BIG = 1e6, R = 0.4;
let badPos = 0;
for (const p of PICKUPS) {
  const g = groundHeightAt(p.x, p.z, BIG, R);
  const onFloor = g !== null && Math.abs(g - (p.y || 0)) < 0.1;
  if (!onFloor) badPos++;
  ok(`${p.kind}${p.what ? ':' + p.what : ''} @ (${f(p.x)},${f(p.z)}) y=${f(p.y || 0)}`,
     onFloor, `groundHeightAt=${g === null ? 'null' : f(g)}`);
}
ok('all pickup positions land on a real surface', badPos === 0);

// ---- 2. counts: every non-pistol weapon has exactly one pickup ----
console.log('\n--- weapon-pickup coverage (one of each non-pistol gun) ---');
const wantWeapons = ['shotgun', 'smg', 'sniper', 'saw'];
for (const w of wantWeapons) {
  const n = PICKUPS.filter(p => p.kind === 'weapon' && p.what === w).length;
  ok(`exactly one ${w} pickup on the map`, n === 1, `count=${n}`);
}
ok('there are health pickups present',
   PICKUPS.filter(p => p.kind === 'health').length >= 3,
   `${PICKUPS.filter(p => p.kind === 'health').length} health pickups`);
ok('no pistol pickup (pistol is the starting weapon)',
   PICKUPS.filter(p => p.kind === 'weapon' && p.what === 'pistol').length === 0);

// ---- 3. proximity gate (replica of pickups.playerOverlaps) ----
console.log('\n--- proximity gate (PICKUP_RADIUS + PICKUP_VERT_TOL) ---');
function playerOverlaps(p, px, py, pz) {
  const dx = px - p.x, dz = pz - p.z;
  if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) return false;
  if (Math.abs(py - (p.y || 0)) > PICKUP_VERT_TOL) return false;
  return true;
}
const samplePickup = { kind: 'health', x: 10, z: 5, y: 0 };
ok('player standing ON the pickup → collected',
   playerOverlaps(samplePickup, 10, 0, 5) === true);
ok('player just inside the radius → collected',
   playerOverlaps(samplePickup, 10 + PICKUP_RADIUS * 0.9, 0, 5) === true);
ok('player just outside the radius → NOT collected',
   playerOverlaps(samplePickup, 10 + PICKUP_RADIUS + 0.1, 0, 5) === false);
ok('player far away → NOT collected',
   playerOverlaps(samplePickup, 20, 0, 5) === false);

// ---- 4. vertical gate: pickup on deck not triggered from the ground below ----
console.log('\n--- vertical gate (pickup on a deck above the player) ---');
const tower = { kind: 'weapon', what: 'sniper', x: 27, z: -22, y: 7.0 };
ok('player on the GROUND directly under TOWER does NOT collect the sniper',
   playerOverlaps(tower, 27, 0, -22) === false, 'Δy=7 > PICKUP_VERT_TOL=' + PICKUP_VERT_TOL);
ok('player ON the TOWER deck (y=7.0) DOES collect the sniper',
   playerOverlaps(tower, 27, 7.0, -22) === true);
ok('player below by exactly PICKUP_VERT_TOL → still on the edge (collect)',
   playerOverlaps(tower, 27, 7.0 - PICKUP_VERT_TOL, -22) === true,
   `Δy=${PICKUP_VERT_TOL} == tol`);
ok('player below by tol + 0.01 → NOT collected',
   playerOverlaps(tower, 27, 7.0 - PICKUP_VERT_TOL - 0.01, -22) === false);

// ---- 5. weapon pickup state machine (replica of unlockWeapon + collect) ----
console.log('\n--- weapon pickup: lock → unlock + ammo top-up; repeat = refill ---');
function makeWeaponSlot(magSize, reserveStart, unlocked) {
  return { def: { magSize, reserveStart, unlocked }, state: { mag: 0, reserve: 0 } };
}
function collectWeapon(slot) {
  const wasLocked = !slot.def.unlocked;
  slot.def.unlocked = true;
  slot.state.mag = slot.def.magSize;
  slot.state.reserve = slot.def.reserveStart;
  return wasLocked;
}
{
  // Shotgun: mag 6, reserve 48 (matches WEAPON_DEFS.shotgun)
  const w = makeWeaponSlot(6, 48, false);
  const firstWasLocked = collectWeapon(w);
  ok('first weapon pickup unlocks the weapon',
     w.def.unlocked === true && firstWasLocked === true);
  ok('first pickup fills mag to magSize', w.state.mag === 6);
  ok('first pickup sets reserve to reserveStart', w.state.reserve === 48);

  // Simulate firing + a partial reload: mag and reserve drop.
  w.state.mag = 2; w.state.reserve = 10;
  const secondWasLocked = collectWeapon(w);
  ok('second pickup of an already-owned weapon does NOT re-lock',
     secondWasLocked === false && w.def.unlocked === true);
  ok('second pickup refills mag', w.state.mag === 6, `mag=${w.state.mag}`);
  ok('second pickup refills reserve', w.state.reserve === 48, `reserve=${w.state.reserve}`);
}

// ---- 6. health pickup: caps at PLAYER_MAX_HEALTH ----
console.log('\n--- health pickup: clamps at PLAYER_MAX_HEALTH ---');
function collectHealth(playerObj) {
  const before = playerObj.health;
  playerObj.health = Math.min(PLAYER_MAX_HEALTH, before + HEALTH_PICKUP_AMOUNT);
  return playerObj.health - before;
}
{
  const p = { health: 50 };
  const g = collectHealth(p);
  ok('partial-HP player gains HEALTH_PICKUP_AMOUNT',
     g === HEALTH_PICKUP_AMOUNT, `gained=${g}`);
  ok('post-pickup HP = 50 + AMOUNT', p.health === 50 + HEALTH_PICKUP_AMOUNT);
}
{
  const p = { health: PLAYER_MAX_HEALTH };
  const g = collectHealth(p);
  ok('full-HP player gains 0 (clamped at max)', g === 0);
  ok('HP unchanged at max after pickup', p.health === PLAYER_MAX_HEALTH);
}
{
  const p = { health: PLAYER_MAX_HEALTH - 5 };
  const g = collectHealth(p);
  ok('almost-full HP only gains the deficit (not the full AMOUNT)',
     g === 5, `gained=${g}`);
  ok('HP clamped exactly at max', p.health === PLAYER_MAX_HEALTH);
}

// ---- 7. respawn: collected → hidden, timer ticks, visible again at 0 ----
console.log('\n--- respawn timer ---');
function makeLivePickup() {
  return { collected: false, respawn: 0, visible: true };
}
function tick(p, dt) {
  if (!p.collected) return;
  p.respawn -= dt;
  if (p.respawn <= 0) {
    p.collected = false;
    p.respawn = 0;
    p.visible = true;
  }
}
{
  const p = makeLivePickup();
  // collect: hide + arm respawn
  p.collected = true; p.respawn = PICKUP_RESPAWN; p.visible = false;
  ok('on collect: hidden + respawn armed',
     p.visible === false && p.respawn === PICKUP_RESPAWN);
  // half-way: still hidden
  for (let i = 0; i < 60 * (PICKUP_RESPAWN / 2); i++) tick(p, 1 / 60);
  ok('half-way through respawn: still hidden',
     p.collected === true && p.visible === false,
     `respawn=${f(p.respawn)}`);
  // run out
  for (let i = 0; i < 60 * (PICKUP_RESPAWN / 2 + 1); i++) tick(p, 1 / 60);
  ok('after PICKUP_RESPAWN seconds: visible again, fresh',
     p.collected === false && p.visible === true && p.respawn === 0);
}

// ---- 8. hover/bob math ----
console.log('\n--- hover/bob (cosmetic but verified bounded) ---');
{
  // Bob amplitude should be small enough that a pickup never dips into the
  // surface or rises above the vertical-tolerance window.
  ok('hover - bob > 0 (pickup never sinks into floor)',
     PICKUP_HOVER_HEIGHT - 0.10 > 0, `hover=${PICKUP_HOVER_HEIGHT}`);
  ok('hover + bob < PICKUP_VERT_TOL (visual stays inside the collect window)',
     PICKUP_HOVER_HEIGHT + 0.10 < PICKUP_VERT_TOL,
     `hover+bob=${PICKUP_HOVER_HEIGHT + 0.10} < ${PICKUP_VERT_TOL}`);
}

console.log(`\n================  ${pass}/${total} PASS  ================`);
if (pass !== total) process.exit(1);
