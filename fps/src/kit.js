// kit.js — map construction kit.
//
// Pre-defined, composable map elements that snap together cleanly on top of
// the verified collision primitives (collision.js makeBoxSolid/makeRampSolid).
// Visuals are generated to match each solid exactly (what you see is what you
// collide with), so there is no clipping or see-through on structural pieces.
//
// THE CONNECTION CONTRACT  (the important part)
// --------------------------------------------
// Every element exposes its walkable TOP Y and its XZ footprint. Connectors
// (ramp / stairs) do NOT take raw coordinates — they take a target platform
// handle plus a side, and COMPUTE the solid so that, by construction:
//
//   * the connector's high end Y === platform.top   (exact same value)
//   * the connector's high end sits on the platform's edge plane
//   * the connector's cross-width is clamped inside the platform's extent,
//     so the high end lands fully on the deck (never half-off → no gap)
//
// At the junction the connector surface and the deck top are therefore
// coplanar. groundHeightAt() takes the highest supporting sample, so the
// player crests onto the deck with ZERO lip, ZERO gap, ZERO step and no
// jump. Walking the other way, the surface descends continuously onto the
// connector. This is verified numerically (harness_kit.mjs) by sampling the
// real groundHeightAt across the seam.
//
// STAIRS are a ramp for COLLISION (one makeRampSolid wedge — smooth, no
// per-step riser to body-block, no jump) with cosmetic step meshes on the
// hypotenuse. They behave exactly like a ramp and inherit the same seamless
// platform join; they just look like steps.
//
// Element semantics:
//   ground   — base floor box (top = y).
//   platform — solid deck: walkable top, occludes below, has an underside.
//   ramp     — smooth incline; connect*() guarantees the seamless deck join.
//   stairs   — ramp collision + visual steps (walk up cleanly, no jumping).
//   box      — walkable cuboid (cover/crate). Jump onto or go around; you
//              cannot walk UP onto it (a box riser body-blocks like a wall —
//              that is what stairs/ramps are for).
//   wall     — tall thin solid obstacle.
//   overhang — the verified sloped thin slab you walk / crouch under.

import * as THREE from 'three';
import { scene } from './scene.js';
import { makeBoxSolid, makeRampSolid, shootables, clamp } from './collision.js';
import { makeFloorTexture, makeBrickTexture, makeWoodTexture,
         makeConcreteTexture, makeMetalTexture,
         makeSlateStoneTexture, makeIronPlateTexture, makeMarbleSlabTexture,
         makeSandstoneTexture, makeRuneSlabTexture,
         makePortalTexture, makeJumpPadTexture, makeBannerTexture } from './textures.js';
import { registerTeleporter } from './teleporters.js';
import { registerJumpPad } from './jumppads.js';

// --- MATERIALS (shared; DoubleSide on structure so a winding mistake can
// never read as see-through — the user requires structure be opaque) ---
// S55: textured materials instead of flat colors. Each texture's repeat is
// tuned for the typical surface size where the material lands.
// S55g: added 5 themed materials (slate / iron / marble / sandstone / rune)
// that LAYOUT entries can request via an optional `mat` field. Default
// behaviour unchanged — entries without `mat` get the kind-default.
const floorTex = makeFloorTexture();
floorTex.repeat.set(20, 20);                  // 160m ground / 8m per tile
const brickTex = makeBrickTexture();
brickTex.repeat.set(2, 1);                    // a couple of repeats across a typical wall
const woodTex = makeWoodTexture();
woodTex.repeat.set(1, 1);                     // crates are small — one tile reads
const concreteTex = makeConcreteTexture();
concreteTex.repeat.set(3, 3);
const concreteRampTex = makeConcreteTexture();
concreteRampTex.repeat.set(2, 2);
const metalTex = makeMetalTexture();
metalTex.repeat.set(2, 2);
const overhangTex = makeConcreteTexture();
overhangTex.repeat.set(2, 2);
// S55g themed textures. Each repeats less aggressively than the base
// brick so the larger block / plate pattern reads at structure scale.
const slateTex = makeSlateStoneTexture();
slateTex.repeat.set(1.5, 1);
const ironTex = makeIronPlateTexture();
ironTex.repeat.set(1.5, 1);
const marbleTex = makeMarbleSlabTexture();
marbleTex.repeat.set(2, 2);
const sandstoneTex = makeSandstoneTexture();
sandstoneTex.repeat.set(1.5, 1);
const runeTex = makeRuneSlabTexture();
runeTex.repeat.set(1, 1);

