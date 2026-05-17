// enemies.js — enemy definitions, model construction, AI, lifecycle.
//
// M10 changes:
//   * Models are now hierarchical: body + head + 2 arms (+ 2 legs for heavy)
//     instead of just body + head. Adds visual character and a clearer head
//     hitbox for headshots.
//   * Each enemy's head mesh has `userData.isHead = true`. weapons.js reads
//     this in fireRays() to apply the headshot multiplier.
//   * Accent materials per enemy type give visual identity (e.g. heavy has a
//     chest plate and visor, shooter has a forward-tilted posture suggesting
//     it's aiming).
//   * Spawn radius and arena scale moved to constants.

import * as THREE from 'three';
import { scene } from './scene.js';
import { shootables, staticAABBs, collideCapsule, groundHeightAt, lineOfSight, rampLinks } from './collision.js';
import { player } from './state.js';
import {
  HIT_FLASH_TIME, DEATH_ANIM_TIME,
  MELEE_ATTACK_COOLDOWN, SHOOTER_ATTACK_COOLDOWN,
  SHOOTER_DIST_MIN, SHOOTER_DIST_MAX,
  AI_UNSTICK_CHECK, AI_UNSTICK_MIN_MOVE, AI_UNSTICK_TIME, AI_VANTAGE_LOS_TIME,
  ENEMY_CONTACT_RANGE_EXTRA, PLAYER_RADIUS, HEAVY_KNOCKBACK,
  SPAWN_MIN_DIST, SPAWN_MAX_DIST, SPAWN_MAX_ATTEMPTS,
  SPAWN_VIEW_CONE_DOT, SPAWN_COVER_MARGIN, SPAWN_SPREAD_MEMORY,
  ARENA_PLAYABLE_HALF,
  AI_STRAFE_SPEED_MULT, AI_STRAFE_FLIP_MIN, AI_STRAFE_FLIP_MAX,
  AI_PEEK_OUT_TIME, AI_PEEK_HIDE_TIME, AI_GRUNT_STRAFE_CHANCE,
  SHOOTER_MUZZLE_Y,
  HEAVY_FIRE_RANGE, HEAVY_WINDUP_TIME, HEAVY_FIRE_DURATION,
  HEAVY_FIRE_INTERVAL, HEAVY_BURST_COOLDOWN,
  HEAVY_MINIGUN_SPREAD, HEAVY_PREFERRED_DIST, HEAVY_BARREL_MAX_RPM,
  PROJECTILE_SPEED, AI_LEAD_ITERATIONS,
  AI_LEAD_STRENGTH_SHOOTER, AI_LEAD_STRENGTH_HEAVY,
  AI_SCATTER_RADIUS, AI_SCATTER_STRENGTH,
  GRAVITY,
} from './constants.js';
import { sfxEnemyDeath, sfxShooterFire } from './audio.js';
import { spawnProjectile } from './projectiles.js';
import { damagePlayer } from './player.js';
import { state, game } from './state.js';
import { GAME_STATE } from './constants.js';
import { onWaveCleared } from './wave.js';

export const enemies = [];

// Enemy capsule height, used for per-floor wall filtering + AABB Y span.
const ENEMY_BODY_H = 1.7;

// M11: redesigned enemy definitions with body/accent/visor/glow colors.
//   * `body` is the main armor color (most of the visible volume)
//   * `accent` is the trim color (belt, pauldrons, joints)
//   * `visor` is the head visor — emissive on heavy and shooter
//   * `glow` is a small chest/back-of-head emissive accent that reads as
//     "powered armor" — gives each silhouette a clear status indicator
export const ENEMY_DEFS = {
  grunt: {
    hp: 30, speed: 4.0, radius: 0.35, score: 100, contactDmg: 10,
    body: 0x991b1b, accent: 0x2a0a0a, visor: 0xff3838, glow: 0xff5252,
  },
  shooter: {
    hp: 20, speed: 2.5, radius: 0.35, score: 150, contactDmg: 0,
    body: 0xca8a04, accent: 0x422006, visor: 0xfde047, glow: 0xfacc15,
  },
  heavy: {
    hp: 150, speed: 1.5, radius: 0.50, score: 400, contactDmg: 25,
    body: 0x7f1d1d, accent: 0x0e0c0c, visor: 0xfacc15, glow: 0xfde047,
  },
};

// --- MODEL CONSTRUCTION ---
// M11: each builder returns hierarchical geometry with:
//   * Capsule torso/head for rounded silhouette (vs m10's stacked boxes)
//   * Emissive visor + chest core that read as glowing "vitals"
//   * Trim edges (thin accent strips at shoulder / belt / collar)
//   * Animation rig refs: head and arms saved separately on the returned
//     object so updateEnemies() can apply idle bob + arm sway per type
// userData.enemy → set on every mesh (raycaster route to enemy)
// userData.isHead → set ONLY on the head mesh (headshot detection)

// Helper: emissive material that survives tone mapping at high brightness.
function emissiveMat(color, intensity) {
  return new THREE.MeshStandardMaterial({
    color: color, emissive: color, emissiveIntensity: intensity,
    roughness: 0.4, metalness: 0.2, toneMapped: false,
  });
}

function buildGruntModel(def) {
  const main   = new THREE.MeshStandardMaterial({ color: def.body,   roughness: 0.55, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.7,  metalness: 0.45 });
  const visor  = emissiveMat(def.visor, 1.4);
  const glow   = emissiveMat(def.glow, 1.0);

  const group = new THREE.Group();

  // Torso — capsule for rounded shoulders
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 4, 10), main);
  torso.position.y = 0.95;

  // Chest core (small glowing center disc)
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), glow);
  core.rotation.x = Math.PI / 2;
  core.position.set(0, 1.05, -0.27);

  // Belt
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.5), accent);
  belt.position.y = 0.5;

  // Hips
  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.18, 4, 8), main);
  hips.position.y = 0.28;

  // Head — capsule for rounded helmet
  const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.20, 0.06, 4, 10), main);
  head.position.y = 1.58;

  // Visor — wide thin emissive band wrapping the front of the head
  const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.025), visor);
  visorMesh.position.set(0, 1.60, -0.20);

  // Arms — cylinder for rounded look
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.7, 10), main);
  armL.position.set( 0.42, 0.95, 0);
  const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.7, 10), main);
  armR.position.set(-0.42, 0.95, 0);

  // Shoulder pads
  const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), accent);
  shoulderL.position.set( 0.42, 1.30, 0);
  const shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), accent);
  shoulderR.position.set(-0.42, 1.30, 0);

  // M13: combat knife in the right hand.
  // The knife is parented to a small pivot Group placed at the right hand
  // (bottom of armR, slightly forward). Animating the pivot's rotation makes
  // the blade slash without needing to re-rig the whole arm. Default pose:
  // blade pointing forward (-Z), held at the hip.
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xd8dde6, roughness: 0.25, metalness: 0.9,
  });
  const hiltMat = new THREE.MeshStandardMaterial({
    color: 0x161616, roughness: 0.6, metalness: 0.3,
  });
  const knifePivot = new THREE.Group();
  // Right hand position: under/forward of the right arm.
  knifePivot.position.set(-0.42, 0.66, -0.10);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, 0.34), bladeMat);
  blade.position.set(0, 0, -0.20);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.025, 0.10, 4),
    bladeMat
  );
  // Cone points +Y by default; rotate so it points -Z to cap the blade.
  tip.rotation.x = -Math.PI / 2;
  tip.position.set(0, 0, -0.42);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.03, 0.03), hiltMat);
  guard.position.set(0, 0, -0.02);
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), hiltMat);
  hilt.rotation.x = Math.PI / 2;
  hilt.position.set(0, 0, 0.06);
  knifePivot.add(blade, tip, guard, hilt);
  // Resting orientation: slight inward angle so it reads as "held", not rigid.
  knifePivot.rotation.set(0, 0.25, 0);

  return {
    group,
    meshes: [torso, core, belt, hips, head, visorMesh, armL, armR, shoulderL, shoulderR],
    head, armL, armR,
    // M13: knife rig. The blade meshes are parented to knifePivot (NOT in
    // `meshes`, or they'd get re-parented to the group and the pivot animation
    // would do nothing). makeEnemy adds knifePivot to the group and registers
    // the blade meshes as shootable + shadow-casting separately.
    knifePivot,
    knifeMeshes: [blade, tip, guard, hilt],
    knifeRestRot: { x: 0, y: 0.25, z: 0 },
    bodyMats: [main, accent, bladeMat, hiltMat], // M11: hit-flash applies to these
    emissiveMats: [visor, glow], // these keep their permanent glow
  };
}

