// wave.js — wave progression, between-wave break, game reset.
//
// M15 Stage 3: weapon unlocks no longer happen here. Every non-pistol weapon
// is acquired by walking over a PICKUP placed on the map (see maplayout.js
// PICKUPS, src/pickups.js). The wave system owns only enemies + score.

import { state, game } from './state.js';
import {
  GAME_STATE, WAVE_TABLE, MAX_WAVE, BREAK_DURATION,
  ARENA_ENEMY_POPULATION, ARENA_ENEMY_MIX, ARENA_ENEMY_RESPAWN_DELAY,
} from './constants.js';
import { enemies, makeEnemy, pickSpawnPoint, pickArenaSpawnPoint, clearEnemies, resetSpawnMemory } from './enemies.js';
import { spawnSpawnFX } from './spawnfx.js';
import { projectiles, clearProjectiles } from './projectiles.js';
import { decals, clearDecals, clearBlood } from './decals.js';
import { resetWeapons } from './weapons.js';
import { resetPlayer } from './player.js';
import { resetPickups } from './pickups.js';
import { setGameState, showToast } from './hud.js';
import { sfxWaveStart, sfxWaveClear, sfxVictory } from './audio.js';

export function startWave(n) {
  game.gameMode = 'wave';       // a real wave start always leaves map-test
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
  game.gameMode = 'wave';
}

// MAP TEST: free-roam mode for inspecting the map AND the enemy models.
// S55ac: spawns one of each enemy type lined up along z just north of the
// spawn pad, all marked `passive` so they don't move or attack — the user
// can walk around them, knife them for fun, and inspect the rigs. Killing
// them doesn't trigger wave-clear (updateWave only acts BETWEEN_WAVES, and
// onWaveCleared only fires on kill if enemiesAlive hits 0 — passive kills
// still decrement it but the game stays PLAYING). Identical setup to a
// fresh run otherwise (entities cleared, ammo/weapons reset, pickups
// respawned, player returned to origin).
const MAPTEST_LINEUP = [
  // Lined up along the X axis a few metres north of SPAWN (which is at z=6).
  // All face -Z (toward the player, since spawn looks toward -Z by default).
  { type: 'grunt',   x: -4.5, z: -1 },
  { type: 'shooter', x: -1.5, z: -1 },
  { type: 'heavy',   x:  1.5, z: -1 },
  { type: 'jetpack', x:  4.5, z: -1 },
];

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
  game.gameMode = 'maptest';
  // Spawn the inspection lineup: passive enemies, one of each type.
  for (let i = 0; i < MAPTEST_LINEUP.length; i++) {
    const spec = MAPTEST_LINEUP[i];
    const e = makeEnemy(spec.type, spec.x, spec.z);
    e.passive = true;
    // Face the player (whose spawn is at z=+6 looking toward -Z); facing +Z
    // means each model's chest points at the player.
    if (e.group) e.group.rotation.y = 0;
  }
  game.enemiesAlive = 0;   // passive lineup doesn't count as a wave target
  setGameState(GAME_STATE.PLAYING);
  showToast(`MAP TEST — inspection lineup   •   Bunny Hop: ${game.bhopEnabled ? 'ON' : 'OFF'}`, 2.6);
}

// ARENA: continuous-combat alternative to wave mode. Maintains a fixed
// population of live enemies; replacements spawn after a short delay at
// SPAWN_ANCHORS points far from the player. On player death the player
// respawns at the anchor farthest from any live enemy (player.js handles
// that path; this function just initializes the run).
export function startArena() {
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
  game.gameMode = 'arena';
  game.arenaKills = 0;
  game.arenaRespawnTimer = 0;
  game.arenaEnemyRespawnTimers = [];
  resetSpawnMemory();
  // Seed the initial population using ARENA_ENEMY_MIX as the round-robin
  // weighting. S55j: spawn from the SCATTERED ENEMY_SPAWN_POINTS pool
  // (pickArenaSpawnPoint) instead of the wave-mode ring-around-player
  // pickSpawnPoint, so the round opens with enemies popping up from every
  // direction on the map rather than all from one zone.
  const types = [];
  for (const t in ARENA_ENEMY_MIX) {
    for (let k = 0; k < ARENA_ENEMY_MIX[t]; k++) types.push(t);
  }
  for (let i = 0; i < ARENA_ENEMY_POPULATION; i++) {
    const type = types[i % types.length];
    const pt = pickArenaSpawnPoint();
    makeEnemy(type, pt.x, pt.z);
    spawnSpawnFX(pt.x, 0, pt.z);
    game.enemiesAlive += 1;
  }
  setGameState(GAME_STATE.PLAYING);
  sfxWaveStart();
  showToast(`ARENA   •   Bunny Hop: ${game.bhopEnabled ? 'ON' : 'OFF'}`, 1.8);
}

// Called from enemies.js when an enemy dies in arena mode. Queues a delayed
// respawn so the population recovers.
export function queueArenaRespawn(type) {
  if (game.gameMode !== 'arena') return;
  game.arenaEnemyRespawnTimers.push({ type, t: ARENA_ENEMY_RESPAWN_DELAY });
}

// Tick the arena pending-respawn queue. Called from main.js each frame
// while the game state is PLAYING.
export function updateArena(dt) {
  if (game.gameMode !== 'arena' || state.gameState !== GAME_STATE.PLAYING) return;
  const q = game.arenaEnemyRespawnTimers;
  for (let i = q.length - 1; i >= 0; i--) {
    q[i].t -= dt;
    if (q[i].t <= 0) {
      const type = q[i].type;
      q.splice(i, 1);
      // S55j: arena respawns use the map-spread point list, so over a
      // long round the player sees enemies arrive from every direction
      // instead of being funneled in from one zone.
      const pt = pickArenaSpawnPoint();
      makeEnemy(type, pt.x, pt.z);
      spawnSpawnFX(pt.x, 0, pt.z);
      game.enemiesAlive += 1;
    }
  }
}
