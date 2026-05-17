// Rebuilds the SHOWCASE solids using the SHIPPED collision.js primitives and
// the SAME connection math kit.js uses (solveConnection replicated verbatim),
// then samples the real groundHeightAt / collideCapsule to prove:
//   * ramp/stairs → platform joins are seamless (continuous, no lip/gap/bump)
//   * stairs behave EXACTLY like a ramp (smooth, no per-step riser wall)
//   * deck→deck ramp is seamless at BOTH ends
//   * boxes are walkable + block; walls block; overhang interacts correctly

import { makeBoxSolid, makeRampSolid, groundHeightAt, collideCapsule, headroomClear }
  from '../src/collision.js';

const R = 0.4, BODY = 1.7, BIG = 1e6, STEP_UP = 0.55;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// --- replica of kit.js solveConnection (verbatim) ---
function solveConnection(P, side, run, width, fromY) {
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
function mkPlatform(cx, cz, top, sx, sz, thick = 0.6) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  makeBoxSolid(x0, x1, top - thick, top, z0, z1);
  return { top, x0, x1, z0, z1, cx, cz };
}
function mkConnector(P, side, run, width, fromY, thick = 0.6) {
  const c = solveConnection(P, side, run, width, fromY);
  makeRampSolid(c.axis, c.loPos, c.hiPos, c.loY, c.hiY, c.c0, c.c1, thick, { skirtSolid: true });
  return c;
}

// --- build the EXACT showcase solids ---
makeBoxSolid(-40, 40, -2, 0, -40, 40);                       // ground
const LP = mkPlatform(16, -14, 2.5, 14, 14);
const HP = mkPlatform(16, -28, 5.0, 10, 8);
const cRamp   = mkConnector(LP, '+z', 7, 5, 0);              // ground → LP ramp
const cStairs = mkConnector(LP, '-x', 7, 5, 0);             // ground → LP stairs
const cDeck   = mkConnector(HP, '+z', 6, 5, LP.top);        // LP → HP ramp
makeBoxSolid(-11.3, -8.7, 0, 2.0, -7.3, -4.7);              // tall cover box
makeBoxSolid(-21, -11, 0, 3, -16.3, -15.7);                 // wall
makeRampSolid('z', 6, 22, 0, 4, -26, -20, 0.6);             // overhang slab

let pass = 0, total = 0;
const ok = (n, c, d) => { total++; console.log(`  ${c?'PASS':'FAIL'}  ${n}  ${d||''}`); if (c) pass++; };
const f = (n,p=4) => Number(n).toFixed(p);

// Walk a straight line sampling groundHeightAt; report continuity stats.
function walk(fixedAxis, fixed, varFrom, varTo, ds, expectTop) {
  const n = Math.round(Math.abs(varTo - varFrom) / ds);
  const step = (varTo - varFrom) / n;
  let prev = null, maxJump = 0, anyNull = false, maxAbove = -Infinity, endH = null;
  for (let i = 0; i <= n; i++) {
    const v = varFrom + i * step;
    const x = fixedAxis === 'x' ? fixed : v;
    const z = fixedAxis === 'x' ? v : fixed;
    const h = groundHeightAt(x, z, BIG, R);
    if (h === null) { anyNull = true; continue; }
    if (prev !== null) maxJump = Math.max(maxJump, Math.abs(h - prev));
    if (expectTop !== undefined) maxAbove = Math.max(maxAbove, h - expectTop);
    prev = h; endH = h;
  }
  return { maxJump, anyNull, maxAbove, endH };
}

console.log('=== 1. Ramp ground→LP (walk along x=16, z: +1 → -10) ===');
{
  // ramp run z∈[-7,0], slope = LP.top/run = 2.5/7 ≈ 0.357 per metre
  const slope = LP.top / 7, ds = 0.1;
  const r = walk('x', 16, 1, -10, ds, LP.top);
  ok('never returns null along the path', r.anyNull === false);
  ok('no sudden step (max jump ≤ slope·ds + eps, i.e. smooth)',
    r.maxJump <= slope * ds + 1e-6, `maxJump=${f(r.maxJump)} limit=${f(slope*ds,4)}`);
  ok('never rises above the deck top (no bump at the seam)',
    r.maxAbove <= 1e-6, `maxAbove=${f(r.maxAbove,6)}`);
  ok('ends exactly on the deck at LP.top',
    Math.abs(r.endH - LP.top) < 1e-6, `endH=${f(r.endH)} LP.top=${LP.top}`);
  // Seam window: ramp side vs deck side must be coplanar.
  const hRamp = groundHeightAt(16, -6.99, BIG, R);   // on ramp, ~edge
  const hEdge = groundHeightAt(16, -7.00, BIG, R);   // exactly the edge
  const hDeck = groundHeightAt(16, -7.01, BIG, R);   // on deck
  ok('seam coplanar (ramp≈edge≈deck within 0.05 m)',
    Math.max(Math.abs(hRamp-hEdge), Math.abs(hEdge-hDeck), Math.abs(hRamp-LP.top)) < 0.05,
    `ramp=${f(hRamp)} edge=${f(hEdge)} deck=${f(hDeck)}`);
}