const MAT = {
  floor:     new THREE.MeshStandardMaterial({ map: floorTex,    roughness: 0.92, metalness: 0.05, side: THREE.DoubleSide }),
  deck:      new THREE.MeshStandardMaterial({ map: concreteTex, color: 0xb5b8bd, roughness: 0.85, metalness: 0.12, side: THREE.DoubleSide }),
  ramp:      new THREE.MeshStandardMaterial({ map: concreteRampTex, color: 0xa2a6ac, roughness: 0.85, metalness: 0.18, side: THREE.DoubleSide }),
  stair:     new THREE.MeshStandardMaterial({ map: metalTex,    color: 0x9aa1ac, roughness: 0.65, metalness: 0.40, side: THREE.DoubleSide }),
  box:       new THREE.MeshStandardMaterial({ map: woodTex,     color: 0xc7b290, roughness: 0.80, metalness: 0.05, side: THREE.DoubleSide }),
  wall:      new THREE.MeshStandardMaterial({ map: brickTex,    color: 0xd0c8bd, roughness: 0.85, metalness: 0.08, side: THREE.DoubleSide }),
  overhang:  new THREE.MeshStandardMaterial({ map: overhangTex, color: 0xa0a4aa, roughness: 0.85, metalness: 0.18, side: THREE.DoubleSide }),
  // S55g themed materials.
  slate:     new THREE.MeshStandardMaterial({ map: slateTex,     color: 0x9eaab6, roughness: 0.88, metalness: 0.10, side: THREE.DoubleSide }),
  iron:      new THREE.MeshStandardMaterial({ map: ironTex,      color: 0xc4bfb6, roughness: 0.62, metalness: 0.55, side: THREE.DoubleSide }),
  marble:    new THREE.MeshStandardMaterial({ map: marbleTex,    color: 0xf0e8d8, roughness: 0.32, metalness: 0.18, side: THREE.DoubleSide }),
  sandstone: new THREE.MeshStandardMaterial({ map: sandstoneTex, color: 0xc8ad84, roughness: 0.95, metalness: 0.04, side: THREE.DoubleSide }),
  rune:      new THREE.MeshStandardMaterial({ map: runeTex,      color: 0xffffff, roughness: 0.50, metalness: 0.25,
                                              emissive: 0xff9a30, emissiveMap: runeTex, emissiveIntensity: 0.85,
                                              side: THREE.DoubleSide }),
};

// Resolve an optional material key to a THREE material; falls back to the
// fallback if `mat` is unset or unknown.
function resolveMat(mat, fallback) {
  if (mat && MAT[mat]) return MAT[mat];
  return MAT[fallback] || MAT.wall;
}

function addMesh(geo, mat, castShadow) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = castShadow !== false;
  m.receiveShadow = true;
  scene.add(m);
  shootables.push(m);
  return m;
}

