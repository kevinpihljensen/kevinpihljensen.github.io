// projectiles.js — shooter-fired projectiles. Yellow spheres traveling at
// PROJECTILE_SPEED, lifetime-limited, collide vs player (3D) and static
// AABBs (2D, at chest height — projectiles fly between 1.0–1.4m up).
//
// S55ai: kind='rocket' variant for the rocketeer. Slower, slightly bigger,
// AND explodes on any hit (player, AABB, or surface) instead of a single-
// target damage. AoE damage is dealt to every enemy + the player inside
// ROCKET_EXPLODE_RADIUS with linear falloff (just like grenades.js).

import * as THREE from 'three';
import { scene } from './scene.js';
import { staticAABBs, pointBlockedBySurface } from './collision.js';
import {
  PROJECTILE_SPEED, PROJECTILE_LIFETIME, PROJECTILE_DAMAGE, PROJECTILE_RADIUS,
  PLAYER_RADIUS, EYE_HEIGHT_STAND, EYE_HEIGHT_CROUCH,
  ROCKET_SPEED, ROCKET_LIFETIME, ROCKET_RADIUS,
  ROCKET_EXPLODE_RADIUS, ROCKET_EXPLODE_DAMAGE, ROCKETEER_DAMAGE,
} from './constants.js';
import { player } from './state.js';
import { damagePlayer } from './player.js';
import { enemies, damageEnemy } from './enemies.js';

export const projectiles = [];

// M11: emissive projectile material — bright yellow-orange that survives tone
// mapping. Slightly bigger sphere than m10 (was 0.12, now 0.16) so it reads
// from across the arena. We add a faint point light to the player projectile
// later if needed; for now the emissive alone is visible enough through fog.
const projectileGeom = new THREE.SphereGeometry(0.16, 12, 8);
const projectileMat = new THREE.MeshStandardMaterial({
  color: 0xff8c1a, emissive: 0xff8c1a, emissiveIntensity: 1.5,
  roughness: 0.4, toneMapped: false,
});
// S55ai: rocket projectile mesh — fat red warhead capsule, distinct from
// the yellow bullet sphere so the player can see "incoming explosive"
// from a distance and decide to break cover or dodge.
const rocketGeom = new THREE.CapsuleGeometry(0.10, 0.34, 6, 10);
const rocketMat = new THREE.MeshStandardMaterial({
  color: 0xff3a14, emissive: 0xff5020, emissiveIntensity: 2.0,
  roughness: 0.45, metalness: 0.4, toneMapped: false,
});
// Quick-fade explosion flash (shared geometry; per-detonation material clone).
const explodeFlashGeom = new THREE.SphereGeometry(1.0, 16, 12);
const explodeFlashMat = new THREE.MeshStandardMaterial({
  color: 0xfff0a0, emissive: 0xffaa30, emissiveIntensity: 2.5,
  toneMapped: false, transparent: true, opacity: 0.85,
});
const _flashes = [];

const _projStep = new THREE.Vector3();

// S55ad: optional `damage` arg overrides PROJECTILE_DAMAGE per shot, used
// by the grunt's low-damage pistol so it can share the projectile path with
// the shooter without needing a separate pool.
export function spawnProjectile(ox, oy, oz, dx, dy, dz, damage) {
  const mesh = new THREE.Mesh(projectileGeom, projectileMat);
  mesh.position.set(ox, oy, oz);
  scene.add(mesh);
  projectiles.push({
    kind: 'bullet',
    mesh,
    position: new THREE.Vector3(ox, oy, oz),
    velocity: new THREE.Vector3(dx * PROJECTILE_SPEED, dy * PROJECTILE_SPEED, dz * PROJECTILE_SPEED),
    lifetime: PROJECTILE_LIFETIME,
    damage: damage !== undefined ? damage : PROJECTILE_DAMAGE,
    // Origin coords retained so the damage-direction indicator can point at the
    // shooter, not at the projectile's current position (which is near the player on hit).
    originX: ox,
    originZ: oz,
  });
}

// S55ai: rocket variant. Slower speed, distinct mesh, explodes on ANY
// collision (player / AABB / ramp surface). Lifetime sized so it covers
// the map diagonal.
export function spawnRocket(ox, oy, oz, dx, dy, dz) {
  const mesh = new THREE.Mesh(rocketGeom, rocketMat);
  mesh.position.set(ox, oy, oz);
  // Orient the capsule along its velocity so it reads as flying nose-first.
  const v = new THREE.Vector3(dx, dy, dz).normalize();
  // Capsule's default axis is +Y; we want it to lie along v.
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
  mesh.quaternion.copy(q);
  scene.add(mesh);
  projectiles.push({
    kind: 'rocket',
    mesh,
    position: new THREE.Vector3(ox, oy, oz),
    velocity: new THREE.Vector3(dx * ROCKET_SPEED, dy * ROCKET_SPEED, dz * ROCKET_SPEED),
    lifetime: ROCKET_LIFETIME,
    damage: ROCKETEER_DAMAGE,
    originX: ox,
    originZ: oz,
  });
}

