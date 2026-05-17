// constants.js — pure data. No imports, no side effects.
// Centralizing tunables here means tweaking gameplay is a single-file edit.

// --- RENDER LAYERS ---
// The world renders on LAYER_WORLD; the first-person weapon view models
// render on LAYER_VIEWMODEL in a separate, depth-cleared pass so they always
// draw on TOP of world geometry and never clip into nearby walls. Lights that
// must illuminate the view model enable LAYER_VIEWMODEL in addition to
// LAYER_WORLD (a light only contributes to a pass whose camera layer it
// shares).
export const LAYER_WORLD = 0;
export const LAYER_VIEWMODEL = 1;

// --- ARENA ---
// M15: multi-floor. Ground = y0, Floor 1 deck = FLOOR1_Y, Floor 2 = FLOOR2_Y.
// Perimeter walls now enclose all three floors (tall). Decks are SOLID (they
// occlude what's beneath them) and offset per floor so no single vantage
// sees everything — not a pyramid.
export const ARENA_SIZE = 80;
export const WALL_THICKNESS = 0.5;
export const FLOOR1_Y = 4.5;          // mid mezzanine deck height
export const FLOOR2_Y = 9.0;          // upper catwalk/perch height
export const PERIMETER_HEIGHT = 13;   // tall enough to wall in all 3 floors
export const RAILING_HEIGHT = 1.1;    // guard rails on elevated decks
// Legacy: some modules still import WALL_HEIGHT; keep it as ground-wall height.
export const WALL_HEIGHT = 4;

// --- PLAYER MOVEMENT (M10: Source/Quake-style) ---
// Ground feel: walk/sprint/crouch are still "wish speeds" — the player
// accelerates toward them. Friction is applied on the ground, NOT in the air,
// and NOT on the single frame the player jumps. That last detail is what
// makes bhop work: a perfectly-timed jump preserves all horizontal velocity.
export const WALK_SPEED = 5.0;
export const SPRINT_SPEED = 8.0;
export const CROUCH_SPEED = 2.5;
export const SCOPE_SPEED = 2.5;        // M10: sniper-scoped movement is slow
export const JUMP_VELOCITY = 6.0;
export const GRAVITY = 20.0;
export const EYE_HEIGHT_STAND = 1.6;
export const EYE_HEIGHT_CROUCH = 1.2;
export const PLAYER_RADIUS = 0.4;
// Stance transition speed. crouchT (0=standing, 1=crouched) moves at this
// many units/second toward its target, so a full crouch/stand takes
// 1/RATE seconds (10 → 0.10 s). Fast, but not an instant snap.
export const CROUCH_TRANSITION_RATE = 10.0;

// M10: bhop physics tuning. Values are tuned for Counter-Strike-style
// strafe-jumping where holding A or D while turning the mouse in the same
// direction visibly accelerates you well past sprint speed.
//   GROUND_FRICTION: how fast ground-contact bleeds horizontal velocity.
//   GROUND_STOP_SPEED: floor for the friction drop, so low speeds still stop.
//   GROUND_ACCEL: how aggressively the player matches wish-velocity on ground.
//   AIR_ACCEL: same in air — higher means faster turning + faster gains.
//   AIR_WISH_SPEED_CAP: the magic number. While airborne, the player can only
//     "spend" this much wish-speed toward acceleration per axis-per-frame. So
//     forward-strafing at speed gives nothing (cap saturated along forward),
//     but strafing 90° to current velocity gives free side speed (cap not
//     saturated on that axis). CS uses 30 ups (~0.762 m/s) per frame at high
//     FPS; we use a per-second value, hence the bigger number.
//   MAX_HORIZONTAL_SPEED: a soft ceiling so bhop gains don't go infinite.
//     The accelerate function won't add velocity past this magnitude.
// M11: AIR_WISH_SPEED_CAP raised 1.8 → 3.0 and AIR_ACCEL 4.0 → 10.0 to make
// strafe-jumping feel like CS rather than a polite Quake. MAX_HORIZONTAL_SPEED
// added at ~3.75× walk speed (18.75 m/s) so highly skilled play tops out
// somewhere fun rather than infinite.
export const GROUND_FRICTION = 6.0;
export const GROUND_STOP_SPEED = 1.5;
export const GROUND_ACCEL = 12.0;
export const AIR_ACCEL = 10.0;
export const AIR_WISH_SPEED_CAP = 3.0;
export const MAX_HORIZONTAL_SPEED = 18.75;

