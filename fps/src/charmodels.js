// charmodels.js — load + slice + rig CS-style player models for enemies.
//
// Pipeline at module init:
//   1. GLTFLoader fetches assets/models/players.glb (async).
//   2. For each chosen character (urban / sas / terror / leet), walk the
//      sub-tree, classify meshes by material name into body / handL /
//      handR / accessories.
//   3. NORMALIZE: rotate so the model's up-axis becomes Y, scale to a
//      target height (1.8 m), translate so feet are on Y=0 and centroid
//      is on the X=0 / Z=0 axis. The 8 chars use mixed conventions
//      (X-up + Z-side OR Y-side, in CS game units OR meters); the
//      normalization detects this from the raw bbox and applies the
//      right rotations.
//   4. SLICE the body mesh into 5 sub-geometries by per-triangle centroid:
//          legL, legR, torsoHead, armL, armR
//      Classification thresholds:
//        y < hipY  → leg (split L/R by x sign)
//        hipY ≤ y < shoulderY AND |x| > armXThreshold → arm (L/R by sign)
//        otherwise → torsoHead.
//      This produces sub-meshes with jagged cut edges; mitigated by
//      shoulder pads below.
//   5. Build a TEMPLATE per character (geometries + materials + pivot
//      positions). Geometries are shared across all instances (Three.js
//      allows the same BufferGeometry on multiple Meshes); materials are
//      cloned per enemy at instantiation so the hit-flash stays isolated.
//
// Runtime: buildCharacterRig(name, weaponBuilder?) returns a fresh rig
// instance compatible with the existing MODEL_BUILDERS contract:
//   { group, meshes, head, armL, armR, bodyMats, emissiveMats }
// plus an optional weaponPivot child of armR.
//
// FALLBACK: if the GLB hasn't loaded yet OR the character template
// failed to build (no body mesh found etc.), buildCharacterRig returns
// null and enemies.js falls back to the procedural builder.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene } from './scene.js';

const ASSET_URL = 'assets/models/players.glb';
const TARGET_HEIGHT = 1.8;     // meters — the engine's standard enemy height
const CHARACTERS = ['urban', 'sas', 'terror', 'leet'];

// Slice thresholds, as fractions of TARGET_HEIGHT or body half-width.
const HIP_Y_FRAC      = 0.48;   // anything below this Y → leg
const SHOULDER_Y_FRAC = 0.76;   // band between hip and shoulder = torso + arms
const ARM_X_HALF_FRAC = 0.30;   // |X| above this in the mid-band → arm

// Per-arm forward rotation. -55° is a "ready / low-ready" rifle pose;
// the seam stays small while the weapon still reads as held forward.
// (Three's coords: positive Z is out of the screen toward camera at default,
// so rotating an arm group around X by a NEGATIVE angle brings it forward.)
const ARM_FORWARD_X = -0.95;

// Per-character template, populated when the GLB resolves.
//   { name, bodyMat, handMat, parts:{torsoHead,legL,legR,armL,armR},
//     handL, handR, accessories, pivots:{hipY,shoulderY,shoulderXL,shoulderXR,handLLocal,handRLocal} }
const templates = {};
let _readyPromise = null;
let _loadErr = null;

// ===========================================================================
// PUBLIC API
// ===========================================================================

// Start the load (idempotent). Returns a Promise that resolves once the
// GLB has been processed (or rejects only on transport failure — per-
// character build failures log warnings but don't reject).
export function initCharModels() {
  if (_readyPromise) return _readyPromise;
  _readyPromise = new Promise((resolve) => {
    new GLTFLoader().load(
      ASSET_URL,
      (gltf) => {
        try { processGltf(gltf); }
        catch (e) { console.warn('charmodels: processing error', e); }
        resolve();
      },
      undefined,
      (err) => {
        console.warn('charmodels: load failed (' + ASSET_URL + ')', err);
        _loadErr = err;
        resolve();    // resolve anyway so callers don't hang; isReady() stays false
      },
    );
  });
  return _readyPromise;
}

export function hasCharacter(name) { return !!templates[name]; }
export function isReady()           { return Object.keys(templates).length > 0; }

// Build a fresh enemy rig instance from a character template. Returns null if
// the requested character isn't loaded yet — caller falls back.
// `weaponBuilder({ parent, meshes, bodyMats })` is optional; if given, called
// after the rig is assembled with the right-hand pivot as `parent`.
export function buildCharacterRig(charName, weaponBuilder) {
  const tpl = templates[charName];
  if (!tpl) return null;
  return assembleRig(tpl, weaponBuilder);
}

