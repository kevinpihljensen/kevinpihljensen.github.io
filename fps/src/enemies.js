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
import { DOORWAYS, ENEMY_SPAWN_POINTS } from './maplayout.js';
import { buildCharacterRig, hasCharacter, buildSimpleRifle, buildHeavyWeapon } from './charmodels.js';
import {
  HIT_FLASH_TIME, DEATH_ANIM_TIME,
  MELEE_ATTACK_COOLDOWN, SHOOTER_ATTACK_COOLDOWN,
  SHOOTER_DIST_MIN, SHOOTER_DIST_MAX,
  AI_UNSTICK_CHECK, AI_UNSTICK_MIN_MOVE, AI_UNSTICK_TIME, AI_VANTAGE_LOS_TIME,
  AI_DOORWAY_LATCH_DIST, AI_DOORWAY_CLEAR_DIST, AI_STUCK_ESCALATE,
  AI_BACKOFF_TIME, AI_LAST_SEEN_TIME,
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
  JETPACK_HOVER_HEIGHT_MIN, JETPACK_HOVER_HEIGHT_MAX,
  JETPACK_HORIZ_SPEED, JETPACK_VERT_SPEED, JETPACK_ORBIT_DIST,
  JETPACK_BURST_COUNT, JETPACK_BURST_INTERVAL, JETPACK_BURST_COOLDOWN,
  JETPACK_AIM_WOBBLE, JETPACK_LEAD_STRENGTH, JETPACK_FIRE_RANGE,
  JETPACK_BOB_AMP, JETPACK_BOB_FREQ,
  PROJECTILE_SPEED, AI_LEAD_ITERATIONS,
  AI_LEAD_STRENGTH_SHOOTER, AI_LEAD_STRENGTH_HEAVY,
  AI_SCATTER_RADIUS, AI_SCATTER_STRENGTH,
  GRAVITY,
  ENEMY_JUMP_VY, ENEMY_MAX_JUMP_HEIGHT, ENEMY_JUMP_COOLDOWN, ENEMY_TERMINAL_VY,
} from './constants.js';
import { sfxEnemyDeath, sfxShooterFire } from './audio.js';
import { spawnProjectile } from './projectiles.js';
import { damagePlayer } from './player.js';
import { state, game } from './state.js';
import { GAME_STATE } from './constants.js';
import { onWaveCleared, queueArenaRespawn } from './wave.js';

export const enemies = [];

// Enemy capsule height, used for per-floor wall filtering + AABB Y span.
const ENEMY_BODY_H = 1.7;

// S54: humanoid soldier definitions. Each type has its own fatigue + accent
// color so silhouettes still read at a glance, but the bodies are now built
// from skin/fabric/boot materials instead of emissive sci-fi armor.
//   * `fatigue` — main uniform color (torso/limbs)
//   * `gear`    — tactical vest / pauldron / helmet color
//   * `accent`  — secondary fabric (lower legs, sleeves)
//   * `skin`    — exposed face/hands tone
// S55: speeds bumped across the board (grunt 4.0→4.7, shooter 2.5→3.1,
// heavy 1.5→1.9) so the bigger map doesn't make enemies feel sluggish.
// New jetpack type added — flies, burst-fires a 3-round carbine, worse aim.
export const ENEMY_DEFS = {
  grunt: {
    hp: 30, speed: 4.7, radius: 0.35, score: 100, contactDmg: 10,
    fatigue: 0x6b1212, gear: 0x1a0a0a, accent: 0x3a1212, skin: 0xc99a73,
  },
  shooter: {
    hp: 20, speed: 3.1, radius: 0.35, score: 150, contactDmg: 0,
    fatigue: 0x8a6a32, gear: 0x2a2218, accent: 0x554021, skin: 0xc99a73,
  },
  heavy: {
    hp: 150, speed: 1.9, radius: 0.50, score: 400, contactDmg: 25,
    fatigue: 0x4a1212, gear: 0x141414, accent: 0x2a0e0e, skin: 0xc99a73,
  },
  jetpack: {
    hp: 35, speed: 4.2, radius: 0.42, score: 220, contactDmg: 0,
    fatigue: 0x2c4a6b, gear: 0x14181f, accent: 0x3a5a82, skin: 0xc99a73,
  },
};

// --- MODEL CONSTRUCTION (S54: humanoid soldiers) ---
//
// Each builder returns:
//   * group       — top-level Group, fully populated. Added to the scene
//                   as-is by makeEnemy.
//   * meshes      — flat array of every Mesh inside `group`. makeEnemy
//                   enables shadows, tags userData.enemy, and registers
//                   each in `shootables`. Already parented; makeEnemy
//                   does NOT re-parent.
//   * headMeshes  — subset of `meshes` that should also be tagged with
//                   userData.isHead = true (head-region headshot hit).
//   * head        — the head sub-Group; `.position.y` is bobbed by the
//                   idle animation.
//   * armL/armR   — arm Groups; `.rotation.x` is swayed by idle anim.
//                   Hands, weapon parts may be children — they sway too.
//   * bodyMats    — materials hit-flash applies to (most everything).
//   * emissiveMats — permanent-emissive mats; flash leaves them alone.
//
// Type-specific extras (kept from M12/M13):
//   * knifePivot/knifeMeshes/knifeRestRot — grunt only; the swipe rig
//   * barrelGrp/muzzleMat — heavy only; minigun spin + muzzle glow

// Build an arm Group with a visible upper arm + forearm cylinder and a
// box "hand" at the wrist. The Group sits at the SHOULDER; rotating its
// X axis swings the arm around the shoulder. All meshes are pushed into
// the caller's `meshes` array.
function _buildArm({ side, shoulderY, length, radius, restRotX, sleeveMat, skinMat, meshes }) {
  const sx = side === 'right' ? -1 : 1;
  const g = new THREE.Group();
  g.position.set(0.34 * sx, shoulderY, 0);
  g.rotation.x = restRotX;
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.9, length * 0.85, 10), sleeveMat);
  sleeve.position.y = -length * 0.425;
  g.add(sleeve);
  meshes.push(sleeve);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.11, 0.13), skinMat);
  hand.position.y = -length - 0.02;
  g.add(hand);
  meshes.push(hand);
  return { g, sleeve, hand };
}

// Build a leg/boot pair, both children of `group`. Pushes meshes.
function _buildLeg({ side, hipY, length, radius, trouserMat, bootMat, group, meshes }) {
  const sx = side === 'right' ? -1 : 1;
  const leg = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.92, length, 10), trouserMat);
  leg.position.set(0.13 * sx, hipY - length * 0.5, 0);
  group.add(leg);
  meshes.push(leg);
  const boot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.10, 0.32), bootMat);
  boot.position.set(0.13 * sx, hipY - length - 0.005, -0.04);
  group.add(boot);
  meshes.push(boot);
}

