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
// S55: doubled to 160×160 (was 80×80). The map now hosts a city-block
// layout with multiple full buildings + multi-floor structures instead of
// the single Citadel courtyard.
export const ARENA_SIZE = 160;
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
// S55af: second zoom level on the sniper. Right-click cycles
// off → SCOPE_FOV (25°) → SCOPE_FOV_2 (10°) → off. The tighter zoom
// shrinks the scope FOV by ~2.5× over the first stage.
export const SCOPE_FOV_2 = 10;

// --- LOOP / NUMERICS ---
export const MAX_DT = 0.1;
export const COLLIDE_EPS = 1e-5;

// --- WEAPONS / RAYCAST ---
export const RAYCAST_RANGE = 200;
export const HEADSHOT_MULTIPLIER = 2.5;  // M10: head-meshes deal this much extra damage
export const DECAL_LIFE = 5.0;
export const MAX_DECALS = 60;
// S54: blood splat lifetime (seconds) and pool cap. Splats fade their opacity
// linearly over the lifetime, then are disposed.
export const BLOOD_LIFE = 1.4;
export const MAX_BLOOD = 80;
export const MUZZLE_FLASH_TIME = 0.045;
export const RECOIL_DECAY = 9.0;
export const RECOIL_PISTOL = 0.018;
export const RECOIL_SHOTGUN = 0.055;
export const RECOIL_SMG = 0.022;
export const RECOIL_SNIPER = 0.080;
export const RECOIL_SAW = 0.030;   // M249: medium, between SMG and shotgun

// --- RECOIL PATTERNS (Session 50) ---
// CS-style spray patterns. Each entry { p, y } is the per-shot kick added to
// the camera pitch (p, +up) and yaw (y, +right) in radians. tryFire() looks up
// pattern[sprayIndex % length], adds the kick (recoilPitch += p, recoilYaw +=
// y) and increments sprayIndex. RECOIL_DECAY brings both back toward zero
// each frame; RECOIL_RESET_TIME of no firing snaps sprayIndex back to 0 so
// each new burst restarts the pattern (this is what makes the AK's T pattern
// learnable in CS — you compensate by pulling DOWN against pitch and LEFT/
// RIGHT against the deliberate yaw drift).
// Patterns chosen by feel rather than copy of real CS spreadsheets:
//   smg : 12 shots — small pitch builds early, then alternating horizontal drift
//   saw : 15 shots — heavier vertical first, then heavy alternating horizontal
//   pistol/shotgun/sniper : single-entry (semi-auto / bolt-action)
export const RECOIL_PATTERNS = {
  pistol:  [{ p: RECOIL_PISTOL,  y: 0.000 }],
  shotgun: [{ p: RECOIL_SHOTGUN, y: 0.012 }],
  sniper:  [{ p: RECOIL_SNIPER,  y: 0.000 }],
  smg: [
    { p: 0.020, y:  0.000 }, { p: 0.022, y:  0.004 }, { p: 0.024, y: -0.003 },
    { p: 0.024, y:  0.006 }, { p: 0.022, y: -0.007 }, { p: 0.020, y:  0.009 },
    { p: 0.018, y: -0.010 }, { p: 0.016, y:  0.011 }, { p: 0.015, y: -0.012 },
    { p: 0.014, y:  0.012 }, { p: 0.013, y: -0.013 }, { p: 0.012, y:  0.011 },
  ],
  saw: [
    { p: 0.026, y:  0.000 }, { p: 0.030, y:  0.005 }, { p: 0.032, y: -0.004 },
    { p: 0.034, y:  0.008 }, { p: 0.032, y: -0.009 }, { p: 0.028, y:  0.012 },
    { p: 0.024, y: -0.013 }, { p: 0.022, y:  0.014 }, { p: 0.020, y: -0.014 },
    { p: 0.018, y:  0.015 }, { p: 0.016, y: -0.015 }, { p: 0.015, y:  0.014 },
    { p: 0.014, y: -0.014 }, { p: 0.013, y:  0.013 }, { p: 0.012, y: -0.012 },
  ],
};
// No fire for this long → spray index resets so a new burst starts at shot 1.
export const RECOIL_RESET_TIME = 0.35;

