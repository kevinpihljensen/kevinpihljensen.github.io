// mapviz.mjs — offline map analysis + renderer for the data-driven layout.
//
// Consumes the SAME src/maplayout.js the game does, mirrors the kit's solid
// construction (solveConnection/platform/box/wall/ground verbatim), builds
// REAL collision.js solids for seam checks, then emits:
//   * one floorplan SVG per elevation band (+ a combined stack)
//   * an oblique (axonometric) SVG of all solids
//   * a text report: footprint overlaps w/ vertical clearance, connector
//     seam verdicts (real groundHeightAt continuity), and a reachability
//     BFS from spawn over connectors + step/jump/duck-jump height deltas.
//
// This is the feedback loop a human level designer has and the model
// otherwise lacks: SEE the multi-level layout and get told what's broken.

import { writeFileSync, readdirSync, unlinkSync } from 'fs';
import { LAYOUT, SPAWN, PICKUPS, DOORWAYS, wallBoxes } from '../src/maplayout.js';
import { lineOfSight } from '../src/collision.js';
import { makeBoxSolid, makeRampSolid, groundHeightAt }
  from '../src/collision.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const STEP_UP = 0.55, JUMP_MOUNT = 0.95, DUCK_MOUNT = 1.30, STAND = 1.7;

// ---- kit math mirror (verbatim from kit.js solveConnection/footHandle) ----
function solveConnection(P, side, run, width, fromY) {
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
function footHandle(c) {
  if (c.axis === 'z') {
    return { top: c.loY, x0: c.c0, x1: c.c1, z0: c.loPos, z1: c.loPos,
             cx: (c.c0 + c.c1) / 2, cz: c.loPos };
  }
  return { top: c.loY, z0: c.c0, z1: c.c1, x0: c.loPos, x1: c.loPos,
           cx: c.loPos, cz: (c.c0 + c.c1) / 2 };
}

// ---- build: solids (for collision seam checks) + pieces (for analysis) ----
const H = {};            // id -> handle
const pieces = [];       // { kind,id, x0,x1,z0,z1, yMin,yMax, top, conn? }
function rect(o) { pieces.push(o); }

for (const e of LAYOUT) {
  if (e.t === 'ground') {
    const half = e.half, top = e.y || 0;
    makeBoxSolid(-half, half, top - 2, top, -half, half);
    rect({ kind: 'ground', id: 'GROUND', x0: -half, x1: half, z0: -half, z1: half,
           yMin: top - 2, yMax: top, top });
  } else if (e.t === 'perimeter') {
    const t = e.thick == null ? 1.0 : e.thick, h = e.half, H2 = e.height;
    const segs = [
      [-h - t, h + t, h, h + t], [-h - t, h + t, -h - t, -h],
      [h, h + t, -h - t, h + t], [-h - t, -h, -h - t, h + t],
    ];
    for (const [x0, x1, z0, z1] of segs) {
      makeBoxSolid(x0, x1, 0, H2, z0, z1, { noWalk: true });
      rect({ kind: 'wall', id: '', x0, x1, z0, z1, yMin: 0, yMax: H2, top: H2 });
    }
  } else if (e.t === 'platform') {
    const thick = e.thick == null ? 0.6 : e.thick;
    const x0 = e.cx - e.sx / 2, x1 = e.cx + e.sx / 2;
    const z0 = e.cz - e.sz / 2, z1 = e.cz + e.sz / 2;
    makeBoxSolid(x0, x1, e.top - thick, e.top, z0, z1);
    const hnd = { top: e.top, x0, x1, z0, z1, cx: e.cx, cz: e.cz };
    if (e.id) H[e.id] = hnd;
    rect({ kind: 'platform', id: e.id || '', x0, x1, z0, z1,
           yMin: e.top - thick, yMax: e.top, top: e.top });
  } else if (e.t === 'box') {
    const base = e.base || 0;
    const x0 = e.cx - e.sx / 2, x1 = e.cx + e.sx / 2;
    const z0 = e.cz - e.sz / 2, z1 = e.cz + e.sz / 2;
    makeBoxSolid(x0, x1, base, base + e.sy, z0, z1);
    const hnd = { top: base + e.sy, x0, x1, z0, z1, cx: e.cx, cz: e.cz };
    if (e.id) H[e.id] = hnd;
    rect({ kind: 'box', id: e.id || '', x0, x1, z0, z1,
           yMin: base, yMax: base + e.sy, top: base + e.sy });
  } else if (e.t === 'wall') {
    for (const r of wallBoxes(e)) {
      makeBoxSolid(r.x0, r.x1, r.y0, r.y1, r.z0, r.z1, { noWalk: true });
      rect({ kind: 'wall', id: '', x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1,
             yMin: r.y0, yMax: r.y1, top: e.door || e.window ? -1 : r.y1 });
    }
  } else if (e.t === 'rampTo' || e.t === 'stairsTo') {
    const P = H[e.to];
    if (!P) { console.warn('mapviz: connector target not found:', e.to); continue; }
    const c = solveConnection(P, e.side, e.run, e.width, e.fromY || 0);
    makeRampSolid(c.axis, c.loPos, c.hiPos, c.loY, c.hiY, c.c0, c.c1,
                  e.thick == null ? 0.6 : e.thick, { skirtSolid: true });
    const aMin = Math.min(c.loPos, c.hiPos), aMax = Math.max(c.loPos, c.hiPos);
    const x0 = c.axis === 'z' ? c.c0 : aMin, x1 = c.axis === 'z' ? c.c1 : aMax;
    const z0 = c.axis === 'z' ? aMin : c.c0, z1 = c.axis === 'z' ? aMax : c.c1;
    rect({ kind: e.t === 'rampTo' ? 'ramp' : 'stairs', id: '', x0, x1, z0, z1,
           yMin: 0, yMax: Math.max(c.loY, c.hiY), top: Math.max(c.loY, c.hiY),
           conn: { to: e.to, side: e.side, loY: c.loY, hiY: c.hiY,
                   axis: c.axis, loPos: c.loPos, hiPos: c.hiPos, c0: c.c0, c1: c.c1 } });
    if (e.id) H[e.id] = footHandle(c);
  } else if (e.t === 'overhang') {
    makeRampSolid(e.axis, e.loPos, e.hiPos, e.loY, e.hiY, e.c0, e.c1,
                  e.thick == null ? 0.6 : e.thick);
    const aMin = Math.min(e.loPos, e.hiPos), aMax = Math.max(e.loPos, e.hiPos);
    const x0 = e.axis === 'z' ? e.c0 : aMin, x1 = e.axis === 'z' ? e.c1 : aMax;
    const z0 = e.axis === 'z' ? aMin : e.c0, z1 = e.axis === 'z' ? aMax : e.c1;
    rect({ kind: 'overhang', id: '', x0, x1, z0, z1,
           yMin: Math.min(e.loY, e.hiY) - 0.6, yMax: Math.max(e.loY, e.hiY), top: -1,
           oh: { axis: e.axis, loPos: e.loPos, hiPos: e.hiPos, loY: e.loY, hiY: e.hiY,
                 thick: e.thick == null ? 0.6 : e.thick } });
  }
}

// ---- analysis ----
const log = [];
const P = (s) => log.push(s);
const f = (n) => Number(n).toFixed(2);
function xzOverlap(a, b) {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return ox > 0.01 && oz > 0.01;
}

P('================ THE CITADEL — MAP ANALYSIS ================\n');

// 1) Footprint overlap + vertical clearance.
P('--- overlap / clearance (structure pairs sharing XZ) ---');
const struct = pieces.filter(p => p.kind === 'platform' || p.kind === 'box' || p.kind === 'ramp' || p.kind === 'stairs' || p.kind === 'overhang');
let issues = 0;
for (let i = 0; i < struct.length; i++) for (let j = i + 1; j < struct.length; j++) {
  const a = struct[i], b = struct[j];
  if (!xzOverlap(a, b)) continue;
  const tag = `${a.kind}${a.id ? '(' + a.id + ')' : ''} × ${b.kind}${b.id ? '(' + b.id + ')' : ''}`;
  // overhang is a slab you pass UNDER: overlap is fine only if whatever it
  // overlaps stays below its underside; intersecting a deck/box is BAD.
  if (a.kind === 'overhang' || b.kind === 'overhang') {
    const oh = a.kind === 'overhang' ? a : b, ot = a.kind === 'overhang' ? b : a;
    const o = oh.oh, m = (o.hiY - o.loY) / (o.hiPos - o.loPos), bI = o.loY - m * o.loPos;
    const aMin = Math.min(o.loPos, o.hiPos), aMax = Math.max(o.loPos, o.hiPos);
    // overlap interval along the slope axis, clamped to the slab run
    const olo = o.axis === 'x' ? Math.max(ot.x0, aMin) : Math.max(ot.z0, aMin);
    const ohi = o.axis === 'x' ? Math.min(ot.x1, aMax) : Math.min(ot.z1, aMax);
    // slab UNDERSIDE = surface(p) - thick; minimum across [olo,ohi] is at
    // whichever end the surface is lower (linear), so check both ends
    const surf = (p) => m * (p < aMin ? aMin : p > aMax ? aMax : p) + bI;
    const undersideMin = Math.min(surf(olo), surf(ohi)) - o.thick;
    const clearUnder = undersideMin - ot.yMax;
    if (clearUnder >= -0.05) P(`  OK    ${tag}: ${f(Math.max(0, clearUnder))}m under the slab here (pass-under)`);
    else { P(`  BAD   ${tag}: slab underside dips ${f(-clearUnder)}m into it — move the overhang`); issues++; }
    continue;
  }
  const lo = a.yMax <= b.yMax ? a : b, hi = lo === a ? b : a;
  const gap = hi.yMin - lo.yMax;
  if (gap >= STAND + 0.05) {
    P(`  OK    ${tag}: ${f(gap)}m clear under upper → walk-under passage`);
  } else if (gap > 0.05) {
    P(`  WARN  ${tag}: ${f(gap)}m gap — too low to walk under, too high to step (dead space)`);
    issues++;
  } else if (gap > -0.05) {
    P(`  OK    ${tag}: flush stack (cover/parapet on a deck)`);
  } else {
    // ranges intersect — fine if it's a connector meeting its platform.
    const connPair = (a.kind === 'ramp' || a.kind === 'stairs' || b.kind === 'ramp' || b.kind === 'stairs');
    if (connPair) P(`  OK    ${tag}: connector meets deck (expected seam overlap)`);
    else { P(`  BAD   ${tag}: geometry intersects (${f(-gap)}m) — fix`); issues++; }
  }
}
if (struct.length && !log[log.length - 1].includes('---')) {} 
P('');

// 2) Connector seam continuity via REAL groundHeightAt.
P('--- connector seams (real groundHeightAt continuity) ---');
const BIG = 1e6, R = 0.4;
let seamFail = 0;
for (const p of pieces) {
  if (!p.conn) continue;
  const c = p.conn, slope = Math.abs((c.hiY - c.loY) / (c.hiPos - c.loPos));
  const aMin = Math.min(c.loPos, c.hiPos), aMax = Math.max(c.loPos, c.hiPos);
  // sample along the run axis, across the full connector + a little onto deck
  let prev = null, maxJump = 0, nul = false, above = -Infinity;
  const cFix = (c.c0 + c.c1) / 2;
  for (let s = aMin - 0.5; s <= aMax + 1.5; s += 0.1) {
    const x = c.axis === 'z' ? cFix : s;
    const z = c.axis === 'z' ? s : cFix;
    const h = groundHeightAt(x, z, BIG, R);
    if (h === null) { nul = true; continue; }
    if (prev !== null) maxJump = Math.max(maxJump, Math.abs(h - prev));
    above = Math.max(above, h - Math.max(c.loY, c.hiY));
    prev = h;
  }
  const ok = !nul && maxJump <= slope * 0.1 + 0.02 && above <= 0.02;
  if (!ok) seamFail++;
  P(`  ${ok ? 'OK  ' : 'FAIL'} ${p.kind} → ${c.to}  (${f(c.loY)}→${f(c.hiY)})  ` +
    `maxStep=${f(maxJump)} (limit ${f(slope * 0.1)})  null=${nul}  bump=${f(Math.max(0, above))}`);
}
P('');

// 3) Reachability BFS from spawn.
P('--- reachability from spawn (0,0) ---');
// surfaces: ground + each platform/box top. connectors are edges.
// S55: pull the ground extent from the LAYOUT instead of hardcoding ±40 so
// the analyzer scales with the arena size.
const _gnd = LAYOUT.find((e) => e.t === 'ground');
const GH = _gnd ? _gnd.half : 40;
const surfaces = [];
surfaces.push({ name: 'GROUND', x0: -GH, x1: GH, z0: -GH, z1: GH, y: 0 });
for (const p of pieces) {
  if (p.kind === 'platform' || p.kind === 'box') {
    surfaces.push({ name: (p.id || p.kind) + '@' + f(p.top), x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1, y: p.top });
  }
}
function near(a, b) { // footprints overlap or touch (within 0.6m) in XZ
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return ox > -0.6 && oz > -0.6;
}
const N = surfaces.length;
const adj = Array.from({ length: N }, () => []);
// connector edges: foot surface (at loY over foot fp) ↔ target platform surface
for (const p of pieces) {
  if (!p.conn) continue;
  const c = p.conn;
  const footFp = c.axis === 'z'
    ? { x0: c.c0, x1: c.c1, z0: Math.min(c.loPos, c.hiPos), z1: Math.min(c.loPos, c.hiPos) + 0.5 }
    : { x0: Math.min(c.loPos, c.hiPos), x1: Math.min(c.loPos, c.hiPos) + 0.5, z0: c.c0, z1: c.c1 };
  // surface at the foot: the highest surface whose fp contains the foot and y≈loY
  let lo = -1, hi = -1;
  for (let i = 0; i < N; i++) {
    const s = surfaces[i];
    if (Math.abs(s.y - c.loY) < 0.2 && near(s, footFp)) { if (lo < 0 || surfaces[i].y > surfaces[lo].y) lo = i; }
    if (Math.abs(s.y - c.hiY) < 0.2 && s.name.startsWith(c.to)) hi = i;
  }
  if (lo >= 0 && hi >= 0) { adj[lo].push({ to: hi, via: 'connector' }); adj[hi].push({ to: lo, via: 'connector' }); }
}
// teleporter edges (S55i): each `teleporter` LAYOUT entry links the
// surface CONTAINING its trigger AABB (at the trigger's foot Y) to the
// surface at its destination position. Treated as a one-way edge in the
// REACHABILITY BFS (target reachable from source) but added in both
// directions so the route graph also acknowledges the link for loop
// counting — the player can in principle walk back via the rest of the
// map even if not via this portal.
for (const e of LAYOUT) {
  if (e.t !== 'teleporter') continue;
  const f = e.from, t = e.to;
  let src = -1, dst = -1;
  for (let i = 0; i < N; i++) {
    const s = surfaces[i];
    if (Math.abs(s.y - f.y) < 0.4 &&
        f.cx >= s.x0 - 0.01 && f.cx <= s.x1 + 0.01 &&
        f.cz >= s.z0 - 0.01 && f.cz <= s.z1 + 0.01) {
      if (src < 0 || surfaces[i].y > surfaces[src].y) src = i;
    }
    if (Math.abs(s.y - t.y) < 0.4 &&
        t.x >= s.x0 - 0.01 && t.x <= s.x1 + 0.01 &&
        t.z >= s.z0 - 0.01 && t.z <= s.z1 + 0.01) {
      if (dst < 0 || surfaces[i].y > surfaces[dst].y) dst = i;
    }
  }
  if (src >= 0 && dst >= 0) {
    adj[src].push({ to: dst, via: 'teleport' });
    adj[dst].push({ to: src, via: 'teleport' });
  }
}
// proximity edges: step/jump/duck between surfaces overlapping in XZ
for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
  if (!near(surfaces[i], surfaces[j])) continue;
  const dy = Math.abs(surfaces[i].y - surfaces[j].y);
  let via = null;
  if (dy <= STEP_UP + 0.001) via = 'step';
  else if (dy <= JUMP_MOUNT) via = 'jump';
  else if (dy <= DUCK_MOUNT) via = 'duck-jump';
  if (via) { adj[i].push({ to: j, via }); adj[j].push({ to: i, via }); }
}
// BFS from GROUND (index 0; spawn at 0,0 is on ground)
const vis = new Array(N).fill(false), how = new Array(N).fill('');
const q = [0]; vis[0] = true; how[0] = 'spawn';
while (q.length) {
  const u = q.shift();
  for (const e of adj[u]) if (!vis[e.to]) { vis[e.to] = true; how[e.to] = e.via; q.push(e.to); }
}
let unreached = 0;
for (let i = 1; i < N; i++) {
  const s = surfaces[i];
  if (vis[i]) { P(`  REACH ${s.name.padEnd(16)} via ${how[i]}`); }
  else {
    // nearest reachable height gap
    let best = Infinity;
    for (let k = 0; k < N; k++) if (vis[k] && near(s, surfaces[k]))
      best = Math.min(best, Math.abs(s.y - surfaces[k].y));
    P(`  ❌STRANDED ${s.name.padEnd(14)} — no route` +
      (best < Infinity ? `; nearest reachable neighbour Δy=${f(best)}m` : '; isolated'));
    unreached++;
  }
}
P('');

