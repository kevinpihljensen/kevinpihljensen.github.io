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
  }
}
