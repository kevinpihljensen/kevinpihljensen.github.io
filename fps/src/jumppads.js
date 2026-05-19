// jumppads.js — Quake-style launch pads. The player walks onto a glowing
// circle on the ground; a vertical velocity is applied that lobs them up
// to a fixed peak height. Unlike teleporters this is NOT a snap — the
// player's horizontal velocity is preserved (so a sprint-jump onto the
// pad arcs forward), only velocityY is forced to the launch value.
//
// Each pad has a brief cooldown so a player who lands back on the same
// pad doesn't immediately re-launch (creating a stuck-in-the-air loop).
//
// API:
//   registerJumpPad({ id, trigger, launchVy, mesh, texture })
//   applyJumpPad(dt)    — called BEFORE updatePlayer in main.js. Sets
//                          velocityY if the player overlaps a trigger.
//   updateJumpPads(dt)  — animates the pad's glow texture.

import { player, state } from './state.js';
import { GAME_STATE } from './constants.js';

const pads = [];

export function registerJumpPad(p) {
  pads.push({
    ...p,
    cooldown: 0,
    pulsePhase: Math.random() * Math.PI * 2,
  });
}

export function updateJumpPads(dt) {
  for (const p of pads) {
    if (p.cooldown > 0) p.cooldown = Math.max(0, p.cooldown - dt);
    // Pulse the texture alpha + scale slightly so the pad reads as
    // "active". Cheap — no allocation.
    p.pulsePhase += dt * 3.5;
    if (p.mesh && p.mesh.material) {
      const a = 0.65 + 0.30 * Math.sin(p.pulsePhase);
      p.mesh.material.opacity = a;
    }
  }
}

export function applyJumpPad(dt) {
  if (!player.alive) return false;
  if (state.gameState !== GAME_STATE.PLAYING) return false;
  const px = player.position.x, py = player.position.y, pz = player.position.z;
  for (const p of pads) {
    if (p.cooldown > 0) continue;
    const t = p.trigger;
    if (px >= t.x0 && px <= t.x1 &&
        py >= t.y0 && py <= t.y1 &&
        pz >= t.z0 && pz <= t.z1) {
      // Set vertical velocity (preserving horizontal so a running-jump
      // launches into a forward arc). Cap by max because letting it
      // stack across multiple pads creates oddities.
      if (player.velocityY < p.launchVy) player.velocityY = p.launchVy;
      // Force-airborne so the gravity integrator doesn't re-clamp to
      // ground in the same frame.
      player.isGrounded = false;
      p.cooldown = 0.40;
      return true;
    }
  }
  return false;
}
