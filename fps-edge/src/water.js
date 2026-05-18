// water.js — water-volume registry + per-frame player overlap tracking.
//
// Imported as LAYOUT entries `{ t: 'water', cx, cz, base, sx, sy, sz }` from
// the Quake .map (any brush whose face texture starts with `*04` / `*water`
// / `*slime`). arena.js registers each via registerWater() at build time;
// updateWaterState(dt) runs once per frame from main.js BEFORE updatePlayer
// so player.js's movement step sees the up-to-date inWater flag.
//
// Water is COSMETIC + TRIGGER ONLY — no collision. Swimming physics
// (buoyancy, reduced gravity, slower movement) lives in player.js gated on
// player.inWater.

import { player } from './state.js';
import { PLAYER_RADIUS } from './constants.js';

// Each entry: { x0,y0,z0, x1,y1,z1, top }  (axis-aligned bounds)
export const waters = [];

export function registerWater({ cx, cz, base, sx, sy, sz }) {
  waters.push({
    x0: cx - sx / 2, x1: cx + sx / 2,
    y0: base,        y1: base + sy,
    z0: cz - sz / 2, z1: cz + sz / 2,
    top: base + sy,
  });
}

export function clearWaters() {
  waters.length = 0;
}

// Two overlap tests per frame:
//   feetInWater = player FEET (capsule bottom = position.y) overlap a water
//                 volume → "wading" state. Disables bhop, keeps player
//                 standing on ground beneath, no swim physics yet.
//   inWater     = player TORSO (feet + ~0.9 m) overlap a water volume →
//                 full swim physics: reduced gravity, buoyancy, no jump.
// Both flags can be true simultaneously (deep water with feet on bottom).
const TORSO_OFFSET = 0.9;
export function updateWaterState(_dt) {
  const px = player.position.x;
  const pz = player.position.z;
  const feetY  = player.position.y;
  const torsoY = feetY + TORSO_OFFSET;
  const r = PLAYER_RADIUS;
  let feetIn = false, torsoIn = false;
  let bestTop = 0;
  for (let i = 0; i < waters.length; i++) {
    const w = waters[i];
    if (px + r < w.x0 || px - r > w.x1) continue;
    if (pz + r < w.z0 || pz - r > w.z1) continue;
    if (feetY  >= w.y0 && feetY  <= w.y1) { feetIn  = true; if (w.top > bestTop) bestTop = w.top; }
    if (torsoY >= w.y0 && torsoY <= w.y1) { torsoIn = true; if (w.top > bestTop) bestTop = w.top; }
  }
  player.feetInWater = feetIn;
  player.inWater     = torsoIn;
  player.waterTop    = (feetIn || torsoIn) ? bestTop : 0;
}
