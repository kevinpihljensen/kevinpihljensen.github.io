# CLAUDE.md — Project handover & working agreement

Read this fully before touching anything. This file is the contract for
how work on this repo is done. The project has survived 40+ sessions
because every change is verified against a regression battery before it
ships. Skipping that is the one way to actually break this project.

---

## 1. What this is

A single-player browser FPS wave shooter.

- **Engine:** Three.js **r160**, loaded from a CDN via an importmap.
- **Language:** vanilla JavaScript, ES modules. No TypeScript.
- **Build:** there is **no build step**. No bundler, no npm install, no
  framework. The browser runs `src/*.js` directly.
- **Run:** static hosting only. `index.html` loads ES modules, which
  browsers refuse to fetch over `file://`. It must be served over
  http(s). Production is **GitHub Pages**; local dev is any static
  server (`python3 -m http.server 8000`).

## 2. Hard constraints — do not violate without explicit user approval

- **No new dependencies.** No npm, no package.json, no bundler
  (Webpack/Vite/Rollup/esbuild/Parcel), no framework (React/Vue/etc.),
  no CSS framework, no jQuery. Three.js r160 from the pinned CDN is the
  only external library. Do not bump the Three.js version.
- **No build step.** The game must run by serving the folder as-is.
- **No external runtime assets** beyond what is in `assets/`. Geometry
  is MOSTLY procedural (BoxGeometry etc.); the lone authored 3D asset is
  `assets/models/medkit.glb`, used by the health pickup and loaded via
  `GLTFLoader` (`three/addons/loaders/GLTFLoader.js`, added to the
  importmap as `three/addons/`). Audio is the bundled `.wav` files. New
  authored assets are a deviation from this contract — flag and ask
  before adding more.
- **GitHub Pages serves from the repo ROOT.** `index.html`, `src/`,
  `assets/` must sit at the repository root — NOT nested in a subfolder.
  If they are nested, Pages 404s. This has bitten the project before.
- **Deterministic gameplay.** All movement/physics is delta-time based,
  never frame-count based. Do not introduce per-frame `Math.random()`
  into deterministic paths without a reason and a test.
- **Output complete files.** When changing a module, the working copy
  must remain complete and runnable. No "// rest unchanged" fragments.

## 3. Repository layout

```
index.html            entry point (served over http; do NOT double-click)
src/*.js               game source — 18 ES modules (see §4)
assets/audio/*.wav     sound effects, loaded at runtime
dev/                   VERIFICATION TOOLING — see §6. Not shipped to
                       players but lives in the repo so the battery is
                       reproducible. Pages ignores it (static files).
  harness_*.mjs        9 regression harnesses (Node, no browser)
  mapviz.mjs           offline map analyzer (geometry/flow/seam checks)
  test-all.sh          runs the whole battery + syntax + mapviz
build-singlefile.mjs   OPTIONAL one-file builder. Not used by Pages, not
                       required to run the game. Safe to ignore.
changelog.md           full session history — newest entry on top
README.md              run/deploy instructions
CLAUDE.md              this file
```

## 4. Module map (`src/`)

18 ES modules. **Critical:** `build-singlefile.mjs` concatenates module
bodies stripping import/export lines, so **every top-level identifier
must be unique across all modules.** Even if you never run the bundler,
keep names globally unique — it is a project invariant.

- `constants.js` — all tunables (speeds, damage, ranges, AI thresholds).
  Pure, no imports → Node-importable. Change tuning HERE, not inline.
- `state.js` — shared mutable game/player state.
- `scene.js` — Three.js scene/camera/renderer/lights singletons.
- `collision.js` — AABB/ramp solids, capsule collision, `lineOfSight`,
  `rampLinks`, `groundHeightAt`. Imports only `COLLIDE_EPS` from
  constants → Node-importable. **Highest-risk file. Touch with care;
  it has the most tests for a reason.**
- `maplayout.js` — PURE DATA: `LAYOUT`, `SPAWN`, and the pure
  `wallBoxes()` decomposition. No engine imports → Node-importable.
  The map is data-driven; edit the map HERE.
