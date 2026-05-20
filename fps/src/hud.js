// hud.js — DOM bindings and visual UI updates.
//
// M11: HUD substantially expanded.
//   * Ammo widget shows mag (large) + reserve (small) + mag pips below.
//   * Weapon roster (top-right) shows all four slots; current is highlighted,
//     locked weapons are dimmed.
//   * Health bar has a label, framed bar, value overlaid on the fill.
//   * Wave row gains an enemies-remaining counter.
//   * Center-bottom speed indicator for bhop feedback (only shows when moving).

import { state, game, player, damageIndicator } from './state.js';
import { WEAPON_DEFS, weaponState, wState } from './weapons.js';
import {
  GAME_STATE, MAX_WAVE, HIT_MARKER_TIME, HEADSHOT_MARKER_TIME,
  DAMAGE_INDICATOR_TIME, DAMAGE_FLASH_TIME, WALK_SPEED, SPRINT_SPEED,
  HEALTH_COLOR_HIGH, HEALTH_COLOR_MID, HEALTH_COLOR_LOW,
} from './constants.js';

// --- DOM REFS ---
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);
export const dom = {
  overlay:           $('overlay'),
  overlayTitle:      $('overlay-title'),
  overlaySubtitle:   $('overlay-subtitle'),
  overlayInstructions: $('overlay-instructions'),
  titlePanel:        $('title-panel'),
  btnPlay:           $('btn-play'),
  btnBhop:           $('btn-bhop'),
  btnModeWave:       $('btn-mode-wave'),
  btnModeArena:      $('btn-mode-arena'),
  btnModeMaptest:    $('btn-mode-maptest'),
  hud:               $('hud'),
  hudAmmo:           $('hud-ammo'),
  hudGrenade:        $('hud-grenade-count'),
  hudWeapon:         $('hud-weapon'),
  hudMagPips:        $('hud-mag-pips'),
  hudHealthFill:     $('hud-health-fill'),
  hudHealthText:     $('hud-health-text'),
  hudWave:           $('hud-wave'),
  hudScore:          $('hud-score'),
  hudEnemiesLeft:    $('hud-enemies-left'),
  hudBreak:          $('hud-break'),
  hudSpeed:          $('hud-speed'),
  hudBhop:           $('hud-bhop'),
  hudWeapons:        $('hud-weapons'),
  crosshair:         $('crosshair'),
  hitMarker:         $('hit-marker'),
  hitMarkerX:        $('hit-marker-x'),
  hitMarkerPlus:     $('hit-marker-plus'),
  damageFlash:       $('damage-flash'),
  damageIndicator:   $('damage-indicator'),
  toast:             $('toast'),
  scopeOverlay:      $('scope-overlay'),
};

// Pre-grab weapon slot elements so we don't re-query each frame.
const weaponSlots = {};
$$('.slot[data-weapon]').forEach((el) => {
  weaponSlots[el.dataset.weapon] = el;
});

// --- TOASTS ---
let toastTimer = 0;
export function showToast(text, dur) {
  dom.toast.textContent = text;
  dom.toast.style.opacity = '1';
  toastTimer = dur || 1.5;
}
export function updateToast(dt) {
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) {
      toastTimer = 0;
      dom.toast.style.opacity = '0';
    }
  }
}

// Reflect the current game toggles on the title selector buttons. Exported
// so input.js can call it after a button/key flips a toggle.
export function syncTitleToggles() {
  const setT = (el, on) => {
    if (!el) return;
    el.classList.toggle('is-on', on);
    el.classList.toggle('is-off', !on);
    const s = el.querySelector('.tp-state');
    if (s) s.textContent = on ? 'ON' : 'OFF';
  };
  setT(dom.btnBhop, game.bhopEnabled);
  // Mode selector — exactly one button is amber-highlighted.
  const setMode = (el, on) => { if (el) el.classList.toggle('is-selected', on); };
  setMode(dom.btnModeWave,    game.modeArmed === 'wave');
  setMode(dom.btnModeArena,   game.modeArmed === 'arena');
  setMode(dom.btnModeMaptest, game.modeArmed === 'maptest');
}