// Detonate a rocket at (x,y,z) — AoE damage to enemies + player with
// linear falloff, plus a visual flash that fades over ~0.45 s. Shared
// with grenades.js's detonate logic but kept local to avoid a cycle.
function rocketExplode(x, y, z, originX, originZ) {
  // Visual flash.
  const fm = new THREE.Mesh(explodeFlashGeom, explodeFlashMat.clone());
  fm.position.set(x, y, z);
  fm.scale.setScalar(0.4);
  scene.add(fm);
  _flashes.push({ mesh: fm, t: 0, dur: 0.45 });
  // Enemies inside the radius take falloff damage.
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    const dx = e.position.x - x;
    const dy = (e.position.y + 1.0) - y;
    const dz = e.position.z - z;
    const d = Math.hypot(dx, dy, dz);
    if (d > ROCKET_EXPLODE_RADIUS) continue;
    const dmg = ROCKET_EXPLODE_DAMAGE * (1 - d / ROCKET_EXPLODE_RADIUS);
    damageEnemy(e, dmg);
  }
  // Player too — using the rocket's ORIGIN for the damage-direction
  // indicator so the player is pointed back at the shooter, not at the
  // explosion centre.
  if (player.alive) {
    const dx = player.position.x - x;
    const dy = (player.position.y + 0.9) - y;
    const dz = player.position.z - z;
    const d = Math.hypot(dx, dy, dz);
    if (d <= ROCKET_EXPLODE_RADIUS) {
      const dmg = ROCKET_EXPLODE_DAMAGE * (1 - d / ROCKET_EXPLODE_RADIUS);
      damagePlayer(dmg, originX, originZ);
    }
  }
}

function destroyProjectileAt(i) {
  scene.remove(projectiles[i].mesh);
  projectiles.splice(i, 1);
}

export function updateProjectiles(dt) {
  // Explosion flashes (rocket detonations only).
  for (let i = _flashes.length - 1; i >= 0; i--) {
    const f = _flashes[i];
    f.t += dt;
    const u = f.t / f.dur;
    if (u >= 1) {
      scene.remove(f.mesh);
      f.mesh.material.dispose();
      _flashes.splice(i, 1);
      continue;
    }
    const r = 0.4 + u * (ROCKET_EXPLODE_RADIUS - 0.4);
    f.mesh.scale.setScalar(r);
    f.mesh.material.opacity = 0.85 * (1 - u) * (1 - u);
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const radius = p.kind === 'rocket' ? ROCKET_RADIUS : PROJECTILE_RADIUS;
    p.lifetime -= dt;
    if (p.lifetime <= 0) {
      // S55ai: rocket that ran out of fuel airbursts at its last position
      // so a long-range overshoot doesn't just silently vanish.
      if (p.kind === 'rocket') {
        rocketExplode(p.position.x, p.position.y, p.position.z, p.originX, p.originZ);
      }
      destroyProjectileAt(i);
      continue;
    }

    _projStep.copy(p.velocity).multiplyScalar(dt);
    p.position.add(_projStep);
    p.mesh.position.copy(p.position);

    // Player hit: 2D radial check + 3D Y range gate so jumping/crouching
    // genuinely dodges. Player Y range is [pos.y, pos.y + eye_height].
    if (player.alive) {
      const ddx = p.position.x - player.position.x;
      const ddz = p.position.z - player.position.z;
      const distSq = ddx * ddx + ddz * ddz;
      const r = PLAYER_RADIUS + radius;
      if (distSq < r * r) {
        const eyeH = player.isCrouching ? EYE_HEIGHT_CROUCH : EYE_HEIGHT_STAND;
        const topY = player.position.y + eyeH + 0.1;
        if (p.position.y >= player.position.y - 0.1 && p.position.y <= topY) {
          if (p.kind === 'rocket') {
            // Direct hit on the player: the impact dose (p.damage) plus
            // the AoE detonation around the hit point.
            damagePlayer(p.damage, p.originX, p.originZ);
            rocketExplode(p.position.x, p.position.y, p.position.z, p.originX, p.originZ);
          } else {
            damagePlayer(p.damage, p.originX, p.originZ);
          }
          destroyProjectileAt(i);
          continue;
        }
      }
    }

    // Static AABB: now height-aware. A projectile at p.position.y only
    // collides with a blocker whose [minY,maxY] span contains it — so a
    // ground-level shot isn't eaten by an upper-floor deck's AABB, and a
    // shot can pass over a low railing.
    let hit = false;
    for (let j = 0; j < staticAABBs.length; j++) {
      const a = staticAABBs[j];
      if (p.position.x >= a.minX - radius &&
          p.position.x <= a.maxX + radius &&
          p.position.z >= a.minZ - radius &&
          p.position.z <= a.maxZ + radius) {
        if (a.minY === undefined ||
            (p.position.y >= a.minY - radius &&
             p.position.y <= a.maxY + radius)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) {
      if (p.kind === 'rocket') {
        rocketExplode(p.position.x, p.position.y, p.position.z, p.originX, p.originZ);
      }
      destroyProjectileAt(i);
      continue;
    }

    // Ramps + decks: solid along their real (sloped) top. Walls are AABBs
    // (handled above); ramps are not, so test them as surfaces here.
    if (pointBlockedBySurface(p.position.x, p.position.y, p.position.z, radius)) {
      if (p.kind === 'rocket') {
        rocketExplode(p.position.x, p.position.y, p.position.z, p.originX, p.originZ);
      }
      destroyProjectileAt(i);
    }
  }
}

export function clearProjectiles() {
  for (let i = 0; i < projectiles.length; i++) scene.remove(projectiles[i].mesh);
  projectiles.length = 0;
  // S55ai: also wipe any active rocket explosion flashes so a mode-switch
  // doesn't leave a half-faded fireball in the new scene.
  for (let i = 0; i < _flashes.length; i++) {
    scene.remove(_flashes[i].mesh);
    _flashes[i].mesh.material.dispose();
  }
  _flashes.length = 0;
}
