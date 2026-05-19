// teleporters.js — Quake-style portal system. Trigger-volume + destination
// pair. When the player overlaps the trigger AABB, they snap to the
// destination position (optionally re-facing). Each portal has a short
// cooldown so the destination triggering its own (or another) portal can't
// cause a frame-stutter loop.
//
// Visuals: each registered portal owns a translucent additive-blended
// mesh + a CanvasTexture (from textures.js makePortalTexture). The runtime
// scrolls the texture offset each frame so the swirl appears animated.
//
// API:
//   registerTeleporter({ id, trigger, to, mesh, texture, yaw? })
//   applyTeleport(dt)    — check player overlap, snap on entry. Call BEFORE updatePlayer.
//   updateTeleporters(dt) — animate portal textures + tick cooldowns.

import { player, state } from './state.js';
import { GAME_STATE } from './constants.js';

// Each portal: { id, trigger:{x0,x1,y0,y1,z0,z1}, to:{x,z,y,yaw?}, mesh, texture, cooldown, scrollU, scrollV }
const portals = [];

export function registerTeleporter(p) {
  portals.push({
    ...p,
    cooldown: 0,
    // Slight per-portal scroll-speed variance so multiple portals don't
    // animate in lock-step.
    scrollU: 0.18 + Math.random() * 0.08,
    scrollV: 0.09 + Math.random() * 0.06,
  });
}

// Animate the portal swirl + tick cooldowns. Cheap — no allocations.
export function updateTeleporters(dt) {
  for (const p of portals) {
    if (p.cooldown > 0) p.cooldown = Math.max(0, p.cooldown - dt);
    if (p.texture) {
      p.texture.offset.x = (p.texture.offset.x + dt * p.scrollU) % 1;
      p.texture.offset.y = (p.texture.offset.y + dt * p.scrollV) % 1;
    }
    // Subtle opacity pulse, 3 Hz, range 0.65..0.85, keeps portals from
    // ever fully fading out.
    if (p.mesh && p.mesh.material) {
      const t = performance.now() * 0.001;
      p.mesh.material.opacity = 0.65 + 0.20 * (0.5 + 0.5 * Math.sin(t * 6 + p.scrollU * 12));
    }
  }
}

// Snap the player on portal entry. Returns true if a teleport happened
// this frame (in case callers want to skip subsequent movement steps).
export function applyTeleport(dt) {
  if (!player.alive) return false;
  if (state.gameState !== GAME_STATE.PLAYING) return false;
  const px = player.position.x, py = player.position.y, pz = player.position.z;
  for (const p of portals) {
    if (p.cooldown > 0) continue;
    const t = p.trigger;
    if (px >= t.x0 && px <= t.x1 &&
        py >= t.y0 && py <= t.y1 &&
        pz >= t.z0 && pz <= t.z1) {
      // Snap. Zero velocity so the player isn't launched on arrival
      // (Quake portals neutralize momentum — preserving it leads to
      // accidental fall damage at the destination).
      player.position.set(p.to.x, p.to.y, p.to.z);
      if (p.to.yaw !== undefined) player.yaw = p.to.yaw;
      player.velocityX = 0;
      player.velocityZ = 0;
      player.velocityY = 0;
      // Cooldown prevents an immediate re-trigger if the destination
      // happens to overlap another portal's trigger.
      p.cooldown = 0.30;
      return true;
    }
  }
  return false;
}
