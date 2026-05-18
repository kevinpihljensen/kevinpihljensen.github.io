// player.js — player movement, damage handling, damage-direction indicator.
//
// M10 changes (the big ones):
//   * Source/Quake-style movement. Horizontal velocity (player.velocityX/Z)
//     persists frame-to-frame. On ground, friction bleeds it; in air, friction
//     is zero and acceleration is capped by AIR_WISH_SPEED_CAP. This is what
//     enables bhop: hold Space → auto-jump on landing → friction is skipped
//     on the jump frame → strafing while turning the mouse accumulates side
//     speed beyond walk/sprint cap.
//   * Auto-jump (m9's edge-trigger reverted). While grounded and Space is
//     held, you jump every frame you can.
//   * Scope-aware: when player.isScoped, walk speed is clamped to SCOPE_SPEED
//     and mouse sensitivity is multiplied by SCOPE_SENS_MULT (handled in the
//     applyMouseDelta function called from input.js).
//   * Heavy knockback adds directly to velocity (no more separate impulse
//     field). Friction bleeds it naturally.

import * as THREE from 'three';
import { camera } from './scene.js';
import { player, state, game, damageIndicator } from './state.js';
import { collideCapsule, groundHeightAt, ceilingHeightAt, headroomClear } from './collision.js';
import { enemies } from './enemies.js';
import { SPAWN, SPAWN_ANCHORS } from './maplayout.js';
import {
  GAME_STATE, MOUSE_SENSITIVITY, PITCH_LIMIT, SCOPE_SENS_MULT,
  WALK_SPEED, SPRINT_SPEED, CROUCH_SPEED, SCOPE_SPEED, KNIFE_SPEED_MULT,
  JUMP_VELOCITY, GRAVITY, EYE_HEIGHT_STAND, EYE_HEIGHT_CROUCH, PLAYER_RADIUS,
  CROUCH_TRANSITION_RATE,
  GROUND_FRICTION, GROUND_STOP_SPEED, GROUND_ACCEL, AIR_ACCEL,
  AIR_WISH_SPEED_CAP, MAX_HORIZONTAL_SPEED,
  PLAYER_MAX_HEALTH, DAMAGE_FLASH_TIME, DAMAGE_INDICATOR_TIME,
  DEFAULT_FOV, SCOPE_FOV, ARENA_PLAYER_RESPAWN_DELAY,
  WATER_GRAVITY, WATER_BUOYANCY, WATER_SWIM_UP, WATER_SWIM_DOWN,
  WATER_SPEED_MULT, WATER_DRAG, WATER_VY_DAMP,
} from './constants.js';
import { sfxPlayerHurt, sfxGameOver } from './audio.js';
import { setGameState } from './hud.js';
import { wState } from './weapons.js';

// --- INPUT STATE OWNED BY PLAYER.JS ---
// Keys and mouse-delta accumulators. input.js writes to these; player.js
// reads them each frame. Keeping the inputs near their consumer means input.js
// doesn't need to know how movement works.
export const keys = {};
export const mouseDelta = { x: 0, y: 0 };

// Space state from the previous frame, for rising-edge jump detection. When
// bunny-hop is DISABLED a jump requires a fresh Space press (release + press
// again) — holding Space yields exactly one hop. When bhop is enabled this
// is ignored and auto-hop (jump every grounded frame Space is held) stands.
let spacePrev = false;

// --- STEP / LEDGE VIEW SMOOTHING ---
// When the feet snap upward in a single frame (step-up, ledge grab, the
// edge-radius ground sample catching a box top, a duck-jump mount) the eye
// would teleport the same amount — a jarring upward jolt. We instead push
// that delta into a view offset so the eye STAYS where it was on the snap
// frame, then ease the offset out over a fraction of a second. Physics and
// where you actually stand are unchanged; only camera Y is eased.
let stepSmooth = 0;
const STEP_SMOOTH_MIN = 0.06;   // ignore tiny rises (ramp climb stays exact)
const STEP_SMOOTH_MAX = 1.30;   // clamp (max real snap ≈ STEP_UP + airLift)
const STEP_SMOOTH_SPEED = 16;   // ease-out rate (≈0.15 s to recover)