// --- OVERLAY / GAME STATE ROUTING ---
export function setGameState(next) {
  state.gameState = next;
  if (next === GAME_STATE.TITLE) {
    dom.overlay.classList.add('is-title');
    syncTitleToggles();
    showOverlay('FPS', 'Choose your options, then play',
      'WASD move • Mouse look • Shift sprint • Ctrl crouch • Space jump\n' +
      'Duck-jump: jump, then hold Ctrl before reaching a ledge to mount higher\n' +
      '1/2/3/4 weapons • R reload • Right-click scope (sniper) • Esc pause');
  } else if (next === GAME_STATE.PAUSED) {
    dom.overlay.classList.remove('is-title');
    showOverlay('Paused', 'Click to resume', 'Esc to pause again');
  } else if (next === GAME_STATE.GAMEOVER) {
    dom.overlay.classList.remove('is-title');
    const subtitle = game.gameMode === 'arena'
      ? `Arena • Kills ${game.arenaKills}`
      : `Wave ${game.wave} • Score ${game.score}`;
    showOverlay('Game Over', subtitle, 'Press R or click to play again');
  } else if (next === GAME_STATE.WON) {
    dom.overlay.classList.remove('is-title');
    showOverlay('Victory', `Score ${game.score}`, 'Press R or click to play again');
  } else {
    dom.overlay.classList.remove('is-title');
    hideOverlay();
  }
}
function showOverlay(title, subtitle, instructions) {
  dom.overlay.style.display = 'flex';
  dom.overlayTitle.textContent = title;
  dom.overlaySubtitle.textContent = subtitle;
  dom.overlayInstructions.textContent = instructions;
  dom.hud.style.display = 'none';
  dom.crosshair.style.display = 'none';
  dom.scopeOverlay.style.opacity = '0';
}
function hideOverlay() {
  dom.overlay.style.display = 'none';
  dom.hud.style.display = 'block';
  dom.crosshair.style.display = player.isScoped ? 'none' : 'block';
}

// --- HEALTH BAR HELPERS ---
// Gradient shifts green → amber → red as HP drops.
function healthGradient(frac) {
  if (frac > 0.6) {
    return 'linear-gradient(180deg, #6bf08e 0%, #4ade80 50%, #2db862 100%)';
  } else if (frac > 0.3) {
    return 'linear-gradient(180deg, #fde68a 0%, #fbbf24 50%, #d97706 100%)';
  } else {
    return 'linear-gradient(180deg, #fca5a5 0%, #ef4444 50%, #b91c1c 100%)';
  }
}
function healthGlow(frac) {
  if (frac > 0.6) return '0 0 12px rgba(74, 222, 128, 0.4)';
  if (frac > 0.3) return '0 0 12px rgba(251, 191, 36, 0.45)';
  return '0 0 14px rgba(239, 68, 68, 0.55)';
}

// --- MAG PIPS ---
// Re-build only when count changes, so per-frame DOM touch is minimal.
let lastMagSize = -1;
let lastMag = -1;
let lastWeaponKey = '';
function updateMagPips(w, s) {
  if (w === lastWeaponKey && lastMagSize === WEAPON_DEFS[w].magSize && lastMag === s.mag) return;
  lastWeaponKey = w;
  lastMagSize = WEAPON_DEFS[w].magSize;
  lastMag = s.mag;
  // Skip pips for high-capacity mags (SMG = 30) — pips become tiny noise.
  if (lastMagSize > 16) {
    dom.hudMagPips.innerHTML = '';
    return;
  }
  let html = '';
  for (let i = 0; i < lastMagSize; i++) {
    html += `<div class="pip${i < s.mag ? '' : ' empty'}"></div>`;
  }
  dom.hudMagPips.innerHTML = html;
}

// --- WEAPON ROSTER ---
let lastRosterKey = '';
function updateWeaponRoster() {
  const key = [
    wState.currentWeapon,
    WEAPON_DEFS.shotgun.unlocked ? 'S' : 's',
    WEAPON_DEFS.smg.unlocked     ? 'M' : 'm',
    WEAPON_DEFS.saw.unlocked     ? 'W' : 'w',
    WEAPON_DEFS.sniper.unlocked  ? 'N' : 'n',
  ].join('|');
  if (key === lastRosterKey) return;
  lastRosterKey = key;
  for (const name in weaponSlots) {
    const el = weaponSlots[name];
    const unlocked = WEAPON_DEFS[name].unlocked;
    const active = wState.currentWeapon === name;
    el.classList.toggle('locked', !unlocked);
    el.classList.toggle('active', active);
  }
}