// Build a humanoid head as a Group at headRestY containing skin head capsule
// + two dark eye dots. `headgearFn` (optional) is invoked with the headGroup
// and meshes array so the caller can add type-specific helmet / cap / hood
// meshes — they're added to the same Group so they bob along with the head.
// Pushes the locally-created eye material into `bodyMats` so it gets the
// hit-flash AND gets disposed when the enemy dies.
function _buildHead({ restY, skinMat, headgearFn, meshes, headMeshes, bodyMats }) {
  const headGroup = new THREE.Group();
  headGroup.position.y = restY;
  // Skin head capsule.
  const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.05, 4, 10), skinMat);
  headGroup.add(head);
  meshes.push(head); headMeshes.push(head);
  // Two small dark eye boxes (slight inset so they read through the band).
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x06080a, roughness: 0.5, metalness: 0.0 });
  bodyMats.push(eyeMat);
  for (const sx of [+1, -1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.015, 0.012), eyeMat);
    eye.position.set(0.05 * sx, 0.012, -0.13);
    headGroup.add(eye);
    meshes.push(eye); headMeshes.push(eye);
  }
  if (headgearFn) headgearFn(headGroup, meshes, headMeshes, eyeMat);
  return { headGroup, head, eyeMat };
}

function buildGruntModel(def) {
  // Per-enemy materials (fresh instances → hit-flash isolated to this enemy).
  const fatigue = new THREE.MeshStandardMaterial({ color: def.fatigue, roughness: 0.82, metalness: 0.06 });
  const gear    = new THREE.MeshStandardMaterial({ color: def.gear,    roughness: 0.75, metalness: 0.12 });
  const accent  = new THREE.MeshStandardMaterial({ color: def.accent,  roughness: 0.80, metalness: 0.05 });
  const skin    = new THREE.MeshStandardMaterial({ color: def.skin,    roughness: 0.75, metalness: 0.02 });
  const boot    = new THREE.MeshStandardMaterial({ color: 0x0e0f12,    roughness: 0.55, metalness: 0.18 });
  const hood    = new THREE.MeshStandardMaterial({ color: 0x111114,    roughness: 0.88, metalness: 0.03 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.25, metalness: 0.9 });
  const hiltMat  = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.6,  metalness: 0.3 });

  const group = new THREE.Group();
  const meshes = [];
  const headMeshes = [];

  // --- TORSO ---
  // Slimmer than M11's wide capsule. Read as a person, not a barrel.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 4, 10), fatigue);
  torso.position.y = 1.05;
  group.add(torso); meshes.push(torso);
  // Tactical vest plate sitting on the front of the torso.
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.12), gear);
  vest.position.set(0, 1.10, -0.18);
  group.add(vest); meshes.push(vest);
  // Belt
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 0.36), gear);
  belt.position.y = 0.72;
  group.add(belt); meshes.push(belt);
  // Hip block (slimmer than torso, suggesting waist taper)
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.20, 0.32), fatigue);
  hips.position.y = 0.62;
  group.add(hips); meshes.push(hips);

  // --- LEGS ---
  _buildLeg({ side: 'left',  hipY: 0.52, length: 0.50, radius: 0.11, trouserMat: fatigue, bootMat: boot, group, meshes });
  _buildLeg({ side: 'right', hipY: 0.52, length: 0.50, radius: 0.11, trouserMat: fatigue, bootMat: boot, group, meshes });

  // --- HEAD (balaclava-style hood + eye band) ---
  const bodyMats = [fatigue, gear, accent, skin, boot, hood, bladeMat, hiltMat];
  const { headGroup } = _buildHead({
    restY: 1.50, skinMat: skin, meshes, headMeshes, bodyMats,
    headgearFn: (hg, ms, hms) => {
      // Hood dome — sphere capped at theta to cover top of head only.
      const top = new THREE.Mesh(
        new THREE.SphereGeometry(0.155, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hood);
      top.position.y = 0.02;
      hg.add(top); ms.push(top); hms.push(top);
      // Mask covering the lower face (below the eye band).
      const mask = new THREE.Mesh(
        new THREE.SphereGeometry(0.145, 14, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.5), hood);
      mask.position.y = -0.01;
      hg.add(mask); ms.push(mask); hms.push(mask);
    },
  });
  group.add(headGroup);
  // Neck — thin skin cylinder bridging head and torso.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.08, 8), skin);
  neck.position.y = 1.36;
  group.add(neck); meshes.push(neck);

  // --- ARMS (groups; armR holds the knife) ---
  const armLrest = +0.05;
  const armRrest = -0.55;   // forward — holding knife at the ready
  const armL = _buildArm({ side: 'left',  shoulderY: 1.32, length: 0.50, radius: 0.075, restRotX: armLrest, sleeveMat: fatigue, skinMat: skin, meshes });
  const armR = _buildArm({ side: 'right', shoulderY: 1.32, length: 0.50, radius: 0.075, restRotX: armRrest, sleeveMat: fatigue, skinMat: skin, meshes });
  group.add(armL.g, armR.g);

  // --- KNIFE (child of the right arm group, positioned at the hand) ---
  // Local position relative to armR group: y at the hand (-length - hand_half),
  // z forward of the hand so the blade sticks out from the fist.
  const knifePivot = new THREE.Group();
  knifePivot.position.set(0, -0.55, -0.06);
  armR.g.add(knifePivot);
  // Knife geometry (small, no fancy detail — the player will mostly see this
  // from a distance during the swipe).
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.014, 0.26), bladeMat);
  blade.position.set(0, 0, -0.16);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.020, 0.07, 4), bladeMat);
  tip.scale.y = 0.45;
  tip.rotation.x = -Math.PI / 2;
  tip.rotation.z = Math.PI / 4;
  tip.position.set(0, 0, -0.31);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.020), hiltMat);
  guard.position.set(0, 0, -0.025);
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.10, 8), hiltMat);
  hilt.rotation.x = Math.PI / 2;
  hilt.position.set(0, 0, 0.04);
  knifePivot.add(blade, tip, guard, hilt);
  // Rest pose: blade aimed forward of the grunt, slight outward yaw.
  knifePivot.rotation.set(0, 0.20, 0);

  return {
    group,
    meshes,
    headMeshes,
    head: headGroup,
    armL: armL.g,
    armR: armR.g,
    bodyMats,
    emissiveMats: [],
    knifePivot,
    knifeMeshes: [blade, tip, guard, hilt],
    knifeRestRot: { x: 0, y: 0.20, z: 0 },
  };
}