// --- FLOW: connector route graph, loops vs dead-ends ---
// Movement quality is about ROUTES, not just reachability. Build a graph of
// the major surfaces using CONNECTOR edges only (real ramps/stairs — ignore
// incidental jump/step micro-links), then report each surface's connector
// degree (1 = dead-end spur, ≥2 = through-route) and whether a cycle exists
// (a loop you can rotate without backtracking). A connected graph has a
// cycle iff edge_count ≥ node_count (in that component).
P('--- flow: route graph (connectors + flush walkways) ---');
const major = (i) => !surfaces[i].name.startsWith('box');
const cdeg = new Array(N).fill(0);
const cedges = [];
const seen = new Set();
for (let u = 0; u < N; u++) for (const e of adj[u]) {
  // A real ROUTE = a ramp/stair connector, OR a flush walk-across between
  // two MAJOR surfaces (platform/named structural box) — e.g. running off
  // the keep onto the bridge, or across the catwalk. Incidental jump/duck
  // links onto small cover crates are NOT routes and are excluded.
  const isRoute = e.via === 'connector' || e.via === 'teleport' ||
    (e.via === 'step' && major(u) && major(e.to));
  if (!isRoute) continue;
  const a = Math.min(u, e.to), b = Math.max(u, e.to), k = a + '-' + b;
  if (seen.has(k)) continue;
  seen.add(k);
  cedges.push([a, b, e.via]); cdeg[a]++; cdeg[b]++;
}
for (const [a, b, via] of cedges)
  P(`  ${surfaces[a].name}  <->  ${surfaces[b].name}  (${via === 'connector' ? 'ramp/stairs' : 'walkway'})`);
