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
//   feetInWater = player CAPSULE (feet → feet + 1.7 m) AABB-overlaps a
//                 water volume, with a small XZ buffer. "Anywhere in or
//                 right at the surface" → disables bhop. Catches the
//                 standing-at-the-water-surface case where feet are
//                 exactly at waterTop (boundary) and Jesus-walking is
//                 the visual mistake.
//   inWater     = player TORSO (feet + ~0.9 m) is strictly inside a
//                 water volume → full swim physics.
// Both can be true simultaneously (deep water with feet on bottom).
const TORSO_OFFSET = 0.9;
const CAPSULE_HEIGHT = 1.7;
const XZ_BUFFER = 1.5;       // surface-flag radius in XZ (m). Generous so
                              // bhop is killed anywhere visibly "on the
                              // water surface" — including standing on the
                              // bank lip right next to the water (where
                              // the Jesus-walking visual was happening).
const Y_BUFFER  = 1.0;       // also flag when feet are up to a metre above
                              // the water surface, so jumping off a brush
                              // a foot above water doesn't restart bhop.
export function updateWaterState(_dt) {
  const px = player.position.x;
  const pz = player.position.z;
  const feetY  = player.position.y;
  const headY  = feetY + CAPSULE_HEIGHT;
  const torsoY = feetY + TORSO_OFFSET;
  const r = PLAYER_RADIUS;
  let feetIn = false, torsoIn = false;
  let bestTop = 0;
  for (let i = 0; i < waters.length; i++) {
    const w = waters[i];
    // XZ overlap with a small buffer for the wading flag; tight for swim.
    const xzNear = !(px + r + XZ_BUFFER < w.x0 || px - r - XZ_BUFFER > w.x1 ||
                     pz + r + XZ_BUFFER < w.z0 || pz - r - XZ_BUFFER > w.z1);
    const xzIn   = !(px + r < w.x0 || px - r > w.x1 ||
                     pz + r < w.z0 || pz - r > w.z1);
    // Wading: capsule intersects water Y range (incl. Y_BUFFER above the
    // surface so a brush sitting ~1 m above water still flags) AND XZ is
    // within XZ_BUFFER of the water footprint.
    if (xzNear && feetY <= w.y1 + Y_BUFFER && headY >= w.y0 - 0.01) {
      feetIn = true; if (w.top > bestTop) bestTop = w.top;
    }
    // Swim: torso strictly inside the water (the existing TORSO test, but
    // also require XZ tightly inside, no buffer).
    if (xzIn && torsoY >= w.y0 && torsoY <= w.y1) {
      torsoIn = true; if (w.top > bestTop) bestTop = w.top;
    }
  }
  player.feetInWater = feetIn;
  player.inWater     = torsoIn;
  player.waterTop    = (feetIn || torsoIn) ? bestTop : 0;
}