console.log('\n=== 2. Stairs ground→LP (walk along z=-14, x: +1 → +11) — must equal a ramp ===');
{
  const slope = LP.top / 7, ds = 0.1;
  const r = walk('z', -14, 1, 11, ds, LP.top);
  ok('never null', r.anyNull === false);
  ok('NO per-step riser wall — max jump ≪ STEP_UP (smooth like a ramp)',
    r.maxJump < STEP_UP * 0.25 && r.maxJump <= slope*ds + 1e-6,
    `maxJump=${f(r.maxJump)} (STEP_UP=${STEP_UP})`);
  ok('ends exactly at LP.top (clean transition onto deck)',
    Math.abs(r.endH - LP.top) < 1e-6, `endH=${f(r.endH)}`);
  // The stair collision is one makeRampSolid wedge → identical profile to a
  // ramp of the same span. Verify the mid-span height matches the analytic
  // ramp surface (proves smooth, not stepped, collision).
  const m = (cStairs.hiY - cStairs.loY) / (cStairs.hiPos - cStairs.loPos);
  const b = cStairs.loY - m * cStairs.loPos;
  let maxErr = 0;
  for (let x = 2.2; x <= 8.8; x += 0.2) {
    const expect = m * x + b;
    const got = groundHeightAt(x, -14, BIG, R);
    maxErr = Math.max(maxErr, Math.abs(got - expect));
  }
  ok('collision tracks the smooth ramp surface (not steps)',
    maxErr < 0.12, `max surface error=${f(maxErr)} m (radius-sample tolerance)`);
}

console.log('\n=== 3. Deck→deck ramp LP→HP (x=16, z: -16 → -26) — seamless BOTH ends ===');
{
  const slope = (HP.top - LP.top) / 6, ds = 0.1;
  const r = walk('x', 16, -16, -26, ds, HP.top);
  ok('never null', r.anyNull === false);
  ok('no sudden step (smooth)', r.maxJump <= slope*ds + 1e-6,
    `maxJump=${f(r.maxJump)} limit=${f(slope*ds,4)}`);
  ok('never above HP.top (no bump)', r.maxAbove <= 1e-6, `maxAbove=${f(r.maxAbove,6)}`);
  ok('ends exactly at HP.top', Math.abs(r.endH - HP.top) < 1e-6, `endH=${f(r.endH)}`);
  const foot = groundHeightAt(16, -18, BIG, R);     // ramp foot, sits on LP
  // Correct seamless invariant for a deck→deck ramp foot: the surface must
  // LEAVE the deck going UP — never below LP.top (no dip/gap), and at most
  // the radius-sample reach above it (it rises immediately, no step). The
  // continuity test above already proved there is no discontinuity here.
  const slopeD = (HP.top - LP.top) / 6;
  const reach = R * 0.7;                              // groundHeightAt sample reach
  ok('FOOT seamless with LP (rises from LP.top, no dip, no step)',
    foot >= LP.top - 1e-6 && foot <= LP.top + slopeD * reach + 1e-6,
    `foot=${f(foot)} ∈ [${LP.top}, ${f(LP.top + slopeD*reach)}]`);
  // Explicit no-dip / no-notch scan across the LP↔ramp boundary.
  let minOverlap = Infinity;
  for (let z = -16; z >= -22; z -= 0.05) {
    const h = groundHeightAt(16, z, BIG, R);
    if (h !== null) minOverlap = Math.min(minOverlap, h);
  }
  ok('no dip below LP.top anywhere across the LP↔ramp boundary',
    minOverlap >= LP.top - 1e-6, `min=${f(minOverlap)} LP.top=${LP.top}`);
  const onHP = groundHeightAt(16, -25, BIG, R);     // past HP edge
  ok('TOP seamless with HP (== HP.top past the edge)',
    Math.abs(onHP - HP.top) < 1e-6, `onHP=${f(onHP)}`);
}

console.log('\n=== 4. Box: walkable top + blocks the body ===');
{
  const topH = groundHeightAt(-10, -6, BIG, R);     // over the tall box centre
  ok('box top is walkable (groundHeightAt = 2.0)',
    Math.abs(topH - 2.0) < 1e-6, `top=${f(topH)}`);
  // Try to stand inside the box footprint at body height → must be pushed out.
  const res = collideCapsule(-10, 0, -6, R, BODY);
  const insideX = res.x > -11.3 && res.x < -8.7;
  const insideZ = res.z > -7.3 && res.z < -4.7;
  ok('walking into the box is blocked (capsule pushed out of footprint)',
    !(insideX && insideZ), `resolved to x=${f(res.x)} z=${f(res.z)}`);
}

console.log('\n=== 5. Wall blocks the body ===');
{
  const res = collideCapsule(-16, 0, -16, R, BODY);  // inside wall footprint
  const insideX = res.x > -21 && res.x < -11;
  const insideZ = res.z > -16.3 && res.z < -15.7;
  ok('walking into the wall is blocked', !(insideX && insideZ),
    `resolved to x=${f(res.x)} z=${f(res.z)}`);
}

