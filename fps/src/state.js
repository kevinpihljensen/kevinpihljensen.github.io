// state.js — central mutable state. Other modules import these singletons
// and read/write them directly. Keeping them all in one module makes it easy
// to audit what state exists and how it's shared.
//
// Note: cycles are fine in ES modules as long as the cross-module reference
// happens INSIDE A FUNCTION (not at module-top-level). All consumers of these
// objects read/write them inside functions, so they get fresh values at call
// time.

import { GAME_STATE, PLAYER_MAX_HEALTH } from './constants.js';
import * as THREE from 'three';

// --- HIGH-LEVEL GAME STATE ---
// `gameState` is a mutable enum value. Other modules mutate it.
export const state = {
  gameState: GAME_STATE.TITLE,
  // Remembers PLAYING vs BETWEEN_WAVES across a pause so we resume to the
  // right state on lock re-acquisition.
  prePauseState: null,
  isLocked: false,
};

// Per-run game data. Reset via wave.js's resetGame().
export const game = {
  wave: 0,
  score: 0,
  enemiesAlive: 0,
  breakTimer: 0,
  elapsed: 0,         // accumulated dt while active — frozen during pause
  mapTest: false,     // map-test run: no enemies spawn (pistol still given)
  mapTestArmed: false,// title-screen toggle (press M) → next run is map-test
  bhopEnabled: true,  // title-screen toggle → bunny-hop speed building on/off
};

// --- PLAYER ---
// Velocities are split horizontal (XZ) from vertical (Y) because horizontal
// motion uses bhop-style frictioned velocity while vertical is simple
// projectile motion under gravity.
export const player = {
  position: new THREE.Vector3(0, 0, 0),
  velocityX: 0,         // M10: horizontal velocity (XZ) for bhop
  velocityZ: 0,
  velocityY: 0,
  yaw: 0,
  pitch: 0,
  isGrounded: true,
  isCrouching: false,
  // Smooth stance amount: 0 = fully standing, 1 = fully crouched. Lerps
  // quickly toward the target each frame; the camera eye height AND the
  // collision capsule height both interpolate with it (fast but not instant).
  crouchT: 0,
  isScoped: false,      // M10: sniper-scoped (right-click toggle)
  health: PLAYER_MAX_HEALTH,
  maxHealth: PLAYER_MAX_HEALTH,
  regenDelay: 0,
  damageFlashTimer: 0,
  alive: true,
};

// M10: damage direction indicator. `angle` is screen-CW relative to player
// forward (0 = directly ahead, +π/2 = right, ±π = behind).
export const damageIndicator = {
  timer: 0,
  angle: 0,
};