function buildShooterModel(def) {
  const main   = new THREE.MeshStandardMaterial({ color: def.body,   roughness: 0.55, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.7,  metalness: 0.45 });
  const visor  = emissiveMat(def.visor, 1.4);
  const glow   = emissiveMat(def.glow, 1.0);
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.35, metalness: 0.7 });

  const group = new THREE.Group();

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 4, 10), main);
  torso.position.y = 0.95;

  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), glow);
  core.rotation.x = Math.PI / 2;
  core.position.set(0, 1.05, -0.27);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.5), accent);
  belt.position.y = 0.5;

  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.18, 4, 8), main);
  hips.position.y = 0.28;

  const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.20, 0.06, 4, 10), main);
  head.position.y = 1.58;

  const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.10, 0.025), visor);
  visorMesh.position.set(0, 1.60, -0.20);

  // Arms held forward — aim posture. We rotate each arm group around its
  // local origin (shoulder) by tilting in X.
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.65, 10), main);
  armL.position.set( 0.30, 1.10, -0.18);
  armL.rotation.x = -0.55;
  const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.65, 10), main);
  armR.position.set(-0.30, 1.10, -0.18);
  armR.rotation.x = -0.55;

  // Rifle in front (compound: receiver + barrel + scope-ish bump)
  const rifleBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.45), gunMat);
  rifleBody.position.set(0, 1.05, -0.40);
  const rifleBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.30, 8), gunMat);
  rifleBarrel.rotation.x = Math.PI / 2;
  rifleBarrel.position.set(0, 1.07, -0.70);

  // Shoulder pads
  const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), accent);
  shoulderL.position.set( 0.42, 1.30, 0);
  const shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), accent);
  shoulderR.position.set(-0.42, 1.30, 0);

  return {
    group,
    meshes: [torso, core, belt, hips, head, visorMesh, armL, armR, rifleBody, rifleBarrel, shoulderL, shoulderR],
    head, armL, armR,
    bodyMats: [main, accent, gunMat],
    emissiveMats: [visor, glow],
  };
}

function buildHeavyModel(def) {
  const main   = new THREE.MeshStandardMaterial({ color: def.body,   roughness: 0.55, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.6,  metalness: 0.5 });
  const visor  = emissiveMat(def.visor, 1.6);
  const glow   = emissiveMat(def.glow, 1.2);
  const plate  = new THREE.MeshStandardMaterial({ color: 0x2a0e0e, roughness: 0.5, metalness: 0.6 });

  const group = new THREE.Group();

  // Wide capsule torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.6, 4, 12), main);
  torso.position.y = 1.10;

  // Chest plate
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 0.10), plate);
  chest.position.set(0, 1.20, -0.40);

  // Chest core glow — bigger and brighter on the heavy
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 16), glow);
  core.rotation.x = Math.PI / 2;
  core.position.set(0, 1.20, -0.46);

  // Belt
  const belt = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.18, 0.75), accent);
  belt.position.y = 0.55;

  // Head — bigger capsule
  const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.05, 4, 12), main);
  head.position.y = 1.88;

  // Yellow glowing visor — heavy's signature
  const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.025), visor);
  visorMesh.position.set(0, 1.89, -0.30);

  // Shoulder pauldrons — big armor plates
  const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), accent);
  shoulderL.position.set( 0.65, 1.55, 0);
  shoulderL.scale.set(1, 0.7, 1);
  const shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), accent);
  shoulderR.position.set(-0.65, 1.55, 0);
  shoulderR.scale.set(1, 0.7, 1);

  // Thick arms — cylinders
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.85, 12), main);
  armL.position.set( 0.65, 1.08, 0);
  const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.85, 12), main);
  armR.position.set(-0.65, 1.08, 0);

  // Legs — cylinders
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.5, 10), main);
  legL.position.set( 0.25, 0.25, 0);
  const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.5, 10), main);
  legR.position.set(-0.25, 0.25, 0);

  // --- M12 MINIGUN ---
  // Mounted forward of the torso, centered, pointing -Z (the model's forward,
  // same axis faceEnemyTowardPlayer aims). Construction:
  //   gunMount  — boxy receiver attached to the body
  //   barrelGrp — rotating group of 6 thin barrels in a ring + a hub; this
  //               group is returned so the AI can spin it on its Z axis
  //   muzzle    — emissive ring at the barrel tips (lights up while firing)
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.35, metalness: 0.85 });
  const gunAccent = new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.5, metalness: 0.7 });
  const muzzleMat = emissiveMat(0xffae3a, 0.0); // intensity raised while firing

  const gunMount = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.42), gunMetal);
  gunMount.position.set(0.20, 1.15, -0.40);

  // Ammo drum on the side
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.22, 14), gunAccent);
  drum.rotation.z = Math.PI / 2;
  drum.position.set(0.46, 1.05, -0.30);

  // Rotating barrel assembly
  const barrelGrp = new THREE.Group();
  barrelGrp.position.set(0.20, 1.16, -0.62);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.46, 12), gunAccent);
  hub.rotation.x = Math.PI / 2;
  barrelGrp.add(hub);
  const BARREL_COUNT = 6;
  const ring = 0.075;
  for (let i = 0; i < BARREL_COUNT; i++) {
    const ang = (i / BARREL_COUNT) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.54, 8), gunMetal);
    b.rotation.x = Math.PI / 2;
    b.position.set(Math.cos(ang) * ring, Math.sin(ang) * ring, 0);
    barrelGrp.add(b);
  }
  // Emissive muzzle disc at the front of the barrel cluster
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 14), muzzleMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0.20, 1.16, -0.92);

  return {
    group,
    meshes: [
      torso, chest, core, belt, head, visorMesh, shoulderL, shoulderR,
      armL, armR, legL, legR, gunMount, drum, muzzle,
    ],
    head, armL, armR,
    bodyMats: [main, accent, plate, gunMetal, gunAccent],
    emissiveMats: [visor, glow, muzzleMat],
    // M12: extra refs for the minigun. barrelGrp is added to the model group
    // here (it's a Group, not a Mesh, so it's not in `meshes`/`shootables` —
    // intentionally not shootable, it's cosmetic). muzzleMat lets the AI glow
    // the muzzle while firing.
    barrelGrp,
    muzzleMat,
  };
}

const MODEL_BUILDERS = {
  grunt: buildGruntModel,
  shooter: buildShooterModel,
  heavy: buildHeavyModel,
};