export function clearKeys() {
  for (const k in keys) keys[k] = false;
  mouseDelta.x = 0;
  mouseDelta.y = 0;
}

// Called by input.js on each mousemove during pointer-lock. Scope sensitivity
// is applied here, not at apply-time, so the scaling happens before the delta
// is folded into the yaw/pitch state.
export function applyMouseDelta(dx, dy) {
  const mult = player.isScoped ? SCOPE_SENS_MULT : 1.0;
  mouseDelta.x += dx * mult;
  mouseDelta.y += dy * mult;
}

// --- SCRATCH VECTORS ---
// Reused across frames to avoid per-frame Vector3 allocations in the hot path.
const _tmpForward = new THREE.Vector3();
const _tmpRight = new THREE.Vector3();

// --- MOVEMENT ---
export function updatePlayer(dt) {
  // Arena mode: while dead and waiting to respawn, freeze movement entirely.
  // updateArenaPlayer ticks the respawn timer and restores `alive`.
  if (!player.alive && game.gameMode === 'arena') return;
  // Look. Mouse deltas accumulate in mouseDelta; apply and zero them each frame.
  player.yaw -= mouseDelta.x * MOUSE_SENSITIVITY;
  player.pitch -= mouseDelta.y * MOUSE_SENSITIVITY;
  if (player.pitch >  PITCH_LIMIT) player.pitch =  PITCH_LIMIT;
  if (player.pitch < -PITCH_LIMIT) player.pitch = -PITCH_LIMIT;
  mouseDelta.x = 0;
  mouseDelta.y = 0;

  // --- CROUCH (smooth, headroom-aware, auto-stand) ---
  // Hold Ctrl → crouch. Release Ctrl → stand up as soon as a full standing
  // capsule fits at the current spot — re-checked EVERY frame, no latch, so
  // crouch-walking out from under the ramp auto-stands you the instant
  // there's room. The stance is not an instant snap: crouchT in [0,1]
  // (0 = standing, 1 = crouched) lerps quickly toward its target, and BOTH
  // the camera eye height and the collision capsule height interpolate with
  // it. While there's no headroom and Ctrl is released the player simply
  // stays crouched (forced, but not latched — it stands the moment it can).
  const crouchKey = !!keys['ControlLeft'] || !!keys['ControlRight'];
  const standCapsuleH  = EYE_HEIGHT_STAND  + 0.1;   // full standing capsule
  const crouchCapsuleH = EYE_HEIGHT_CROUCH + 0.1;   // fully crouched capsule

  let wantCrouch;
  if (crouchKey) {
    wantCrouch = true;                               // holding Ctrl → crouch
  } else if (player.crouchT > 0) {
    // Already (at least partly) crouched and Ctrl released: stand only if a
    // standing capsule actually fits here, otherwise stay crouched so we
    // don't pop up into a slab. Re-evaluated every frame → auto-stands the
    // instant you move into clearance, no press needed.
    const canStand = headroomClear(
      player.position.x, player.position.y, player.position.z,
      PLAYER_RADIUS, standCapsuleH
    );
    wantCrouch = !canStand;
  } else {
    // Fully standing and not pressing crouch → NEVER auto-crouch. Walking up
    // to / alongside the ramp (e.g. the low start, from the side) just gets
    // blocked by the slab as a solid via rampOverheadClip, exactly like a
    // wall. Ducking under requires actually pressing crouch.
    wantCrouch = false;
  }
  player.isCrouching = wantCrouch;            // gameplay stance (speed, enemy aim)

  // Move crouchT toward the target at a fixed rate (frame-rate independent):
  // fast (~0.1 s end to end) but not an instant teleport of the view.
  const targetT = wantCrouch ? 1 : 0;
  const crouchStep = CROUCH_TRANSITION_RATE * dt;
  if (player.crouchT < targetT) {
    player.crouchT = Math.min(targetT, player.crouchT + crouchStep);
  } else if (player.crouchT > targetT) {
    player.crouchT = Math.max(targetT, player.crouchT - crouchStep);
  }

  // Interpolated capsule height — used for ALL collision this frame so the
  // body always matches what the camera shows (no clip while transitioning).
  // Raising only ever begins when headroomClear(standing) was true, so the
  // growing capsule has the room it needs.
  const bodyH = standCapsuleH + (crouchCapsuleH - standCapsuleH) * player.crouchT;

  // FOV transition based on scope state.
  const targetFov = player.isScoped ? SCOPE_FOV : DEFAULT_FOV;
  if (camera.fov !== targetFov) {
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }

  // --- BUILD WISH DIRECTION FROM INPUT ---
  // Forward/right unit vectors derived from yaw alone (so look-up/down doesn't
  // tilt walking). Y components are zero.
  const sy = Math.sin(player.yaw);
  const cy = Math.cos(player.yaw);
  _tmpForward.set(-sy, 0, -cy);
  _tmpRight.set(cy, 0, -sy);

  let forwardInput = 0, rightInput = 0;
  if (keys['KeyW']) forwardInput += 1;
  if (keys['KeyS']) forwardInput -= 1;
  if (keys['KeyD']) rightInput   += 1;
  if (keys['KeyA']) rightInput   -= 1;

  // Walk-speed selection. Sprint (Shift) is suppressed when crouched or scoped.
  // Note: bhop lets the player exceed this cap via air-strafe; that's intentional.
  let wishSpeed;
  if (player.isScoped) wishSpeed = SCOPE_SPEED;
  else if (player.isCrouching) wishSpeed = CROUCH_SPEED;
  else if (keys['ShiftLeft'] || keys['ShiftRight']) wishSpeed = SPRINT_SPEED;
  else wishSpeed = WALK_SPEED;
  // fps-edge: swim is slow.
  if (player.inWater) wishSpeed *= WATER_SPEED_MULT;

  // Knife out → small mobility buff (lighter than a gun): a flat multiplier
  // on whatever the current move state is, so scoped/crouch/sprint all keep
  // their relative feel. Does not stack into bhop (caps still apply).
  if (wState.currentWeapon === 'knife') wishSpeed *= KNIFE_SPEED_MULT;

  // Compose wishvel from input. wishDir is the unit direction; wishLen is the
  // magnitude of the input vector (0 if no keys, 1 if straight one direction,
  // √2 if diagonal — which we don't normalize, matching classic FPS behavior
  // where diagonal is slightly faster... actually we DO normalize: it feels
  // wrong otherwise).
  let wishVelX = _tmpForward.x * forwardInput + _tmpRight.x * rightInput;
  let wishVelZ = _tmpForward.z * forwardInput + _tmpRight.z * rightInput;
  const wishLen = Math.hypot(wishVelX, wishVelZ);
  let wishDirX = 0, wishDirZ = 0;
  let effectiveWishSpeed = 0;
  if (wishLen > 0.001) {
    wishDirX = wishVelX / wishLen;
    wishDirZ = wishVelZ / wishLen;
    effectiveWishSpeed = wishSpeed;
  }

  // --- JUMP / GROUND DETECTION ---
  // bhop ENABLED  → auto-jump: jump every grounded frame Space is held (the
  //                 friction skip below preserves speed → classic bhop).
  // bhop DISABLED → jump only on a RISING EDGE of Space (must release and
  //                 press again). Holding Space gives exactly ONE hop.
  const spaceDown = !!keys['Space'];
  const jumpInput = game.bhopEnabled ? spaceDown : (spaceDown && !spacePrev);
  spacePrev = spaceDown;
  // fps-edge: in water, Space/Ctrl produce continuous up/down velocity;
  // ground-anchored jumping is disabled. willJump stays declared in this
  // outer scope (the friction-skip block farther down references it) — we
  // just never set it true in water.
  const willJump = player.isGrounded && jumpInput && !player.inWater;
  if (willJump) {
    player.velocityY = JUMP_VELOCITY;
    player.isGrounded = false;
  }

  // --- GROUND FRICTION ---
  // Apply only when grounded AND not jumping this frame — UNLESS bunny-hop is
  // disabled, in which case friction also applies on the jump frame so a
  // chained jump bleeds speed like a normal stop (no bhop speed preservation).
  // Normal single jumps still work; you just can't build/keep speed.
  if (player.isGrounded && (!willJump || !game.bhopEnabled)) {
    const speed = Math.hypot(player.velocityX, player.velocityZ);
    if (speed > 0.0001) {
      const control = Math.max(speed, GROUND_STOP_SPEED);
      const drop = control * GROUND_FRICTION * dt;
      const newSpeed = Math.max(0, speed - drop);
      const scale = newSpeed / speed;
      player.velocityX *= scale;
      player.velocityZ *= scale;
    }
  }

  // --- ACCELERATE TOWARD WISH DIRECTION ---
  // Classic Source/Quake accelerate. The cap is the key bhop ingredient:
  //   currentSpeed = velocity · wishDir   (projection of velocity onto wish)
  //   addSpeed = wishSpeedCapped - currentSpeed
  //   If addSpeed > 0, add `min(addSpeed, accel*wish*dt)` along wishDir.
  // On ground, wishSpeedCapped = full wish speed (snappy).
  // In air, wishSpeedCapped = AIR_WISH_SPEED_CAP (≈1.8). That's small enough
  // that strafing forward at full speed gives no boost (cap saturated), but
  // strafing 90° to current velocity gives free side speed (cap not saturated
  // along that axis).
  if (effectiveWishSpeed > 0) {
    const currentSpeed = player.velocityX * wishDirX + player.velocityZ * wishDirZ;
    const accelLimit = player.isGrounded ? GROUND_ACCEL : AIR_ACCEL;
    const wishSpeedCapped = player.isGrounded
      ? effectiveWishSpeed
      : Math.min(effectiveWishSpeed, AIR_WISH_SPEED_CAP);
    const addSpeed = wishSpeedCapped - currentSpeed;
    if (addSpeed > 0) {
      let accel = accelLimit * effectiveWishSpeed * dt;
      if (accel > addSpeed) accel = addSpeed;
      player.velocityX += wishDirX * accel;
      player.velocityZ += wishDirZ * accel;
    }
  }

  // Soft max-speed clamp. Bhop gains are uncapped along the wishDir axis (the
  // accelerate function only caps the projection onto wishDir, not total
  // speed), so without this a perfect strafe-jumper would accelerate forever.
  // Clamp the magnitude after accelerate so the player can reach the ceiling
  // and ride it. Skipped on the ground because ground friction will pull you
  // back to wish speed anyway, and clamping mid-stride feels mushy.
  if (!player.isGrounded) {
    const horizSpeed = Math.hypot(player.velocityX, player.velocityZ);
    if (horizSpeed > MAX_HORIZONTAL_SPEED) {
      const scale = MAX_HORIZONTAL_SPEED / horizSpeed;
      player.velocityX *= scale;
      player.velocityZ *= scale;
    }
  }

  // Bunny-hop disabled: hard-cap total horizontal speed to the normal run
  // ceiling every frame (ground and air). Combined with the friction-on-jump
  // above, chained jumps and air-strafing cannot accumulate speed — movement
  // stays at normal walk/sprint pace. No effect when bhop is enabled.
  if (!game.bhopEnabled) {
    const hs = Math.hypot(player.velocityX, player.velocityZ);
    if (hs > SPRINT_SPEED) {
      const sc = SPRINT_SPEED / hs;
      player.velocityX *= sc;
      player.velocityZ *= sc;
    }
  }

  // --- MOVE + COLLIDE (Source-style split) ---
  // 1. Integrate horizontal velocity, then resolve the capsule BODY out of
  //    solids horizontally (walls, ramp sides/undersides). collideCapsule
  //    never moves us vertically — that's step 2's job. This is why there's
  //    no ramp "slide": the slope never pushes the body.
  // 2. Integrate vertical velocity (gravity / jump). Find the highest
  //    walkable surface under us within step-up range. If our feet are at or
  //    below it (falling onto / standing on it), snap to it and we're
  //    grounded. Else we're airborne. A ceiling (deck/ramp overhead) caps a
  //    rising jump so you can't pop through a floor.
  // bodyH (the capsule height used for all collision below) was computed in
  // the smooth-crouch block above so it tracks the interpolated stance.

  // --- DUCK-JUMP COMPRESSION ---
  // While airborne, crouching compresses the body: the hull BOTTOM (feet)
  // tucks UP by exactly how much the capsule shrank, while the hull TOP
  // (head) stays on the unchanged jump arc. This is pure shape compression —
  // player.position.y (the jump integration: velocity, gravity, apex and the
  // landing rule) is NEVER modified, so NO jump mechanic changes. Grounded
  // or not crouching → airLift = 0 → behaviour byte-identical to before.
  const airLift = (!player.isGrounded) ? (standCapsuleH - bodyH) : 0;

  // 1. Horizontal.
  player.position.x += player.velocityX * dt;
  player.position.z += player.velocityZ * dt;
  {
    const res = collideCapsule(
      player.position.x, player.position.y + airLift, player.position.z,
      PLAYER_RADIUS, bodyH
    );
    player.position.x = res.x;
    player.position.z = res.z;
  }
  // Simple enemy body block (enemies keep an .aabb circle): push the player
  // out of any live enemy's radius in XZ. Cheap and good enough; enemies are
  // soft obstacles.
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    const ex = e.position.x, ez = e.position.z;
    const er = (e.def ? e.def.radius : 0.5);
    const ddx = player.position.x - ex;
    const ddz = player.position.z - ez;
    const rr = PLAYER_RADIUS + er;
    const d2 = ddx*ddx + ddz*ddz;
    if (d2 < rr*rr && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const push = (rr - d);
      player.position.x += (ddx / d) * push;
      player.position.z += (ddz / d) * push;
    }
  }

  // 2. Vertical.
  // Grounded state coming INTO this frame's vertical step. willJump (above)
  // already cleared player.isGrounded on a launch frame, and airborne frames
  // keep it false — so wasGrounded is false for the entire jump/fall arc and
  // true only when we were actually standing on a surface last frame and did
  // not jump this frame. The stay-on-ground stick is gated on this so it
  // applies to walking down ramps/stairs but NOT to a jump's descent.
  const wasGrounded = player.isGrounded;
  const feetYStart = player.position.y;   // for step/ledge view smoothing
  if (player.inWater) {
    // fps-edge SWIMMING: reduced gravity + steady buoyancy. Space → up,
    // Ctrl → down, neither → gentle drift. velocityY eases toward target.
    const ctrlDown = !!(keys['ControlLeft'] || keys['ControlRight']);
    let targetVy;
    if (jumpInput && ctrlDown)      targetVy = 0;
    else if (jumpInput)             targetVy = WATER_SWIM_UP;
    else if (ctrlDown)              targetVy = -WATER_SWIM_DOWN;
    else                            targetVy = (WATER_BUOYANCY - WATER_GRAVITY) * 0.35;
    const damp = 1 - Math.exp(-WATER_VY_DAMP * dt);
    player.velocityY += (targetVy - player.velocityY) * damp;
    player.velocityY -= (WATER_GRAVITY - WATER_BUOYANCY) * dt;
    // Horizontal drag — exponential decay.
    const hDamp = 1 - Math.exp(-WATER_DRAG * dt);
    player.velocityX -= player.velocityX * hDamp;
    player.velocityZ -= player.velocityZ * hDamp;
  } else {
    player.velocityY -= GRAVITY * dt;
  }
  let nextY = player.position.y + player.velocityY * dt;

  // Ceiling: lowest solid surface above the head clips a rising jump. The
  // head is the hull TOP (position.y + standCapsuleH) and does NOT move when
  // you compress/duck mid-air, so the ceiling test uses the standing top.
  // For an uncrouched jump standCapsuleH == bodyH → identical to before.
  if (player.velocityY > 0) {
    const ceil = ceilingHeightAt(
      player.position.x, player.position.z,
      player.position.y + standCapsuleH, PLAYER_RADIUS
    );
    if (ceil !== null && nextY + standCapsuleH > ceil) {
      nextY = ceil - standCapsuleH - 0.02;
      if (nextY < player.position.y) nextY = player.position.y;
      player.velocityY = 0;
    }
  }

  // Ground support: highest walkable surface at-or-below feet + step-up.
  const STEP_UP = 0.55;
  // The collision feet while airborne are the COMPRESSED feet (airLift): a
  // duck-jump lets the tucked feet clear/land on a ledge the standing feet
  // could not. The jump arc itself (position.y) is unchanged; only the hull
  // geometry compresses. airLift == 0 when grounded or not crouching, so
  // this is byte-identical to the previous behaviour for normal jumps.
  const qFeet = player.position.y + airLift;
  const qNext = nextY + airLift;
  const gY = groundHeightAt(
    player.position.x, player.position.z,
    Math.max(qFeet, qNext) + STEP_UP, PLAYER_RADIUS
  );

  if (gY !== null && qNext <= gY + 0.001) {
    // The (compressed) feet have reached the surface — stand on it.
    player.position.y = gY;
    player.velocityY = 0;
    player.isGrounded = true;
  } else {
    player.position.y = nextY;
    player.isGrounded = false;
    // Stay-on-ground: if we were grounded coming into this frame and we're
    // only just above a surface while moving downward (walking down a
    // ramp/stairs), stick to it instead of bunny-stepping off every lip.
    // Gated on `wasGrounded` (not the just-cleared player.isGrounded) so a
    // jump's descent — which is airborne the whole arc — is NOT snapped down
    // early; the player falls the full parabola and lands naturally via the
    // branch above when nextY actually reaches the surface.
    if (wasGrounded && player.velocityY <= 0 && gY !== null &&
        nextY - gY < STEP_UP && nextY - gY > 0) {
      player.position.y = gY;
      player.velocityY = 0;
      player.isGrounded = true;
    }
  }

  // --- CAMERA SYNC ---
  // Eye height interpolates with crouchT so crouch/stand is a fast smooth
  // dip rather than an instant jump.
  const eyeH = EYE_HEIGHT_STAND +
    (EYE_HEIGHT_CROUCH - EYE_HEIGHT_STAND) * player.crouchT;

  // Step/ledge view smoothing: if the feet jumped UP this frame (a discrete
  // ground snap — step-up, ledge/edge grab, duck-jump mount), absorb that
  // delta so the eye does NOT teleport; then ease it out. Order matters:
  // ease the carry-over from prior snaps FIRST, then absorb any NEW snap
  // FULLY this frame, so on the snap frame the eye stays EXACTLY where it
  // was (zero jolt) and only eases up on subsequent frames. Only upward
  // discrete snaps qualify — continuous ramp climb is below the threshold
  // and downward motion (falling/walking down) is left exact, so those feel
  // direct. Physics/where-you-stand is unchanged. Composes with crouch: if
  // you're still holding Ctrl the low eyeH is unaffected — you stay low
  // without the jolt.
  stepSmooth -= stepSmooth * Math.min(1, dt * STEP_SMOOTH_SPEED);
  if (stepSmooth < 0.0005) stepSmooth = 0;
  const dyStep = player.position.y - feetYStart;
  if (player.isGrounded && dyStep > STEP_SMOOTH_MIN) {
    stepSmooth = Math.min(STEP_SMOOTH_MAX, stepSmooth + dyStep);
  }

  camera.position.x = player.position.x;
  camera.position.y = player.position.y + eyeH - stepSmooth;
  camera.position.z = player.position.z;

  // Recoil pitch is added on top of the look pitch so it visibly kicks the
  // camera. wState comes from weapons.js — this is a module cycle but it
  // works because we only reference wState inside a function body.
  // S50: recoil now has both pitch (vertical kick) and yaw (horizontal drift,
  // applied via per-weapon spray patterns). Both decay each frame.
  camera.rotation.x = player.pitch + wState.recoilPitch;
  camera.rotation.y = player.yaw   + wState.recoilYaw;

  // M15 Stage 3: passive health regen removed. The only way to recover HP is
  // to walk over a health pickup (see src/pickups.js).
  if (player.damageFlashTimer > 0) {
    player.damageFlashTimer -= dt;
    if (player.damageFlashTimer < 0) player.damageFlashTimer = 0;
  }
  if (damageIndicator.timer > 0) {
    damageIndicator.timer -= dt;
    if (damageIndicator.timer < 0) damageIndicator.timer = 0;
  }
}