const inGraph = new Set();
for (const [a, b] of cedges) { inGraph.add(a); inGraph.add(b); }
const hasLoop = cedges.length >= inGraph.size && inGraph.size > 0;
const deadEnds = [];
for (let i = 1; i < N; i++) if (major(i) && cdeg[i] === 1) deadEnds.push(surfaces[i].name);
const isolated = [];
for (let i = 1; i < N; i++)
  if (cdeg[i] === 0 && (surfaces[i].name.startsWith('KEEP') ||
      surfaces[i].name.startsWith('TOWER') || surfaces[i].name.startsWith('WEST') ||
      surfaces[i].name.startsWith('SOUTH') || surfaces[i].name.startsWith('EAST') ||
      surfaces[i].name.startsWith('RAMPART')))
    isolated.push(surfaces[i].name);
P(`  loop present: ${hasLoop ? 'YES — rotational route exists' : 'NO — tree only (backtracking forced)'}` +
  `  (${inGraph.size} nodes, ${cedges.length} connector edges)`);
P(`  dead-end spurs (one connector): ${deadEnds.length ? deadEnds.join(', ') : 'none'}`);
if (isolated.length) P(`  ⚠ named decks with NO connector (jump-only): ${isolated.join(', ')}`);
P('');
// --- GEOMETRY WARNINGS (S55d) ---------------------------------------------
// Auto-flag suspicious patterns that BURNED us during recent sessions and
// were only caught after the user reported them visually. Each warning is
// counted in `geomWarns` but DOES NOT auto-fail the map (some patterns are
// intentional). The agent can scan the report on every map edit.
let geomWarns = 0;
P('--- geometry warnings (auto-flag of suspicious patterns) ---');