// Build a non-indexed mesh from explicit triangles (verts + face index lists).
function triMesh(verts, faces, mat, castShadow) {
  const pos = [];
  for (const f of faces) for (const i of f) {
    const p = verts[i]; pos.push(p[0], p[1], p[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return addMesh(geo, mat, castShadow);
}

// --- GROUND ---------------------------------------------------------------
// Big floor box, top face at y. half = half-extent (x,z in [-half, half]).
export function ground(half, y) {
  const top = y === undefined ? 0 : y;
  makeBoxSolid(-half, half, top - 2, top, -half, half);
  const g = new THREE.BoxGeometry(half * 2, 2, half * 2);
  const m = new THREE.Mesh(g, MAT.floor);
  m.position.set(0, top - 1, 0);
  m.receiveShadow = true;
  scene.add(m); shootables.push(m);
  return { top, x0: -half, x1: half, z0: -half, z1: half, cx: 0, cz: 0 };
}

// --- PLATFORM / DECK ------------------------------------------------------
// Solid box deck. top = walkable Y; thick = how far it extends below top.
// Optional `mat` overrides the default deck material — S55g uses this to
// theme zones (slate keep, marble HILLTOP, etc).
export function platform({ cx, cz, top, sx, sz, thick = 0.6, mat }) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  makeBoxSolid(x0, x1, top - thick, top, z0, z1);
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, thick, sz), resolveMat(mat, 'deck'));
  m.position.set(cx, top - thick / 2, cz);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m); shootables.push(m);
  return { top, x0, x1, z0, z1, cx, cz };
}

// --- BOX / COVER ----------------------------------------------------------
// Solid cuboid you can stand on / hide behind. Walkable top = base + sy.
// (You cannot walk UP onto it — a box riser body-blocks like a wall. Jump
// onto it, or go around. Use stairs/ramp for no-jump ascent.)
// Optional `mat` overrides the default crate material (used for the
// CATWALK_HE bridge — it should read as forged iron, not wood).
export function box({ cx, cz, base = 0, sx, sy, sz, mat }) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  makeBoxSolid(x0, x1, base, base + sy, z0, z1);
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), resolveMat(mat, 'box'));
  m.position.set(cx, base + sy / 2, cz);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m); shootables.push(m);
  return { top: base + sy, x0, x1, z0, z1, cx, cz };
}

// --- TEXT LABEL (in-world floating sprite) --------------------------------
// A canvas-texture sprite that always faces the camera. Used to label test
// boxes with their height so the player can report which heights work.
export function textLabel(text, x, y, z, scale = 1) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(10,12,16,0.78)';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#7fd4ff'; g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 122);
  g.fillStyle = '#eaf6ff';
  g.font = 'bold 64px system-ui, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.position.set(x, y, z);
  sp.scale.set(1.6 * scale, 0.8 * scale, 1);
  scene.add(sp);
  return sp;
}

// A solid box with a floating height label hovering above it. `label`
// overrides the auto "<height> m" text if given.
export function labeledBox({ cx, cz, base = 0, sx, sy, sz, label }) {
  const h = box({ cx, cz, base, sx, sy, sz });
  const txt = label !== undefined ? label : `${(base + sy).toFixed(2)} m`;
  textLabel(txt, cx, base + sy + 0.9, cz, 1);
  return h;
}

// --- SOLID BOX (low-level) -----------------------------------------------
// An axis-aligned solid from explicit world bounds, with a mesh that
// matches it exactly. Used to build aperture walls (doorways/windows) as a
// set of verified makeBoxSolid segments — what you see is what you collide
// with and shoot, and the opening has NO mesh so bullets/vision pass.
export function solidBox({ x0, x1, y0, y1, z0, z1 }, kind = 'wall', mat) {
  if (x1 - x0 <= 1e-4 || y1 - y0 <= 1e-4 || z1 - z0 <= 1e-4) return;
  // S55: wall-style solids are not walkable (see kit.wall comment).
  // S55g: `mat` (optional) overrides material independently of collision
  // semantics. We treat slate/iron/sandstone/rune as wall-like (noWalk);
  // marble is decorative deck-cladding (walkable). The `kind` arg keeps
  // its existing role as the "what is this collision-wise" hint.
  const noWalkMats = new Set(['slate', 'iron', 'sandstone', 'rune']);
  const isWall = kind === 'wall' || noWalkMats.has(mat);
  const opts = isWall ? { noWalk: true } : undefined;
  makeBoxSolid(x0, x1, y0, y1, z0, z1, opts);
  const material = (mat && MAT[mat]) || MAT[kind] || MAT.wall;
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m); shootables.push(m);
}

