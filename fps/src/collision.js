// collision.js — true 3D solid collision (CS-style), M15 rewrite.
//
// WORLD MODEL
// Everything solid is a convex SOLID defined by a small set of inward-facing
// half-spaces (planes). A point is "inside" the solid iff it is on the
// negative side of every plane. Two solid kinds are built here:
//
//   * BOX   — 6 axis-aligned planes (walls, floor slabs, cover, decks).
//   * RAMP  — a box whose TOP face is a tilted plane (a wedge). The four
//             sides + bottom are axis-aligned; the top is the sloped surface
//             you walk on. This is exactly how a Source/CS brush ramp works.
//
// The player and every enemy are a vertical CAPSULE: a segment from
// (x, feetY, z) up to (x, feetY+height, z) with a radius. Collision response
// is penetration resolution: find the solid face the capsule is least deep
// through and push the capsule out along that face's normal. Walking into a
// ramp's sloped top pushes you UP the slope (so you climb it and never clip
// through it, from any direction); standing on it just supports you (no
// slide, because we resolve against the plane instead of letting gravity
// re-catch you each frame); the vertical sides/underside push you out
// horizontally (no side/under clip-through).
//
// Each solid also carries a plain AABB (minX..maxY) for broad-phase culling
// and for the projectile test.

import { COLLIDE_EPS } from './constants.js';

export const solids = [];      // every collidable convex volume
export const shootables = [];  // meshes the weapon raycaster can hit

// Back-compat shims. Older modules imported these; keep them defined so
// imports don't break. staticAABBs mirrors box AABBs for any leftover use;
// rampLinks is still produced for enemy ramp navigation.
export const staticAABBs = [];
export const rampLinks = [];

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// --- SOLID BUILDERS ---------------------------------------------------------
// A plane is { nx, ny, nz, d } meaning the half-space  n·p + d <= 0  is SOLID
// interior side... we store it so that signedDist = n·p + d, and the point is
// inside the slab for that plane when signedDist <= 0. The capsule must be
// pushed so that for the least-penetrating plane, signedDist becomes +radius.

function makeBoxSolid(minX, maxX, minY, maxY, minZ, maxZ, opts) {
  const planes = [
    { nx:-1, ny:0, nz:0, d: minX },   // x >= minX  -> -x + minX <= 0
    { nx: 1, ny:0, nz:0, d:-maxX },   // x <= maxX
    { nx:0, ny:-1, nz:0, d: minY },   // y >= minY
    { nx:0, ny: 1, nz:0, d:-maxY },   // y <= maxY
    { nx:0, ny:0, nz:-1, d: minZ },   // z >= minZ
    { nx:0, ny:0, nz: 1, d:-maxZ },   // z <= maxZ
  ];
  const s = {
    kind: 'box', planes,
    minX, maxX, minY, maxY, minZ, maxZ,
    walkable: !(opts && opts.noWalk),     // can you stand on its top?
    topY: maxY,
  };
  solids.push(s);
  staticAABBs.push({ minX, maxX, minZ, maxZ, minY, maxY });
  return s;
}