// 1. Wall body intrudes into a deck volume (mesh z-fight at deck top).
//    Mirrors the harness_arena check, surfaced here so the report flags it.
{
  const platsForWarn = pieces.filter((p) => p.kind === 'platform');
  for (const e of LAYOUT) {
    if (e.t !== 'wall') continue;
    const tk = e.thick == null ? 0.5 : e.thick;
    const wx0 = e.axis === 'x' ? e.cx - e.length / 2 : e.cx - tk / 2;
    const wx1 = e.axis === 'x' ? e.cx + e.length / 2 : e.cx + tk / 2;
    const wz0 = e.axis === 'z' ? e.cz - e.length / 2 : e.cz - tk / 2;
    const wz1 = e.axis === 'z' ? e.cz + e.length / 2 : e.cz + tk / 2;
    const wyTop = (e.base || 0) + e.height;
    for (const p of platsForWarn) {
      const xOv = Math.min(wx1, p.x1) - Math.max(wx0, p.x0);
      const zOv = Math.min(wz1, p.z1) - Math.max(wz0, p.z0);
      if (xOv < 0.01 || zOv < 0.01) continue;
      const pTop = p.yMax, pBot = p.yMin;
      if (wyTop <= pBot + 0.001) continue;       // wall fully below deck
      if ((e.base || 0) >= pTop - 0.001) continue; // wall fully above deck
      P(`  WARN  wall ${e.axis}@(${e.cx},${e.cz}) y=[${f(e.base||0)},${f(wyTop)}] intrudes ` +
        `${p.id||'<unnamed>'} deck y=[${f(pBot)},${f(pTop)}] — z-fight at deck top`);
      geomWarns++;
    }
  }
}

// 2. Doorway opens into a connector wedge body (the stair-trap bug class).
//    For every wall with a `door` aperture, check whether a ramp/stair body
//    sits within 0.5 m of the wall's OUTER face inside the aperture
//    footprint. If so, a player walking through the doorway hits the wedge
//    and bounces back — that's the WAREHOUSE south-stair trap from S55b.
{
  const conns = pieces.filter((p) => p.kind === 'ramp' || p.kind === 'stairs');
  for (const e of LAYOUT) {
    if (e.t !== 'wall' || !e.door) continue;
    const tk = e.thick == null ? 0.5 : e.thick;
    const dWidth = e.door.width, dOffset = e.door.offset || 0, dHeight = e.door.height;
    const base = e.base || 0;
    // Doorway aperture XZ footprint (the gap in the wall).
    let apx0, apx1, apz0, apz1;
    if (e.axis === 'x') {
      apx0 = e.cx - dWidth / 2 + dOffset;
      apx1 = e.cx + dWidth / 2 + dOffset;
      apz0 = e.cz - tk / 2;
      apz1 = e.cz + tk / 2;
    } else {
      apz0 = e.cz - dWidth / 2 + dOffset;
      apz1 = e.cz + dWidth / 2 + dOffset;
      apx0 = e.cx - tk / 2;
      apx1 = e.cx + tk / 2;
    }
    // For each ramp/stair, check if its body sits adjacent to the aperture
    // on either side within 0.6 m (i.e. wall thickness + half a capsule).
    for (const c of conns) {
      const dist = Math.max(
        c.x0 - apx1, apx0 - c.x1, c.z0 - apz1, apz0 - c.z1,
      );
      if (dist > 0.6) continue;                  // wedge far away, not adjacent
      // Wedge y-range overlap with the doorway's y aperture (0..dHeight).
      const yOv = Math.min(c.yMax, base + dHeight) - Math.max(c.yMin, base);
      if (yOv < 0.5) continue;
      P(`  WARN  doorway in wall ${e.axis}@(${e.cx},${e.cz}) opens within ` +
        `${f(Math.max(0, dist))}m of ${c.kind} wedge — ground traversal traps`);
      geomWarns++;
    }
  }
}

// 3. Doorway too narrow for a standing player capsule (width < 2*R + 0.2).
{
  const MIN_DOOR = 2 * 0.4 + 0.2;   // PLAYER_RADIUS=0.4
  for (const e of LAYOUT) {
    if (e.t !== 'wall' || !e.door) continue;
    if (e.door.width + 0.01 < MIN_DOOR) {
      P(`  WARN  doorway in wall ${e.axis}@(${e.cx},${e.cz}) width=${f(e.door.width)}m ` +
        `< minimum ${f(MIN_DOOR)}m for a standing capsule`);
      geomWarns++;
    }
    // Door HEIGHT too short to walk through standing — ONLY when there's a
    // lintel above (door.height < wall.height). A parapet where the doorway
    // takes the full wall height has open air above the doorway, so the
    // player's head just clears the parapet top — no obstruction.
    const hasLintel = e.door.height + 0.001 < e.height;
    if (hasLintel && e.door.height + 0.01 < STAND) {
      P(`  WARN  doorway in wall ${e.axis}@(${e.cx},${e.cz}) lintel at ` +
        `y=${f((e.base || 0) + e.door.height)}m is below standing capsule top ` +
        `${f((e.base || 0) + STAND)}m — player will bump head`);
      geomWarns++;
    }
  }
}

// 4. Pickup floats / sinks: groundHeightAt at the pickup's (x,z) should
//    equal its declared y within ±0.1m.
{
  // PICKUPS may not exist in older layouts — guard the import access.
  // We re-import here so the script doesn't need to mutate the top.
  // Layout shape: maplayout exports `PICKUPS` separately.
}

P(`  ${geomWarns === 0 ? 'no geometry warnings flagged' : 'geomWarns=' + geomWarns + ' (review above)'}`);
P('');