// --- WALL -----------------------------------------------------------------
// Tall thin solid obstacle. axis 'x' → spans along X (length in X); axis 'z'
// → spans along Z. height from base up.
export function wall({ cx, cz, base = 0, length, height, thick = 0.5, axis = 'x', mat }) {
  let x0, x1, z0, z1;
  if (axis === 'x') { x0 = cx - length / 2; x1 = cx + length / 2; z0 = cz - thick / 2; z1 = cz + thick / 2; }
  else              { z0 = cz - length / 2; z1 = cz + length / 2; x0 = cx - thick / 2; x1 = cx + thick / 2; }
  // S55: walls are NOT walkable. A 0.5 m-thick beam shouldn't read as a
  // walkable ledge — without this, a stair/ramp seam landing next to a wall
  // (e.g. an external staircase passing the building wall) would pick up the
  // wall top as the surface and the connector-seam check would fail.
  makeBoxSolid(x0, x1, base, base + height, z0, z1, { noWalk: true });
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, height, z1 - z0), resolveMat(mat, 'wall'));
  m.position.set((x0 + x1) / 2, base + height / 2, (z0 + z1) / 2);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m); shootables.push(m);
  return { top: base + height, x0, x1, z0, z1, cx, cz };
}

// Resolve a connector spec against a platform `P` and a `side` into the
// makeRampSolid arguments — the SINGLE source of the connection contract.
// Returns { axis, loPos, hiPos, loY, hiY, c0, c1 }.
function solveConnection(P, side, run, width, fromY) {
  const hiY = P.top;            // exact same value as the deck top
  const loY = fromY;
  const half = width / 2;
  let axis, loPos, hiPos, c0, c1;
  if (side === '-z' || side === '+z') {
    axis = 'z';
    if (side === '-z') { hiPos = P.z0; loPos = P.z0 - run; }
    else               { hiPos = P.z1; loPos = P.z1 + run; }
    c0 = clamp(P.cx - half, P.x0, P.x1);
    c1 = clamp(P.cx + half, P.x0, P.x1);
  } else {
    axis = 'x';
    if (side === '-x') { hiPos = P.x0; loPos = P.x0 - run; }
    else               { hiPos = P.x1; loPos = P.x1 + run; }
    c0 = clamp(P.cz - half, P.z0, P.z1);
    c1 = clamp(P.cz + half, P.z0, P.z1);
  }
  return { axis, loPos, hiPos, loY, hiY, c0, c1 };
}

// Solid wedge mesh exactly matching makeRampSolid's solid (y=0 → sloped top,
// 4 sides, flat bottom). axis 'z': run in Z, cross in X (c0..c1). 'x' mirror.
function wedgeMesh(axis, loPos, hiPos, loY, hiY, c0, c1, mat) {
  // Surface y at a run coordinate p (clamped to the run span).
  const aMin = Math.min(loPos, hiPos), aMax = Math.max(loPos, hiPos);
  const m = (hiY - loY) / (hiPos - loPos);
  const b = loY - m * loPos;
  const yAt = (p) => m * (p < aMin ? aMin : p > aMax ? aMax : p) + b;
  const yLo = yAt(aMin), yHi = yAt(aMax);   // surface y at the two run ends
  let V;
  if (axis === 'z') {
    // x in [c0,c1], z in [aMin,aMax]; top sloped, bottom y=0.
    V = [
      [c0, yAt(aMin), aMin], [c1, yAt(aMin), aMin],  // 0,1 top @ aMin
      [c1, yAt(aMax), aMax], [c0, yAt(aMax), aMax],  // 2,3 top @ aMax
      [c0, 0, aMin], [c1, 0, aMin],                  // 4,5 bottom @ aMin
      [c1, 0, aMax], [c0, 0, aMax],                  // 6,7 bottom @ aMax
    ];
  } else {
    // z in [c0,c1], x in [aMin,aMax].
    V = [
      [aMin, yAt(aMin), c0], [aMin, yAt(aMin), c1],
      [aMax, yAt(aMax), c1], [aMax, yAt(aMax), c0],
      [aMin, 0, c0], [aMin, 0, c1],
      [aMax, 0, c1], [aMax, 0, c0],
    ];
  }
  void yLo; void yHi;
  const F = [
    [0, 1, 2], [0, 2, 3],   // sloped top
    [4, 6, 5], [4, 7, 6],   // flat bottom
    [0, 4, 5], [0, 5, 1],   // end @ aMin
    [3, 2, 6], [3, 6, 7],   // end @ aMax
    [0, 3, 7], [0, 7, 4],   // side c0
    [1, 5, 6], [1, 6, 2],   // side c1
  ];
  triMesh(V, F, mat, true);
}

