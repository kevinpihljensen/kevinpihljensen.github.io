// scene.js — Three.js engine singletons + atmosphere.
//
// M11 changes:
//   * Background is a gradient sky (CanvasTexture used as scene.background)
//     rather than flat grey. Warmer near the horizon, cool overhead.
//   * Fog: linear fog from 30 → 90 units. Distant cover fades into haze,
//     gives the 80x80 arena a sense of scale.
//   * Lighting: directional sun (warm) + hemisphere light (sky/ground tint)
//     + small fill ambient. Three lights working together looks substantially
//     better than the m10 single-directional setup.
//   * Tone mapping: ACESFilmic + output color space sRGB so materials retain
//     contrast and saturated colors don't blow out.

import * as THREE from 'three';
import { DEFAULT_FOV, EYE_HEIGHT_STAND, LAYER_VIEWMODEL } from './constants.js';

// --- RENDERER ---
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// ACES tone mapping gives a slightly filmic roll-off — bright highlights
// don't clip to pure white as harshly. Exposure trimmed slightly under 1.0
// because hemisphere + directional + ambient stacks brighter than just
// directional + ambient.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- SKY ---
// A vertical-gradient canvas: deep blue-grey at top, warmer near horizon.
// Used as scene.background. Cheap, no shader, no asset.
function makeSkyTexture() {
  const W = 4, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.00, '#1a2030');  // zenith
  grad.addColorStop(0.55, '#3d4655');
  grad.addColorStop(0.90, '#6b6358');  // warmer horizon
  grad.addColorStop(1.00, '#8a7864');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- SCENE ---
export const scene = new THREE.Scene();
scene.background = makeSkyTexture();
// Linear fog: starts close enough to soften the far perimeter, dense enough
// at the horizon that you don't see the harsh edge between floor and sky.
scene.fog = new THREE.Fog(0x5a5868, 30, 95);

// --- CAMERA ---
export const camera = new THREE.PerspectiveCamera(
  DEFAULT_FOV,
  window.innerWidth / window.innerHeight,
  // Near plane 0.05 (was 0.1): when crouched hard up against the ramp's
  // sloped underside the eye sits ~0.1 m below it, so a 0.1 near plane
  // clipped the slab and you could see through it. 0.05 keeps it solid;
  // depth precision with far=500 is still fine for this scene.
  0.05,
  500
);
camera.rotation.order = 'YXZ';
camera.position.set(0, EYE_HEIGHT_STAND, 0);
scene.add(camera);

export const clock = new THREE.Clock();

// --- LIGHTING ---
// Four-part setup tuned so NOTHING in the playable area ever reads as pure
// black, even surfaces facing away from the sun:
//   * hemisphere — strong sky/ground fill (raised from 0.55 → 0.95)
//   * ambient    — flat floor so shadowed faces keep detail (0.15 → 0.40)
//   * sun        — directional key + shadows (slightly softened to 0.85 so
//                  the lit/unlit contrast isn't so harsh across the map)
//   * viewLight  — a dim point light parented to the camera. Travels with the
//                  player and always lights whatever they're looking at from
//                  their side. This is what stops the held weapon from going
//                  black when you face away from the sun (the view model is
//                  lit by world lights like everything else, so without this
//                  its shadowed side is whatever faces the camera).
const hemi = new THREE.HemisphereLight(0xaebdd6, 0x6a5a48, 1.25);
hemi.position.set(0, 50, 0);
scene.add(hemi);

const ambient = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffe5b8, 1.05);
sun.position.set(30, 60, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// Shadow camera sized for the 80x80 arena. Bigger = softer / lower res; we
// keep it just big enough to cover the play area.
sun.shadow.camera.left = -50;
sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50;
sun.shadow.camera.bottom = -50;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 150;
// Bias trims acne; normalBias helps thin walls (interior walls + pillars).
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
// Lighter shadows: don't let shadowed areas crush to black. (0 = full dark,
// 1 = no shadow.) ~0.45 keeps shadows readable as shape without being caves.
sun.shadow.intensity = 0.55;
scene.add(sun);

// Camera-follow fill light. Brightened and reach extended so the held
// weapon (and nearby geometry) is never in shade even facing away from the
// sun. No shadows (perf + it's a fill).
const viewLight = new THREE.PointLight(0xfff2e0, 1.5, 32, 1.2);
viewLight.castShadow = false;
viewLight.position.set(0, 0, 0);
camera.add(viewLight);

// --- OVERHEAD ARENA FLOOD ---
// Artificial ceiling lighting: a grid of high downward point lights so the
// WHOLE 80x80 arena reads bright and evenly lit, not just the sun-facing
// side. No shadows (a 9-light shadowed grid is far too expensive and the
// sun already supplies the shaped shadows). World layer only — the held
// weapon is handled by viewLight, so these don't double-blow-out the gun.
const floodLights = [];
for (let gx = -1; gx <= 1; gx++) {
  for (let gz = -1; gz <= 1; gz++) {
    const fl = new THREE.PointLight(0xf3f6ff, 0.85, 70, 1.0);
    fl.castShadow = false;
    fl.position.set(gx * 24, 19, gz * 24);
    scene.add(fl);
    floodLights.push(fl);
  }
}
// A broad ambient bump so deep-shadow faces away from every flood light
// still keep detail (the user wants the whole map lit up).
const skyFill = new THREE.HemisphereLight(0xdfe8ff, 0x4a4640, 0.55);
skyFill.position.set(0, 60, 0);
scene.add(skyFill);

// The view model renders in a separate, depth-cleared pass on
// LAYER_VIEWMODEL. A light only contributes to a pass whose camera layer it
// shares, so every light that should illuminate the held weapon must also be
// enabled on LAYER_VIEWMODEL (they keep LAYER_WORLD too, so the world pass is
// unchanged). This keeps the gun lit exactly as it was before the overlay.
for (const L of [hemi, ambient, sun, viewLight]) {
  L.layers.enable(LAYER_VIEWMODEL);
}

// --- DEDICATED VIEW-MODEL LIGHT RIG ---
// These light ONLY the view-model pass (layers set to LAYER_VIEWMODEL and
// NOT world), parented to the camera so they travel with the player. Because
// they are independent of every world light, the held weapon is lit the same
// no matter how dark or bright the map is. Combined with the emissive floor
// on the weapon materials (weapons.js), the gun is always clearly visible.
// They contribute nothing to the world pass, so they don't wash the arena.
const gunKey = new THREE.DirectionalLight(0xffffff, 2.4);
gunKey.position.set(-0.4, 0.6, 1);     // from upper-left-front of the camera
gunKey.target.position.set(0, -0.2, -1);
gunKey.castShadow = false;
camera.add(gunKey);
camera.add(gunKey.target);

const gunFill = new THREE.HemisphereLight(0xdfe6ff, 0x202024, 1.6);
camera.add(gunFill);

const gunRim = new THREE.PointLight(0xffffff, 1.4, 8, 1.5);
gunRim.position.set(0.3, -0.1, -0.6);  // just ahead of the camera
gunRim.castShadow = false;
camera.add(gunRim);

for (const L of [gunKey, gunFill, gunRim]) {
  L.layers.set(LAYER_VIEWMODEL);        // ONLY the view-model pass
}

// --- RESIZE ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
