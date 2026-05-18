// maplayout.js — RIDGEPOINT TOWN (v4: 160×160 town map, multi-floor buildings).
//
// S55: scaled 2× (was 80×80). Replaces the single-courtyard Citadel with a
// town/compound layout: spawn plaza in the centre, four full multi-floor
// buildings (HOUSE_NW, HOUSE_NE, TOWER_NE, WAREHOUSE), a hilltop sniper
// outpost (HILLTOP), enclosed rooms (BUNKER_S, GUARDHOUSE_W), and a ruins
// quadrant in the south-east with broken-wall cover. Catwalks + external
// stairs link the high decks into a loop so there's a real flow up high in
// addition to the ground-level layout. Doorways are exported separately for
// the AI router so enemies can navigate through them instead of paw at walls.
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
// side. Computed by hand from the wall entries below so the router does NOT
// have to scan the layout every frame. Keep this in sync with the doorway
// walls.
export const DOORWAYS = [
  // HOUSE_NW: doorway on the +z side (faces plaza)
  { x: -35, z: -23,  axis: 'x' },
  // HOUSE_NE: doorway on the -x side (faces plaza)
  { x:  33, z: -35,  axis: 'z' },
  // WAREHOUSE: two doorways (entry + interior partition)
  { x:  35,  z:  8,  axis: 'z' },
  { x:  45,  z:  2,  axis: 'x' },   // interior partition doorway
  // BUNKER_S: doorway on the -z side (faces plaza)
  { x:   0,  z:  36, axis: 'x' },
  // GUARDHOUSE_W: doorway on the +x side (faces plaza)
  { x: -33,  z:  14, axis: 'z' },
  // TOWER_NE ground room: doorway on the -x side
  { x:  50,  z: -18, axis: 'z' },
  // HILLTOP arch: doorway in the parapet on the -z side (only opening up top)
  { x:   0,  z: -32, axis: 'x' },
  // RUINS_SE archway: door-shaped gap on -z
  { x:  43,  z:  30, axis: 'x' },
];

