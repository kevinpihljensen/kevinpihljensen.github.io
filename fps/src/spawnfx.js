// spawnfx.js — short-lived visual flourish at arena enemy spawn points.
// When an arena enemy is placed (wave.js startArena + respawn queue),
// a glowing additive-blended pillar briefly rises at the spawn position
// and dissolves. Pure visual / atmospheric — collision is untouched.
//
// S55o: the original implementation also added a co-located PointLight
// per FX. That meant the scene's point-light COUNT changed every spawn
// (~every 1.7 s in arena), which forces every MeshStandardMaterial in
// the scene to recompile its fragment shader — the classic Three.js
// perf gotcha. The point light is gone now; the additive-blended mesh
// alone reads "bright" against the dusk floor without needing real
// per-pixel illumination.
//
// API:
//   spawnSpawnFX(x, y, z, color?)  — fire one effect at this position.
//   updateSpawnFX(dt)              — tick all active effects.

import * as THREE from 'three';
import { scene } from './scene.js';

const FX_DURATION = 0.85;

// Each FX: { t: 0..1, mesh, mat }.
const active = [];

export function spawnSpawnFX(x, y, z, color) {
  const c = color === undefined ? 0xff44a4 : color;
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
  active.push({ t: 0, mesh, mat });
}

export function updateSpawnFX(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const fx = active[i];
    fx.t += dt;
    const k = fx.t / FX_DURATION;
    if (k >= 1) {
      scene.remove(fx.mesh);
      fx.mesh.geometry.dispose();
      fx.mat.dispose();
      active.splice(i, 1);
      continue;
    }
    // Envelope: scale grows (0.6 → 1.6), opacity falls quadratically.
    const grow = 0.6 + k * 1.0;
    fx.mesh.scale.set(grow, 1.0, grow);
    fx.mat.opacity = 1.0 - k * k;
  }
}