export function makeEnemy(type, x, z) {
  const def = ENEMY_DEFS[type];
  const built = MODEL_BUILDERS[type](def);

  built.group.position.set(x, 0, z);
  for (let i = 0; i < built.meshes.length; i++) {
    const m = built.meshes[i];
    m.castShadow = true;
    m.receiveShadow = true;
    built.group.add(m);
  }
  // M12: the heavy's minigun has a rotating barrel Group (not in `meshes`
  // since it's cosmetic / non-shootable). Add it to the model group and turn
  // off shadows on its children (lots of thin cylinders → shadow acne + cost).
  if (built.barrelGrp) {
    built.barrelGrp.traverse((o) => {
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
    });
    built.group.add(built.barrelGrp);
  }
  // M13: the grunt's knife lives under a pivot Group (so the swipe animation
  // can rotate the whole blade as a unit). Parent the pivot to the model
  // group; the blade meshes themselves still cast shadows + are shootable.
  if (built.knifePivot) {
    for (let i = 0; i < built.knifeMeshes.length; i++) {
      built.knifeMeshes[i].castShadow = true;
      built.knifeMeshes[i].receiveShadow = true;
    }
    built.group.add(built.knifePivot);
  }
  scene.add(built.group);

  const aabb = {
    minX: x - def.radius, maxX: x + def.radius,
    minZ: z - def.radius, maxZ: z + def.radius,
  };

  const enemy = {
    type, def,
    position: new THREE.Vector3(x, 0, z),
    group: built.group,
    bodyMats: built.bodyMats,         // M11: flashable materials
    emissiveMats: built.emissiveMats, // M11: permanent-glow materials (visor/core)
    meshes: built.meshes,
    head: built.head,
    armL: built.armL,
    armR: built.armR,
    armLRestX: built.armL ? built.armL.rotation.x : 0,
    armRRestX: built.armR ? built.armR.rotation.x : 0,
    headRestY: built.head ? built.head.position.y : 0,
    animPhase: Math.random() * Math.PI * 2,
    // M12: minigun refs (heavy only; undefined for others — guarded at use)
    barrelGrp: built.barrelGrp || null,
    muzzleMat: built.muzzleMat || null,
    aabb,
    hp: def.hp,
    maxHp: def.hp,
    hitFlashTimer: 0,
    deathTimer: 0,
    attackCooldown: 0,
    alive: true,

    // --- M12 AI STATE ---
    // aiState: 'advance' | 'strafe' | 'reposition' | 'peek' | 'hide'
    aiState: 'advance',
    aiTimer: 0,                 // generic per-state countdown
    retargetTimer: 0,          // throttle for recomputing the tactical goal
    strafeDir: Math.random() < 0.5 ? 1 : -1,  // +1 = circle CW, -1 = CCW
    strafeFlipTimer: AI_STRAFE_FLIP_MIN + Math.random() * (AI_STRAFE_FLIP_MAX - AI_STRAFE_FLIP_MIN),
    hadLOS: false,             // could the enemy see the player last tick
    flankSign: Math.random() < 0.5 ? 1 : -1,  // which way to arc when seeking LOS
    // grunts: only a fraction juke; the rest still rush (variety + pressure)
    juker: Math.random() < AI_GRUNT_STRAFE_CHANCE,
    // M15 Stage 2: cross-floor navigation latch (see navGoal).
    navRamp: -1,               // index into rampLinks, or -1 (none)
    navExitUp: true,           // is the latched traversal upward?
    navActive: false,          // currently pathing to a ramp (cross-floor)?
    navVantage: false,         // climbing for a sightline (not because player is up)
    noLosTimer: 0,             // seconds since we last saw the player
    _saw: false,               // did canSeePlayer return true this frame
    scatterX: 0, scatterZ: 0,  // per-frame personal-space nudge (anti-clump)
    _losAimY: 1.0,             // player-rel Y of the highest part we can see
    // stuck-detection: sampled position + timers (windows / ramp mouths)
    stuckX: x, stuckZ: z,
    stuckCheckTimer: AI_UNSTICK_CHECK,
    unstickTimer: 0,
    unstickSign: Math.random() < 0.5 ? 1 : -1,
    // heavy minigun sub-state: 'idle' | 'windup' | 'firing' | 'spindown'
    gunState: 'idle',
    gunTimer: 0,
    fireTickTimer: 0,
    barrelSpin: 0,             // current barrel angular position (radians)
    barrelSpeed: 0,            // current barrel angular velocity (radians/s)

    // --- M13 GRUNT KNIFE SWIPE ---
    // knifePivot: Group the blade meshes hang under; rotating it = the slash.
    // swipeTimer counts DOWN through one swing; 0 = idle (resting pose).
    // swipeHit gates damage to a single frame mid-swing (the "connect" point).
    knifePivot: built.knifePivot || null,
    knifeRestRot: built.knifeRestRot || null,
    swipeTimer: 0,
    swipeDuration: 0.42,       // total swing length (s)
    swipeHitDone: false,
  };

  // M13: register the grunt's knife meshes as shootable + enemy-tagged, just
  // like body meshes (so you can shoot the knife/hand and it counts as a body
  // hit on that grunt — not a headshot).
  if (built.knifeMeshes) {
    for (let i = 0; i < built.knifeMeshes.length; i++) {
      built.knifeMeshes[i].userData.enemy = enemy;
      shootables.push(built.knifeMeshes[i]);
    }
    enemy.knifeMeshes = built.knifeMeshes;
  }

  // Tag every mesh with the enemy ref so the raycaster can route hits.
  // Tag ONLY the head mesh with isHead = true so weapons can detect headshots.
  for (let i = 0; i < built.meshes.length; i++) {
    built.meshes[i].userData.enemy = enemy;
    shootables.push(built.meshes[i]);
  }
  built.head.userData.isHead = true;

  enemies.push(enemy);
  return enemy;
}

function syncEnemy(e) {
  e.group.position.x = e.position.x;
  e.group.position.y = e.position.y;   // M15 Stage 2: ride the surface
  e.group.position.z = e.position.z;
  e.aabb.minX = e.position.x - e.def.radius;
  e.aabb.maxX = e.position.x + e.def.radius;
  e.aabb.minZ = e.position.z - e.def.radius;
  e.aabb.maxZ = e.position.z + e.def.radius;
  // M15: give the enemy AABB a vertical span at its current floor so the
  // player's height-filtered collision only bumps enemies on the same level
  // (you don't collide with an enemy on the catwalk while you're beneath it).
  e.aabb.minY = e.position.y;
  e.aabb.maxY = e.position.y + ENEMY_BODY_H;
}

// M9: face the player. Three.js convention: -Z is forward for an unrotated
// mesh, so we rotate around Y by atan2(-dx, -dz) to point local -Z at the
// player. With the more complex M10 models, this also keeps visors / chest
// plates / forward-tilted arms oriented toward the player.
function faceEnemyTowardPlayer(e, dx, dz) {
  if (dx * dx + dz * dz < 1e-6) return;
  e.group.rotation.y = Math.atan2(-dx, -dz);
}

export function damageEnemy(enemy, damage) {
  if (!enemy.alive) return;
  enemy.hp -= damage;
  enemy.hitFlashTimer = HIT_FLASH_TIME;
  // Flash only the body materials. Emissive visor/core mats keep their
  // permanent glow during the flash (they're set up to be "always lit").
  for (let i = 0; i < enemy.bodyMats.length; i++) {
    enemy.bodyMats[i].emissive.setRGB(1, 1, 1);
  }
  if (enemy.hp <= 0) killEnemy(enemy);
}

export function killEnemy(enemy) {
  enemy.alive = false;
  enemy.deathTimer = DEATH_ANIM_TIME;
  for (let i = 0; i < enemy.meshes.length; i++) {
    const idx = shootables.indexOf(enemy.meshes[i]);
    if (idx !== -1) shootables.splice(idx, 1);
  }
  // M13: knife meshes are shootable too — remove them on death.
  if (enemy.knifeMeshes) {
    for (let i = 0; i < enemy.knifeMeshes.length; i++) {
      const idx = shootables.indexOf(enemy.knifeMeshes[i]);
      if (idx !== -1) shootables.splice(idx, 1);
    }
  }
  sfxEnemyDeath();
  if (state.gameState === GAME_STATE.PLAYING || state.gameState === GAME_STATE.BETWEEN_WAVES) {
    game.score += enemy.def.score;
    game.enemiesAlive -= 1;
    if (state.gameState === GAME_STATE.PLAYING && game.enemiesAlive <= 0 && !game.mapTest) {
      onWaveCleared();
    }
  }
}

// ============================================================================
// M12 TACTICAL AI
// ============================================================================
// All three enemy types share one movement vocabulary built from a few
// primitives, then layer type-specific combat on top:
//
//   advance      walk toward the player (used to close distance)
//   strafe       circle the player left/right at current range (juke)
//   reposition   no line-of-sight → arc around obstacles to regain it
//   peek/hide    ranged types: pop out from cover to fire, then duck back
//
// Line of sight is the 2D `lineOfSight()` segment test from collision.js
// (chest height). Enemies only fire when they can actually see the player,
// and actively try to re-establish LOS when blocked instead of pressing
// face-first into a wall.
//
// Movement helpers all funnel through `stepToward` so static + dynamic
// collision resolution stays consistent with the rest of the game.

const _vec = { x: 0, z: 0 };

// M15: enemies use the same Source-style split as the player — horizontal
// capsule resolve against solids, then snap to the highest walkable surface
// beneath them (riding decks/ramps, falling off edges). enemy.position.y
// tracks the floor the enemy is on, feeding canSeePlayer's 3D LOS.
function stepMove(enemy, vx, vz, dt) {
  // Scatter: add the proactive personal-space velocity (computed once per
  // frame in updateEnemies, and forced to 0 there for enemies that are
  // climbing a ramp or unsticking). This shapes the approach into a spread
  // so enemies don't form a single clump funnelling along one line toward
  // the player, without ever fighting the committed nav/unstick movement.
  vx += enemy.scatterX || 0;
  vz += enemy.scatterZ || 0;
  if (vx !== 0 || vz !== 0) {
    enemy.position.x += vx * dt;
    enemy.position.z += vz * dt;
    const res = collideCapsule(
      enemy.position.x, enemy.position.y, enemy.position.z,
      enemy.def.radius, ENEMY_BODY_H
    );
    enemy.position.x = res.x;
    enemy.position.z = res.z;
  }
  // Vertical: snap to / fall toward the surface below (within step-up).
  const STEP = 0.6;
  const gY = groundHeightAt(
    enemy.position.x, enemy.position.z,
    enemy.position.y + STEP, enemy.def.radius
  );
  const groundY = gY === null ? 0 : gY;
  if (enemy.position.y > groundY) {
    enemy.position.y -= Math.min(enemy.position.y - groundY, GRAVITY * dt * dt + 0.25);
    if (enemy.position.y < groundY) enemy.position.y = groundY;
  } else {
    enemy.position.y = groundY;
  }
}