// --- RAMP -----------------------------------------------------------------
// connectRamp(platform, { side, run, width, fromY=0, thick }) → builds a
// ramp whose high end is coplanar with platform.top at the platform edge
// (seamless). Returns a foot handle so you can chain (e.g. deck→deck).
export function connectRamp(P, { side, run, width, fromY = 0, thick = 0.6 }) {
  const c = solveConnection(P, side, run, width, fromY);
  makeRampSolid(c.axis, c.loPos, c.hiPos, c.loY, c.hiY, c.c0, c.c1, thick, { skirtSolid: true });
  wedgeMesh(c.axis, c.loPos, c.hiPos, c.loY, c.hiY, c.c0, c.c1, MAT.ramp);
  return footHandle(c);
}

// --- STAIRS ---------------------------------------------------------------
// Same collision as connectRamp (one wedge → smooth, no per-step wall, no
// jump, same seamless deck join). Visual = `steps` tread boxes on the
// hypotenuse so it reads as a staircase.
export function connectStairs(P, { side, run, width, fromY = 0, steps = 8, thick = 0.6 }) {
  const c = solveConnection(P, side, run, width, fromY);
  makeRampSolid(c.axis, c.loPos, c.hiPos, c.loY, c.hiY, c.c0, c.c1, thick, { skirtSolid: true });

  const aMin = Math.min(c.loPos, c.hiPos), aMax = Math.max(c.loPos, c.hiPos);
  const runLen = aMax - aMin;
  const m = (c.hiY - c.loY) / (c.hiPos - c.loPos);
  const bb = c.loY - m * c.loPos;
  const yAt = (p) => m * (p < aMin ? aMin : p > aMax ? aMax : p) + bb;
  const tread = runLen / steps;
  const wLo = c.c0, wHi = c.c1, wMid = (c.c0 + c.c1) / 2, wLen = wHi - wLo;
  for (let i = 0; i < steps; i++) {
    const p0 = aMin + i * tread, p1 = p0 + tread;
    // Step top = surface y at the FRONT (uphill) edge of this tread, so the
    // nosing sits on the collision ramp line (you appear to walk the steps).
    const topY = Math.max(yAt(p0), yAt(p1));
    const h = topY;                          // box from y=0 up to the tread
    if (h <= 0) continue;
    let geo, px, pz;
    if (c.axis === 'z') {
      geo = new THREE.BoxGeometry(wLen, h, tread);
      px = wMid; pz = (p0 + p1) / 2;
    } else {
      geo = new THREE.BoxGeometry(tread, h, wLen);
      px = (p0 + p1) / 2; pz = wMid;
    }
    const mesh = new THREE.Mesh(geo, MAT.stair);
    mesh.position.set(px, h / 2, pz);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh); shootables.push(mesh);   // visual only — NOT a solid
  }
  return footHandle(c);
}

