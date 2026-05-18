// maplayout.js — RIDGEPOINT ARENA (S55f: Quake-instagib rework).
//
// S55f: Reworked from RIDGEPOINT TOWN (wave shooter) into an arena map
// inspired by Q1/Q3 instagib design. Core moves:
//   - Tighter playfield (130×130, was 160×160) — instagib rewards
//     compressed engagements.
//   - 4-fold pseudo-symmetric fortresses: HILLTOP (N), SOUTH_BASTION (S),
//     HOUSE_NW/SW (W-flank), HOUSE_NE/SE/TOWER/WAREHOUSE (E-flank).
//   - CENTRAL_ALTAR at (0,-12) holds the sniper — visible from spawn,
//     exposed to HILLTOP, ramped on 4 sides. The map's contested core.
//   - High-circuit catwalk loop: HILLTOP <-> CATWALK_HE <-> HOUSE_NE_F2 ...
//     CATWALK_HW <-> HOUSE_NW_F2 <-> CATWALK_NW <-> WEST_RAMPART <->
//     CATWALK_SW <-> HOUSE_SW_F2; SE side WAREHOUSE_ROOF <-> CATWALK_SE
//     <-> HOUSE_SE_F2. You can stay up high or drop down anywhere.
//   - Every named building has TWO ground-floor entries (flank routes).
//   - 5 SPAWN_ANCHORS (C/N/E/S/W) at cover positions for arena multi-spawn.
//   - Removed wave-shooter dead-end stash rooms (BUNKER_S, GUARDHOUSE_W,
//     HOUSE_SW interior-only, scattered RUINS walls).
//
// SINGLE SOURCE OF TRUTH (pure data + pure helpers, no engine imports) shared
// by the runtime (arena.js + kit.js) and the offline analyzer (mapviz.mjs).
//
// Schema (entry type `t`):
//   ground / perimeter / platform / box / wall / rampTo / stairsTo / overhang
//   `wall` supports an APERTURE so it can be a DOORWAY or a WINDOW:
//     door?:{width,height,offset?}            // gap from the floor up
//     window?:{width,height,sill,offset?}     // gap in a mid band
//   A doorway = no solid in the opening (walk + see + shoot through).
//   A window  = solid sill below + lintel above + side jambs; the mid band
//               is clear, so you CANNOT walk through but CAN see/shoot.
//   Both are built as verified makeBoxSolid segments (what you see is what
//   you collide with); the opening has no mesh so bullets/vision pass.

export const SPAWN = { x: 0, z: 0 };

// S55f: arena spawn anchors. Player initial spawn (wave-mode + arena) stays
// at SPAWN above for back-compat. Arena mode picks an anchor on respawn —
// the farthest one from any live enemy. C is the center (= SPAWN); the four
// cardinals sit at the inner edge of the plaza, each behind a cover crate
// at ~22 m from center. The arena geometry is balanced around these
// anchors: every weapon pickup is reachable from any anchor without
// traversing more than one fortress.
export const SPAWN_ANCHORS = [
  { id: 'C', x:   0, z:   0 },
  { id: 'N', x:   0, z: -22 },
  { id: 'E', x:  22, z:   0 },
  { id: 'S', x:   0, z:  22 },
  { id: 'W', x: -22, z:   0 },
];