// --- CROSS-FLOOR NAVIGATION ---
// If the player is on a different height, walking straight grinds into a
// deck wall. Retarget via a ramp. The earlier "near entry → aim at exit"
// heuristic oscillated (moving up the ramp grew the entry distance, which
// flipped the target back to the entry). Fix: LATCH onto a ramp. Once the
// enemy commits, it keeps targeting that ramp's exit until it has reached
// the exit's height (± tolerance) or the player changes to its level —
// then the latch clears and it re-evaluates. State lives on the enemy:
//   enemy.navRamp  = index into rampLinks (or -1)
//   enemy.navExitY = the height we're climbing/descending toward
const FLOOR_EPS = 2.0;

function pickRamp(enemy, goingUp) {
  let bi = -1, bestScore = Infinity;
  for (let i = 0; i < rampLinks.length; i++) {
    const r = rampLinks[i];
    const lowNear  = Math.abs(r.lowY  - enemy.position.y) < 2.6;
    const highNear = Math.abs(r.highY - enemy.position.y) < 2.6;
    let entry, exit;
    if (goingUp && lowNear)        { entry = { x: r.lowX,  z: r.lowZ  }; exit = { x: r.highX, z: r.highZ }; }
    else if (!goingUp && highNear) { entry = { x: r.highX, z: r.highZ }; exit = { x: r.lowX,  z: r.lowZ  }; }
    else continue;
    const dEntry = Math.hypot(entry.x - enemy.position.x, entry.z - enemy.position.z);
    const dExit  = Math.hypot(exit.x - player.position.x, exit.z - player.position.z);
    const score = dEntry + dExit;
    if (score < bestScore) { bestScore = score; bi = i; }
  }
  return bi;
}

function navGoal(enemy) {
  const dy = player.position.y - enemy.position.y;
  const sameFloor = Math.abs(dy) <= FLOOR_EPS;

  // Drop a vantage latch the moment we can see the player again, or if there
  // are no ramps at all.
  if (enemy.navVantage && (enemy.noLosTimer === 0 || rampLinks.length === 0)) {
    enemy.navVantage = false;
    enemy.navRamp = -1;
  }

  if (sameFloor && !enemy.navVantage) {
    // Same level as the player. Normally just chase directly. BUT if we've
    // been unable to see them for a sustained time and they're not right on
    // top of us, seek a HIGHER VANTAGE: latch the nearest up-ramp and climb
    // it for a clearer sightline instead of pawing at cover forever.
    const pdx = player.position.x - enemy.position.x;
    const pdz = player.position.z - enemy.position.z;
    const far = (pdx * pdx + pdz * pdz) > 12 * 12;
    if (enemy.noLosTimer > AI_VANTAGE_LOS_TIME && far && rampLinks.length > 0) {
      const ri = pickRamp(enemy, true);
      if (ri >= 0 && rampLinks[ri].highY > enemy.position.y + 1.5) {
        enemy.navRamp = ri;
        enemy.navExitUp = true;
        enemy.navVantage = true;
        // fall through to the steering code below
      } else {
        enemy.navRamp = -1;
        return null;
      }
    } else {
      enemy.navRamp = -1;
      return null;
    }
  } else if (rampLinks.length === 0) {
    enemy.navRamp = -1;
    return null;
  }

  // Vantage climbs are always "up"; a real cross-floor chase follows dy.
  const goingUp = enemy.navVantage ? true : dy > 0;

  // Validate an existing latch: still useful only if its exit height is in
  // the direction we need to go and we haven't yet reached that height.
  // (A vantage latch ignores the direction check — it only ends when we
  // top out or regain LOS, handled above.)
  if (enemy.navRamp >= 0 && enemy.navRamp < rampLinks.length) {
    const r = rampLinks[enemy.navRamp];
    const exitY = enemy.navExitUp ? r.highY : r.lowY;
    const reachedExit = Math.abs(enemy.position.y - exitY) < 1.0;
    const stillCorrectDir = enemy.navVantage || (enemy.navExitUp === goingUp);
    if (reachedExit || !stillCorrectDir) {
      enemy.navRamp = -1;          // arrived / wrong way now → re-evaluate
      if (reachedExit) enemy.navVantage = false;
    }
  }

  // Acquire a ramp if we don't have a valid latch.
  if (enemy.navRamp < 0) {
    enemy.navRamp = pickRamp(enemy, goingUp);
    enemy.navExitUp = goingUp;
    if (enemy.navRamp < 0) return null; // no ramp serves this transition
  }

  // Steer toward the latched ramp's EXIT. The exit lies past the entry along
  // the ramp run, so heading straight for it naturally walks the enemy onto
  // the mouth and up the slope — and because the ramp is latched (cleared
  // only on reaching exit height or a direction change) there's no
  // entry/exit flip-flop. We bias the target slightly toward the entry while
  // the enemy is still off the ramp and far to the side, so it lines up with
  // the mouth instead of trying to cut the corner into the deck wall.
  const r = rampLinks[enemy.navRamp];
  const up = enemy.navExitUp;
  const entry = up ? { x: r.lowX,  z: r.lowZ  } : { x: r.highX, z: r.highZ };
  const exit  = up ? { x: r.highX, z: r.highZ } : { x: r.lowX,  z: r.lowZ  };
  const startY = up ? r.lowY : r.highY;
  const offRamp = Math.abs(enemy.position.y - startY) < 0.4;
  if (offRamp) {
    const dEntry = Math.hypot(
      entry.x - enemy.position.x, entry.z - enemy.position.z
    );
    // Far from the mouth → aim at the mouth; close → commit to the exit so
    // we actually step onto and climb the ramp.
    if (dEntry > 2.0) return entry;
  }
  return exit;
}

// Unit vector from enemy toward its current goal (player, or a ramp entry if
// cross-floor). Writes into _vec, returns horizontal distance to the PLAYER
// (AI range checks still use true player distance, not goal distance).
function toPlayer(enemy) {
  const pdx = player.position.x - enemy.position.x;
  const pdz = player.position.z - enemy.position.z;
  const pd = Math.sqrt(pdx * pdx + pdz * pdz);

  const goal = navGoal(enemy);
  enemy.navActive = goal !== null;   // true ⇒ committed to a ramp, climbing
  let tx, tz;
  if (goal) {
    tx = goal.x - enemy.position.x;
    tz = goal.z - enemy.position.z;
  } else {
    tx = pdx; tz = pdz;
  }
  const d = Math.sqrt(tx * tx + tz * tz);
  if (d > 1e-4) { _vec.x = tx / d; _vec.z = tz / d; }
  else { _vec.x = 0; _vec.z = 0; }
  return pd;
}

// True if this enemy can see ANY exposed part of the player — head, chest,
// OR pelvis — not just the chest. A single chest ray meant a player peeking
// from cover with just their head (or just their legs) showing read as
// fully hidden, so hiding the torso alone made you untargetable and
// peek-shooting was free. Sampling several body points fixes that: if you
// can be seen well enough to shoot from, you can be shot back at.
//
// Side effect: stashes the player-relative Y of the HIGHEST visible sample
// in enemy._losAimY, so shooters/heavy aim at the part they can actually
// see (e.g. just the head over a crate) instead of firing into the cover.
const _LOS_SAMPLES_STAND  = [1.58, 1.05, 0.55];  // head, chest, pelvis
const _LOS_SAMPLES_CROUCH = [1.18, 0.80, 0.40];
function canSeePlayer(enemy) {
  const ex = enemy.position.x, ey = enemy.position.y + 1.1, ez = enemy.position.z;
  const px = player.position.x, py = player.position.y, pz = player.position.z;
  const samp = player.isCrouching ? _LOS_SAMPLES_CROUCH : _LOS_SAMPLES_STAND;
  for (let i = 0; i < samp.length; i++) {
    if (lineOfSight(ex, ey, ez, px, py + samp[i], pz)) {
      enemy._losAimY = samp[i];   // aim at the highest part in view
      enemy._saw = true;
      return true;
    }
  }
  enemy._saw = false;
  return false;
}

// Decrement a timer field, clamping at 0. Returns true on the frame it hits 0.
function tick(enemy, field, dt) {
  if (enemy[field] > 0) {
    enemy[field] -= dt;
    if (enemy[field] <= 0) { enemy[field] = 0; return true; }
  }
  return false;
}

// Strafe: move perpendicular to the enemy→player direction. strafeDir flips
// periodically so it doesn't orbit forever in one direction (looks robotic
// and is easy to predict). Returns the (vx,vz) via _vec scaled by speed.
function strafeVelocity(enemy, speed) {
  // Perpendicular to (_vec.x,_vec.z) is (-_vec.z, _vec.x). strafeDir picks side.
  return {
    x: -_vec.z * enemy.strafeDir * speed,
    z:  _vec.x * enemy.strafeDir * speed,
  };
}