// Ramp wedge. Runs along an axis from (loEnd -> hiEnd) climbing loY -> hiY.
// `axis` = 'z' (run in Z) or 'x'. Cross-axis spans [c0,c1]. The TOP is one
// tilted plane; the other 5 faces are axis-aligned (vertical sides + ends +
// flat bottom at y = minY).
// opts.skirtSolid = true → the wedge BODY-blocks like a box (the filled mass
// below the walk surface is solid), making an elevated ramp/stairs ONE whole
// object you cannot clip through. Default false preserves the verified
// walk-under (overhang) behaviour for any direct/legacy caller.
function makeRampSolid(axis, loPos, hiPos, loY, hiY, c0, c1, thickness, opts) {
  const aMin = Math.min(loPos, hiPos);
  const aMax = Math.max(loPos, hiPos);
  const minY = 0;
  const maxY = Math.max(loY, hiY) + 0.001;
  // Slab thickness (vertical). The walkable top is the sloped surface; the
  // walk-under clearance is governed by an underside = top - THICK. The solid
  // planes below stay a full wedge — that keeps the verified body-push +
  // ground-support behaviour intact. The "open space underneath" is produced
  // by a SEPARATE overhead-clip pass (rampOverheadBlock) plus the ground
  // query ignoring a ramp top that is above the mover. Nothing here changes
  // the 7/7 wedge behaviour; the slab effect is layered on top.
  const THICK = thickness === undefined ? 0.6 : thickness;

  let minX, maxX, minZ, maxZ;
  if (axis === 'z') { minZ=aMin; maxZ=aMax; minX=c0; maxX=c1; }
  else              { minX=aMin; maxX=aMax; minZ=c0; maxZ=c1; }

  // Top sloped plane (walk surface). y = m*<axis> + b ; interior f<=0.
  let m, b, nx, ny, nz;
  if (axis === 'z') {
    m = (hiY - loY) / (hiPos - loPos);
    b = loY - m * loPos;
    nx = 0; ny = 1; nz = -m;
  } else {
    m = (hiY - loY) / (hiPos - loPos);
    b = loY - m * loPos;
    nx = -m; ny = 1; nz = 0;
  }
  const len = Math.hypot(nx, ny, nz);
  nx/=len; ny/=len; nz/=len;
  const topPlane = { nx, ny, nz, d: -b/len };

  const planes = [
    { nx:-1, ny:0, nz:0, d: minX },
    { nx: 1, ny:0, nz:0, d:-maxX },
    { nx:0, ny:-1, nz:0, d: minY },     // flat bottom (wedge)
    { nx:0, ny:0, nz:-1, d: minZ },
    { nx:0, ny:0, nz: 1, d:-maxZ },
    topPlane,                            // sloped top
  ];

  const s = {
    kind:'ramp', planes,
    minX, maxX, minY, maxY, minZ, maxZ,
    axis, loPos, hiPos, loY, hiY, m, b, thick: THICK,
    walkable:true,
    skirtSolid: !!(opts && opts.skirtSolid),
  };
  solids.push(s);
  staticAABBs.push({ minX, maxX, minZ, maxZ, minY, maxY });

  const inset = 1.0;
  const dir = Math.sign(hiPos - loPos) || 1;
  if (axis === 'z') {
    rampLinks.push({
      lowX:(c0+c1)/2, lowZ:loPos + dir*inset, lowY:loY,
      highX:(c0+c1)/2, highZ:hiPos - dir*inset, highY:hiY,
    });
  } else {
    rampLinks.push({
      lowX:loPos + dir*inset, lowZ:(c0+c1)/2, lowY:loY,
      highX:hiPos - dir*inset, highZ:(c0+c1)/2, highY:hiY,
    });
  }
  return s;
}

export { makeBoxSolid, makeRampSolid };

// Height of a ramp's top surface at (x,z) (clamped to its run).
function rampSurfaceY(s, x, z) {
  let p = s.axis === 'z' ? z : x;
  const lo = Math.min(s.loPos, s.hiPos), hi = Math.max(s.loPos, s.hiPos);
  if (p < lo) p = lo; else if (p > hi) p = hi;
  return s.m * p + s.b;
}

// --- CAPSULE COLLISION ------------------------------------------------------
// Resolve a capsule (centre x,z; feetY; radius r; height h) out of every
// solid. Returns { x, z, feetY, grounded, groundNormalY }.
//
// For each solid we treat the capsule as: vertical segment of points at the
// capsule axis, "inflated" by r horizontally. We compute, per plane, the
// signed distance of the *closest capsule point* to that plane; the capsule
// intersects the solid iff it is inside (>=) all planes. We then push out
// along the plane of minimum penetration. Iterated a few times so resolving
// against one solid doesn't shove you into another.

const ITERATIONS = 4;

// Resolve the capsule BODY against a solid, pushing HORIZONTALLY only.
// Vertical support is the separate groundHeightAt query (Source-style split):
// the walk surface must not push the body or it would feel like a slide.
const GROUND_SKIN = 0.12;

