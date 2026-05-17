// weapons.js — weapon definitions, view models, firing, reloading, switching.
//
// M10 additions:
//   * Two new weapons: SMG (full-auto, high RPM) and Sniper Rifle (single-shot,
//     high damage, scope-able). Total 4 weapons.
//   * Headshot detection: ray hits whose object has userData.isHead === true
//     deal HEADSHOT_MULTIPLIER × damage and trigger a distinct gold "+" hit
//     marker + sfxHeadshot cue.
//   * Full-auto handling: while the sniper/pistol/shotgun fire one-per-click,
//     the SMG fires continuously while mouse is held (gated by fireCooldown).
//     The held state lives in player.js (mouseHeld); weapons.processAutoFire()
//     is called from the game loop.
//   * Scope: right-click toggles `player.isScoped`. Only meaningful with the
//     sniper equipped. Side effects (FOV, sensitivity, walk speed, overlay)
//     are handled in player.js + hud.js + input.js — weapons.js just owns
//     the toggle function and clears the scope on weapon swap.

import * as THREE from 'three';
import { scene, camera } from './scene.js';
import { shootables } from './collision.js';
import {
  RAYCAST_RANGE, MUZZLE_FLASH_TIME, RECOIL_DECAY,
  RECOIL_PISTOL, RECOIL_SHOTGUN, RECOIL_SMG, RECOIL_SNIPER, RECOIL_SAW,
  HIT_MARKER_TIME, HEADSHOT_MARKER_TIME, HEADSHOT_MULTIPLIER,
  KNIFE_RANGE, KNIFE_DAMAGE, KNIFE_COOLDOWN,
  DEFAULT_FOV,
} from './constants.js';
import { state, player } from './state.js';
import { GAME_STATE, LAYER_VIEWMODEL } from './constants.js';
import {
  sfxPistol, sfxShotgun, sfxSmg, sfxSniper, sfxSaw, sfxKnife,
  sfxEmptyClick, sfxReloadStart, sfxEnemyHit, sfxHeadshot,
  sfxScopeOn, sfxScopeOff, sfxWeaponDeploy, stopAllReloadAudio,
} from './audio.js';
import { damageEnemy } from './enemies.js';
import { createImpact } from './decals.js';

// --- WEAPON DEFS ---
// Each weapon: { name, damage, rpm, magSize, reserveStart, reloadTime,
//                spread, pellets, recoil, unlocked, autoFire, canScope, sfxFire }
// rpm → fireCooldown = 60/rpm seconds. spread in radians. pellets > 1 ⇒ shotgun-style.
// autoFire = true ⇒ fires while mouse held; false ⇒ once per click.
// canScope = true ⇒ right-click toggles scope.
export const WEAPON_DEFS = {
  pistol: {
    name: 'Pistol', damage: 20, rpm: 300, magSize: 12, reserveStart: 96,
    reloadTime: 1.2, spread: 0.005, pellets: 1, recoil: RECOIL_PISTOL,
    headshotMult: 1.25,
    unlocked: true,  autoFire: false, canScope: false, sfxFire: sfxPistol,
  },
  shotgun: {
    name: 'Shotgun', damage: 8, rpm: 60, magSize: 6, reserveStart: 48,
    reloadTime: 1.8, spread: 0.06, pellets: 8, recoil: RECOIL_SHOTGUN,
    headshotMult: 2.0,
    unlocked: false, autoFire: false, canScope: false, sfxFire: sfxShotgun,
  },
  smg: {
    name: 'SMG', damage: 12, rpm: 600, magSize: 30, reserveStart: 120,
    reloadTime: 1.5, spread: 0.025, pellets: 1, recoil: RECOIL_SMG,
    headshotMult: 1.5,
    unlocked: false, autoFire: true,  canScope: false, sfxFire: sfxSmg,
  },
  sniper: {
    name: 'Sniper', damage: 120, rpm: 50, magSize: 5, reserveStart: 25,
    reloadTime: 2.5, spread: 0,    pellets: 1, recoil: RECOIL_SNIPER,
    headshotMult: 2.5,
    unlocked: false, autoFire: false, canScope: true,  sfxFire: sfxSniper,
  },
  saw: {
    // High capacity, medium damage, full-auto. Accuracy DEGRADES the longer
    // you hold the trigger: each shot adds `bloom.addPerShot` to the spread
    // up to `bloom.maxExtra`; it recovers at `bloom.recoverPerSec` when you
    // ease off. Start tight, end hosing.
    name: 'M249 SAW', damage: 16, rpm: 750, magSize: 100, reserveStart: 200,
    reloadTime: 4.0, spread: 0.012, pellets: 1, recoil: RECOIL_SAW,
    headshotMult: 1.4,
    unlocked: false, autoFire: true, canScope: false, sfxFire: sfxSaw,
    bloom: { addPerShot: 0.0090, recoverPerSec: 0.060, maxExtra: 0.075 },
  },
  knife: {
    // Always-available melee fallback. No ammo. Short reach, fast swipe.
    name: 'Knife', damage: KNIFE_DAMAGE, rpm: 60 / KNIFE_COOLDOWN,
    magSize: 0, reserveStart: 0, reloadTime: 0, spread: 0, pellets: 1,
    recoil: 0, headshotMult: 1.0, melee: true, range: KNIFE_RANGE,
    unlocked: true, autoFire: false, canScope: false, sfxFire: sfxKnife,
  },
};

// Mutable per-weapon ammo state.
export const weaponState = {
  pistol:  { mag: WEAPON_DEFS.pistol.magSize,  reserve: WEAPON_DEFS.pistol.reserveStart  },
  shotgun: { mag: WEAPON_DEFS.shotgun.magSize, reserve: WEAPON_DEFS.shotgun.reserveStart },
  smg:     { mag: WEAPON_DEFS.smg.magSize,     reserve: WEAPON_DEFS.smg.reserveStart     },
  sniper:  { mag: WEAPON_DEFS.sniper.magSize,  reserve: WEAPON_DEFS.sniper.reserveStart  },
  saw:     { mag: WEAPON_DEFS.saw.magSize,     reserve: WEAPON_DEFS.saw.reserveStart     },
  knife:   { mag: 0, reserve: 0 },   // unused (melee has no ammo)
};