export const HEAVY_KNOCKBACK = 6.0;    // M10: now a direct velocity add (was impulse)

// --- LOOK ---
export const MOUSE_SENSITIVITY = 0.002;
export const PITCH_LIMIT = Math.PI / 2 - 0.01;
export const SCOPE_SENS_MULT = 0.35;   // M10: scoped sensitivity ratio
export const DEFAULT_FOV = 75;
export const SCOPE_FOV = 25;

// --- LOOP / NUMERICS ---
export const MAX_DT = 0.1;
export const COLLIDE_EPS = 1e-5;

// --- WEAPONS / RAYCAST ---
export const RAYCAST_RANGE = 200;
export const HEADSHOT_MULTIPLIER = 2.5;  // M10: head-meshes deal this much extra damage
export const DECAL_LIFE = 5.0;
export const MAX_DECALS = 60;
export const MUZZLE_FLASH_TIME = 0.045;
export const RECOIL_DECAY = 9.0;
export const RECOIL_PISTOL = 0.018;
export const RECOIL_SHOTGUN = 0.055;
export const RECOIL_SMG = 0.022;
export const RECOIL_SNIPER = 0.080;
export const RECOIL_SAW = 0.030;   // M249: medium, between SMG and shotgun

// --- ENEMIES ---
export const HIT_FLASH_TIME = 0.12;
export const DEATH_ANIM_TIME = 0.18;
export const ENEMY_CONTACT_RANGE_EXTRA = 0.15;
export const MELEE_ATTACK_COOLDOWN = 1.0;
export const SHOOTER_ATTACK_COOLDOWN = 2.0;
export const SHOOTER_DIST_MIN = 8.0;
export const SHOOTER_DIST_MAX = 40.0;   // will hold & fire from up to here before bothering to close
export const SHOOTER_FIRE_RANGE = 25.0;

// AI stuck-detection / unstick (windows, ramp mouths, cover corners): if an
// enemy that should be travelling moves less than MIN_MOVE over CHECK
// seconds it slides perpendicular for UNSTICK_TIME to clear the obstacle.
export const AI_UNSTICK_CHECK = 0.45;
export const AI_UNSTICK_MIN_MOVE = 0.18;
export const AI_UNSTICK_TIME = 0.70;
// Sustained no-LOS → seek a higher vantage by climbing the nearest up-ramp.
export const AI_VANTAGE_LOS_TIME = 1.8;

// --- ENEMY AI (M12) ---
// Shared tactical-movement tuning used by the new state-machine AI.
//   STRAFE_*       — sidestep speed multiplier + how often they flip direction
//   PEEK_*         — cover peek/duck rhythm for ranged enemies
//   GRUNT_STRAFE   — fraction of grunts that weave vs. straight-rush
export const AI_STRAFE_SPEED_MULT = 0.75;   // strafe is a bit slower than advance
export const AI_STRAFE_FLIP_MIN = 0.8;      // seconds before possibly flipping strafe dir
export const AI_STRAFE_FLIP_MAX = 2.2;
export const AI_PEEK_OUT_TIME = 1.4;        // ranged enemy stays exposed this long
export const AI_PEEK_HIDE_TIME = 1.1;       // then hides behind cover this long
export const AI_GRUNT_STRAFE_CHANCE = 0.55; // fraction of grunts that juke vs beeline

// --- HEAVY MINIGUN (M12) ---
// The heavy now carries a barrel-spinning minigun. It must spin up before
// firing (telegraph), then hoses a fast stream of projectiles, then spins
// down. Still dangerous in melee (knockback retained).
export const HEAVY_FIRE_RANGE = 120.0;      // ≈ whole arena: fires whenever it has LOS
export const HEAVY_WINDUP_TIME = 1.0;       // barrel spin-up before first shot
export const HEAVY_FIRE_DURATION = 2.2;     // length of a firing burst
export const HEAVY_FIRE_INTERVAL = 0.10;    // seconds between minigun rounds
export const HEAVY_BURST_COOLDOWN = 1.6;    // rest between bursts
export const HEAVY_MINIGUN_SPREAD = 0.045;  // radians of inaccuracy per round
export const HEAVY_PREFERRED_DIST = 14.0;   // tries to hold around this range
export const HEAVY_BARREL_MAX_RPM = 22.0;   // visual barrel spin (radians/s at full)

