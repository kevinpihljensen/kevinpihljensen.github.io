// input.js — keyboard, mouse, pointer-lock, fullscreen, and the start-game
// flow (overlay click → audio init → request lock → request fullscreen with
// keyboard lock).
//
// M10 changes:
//   * Number keys 3 and 4 select SMG and sniper.
//   * Right mouse button toggles scope (calls weapons.toggleScope).
//   * mousedown/mouseup track held state for full-auto SMG (sets
//     weapons.wState.mouseHeld).

import { renderer } from './scene.js';
import { state, game, player } from './state.js';
import { GAME_STATE, KEYS_TO_LOCK } from './constants.js';
import { ensureAudio, suspendAudio, resumeAudio } from './audio.js';
import { keys, applyMouseDelta, clearKeys } from './player.js';
import {
  tryFire, tryReload, switchWeapon, toggleScope, wState,
} from './weapons.js';
import { setGameState, dom, syncTitleToggles } from './hud.js';
import { resetGame, startWave, startMapTest } from './wave.js';

// --- KEYBOARD ---
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;

  if (e.code === 'Escape') {
    // The browser will also exit pointer lock on Escape; our pointerlockchange
    // handler will then push us into PAUSED. No-op here.
    return;
  }

  // Title screen: keyboard accelerators mirroring the selector buttons.
  // M toggles Map Test, B toggles Bunny Hop. Enter/Space starts the run.
  if (state.gameState === GAME_STATE.TITLE) {
    if (e.code === 'KeyM') {
      game.mapTestArmed = !game.mapTestArmed;
      syncTitleToggles();
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyB') {
      game.bhopEnabled = !game.bhopEnabled;
      syncTitleToggles();
      e.preventDefault();
      return;
    }
    if (e.code === 'Enter' || e.code === 'Space') {
      beginRun();
      e.preventDefault();
      return;
    }
  }

  if (state.gameState === GAME_STATE.PLAYING || state.gameState === GAME_STATE.BETWEEN_WAVES) {
    if (e.code === 'KeyR') { tryReload(); e.preventDefault(); return; }
    if (e.code === 'Digit1') { switchWeapon('pistol');  e.preventDefault(); return; }
    if (e.code === 'Digit2') { switchWeapon('shotgun'); e.preventDefault(); return; }
    if (e.code === 'Digit3') { switchWeapon('smg');     e.preventDefault(); return; }
    if (e.code === 'Digit4') { switchWeapon('sniper');  e.preventDefault(); return; }
    if (e.code === 'Digit5') { switchWeapon('saw');     e.preventDefault(); return; }
    if (e.code === 'Digit6' || e.code === 'KeyV') { switchWeapon('knife'); e.preventDefault(); return; }
  }

  if (state.gameState === GAME_STATE.GAMEOVER || state.gameState === GAME_STATE.WON) {
    if (e.code === 'KeyR') {
      resetGame();
      startWave(1);
      requestLock();
      e.preventDefault();
    }
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

// --- MOUSE ---
// Movement is only captured while pointer-locked.
window.addEventListener('mousemove', (e) => {
  if (!state.isLocked) return;
  applyMouseDelta(e.movementX || 0, e.movementY || 0);
});

// Left button: fire (one shot for semi-auto, continuous via processAutoFire
// for SMG while held). Right button: scope toggle. Context menu suppressed
// so right-click doesn't pop the browser menu.
window.addEventListener('mousedown', (e) => {
  if (!state.isLocked) return;
  if (e.button === 0) {
    wState.mouseHeld = true;
    tryFire();
  } else if (e.button === 2) {
    toggleScope();
  }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    wState.mouseHeld = false;
  }
});
window.addEventListener('contextmenu', (e) => {
  // Prevent the browser's right-click menu from appearing over the game.
  e.preventDefault();
});

// --- POINTER LOCK ---
function requestLock() {
  try { renderer.domElement.requestPointerLock(); } catch (_) {}
}

document.addEventListener('pointerlockchange', () => {
  state.isLocked = (document.pointerLockElement === renderer.domElement);
  if (state.isLocked) {
    resumeAudio();
    if (state.prePauseState) {
      setGameState(state.prePauseState);
      state.prePauseState = null;
    }
  } else {
    suspendAudio();
    wState.mouseHeld = false;  // releasing lock should stop continuous fire
    clearKeys();
    if (state.gameState === GAME_STATE.PLAYING || state.gameState === GAME_STATE.BETWEEN_WAVES) {
      state.prePauseState = state.gameState;
      setGameState(GAME_STATE.PAUSED);
    }
  }
});

document.addEventListener('pointerlockerror', () => {
  // Lock failed (e.g. user denied or focus lost). Drop back to title gracefully.
  state.isLocked = false;
});

// --- OVERLAY CLICK = RESUME / PLAY-AGAIN (not the title) ---
// On the title screen the structured selector panel + PLAY button handle
// starting, so a background click there does nothing (prevents accidental
// starts while toggling options). Pause / game-over / victory keep
// click-anywhere.
dom.overlay.addEventListener('click', async () => {
  ensureAudio();
  if (state.gameState === GAME_STATE.GAMEOVER || state.gameState === GAME_STATE.WON) {
    resetGame();
    startWave(1);
    await tryFullscreenWithKeyboardLock();
    requestLock();
    return;
  }
  if (state.gameState === GAME_STATE.PAUSED) {
    await tryFullscreenWithKeyboardLock();
    requestLock();
  }
});

// Shared "begin a run from the title with the current toggles".
async function beginRun() {
  ensureAudio();
  if (game.mapTestArmed) startMapTest();
  else startWave(1);
  await tryFullscreenWithKeyboardLock();
  requestLock();
}

if (dom.btnPlay) {
  dom.btnPlay.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.gameState === GAME_STATE.TITLE) beginRun();
  });
}
if (dom.btnBhop) {
  dom.btnBhop.addEventListener('click', (e) => {
    e.stopPropagation();
    game.bhopEnabled = !game.bhopEnabled;
    syncTitleToggles();
  });
}
if (dom.btnMaptest) {
  dom.btnMaptest.addEventListener('click', (e) => {
    e.stopPropagation();
    game.mapTestArmed = !game.mapTestArmed;
    syncTitleToggles();
  });
}

async function tryFullscreenWithKeyboardLock() {
  // Fullscreen is requested so the Keyboard Lock API works in Chrome (it lets
  // us capture keys like Tab without triggering browser shortcuts). Best-effort:
  // any error here is non-fatal, the game still works without fullscreen.
  //
  // IMPORTANT: fullscreen the document root, NOT renderer.domElement. When you
  // fullscreen a specific element, only that element + its descendants render.
  // The HUD, crosshair, and overlay are SIBLINGS of the canvas in <body>, so
  // fullscreening just the canvas hides the entire HUD. Fullscreening
  // documentElement keeps the whole page (canvas + HUD) visible.
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    if (navigator.keyboard && navigator.keyboard.lock) {
      await navigator.keyboard.lock(KEYS_TO_LOCK);
    }
  } catch (_) {}
}