// --- DAMAGE ---
// sourceX/sourceZ is the world position of the damage source (enemy or
// projectile origin), used to compute the damage-direction indicator angle.
export function damagePlayer(amount, sourceX, sourceZ) {
  if (!player.alive) return;
  player.health -= amount;
  player.damageFlashTimer = DAMAGE_FLASH_TIME;
  sfxPlayerHurt();
  if (sourceX !== undefined && sourceZ !== undefined) {
    showDamageIndicator(sourceX, sourceZ);
  }
  if (player.health <= 0) {
    player.health = 0;
    killPlayer();
  }
}

// Angle math: project the source→player vector into the player's local frame
// (forward = -Z after yaw rotation). rightComp / forwardComp give us
// atan2(right, forward) — 0 = directly ahead, π/2 = right, ±π = behind.
function showDamageIndicator(sourceX, sourceZ) {
  const dx = sourceX - player.position.x;
  const dz = sourceZ - player.position.z;
  if (dx * dx + dz * dz < 1e-6) return;
  const cy = Math.cos(player.yaw);
  const sy = Math.sin(player.yaw);
  const rightComp = dx * cy - dz * sy;
  const forwardComp = -dx * sy - dz * cy;
  damageIndicator.angle = Math.atan2(rightComp, forwardComp);
  damageIndicator.timer = DAMAGE_INDICATOR_TIME;
}