// --- PLAYER DAMAGE ---
// M15 Stage 3: passive regen removed. Health is restored ONLY by walking over
// HEALTH pickups (see PICKUPS in maplayout.js, src/pickups.js).
export const PLAYER_MAX_HEALTH = 100;
export const DAMAGE_FLASH_TIME = 0.3;

// --- PROJECTILES ---
// M14: speed raised 35 → 52 so shots are much harder to simply sidestep,
// and enemies now lead their aim (see AI_LEAD_* below). Lifetime trimmed a
// touch since faster rounds cover the arena in less time anyway.
export const PROJECTILE_SPEED = 52.0;
export const PROJECTILE_LIFETIME = 3.2;  // 52*3.2 ≈ 166m: clears the ~113m map diagonal
export const PROJECTILE_DAMAGE = 8;
export const PROJECTILE_RADIUS = 0.12;
export const SHOOTER_MUZZLE_Y = 1.2;

// --- ENEMY PREDICTIVE AIM (M14) ---
// Enemies solve for where the player WILL be when the round arrives, instead
// of firing at where the player is now. AI_LEAD_STRENGTH scales how much of
// the computed lead is applied (1.0 = perfect prediction; <1 = deliberately
// imperfect so a hard juke can still beat it). Shooter aims more precisely
// than the suppressive minigun heavy.
export const AI_LEAD_ITERATIONS = 3;     // fixed-point solve passes
export const AI_LEAD_STRENGTH_SHOOTER = 0.92;
export const AI_LEAD_STRENGTH_HEAVY = 0.75;

// SCATTER: proactive personal-space so enemies don't clump into a single
// blob converging on the player. Each enemy is nudged away from nearby
// same-floor allies within AI_SCATTER_RADIUS; the nudge is a velocity
// component (not a hard shove like separateEnemies) so it shapes the
// approach into a spread instead of a conga line. Falls to 0 at the radius.
export const AI_SCATTER_RADIUS = 4.5;
export const AI_SCATTER_STRENGTH = 3.4;   // m/s at zero distance, linearly → 0 at radius

// --- HEALTH BAR COLORS ---
export const HEALTH_COLOR_HIGH = '#4ade80';
export const HEALTH_COLOR_MID  = '#fbbf24';
export const HEALTH_COLOR_LOW  = '#ef4444';

// --- WAVE SYSTEM ---
// Per design.md. Index 0 is unused so wave numbers are 1-indexed.
export const WAVE_TABLE = [
  null,
  { grunts:  3, shooters: 0, heavies: 0 }, // 1
  { grunts:  5, shooters: 0, heavies: 0 }, // 2
  { grunts:  4, shooters: 2, heavies: 0 }, // 3
  { grunts:  6, shooters: 2, heavies: 0 }, // 4
  { grunts:  5, shooters: 3, heavies: 1 }, // 5
  { grunts:  7, shooters: 3, heavies: 1 }, // 6
  { grunts:  6, shooters: 4, heavies: 2 }, // 7
  { grunts:  8, shooters: 4, heavies: 2 }, // 8
  { grunts:  7, shooters: 5, heavies: 3 }, // 9
  { grunts: 10, shooters: 5, heavies: 4 }, // 10
];
export const MAX_WAVE = 10;
export const BREAK_DURATION = 5.0;

// M15 Stage 3: weapons are no longer unlocked by wave number. Each non-pistol
// weapon spawns as a PICKUP on the map (see PICKUPS in maplayout.js); walking
// over it permanently unlocks the weapon for the rest of the run AND tops up
// its ammo. The wave system only spawns enemies; it owns no weapon state.

