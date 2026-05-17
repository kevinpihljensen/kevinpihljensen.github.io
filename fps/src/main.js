// main.js — entry point. Imports register all side effects (scene, arena,
// input listeners), then we set the initial state and start the render loop.

import { renderer, scene, camera, clock } from './scene.js';
import { state, game } from './state.js';
import { GAME_STATE, MAX_DT, LAYER_WORLD, LAYER_VIEWMODEL } from './constants.js';
import './arena.js';     // builds floor / walls / cover at import time
import './input.js';     // attaches keyboard / mouse listeners at import time
import { updatePlayer } from './player.js';
import { updateEnemies } from './enemies.js';
import { updateProjectiles } from './projectiles.js';
import { updateWeaponTimers, processAutoFire } from './weapons.js';
import { updateDecals } from './decals.js';
import { updateWave } from './wave.js';
import { setGameState, updateHUD, updateToast } from './hud.js';

// Initial UI state: title overlay shown, no HUD, no canvas focus.
setGameState(GAME_STATE.TITLE);

function loop() {
  // dt is clamped so a long tab-suspend doesn't snap the player through walls.
  let dt = clock.getDelta();
  if (dt > MAX_DT) dt = MAX_DT;

  const active = (state.gameState === GAME_STATE.PLAYING ||
                  state.gameState === GAME_STATE.BETWEEN_WAVES);

  if (active) {
    game.elapsed += dt;
    // Order matters: process full-auto BEFORE weapon timers so the cooldown
    // tick in the same frame doesn't undercut the next fire.
    processAutoFire();
    updateEnemies(dt);
    updateProjectiles(dt);
    updatePlayer(dt);
    updateWeaponTimers(dt);
    updateWave(dt);
    updateDecals(dt);
    updateHUD(dt);
    updateToast(dt);
  }

  // Two-pass render so the first-person weapon never clips into nearby
  // geometry: render the WORLD (LAYER_WORLD), clear only the depth buffer,
  // then render the VIEW MODEL (LAYER_VIEWMODEL) on top — it draws over the
  // wall instead of poking through it.
  //
  // CRITICAL: scene.background (the sky CanvasTexture) is drawn as a
  // full-screen pass on EVERY renderer.render() call, independent of
  // autoClear. Left enabled, the second pass would repaint the whole sky over
  // the world from pass 1 (you'd see only the gun against the sky). So the
  // background is nulled for the view-model pass and restored after; the
  // world pass keeps it. autoClear is also disabled for pass 2 so it keeps
  // pass 1's color buffer. Hitscan uses the camera position/direction (not
  // camera.layers), so accuracy is unaffected.
  camera.layers.set(LAYER_WORLD);
  renderer.render(scene, camera);

  const prevAutoClear = renderer.autoClear;
  const prevBackground = scene.background;
  renderer.autoClear = false;
  scene.background = null;
  renderer.clearDepth();
  camera.layers.set(LAYER_VIEWMODEL);
  renderer.render(scene, camera);
  scene.background = prevBackground;
  renderer.autoClear = prevAutoClear;

  // Leave the camera's layer mask unrestricted between frames (defensive;
  // next frame's pass 1 sets it explicitly anyway).
  camera.layers.enableAll();
}

renderer.setAnimationLoop(loop);