function maybeFlipStrafe(enemy, dt) {
  if (tick(enemy, 'strafeFlipTimer', dt)) {
    enemy.strafeDir *= -1;
    enemy.strafeFlipTimer =
      AI_STRAFE_FLIP_MIN + Math.random() * (AI_STRAFE_FLIP_MAX - AI_STRAFE_FLIP_MIN);
  }
}

// Common: face the player and tick the melee/attack cooldown.
function faceAndCool(enemy, dt) {
  faceEnemyTowardPlayer(enemy, _vec.x, _vec.z);
  if (enemy.attackCooldown > 0) {
    enemy.attackCooldown -= dt;
    if (enemy.attackCooldown < 0) enemy.attackCooldown = 0;
  }
}

// Melee contact.
//   * Heavy: instant hit + knockback the moment you're in range (unchanged
//     feel — it's a brute, not a duelist).
//   * Grunt: initiates a knife SWIPE animation instead of dealing damage
//     instantly. The actual hit is applied partway through the swing by
//     updateGruntSwipe (so the damage visibly corresponds to the blade
//     connecting, and you can back out of range during the wind-up to dodge).
function tryMeleeContact(enemy, dist) {
  const contactRange = PLAYER_RADIUS + enemy.def.radius + ENEMY_CONTACT_RANGE_EXTRA;

  if (enemy.type === 'grunt') {
    // Start a swing if in range, not cooling down, and not already swinging.
    if (dist <= contactRange && enemy.attackCooldown <= 0 &&
        enemy.swipeTimer <= 0 && player.alive) {
      enemy.swipeTimer = enemy.swipeDuration;
      enemy.swipeHitDone = false;
      enemy.attackCooldown = MELEE_ATTACK_COOLDOWN;
    }
    return;
  }

  // Heavy (and any other melee type): instant.
  if (dist <= contactRange && enemy.attackCooldown <= 0 && player.alive) {
    damagePlayer(enemy.def.contactDmg, enemy.position.x, enemy.position.z);
    enemy.attackCooldown = MELEE_ATTACK_COOLDOWN;
    if (enemy.type === 'heavy' && dist > 1e-4) {
      player.velocityX += _vec.x * HEAVY_KNOCKBACK;
      player.velocityZ += _vec.z * HEAVY_KNOCKBACK;
    }
  }
}

// M13: drive the grunt's knife-swipe animation + apply the hit mid-swing.
//
// Swing timeline (swipeTimer counts DOWN from swipeDuration → 0):
//   phase = 1 - swipeTimer/swipeDuration   (0 = start, 1 = end)
//   * 0.00–0.30  wind-up: arm cocks back, knife raised
//   * 0.30–0.55  slash: fast arc across the front; the HIT lands at ~0.45
//   * 0.55–1.00  recover: arm + knife ease back to the resting pose
//
// The damage is applied once, on the first frame phase passes the connect
// point, and ONLY if the player is still within reach (so retreating during
// wind-up dodges it — the swing still animates, it just whiffs).
const SWIPE_CONNECT = 0.45;

function updateGruntSwipe(enemy, dt) {
  const pivot = enemy.knifePivot;
  if (!pivot) return;
  const rest = enemy.knifeRestRot;

  if (enemy.swipeTimer <= 0) {
    // Idle: hold the resting pose (idle arm-sway already moved armR; the
    // knife pivot is independent of the arm so just keep it at rest).
    pivot.rotation.set(rest.x, rest.y, rest.z);
    return;
  }

  enemy.swipeTimer -= dt;
  const phase = 1 - Math.max(0, enemy.swipeTimer) / enemy.swipeDuration;

  // Build the slash arc. The pivot mostly rotates about Y (horizontal slash
  // across the player's front) with a little X (downward chop) for weight.
  let yRot, xRot;
  if (phase < 0.30) {
    // Wind-up: cock back (knife swings out to the grunt's right + raised).
    const t = phase / 0.30;
    yRot = rest.y + t * 1.2;            // rotate blade back/outward
    xRot = rest.x - t * 0.5;            // raise it
  } else if (phase < 0.55) {
    // Slash: whip across to the left + down. Fast, eased.
    const t = (phase - 0.30) / 0.25;
    const e2 = t * t * (3 - 2 * t);     // smoothstep for a snappy feel
    yRot = (rest.y + 1.2) - e2 * 2.6;   // sweep all the way across
    xRot = (rest.x - 0.5) + e2 * 0.9;   // chop downward through the arc
  } else {
    // Recover: ease everything back to rest.
    const t = (phase - 0.55) / 0.45;
    const e2 = t * t * (3 - 2 * t);
    yRot = (rest.y - 1.4) + e2 * (rest.y - (rest.y - 1.4));
    xRot = (rest.x + 0.4) + e2 * (rest.x - (rest.x + 0.4));
  }
  pivot.rotation.set(xRot, yRot, rest.z);

  // Apply the hit once, at the connect point, if still in reach + facing.
  if (!enemy.swipeHitDone && phase >= SWIPE_CONNECT) {
    enemy.swipeHitDone = true;
    const dx = player.position.x - enemy.position.x;
    const dz = player.position.z - enemy.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const reach = PLAYER_RADIUS + enemy.def.radius + ENEMY_CONTACT_RANGE_EXTRA + 0.25;
    if (d <= reach && player.alive) {
      damagePlayer(enemy.def.contactDmg, enemy.position.x, enemy.position.z);
    }
  }

  if (enemy.swipeTimer <= 0) {
    enemy.swipeTimer = 0;
    pivot.rotation.set(rest.x, rest.y, rest.z);
  }
}

// --- GRUNT --------------------------------------------------------------
// Aggressive rusher, but the "juker" fraction weaves: alternates short
// advance bursts with strafing so it's not a straight line you can track.
// Non-jukers still beeline (keeps pressure high, adds variety across a wave).
// If LOS is blocked, all grunts arc toward the player's side to come around
// cover rather than grinding into a wall.
function gruntAI(enemy, dt) {
  const dist = toPlayer(enemy);
  faceAndCool(enemy, dt);
  const sees = canSeePlayer(enemy);
  const spd = enemy.def.speed;

  if (enemy.unstickTimer > 0) {
    // Wedged on geometry (window sill, ramp side, cover corner): slide
    // perpendicular to the goal with a little forward bias to scrape free.
    enemy.unstickTimer -= dt;
    const s = enemy.unstickSign;
    stepMove(enemy, (-_vec.z * s * 0.9 + _vec.x * 0.35) * spd,
                     ( _vec.x * s * 0.9 + _vec.z * 0.35) * spd, dt);
    return;
  }

  if (enemy.navActive) {
    // Player is on another floor and we're committed to a ramp: drive
    // STRAIGHT for it. (Without this the no-LOS arc below would spin us
    // sideways forever and we'd never climb — the elevation bug.)
    stepMove(enemy, _vec.x * spd, _vec.z * spd, dt);
    return;
  }

  if (!sees && dist > 2.0) {
    // Lost sight: arc around the obstacle. Blend forward + sideways so it
    // sweeps around corners instead of pawing at the wall.
    const s = enemy.flankSign;
    const vx = (_vec.x * 0.55 + (-_vec.z) * s * 0.85) * spd;
    const vz = (_vec.z * 0.55 + ( _vec.x) * s * 0.85) * spd;
    stepMove(enemy, vx, vz, dt);
  } else if (enemy.juker && dist > 3.0) {
    // Weave: bias forward but add a strafe component.
    maybeFlipStrafe(enemy, dt);
    const sv = strafeVelocity(enemy, spd * 0.7);
    const vx = _vec.x * spd * 0.75 + sv.x;
    const vz = _vec.z * spd * 0.75 + sv.z;
    stepMove(enemy, vx, vz, dt);
  } else {
    // Close the gap directly.
    stepMove(enemy, _vec.x * spd, _vec.z * spd, dt);
  }

  tryMeleeContact(enemy, dist);
}