// --- PICKUPS (M15 Stage 3) ---
// Weapon pickups and HEALTH pickups sit at fixed map positions. Walk-over to
// collect (PICKUP_RADIUS horizontal, ±PICKUP_VERT_TOL vertical so a pickup on
// a deck doesn't trigger from the ground below it). Collected pickups hide
// and respawn after PICKUP_RESPAWN seconds, so health pickups remain useful
// across a wave and weapon pickups double as ammo refills after the first
// grab. Visuals: a small group that bobs and spins for visibility.
export const PICKUP_RADIUS = 1.1;          // horizontal collect distance (m)
export const PICKUP_VERT_TOL = 1.6;        // vertical tolerance — must be on same level (≤ standing height)
export const PICKUP_RESPAWN = 25.0;        // seconds before a collected pickup returns
export const PICKUP_HOVER_HEIGHT = 0.9;    // base hover above the surface (m)
export const PICKUP_BOB_AMP = 0.10;        // bob amplitude (m)
export const PICKUP_BOB_RATE = 2.2;        // bob frequency (rad/s)
export const PICKUP_SPIN_RATE = 1.4;       // yaw rotation rate (rad/s)
export const HEALTH_PICKUP_AMOUNT = 25;    // HP restored per health pickup (capped at PLAYER_MAX_HEALTH)

// Knife: always available melee fallback. Short reach, fast swipe, lethal to
// light enemies in one hit (kills a 30-HP grunt / 20-HP shooter outright;
// ~2 hits for a 150-HP heavy).
export const KNIFE_RANGE = 2.6;
export const KNIFE_DAMAGE = 75;
export const KNIFE_COOLDOWN = 0.42;      // seconds between swipes
export const KNIFE_SPEED_MULT = 1.15;    // small mobility buff while knife is out

// --- SPAWNING ---
// Enemies spawn on a ring AROUND THE PLAYER (not the arena origin), so they
// never appear in your lap regardless of where you've moved. The ring radius
// is randomized between MIN and MAX each spawn, candidates are clamped to
// stay inside the play area, and a hard MIN_DIST gate rejects anything too
// close. SPAWN_SPREAD_TRIES picks the farthest-from-other-fresh-spawns
// candidate so a wave fans out instead of clustering on one arc.
export const ARENA_PLAYABLE_HALF = 38;   // keep spawns inside walls (arena 80 → ±40 walls)
export const SPAWN_MIN_DIST = 22;        // hard minimum distance from player
export const SPAWN_MAX_DIST = 34;        // outer ring distance from player
export const SPAWN_MAX_ATTEMPTS = 18;
export const SPAWN_VIEW_CONE_DOT = 0.3;
export const SPAWN_COVER_MARGIN = 1.0;
export const SPAWN_SPREAD_TRIES = 6;     // candidates evaluated for fan-out
export const SPAWN_SPREAD_MEMORY = 8;    // recent spawns remembered for spacing

// Legacy alias — some older call sites referenced SPAWN_RADIUS directly.
export const SPAWN_RADIUS = 32;

// --- HUD POLISH ---
export const HIT_MARKER_TIME = 0.18;
export const HEADSHOT_MARKER_TIME = 0.28;  // M10: longer marker for headshots
export const DAMAGE_INDICATOR_TIME = 1.1;

// --- AUDIO ---
export const AUDIO_MASTER_VOLUME = 0.45;

// --- GAME STATES ---
export const GAME_STATE = {
  TITLE: 'title',
  PLAYING: 'playing',
  BETWEEN_WAVES: 'between_waves',
  PAUSED: 'paused',
  GAMEOVER: 'gameover',
  WON: 'won',
};

// --- INPUT ---
// Keys to grab via Keyboard Lock API where supported (Chrome in fullscreen).
// Esc is deliberately excluded.
export const KEYS_TO_LOCK = [
  'KeyA','KeyB','KeyC','KeyD','KeyE','KeyF','KeyG','KeyH','KeyI','KeyJ',
  'KeyK','KeyL','KeyM','KeyN','KeyO','KeyP','KeyQ','KeyR','KeyS','KeyT',
  'KeyU','KeyV','KeyW','KeyX','KeyY','KeyZ',
  'Digit0','Digit1','Digit2','Digit3','Digit4',
  'Digit5','Digit6','Digit7','Digit8','Digit9',
  'Space','Tab','Enter','Backspace',
  'ControlLeft','ControlRight',
  'ShiftLeft','ShiftRight',
  'AltLeft','AltRight',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
];