function resolveBodyHoriz(P, r, h, s, ctx) {
  if (P.x < s.minX - r || P.x > s.maxX + r ||
      P.z < s.minZ - r || P.z > s.maxZ + r) return;

  const yLo = P.feetY + GROUND_SKIN;
  const yHi = P.feetY + h;
  if (yLo > s.maxY + 0.001 || yHi < s.minY - 0.001) return;

  // S55ad: stair→deck smooth transition. If we're currently on a ramp whose
  // hi end matches this walkable box's top, skip horizontal push so we can
  // walk straight onto the deck instead of being pinned by the deck's
  // vertical face at the last 12 cm of climb. Restricted to the ramp case
  // (ctx.rampHiY only set when collideCapsule found a ramp under the feet)
  // so cover-box mechanics in open ground are untouched.
  if (ctx && ctx.rampHiY !== -Infinity &&
      s.kind === 'box' && s.walkable &&
      Math.abs(s.maxY - ctx.rampHiY) < 0.05) {
    return;
  }

  // RAMP body-push.
  //   * Non-skirtSolid ramps (overhang / walk-under pieces): body-push stays
  //     DISABLED — solidity is expressed by groundHeightAt (stand on it) +
  //     rampOverheadClip (walk under it). Unchanged, verified behaviour.
  //   * skirtSolid ramps (kit connectors: elevated ramp/stairs): the FILLED
  //     mass below the walk surface is a real obstacle, so the wedge is ONE
  //     whole solid you cannot clip through. We push out of the shallowest
  //     VERTICAL side/end plane, but ONLY when the capsule is genuinely
  //     inside the skirt (below the walk surface here by more than the
  //     ground skin). Standing on / walking up the slope keeps feet at the
  //     surface, so it is never "inside" → never pushed (no slide, and no
  //     block at the foot where you step on).
  if (s.kind === 'ramp') {
    if (!s.skirtSolid) return;
    const surfY = rampSurfaceY(s, P.x, P.z);
    if (P.feetY + GROUND_SKIN >= surfY - 0.001) return;   // on/above the slope
    let sh = -Infinity, vp = null;
    for (let i = 0; i < s.planes.length; i++) {
      const pl = s.planes[i];
      const hm = Math.hypot(pl.nx, pl.nz);
      if (hm < 0.30) continue;            // skip sloped top + flat bottom
      const sd = pl.nx * P.x + pl.nz * P.z + pl.d - r * hm;
      if (sd > 0) return;                 // outside a vertical face → no overlap
      if (sd > sh) { sh = sd; vp = pl; }
    }
    if (!vp) return;
    const pushR = (-sh) + COLLIDE_EPS;
    P.x += vp.nx * pushR;
    P.z += vp.nz * pushR;
    return;
  }

  let shallow = -Infinity;
  let bp = null;
  for (let i = 0; i < s.planes.length; i++) {
    const pl = s.planes[i];
    const hmag = Math.hypot(pl.nx, pl.nz);
    const py = pl.ny > 0 ? yLo : yHi;
    const minSD = pl.nx * P.x + pl.ny * py + pl.nz * P.z + pl.d - r * hmag;
    if (minSD > 0) return;                 // separated → no overlap
    if (minSD > shallow) { shallow = minSD; bp = pl; }
  }
  if (!bp) return;

  // Jumping UP into a raised floor / overhead box from below: the shallowest
  // separating plane is the box's UNDERSIDE (ny < 0) and the feet are below
  // it. This is a vertical head-bonk, owned by the ceiling clip in
  // player.js — the body must NOT be pushed horizontally here, or the player
  // gets flung sideways out from under the structure. Just stop; you simply
  // can't rise past it. (A normal ground box has minY≈0 so feetY < minY is
  // false → unaffected. Walking into a raised floor's SIDE picks a wall
  // plane, not the underside → unaffected.)
  if (bp.ny < -0.5 && P.feetY < s.minY - 0.001) return;

  // If the shallowest plane is a near-horizontal top, switch to the
  // shallowest plane that has a horizontal normal (a wall / ramp side) so we
  // don't shove the body along a walkable top (the "slide").
  let usePlane = bp;
  if (Math.hypot(bp.nx, bp.nz) < 0.30) {
    let sh2 = -Infinity, bp2 = null;
    for (let i = 0; i < s.planes.length; i++) {
      const pl = s.planes[i];
      const hm = Math.hypot(pl.nx, pl.nz);
      if (hm < 0.30) continue;
      const py = pl.ny > 0 ? yLo : yHi;
      const sd = pl.nx*P.x + pl.ny*py + pl.nz*P.z + pl.d - r*hm;
      if (sd > sh2) { sh2 = sd; bp2 = pl; }
    }
    if (!bp2 || sh2 > 0) return;           // genuinely just on top
    usePlane = bp2; shallow = sh2;
  }

  const nx = usePlane.nx, nz = usePlane.nz;
  const hlen = Math.hypot(nx, nz);
  if (hlen < 1e-6) return;
  const push = (-shallow) + COLLIDE_EPS;
  P.x += nx * push;
  P.z += nz * push;
}