// --- SHOOTER ------------------------------------------------------------
// Holds mid-range, only fires with LOS, and uses a peek/hide rhythm:
//   * No LOS                → reposition (arc) to find a firing angle
//   * LOS + too far/close   → adjust range while strafing
//   * LOS + good range      → strafe-peek and fire on cadence, then hide:
//                              periodically breaks LOS deliberately
function shooterAI(enemy, dt) {
  const dist = toPlayer(enemy);
  faceAndCool(enemy, dt);
  const sees = canSeePlayer(enemy);
  const spd = enemy.def.speed;

  tick(enemy, 'aiTimer', dt);
  maybeFlipStrafe(enemy, dt);

  if (enemy.unstickTimer > 0) {
    enemy.unstickTimer -= dt;
    const s = enemy.unstickSign;
    stepMove(enemy, (-_vec.z * s * 0.9 + _vec.x * 0.35) * spd,
                     ( _vec.x * s * 0.9 + _vec.z * 0.35) * spd, dt);
    enemy.hadLOS = false;
    return;
  }

  if (enemy.navActive) {
    // Cross-floor: move toward the ramp to close the height gap — BUT do
    // not stop shooting a player we can already see. Previously this branch
    // returned before any fire logic, so an elevated-but-visible player
    // made the shooter abandon firing entirely to go path to a ramp. Now
    // it fires on cadence whenever it has LOS, then continues to the ramp.
    stepMove(enemy, _vec.x * spd, _vec.z * spd, dt);
    if (sees) {
      shooterCombatTick(enemy, dt);
    } else {
      enemy.hadLOS = false;
    }
    return;
  }

  if (!sees) {
    // Can't see player: arc around cover toward a firing angle.
    enemy.aiState = 'reposition';
    const s = enemy.flankSign;
    const vx = (_vec.x * 0.5 + (-_vec.z) * s * 0.9) * spd;
    const vz = (_vec.z * 0.5 + ( _vec.x) * s * 0.9) * spd;
    stepMove(enemy, vx, vz, dt);
    enemy.hadLOS = false;
    return;
  }

  // Range management: keep within the shooter band while strafing.
  let approach = 0;
  if      (dist > SHOOTER_DIST_MAX) approach =  1;
  else if (dist < SHOOTER_DIST_MIN) approach = -1;

  const sv = strafeVelocity(enemy, spd * AI_STRAFE_SPEED_MULT);
  const vx = sv.x + _vec.x * spd * 0.6 * approach;
  const vz = sv.z + _vec.z * spd * 0.6 * approach;
  stepMove(enemy, vx, vz, dt);

  shooterCombatTick(enemy, dt);
}

// Peek/hide cadence + firing for a shooter that currently has LOS. Extracted
// so the cross-floor branch can also fire at a visible (e.g. elevated)
// player instead of suppressing combat while it paths to a ramp.
function shooterCombatTick(enemy, dt) {
  // Just regained LOS → start a fresh peek window.
  if (!enemy.hadLOS) {
    enemy.aiState = 'peek';
    enemy.aiTimer = AI_PEEK_OUT_TIME;
    enemy.hadLOS = true;
  }
  if (enemy.aiState === 'peek') {
    if (enemy.attackCooldown <= 0 && player.alive) {
      shooterFire(enemy);
      enemy.attackCooldown = SHOOTER_ATTACK_COOLDOWN;
    }
    if (enemy.aiTimer <= 0) {
      enemy.aiState = 'hide';
      enemy.aiTimer = AI_PEEK_HIDE_TIME;
      enemy.flankSign *= -1;
    }
  } else if (enemy.aiState === 'hide') {
    if (enemy.aiTimer <= 0) {
      enemy.aiState = 'peek';
      enemy.aiTimer = AI_PEEK_OUT_TIME;
    }
  }
}

// M14: predictive lead-aim. Returns a unit direction (into out{x,y,z}) from
// the muzzle (ox,oy,oz) toward where the player will be when a projectile of
// PROJECTILE_SPEED arrives, given the player's current horizontal velocity.
//
// Solve |P + V*t - M| = s*t for t by fixed-point iteration:
//   t0 = |P - M| / s            (time to current position)
//   t  = |P + V*t_prev - M| / s (refine; converges in ~2-3 passes)
// then aim at P + V*t*strength. `strength` < 1 leaves the player a sliver of
// counterplay (a sharp direction change mid-flight can still dodge).
const _lead = { x: 0, y: 0, z: 0 };
function leadAim(ox, oy, oz, aimY, strength) {
  const px = player.position.x;
  const pz = player.position.z;
  const py = player.position.y + aimY;
  const vx = player.velocityX || 0;
  const vz = player.velocityZ || 0;

  let t = Math.sqrt(
    (px - ox) * (px - ox) + (py - oy) * (py - oy) + (pz - oz) * (pz - oz)
  ) / PROJECTILE_SPEED;

  for (let i = 0; i < AI_LEAD_ITERATIONS; i++) {
    const fx = px + vx * t;
    const fz = pz + vz * t;
    t = Math.sqrt(
      (fx - ox) * (fx - ox) + (py - oy) * (py - oy) + (fz - oz) * (fz - oz)
    ) / PROJECTILE_SPEED;
  }

  // Apply only `strength` of the lead so prediction isn't pixel-perfect.
  const tx = px + vx * t * strength;
  const tz = pz + vz * t * strength;
  let dx = tx - ox;
  let dy = py - oy;
  let dz = tz - oz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  _lead.x = dx / len;
  _lead.y = dy / len;
  _lead.z = dz / len;
  return _lead;
}

function shooterFire(enemy) {
  const ox = enemy.position.x;
  // Muzzle is relative to the floor THIS enemy is standing on — not a fixed
  // world height. Without the +position.y a shooter up on a deck spawned its
  // projectile underground, and one on the ground shooting at a player on a
  // 7m deck launched from the wrong origin, so elevated trades never landed.
  const oy = enemy.position.y + SHOOTER_MUZZLE_Y;
  const oz = enemy.position.z;
  // Aim at whatever part of the player we actually have LOS to (stashed by
  // canSeePlayer), led for projectile travel time — so a player peeking
  // with only their head up gets shot at the head, not into the cover.
  const aimY = enemy._losAimY != null ? enemy._losAimY : (player.isCrouching ? 0.8 : 1.0);
  const dir = leadAim(ox, oy, oz, aimY, AI_LEAD_STRENGTH_SHOOTER);
  spawnProjectile(ox, oy, oz, dir.x, dir.y, dir.z);
  sfxShooterFire();
}

// --- HEAVY --------------------------------------------------------------
// Walking minigun platform. Behavior:
//   * Out of fire range / no LOS → advance (and arc around cover)
//   * In range with LOS          → hold around HEAVY_PREFERRED_DIST, strafe
//                                   slowly, run the minigun cycle:
//       idle → windup (telegraph, barrels spin up, no shots)
//            → firing (hose a stream of spread projectiles)
//            → spindown (barrels coast down) → idle (cooldown) → ...
//   * Always dangerous in melee (knockback retained).
// The barrel group spins based on gunState; the muzzle glows while firing.
function heavyAI(enemy, dt) {
  const dist = toPlayer(enemy);
  faceAndCool(enemy, dt);
  const sees = canSeePlayer(enemy);
  const spd = enemy.def.speed;

  const inRange = dist <= HEAVY_FIRE_RANGE;
  const engaging = sees && inRange;

  if (enemy.unstickTimer > 0) {
    enemy.unstickTimer -= dt;
    const s = enemy.unstickSign;
    stepMove(enemy, (-_vec.z * s * 0.9 + _vec.x * 0.35) * spd,
                     ( _vec.x * s * 0.9 + _vec.z * 0.35) * spd, dt);
    updateHeavyGun(enemy, dt, false);
    return;
  }

  if (enemy.navActive) {
    // Cross-floor: lumber toward the ramp to close the height gap, but keep
    // engaging if we can see the target. updateHeavyGun runs the full
    // windup→firing cycle (and calls heavyFire itself) when passed
    // engaging=true, so an elevated visible player still gets hosed instead
    // of getting a free pass while the heavy paths to a ramp.
    stepMove(enemy, _vec.x * spd, _vec.z * spd, dt);
    updateHeavyGun(enemy, dt, sees && inRange);
    return;
  }

  // --- MOVEMENT ---
  if (!sees) {
    // Lost LOS: lumber around the obstacle (slower arc than the grunt).
    const s = enemy.flankSign;
    const vx = (_vec.x * 0.7 + (-_vec.z) * s * 0.6) * spd;
    const vz = (_vec.z * 0.7 + ( _vec.x) * s * 0.6) * spd;
    stepMove(enemy, vx, vz, dt);
  } else if (dist > HEAVY_FIRE_RANGE) {
    // Close to engagement distance.
    stepMove(enemy, _vec.x * spd, _vec.z * spd, dt);
  } else {
    // In the fight: hold around preferred distance and strafe slowly so it
    // isn't a stationary turret but also isn't twitchy.
    maybeFlipStrafe(enemy, dt);
    let approach = 0;
    if      (dist > HEAVY_PREFERRED_DIST + 2.5) approach =  1;
    else if (dist < HEAVY_PREFERRED_DIST - 2.5) approach = -1;
    // While actively firing the heavy plants (no advance) for a heavier feel;
    // it only repositions between bursts.
    const firing = enemy.gunState === 'firing' || enemy.gunState === 'windup';
    const strafeMul = firing ? 0.35 : AI_STRAFE_SPEED_MULT;
    const sv = strafeVelocity(enemy, spd * strafeMul);
    const adv = firing ? 0 : (spd * 0.5 * approach);
    stepMove(enemy, sv.x + _vec.x * adv, sv.z + _vec.z * adv, dt);
  }

  // --- MINIGUN STATE MACHINE ---
  updateHeavyGun(enemy, dt, engaging);

  // --- MELEE (still bad to hug a heavy) ---
  tryMeleeContact(enemy, dist);
}

