// maplayout.js — THE CITADEL (v3: enclosure, doorways, windows).
//
// SINGLE SOURCE OF TRUTH (pure data + one pure helper, no engine imports)
// shared by the runtime (arena.js + kit.js) and the offline analyzer
// (mapviz.mjs). Connectors reference a platform by `to:<id>` so the kit's
// seamless-join contract holds by construction.
//
// Schema (entry type `t`):
//   ground / perimeter / platform / box / wall / rampTo / stairsTo / overhang
//   wall now supports an APERTURE so it can be a DOORWAY or a WINDOW:
//     { t:'wall', cx,cz, base?, length, height, thick?, axis,
//       door?:{width,height,offset?}            // gap from the floor up
//       window?:{width,height,sill,offset?} }   // gap in a mid band
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

export const LAYOUT = [
  // --- shell ---
  { t: 'ground', half: 40, y: 0 },
  { t: 'perimeter', half: 40, height: 14, thick: 1.0 },

  // --- NORTH: central KEEP (tier 4.5) ---
  { t: 'platform', id: 'KEEP', cx: 0, cz: -20, top: 4.5, sx: 20, sz: 16 },
  { t: 'rampTo',   to: 'KEEP', side: '+z', run: 9, width: 8, fromY: 0 },
  { t: 'stairsTo', to: 'KEEP', side: '-x', run: 9, width: 6, fromY: 0, steps: 9 },

  // --- NORTH-EAST: walkway -> tower -> catwalk -> rampart ---
  { t: 'platform', id: 'TOWER', cx: 27, cz: -22, top: 7.0, sx: 10, sz: 10 },
  { t: 'box', id: 'BRIDGE', cx: 15.5, cz: -20, base: 3.9, sx: 11, sy: 0.6, sz: 6 },
  { t: 'rampTo', to: 'TOWER', side: '-x', run: 6, width: 5, fromY: 4.5 },
  { t: 'platform', id: 'RAMPART', cx: 27, cz: -34, top: 7.0, sx: 14, sz: 6 },
  { t: 'box', id: 'CATWALK', cx: 27, cz: -29, base: 6.4, sx: 8, sy: 0.6, sz: 4 },

  // --- WEST annex (tier 3.0) ---
  { t: 'platform', id: 'WEST', cx: -28, cz: -6, top: 3.0, sx: 12, sz: 18 },
  { t: 'rampTo', to: 'WEST', side: '+x', run: 8, width: 6, fromY: 0 },

  // --- SOUTH bastion / gatehouse (tier 2.5) ---
  { t: 'platform', id: 'SOUTH', cx: 0, cz: 22, top: 2.5, sx: 18, sz: 10 },
  { t: 'rampTo',   to: 'SOUTH', side: '-z', run: 8, width: 7, fromY: 0 },
  { t: 'stairsTo', to: 'SOUTH', side: '+x', run: 7, width: 5, fromY: 0, steps: 7 },

  // --- EAST redoubt (tier 2.5) ---
  { t: 'platform', id: 'EAST', cx: 30, cz: 6, top: 2.5, sx: 10, sz: 16 },
  { t: 'rampTo', to: 'EAST', side: '-x', run: 7, width: 6, fromY: 0 },

  // --- SW covered crouch corridor ---
  { t: 'overhang', axis: 'x', loPos: -30, hiPos: -16, loY: 0.2, hiY: 3.4,
    c0: 10, c1: 16, thick: 0.6 },

  // ===================  ENCLOSURE / SIGHTLINE CONTROL  ================
  // Enclosed OUTPOST room (east-central courtyard, clear of every connector
  // corridor). Doorway faces south (away from spawn) so you can't see who's
  // inside until you flank it; windows on the spawn-facing (north) and west
  // sides to shoot out of without being walk-through.
  { t: 'wall', axis: 'x', cx: 11, cz: 4,  length: 10, height: 4.0, thick: 0.6,
    window: { width: 2.6, height: 1.3, sill: 1.1 } },                  // N (faces spawn)
  { t: 'wall', axis: 'x', cx: 11, cz: 14, length: 10, height: 4.0, thick: 0.6,
    door:   { width: 2.4, height: 2.6 } },                             // S doorway
  { t: 'wall', axis: 'z', cx: 6,  cz: 9,  length: 10, height: 4.0, thick: 0.6,
    window: { width: 2.6, height: 1.3, sill: 1.1 } },                  // W window
  { t: 'wall', axis: 'z', cx: 16, cz: 9,  length: 10, height: 4.0, thick: 0.6 }, // E solid

  // Tall freestanding SCREEN with a doorway: breaks the spawn↔west diagonal
  // so it isn't a clean line; the doorway is the only ground gap.
  { t: 'wall', axis: 'x', cx: -9, cz: 2, length: 12, height: 3.6, thick: 0.6,
    door: { width: 2.6, height: 2.6 } },

  // Second screen with a doorway, breaking the east-central sightline.
  { t: 'wall', axis: 'z', cx: 16, cz: -4, length: 12, height: 3.4, thick: 0.6,
    door: { width: 2.4, height: 2.4 } },

  // Window-slit wall covering the SE open ground (shoot through the slit).
  { t: 'wall', axis: 'x', cx: 20, cz: 16, length: 12, height: 3.4, thick: 0.6,
    window: { width: 3.0, height: 1.0, sill: 1.2 } },

  // ===============  PARAPETS ON THE ELEVATED PLATFORMS  ==============
  // Each deck gets fortified rim walls (base = its top) on the edges its
  // connector does NOT use, so you arrive freely but the position is
  // enclosed: a 2.2 m wall blocks line of sight INTO the deck (surprise —
  // you can't see who's holding it), with a window slit to shoot OUT from
  // cover. Verified not to block any connector (mapviz seam check).
  // KEEP (top 4.5): ramp on +z, stairs on -x, BRIDGE on +x → wall the -z rim.
  { t: 'wall', axis: 'x', cx: 0,  cz: -28, base: 4.5, length: 20, height: 2.2, thick: 0.4,
    window: { width: 9, height: 1.0, sill: 1.0 } },
  // WEST (top 3.0): ramp on +x → wall the +z and -x rims.
  { t: 'wall', axis: 'x', cx: -28, cz: 3,  base: 3.0, length: 12, height: 2.2, thick: 0.4,
    window: { width: 6, height: 1.0, sill: 1.0 } },
  { t: 'wall', axis: 'z', cx: -34, cz: -6, base: 3.0, length: 18, height: 2.2, thick: 0.4,
    window: { width: 8, height: 1.0, sill: 1.0 } },
  // SOUTH (top 2.5): ramp on -z, stairs on +x → wall the +z rim.
  { t: 'wall', axis: 'x', cx: 0,  cz: 27, base: 2.5, length: 18, height: 2.2, thick: 0.4,
    window: { width: 8, height: 1.0, sill: 1.0 } },
  // EAST (top 2.5): ramp on -x → wall the +x and -z rims.
  { t: 'wall', axis: 'z', cx: 35, cz: 6,  base: 2.5, length: 16, height: 2.2, thick: 0.4,
    window: { width: 8, height: 1.0, sill: 1.0 } },
  { t: 'wall', axis: 'x', cx: 30, cz: -2, base: 2.5, length: 10, height: 2.0, thick: 0.4,
    window: { width: 5, height: 1.0, sill: 1.0 } },
  // TOWER (top 7.0): ramp on -x, CATWALK on -z → wall +x and +z (sniper nest).
  { t: 'wall', axis: 'z', cx: 32, cz: -22, base: 7.0, length: 10, height: 2.2, thick: 0.4,
    window: { width: 4, height: 1.0, sill: 1.0 } },
  { t: 'wall', axis: 'x', cx: 27, cz: -17, base: 7.0, length: 10, height: 2.2, thick: 0.4,
    window: { width: 5, height: 1.0, sill: 1.0 } },
  // RAMPART (top 7.0): CATWALK on +z → wall -z and +x (fortified vantage).
  // The -x side is now the BACK STAIRCASE down to the courtyard floor (loop
  // closer + an attack route up to / escape down from the sniper perch),
  // so it is intentionally open (the stairs are the access).
  { t: 'wall', axis: 'x', cx: 27, cz: -37, base: 7.0, length: 14, height: 2.2, thick: 0.4,
    window: { width: 7, height: 1.0, sill: 1.0 } },
  { t: 'wall', axis: 'z', cx: 34, cz: -34, base: 7.0, length: 6, height: 2.0, thick: 0.4,
    window: { width: 3, height: 1.0, sill: 1.0 } },
  // Long back staircase: RAMPART (7.0) ↓ ground. Closes the high circuit
  // (courtyard → KEEP → BRIDGE → TOWER → CATWALK → RAMPART → here → back).
  { t: 'stairsTo', to: 'RAMPART', side: '-x', run: 14, width: 5, fromY: 0, steps: 12 },

  // --- cover (clear of decks, rooms, screens, connector corridors) ---
  { t: 'box', cx: -6, cz: -8, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx:  7, cz: -8, sx: 2.0, sy: 1.0, sz: 2.0 },
  { t: 'box', cx: -7, cz: 13, sx: 3.0, sy: 1.3, sz: 3.0 },
  { t: 'box', cx: -18, cz: 6, sx: 2.4, sy: 1.2, sz: 2.4 },
  { t: 'box', cx: -17, cz: -16, sx: 2.2, sy: 1.0, sz: 2.2 },
  { t: 'box', cx: 28, cz: -6, sx: 2.4, sy: 1.1, sz: 2.4 },
  { t: 'box', cx: -13, cz: 20, sx: 2.4, sy: 1.0, sz: 2.4 },
  { t: 'box', cx:  0, cz: -25, base: 4.5, sx: 3.0, sy: 1.1, sz: 2.0 }, // keep parapet
  { t: 'box', cx: 27, cz: -22, base: 7.0, sx: 2.0, sy: 1.0, sz: 2.0 }, // tower parapet
  { t: 'box', cx:  0, cz: 24, base: 2.5, sx: 3.0, sy: 1.0, sz: 1.6 },  // bastion parapet
];
