// teleporters.js — runtime teleporter triggers + visible shimmer portals.
//
// LAYOUT entries with t='teleporter' (emitted by the Quake .map importer for
// each trigger_teleport ↔ info_teleport_destination pair) register here at
// arena-build time. The trigger volume warps the player when entered; a
// visible "shimmer portal" mesh is built at the same volume so the
// teleporter reads in-world as an obvious purple shimmery box.
//
// applyTeleport(dt) — runs from the player update loop; if the player's
//   capsule overlaps any trigger volume, snaps position to dest + zeros
//   velocity. 350 ms hysteresis prevents instant re-trigger.
// updateTeleporters(dt) — scrolls each portal mesh's texture offsets and
//   pulses its emissive intensity so it shimmers visibly.

import * as THREE from 'three';
import { scene } from './scene.js';
import { player } from './state.js';
import { PLAYER_RADIUS, EYE_HEIGHT_STAND } from './constants.js';
import { makePortalTexture } from './textures.js';

// Each entry: { x0,y0,z0, x1,y1,z1, dx,dy,dz, name, mesh, tex }
export const teleporters = [];

// Hysteresis: once a teleport fires, hold a brief lockout so the player
// doesn't immediately re-trigger if the destination overlaps the same /
// adjacent trigger volume.
let _lockout = 0;

// Shared portal texture — one allocation, each mesh's MATERIAL clones the
// texture so per-instance offset animation doesn't fight (each material
// owns its own .map reference, but Three.js permits sharing the underlying
// CanvasTexture; safer to clone for offsets).
const _portalSrc = makePortalTexture();

function makePortalMesh(x0, y0, z0, x1, y1, z1) {
  // Per-instance texture clone so each portal's offset can scroll
  // independently without affecting other portals.
  const tex = _portalSrc.clone();
  tex.needsUpdate = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // Repeat tuned so the swirl reads at human scale on a ~2 m trigger.
  tex.repeat.set(1.0, 1.0);
  // Normal alpha blending (default) so the dark purple texture reads as
  // dark — additive blending was washing it bright pink over light walls.
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.80,
    depthWrite: false,
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.renderOrder = 2;            // after opaque + water
  scene.add(m);
  return { mesh: m, tex };
}

export function registerTeleporter(e) {
  const { mesh, tex } = makePortalMesh(e.x0, e.y0, e.z0, e.x1, e.y1, e.z1);
  teleporters.push({
    x0: e.x0, y0: e.y0, z0: e.z0,
    x1: e.x1, y1: e.y1, z1: e.z1,
    dx: e.dx, dy: e.dy, dz: e.dz,
    name: e.name || '',
    mesh, tex,
  });
}

// Animate every portal's texture offset and emissive pulse. Two layers of
// motion at different rates give the swirl a "drifting + counter-drifting"
// feel that reads as alive.
let _animT = 0;
export function updateTeleporters(dt) {
  _animT += dt;
  const pulse = 0.75 + 0.25 * Math.sin(_animT * 3.0);   // 0.5..1.0 brightness
  for (let i = 0; i < teleporters.length; i++) {
    const t = teleporters[i];
    // Stagger per-portal so they don't all twinkle in sync.
    const phase = i * 0.37;
    t.tex.offset.x = ((_animT + phase) * 0.18) % 1;
    t.tex.offset.y = ((_animT + phase) * 0.09) % 1;
    // Subtle pulse — stays in the 0.65–0.85 band so the portal always
    // reads as substantial dark-purple, not transparent ghost.
    t.mesh.material.opacity = 0.65 + 0.20 * pulse;
  }
}

export function applyTeleport(dt) {
  if (_lockout > 0) {
    _lockout -= dt;
    if (_lockout > 0) return;
  }
  const px = player.position.x;
  const py = player.position.y;
  const pz = player.position.z;
  const r = PLAYER_RADIUS;
  const capTop = py + EYE_HEIGHT_STAND;
  for (let i = 0; i < teleporters.length; i++) {
    const t = teleporters[i];
    if (capTop < t.y0 || py > t.y1) continue;
    if (px + r < t.x0 || px - r > t.x1) continue;
    if (pz + r < t.z0 || pz - r > t.z1) continue;
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
  for (const t of teleporters) {
    scene.remove(t.mesh);
    t.mesh.geometry.dispose();
    t.mesh.material.dispose();
    t.tex.dispose();
  }
  teleporters.length = 0;
  _lockout = 0;
}