// Drives gunState + barrel spin + muzzle glow + projectile stream.
function updateHeavyGun(enemy, dt, engaging) {
  const g = enemy;

  switch (g.gunState) {
    case 'idle':
      // Resting; gunTimer counts down the inter-burst cooldown.
      if (g.gunTimer > 0) g.gunTimer -= dt;
      if (engaging && g.gunTimer <= 0) {
        g.gunState = 'windup';
        g.gunTimer = HEAVY_WINDUP_TIME;
      }
      break;

    case 'windup':
      // Telegraph: barrels accelerate, no shots yet. If the player breaks
      // engagement during windup the heavy aborts back to idle (so you can
      // juke behind cover to deny the burst).
      g.gunTimer -= dt;
      if (!engaging) { g.gunState = 'spindown'; break; }
      if (g.gunTimer <= 0) {
        g.gunState = 'firing';
        g.gunTimer = HEAVY_FIRE_DURATION;
        g.fireTickTimer = 0;
      }
      break;

    case 'firing':
      g.gunTimer -= dt;
      g.fireTickTimer -= dt;
      if (g.fireTickTimer <= 0 && player.alive) {
        heavyFire(g);
        g.fireTickTimer = HEAVY_FIRE_INTERVAL;
      }
      if (g.gunTimer <= 0 || !engaging) {
        g.gunState = 'spindown';
      }
      break;

    case 'spindown':
      // Barrels coast down; once slow, return to idle + start the cooldown.
      if (g.barrelSpeed < 1.0) {
        g.gunState = 'idle';
        g.gunTimer = HEAVY_BURST_COOLDOWN;
      }
      break;
  }

  // Barrel target speed by state.
  let targetSpeed = 0;
  if (g.gunState === 'windup')        targetSpeed = HEAVY_BARREL_MAX_RPM * 0.6;
  else if (g.gunState === 'firing')   targetSpeed = HEAVY_BARREL_MAX_RPM;
  else if (g.gunState === 'spindown') targetSpeed = 0;

  // Ease barrelSpeed toward target, integrate spin, apply to the group.
  g.barrelSpeed += (targetSpeed - g.barrelSpeed) * Math.min(1, dt * 4.0);
  if (g.barrelGrp) {
    g.barrelSpin += g.barrelSpeed * dt;
    g.barrelGrp.rotation.z = g.barrelSpin;
  }

  // Muzzle glow tracks firing.
  if (g.muzzleMat) {
    const lit = g.gunState === 'firing';
    const target = lit ? 1.6 : 0.0;
    g.muzzleMat.emissiveIntensity +=
      (target - g.muzzleMat.emissiveIntensity) * Math.min(1, dt * 12.0);
  }
}

// One minigun round: a spread projectile fired from the barrel muzzle toward
// the player. Spread is wider than the shooter's aimed shot (suppressive).
function heavyFire(enemy) {
  // Muzzle ≈ 0.2 right of center, ~1.16 high, ~0.92 forward along facing.
  // Compute world muzzle from the enemy facing (group.rotation.y).
  const yaw = enemy.group.rotation.y;
  const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
  // local offset (0.20, 1.16, -0.92) → world (rotate XZ by yaw)
  const lx = 0.20, lz = -0.92;
  const ox = enemy.position.x + (lx * cosY + lz * sinY);
  const oy = enemy.position.y + 1.16;   // relative to the heavy's own floor
  const oz = enemy.position.z + (-lx * sinY + lz * cosY);

  const eyeH = player.isCrouching ? 1.2 : 1.6;
  // Lead the aim at the part we can see (weaker strength than the shooter —
  // it's suppressive fire), then add the cone spread on top.
  const aimY = enemy._losAimY != null ? enemy._losAimY : eyeH * 0.5;
  const dir = leadAim(ox, oy, oz, aimY, AI_LEAD_STRENGTH_HEAVY);
  let ddx = dir.x, ddy = dir.y, ddz = dir.z;

  const s = HEAVY_MINIGUN_SPREAD;
  ddx += (Math.random() * 2 - 1) * s;
  ddy += (Math.random() * 2 - 1) * s * 0.6;
  ddz += (Math.random() * 2 - 1) * s;
  const l2 = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);

  spawnProjectile(ox, oy, oz, ddx / l2, ddy / l2, ddz / l2);
  sfxShooterFire();
}

export function updateEnemies(dt) {
  // --- SCATTER pass: compute each live enemy's personal-space nudge from
  // nearby same-floor allies BEFORE the AIs run, so the value is stable for
  // this frame. Zeroed for enemies that are climbing a ramp or unsticking,
  // so it never fights that committed movement.
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    a.scatterX = 0; a.scatterZ = 0;
    if (!a.alive || a.navActive || a.navVantage || a.unstickTimer > 0) continue;
    let sx = 0, sz = 0;
    for (let j = 0; j < enemies.length; j++) {
      if (j === i) continue;
      const b = enemies[j];
      if (!b.alive) continue;
      if (Math.abs(a.position.y - b.position.y) > 1.5) continue; // different floor
      const dx = a.position.x - b.position.x;
      const dz = a.position.z - b.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= AI_SCATTER_RADIUS * AI_SCATTER_RADIUS || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      // linear falloff: full strength at d→0, zero at the radius
      const w = (1 - d / AI_SCATTER_RADIUS) * AI_SCATTER_STRENGTH;
      sx += (dx / d) * w;
      sz += (dz / d) * w;
    }
    // Clamp so a tight knot can't fling an enemy faster than it can run.
    const sm = Math.hypot(sx, sz);
    const cap = a.def.speed * 0.9;
    if (sm > cap) { sx = sx / sm * cap; sz = sz / sm * cap; }
    a.scatterX = sx;
    a.scatterZ = sz;
  }

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.alive) {
      if      (e.type === 'grunt')   gruntAI(e, dt);
      else if (e.type === 'shooter') shooterAI(e, dt);
      else if (e.type === 'heavy')   heavyAI(e, dt);
      syncEnemy(e);

      // Track no-LOS duration (drives the vantage-seek in navGoal) and
      // detect being wedged on geometry. canSeePlayer set e._saw this frame.
      e.noLosTimer = e._saw ? 0 : e.noLosTimer + dt;
      e.stuckCheckTimer -= dt;
      if (e.stuckCheckTimer <= 0) {
        const moved = Math.hypot(e.position.x - e.stuckX, e.position.z - e.stuckZ);
        const pdx = player.position.x - e.position.x;
        const pdz = player.position.z - e.position.z;
        const farFromPlayer = (pdx * pdx + pdz * pdz) > 3.0 * 3.0;
        // Barely moved over the window while it should have been travelling
        // (not legitimately stopped at melee range) → kick an unstick slide.
        if (moved < AI_UNSTICK_MIN_MOVE && farFromPlayer && e.unstickTimer <= 0) {
          e.unstickTimer = AI_UNSTICK_TIME;
          e.unstickSign = -e.unstickSign;   // alternate so we don't re-jam the same way
        }
        e.stuckX = e.position.x;
        e.stuckZ = e.position.z;
        e.stuckCheckTimer = AI_UNSTICK_CHECK;
      }

      // M11: idle animation. Phase-offset per enemy so a wave doesn't bob
      // in sync. Head bob (small Y sine) + arm sway (small X-rotation
      // counter-phased between left and right). Shooters keep their
      // forward-tilted aim posture; sway is layered on top.
      e.animPhase += dt * 4.5;
      const headBob = Math.sin(e.animPhase) * 0.012;
      const armSway = Math.sin(e.animPhase) * 0.08;
      if (e.head) e.head.position.y = e.headRestY + headBob;
      if (e.armL) e.armL.rotation.x = e.armLRestX + armSway;
      if (e.armR) e.armR.rotation.x = e.armRRestX - armSway;

      // M13: grunt knife-swipe animation overrides arm sway while attacking.
      if (e.type === 'grunt') updateGruntSwipe(e, dt);

      // Hit flash on body mats only — emissive mats keep their permanent glow.
      if (e.hitFlashTimer > 0) {
        e.hitFlashTimer -= dt;
        const flash = Math.max(0, e.hitFlashTimer / HIT_FLASH_TIME);
        for (let j = 0; j < e.bodyMats.length; j++) {
          e.bodyMats[j].emissive.setRGB(flash, flash, flash);
        }
        if (e.hitFlashTimer <= 0) {
          e.hitFlashTimer = 0;
          for (let j = 0; j < e.bodyMats.length; j++) e.bodyMats[j].emissive.setRGB(0, 0, 0);
        }
      }
    } else if (e.deathTimer > 0) {
      e.deathTimer -= dt;
      const t = Math.max(0, e.deathTimer / DEATH_ANIM_TIME);
      e.group.scale.setScalar(t);
      if (e.deathTimer <= 0) {
        scene.remove(e.group);
        for (let j = 0; j < e.bodyMats.length; j++) e.bodyMats[j].dispose();
        for (let j = 0; j < e.emissiveMats.length; j++) e.emissiveMats[j].dispose();
        e.deathTimer = 0;
      }
    }
  }

  // M13: enemy-enemy separation pass.
  // AI movement only collides each enemy against static geometry, not against
  // other enemies (testing every enemy against every other inside moveCircle
  // would be expensive and order-dependent). Instead, after everyone has moved
  // this frame, run one relaxation pass: for each overlapping pair, push both
  // apart by half the penetration along the line between their centers. This
  // is symmetric (no enemy "wins"), stable across frames, and O(n²) which is
  // fine for the ~19-enemy wave cap. Two iterations resolve chains/clumps
  // (A pushed into B pushed into C) without visible jitter.
  separateEnemies();
}

