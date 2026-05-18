# fps-edge / Quake "The Edge" import — status

This directory is a **side-project spike**, forked from `fps/` to experiment
with importing Quake's *The Edge* (q2dm1) into the engine's LAYOUT vocabulary.

## What works

- `dev/import_edge.py` parses `dev/source/q2dm1q1restoration.map` (Tim Willits /
  Chuma restoration, see `dev/source/README.md`), computes each brush's
  AABB by intersecting half-spaces, and emits a generated `src/maplayout.js`.
- 1025 boxes survive filtering (sky / trigger / clip / sub-volume slivers
  dropped). 12 deathmatch spawns and 28 pickups (weapons mapped per
  `weapon_map` in the importer; armor and ammo skipped).
- The resulting plan view + oblique read as recognisably *The Edge*
  (central courtyard, slipgate column, rocket-launcher pit, upper bridge).

## What is broken and why

`dev/test-all.sh` does NOT pass on this map. The failures are structural,
not bugs in the import:

- `harness_ai` / `harness_arena` / `harness_doors` / `harness_pickups` all
  reference structures by ID (`HILLTOP`, `HOUSE_NW_F2`, `CATWALK_HE`,
  `WAREHOUSE_ROOF`) that exist in `fps/`'s structured map and not in a
  brush-imported one.
- `mapviz` reports `overlap issues≈1293`, `stranded surfaces=1025`,
  `unreachable pickups=28`, `loop=NO`. These reflect the engine validator's
  assumptions (named platforms, explicit `rampTo`/`stairsTo` connectors, an
  AI-routable DOORWAYS registry), none of which Quake brushes provide.

The geometric vocabularies don't align:

| Engine LAYOUT          | Quake .map                        |
|------------------------|-----------------------------------|
| Axis-aligned boxes     | Convex polyhedra at any angle     |
| `rampTo` / `stairsTo`  | Brush slopes / `func_plat`        |
| Wall + door/window     | Many small brushes outlining ap.  |
| Single ground plane    | Multi-level "floors" everywhere   |
| (no teleporters)       | `trigger_teleport` pairs          |
| (no water)             | Water/lava sectors                |

Sloped Quake surfaces become stair-step AABB stacks in the conversion; the
result is playable as collision soup but visually blocky.

## How to ship this

Three options, escalating in cost:

1. **Stop.** Keep the spike as reference; don't deploy.
2. **Adapt validators.** Add a "free-form map" mode where `mapviz` skips
   connector-graph + reachability checks and map-specific harnesses are
   gated on a structured-map flag. ~4 files, real but bounded work.
3. **Distill brush-soup → structured LAYOUT.** Post-process the 1025 boxes
   into ~20–30 named rooms with auto-routed ramps/stairs. Heavier, lossier.

## Deployment caveat

GitHub Pages serves from repo root. `fps-edge/` in a subfolder won't be
served alongside the live `fps/` deployment. Standalone hosting needed if
you ever want to play this in a browser.

## Source attribution

The Quake map source in `dev/source/` is Chuma's `q2dm1q1restoration`,
which is a restoration of Tim Willits's Quake 1 conversion of his own
Quake 2 *The Edge* (q2dm1). Full credits in `dev/source/README.md`.
