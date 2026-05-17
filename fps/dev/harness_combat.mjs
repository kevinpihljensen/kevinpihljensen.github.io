// Part 1: the new crouch gating (real shipped headroomClear + real arena)
//          — standing near the ramp side must NOT auto-crouch.
// Part 2: weapon kill matrix vs the three enemies (body + headshot), using
//          the exact shipped WEAPON_DEFS numbers, plus shotgun head-pellet
//          expectation vs distance for the new spread vs the old.

import { makeBoxSolid, makeRampSolid, headroomClear }
  from '../src/collision.js';

makeBoxSolid(-30, 30, -2, 0, -30, 30);          // floor
makeRampSolid('z', -4, -20, 0, 4, -4, 4, 0.6);  // ramp slab (x in [-4,4])
makeBoxSolid(6, 9, 0, 3, 4, 7);
makeBoxSolid(-12, -4, 0, 2.5, 6, 7);

const EYE_STAND = 1.6, EYE_CROUCH = 1.2, PLAYER_R = 0.4;
const STAND_H = EYE_STAND + 0.1, CROUCH_H = EYE_CROUCH + 0.1;
const RATE = 10.0, DT = 1 / 60;

// Exact replica of the SHIPPED player.js wantCrouch gating.
function wantCrouch(st, ctrl) {
  if (ctrl) return true;
  if (st.crouchT > 0) {
    return !headroomClear(st.x, st.feetY, st.z, PLAYER_R, STAND_H);
  }
  return false;                       // fully standing, no Ctrl → never auto-crouch
}
function stepCrouch(st, ctrl) {
  const wc = wantCrouch(st, ctrl);
  st.isCrouching = wc;
  const t = wc ? 1 : 0, s = RATE * DT;
  if (st.crouchT < t) st.crouchT = Math.min(t, st.crouchT + s);
  else if (st.crouchT > t) st.crouchT = Math.max(t, st.crouchT - s);
}
const mk = (x, z) => ({ x, z, feetY: 0, crouchT: 0, isCrouching: false });

let pass = 0, total = 0;
const ok = (n, c, d) => { total++; console.log(`  ${c?'PASS':'FAIL'}  ${n}  ${d||''}`); if (c) pass++; };
const f = (n,p=2) => Number(n).toFixed(p);

console.log('================ PART 1: auto-crouch-from-side fix ================');
// Ramp footprint: x in [-4,4], z in [-20,-4]; expanded by PLAYER_R=0.4 in
// headroomClear. The "side near the start" = beside the low end, e.g.
// x≈4.2 (just inside the +x edge+r), z≈-6 (slab is low here).
console.log('headroomClear(standing) at the side-of-start spot x=4.2 z=-6:',
  headroomClear(4.2, 0, -6, PLAYER_R, STAND_H));
{
  // BUG REPRODUCTION (old logic = !headroomClear regardless of stance):
  const oldWouldCrouch = !headroomClear(4.2, 0, -6, PLAYER_R, STAND_H);
  console.log(`  (old logic here would have forced crouch = ${oldWouldCrouch})`);

  const st = mk(4.2, -6);             // standing, never pressed Ctrl
  for (let i = 0; i < 30; i++) stepCrouch(st, false);
  ok('standing at ramp side/start, no Ctrl → stays standing (no auto-crouch)',
    st.isCrouching === false && st.crouchT === 0,
    `crouchT=${f(st.crouchT)} isCrouching=${st.isCrouching}`);

  // Walk along the side through the whole low->mid start region, never Ctrl.
  let everCrouched = false;
  const s2 = mk(4.2, -4);
  for (let z = -4; z >= -14; z -= 0.25) {
    s2.z = z; stepCrouch(s2, false);
    if (s2.isCrouching || s2.crouchT > 0) everCrouched = true;
  }
  ok('walking the entire ramp side standing, no Ctrl → never auto-crouches',
    everCrouched === false);
}
{
  // Regression: crouch under the slab (Ctrl), release under it → stays
  // crouched; then walk to open → auto-stands.
  const st = mk(0, 0);
  for (let i=0;i<8;i++) stepCrouch(st, true);     // crouch in open
  st.z = -8;                                       // under slab
  for (let i=0;i<4;i++) stepCrouch(st, true);
  for (let i=0;i<20;i++) stepCrouch(st, false);    // release, no room
  ok('crouched under slab, release → stays crouched (regression intact)',
    st.isCrouching === true && st.crouchT === 1);
  st.z = 0;                                        // walk to open
  for (let i=0;i<8;i++) stepCrouch(st, false);
  ok('then walk to open → AUTO-stands (regression intact)',
    st.isCrouching === false && st.crouchT === 0);
}