function killPlayer() {
  player.alive = false;
  player.velocityX = 0;
  player.velocityZ = 0;
  if (game.gameMode === 'arena') {
    // Arena: don't end the run — start the respawn timer. updateArenaPlayer
    // (called from main.js) ticks it and respawns at a safe anchor.
    game.arenaRespawnTimer = ARENA_PLAYER_RESPAWN_DELAY;
    sfxPlayerHurt();   // distinct from gameover; uses the existing hurt cue
  } else {
    setGameState(GAME_STATE.GAMEOVER);
    sfxGameOver();
  }
}

// Pick the SPAWN_ANCHORS point with the maximum minimum-distance to any live
// enemy. That spawn is the "safest" — used for arena respawn.
function pickArenaRespawnAnchor() {
  let best = SPAWN_ANCHORS[0];
  let bestDist = -Infinity;
  for (let i = 0; i < SPAWN_ANCHORS.length; i++) {
    const a = SPAWN_ANCHORS[i];
    let minD = Infinity;
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      const dx = e.position.x - a.x;
      const dz = e.position.z - a.z;
      const d = dx * dx + dz * dz;
      if (d < minD) minD = d;
    }
    if (minD > bestDist) { bestDist = minD; best = a; }
  }
  return best;
}

// Arena-only tick: counts down the respawn timer and respawns the player at
// the safest anchor when it hits zero. Called from main.js while gameState
// is PLAYING. No-op in wave / maptest modes.
export function updateArenaPlayer(dt) {
  if (game.gameMode !== 'arena' || player.alive) return;
  game.arenaRespawnTimer -= dt;
  if (game.arenaRespawnTimer > 0) return;
  const a = pickArenaRespawnAnchor();
  // fps-edge: spawn anchors carry a y component (The Edge's spawns are on
  // multiple decks 7-25 m up). Fall back to 0 if a legacy anchor lacks y.
  player.position.set(a.x, a.y == null ? 0 : a.y, a.z);
  player.velocityX = 0;
  player.velocityZ = 0;
  player.velocityY = 0;
  player.health = PLAYER_MAX_HEALTH;
  player.damageFlashTimer = 0;
  player.alive = true;
  damageIndicator.timer = 0;
}

export function resetPlayer() {
  // fps-edge: SPAWN carries a y (The Edge's player_start sits on an upper
  // deck). Fall back to 0 for legacy maps where SPAWN is { x, z } only.
  player.position.set(SPAWN.x, SPAWN.y == null ? 0 : SPAWN.y, SPAWN.z);
  player.velocityX = 0;
  player.velocityZ = 0;
  player.velocityY = 0;
  player.yaw = 0;
  player.pitch = 0;
  player.isGrounded = true;
  player.isCrouching = false;
  player.crouchT = 0;
  player.isScoped = false;
  player.health = PLAYER_MAX_HEALTH;
  player.maxHealth = PLAYER_MAX_HEALTH;
  player.damageFlashTimer = 0;
  player.alive = true;
  damageIndicator.timer = 0;
  damageIndicator.angle = 0;
  spacePrev = false;
  stepSmooth = 0;
  clearKeys();
}
