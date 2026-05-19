// torches.js — procedural wall-mounted torch geometry with flickering
// point lights. Each torch is a small wood pole topped by a glowing tip
// + a colored PointLight. Used as atmospheric accents at building entries.
//
// Flicker is cheap and deterministic per-torch: a per-torch random seed
// shifts the sin/cos phase so adjacent torches don't pulse in lock-step.
// Intensity oscillates ~25% around base, emissive tip in unison.
//
// API:
//   makeTorch(x, y, z, opts?) — builds geometry + light, registers it,
//                                returns the handle.
//   updateTorchFlicker(dt)   — called each frame from main.js to animate
//                                all registered torches. Cheap; no allocs.

import * as THREE from 'three';
import { scene } from './scene.js';

// Per-torch record. Stays small — a handful of fields per active torch.
const torchList = [];
// Persistent accumulator so flicker is continuous across frames.
let flickerTime = 0;

// Shared pole material — every torch uses the same charred wood shader.
const POLE_MAT = new THREE.MeshStandardMaterial({
  color: 0x2a1408,
  roughness: 1.0,
  metalness: 0.0,
});

export function makeTorch(x, y, z, opts) {
  const o = opts || {};
  const color = o.color === undefined ? 0xffb050 : o.color;
  const baseI = o.intensity === undefined ? 1.6 : o.intensity;
  const range = o.range === undefined ? 11 : o.range;
  const poleH = o.poleH === undefined ? 0.7 : o.poleH;

  // Wood pole.
  const pole = new THREE.Mesh(
    new THREE.BoxGeometry(0.10, poleH, 0.10),
    POLE_MAT,
  );
  pole.position.set(x, y + poleH / 2, z);
  pole.castShadow = false;
  pole.receiveShadow = false;
  scene.add(pole);

  // Glowing tip — emissive sphere. Each torch gets its OWN material so the
  // flicker can drive its emissiveIntensity without affecting other torches.
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xffd070,
    roughness: 0.4,
    metalness: 0.0,
    emissive: color,
    emissiveIntensity: 2.6,
  });
  const tipY = y + poleH + 0.16;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.20, 10, 8), tipMat);
  tip.position.set(x, tipY, z);
  tip.castShadow = false;
  scene.add(tip);

  // Point light.
  const light = new THREE.PointLight(color, baseI, range, 1.5);
  light.castShadow = false;
  light.position.set(x, tipY + 0.08, z);
  scene.add(light);

  const torch = {
    light, tip, tipMat,
    baseI, baseEmissive: 2.6,
    seed: Math.random() * 100,
    // Two harmonics for a less-regular flicker pattern.
    f1: 11 + Math.random() * 4,
    f2: 6.5 + Math.random() * 3,
  };
  torchList.push(torch);
  return torch;
}

// Brazier — a beefier torch. Wider iron pole, larger flame tip + extra
// flicker glow halo, double the light intensity + range. Used at iconic
// landmark approaches where the regular torch would feel underweight
// (citadel ramp foot, foundry entrance, etc).
export function makeBrazier(x, y, z, opts) {
  const o = opts || {};
  const color = o.color === undefined ? 0xff8030 : o.color;
  const baseI = o.intensity === undefined ? 3.2 : o.intensity;
  const range = o.range === undefined ? 16 : o.range;
  const poleH = o.poleH === undefined ? 1.2 : o.poleH;

  // Wider iron pole (cylinder approximated by a thick box).
  const pole = new THREE.Mesh(
    new THREE.BoxGeometry(0.20, poleH, 0.20),
    new THREE.MeshStandardMaterial({ color: 0x1a1a20, roughness: 0.55, metalness: 0.55 }),
  );
  pole.position.set(x, y + poleH / 2, z);
  scene.add(pole);

  // Bowl (squat ring at the top).
  const bowl = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.15, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x2c2820, roughness: 0.7, metalness: 0.45 }),
  );
  bowl.position.set(x, y + poleH + 0.08, z);
  scene.add(bowl);

  // Bigger flame core + outer halo (two stacked spheres).
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xffd070,
    roughness: 0.30,
    metalness: 0.0,
    emissive: color,
    emissiveIntensity: 3.4,
  });
  const tipY = y + poleH + 0.40;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), tipMat);
  tip.position.set(x, tipY, z);
  scene.add(tip);

  const haloMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), haloMat);
  halo.position.set(x, tipY, z);
  halo.renderOrder = 1;
  scene.add(halo);

  const light = new THREE.PointLight(color, baseI, range, 1.4);
  light.castShadow = false;
  light.position.set(x, tipY + 0.10, z);
  scene.add(light);

  const torch = {
    light, tip, tipMat,
    baseI, baseEmissive: 3.4,
    halo, haloMat, baseHaloOpacity: 0.35,
    seed: Math.random() * 100,
    f1: 9 + Math.random() * 3,
    f2: 5 + Math.random() * 3,
    isBrazier: true,
  };
  torchList.push(torch);
  return torch;
}

// Tick. Called from main.js every frame.
export function updateTorchFlicker(dt) {
  flickerTime += dt;
  const t = flickerTime;
  for (let i = 0; i < torchList.length; i++) {
    const T = torchList[i];
    // Two-octave flicker: a slow swell and a faster jitter, both in
    // [-1, 1]. Final factor in roughly [0.72, 1.18].
    const a = Math.sin(t * T.f1 + T.seed);
    const b = Math.cos(t * T.f2 + T.seed * 0.7);
    const f = 0.95 + 0.16 * a + 0.07 * b;
    T.light.intensity = T.baseI * f;
    T.tipMat.emissiveIntensity = T.baseEmissive * f;
    if (T.halo && T.haloMat) {
      T.haloMat.opacity = T.baseHaloOpacity * (0.7 + 0.4 * f);
    }
  }
}
