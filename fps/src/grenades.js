// grenades.js — player-throwable explosives with AoE damage.
//
// Lifecycle (one in-flight grenade):
//   1. throwGrenade() consumes player.grenades, spawns a dark sphere at the
//      eye, gives it a velocity along the camera forward + an upward tilt.
//   2. updateGrenades() integrates gravity, bounces off static AABBs with
//      energy loss, ticks the fuse.
//   3. When the fuse hits zero (or velocity is near zero and the grenade has
//      settled), detonate: spawn a quick expanding emissive sphere as the
//      explosion visual, damage every enemy and the player inside
//      GRENADE_RADIUS with linear falloff.
//
// Collision uses the existing staticAABBs list (height-aware) the same way
// projectiles.js does. We don't bounce off ramps — there's no ramp AABB
// surface query that supports a bounce normal — instead the grenade just
// slides along until the fuse fires. Good enough for a gameplay-feel
// explosive; no one will spend a frame analysing a grenade rolling down a
// ramp.

import * as THREE from 'three';
import { scene } from './scene.js';
import { staticAABBs, groundHeightAt } from './collision.js';
import { player } from './state.js';
import { enemies, damageEnemy } from './enemies.js';
import { damagePlayer } from './player.js';
import {
  GRENADE_FUSE, GRENADE_GRAVITY, GRENADE_BOUNCE,
  GRENADE_RADIUS, GRENADE_DAMAGE, GRENADE_SELF_DAMAGE_MULT,
} from './constants.js';

export const grenades = [];

// Two pools: the small dark "live" grenade (one mesh per active throw), and
// a "flash" mesh per detonation (a quickly-expanding emissive sphere).
const liveGeom = new THREE.SphereGeometry(0.085, 10, 8);
const liveMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a1a, roughness: 0.55, metalness: 0.55, emissive: 0x110a0a,
});
const flashGeom = new THREE.SphereGeometry(1.0, 16, 12);
const flashMat = new THREE.MeshStandardMaterial({
  color: 0xfff0a0, emissive: 0xffaa30, emissiveIntensity: 2.5,
  toneMapped: false, transparent: true, opacity: 0.85,
});

const flashes = [];

const _step = new THREE.Vector3();

export function spawnGrenade(ox, oy, oz, vx, vy, vz) {
  const mesh = new THREE.Mesh(liveGeom, liveMat);
  mesh.position.set(ox, oy, oz);
  mesh.castShadow = true;
  scene.add(mesh);
  grenades.push({
    mesh,
    position: new THREE.Vector3(ox, oy, oz),
    velocity: new THREE.Vector3(vx, vy, vz),
    fuse: GRENADE_FUSE,
    detonated: false,
  });
}

// Try to find an axis to reflect against when the grenade pushes into an
// AABB. Picks the shallowest-penetration face so the bounce reads correct.
// Returns 'x', 'y', or 'z' (the world axis to flip), or null if no face is
// resolvable (the grenade is entirely inside the box — shouldn't happen in
// practice but we treat it as "stop").
function aabbBounceAxis(p, prev, a) {
  // Compare how far each axis crossed the box face from outside-prev to
  // inside-now. The axis with the smallest "depth" is the contact face.
  let depth = Infinity, axis = null;
  if (prev.x < a.minX && p.x >= a.minX) { const d = p.x - a.minX; if (d < depth) { depth = d; axis = 'x'; } }
  if (prev.x > a.maxX && p.x <= a.maxX) { const d = a.maxX - p.x; if (d < depth) { depth = d; axis = 'x'; } }
  if (prev.y < a.minY && p.y >= a.minY) { const d = p.y - a.minY; if (d < depth) { depth = d; axis = 'y'; } }
  if (prev.y > a.maxY && p.y <= a.maxY) { const d = a.maxY - p.y; if (d < depth) { depth = d; axis = 'y'; } }
  if (prev.z < a.minZ && p.z >= a.minZ) { const d = p.z - a.minZ; if (d < depth) { depth = d; axis = 'z'; } }
  if (prev.z > a.maxZ && p.z <= a.maxZ) { const d = a.maxZ - p.z; if (d < depth) { depth = d; axis = 'z'; } }
  return axis;
}