// Dedicated OVERHEAD-CLIP pass for the ramp underside (the "walk under it"
// feature), kept fully separate from body-push and ground-support so it
// can't destabilise them.
//
// Model: the slab occupies, along its run axis p∈[runMin,runMax] and cross
// axis c∈[cMin,cMax], the vertical band [underY(p), topY(p)] where
// topY(p)=m*p+b and underY(p)=topY(p)-thick. If the mover's capsule
// (feetY..feetY+bodyH) vertically overlaps that band AND the mover is inside
// the XZ footprint, the slab is a solid obstacle there: push the capsule out
// to the nearest footprint exit. There are up to three candidate exits:
//   * run-axis "slope boundary" pB where head height exactly meets underY
//     (lets you go further under as the slab rises, deeper when crouched);
//   * the two cross-axis slab edges (cMin, cMax) — these give the
//     "blocked from the side until the slab clears your head" behaviour.
// We choose whichever exit is the smallest displacement (shallowest), so
// approaching from the side pushes you back out the side, and approaching
// head-on pushes you back along the run axis. Crouch shrinks bodyH so the
// vertical-overlap test frees up sooner — no crouch special-casing.
function rampOverheadClip(P, r, bodyH) {
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (s.kind !== 'ramp') continue;
    if (s.skirtSolid) continue;   // solid climb — handled by body-push, not walk-under

    const runMin = Math.min(s.loPos, s.hiPos);
    const runMax = Math.max(s.loPos, s.hiPos);
    // Cross-axis (width) extent of the slab.
    const cMin = (s.axis === 'z') ? s.minX : s.minZ;
    const cMax = (s.axis === 'z') ? s.maxX : s.maxZ;

    const pPos = (s.axis === 'z') ? P.z : P.x;   // along run
    const cPos = (s.axis === 'z') ? P.x : P.z;   // along width

    // Broad reject: outside the footprint (expanded by radius) → not blocked.
    if (pPos < runMin - r || pPos > runMax + r) continue;
    if (cPos < cMin - r || cPos > cMax + r) continue;

    // Slab vertical band at the capsule's (clamped) run position.
    const pc = pPos < runMin ? runMin : (pPos > runMax ? runMax : pPos);
    const topY = s.m * pc + s.b;
    const underY = topY - s.thick;

    const feetY = P.feetY;
    const headY = feetY + bodyH;

    // Does the capsule vertically intersect the slab band? If the whole
    // capsule is below underY (walking under, head clears) or above topY
    // (on top / above), the slab is not blocking — skip.
    if (headY <= underY + 0.001) continue;     // fully under, clears: allowed
    if (feetY >= topY - 0.001) continue;       // on top / above: ground-support's job

    // The capsule is intruding into the slab volume. Compute the candidate
    // exits and pick the smallest move.
    //
    // (1) Run-axis slope boundary: the p where head height == underY(p):
    //       headY = m*pB + b - thick  →  pB = (headY - b + thick)/m
    //     Past pB toward the thinner side the slab is below the head (solid);
    //     toward the thicker side it clears. Only meaningful if |m| not ~0.
    let bestMove = Infinity;
    let apply = null;

    if (Math.abs(s.m) > 1e-6) {
      const pB = (headY - s.b + s.thick) / s.m;
      // Clearance side: where underY(p) >= headY. d(underY)/dp = m.
      // If m>0, higher p → higher underY → clearance is p >= pB.
      // If m<0, clearance is p <= pB.
      let target = null;
      if (s.m > 0) { if (pc < pB) target = pB; }
      else         { if (pc > pB) target = pB; }
      if (target !== null) {
        const move = Math.abs(target - pPos);
        if (move < bestMove) {
          bestMove = move;
          const tv = target;
          apply = () => { if (s.axis === 'z') P.z = tv; else P.x = tv; };
        }
      }
    }

    // (2)/(3) Cross-axis edges: push out the nearer side of the slab width.
    const exitLo = cMin - r;          // just outside the low edge
    const exitHi = cMax + r;          // just outside the high edge
    const moveLo = Math.abs(cPos - exitLo);
    const moveHi = Math.abs(cPos - exitHi);
    if (moveLo < bestMove) {
      bestMove = moveLo;
      apply = () => { if (s.axis === 'z') P.x = exitLo; else P.z = exitLo; };
    }
    if (moveHi < bestMove) {
      bestMove = moveHi;
      apply = () => { if (s.axis === 'z') P.x = exitHi; else P.z = exitHi; };
    }

    if (apply) apply();
  }
}

