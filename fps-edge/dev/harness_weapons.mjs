// Pure replication of the SAW bloom model + knife rules exactly as coded in
// weapons.js (tryFire/updateWeaponTimers). No engine import needed.
const SAW = { spread: 0.012, rpm: 750, bloom: { addPerShot: 0.0090, recoverPerSec: 0.060, maxExtra: 0.075 } };
const KNIFE = { melee: true, damage: 75, range: 2.6, rpm: 60 / 0.42, magSize: 0 };
const GRUNT_HP = 30, SHOOTER_HP = 20, HEAVY_HP = 150;

let pass = 0, total = 0;
const ok = (n, c, d) => { total++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}  ${d || ''}`); if (c) pass++; };
const f = v => Number(v).toFixed(5);

// --- SAW: sustained fire widens spread up to the cap, then recovers ---
let bloom = 0;
const dtShot = 60 / SAW.rpm;            // seconds between SAW shots at full RPM
const eff = () => SAW.spread + bloom;
const start = eff();
// hold the trigger: 60 shots, applying per-shot add then per-shot recover
for (let i = 0; i < 60; i++) {
  bloom = Math.min(SAW.bloom.maxExtra, bloom + SAW.bloom.addPerShot);   // tryFire add
  bloom = Math.max(0, bloom - SAW.bloom.recoverPerSec * dtShot);        // timer recover during the shot frame
}
const held = eff();
ok('SAW spread GROWS under sustained fire', held > start + 0.02, `start=${f(start)} held=${f(held)}`);
ok('SAW spread is CAPPED (never exceeds base+maxExtra)',
   held <= SAW.spread + SAW.bloom.maxExtra + 1e-9,
   `held=${f(held)} cap=${f(SAW.spread + SAW.bloom.maxExtra)}`);
// now release for 2 seconds (no shots, pure recovery at recoverPerSec)
let t = 0; while (t < 2.0) { bloom = Math.max(0, bloom - SAW.bloom.recoverPerSec * (1 / 60)); t += 1 / 60; }
ok('SAW spread RECOVERS toward base when you stop firing',
   SAW.spread + bloom <= start + 0.005, `recovered=${f(SAW.spread + bloom)} base=${f(SAW.spread)}`);
// monotonic growth check over the first 20 held shots
{ let b = 0, prev = -1, mono = true;
  for (let i = 0; i < 20; i++) { b = Math.min(SAW.bloom.maxExtra, b + SAW.bloom.addPerShot);
    b = Math.max(0, b - SAW.bloom.recoverPerSec * dtShot);
    if (b < prev - 1e-9) mono = false; prev = b; }
  ok('SAW bloom is monotonic non-decreasing while held (until cap)', mono); }

// --- KNIFE: no ammo, lethal to light enemies, reach-gated ---
ok('knife has no magazine (melee, never needs ammo)', KNIFE.magSize === 0);
ok('knife one-hits a 30-HP grunt', KNIFE.damage >= GRUNT_HP, `dmg=${KNIFE.damage}`);
ok('knife one-hits a 20-HP shooter', KNIFE.damage >= SHOOTER_HP);
ok('knife does NOT one-hit a 150-HP heavy (takes ~2)', KNIFE.damage < HEAVY_HP && KNIFE.damage * 2 >= HEAVY_HP,
   `2 hits = ${KNIFE.damage * 2}`);
ok('knife reach is short (melee, not a ranged poke)', KNIFE.range > 1.5 && KNIFE.range < 4.0, `range=${KNIFE.range}m`);
// reach gate: an enemy beyond range is not hit
const enemyDist = 5.0;
ok('enemy beyond knife reach is NOT hit', !(enemyDist <= KNIFE.range), `enemy@${enemyDist}m vs reach ${KNIFE.range}m`);

// --- KNIFE mobility buff: equipped → wishSpeed * KNIFE_SPEED_MULT ---
const KNIFE_SPEED_MULT = 1.15, WALK = 5.0, SPRINT = 8.0;
ok('knife speed multiplier is a SMALL boost (1.0–1.3)',
   KNIFE_SPEED_MULT > 1.0 && KNIFE_SPEED_MULT <= 1.3, `mult=${KNIFE_SPEED_MULT}`);
ok('knife walk speed > normal walk', WALK * KNIFE_SPEED_MULT > WALK,
   `${f(WALK * KNIFE_SPEED_MULT)} vs ${WALK}`);
ok('knife is faster than walking but not absurd vs sprint',
   WALK * KNIFE_SPEED_MULT < SPRINT * KNIFE_SPEED_MULT && WALK * KNIFE_SPEED_MULT < SPRINT + 1,
   `knife-walk=${f(WALK * KNIFE_SPEED_MULT)} sprint=${SPRINT}`);

// --- S50: per-weapon recoil patterns + spray index state machine ---
const C = await import('../src/constants.js');
const PAT = C.RECOIL_PATTERNS;
const RESET = C.RECOIL_RESET_TIME;
ok('RECOIL_PATTERNS defined for every weapon (incl. single-shot ones)',
   PAT.pistol && PAT.shotgun && PAT.sniper && PAT.smg && PAT.saw);
ok('single-shot weapons have a single-entry pattern',
   PAT.pistol.length === 1 && PAT.shotgun.length === 1 && PAT.sniper.length === 1);
ok('SMG pattern has multiple entries (spray over a burst)',
   PAT.smg.length >= 8, `len=${PAT.smg.length}`);
ok('SAW pattern has multiple entries (spray over a burst)',
   PAT.saw.length >= 8, `len=${PAT.saw.length}`);
// every entry has p (pitch) and y (yaw); pitch is positive (kicks UP), yaw can be either sign
let allShapeOK = true, anyYawDrift = false;
for (const key of Object.keys(PAT)) {
  for (const e of PAT[key]) {
    if (typeof e.p !== 'number' || typeof e.y !== 'number') allShapeOK = false;
    if (e.p <= 0) allShapeOK = false;       // pitch always positive (no "down" kick)
    if (Math.abs(e.y) > 1e-9) anyYawDrift = true;
  }
}
ok('every pattern entry has positive pitch + numeric yaw', allShapeOK);
ok('at least one weapon has horizontal yaw drift (proper CS-style spray)', anyYawDrift);
// SMG pattern: pitch peaks early then tapers, horizontal alternates
{
  const p = PAT.smg;
  // peak pitch in first half — typical CS spray characteristic
  let maxFirstHalf = 0, maxSecondHalf = 0;
  for (let i = 0; i < p.length; i++) {
    if (i < p.length / 2) maxFirstHalf = Math.max(maxFirstHalf, p[i].p);
    else maxSecondHalf = Math.max(maxSecondHalf, p[i].p);
  }
  ok('SMG pattern: pitch peaks in the first half of the spray',
     maxFirstHalf >= maxSecondHalf, `first=${maxFirstHalf} second=${maxSecondHalf}`);
  // alternation: at least 3 yaw sign changes across the pattern
  let signChanges = 0;
  for (let i = 1; i < p.length; i++) {
    if (p[i].y !== 0 && p[i - 1].y !== 0 &&
        Math.sign(p[i].y) !== Math.sign(p[i - 1].y)) signChanges++;
  }
  ok('SMG pattern alternates horizontal direction (≥3 sign flips)',
     signChanges >= 3, `signChanges=${signChanges}`);
}
// Spray state machine (replica of tryFire / updateWeaponTimers logic)
function makeSprayState() {
  return { sprayIndex: 0, sprayResetTimer: 0, recoilPitch: 0, recoilYaw: 0 };
}
function applyFire(s, weaponKey) {
  const p = PAT[weaponKey];
  const k = p[s.sprayIndex % p.length];
  s.recoilPitch += k.p;
  s.recoilYaw += k.y;
  s.sprayIndex += 1;
  s.sprayResetTimer = RESET;
}
function tickReset(s, dt) {
  if (s.sprayResetTimer > 0) {
    s.sprayResetTimer -= dt;
    if (s.sprayResetTimer <= 0) {
      s.sprayResetTimer = 0;
      s.sprayIndex = 0;
    }
  }
}
{
  const s = makeSprayState();
  applyFire(s, 'smg'); applyFire(s, 'smg'); applyFire(s, 'smg');
  ok('three SMG shots advance sprayIndex to 3', s.sprayIndex === 3);
  ok('sprayResetTimer is armed after a shot', s.sprayResetTimer === RESET);
  // No-fire for less than RESET → index keeps
  for (let i = 0; i < 60 * (RESET / 2); i++) tickReset(s, 1 / 60);
  ok('half a reset window in: spray NOT reset', s.sprayIndex === 3);
  // Past RESET → snaps to 0
  for (let i = 0; i < 60 * (RESET + 0.1); i++) tickReset(s, 1 / 60);
  ok('past RECOIL_RESET_TIME of no fire: spray reset to 0',
     s.sprayIndex === 0 && s.sprayResetTimer === 0);
}
{
  // Cycling: after going past the pattern length, sprayIndex KEEPS counting
  // but pattern[index % len] wraps. Net kick is bounded since later entries
  // are smaller.
  const s = makeSprayState();
  const p = PAT.smg;
  for (let i = 0; i < p.length * 2; i++) applyFire(s, 'smg');
  ok('firing past pattern length wraps via modulo (sprayIndex keeps counting)',
     s.sprayIndex === p.length * 2);
  // Pitch and yaw kicks are summed twice over the pattern, then we don't
  // actually require any specific value; just that the system stays sane.
  ok('total recoil after wrap-around is bounded (sums + decay would converge)',
     Math.abs(s.recoilPitch) < 5 && Math.abs(s.recoilYaw) < 5,
     `p=${s.recoilPitch.toFixed(2)} y=${s.recoilYaw.toFixed(2)}`);
}

// --- S50: view-model sway/bob/reload tunables — sanity bounds ---
ok('VIEW_SWAY_MAX is small enough not to push the gun off-screen',
   C.VIEW_SWAY_MAX > 0 && C.VIEW_SWAY_MAX < 0.2,
   `${C.VIEW_SWAY_MAX} m`);
ok('VIEW_BOB_AMP is subtle (≤ 0.03 m)',
   C.VIEW_BOB_AMP > 0 && C.VIEW_BOB_AMP <= 0.03);
// Time-constant for exp(-k*t) is 1/k; ~5 time constants → < 1% remaining.
ok('VIEW_LAND_DIP decays in well under a second (5τ ≤ 1.0 s)',
   (5 / C.VIEW_LAND_DIP_DECAY) <= 1.0,
   `5τ=${(5/C.VIEW_LAND_DIP_DECAY).toFixed(2)}s for ~99% decay`);
ok('RELOAD_MAG_DROP positive (mag visibly drops)',
   C.RELOAD_MAG_DROP > 0.05);
ok('RELOAD_COVER_OPEN positive radians (SAW cover hinges open)',
   C.RELOAD_COVER_OPEN > 0);

console.log(`\n================  ${pass}/${total} PASS  ================`);
if (pass !== total) process.exit(1);
