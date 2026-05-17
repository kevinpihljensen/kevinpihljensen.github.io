// wave.js — wave progression, weapon unlocks, between-wave break, game reset.
//
// M10: unlock progression extended for the new weapons.
//   Wave 3 → shotgun (existing)
//   Wave 5 → SMG (new)
//   Wave 7 → sniper rifle (new)
// Each unlock plays sfxWeaponUnlock and shows a toast.

import { state, game } from './state.js';
import {
  GAME_STATE, WAVE_TABLE, MAX_WAVE, BREAK_DURATION,
  SHOTGUN_UNLOCK_WAVE, SMG_UNLOCK_WAVE, SAW_UNLOCK_WAVE, SNIPER_UNLOCK_WAVE,
} from './constants.js';
import { enemies, makeEnemy, pickSpawnPoint, clearEnemies, resetSpawnMemory } from './enemies.js';
import { projectiles, clearProjectiles } from './projectiles.js';
import { decals, clearDecals } from './decals.js';
import { WEAPON_DEFS, resetWeapons } from './weapons.js';
import { resetPlayer } from './player.js';
import { setGameState, showToast } from './hud.js';
import {
  sfxWaveStart, sfxWaveClear, sfxVictory, sfxWeaponUnlock,
} from './audio.js';

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

  // Weapon unlocks happen at the start of the unlock wave. They stack with
  // the "Wave N" toast: unlock toast plays a beat later so the player notices.
  if (n === SHOTGUN_UNLOCK_WAVE && !WEAPON_DEFS.shotgun.unlocked) {
    WEAPON_DEFS.shotgun.unlocked = true;
    setTimeout(() => { sfxWeaponUnlock(); showToast('Shotgun unlocked! [2]', 2.2); }, 1100);
  }
  if (n === SMG_UNLOCK_WAVE && !WEAPON_DEFS.smg.unlocked) {
    WEAPON_DEFS.smg.unlocked = true;
    setTimeout(() => { sfxWeaponUnlock(); showToast('SMG unlocked! [3]', 2.2); }, 1100);
  }
  if (n === SAW_UNLOCK_WAVE && !WEAPON_DEFS.saw.unlocked) {
    WEAPON_DEFS.saw.unlocked = true;
    setTimeout(() => {
      sfxWeaponUnlock();
      showToast('M249 SAW unlocked! [5]  (sustained fire widens the spread)', 2.6);
    }, 1100);
  }
  if (n === SNIPER_UNLOCK_WAVE && !WEAPON_DEFS.sniper.unlocked) {
    WEAPON_DEFS.sniper.unlocked = true;
    setTimeout(() => {
      sfxWeaponUnlock();
      showToast('Sniper Rifle unlocked! [4]  (Right-click to scope)', 2.6);
    }, 1100);
  }
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
// player to origin. Called by input.js when R is pressed on the gameover /
// victory screen.
export function resetGame() {
  clearEnemies();
  clearProjectiles();
  clearDecals();
  resetWeapons();
  resetPlayer();
  game.wave = 0;
  game.score = 0;
  game.enemiesAlive = 0;
  game.breakTimer = 0;
  game.elapsed = 0;
  game.mapTest = false;
}

// MAP TEST: a free-roam run with NO enemies. Identical setup to a fresh run
// (entities cleared, ammo/weapons reset → pistol is the default starting
// weapon, player returned to origin) but no wave is spawned. Stays in
// PLAYING with enemiesAlive = 0; updateWave only acts BETWEEN_WAVES and
// onWaveCleared only fires on a kill, so with no enemies this is stable.
export function startMapTest() {
  clearEnemies();
  clearProjectiles();
  clearDecals();
  resetWeapons();        // pistol is unlocked + selected by default
  resetPlayer();
  game.wave = 0;
  game.score = 0;
  game.enemiesAlive = 0;
  game.breakTimer = 0;
  game.elapsed = 0;
  game.mapTest = true;
  setGameState(GAME_STATE.PLAYING);
  showToast(`MAP TEST — no enemies   •   Bunny Hop: ${game.bhopEnabled ? 'ON' : 'OFF'}`, 2.6);
}