console.log('\n=== 6. Overhang: stand on floor under it; standing blocked where low ===');
{
  // Under the slab at z=14 (mid): you stand on the FLOOR (0), not the slab.
  const gUnder = groundHeightAt(-23, 14, 1.0, R);   // low maxY → only floor
  ok('you stand on the floor under the overhang (≈0)',
    Math.abs(gUnder - 0) < 1e-6, `g=${f(gUnder)}`);
  // overhang run z∈[6,22], loY0→hiY4, THICK0.6 → underY(z)=m*z+b-0.6,
  // m=4/16=0.25, b=0-0.25*6=-1.5 → underY = 0.25z -1.5 -0.6.
  const standLow = headroomClear(-23, 0, 9, R, BODY);   // z=9: low slab
  const standHigh = headroomClear(-23, 0, 21, R, BODY); // z=21: high slab
  ok('standing blocked where the slab is low (z=9)', standLow === false);
  ok('standing clears where the slab is high (z=21)', standHigh === true,
    `(underside high enough for a standing capsule)`);
}

console.log('\n=== 7. Spawn area stays open (floor present at origin) ===');
{
  const g = groundHeightAt(0, 0, BIG, R);
  ok('origin is open floor (groundHeightAt = 0, nothing on the spawn)',
    g !== null && Math.abs(g - 0) < 1e-6, `g=${g === null ? 'null' : f(g)}`);
}

console.log('\n=== 8. Solid connectors are ONE whole solid (clip-through fix) ===');
{
  // Deck→deck ramp LP→HP: skirtSolid. Its foot is at y=2.5 on LP and it
  // rises to 5.0; the wedge mass extends down to y=0. At GROUND level
  // (feetY=0) beside/under that elevated mass you must now be BLOCKED
  // (previously you clipped straight through the "box part").
  // The deck→deck ramp runs x=16, z∈[-26,-16], cross x∈[13.5,18.5].
  const inX = 16, deepZ = -22;            // well inside the elevated wedge
  const surf = groundHeightAt(inX, deepZ, BIG, R);   // ramp surface here (~4)
  const before = { x: inX, z: deepZ };
  const res = collideCapsule(inX, 0, deepZ, R, BODY);  // standing at ground
  const movedOut = Math.hypot(res.x - before.x, res.z - before.z) > 0.05;
  ok('at ground level the elevated connector skirt BLOCKS the body (no clip-through)',
    movedOut, `surf≈${f(surf)} pushed to x=${f(res.x)} z=${f(res.z)} (Δ=${f(Math.hypot(res.x-before.x,res.z-before.z))})`);

  // Climbing is unaffected: feet ON the slope (groundHeightAt) → not "inside"
  // → no body push, so you still walk up smoothly.
  const climbZ = -20;
  const sY = groundHeightAt(inX, climbZ, BIG, R);     // surface to stand on
  const onSlope = collideCapsule(inX, sY, inX === 16 ? climbZ : climbZ, R, BODY);
  const stayed = Math.hypot(onSlope.x - inX, onSlope.z - climbZ) < 1e-6;
  ok('standing ON the connector slope is NOT pushed (still climbable)',
    stayed, `feet=${f(sY)} stays x=${f(onSlope.x)} z=${f(onSlope.z)}`);

  // Ground→LP ramp (skirtSolid, foot at y=0): walking UP from the foot must
  // still work — at the foot the surface ≈ feet so no spurious block.
  const footS = groundHeightAt(16, -1, BIG, R);       // just onto the ramp
  const atFoot = collideCapsule(16, footS, -1, R, BODY);
  ok('ground→LP ramp foot is walk-onto (no spurious block at the start)',
    Math.hypot(atFoot.x - 16, atFoot.z + 1) < 1e-6,
    `feet=${f(footS)} x=${f(atFoot.x)} z=${f(atFoot.z)}`);

  // The overhang (NON-skirtSolid) must STILL allow walk-under: standing
  // under its high end is clear (verified in section 6); confirm the body
  // is NOT ejected there (walk-under preserved, not turned into a wall).
  const ohRes = collideCapsule(-23, 0, 21, R, BODY);  // under the high end
  ok('overhang still allows walk-under (non-skirtSolid unchanged)',
    Math.hypot(ohRes.x + 23, ohRes.z - 21) < 0.5,
    `x=${f(ohRes.x)} z=${f(ohRes.z)} (not ejected)`);
}

console.log('\n=== 7. Spawn area stays open (floor present at origin) ===');
{
  const g = groundHeightAt(0, 0, BIG, R);
  ok('origin is open floor (groundHeightAt = 0, nothing on the spawn)',
    g !== null && Math.abs(g - 0) < 1e-6, `g=${g === null ? 'null' : f(g)}`);
}

console.log(`\n================  ${pass}/${total} PASS  ================`);
if (pass !== total) process.exit(1);