// A handle describing the connector's FOOT (low end) so callers can place
// something there or chain another element.
function footHandle(c) {
  const lo = Math.min(c.loPos, c.hiPos), hi = Math.max(c.loPos, c.hiPos);
  if (c.axis === 'z') {
    return { top: c.loY, x0: c.c0, x1: c.c1,
             z0: c.loPos < c.hiPos ? lo : hi - 0,
             z1: c.loPos < c.hiPos ? lo : hi,
             cx: (c.c0 + c.c1) / 2, cz: c.loPos };
  }
  return { top: c.loY, z0: c.c0, z1: c.c1,
           x0: c.loPos, x1: c.loPos,
           cx: c.loPos, cz: (c.c0 + c.c1) / 2 };
}

// --- OVERHANG -------------------------------------------------------------
// The verified sloped thin slab you walk / crouch under (Sessions 17–26).
// Built from makeRampSolid with an explicit THICK; thin slab visual matching
// the underside used by rampOverheadClip.
export function overhang({ axis = 'z', loPos, hiPos, loY, hiY, c0, c1, thick = 0.6 }) {
  makeRampSolid(axis, loPos, hiPos, loY, hiY, c0, c1, thick);
  const m = (hiY - loY) / (hiPos - loPos);
  const b = loY - m * loPos;
  const tA = m * loPos + b, tB = m * hiPos + b;
  let V;
  if (axis === 'z') {
    V = [
      [c0, tA, loPos], [c1, tA, loPos], [c1, tB, hiPos], [c0, tB, hiPos],
      [c0, tA - thick, loPos], [c1, tA - thick, loPos],
      [c1, tB - thick, hiPos], [c0, tB - thick, hiPos],
    ];
  } else {
    V = [
      [loPos, tA, c0], [loPos, tA, c1], [hiPos, tB, c1], [hiPos, tB, c0],
      [loPos, tA - thick, c0], [loPos, tA - thick, c1],
      [hiPos, tB - thick, c1], [hiPos, tB - thick, c0],
    ];
  }
  const F = [
    [0, 1, 2], [0, 2, 3],   // sloped top
    [4, 6, 5], [4, 7, 6],   // sloped underside
    [0, 4, 5], [0, 5, 1],   // low end
    [3, 2, 6], [3, 6, 7],   // high end
    [0, 3, 7], [0, 7, 4],   // side c0
    [1, 5, 6], [1, 6, 2],   // side c1
  ];
  triMesh(V, F, MAT.overhang, true);
}

// Convenience: a rectangular ring of perimeter walls enclosing ±half.
export function perimeter(half, height, thick = 1.0) {
  const t = thick;
  wall({ cx: 0, cz:  half, length: half * 2 + t * 2, height, thick: t, axis: 'x' });
  wall({ cx: 0, cz: -half, length: half * 2 + t * 2, height, thick: t, axis: 'x' });
  wall({ cx:  half, cz: 0, length: half * 2 + t * 2, height, thick: t, axis: 'z' });
  wall({ cx: -half, cz: 0, length: half * 2 + t * 2, height, thick: t, axis: 'z' });
}

// --- PORTAL / TELEPORTER --------------------------------------------------
// Build a glowing portal mesh AND register a teleporter trigger volume.
// `from` is the trigger AABB (the gate the player walks into); `to` is the
// destination position. The visible mesh is an additive-blended box at the
// trigger position, sized to make the portal feel like a doorway you step
// through (not a tile you walk on). The mesh is NOT a collider — bullets
// and vision pass through it.
//
// Schema for a LAYOUT entry:
//   { t: 'teleporter', id, from:{cx,cz,y,sx,sy,sz}, to:{x,z,y,yaw?} }
//
// Internally the portal texture is CLONED per portal so each one animates
// independently (different scroll speeds + phase).
export function portal({ id, from, to }) {
  const tex = makePortalTexture();
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const geo = new THREE.BoxGeometry(from.sx, from.sy, from.sz);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(from.cx, from.y + from.sy / 2, from.cz);
  mesh.renderOrder = 2;
  scene.add(mesh);
  // Trigger AABB in world coords.
  const trigger = {
    x0: from.cx - from.sx / 2, x1: from.cx + from.sx / 2,
    y0: from.y,                y1: from.y + from.sy,
    z0: from.cz - from.sz / 2, z1: from.cz + from.sz / 2,
  };
  registerTeleporter({ id, trigger, to, mesh, texture: tex });
}