- `kit.js` — builder helpers (platform/box/wall/ramp/stairs/overhang/
  solidBox) that turn LAYOUT entries into solids + meshes.
- `arena.js` — thin dispatcher: walks `LAYOUT`, calls `kit`.
- `textures.js`, `decals.js` — procedural textures, bullet decals.
- `projectiles.js` — enemy projectile pool + update.
- `enemies.js` — enemy models, spawn, **AI** (grunt/shooter/heavy),
  navigation, LOS, scatter. Largest behavioural file.
- `weapons.js` — weapon defs, view models, firing, knife, SAW bloom.
- `player.js` — player movement, camera, health, knife speed buff.
- `wave.js` — wave progression + weapon unlocks.
- `hud.js` — DOM HUD (health/ammo/wave/score/roster).
- `input.js` — keyboard/mouse, pointer lock, weapon switch keys.
- `audio.js` — WebAudio: sample playback + synth fallbacks.
- `main.js` — wires it together; `renderer.setAnimationLoop(tick)`.

Only `constants.js`, `collision.js`, and `maplayout.js` are
Node-importable (no THREE/DOM). The harnesses exploit this: they import
those real modules and re-replicate the physics/AI math around them, so
the tests check the ACTUAL shipped code, not a copy.

## 5. The non-negotiable workflow

Every change-set, in order:

1. Edit `src/` (tuning → `constants.js`; map → `maplayout.js`).
2. `node --check` every modified module.
3. **Run the full battery:** `cd dev && ./test-all.sh`. It must end
   `ALL GREEN`. If anything fails, the change is not done.
4. If you changed map geometry/layout: confirm mapviz reports
   `*** MAP OK ***` (test-all.sh runs it; for renders see §6).
5. If you changed `collision.js`: re-run the WHOLE battery and read it
   carefully. Collision changes have caused the worst regressions.
6. Add a `changelog.md` entry (newest on top — see §7).
7. Only then is the change deliverable.

**Do not commit / hand over code that has not passed `./test-all.sh`.**
A harness that goes red is a real bug, not a flaky test — investigate
it, do not silence it. If a test is genuinely wrong, fix the test
deliberately and say so in the changelog.

When you add a feature with new logic (a weapon, an AI behaviour, a
collision rule), add or extend a harness to cover it. The pattern:
import the real Node-safe module, replicate the math, assert old-vs-new
where it fixes a bug. See `dev/harness_ai.mjs` for the established style.

## 6. Verification tooling (`dev/`)

- `./test-all.sh` — one command: syntax check + 10 harnesses + mapviz.
  Current baseline: **216 assertions, ALL GREEN; MAP OK; geomWarns=0;
  pickup-reach=0; doorway-drift=0.**
- Individual harness: `cd dev && node harness_ai.mjs`.
- `node dev/mapviz.mjs` — writes `dev/map_report.txt` plus SVG plans
  (one per elevation tier), an oblique isometric, and **4 elevation
  cross-sections** (looking N / S / E / W) into `dev/`. All generated;
  `.gitignore` excludes them. Report covers:
   - footprint overlap + vertical clearance
   - connector-seam continuity (real `groundHeightAt` continuity)
   - reachability BFS from spawn
   - route-graph + loop / dead-end analysis
   - **geometry warnings** (`geomWarns` in SUMMARY) — auto-flags wall
     bodies intruding into a deck volume (z-fight at deck top),
     doorways opening into a connector wedge body (stair-trap bug
     class), doorway too narrow for a standing capsule, lintel too low
   - **per-building inventory** — every named structure listed with
     its footprint, height stack, every wall (with door/window status),
     every connector landing on it, every pickup on top. One-glance
     structural readout without grepping LAYOUT
   - **pickup reachability** — each pickup must be on a surface
     reached by the BFS; counts unreachable pickups in SUMMARY
   - **DOORWAYS registry consistency** — verifies the AI router's
     hand-maintained `DOORWAYS` array matches the actual door-bearing
     walls at ground level; counts drift in SUMMARY. Catches the
     "moved a wall but forgot to update DOORWAYS" bug class
   - **sightline matrix** — pairwise LOS between SPAWN + every weapon
     pickup at chest height; quick combat-flow reference

