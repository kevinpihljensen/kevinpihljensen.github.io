// decals.js — bullet impact marks + blood splatter.
//
// Two pools live here:
//   * `decals`  — black circle marks where bullets hit world geometry. Long
//                 lifetime, no fade, FIFO eviction at MAX_DECALS.
//   * `blood`   — red splat discs spawned when an enemy is hit. Short
//                 lifetime, opacity fades linearly to zero, FIFO eviction at
//                 MAX_BLOOD. Each splat call spawns several offset droplets
//                 around the hit point so it reads as a burst rather than a
//                 single dot.
//
// Both pools are cleared on round reset (`clearDecals` + `clearBlood`).

import * as THREE from 'three';
import { scene } from './scene.js';
import { DECAL_LIFE, MAX_DECALS, BLOOD_LIFE, MAX_BLOOD } from './constants.js';

const decalGeom = new THREE.CircleGeometry(0.08, 14);
const decalMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.DoubleSide });

export const decals = [];

const _decalPos = new THREE.Vector3();
const _decalLook = new THREE.Vector3();

export function createImpact(point, worldNormal) {
  const mesh = new THREE.Mesh(decalGeom, decalMat);
  // Pull the decal slightly off the surface along the normal to avoid z-fighting.
  _decalPos.copy(point).addScaledVector(worldNormal, 0.005);
  mesh.position.copy(_decalPos);
  _decalLook.copy(point).add(worldNormal);
  mesh.lookAt(_decalLook);
  scene.add(mesh);
  decals.push({ mesh, age: 0 });
  while (decals.length > MAX_DECALS) {
    const old = decals.shift();
    scene.remove(old.mesh);
  }
}

export function updateDecals(dt) {
  for (let i = decals.length - 1; i >= 0; i--) {
    decals[i].age += dt;
    if (decals[i].age >= DECAL_LIFE) {
      scene.remove(decals[i].mesh);
      decals.splice(i, 1);
    }
  }
}

export function clearDecals() {
  for (let i = 0; i < decals.length; i++) scene.remove(decals[i].mesh);
  decals.length = 0;
}

// --- S54 BLOOD SPLATTER ---
// Shared geometry; materials are PER-SPLAT so opacity can fade independently.
const bloodGeom = new THREE.CircleGeometry(0.07, 10);

export const blood = [];

// Reusable scratch vectors so we don't allocate on every hit (hot path).
const _bp = new THREE.Vector3();
const _bAxisX = new THREE.Vector3();
const _bAxisY = new THREE.Vector3();
const _bLookAt = new THREE.Vector3();
const _WORLD_UP = new THREE.Vector3(0, 1, 0);
const _WORLD_RIGHT = new THREE.Vector3(1, 0, 0);

// Build a 2D basis on the plane perpendicular to `n` (assumed unit length),
// writing the two basis vectors into `outX` and `outY`. Picks UP × n by
// default, falling back to RIGHT × n when n is nearly vertical (degenerate).
function _basisOnPlane(n, outX, outY) {
  if (Math.abs(n.y) < 0.95) outX.crossVectors(_WORLD_UP, n).normalize();
  else                       outX.crossVectors(_WORLD_RIGHT, n).normalize();
  outY.crossVectors(n, outX).normalize();
}

// Spawn a blood burst at `point`, oriented so the disks face along `normal`
// (which should point back toward the shooter for a clean camera-facing
// read). Spawns 4–6 droplets in a small disc around the hit point with
// randomised scale and a slight push along the normal so droplets don't
// z-fight each other.
export function createBloodSplat(point, normal) {
  _basisOnPlane(normal, _bAxisX, _bAxisY);
  _bLookAt.copy(point).add(normal);
  const droplets = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < droplets; i++) {
    const r = Math.random() * 0.20;
    const phi = Math.random() * Math.PI * 2;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7a0808, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const m = new THREE.Mesh(bloodGeom, mat);
    m.scale.setScalar(0.5 + Math.random() * 0.9);
    _bp.copy(point)
      .addScaledVector(normal, 0.015 + Math.random() * 0.01)
      .addScaledVector(_bAxisX, Math.cos(phi) * r)
      .addScaledVector(_bAxisY, Math.sin(phi) * r);
    m.position.copy(_bp);
    m.lookAt(_bLookAt);
    scene.add(m);
    blood.push({ mesh: m, mat, age: 0 });
    while (blood.length > MAX_BLOOD) {
      const old = blood.shift();
      scene.remove(old.mesh);
      old.mat.dispose();
    }
  }
}

export function updateBlood(dt) {
  for (let i = blood.length - 1; i >= 0; i--) {
    const b = blood[i];
    b.age += dt;
    const t = b.age / BLOOD_LIFE;
    if (t >= 1) {
      scene.remove(b.mesh);
      b.mat.dispose();
      blood.splice(i, 1);
    } else {
      // Linear opacity fade from 0.95 → 0.
      b.mat.opacity = 0.95 * (1 - t);
    }
  }
}

export function clearBlood() {
  for (let i = 0; i < blood.length; i++) {
    scene.remove(blood[i].mesh);
    blood[i].mat.dispose();
  }
  blood.length = 0;
}