// Per-frame transient state — exported so HUD can read and input can mutate
// where appropriate.
export const wState = {
  currentWeapon: 'pistol',
  fireCooldown: 0,
  reloadTimer: 0,
  recoilPitch: 0,
  muzzleFlashTimer: 0,
  activeMuzzleFlash: null,
  hitMarkerTimer: 0,
  // M10: separate timer for headshot marker (longer, distinct color in HUD)
  headshotMarkerTimer: 0,
  // M10: mouse held for full-auto fire. Set by input.js mousedown/up.
  mouseHeld: false,
  // SAW progressive inaccuracy: extra spread (radians) accumulated by
  // sustained fire, recovered when not firing. 0 for all other weapons.
  bloom: 0,
  // Knife swipe animation timer (drives the view-model lunge).
  meleeAnim: 0,
};

// --- WEAPON MATERIAL PALETTE ---
// Used by every build*Model() function. Each entry is a factory returning a
// FRESH MeshStandardMaterial — sharing instances is unsafe because the
// view-model emissive-lift loop (further down) mutates materials in place;
// pickups built later need pristine copies. Cheap to call (≤6 materials per
// weapon × small N of allocations at startup + per pickup spawn).
function wmat(spec) { return new THREE.MeshStandardMaterial(spec); }
const WMAT = {
  // Blued / parkerised steel: dark gunmetal you see on slides, receivers, barrels
  bluedSteel:    () => wmat({ color: 0x141618, roughness: 0.32, metalness: 0.85 }),
  // Slightly lighter dark steel — used for frame parts that need a tonal step
  darkSteel:     () => wmat({ color: 0x1f2126, roughness: 0.40, metalness: 0.78 }),
  // Polished / chrome: bolt handles, sight surfaces, barrel interiors
  polishedSteel: () => wmat({ color: 0x8a8e96, roughness: 0.22, metalness: 0.95 }),
  // Aluminium / hard-anodised: rails, mounts, suppressor bodies
  aluminum:      () => wmat({ color: 0x3a3d44, roughness: 0.50, metalness: 0.82 }),
  // Polymer (matte black plastic): grips, magazine bodies, polymer frames
  polymer:       () => wmat({ color: 0x0c0c10, roughness: 0.82, metalness: 0.04 }),
  // Hard rubber (recoil pads, textured grip surfaces): blacker than polymer, rougher
  rubber:        () => wmat({ color: 0x07080a, roughness: 0.92, metalness: 0.02 }),
  // Walnut stock — slightly variegated browns
  walnut:        () => wmat({ color: 0x4a2812, roughness: 0.66, metalness: 0.10 }),
  walnutLight:   () => wmat({ color: 0x5e3618, roughness: 0.60, metalness: 0.10 }),
  // Brass: shell casings, ammo belt links, occasional accents
  brass:         () => wmat({ color: 0xb88a3a, roughness: 0.42, metalness: 0.82 }),
  // Bright steel sight post / serrated detail
  accentSteel:   () => wmat({ color: 0x52555c, roughness: 0.35, metalness: 0.75 }),
  // Red accent (dot sight LED, knife wrap accent)
  redAccent:     () => wmat({ color: 0xff3322, emissive: 0xff2200, emissiveIntensity: 0.6,
                              roughness: 0.4, metalness: 0.1 }),
  // Glass / lens
  lens:          () => wmat({ color: 0x0a0a0e, roughness: 0.10, metalness: 0.95 }),
};