// ===========================================================================
// PROCESS GLB
// ===========================================================================

function processGltf(gltf) {
  for (const charName of CHARACTERS) {
    const root = findCharRoot(gltf.scene, charName);
    if (!root) { console.warn('charmodels: no root for', charName); continue; }
    try {
      templates[charName] = buildTemplate(root, charName);
    } catch (e) {
      console.warn('charmodels: failed building template for', charName, e);
    }
  }
  const got = Object.keys(templates);
  console.log('charmodels: loaded ' + got.length + '/' + CHARACTERS.length + ' (' + got.join(', ') + ')');
}

function findCharRoot(sceneRoot, charName) {
  let found = null;
  const lc = charName.toLowerCase();
  sceneRoot.traverse((n) => {
    if (found) return;
    if (n.name && n.name.toLowerCase().startsWith(lc)) found = n;
  });
  return found;
}

// Collect every mesh in `root`, baking the chain of parent transforms into
// each geometry's vertex positions. After this we own freestanding geometries
// that can be detached from the GLB scene without losing their placement.
function collectMeshes(root) {
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse((n) => {
    if (!n.isMesh) return;
    const g = n.geometry.clone();
    g.applyMatrix4(n.matrixWorld);
    out.push({ name: n.name || '', material: n.material, geometry: g });
  });
  return out;
}

// Classify the collected meshes by material name. Each character has:
//   - 1 body mesh (material '<char>_skin' or similar)
//   - 0-2 hand meshes (material 'hand_<char>' or '<char>_hands')
//   - 0-N accessories (glasses, backpack, chrome trim, etc.)
function classifyMeshes(meshes, charName) {
  const lc = charName.toLowerCase();
  let body = null;
  const hands = [];
  const accessories = [];

  for (const m of meshes) {
    const mname = ((m.material && m.material.name) || '').toLowerCase();
    if (mname.startsWith('hand') || mname.endsWith('_hands') || mname.includes('_hand')) {
      hands.push(m);
    } else if (mname.includes('skin') || mname.includes(lc)) {
      // First skin-tagged mesh wins as the body. Subsequent skin matches
      // (rare) go into accessories.
      if (!body) body = m;
      else accessories.push(m);
    } else {
      accessories.push(m);
    }
  }
  // Fallback: if no body identified, pick the largest mesh (most vertices).
  if (!body && meshes.length) {
    body = meshes.reduce((a, b) =>
      (a.geometry.attributes.position.count >= b.geometry.attributes.position.count ? a : b));
    // Don't double-count.
    const i = accessories.indexOf(body);
    if (i >= 0) accessories.splice(i, 1);
    const j = hands.indexOf(body);
    if (j >= 0) hands.splice(j, 1);
  }
  return { body, hands, accessories };
}

// ===========================================================================
// NORMALIZATION — rotate / scale / center so the model's up is +Y, side is X,
// depth is Z, height 1.8 m, feet on Y=0, centroid on origin.
// ===========================================================================

