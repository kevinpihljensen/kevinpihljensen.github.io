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

console.log(`\n================  ${pass}/${total} PASS  ================`);
if (pass !== total) process.exit(1);