// --- VIEW MODELS (held weapons attached to camera) ---
// M11: greatly expanded vs m10. Each weapon now has multi-part construction:
// slide, frame, barrel, magazine well, grip, trigger guard, sights, etc.
// Materials use real metalness so the dark gunmetal reads as metal rather
// than charcoal-painted plastic. Position offsets tuned so the gun sits in
// the lower-right but doesn't obstruct the crosshair.
export function buildPistolModel() {
  const g = new THREE.Group();
  // Slide (top half) — blued steel
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.05, 0.22), WMAT.bluedSteel());
  top.position.set(0, 0.03, -0.04);
  g.add(top);
  // Frame (bottom) — polymer for a Glock-ish look
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.04, 0.13), WMAT.polymer());
  frame.position.set(0, -0.015, -0.02);
  g.add(frame);
  // Barrel — polished steel poking out
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 10), WMAT.polishedSteel());
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.18);
  g.add(barrel);
  // Polymer grip (angled rearward)
  const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), WMAT.polymer());
  gripMesh.position.set(0, -0.10, 0.03);
  gripMesh.rotation.x = -0.18;
  g.add(gripMesh);
  // Trigger guard
  const tg = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 14, Math.PI), WMAT.darkSteel());
  tg.rotation.x = Math.PI / 2;
  tg.position.set(0, -0.038, 0.02);
  g.add(tg);
  // Front + rear sights — accent steel so they read against the slide
  const fs = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.012), WMAT.accentSteel());
  fs.position.set(0, 0.062, -0.13);
  g.add(fs);
  const rs = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.012, 0.014), WMAT.accentSteel());
  rs.position.set(0, 0.062, 0.05);
  g.add(rs);
  // --- M48 detail additions ---
  // Slide rear cocking serrations (4 thin ridges on each side)
  for (let i = 0; i < 4; i++) {
    const z = 0.04 + i * 0.014;
    const serrR = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.04, 0.005), WMAT.bluedSteel());
    serrR.position.set(0.028, 0.03, z); g.add(serrR);
    const serrL = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.04, 0.005), WMAT.bluedSteel());
    serrL.position.set(-0.028, 0.03, z); g.add(serrL);
  }
  // Slide front serrations (3 thinner ridges, just behind the muzzle)
  for (let i = 0; i < 3; i++) {
    const z = -0.13 + i * 0.012;
    const serrR = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.035, 0.005), WMAT.bluedSteel());
    serrR.position.set(0.028, 0.03, z); g.add(serrR);
    const serrL = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.035, 0.005), WMAT.bluedSteel());
    serrL.position.set(-0.028, 0.03, z); g.add(serrL);
  }
  // Trigger — small box inside the trigger guard
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.022, 0.008), WMAT.accentSteel());
  trigger.position.set(0, -0.034, 0.025);
  g.add(trigger);
  // Hammer at the rear of the slide
  const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.022, 0.010), WMAT.bluedSteel());
  hammer.position.set(0, 0.062, 0.075);
  g.add(hammer);
  // Magazine baseplate (thin block at the bottom of the grip)
  const magBase = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.014, 0.06), WMAT.polymer());
  magBase.position.set(0.005, -0.165, 0.045);
  magBase.rotation.x = -0.18;
  g.add(magBase);
  // Slide release lever — small box on the left side of the frame
  const release = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.008, 0.025), WMAT.accentSteel());
  release.position.set(-0.03, 0.005, 0.01);
  g.add(release);
  // Picatinny rail under the dust cover
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.010, 0.07), WMAT.aluminum());
  rail.position.set(0, -0.005, -0.10);
  g.add(rail);
  // Ejection port — dark rectangle inset on the slide's right side (flat plane)
  const port = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.020, 0.060), WMAT.rubber());
  port.position.set(0.028, 0.040, -0.04);
  g.add(port);
  g.position.set(0.16, -0.16, -0.4);
  return g;
}
export function buildShotgunModel() {
  const g = new THREE.Group();
  // Walnut stock — rear
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.10, 0.22), WMAT.walnut());
  stock.position.set(0, -0.005, 0.20);
  g.add(stock);
  // Lighter walnut comb (visible age band on top of the stock)
  const comb = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.024, 0.16), WMAT.walnutLight());
  comb.position.set(0, 0.052, 0.18);
  g.add(comb);
  // Steel receiver
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.18), WMAT.bluedSteel());
  receiver.position.set(0, 0.005, 0.02);
  g.add(receiver);
  // Barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 12), WMAT.bluedSteel());
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.024, -0.27);
  g.add(barrel);
  // Pump grip
  const pumpMesh = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.045, 0.13), WMAT.walnut());
  pumpMesh.position.set(0, -0.04, -0.16);
  g.add(pumpMesh);
  // Trigger guard
  const tg = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 14, Math.PI), WMAT.bluedSteel());
  tg.rotation.x = Math.PI / 2;
  tg.position.set(0, -0.045, 0.06);
  g.add(tg);
  // Bead front sight (polished — catches the light)
  const fs = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), WMAT.polishedSteel());
  fs.position.set(0, 0.055, -0.48);
  g.add(fs);
  // --- M48 detail additions ---
  // Magazine tube under the barrel (full-length cylinder)
  const magTube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.40, 10), WMAT.bluedSteel());
  magTube.rotation.x = Math.PI / 2;
  magTube.position.set(0, -0.012, -0.26);
  g.add(magTube);
  // Trigger inside the guard
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.020, 0.010), WMAT.accentSteel());
  trigger.position.set(0, -0.045, 0.06);
  g.add(trigger);
  // Pump grip ribs (5 raised ridges for grip)
  for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.006, 0.005), WMAT.bluedSteel());
    rib.position.set(0, -0.062, -0.21 + i * 0.026);
    g.add(rib);
  }
  // Recoil pad on the stock butt (rubber)
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, 0.020), WMAT.rubber());
  pad.position.set(0, -0.005, 0.315);
  g.add(pad);
  // Loading port — dark recessed rectangle on the receiver's underside
  const port = new THREE.Mesh(new THREE.BoxGeometry(0.060, 0.003, 0.060), WMAT.rubber());
  port.position.set(0, -0.040, 0.04);
  g.add(port);
  // Rear sight (bead-style — small raised square)
  const rs = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.008, 0.012), WMAT.accentSteel());
  rs.position.set(0, 0.054, -0.06);
  g.add(rs);
  // Sling stud on the bottom of the stock
  const slingStud = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.015, 8), WMAT.accentSteel());
  slingStud.position.set(0, -0.050, 0.27);
  g.add(slingStud);
  g.position.set(0.20, -0.18, -0.45);
  return g;
}
export function buildSmgModel() {
  const g = new THREE.Group();
  // Boxy receiver — dark steel
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.10, 0.20), WMAT.darkSteel());
  body.position.set(0, 0.005, -0.02);
  g.add(body);
  // Topstrap accent (slim raised aluminium section)
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.18), WMAT.aluminum());
  top.position.set(0, 0.062, -0.02);
  g.add(top);
  // Short barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.14, 10), WMAT.bluedSteel());
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.025, -0.18);
  g.add(barrel);
  // Drop magazine — polymer
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.06), WMAT.polymer());
  mag.position.set(0, -0.13, -0.04);
  mag.rotation.x = 0.05;
  g.add(mag);
  // Polymer grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.10, 0.05), WMAT.polymer());
  grip.position.set(0, -0.09, 0.10);
  grip.rotation.x = -0.15;
  g.add(grip);
  // Folding stock (extended)
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.15), WMAT.aluminum());
  stock.position.set(0, 0.005, 0.16);
  g.add(stock);
  const stockButt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.025), WMAT.rubber());
  stockButt.position.set(0, 0.005, 0.24);
  g.add(stockButt);
  // Trigger guard
  const tg = new THREE.Mesh(new THREE.TorusGeometry(0.020, 0.005, 6, 14, Math.PI), WMAT.darkSteel());
  tg.rotation.x = Math.PI / 2;
  tg.position.set(0, -0.04, 0.06);
  g.add(tg);
  // --- M48 detail additions ---
  // Trigger
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.020, 0.008), WMAT.accentSteel());
  trigger.position.set(0, -0.040, 0.06); g.add(trigger);
  // Suppressor on the muzzle (longer/thicker than the barrel)
  const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 12), WMAT.aluminum());
  suppressor.rotation.x = Math.PI / 2;
  suppressor.position.set(0, 0.025, -0.30);
  g.add(suppressor);
  // Charging handle (cylinder + knob) on top
  const chargeBar = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.04, 8), WMAT.polishedSteel());
  chargeBar.rotation.z = Math.PI / 2;
  chargeBar.position.set(0.035, 0.075, 0.02);
  g.add(chargeBar);
  const chargeKnob = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), WMAT.polishedSteel());
  chargeKnob.position.set(0.060, 0.075, 0.02);
  g.add(chargeKnob);
  // Picatinny rail running across the top
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.008, 0.14), WMAT.aluminum());
  rail.position.set(0, 0.072, -0.02);
  g.add(rail);
  // Red-dot sight: base + housing + glowing dot
  const dotBase = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.012, 0.040), WMAT.aluminum());
  dotBase.position.set(0, 0.082, -0.04); g.add(dotBase);
  const dotBody = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.024, 0.030), WMAT.darkSteel());
  dotBody.position.set(0, 0.100, -0.04); g.add(dotBody);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), WMAT.redAccent());
  dot.position.set(0, 0.104, -0.030); g.add(dot);
  // Magazine ridges (5 grip ribs on the mag body)
  for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.057, 0.005, 0.058), WMAT.polymer());
    rib.position.set(0, -0.080 - i * 0.020, -0.04);
    rib.rotation.x = 0.05;
    g.add(rib);
  }
  // Selector switch lever on the receiver's left side
  const selector = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.018, 0.020), WMAT.accentSteel());
  selector.position.set(-0.034, 0.020, 0.045);
  g.add(selector);
  // Sling loop on the back of the receiver
  const slingLoop = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0025, 6, 12), WMAT.accentSteel());
  slingLoop.rotation.y = Math.PI / 2;
  slingLoop.position.set(0, 0.005, 0.085);
  g.add(slingLoop);
  g.position.set(0.18, -0.17, -0.42);
  return g;
}
export function buildSniperModel() {
  const g = new THREE.Group();
  // Long walnut stock
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.10, 0.26), WMAT.walnut());
  stock.position.set(0, -0.005, 0.22);
  g.add(stock);
  // Stock comb (raised cheek piece — lighter walnut to show grain step)
  const comb = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.16), WMAT.walnutLight());
  comb.position.set(0, 0.06, 0.17);
  g.add(comb);
  // Receiver (blued steel)
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.085, 0.20), WMAT.bluedSteel());
  receiver.position.set(0, 0.005, 0);
  g.add(receiver);
  // Bolt handle (polished — catches light)
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8), WMAT.polishedSteel());
  bolt.rotation.z = Math.PI / 2;
  bolt.position.set(-0.05, 0.04, 0.05);
  g.add(bolt);
  const boltKnob = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), WMAT.polishedSteel());
  boltKnob.position.set(-0.08, 0.04, 0.05);
  g.add(boltKnob);
  // Long barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.55, 12), WMAT.bluedSteel());
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.37);
  g.add(barrel);
  // Muzzle brake
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.05, 10), WMAT.darkSteel());
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.02, -0.66);
  g.add(muzzle);
  // Scope body
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.20, 14), WMAT.aluminum());
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.085, -0.06);
  g.add(scope);
  // Scope objective bell
  const objective = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.04, 14), WMAT.aluminum());
  objective.rotation.x = Math.PI / 2;
  objective.position.set(0, 0.085, -0.18);
  g.add(objective);
  // Scope eyepiece bell
  const eyepiece = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.04, 14), WMAT.aluminum());
  eyepiece.rotation.x = Math.PI / 2;
  eyepiece.position.set(0, 0.085, 0.06);
  g.add(eyepiece);
  // Scope mounts
  const mount1 = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.025), WMAT.darkSteel());
  mount1.position.set(0, 0.06, -0.10); g.add(mount1);
  const mount2 = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.025), WMAT.darkSteel());
  mount2.position.set(0, 0.06, 0.02); g.add(mount2);
  // Walnut grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.10, 0.05), WMAT.walnut());
  grip.position.set(0, -0.07, 0.09);
  grip.rotation.x = -0.15;
  g.add(grip);
  // Trigger guard
  const tg = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 14, Math.PI), WMAT.bluedSteel());
  tg.rotation.x = Math.PI / 2;
  tg.position.set(0, -0.038, 0.04);
  g.add(tg);
  // Bipod legs (folded forward)
  const bipodL = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 6), WMAT.darkSteel());
  bipodL.rotation.set(-0.4, 0, 0.3);
  bipodL.position.set( 0.03, -0.06, -0.30);
  g.add(bipodL);
  const bipodR = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 6), WMAT.darkSteel());
  bipodR.rotation.set(-0.4, 0, -0.3);
  bipodR.position.set(-0.03, -0.06, -0.30);
  g.add(bipodR);
  // --- M48 detail additions ---
  // Trigger
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.020, 0.008), WMAT.accentSteel());
  trigger.position.set(0, -0.032, 0.04); g.add(trigger);
  // Scope windage turret (top of scope, perpendicular)
  const windage = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.024, 12), WMAT.darkSteel());
  windage.position.set(0, 0.115, -0.06); g.add(windage);
  // Scope elevation turret (right side of scope, perpendicular)
  const elev = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.024, 12), WMAT.darkSteel());
  elev.rotation.z = Math.PI / 2;
  elev.position.set(0.030, 0.085, -0.06); g.add(elev);
  // Lens inserts (dark, slightly reflective) on both ends of the scope
  const objLens = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.003, 14), WMAT.lens());
  objLens.rotation.x = Math.PI / 2;
  objLens.position.set(0, 0.085, -0.201); g.add(objLens);
  const eyeLens = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.003, 14), WMAT.lens());
  eyeLens.rotation.x = Math.PI / 2;
  eyeLens.position.set(0, 0.085, 0.081); g.add(eyeLens);
  // Recoil pad on the stock butt
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.105, 0.022), WMAT.rubber());
  pad.position.set(0, -0.005, 0.358); g.add(pad);
  // Front sling swivel under the barrel
  const swivelF = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0025, 6, 12), WMAT.accentSteel());
  swivelF.rotation.y = Math.PI / 2;
  swivelF.position.set(0, -0.005, -0.20); g.add(swivelF);
  // Rear sling swivel on the stock
  const swivelR = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0025, 6, 12), WMAT.accentSteel());
  swivelR.rotation.y = Math.PI / 2;
  swivelR.position.set(0, -0.055, 0.28); g.add(swivelR);
  // Muzzle brake vents (3 thin slot meshes around the brake)
  for (let i = 0; i < 3; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.004, 0.006), WMAT.rubber());
    vent.position.set(0, 0.039 + i * -0.018, -0.66);
    g.add(vent);
  }
  g.position.set(0.22, -0.18, -0.48);
  return g;
}