function buildTemplate(root, charName) {
  const meshes = collectMeshes(root);
  const { body, hands, accessories } = classifyMeshes(meshes, charName);
  if (!body) throw new Error('no body mesh');

  // --- Stage 1: detect up-axis from raw body bbox and rotate so it's Y. ---
  const bb0 = new THREE.Box3().setFromBufferAttribute(body.geometry.attributes.position);
  const sz0 = new THREE.Vector3().subVectors(bb0.max, bb0.min);
  let upAxis = 'y';
  if (sz0.x >= sz0.y && sz0.x >= sz0.z)      upAxis = 'x';
  else if (sz0.z >= sz0.y && sz0.z >= sz0.x) upAxis = 'z';

  const rot1 = new THREE.Matrix4();
  // R that sends up-axis → +Y:
  //   x-up: rotate +90° around Z. (1,0,0)→(0,1,0) ✓
  //   z-up: rotate -90° around X. (0,0,1)→(0,1,0) ✓
  //   y-up: identity.
  if (upAxis === 'x')      rot1.makeRotationZ( Math.PI / 2);
  else if (upAxis === 'z') rot1.makeRotationX(-Math.PI / 2);

  // --- Stage 2: after stage 1, if side-axis came out as Z (wider in Z than X),
  //              rotate around Y to swap Z→X. We want X to be the "side". ---
  const allGeos = [body.geometry, ...hands.map(h => h.geometry), ...accessories.map(a => a.geometry)];
  for (const g of allGeos) g.applyMatrix4(rot1);

  const bb1 = new THREE.Box3().setFromBufferAttribute(body.geometry.attributes.position);
  const sz1 = new THREE.Vector3().subVectors(bb1.max, bb1.min);
  let rot2 = null;
  if (sz1.z > sz1.x * 1.05) {
    // Z is the actual side axis — rotate -90° around Y so (0,0,Z) → (Z,0,0).
    // R_y(-90°): (0,0,1)→(1,0,0), (1,0,0)→(0,0,-1).
    rot2 = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
    for (const g of allGeos) g.applyMatrix4(rot2);
  }

  // --- Stage 3: scale so body height = TARGET_HEIGHT, then translate so
  //              feet are on Y=0 and centroid is on X=Z=0. ---
  const bb2 = new THREE.Box3().setFromBufferAttribute(body.geometry.attributes.position);
  const h = bb2.max.y - bb2.min.y;
  const scale = h > 1e-6 ? (TARGET_HEIGHT / h) : 1;
  const center = new THREE.Vector3().addVectors(bb2.min, bb2.max).multiplyScalar(0.5 * scale);
  // Want: after scale + translate, feet at Y=0, centroid at X=Z=0.
  // After scale alone, the body's bbox.min.y * scale is current floor.
  // To shift floor to 0: translate by -bb2.min.y * scale on Y.
  // To shift centroid X/Z to 0: translate by -center.x / -center.z.
  const tx = -center.x;
  const ty = -bb2.min.y * scale;
  const tz = -center.z;

  const sm = new THREE.Matrix4().makeScale(scale, scale, scale);
  const tm = new THREE.Matrix4().makeTranslation(tx, ty, tz);
  const final = new THREE.Matrix4().multiplyMatrices(tm, sm);
  for (const g of allGeos) g.applyMatrix4(final);

  // --- Stage 4: orient character so they face -Z (Three.js camera default).
  // Heuristic: backpack accessories tend to be behind the character. Inspect
  // accessory bbox vs body center; if accessory is on +Z side, rotate 180° Y.
  // For 4 hand-picked characters this isn't always reliable — fall back to a
  // manual override per character if needed.
  // (Simple version for now: no flip. We'll observe and tune.)

  // --- Stage 5: re-classify hands L/R by post-normalization X sign. ---
  let handL = null, handR = null;
  for (const hh of hands) {
    const hbb = new THREE.Box3().setFromBufferAttribute(hh.geometry.attributes.position);
    const xc = (hbb.min.x + hbb.max.x) / 2;
    if (xc < 0) handL = hh; else handR = hh;
  }

  // --- Stage 6: compute slice thresholds in absolute meters. ---
  const bb3 = new THREE.Box3().setFromBufferAttribute(body.geometry.attributes.position);
  const halfW = Math.max(Math.abs(bb3.min.x), Math.abs(bb3.max.x));
  const params = {
    hipY:      TARGET_HEIGHT * HIP_Y_FRAC,
    shoulderY: TARGET_HEIGHT * SHOULDER_Y_FRAC,
    armX:      halfW * ARM_X_HALF_FRAC * 2,   // 0.30 of half-width × 2 = 0.60 of half-width.
                                              // Picked to be just OUTSIDE the torso column
                                              // while still inside the actual arm geometry.
  };

  // --- Stage 7: slice. ---
  const parts = sliceBody(body.geometry, params);

  // --- Stage 8: pivots (hand position relative to shoulder, in template/
  //              local space — used by assembleRig to place hand meshes
  //              + the weapon mount inside the arm group). ---
  function meshCentroid(g) {
    const bb = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
    return new THREE.Vector3(
      (bb.min.x + bb.max.x) / 2,
      (bb.min.y + bb.max.y) / 2,
      (bb.min.z + bb.max.z) / 2,
    );
  }
  const handLCentroid = handL ? meshCentroid(handL.geometry) : null;
  const handRCentroid = handR ? meshCentroid(handR.geometry) : null;

  return {
    name: charName,
    bodyMat: body.material,
    handMat: (handL || handR || body).material,
    parts: parts,
    handL: handL ? handL.geometry : null,
    handR: handR ? handR.geometry : null,
    accessories: accessories.map(a => ({ geometry: a.geometry, material: a.material })),
    pivots: {
      hipY: params.hipY,
      shoulderY: params.shoulderY,
      shoulderXL: -params.armX,
      shoulderXR:  params.armX,
      handLCentroid,
      handRCentroid,
    },
  };
}