console.log('\n================ PART 2: weapon kill matrix ================');
const ENEMIES = { Grunt: 30, Shooter: 20, Heavy: 150 };
const W = {
  pistol:  { dmg: 20,  hs: 1.25, pellets: 1 },
  smg:     { dmg: 12,  hs: 1.5,  pellets: 1 },
  sniper:  { dmg: 120, hs: 2.5,  pellets: 1 },
  shotgun: { dmg: 8,   hs: 2.0,  pellets: 8 },
};
const shotsToKill = (hp, perShot) => (perShot <= 0 ? Infinity : Math.ceil(hp / perShot));

console.log('\nSingle-projectile weapons — shots to kill (BODY / HEADSHOT):');
console.log('  weapon   | Grunt(30)   | Shooter(20) | Heavy(150)');
for (const wn of ['pistol','smg','sniper']) {
  const w = W[wn];
  const row = [];
  for (const en of ['Grunt','Shooter','Heavy']) {
    const hp = ENEMIES[en];
    row.push(`${shotsToKill(hp, w.dmg)} / ${shotsToKill(hp, w.dmg*w.hs)}`.padEnd(11));
  }
  console.log(`  ${wn.padEnd(8)} | ${row.join(' | ')}   (dmg ${w.dmg}, hsx${w.hs} = ${w.dmg*w.hs} headshot)`);
}

console.log('\nRequirement checks:');
ok('Sniper headshot 1-shots Grunt',  shotsToKill(30,120*2.5)===1);
ok('Sniper headshot 1-shots Shooter',shotsToKill(20,120*2.5)===1);
ok('Sniper headshot 1-shots Heavy (150) — the binding case',
  shotsToKill(150,120*2.5)===1, `headshot dmg=${120*2.5} >= 150`);
ok('Pistol headshot 2-shots Grunt (not 1)',
  shotsToKill(30,20*1.25)===2, `25/headshot → ${shotsToKill(30,25)} shots`);
ok('Pistol headshot does NOT 2-shot Heavy',
  shotsToKill(150,20*1.25) > 2, `${shotsToKill(150,25)} headshots`);
ok('Pistol headshot kills Shooter in <=2 (1, weakest enemy — reported)',
  shotsToKill(20,20*1.25) <= 2, `${shotsToKill(20,25)} headshot`);
ok('SMG headshot 2-shots Grunt',  shotsToKill(30,12*1.5)===2, `18/hs → ${shotsToKill(30,18)}`);
ok('SMG headshot 2-shots Shooter',shotsToKill(20,12*1.5)===2, `18/hs → ${shotsToKill(20,18)}`);
ok('SMG headshot does NOT 2-shot Heavy', shotsToKill(150,12*1.5) > 2, `${shotsToKill(150,18)} headshots`);

console.log('\nShotgun — expected pellets on the head vs distance (aimed at head),');
console.log('pellets uniform-in-area within radius d·tan(spread); head radius ≈ 0.20 m,');
console.log('8 pellets, headshot pellet = 8·2.0 = 16 dmg:');
const headR = 0.20, pellets = 8;
function shotgunRow(spread) {
  const tan = Math.tan(spread);
  const out = [];
  for (const d of [2,4,6,8,10]) {
    const R = d * tan;
    const fracOnHead = R <= headR ? 1 : (headR / R) ** 2;
    const eHead = pellets * fracOnHead;
    const headDmg = eHead * W.shotgun.dmg * W.shotgun.hs;
    out.push(`d=${d}m: ${f(eHead,1)}plt ${f(headDmg,0)}dmg`);
  }
  return out.join('  |  ');
}
console.log(`  OLD spread 0.17 : ${shotgunRow(0.17)}`);
console.log(`  NEW spread 0.06 : ${shotgunRow(0.06)}`);
{
  // New spread should put clearly more pellets on the head at mid range and
  // be lethal to a Grunt(30) at close range, weak far — i.e. distance-dependent.
  const tanNew = Math.tan(0.06), tanOld = Math.tan(0.17);
  const eHeadNew5 = pellets * Math.min(1, (headR/(5*tanNew))**2);
  const eHeadOld5 = pellets * Math.min(1, (headR/(5*tanOld))**2);
  ok('new spread lands many more head pellets at 5 m than old',
    eHeadNew5 > eHeadOld5 * 3, `new=${f(eHeadNew5,2)} vs old=${f(eHeadOld5,2)}`);
  const closeHeadDmg = pellets * Math.min(1,(headR/(2*tanNew))**2) * 8 * 2.0;
  ok('close-range (2 m) shotgun headshot kills a Grunt (30)',
    closeHeadDmg >= 30, `~${f(closeHeadDmg,0)} dmg`);
  const farHeadDmg = pellets * Math.min(1,(headR/(10*tanNew))**2) * 8 * 2.0;
  ok('far (10 m) shotgun headshot does NOT 1-shot a Grunt (distance-dependent)',
    farHeadDmg < 30, `~${f(farHeadDmg,0)} dmg at 10 m`);
}

console.log(`\n================  ${pass}/${total} PASS  ================`);
if (pass !== total) process.exit(1);