export function collideCapsule(x, feetY, z, r, h) {
  const P = { x, feetY, z };
  // S55ad: if the feet are currently on (or very close to the top of) a
  // RAMP, remember that ramp's hiY. resolveBodyHoriz uses this to let a
  // walkable box whose top matches the ramp's hiY skip its horizontal
  // push, smoothing the stair→deck transition.
  let rampHiY = -Infinity;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (s.kind !== 'ramp') continue;
    if (x < s.minX - r || x > s.maxX + r ||
        z < s.minZ - r || z > s.maxZ + r) continue;
    const surf = rampSurfaceY(s, x, z);
    if (Math.abs(surf - feetY) < 0.20 && s.hiY > rampHiY) rampHiY = s.hiY;
  }
  const ctx = { rampHiY };
  for (let it = 0; it < ITERATIONS; it++) {
    for (let i = 0; i < solids.length; i++) resolveBodyHoriz(P, r, h, solids[i], ctx);
  }
  // Overhead clip is a separate, final pass (does not feed back into the
  // body-push iterations, so it can't destabilise them).
  rampOverheadClip(P, r, h);
  return { x: P.x, feetY: P.feetY, z: P.z };
}

// Highest walkable surface height at (x,z) that is at-or-below `maxY`
// (feetY + step-up). Drives vertical support: the player/enemy is placed ON
// this surface when grounded, so there is never any slide and ramps/stairs/
// flat floor all behave identically. Uses the capsule radius so you can
// stand near an edge (sample the four offsets + centre, take the highest
// that still supports — conservative = highest so you don't sink at edges).
export function groundHeightAt(x, z, maxY, r) {
  const rr = r === undefined ? 0 : r * 0.7;
  const xs = [x, x + rr, x - rr, x, x];
  const zs = [z, z, z, z + rr, z - rr];
  let best = -Infinity;
  for (let k = 0; k < xs.length; k++) {
    const px = xs[k], pz = zs[k];
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!s.walkable) continue;
      if (px < s.minX || px > s.maxX || pz < s.minZ || pz > s.maxZ) continue;
      const top = (s.kind === 'ramp') ? rampSurfaceY(s, px, pz) : s.maxY;
      if (top <= maxY + 0.05 && top > best) best = top;
    }
  }
  return best === -Infinity ? null : best;
}

// Lowest solid surface strictly above `headY` at (x,z) — caps a rising jump
// so you can't pop up through a deck or ramp. Returns null if open above.
// For a box the relevant blocker is its BOTTOM (minY) if you're under it, or
// its top if you're inside; we use the simplest robust rule: the lowest
// solid face above headY among solids whose XZ footprint contains (x,z).
export function ceilingHeightAt(x, z, headY, r) {
  const rr = r === undefined ? 0 : r * 0.6;
  let best = Infinity;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (x < s.minX - rr || x > s.maxX + rr ||
        z < s.minZ - rr || z > s.maxZ + rr) continue;
    let c = Infinity;
    if (s.kind === 'ramp') {
      const ry = rampSurfaceY(s, x, z);
      if (ry > headY + 0.05) c = ry;
    } else {
      // Box. Its UNDERSIDE caps a rising head as long as it is at/above the
      // head (use a tiny epsilon, NOT a generous margin, so the underside
      // keeps capping right up until the head physically meets it — this is
      // what stops a jump under a raised floor instead of letting the head
      // slip past). Only if the head is already embedded (above the
      // underside, below the top) does the top become the cap.
      if (s.minY >= headY - 0.001) c = s.minY;
      else if (s.maxY > headY)     c = s.maxY;
    }
    if (c < best) best = c;
  }
  return best === Infinity ? null : best;
}

