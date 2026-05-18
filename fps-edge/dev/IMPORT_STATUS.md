# fps-edge / Quake "The Edge" import — status

This directory is a **standalone project** forked from `fps/` to bring The
Edge (q2dm1) into the engine. Its own validators, test runner, and runtime
features (e.g. teleporters) live here. The fps/ contract no longer applies
verbatim — see §"Validation" below for the rules this project plays by.

## Quick run

```sh
# 1. Re-import from the Quake .map (regenerates src/maplayout.js).
python3 dev/import_edge.py

# 2. Validate (engine-pure harnesses + edge_validate.mjs).
cd dev && bash test-all.sh

# 3. Render plan / oblique / FP views (mapviz + fps-render → PNG).
bash render-map.sh

# 4. Serve locally to play in a browser.
python3 -m http.server 8000   # from fps-edge/
```

## What works

### Importer (`dev/import_edge.py`, v2)
- Parses 699 entities + 1500+ brushes from
  `dev/source/q2dm1q1restoration.map`.
- Each world / `func_wall` brush → AABB via plane-triple vertex enumeration.
- **Slope detection**: when a brush's top face is tilted 5–66° (dot-with-UP
  between 0.40 and 0.98), it's converted to a stair-step stack instead of
  one inflated AABB. ~27 brushes hit this path.
- **Filters**: sky / trigger / clip / origin brushes dropped by texture
  name; water marked but kept as cosmetic; sub-volume slivers (<0.008 m³)
  dropped.
- **Teleporters**: each `trigger_teleport` entity's union AABB +
  destination point is emitted as a new `{ t: 'teleporter' }` LAYOUT entry.
- **Spawns**: all 12 `info_player_deathmatch` entries → SPAWN_ANCHORS;
  the closest-to-origin one is the default SPAWN.
- **Pickups**: weapons mapped to engine equivalents
  (SSG→shotgun, NG→smg, SNG→saw, LG→sniper; RL/GL dropped — no engine
  splash damage); 22 healths → kept; armors/ammo dropped.

Current output: **1132 boxes + 3 teleporters + 12 spawn anchors + 28
pickups**, map extents 73 × 76 m horizontal × 46 m tall.

### Runtime: teleporter primitive
- `src/teleporters.js` — registers trigger volumes from LAYOUT
  (`{ t: 'teleporter', x0..z1, dx,dy,dz, name }`) at arena-build time;
  `applyTeleport(dt)` runs in the main loop after `updatePlayer(dt)` and
  warps the player + zeros their velocity when their capsule enters a
  trigger AABB. 350 ms hysteresis prevents instant re-trigger.
- Hooked into `src/arena.js` (`case 'teleporter': registerTeleporter(e)`)
  and `src/main.js` (`applyTeleport(dt)`).

### Runtime: elevator primitive (NEW)
- `src/elevators.js` — registers `func_plat` brushes from LAYOUT
  (`{ t: 'elevator', cx,cz,sx,sy,sz, bottomY, topY, speed, wait, startsAtTop }`)
  with a KINEMATIC solid (`solids[].kind = 'box'` whose `minY` / `maxY` /
  `topY` / plane d-values are mutated each frame) plus a matching THREE.Mesh
  that follows. State machine: `at_top → falling → at_bottom → rising →
  at_top`. Triggers:
  - `playerOnPlate(lift)` — player capsule standing on the moving deck.
  - `playerCalling(lift)` — player in the plate's XZ but at/below `bottomY`
    (the Quake "lower trigger field" pattern). When plate is `at_top` and
    a player is calling, it drops to pick them up.