function buildShooterModel(def) {
  const fatigue = new THREE.MeshStandardMaterial({ color: def.fatigue, roughness: 0.82, metalness: 0.06 });
  const gear    = new THREE.MeshStandardMaterial({ color: def.gear,    roughness: 0.75, metalness: 0.12 });
  const accent  = new THREE.MeshStandardMaterial({ color: def.accent,  roughness: 0.80, metalness: 0.05 });
  const skin    = new THREE.MeshStandardMaterial({ color: def.skin,    roughness: 0.75, metalness: 0.02 });
  const boot    = new THREE.MeshStandardMaterial({ color: 0x14130f,    roughness: 0.55, metalness: 0.18 });
  const cap     = new THREE.MeshStandardMaterial({ color: 0x2b2418,    roughness: 0.80, metalness: 0.05 });
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.40, metalness: 0.70 });
  const gunPoly  = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.85, metalness: 0.05 });

  const group = new THREE.Group();
  const meshes = [];
  const headMeshes = [];

  // --- TORSO + GEAR ---
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 4, 10), fatigue);
  torso.position.y = 1.05;
  group.add(torso); meshes.push(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.40, 0.12), gear);
  vest.position.set(0, 1.10, -0.18);
  group.add(vest); meshes.push(vest);
  // Belt + ammo pouches (two small boxes on the front of the belt).
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 0.36), gear);
  belt.position.y = 0.72;
  group.add(belt); meshes.push(belt);
  for (const sx of [+1, -1]) {
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.07), accent);
    pouch.position.set(0.13 * sx, 0.74, -0.20);
    group.add(pouch); meshes.push(pouch);
  }
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.20, 0.32), fatigue);
  hips.position.y = 0.62;
  group.add(hips); meshes.push(hips);

  // --- LEGS ---
  _buildLeg({ side: 'left',  hipY: 0.52, length: 0.50, radius: 0.11, trouserMat: fatigue, bootMat: boot, group, meshes });
  _buildLeg({ side: 'right', hipY: 0.52, length: 0.50, radius: 0.11, trouserMat: fatigue, bootMat: boot, group, meshes });

  // --- HEAD (tactical cap + dark sunglasses band) ---
  const bodyMats = [fatigue, gear, accent, skin, boot, cap, gunMetal, gunPoly];
  const { headGroup } = _buildHead({
    restY: 1.50, skinMat: skin, meshes, headMeshes, bodyMats,
    headgearFn: (hg, ms, hms) => {
      // Cap crown — short cylinder
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.130, 0.06, 14), cap);
      crown.position.y = 0.10;
      hg.add(crown); ms.push(crown); hms.push(crown);
      // Brim — flat box poking forward
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.018, 0.10), cap);
      brim.position.set(0, 0.085, -0.13);
      hg.add(brim); ms.push(brim); hms.push(brim);
      // Sunglasses band — covers eye area
      const shades = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.038, 0.018), gunPoly);
      shades.position.set(0, 0.012, -0.135);
      hg.add(shades); ms.push(shades); hms.push(shades);
    },
  });
  group.add(headGroup);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.08, 8), skin);
  neck.position.y = 1.36;
  group.add(neck); meshes.push(neck);

  // --- ARMS (both forward, posed at the rifle) ---
  // Right hand at trigger grip (~z=-0.36, slightly right of center).
  // Left hand at foregrip (~z=-0.56, slightly left of center).
  const armLrest = -0.95;   // strong forward tilt
  const armRrest = -0.95;
  const armL = _buildArm({ side: 'left',  shoulderY: 1.30, length: 0.46, radius: 0.075, restRotX: armLrest, sleeveMat: fatigue, skinMat: skin, meshes });
  const armR = _buildArm({ side: 'right', shoulderY: 1.30, length: 0.46, radius: 0.075, restRotX: armRrest, sleeveMat: fatigue, skinMat: skin, meshes });
  // Bring the shoulders inward a touch so the elbows angle in toward the rifle.
  armL.g.position.x = +0.22;
  armR.g.position.x = -0.22;
  group.add(armL.g, armR.g);

  // --- RIFLE (parented to the model group, hands wrap around it) ---
  // Receiver, stock, magazine, barrel, sight rail — separate meshes so the
  // gun reads as a real weapon rather than one box.
  const rifleStock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.18), gunPoly);
  rifleStock.position.set(0, 1.05, -0.18);
  group.add(rifleStock); meshes.push(rifleStock);
  const rifleBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.30), gunMetal);
  rifleBody.position.set(0, 1.05, -0.42);
  group.add(rifleBody); meshes.push(rifleBody);
  const rifleMag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.05), gunPoly);
  rifleMag.position.set(0, 0.98, -0.40);
  group.add(rifleMag); meshes.push(rifleMag);
  const rifleRail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.18), gunMetal);
  rifleRail.position.set(0, 1.10, -0.42);
  group.add(rifleRail); meshes.push(rifleRail);
  const rifleBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.020, 0.32, 8), gunMetal);
  rifleBarrel.rotation.x = Math.PI / 2;
  rifleBarrel.position.set(0, 1.06, -0.72);
  group.add(rifleBarrel); meshes.push(rifleBarrel);

  return {
    group,
    meshes,
    headMeshes,
    head: headGroup,
    armL: armL.g,
    armR: armR.g,
    bodyMats,
    emissiveMats: [],
  };
}

function buildHeavyModel(def) {
  const fatigue = new THREE.MeshStandardMaterial({ color: def.fatigue, roughness: 0.82, metalness: 0.06 });
  const gear    = new THREE.MeshStandardMaterial({ color: def.gear,    roughness: 0.65, metalness: 0.25 });
  const accent  = new THREE.MeshStandardMaterial({ color: def.accent,  roughness: 0.70, metalness: 0.12 });
  const skin    = new THREE.MeshStandardMaterial({ color: def.skin,    roughness: 0.75, metalness: 0.02 });
  const boot    = new THREE.MeshStandardMaterial({ color: 0x0e0f12,    roughness: 0.55, metalness: 0.18 });
  const plate   = new THREE.MeshStandardMaterial({ color: 0x1a0e0e,    roughness: 0.55, metalness: 0.40 });
  const helmet  = new THREE.MeshStandardMaterial({ color: 0x141416,    roughness: 0.65, metalness: 0.25 });
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.35, metalness: 0.85 });
  const gunAccent = new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.5, metalness: 0.7 });
  const muzzleMat = new THREE.MeshStandardMaterial({
    color: 0xffae3a, emissive: 0xffae3a, emissiveIntensity: 0.0,
    roughness: 0.4, metalness: 0.2, toneMapped: false,
  });

  const group = new THREE.Group();
  const meshes = [];
  const headMeshes = [];

  // --- TORSO (wider, heavier; plate carrier on top) ---
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 4, 12), fatigue);
  torso.position.y = 1.15;
  group.add(torso); meshes.push(torso);
  // Plate carrier covering front + sides of the torso.
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.62, 0.18), plate);
  chest.position.set(0, 1.20, -0.18);
  group.add(chest); meshes.push(chest);
  // Shoulder pauldrons (kept from M11 — looks gnarly, fits the heavy).
  for (const sx of [+1, -1]) {
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.20, 12, 10), gear);
    pauldron.position.set(0.46 * sx, 1.50, 0);
    pauldron.scale.set(1, 0.7, 1);
    group.add(pauldron); meshes.push(pauldron);
  }
  // Belt (broader than grunt/shooter to read heavy)
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.12, 0.50), gear);
  belt.position.y = 0.78;
  group.add(belt); meshes.push(belt);
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.22, 0.40), fatigue);
  hips.position.y = 0.65;
  group.add(hips); meshes.push(hips);

  // --- LEGS (thicker) ---
  _buildLeg({ side: 'left',  hipY: 0.54, length: 0.52, radius: 0.16, trouserMat: fatigue, bootMat: boot, group, meshes });
  _buildLeg({ side: 'right', hipY: 0.54, length: 0.52, radius: 0.16, trouserMat: fatigue, bootMat: boot, group, meshes });

  // --- HEAD (combat helmet dome + visor goggles) ---
  const bodyMats = [fatigue, gear, accent, skin, boot, plate, helmet, gunMetal, gunAccent];
  const { headGroup } = _buildHead({
    restY: 1.72, skinMat: skin, meshes, headMeshes, bodyMats,
    headgearFn: (hg, ms, hms) => {
      // Combat helmet — half-sphere a bit bigger than the head
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.175, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), helmet);
      dome.position.y = 0.02;
      hg.add(dome); ms.push(dome); hms.push(dome);
      // Front rim of helmet
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 6, 16, Math.PI), helmet);
      rim.rotation.x = -Math.PI / 2;
      rim.position.set(0, 0.04, 0);
      hg.add(rim); ms.push(rim); hms.push(rim);
      // Dark goggles band
      const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.020), gunMetal);
      goggles.position.set(0, 0.015, -0.16);
      hg.add(goggles); ms.push(goggles); hms.push(goggles);
    },
  });
  group.add(headGroup);
  // Thick neck (helmet pushed the head up — slightly taller neck reads as "armored").
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.10, 0.10, 8), skin);
  neck.position.y = 1.55;
  group.add(neck); meshes.push(neck);

  // --- ARMS (groups; both forward to grip the minigun handles) ---
  const armLrest = -0.85;
  const armRrest = -0.85;
  const armL = _buildArm({ side: 'left',  shoulderY: 1.42, length: 0.62, radius: 0.13, restRotX: armLrest, sleeveMat: fatigue, skinMat: skin, meshes });
  const armR = _buildArm({ side: 'right', shoulderY: 1.42, length: 0.62, radius: 0.13, restRotX: armRrest, sleeveMat: fatigue, skinMat: skin, meshes });
  armL.g.position.x = +0.40;
  armR.g.position.x = -0.40;
  group.add(armL.g, armR.g);

  // --- MINIGUN ---
  // Geometry positions kept compatible with the heavyFire muzzle offset (0.20,
  // 1.16, -0.92) — moving them shifts the muzzle math in enemies.js#heavyFire.
  const gunMount = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.42), gunMetal);
  gunMount.position.set(0.20, 1.15, -0.40);
  group.add(gunMount); meshes.push(gunMount);
  // Two large grip handles on the receiver (one for each hand, visually).
  const gripL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), gunAccent);
  gripL.position.set(0.36, 1.06, -0.32);
  group.add(gripL); meshes.push(gripL);
  const gripR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), gunAccent);
  gripR.position.set(0.04, 1.06, -0.32);
  group.add(gripR); meshes.push(gripR);
  // Ammo drum.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.22, 14), gunAccent);
  drum.rotation.z = Math.PI / 2;
  drum.position.set(0.46, 1.05, -0.30);
  group.add(drum); meshes.push(drum);
  // Rotating barrel assembly (kept as a Group so AI can spin it on Z).
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
  group.add(barrelGrp);
  // Muzzle disc (emissive, brightens while firing).
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 14), muzzleMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0.20, 1.16, -0.92);
  group.add(muzzle); meshes.push(muzzle);

  return {
    group,
    meshes,
    headMeshes,
    head: headGroup,
    armL: armL.g,
    armR: armR.g,
    bodyMats,
    emissiveMats: [muzzleMat],
    barrelGrp,
    muzzleMat,
  };
}