// True if a capsule of height `h` standing at (x, feetY, z) has clear
// headroom — i.e. it is NOT intruded by any ramp slab underside or by a box
// underside overhead. Pure yes/no (never moves anything). Used to decide
// whether the player may stand up from a crouch: if a standing capsule would
// be ejected by rampOverheadClip / a low ceiling here, standing is refused.
// Mirrors the vertical-overlap logic in rampOverheadClip plus a box-underside
// check, so "can I stand" agrees exactly with "would standing be pushed".
export function headroomClear(x, feetY, z, r, h) {
  const headY = feetY + h;

  // Ramp slabs: identical vertical-overlap test to rampOverheadClip.
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (s.kind !== 'ramp') continue;
    if (s.skirtSolid) continue;   // solid climb — no walk-under headroom concept

    const runMin = Math.min(s.loPos, s.hiPos);
    const runMax = Math.max(s.loPos, s.hiPos);
    const cMin = (s.axis === 'z') ? s.minX : s.minZ;
    const cMax = (s.axis === 'z') ? s.maxX : s.maxZ;

    const pPos = (s.axis === 'z') ? z : x;
    const cPos = (s.axis === 'z') ? x : z;

    if (pPos < runMin - r || pPos > runMax + r) continue;
    if (cPos < cMin - r || cPos > cMax + r) continue;

    const pc = pPos < runMin ? runMin : (pPos > runMax ? runMax : pPos);
    const topY = s.m * pc + s.b;
    const underY = topY - s.thick;

    if (headY <= underY + 0.001) continue;   // fully under, clears
    if (feetY >= topY - 0.001) continue;      // on top / above the slab
    return false;                             // would intrude the slab
  }

  // Box undersides (decks / overhead boxes): a box whose BOTTOM sits above
  // the feet but below the head, with our XZ inside its footprint (+r), is a
  // low ceiling. A box we stand ON has minY below the feet, so it is excluded
  // by the `s.minY > feetY` term and never falsely blocks standing.
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (s.kind !== 'box') continue;
    if (x < s.minX - r || x > s.maxX + r ||
        z < s.minZ - r || z > s.maxZ + r) continue;
    if (s.minY > feetY + 0.001 && s.minY < headY - 0.001) return false;
  }

  return true;
}

export function lineOfSight(x0,y0,z0, x1,y1,z1) {
  const dx=x1-x0, dy=y1-y0, dz=z1-z0;
  for (let i=0;i<solids.length;i++){
    const s=solids[i];
    let t0=0, t1=1, ok=true;
    for (let k=0;k<s.planes.length;k++){
      const pl=s.planes[k];
      const denom = pl.nx*dx + pl.ny*dy + pl.nz*dz;
      const dist0 = pl.nx*x0 + pl.ny*y0 + pl.nz*z0 + pl.d;
      if (Math.abs(denom) < 1e-9){
        if (dist0 > 0){ ok=false; break; }      // parallel & outside this slab
        continue;
      }
      const t = -dist0/denom;
      if (denom < 0){ if (t > t0) t0 = t; }     // entering
      else          { if (t < t1) t1 = t; }     // leaving
      if (t0 > t1){ ok=false; break; }
    }
    if (ok && t0 <= t1 && t1 >= 0 && t0 <= 1) return false; // segment hits solid
  }
  return true;
}

// Projectile point test (radius pad). Inside any solid → blocked.
export function pointBlockedBySurface(x, y, z, pad) {
  for (let i=0;i<solids.length;i++){
    const s=solids[i];
    if (x < s.minX-pad || x > s.maxX+pad ||
        y < s.minY-pad || y > s.maxY+pad ||
        z < s.minZ-pad || z > s.maxZ+pad) continue;
    let inside=true;
    for (let k=0;k<s.planes.length;k++){
      const pl=s.planes[k];
      if (pl.nx*x + pl.ny*y + pl.nz*z + pl.d > pad){ inside=false; break; }
    }
    if (inside) return true;
  }
  return false;
}
