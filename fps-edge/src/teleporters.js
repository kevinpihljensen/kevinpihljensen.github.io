// teleporters.js — runtime teleporter triggers.
//
// LAYOUT entries with t='teleporter' (emitted by the Quake .map importer for
// each trigger_teleport ↔ info_teleport_destination pair) register here at
// arena-build time. Each frame, applyTeleport() is called from the player
// update loop with the player's position; if the player's AABB overlaps any
// trigger volume, their position is snapped to the destination point.
//
// No mesh — teleporter volumes are invisible. The .map's brush geometry
// around the trigger (the slipgate frame, the water surface, etc.) is built
// from regular solid brushes as usual.

import { player } from './state.js';
import { PLAYER_RADIUS, EYE_HEIGHT_STAND } from './constants.js';

// Each entry: { x0,y0,z0, x1,y1,z1, dx,dy,dz, name }
export const teleporters = [];

// Hysteresis: once a teleport fires, hold a brief lockout so the player
// doesn't immediately re-trigger if the destination overlaps the same /
// adjacent trigger volume.
let _lockout = 0;

export function registerTeleporter(e) {
  teleporters.push({
    x0: e.x0, y0: e.y0, z0: e.z0,
    x1: e.x1, y1: e.y1, z1: e.z1,
    dx: e.dx, dy: e.dy, dz: e.dz,
    name: e.name || '',
  });
}

export function applyTeleport(dt) {
  if (_lockout > 0) {
    _lockout -= dt;
    if (_lockout > 0) return;
  }
  // Player capsule: position is at the feet; chest sits at +1.0 m or so.
  // Test the capsule's vertical span [py, py + EYE_HEIGHT_STAND] against
  // the trigger AABB. Horizontal test uses a capsule-vs-AABB overlap with
  // PLAYER_RADIUS inflation.
  const px = player.position.x;
  const py = player.position.y;
  const pz = player.position.z;
  const r = PLAYER_RADIUS;
  const capTop = py + EYE_HEIGHT_STAND;
  for (let i = 0; i < teleporters.length; i++) {
    const t = teleporters[i];
    if (capTop < t.y0 || py > t.y1) continue;             // vertical miss
    if (px + r < t.x0 || px - r > t.x1) continue;         // X miss
    if (pz + r < t.z0 || pz - r > t.z1) continue;         // Z miss
    // Hit — snap to destination.
    player.position.set(t.dx, t.dy, t.dz);
    player.velocityX = 0;
    player.velocityZ = 0;
    player.velocityY = 0;
    _lockout = 0.35;
    return;
  }
}

export function clearTeleporters() {
  teleporters.length = 0;
  _lockout = 0;
}
