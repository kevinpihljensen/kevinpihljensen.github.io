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

// Test the player's TORSO (capsule centre at feetY + ~0.9 m) against every
// water volume. We use the torso point — not the feet — so wading ankle-
// deep through a thin water sheet doesn't trigger full swimming physics.
const TORSO_OFFSET = 0.9;
export function updateWaterState(_dt) {
  const px = player.position.x;
  const pz = player.position.z;
  const py = player.position.y + TORSO_OFFSET;
  const r = PLAYER_RADIUS;
  let inside = false;
  let bestTop = 0;
  for (let i = 0; i < waters.length; i++) {
    const w = waters[i];
    if (px + r < w.x0 || px - r > w.x1) continue;
    if (pz + r < w.z0 || pz - r > w.z1) continue;
    if (py < w.y0 || py > w.y1) continue;
    inside = true;
    if (w.top > bestTop) bestTop = w.top;
  }
  player.inWater = inside;
  player.waterTop = inside ? bestTop : 0;
}
