// fps-render.mjs — first-person raytraced renders of the map from a curated
// list of camera poses (spawn, building entries, pickup locations). Pure
// Node, no Three.js — projects rays against the same solids the runtime
// uses (built from src/maplayout.js).
//
// S55e: closes the last big visibility gap. Floorplans show the map from
// above, elevations show it from the side, but neither tells me what the
// PLAYER actually sees standing inside it. With these renders I can:
//   * confirm a doorway leads where I think it does
//   * confirm a deck's parapet is at the right height for an approaching
//     player to see/shoot over
//   * confirm an external stair is visually connected to its building
//   * confirm a pickup is visible from its approach path
//
// Output: one binary PPM (Portable Pixmap, P6) per camera pose. The
// companion render-map.sh converts each PPM to PNG via Pillow so the
// agent can Read() them.
//
// Usage:  cd dev && node fps-render.mjs

import { writeFileSync, readdirSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { LAYOUT, SPAWN, PICKUPS, wallBoxes } from '../src/maplayout.js';

const __DIR = dirname(fileURLToPath(import.meta.url));

// --- BUILD SOLIDS (subset of mapviz's solid build) -----------------------
// Each entry: { kind, x0,x1, y0,y1, z0,z1, ramp?:{axis, loPos,hiPos, loY,hiY, m, b} }
// For boxes we store an AABB. For ramps we store the AABB PLUS the sloped
// surface parameters (so the raycaster can intersect against the slope).
const solids = [];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const H = {};

function pushBox(kind, x0, x1, y0, y1, z0, z1, opts) {
  solids.push({ kind, x0, x1, y0, y1, z0, z1, opts: opts || {} });
}
function solveConn(P, side, run, width, fromY) {
  const hiY = P.top, loY = fromY, half = width / 2;
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

for (const e of LAYOUT) {
  if (e.t === 'ground') {
    pushBox('ground', -e.half, e.half, (e.y || 0) - 2, (e.y || 0), -e.half, e.half);
  } else if (e.t === 'perimeter') {
    const t = e.thick == null ? 1.0 : e.thick, h = e.half, hh = e.height;
    for (const [x0, x1, z0, z1] of [
      [-h - t,  h + t,  h,      h + t],
      [-h - t,  h + t, -h - t, -h],
      [ h,      h + t, -h - t,  h + t],
      [-h - t, -h,     -h - t,  h + t],
    ]) pushBox('wall', x0, x1, 0, hh, z0, z1);
  } else if (e.t === 'platform') {
    const thick = e.thick == null ? 0.6 : e.thick;
    const x0 = e.cx - e.sx / 2, x1 = e.cx + e.sx / 2;
    const z0 = e.cz - e.sz / 2, z1 = e.cz + e.sz / 2;
    pushBox('deck', x0, x1, e.top - thick, e.top, z0, z1);
    H[e.id] = { top: e.top, x0, x1, z0, z1, cx: e.cx, cz: e.cz };
  } else if (e.t === 'box') {
    const base = e.base || 0;
    const x0 = e.cx - e.sx / 2, x1 = e.cx + e.sx / 2;
    const z0 = e.cz - e.sz / 2, z1 = e.cz + e.sz / 2;
    pushBox(e.id ? 'namedBox' : 'box', x0, x1, base, base + e.sy, z0, z1);
    if (e.id) H[e.id] = { top: base + e.sy, x0, x1, z0, z1, cx: e.cx, cz: e.cz };
  } else if (e.t === 'wall') {
    for (const r of wallBoxes(e)) pushBox('wall', r.x0, r.x1, r.y0, r.y1, r.z0, r.z1);
  } else if (e.t === 'rampTo' || e.t === 'stairsTo') {
    const P = H[e.to]; if (!P) continue;
    const c = solveConn(P, e.side, e.run, e.width, e.fromY || 0);
    const aMin = Math.min(c.loPos, c.hiPos), aMax = Math.max(c.loPos, c.hiPos);
    const x0 = c.axis === 'z' ? c.c0 : aMin, x1 = c.axis === 'z' ? c.c1 : aMax;
    const z0 = c.axis === 'z' ? aMin : c.c0, z1 = c.axis === 'z' ? aMax : c.c1;
    const m = (c.hiY - c.loY) / (c.hiPos - c.loPos);
    const b = c.loY - m * c.loPos;
    solids.push({
      kind: e.t === 'rampTo' ? 'ramp' : 'stairs',
      x0, x1, y0: 0, y1: Math.max(c.loY, c.hiY) + 0.001, z0, z1,
      ramp: { axis: c.axis, loPos: c.loPos, hiPos: c.hiPos, loY: c.loY, hiY: c.hiY, m, b, c0: c.c0, c1: c.c1 },
    });
  }
}

// --- RAY INTERSECTION ----------------------------------------------------
// AABB-slab method for boxes; for ramps, intersect against both the AABB
// AND the sloped top plane, taking whichever is earlier within the wedge's
// XZ footprint and below the wedge top.

// Reusable scratch (no allocations in the hot loop).
function rayAABB(ox, oy, oz, dx, dy, dz, x0, x1, y0, y1, z0, z1) {
  let tMin = -Infinity, tMax = Infinity, entryAxis = -1, entrySign = 0;
  // X
  if (Math.abs(dx) < 1e-9) {
    if (ox < x0 || ox > x1) return null;
  } else {
    let t1, t2, sign;
    if (dx > 0) { t1 = (x0 - ox) / dx; t2 = (x1 - ox) / dx; sign = -1; }
    else        { t1 = (x1 - ox) / dx; t2 = (x0 - ox) / dx; sign = +1; }
    if (t1 > tMin) { tMin = t1; entryAxis = 0; entrySign = sign; }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  // Y
  if (Math.abs(dy) < 1e-9) {
    if (oy < y0 || oy > y1) return null;
  } else {
    let t1, t2, sign;
    if (dy > 0) { t1 = (y0 - oy) / dy; t2 = (y1 - oy) / dy; sign = -1; }
    else        { t1 = (y1 - oy) / dy; t2 = (y0 - oy) / dy; sign = +1; }
    if (t1 > tMin) { tMin = t1; entryAxis = 1; entrySign = sign; }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  // Z
  if (Math.abs(dz) < 1e-9) {
    if (oz < z0 || oz > z1) return null;
  } else {
    let t1, t2, sign;
    if (dz > 0) { t1 = (z0 - oz) / dz; t2 = (z1 - oz) / dz; sign = -1; }
    else        { t1 = (z1 - oz) / dz; t2 = (z0 - oz) / dz; sign = +1; }
    if (t1 > tMin) { tMin = t1; entryAxis = 2; entrySign = sign; }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  if (tMin < 0.001) return null;
  const nx = entryAxis === 0 ? entrySign : 0;
  const ny = entryAxis === 1 ? entrySign : 0;
  const nz = entryAxis === 2 ? entrySign : 0;
  return { t: tMin, nx, ny, nz };
}

// Intersect ray with a ramp's sloped TOP plane. Returns the t at which the
// ray crosses the plane y = m*p + b (p = x or z), provided the hit lands
// within the wedge's XZ footprint.
function rayRampTop(ox, oy, oz, dx, dy, dz, s) {
  const r = s.ramp;
  // Plane normal: (0, 1, -m) for axis='z' (slope rises with z),
  // or (-m, 1, 0) for axis='x'. Plane equation: N·P = b.
  let nx, nz;
  if (r.axis === 'z') { nx = 0; nz = -r.m; }
  else                { nx = -r.m; nz = 0; }
  const ny = 1;
  const denom = nx * dx + ny * dy + nz * dz;
  if (Math.abs(denom) < 1e-9) return null;
  const t = (r.b - (nx * ox + ny * oy + nz * oz)) / denom;
  if (t < 0.001) return null;
  const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
  if (hx < s.x0 - 0.001 || hx > s.x1 + 0.001) return null;
  if (hz < s.z0 - 0.001 || hz > s.z1 + 0.001) return null;
  // Ensure the hit is at the wedge's sloped surface (not below it).
  // Surface y at the hit's run-axis coord.
  const p = r.axis === 'z' ? hz : hx;
  const surfY = r.m * p + r.b;
  if (Math.abs(hy - surfY) > 0.01) return null;
  // Normal points up + away from the slope rise direction.
  const len = Math.hypot(nx, ny, nz);
  return { t, nx: nx / len, ny: ny / len, nz: nz / len };
}

function nearestHit(ox, oy, oz, dx, dy, dz) {
  let best = null;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    let hit;
    if (s.ramp) {
      // Test sloped top first (the visible top surface of the ramp).
      hit = rayRampTop(ox, oy, oz, dx, dy, dz, s);
      // Then test the AABB (side/end walls of the wedge below the slope).
      const aabbHit = rayAABB(ox, oy, oz, dx, dy, dz, s.x0, s.x1, s.y0, s.y1, s.z0, s.z1);
      if (aabbHit) {
        // Only count the AABB hit if it's BELOW the sloped surface at that
        // point (otherwise the AABB top would obscure the slope).
        const hpY = oy + dy * aabbHit.t;
        const hpP = s.ramp.axis === 'z' ? oz + dz * aabbHit.t : ox + dx * aabbHit.t;
        const surfY = s.ramp.m * hpP + s.ramp.b;
        if (hpY <= surfY + 0.01) {
          if (!hit || aabbHit.t < hit.t) hit = aabbHit;
        }
      }
    } else {
      hit = rayAABB(ox, oy, oz, dx, dy, dz, s.x0, s.x1, s.y0, s.y1, s.z0, s.z1);
    }
    if (hit && (!best || hit.t < best.t)) {
      best = hit;
      best.kind = s.kind;
    }
  }
  return best;
}

// --- COLOR / SHADING ----------------------------------------------------
const KIND_COLOR = {
  ground:   [90, 95, 105],
  deck:     [110, 130, 160],
  ramp:     [110, 165, 130],
  stairs:   [115, 145, 175],
  wall:     [185, 175, 160],     // brick-ish
  box:      [165, 140, 100],     // wood crate
  namedBox: [170, 150, 110],
};
// Sun direction (FROM the sun TO the surface) — points roughly down-east.
const SUN_X = -0.40, SUN_Y = -0.78, SUN_Z = -0.48;
const SUN_LEN = Math.hypot(SUN_X, SUN_Y, SUN_Z);
const SX = SUN_X / SUN_LEN, SY = SUN_Y / SUN_LEN, SZ = SUN_Z / SUN_LEN;
const SKY = [40, 55, 80];
const AMBIENT = 0.32;
const DIFFUSE = 0.68;

function shade(hit, _t) {
  if (!hit) return SKY;
  const base = KIND_COLOR[hit.kind] || [180, 180, 180];
  // Lambert against the sun (sun direction points TO surface, so negate).
  const ndotl = Math.max(0, -(hit.nx * SX + hit.ny * SY + hit.nz * SZ));
  const k = AMBIENT + DIFFUSE * ndotl;
  return [
    Math.min(255, base[0] * k) | 0,
    Math.min(255, base[1] * k) | 0,
    Math.min(255, base[2] * k) | 0,
  ];
}

// --- RENDER --------------------------------------------------------------
const W = 480, Hh = 270;
const FOV_V = Math.PI * 75 / 180;       // matches the game's default FOV
const ASPECT = W / Hh;
const TAN_V = Math.tan(FOV_V / 2);
const TAN_H = TAN_V * ASPECT;

function render(camX, camY, camZ, lookX, lookY, lookZ, name) {
  // Camera basis: forward / right / up.
  let fx = lookX - camX, fy = lookY - camY, fz = lookZ - camZ;
  let fl = Math.hypot(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;
  // World up = (0, 1, 0). right = normalize(cross(forward, up)).
  // forward × (0,1,0) = (fz*1 - fy*0, fx*0 - fz*0, fy*0 - fx*1) wait let me redo
  // f × up where up=(0,1,0): (fy*0 - fz*1, fz*0 - fx*0, fx*1 - fy*0) = (-fz, 0, fx)
  let rx = -fz, ry = 0, rz = fx;
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl; ry /= rl; rz /= rl;
  // up = cross(right, forward)
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  // RGB byte buffer.
  const buf = Buffer.alloc(W * Hh * 3);
  let p = 0;
  for (let y = 0; y < Hh; y++) {
    const sy = (0.5 - (y + 0.5) / Hh) * 2 * TAN_V;   // top → +TAN_V, bottom → -TAN_V
    for (let x = 0; x < W; x++) {
      const sx = ((x + 0.5) / W - 0.5) * 2 * TAN_H;
      let dx = fx + sx * rx + sy * ux;
      let dy = fy + sx * ry + sy * uy;
      let dz = fz + sx * rz + sy * uz;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl; dy /= dl; dz /= dl;
      const hit = nearestHit(camX, camY, camZ, dx, dy, dz);
      const c = shade(hit, hit ? hit.t : 0);
      buf[p++] = c[0]; buf[p++] = c[1]; buf[p++] = c[2];
    }
  }
  // PPM header + body. P6 is RGB binary.
  const header = `P6\n${W} ${Hh}\n255\n`;
  writeFileSync(`${__DIR}/${name}.ppm`, Buffer.concat([Buffer.from(header, 'ascii'), buf]));
}

// --- CAMERA POSES (fps-edge) -------------------------------------------
// All poses derived from imported entity positions. Eye height = 1.6 (player.js).
const EYE = 1.6;
const SPAWN_Y = SPAWN.y == null ? 0 : SPAWN.y;   // spawn deck y (alcove floor)

// SPAWN cardinal views — looking 30 m out in each direction at slight downward tilt.
render(SPAWN.x, SPAWN_Y + EYE, SPAWN.z,  SPAWN.x +  0, SPAWN_Y + EYE - 1, SPAWN.z - 30, 'fps_spawn_N');
render(SPAWN.x, SPAWN_Y + EYE, SPAWN.z,  SPAWN.x + 30, SPAWN_Y + EYE - 1, SPAWN.z +  0, 'fps_spawn_E');
render(SPAWN.x, SPAWN_Y + EYE, SPAWN.z,  SPAWN.x +  0, SPAWN_Y + EYE - 1, SPAWN.z + 30, 'fps_spawn_S');
render(SPAWN.x, SPAWN_Y + EYE, SPAWN.z,  SPAWN.x - 30, SPAWN_Y + EYE - 1, SPAWN.z +  0, 'fps_spawn_W');

// Iconic Edge landmarks (engine coords from import_edge.py output):
//
//   RL pit lift  cx=25.5,  cz=-12.9   bottom y=21.75  top y=40.0
//   small lift   cx=14.5,  cz=-15.4   bottom y=28.4   top y=36.0
//   sniper       (-21.0, 30.9, 22.0)
//   shotgun A    (18.5, 14.1, 28.5)
//   shotgun B    (5.5, -0.9, 18.3)
//   nailgun A    (24.5, 16.1, 18.3)
//   nailgun B    (12.0,  9.0,  5.7)    // SSG-like position
//   SNG          (-1.5, 24.0, -40.5)
//   LG (sniper map) (7.5, 14.0, 11.8)
//
// Look from courtyard floor up at the RL pit lift (one of The Edge's iconic
// vertical sightlines).
render(25.5, 22 + EYE, -8, 25.5, 22 + EYE * 2, -12.9, 'fps_lift_RL_from_below');
// Standing on top of the RL platform looking back at the lift.
render(25.5, 40 + EYE, -8, 25.5, 40 + EYE - 0.4, -12.9, 'fps_lift_RL_at_top');
// Looking at the smaller lift from below.
render(14.5, 28 + EYE, -19, 14.5, 28 + EYE * 1.5, -15.4, 'fps_lift_small_from_below');

// Sightline from the sniper pickup looking down into the courtyard (classic
// Edge sniper perch).
render(-21, 22 + EYE, 30.9, 0, 22 + EYE - 4, 0, 'fps_sniper_perch_overlook');

// Teleporter trigger fps view — looking at the water section.
render(7.8, 14 + EYE, 17.5, 7.8, 14 + EYE - 0.5, 14, 'fps_teleporter_water');

// Overview from a high external vantage so the whole map's relative
// elevations read in one frame.
render(-35, 50, -35, 0, 15, 0, 'fps_overview_NW_high');

console.log(`[wrote ${__DIR}/fps_*.ppm — convert with render-map.sh]`);