// --- PICKUP REACHABILITY (S55e) ------------------------------------------
// Each pickup must sit on a surface that is REACHABLE from the spawn via
// the connector + jump/step graph. harness_pickups already verifies the
// pickup lands on a real surface; this layer ASLO verifies that surface
// is reachable. Catches "I placed a pickup on a deck nobody can reach".
P('--- pickup reachability (each pickup must be on a reachable surface) ---');
let unreachablePickups = 0;
if (typeof PICKUPS !== 'undefined' && Array.isArray(PICKUPS)) {
  for (const p of PICKUPS) {
    // Find the surface(s) containing (p.x, p.z) at p.y (within tolerance).
    let bestIdx = -1, bestDy = Infinity;
    for (let i = 0; i < N; i++) {
      const s = surfaces[i];
      if (p.x < s.x0 || p.x > s.x1 || p.z < s.z0 || p.z > s.z1) continue;
      const dy = Math.abs(s.y - (p.y || 0));
      if (dy < 0.2 && dy < bestDy) { bestDy = dy; bestIdx = i; }
    }
    const label = `${p.kind}${p.what ? ':' + p.what : ''} @(${f(p.x)},${f(p.z)},${f(p.y||0)})`;
    if (bestIdx < 0) {
      P(`  ❌ MISS  ${label}: no surface at that (x,z,y) — pickup floats / sinks`);
      unreachablePickups++;
    } else if (!vis[bestIdx]) {
      P(`  ❌ STRAND ${label}: surface ${surfaces[bestIdx].name} is STRANDED (no route from spawn)`);
      unreachablePickups++;
    } else {
      P(`  OK      ${label}: on ${surfaces[bestIdx].name} (reached via ${how[bestIdx]})`);
    }
  }
}
P('');

// --- PER-BUILDING INVENTORY (S55e) ---------------------------------------
// Textual summary of each named structure: footprint, height stack, which
// walls bound it (with door/window status), connectors landing here, and
// pickups on top. Gives the agent a one-glance structural readout
// without scanning the LAYOUT array manually.
P('--- per-building inventory (each named structure with its parts) ---');
const namedPlats = LAYOUT.filter((e) => e.t === 'platform' && e.id);
const namedBoxes = LAYOUT.filter((e) => e.t === 'box' && e.id);
const allWalls = LAYOUT.filter((e) => e.t === 'wall');
const allConns = LAYOUT.filter((e) => e.t === 'rampTo' || e.t === 'stairsTo');
function dscWall(w) {
  const apr = w.door ? `door ${f(w.door.width)}x${f(w.door.height)}`
              : w.window ? `window w${f(w.window.width)}xh${f(w.window.height)}@sill${f(w.window.sill)}`
              : 'solid';
  const y = `y[${f(w.base || 0)},${f((w.base || 0) + w.height)}]`;
  return `${w.axis}-axis cx=${f(w.cx)} cz=${f(w.cz)} L=${f(w.length)} ${y} ${apr}`;
}
for (const b of [...namedPlats, ...namedBoxes]) {
  const isPlat = b.t === 'platform';
  const thick = b.thick == null ? 0.6 : (isPlat ? b.thick : null);
  const top = isPlat ? b.top : (b.base || 0) + b.sy;
  const bot = isPlat ? b.top - (b.thick == null ? 0.6 : b.thick) : (b.base || 0);
  const sx = b.sx, sz = b.sz;
  const x0 = b.cx - sx / 2, x1 = b.cx + sx / 2;
  const z0 = b.cz - sz / 2, z1 = b.cz + sz / 2;
  P(`  ${b.id} [${b.t}]  footprint x=[${f(x0)},${f(x1)}] z=[${f(z0)},${f(z1)}]  y=[${f(bot)},${f(top)}]  size ${f(sx)}×${f(sz)} h=${f(top - bot)}`);
  // Walls touching this building's perimeter (centerline within 1.5m of an edge).
  for (const w of allWalls) {
    const wt = w.thick == null ? 0.5 : w.thick;
    const wHalfL = w.length / 2;
    let touches = false;
    if (w.axis === 'x') {
      // wall spans x along its length; touches if its z-center sits within 1.5m of building's z-edge AND x-extent overlaps
      const wx0 = w.cx - wHalfL, wx1 = w.cx + wHalfL;
      if (Math.min(wx1, x1) - Math.max(wx0, x0) > -0.5 &&
          (Math.abs(w.cz - z0) < 1.5 || Math.abs(w.cz - z1) < 1.5 ||
           (w.cz > z0 && w.cz < z1)))
        touches = true;
    } else {
      const wz0 = w.cz - wHalfL, wz1 = w.cz + wHalfL;
      if (Math.min(wz1, z1) - Math.max(wz0, z0) > -0.5 &&
          (Math.abs(w.cx - x0) < 1.5 || Math.abs(w.cx - x1) < 1.5 ||
           (w.cx > x0 && w.cx < x1)))
        touches = true;
    }
    if (touches) P(`    wall:  ${dscWall(w)}`);
  }
  // Connectors that LAND on this building.
  for (const c of allConns) {
    if (c.to === b.id) P(`    conn:  ${c.t} side=${c.side} run=${f(c.run)} width=${f(c.width)} fromY=${f(c.fromY||0)}`);
  }
  // Pickups on top.
  if (typeof PICKUPS !== 'undefined') {
    for (const p of PICKUPS) {
      if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 &&
          Math.abs((p.y || 0) - top) < 0.2)
        P(`    pickup: ${p.kind}${p.what ? ':' + p.what : ''} @(${f(p.x)},${f(p.z)})`);
    }
  }
}
P('');