// Push apart any two live enemies whose circles overlap. Uses each enemy's
// def.radius as its body radius (matches the AABB used for player collision).
function separateEnemies() {
  const ITER = 2;
  for (let pass = 0; pass < ITER; pass++) {
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (!b.alive) continue;

        let dx = b.position.x - a.position.x;
        let dz = b.position.z - a.position.z;
        // M15 Stage 2: don't separate enemies on different floors — one on a
        // catwalk shouldn't shove the one directly beneath it.
        if (Math.abs(a.position.y - b.position.y) > 1.5) continue;
        const minDist = a.def.radius + b.def.radius;
        let distSq = dx * dx + dz * dz;

        if (distSq >= minDist * minDist) continue; // not overlapping

        let dist = Math.sqrt(distSq);
        // Exactly coincident (e.g. two enemies spawned on the same point):
        // pick a deterministic-ish arbitrary axis so they don't stay fused.
        if (dist < 1e-4) {
          dx = (i % 2 === 0) ? 1 : -1;
          dz = 0;
          dist = 1;
        }

        const overlap = minDist - dist;
        const nx = dx / dist;
        const nz = dz / dist;
        // Split the correction. Heavier enemies could resist more, but equal
        // split keeps it simple and visually clean; the AI re-closes anyway.
        const push = overlap * 0.5;
        a.position.x -= nx * push;
        a.position.z -= nz * push;
        b.position.x += nx * push;
        b.position.z += nz * push;

        // Re-resolve against solids so a separation push can't shove an
        // enemy into / through a wall (collideCapsule with no prior motion
        // just runs the static resolution at the new position).
        {
          const ra = collideCapsule(a.position.x, a.position.y, a.position.z, a.def.radius, ENEMY_BODY_H);
          a.position.x = ra.x; a.position.z = ra.z;
          const rb = collideCapsule(b.position.x, b.position.y, b.position.z, b.def.radius, ENEMY_BODY_H);
          b.position.x = rb.x; b.position.z = rb.z;
        }

        // Keep group transform + AABB in sync after the shove.
        syncEnemy(a);
        syncEnemy(b);
      }
    }
  }
}

// Recent spawn positions, used to fan a wave out (a new spawn prefers to be
// far from the last few). Trimmed to SPAWN_SPREAD_MEMORY entries.
const _recentSpawns = [];

function spawnBlockedByCover(x, z) {
  for (let j = 0; j < staticAABBs.length; j++) {
    const a = staticAABBs[j];
    if (x > a.minX - SPAWN_COVER_MARGIN && x < a.maxX + SPAWN_COVER_MARGIN &&
        z > a.minZ - SPAWN_COVER_MARGIN && z < a.maxZ + SPAWN_COVER_MARGIN) {
      return true;
    }
  }
  return false;
}

// Squared distance from (x,z) to the nearest of the last few spawns. Larger
// = more isolated = better (we want the wave to fan out, not pile up).
function isolationScore(x, z) {
  let best = Infinity;
  for (let i = 0; i < _recentSpawns.length; i++) {
    const s = _recentSpawns[i];
    const dx = x - s.x, dz = z - s.z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return best === Infinity ? 1e9 : best;
}

// Pick a spawn point on a ring AROUND THE PLAYER.
//   * distance ∈ [SPAWN_MIN_DIST, SPAWN_MAX_DIST] from the player
//   * clamped to stay inside ±ARENA_PLAYABLE_HALF (never outside walls)
//   * not overlapping cover
//   * prefers points outside the player's current view cone
//   * among valid candidates, prefers the one farthest from recent spawns
//     so a wave spreads around you instead of clustering on one side
export function pickSpawnPoint() {
  const pyaw = player.yaw;
  const fx = -Math.sin(pyaw);
  const fz = -Math.cos(pyaw);
  const px = player.position.x;
  const pz = player.position.z;

  let best = null;
  let bestScore = -Infinity;
  let fallback = null;          // best valid point even if in view cone

  for (let i = 0; i < SPAWN_MAX_ATTEMPTS; i++) {
    const theta = Math.random() * Math.PI * 2;
    const dist = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
    let x = px + Math.cos(theta) * dist;
    let z = pz + Math.sin(theta) * dist;

    // Clamp inside the play area. Clamping can pull a point closer to the
    // player than SPAWN_MIN_DIST near a corner — re-check the hard gate after.
    x = Math.max(-ARENA_PLAYABLE_HALF, Math.min(ARENA_PLAYABLE_HALF, x));
    z = Math.max(-ARENA_PLAYABLE_HALF, Math.min(ARENA_PLAYABLE_HALF, z));

    const ddx = x - px;
    const ddz = z - pz;
    const len = Math.sqrt(ddx * ddx + ddz * ddz);
    if (len < SPAWN_MIN_DIST) continue;             // hard minimum distance
    if (spawnBlockedByCover(x, z)) continue;

    const dot = len > 0.001 ? (fx * ddx + fz * ddz) / len : 1;
    const inView = dot > SPAWN_VIEW_CONE_DOT;

    // Score: isolation from recent spawns, with a big penalty for in-view.
    let score = isolationScore(x, z);
    if (inView) {
      if (!fallback || score > fallback.score) fallback = { x, z, score };
      continue;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { x, z };
    }
  }

  let chosen = best || (fallback ? { x: fallback.x, z: fallback.z } : null);

  // Last resort: ring-walk around the player until something clears cover &
  // the min-distance gate (guarantees we always return a sane point).
  if (!chosen) {
    for (let i = 0; i < 36; i++) {
      const theta = (i / 36) * Math.PI * 2;
      let x = px + Math.cos(theta) * SPAWN_MIN_DIST;
      let z = pz + Math.sin(theta) * SPAWN_MIN_DIST;
      x = Math.max(-ARENA_PLAYABLE_HALF, Math.min(ARENA_PLAYABLE_HALF, x));
      z = Math.max(-ARENA_PLAYABLE_HALF, Math.min(ARENA_PLAYABLE_HALF, z));
      const dx = x - px, dz = z - pz;
      if (Math.sqrt(dx * dx + dz * dz) < SPAWN_MIN_DIST * 0.85) continue;
      if (!spawnBlockedByCover(x, z)) { chosen = { x, z }; break; }
    }
  }
  if (!chosen) chosen = { x: ARENA_PLAYABLE_HALF, z: ARENA_PLAYABLE_HALF };

  // Remember it so subsequent spawns this wave fan away from it.
  _recentSpawns.push({ x: chosen.x, z: chosen.z });
  if (_recentSpawns.length > SPAWN_SPREAD_MEMORY) _recentSpawns.shift();

  return chosen;
}

// Wave system calls this at the start of each wave so spacing is per-wave,
// not bleeding across waves.
export function resetSpawnMemory() {
  _recentSpawns.length = 0;
}

export function clearEnemies() {
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    scene.remove(e.group);
    for (let j = 0; j < e.bodyMats.length; j++) e.bodyMats[j].dispose();
    for (let j = 0; j < e.emissiveMats.length; j++) e.emissiveMats[j].dispose();
    for (let j = 0; j < e.meshes.length; j++) {
      const idx = shootables.indexOf(e.meshes[j]);
      if (idx !== -1) shootables.splice(idx, 1);
    }
    // M13: knife meshes are shootable too — remove on full clear.
    if (e.knifeMeshes) {
      for (let j = 0; j < e.knifeMeshes.length; j++) {
        const idx = shootables.indexOf(e.knifeMeshes[j]);
        if (idx !== -1) shootables.splice(idx, 1);
      }
    }
  }
  enemies.length = 0;
}