function buildJetpackModel(def) {
  // S55: flying enemy. Humanoid in a flight suit with a jetpack pack on the
  // back + two thruster cones below it. The thrusters glow when flying (set
  // by jetpackAI). Carbine in both hands (similar to the shooter's posture).
  const fatigue  = new THREE.MeshStandardMaterial({ color: def.fatigue, roughness: 0.75, metalness: 0.10 });
  const gear     = new THREE.MeshStandardMaterial({ color: def.gear,    roughness: 0.55, metalness: 0.25 });
  const accent   = new THREE.MeshStandardMaterial({ color: def.accent,  roughness: 0.70, metalness: 0.15 });
  const skin     = new THREE.MeshStandardMaterial({ color: def.skin,    roughness: 0.75, metalness: 0.02 });
  const boot     = new THREE.MeshStandardMaterial({ color: 0x14181f,    roughness: 0.55, metalness: 0.20 });
  const helmet   = new THREE.MeshStandardMaterial({ color: 0x141618,    roughness: 0.55, metalness: 0.30 });
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.40, metalness: 0.70 });
  const gunPoly  = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.85, metalness: 0.05 });
  // Emissive thruster glow — bright blue/white core that's brightened while
  // the jetpack is engaged. toneMapped: false so it pops through ACES.
  const thrustMat = new THREE.MeshStandardMaterial({
    color: 0x6cc6ff, emissive: 0x6cc6ff, emissiveIntensity: 0.8,
    roughness: 0.4, metalness: 0.2, toneMapped: false,
  });

  const group = new THREE.Group();
  const meshes = [];
  const headMeshes = [];

  // --- TORSO ---
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 4, 10), fatigue);
  torso.position.y = 1.05;
  group.add(torso); meshes.push(torso);
  // Flight harness — chest straps as a thin vest plate.
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.10), gear);
  vest.position.set(0, 1.05, -0.18);
  group.add(vest); meshes.push(vest);
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.18, 0.30), fatigue);
  hips.position.y = 0.66;
  group.add(hips); meshes.push(hips);

  // --- LEGS (tucked; no boots planted on the ground — they dangle) ---
  _buildLeg({ side: 'left',  hipY: 0.58, length: 0.50, radius: 0.10, trouserMat: fatigue, bootMat: boot, group, meshes });
  _buildLeg({ side: 'right', hipY: 0.58, length: 0.50, radius: 0.10, trouserMat: fatigue, bootMat: boot, group, meshes });

  // --- HEAD (full flight helmet — dome + dark visor) ---
  const bodyMats = [fatigue, gear, accent, skin, boot, helmet, gunMetal, gunPoly];
  const { headGroup } = _buildHead({
    restY: 1.50, skinMat: skin, meshes, headMeshes, bodyMats,
    headgearFn: (hg, ms, hms) => {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), helmet);
      dome.position.y = 0.02;
      hg.add(dome); ms.push(dome); hms.push(dome);
      // Dark wraparound visor covering the whole face.
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.020), gunMetal);
      visor.position.set(0, 0.000, -0.14);
      hg.add(visor); ms.push(visor); hms.push(visor);
    },
  });
  group.add(headGroup);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.08, 8), skin);
  neck.position.y = 1.36;
  group.add(neck); meshes.push(neck);

  // --- ARMS (forward; both hands at the carbine grips) ---
  const armL = _buildArm({ side: 'left',  shoulderY: 1.30, length: 0.46, radius: 0.075, restRotX: -0.95, sleeveMat: fatigue, skinMat: skin, meshes });
  const armR = _buildArm({ side: 'right', shoulderY: 1.30, length: 0.46, radius: 0.075, restRotX: -0.95, sleeveMat: fatigue, skinMat: skin, meshes });
  armL.g.position.x = +0.22;
  armR.g.position.x = -0.22;
  group.add(armL.g, armR.g);

  // --- CARBINE (short rifle — burst-fire weapon) ---
  const cbStock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.14), gunPoly);
  cbStock.position.set(0, 1.05, -0.16);
  group.add(cbStock); meshes.push(cbStock);
  const cbBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.25), gunMetal);
  cbBody.position.set(0, 1.05, -0.36);
  group.add(cbBody); meshes.push(cbBody);
  const cbMag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.05), gunPoly);
  cbMag.position.set(0, 0.99, -0.34);
  group.add(cbMag); meshes.push(cbMag);
  const cbBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8), gunMetal);
  cbBarrel.rotation.x = Math.PI / 2;
  cbBarrel.position.set(0, 1.05, -0.58);
  group.add(cbBarrel); meshes.push(cbBarrel);

  // --- JETPACK (back-mounted) ---
  // Main pack block on the back.
  const packMain = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.50, 0.18), gear);
  packMain.position.set(0, 1.05, 0.20);
  group.add(packMain); meshes.push(packMain);
  // Side fuel cylinders.
  for (const sx of [+1, -1]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.46, 12), accent);
    tank.position.set(0.18 * sx, 1.05, 0.20);
    group.add(tank); meshes.push(tank);
  }
  // Two thruster cones below the pack — apex pointing DOWN, emissive flame.
  const thrustGroup = new THREE.Group();
  for (const sx of [+1, -1]) {
    const thrustCone = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 12), thrustMat);
    thrustCone.rotation.x = Math.PI;            // apex points -Y (downward)
    thrustCone.position.set(0.12 * sx, 0.72, 0.20);
    thrustGroup.add(thrustCone);
    meshes.push(thrustCone);
  }
  group.add(thrustGroup);

  return {
    group,
    meshes,
    headMeshes,
    head: headGroup,
    armL: armL.g,
    armR: armR.g,
    bodyMats,
    emissiveMats: [thrustMat],
    // S55: jetpack-specific refs — thrustMat lets the AI brighten the flame
    // glow while actively flying / firing.
    thrustMat,
  };
}