- `node dev/fps-render.mjs` — first-person raytraced renders from
  curated camera poses (spawn cardinals, building approach views, stair
  landings, rooftop pickups, interior of WAREHOUSE). Pure Node — projects
  rays against the same solids the runtime uses. Writes binary PPM files
  in `dev/`. Lets the agent literally see what the player would see at
  each position; the elevation views show profile geometry, the FP views
  show approach + interior framing.

- `bash dev/render-map.sh` — runs mapviz, fps-render, then converts
  every SVG → PNG (cairosvg) and every PPM → PNG (Pillow). Read the
  resulting `map_*.png` (orthographic) and `fps_*.png` (first-person)
  files to comprehend the map visually.

**Visibility workflow for map edits.** After any `maplayout.js` change:

1. `cd dev && bash test-all.sh` — confirm ALL GREEN + MAP OK + every
   summary counter at zero (`geomWarns=0`, `unreachable pickups=0`,
   `doorway drift=0`).
2. `bash dev/render-map.sh` — refresh the renders (~15 s).
3. Read the elevation cross-section facing the edited area first — it
   makes wall-vs-deck and stair-wedge issues visually obvious (each
   solid is a filled rectangle in side profile; overlaps glow).
4. Read the FP view nearest the edit (`fps_outside_<BUILDING>` or
   `fps_roof_<BUILDING>_at_<pickup>`) to verify the player's view of
   the building reads correctly: stair wedges connect cleanly to deck
   edges, windows are at expected sill heights, no z-fight stripes.
5. If you added/changed a doorway in a ground-floor wall, you MUST
   update the `DOORWAYS` export in `maplayout.js` to match. The
   consistency check will flag drift but the AI router depends on this
   list to route enemies through interior doors.
6. If the change touched a deck size or wall thickness, scan the
   per-building inventory section of the report for the affected
   structure.

Harnesses cover: AI (LOS/elevation/nav/scatter/cross-floor fire),
arena seams + clipping + connector-landing pose, weapons (SAW bloom +
knife), doors/windows, raised-floor, duck-jump, kit builders, combat,
crouch, pickups (positions + collect/respawn). Keep them green.

## 7. Changelog discipline

`changelog.md`, newest entry at the TOP of the session log. Each entry:
`### YYYY-MM-DD — Session N (short title)`, then prose explaining the
root cause and the fix, then **Changed** / **Known issues**. Be
specific (function names, the actual bug). The changelog is how the
next session resumes without re-deriving state — treat it as required
output, not an afterthought. Also update the "Lines of code" line.

## 8. Deployment

GitHub Pages, repo root, branch `main`, folder `/ (root)`. Pushing to
`main` redeploys. `dev/` and `build-singlefile.mjs` sitting in the repo
do not affect Pages (it just serves static files; nothing links them).

## 9. Style

- `const` by default, `let` only when reassigned, never `var`.
- Strict equality (`===` / `!==`).
- 2-space indent, semicolons required.
- One scene/camera/renderer/Clock at module top level.
- Reuse temp vectors in hot loops; do not allocate per frame.
- Dispose geometry/material when removing meshes.
- Comment sections with `// --- THING ---` banners.
- Honest engineering: state tradeoffs, do not over-claim, do not churn
  the map/tuning without a reason. Subjective tuning (AI feel, map
  feel, weapon feel) is the user's call — flag it, do not silently
  rebalance.

## 10. Known open items (carried in changelog)

- Cross-floor "fire while advancing" is intentional; throttling it is a
  tunable pending playtest feedback.
- `pickRamp` is single-hop scored; deep multi-tier routes are
  non-optimal but functional. WEST/SOUTH/EAST are deliberate
  single-connector spurs.
- Scatter/vantage/unstick thresholds, SAW bloom, knife buff are
  heuristic tunables.
- M15 Stage 3 (pickups + ground weapons, remove wave-unlocks) not
  started. Multiplayer deferred (open: PvP vs co-op; the no-build /
  static-host constraint is the key tension).