// --- VIEW-MODEL SWAY / BOB / LAG (Session 50) ---
// Each-frame additive offsets to the held weapon's transform so it feels
// alive: lags slightly when you turn, bobs while running, dips on landing.
// Tuned conservatively — strong enough to be felt, weak enough to not block
// the crosshair. Underlying mesh transform is independent (collision/aim
// use the camera, not the view-model position).
export const VIEW_SWAY_LAG = 0.040;      // multiplier on yaw/pitch delta → X/Y offset
export const VIEW_SWAY_MAX = 0.035;      // hard cap so a quick 180° doesn't fling the gun
export const VIEW_SWAY_DECAY = 12.0;     // how fast the lag offset returns to zero
export const VIEW_BOB_AMP = 0.010;       // bob amplitude at walk speed
export const VIEW_BOB_FREQ = 9.0;        // bob cycles/sec at walk speed (≈ 2 steps/sec * 4)
export const VIEW_LAND_DIP = 0.040;      // m of downward dip when feet hit the ground
export const VIEW_LAND_DIP_DECAY = 9.0;  // how fast the dip eases back up

// Reload anim — tunables consumed by the procedural reload routines in
// weapons.js. Each weapon has its own animated part (mag / pump / bolt /
// cover, tagged at build time via userData.reloadPart) plus a small whole-gun
// tilt and dip so the reload reads at a glance.
export const RELOAD_TILT_X = 0.30;       // rad: gun rotates rightward/up during reload
export const RELOAD_TILT_Z = -0.18;      // rad: gun rolls slightly outward
export const RELOAD_DIP_Y = -0.04;       // m: drops slightly during reload
export const RELOAD_MAG_DROP = 0.16;     // m: how far the magazine drops out of view
export const RELOAD_PUMP_TRAVEL = 0.05;  // m: shotgun pump back-and-forward
export const RELOAD_BOLT_TRAVEL = 0.04;  // m: sniper bolt back-and-forward
export const RELOAD_BOLT_ROTATE = 1.0;   // rad: sniper bolt twist (lift bolt before pulling)
export const RELOAD_COVER_OPEN = 0.9;    // rad: SAW top cover hinges up

// --- ENEMY SKIN OVERRIDES (S55ah) ---
// Per-class flags to swap in alternate authored rigs without losing the
// existing CS-rig path. Flip to false to revert to the S55p CS-rig (terror).
// The grunt operator rig is `assets/models/operator.glb`, a Claude-Design
// export with bundled skeletal animations.
export const USE_OPERATOR_FOR_GRUNT = false;

// --- ENEMIES ---
export const HIT_FLASH_TIME = 0.12;
export const DEATH_ANIM_TIME = 0.18;
export const ENEMY_CONTACT_RANGE_EXTRA = 0.15;
export const MELEE_ATTACK_COOLDOWN = 1.0;
export const SHOOTER_ATTACK_COOLDOWN = 2.0;
export const SHOOTER_DIST_MIN = 8.0;
export const SHOOTER_DIST_MAX = 40.0;   // will hold & fire from up to here before bothering to close
export const SHOOTER_FIRE_RANGE = 25.0;

// --- GRUNT PISTOL (S55ad) ---
// Replaces the broken knife-swipe. Grunt is now a close-range pistolier:
// closes to 6-14 m, fires a low-damage round on a brisk cadence with poor
// aim. Lower damage per shot than the shooter (4 vs 8) so a grunt feels
// like a chip-damage threat while shooters are real punishers.
export const GRUNT_FIRE_RANGE = 22.0;
export const GRUNT_DIST_MIN = 6.0;
export const GRUNT_DIST_MAX = 14.0;
export const GRUNT_ATTACK_COOLDOWN = 1.1;
export const GRUNT_DAMAGE = 4;
export const GRUNT_AIM_WOBBLE = 0.045;   // radians of per-shot aim error
export const GRUNT_LEAD_STRENGTH = 0.55; // worse prediction than shooter (0.92)

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

// --- ENEMY JUMP (S55g) ---
// Grunts and shooters can hop short obstacles (crates, low ledges). Peak
// height = v²/(2g) ≈ 0.76 m; combined with the 0.6 m step-up this lets
// them clear ~1.4 m. They are also willing to walk off elevated decks when
// the player is visibly below — see navGoal's drop-off branch.
export const ENEMY_JUMP_VY = 5.5;
export const ENEMY_MAX_JUMP_HEIGHT = 1.4;
export const ENEMY_JUMP_COOLDOWN = 0.7;
export const ENEMY_TERMINAL_VY = -25;

