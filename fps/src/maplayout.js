// maplayout.js — RIDGEPOINT CITADEL (S55g: cohesive Quake-arena redesign).
//
// Architectural DNA (informed by Quake-tradition map design — DM3 keep,
// DM4 atrium, DM6 verticality, "The Edge" multi-tier flow — without
// copying any specific source map):
//
//   1. ONE dominant central landmark. Everything reads off the central
//      keep (THE CITADEL). It's the first thing you see from spawn, and
//      every flow loop in the map runs around or through it.
//   2. ASYMMETRIC peripheral zones, one personality per cardinal:
//        North = THE VAULT (close blockhouse bunker, two-room interior)
//        East  = THE FOUNDRY (long two-room industrial hall, drop target)
//        South = THE TERRACE (open elevated plaza, mid-tier exposure)
//        West  = THE COLONNADE (tall standing columns + rampart walkway)
//      No 4-fold mirror. Each zone has a distinct silhouette, role, and
//      preferred combat range. Anti-symmetry forces the player to learn
//      the map's geography (which is half the joy of an arena map).
//   3. THREE MEANINGFUL ELEVATIONS, stacked tight:
//        y=0   — open plaza + interior corridors (frags happen here)
//        y=4   — mezzanine ring (citadel base deck, building rooftops,
//                rampart top) → the dominant combat layer
//        y=8   — HILLTOP keep + CATWALK_HE → the iconic sniper perch
//      Each elevation has a flow loop. Vertical pumps (ramps/stairs)
//      let the player shift layer mid-engagement.
//   4. RISK/REWARD POWER WEAPON. Sniper sits on HILLTOP top, exposed to
//      every approach but commanding every sightline. To reach it you
//      climb 8 m up the keep face — long commit, no easy escape.
//   5. CQC INTERIOR for the shotgun. Inside the FOUNDRY's west room.
//      Tight 7-m partitioned space rewards close-range cleanup.
//
// The map is 130×130 (constants demand it). Playable interior is the
// inner ±60. Perimeter at ±65 (walls 14 m tall).
//
//  FLOOR PLAN (rough — see SVG mapviz output for exact geometry):
//                    z=-65 (NORTH wall)
//   x=-65   +------------------------------------------+   x=+65
//           |                                          |
//   z=-50   |             ▓ VAULT ▓                    |
//           |          (blockhouse, 2 rms)             |
//   z=-30   |              ↑ ramp ↑                    |
//           |                                          |
//           |    ┌─CITADEL_BASE──┐   FOUNDRY           |
//   z=-15   |    │   ▓HILLTOP▓   │═CATWALK_HE  ▓▓▓▓    |
//           |    │  (sniper y=8) │   (y=8)    (y=4 roof|
//           |    │     y=4       │  →drop→4   /interior|
//           |    └───────────────┘            ▓▓▓▓     |
//           |       ↑ ramp ↑                  ↑ stair  |
//           |     ↑ S ramp ↑                           |
//   z=0     |  COL  ●SPAWN(0,0)                        |
//           |  UMNS                                    |
//           |  ▓▓▓        TERRACE (y=3)                |
//   z=+25   |  RAMPART  ▓▓▓▓▓▓▓▓▓▓▓▓▓                 |
//           |  (y=5)                                   |
//           |                                          |
//   z=+65   +------------------------------------------+
//                    z=+65 (SOUTH wall)
//
// SCHEMA: see entries (`t` field). New-this-session: no new types — all
// geometry uses the existing primitives (ground/perimeter/platform/box/
// wall/rampTo/stairsTo/overhang). The redesign is purely architectural;
// the verified collision kit is unchanged.

// SPAWN — clear ground 9 m south of the CITADEL S ramp foot (z=3). Looking
// north, the player faces a dramatic 10 m grand ramp climbing up to the
// citadel mezzanine. Looking south, the TERRACE 19 m away. The legacy
// (0,0) origin was on the ramp surface; moving south by 6 m gives both
// open ground at spawn AND a wider view of the central feature.
export const SPAWN = { x: 0, z: 6 };