// --- DOORWAYS REGISTRY CONSISTENCY (S55e) -------------------------------
// The hand-maintained DOORWAYS export feeds the AI router (see enemies.js
// updateDoorwayLatch). It's easy for this list to drift when walls are
// added/moved/changed — a doorway entry then routes the AI through empty
// air, or a new doorway has no entry and AIs paw at the wall. Check both
// directions: every door-bearing wall has a nearby DOORWAYS entry, and
// every DOORWAYS entry corresponds to a real door-bearing wall.
P('--- DOORWAYS registry consistency (AI router waypoint list) ---');
let doorwayDrift = 0;
if (typeof DOORWAYS !== 'undefined' && Array.isArray(DOORWAYS)) {
  // Collect every wall that has a `door` aperture.
  const doorWalls = LAYOUT
    .filter((e) => e.t === 'wall' && e.door)
    .map((e) => ({ cx: e.cx, cz: e.cz, axis: e.axis, base: e.base || 0 }));
  // Match within 2 m (DOORWAYS entries are usually wall midpoints).
  const matched = new Set();
  for (let i = 0; i < DOORWAYS.length; i++) {
    const d = DOORWAYS[i];
    let bestIdx = -1, bestDist = Infinity;
    for (let j = 0; j < doorWalls.length; j++) {
      const w = doorWalls[j];
      // Only consider ground-floor doors (base ~ 0). The AI routes at
      // ground level — parapet doorways aren't traversable for routing.
      if (w.base > 0.1) continue;
      if (w.axis !== d.axis) continue;
      const dd = Math.hypot(w.cx - d.x, w.cz - d.z);
      if (dd < bestDist) { bestDist = dd; bestIdx = j; }
    }
    if (bestIdx < 0 || bestDist > 2.0) {
      P(`  ❌ DRIFT  DOORWAYS[${i}] @(${f(d.x)},${f(d.z)}, axis ${d.axis}) — no matching ground-floor door wall (nearest ${f(bestDist)}m)`);
      doorwayDrift++;
    } else {
      matched.add(bestIdx);
    }
  }
  // Any ground-floor door-bearing wall NOT covered by DOORWAYS is a routing gap.
  for (let j = 0; j < doorWalls.length; j++) {
    if (matched.has(j)) continue;
    const w = doorWalls[j];
    if (w.base > 0.1) continue;                  // parapet doorways are intentionally out of the AI graph
    P(`  ❌ MISS   ground-floor door at wall ${w.axis}@(${f(w.cx)},${f(w.cz)}) has no DOORWAYS entry — AI won't route through it`);
    doorwayDrift++;
  }
  if (doorwayDrift === 0) {
    P(`  OK  ${DOORWAYS.length} DOORWAYS entries ↔ ${doorWalls.filter((w) => w.base <= 0.1).length} ground-floor door walls match`);
  }
}
P('');

// --- SIGHTLINE MATRIX (S55e) --------------------------------------------
// Pairwise LOS check between named landmarks (spawn + each pickup). Gives
// a quick "from here can I see there" reference for combat-flow reasoning:
// if a pickup has LOS to spawn from far away, that pickup's defender has
// an early-spotting advantage; if a pickup has NO LOS to most of the map,
// it's a safe pickup but a poor sniper perch.
P('--- sightline matrix (LOS between landmarks at chest height 1.05m) ---');
const landmarks = [{ name: 'SPAWN', x: SPAWN.x, z: SPAWN.z, y: 0 }];
if (typeof PICKUPS !== 'undefined') {
  for (const p of PICKUPS) {
    if (p.kind !== 'weapon') continue;
    landmarks.push({ name: p.what, x: p.x, z: p.z, y: p.y || 0 });
  }
}
const CHEST = 1.05;
// Header row.
let head = '       ';
for (const a of landmarks) head += a.name.padEnd(9);
P('  ' + head);
for (const a of landmarks) {
  let row = a.name.padEnd(9);
  for (const b of landmarks) {
    if (a === b) { row += '   -    '; continue; }
    const sees = lineOfSight(a.x, a.y + CHEST, a.z, b.x, b.y + CHEST, b.z);
    row += sees ? '   ✓    ' : '   ✗    ';
  }
  P('  ' + row);
}
P('');

P(`SUMMARY: overlap issues=${issues}  seam fails=${seamFail}  stranded surfaces=${unreached}` +
  `  | loop=${hasLoop ? 'yes' : 'NO'}  dead-ends=${deadEnds.length}  | geomWarns=${geomWarns}` +
  `  | unreachable pickups=${unreachablePickups}  | doorway drift=${doorwayDrift}`);
P(unreached || seamFail || issues || unreachablePickups || doorwayDrift
  ? '*** MAP HAS ISSUES — see above ***'
  : '*** MAP OK ***');

const report = log.join('\n');
console.log(report);
// S55d: write outputs alongside the script (./dev/...) so they're easy to
// find regardless of where the script is invoked from. Was hardcoded to
// /home/claude/build/dev which only existed on one sandbox.
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __DIR = dirname(fileURLToPath(import.meta.url));
writeFileSync(`${__DIR}/map_report.txt`, report);

// ---- SVG renderers ----
// S55: WORLD scales with the actual ground extent so big maps still fit.
const WORLD = GH + 4, SZ = 1100, sc = SZ / (WORLD * 2);
const X = (x) => (x + WORLD) * sc, Z = (z) => (z + WORLD) * sc;
function band(label, ymin, ymax) {
  const inb = (p) => p.top >= ymin - 0.01 && p.top <= ymax + 0.01;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${SZ}" height="${SZ}" font-family="monospace">`;
  s += `<rect width="${SZ}" height="${SZ}" fill="#0c0f14"/>`;
  for (let g = -GH; g <= GH; g += 10)
    s += `<line x1="${X(g)}" y1="0" x2="${X(g)}" y2="${SZ}" stroke="#1b2230"/>` +
         `<line x1="0" y1="${Z(g)}" x2="${SZ}" y2="${Z(g)}" stroke="#1b2230"/>`;
  // faint context: everything below this band
  for (const p of pieces) if (p.top < ymin - 0.01 && p.kind !== 'ground' && p.kind !== 'wall')
    s += `<rect x="${X(p.x0)}" y="${Z(p.z0)}" width="${(p.x1-p.x0)*sc}" height="${(p.z1-p.z0)*sc}" fill="#161b24"/>`;
  for (const p of pieces) {
    if (p.kind === 'wall') { s += `<rect x="${X(p.x0)}" y="${Z(p.z0)}" width="${(p.x1-p.x0)*sc}" height="${(p.z1-p.z0)*sc}" fill="#b9c2d0" fill-opacity="0.85"/>`; continue; }
    if (!inb(p) && !(p.conn)) continue;
    const col = p.kind === 'platform' ? '#3b6ea5' : p.kind === 'box' ? '#7a6336'
      : p.kind === 'ramp' ? '#4a7a52' : p.kind === 'stairs' ? '#52708a'
      : p.kind === 'overhang' ? '#6a4a6a' : '#26303f';
    s += `<rect x="${X(p.x0)}" y="${Z(p.z0)}" width="${(p.x1-p.x0)*sc}" height="${(p.z1-p.z0)*sc}" fill="${col}" fill-opacity="0.82" stroke="#0a0d12"/>`;
    if (p.conn) {
      const c = p.conn, mx = (p.x0+p.x1)/2, mz=(p.z0+p.z1)/2;
      s += `<text x="${X(mx)}" y="${Z(mz)}" fill="#dfe" font-size="11" text-anchor="middle">▲${f(c.loY)}→${f(c.hiY)}</text>`;
    } else if (p.id) {
      s += `<text x="${X((p.x0+p.x1)/2)}" y="${Z((p.z0+p.z1)/2)}" fill="#fff" font-size="12" text-anchor="middle">${p.id} ${f(p.top)}</text>`;
    }
  }
  s += `<circle cx="${X(SPAWN.x)}" cy="${Z(SPAWN.z)}" r="6" fill="#ffd23a"/><text x="${X(SPAWN.x)+9}" y="${Z(SPAWN.z)+4}" fill="#ffd23a" font-size="12">SPAWN</text>`;
  s += `<rect x="${X(-GH)}" y="${Z(-GH)}" width="${GH*2*sc}" height="${GH*2*sc}" fill="none" stroke="#3a4658" stroke-dasharray="4 4"/>`;
  s += `<text x="14" y="26" fill="#fff" font-size="18">${label}</text></svg>`;
  return s;
}
// elevation bands: ground + platform tops + named structural walkways
// (BRIDGE/CATWALK) — NOT individual cover crates (they'd each be a "tier").
for (const fn of readdirSync(__DIR))
  if (/^map_(plan|elev|oblique).*\.svg$/.test(fn)) unlinkSync(`${__DIR}/${fn}`);