export function buildSawModel() {
  const g = new THREE.Group();
  // Bulky receiver
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, 0.30), WMAT.darkSteel());
  body.position.set(0, 0.01, -0.02);
  g.add(body);
  // Feed tray / top cover
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.20), WMAT.aluminum());
  cover.position.set(0, 0.075, -0.02);
  g.add(cover);
  // Carry handle
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 12, Math.PI), WMAT.bluedSteel());
  handle.rotation.set(Math.PI / 2, 0, 0);
  handle.position.set(0, 0.09, -0.04);
  g.add(handle);
  // Long heavy barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.40, 12), WMAT.bluedSteel());
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.32);
  g.add(barrel);
  // Barrel shroud
  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.16, 10), WMAT.darkSteel());
  shroud.rotation.x = Math.PI / 2;
  shroud.position.set(0, 0.02, -0.20);
  g.add(shroud);
  // 200-rd ammo box hanging under the receiver
  const ammo = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.13), WMAT.darkSteel());
  ammo.position.set(0, -0.10, 0.01);
  g.add(ammo);
  // Pistol grip — polymer
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.055), WMAT.polymer());
  grip.position.set(0, -0.085, 0.12);
  grip.rotation.x = -0.16;
  g.add(grip);
  // Solid stock
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.16), WMAT.darkSteel());
  stock.position.set(0, 0.0, 0.20);
  g.add(stock);
  // Folded bipod under the barrel
  const bipodL = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.15, 6), WMAT.darkSteel());
  bipodL.rotation.set(-0.5, 0, 0.35); bipodL.position.set(0.03, -0.05, -0.34);
  g.add(bipodL);
  const bipodR = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.15, 6), WMAT.darkSteel());
  bipodR.rotation.set(-0.5, 0, -0.35); bipodR.position.set(-0.03, -0.05, -0.34);
  g.add(bipodR);
  // Front sight post
  const fs = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.02, 0.01), WMAT.accentSteel());
  fs.position.set(0, 0.06, -0.30);
  g.add(fs);
  // --- M48 detail additions ---
  // Trigger guard + trigger
  const tg = new THREE.Mesh(new THREE.TorusGeometry(0.020, 0.005, 6, 14, Math.PI), WMAT.darkSteel());
  tg.rotation.x = Math.PI / 2;
  tg.position.set(0, -0.045, 0.07); g.add(tg);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.018, 0.008), WMAT.accentSteel());
  trigger.position.set(0, -0.042, 0.07); g.add(trigger);
  // Brass ammo belt feeding from the top of the box into the receiver — a
  // short chain of brass + steel link blocks
  for (let i = 0; i < 7; i++) {
    const link = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.008, 0.008), WMAT.brass());
    link.position.set(0, -0.040 + i * 0.012, -0.005 - i * 0.002);
    g.add(link);
  }
  // Rivets along the top cover (4 small steel domes)
  for (let i = 0; i < 4; i++) {
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), WMAT.polishedSteel());
    rivet.position.set(-0.025 + i * 0.018, 0.092, -0.04);
    g.add(rivet);
  }
  // Vent slits on the barrel shroud (5 dark cuts around the top)
  for (let i = 0; i < 5; i++) {
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.004, 0.060), WMAT.rubber());
    slit.position.set(-0.018 + i * 0.009, 0.046, -0.20);
    g.add(slit);
  }
  // Charging handle on the right side of the receiver
  const chargeBar = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.045, 8), WMAT.polishedSteel());
  chargeBar.rotation.z = Math.PI / 2;
  chargeBar.position.set(0.058, 0.020, -0.08); g.add(chargeBar);
  const chargeKnob = new THREE.Mesh(new THREE.SphereGeometry(0.010, 8, 6), WMAT.polishedSteel());
  chargeKnob.position.set(0.085, 0.020, -0.08); g.add(chargeKnob);
  // Recoil pad on the stock butt
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.080, 0.020), WMAT.rubber());
  pad.position.set(0, 0.0, 0.290); g.add(pad);
  // Sling loop on the rear of the receiver
  const slingLoop = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.003, 6, 12), WMAT.accentSteel());
  slingLoop.rotation.y = Math.PI / 2;
  slingLoop.position.set(0, 0.030, 0.090); g.add(slingLoop);
  // Rear sight (peep) on the back of the top cover
  const rs = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.014, 0.010), WMAT.accentSteel());
  rs.position.set(0, 0.094, 0.060); g.add(rs);
  g.position.set(0.20, -0.18, -0.44);
  return g;
}
function buildKnifeModel() {
  const g = new THREE.Group();
  // Blade body (polished steel)
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.006, 0.20), WMAT.polishedSteel());
  blade.position.set(0, 0, -0.13);
  g.add(blade);
  // Bevel / edge — slightly brighter strip running down the cutting edge
  const bevel = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.005, 0.20),
                               wmat({ color: 0xe6e9ef, roughness: 0.15, metalness: 0.85 }));
  bevel.position.set(0.008, 0, -0.13);
  g.add(bevel);
  // Point — angled cone tip
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 4), WMAT.polishedSteel());
  tip.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  tip.position.set(0, 0, -0.255);
  g.add(tip);
  // Cross guard
  const cg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.018), WMAT.darkSteel());
  cg.position.set(0, 0, -0.025);
  g.add(cg);
  // Handle core — dark polymer
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.011, 0.11, 8), WMAT.polymer());
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, 0, 0.045);
  g.add(handle);
  // Pommel — small heavy cap
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), WMAT.darkSteel());
  pommel.position.set(0, 0, 0.105);
  g.add(pommel);
  // --- M48 detail additions ---
  // Blade fuller — narrow recessed groove running most of the blade length.
  // Modelled as a slightly darker (so it reads "recessed") inset bar.
  const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.003, 0.16), WMAT.darkSteel());
  fuller.position.set(-0.003, 0.002, -0.15);
  g.add(fuller);
  // Saw-back teeth on the spine of the blade — 6 small cone notches
  for (let i = 0; i < 6; i++) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.0035, 0.012, 3), WMAT.polishedSteel());
    tooth.rotation.x = Math.PI / 2;
    tooth.position.set(-0.009, 0.003, -0.06 - i * 0.024);
    g.add(tooth);
  }
  // Paracord wrap on the handle — alternating dark/light bands
  for (let i = 0; i < 6; i++) {
    const isDark = i % 2 === 0;
    const ringMat = isDark ? WMAT.polymer() : wmat({ color: 0x9a9591, roughness: 0.85, metalness: 0.04 });
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, 0.018, 8), ringMat);
    wrap.rotation.x = Math.PI / 2;
    wrap.position.set(0, 0, 0.0 + i * 0.018);
    g.add(wrap);
  }
  // Lanyard hole through the pommel (small dark cylinder passing through)
  const lanyard = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.020, 8), WMAT.rubber());
  lanyard.rotation.z = Math.PI / 2;
  lanyard.position.set(0, 0, 0.110);
  g.add(lanyard);
  // Glass-breaker spike sticking out the back of the pommel
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.020, 4), WMAT.polishedSteel());
  spike.rotation.x = -Math.PI / 2;
  spike.position.set(0, 0, 0.128);
  g.add(spike);
  // Small red accent on the cross guard (signature flair)
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.003, 0.003), WMAT.redAccent());
  accent.position.set(0, -0.006, -0.025);
  g.add(accent);
  g.position.set(0.17, -0.15, -0.34);
  g.rotation.set(0.10, -0.12, 0);
  return g;
}

