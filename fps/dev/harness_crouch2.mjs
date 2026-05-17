// Drives the SHIPPED collision.js headroomClear against the REAL arena
// solids through a faithful replica of the NEW smooth, auto-stand crouch
// (no latch). Also computes the near-plane geometry that the see-through fix
// relies on.

import { makeBoxSolid, makeRampSolid, headroomClear }
  from '../src/collision.js';

makeBoxSolid(-30, 30, -2, 0, -30, 30);          // floor (top y=0)
makeRampSolid('z', -4, -20, 0, 4, -4, 4, 0.6);  // ramp slab
makeBoxSolid(6, 9, 0, 3, 4, 7);                 // wall 1
makeBoxSolid(-12, -4, 0, 2.5, 6, 7);            // wall 2

const EYE_STAND = 1.6, EYE_CROUCH = 1.2, PLAYER_R = 0.4;
const STAND_H = EYE_STAND + 0.1;   // 1.7
const CROUCH_H = EYE_CROUCH + 0.1; // 1.3
const RATE = 10.0;                 // CROUCH_TRANSITION_RATE
const DT = 1 / 60;

// Faithful replica of the player.js crouch block (the parts under test).
function stepCrouch(st, ctrl) {
  const crouchKey = !!ctrl;
  let wantCrouch;
  if (crouchKey) {
    wantCrouch = true;
  } else {
    const canStand = headroomClear(st.x, st.feetY, st.z, PLAYER_R, STAND_H);
    wantCrouch = !canStand;
  }
  st.isCrouching = wantCrouch;
  const targetT = wantCrouch ? 1 : 0;
  const step = RATE * DT;
  if (st.crouchT < targetT) st.crouchT = Math.min(targetT, st.crouchT + step);
  else if (st.crouchT > targetT) st.crouchT = Math.max(targetT, st.crouchT - step);
  st.bodyH = STAND_H + (CROUCH_H - STAND_H) * st.crouchT;
  st.eyeH  = EYE_STAND + (EYE_CROUCH - EYE_STAND) * st.crouchT;
}
function newSt(x, z) {
  return { x, z, feetY: 0, isCrouching: false, crouchT: 0,
           bodyH: STAND_H, eyeH: EYE_STAND };
}
let pass = 0, total = 0;
function expect(name, cond, detail) {
  total++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`);
  if (cond) pass++;
}
const f = (n, p = 4) => Number(n).toFixed(p);

// Frames to drive crouchT from a to b at RATE.
function framesFor(a, b) { return Math.ceil(Math.abs(b - a) / (RATE * DT)); }

console.log(`--- transition speed (RATE=${RATE}, dt=${f(DT,5)}) ---`);
console.log(`    full stance change = ${framesFor(0,1)} frames ` +
  `= ${f(framesFor(0,1)*DT,3)} s  (not instant; very fast)`);
expect('not instant (more than 1 frame)', framesFor(0,1) > 1, `${framesFor(0,1)} frames`);
expect('very fast (<= 0.15 s)', framesFor(0,1)*DT <= 0.15 + 1e-9, `${f(framesFor(0,1)*DT,3)} s`);

console.log('\n--- S1: hold Ctrl in open → smooth crouch 0→1 ---');
{
  const st = newSt(0, 0);
  let maxEyeStep = 0, prevEye = st.eyeH;
  for (let i = 0; i < 12; i++) {
    stepCrouch(st, true);
    maxEyeStep = Math.max(maxEyeStep, Math.abs(prevEye - st.eyeH));
    prevEye = st.eyeH;
  }
  expect('S1 reaches fully crouched', Math.abs(st.crouchT - 1) < 1e-9,
    `crouchT=${f(st.crouchT)} eyeH=${f(st.eyeH)}`);
  expect('S1 per-frame eye move is gradual (< full 0.40 m jump)',
    maxEyeStep < 0.40 && maxEyeStep > 0,
    `maxEyeStep=${f(maxEyeStep)} m/frame (instant would be 0.40)`);
}

console.log('\n--- S2: crouch under slab z=-8 (no standing room), release Ctrl → STAY crouched ---');
const s2 = newSt(0, 0);
{
  for (let i = 0; i < 8; i++) stepCrouch(s2, true);  // crouch in open
  s2.z = -8;                                          // walked under slab
  for (let i = 0; i < 4; i++) stepCrouch(s2, true);   // hold under slab
  expect('S2 fully crouched under slab', Math.abs(s2.crouchT - 1) < 1e-9, `crouchT=${f(s2.crouchT)}`);
  for (let i = 0; i < 30; i++) stepCrouch(s2, false); // RELEASE, stay put (no room)
  expect('S2 released, no headroom → stays crouched',
    s2.isCrouching === true && Math.abs(s2.crouchT - 1) < 1e-9,
    `crouchT=${f(s2.crouchT)}`);
}

console.log('\n--- S3: from S2, walk to open (z=0) WITHOUT pressing Ctrl → AUTO-STAND ---');
{
  s2.z = 0;                              // moved into clearance, Ctrl still up
  const need = framesFor(1, 0);
  for (let i = 0; i < need; i++) stepCrouch(s2, false);
  expect('S3 auto-stood (no key press) once in clear space',
    s2.isCrouching === false && Math.abs(s2.crouchT - 0) < 1e-9,
    `crouchT=${f(s2.crouchT)} after ${need} frames (${f(need*DT,3)} s)`);
}

console.log('\n--- S4: crouch deep under slab z=-15 (standing fits), release → auto-stand ---');
{
  const st = newSt(0, 0);
  for (let i = 0; i < 8; i++) stepCrouch(st, true);
  st.z = -15;
  for (let i = 0; i < 4; i++) stepCrouch(st, true);
  expect('S4 crouched at z=-15', Math.abs(st.crouchT - 1) < 1e-9, `crouchT=${f(st.crouchT)}`);
  for (let i = 0; i < framesFor(1,0); i++) stepCrouch(st, false);
  expect('S4 standing headroom exists here → auto-stands',
    st.isCrouching === false && Math.abs(st.crouchT) < 1e-9, `crouchT=${f(st.crouchT)}`);
}

console.log('\n--- S5: continuity — eye height never jumps the full delta in one frame ---');
{
  const st = newSt(2, 2);
  let maxStep = 0, prev = st.eyeH;
  // crouch, then stand, then crouch again
  for (let i = 0; i < 10; i++) { stepCrouch(st, true);  maxStep = Math.max(maxStep, Math.abs(prev-st.eyeH)); prev=st.eyeH; }
  for (let i = 0; i < 10; i++) { stepCrouch(st, false); maxStep = Math.max(maxStep, Math.abs(prev-st.eyeH)); prev=st.eyeH; }
  for (let i = 0; i < 10; i++) { stepCrouch(st, true);  maxStep = Math.max(maxStep, Math.abs(prev-st.eyeH)); prev=st.eyeH; }
  const perFrame = Math.abs(EYE_STAND-EYE_CROUCH) * RATE * DT;
  expect('S5 max single-frame eye move == rate-limited step (not a teleport)',
    Math.abs(maxStep - perFrame) < 1e-9,
    `maxStep=${f(maxStep,5)} expected=${f(perFrame,5)} (full delta=${f(Math.abs(EYE_STAND-EYE_CROUCH))})`);
}

console.log('\n--- S6: regression — open-space crouch/stand cycles, never sticks ---');
{
  const st = newSt(5, 5);
  let stuck = false;
  for (let c = 0; c < 5; c++) {
    for (let i = 0; i < 8; i++) stepCrouch(st, true);
    if (Math.abs(st.crouchT - 1) > 1e-9) stuck = true;
    for (let i = 0; i < 8; i++) stepCrouch(st, false);
    if (Math.abs(st.crouchT - 0) > 1e-9) stuck = true; // must always return to standing
  }
  expect('S6 always returns to standing in the open (never sticks)', stuck === false,
    `final crouchT=${f(st.crouchT)} isCrouching=${st.isCrouching}`);
}

console.log('\n--- S7: headroomClear standing boundary unchanged (collision.js intact) ---');
expect('z=-8 blocked', headroomClear(0,0,-8,PLAYER_R,STAND_H) === false);
expect('z=-13 blocked', headroomClear(0,0,-13,PLAYER_R,STAND_H) === false);
expect('z=-13.2 clear (boundary = -13.20, matches Sessions 21–22)',
  headroomClear(0,0,-13.2,PLAYER_R,STAND_H) === true);
expect('z=-15 clear', headroomClear(0,0,-15,PLAYER_R,STAND_H) === true);

console.log('\n--- Near-plane see-through proof (geometry) ---');
{
  // Ramp underside: underY(z) = topY - THICK = (m*z+b) - 0.6, m=-0.25, b=-1.
  // Crouched hard against it, rampOverheadClip clamps head = underY, so
  // eye = head - (CROUCH_H - EYE_CROUCH) = underY - (1.3 - 1.2) = underY-0.1.
  const vGap = CROUCH_H - EYE_CROUCH;            // 0.10 m vertical eye→underside
  const slopeAngle = Math.atan(0.25);            // ramp tilt
  const perp = vGap * Math.cos(slopeAngle);      // shortest eye→slab distance
  const oldNear = 0.10, newNear = 0.05;
  console.log(`    vertical eye→underside gap = ${f(vGap)} m`);
  console.log(`    slab tilt = ${f(slopeAngle*180/Math.PI,2)}°  → perpendicular distance = ${f(perp,5)} m`);
  console.log(`    old near=${oldNear}  new near=${newNear}`);
  expect('old near 0.10 m clipped the slab (0.10 > perp)', oldNear > perp,
    `${oldNear} > ${f(perp,5)} → see-through`);
  expect('new near 0.05 m does NOT clip (0.05 < perp)', newNear < perp,
    `${newNear} < ${f(perp,5)} → solid`);
}

console.log(`\n================  ${pass}/${total} PASS  ================`);
if (pass !== total) process.exit(1);