const tops = [...new Set(pieces
  .filter(p => (p.kind === 'platform' || (p.kind === 'box' && p.id) || p.kind === 'ground'))
  .map(p => Math.round(p.top * 10) / 10))].sort((a, b) => a - b);
writeFileSync(`${__DIR}/map_plan_all.svg`, band('ALL TIERS', -1, 99));
let bi = 0;
for (const t of tops) { writeFileSync(`${__DIR}/map_plan_t${bi}_${t}.svg`, band(`TIER y=${t}`, t - 0.05, t + 0.05)); bi++; }

// oblique isometric, auto-fit, perimeter walls excluded (they'd box the view)
function oblique() {
  const W = 980, Hh = 640, a = 1.0, bb = 0.5, cc = 1.0;   // iso basis
  const ip = (x, y, z) => [ (x - z) * a, (x + z) * bb - y * cc ];
  // S55: filter perimeter walls by length relative to ground size, not by a
  // hardcoded 60m, so the oblique view doesn't suddenly include perimeter
  // walls when the arena grows.
  const PERIM_LEN = GH * 2 - 2;
  const draw = pieces.filter(p => p.kind !== 'ground' &&
    !(p.kind === 'wall' && (p.x1 - p.x0 > PERIM_LEN || p.z1 - p.z0 > PERIM_LEN)));
  // projected bounds for auto-fit
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
  for (const p of draw) for (const X0 of [p.x0, p.x1]) for (const Y0 of [p.yMin, p.yMax]) for (const Z0 of [p.z0, p.z1]) {
    const [sx, sy] = ip(X0, Y0, Z0);
    mnx = Math.min(mnx, sx); mxx = Math.max(mxx, sx);
    mny = Math.min(mny, sy); mxy = Math.max(mxy, sy);
  }
  const sc2 = Math.min((W - 80) / (mxx - mnx), (Hh - 90) / (mxy - mny));
  const ox = 40 - mnx * sc2, oy = 50 - mny * sc2;
  const PT = (x, y, z) => { const [sx, sy] = ip(x, y, z); return [ox + sx * sc2, oy + sy * sc2]; };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" font-family="monospace"><rect width="${W}" height="${Hh}" fill="#0c0f14"/>`;
  // painter's order: far (low x+z) first
  const order = [...draw].sort((p, q) => ((p.x0 + p.x1 + p.z0 + p.z1)) - ((q.x0 + q.x1 + q.z0 + q.z1)) || p.yMin - q.yMin);
  for (const p of order) {
    const col = p.kind === 'platform' ? '#3b6ea5' : p.kind === 'box' && p.id ? '#8a6a2e'
      : p.kind === 'box' ? '#7a6336' : p.kind === 'ramp' ? '#4a7a52'
      : p.kind === 'stairs' ? '#52708a' : p.kind === 'overhang' ? '#6a4a6a' : '#3a4250';
    const v = [[p.x0,p.yMin,p.z0],[p.x1,p.yMin,p.z0],[p.x1,p.yMin,p.z1],[p.x0,p.yMin,p.z1],
              [p.x0,p.yMax,p.z0],[p.x1,p.yMax,p.z0],[p.x1,p.yMax,p.z1],[p.x0,p.yMax,p.z1]].map(q => PT(...q));
    const poly = (idx, op) => `<polygon points="${idx.map(i => v[i].join(',')).join(' ')}" fill="${col}" fill-opacity="${op}" stroke="#0a0d12" stroke-width="0.7"/>`;
    s += poly([4,5,6,7], 1.0);       // top
    s += poly([1,2,6,5], 0.72);      // east face
    s += poly([2,3,7,6], 0.55);      // south face
    if (p.id) { const t = PT((p.x0+p.x1)/2, p.yMax, (p.z0+p.z1)/2); s += `<text x="${t[0]}" y="${t[1]-3}" fill="#fff" font-size="11" text-anchor="middle">${p.id}</text>`; }
  }
  const sp = PT(SPAWN.x, 0, SPAWN.z);
  s += `<circle cx="${sp[0]}" cy="${sp[1]}" r="6" fill="#ffd23a"/><text x="${sp[0]+9}" y="${sp[1]}" fill="#ffd23a" font-size="12">SPAWN</text>`;
  s += `<text x="20" y="30" fill="#fff" font-size="18">OBLIQUE (isometric) — +y up, perimeter omitted</text></svg>`;
  return s;
}
writeFileSync(`${__DIR}/map_oblique.svg`, oblique());