function detonate(g) {
  // Spawn the visual flash — expanding emissive sphere that fades over
  // ~0.45 s. Pooled per detonation; no audio.
  const fm = new THREE.Mesh(flashGeom, flashMat.clone());
  fm.position.copy(g.position);
  fm.scale.setScalar(0.4);
  scene.add(fm);
  flashes.push({ mesh: fm, t: 0, dur: 0.45 });

  // Damage scan: enemies + player. Linear falloff from centre to radius.
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    const dx = e.position.x - g.position.x;
    const dy = (e.position.y + 1.0) - g.position.y;
    const dz = e.position.z - g.position.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > GRENADE_RADIUS) continue;
    const dmg = GRENADE_DAMAGE * (1 - d / GRENADE_RADIUS);
    damageEnemy(e, dmg);
  }
  if (player.alive) {
    const dx = player.position.x - g.position.x;
    const dy = (player.position.y + 0.9) - g.position.y;
    const dz = player.position.z - g.position.z;
    const d = Math.hypot(dx, dy, dz);
    if (d <= GRENADE_RADIUS) {
      const dmg = GRENADE_DAMAGE * (1 - d / GRENADE_RADIUS) * GRENADE_SELF_DAMAGE_MULT;
      damagePlayer(dmg, g.position.x, g.position.z);
    }
  }

  scene.remove(g.mesh);
  g.detonated = true;
}

export function updateGrenades(dt) {
  // 1. Flashes (visual only).
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t += dt;
    const u = f.t / f.dur;
    if (u >= 1) {
      scene.remove(f.mesh);
      f.mesh.material.dispose();
      flashes.splice(i, 1);
      continue;
    }
    // Expand from 0.4 → GRENADE_RADIUS scale; opacity fades cubicly out.
    const r = 0.4 + u * (GRENADE_RADIUS - 0.4);
    f.mesh.scale.setScalar(r);
    f.mesh.material.opacity = 0.85 * (1 - u) * (1 - u);
  }

  // 2. Live grenades.
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    if (g.detonated) { grenades.splice(i, 1); continue; }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      detonate(g);
      grenades.splice(i, 1);
      continue;
    }
    // Gravity.
    g.velocity.y -= GRENADE_GRAVITY * dt;
    // Integrate.
    const prevX = g.position.x, prevY = g.position.y, prevZ = g.position.z;
    _step.copy(g.velocity).multiplyScalar(dt);
    g.position.add(_step);
    // Floor contact: clamp to groundHeightAt + small skin, bounce.
    const gh = groundHeightAt(g.position.x, g.position.z, g.position.y + 0.2, 0.1);
    if (gh !== null && g.position.y <= gh + 0.05) {
      g.position.y = gh + 0.05;
      if (g.velocity.y < 0) g.velocity.y = -g.velocity.y * GRENADE_BOUNCE;
      // Horizontal friction so the grenade doesn't slide forever.
      g.velocity.x *= 0.78;
      g.velocity.z *= 0.78;
      // Settle: if horizontal speed is tiny and we just landed, stop entirely.
      if (Math.hypot(g.velocity.x, g.velocity.z) < 0.20 && Math.abs(g.velocity.y) < 0.4) {
        g.velocity.set(0, 0, 0);
      }
    }
    // AABB bounce.
    const prev = { x: prevX, y: prevY, z: prevZ };
    const pad = 0.085;
    for (let j = 0; j < staticAABBs.length; j++) {
      const a = staticAABBs[j];
      if (g.position.x < a.minX - pad || g.position.x > a.maxX + pad) continue;
      if (g.position.z < a.minZ - pad || g.position.z > a.maxZ + pad) continue;
      if (a.minY !== undefined &&
          (g.position.y < a.minY - pad || g.position.y > a.maxY + pad)) continue;
      const axis = aabbBounceAxis(g.position, prev, a);
      if (axis === 'x') {
        g.position.x = prevX;
        g.velocity.x = -g.velocity.x * GRENADE_BOUNCE;
      } else if (axis === 'y') {
        g.position.y = prevY;
        g.velocity.y = -g.velocity.y * GRENADE_BOUNCE;
      } else if (axis === 'z') {
        g.position.z = prevZ;
        g.velocity.z = -g.velocity.z * GRENADE_BOUNCE;
      }
      // Dampen horizontal after a wall bounce so it doesn't ricochet
      // forever between two parallel walls.
      g.velocity.x *= 0.85;
      g.velocity.z *= 0.85;
    }
    g.mesh.position.copy(g.position);
  }
}

export function clearGrenades() {
  for (let i = 0; i < grenades.length; i++) scene.remove(grenades[i].mesh);
  grenades.length = 0;
  for (let i = 0; i < flashes.length; i++) {
    scene.remove(flashes[i].mesh);
    flashes[i].mesh.material.dispose();
  }
  flashes.length = 0;
}
