// operatorskin.js — drop-in replacement skin for the grunt.
//
// The asset (assets/models/operator.glb) is a rigged Claude-Design export
// with one skin + three baked animations. Unlike the CS player models
// (charmodels.js) we DON'T slice the body — this model already has a real
// skeleton, so we let its bundled animation clips drive the limbs.
//
// API:
//   initOperatorSkin()                — kick off the GLB load (idempotent)
//   hasOperator()                     — true once the GLB has loaded
//   buildOperatorRig()                — returns a rig object compatible with
//                                       enemies.js makeEnemy (the same fields
//                                       buildCharacterRig returns)
//
// Each call to buildOperatorRig clones the loaded scene via SkeletonUtils.clone
// so every instance has its own SkinnedMesh references AND its own skeleton.
// We also create one AnimationMixer per instance and start the first clip on
// loop; the per-frame tick is driven from updateEnemies in enemies.js via the
// returned `mixer` field.
//
// Each rig hands back its mixer in the returned object so enemies.js can
// tick it per-frame; there is no global registry.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const ASSET_URL = 'assets/models/operator.glb';

// One target height in metres. We scale the cloned tree so its Y span fits
// this — keeps movement / collision feeling consistent with the other
// enemy rigs.
const TARGET_HEIGHT = 1.8;

let _gltf = null;
let _readyPromise = null;
// Source-tree measurements so each clone scales identically.
let _scale = 1;

export function hasOperator() { return _gltf !== null; }

export function initOperatorSkin() {
  if (_readyPromise) return _readyPromise;
  _readyPromise = new Promise((resolve) => {
    new GLTFLoader().load(
      ASSET_URL,
      (gltf) => {
        try {
          // Pre-measure the source so each clone uses the same scale.
          const bb = new THREE.Box3().setFromObject(gltf.scene);
          const h = bb.max.y - bb.min.y;
          _scale = h > 1e-3 ? (TARGET_HEIGHT / h) : 1;
          _gltf = gltf;
        } catch (e) {
          console.warn('operatorskin: process error', e);
        }
        resolve();
      },
      undefined,
      (err) => {
        console.warn('operatorskin: load failed (' + ASSET_URL + ')', err);
        resolve();
      },
    );
  });
  return _readyPromise;
}

// Build a fresh rig instance. The returned shape matches what
// buildCharacterRig returns so enemies.js makeEnemy can consume it
// interchangeably.
export function buildOperatorRig() {
  if (!_gltf) return null;
  const root = cloneSkinned(_gltf.scene);
  root.scale.setScalar(_scale);

  // Walk the tree: cast/receive shadows, collect every Mesh, collect
  // material refs for hit-flash. (We DON'T touch positions or hierarchy —
  // the model and its skeleton stay exactly as authored.)
  const meshes = [];
  const bodyMats = [];
  const seenMats = new Set();
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    meshes.push(o);
    // Material(s): may be a single material or an array (multi-material).
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (!m || seenMats.has(m)) continue;
      seenMats.add(m);
      // Hit-flash code in enemies.js sets m.emissive.setRGB during a flash
      // and restores to m.userData.restEmissive on clear. Read whatever
      // emissive the material was authored with as the rest baseline so
      // the flash returns to source-design colour, not pitch black.
      if (m.emissive) {
        m.userData = m.userData || {};
        m.userData.restEmissive = {
          r: m.emissive.r, g: m.emissive.g, b: m.emissive.b,
        };
      }
      bodyMats.push(m);
    }
  });

  // Animation mixer: play the first clip on loop. Three clips exist in the
  // source; the first is almost always the idle/walk loop. Phase offset
  // randomised so a row of operators doesn't lock-step.
  let mixer = null;
  if (_gltf.animations && _gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(_gltf.animations[0]);
    action.play();
    // Random start time so multiple operators desync.
    action.time = Math.random() * action.getClip().duration;
  }

  // Wrap in an outer Group so enemies.js (which sets group.rotation.y to
  // face the player) doesn't collide with any rotation the model carries
  // internally. Outer group is what enemies.js will rotate / position.
  const outer = new THREE.Group();
  outer.add(root);

  return {
    group: outer,
    meshes,
    bodyMats,
    emissiveMats: [],
    headMeshes: [],
    // No head / armL / armR / legL / legR — the bundled animation runs the
    // limbs. enemies.js animation hooks are all null-guarded.
    head: null,
    armL: null,
    armR: null,
    legL: null,
    legR: null,
    weaponPivot: null,
    mixer,
  };
}