// --- ELEVATION VIEWS (S55d) ----------------------------------------------
// Orthographic side projections along each cardinal axis. These are the
// view that makes wall-vs-deck overlaps OBVIOUS: a wall poking into a deck
// reads as two filled boxes occupying the same Y-band; the previous flat-
// floorplan + oblique combo could miss this entirely (the overlap is a
// thin horizontal sliver). Also makes stair-doorway traps visible because
// you see the stair wedge body abutting the wall in side profile.
//
// For each axis, project all pieces (excluding the ground floor) onto the
// vertical plane perpendicular to the view axis. Pieces farther from the
// viewer are drawn first (painter's order) and slightly tinted darker.
function elevation(viewAxis, viewDir, title) {
  // viewAxis: 'x' (looking along ±X, see the YZ plane) or 'z' (looking
  // along ±Z, see the YX plane). viewDir: +1 or -1 (toward +axis or -).
  const W = 1200, Hh = 520;
  const Y_MAX = 14;     // a bit higher than the tallest perimeter
  const horizMin = -GH, horizMax = GH;
  const padX = 36, padY = 40;
  const sx = (W - padX * 2) / (horizMax - horizMin);
  const sy = (Hh - padY * 2) / (Y_MAX + 2);
  const X0 = (h) => padX + (h - horizMin) * sx;
  const Y0 = (y) => Hh - padY - y * sy;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" font-family="monospace">`;
  s += `<rect width="${W}" height="${Hh}" fill="#0c0f14"/>`;
  // Y grid lines every 2 m + labels.
  s += `<g stroke="#1c2330" stroke-width="1">`;
  for (let yy = 0; yy <= Y_MAX; yy += 2)
    s += `<line x1="${padX}" y1="${Y0(yy)}" x2="${W - padX}" y2="${Y0(yy)}"/>`;
  for (let h = -80; h <= 80; h += 20)
    s += `<line x1="${X0(h)}" y1="${padY}" x2="${X0(h)}" y2="${Hh - padY}"/>`;
  s += `</g>`;
  s += `<g fill="#5c6878" font-size="11">`;
  for (let yy = 0; yy <= Y_MAX; yy += 2)
    s += `<text x="${padX - 6}" y="${Y0(yy) + 4}" text-anchor="end">${yy}</text>`;
  s += `</g>`;
  // Ground line at y=0.
  s += `<line x1="${padX}" y1="${Y0(0)}" x2="${W - padX}" y2="${Y0(0)}" stroke="#3a4658" stroke-width="2"/>`;
  // Sort pieces by depth (along viewAxis), far first.
  const depth = (p) => viewAxis === 'x' ? (viewDir > 0 ? (p.x0 + p.x1) / 2 : -(p.x0 + p.x1) / 2)
                                        : (viewDir > 0 ? (p.z0 + p.z1) / 2 : -(p.z0 + p.z1) / 2);
  // Filter out the perimeter walls (which fill the whole background like a
  // skybox in elevation) and the ground floor (handled separately as the
  // baseline at y=0). Match perimeter walls by length covering the full
  // arena (any single wall whose horizontal span exceeds 90% of GH×2).
  const PERIM_LEN = GH * 1.9;
  const ordered = pieces
    .filter((p) => p.kind !== 'ground' &&
      !(p.kind === 'wall' && ((p.x1 - p.x0) > PERIM_LEN || (p.z1 - p.z0) > PERIM_LEN)))
    .slice()
    .sort((a, b) => depth(a) - depth(b));
  for (const p of ordered) {
    // Horizontal bounds (the axis perpendicular to view).
    const h0 = viewAxis === 'x' ? p.z0 : p.x0;
    const h1 = viewAxis === 'x' ? p.z1 : p.x1;
    const y0 = p.yMin, y1 = p.yMax;
    if (y1 - y0 < 0.01 || h1 - h0 < 0.01) continue;
    // For ramps, draw the wedge silhouette (slope) when seen ALONG the run
    // axis; otherwise (seen across the run axis) draw the full bounding box.
    let path;
    if (p.kind === 'ramp' || p.kind === 'stairs') {
      const conn = p.conn;
      if (conn && conn.axis === viewAxis) {
        // Run axis is into the view → ramp shows as a triangle profile in YH.
        // The slope goes from (cf, loY) to (cf, hiY) but along the run we
        // project a triangle: at h_low the wedge top is loY; at h_high top is hiY.
        // Since we're projecting along the run axis we see a rectangle with the
        // sloped TOP. We approximate with a triangle from (h0, 0) to (h1, 0)
        // to (mid, max(yMax)).
        const hMid = (h0 + h1) / 2;
        path = `M ${X0(h0)} ${Y0(0)} L ${X0(h1)} ${Y0(0)} L ${X0(h1)} ${Y0(conn.hiY)} L ${X0(h0)} ${Y0(conn.loY)} Z`;
        // pick the orientation of the diagonal based on which end is high
        path = `M ${X0(h0)} ${Y0(0)} L ${X0(h1)} ${Y0(0)} L ${X0(h1)} ${Y0(conn.hiY)} L ${X0(h0)} ${Y0(conn.loY)} Z`;
        void hMid;
      } else {
        path = `M ${X0(h0)} ${Y0(y0)} L ${X0(h1)} ${Y0(y0)} L ${X0(h1)} ${Y0(y1)} L ${X0(h0)} ${Y0(y1)} Z`;
      }
    } else {
      path = `M ${X0(h0)} ${Y0(y0)} L ${X0(h1)} ${Y0(y0)} L ${X0(h1)} ${Y0(y1)} L ${X0(h0)} ${Y0(y1)} Z`;
    }
    // Color by kind; tint slightly darker by depth so far pieces fade back.
    const col = p.kind === 'platform' ? '#3b6ea5'
      : p.kind === 'box' && p.id ? '#8a6a2e'
      : p.kind === 'box' ? '#7a6336'
      : p.kind === 'ramp' ? '#4a7a52'
      : p.kind === 'stairs' ? '#52708a'
      : p.kind === 'overhang' ? '#6a4a6a'
      : '#aab2bf';
    s += `<path d="${path}" fill="${col}" fill-opacity="0.82" stroke="#0a0d12" stroke-width="0.6"/>`;
    if (p.id) {
      const tx = X0((h0 + h1) / 2);
      const ty = Y0((y0 + y1) / 2);
      s += `<text x="${tx}" y="${ty + 4}" fill="#fff" font-size="10" text-anchor="middle">${p.id}</text>`;
    }
  }
  s += `<text x="20" y="26" fill="#fff" font-size="16">${title}</text>`;
  s += `<text x="${W - 14}" y="${Hh - 14}" fill="#5c6878" font-size="11" text-anchor="end">horizontal axis: ${viewAxis === 'x' ? 'Z' : 'X'} (m) — vertical: Y (m)</text>`;
  s += `</svg>`;
  return s;
}

// Generate 4 elevation views (looking along ±X and ±Z).
writeFileSync(`${__DIR}/map_elev_from_west.svg`,  elevation('x', +1,
  'ELEVATION — looking EAST (from -X), horizontal axis = Z'));
writeFileSync(`${__DIR}/map_elev_from_east.svg`,  elevation('x', -1,
  'ELEVATION — looking WEST (from +X), horizontal axis = Z'));
writeFileSync(`${__DIR}/map_elev_from_north.svg`, elevation('z', +1,
  'ELEVATION — looking SOUTH (from -Z), horizontal axis = X'));
writeFileSync(`${__DIR}/map_elev_from_south.svg`, elevation('z', -1,
  'ELEVATION — looking NORTH (from +Z), horizontal axis = X'));

console.log(`\n[wrote ${__DIR}/map_report.txt + plan/elev/oblique SVGs]`);
