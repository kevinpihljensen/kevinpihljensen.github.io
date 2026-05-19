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
// S55i: stormy-dusk gradient. Deep indigo zenith bleeds into a violent
// orange band at the horizon, with a dark ground line below. The amber
// horizon picks up the torches + rune-sentinel lights in the same hue
// family, so the warm lights read as belonging to the world rather than
// floating on it. Cheap, no shader, no asset — a 4×256 vertical strip
// upscaled by THREE's wrapping at draw time.
function makeSkyTexture() {
  const W = 4, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.00, '#0a0a1c');  // deep indigo zenith
  grad.addColorStop(0.40, '#2a1832');  // bruised violet
  grad.addColorStop(0.70, '#5a2a28');  // dim ember
  grad.addColorStop(0.86, '#a85020');  // orange ember
  grad.addColorStop(0.93, '#cc6628');  // peak horizon glow
  grad.addColorStop(1.00, '#2a1a18');  // dark ground line
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- SCENE ---
export const scene = new THREE.Scene();
scene.background = makeSkyTexture();
// S55i: dusty-orange fog matched to the dusk sky's horizon. Denser
// (28→85, was 30→95) so distant geometry hazes earlier, intensifying
// the citadel's "looming" silhouette from spawn.
scene.fog = new THREE.Fog(0x4a2a28, 28, 85);

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
// S55i: dusk-mood lighting. Hemisphere palette shifts warmer (violet sky
// + warm dim ground); sun direction lowered to a long oblique angle from
// the horizon so shadows stretch dramatically across the plaza; sun color
// warmed toward orange-red. Ambient nudged down so the torches and rune
// sentinels actually MATTER as light sources.
const hemi = new THREE.HemisphereLight(0x6a4878, 0x4a3024, 0.95);
hemi.position.set(0, 50, 0);
scene.add(hemi);

const ambient = new THREE.AmbientLight(0xffe0c4, 0.45);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffae64, 1.20);
sun.position.set(45, 22, 35);
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
// S55o: the 3×3 = 9-flood grid was a major contributor to the recent
// frame-rate hitches — each PointLight runs another iteration of the
// fragment-shader light loop per pixel. Reduced to a sparse 5-point
// pattern (1 centre + 4 cardinals at ±32) with each light's range
// bumped 70 → 80 so coverage is preserved. Same dusk-amber tint,
// each light slightly brighter (0.55 → 0.70) so the total scene
// illumination level stays close to what it was. Net fragment-shader
// work: ≈ 44 % less per pixel.
const floodLights = [];
const FLOOD_POSITIONS = [
  [  0, 19,   0],
  [ 32, 19,   0],
  [-32, 19,   0],
  [  0, 19,  32],
  [  0, 19, -32],
];
for (const [px, py, pz] of FLOOD_POSITIONS) {
  const fl = new THREE.PointLight(0xffd098, 0.70, 80, 1.0);
  fl.castShadow = false;
  fl.position.set(px, py, pz);
  scene.add(fl);
  floodLights.push(fl);
}
// A broad ambient bump matched to the dusk sky.
const skyFill = new THREE.HemisphereLight(0xb88a78, 0x3a2418, 0.45);
skyFill.position.set(0, 60, 0);
scene.add(skyFill);

// S55g: amber atmospheric glow from the two RUNE SENTINEL monoliths
// flanking the citadel grand-ramp foot (maplayout.js puts the rune walls
// at (-5, 4) and (5, 4) with emissive 0xff9a30). Small radius (12 m) so
// the glow stays local to the citadel approach — sells the "you are
// entering the keep" beat without washing the whole plaza.
const runeSentinelL = new THREE.PointLight(0xff9a30, 1.8, 12, 1.6);
runeSentinelL.position.set(-5, 2.4, 4);
runeSentinelL.castShadow = false;
scene.add(runeSentinelL);
const runeSentinelR = new THREE.PointLight(0xff9a30, 1.8, 12, 1.6);
runeSentinelR.position.set( 5, 2.4, 4);
runeSentinelR.castShadow = false;
scene.add(runeSentinelR);

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