// ===========================================================================
// SLICING — partition a BufferGeometry's triangles into 5 buckets by centroid.
// Each bucket becomes a fresh, non-indexed BufferGeometry sharing the source's
// position/normal/uv attributes for its assigned triangles.
// ===========================================================================

function sliceBody(geo, p) {
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const idx = geo.index;
  const triCount = idx ? (idx.count / 3) : (pos.count / 3);

  const buckets = {
    torsoHead: { pos: [], norm: [], uv: [] },
    legL:      { pos: [], norm: [], uv: [] },
    legR:      { pos: [], norm: [], uv: [] },
    armL:      { pos: [], norm: [], uv: [] },
    armR:      { pos: [], norm: [], uv: [] },
  };

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3)     : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

    const x0 = pos.getX(i0), y0 = pos.getY(i0), z0 = pos.getZ(i0);
    const x1 = pos.getX(i1), y1 = pos.getY(i1), z1 = pos.getZ(i1);
    const x2 = pos.getX(i2), y2 = pos.getY(i2), z2 = pos.getZ(i2);

    const cx = (x0 + x1 + x2) / 3;
    const cy = (y0 + y1 + y2) / 3;

    let target;
    if (cy < p.hipY) {
      target = cx < 0 ? buckets.legL : buckets.legR;
    } else if (cy < p.shoulderY) {
      if      (cx < -p.armX) target = buckets.armL;
      else if (cx >  p.armX) target = buckets.armR;
      else                   target = buckets.torsoHead;
    } else {
      // Above shoulder line: still classify arms outboard, head inboard.
      if      (cx < -p.armX) target = buckets.armL;
      else if (cx >  p.armX) target = buckets.armR;
      else                   target = buckets.torsoHead;
    }

    target.pos.push(x0, y0, z0,  x1, y1, z1,  x2, y2, z2);
    if (norm) {
      target.norm.push(
        norm.getX(i0), norm.getY(i0), norm.getZ(i0),
        norm.getX(i1), norm.getY(i1), norm.getZ(i1),
        norm.getX(i2), norm.getY(i2), norm.getZ(i2),
      );
    }
    if (uv) {
      target.uv.push(
        uv.getX(i0), uv.getY(i0),
        uv.getX(i1), uv.getY(i1),
        uv.getX(i2), uv.getY(i2),
      );
    }
  }

  const out = {};
  for (const key in buckets) {
    const b = buckets[key];
    if (b.pos.length === 0) { out[key] = null; continue; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    if (b.norm.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3));
    else               g.computeVertexNormals();
    if (b.uv.length)   g.setAttribute('uv',     new THREE.Float32BufferAttribute(b.uv, 2));
    out[key] = g;
  }
  return out;
}

// ===========================================================================
// RIG ASSEMBLY — build a fresh THREE.Group hierarchy from a template.
// ===========================================================================

function cloneMat(src) {
  if (!src) return new THREE.MeshStandardMaterial({ color: 0x888888 });
  const c = src.clone();
  // Three.js GLTFLoader materials default to roughness 1 with a baseColor
  // texture; that reads flat in the dusk lighting. Nudge metalness up a hair
  // for a bit of specular pickup off the textured surfaces.
  if (c.metalness !== undefined) c.metalness = Math.min(0.25, (c.metalness || 0) + 0.10);
  if (c.roughness !== undefined) c.roughness = Math.max(0.5, (c.roughness || 0.9) - 0.10);
  return c;
}