// Build all view models and attach to camera. Hidden by default; the active
// one is toggled via updateWeaponVisibility().
const VIEW_MODELS = {
  pistol:  buildPistolModel(),
  shotgun: buildShotgunModel(),
  smg:     buildSmgModel(),
  sniper:  buildSniperModel(),
  saw:     buildSawModel(),
  knife:   buildKnifeModel(),
};
for (const key in VIEW_MODELS) {
  camera.add(VIEW_MODELS[key]);
  VIEW_MODELS[key].visible = false;
  // View models are parented to the camera, so they're always in the
  // foreground. Disable shadow casting/receiving across the whole tree —
  // otherwise the sun would try to cast their shadow somewhere weird, and
  // self-shadowing inside the gun parts causes acne.
  VIEW_MODELS[key].traverse((obj) => {
    if (obj.isMesh) { obj.castShadow = false; obj.receiveShadow = false; }
  });
}
VIEW_MODELS.pistol.visible = true;

// Per-weapon muzzle flash, positioned at each model's barrel tip. M11: each
// flash is two parts — a small bright core sphere (the hot center of the
// flash) plus a translucent corona disc that fakes a brief lens-flare halo.
// `toneMapped: false` keeps both readable through ACES tone mapping.
const flashCoreMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, toneMapped: false });
const flashCoronaMat = new THREE.MeshBasicMaterial({
  color: 0xffaa44, transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false,
});
const flashCoreGeom = new THREE.SphereGeometry(0.055, 10, 8);
const flashCoronaGeom = new THREE.PlaneGeometry(0.28, 0.28);

