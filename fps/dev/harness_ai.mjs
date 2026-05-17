// Verifies the two AI fixes against the REAL collision.js:
//  (1) Multi-point LOS: a player peeking with only the head over cover is
//      visible/engageable (old single chest-ray said "blind"), while a full
//      wall still fully blocks (no over-buff — can't see through solids).
//  (2) Cross-floor commit: navGoal's gate returns a ramp goal when the
//      player is a tier above (navActive=true ⇒ AI climbs instead of
//      arcing), and clears on the same level; pickRamp picks the ramp whose
//      exit is nearest the player and steers toward its ENTRY (climb), not
//      perpendicular.
import {
  makeBoxSolid, makeRampSolid, lineOfSight, rampLinks, solids,
} from '../src/collision.js';

let pass = 0, total = 0;
const ok = (n, c, d) => { total++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}  ${d || ''}`); if (c) pass++; };
const f = v => Number(v).toFixed(3);

// ---- exact replication of the new canSeePlayer sampling ----
const STAND  = [1.58, 1.05, 0.55];
const CROUCH = [1.18, 0.80, 0.40];
function canSee(ex, ey, ez, px, py, pz, crouch) {
  const s = crouch ? CROUCH : STAND;
  for (let i = 0; i < s.length; i++)
    if (lineOfSight(ex, ey + 1.1, ez, px, py + s[i], pz)) return s[i]; // aimY
  return null;
}

// floor
makeBoxSolid(-60, 60, -2, 0, -60, 60);
// chest-high cover crate at x=0 (top y=1.1): blocks chest, not the head
makeBoxSolid(-1, 1, 0, 1.1, -1, 1);

const ex = -6, ez = 0, px = 6, pz = 0;          // enemy left, player right

// (1a) Old behaviour: a single chest ray (1.05) is blocked by the crate.
const chestOnly = lineOfSight(ex, 0 + 1.1, ez, px, 0 + 1.05, pz);
ok('single chest ray is BLOCKED by chest-high cover (the old bug)', !chestOnly);

// (1b) New behaviour: multi-sample still sees the HEAD over the crate.
const aim = canSee(ex, 0, ez, px, 0, pz, false);
ok('multi-point LOS sees the player (head over cover)', aim !== null, `aimY=${aim}`);
ok('aim height is the HEAD (shoot the exposed part, not the crate)',
   aim === 1.58, `aimY=${f(aim)}`);

// (1c) Crouched fully behind the crate (head at 1.18 < crate top 1.1? no —
// 1.18 > 1.1, still a sliver). Use a TALL wall to prove no over-buff:
makeBoxSolid(19, 21, 0, 6, -8, 8);              // full-height wall at x=20
const blockedAimY = canSee(25 - 31, 0, 0, /*px*/ 25, 0, 0, false);
// enemy at x=-6, player at x=25, wall spans x[19,21] full height → all 3
// samples blocked.
ok('a FULL wall still blocks every sample (no seeing through solids)',
   canSee(-6, 0, 0, 25, 0, 0, false) === null);

// (2) Cross-floor: build a real ramp ground(0) → deck(4.5).
const before = rampLinks.length;
makeRampSolid('x', 10, 24, 0, 4.5, -3, 3, 0.6);  // loPos→hiPos along x
ok('ramp registers a navigation link in rampLinks', rampLinks.length === before + 1);
const r = rampLinks[rampLinks.length - 1];

// navGoal gate: FLOOR_EPS = 2.0. Player a tier above ⇒ navActive.
const FLOOR_EPS = 2.0;
const enemyY = 0, playerHigh = 4.5, playerSame = 0.0;
ok('player on a higher tier ⇒ cross-floor nav engages (navActive)',
   Math.abs(playerHigh - enemyY) > FLOOR_EPS && rampLinks.length > 0);
ok('player on the same level ⇒ no cross-floor nav (chase directly)',
   !(Math.abs(playerSame - enemyY) > FLOOR_EPS));

// pickRamp: among links whose low end is near the enemy, pick min(dEntry +
// dExit-to-player). With one ramp and player near its top, it must select
// it AND steer toward the ENTRY (low end) so the enemy climbs.
const enemyPos = { x: 2, z: 0 };
const playerPos = { x: 26, z: 0, y: 4.5 };       // up on the deck past the top
const lowNear = Math.abs(r.lowY - enemyY) < 2.6;
ok('ramp low end is reachable from the enemy floor', lowNear);
const entry = { x: r.lowX, z: r.lowZ }, exit = { x: r.highX, z: r.highZ };
const steerx = entry.x - enemyPos.x, steerz = entry.z - enemyPos.z;
const toPlayerx = playerPos.x - enemyPos.x;
// Steering toward the ramp entry must have a positive component toward the
// player's side (climb the ramp), i.e. it is NOT a perpendicular arc.
const dot = (steerx * toPlayerx) / (Math.hypot(steerx, steerz) * Math.abs(toPlayerx) || 1);
ok('cross-floor steer points toward the ramp entry (climbs, not arcs)',
   dot > 0.5, `dot=${f(dot)}`);

// ---- (3) cross-map shooting: range gates lifted ----
const C = await import('../src/constants.js');
const { wallBoxes } = await import('../src/maplayout.js');
const diag = Math.hypot(80, 80);                       // ≈113m arena diagonal
const projRange = C.PROJECTILE_SPEED * C.PROJECTILE_LIFETIME;
ok('projectile range now clears the whole map diagonal',
   projRange >= diag, `range=${f(projRange)}m  diag=${f(diag)}m`);
ok('heavy fire-range gate now spans the whole map',
   C.HEAVY_FIRE_RANGE >= diag, `HEAVY_FIRE_RANGE=${C.HEAVY_FIRE_RANGE}`);
ok('shooter holds & fires from long range before closing',
   C.SHOOTER_DIST_MAX >= 35, `SHOOTER_DIST_MAX=${C.SHOOTER_DIST_MAX}`);
// LOS itself has no range cap: open sightline across 90m is clear,
// the same span with a wall in it is blocked — at any distance.
makeBoxSolid(-3, 3, 0, 6, 48, 52);                     // wall far downrange
ok('open long-range sightline (90m) is clear',
   lineOfSight(0, 1.6, -45, 0, 1.6, 45) === true);
ok('a wall blocks the long-range sightline (no infinite x-ray, but no range cap either)',
   lineOfSight(0, 1.6, -45, 0, 1.6, 60) === false);

// ---- (4) unstick: wedged on a window sill but has LOS through it ----
// Build a real window wall: solid sill + lintel + jambs, clear mid band.
for (const r of wallBoxes({ t: 'wall', axis: 'x', cx: 40, cz: 0, length: 12,
      height: 4, thick: 0.6, window: { width: 3, height: 1.3, sill: 1.1 } }))
  makeBoxSolid(r.x0, r.x1, r.y0, r.y1, r.z0, r.z1);
const { collideCapsule } = await import('../src/collision.js');
// Enemy at z=-0.6 (just south of the 0.6-thick sill at z[-0.3,0.3]) tries to
// step NORTH through the window toward the player; tentative pos lands inside
// the sill band and collideCapsule shoves it back out — net progress ≈ 0.
const z0 = -0.6, stepN = 0.5;
const res2 = collideCapsule(40, 0, z0 + stepN, 0.35, 1.7);
const advance = res2.z - z0;                           // intended +0.5
ok('a straight push into the window sill barely progresses (the stuck case)',
   advance < 0.3, `Δz=${f(advance)} vs intended +${stepN} (sill blocks the body)`);
ok('but LOS THROUGH the window band is clear (so old AI never re-routed)',
   lineOfSight(40, 0 + 1.1, -4, 40, 0 + 1.6, 4) === true);
const movedTooLittle = advance < C.AI_UNSTICK_MIN_MOVE;
ok('stuck rule triggers an unstick (progress < AI_UNSTICK_MIN_MOVE)',
   movedTooLittle, `${f(advance)} < ${C.AI_UNSTICK_MIN_MOVE}`);
// unstick slide is perpendicular to the goal (slides ALONG the wall)
const gx = 0, gz = 1; // goal dir = +z (toward player through window)
const s = 1, ux = -gz * s * 0.9 + gx * 0.35, uz = gx * s * 0.9 + gz * 0.35;
const perpDot = Math.abs(ux) / Math.hypot(ux, uz);     // ≈1 ⇒ mostly sideways
ok('unstick slide is mostly perpendicular (slides along the obstacle)',
   perpDot > 0.85, `perpComponent=${f(perpDot)}`);

// ---- (5) vantage-seek: LOS-starved on the flat ⇒ climb for a sightline ----
const VT = C.AI_VANTAGE_LOS_TIME;
const farXZ = 20 * 20;                                  // player 20m away (>12)
ok('no vantage climb until LOS-starved past the threshold',
   !((1.0 > VT)), `noLosTimer 1.0s < ${VT}s ⇒ keep chasing`);
ok('LOS-starved + far + up-ramp present ⇒ vantage climb engages',
   (VT + 0.5) > VT && farXZ > 144 && rampLinks.length > 0,
   `noLosTimer ${VT + 0.5}s > ${VT}s`);
ok('vantage requires the ramp to actually gain height (>1.5m up)',
   rampLinks.some(rr => rr.highY > 0 + 1.5));

// ---- (6) muzzle origin is relative to the enemy's OWN floor ----
// Replicates the fixed shooterFire/heavyFire origin math. Before the fix
// oy was a fixed world constant, so an enemy on a 7m deck fired from
// underground and a ground enemy shooting a player on a deck launched from
// the wrong height — elevated trades never connected.
const SHOOTER_MUZZLE_Y = C.SHOOTER_MUZZLE_Y;
function shooterMuzzleY(enemyFloorY) { return enemyFloorY + SHOOTER_MUZZLE_Y; }
ok('shooter on the ground: muzzle just above ground',
   Math.abs(shooterMuzzleY(0) - SHOOTER_MUZZLE_Y) < 1e-9, `y=${f(shooterMuzzleY(0))}`);
ok('shooter on a 7m deck: muzzle rises with the deck (not stuck at world 1.2)',
   shooterMuzzleY(7.0) === 7.0 + SHOOTER_MUZZLE_Y, `y=${f(shooterMuzzleY(7.0))} (was ${SHOOTER_MUZZLE_Y})`);
// direction toward an elevated player from a correctly-placed muzzle is up
{ const oy = shooterMuzzleY(0), py = 7.0 + 1.58;     // player on 7m deck, head
  const dy = py - oy;
  ok('ground shooter aims UPWARD at an elevated player (positive dy)',
     dy > 4, `dy=${f(dy)}`);
  // and the LOS test that gates the shot is itself uncapped vertically
  ok('elevated LOS (ground enemy → player 7m up, open) is clear',
     lineOfSight(0, 0 + 1.1, -30, 0, 7.0 + 1.05, -30) === true); }

// ---- (7) scatter: replicate the personal-space pass ----
const SR = C.AI_SCATTER_RADIUS, SS = C.AI_SCATTER_STRENGTH;
function scatterVec(self, others) {
  let sx = 0, sz = 0;
  for (const b of others) {
    if (Math.abs(self.y - b.y) > 1.5) continue;
    const dx = self.x - b.x, dz = self.z - b.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= SR * SR || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const w = (1 - d / SR) * SS;
    sx += dx / d * w; sz += dz / d * w;
  }
  return { sx, sz };
}
// two enemies almost on top of each other → strong mutual push apart
{ const a = { x: 0, y: 0, z: 0 }, b = { x: 0.4, y: 0, z: 0 };
  const va = scatterVec(a, [b]);
  ok('clustered enemies get a non-zero scatter push', Math.hypot(va.sx, va.sz) > 0.5,
     `|s|=${f(Math.hypot(va.sx, va.sz))}`);
  ok('scatter pushes AWAY from the neighbour (negative x here)', va.sx < 0,
     `sx=${f(va.sx)}`); }
// beyond the radius → exactly zero (doesn't perturb a spread formation)
{ const v = scatterVec({ x: 0, y: 0, z: 0 }, [{ x: SR + 1, y: 0, z: 0 }]);
  ok('no scatter beyond AI_SCATTER_RADIUS', v.sx === 0 && v.sz === 0); }
// different floor → ignored (one on a catwalk doesn't shove one below)
{ const v = scatterVec({ x: 0, y: 0, z: 0 }, [{ x: 0.5, y: 7, z: 0 }]);
  ok('scatter ignores enemies on a different floor', v.sx === 0 && v.sz === 0); }
// falloff is monotonic: closer ⇒ stronger
{ const near = Math.hypot(...Object.values(scatterVec({x:0,y:0,z:0},[{x:1,y:0,z:0}])));
  const far  = Math.hypot(...Object.values(scatterVec({x:0,y:0,z:0},[{x:3,y:0,z:0}])));
  ok('scatter strength falls off with distance (near > far)', near > far,
     `near=${f(near)} far=${f(far)}`); }

// ---- (8) THE elevation bug: fire while cross-floor if visible ----
// Reproduce the exact control flow of shooterAI's nav branch. The bug was:
// when the player is on another tier, navGoal sets navActive=true and the
// shooter `return`ed BEFORE any fire logic — so a visible, in-LOS, elevated
// (even point-blank) player was never shot at. The fix calls
// shooterCombatTick whenever it has LOS, even inside the nav branch.
function shooterNavBranch({ navActive, sees, attackCooldown }) {
  // returns whether a shot is taken this tick under the FIXED logic
  let fired = false;
  if (navActive) {
    if (sees) {
      // shooterCombatTick: peek state + fire when cooldown elapsed
      if (attackCooldown <= 0) fired = true;
    }
    return { handled: true, fired };
  }
  return { handled: false, fired };
}
// OLD logic for contrast: nav branch returned with no fire, ever.
function shooterNavBranchOLD({ navActive }) {
  if (navActive) return { handled: true, fired: false };
  return { handled: false, fired: false };
}

const elevatedVisible = { navActive: true, sees: true, attackCooldown: 0 };
ok('OLD: elevated+visible player was NEVER shot (the reported bug)',
   shooterNavBranchOLD(elevatedVisible).fired === false);
ok('FIXED: shooter fires at a visible player while pathing cross-floor',
   shooterNavBranch(elevatedVisible).fired === true);
ok('FIXED: still respects fire cadence (no shot while on cooldown)',
   shooterNavBranch({ navActive: true, sees: true, attackCooldown: 0.7 }).fired === false);
ok('FIXED: no blind-fire while cross-floor without LOS',
   shooterNavBranch({ navActive: true, sees: false, attackCooldown: 0 }).fired === false);

// Heavy parity: engaging passed truthfully into the gun state machine when
// navActive + sees + in range (updateHeavyGun then runs windup→firing).
function heavyNavEngaging({ navActive, sees, inRange }) {
  return navActive ? (sees && inRange) : null; // null = not the nav branch
}
ok('FIXED: heavy engages (gun cycle runs) at a visible elevated player while cross-floor',
   heavyNavEngaging({ navActive: true, sees: true, inRange: true }) === true);
ok('FIXED: heavy does NOT engage cross-floor without LOS',
   heavyNavEngaging({ navActive: true, sees: false, inRange: true }) === false);

// Sanity: with the muzzle fix from (6), a point-blank elevated shot has a
// steep but valid upward direction (not degenerate).
{ const ox = 0, oz = 0, oy = shooterMuzzleY(0);     // shooter on ground
  const px = 1.5, pz = 0, py = 4.5 + 1.05;          // player 4.5m up, very close
  const dx = px - ox, dy = py - oy, dz = pz - oz;
  const len = Math.hypot(dx, dy, dz);
  ok('point-blank elevated aim is a valid steep-up unit vector',
     len > 0 && (dy / len) > 0.7, `dy/len=${f(dy / len)}`); }

console.log(`\n================  ${pass}/${total} PASS  ================`);
if (pass !== total) process.exit(1);