// Multi-anchor list used by the arena spawn-selection logic in player.js.
// Each anchor is a clear ground-level patch. The arena respawn picks the
// anchor farthest from any live enemy. Choices:
//   C — spawn point (matches SPAWN).
//   N — between CITADEL north edge and VAULT south wall (≈30 m gap).
//   E — south of FOUNDRY, between citadel and foundry south doors.
//   S — north of TERRACE, between TERRACE N face and the spawn ramp foot.
//   W — between CITADEL west edge and WEST_RAMPART columns.
export const SPAWN_ANCHORS = [
  { id: 'C', x:   0, z:   6 },
  { id: 'N', x:   0, z: -32 },
  { id: 'E', x:  24, z:   5 },
  { id: 'S', x:   0, z:  20 },
  { id: 'W', x: -22, z:   0 },
];

// Pure wall-decomposition helper. Splits a wall entry into world-space
// AABB rects, honoring an optional door or window aperture. Used IDENTICALLY
// by the runtime arena.js and the offline mapviz.mjs analyzer, so a single
// definition keeps the simulated map and the rendered map in sync.
//
//   door:   { width, height, offset? }            — full-height gap from base
//   window: { width, height, sill, offset? }      — mid-band gap with sill
//
// A doorway = NO solid mesh in the opening (walk + see + shoot through).
// A window  = solid sill below + lintel above + side jambs; the mid band
//             is clear, so you CANNOT walk through but CAN see/shoot.
export function wallBoxes(e) {
  const base = e.base || 0, H = e.height, t = e.thick == null ? 0.5 : e.thick;
  const L = e.length, axis = e.axis;
  let ap = null;
  if (e.door) ap = { u0: -e.door.width / 2 + (e.door.offset || 0),
                      u1: e.door.width / 2 + (e.door.offset || 0),
                      y0: 0, y1: e.door.height };
  else if (e.window) ap = { u0: -e.window.width / 2 + (e.window.offset || 0),
                            u1: e.window.width / 2 + (e.window.offset || 0),
                            y0: e.window.sill, y1: e.window.sill + e.window.height };
  const out = [];
  const lmin = (axis === 'x' ? e.cx : e.cz) - L / 2;
  const lmax = (axis === 'x' ? e.cx : e.cz) + L / 2;
  const c0 = (axis === 'x' ? e.cz : e.cx) - t / 2;
  const c1 = (axis === 'x' ? e.cz : e.cx) + t / 2;
  const mk = (a, b, y0, y1) => {
    if (axis === 'x') out.push({ x0: a, x1: b, y0, y1, z0: c0, z1: c1 });
    else              out.push({ x0: c0, x1: c1, y0, y1, z0: a, z1: b });
  };
  if (!ap) { mk(lmin, lmax, base, base + H); return out; }
  const a0 = (axis === 'x' ? e.cx : e.cz) + ap.u0;
  const a1 = (axis === 'x' ? e.cx : e.cz) + ap.u1;
  if (ap.y0 > 0.001)        mk(lmin, lmax, base, base + ap.y0);          // sill
  if (ap.y1 < H - 0.001)    mk(lmin, lmax, base + ap.y1, base + H);      // lintel
  if (a0 > lmin + 0.001)    mk(lmin, a0, base + ap.y0, base + ap.y1);    // jamb L
  if (a1 < lmax - 0.001)    mk(a1, lmax, base + ap.y0, base + ap.y1);    // jamb R
  return out;
}

// AI router waypoint list (ground-floor doorway midpoints). When an enemy
// loses LOS to the player through a wall, the router latches onto the
// nearest DOORWAYS entry and routes around. Each must be the EXACT (cx,cz)
// of a ground-floor wall (base=0) bearing a `door` aperture. mapviz's
// DOORWAYS-consistency check flags drift. Parapet doorways (base>0) are
// NOT in this list — AI routes at ground level only.
//
// S55g: redesigned with the new building set:
//   VAULT       — 2 entries (S front door + W flank)
//   FOUNDRY     — 2 outer entries (S front door + W flank) + 1 interior partition
//                 (5 total entries on the foundry side — long building, two rooms)
// CITADEL has no ground-floor walls (it's a solid keep); access is via ramp
// or stair on top, so no DOORWAYS entries.
// TERRACE / WEST_RAMPART are open elevated decks reached by ramps, no walls.
export const DOORWAYS = [
  // VAULT (north blockhouse).
  { x:   0, z: -39, axis: 'x' },   // S front door
  { x:  -9, z: -45, axis: 'z' },   // W flank door
  // FOUNDRY (east industrial hall).
  { x:  22, z:  -9, axis: 'x' },   // S front door
  { x:  14, z: -15, axis: 'z' },   // W flank door (faces citadel)
  { x:  22, z: -15, axis: 'z' },   // interior partition
];