// Per-weapon: offset (barrel tip) and core scale (sniper has biggest flash).
const FLASH_OFFSETS = {
  pistol:  { x: 0, y: 0.03, z: -0.22, scale: 0.9 },
  shotgun: { x: 0, y: 0.025, z: -0.50, scale: 1.5 },
  smg:     { x: 0, y: 0.025, z: -0.28, scale: 0.9 },
  sniper:  { x: 0, y: 0.02,  z: -0.69, scale: 1.8 },
  saw:     { x: 0, y: 0.02,  z: -0.54, scale: 1.3 },
  knife:   { x: 0, y: 0,     z: -0.30, scale: 0.0 },  // melee: never shown
};

// Where each weapon group sits relative to the camera. Mirrors the
// `g.position.set(...)` line in each build*Model() function. Kept here so
// the muzzle-light positioning code can compute world-correct muzzle
// positions = weaponOff + flashOff (both in camera space).
const WEAPON_OFFSETS = {
  pistol:  { x: 0.16, y: -0.16, z: -0.40 },
  shotgun: { x: 0.20, y: -0.18, z: -0.45 },
  smg:     { x: 0.18, y: -0.17, z: -0.42 },
  sniper:  { x: 0.22, y: -0.18, z: -0.48 },
  saw:     { x: 0.20, y: -0.18, z: -0.44 },
  knife:   { x: 0.17, y: -0.15, z: -0.34 },
};

// Each weapon gets a small group: { core sphere, corona quad }. The whole
// group is toggled visible per shot; the corona stays facing camera since
// it's parented under the weapon and the weapon is parented under the camera.
const MUZZLE_FLASHES = {};
for (const key in VIEW_MODELS) {
  const off = FLASH_OFFSETS[key];
  const flashGroup = new THREE.Group();
  flashGroup.position.set(off.x, off.y, off.z);
  flashGroup.scale.setScalar(off.scale);

  const core = new THREE.Mesh(flashCoreGeom, flashCoreMat);
  flashGroup.add(core);

  const corona = new THREE.Mesh(flashCoronaGeom, flashCoronaMat);
  // Face forward (-Z); since this is parented to weapon parented to camera,
  // it'll always read as facing the player.
  flashGroup.add(corona);

  flashGroup.visible = false;
  VIEW_MODELS[key].add(flashGroup);
  MUZZLE_FLASHES[key] = flashGroup;
}

// Put every object in each view-model subtree (gun parts AND the muzzle-flash
// group built above) on LAYER_VIEWMODEL. The main render loop draws the world
// first, clears depth, then renders this layer on top — so the held weapon
// can never clip into a wall, it draws over it. Done here, after the flash
// groups are attached, so the whole subtree is covered.
for (const key in VIEW_MODELS) {
  VIEW_MODELS[key].traverse((obj) => obj.layers.set(LAYER_VIEWMODEL));
}

// --- WEAPON SELF-LIGHTING (independent of world lighting) ---
// The gun materials are intentionally dark, near-black metals. A metallic
// PBR surface has almost no diffuse term, so even strong lights leave it
// reading black without an environment map. To guarantee the held weapon is
// ALWAYS clearly visible no matter how dark (or bright) the map is, we give
// every view-model material a constant emissive floor derived from its own
// colour. Emissive is added regardless of any scene light, so it is by
// definition independent of world lighting. We also pull metalness down a
// little so the dedicated view-model light (added in scene.js) produces real
// form (diffuse shading) rather than just a pinpoint specular highlight.
// Muzzle-flash materials are MeshBasic (no emissive/metalness) → skipped.
const _vmColor = new THREE.Color();
for (const key in VIEW_MODELS) {
  VIEW_MODELS[key].traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m || m.isMeshBasicMaterial || m.emissive === undefined) continue;
      _vmColor.copy(m.color);
      // Emissive = the material's own colour, lifted off pure black so even
      // a 0x000000 part stays readable, at a modest constant intensity.
      m.emissive.setRGB(
        Math.max(_vmColor.r, 0.06),
        Math.max(_vmColor.g, 0.06),
        Math.max(_vmColor.b, 0.07)
      );
      m.emissiveIntensity = 0.28;
      if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.72);
      if (m.roughness !== undefined) m.roughness = Math.max(m.roughness, 0.32);
      m.needsUpdate = true;
    }
  });
}

function updateWeaponVisibility() {
  for (const key in VIEW_MODELS) {
    VIEW_MODELS[key].visible = (wState.currentWeapon === key);
  }
}

// --- RAYCAST SCRATCH BUFFERS (reused per frame) ---
const _origin     = new THREE.Vector3();
const _direction  = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _camRight   = new THREE.Vector3();
const _camUp      = new THREE.Vector3();
const _camBasisZ  = new THREE.Vector3();
const _hitNormal  = new THREE.Vector3();
const _normalMat3 = new THREE.Matrix3();
const _raycaster = new THREE.Raycaster();
_raycaster.far = RAYCAST_RANGE;

function canAct() {
  return state.isLocked &&
    (state.gameState === GAME_STATE.PLAYING || state.gameState === GAME_STATE.BETWEEN_WAVES);
}