// --- JETPACK (S55) ---
// New flying enemy. Hovers above the player, fires a 3-round burst from a
// carbine, then reloads. Worse aim than the ground shooter (weaker lead +
// per-shot wobble); HP is low (it's exposed up there).
export const JETPACK_HOVER_HEIGHT_MIN = 5.5;   // metres above the player's floor
export const JETPACK_HOVER_HEIGHT_MAX = 11.0;  // upper hover bound
export const JETPACK_HORIZ_SPEED = 4.2;        // horizontal m/s
export const JETPACK_VERT_SPEED = 4.0;         // vertical m/s
export const JETPACK_ORBIT_DIST = 14.0;        // tries to keep this radius around the player
export const JETPACK_BURST_COUNT = 3;          // rounds per burst
export const JETPACK_BURST_INTERVAL = 0.10;    // seconds between rounds in a burst
export const JETPACK_BURST_COOLDOWN = 1.4;     // rest between bursts
export const JETPACK_AIM_WOBBLE = 0.025;       // radians of per-shot aim error
export const JETPACK_LEAD_STRENGTH = 0.55;     // worse prediction than the shooter (0.92)
export const JETPACK_FIRE_RANGE = 60.0;        // won't open up beyond this range
// Bob/sway so the jetpack isn't a static turret in the air.
export const JETPACK_BOB_AMP = 0.55;
export const JETPACK_BOB_FREQ = 1.6;

