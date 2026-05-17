// decals.js — bullet impact marks. Tiny black circles placed at hit points,
// oriented along the surface normal. FIFO eviction at MAX_DECALS, lifetime
// of DECAL_LIFE seconds.

import * as THREE from 'three';
import { scene } from './scene.js';
import { DECAL_LIFE, MAX_DECALS } from './constants.js';

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
