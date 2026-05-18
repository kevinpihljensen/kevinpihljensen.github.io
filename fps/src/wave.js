// wave.js — wave progression, between-wave break, game reset.
//
// M15 Stage 3: weapon unlocks no longer happen here. Every non-pistol weapon
// is acquired by walking over a PICKUP placed on the map (see maplayout.js
// PICKUPS, src/pickups.js). The wave system owns only enemies + score.

import { state, game } from './state.js';
import { GAME_STATE, WAVE_TABLE, MAX_WAVE, BREAK_DURATION } from './constants.js';
import { enemies, makeEnemy, pickSpawnPoint, clearEnemies, resetSpawnMemory } from './enemies.js';
import { projectiles, clearProjectiles } from './projectiles.js';
import { decals, clearDecals, clearBlood } from './decals.js';
import { resetWeapons } from './weapons.js';
import { resetPlayer } from './player.js';
import { resetPickups } from './pickups.js';
import { setGameState, showToast } from './hud.js';
import { sfxWaveStart, sfxWaveClear, sfxVictory } from './audio.js';

export function startWave(n) {
  game.mapTest = false;       // a real wave start always leaves map-test
  game.wave = n;
  game.breakTimer = 0;
  resetSpawnMemory();   // fresh fan-out spacing per wave
  const table = WAVE_TABLE[n];
  const spec = [
    { type: 'grunt',   count: table.grunts   },
    { type: 'shooter', count: table.shooters },
    { type: 'heavy',   count: table.heavies  },
    { type: 'jetpack', count: table.jetpacks || 0 },
  ];
  let total = 0;
  for (let i = 0; i < spec.length; i++) {
    for (let k = 0; k < spec[i].count; k++) {
      const pt = pickSpawnPoint();
      makeEnemy(spec[i].type, pt.x, pt.z);
      total += 1;
    }
  }
  game.enemiesAlive = total;
  setGameState(GAME_STATE.PLAYING);
  sfxWaveStart();
  showToast(`Wave ${n}   •   Bunny Hop: ${game.bhopEnabled ? 'ON' : 'OFF'}`, 1.8);
}

export function onWaveCleared() {
  if (game.wave >= MAX_WAVE) {
    winGame();
    return;
  }
  game.breakTimer = BREAK_DURATION;
  setGameState(GAME_STATE.BETWEEN_WAVES);
  sfxWaveClear();
  showToast(`Wave ${game.wave} cleared!`, 1.8);
}

export function winGame() {
  setGameState(GAME_STATE.WON);
  sfxVictory();
}

export function updateWave(dt) {
  if (state.gameState !== GAME_STATE.BETWEEN_WAVES) return;
  game.breakTimer -= dt;
  if (game.breakTimer <= 0) {
    startWave(game.wave + 1);
  }
}

// Full reset for play-again. Wipes all entities, restores ammo, returns
// player to origin, respawns every map pickup. Called by input.js when R is
// pressed on the gameover / victory screen.
export function resetGame() {
  clearEnemies();
  clearProjectiles();
  clearDecals();
  clearBlood();
  resetWeapons();
  resetPlayer();
  resetPickups();
  game.wave = 0;
  game.score = 0;
  game.enemiesAlive = 0;
  game.breakTimer = 0;
  game.elapsed = 0;
  game.mapTest = false;
}

// MAP TEST: a free-roam run with NO enemies. Identical setup to a fresh run
// (entities cleared, ammo/weapons reset → pistol+knife are the starting kit,
// player returned to origin, pickups respawned) but no wave is spawned. Stays
// in PLAYING with enemiesAlive = 0; updateWave only acts BETWEEN_WAVES and
// onWaveCleared only fires on a kill, so with no enemies this is stable.
export function startMapTest() {
  clearEnemies();
  clearProjectiles();
  clearDecals();
  clearBlood();
  resetWeapons();        // pistol is unlocked + selected by default
  resetPlayer();
  resetPickups();
  game.wave = 0;
  game.score = 0;
  game.enemiesAlive = 0;
  game.breakTimer = 0;
  game.elapsed = 0;
  game.mapTest = true;
  setGameState(GAME_STATE.PLAYING);
  showToast(`MAP TEST — no enemies   •   Bunny Hop: ${game.bhopEnabled ? 'ON' : 'OFF'}`, 2.6);
}