export const LAYOUT = [
  // =====================================================================
  // SHELL — 130×130 perimeter (±65), 14 m walls.
  // =====================================================================
  { t: 'ground', half: 65, y: 0 },
  { t: 'perimeter', half: 65, height: 14, thick: 1.0 },

  // =====================================================================
  // THE CITADEL — central tiered keep. Two solid blocks stacked:
  //   CITADEL_BASE: 16×16 footprint, solid y=[0,4]. Walkable mezzanine
  //   on top. Reached by 1 ramp (S, wide) + 2 stairs (N, W). The base
  //   has no ground-floor walls — it's a solid block; you cannot enter
  //   from below. You climb onto it from one of three sides.
  //
  //   HILLTOP: 8×8 footprint centered on the base, solid y=[4,8].
  //   The iconic sniper perch. Reached only by an internal stair on
  //   the south face (CITADEL_BASE deck → HILLTOP deck, +z side).
  //   East parapet has a door opening onto CATWALK_HE.
  // =====================================================================
  // CITADEL_BASE — solid block y=[0,4]. Clad in SLATE: dark hewn-stone
  // blocks read as fortress masonry from any approach.
  { t: 'platform', id: 'CITADEL_BASE', cx: 0, cz: -15, top: 4, sx: 16, sz: 16, thick: 4, mat: 'slate' },
  // External access to CITADEL_BASE mezzanine.
  { t: 'rampTo',   to: 'CITADEL_BASE', side: '+z', run: 10, width: 8, fromY: 0 },   // S grand ramp (from spawn)
  { t: 'stairsTo', to: 'CITADEL_BASE', side: '-z', run: 8,  width: 5, fromY: 0, steps: 8 },   // N stair (toward vault)
  { t: 'stairsTo', to: 'CITADEL_BASE', side: '-x', run: 8,  width: 5, fromY: 0, steps: 8 },   // W stair (toward colonnade)
  // CITADEL_BASE peripheral parapets (cover for mezzanine combat). Each
  // sits on the base perimeter at base=4, leaving doorways at the connector
  // landings (S ramp, N stair, W stair) and an open E face for the catwalk.
  { t: 'wall', axis: 'x', cx:  0, cz: -23, base: 4, length: 16, height: 1.6, thick: 0.4, mat: 'slate',
    door: { width: 5.2, height: 1.6 } },                                                    // N parapet (N stair landing)
  { t: 'wall', axis: 'x', cx:  0, cz:  -7, base: 4, length: 16, height: 1.6, thick: 0.4, mat: 'slate',
    door: { width: 8.0, height: 1.6 } },                                                    // S parapet (S ramp landing)
  { t: 'wall', axis: 'z', cx: -8, cz: -15, base: 4, length: 16, height: 1.6, thick: 0.4, mat: 'slate',
    door: { width: 5.2, height: 1.6 } },                                                    // W parapet (W stair landing)
  { t: 'wall', axis: 'z', cx:  8, cz: -15, base: 4, length: 16, height: 1.6, thick: 0.4, mat: 'slate',
    door: { width: 5.2, height: 1.6 } },                                                    // E parapet (CATWALK_HE access)

  // HILLTOP — sniper perch on top of CITADEL_BASE. Offset NORTH of citadel
  // center (cz=-17) so its south edge (z=-13) is 6 m north of the base
  // south edge (z=-7) — leaving room for the inner stair without its
  // wedge body extending into the S ramp's seam-test zone.
  // HILLTOP top deck is CLAD IN MARBLE — the sacred sniper perch. The
  // contrast with the surrounding slate parapets reads instantly as "this
  // is the prize". Marble is reflective + lighter than slate, so the
  // perch glows visually from any approach.
  { t: 'platform', id: 'HILLTOP', cx: 0, cz: -17, top: 8, sx: 8, sz: 8, thick: 4, mat: 'marble' },
  // Inner stair from CITADEL_BASE mezzanine (y=4) up to HILLTOP (y=8).
  // Lands on HILLTOP south edge (z=-13), foot on CITADEL_BASE at z=-9.
  // 4 m run, 4 m rise → 45° pitch, sits 2 m north of base south edge.
  { t: 'stairsTo', to: 'HILLTOP', side: '+z', run: 4, width: 5, fromY: 4, steps: 8 },
  // HILLTOP parapets (cover on the perch) — slate to match the keep walls.
  { t: 'wall', axis: 'x', cx:  0, cz: -21, base: 8, length: 8, height: 1.6, thick: 0.4, mat: 'slate',
    window: { width: 5, height: 0.8, sill: 0.6 } },                                          // N parapet slit
  { t: 'wall', axis: 'x', cx:  0, cz: -13, base: 8, length: 8, height: 1.6, thick: 0.4, mat: 'slate',
    door: { width: 5.0, height: 1.6 } },                                                     // S parapet (inner stair landing)
  { t: 'wall', axis: 'z', cx: -4, cz: -17, base: 8, length: 8, height: 1.6, thick: 0.4, mat: 'slate',
    window: { width: 5, height: 0.8, sill: 0.6 } },                                          // W parapet slit
  { t: 'wall', axis: 'z', cx:  4, cz: -17, base: 8, length: 8, height: 1.6, thick: 0.4, mat: 'slate',
    door: { width: 4.0, height: 1.6 } },                                                     // E parapet (CATWALK_HE landing)

  // CATWALK_HE — high catwalk bridging HILLTOP east face (x=4, y=8) to a
  // point above FOUNDRY_ROOF. y=8 (flush with HILLTOP top). Player can
  // either drop off the east end onto FOUNDRY_ROOF at y=4 (one-way commit)
  // or climb back up via the FOUNDRY_ROOF → CATWALK_HE stair (below).
  // Clad in IRON (industrial walkway bridging citadel + foundry — visually
  // signals the foundry zone is forged metal vs the citadel's hewn stone).
  // Named: the harness anchors flush + abut assertions on this id.
  { t: 'box', id: 'CATWALK_HE', cx: 10, cz: -17, base: 7.4, sx: 12, sy: 0.6, sz: 4, mat: 'iron' },
  // FOUNDRY_ROOF → CATWALK_HE stair. Closes the main flow loop:
  //   GROUND → CITADEL_BASE → HILLTOP → CATWALK_HE → FOUNDRY_ROOF →
  //   GROUND (foundry external stair) → repeat. The wedge lands on the
  //   foundry roof at x=20 (well east of CATWALK_HE's east edge x=16),
  //   so the catwalk drop-zone and the climb-up are spatially separated.
  { t: 'stairsTo', to: 'CATWALK_HE', side: '+x', run: 4, width: 5, fromY: 4, steps: 8 },

  // =====================================================================
  // THE FOUNDRY — east industrial hall. Long two-room enclosed building
  // with an internal partition + walkable roof. Ground floor is tight CQC
  // (shotgun pickup in the west room); roof is mid-tier mezzanine.
  // =====================================================================
  // The FOUNDRY is clad in IRON throughout — riveted plate walls + roof
  // give it a distinctly industrial silhouette next to the citadel's stone.
  { t: 'platform', id: 'FOUNDRY_ROOF', cx: 22, cz: -15, top: 4, sx: 16, sz: 12, mat: 'iron' },
  // Ground floor walls (enclose the interior).
  { t: 'wall', axis: 'x', cx: 22, cz: -21, length: 16, height: 3.4, thick: 0.5, mat: 'iron' },           // N solid (back)
  { t: 'wall', axis: 'x', cx: 22, cz:  -9, length: 16, height: 3.4, thick: 0.5, mat: 'iron',
    door: { width: 2.6, height: 2.8 } },                                                     // S front door
  { t: 'wall', axis: 'z', cx: 14, cz: -15, length: 12, height: 3.4, thick: 0.5, mat: 'iron',
    door: { width: 2.6, height: 2.8 } },                                                     // W flank door (faces citadel)
  { t: 'wall', axis: 'z', cx: 30, cz: -15, length: 12, height: 3.4, thick: 0.5, mat: 'iron',
    window: { width: 4.0, height: 1.0, sill: 1.2 } },                                        // E slit (stair side)
  { t: 'wall', axis: 'z', cx: 22, cz: -15, length: 12, height: 3.4, thick: 0.4, mat: 'iron',
    door: { width: 2.2, height: 2.6 } },                                                     // interior partition (W/E rooms)
  // External stair to FOUNDRY_ROOF — east face (clear of citadel).
  { t: 'stairsTo', to: 'FOUNDRY_ROOF', side: '+x', run: 8, width: 5, fromY: 0, steps: 8 },
  // Roof parapets.
  { t: 'wall', axis: 'x', cx: 22, cz: -21, base: 4, length: 16, height: 1.6, thick: 0.4, mat: 'iron',
    window: { width: 8, height: 0.8, sill: 0.6 } },                                          // N parapet (window toward vault)
  { t: 'wall', axis: 'x', cx: 22, cz:  -9, base: 4, length: 16, height: 1.6, thick: 0.4, mat: 'iron',
    window: { width: 8, height: 0.8, sill: 0.6 } },                                          // S parapet
  { t: 'wall', axis: 'z', cx: 14, cz: -15, base: 4, length: 12, height: 1.6, thick: 0.4, mat: 'iron',
    door: { width: 4.0, height: 1.6 } },                                                     // W parapet (CATWALK_HE drop zone)
  { t: 'wall', axis: 'z', cx: 30, cz: -15, base: 4, length: 12, height: 1.6, thick: 0.4, mat: 'iron',
    door: { width: 5.2, height: 1.6 } },                                                     // E parapet (stair landing)

  // =====================================================================
  // THE VAULT — north blockhouse. Two interior rooms, walkable roof,
  // reached at ground via 2 doors (S front, W flank) and on top via an
  // external east-side ramp. The "tight" zone of the map.
  // =====================================================================
  // The VAULT is clad in SLATE to match the citadel — they're both stone
  // strongholds. (The foundry's iron differentiates the east sector.)
  { t: 'platform', id: 'VAULT_ROOF', cx: 0, cz: -45, top: 4, sx: 18, sz: 12, mat: 'slate' },
  // Ground floor walls.
  { t: 'wall', axis: 'x', cx:  0, cz: -51, length: 18, height: 3.4, thick: 0.5, mat: 'slate' },           // N solid (back)
  { t: 'wall', axis: 'x', cx:  0, cz: -39, length: 18, height: 3.4, thick: 0.5, mat: 'slate',
    door: { width: 2.6, height: 2.8 } },                                                     // S front door
  { t: 'wall', axis: 'z', cx: -9, cz: -45, length: 12, height: 3.4, thick: 0.5, mat: 'slate',
    door: { width: 2.6, height: 2.8 } },                                                     // W flank door
  // East side: ground ramp lands here on a 6 m-wide span at cz∈[-48,-42];
  // the gaps at cz∈[-51,-48] and cz∈[-42,-39] are closed by two short
  // wall segments so the foundry interior isn't open on the east face.
  { t: 'wall', axis: 'z', cx:  9, cz: -49.5, length: 3, height: 3.4, thick: 0.5, mat: 'slate' },
  { t: 'wall', axis: 'z', cx:  9, cz: -40.5, length: 3, height: 3.4, thick: 0.5, mat: 'slate' },
  // External ramp UP to VAULT_ROOF — east face.
  { t: 'rampTo', to: 'VAULT_ROOF', side: '+x', run: 10, width: 6, fromY: 0 },
  // Roof parapets.
  { t: 'wall', axis: 'x', cx:  0, cz: -51, base: 4, length: 18, height: 1.6, thick: 0.4, mat: 'slate',
    window: { width: 10, height: 0.8, sill: 0.5 } },                                         // N parapet
  { t: 'wall', axis: 'x', cx:  0, cz: -39, base: 4, length: 18, height: 1.6, thick: 0.4, mat: 'slate',
    window: { width: 10, height: 0.8, sill: 0.5 } },                                         // S parapet
  { t: 'wall', axis: 'z', cx: -9, cz: -45, base: 4, length: 12, height: 1.6, thick: 0.4, mat: 'slate',
    window: { width: 6, height: 0.8, sill: 0.5 } },                                          // W parapet
  { t: 'wall', axis: 'z', cx:  9, cz: -45, base: 4, length: 12, height: 1.6, thick: 0.4, mat: 'slate',
    door: { width: 5.2, height: 1.6 } },                                                     // E parapet (ramp landing)
  // Roof cover crates.
  { t: 'box', cx: -4, cz: -47, base: 4, sx: 1.8, sy: 1.0, sz: 1.6 },
  { t: 'box', cx:  4, cz: -43, base: 4, sx: 1.8, sy: 1.0, sz: 1.6 },

  // =====================================================================
  // THE TERRACE — south open elevated plaza. Wide platform at y=3,
  // exposed from spawn and the citadel, reached by 2 wing ramps (W + E)
  // and an explicit N parapet doorway facing the citadel.
  // =====================================================================
  // TERRACE is clad in SANDSTONE — warm, weathered, distinctly different
  // from the citadel's cool slate. A clear visual contrast across the map.
  { t: 'platform', id: 'TERRACE', cx: 0, cz: 30, top: 3, sx: 22, sz: 10, mat: 'sandstone' },
  { t: 'rampTo', to: 'TERRACE', side: '-x', run: 7, width: 5, fromY: 0 },                    // W wing ramp
  { t: 'rampTo', to: 'TERRACE', side: '+x', run: 7, width: 5, fromY: 0 },                    // E wing ramp
  { t: 'rampTo', to: 'TERRACE', side: '-z', run: 8, width: 6, fromY: 0 },                    // N ramp (faces spawn/citadel)
  // Terrace parapets (front-facing N has the ramp doorway, others are window-slit).
  { t: 'wall', axis: 'x', cx: 0, cz: 25, base: 3, length: 22, height: 1.6, thick: 0.4, mat: 'sandstone',
    door: { width: 6.0, height: 1.6 } },                                                     // N parapet (N ramp landing)
  { t: 'wall', axis: 'x', cx: 0, cz: 35, base: 3, length: 22, height: 1.6, thick: 0.4, mat: 'sandstone',
    window: { width: 12, height: 0.8, sill: 0.5 } },                                         // S parapet
  // Terrace cover crates (low cover for combat on the deck).
  { t: 'box', cx:  6, cz: 30, base: 3, sx: 1.8, sy: 1.0, sz: 1.8 },
  { t: 'box', cx: -6, cz: 30, base: 3, sx: 1.8, sy: 1.0, sz: 1.8 },

  // =====================================================================
  // THE COLONNADE — west sector. A row of 4 stand-alone Quake-style
  // columns + an elevated WEST_RAMPART walkway behind them. The columns
  // break sightlines along the west axis (every ~13 m). Tactical use:
  // weave between columns at ground for SAW pickup contests, or climb
  // the rampart for height advantage. The columns rise above the
  // rampart (y=7 column top vs y=5 rampart top) for visual rhythm.
  // =====================================================================
  // Columns are NOT walkable — they're decorative pillars that block sight-
  // lines, not platforms. Implemented as `wall` solids (axis-agnostic since
  // length==thick==4) so the reachability BFS doesn't count their tops as
  // stranded surfaces. Visual: tall 4 m × 4 m × 7 m square pillars in a
  // row down the west sector.
  // Columns: massive worn sandstone pillars. The yellow-warm palette
  // makes them pop against the green ground.
  { t: 'wall', axis: 'x', cx: -48, cz: -20, length: 4, height: 7, thick: 4, mat: 'sandstone' },   // Col 1 (N) — opposite VAULT/CITADEL_BASE
  { t: 'wall', axis: 'x', cx: -48, cz:  -7, length: 4, height: 7, thick: 4, mat: 'sandstone' },   // Col 2 — between citadel and rampart N end
  { t: 'wall', axis: 'x', cx: -48, cz:   7, length: 4, height: 7, thick: 4, mat: 'sandstone' },   // Col 3 — between rampart S and terrace level
  { t: 'wall', axis: 'x', cx: -48, cz:  20, length: 4, height: 7, thick: 4, mat: 'sandstone' },   // Col 4 (S) — opposite TERRACE west wing
  // WEST_RAMPART — long thin elevated walkway running N-S along the
  // west sector. Top at y=5 (1 m above terrace, 1 m below FOUNDRY_ROOF).
  // Sandstone — same family as the columns it overlooks.
  { t: 'platform', id: 'WEST_RAMPART', cx: -30, cz: 0, top: 5, sx: 8, sz: 24, mat: 'sandstone' },
  { t: 'rampTo', to: 'WEST_RAMPART', side: '+x', run: 7, width: 5, fromY: 0 },               // E ramp (faces plaza)
  // Rampart parapets.
  { t: 'wall', axis: 'z', cx: -34, cz: 0, base: 5, length: 24, height: 1.6, thick: 0.4, mat: 'sandstone',
    window: { width: 14, height: 0.9, sill: 0.5 } },                                         // W parapet (overlooks columns)
  { t: 'wall', axis: 'x', cx: -30, cz: -12, base: 5, length: 8, height: 1.6, thick: 0.4, mat: 'sandstone',
    window: { width: 4, height: 0.9, sill: 0.5 } },                                          // N parapet
  { t: 'wall', axis: 'x', cx: -30, cz:  12, base: 5, length: 8, height: 1.6, thick: 0.4, mat: 'sandstone',
    window: { width: 4, height: 0.9, sill: 0.5 } },                                          // S parapet
  // Rampart cover.
  { t: 'box', cx: -30, cz: -6, base: 5, sx: 1.8, sy: 1.0, sz: 1.6 },
  { t: 'box', cx: -30, cz:  6, base: 5, sx: 1.8, sy: 1.0, sz: 1.6 },

  // =====================================================================
  // OVERHANG — citadel east balcony. A sloped slab cantilevering east
  // from CITADEL_BASE's east face. Decorative + tactical: low underside
  // creates an awning the player walks under at ground level, so the
  // citadel east approach has overhead cover (visually echoes Quake's
  // habit of cantilevered industrial fixtures).
  // =====================================================================
  { t: 'overhang', axis: 'x',
    loPos: 12, hiPos: 8, loY: 2.6, hiY: 4.0,
    c0: -12, c1: -8, thick: 0.4 },

  // =====================================================================
  // RUNE SENTINELS — two glowing rune-marked monoliths flanking the S
  // grand ramp at its foot, telegraphing "you are entering the citadel".
  // Built as `wall` entries (square footprint 1.4×1.4, height 2.5 m) so
  // they don't register as walkable surfaces. The emissive rune material
  // gives them an amber glow visible from the entire south plaza.
  // =====================================================================
  { t: 'wall', axis: 'x', cx: -5, cz: 4, length: 1.4, height: 2.5, thick: 1.4, mat: 'rune' },
  { t: 'wall', axis: 'x', cx:  5, cz: 4, length: 1.4, height: 2.5, thick: 1.4, mat: 'rune' },

  // =====================================================================
  // PLAZA COVER — scattered low boxes around spawn anchors and the open
  // plaza. Each spawn anchor gets one cover crate adjacent; the mid-plaza
  // pieces break the long N-S spawn-to-vault corridor. Cover height 1.0 m
  // (duckable, peekable, jumpable). cz ranges: spawn area cz≈0,
  // mid-plaza cz∈[-25,-10], outer plaza cz∈[10,20].
  // =====================================================================
  // Anchor cover.
  { t: 'box', cx:  -3, cz:   8, sx: 2.0, sy: 1.0, sz: 2.0 },           // C anchor (south-west of spawn)
  { t: 'box', cx:  -4, cz: -32, sx: 2.4, sy: 1.0, sz: 2.0 },           // N anchor (offset off the N stair axis)
  { t: 'box', cx:  24, cz:   5, sx: 2.0, sy: 1.0, sz: 2.4 },           // E anchor
  { t: 'box', cx:   0, cz:  22, sx: 2.4, sy: 1.0, sz: 2.0 },           // S anchor (north of terrace)
  { t: 'box', cx: -22, cz:   0, sx: 2.0, sy: 1.0, sz: 2.4 },           // W anchor
  // Mid-plaza cover (north corridor — between spawn and N anchor).
  { t: 'box', cx:  10, cz: -28, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx: -10, cz: -28, sx: 2.0, sy: 1.0, sz: 2.0 },
  // East corridor between citadel and foundry.
  { t: 'box', cx:  14, cz:  -2, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx:  18, cz:  10, sx: 2.0, sy: 1.0, sz: 2.0 },
  // West corridor between citadel and colonnade. (-16,-20) pulls clear of
  // the W stair sample line at z=-15 so seam continuity isn't broken.
  { t: 'box', cx: -16, cz: -20, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx: -38, cz:  -2, sx: 2.0, sy: 1.0, sz: 2.0 },
  // South open plaza between terrace and citadel S ramp foot.
  { t: 'box', cx:  10, cz:  12, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx: -10, cz:  12, sx: 2.0, sy: 1.0, sz: 2.0 },
];