function assembleRig(tpl, weaponBuilder) {
  const bodyMat = cloneMat(tpl.bodyMat);
  const handMat = tpl.handMat ? cloneMat(tpl.handMat) : bodyMat;
  const bodyMats = [bodyMat];
  if (handMat !== bodyMat) bodyMats.push(handMat);

  const root = new THREE.Group();
  const meshes = [];
  const piv = tpl.pivots;

  // --- TORSO + HEAD: directly attached to root, no counter-translate
  //                   needed because root is at world (0,0,0). ---
  if (tpl.parts.torsoHead) {
    const m = new THREE.Mesh(tpl.parts.torsoHead, bodyMat);
    root.add(m); meshes.push(m);
  }

  // --- HEAD pivot — synthetic Group at neck height, used by enemy AI for
  //     "head bob" animations. No geometry attached (head is welded into
  //     torsoHead); the bob translates an empty Object3D which the engine
  //     treats as "head moved" but visually nothing happens. Cheap. ---
  const headGroup = new THREE.Group();
  headGroup.position.y = piv.shoulderY + 0.18;
  root.add(headGroup);

  // --- LEGS — each leg gets a Group whose pivot is at the hip joint.
  //     The mesh inside is counter-translated so its geometry stays put;
  //     rotating the Group around X rotates the leg around the hip. ---
  const legLGroup = new THREE.Group();
  legLGroup.position.set(0, piv.hipY, 0);
  root.add(legLGroup);
  if (tpl.parts.legL) {
    const m = new THREE.Mesh(tpl.parts.legL, bodyMat);
    m.position.y = -piv.hipY;   // counter-translate: mesh ends up at world Y of original geo
    legLGroup.add(m); meshes.push(m);
  }
  const legRGroup = new THREE.Group();
  legRGroup.position.set(0, piv.hipY, 0);
  root.add(legRGroup);
  if (tpl.parts.legR) {
    const m = new THREE.Mesh(tpl.parts.legR, bodyMat);
    m.position.y = -piv.hipY;
    legRGroup.add(m); meshes.push(m);
  }

  // --- ARMS — each arm gets a Group pivoted at the shoulder. Counter-
  //     translate the mesh inside so its geometry stays at the original
  //     world position before rotation. Then rotate the Group around X
  //     by ARM_FORWARD_X to bring the arm forward into a held-rifle pose. ---
  const armLGroup = new THREE.Group();
  armLGroup.position.set(piv.shoulderXL, piv.shoulderY, 0);
  root.add(armLGroup);
  if (tpl.parts.armL) {
    const m = new THREE.Mesh(tpl.parts.armL, bodyMat);
    m.position.set(-piv.shoulderXL, -piv.shoulderY, 0);
    armLGroup.add(m); meshes.push(m);
  }
  armLGroup.rotation.x = ARM_FORWARD_X;

  const armRGroup = new THREE.Group();
  armRGroup.position.set(piv.shoulderXR, piv.shoulderY, 0);
  root.add(armRGroup);
  if (tpl.parts.armR) {
    const m = new THREE.Mesh(tpl.parts.armR, bodyMat);
    m.position.set(-piv.shoulderXR, -piv.shoulderY, 0);
    armRGroup.add(m); meshes.push(m);
  }
  armRGroup.rotation.x = ARM_FORWARD_X;

  // --- HAND MESHES — separate from the body. Attach inside each arm group at
  //     the hand's original world position (counter-translated against the
  //     shoulder pivot, same trick as the arm mesh). After group rotation, the
  //     hand rotates with the arm and ends up roughly at the forward hand
  //     position. ---
  if (tpl.handL) {
    const m = new THREE.Mesh(tpl.handL, handMat);
    m.position.set(-piv.shoulderXL, -piv.shoulderY, 0);
    armLGroup.add(m); meshes.push(m);
  }
  if (tpl.handR) {
    const m = new THREE.Mesh(tpl.handR, handMat);
    m.position.set(-piv.shoulderXR, -piv.shoulderY, 0);
    armRGroup.add(m); meshes.push(m);
  }

  // --- SHOULDER PADS — small dark spheres covering the shoulder cuts.
  //     Sit at each arm group's origin (= shoulder pivot), so they rotate
  //     with the arm. Reads as armor / pauldron, hides the seam where the
  //     slicer tore through the welded geometry. ---
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x14161c, roughness: 0.85, metalness: 0.20,
  });
  bodyMats.push(padMat);
  const padL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), padMat);
  armLGroup.add(padL); meshes.push(padL);
  const padR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), padMat);
  armRGroup.add(padR); meshes.push(padR);

  // --- HIP COVER — small dark band at the waist where the leg slice cut
  //     across. Belt-like; hides the hip seams. ---
  const beltGeo = new THREE.BoxGeometry(0.42, 0.10, 0.30);
  const beltMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.85, metalness: 0.20 });
  bodyMats.push(beltMat);
  const belt = new THREE.Mesh(beltGeo, beltMat);
  belt.position.y = piv.hipY;
  root.add(belt); meshes.push(belt);

  // --- ACCESSORIES (backpack, glasses, chrome) — attached directly to root
  //     at their original positions. ---
  for (const acc of tpl.accessories) {
    if (!acc.geometry) continue;
    const am = new THREE.Mesh(acc.geometry, cloneMat(acc.material));
    root.add(am); meshes.push(am);
  }

  // --- WEAPON MOUNT — Group inside armRGroup at the right-hand position.
  //     Caller's weaponBuilder hangs a weapon mesh under this pivot. The
  //     weapon then inherits the arm rotation, so it tracks the hand. ---
  let weaponPivot = null;
  if (weaponBuilder) {
    weaponPivot = new THREE.Group();
    // Local position of the right-hand centroid in the arm group's local
    // space. If the hand pivot is unknown, fall back to a forward + down
    // offset that lands roughly where a held rifle should sit.
    if (piv.handRCentroid) {
      weaponPivot.position.set(
        piv.handRCentroid.x - piv.shoulderXR,
        piv.handRCentroid.y - piv.shoulderY,
        piv.handRCentroid.z,
      );
    } else {
      // Fallback: down 0.55 m from shoulder, slightly forward.
      weaponPivot.position.set(0, -0.55, -0.05);
    }
    armRGroup.add(weaponPivot);
    weaponBuilder({ parent: weaponPivot, meshes, bodyMats });
  }

  return {
    group: root,
    meshes,
    head: headGroup,
    armL: armLGroup,
    armR: armRGroup,
    bodyMats,
    emissiveMats: [],
    weaponPivot,
  };
}