export function tryFire() {
  if (!canAct()) return;
  if (wState.reloadTimer > 0) return;
  if (wState.fireCooldown > 0) return;

  const w = WEAPON_DEFS[wState.currentWeapon];

  // --- MELEE (knife): no ammo, short reach, swipe ---
  if (w.melee) {
    wState.fireCooldown = 60 / w.rpm;
    wState.meleeAnim = 0.22;          // drives the view-model lunge
    meleeStrike(w);
    w.sfxFire();
    return;
  }

  const s = weaponState[wState.currentWeapon];
  if (s.mag <= 0) {
    sfxEmptyClick();
    return;
  }

  s.mag -= 1;
  wState.fireCooldown = 60 / w.rpm;

  // Effective spread = base + accumulated bloom (SAW only; 0 otherwise).
  const spread = w.spread + (w.bloom ? wState.bloom : 0);
  fireRays(w, spread);
  triggerMuzzleFlash();
  wState.recoilPitch += w.recoil;
  // Sustained fire widens the cone up to the cap.
  if (w.bloom) {
    wState.bloom = Math.min(w.bloom.maxExtra, wState.bloom + w.bloom.addPerShot);
  }
  w.sfxFire();
}

// M10: called every active frame from the game loop. Full-auto weapons fire
// continuously while mouse is held; tryFire() is gated by fireCooldown so
// this naturally rate-limits.
export function processAutoFire() {
  if (!wState.mouseHeld) return;
  const w = WEAPON_DEFS[wState.currentWeapon];
  if (w.autoFire) tryFire();
}

function fireRays(w, spread) {
  _origin.copy(camera.position);
  camera.getWorldDirection(_camForward);
  camera.matrixWorld.extractBasis(_camRight, _camUp, _camBasisZ);

  let anyEnemyHit = false;
  let anyHeadshot = false;

  for (let i = 0; i < w.pellets; i++) {
    if (spread > 0) {
      const r = Math.sqrt(Math.random()) * Math.tan(spread);
      const phi = Math.random() * Math.PI * 2;
      const ox = r * Math.cos(phi);
      const oy = r * Math.sin(phi);
      _direction.copy(_camForward);
      _direction.addScaledVector(_camRight, ox);
      _direction.addScaledVector(_camUp, oy);
      _direction.normalize();
    } else {
      _direction.copy(_camForward);
    }

    _raycaster.set(_origin, _direction);
    _raycaster.far = RAYCAST_RANGE;
    const hits = _raycaster.intersectObjects(shootables, false);
    if (hits.length > 0 && hits[0].face) {
      const hit = hits[0];
      const enemy = hit.object.userData && hit.object.userData.enemy;
      if (enemy && enemy.alive) {
        const isHead = hit.object.userData.isHead === true;
        const hsMult = w.headshotMult !== undefined ? w.headshotMult : HEADSHOT_MULTIPLIER;
        const damage = isHead ? w.damage * hsMult : w.damage;
        damageEnemy(enemy, damage);
        anyEnemyHit = true;
        if (isHead) anyHeadshot = true;
      } else {
        _hitNormal.copy(hit.face.normal);
        _normalMat3.getNormalMatrix(hit.object.matrixWorld);
        _hitNormal.applyMatrix3(_normalMat3).normalize();
        createImpact(hit.point, _hitNormal);
      }
    }
  }

  if (anyHeadshot) {
    sfxHeadshot();
    wState.headshotMarkerTimer = HEADSHOT_MARKER_TIME;
  } else if (anyEnemyHit) {
    sfxEnemyHit();
    wState.hitMarkerTimer = HIT_MARKER_TIME;
  }
}

// Melee: a single short ray straight ahead. Only registers if the FIRST
// thing hit is an enemy within reach (a wall in the way blocks the swipe).
function meleeStrike(w) {
  _origin.copy(camera.position);
  camera.getWorldDirection(_camForward);
  _raycaster.set(_origin, _camForward);
  _raycaster.far = w.range;
  const hits = _raycaster.intersectObjects(shootables, false);
  if (hits.length > 0 && hits[0].distance <= w.range) {
    const hit = hits[0];
    const enemy = hit.object.userData && hit.object.userData.enemy;
    if (enemy && enemy.alive) {
      const isHead = hit.object.userData.isHead === true;
      const dmg = isHead ? w.damage * (w.headshotMult || 1) : w.damage;
      damageEnemy(enemy, dmg);
      sfxEnemyHit();
      wState.hitMarkerTimer = HIT_MARKER_TIME;
    }
  }
}

// Shared muzzle point light — attached to camera, repositioned per shot to
// the muzzle of the active weapon. Casts no shadow (perf), high intensity but
// very short range so it just kisses nearby surfaces.
const muzzleLight = new THREE.PointLight(0xffd28a, 0, 4, 2);
muzzleLight.castShadow = false;
camera.add(muzzleLight);
// Keeps LAYER_WORLD (flash still kisses nearby walls in the world pass) and
// also enables LAYER_VIEWMODEL so the flash lights the gun in the overlay
// pass.
muzzleLight.layers.enable(LAYER_VIEWMODEL);

function triggerMuzzleFlash() {
  const flash = MUZZLE_FLASHES[wState.currentWeapon];
  flash.visible = true;
  wState.activeMuzzleFlash = flash;
  wState.muzzleFlashTimer = MUZZLE_FLASH_TIME;
  // Position the shared point light at this weapon's muzzle, in camera space.
  // muzzleLight is parented to the camera (not the weapon group), so we have
  // to add both offsets ourselves.
  const off = FLASH_OFFSETS[wState.currentWeapon];
  const woff = WEAPON_OFFSETS[wState.currentWeapon];
  muzzleLight.position.set(woff.x + off.x, woff.y + off.y, woff.z + off.z);
  // Sniper is the loudest gun, give it a brighter pop.
  muzzleLight.intensity = (wState.currentWeapon === 'sniper') ? 5.0
                       : (wState.currentWeapon === 'shotgun') ? 4.0
                       : 2.5;
}

export function tryReload() {
  if (!canAct()) return;
  if (wState.reloadTimer > 0) return;
  const w = WEAPON_DEFS[wState.currentWeapon];
  const s = weaponState[wState.currentWeapon];
  if (s.mag >= w.magSize) return;
  if (s.reserve <= 0) return;
  wState.reloadTimer = w.reloadTime;
  // sfxReloadStart schedules clipout / clipin / boltpull at frac-of-reload-time
  // intervals using the duration we pass here. If reloadTime changes for a
  // weapon, the sample chain stays in sync.
  sfxReloadStart(wState.currentWeapon, w.reloadTime);
}