// Pure: decompose a wall (with optional door/window aperture) into solid
// box rects in WORLD coords. Used identically by arena.js and mapviz.mjs.
export function wallBoxes(e) {
  const base = e.base || 0, H = e.height, t = e.thick == null ? 0.5 : e.thick;
  const L = e.length, axis = e.axis;
  // aperture in wall-local length offset (u, from centre) + y over [base]
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

// S55: doorway midpoints (world XZ + the wall axis they belong to) for the
// AI router. When an enemy is blocked from reaching the player by a wall, it
// can latch onto the nearest doorway, route to it, and re-engage on the other
// side. Each entry must be the EXACT wall center (cx, cz) of a wall that has
// a `door` aperture. The mapviz DOORWAYS-consistency check (S55e) cross-
// references this list against every door-bearing wall at ground level and
// fails the map if any entry has drifted or any ground-floor door is
// missing. Parapet doorways (base > 0) are intentionally NOT in this list —
// the AI routes at ground level.
export const DOORWAYS = [
  // HILLTOP + SOUTH_BASTION are elevated outposts — their doorways are all
  // parapet (base>0), reached via ramp/stair. No ground-floor doors → not
  // in this list (AI router operates at ground level only).
  // NW house — 2 entries (S faces plaza, E flank)
  { x: -35, z: -23,  axis: 'x' },   // HOUSE_NW S entry
  { x: -28, z: -30,  axis: 'z' },   // HOUSE_NW E flank (NEW)
  // NE house — 2 entries (W faces plaza, N flank)
  { x:  33, z: -42,  axis: 'z' },   // HOUSE_NE W entry
  { x:  40, z: -49,  axis: 'x' },   // HOUSE_NE N flank (NEW)
  // Tower — 2 entries (W faces plaza, N flank)
  { x:  50, z: -18,  axis: 'z' },   // TOWER_NE W entry
  { x:  55, z: -23,  axis: 'x' },   // TOWER_NE N flank (NEW)
  // Warehouse — 2 outer entries (W faces plaza, E flank) + 1 interior partition
  { x:  35, z:   8,  axis: 'z' },   // WAREHOUSE W entry
  { x:  55, z:   8,  axis: 'z' },   // WAREHOUSE E flank (NEW)
  { x:  45, z:   8,  axis: 'z' },   // WAREHOUSE interior partition
  // SW house — 2 entries (N faces plaza, E flank)
  { x: -35, z:  23,  axis: 'x' },   // HOUSE_SW N entry
  { x: -28, z:  30,  axis: 'z' },   // HOUSE_SW E flank (NEW)
  // SE house — 2 entries (W faces plaza, N flank)
  { x:  29, z:  30,  axis: 'z' },   // HOUSE_SE W entry
  { x:  35, z:  23,  axis: 'x' },   // HOUSE_SE N flank (NEW)
];

export const LAYOUT = [
  // =====================================================================
  // SHELL — 130×130 (was 160×160 before S55f)
  // =====================================================================
  { t: 'ground', half: 65, y: 0 },
  { t: 'perimeter', half: 65, height: 14, thick: 1.0 },

  // =====================================================================
  // CENTRAL_ALTAR — the contested core (DM4-pit inspired).
  //   8×8 raised platform at y=2.5 north of spawn (between SPAWN and
  //   HILLTOP). Ramps on all four sides so it can be entered from any
  //   approach but the player is exposed to every fortress while on top.
  //   Hosts the sniper pickup.
  // =====================================================================
  { t: 'platform', id: 'CENTRAL_ALTAR', cx: 0, cz: -12, top: 2.5, sx: 8, sz: 8 },
  { t: 'rampTo',   to: 'CENTRAL_ALTAR', side: '+z', run: 4, width: 5, fromY: 0 },   // S ramp (from spawn)
  { t: 'rampTo',   to: 'CENTRAL_ALTAR', side: '-z', run: 4, width: 5, fromY: 0 },   // N ramp (toward HILLTOP)
  { t: 'rampTo',   to: 'CENTRAL_ALTAR', side: '+x', run: 4, width: 5, fromY: 0 },   // E ramp
  { t: 'rampTo',   to: 'CENTRAL_ALTAR', side: '-x', run: 4, width: 5, fromY: 0 },   // W ramp

  // =====================================================================
  // NORTH: HILLTOP — fortified sniper outpost (kept from S55).
  //   16×14 deck at y=6.0, parapets with shooting slits, S archway for
  //   ramp ingress + W doorway for stair ingress.
  // =====================================================================
  { t: 'platform', id: 'HILLTOP', cx: 0, cz: -50, top: 6.0, sx: 16, sz: 14 },
  { t: 'rampTo',   to: 'HILLTOP', side: '+z', run: 10, width: 8, fromY: 0 },   // S ramp into plaza
  { t: 'stairsTo', to: 'HILLTOP', side: '-x', run: 8,  width: 5, fromY: 0, steps: 8 }, // W stairs
  { t: 'wall', axis: 'x', cx: 0,  cz: -57, base: 6.0, length: 16, height: 2.2, thick: 0.4,
    window: { width: 8, height: 0.9, sill: 0.9 } },                            // N slit
  { t: 'wall', axis: 'x', cx: 0,  cz: -43, base: 6.0, length: 16, height: 2.2, thick: 0.4,
    door: { width: 8.0, height: 2.2 } },                                       // S archway (ramp landing)
  { t: 'wall', axis: 'z', cx: -8, cz: -50, base: 6.0, length: 14, height: 2.2, thick: 0.4,
    door: { width: 5.2, height: 2.2 } },                                       // W doorway (stair landing)
  { t: 'wall', axis: 'z', cx:  8, cz: -50, base: 6.0, length: 14, height: 2.2, thick: 0.4,
    door: { width: 5.2, height: 2.2 } },                                       // E doorway (CATWALK_HE)
  // Cover boxes on the deck.
  { t: 'box', cx:  4, cz: -53, base: 6.0, sx: 2.0, sy: 1.0, sz: 1.6 },
  { t: 'box', cx: -4, cz: -47, base: 6.0, sx: 2.0, sy: 1.0, sz: 1.6 },

  // =====================================================================
  // NORTH-WEST: HOUSE_NW — two-story house with deck.
  //   Ground floor: 14×14 walled room with S doorway (plaza) + E flank
  //                 doorway (NEW S55f: opens onto the catwalk approach).
  //   2nd floor:    deck at y=4.0, accessed by external stairs on -x.
  //                 Parapet doorways W (stair landing) + E (CATWALK_HW).
  // =====================================================================
  { t: 'platform', id: 'HOUSE_NW_F2', cx: -35, cz: -30, top: 4.0, sx: 14, sz: 14 },
  { t: 'wall', axis: 'x', cx: -35, cz: -37, length: 14, height: 3.4, thick: 0.5 },                  // N solid
  { t: 'wall', axis: 'x', cx: -35, cz: -23, length: 14, height: 3.4, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                            // S doorway (faces plaza)
  { t: 'wall', axis: 'z', cx: -42, cz: -30, length: 14, height: 3.4, thick: 0.5,
    window: { width: 5.0, height: 0.9, sill: 2.0 } },                                                // W: high-sill slit (stair side)
  { t: 'wall', axis: 'z', cx: -28, cz: -30, length: 14, height: 3.4, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // E flank doorway (NEW S55f)
  // External stairs up to F2 — lands on -x edge.
  { t: 'stairsTo', to: 'HOUSE_NW_F2', side: '-x', run: 7, width: 5, fromY: 0, steps: 7 },
  // 2nd-floor parapets — windows on N/S, doorways on W (stairs) + E (catwalk drop).
  { t: 'wall', axis: 'x', cx: -35, cz: -37, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'x', cx: -35, cz: -23, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'z', cx: -42, cz: -30, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // W parapet doorway (stair landing)
  { t: 'wall', axis: 'z', cx: -28, cz: -30, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // E parapet doorway (CATWALK_HW)

  // =====================================================================
  // NORTH-EAST: HOUSE_NE — two-story house (mirror of HOUSE_NW).
  //   Ground entries: W doorway (plaza) + N flank doorway (NEW S55f).
  // =====================================================================
  { t: 'platform', id: 'HOUSE_NE_F2', cx: 40, cz: -42, top: 4.0, sx: 14, sz: 14 },
  { t: 'wall', axis: 'x', cx: 40, cz: -49, length: 14, height: 3.4, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // N flank doorway (NEW S55f)
  { t: 'wall', axis: 'x', cx: 40, cz: -35, length: 14, height: 3.4, thick: 0.5,
    window: { width: 2.4, height: 1.3, sill: 1.0 } },                                                // S with window
  { t: 'wall', axis: 'z', cx: 33, cz: -42, length: 14, height: 3.4, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // W doorway (entry)
  { t: 'wall', axis: 'z', cx: 47, cz: -42, length: 14, height: 3.4, thick: 0.5,
    window: { width: 5.0, height: 0.9, sill: 2.0 } },                                                // E: high-sill slit (stair side)
  { t: 'stairsTo', to: 'HOUSE_NE_F2', side: '+x', run: 7, width: 5, fromY: 0, steps: 7 },
  { t: 'wall', axis: 'x', cx: 40, cz: -49, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'x', cx: 40, cz: -35, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'z', cx: 33, cz: -42, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // W parapet doorway (CATWALK_HE drop)
  { t: 'wall', axis: 'z', cx: 47, cz: -42, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // E parapet doorway (stair landing)

  // =====================================================================
  // EAST: TOWER_NE — 2-tier tower (highest perch on the east side).
  //   Ground entries: W doorway (plaza) + N flank doorway (NEW S55f).
  // =====================================================================
  { t: 'platform', id: 'TOWER_NE_TOP', cx: 55, cz: -18, top: 4.5, sx: 10, sz: 10 },
  { t: 'wall', axis: 'x', cx: 55, cz: -23, length: 10, height: 3.9, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // N flank doorway (NEW S55f)
  { t: 'wall', axis: 'x', cx: 55, cz: -13, length: 10, height: 3.9, thick: 0.5,
    window: { width: 5.0, height: 0.9, sill: 2.4 } },                                                // S: high-sill slit (ramp side)
  { t: 'wall', axis: 'z', cx: 50, cz: -18, length: 10, height: 3.9, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // W doorway (entry)
  { t: 'wall', axis: 'z', cx: 60, cz: -18, length: 10, height: 3.9, thick: 0.5,
    window: { width: 1.6, height: 1.0, sill: 1.1 } },                                                // E with window
  // External ramp to the rooftop perch — lands on +z (south) edge.
  { t: 'rampTo', to: 'TOWER_NE_TOP', side: '+z', run: 7, width: 5, fromY: 0 },
  // Roof parapets — N/E slits; W solid; +z (ramp landing) open.
  { t: 'wall', axis: 'x', cx: 55, cz: -23, base: 4.5, length: 10, height: 1.6, thick: 0.4,
    window: { width: 5, height: 0.9, sill: 0.6 } },
  { t: 'wall', axis: 'z', cx: 50, cz: -18, base: 4.5, length: 10, height: 1.6, thick: 0.4 },
  { t: 'wall', axis: 'z', cx: 60, cz: -18, base: 4.5, length: 10, height: 1.6, thick: 0.4,
    window: { width: 5, height: 0.9, sill: 0.6 } },
  { t: 'box', cx: 55, cz: -20, base: 4.5, sx: 1.6, sy: 1.0, sz: 1.6 },

  // =====================================================================
  // EAST: WAREHOUSE — long two-room building with walkable roof.
  //   Ground entries: W doorway (plaza) + E flank doorway (NEW S55f,
  //                   replaces window) + interior partition doorway.
  // =====================================================================
  { t: 'platform', id: 'WAREHOUSE_ROOF', cx: 45, cz: 8, top: 4.0, sx: 20, sz: 12 },
  { t: 'wall', axis: 'x', cx: 45, cz:  2, length: 20, height: 3.4, thick: 0.5,
    window: { width: 3.0, height: 1.2, sill: 1.1 } },                                                // N (faces plaza)
  { t: 'wall', axis: 'x', cx: 45, cz: 14, length: 20, height: 3.4, thick: 0.5,
    window: { width: 5.0, height: 0.9, sill: 2.0 } },                                                // S: high-sill slit (stair side)
  { t: 'wall', axis: 'z', cx: 35, cz:  8, length: 12, height: 3.4, thick: 0.5,
    door: { width: 2.6, height: 2.8 } },                                                             // W doorway (entry)
  { t: 'wall', axis: 'z', cx: 55, cz:  8, length: 12, height: 3.4, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // E flank doorway (NEW S55f)
  { t: 'wall', axis: 'z', cx: 45, cz: 8, length: 12, height: 3.4, thick: 0.4,
    door: { width: 2.2, height: 2.6 } },                                                             // interior partition
  // Roof parapets.
  { t: 'wall', axis: 'x', cx: 45, cz:  2, base: 4.0, length: 20, height: 1.6, thick: 0.4,
    window: { width: 10, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'x', cx: 45, cz: 14, base: 4.0, length: 20, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // S parapet doorway (stair landing)
  { t: 'wall', axis: 'z', cx: 35, cz:  8, base: 4.0, length: 12, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // W parapet doorway (CATWALK_SE drop) — NEW S55f
  { t: 'wall', axis: 'z', cx: 55, cz:  8, base: 4.0, length: 12, height: 1.6, thick: 0.4,
    window: { width: 5, height: 0.8, sill: 0.7 } },
  // Stairs up to WAREHOUSE_ROOF — +z side.
  { t: 'stairsTo', to: 'WAREHOUSE_ROOF', side: '+z', run: 7, width: 5, fromY: 0, steps: 8 },

  // =====================================================================
  // SOUTH-WEST: HOUSE_SW — two-story house (NEW S55f, replaces flat
  // HOUSE_SW + GUARDHOUSE_W stash rooms). Mirror of HOUSE_NW.
  //   Ground entries: N doorway (plaza) + E flank doorway.
  // =====================================================================
  { t: 'platform', id: 'HOUSE_SW_F2', cx: -35, cz: 30, top: 4.0, sx: 14, sz: 14 },
  { t: 'wall', axis: 'x', cx: -35, cz: 23, length: 14, height: 3.4, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // N doorway (faces plaza)
  { t: 'wall', axis: 'x', cx: -35, cz: 37, length: 14, height: 3.4, thick: 0.5 },                    // S solid
  { t: 'wall', axis: 'z', cx: -42, cz: 30, length: 14, height: 3.4, thick: 0.5,
    window: { width: 5.0, height: 0.9, sill: 2.0 } },                                                // W: high-sill slit (stair side)
  { t: 'wall', axis: 'z', cx: -28, cz: 30, length: 14, height: 3.4, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // E flank doorway
  { t: 'stairsTo', to: 'HOUSE_SW_F2', side: '-x', run: 7, width: 5, fromY: 0, steps: 7 },
  // 2nd-floor parapets — doorways W (stair) + E (catwalk drop).
  { t: 'wall', axis: 'x', cx: -35, cz: 23, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'x', cx: -35, cz: 37, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'z', cx: -42, cz: 30, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // W parapet doorway (CATWALK_SW)
  { t: 'wall', axis: 'z', cx: -28, cz: 30, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // E parapet doorway (open onto plaza)

  // =====================================================================
  // SOUTH-EAST: HOUSE_SE — two-story house (NEW S55f, replaces RUINS).
  //   Mirror of HOUSE_NE. Ground entries: W doorway (plaza) + N flank.
  // =====================================================================
  { t: 'platform', id: 'HOUSE_SE_F2', cx: 35, cz: 30, top: 4.0, sx: 12, sz: 12 },
  { t: 'wall', axis: 'x', cx: 35, cz: 23, length: 12, height: 3.4, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // N flank doorway
  { t: 'wall', axis: 'x', cx: 35, cz: 37, length: 12, height: 3.4, thick: 0.5,
    window: { width: 2.4, height: 1.3, sill: 1.0 } },                                                // S with window
  { t: 'wall', axis: 'z', cx: 29, cz: 30, length: 12, height: 3.4, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // W doorway (entry)
  { t: 'wall', axis: 'z', cx: 41, cz: 30, length: 12, height: 3.4, thick: 0.5,
    window: { width: 5.0, height: 0.9, sill: 2.0 } },                                                // E: high-sill slit (stair side)
  { t: 'stairsTo', to: 'HOUSE_SE_F2', side: '+x', run: 7, width: 5, fromY: 0, steps: 7 },
  // 2nd-floor parapets — doorway E (stair) + W (catwalk drop toward WAREHOUSE).
  { t: 'wall', axis: 'x', cx: 35, cz: 23, base: 4.0, length: 12, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'x', cx: 35, cz: 37, base: 4.0, length: 12, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'z', cx: 29, cz: 30, base: 4.0, length: 12, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // W parapet doorway (CATWALK_SE)
  { t: 'wall', axis: 'z', cx: 41, cz: 30, base: 4.0, length: 12, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // E parapet doorway (stair landing)

  // =====================================================================
  // SOUTH: SOUTH_BASTION — south fortress (NEW S55f, replaces BUNKER_S).
  //   16×12 deck at y=5.0, mirrors HILLTOP at smaller scale. Ground entries:
  //   N archway (ramp landing, wide) + E doorway (stair landing).
  // =====================================================================
  { t: 'platform', id: 'SOUTH_BASTION', cx: 0, cz: 45, top: 5.0, sx: 16, sz: 12 },
  { t: 'rampTo',   to: 'SOUTH_BASTION', side: '-z', run: 8, width: 8, fromY: 0 },   // N ramp into plaza
  { t: 'stairsTo', to: 'SOUTH_BASTION', side: '+x', run: 8, width: 5, fromY: 0, steps: 8 }, // E stairs
  { t: 'wall', axis: 'x', cx: 0, cz: 37, base: 5.0, length: 16, height: 2.2, thick: 0.4,
    door: { width: 8.0, height: 2.2 } },                                       // N archway (ramp landing)
  { t: 'wall', axis: 'x', cx: 0, cz: 51, base: 5.0, length: 16, height: 2.2, thick: 0.4,
    window: { width: 8, height: 0.9, sill: 0.9 } },                            // S slit
  { t: 'wall', axis: 'z', cx: -8, cz: 45, base: 5.0, length: 12, height: 2.2, thick: 0.4,
    window: { width: 5, height: 0.9, sill: 0.9 } },                            // W slit
  { t: 'wall', axis: 'z', cx:  8, cz: 45, base: 5.0, length: 12, height: 2.2, thick: 0.4,
    door: { width: 5.2, height: 2.2 } },                                       // E doorway (stair landing)
  // Cover crates on the bastion deck.
  { t: 'box', cx:  4, cz: 48, base: 5.0, sx: 2.0, sy: 1.0, sz: 1.6 },
  { t: 'box', cx: -4, cz: 42, base: 5.0, sx: 2.0, sy: 1.0, sz: 1.6 },

  // =====================================================================
  // WEST: WEST_RAMPART — elevated walkway along the west edge (kept S55,
  // pulled east from x=-65 to x=-55 to anchor the SW/NW catwalk loop).
  // =====================================================================
  { t: 'platform', id: 'WEST_RAMPART', cx: -55, cz: 0, top: 5.0, sx: 8, sz: 28 },
  { t: 'rampTo', to: 'WEST_RAMPART', side: '+x', run: 7, width: 5, fromY: 0 },
  { t: 'wall', axis: 'z', cx: -59, cz: 0, base: 5.0, length: 28, height: 2.0, thick: 0.4,
    window: { width: 16, height: 1.0, sill: 0.8 } },
  { t: 'wall', axis: 'x', cx: -55, cz: -14, base: 5.0, length: 8, height: 2.0, thick: 0.4,
    door: { width: 4.0, height: 2.0 } },                                                             // N parapet doorway (CATWALK_NW)
  { t: 'wall', axis: 'x', cx: -55, cz:  14, base: 5.0, length: 8, height: 2.0, thick: 0.4,
    door: { width: 4.0, height: 2.0 } },                                                             // S parapet doorway (CATWALK_SW)

  // =====================================================================
  // CATWALKS — close the high-circuit loop. Each is a structural box at
  // a fixed elevation; player drops down or walks across as the deck
  // heights allow. None overlap a building footprint.
  // =====================================================================
  // CATWALK_HE (kept S55): HILLTOP east edge (x=8, top=6.0) → 22m east.
  //   West edge x=8 (flush HILLTOP), east edge x=30. HOUSE_NE_F2 west edge
  //   x=33 → 3m sprint-jump gap. Stair down on +z, foot at z=-38.
  { t: 'box', id: 'CATWALK_HE', cx: 19, cz: -50, base: 5.4, sx: 22, sy: 0.6, sz: 4 },
  { t: 'stairsTo', to: 'CATWALK_HE', side: '+z', run: 10, width: 8, fromY: 0, steps: 11 },
  // (CATWALK_HW dropped S55f: a west-side mirror of CATWALK_HE would have
  // to abut HILLTOP's west edge but the HILLTOP -x stair occupies that
  // region, so a flush body intrudes on the stair landing. The high circuit
  // covers the west side via WEST_RAMPART ↔ CATWALK_NW ↔ HOUSE_NW_F2
  // instead; the only access to HILLTOP top is the +z ramp and -x stair.)
  // CATWALK_NW (NEW S55f): connects WEST_RAMPART north end (z=-14) to
  //   HOUSE_NW_F2 west edge (x=-42, top=4.0). WEST_RAMPART top = 5.0; the
  //   catwalk drops 1.0 to the HOUSE_NW deck. Top at y=5.0. Spans x=[-51,-42],
  //   cz=-14 (aligned with WEST_RAMPART north parapet doorway).
  { t: 'box', id: 'CATWALK_NW', cx: -46.5, cz: -14, base: 4.4, sx: 9, sy: 0.6, sz: 4 },
  // CATWALK_SW (NEW S55f): mirrors CATWALK_NW. Connects WEST_RAMPART south
  //   end (z=14) to HOUSE_SW_F2 west edge (x=-42, top=4.0).
  { t: 'box', id: 'CATWALK_SW', cx: -46.5, cz: 14, base: 4.4, sx: 9, sy: 0.6, sz: 4 },
  // CATWALK_SE (NEW S55f): connects WAREHOUSE_ROOF (cx=45, z range [2,14],
  //   top=4.0) to HOUSE_SE_F2 (cx=35, z range [24,36], top=4.0). Flush in y.
  //   Spans cz=[15,23] = 8m gap. cx=38 (overlap of both footprints on x).
  { t: 'box', id: 'CATWALK_SE', cx: 38, cz: 19, base: 3.4, sx: 6, sy: 0.6, sz: 10 },

  // =====================================================================
  // PLAZA COVER — scattered crates around spawn anchors. Each spawn anchor
  // gets one cover crate at its position so a fresh spawn is not exposed.
  // Cover height 1.0 m (duckable, peekable).
  // =====================================================================
  // Anchor cover (one per cardinal anchor + center area).
  { t: 'box', cx:   0, cz: -22, sx: 2.4, sy: 1.0, sz: 2.0 },   // N anchor cover
  { t: 'box', cx:  22, cz:   0, sx: 2.0, sy: 1.0, sz: 2.4 },   // E anchor cover
  { t: 'box', cx:   0, cz:  22, sx: 2.4, sy: 1.0, sz: 2.0 },   // S anchor cover
  { t: 'box', cx: -22, cz:   0, sx: 2.0, sy: 1.0, sz: 2.4 },   // W anchor cover
  // Mid-plaza cover (between anchors and altar).
  { t: 'box', cx:  10, cz: -10, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx: -10, cz: -10, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx:  10, cz:  10, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx: -10, cz:  10, sx: 2.0, sy: 1.0, sz: 2.0 },
  // Inter-quadrant cover (between plaza and outer fortresses).
  { t: 'box', cx:  22, cz: -22, sx: 2.4, sy: 1.0, sz: 2.4 },
  { t: 'box', cx: -22, cz: -22, sx: 2.4, sy: 1.0, sz: 2.4 },
  { t: 'box', cx:  22, cz:  22, sx: 2.4, sy: 1.0, sz: 2.4 },
  { t: 'box', cx: -22, cz:  22, sx: 2.4, sy: 1.0, sz: 2.4 },
];

// --- PICKUPS ---
// S55f: arena distribution. 4 weapons at the 4 elevated power positions
// (sniper on the contested CENTRAL_ALTAR; the others on each cardinal
// fortress). 8 health packs distributed one per quadrant at ground + one
// per quadrant at deck height.
export const PICKUPS = [
  // Weapons.
  { kind: 'weapon', what: 'sniper',  x:   0, z: -12, y: 2.5 },   // CENTRAL_ALTAR (contested core)
  { kind: 'weapon', what: 'saw',     x:   0, z: -50, y: 6.0 },   // HILLTOP (north)
  { kind: 'weapon', what: 'shotgun', x:  45, z:  10, y: 4.0 },   // WAREHOUSE_ROOF (east)
  { kind: 'weapon', what: 'smg',     x: -35, z:  30, y: 4.0 },   // HOUSE_SW_F2 (south-west)
  // Ground health — one per quadrant.
  { kind: 'health', x:  15, z: -15, y: 0 },
  { kind: 'health', x: -15, z: -15, y: 0 },
  { kind: 'health', x:  15, z:  15, y: 0 },
  { kind: 'health', x: -15, z:  15, y: 0 },
  // Deck health — one per elevated fortress.
  { kind: 'health', x: -35, z: -30, y: 4.0 },                    // HOUSE_NW_F2
  { kind: 'health', x:  40, z: -42, y: 4.0 },                    // HOUSE_NE_F2
  { kind: 'health', x:  35, z:  30, y: 4.0 },                    // HOUSE_SE_F2
  { kind: 'health', x:   0, z:  45, y: 5.0 },                    // SOUTH_BASTION
  { kind: 'health', x: -55, z:   0, y: 5.0 },                    // WEST_RAMPART
];
