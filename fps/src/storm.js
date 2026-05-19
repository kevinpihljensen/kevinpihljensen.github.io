// storm.js — periodic lightning flash atmospheric effect. Strikes
// happen on a randomized interval (8-18 s). Each strike is a two-pulse
// envelope: a brief bright spike (~0.10 s), a dim falloff (~0.25 s),
// optionally a second smaller spike (~0.07 s) for a forked-bolt feel.
//
// Visually drives a hidden DirectionalLight added to the scene at flash
// time — its intensity is the only thing that's animated. No textures,
// no DOM overlay, no shaders. The strike light shares its layer mask
// with the world so it illuminates structure, not the held weapon
// (which would feel uncomfortably bright).
//
// API:
//   initStorm()         — creates the flash light. Call once at boot.
//   updateStorm(dt)     — tick. Increments timers, drives light intensity.

import * as THREE from 'three';
import { scene } from './scene.js';
import { LAYER_WORLD } from './constants.js';

let flashLight = null;
let timeToNextStrike = 0;     // seconds until the next bolt fires
let strikeEnvT = 0;           // strike envelope timer (0 = inactive)
let strikeDuration = 0;       // total envelope length, set per strike
let secondaryDelay = 0;       // for double-flash strikes
let strikeIntensityPeak = 0;  // randomized per strike

function pickNextInterval() {
  // 8-18 second gap between bolts. Skewed slightly toward the longer
  // end so the player isn't constantly flashing.
  return 8 + Math.random() * 10;
}

export function initStorm() {
  if (flashLight) return;
  // White-blue directional, no shadows — purely an ambient illumination
  // event. Angle chosen to come from the upper north so structure faces
  // pointing toward spawn get the harshest light, dramatizing skylines.
  flashLight = new THREE.DirectionalLight(0xe6efff, 0);
  flashLight.position.set(0, 80, -60);
  flashLight.castShadow = false;
  flashLight.layers.set(LAYER_WORLD);
  scene.add(flashLight);
  timeToNextStrike = 3 + Math.random() * 4;     // first bolt ~3-7s after spawn
}

export function updateStorm(dt) {
  if (!flashLight) return;
  if (strikeEnvT > 0) {
    // Two-pulse envelope:
    //   t < 0.10: rising spike to peak
    //   t < 0.35: linear falloff to ~0
    //   t < 0.35+secondaryDelay: small fork-bolt secondary spike
    let intensity = 0;
    if (strikeEnvT < 0.10) {
      intensity = strikeIntensityPeak * (strikeEnvT / 0.10);
    } else if (strikeEnvT < 0.35) {
      intensity = strikeIntensityPeak * (1 - (strikeEnvT - 0.10) / 0.25);
    } else if (secondaryDelay > 0 && strikeEnvT < 0.35 + secondaryDelay + 0.10) {
      const t2 = strikeEnvT - 0.35 - secondaryDelay;
      if (t2 < 0.05) intensity = strikeIntensityPeak * 0.55 * (t2 / 0.05);
      else if (t2 < 0.10) intensity = strikeIntensityPeak * 0.55 * (1 - (t2 - 0.05) / 0.05);
    }
    flashLight.intensity = Math.max(0, intensity);
    strikeEnvT += dt;
    if (strikeEnvT > strikeDuration) {
      strikeEnvT = 0;
      flashLight.intensity = 0;
    }
    return;
  }
  // No active strike — count down to the next one.
  timeToNextStrike -= dt;
  if (timeToNextStrike <= 0) {
    // Fire a bolt.
    strikeEnvT = 0.001;
    strikeIntensityPeak = 2.4 + Math.random() * 1.6;  // 2.4-4.0
    secondaryDelay = Math.random() < 0.55 ? 0.06 + Math.random() * 0.12 : 0;
    strikeDuration = 0.36 + (secondaryDelay > 0 ? secondaryDelay + 0.12 : 0);
    // Re-jitter direction slightly per strike for variety.
    flashLight.position.set(
      (Math.random() - 0.5) * 80,
      60 + Math.random() * 40,
      (Math.random() - 0.5) * 80 - 30,
    );
    timeToNextStrike = pickNextInterval();
  }
}
