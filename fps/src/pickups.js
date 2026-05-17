// pickups.js — M15 Stage 3.
//
// Static map pickups. Two kinds:
//   * 'weapon' — walking over it permanently unlocks the weapon (first time)
//                AND refills its ammo. Re-spawns after PICKUP_RESPAWN so it
//                doubles as an ammo refill station.
//   * 'health' — restores HEALTH_PICKUP_AMOUNT HP up to PLAYER_MAX_HEALTH.
//                Re-spawns on the same timer so it stays useful across a wave.
//
// Geometry is procedural (per project constraint — no extra assets). Each
// pickup is a small group at the pickup's world position that bobs and spins
// so it is visually distinct from level geometry.
//
// Pickup placements live in maplayout.js (PICKUPS array). spawnAllPickups()
// reads them at import time so the meshes exist before the first frame.

import * as THREE from 'three';
import { scene } from './scene.js';
import { state, player, game } from './state.js';
import {
  GAME_STATE, PLAYER_MAX_HEALTH,
  PICKUP_RADIUS, PICKUP_VERT_TOL, PICKUP_RESPAWN,
  PICKUP_HOVER_HEIGHT, PICKUP_BOB_AMP, PICKUP_BOB_RATE, PICKUP_SPIN_RATE,
  HEALTH_PICKUP_AMOUNT,
} from './constants.js';
import { PICKUPS as PICKUP_LAYOUT } from './maplayout.js';
import { WEAPON_DEFS, unlockWeapon } from './weapons.js';
import { sfxWeaponUnlock, sfxScopeOn } from './audio.js';
import { showToast } from './hud.js';

// --- color / label per weapon — used by both the pickup mesh tint and the
// collection toast so the player learns the colour ↔ gun association. ---
const WEAPON_PICKUP_INFO = {
  shotgun: { color: 0xff8a2a, label: 'Shotgun', key: '2' },
  smg:     { color: 0x36d6ff, label: 'SMG',     key: '3' },
  sniper:  { color: 0xb47bff, label: 'Sniper',  key: '4' },
  saw:     { color: 0x9ee03a, label: 'M249 SAW', key: '5' },
};

// --- live list of pickups in the scene ---
// Each entry: { kind, what, x, y, z, surfaceY, group, collected, respawn, phase }
export const pickups = [];

// Shared materials reused across pickups for the cross sprite + ring.
const HEALTH_RED = new THREE.MeshStandardMaterial({
  color: 0xff3344, emissive: 0xff3344, emissiveIntensity: 0.6,
  roughness: 0.5, metalness: 0.1,
});
const HEALTH_WHITE = new THREE.MeshStandardMaterial({
  color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.7,
  roughness: 0.5, metalness: 0.0,
});

function buildHealthMesh() {
  const g = new THREE.Group();
  // Red base cube
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), HEALTH_RED);
  g.add(base);
  // White cross on top: two thin perpendicular boxes
  const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.08, 0.10), HEALTH_WHITE);
  arm1.position.y = 0.10;
  g.add(arm1);
  const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.40), HEALTH_WHITE);
  arm2.position.y = 0.10;
  g.add(arm2);
  return g;
}

function buildWeaponMesh(what) {
  const info = WEAPON_PICKUP_INFO[what];
  const c = info ? info.color : 0xffffff;
  const g = new THREE.Group();
  // Glowing ring (the "summon" pad)
  const ringMat = new THREE.MeshStandardMaterial({
    color: c, emissive: c, emissiveIntensity: 0.9,
    roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.95,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.40, 0.05, 8, 24), ringMat);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  // Floating crystal core: octahedron in the same colour
  const coreMat = new THREE.MeshStandardMaterial({
    color: c, emissive: c, emissiveIntensity: 1.1,
    roughness: 0.25, metalness: 0.6,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), coreMat);
  core.position.y = 0.05;
  g.add(core);
  return g;
}

function makePickup(entry) {
  const group = entry.kind === 'weapon'
    ? buildWeaponMesh(entry.what)
    : buildHealthMesh();
  group.position.set(entry.x, (entry.y || 0) + PICKUP_HOVER_HEIGHT, entry.z);
  scene.add(group);
  pickups.push({
    kind: entry.kind,
    what: entry.what || null,
    x: entry.x, z: entry.z,
    surfaceY: entry.y || 0,
    group,
    collected: false,
    respawn: 0,
    // Phase staggers bob/spin so a row of pickups doesn't pulse in lockstep.
    phase: Math.random() * Math.PI * 2,
  });
}

export function spawnAllPickups() {
  for (const entry of PICKUP_LAYOUT) makePickup(entry);
}

// Called by wave.resetGame / startMapTest. Re-shows any collected pickup and
// clears its respawn timer so a fresh run starts with everything available.
export function resetPickups() {
  for (const p of pickups) {
    p.collected = false;
    p.respawn = 0;
    p.group.visible = true;
  }
}

function applyPickup(p) {
  if (p.kind === 'weapon') {
    const wasLocked = unlockWeapon(p.what);
    const info = WEAPON_PICKUP_INFO[p.what];
    const label = info ? info.label : p.what;
    const key = info ? info.key : '';
    showToast(wasLocked
      ? `${label} acquired! [${key}]`
      : `${label} ammo refilled`, 1.6);
    sfxWeaponUnlock();
  } else {
    // Health: clamp at max so a full-HP player gains nothing (the pickup
    // still gets consumed so it can't be "saved"; that matches arena-FPS feel).
    const before = player.health;
    player.health = Math.min(PLAYER_MAX_HEALTH, before + HEALTH_PICKUP_AMOUNT);
    const gained = Math.round(player.health - before);
    if (gained > 0) showToast(`+${gained} HP`, 1.2);
    sfxScopeOn();
  }
}

// Pickup collision test. A pickup is collected when the player's feet are
// within PICKUP_RADIUS horizontally AND within ±PICKUP_VERT_TOL vertically of
// the pickup's surface — so a pickup on a deck is not triggered from the
// ground directly below it.
function playerOverlaps(p) {
  const dx = player.position.x - p.x;
  const dz = player.position.z - p.z;
  if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) return false;
  if (Math.abs(player.position.y - p.surfaceY) > PICKUP_VERT_TOL) return false;
  return true;
}

export function updatePickups(dt) {
  if (state.gameState !== GAME_STATE.PLAYING &&
      state.gameState !== GAME_STATE.BETWEEN_WAVES) return;
  for (let i = 0; i < pickups.length; i++) {
    const p = pickups[i];
    if (p.collected) {
      p.respawn -= dt;
      if (p.respawn <= 0) {
        p.collected = false;
        p.respawn = 0;
        p.group.visible = true;
      }
      continue;
    }
    // Visual: bob + spin. Phase staggers neighbours so they aren't in lockstep.
    const t = game.elapsed + p.phase;
    const bob = Math.sin(t * PICKUP_BOB_RATE) * PICKUP_BOB_AMP;
    p.group.position.y = p.surfaceY + PICKUP_HOVER_HEIGHT + bob;
    p.group.rotation.y = t * PICKUP_SPIN_RATE;
    // Collect on overlap.
    if (player.alive && playerOverlaps(p)) {
      applyPickup(p);
      p.collected = true;
      p.respawn = PICKUP_RESPAWN;
      p.group.visible = false;
    }
  }
}

// Build the meshes at import time — same pattern as arena.js (build the world
// before the first frame so the loop has everything to render).
spawnAllPickups();
