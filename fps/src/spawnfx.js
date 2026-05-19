// spawnfx.js — short-lived visual flourish at arena enemy spawn points.
// When an arena enemy is placed (wave.js startArena + respawn queue),
// a glowing pillar of light briefly rises at the spawn position, then
// dissolves. Pure visual / atmospheric — collision is untouched.
//
// Each FX is a small additive-blended cylinder (approximated as a thin
// vertical box) + a flash point light. Animated over a ~0.8 s lifetime
// with rising scale and falling opacity. Cleaned up after expiry.
//
// API:
//   spawnSpawnFX(x, y, z, color?)  — fire one effect at this position.
//   updateSpawnFX(dt)              — tick all active effects.

import * as THREE from 'three';
import { scene } from './scene.js';
import { LAYER_WORLD } from './constants.js';

const FX_DURATION = 0.85;

// Each FX: { t: 0..1, mesh, light, baseScale, color }.
const active = [];

export function spawnSpawnFX(x, y, z, color) {
  const c = color === undefined ? 0xff44a4 : color;
  // Vertical glow pillar — narrow + tall so it reads as a beam.
  const mat = new THREE.MeshBasicMaterial({
    color: c,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.4, 0.6), mat);
  mesh.position.set(x, y + 1.7, z);
  mesh.renderOrder = 2;
  scene.add(mesh);
  // Co-located point light so the beam casts a flash on nearby walls.
  const light = new THREE.PointLight(c, 2.8, 9, 1.6);
  light.castShadow = false;
  light.position.set(x, y + 1.5, z);
  light.layers.set(LAYER_WORLD);
  scene.add(light);
  active.push({ t: 0, mesh, light, mat });
}

export function updateSpawnFX(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const fx = active[i];
    fx.t += dt;
    const k = fx.t / FX_DURATION;
    if (k >= 1) {
      // Cleanup.
      scene.remove(fx.mesh);
      scene.remove(fx.light);
      fx.mesh.geometry.dispose();
      fx.mat.dispose();
      active.splice(i, 1);
      continue;
    }
    // Envelope: scale grows (0.6 → 1.6), opacity falls (1.0 → 0).
    const grow = 0.6 + k * 1.0;
    fx.mesh.scale.set(grow, 1.0, grow);
    fx.mat.opacity = 1.0 - k * k;            // quadratic falloff
    fx.light.intensity = 2.8 * (1.0 - k);    // linear falloff
  }
}