// --- PICKUPS ---
// S55g distribution. 4 weapons, each tied to its zone's combat range:
//   sniper   — HILLTOP top (y=8). The risk/reward power weapon.
//   shotgun  — Under CATWALK_HE (y=0). Tight zone hemmed in by citadel
//              east face + the catwalk overhead; perfect for CQC pickup
//              contests because the catwalk drop-zone is right above.
//   smg      — VAULT_ROOF (y=4). Mid-range, central blockhouse cover.
//   saw      — COLONNADE ground (y=0). Close-quarters between columns.
// 8 health packs distributed: 4 ground (one per cardinal quadrant) +
// 4 elevated (one per accessible elevated landmark).
//
// Why no pickup INSIDE a roofed building: the harness verifies each
// pickup's y matches groundHeightAt at its (x,z), but groundHeightAt
// returns the HIGHEST walkable surface, which means a pickup under a
// roofed deck would clash with the deck above. Every pickup is therefore
// on a surface with open sky above.
export const PICKUPS = [
  // Weapons.
  { kind: 'weapon', what: 'sniper',  x:   0, z: -17, y: 8.0 },         // HILLTOP perch
  { kind: 'weapon', what: 'shotgun', x:  22, z: -12, y: 4.0 },         // FOUNDRY_ROOF center (clear of CATWALK_HE shadow and the new stair)
  { kind: 'weapon', what: 'smg',     x:   0, z: -45, y: 4.0 },         // VAULT_ROOF center
  { kind: 'weapon', what: 'saw',     x: -48, z:   0, y: 0.0 },         // COLONNADE ground (between cols 2 & 3)
  // Ground health — one per cardinal-ish quadrant.
  { kind: 'health', x:  18, z: -28, y: 0 },                            // NE plaza
  { kind: 'health', x: -18, z: -28, y: 0 },                            // NW plaza
  { kind: 'health', x:  18, z:  18, y: 0 },                            // SE plaza
  { kind: 'health', x: -18, z:  18, y: 0 },                            // SW plaza
  // Deck health — one per accessible elevated landmark.
  { kind: 'health', x:   0, z:  -7, y: 4.0 },                          // CITADEL_BASE mezzanine (S edge, by S parapet door)
  { kind: 'health', x:   0, z:  33, y: 3.0 },                          // TERRACE (S half)
  { kind: 'health', x: -30, z:   0, y: 5.0 },                          // WEST_RAMPART center
];