- Hooked into `src/arena.js` (`case 'elevator': registerElevator(e)`) and
  `src/main.js` (`updateElevators(dt)` called BEFORE `updatePlayer` so the
  player's gravity step sees the moved plate y in the same frame).
- Importer reads Quake `func_plat` conventions: the brush ALWAYS represents
  the top (raised) position; `height` keyvalue gives travel distance
  (default = overall brush AABB height − 8). spawnflags bit 1 only relocates
  the trigger field, not the rest position. Two lifts extracted:
  - **RL pit lift** (cx=25.5, cz=-12.9): 4×4 m plate, y=21.75 → y=40.0
    (18.25 m travel).
  - Smaller lift (cx=14.5, cz=-15.4): 2×3 m plate, y=28.4 → y=36.0
    (7.6 m travel).

### Visualization
- `dev/mapviz.mjs` still produces useful plan + oblique + elevation SVGs
  (it ignores the connector-graph violations and just paints solids).
- `dev/render-map.sh` converts SVG → PNG via cairosvg, PPM → PNG via
  Pillow. **The plan view (`map_plan_all.png`) is recognisably The Edge.**

## Validation

The fps/ validators were built for the engine's **structured map model**
(named platforms, explicit `rampTo` / `stairsTo` connectors, DOORWAYS
registry). A Quake-imported map has none of that — the LAYOUT is brush
soup. Adapted validation:

| Check                         | fps/ source       | fps-edge equivalent          |
|-------------------------------|-------------------|------------------------------|
| Syntax                        | `node --check`    | unchanged                    |
| Engine-pure harnesses (×6)    | green             | green (same — they don't read the map) |
| Map-dependent harnesses (×4)  | green             | **SKIPPED** (assume IDs that don't exist) |
| `mapviz.mjs`                  | strict            | superseded by `edge_validate.mjs` |
| Map analysis                  | connector graph   | **`edge_validate.mjs`** — brush-aware |

### `dev/edge_validate.mjs` checks
1. SPAWN sits on walkable ground (capsule fits).
2. Every PICKUPS entry sits within 1.5 m vertical of a walkable surface.
3. Every teleporter has a non-degenerate trigger volume and its dest is on
   walkable ground.
4. **Reachability**: capsule-aware 2D BFS from EVERY SPAWN_ANCHOR (the
   engine's arena mode respawns the player at any anchor). Per cell:
   step-up ≤ 0.6 m, jump-up ≤ 1.5 m, drops unlimited, teleporters as
   directed edges. Each pickup must land in or adjacent to a visited cell
   within 1.5 m vertical.
5. Performance hint (solid count).

`dev/test-all.sh` runs the 6 engine-pure harnesses + `edge_validate`.

### Current results

```
ALL ENGINE-PURE HARNESSES GREEN (101/101)
SUMMARY: solids=1138  teleporters=3  pickups=28  floating=0  unreachable=0
*** EDGE MAP OK ***
ALL GREEN
```

**Spawn ✓ — Pickups all on surfaces ✓ — Teleporters ✓ — Elevators ✓ — Reachability: 28 of 28 pickups reachable from spawn anchors (100%).**

The previous "15 unreachable" was a validator artifact: the BFS keyed cells
by (ix,iz) only, so when a stacked Edge corridor had two walkable floors at
the same XZ, only one was tracked. Multi-y BFS keys cells by (ix,iz,iy)
with iy a 2 m bucket, runs both a climb-clipped probe and a drop probe per
neighbour, and now reaches every pickup.

## Known gaps (priority order)

1. ~~**Elevators (`func_plat`)**~~ — done (see Runtime section above).
2. **Doorway preservation** — detect Quake wall brushes with carved
   apertures in adjacent brush stacks; ensure the resulting AABB cluster
   leaves a passable gap. Heuristic post-pass on the imported LAYOUT.
3. **Water surfaces** — currently dropped; could become slow-walk zones
   later.
4. **Weapon coverage** — RL + GL dropped because the engine has no splash
   damage. Adding a projectile-with-radius-damage weapon is its own ticket.
5. **Quake-style textures** — runtime uses procedural engine textures. A
   Quake-flavoured texture pack (rust metal, sandstone, computer panels)
   would help the visual sell.

## Deployment caveat

GitHub Pages serves from repo root. `fps-edge/` in a subfolder is NOT
auto-deployed alongside the live `fps/` build. To deploy, either move
`fps-edge/` to root (replacing `fps/`) or set up a separate Pages site.

## Source attribution

The Quake map source in `dev/source/` is Chuma's `q2dm1q1restoration`, a
restoration of Tim Willits's Q1 conversion of his own Q2 q2dm1 "The Edge".
Full credits in `dev/source/README.md`.