// --- HUD ---
export function updateHUD(dt) {
  if (state.gameState !== GAME_STATE.PLAYING && state.gameState !== GAME_STATE.BETWEEN_WAVES) {
    return;
  }

  // Ammo: mag (big) + reserve (small). When reloading, the whole line becomes "Reloading…".
  const w = WEAPON_DEFS[wState.currentWeapon];
  const s = weaponState[wState.currentWeapon];
  if (w.melee) {
    dom.hudAmmo.innerHTML = `<span class="reload-text">MELEE</span>`;
  } else if (wState.reloadTimer > 0) {
    dom.hudAmmo.innerHTML = `<span class="reload-text">Reloading…</span>`;
  } else {
    dom.hudAmmo.innerHTML = `<span class="mag">${s.mag}</span><span class="reserve"> / ${s.reserve}</span>`;
  }
  dom.hudWeapon.textContent = w.name;
  updateMagPips(wState.currentWeapon, s);
  updateWeaponRoster();
  // S55ae: grenade count. Dimmed colour when zero so the [G] hint still
  // shows the binding but doesn't shout when there's nothing to throw.
  dom.hudGrenade.textContent = String(player.grenades);
  dom.hudGrenade.style.opacity = player.grenades > 0 ? '1' : '0.35';

  // Health
  const hp = Math.max(0, Math.min(player.maxHealth, player.health));
  const frac = hp / player.maxHealth;
  dom.hudHealthFill.style.width = (frac * 100).toFixed(0) + '%';
  dom.hudHealthFill.style.background = healthGradient(frac);
  dom.hudHealthFill.style.boxShadow = healthGlow(frac);
  dom.hudHealthText.textContent = `${Math.ceil(hp)} / ${player.maxHealth}`;

  // Wave / score / enemies-left / between-waves countdown. In arena mode the
  // wave display shows ARENA + kill count (game.arenaKills) instead.
  if (game.gameMode === 'arena') {
    dom.hudWave.innerHTML = `<span class="current">ARENA</span>`;
    dom.hudScore.innerHTML = `<span class="label">KILLS</span><span class="value">${game.arenaKills}</span>`;
  } else if (game.gameMode === 'maptest') {
    dom.hudWave.innerHTML = `<span class="current">MAP TEST</span>`;
    dom.hudScore.innerHTML = `<span class="label">SCORE</span><span class="value">${game.score}</span>`;
  } else {
    dom.hudWave.innerHTML =
      `Wave <span class="current">${game.wave}</span><span class="sep">/</span><span class="total">${MAX_WAVE}</span>`;
    dom.hudScore.innerHTML = `<span class="label">SCORE</span><span class="value">${game.score}</span>`;
  }
  if (state.gameState === GAME_STATE.PLAYING && game.enemiesAlive > 0 && game.gameMode !== 'arena') {
    dom.hudEnemiesLeft.textContent = `${game.enemiesAlive} left`;
  } else {
    dom.hudEnemiesLeft.textContent = '';
  }
  if (state.gameState === GAME_STATE.BETWEEN_WAVES && game.breakTimer > 0) {
    dom.hudBreak.style.display = 'block';
    dom.hudBreak.textContent = `Next wave in ${game.breakTimer.toFixed(1)}s`;
  } else {
    dom.hudBreak.style.display = 'none';
  }

  // Crosshair vs scope.
  dom.crosshair.style.display = player.isScoped ? 'none' : 'block';
  dom.scopeOverlay.style.opacity = player.isScoped ? '1' : '0';

  // Hit marker (red X) / headshot marker (gold +). Headshot takes precedence.
  if (wState.headshotMarkerTimer > 0) {
    dom.hitMarker.style.display = 'block';
    dom.hitMarkerX.style.display = 'none';
    dom.hitMarkerPlus.style.display = 'block';
    dom.hitMarkerPlus.style.opacity = (wState.headshotMarkerTimer / HEADSHOT_MARKER_TIME).toFixed(3);
  } else if (wState.hitMarkerTimer > 0) {
    dom.hitMarker.style.display = 'block';
    dom.hitMarkerX.style.display = 'block';
    dom.hitMarkerPlus.style.display = 'none';
    dom.hitMarkerX.style.opacity = (wState.hitMarkerTimer / HIT_MARKER_TIME).toFixed(3);
  } else {
    dom.hitMarker.style.display = 'none';
  }

  // Damage flash
  if (player.damageFlashTimer > 0) {
    const a = (player.damageFlashTimer / DAMAGE_FLASH_TIME) * 0.5;
    dom.damageFlash.style.opacity = a.toFixed(3);
  } else {
    dom.damageFlash.style.opacity = '0';
  }

  // Damage direction indicator.
  if (damageIndicator.timer > 0) {
    const op = (damageIndicator.timer / DAMAGE_INDICATOR_TIME);
    dom.damageIndicator.style.opacity = op.toFixed(3);
    const deg = damageIndicator.angle * 180 / Math.PI;
    dom.damageIndicator.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
  } else {
    dom.damageIndicator.style.opacity = '0';
  }

  // Speed readout. Color escalates as you exceed sprint speed (bhop gains).
  const speed = Math.hypot(player.velocityX, player.velocityZ);
  if (speed < 0.5) {
    dom.hudSpeed.style.opacity = '0';
  } else {
    dom.hudSpeed.style.opacity = '1';
    dom.hudSpeed.textContent = `${speed.toFixed(1)} m/s`;
    dom.hudSpeed.className = '';
    if      (speed > SPRINT_SPEED * 1.8) dom.hudSpeed.className = 'fastest';
    else if (speed > SPRINT_SPEED * 1.3) dom.hudSpeed.className = 'faster';
    else if (speed > SPRINT_SPEED * 1.0) dom.hudSpeed.className = 'fast';
  }

  // Persistent confirmation of the movement mode: the badge is shown only
  // when bunny-hop is OFF (the non-default test mode), so the player can
  // always verify which mode is active.
  if (dom.hudBhop) {
    dom.hudBhop.style.display = game.bhopEnabled ? 'none' : 'block';
  }
}