// --- AI ROUTING (S55) ---
// Doorway waypoints + stuck-escalation tunables. The new pathfinder lets AIs
// route through registered doorway midpoints instead of pawing at walls.
export const AI_DOORWAY_LATCH_DIST = 9.0;   // recruit a doorway waypoint within this radius if blocked
export const AI_DOORWAY_CLEAR_DIST = 1.6;   // drop a doorway waypoint when this close to it
export const AI_STUCK_ESCALATE = 2;         // after N back-to-back unsticks, run a deeper "back off + arc" maneuver
export const AI_BACKOFF_TIME = 0.55;        // duration of the deep-stuck backoff
export const AI_LAST_SEEN_TIME = 3.5;       // seconds AI keeps heading to last known player pos after LOS loss

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
// S55: jetpacks introduced in wave 3 and +1 every second round.
//   waves 1–2: 0 jetpacks
//   waves 3–4: 1 jetpack
//   waves 5–6: 2 jetpacks
//   waves 7–8: 3 jetpacks
//   waves 9–10: 4 jetpacks
export const WAVE_TABLE = [
  null,
  { grunts:  3, shooters: 0, heavies: 0, jetpacks: 0 }, // 1
  { grunts:  5, shooters: 0, heavies: 0, jetpacks: 0 }, // 2
  { grunts:  4, shooters: 2, heavies: 0, jetpacks: 1 }, // 3
  { grunts:  6, shooters: 2, heavies: 0, jetpacks: 1 }, // 4
  { grunts:  5, shooters: 3, heavies: 1, jetpacks: 2 }, // 5
  { grunts:  7, shooters: 3, heavies: 1, jetpacks: 2 }, // 6
  { grunts:  6, shooters: 4, heavies: 2, jetpacks: 3 }, // 7
  { grunts:  8, shooters: 4, heavies: 2, jetpacks: 3 }, // 8
  { grunts:  7, shooters: 5, heavies: 3, jetpacks: 4 }, // 9
  { grunts: 10, shooters: 5, heavies: 4, jetpacks: 4 }, // 10
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
export const PICKUP_HOVER_HEIGHT = 0.35;   // base hover above the surface (m) — close to floor
export const PICKUP_BOB_AMP = 0.10;        // bob amplitude (m)
export const PICKUP_BOB_RATE = 2.2;        // bob frequency (rad/s)
export const PICKUP_SPIN_RATE = 1.4;       // yaw rotation rate (rad/s)
export const HEALTH_PICKUP_AMOUNT = 25;    // HP restored per health pickup (capped at PLAYER_MAX_HEALTH)

// --- GRENADES (S55ae) ---
// Player-thrown explosive. Picked up on the map (kind='grenade'), tossed
// with G. Travels under gravity, bounces off solids with energy loss,
// detonates on fuse expiry. Explosion damages enemies + player inside
// GRENADE_RADIUS with linear-falloff damage (full at centre, 0 at edge).
export const GRENADE_MAX_HELD = 4;          // can hold this many at once
export const GRENADE_PICKUP_AMOUNT = 2;     // grenades gained per pickup
export const GRENADE_FUSE = 2.4;            // seconds from throw to detonation
export const GRENADE_THROW_SPEED = 16.0;    // initial speed (m/s)
export const GRENADE_THROW_UP = 0.20;       // y component of throw direction
export const GRENADE_GRAVITY = 14.0;        // gravity on the in-flight grenade
export const GRENADE_BOUNCE = 0.45;         // velocity multiplier on bounce
export const GRENADE_RADIUS = 6.0;          // explosion radius (m)
export const GRENADE_DAMAGE = 80;           // peak damage at centre (linear falloff)
export const GRENADE_SELF_DAMAGE_MULT = 0.6;// player self-damage from own grenade
export const GRENADE_THROW_COOLDOWN = 0.5;  // seconds between throws

// Knife: always available melee fallback. Short reach, fast swipe, lethal to
// light enemies in one hit (kills a 30-HP grunt / 20-HP shooter outright;
// ~2 hits for a 150-HP heavy).
export const KNIFE_RANGE = 2.6;
export const KNIFE_DAMAGE = 75;
export const KNIFE_COOLDOWN = 0.42;      // seconds between swipes
export const KNIFE_SPEED_MULT = 1.15;    // small mobility buff while knife is out
// S51: animation length of the visible swipe. Slightly shorter than the
// cooldown so the slash visually completes before the next swipe can fire.
export const KNIFE_SWIPE_DURATION = 0.36;

// --- SPAWNING ---
// Enemies spawn on a ring AROUND THE PLAYER (not the arena origin), so they
// never appear in your lap regardless of where you've moved. The ring radius
// is randomized between MIN and MAX each spawn, candidates are clamped to
// stay inside the play area, and a hard MIN_DIST gate rejects anything too
// close. SPAWN_SPREAD_TRIES picks the farthest-from-other-fresh-spawns
// candidate so a wave fans out instead of clustering on one arc.
// S55f: arena shrunk 160×160 → 130×130 (perimeter half=65) for instagib
// compactness. Spawn ring tightened so enemies stay inside the playable
// region and engage faster.
export const ARENA_PLAYABLE_HALF = 60;   // keep spawns inside walls (arena 130 → ±65 walls)
export const SPAWN_MIN_DIST = 22;        // hard minimum distance from player
export const SPAWN_MAX_DIST = 40;        // outer ring distance from player
export const SPAWN_MAX_ATTEMPTS = 22;
export const SPAWN_VIEW_CONE_DOT = 0.3;
export const SPAWN_COVER_MARGIN = 1.0;
export const SPAWN_SPREAD_TRIES = 6;     // candidates evaluated for fan-out
export const SPAWN_SPREAD_MEMORY = 8;    // recent spawns remembered for spacing

// Legacy alias — some older call sites referenced SPAWN_RADIUS directly.
export const SPAWN_RADIUS = 36;

// --- ARENA MODE (S55f) ---
// Continuous-combat alternative to the wave shooter. Maintains a target
// population of live enemies; when one dies, a replacement spawns after a
// short delay at a SPAWN_ANCHORS point far from the player. Player respawns
// on death at the farthest-from-enemies anchor instead of GAMEOVER. Score
// counts kills, not waves.
// S55k: bumped 5 → 7 to match the bigger / denser map. Still pacy
// enough for a single player; 12 ENEMY_SPAWN_POINTS + spread picker
// keeps engagements developing from every direction. Jetpack added
// so the player has to scan the sky as well as the ground.
export const ARENA_ENEMY_POPULATION = 7;
export const ARENA_ENEMY_RESPAWN_DELAY = 1.7;   // seconds from kill to replacement
export const ARENA_PLAYER_RESPAWN_DELAY = 1.0;  // seconds player stays dead before respawn
export const ARENA_ENEMY_MIX = { grunt: 3, shooter: 2, heavy: 1, jetpack: 1 };

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
