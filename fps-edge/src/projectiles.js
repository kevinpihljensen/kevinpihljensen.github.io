// projectiles.js — shooter-fired projectiles. Yellow spheres traveling at
// PROJECTILE_SPEED, lifetime-limited, collide vs player (3D) and static
// AABBs (2D, at chest height — projectiles fly between 1.0–1.4m up).

import * as THREE from 'three';
import { scene } from './scene.js';
import { staticAABBs, pointBlockedBySurface } from './collision.js';
import {
  PROJECTILE_SPEED, PROJECTILE_LIFETIME, PROJECTILE_DAMAGE, PROJECTILE_RADIUS,
  PLAYER_RADIUS, EYE_HEIGHT_STAND, EYE_HEIGHT_CROUCH,
} from './constants.js';
import { player } from './state.js';
import { damagePlayer } from './player.js';

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
const _projStep = new THREE.Vector3();

export function spawnProjectile(ox, oy, oz, dx, dy, dz) {
  const mesh = new THREE.Mesh(projectileGeom, projectileMat);
  mesh.position.set(ox, oy, oz);
  scene.add(mesh);
  projectiles.push({
    mesh,
    position: new THREE.Vector3(ox, oy, oz),
    velocity: new THREE.Vector3(dx * PROJECTILE_SPEED, dy * PROJECTILE_SPEED, dz * PROJECTILE_SPEED),
    lifetime: PROJECTILE_LIFETIME,
    // Origin coords retained so the damage-direction indicator can point at the
    // shooter, not at the projectile's current position (which is near the player on hit).
    originX: ox,
    originZ: oz,
  });
}

function destroyProjectileAt(i) {
  scene.remove(projectiles[i].mesh);
  projectiles.splice(i, 1);
}

export function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.lifetime -= dt;
    if (p.lifetime <= 0) {
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
      const r = PLAYER_RADIUS + PROJECTILE_RADIUS;
      if (distSq < r * r) {
        const eyeH = player.isCrouching ? EYE_HEIGHT_CROUCH : EYE_HEIGHT_STAND;
        const topY = player.position.y + eyeH + 0.1;
        if (p.position.y >= player.position.y - 0.1 && p.position.y <= topY) {
          damagePlayer(PROJECTILE_DAMAGE, p.originX, p.originZ);
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
      if (p.position.x >= a.minX - PROJECTILE_RADIUS &&
          p.position.x <= a.maxX + PROJECTILE_RADIUS &&
          p.position.z >= a.minZ - PROJECTILE_RADIUS &&
          p.position.z <= a.maxZ + PROJECTILE_RADIUS) {
        if (a.minY === undefined ||
            (p.position.y >= a.minY - PROJECTILE_RADIUS &&
             p.position.y <= a.maxY + PROJECTILE_RADIUS)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) { destroyProjectileAt(i); continue; }

    // Ramps + decks: solid along their real (sloped) top. Walls are AABBs
    // (handled above); ramps are not, so test them as surfaces here.
    if (pointBlockedBySurface(p.position.x, p.position.y, p.position.z,
                              PROJECTILE_RADIUS)) {
      destroyProjectileAt(i);
    }
  }
}

export function clearProjectiles() {
  for (let i = 0; i < projectiles.length; i++) scene.remove(projectiles[i].mesh);
  projectiles.length = 0;
}
