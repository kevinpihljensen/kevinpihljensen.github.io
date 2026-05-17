# FPS

A browser FPS wave shooter. Three.js (loaded from CDN), vanilla JS ES
modules, no build step, no bundler, no npm.

## How to run

This is a modular site: `index.html` loads the game from `src/*.js` at
runtime. Browsers block ES-module loading over `file://`, so it must be
served over http(s) — **double-clicking `index.html` will not work.**

### GitHub Pages (canonical — what this project is deployed as)

Push the repo, then in **Settings -> Pages -> Build and deployment**, set
**Source -> Deploy from a branch**, branch **main**, folder **/ (root)**,
Save. After ~1 minute the game is live at
`https://YOURNAME.github.io/REPO/`. Pages serves over https, so the
modules load correctly.

### Local server (for development)

```
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Edit files in `src/`, refresh to see
changes. Any static server works (Live Server, `npx serve`, etc.).

## Controls

- **WASD** move, **mouse** look, **click** to lock pointer
- **Shift** sprint, **Ctrl** crouch, **Space** jump (hold for bunnyhop)
- **1** pistol, **2** shotgun, **3** SMG, **4** sniper, **5** M249 SAW,
  **6 / V** knife
- **R** reload, **right-click** scope (sniper only), **Esc** pause

Shotgun/SMG/SAW/sniper unlock on later waves. The knife is always
available (melee, no ammo, small movement-speed buff while equipped).

## Project structure

```
index.html            <- entry point (served over http; do NOT double-click)
src/*.js               <- game source, 18 ES modules
assets/audio/*.wav     <- sound effects (loaded at runtime)
build-singlefile.mjs   <- OPTIONAL: bundles everything into one
                          self-contained file for the file:// /
                          single-file-demo case. NOT used by GitHub Pages
                          and NOT required to run the game.
changelog.md           <- full build/session history
README.md              <- this file
```

Note: a previously-shipped `fps-standalone.html` (a one-file bundle for
the double-click case) has been removed -- GitHub Pages serves the
modular version directly, so it was redundant. `build-singlefile.mjs`
is retained so a single-file build can still be generated on demand if
ever needed; running it is not part of normal use or deployment.