function finishReload() {
  const w = WEAPON_DEFS[wState.currentWeapon];
  const s = weaponState[wState.currentWeapon];
  const needed = w.magSize - s.mag;
  const toLoad = Math.min(needed, s.reserve);
  s.mag += toLoad;
  s.reserve -= toLoad;
}

// M15 Stage 3: weapon pickups call this on collection. First grab unlocks the
// weapon (it's owned for the rest of the run); every grab refills the mag and
// resets reserve to the starting amount, so pickups double as ammo refills.
// Returns true if this was the first time the weapon was unlocked (caller may
// use that to differentiate the toast / cue).
export function unlockWeapon(name) {
  const def = WEAPON_DEFS[name];
  if (!def) return false;
  const wasLocked = !def.unlocked;
  def.unlocked = true;
  const s = weaponState[name];
  if (s) {
    s.mag = def.magSize;
    s.reserve = def.reserveStart;
  }
  return wasLocked;
}

export function switchWeapon(name) {
  if (name === wState.currentWeapon) return;
  if (!WEAPON_DEFS[name] || !WEAPON_DEFS[name].unlocked) return;
  // Coming off a scoped weapon → force unscope so the next gun isn't locked
  // into low FOV / low sensitivity by stale state.
  if (player.isScoped) setScope(false);
  // Cancel any in-flight reload audio so the old weapon's clipin/boltpull
  // doesn't bleed into the new weapon's deploy.
  stopAllReloadAudio();
  wState.reloadTimer = 0;
  wState.fireCooldown = 0;
  wState.bloom = 0;
  wState.currentWeapon = name;
  updateWeaponVisibility();
  // Play deploy sample (currently only the sniper has one; others are silent).
  sfxWeaponDeploy(name);
}

// --- SCOPE ---
// M10: only the sniper canScope. Right-click toggles. Side effects on FOV /
// sensitivity / walk speed / overlay are read elsewhere (player.js, hud.js,
// input.js); this function owns the flag.
export function toggleScope() {
  if (!canAct()) return;
  const w = WEAPON_DEFS[wState.currentWeapon];
  if (!w.canScope) return;
  setScope(!player.isScoped);
}

export function setScope(on) {
  if (player.isScoped === on) return;
  player.isScoped = on;
  if (on) sfxScopeOn(); else sfxScopeOff();
}

export function updateWeaponTimers(dt) {
  if (wState.fireCooldown > 0) {
    wState.fireCooldown -= dt;
    if (wState.fireCooldown < 0) wState.fireCooldown = 0;
  }
  if (wState.reloadTimer > 0) {
    wState.reloadTimer -= dt;
    if (wState.reloadTimer <= 0) {
      wState.reloadTimer = 0;
      finishReload();
    }
  }
  if (wState.muzzleFlashTimer > 0) {
    wState.muzzleFlashTimer -= dt;
    // Fade the muzzle point light proportionally to how much of the flash
    // window remains. Snaps off at the end with the mesh.
    if (muzzleLight.intensity > 0) {
      const frac = Math.max(0, wState.muzzleFlashTimer / MUZZLE_FLASH_TIME);
      muzzleLight.intensity *= frac;
    }
    if (wState.muzzleFlashTimer <= 0) {
      wState.muzzleFlashTimer = 0;
      if (wState.activeMuzzleFlash) {
        wState.activeMuzzleFlash.visible = false;
        wState.activeMuzzleFlash = null;
      }
      muzzleLight.intensity = 0;
    }
  }
  if (wState.recoilPitch !== 0) {
    wState.recoilPitch *= Math.exp(-RECOIL_DECAY * dt);
    if (Math.abs(wState.recoilPitch) < 1e-5) wState.recoilPitch = 0;
  }

  // SAW bloom recovers toward 0 when you ease off the trigger (tryFire adds
  // to it per shot). Only the active weapon's recovery rate applies; any
  // other weapon has no bloom params so the value just bleeds back to 0.
  if (wState.bloom > 0) {
    const aw = WEAPON_DEFS[wState.currentWeapon];
    const rec = (aw.bloom ? aw.bloom.recoverPerSec : 0.12) * dt;
    wState.bloom = Math.max(0, wState.bloom - rec);
  }

  // Knife swipe: a quick forward lunge of the view model, eased out.
  if (wState.meleeAnim > 0) {
    wState.meleeAnim -= dt;
    if (wState.meleeAnim < 0) wState.meleeAnim = 0;
    const km = VIEW_MODELS.knife;
    if (km) {
      const p = 1 - wState.meleeAnim / 0.22;          // 0→1 over the swipe
      const lunge = Math.sin(Math.min(1, Math.max(0, p)) * Math.PI);
      km.position.z = WEAPON_OFFSETS.knife.z - lunge * 0.16;
      km.rotation.z = -lunge * 0.5;
    }
  }
  if (wState.hitMarkerTimer > 0) {
    wState.hitMarkerTimer -= dt;
    if (wState.hitMarkerTimer < 0) wState.hitMarkerTimer = 0;
  }
  if (wState.headshotMarkerTimer > 0) {
    wState.headshotMarkerTimer -= dt;
    if (wState.headshotMarkerTimer < 0) wState.headshotMarkerTimer = 0;
  }
}

export function resetWeapons() {
  // Cancel any scheduled reload sample chain so it doesn't bleed past reset.
  stopAllReloadAudio();
  WEAPON_DEFS.shotgun.unlocked = false;
  WEAPON_DEFS.smg.unlocked = false;
  WEAPON_DEFS.saw.unlocked = false;
  WEAPON_DEFS.sniper.unlocked = false;
  // knife stays unlocked (always-available melee fallback).
  for (const key in WEAPON_DEFS) {
    weaponState[key].mag = WEAPON_DEFS[key].magSize;
    weaponState[key].reserve = WEAPON_DEFS[key].reserveStart;
  }
  wState.currentWeapon = 'pistol';
  wState.fireCooldown = 0;
  wState.reloadTimer = 0;
  wState.recoilPitch = 0;
  wState.bloom = 0;
  wState.meleeAnim = 0;
  wState.muzzleFlashTimer = 0;
  wState.hitMarkerTimer = 0;
  wState.headshotMarkerTimer = 0;
  wState.mouseHeld = false;
  if (wState.activeMuzzleFlash) {
    wState.activeMuzzleFlash.visible = false;
    wState.activeMuzzleFlash = null;
  }
  muzzleLight.intensity = 0;
  setScope(false);
  camera.fov = DEFAULT_FOV;
  camera.updateProjectionMatrix();
  updateWeaponVisibility();
}