export const LAYOUT = [
  // =====================================================================
  // SHELL
  // =====================================================================
  { t: 'ground', half: 80, y: 0 },
  { t: 'perimeter', half: 80, height: 16, thick: 1.0 },

  // =====================================================================
  // NORTH-WEST: HOUSE_NW — two-story house
  //   ground floor: 14×14 walled room with a south doorway
  //   2nd floor:    platform deck at y=4.0 (top), accessed by external
  //                 stairs on the west side; balcony walls with windows
  // =====================================================================
  // 2nd-floor deck (the upstairs floor / ground-floor ceiling).
  { t: 'platform', id: 'HOUSE_NW_F2', cx: -35, cz: -30, top: 4.0, sx: 14, sz: 14 },
  // Ground-floor walls (base=0, height=4.0) — perimeter of the room.
  { t: 'wall', axis: 'x', cx: -35, cz: -37, length: 14, height: 4.0, thick: 0.5 },                  // N solid
  { t: 'wall', axis: 'x', cx: -35, cz: -23, length: 14, height: 4.0, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                            // S doorway (faces plaza)
  // S55b: W wall has a TALL doorway sized to the external staircase that
  // lands here. Without this the wall body sits in the stair's landing
  // zone and blocks the player from reaching the 2nd-floor deck.
  { t: 'wall', axis: 'z', cx: -42, cz: -30, length: 14, height: 4.0, thick: 0.5,
    door: { width: 5.2, height: 4.0 } },                                                             // W: tall stair-doorway
  { t: 'wall', axis: 'z', cx: -28, cz: -30, length: 14, height: 4.0, thick: 0.5,
    window: { width: 2.0, height: 1.2, sill: 1.0 } },                                                // E with window
  // External stairs up to the 2nd-floor deck (lands on the -x edge of HOUSE_NW_F2).
  { t: 'stairsTo', to: 'HOUSE_NW_F2', side: '-x', run: 7, width: 5, fromY: 0, steps: 7 },
  // 2nd-floor parapet walls — half-height with windows so the roof reads as a defensible balcony.
  { t: 'wall', axis: 'x', cx: -35, cz: -37, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'x', cx: -35, cz: -23, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  // S55b: W parapet has a doorway aligned with the stair so the player can
  // walk OFF the stair onto the deck (was solid → blocked the landing).
  { t: 'wall', axis: 'z', cx: -42, cz: -30, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // W parapet doorway
  // The +x parapet leaves a doorway-sized gap so the player can drop / hop onto a catwalk
  // (or sniper-shoot through the gap toward the central plaza).
  { t: 'wall', axis: 'z', cx: -28, cz: -30, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    door: { width: 3.0, height: 1.6 } },

  // =====================================================================
  // NORTH: HILLTOP — fortified sniper outpost on a high platform
  //   16×16 deck at y=6.0, parapet walls with shooting slits all around,
  //   one south-side archway for ingress
  // =====================================================================
  { t: 'platform', id: 'HILLTOP', cx: 0, cz: -50, top: 6.0, sx: 16, sz: 14 },
  // Ramps + stairs up to the HILLTOP from the ground.
  { t: 'rampTo',   to: 'HILLTOP', side: '+z', run: 10, width: 8, fromY: 0 },   // south ramp into plaza
  { t: 'stairsTo', to: 'HILLTOP', side: '-x', run: 8,  width: 5, fromY: 0, steps: 8 }, // west stairs
  // Parapets on the deck (base=6.0, height=2.2). S55b: S doorway widened to
  // 8 m so the whole 8-m-wide ramp lands cleanly (was 3 m → 5 m of the ramp
  // width was hitting the parapet body). W parapet gets a 5-m doorway so the
  // -x stairs land without being blocked.
  { t: 'wall', axis: 'x', cx: 0,  cz: -57, base: 6.0, length: 16, height: 2.2, thick: 0.4,
    window: { width: 8, height: 0.9, sill: 0.9 } },                            // N slit
  { t: 'wall', axis: 'x', cx: 0,  cz: -43, base: 6.0, length: 16, height: 2.2, thick: 0.4,
    door: { width: 8.0, height: 2.2 } },                                       // S archway (ramp landing)
  { t: 'wall', axis: 'z', cx: -8, cz: -50, base: 6.0, length: 14, height: 2.2, thick: 0.4,
    door: { width: 5.2, height: 2.2 } },                                       // W doorway (stair landing)
  { t: 'wall', axis: 'z', cx:  8, cz: -50, base: 6.0, length: 14, height: 2.2, thick: 0.4,
    window: { width: 6, height: 0.9, sill: 0.9 } },                            // E slit
  // Cover boxes ON the HILLTOP for crouch-fire spots.
  { t: 'box', cx:  4, cz: -53, base: 6.0, sx: 2.0, sy: 1.0, sz: 1.6 },
  { t: 'box', cx: -4, cz: -47, base: 6.0, sx: 2.0, sy: 1.0, sz: 1.6 },

  // =====================================================================
  // NORTH-EAST: HOUSE_NE — two-story house
  // =====================================================================
  { t: 'platform', id: 'HOUSE_NE_F2', cx: 40, cz: -42, top: 4.0, sx: 14, sz: 14 },
  // Ground-floor walls. Doorway faces west into the plaza.
  { t: 'wall', axis: 'x', cx: 40, cz: -49, length: 14, height: 4.0, thick: 0.5 },                   // N solid
  { t: 'wall', axis: 'x', cx: 40, cz: -35, length: 14, height: 4.0, thick: 0.5,
    window: { width: 2.4, height: 1.3, sill: 1.0 } },                                                // S with window
  { t: 'wall', axis: 'z', cx: 33, cz: -42, length: 14, height: 4.0, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // W doorway
  // S55b: E wall has a TALL doorway sized to the external staircase that
  // lands here (was a window; the wall body blocked the stair landing).
  { t: 'wall', axis: 'z', cx: 47, cz: -42, length: 14, height: 4.0, thick: 0.5,
    door: { width: 5.2, height: 4.0 } },                                                             // E: tall stair-doorway
  // External stairs to the 2nd-floor deck — lands on the +x edge.
  { t: 'stairsTo', to: 'HOUSE_NE_F2', side: '+x', run: 7, width: 5, fromY: 0, steps: 7 },
  // 2nd-floor parapets — slits on three sides + a doorway on +x where the
  // stair lands so the player can walk OFF the stair onto the deck.
  { t: 'wall', axis: 'x', cx: 40, cz: -49, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'x', cx: 40, cz: -35, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'z', cx: 33, cz: -42, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    window: { width: 6, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'z', cx: 47, cz: -42, base: 4.0, length: 14, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // E parapet doorway

  // =====================================================================
  // EAST: TOWER_NE — 2-tier tower (ground room → rooftop perch)
  //   ground floor: enclosed 10×10 room with a -x doorway
  //   roof:         10×10 platform at y=4.5, parapets all around with a
  //                 west-side opening where the ramp lands. Highest tier
  //                 you can reach from this building.
  // =====================================================================
  { t: 'platform', id: 'TOWER_NE_TOP', cx: 55, cz: -18, top: 4.5, sx: 10, sz: 10 },
  // Ground-floor walls (height matches the deck base = 4.5).
  { t: 'wall', axis: 'x', cx: 55, cz: -23, length: 10, height: 4.5, thick: 0.5,
    window: { width: 1.6, height: 1.0, sill: 1.1 } },                                                // N with window
  // S55b: S wall has a TALL doorway sized to the external ramp that lands
  // here (was a window; the wall body blocked the ramp landing).
  { t: 'wall', axis: 'x', cx: 55, cz: -13, length: 10, height: 4.5, thick: 0.5,
    door: { width: 5.2, height: 4.5 } },                                                             // S: tall ramp-doorway
  // W wall: ground-floor entry doorway.
  { t: 'wall', axis: 'z', cx: 50, cz: -18, length: 10, height: 4.5, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // W doorway
  { t: 'wall', axis: 'z', cx: 60, cz: -18, length: 10, height: 4.5, thick: 0.5,
    window: { width: 1.6, height: 1.0, sill: 1.1 } },                                                // E with window
  // External ramp to the rooftop perch — lands on +z (south) edge of the deck,
  // an open side (no parapet on that side).
  { t: 'rampTo', to: 'TOWER_NE_TOP', side: '+z', run: 7, width: 5, fromY: 0 },
  // Roof parapets — three sides slit windows; +z side open (ramp comes up there).
  { t: 'wall', axis: 'x', cx: 55, cz: -23, base: 4.5, length: 10, height: 1.6, thick: 0.4,
    window: { width: 5, height: 0.9, sill: 0.6 } },                                                  // N parapet
  { t: 'wall', axis: 'z', cx: 50, cz: -18, base: 4.5, length: 10, height: 1.6, thick: 0.4 },        // W parapet (solid)
  { t: 'wall', axis: 'z', cx: 60, cz: -18, base: 4.5, length: 10, height: 1.6, thick: 0.4,
    window: { width: 5, height: 0.9, sill: 0.6 } },                                                  // E parapet
  // Cover crate on the roof.
  { t: 'box', cx: 55, cz: -20, base: 4.5, sx: 1.6, sy: 1.0, sz: 1.6 },

  // =====================================================================
  // EAST: WAREHOUSE — long single-story building, two rooms via interior wall
  //   ground floor: 20×12 walled building. Interior partition wall splits it
  //                 into a west room (entry) and east room (loot), connected
  //                 by an interior doorway
  //   roof: walkable solid deck at y=4.0 — the whole 20×12 platform
  // =====================================================================
  { t: 'platform', id: 'WAREHOUSE_ROOF', cx: 45, cz: 8, top: 4.0, sx: 20, sz: 12 },
  // Outer walls. S55b: S wall has a TALL doorway sized to the external
  // staircase (was a window; the wall body blocked the stair landing).
  { t: 'wall', axis: 'x', cx: 45, cz:  2, length: 20, height: 4.0, thick: 0.5,
    window: { width: 3.0, height: 1.2, sill: 1.1 } },                                                // N (faces plaza)
  { t: 'wall', axis: 'x', cx: 45, cz: 14, length: 20, height: 4.0, thick: 0.5,
    door: { width: 5.2, height: 4.0 } },                                                             // S: tall stair-doorway
  { t: 'wall', axis: 'z', cx: 35, cz:  8, length: 12, height: 4.0, thick: 0.5,
    door: { width: 2.6, height: 2.8 } },                                                             // W doorway (entry)
  { t: 'wall', axis: 'z', cx: 55, cz:  8, length: 12, height: 4.0, thick: 0.5,
    window: { width: 2.4, height: 1.2, sill: 1.1 } },                                                // E
  // Interior partition wall (axis=x, splits the building N/S at cz=8) with one doorway.
  // Wait — interior splitting a 20×12 building (sx=20 sz=12, cz=8 center) would run along
  // x at some inner z. But sz=12 means z extent is [2,14]. An x-axis wall at cz=8 cuts the
  // building E-W; instead, what we want is a z-axis wall at some cx that splits the building
  // into a west room and east room. Put it at cx=45 (center) with axis='x'? No — axis='x'
  // means the wall runs along X.
  // For splitting into west/east halves we need a wall running along Z (axis='z'), at cx=45.
  { t: 'wall', axis: 'z', cx: 45, cz: 8, length: 12, height: 4.0, thick: 0.4,
    door: { width: 2.2, height: 2.6 } },                                                             // interior partition with doorway
  // Roof parapets — S side has a doorway aligned with the stair landing so
  // the player can walk OFF the stair onto the roof (was a window → blocked).
  { t: 'wall', axis: 'x', cx: 45, cz:  2, base: 4.0, length: 20, height: 1.6, thick: 0.4,
    window: { width: 10, height: 0.8, sill: 0.7 } },
  { t: 'wall', axis: 'x', cx: 45, cz: 14, base: 4.0, length: 20, height: 1.6, thick: 0.4,
    door: { width: 5.2, height: 1.6 } },                                                             // S parapet doorway
  { t: 'wall', axis: 'z', cx: 35, cz:  8, base: 4.0, length: 12, height: 1.6, thick: 0.4 },         // W solid
  { t: 'wall', axis: 'z', cx: 55, cz:  8, base: 4.0, length: 12, height: 1.6, thick: 0.4,
    window: { width: 5, height: 0.8, sill: 0.7 } },
  // Stairs up to the WAREHOUSE roof — on the +z side (faces south, away from the entry).
  { t: 'stairsTo', to: 'WAREHOUSE_ROOF', side: '+z', run: 7, width: 5, fromY: 0, steps: 8 },

  // =====================================================================
  // SOUTH-WEST: GUARDHOUSE_W — single-story enclosed room (loot stash)
  //   12×10, doorway on the east side (faces plaza), windows
  // =====================================================================
  { t: 'wall', axis: 'x', cx: -40, cz:  9, length: 12, height: 3.6, thick: 0.5,
    window: { width: 2.2, height: 1.2, sill: 1.1 } },                                                // N
  { t: 'wall', axis: 'x', cx: -40, cz: 19, length: 12, height: 3.6, thick: 0.5,
    window: { width: 2.2, height: 1.2, sill: 1.1 } },                                                // S
  { t: 'wall', axis: 'z', cx: -46, cz: 14, length: 10, height: 3.6, thick: 0.5 },                   // W solid
  { t: 'wall', axis: 'z', cx: -34, cz: 14, length: 10, height: 3.6, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // E doorway

  // =====================================================================
  // SOUTH-WEST: HOUSE_SW — single-story house
  // =====================================================================
  { t: 'wall', axis: 'x', cx: -50, cz: 30, length: 14, height: 3.6, thick: 0.5,
    door: { width: 2.4, height: 2.6 } },                                                             // N doorway (faces plaza-ish)
  { t: 'wall', axis: 'x', cx: -50, cz: 42, length: 14, height: 3.6, thick: 0.5,
    window: { width: 2.2, height: 1.2, sill: 1.1 } },                                                // S
  { t: 'wall', axis: 'z', cx: -57, cz: 36, length: 12, height: 3.6, thick: 0.5,
    window: { width: 2.2, height: 1.2, sill: 1.1 } },                                                // W
  { t: 'wall', axis: 'z', cx: -43, cz: 36, length: 12, height: 3.6, thick: 0.5,
    window: { width: 2.2, height: 1.2, sill: 1.1 } },                                                // E

  // =====================================================================
  // SOUTH: BUNKER_S — small enclosed concrete bunker (loot stash)
  //   10×8 walled box, single doorway on the north (faces plaza)
  // =====================================================================
  { t: 'wall', axis: 'x', cx:  0, cz: 36, length: 10, height: 3.0, thick: 0.6,
    door: { width: 2.0, height: 2.4 } },                                                             // N doorway
  { t: 'wall', axis: 'x', cx:  0, cz: 44, length: 10, height: 3.0, thick: 0.6 },                    // S solid
  { t: 'wall', axis: 'z', cx: -5, cz: 40, length: 8,  height: 3.0, thick: 0.6,
    window: { width: 1.4, height: 0.8, sill: 1.1 } },                                                // W slit
  { t: 'wall', axis: 'z', cx:  5, cz: 40, length: 8,  height: 3.0, thick: 0.6,
    window: { width: 1.4, height: 0.8, sill: 1.1 } },                                                // E slit

  // =====================================================================
  // SOUTH-EAST: RUINS — broken walls + scattered cover (open combat zone)
  //   No platforms — just walls of varying lengths and orientations to break
  //   up sightlines, plus a few cover crates
  // =====================================================================
  // L-shaped ruin wall fragments.
  { t: 'wall', axis: 'x', cx: 35, cz: 30, length: 10, height: 3.0, thick: 0.6,
    door: { width: 2.2, height: 2.4 } },                                                             // S55 DOORWAYS: (43,30) close enough
  { t: 'wall', axis: 'z', cx: 30, cz: 35, length: 10, height: 3.0, thick: 0.6,
    window: { width: 2.0, height: 1.0, sill: 1.0 } },
  { t: 'wall', axis: 'x', cx: 50, cz: 45, length: 8,  height: 2.4, thick: 0.6 },
  { t: 'wall', axis: 'z', cx: 55, cz: 40, length: 8,  height: 2.4, thick: 0.6,
    window: { width: 2.0, height: 1.0, sill: 0.9 } },
  // A small broken platform (former floor of a collapsed building).
  { t: 'platform', id: 'RUINS_DECK', cx: 45, cz: 50, top: 2.0, sx: 6, sz: 6 },
  { t: 'rampTo', to: 'RUINS_DECK', side: '-z', run: 4, width: 4, fromY: 0 },

  // =====================================================================
  // FAR-WEST: PERIMETER RAMPART — long elevated walkway along the west edge
  //   useful for a sniper to flank the whole map
  // =====================================================================
  { t: 'platform', id: 'WEST_RAMPART', cx: -65, cz: 0, top: 5.0, sx: 8, sz: 28 },
  { t: 'rampTo', to: 'WEST_RAMPART', side: '+x', run: 7, width: 5, fromY: 0 },
  { t: 'wall', axis: 'z', cx: -69, cz: 0, base: 5.0, length: 28, height: 2.0, thick: 0.4,
    window: { width: 16, height: 1.0, sill: 0.8 } },
  { t: 'wall', axis: 'x', cx: -65, cz: -14, base: 5.0, length: 8, height: 2.0, thick: 0.4 },
  { t: 'wall', axis: 'x', cx: -65, cz:  14, base: 5.0, length: 8, height: 2.0, thick: 0.4 },

  // =====================================================================
  // CATWALKS — link the elevated decks so the high circuit forms a loop
  // =====================================================================
  // CATWALK_HE — walkway at y=6.0, flush with HILLTOP east edge, extending
  // east into the gap between HILLTOP and HOUSE_NE. Does NOT overlap any
  // building footprint (the only thing in its z range at this y is HILLTOP).
  // Top is HILLTOP top (y=6.0) so it forms a continuous walk-across loop.
  { t: 'box', id: 'CATWALK_HE', cx: 19, cz: -50, base: 5.4, sx: 22, sy: 0.6, sz: 4 },
  // West edge at x=8 = HILLTOP east edge (flush walkway).
  // East edge at x=30. HOUSE_NE_F2 west edge at x=33 (3m gap — sprint-jump it).
  // HOUSE_NE_F2 top y=4.0; CATWALK_HE top y=6.0 → drop down onto the house roof.
  // S55: a stair down from the south-facing edge of CATWALK_HE creates an
  // actual LOOP in the route graph: ground → CATWALK_HE → HILLTOP → (ramp)
  // → ground. The stair foot lands in open ground (x∈[15,23], z=-38), no
  // building footprint conflict.
  { t: 'stairsTo', to: 'CATWALK_HE', side: '+z', run: 10, width: 8, fromY: 0, steps: 11 },

  // =====================================================================
  // COVER BOXES — scatter in the plaza + around buildings for cover
  // =====================================================================
  // PLAZA (around spawn).
  { t: 'box', cx:  7, cz:  4, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx: -8, cz:  6, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx:  5, cz: -8, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx: -10, cz: -10, sx: 2.4, sy: 1.2, sz: 2.4 },
  { t: 'box', cx: 12, cz: -3, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx: -3, cz: 14, sx: 2.4, sy: 1.1, sz: 2.4 },
  // EAST CORRIDOR (between plaza and WAREHOUSE/TOWER_NE).
  { t: 'box', cx: 22, cz: -10, sx: 2.4, sy: 1.0, sz: 2.4 },
  { t: 'box', cx: 28, cz:  0, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx: 30, cz: 18, sx: 2.4, sy: 1.0, sz: 2.4 },
  // WEST corridor (between plaza and HOUSE_NW / HOUSE_SW).
  { t: 'box', cx: -22, cz: -8, sx: 2.4, sy: 1.0, sz: 2.4 },
  { t: 'box', cx: -20, cz:  4, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx: -25, cz: 18, sx: 2.4, sy: 1.0, sz: 2.4 },
  // NORTH approach to HILLTOP.
  { t: 'box', cx:  -10, cz: -25, sx: 2.4, sy: 1.0, sz: 2.4 },
  { t: 'box', cx:   12, cz: -25, sx: 2.4, sy: 1.0, sz: 2.4 },
  // SOUTH zone around BUNKER + RUINS.
  { t: 'box', cx: -12, cz: 32, sx: 2.4, sy: 1.0, sz: 2.4 },
  { t: 'box', cx:  15, cz: 32, sx: 2.4, sy: 1.0, sz: 2.4 },
  { t: 'box', cx:  25, cz: 48, sx: 2.4, sy: 1.0, sz: 2.4 },
  { t: 'box', cx: -25, cz: 52, sx: 2.4, sy: 1.0, sz: 2.4 },
  // FAR-WEST approach to WEST_RAMPART.
  { t: 'box', cx: -55, cz: -10, sx: 2.4, sy: 1.0, sz: 2.4 },
  { t: 'box', cx: -55, cz:  10, sx: 2.4, sy: 1.0, sz: 2.4 },
];

// --- PICKUPS (M15 Stage 3) ---
// S55: weapons distributed across the bigger map; each requires a real trip
// to a distinct building, so the player has to learn the layout. Health
// pickups spread across every quadrant so an engaged player at any spot has
// a nearby refill option.
export const PICKUPS = [
  // weapons — one of each non-pistol gun. Each pickup must land on the
  // HIGHEST walkable surface at its (x,z) so the harness_pickups check
  // sees it on the floor — that means pickups inside buildings with a
  // roof platform overhead go ON THE ROOF, not the ground floor.
  { kind: 'weapon', what: 'shotgun', x:  45, z:  10, y: 4.0 },   // WAREHOUSE roof
  { kind: 'weapon', what: 'smg',     x:   0, z:  40, y: 0   },   // BUNKER_S interior (open roof)
  { kind: 'weapon', what: 'saw',     x:   0, z: -50, y: 6.0 },   // HILLTOP perch
  { kind: 'weapon', what: 'sniper',  x:  55, z: -18, y: 4.5 },   // TOWER_NE rooftop
  // health — distributed across all quadrants + elevations; placed in open
  // areas (no cover box / overhead deck shadowing them).
  { kind: 'health', x:  10, z:  10, y: 0 },                       // plaza east
  { kind: 'health', x: -14, z: -13, y: 0 },                       // plaza west (off the cover boxes)
  { kind: 'health', x: -35, z: -30, y: 4.0 },                     // HOUSE_NW 2nd floor
  { kind: 'health', x:  40, z: -42, y: 4.0 },                     // HOUSE_NE 2nd floor
  { kind: 'health', x: -50, z:  37, y: 0 },                       // HOUSE_SW interior
  { kind: 'health', x:  20, z:  20, y: 0 },                       // SE quadrant
  { kind: 'health', x: -65, z:   0, y: 5.0 },                     // WEST_RAMPART
  { kind: 'health', x:  45, z:  50, y: 2.0 },                     // RUINS_DECK
];