// --- JUMP PAD --------------------------------------------------------------
// A flat glowing tile on the ground. Player walks onto it; their vertical
// velocity is forced to launchVy (preserving horizontal speed, so a
// running-jump onto the pad lobs the player into a forward arc). Visual
// is a single horizontal plane lying flat on the floor, alpha-blended
// additive so it reads as a glow patch, never an obstacle.
//
// Schema for a LAYOUT entry:
//   { t: 'jumppad', id, cx, cz, sx, sz, launchVy }
//
// launchVy defaults to 14 → peak height ≈ 4.9 m (v²/2g with GRAVITY=20).
// Trigger AABB is sx × 1.5 m tall (so a sprinting/crouched player still
// fires it) × sz, centered at (cx, 0.75, cz).
export function jumppad({ id, cx, cz, sx = 3, sz = 3, launchVy = 14 }) {
  const tex = makeJumpPadTexture();
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Plane lying flat on the ground (slightly above to avoid z-fight
  // with the floor decals).
  const geo = new THREE.PlaneGeometry(sx, sz);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, 0.04, cz);
  mesh.renderOrder = 1;
  scene.add(mesh);
  // Trigger AABB. Vertical span 0..1.5 catches walking + crouched feet.
  const trigger = {
    x0: cx - sx / 2, x1: cx + sx / 2,
    y0: 0,           y1: 1.5,
    z0: cz - sz / 2, z1: cz + sz / 2,
  };
  registerJumpPad({ id, trigger, launchVy, mesh, texture: tex });
}

// --- GLOWPANE (emissive window panel) -------------------------------------
// A thin flat emissive plane mesh placed in front of a wall's window
// aperture. Suggests "lit interior" — when the player approaches a
// building at night they see a warm rectangle of light through the slit
// rather than black void. Pure decoration; non-collider.
//
// Schema for a LAYOUT entry:
//   { t: 'glowpane', x, y, z, w, h, color?, face? }
// (face: 'north' | 'south' | 'east' | 'west', controls plane rotation)
export function glowpane({ x, y, z, w = 1.0, h = 0.6, color = 0xffb060, face = 'south' }) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x404040,
    emissive: color,
    emissiveIntensity: 1.8,
    roughness: 0.6,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const geo = new THREE.PlaneGeometry(w, h);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y + h / 2, z);
  if (face === 'north')      mesh.rotation.y = Math.PI;
  else if (face === 'east')  mesh.rotation.y = -Math.PI / 2;
  else if (face === 'west')  mesh.rotation.y = Math.PI / 2;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);
  return mesh;
}

// --- BANNER (hanging fabric flourish) -------------------------------------
// A flat fabric mesh hanging vertically from (or against) a structure.
// Pure decoration — non-collider. Default size 1.4 m wide × 3.0 m tall.
// `face` controls which way the banner shows ('north', 'south', 'east',
// 'west'); the geometry is a single PlaneGeometry, double-sided so the
// banner reads from both sides without z-fight. `tone` picks the palette.
export function banner({ x, y, z, face = 'south', tone = 'crimson', w = 1.4, h = 3.0 }) {
  const tex = makeBannerTexture(tone);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.92,
    metalness: 0.05,
    side: THREE.DoubleSide,
    transparent: false,
  });
  const geo = new THREE.PlaneGeometry(w, h);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y + h / 2, z);
  // Face flag rotates the plane around Y so the printed side points the
  // requested direction.
  if (face === 'north')      mesh.rotation.y = Math.PI;
  else if (face === 'east')  mesh.rotation.y = -Math.PI / 2;
  else if (face === 'west')  mesh.rotation.y = Math.PI / 2;
  // (south = 0 default)
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