const MODEL_BUILDERS = {
  grunt: buildGruntModel,
  shooter: buildShooterModel,
  heavy: buildHeavyModel,
  jetpack: buildJetpackModel,
};

// S55p: per-enemy-class character mapping into the loaded player models.
// When the GLB has loaded and the named character template is ready,
// makeEnemy() builds a CS-style rig instead of the procedural model. If
// the GLB hasn't loaded yet (race at game start, or load failure), the
// per-class procedural builder above is the fallback.
const CHAR_FOR_TYPE = {
  grunt:   'terror',
  shooter: 'sas',
  heavy:   'urban',
  jetpack: 'leet',
};
const WEAPON_FOR_TYPE = {
  grunt:   buildSimpleRifle,
  shooter: buildSimpleRifle,
  heavy:   buildHeavyWeapon,
  jetpack: buildSimpleRifle,
};

export function makeEnemy(type, x, z) {
  const def = ENEMY_DEFS[type];
  // S55p: prefer the CS-style player rig (loaded async from players.glb).
  // Falls back to the procedural model if the GLB isn't loaded yet or the
  // character template failed to build.
  let built = null;
  const csChar = CHAR_FOR_TYPE[type];
  if (csChar && hasCharacter(csChar)) {
    built = buildCharacterRig(csChar, WEAPON_FOR_TYPE[type] || null);
  }
  if (!built) built = MODEL_BUILDERS[type](def);

  built.group.position.set(x, 0, z);

  // S54: the builder has already parented every mesh into the correct sub-
  // group (head Group, armL/armR Groups, or directly on `group`). We do NOT
  // re-parent here — that would yank arm meshes out of their swing groups
  // and the idle sway / weapon-follow-arm coupling would break.
  for (let i = 0; i < built.meshes.length; i++) {
    const m = built.meshes[i];
    m.castShadow = true;
    m.receiveShadow = true;
  }
  // Heavy minigun's rotating barrel group is cosmetic — shadows off (lots of
  // thin cylinders → shadow acne + cost), already parented inside the builder.
  if (built.barrelGrp) {
    built.barrelGrp.traverse((o) => {
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
    });
  }
  // Grunt knife meshes are shootable + shadow-casting; the pivot is already
  // parented to the right-arm group inside the builder.
  if (built.knifePivot) {
    for (let i = 0; i < built.knifeMeshes.length; i++) {
      built.knifeMeshes[i].castShadow = true;
      built.knifeMeshes[i].receiveShadow = true;
    }
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
    // S55r: CS-rig legs (procedural builders leave these undefined).
    // Animated by legSwing in the update tick when present.
    legL: built.legL || null,
    legR: built.legR || null,
    headRestY: built.head ? built.head.position.y : 0,
    animPhase: Math.random() * Math.PI * 2,
    // S55t: separate leg-cycle phase that advances much faster than the
    // general animPhase so the walk reads as a brisk CS-style step rate
    // rather than the slow torso-bob rate.
    legPhase: Math.random() * Math.PI * 2,
    // M12: minigun refs (heavy only; undefined for others — guarded at use)
    barrelGrp: built.barrelGrp || null,
    muzzleMat: built.muzzleMat || null,
    // S55: jetpack thrust glow ref (jetpack type only; null otherwise)
    thrustMat: built.thrustMat || null,
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

    // --- S55 SMARTER MOVEMENT ---
    // Last position we had LOS to the player at; the AI heads here after the
    // sightline drops instead of immediately giving up. Cleared by aging out.
    lastSeenX: x, lastSeenY: 0, lastSeenZ: z, lastSeenTimer: 0,
    // Doorway latch — index into DOORWAYS or -1. Set when blocked from the
    // player by a wall and a doorway lies between us and them; cleared once
    // we get close to the doorway midpoint.
    doorwayIdx: -1,
    // Consecutive unstick count; resets when the enemy starts moving freely
    // again. Used to escalate to a deeper backoff after AI_STUCK_ESCALATE
    // back-to-back unsticks.
    stuckCount: 0,
    backoffTimer: 0,           // deep-stuck reverse-and-arc countdown
    // --- S55 JETPACK STATE (jetpack type only) ---
    // burst sub-state: 'idle' | 'firing'
    flyState: 'idle',
    burstLeft: 0,              // rounds still to fire in the current burst
    burstTickTimer: 0,         // seconds until the next round of the burst
    burstCooldown: 0,              // seconds until the next burst can start
    hoverTargetY: 0,               // current chosen hover altitude (relative to player floor)

    // --- S55g JUMP STATE ---
    // Grunts + shooters can jump short obstacles and fall off elevated decks.
    // velocityY drives gravity-integrated vertical motion in stepMove.
    canJump: (type === 'grunt' || type === 'shooter'),
    velocityY: 0,
    jumpCooldown: 0,
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
  // S54: tag the SET of head-region meshes (head capsule + headgear + eye
  // dots) with isHead so headshots register whether the player aims at the
  // helmet, the eye band, or the chin.
  for (let i = 0; i < built.meshes.length; i++) {
    built.meshes[i].userData.enemy = enemy;
    shootables.push(built.meshes[i]);
  }
  // S55q: guard against builders that don't expose headMeshes — the CS-rig
  // path returns []; older callers might omit the field entirely.
  if (built.headMeshes) {
    for (let i = 0; i < built.headMeshes.length; i++) {
      built.headMeshes[i].userData.isHead = true;
    }
  }

  // S55: jetpacks spawn IN THE AIR with a random hover altitude. Pick from
  // the configured band so the squadron isn't all at the exact same height.
  if (type === 'jetpack') {
    const hY = JETPACK_HOVER_HEIGHT_MIN +
               Math.random() * (JETPACK_HOVER_HEIGHT_MAX - JETPACK_HOVER_HEIGHT_MIN);
    enemy.hoverTargetY = hY;
    enemy.position.y = hY;
  }

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
    if (game.gameMode === 'arena') {
      // Arena: count kill, queue a replacement to maintain population.
      game.arenaKills += 1;
      queueArenaRespawn(enemy.type || 'grunt');
    } else if (state.gameState === GAME_STATE.PLAYING && game.enemiesAlive <= 0 && game.gameMode !== 'maptest') {
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

  // S55g: ledge-hop. If this enemy can jump, is on (or near) the ground, and
  // a walkable surface ahead sits within ENEMY_MAX_JUMP_HEIGHT but above the
  // step-up limit, give a vertical impulse so we land on it.
  if (enemy.canJump && enemy.velocityY <= 0.01 && enemy.jumpCooldown <= 0) {
    const sp = Math.hypot(vx, vz);
    if (sp > 0.3) {
      const lookDist = enemy.def.radius + 0.4;
      const lookX = enemy.position.x + (vx / sp) * lookDist;
      const lookZ = enemy.position.z + (vz / sp) * lookDist;
      const aheadY = groundHeightAt(
        lookX, lookZ, enemy.position.y + ENEMY_MAX_JUMP_HEIGHT, enemy.def.radius
      );
      if (aheadY !== null) {
        const rise = aheadY - enemy.position.y;
        if (rise > 0.6 && rise < ENEMY_MAX_JUMP_HEIGHT) {
          enemy.velocityY = ENEMY_JUMP_VY;
          enemy.jumpCooldown = ENEMY_JUMP_COOLDOWN;
        }
      }
    }
  }
  if (enemy.jumpCooldown > 0) enemy.jumpCooldown -= dt;

  // Vertical: gravity-integrated. velocityY < 0 = falling, > 0 = rising. The
  // ground probe extends up to STEP above current position so small step-ups
  // (ramp gradients, low ledges within step-up) snap cleanly.
  const STEP = 0.6;
  enemy.velocityY -= GRAVITY * dt;
  if (enemy.velocityY < ENEMY_TERMINAL_VY) enemy.velocityY = ENEMY_TERMINAL_VY;
  const proposedY = enemy.position.y + enemy.velocityY * dt;
  const probeMaxY = Math.max(enemy.position.y, proposedY) + STEP;
  const gY = groundHeightAt(
    enemy.position.x, enemy.position.z, probeMaxY, enemy.def.radius
  );
  const groundY = gY === null ? 0 : gY;
  if (proposedY <= groundY) {
    // Landed (or never left ground / sub-frame ramp step-up).
    enemy.position.y = groundY;
    enemy.velocityY = 0;
  } else {
    enemy.position.y = proposedY;
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

  // S55g: drop-off. When the player is visibly BELOW us, skip the down-ramp
  // detour — go direct. stepMove's gravity-integrated fall handles the drop
  // when the enemy walks off the deck edge. Gated to grunt/shooter (heavies
  // are reluctant; jetpacks fly). Disabled when seeking vantage (we just
  // climbed for sight — don't immediately drop back down).
  if (dy < -FLOOR_EPS && enemy._saw && !enemy.navVantage &&
      (enemy.type === 'grunt' || enemy.type === 'shooter')) {
    enemy.navRamp = -1;
    return null;
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

// --- S55 SMART ROUTING ---
// Doorway waypoint pathing: when a wall is between us and the player, route
// to the nearest DOORWAY midpoint that lies in the direction of the player,
// then re-engage. This is the major fix for "AI paws at walls forever".
//
// findRoutingDoorway picks the doorway with the best (dist-to-doorway +
// dist-from-doorway-to-target) score, gated by a max distance and by the
// requirement that the doorway is in front of us (dot > 0.3).
function findRoutingDoorway(enemy, tx, tz) {
  const ex = enemy.position.x, ez = enemy.position.z;
  const dx = tx - ex, dz = tz - ez;
  const totalDist = Math.hypot(dx, dz);
  if (totalDist < 1.0) return -1;
  const ux = dx / totalDist, uz = dz / totalDist;
  let bestIdx = -1, bestScore = Infinity;
  for (let i = 0; i < DOORWAYS.length; i++) {
    const d = DOORWAYS[i];
    const ddx = d.x - ex, ddz = d.z - ez;
    const dToDoor = Math.hypot(ddx, ddz);
    if (dToDoor > AI_DOORWAY_LATCH_DIST) continue;
    if (dToDoor < 0.001) continue;
    const dot = (ddx * ux + ddz * uz) / dToDoor;
    if (dot < 0.3) continue;                  // doorway must be roughly toward the target
    const remaining = Math.hypot(d.x - tx, d.z - tz);
    const score = dToDoor + remaining;
    if (score < bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

// Maintain the doorway latch — drop it on arrival, acquire one when blocked.
function updateDoorwayLatch(enemy, sees, distToPlayer) {
  if (sees) {
    enemy.doorwayIdx = -1;
    return;
  }
  if (enemy.doorwayIdx >= 0) {
    const d = DOORWAYS[enemy.doorwayIdx];
    const dd = Math.hypot(d.x - enemy.position.x, d.z - enemy.position.z);
    if (dd < AI_DOORWAY_CLEAR_DIST) enemy.doorwayIdx = -1;
    return;
  }
  if (distToPlayer < 6.0) return;             // too close for waypoint routing
  enemy.doorwayIdx = findRoutingDoorway(enemy, player.position.x, player.position.z);
}

// Maintain the last-seen-player tracker; ages out after AI_LAST_SEEN_TIME.
function updateLastSeen(enemy, sees, dt) {
  if (sees) {
    enemy.lastSeenX = player.position.x;
    enemy.lastSeenY = player.position.y;
    enemy.lastSeenZ = player.position.z;
    enemy.lastSeenTimer = AI_LAST_SEEN_TIME;
  } else if (enemy.lastSeenTimer > 0) {
    enemy.lastSeenTimer -= dt;
    if (enemy.lastSeenTimer < 0) enemy.lastSeenTimer = 0;
  }
}

// Unit vector from enemy toward its current goal (player, or a ramp entry if
// cross-floor, or a doorway waypoint, or the last-seen position). Writes
// into _vec, returns horizontal distance to the PLAYER (AI range checks
// still use true player distance, not goal distance).
//
// Priority (highest first):
//   1. ramp navGoal (cross-floor chase or vantage seek)
//   2. doorway latch (blocked-by-wall → route through the doorway)
//   3. last-seen position (LOS lost recently → push to where they were)
//   4. player.position
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
  } else if (enemy.doorwayIdx >= 0) {
    const d = DOORWAYS[enemy.doorwayIdx];
    tx = d.x - enemy.position.x;
    tz = d.z - enemy.position.z;
  } else if (enemy.lastSeenTimer > 0 && !enemy._saw) {
    // LOS recently lost: head to where the player was last seen.
    tx = enemy.lastSeenX - enemy.position.x;
    tz = enemy.lastSeenZ - enemy.position.z;
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
  updateLastSeen(enemy, sees, dt);
  updateDoorwayLatch(enemy, sees, dist);
  const spd = enemy.def.speed;

  // S55: deep backoff. After several back-to-back unsticks, reverse course
  // for AI_BACKOFF_TIME and arc wide before re-engaging — gets unjammed from
  // corners/doorways/cover-knots that the short unstick can't escape.
  if (enemy.backoffTimer > 0) {
    enemy.backoffTimer -= dt;
    const s = enemy.unstickSign;
    stepMove(enemy, (-_vec.x * 0.7 + (-_vec.z) * s * 0.6) * spd,
                     (-_vec.z * 0.7 + ( _vec.x) * s * 0.6) * spd, dt);
    return;
  }

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
  updateLastSeen(enemy, sees, dt);
  updateDoorwayLatch(enemy, sees, dist);
  const spd = enemy.def.speed;

  tick(enemy, 'aiTimer', dt);
  maybeFlipStrafe(enemy, dt);

  if (enemy.backoffTimer > 0) {
    enemy.backoffTimer -= dt;
    const s = enemy.unstickSign;
    stepMove(enemy, (-_vec.x * 0.7 + (-_vec.z) * s * 0.6) * spd,
                     (-_vec.z * 0.7 + ( _vec.x) * s * 0.6) * spd, dt);
    enemy.hadLOS = false;
    return;
  }

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
  sfxShooterFire(ox, oy, oz);   // S55: positional fire at the muzzle
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
  updateLastSeen(enemy, sees, dt);
  updateDoorwayLatch(enemy, sees, dist);
  const spd = enemy.def.speed;

  const inRange = dist <= HEAVY_FIRE_RANGE;
  const engaging = sees && inRange;

  if (enemy.backoffTimer > 0) {
    enemy.backoffTimer -= dt;
    const s = enemy.unstickSign;
    stepMove(enemy, (-_vec.x * 0.7 + (-_vec.z) * s * 0.6) * spd,
                     (-_vec.z * 0.7 + ( _vec.x) * s * 0.6) * spd, dt);
    updateHeavyGun(enemy, dt, false);
    return;
  }

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
  sfxShooterFire(ox, oy, oz);   // S55: positional fire at the heavy muzzle
}

// --- JETPACK ------------------------------------------------------------
// S55: flying enemy. Hovers above the player's floor at a random altitude
// in [JETPACK_HOVER_HEIGHT_MIN, MAX], orbits at JETPACK_ORBIT_DIST, and
// fires 3-round bursts with worse aim than the ground shooter. Has its OWN
// vertical movement (no ground snap) and collides with walls horizontally.
//
// Flight state machine for the burst:
//   idle    → cooldown ticking, eyeing the player; transitions to 'firing'
//             once burstCooldown ≤ 0 and we have LOS + in range
//   firing  → fires one round per BURST_INTERVAL; after BURST_COUNT rounds
//             returns to idle with burstCooldown = BURST_COOLDOWN
function jetpackAI(enemy, dt) {
  const dist = toPlayer(enemy);
  faceAndCool(enemy, dt);
  const sees = canSeePlayer(enemy);
  updateLastSeen(enemy, sees, dt);
  // No doorway routing for jetpacks — they fly OVER walls.
  enemy.doorwayIdx = -1;
  // No cross-floor ramp pathing either — clear it so toPlayer goes straight
  // to player.position (the navGoal in toPlayer already returned null for
  // same-floor — jetpacks effectively never engage navGoal because they fly
  // to whatever altitude they want).
  enemy.navActive = false;
  maybeFlipStrafe(enemy, dt);

  // --- HORIZONTAL MOVEMENT (orbit + strafe) ---
  // approach: -1 = back away (we're too close), +1 = close in (too far), 0 = hold range.
  const orbitErr = dist - JETPACK_ORBIT_DIST;
  let approach = 0;
  if (orbitErr > 3) approach = 1;
  else if (orbitErr < -3) approach = -1;
  else approach = orbitErr / 3.0;
  const sv = strafeVelocity(enemy, JETPACK_HORIZ_SPEED * 0.7);
  const vx = sv.x + _vec.x * JETPACK_HORIZ_SPEED * 0.6 * approach;
  const vz = sv.z + _vec.z * JETPACK_HORIZ_SPEED * 0.6 * approach;

  // --- VERTICAL MOVEMENT (track hover Y above the player's floor) ---
  const bob = Math.sin(game.elapsed * JETPACK_BOB_FREQ + enemy.animPhase) * JETPACK_BOB_AMP;
  const targetY = player.position.y + enemy.hoverTargetY + bob;
  let dy = targetY - enemy.position.y;
  const maxDy = JETPACK_VERT_SPEED * dt;
  if (dy > maxDy) dy = maxDy;
  else if (dy < -maxDy) dy = -maxDy;

  // Apply horizontal then vertical with collision against walls.
  enemy.position.x += vx * dt;
  enemy.position.z += vz * dt;
  const res = collideCapsule(
    enemy.position.x, enemy.position.y, enemy.position.z,
    enemy.def.radius, ENEMY_BODY_H
  );
  enemy.position.x = res.x;
  enemy.position.z = res.z;
  enemy.position.y += dy;
  // Clamp to a sensible flight envelope (above ground, below perimeter top).
  if (enemy.position.y < 1.0)  enemy.position.y = 1.0;
  if (enemy.position.y > 13.5) enemy.position.y = 13.5;

  // Thruster glow brightens while in flight (always, while alive).
  if (enemy.thrustMat) enemy.thrustMat.emissiveIntensity = 1.8;

  // --- BURST-FIRE STATE MACHINE ---
  const engaging = sees && dist <= JETPACK_FIRE_RANGE;
  if (enemy.flyState === 'firing') {
    enemy.burstTickTimer -= dt;
    // Abort the burst if LOS drops mid-burst — keeps bullets from sailing
    // into walls when the player ducks behind cover.
    if (!sees) {
      enemy.flyState = 'idle';
      enemy.burstCooldown = JETPACK_BURST_COOLDOWN * 0.6;
    } else if (enemy.burstTickTimer <= 0 && enemy.burstLeft > 0 && player.alive) {
      jetpackFire(enemy);
      enemy.burstLeft -= 1;
      enemy.burstTickTimer = JETPACK_BURST_INTERVAL;
      if (enemy.burstLeft <= 0) {
        enemy.flyState = 'idle';
        enemy.burstCooldown = JETPACK_BURST_COOLDOWN;
      }
    }
  } else {
    if (enemy.burstCooldown > 0) {
      enemy.burstCooldown -= dt;
      if (enemy.burstCooldown < 0) enemy.burstCooldown = 0;
    }
    if (engaging && enemy.burstCooldown <= 0) {
      enemy.flyState = 'firing';
      enemy.burstLeft = JETPACK_BURST_COUNT;
      enemy.burstTickTimer = 0;     // fire the first round immediately
    }
  }
}

function jetpackFire(enemy) {
  // Carbine muzzle ≈ 0.58 m forward of the enemy origin at ~1.05 m up.
  // Transform local → world via the enemy facing yaw.
  const yaw = enemy.group.rotation.y;
  const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
  const lx = 0, lz = -0.58;
  const ox = enemy.position.x + (lx * cosY + lz * sinY);
  const oy = enemy.position.y + 1.05;
  const oz = enemy.position.z + (-lx * sinY + lz * cosY);

  const eyeH = player.isCrouching ? 1.2 : 1.6;
  const aimY = enemy._losAimY != null ? enemy._losAimY : eyeH * 0.5;
  // Weak lead + per-shot wobble: deliberately worse than the ground shooter.
  const dir = leadAim(ox, oy, oz, aimY, JETPACK_LEAD_STRENGTH);
  let ddx = dir.x, ddy = dir.y, ddz = dir.z;
  const w = JETPACK_AIM_WOBBLE;
  ddx += (Math.random() * 2 - 1) * w;
  ddy += (Math.random() * 2 - 1) * w * 0.6;
  ddz += (Math.random() * 2 - 1) * w;
  const l = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);

  spawnProjectile(ox, oy, oz, ddx / l, ddy / l, ddz / l);
  sfxShooterFire(ox, oy, oz);   // S55: positional fire at the jetpack muzzle
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
      else if (e.type === 'jetpack') jetpackAI(e, dt);
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
        // S55: barely moved while we should have been travelling. Escalate
        // after AI_STUCK_ESCALATE consecutive unsticks: instead of another
        // perpendicular slide (which can re-jam at the same spot), trigger
        // a deep BACKOFF (reverse + arc) and drop any doorway latch so we
        // re-evaluate routing. A successful move bigger than MIN_MOVE
        // resets the count.
        if (moved < AI_UNSTICK_MIN_MOVE && farFromPlayer) {
          e.stuckCount += 1;
          if (e.unstickTimer <= 0 && e.backoffTimer <= 0) {
            if (e.stuckCount >= AI_STUCK_ESCALATE) {
              e.backoffTimer = AI_BACKOFF_TIME;
              e.unstickSign = -e.unstickSign;
              e.flankSign = -e.flankSign;
              e.doorwayIdx = -1;     // give up the current waypoint; route fresh
              e.stuckCount = 0;
            } else {
              e.unstickTimer = AI_UNSTICK_TIME;
              e.unstickSign = -e.unstickSign;
            }
          }
        } else if (moved > AI_UNSTICK_MIN_MOVE * 2.0) {
          e.stuckCount = 0;          // moved freely → forget recent jams
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
      // S55t: arm sway knocked WAY down (0.08 → 0.015). It's a hold-
      // a-rifle pose now, not a free-swinging arm — should look mostly
      // steady with a faint breathing motion.
      const armSway = Math.sin(e.animPhase) * 0.015;
      if (e.head) e.head.position.y = e.headRestY + headBob;
      if (e.armL) e.armL.rotation.x = e.armLRestX + armSway;
      if (e.armR) e.armR.rotation.x = e.armRRestX - armSway;
      // S55t: leg cycle on its own faster phase. dt*11 ≈ 0.57 s per
      // cycle, close to a CS sprint stride. Amplitude 0.55 rad ≈ 31°
      // gives a confident step rather than a wobble.
      if (e.legL || e.legR) {
        e.legPhase = (e.legPhase || 0) + dt * 11;
        const legSwing = Math.sin(e.legPhase) * 0.55;
        if (e.legL) e.legL.rotation.x = legSwing;
        if (e.legR) e.legR.rotation.x = -legSwing;
      }
      // S55t: head tracking — pitch the head to look toward the player.
      // The body's group.rotation.y already faces the player (the AI
      // sets it every frame); we layer pitch (X-axis rotation) on the
      // head Group so the head additionally tips up/down for tall or
      // crouched players. Clamped to ±35° so the neck doesn't break.
      if (e.head) {
        const hdx = player.position.x - e.position.x;
        const hdz = player.position.z - e.position.z;
        const hd  = Math.hypot(hdx, hdz);
        const headWorldY = e.position.y + (e.headRestY || 0);
        const dy  = (player.position.y + 1.0) - headWorldY;
        const pitch = Math.atan2(-dy, Math.max(0.5, hd));
        // S55x: clamp tightened from ±0.6 to ±0.35 rad. The head slice
        // now anchors at upper-neck/chest height (NECK_Y_FRAC 0.85→0.78
        // so the chin makes it into the head bucket); ±0.6 there visibly
        // detaches the head from the shoulders. ±0.35 ≈ 20° reads as a
        // person looking up/down without snapping the silhouette.
        const clamped = Math.max(-0.35, Math.min(0.35, pitch));
        e.head.rotation.x = clamped;
      }

      // M13: grunt knife-swipe animation overrides arm sway while attacking.
      if (e.type === 'grunt') updateGruntSwipe(e, dt);

      // Hit flash on body mats only — emissive mats keep their permanent glow.
      // S55v: CS character materials carry a baseline self-emissive (so
      // textures are readable in dim parts of the map). The hit-flash lerps
      // toward white but settles back to that rest value instead of zero.
      if (e.hitFlashTimer > 0) {
        e.hitFlashTimer -= dt;
        const flash = Math.max(0, e.hitFlashTimer / HIT_FLASH_TIME);
        for (let j = 0; j < e.bodyMats.length; j++) {
          const m = e.bodyMats[j];
          const rest = m.userData && m.userData.restEmissive;
          if (rest) {
            m.emissive.setRGB(
              flash + (1 - flash) * rest.r,
              flash + (1 - flash) * rest.g,
              flash + (1 - flash) * rest.b,
            );
          } else {
            m.emissive.setRGB(flash, flash, flash);
          }
        }
        if (e.hitFlashTimer <= 0) {
          e.hitFlashTimer = 0;
          for (let j = 0; j < e.bodyMats.length; j++) {
            const m = e.bodyMats[j];
            const rest = m.userData && m.userData.restEmissive;
            if (rest) m.emissive.setRGB(rest.r, rest.g, rest.b);
            else m.emissive.setRGB(0, 0, 0);
          }
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

// S55j: ARENA-MODE spawn picker. Unlike pickSpawnPoint() (which spawns on
// a ring around the player — wave-shooter feel), this picks from the
// fixed ENEMY_SPAWN_POINTS scatter across the WHOLE map. Result: arena
// enemies pop up from every direction over a run, not just one zone.
//
// Selection algorithm:
//   1. Filter to points ≥ SPAWN_MIN_DIST from the player (hard gate).
//   2. Filter to points NOT in the player's forward view cone (so a
//      spawn doesn't blink into being right in front of them).
//   3. Among survivors, pick the one with the best isolation score
//      (farthest from recent spawns). Tie-break randomly.
//   4. If gates filter everything out, relax (any point ≥ MIN_DIST,
//      then any point at all). Always returns a valid {x,z}.
export function pickArenaSpawnPoint() {
  const pyaw = player.yaw;
  const fx = -Math.sin(pyaw);
  const fz = -Math.cos(pyaw);
  const px = player.position.x;
  const pz = player.position.z;

  const pts = ENEMY_SPAWN_POINTS;
  if (!pts || pts.length === 0) return pickSpawnPoint();      // safety fallback

  // Tier candidates by acceptability.
  const tier1 = [];  // far enough + behind/side + not blocked by cover
  const tier2 = [];  // far enough + not blocked by cover (any direction)
  const tier3 = [];  // not blocked by cover (any distance, any direction)
  const tier4 = [];  // anything at all

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (spawnBlockedByCover(p.x, p.z)) { tier4.push(p); continue; }
    const ddx = p.x - px, ddz = p.z - pz;
    const len = Math.sqrt(ddx * ddx + ddz * ddz);
    const farEnough = len >= SPAWN_MIN_DIST;
    if (!farEnough) { tier3.push(p); continue; }
    const dot = len > 0.001 ? (fx * ddx + fz * ddz) / len : 1;
    const inView = dot > SPAWN_VIEW_CONE_DOT;
    if (inView) tier2.push(p); else tier1.push(p);
  }

  const pool = tier1.length ? tier1 : tier2.length ? tier2 : tier3.length ? tier3 : tier4;

  // Score by isolation from recent spawns (so consecutive spawns fan out
  // across the map rather than reusing the same point each respawn).
  let best = pool[0], bestScore = -Infinity;
  for (let i = 0; i < pool.length; i++) {
    // Add a small jitter so equal-score candidates don't always pick the
    // same one (cheap variety without per-frame Math.random() in a hot
    // path — this only runs on spawn events).
    const s = isolationScore(pool[i].x, pool[i].z) + Math.random() * 2;
    if (s > bestScore) { bestScore = s; best = pool[i]; }
  }

  _recentSpawns.push({ x: best.x, z: best.z });
  if (_recentSpawns.length > SPAWN_SPREAD_MEMORY) _recentSpawns.shift();
  return { x: best.x, z: best.z };
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
