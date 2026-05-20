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
  // BARRACKS (NE industrial hall, S55j).
  { x:  42, z: -31, axis: 'x' },   // S front door
  { x:  42, z: -36, axis: 'z' },   // interior partition
  // WATCHTOWER (NW sentinel tower, S55j).
  { x: -42, z: -28, axis: 'x' },   // S front door
  // SOUTH_KEEP (far-south bastion, S55k).
  { x:   0, z: 50, axis: 'x' },    // N front door
  { x: -12, z: 55, axis: 'z' },    // W flank door
  { x:   0, z: 55, axis: 'z' },    // interior partition
  // EAST_TOWER (far-east watchtower, S55k).
  { x:  51, z:  0, axis: 'z' },    // W front door
];

// S55j: Arena-mode enemy spawn points scattered across the WHOLE MAP so
// new enemies pop up from every corner — not just on a ring around the
// player (the wave-mode pickSpawnPoint() behaviour). Each point is on
// open ground (groundHeightAt = 0), spaced ≥ 18 m apart, well clear of
// every building footprint. enemies.js's pickArenaSpawnPoint() picks
// from this list with player-distance + view-cone + recent-spawn
// avoidance, ensuring distribution + good combat pacing.
//
// Distribution covers all 8 compass directions (4 cardinals + 4
// diagonals) plus 4 mid-distance points, for 12 total. Open-area
// fallbacks every quadrant means even when 3 are gated out by the
// avoidance heuristics, at least 1 is always usable.
export const ENEMY_SPAWN_POINTS = [
  // Cardinals at the perimeter (clear of the new corner buildings).
  { x:   0, z: -55 },                                                   // far N (behind VAULT)
  { x:  45, z:   8 },                                                   // E (south of EAST_TOWER, open ground)
  { x: -18, z:  43 },                                                   // S (NW of SOUTH_KEEP, open ground)
  { x: -55, z:   0 },                                                   // far W (west of COLONNADE)
  // Diagonal corners.
  { x:  52, z: -52 },                                                   // NE corner (past BARRACKS)
  { x: -52, z: -52 },                                                   // NW corner (past WATCHTOWER)
  { x:  52, z:  52 },                                                   // SE corner (past MARKET)
  { x: -52, z:  52 },                                                   // SW corner (past RUINS)
  // Mid-distance points filling gaps.
  { x:  20, z: -32 },                                                   // between FOUNDRY + BARRACKS
  { x: -25, z: -18 },                                                   // between CITADEL + WATCHTOWER
  { x:  25, z:  18 },                                                   // between FOUNDRY + MARKET
  { x: -22, z:  22 },                                                   // between TERRACE + RUINS
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
  { t: 'wall', axis: 'z', cx: -8, cz: -17.5, base: 4, length: 11, height: 1.6, thick: 0.4, mat: 'slate',
    door: { width: 5.2, height: 1.6, offset: 2.5 } },                                       // W parapet (W stair landing) — shortened to z=[-23,-12] to leave the BRIDGE_W gap at z=[-12,-7]
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

  // THE SPIRE — y=14 marble obelisk above HILLTOP. Sits as a 4×4 solid
  // block on top of HILLTOP (y=8 → 14), creating the map's tallest
  // landmark visible from anywhere. The sniper pickup lives on top of the
  // SPIRE, accessible ONLY via the south-plaza teleporter — no walkable
  // route from HILLTOP up (6 m delta, too tall for duck-jump). This is the
  // map's premier commitment beat: enter the portal at ground level,
  // pop out 14 m up with no easy retreat except a long fall.
  { t: 'platform', id: 'SPIRE', cx: 0, cz: -17, top: 14, sx: 4, sz: 4, thick: 6, mat: 'marble' },
  // Spire crown parapets — slate slits on all 4 sides. Door-style aperture
  // height equals wall height so the sniper has clear sightlines through
  // every face from the perch's center.
  { t: 'wall', axis: 'x', cx: 0, cz: -19, base: 14, length: 4, height: 1.2, thick: 0.3, mat: 'slate',
    window: { width: 2.6, height: 0.7, sill: 0.4 } },
  { t: 'wall', axis: 'x', cx: 0, cz: -15, base: 14, length: 4, height: 1.2, thick: 0.3, mat: 'slate',
    window: { width: 2.6, height: 0.7, sill: 0.4 } },
  { t: 'wall', axis: 'z', cx: -2, cz: -17, base: 14, length: 4, height: 1.2, thick: 0.3, mat: 'slate',
    window: { width: 2.6, height: 0.7, sill: 0.4 } },
  { t: 'wall', axis: 'z', cx:  2, cz: -17, base: 14, length: 4, height: 1.2, thick: 0.3, mat: 'slate',
    window: { width: 2.6, height: 0.7, sill: 0.4 } },

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

  // =====================================================================
  // FOUNDRY interior — small wood cover crates so the two-room CQC fight
  // has angles. Diagonally placed in each room (NW + SE of room center),
  // clear of every doorway aperture so AI routing doesn't catch on them.
  // sy=0.9 → jump-mountable from the ground (within JUMP_MOUNT=0.95).
  // =====================================================================
  { t: 'box', cx: 17, cz: -11, base: 0, sx: 1.4, sy: 0.9, sz: 1.4 },   // W room NW
  { t: 'box', cx: 19, cz: -19, base: 0, sx: 1.4, sy: 0.9, sz: 1.4 },   // W room SE
  { t: 'box', cx: 25, cz: -11, base: 0, sx: 1.4, sy: 0.9, sz: 1.4 },   // E room NW
  { t: 'box', cx: 27, cz: -19, base: 0, sx: 1.4, sy: 0.9, sz: 1.4 },   // E room SE

  // =====================================================================
  // BRIDGE_W — west loop closer. An iron-plate elevated bridge spanning
  // the gap between WEST_RAMPART east edge (x=-26, top=5) and the
  // CITADEL_BASE west edge (x=-8, top=4). Bridge top y=4.5 is exactly
  // halfway: 0.5 m below the rampart, 0.5 m above the citadel — both
  // within STEP_UP (0.55 m) so the BFS counts both ends as walkable
  // routes, closing the WEST flow loop:
  //   GROUND → WEST_RAMPART (E ramp) → BRIDGE_W (step down) → CITADEL_BASE
  //   (step down) → GROUND (any citadel ramp/stair) → repeat.
  // The bridge attaches at the citadel's NW area (z=-11 to -7) where
  // the W parapet was shortened to leave an open gap. No new doorway
  // required.
  // =====================================================================
  { t: 'box', id: 'BRIDGE_W', cx: -17, cz: -9, base: 3.9, sx: 18, sy: 0.6, sz: 4, mat: 'iron' },
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
  // TELEPORTERS — Quake-style portal pairs. Two one-way portals introduce
  // movement mechanics no other route in the map provides:
  //
  //   TELE_SPIRE: south plaza (visible from spawn) → SPIRE top.
  //     Vertical 14 m leap. The portal stands as a glowing magenta gate
  //     7 m east of the citadel grand ramp. Only way to reach the SPIRE
  //     where the sniper lives.
  //
  //   TELE_TUNNEL: inside the VAULT east room → colonnade ground.
  //     ~50 m horizontal hop across the map. An escape route for cornered
  //     vault defenders, or a fast offensive pivot from N to W.
  //
  // Trigger AABBs are vertical (sy=3) so jumping through them still fires;
  // visible mesh = the trigger box rendered with additive-blended portal
  // texture. Cooldown 0.3 s in teleporters.js prevents re-trigger loops.
  // =====================================================================
  { t: 'teleporter', id: 'TELE_SPIRE',
    from: { cx:  6, cz: 12, y: 0, sx: 2, sy: 3, sz: 2 },
    to:   { x:  0, z: -17, y: 14, yaw: Math.PI } },                                // facing south, looking down at the citadel + map
  { t: 'teleporter', id: 'TELE_TUNNEL',
    from: { cx:  5, cz: -46, y: 0, sx: 2, sy: 3, sz: 2 },
    to:   { x: -46, z:   0, y:  0, yaw: -Math.PI / 2 } },                          // facing west, into the colonnade
  // S55k: two more teleporters wire the map's far corners to its core.
  { t: 'teleporter', id: 'TELE_SOUTH_TO_FOUNDRY',
    from: { cx: -8, cz: 46, y: 0, sx: 2, sy: 3, sz: 2 },
    to:   { x:  22, z: -15, y: 4, yaw: 0 } },                                      // SOUTH_KEEP approach → FOUNDRY_ROOF center, facing north
  { t: 'teleporter', id: 'TELE_EAST_TO_RAMPART',
    from: { cx: 55, cz: 22, y: 0, sx: 2, sy: 3, sz: 2 },
    to:   { x: -30, z:  0, y:  5, yaw: -Math.PI / 2 } },                           // EAST_TOWER approach → WEST_RAMPART top, facing west
  // S55n: SPIRE return portal — solves the "stuck up top" problem. The
  // TELE_SPIRE drops the player at (0,14,-17); this return portal sits
  // at the SPIRE deck's NW corner (-1.5, 14, -18.5) which is OUTSIDE
  // the TELE_SPIRE destination AABB, so it doesn't fire on arrival.
  // Returns the player to the south plaza, slightly east of TELE_SPIRE's
  // source so the loop reads as a circuit.
  { t: 'teleporter', id: 'TELE_SPIRE_RETURN',
    from: { cx: -1.5, cz: -18.5, y: 14, sx: 1.5, sy: 1.8, sz: 1.5 },
    to:   { x: 10, z:   16, y:   0, yaw: 0 } },                                    // back to south plaza, facing north
  // S55n: FOUNDRY → SOUTH_KEEP cross-map shortcut so the eastern and
  // southern flanks share a fast lane.
  { t: 'teleporter', id: 'TELE_FOUNDRY_TO_SOUTH',
    from: { cx: 30, cz:  -3, y: 0, sx: 2, sy: 3, sz: 2 },
    to:   { x: -8, z:  53, y:   0, yaw: 0 } },                                     // outside FOUNDRY SE corner → SOUTH_KEEP west flank approach

  // =====================================================================
  // TORCHES — wall-mounted flickering flames at every building entry.
  // Each torch is a tiny wood pole + glowing tip + warm point light
  // (range 11 m). Flicker animates intensity ±20 % via sin/cos noise.
  // Placement traces the player's natural approach to each entry:
  //   - VAULT S door
  //   - FOUNDRY S door
  //   - TERRACE N approach
  //   - COLONNADE north + south column bases
  //   - SPIRE base (HILLTOP top, flanking the spire)
  // =====================================================================
  // S55o: culled 19 torches down to 5 (one per major outer-building
  // entry). Every torch is a PointLight; with 9 floodlights + 2 rune
  // sentinels + 4 braziers already in the scene, 19 extras pushed
  // total point-light count past where the Standard material's
  // fragment shader runs cheaply. Each torch now centers on its
  // doorway rather than flanking it as a pair.
  { t: 'torch', x:  0,   y: 0, z: -37.5 },   // VAULT S door (centered)
  { t: 'torch', x: 22.0, y: 0, z:  -8.0 },   // FOUNDRY S door (centered)
  { t: 'torch', x: 42.0, y: 0, z: -30.0 },   // BARRACKS S door (centered)
  { t: 'torch', x:-42.0, y: 0, z: -27.0 },   // WATCHTOWER S door (centered)
  { t: 'torch', x:  0,   y: 0, z:  51.0 },   // SOUTH_KEEP N door (centered)

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
  // THE BARRACKS — NE quadrant industrial 2-room hall, iron-clad, walkable
  // roof at y=4. Mirrors the FOUNDRY's industrial silhouette but at a
  // different scale and placed where the map was previously empty.
  // External stair on east face to the roof.
  // =====================================================================
  { t: 'platform', id: 'BARRACKS_ROOF', cx: 42, cz: -36, top: 4, sx: 14, sz: 10, mat: 'iron' },
  // Ground floor walls.
  { t: 'wall', axis: 'x', cx: 42, cz: -41, length: 14, height: 3.4, thick: 0.5, mat: 'iron' },               // N back
  { t: 'wall', axis: 'x', cx: 42, cz: -31, length: 14, height: 3.4, thick: 0.5, mat: 'iron',
    door: { width: 2.6, height: 2.8 } },                                                     // S front door
  { t: 'wall', axis: 'z', cx: 35, cz: -36, length: 10, height: 3.4, thick: 0.5, mat: 'iron',
    window: { width: 4.0, height: 1.0, sill: 1.2 } },                                        // W flank slit
  { t: 'wall', axis: 'z', cx: 49, cz: -36, length: 10, height: 3.4, thick: 0.5, mat: 'iron',
    window: { width: 4.0, height: 1.0, sill: 1.2 } },                                        // E flank slit (stair side)
  { t: 'wall', axis: 'z', cx: 42, cz: -36, length: 10, height: 3.4, thick: 0.4, mat: 'iron',
    door: { width: 2.2, height: 2.6 } },                                                     // interior partition
  // External stair to roof — east face.
  { t: 'stairsTo', to: 'BARRACKS_ROOF', side: '+x', run: 7, width: 5, fromY: 0, steps: 7 },
  // Roof parapets.
  { t: 'wall', axis: 'x', cx: 42, cz: -41, base: 4, length: 14, height: 1.6, thick: 0.4, mat: 'iron',
    window: { width: 8, height: 0.8, sill: 0.6 } },
  { t: 'wall', axis: 'x', cx: 42, cz: -31, base: 4, length: 14, height: 1.6, thick: 0.4, mat: 'iron',
    window: { width: 8, height: 0.8, sill: 0.6 } },
  { t: 'wall', axis: 'z', cx: 35, cz: -36, base: 4, length: 10, height: 1.6, thick: 0.4, mat: 'iron',
    window: { width: 6, height: 0.8, sill: 0.6 } },
  { t: 'wall', axis: 'z', cx: 49, cz: -36, base: 4, length: 10, height: 1.6, thick: 0.4, mat: 'iron',
    door: { width: 5.2, height: 1.6 } },                                                     // E parapet (stair landing)

  // =====================================================================
  // THE WATCHTOWER — NW quadrant slate sentinel tower. 8×8 single-room
  // building, walkable roof at y=4. Three slit-window walls + a front
  // door. East-facing external stair. Roof has slit parapets for
  // sniping over the colonnade and into the citadel ramp area.
  // =====================================================================
  { t: 'platform', id: 'WATCHTOWER_ROOF', cx: -42, cz: -32, top: 4, sx: 8, sz: 8, mat: 'slate' },
  // Ground floor walls.
  { t: 'wall', axis: 'x', cx: -42, cz: -36, length: 8, height: 3.4, thick: 0.5, mat: 'slate',
    window: { width: 3.0, height: 0.9, sill: 1.5 } },                                        // N slit
  { t: 'wall', axis: 'x', cx: -42, cz: -28, length: 8, height: 3.4, thick: 0.5, mat: 'slate',
    door: { width: 2.4, height: 2.8 } },                                                     // S front door
  { t: 'wall', axis: 'z', cx: -46, cz: -32, length: 8, height: 3.4, thick: 0.5, mat: 'slate',
    window: { width: 3.0, height: 0.9, sill: 1.5 } },                                        // W slit
  { t: 'wall', axis: 'z', cx: -38, cz: -32, length: 8, height: 3.4, thick: 0.5, mat: 'slate',
    window: { width: 3.0, height: 0.9, sill: 1.5 } },                                        // E slit (stair side)
  // External stair to roof — east face.
  { t: 'stairsTo', to: 'WATCHTOWER_ROOF', side: '+x', run: 7, width: 5, fromY: 0, steps: 7 },
  // Roof parapets — slit walls on all 4 sides (defensive lookout).
  { t: 'wall', axis: 'x', cx: -42, cz: -36, base: 4, length: 8, height: 1.6, thick: 0.4, mat: 'slate',
    window: { width: 5, height: 0.9, sill: 0.5 } },
  { t: 'wall', axis: 'x', cx: -42, cz: -28, base: 4, length: 8, height: 1.6, thick: 0.4, mat: 'slate',
    window: { width: 5, height: 0.9, sill: 0.5 } },
  { t: 'wall', axis: 'z', cx: -46, cz: -32, base: 4, length: 8, height: 1.6, thick: 0.4, mat: 'slate',
    window: { width: 5, height: 0.9, sill: 0.5 } },
  { t: 'wall', axis: 'z', cx: -38, cz: -32, base: 4, length: 8, height: 1.6, thick: 0.4, mat: 'slate',
    door: { width: 5.2, height: 1.6 } },                                                     // E parapet (stair landing)

  // =====================================================================
  // THE RUINS — SW quadrant collection of broken sandstone walls + a
  // partially-collapsed overhang slab. No roof, no platform — pure cover
  // geometry. Walls are reduced height (1.8 m, like broken arches) so the
  // player crouches behind / vaults over them. Reads as a once-grand
  // structure now reclaimed by time, in contrast to the freshly-built
  // BARRACKS and WATCHTOWER.
  // =====================================================================
  { t: 'wall', axis: 'x', cx: -32, cz: 27, length: 12, height: 1.8, thick: 0.6, mat: 'sandstone' },          // N arc (broken)
  { t: 'wall', axis: 'z', cx: -38, cz: 32, length: 10, height: 1.8, thick: 0.6, mat: 'sandstone',
    window: { width: 3, height: 0.5, sill: 1.0 } },                                                          // W broken wall w/ opening
  { t: 'wall', axis: 'x', cx: -32, cz: 37, length: 8, height: 1.4, thick: 0.6, mat: 'sandstone' },           // S low remnant
  { t: 'wall', axis: 'z', cx: -26, cz: 30, length: 6, height: 1.6, thick: 0.6, mat: 'sandstone' },           // partial E wall
  // Half-collapsed roof slab cantilevering inward.
  { t: 'overhang', axis: 'z', loPos: 30, hiPos: 27, loY: 2.4, hiY: 3.4, c0: -36, c1: -28, thick: 0.4 },
  // Rubble — small ground crates as collapsed debris.
  { t: 'box', cx: -34, cz: 33, base: 0, sx: 1.6, sy: 1.0, sz: 1.6 },
  { t: 'box', cx: -28, cz: 35, base: 0, sx: 1.4, sy: 0.8, sz: 1.4 },

  // =====================================================================
  // THE MARKET — SE quadrant open-air covered stalls. Two L-shaped
  // sandstone walls plus an awning overhang create a covered courtyard
  // the player can fight through. No walkable roof. Designed as a CQC
  // cover zone for the SE plaza — balances the SW RUINS without being
  // visually identical.
  // =====================================================================
  { t: 'wall', axis: 'x', cx: 35, cz: 37, length: 12, height: 2.6, thick: 0.5, mat: 'sandstone' },           // N back wall (taller)
  { t: 'wall', axis: 'z', cx: 41, cz: 33, length: 10, height: 2.6, thick: 0.5, mat: 'sandstone' },           // E side wall
  { t: 'wall', axis: 'x', cx: 33, cz: 27, length: 6, height: 1.8, thick: 0.5, mat: 'sandstone' },            // partial S counter wall
  // Awning slab covering the stall interior.
  { t: 'overhang', axis: 'z', loPos: 30, hiPos: 36, loY: 2.4, hiY: 2.6, c0: 30, c1: 40, thick: 0.4 },
  // Market crate stalls.
  { t: 'box', cx: 36, cz: 32, base: 0, sx: 1.6, sy: 0.9, sz: 1.6 },
  { t: 'box', cx: 32, cz: 34, base: 0, sx: 1.4, sy: 0.7, sz: 2.6 },

  // =====================================================================
  // THE SOUTH KEEP — far-south slate bastion. The map's southernmost
  // landmark, balancing VAULT's mass at the north. Two-level access:
  // ground-floor 24×10 hall with N front door + W flank door + interior
  // partition, walkable roof at y=4. The roof has a sniper slit looking
  // back at the citadel — a long sightline across the whole map.
  // =====================================================================
  { t: 'platform', id: 'SOUTH_KEEP_ROOF', cx: 0, cz: 55, top: 4, sx: 24, sz: 10, mat: 'slate' },
  // Ground walls.
  { t: 'wall', axis: 'x', cx:  0, cz: 50, length: 24, height: 3.4, thick: 0.5, mat: 'slate',
    door: { width: 3.0, height: 2.8, offset: -6 } },                                         // N front door (W half)
  { t: 'wall', axis: 'x', cx:  0, cz: 60, length: 24, height: 3.4, thick: 0.5, mat: 'slate' },// S back wall (closed)
  { t: 'wall', axis: 'z', cx:-12, cz: 55, length: 10, height: 3.4, thick: 0.5, mat: 'slate',
    door: { width: 2.6, height: 2.8 } },                                                     // W flank door
  { t: 'wall', axis: 'z', cx: 12, cz: 55, length: 10, height: 3.4, thick: 0.5, mat: 'slate',
    window: { width: 4.0, height: 1.0, sill: 1.2 } },                                        // E flank slit (stair side)
  { t: 'wall', axis: 'z', cx:  0, cz: 55, length: 10, height: 3.4, thick: 0.4, mat: 'slate',
    door: { width: 2.6, height: 2.6 } },                                                     // interior partition
  // External stair on east face — lands on the roof.
  { t: 'stairsTo', to: 'SOUTH_KEEP_ROOF', side: '+x', run: 7, width: 5, fromY: 0, steps: 7 },
  // Roof parapets — N has a wide slit aimed at the citadel.
  { t: 'wall', axis: 'x', cx:  0, cz: 50, base: 4, length: 24, height: 1.6, thick: 0.4, mat: 'slate',
    window: { width: 16, height: 0.9, sill: 0.4 } },
  { t: 'wall', axis: 'x', cx:  0, cz: 60, base: 4, length: 24, height: 1.6, thick: 0.4, mat: 'slate',
    window: { width: 10, height: 0.8, sill: 0.5 } },
  { t: 'wall', axis: 'z', cx:-12, cz: 55, base: 4, length: 10, height: 1.6, thick: 0.4, mat: 'slate',
    window: { width: 6, height: 0.8, sill: 0.5 } },
  { t: 'wall', axis: 'z', cx: 12, cz: 55, base: 4, length: 10, height: 1.6, thick: 0.4, mat: 'slate',
    door: { width: 5.2, height: 1.6 } },                                                     // E parapet (stair landing)

  // =====================================================================
  // THE EAST TOWER — far-east slim sandstone watchtower. 8×8 footprint
  // with a slight height premium (roof y=5) versus the rest of the
  // map's y=4 standard, so it's the second-tallest landmark after the
  // SPIRE. Slit windows on N + S + E, front door on W. The tower's
  // east side abuts the perimeter wall — gives a "back-against-the-
  // edge" feel to combat there.
  // =====================================================================
  { t: 'platform', id: 'EAST_TOWER_ROOF', cx: 55, cz: 0, top: 5, sx: 8, sz: 8, mat: 'sandstone' },
  { t: 'wall', axis: 'x', cx: 55, cz: -4, length: 8, height: 4.4, thick: 0.5, mat: 'sandstone',
    window: { width: 3.0, height: 0.9, sill: 2.0 } },
  { t: 'wall', axis: 'x', cx: 55, cz:  4, length: 8, height: 4.4, thick: 0.5, mat: 'sandstone',
    window: { width: 3.0, height: 0.9, sill: 2.0 } },
  { t: 'wall', axis: 'z', cx: 51, cz:  0, length: 8, height: 4.4, thick: 0.5, mat: 'sandstone',
    door: { width: 2.4, height: 2.8 } },
  { t: 'wall', axis: 'z', cx: 59, cz:  0, length: 8, height: 4.4, thick: 0.5, mat: 'sandstone',
    window: { width: 3.0, height: 0.9, sill: 2.0 } },
  // External stair (north face this time, for variety).
  { t: 'stairsTo', to: 'EAST_TOWER_ROOF', side: '-z', run: 7, width: 5, fromY: 0, steps: 8 },
  // Roof parapets (slits on 3 sides + door on N for stair landing).
  { t: 'wall', axis: 'x', cx: 55, cz: -4, base: 5, length: 8, height: 1.6, thick: 0.4, mat: 'sandstone',
    door: { width: 5.2, height: 1.6 } },                                                     // N parapet (stair)
  { t: 'wall', axis: 'x', cx: 55, cz:  4, base: 5, length: 8, height: 1.6, thick: 0.4, mat: 'sandstone',
    window: { width: 5, height: 0.9, sill: 0.5 } },
  { t: 'wall', axis: 'z', cx: 51, cz:  0, base: 5, length: 8, height: 1.6, thick: 0.4, mat: 'sandstone',
    window: { width: 5, height: 0.9, sill: 0.5 } },
  { t: 'wall', axis: 'z', cx: 59, cz:  0, base: 5, length: 8, height: 1.6, thick: 0.4, mat: 'sandstone',
    window: { width: 5, height: 0.9, sill: 0.5 } },

  // =====================================================================
  // WEST_RUIN — far-west crumbling sandstone arch. Two tall partial
  // walls + a low remnant. No roof, no platform — visual landmark only
  // to anchor the colonnade's far west edge. Reads as a single arch in
  // a wasteland.
  // =====================================================================
  { t: 'wall', axis: 'z', cx: -58, cz: -4, length: 6, height: 3.6, thick: 0.7, mat: 'sandstone' },           // N pillar
  { t: 'wall', axis: 'z', cx: -58, cz:  4, length: 6, height: 3.6, thick: 0.7, mat: 'sandstone' },           // S pillar
  { t: 'wall', axis: 'x', cx: -58, cz:  0, length: 5, height: 1.5, thick: 0.4, mat: 'sandstone' },           // low arch base (broken)

  // =====================================================================
  // CENTRAL SHRINE — small rune-marked monument in the SE plaza near
  // the MARKET. Three short walls + a rune-slab accent wall + a low
  // brazier-sized overhang. Visual emissive accent piece; the rune wall
  // glows amber, drawing the eye into the SE corner.
  // =====================================================================
  { t: 'wall', axis: 'x', cx: 12, cz: 15, length: 5, height: 2.4, thick: 0.5, mat: 'sandstone' },            // N shrine wall
  { t: 'wall', axis: 'z', cx: 14.5, cz: 18, length: 6, height: 2.4, thick: 0.5, mat: 'sandstone' },          // E side
  { t: 'wall', axis: 'z', cx: 9.5, cz: 18, length: 6, height: 2.4, thick: 0.5, mat: 'sandstone' },           // W side
  // Rune-marked accent slab as the focal "altar" face.
  { t: 'wall', axis: 'x', cx: 12, cz: 17, length: 3, height: 1.8, thick: 0.5, mat: 'rune' },                 // glowing altar
  // Awning over the shrine.
  { t: 'overhang', axis: 'z', loPos: 15, hiPos: 21, loY: 2.4, hiY: 2.8, c0: 9, c1: 15, thick: 0.3 },

  // S55ab: GLOWPANES removed — the beige emissive rectangles in the window
  // slits read as floating boxes from outside instead of suggesting lit
  // interiors. Window apertures stay open; the wall punch-outs remain
  // (sill / lintel are part of the wall geometry, not the glowpane).
  // =====================================================================
  // BANNERS — hanging fabric flourish on every faction's front face.
  // Three tones: gold (citadel keep), crimson (slate strongholds: vault,
  // south keep), azure (iron-clad foundry + barracks). Pure decoration;
  // non-collider. Sized 1.4 × 3.0 m, hung from y≈0.3 so the bottom kisses
  // the ground and the top hits y=3.3 (under most building parapets).
  // =====================================================================
  // CITADEL_BASE south face — gold banners flanking the rune sentinels.
  { t: 'banner', x: -3.0, y: 0.3, z: -7.30, face: 'south', tone: 'gold' },
  { t: 'banner', x:  3.0, y: 0.3, z: -7.30, face: 'south', tone: 'gold' },
  // VAULT south face — crimson.
  { t: 'banner', x: -5.0, y: 0.3, z: -39.30, face: 'south', tone: 'crimson' },
  { t: 'banner', x:  5.0, y: 0.3, z: -39.30, face: 'south', tone: 'crimson' },
  // FOUNDRY south face — azure.
  { t: 'banner', x: 18.0, y: 0.3, z:  -9.30, face: 'south', tone: 'azure' },
  { t: 'banner', x: 26.0, y: 0.3, z:  -9.30, face: 'south', tone: 'azure' },
  // BARRACKS south face — azure.
  { t: 'banner', x: 38.0, y: 0.3, z: -31.30, face: 'south', tone: 'azure' },
  { t: 'banner', x: 46.0, y: 0.3, z: -31.30, face: 'south', tone: 'azure' },
  // SOUTH_KEEP north face — gold (visible from the citadel approach).
  { t: 'banner', x: -5.0, y: 0.3, z:  49.70, face: 'north', tone: 'gold' },
  { t: 'banner', x:  5.0, y: 0.3, z:  49.70, face: 'north', tone: 'gold' },

  // =====================================================================
  // BRAZIERS — bigger torch variant with wider iron pole + flame halo +
  // 2× point-light range. Placed at the map's grandest moments where a
  // small torch would feel underweight.
  // =====================================================================
  // S55o: culled 6 braziers down to 2. Keep the citadel mezzanine
  // pair — these flank the S parapet door and are visible from spawn
  // (the map's most-seen lighting beat). Drop the HILLTOP pair, the
  // TERRACE one, and the SHRINE one — their atmosphere is already
  // covered by the rune sentinels + the marble HILLTOP material.
  { t: 'brazier', x: -4.0, y: 4, z: -6.5 },                                 // CITADEL_BASE mezzanine S edge, west of door
  { t: 'brazier', x:  4.0, y: 4, z: -6.5 },                                 // CITADEL_BASE mezzanine S edge, east of door

  // =====================================================================
  // JUMP PADS — new movement mechanic. Step on the glowing cyan tile;
  // velocityY launches you up to ≈ 4.9 m peak height (vy=14, GRAVITY=20
  // → v²/2g). Horizontal velocity is preserved so a running-jump arcs
  // forward into the destination. Four pads placed to give alternative
  // vertical access to each new corner building's roof.
  // =====================================================================
  { t: 'jumppad', id: 'PAD_BARRACKS',  cx:  35, cz: -27, sx: 3, sz: 3, launchVy: 13 },        // → BARRACKS roof
  { t: 'jumppad', id: 'PAD_WATCHTOWER',cx: -35, cz: -28, sx: 3, sz: 3, launchVy: 13 },        // → WATCHTOWER roof
  { t: 'jumppad', id: 'PAD_TERRACE',   cx:  18, cz:  22, sx: 3, sz: 3, launchVy: 12 },        // → MARKET awning / TERRACE deck
  { t: 'jumppad', id: 'PAD_SOUTHKEEP', cx:  18, cz:  46, sx: 3, sz: 3, launchVy: 13 },        // → SOUTH_KEEP roof

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
  // S55m: extra cover bridging the new corner buildings into the central
  // map. Without these, the plazas around the corner buildings feel
  // empty after the corner walls go up. Each crate is positioned to
  // break a long open-line-of-sight.
  // NE plaza (between FOUNDRY and BARRACKS).
  { t: 'box', cx:  28, cz: -24, sx: 2.2, sy: 1.0, sz: 2.2 },
  { t: 'box', cx:  32, cz: -18, sx: 2.0, sy: 1.0, sz: 2.0 },
  // NW plaza (between citadel and WATCHTOWER).
  { t: 'box', cx: -25, cz: -22, sx: 2.2, sy: 1.0, sz: 2.2 },
  { t: 'box', cx: -32, cz: -18, sx: 2.0, sy: 1.0, sz: 2.0 },
  // SE plaza (between TERRACE and EAST_TOWER + MARKET).
  { t: 'box', cx:  28, cz:   2, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx:  42, cz:   8, sx: 2.2, sy: 1.0, sz: 2.2 },
  // SW plaza (between RUINS and TERRACE).
  { t: 'box', cx: -22, cz:  18, sx: 2.0, sy: 1.0, sz: 2.0 },
  // Far-south plaza (between TERRACE and SOUTH_KEEP).
  { t: 'box', cx:   8, cz:  42, sx: 2.2, sy: 1.0, sz: 2.2 },
  { t: 'box', cx:  -8, cz:  42, sx: 2.2, sy: 1.0, sz: 2.2 },
  // NE far corner (between BARRACKS and the new SPIRE/teleporter area).
  { t: 'box', cx:  42, cz: -22, sx: 2.0, sy: 1.0, sz: 2.0 },
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
  { kind: 'weapon', what: 'sniper',  x:   0, z: -17, y: 14.0 },        // SPIRE top — accessible only via TELE_SPIRE portal
  { kind: 'weapon', what: 'shotgun', x:  22, z: -12, y: 4.0 },         // FOUNDRY_ROOF center (clear of CATWALK_HE shadow and the new stair)
  { kind: 'weapon', what: 'smg',     x:   0, z: -45, y: 4.0 },         // VAULT_ROOF center
  { kind: 'weapon', what: 'saw',     x: -48, z:   0, y: 0.0 },         // COLONNADE ground (between cols 2 & 3)
  // S55ak: rocket launcher — placed on CATWALK_HE (the high iron bridge
  // at y=8 above the citadel east side). High-traffic vertical contest
  // point matching the long-range explosive role.
  { kind: 'weapon', what: 'rocket',  x:  10, z: -17, y: 8.0 },         // CATWALK_HE top
  // Ground health — one per cardinal-ish quadrant.
  { kind: 'health', x:  18, z: -28, y: 0 },                            // NE plaza
  { kind: 'health', x: -18, z: -28, y: 0 },                            // NW plaza
  { kind: 'health', x:  18, z:  18, y: 0 },                            // SE plaza
  { kind: 'health', x: -18, z:  18, y: 0 },                            // SW plaza
  // Deck health — one per accessible elevated landmark.
  { kind: 'health', x:   0, z:  -7, y: 4.0 },                          // CITADEL_BASE mezzanine (S edge, by S parapet door)
  { kind: 'health', x:   3, z: -17, y: 8.0 },                          // HILLTOP perch (east of SPIRE base — catwalk staging point)
  { kind: 'health', x:   0, z:  33, y: 3.0 },                          // TERRACE (S half)
  { kind: 'health', x: -30, z:   0, y: 5.0 },                          // WEST_RAMPART center
  // S55m: one health pickup per new corner-building roof.
  { kind: 'health', x:  42, z: -36, y: 4.0 },                          // BARRACKS roof center
  { kind: 'health', x: -42, z: -32, y: 4.0 },                          // WATCHTOWER roof center
  { kind: 'health', x:  55, z:   0, y: 5.0 },                          // EAST_TOWER roof center
  { kind: 'health', x:   0, z:  55, y: 4.0 },                          // SOUTH_KEEP roof center
  // S55ae: grenade pickups — four around the map at points likely to be in
  // the player's flow, all on open surfaces (no roofed buildings) so the
  // pickup-reachability harness passes.
  { kind: 'grenade', x:  12, z:   2, y: 0 },                           // SE plaza near foundry approach
  { kind: 'grenade', x: -12, z:   2, y: 0 },                           // SW plaza
  { kind: 'grenade', x:   0, z:  -7, y: 4.0 },                         // CITADEL_BASE mezzanine
  { kind: 'grenade', x: -30, z:  16, y: 0 },                           // West plaza
];