// ===========================================================================
// SIMPLE WEAPON BUILDERS — generic rifle / shotgun / minigun stub for
// enemies that aren't using the procedural rig's per-class weapon meshes.
// ===========================================================================

const RIFLE_MAT_BODY  = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.60, metalness: 0.45 });
const RIFLE_MAT_WOOD  = new THREE.MeshStandardMaterial({ color: 0x402810, roughness: 0.80, metalness: 0.05 });
const RIFLE_MAT_BARREL = new THREE.MeshStandardMaterial({ color: 0x0a0c0f, roughness: 0.45, metalness: 0.70 });

// Build a small rifle-ish shape under `parent`. Sized so a 1.8 m character
// holding it looks proportionate.
export function buildSimpleRifle({ parent, meshes, bodyMats }) {
  const grp = new THREE.Group();
  // Receiver
  const recv = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.32), RIFLE_MAT_BODY);
  recv.position.set(0, 0, -0.10);
  // Barrel
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.36, 8), RIFLE_MAT_BARREL);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, 0.012, -0.40);
  // Stock
  const stk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.22), RIFLE_MAT_WOOD);
  stk.position.set(0, 0, 0.10);
  // Magazine
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.10), RIFLE_MAT_BODY);
  mag.position.set(0, -0.10, -0.05);
  grp.add(recv, bar, stk, mag);
  parent.add(grp);
  meshes.push(recv, bar, stk, mag);
  bodyMats.push(RIFLE_MAT_BODY, RIFLE_MAT_WOOD, RIFLE_MAT_BARREL);
}

// Heavier variant — bigger receiver + double barrel for the heavy class.
export function buildHeavyWeapon({ parent, meshes, bodyMats }) {
  const grp = new THREE.Group();
  const recv = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.14, 0.44), RIFLE_MAT_BODY);
  recv.position.set(0, 0, -0.12);
  const bar1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.46, 8), RIFLE_MAT_BARREL);
  bar1.rotation.x = Math.PI / 2;
  bar1.position.set(-0.025, 0.03, -0.50);
  const bar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.46, 8), RIFLE_MAT_BARREL);
  bar2.rotation.x = Math.PI / 2;
  bar2.position.set( 0.025, 0.03, -0.50);
  const stk = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.24), RIFLE_MAT_WOOD);
  stk.position.set(0, 0, 0.14);
  grp.add(recv, bar1, bar2, stk);
  parent.add(grp);
  meshes.push(recv, bar1, bar2, stk);
  bodyMats.push(RIFLE_MAT_BODY, RIFLE_MAT_WOOD, RIFLE_MAT_BARREL);
}
