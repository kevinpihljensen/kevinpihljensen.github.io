// audio.js — Web Audio API with sample playback + procedural fallbacks.
//
// M11: sample-based for all gun-related cues.
//
//   Weapon fire (single-shot samples):
//     pistol         → CS Desert Eagle
//     sniper         → CS AWP
//     smg            → CS MAC-10
//     shotgun        → CS XM1014
//     shooter_fire   → CS Galil (enemy projectile shooters)
//
//   Reload sequences (timed: clipout, then clipin, then optional bolt):
//     pistol         → de_clipout, de_clipin
//     smg            → mac10_clipout, mac10_clipin, mac10_boltpull
//     sniper         → awp_clipout, awp_clipin
//     shotgun        → synth (no per-shell sample uploaded)
//
//   Weapon equip (one-shot when switching TO this weapon):
//     sniper         → awp_deploy
//
// Reloads are scheduled via setTimeout chains. Each is queued on tryReload(),
// not strictly at the start/end — the timing is tuned to land near the
// reload-time boundaries in WEAPON_DEFS. If a reload is interrupted (player
// dies, weapon swap, game reset), cancelReloadSequence() clears the chain.
//
// If a sample fails to load (404, decode error), the corresponding function
// silently falls back to its synth implementation. So missing assets degrade
// gracefully.

import { AUDIO_MASTER_VOLUME } from './constants.js';

let audioCtx = null;
let masterGain = null;
let compressor = null;

export function ensureAudio() {
  if (audioCtx) return audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = AUDIO_MASTER_VOLUME;
    // Compressor on master bus catches peaks when multiple cues stack
    // (e.g. shotgun + enemy hit + footstep). Without it, layered samples clip.
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);
    preloadSamples();
  } catch (e) {
    audioCtx = null;
    masterGain = null;
    compressor = null;
  }
  return audioCtx;
}

export function suspendAudio() {
  if (audioCtx && audioCtx.state === 'running') audioCtx.suspend().catch(() => {});
}
export function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}

// --- SAMPLES ---
const samples = {};
const SAMPLE_FILES = {
  // Fire
  pistol:           'assets/audio/pistol.wav',
  sniper:           'assets/audio/sniper.wav',
  smg:              'assets/audio/smg.wav',
  shotgun:          'assets/audio/shotgun.wav',
  saw:              'assets/audio/saw.wav',
  shooter_fire:     'assets/audio/shooter_fire.wav',
  // Reload
  pistol_clipout:   'assets/audio/pistol_clipout.wav',
  pistol_clipin:    'assets/audio/pistol_clipin.wav',
  smg_clipout:      'assets/audio/smg_clipout.wav',
  smg_clipin:       'assets/audio/smg_clipin.wav',
  smg_boltpull:     'assets/audio/smg_boltpull.wav',
  saw_clipout:      'assets/audio/saw_clipout.wav',
  saw_clipin:       'assets/audio/saw_clipin.wav',
  sniper_clipout:   'assets/audio/sniper_clipout.wav',
  sniper_clipin:    'assets/audio/sniper_clipin.wav',
  // Deploy
  sniper_deploy:    'assets/audio/sniper_deploy.wav',
};

// Per-sample gain trims — balance loudness across samples recorded at
// different levels. Tuned by file size as a rough proxy plus ear judgment:
// the big AWP shot needs the most attenuation; small clipout clicks need
// little or none. Adjust if anything sounds off.
const SAMPLE_GAIN = {
  pistol:         0.85,
  sniper:         0.50,
  smg:            0.85,
  shotgun:        0.70,
  saw:            0.80,
  shooter_fire:   0.55,
  pistol_clipout: 0.90,
  pistol_clipin:  0.90,
  smg_clipout:    0.90,
  smg_clipin:     0.85,
  smg_boltpull:   0.85,
  saw_clipout:    0.90,
  saw_clipin:     0.90,
  sniper_clipout: 0.85,
  sniper_clipin:  0.85,
  sniper_deploy:  0.80,
};

let preloadStarted = false;
function preloadSamples() {
  if (preloadStarted || !audioCtx) return;
  preloadStarted = true;
  for (const slot in SAMPLE_FILES) {
    fetch(SAMPLE_FILES[slot])
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((ab) => audioCtx.decodeAudioData(ab))
      .then((buf) => { samples[slot] = buf; })
      .catch(() => { /* fall back to synth for that slot */ });
  }
}

// Play a buffered sample. detuneCents adds ±N cents of random pitch jitter
// so repeated firing (especially full-auto SMG) doesn't sound like a perfect
// loop. Returns true on success, false if no buffer available.
function playSample(slot, detuneCents) {
  const buf = samples[slot];
  if (!audioCtx || !masterGain || !buf) return false;
  try {
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    if (detuneCents) src.detune.value = (Math.random() * 2 - 1) * detuneCents;
    const g = audioCtx.createGain();
    g.gain.value = SAMPLE_GAIN[slot] !== undefined ? SAMPLE_GAIN[slot] : 1.0;
    src.connect(g);
    g.connect(masterGain);
    src.start();
    return true;
  } catch (_) { return false; }
}

// S55: positional sample playback. Same as playSample but routes through a
// WebAudio PannerNode so the listener (updated each frame from the camera
// via updateAudioListener) hears stereo positioning + distance falloff.
// Returns true on success.
function playSamplePositional(slot, x, y, z, detuneCents) {
  const buf = samples[slot];
  if (!audioCtx || !masterGain || !buf) return false;
  try {
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    if (detuneCents) src.detune.value = (Math.random() * 2 - 1) * detuneCents;
    const g = audioCtx.createGain();
    g.gain.value = SAMPLE_GAIN[slot] !== undefined ? SAMPLE_GAIN[slot] : 1.0;
    const panner = audioCtx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    // refDistance: gain = 1.0 within this radius; rolloff kicks in past it.
    // maxDistance caps the attenuation so distant sources don't drop to 0.
    panner.refDistance = 6;
    panner.maxDistance = 140;
    panner.rolloffFactor = 1.4;
    // Modern AudioParam API + setPosition fallback for older browsers.
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else if (panner.setPosition) {
      panner.setPosition(x, y, z);
    }
    src.connect(g);
    g.connect(panner);
    panner.connect(masterGain);
    src.start();
    return true;
  } catch (_) { return false; }
}

// S55: positional one-shot synth fallback. A short band-limited noise burst
// at (x,y,z) routed through a panner — used when the sample variant fails
// (e.g. asset 404 in dev). Keeps the spatial cue alive even without samples.
function playNoisePositional(opts, x, y, z) {
  if (!audioCtx || !masterGain) return;
  const t0 = audioCtx.currentTime;
  const dur     = opts.duration || 0.1;
  const gain    = opts.gain !== undefined ? opts.gain : 0.2;
  const lowpass = opts.lowpass || 2000;
  const bufLen = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
  const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = lowpass;
  const env = audioCtx.createGain();
  env.gain.setValueAtTime(gain, t0);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const panner = audioCtx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 6;
  panner.maxDistance = 140;
  panner.rolloffFactor = 1.4;
  if (panner.positionX) {
    panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z;
  } else if (panner.setPosition) {
    panner.setPosition(x, y, z);
  }
  src.connect(lp); lp.connect(env); env.connect(panner); panner.connect(masterGain);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

// S55: called once per active frame from main.js with the camera's world
// position + forward unit vector. Updates the global WebAudio listener so
// every PannerNode created via playSamplePositional pans correctly.
export function updateAudioListener(px, py, pz, fx, fy, fz) {
  if (!audioCtx || !audioCtx.listener) return;
  const L = audioCtx.listener;
  if (L.positionX) {
    L.positionX.value = px;
    L.positionY.value = py;
    L.positionZ.value = pz;
    L.forwardX.value = fx;
    L.forwardY.value = fy;
    L.forwardZ.value = fz;
    L.upX.value = 0;
    L.upY.value = 1;
    L.upZ.value = 0;
  } else if (L.setPosition) {
    L.setPosition(px, py, pz);
    L.setOrientation(fx, fy, fz, 0, 1, 0);
  }
}

// --- SYNTH PRIMITIVES (fallback only) ---
function playTone(opts) {
  if (!audioCtx || !masterGain) return;
  const t0 = audioCtx.currentTime;
  const freq    = opts.freq;
  const type    = opts.type || 'square';
  const dur     = opts.duration || 0.08;
  const attack  = opts.attack !== undefined ? opts.attack : 0.002;
  const gain    = opts.gain !== undefined ? opts.gain : 0.25;
  const freqEnd = opts.freqEnd;

  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(0.01, freqEnd), t0 + dur);
  }
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env);
  env.connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function playNoise(opts) {
  if (!audioCtx || !masterGain) return;
  const t0 = audioCtx.currentTime;
  const dur      = opts.duration || 0.1;
  const gain     = opts.gain !== undefined ? opts.gain : 0.2;
  const lowpass  = opts.lowpass || 2000;
  const highpass = opts.highpass || 0;
  const lowpassEnd = opts.lowpassEnd;
  const attack   = opts.attack !== undefined ? opts.attack : 0;

  const bufLen = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
  const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

  const src = audioCtx.createBufferSource();
  src.buffer = buf;

  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(lowpass, t0);
  if (lowpassEnd !== undefined) {
    lp.frequency.exponentialRampToValueAtTime(Math.max(20, lowpassEnd), t0 + dur);
  }

  const env = audioCtx.createGain();
  if (attack > 0) {
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + attack);
  } else {
    env.gain.setValueAtTime(gain, t0);
  }
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  if (highpass > 0) {
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = highpass;
    src.connect(hp); hp.connect(lp);
  } else {
    src.connect(lp);
  }
  lp.connect(env);
  env.connect(masterGain);

  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// --- WEAPON FIRE (sample-first, synth fallback) ---
// 8 cents of pitch jitter keeps full-auto SMG / consecutive pistol shots
// from sounding like a tape loop. Snipers + shotgun get less because each
// shot is more deliberate / distinct.
export function sfxPistol() {
  if (playSample('pistol', 12)) return;
  playTone({ freq: 900, type: 'square', duration: 0.07, gain: 0.18, freqEnd: 220 });
  playNoise({ duration: 0.05, gain: 0.13, lowpass: 4500, highpass: 600 });
}
export function sfxShotgun() {
  if (playSample('shotgun', 6)) return;
  playNoise({ duration: 0.22, gain: 0.40, lowpass: 1400, highpass: 100 });
  playTone({ freq: 130, type: 'sine', duration: 0.18, gain: 0.28, freqEnd: 50 });
}
export function sfxSmg() {
  if (playSample('smg', 18)) return;
  playTone({ freq: 700, type: 'square', duration: 0.04, gain: 0.13, freqEnd: 200 });
  playNoise({ duration: 0.035, gain: 0.10, lowpass: 5000, highpass: 800 });
}
export function sfxSniper() {
  if (playSample('sniper', 4)) return;
  playNoise({ duration: 0.30, gain: 0.45, lowpass: 1800, highpass: 200 });
  playTone({ freq: 1400, type: 'sawtooth', duration: 0.05, gain: 0.18, freqEnd: 400 });
  playTone({ freq: 90, type: 'sine', duration: 0.45, gain: 0.20, freqEnd: 38 });
}
export function sfxSaw() {
  // M249: punchier and deeper than the SMG, with a low chug under it.
  if (playSample('saw', 16)) return;
  playTone({ freq: 560, type: 'square', duration: 0.05, gain: 0.15, freqEnd: 150 });
  playNoise({ duration: 0.045, gain: 0.13, lowpass: 4200, highpass: 500 });
  playTone({ freq: 120, type: 'sine', duration: 0.06, gain: 0.12, freqEnd: 55 });
}
export function sfxKnife() {
  // Quick whoosh — short band-limited noise sweep, no tone.
  if (playSample('knife', 8)) return;
  playNoise({ duration: 0.13, gain: 0.16, lowpass: 6000, highpass: 1400 });
}
// S55: positional when (x,y,z) is supplied (enemy fire), full-volume non-
// positional when not (e.g. UI cue / fallback). Tries the sample first; if
// the asset failed to load, falls back to a positional synth so the spatial
// cue survives the asset miss.
export function sfxShooterFire(x, y, z) {
  if (x !== undefined) {
    if (playSamplePositional('shooter_fire', x, y, z, 14)) return;
    playNoisePositional({ duration: 0.10, gain: 0.20, lowpass: 4000 }, x, y, z);
    return;
  }
  if (playSample('shooter_fire', 14)) return;
  playTone({ freq: 380, type: 'sawtooth', duration: 0.12, gain: 0.14, freqEnd: 880 });
}

// --- RELOAD SEQUENCE ---
// Reload is choreographed: clipout fires immediately, clipin fires partway
// through, optional boltpull fires near the end.
//
// Timings are expressed as a fraction of WEAPON_DEFS.reloadTime, computed at
// schedule time so a future change to reload-time doesn't desync the chain:
//   clipout:    0.00 (immediately)
//   clipin:     0.45 (just past halfway — mag-in click lands near middle)
//   boltpull:   0.85 (near the end, before the "ready" timer fires)
//
// Each scheduled timeout is tracked so cancelReloadSequence() can clear them
// (player death, weapon switch, reset).

let activeReloadTimers = [];

function cancelReloadSequence() {
  for (let i = 0; i < activeReloadTimers.length; i++) clearTimeout(activeReloadTimers[i]);
  activeReloadTimers = [];
}

// Public: called by resetWeapons / switchWeapon / killPlayer to clear any
// in-flight reload audio when state resets.
export function stopAllReloadAudio() {
  cancelReloadSequence();
}

// Public: tryReload (in weapons.js) calls this with the weapon key and the
// reload duration in seconds.
export function sfxReloadStart(weaponKey, reloadTimeSec) {
  cancelReloadSequence();

  const ms = reloadTimeSec * 1000;
  const at = (frac, fn) => activeReloadTimers.push(setTimeout(fn, Math.max(0, ms * frac)));

  if (weaponKey === 'pistol') {
    if (samples.pistol_clipout) {
      at(0.00, () => playSample('pistol_clipout', 0));
      at(0.55, () => playSample('pistol_clipin',  0));
    } else {
      // Synth fallback: two-step click.
      at(0.00, () => playTone({ freq: 1200, type: 'square', duration: 0.05, gain: 0.14 }));
      at(0.55, () => playTone({ freq:  850, type: 'square', duration: 0.06, gain: 0.14 }));
    }
  } else if (weaponKey === 'smg') {
    if (samples.smg_clipout) {
      at(0.00, () => playSample('smg_clipout',  0));
      at(0.40, () => playSample('smg_clipin',   0));
      at(0.78, () => playSample('smg_boltpull', 0));
    } else {
      at(0.00, () => playTone({ freq: 1300, type: 'square', duration: 0.05, gain: 0.13 }));
      at(0.40, () => playTone({ freq:  900, type: 'square', duration: 0.06, gain: 0.13 }));
      at(0.78, () => playTone({ freq:  600, type: 'square', duration: 0.07, gain: 0.13 }));
    }
  } else if (weaponKey === 'saw') {
    // Heavy belt-box swap: box out, then box in partway through the long
    // 4 s reload. Uses the uploaded m249 box samples.
    if (samples.saw_clipout) {
      at(0.00, () => playSample('saw_clipout', 0));
      at(0.55, () => playSample('saw_clipin',  0));
    } else {
      at(0.00, () => playTone({ freq: 520, type: 'square', duration: 0.08, gain: 0.13 }));
      at(0.55, () => playTone({ freq: 360, type: 'square', duration: 0.10, gain: 0.13 }));
    }
  } else if (weaponKey === 'sniper') {
    if (samples.sniper_clipout) {
      at(0.00, () => playSample('sniper_clipout', 0));
      at(0.55, () => playSample('sniper_clipin',  0));
    } else {
      at(0.00, () => playTone({ freq: 1100, type: 'square', duration: 0.07, gain: 0.14 }));
      at(0.55, () => playTone({ freq:  700, type: 'square', duration: 0.08, gain: 0.14 }));
    }
  } else if (weaponKey === 'shotgun') {
    // No shotgun sample uploaded. Synth a per-shell rack: short clicks every
    // ~0.25s for the duration of the reload. magSize=6 so 6 racks.
    const shells = 6;
    for (let i = 0; i < shells; i++) {
      at(i / shells * 0.95, () => {
        playTone({ freq: 220, type: 'square', duration: 0.04, gain: 0.10 });
        playNoise({ duration: 0.05, gain: 0.06, lowpass: 1200, highpass: 200 });
      });
    }
  } else {
    // Unknown weapon: generic two-step click.
    at(0.00, () => playTone({ freq: 1200, type: 'square', duration: 0.05, gain: 0.14 }));
    at(0.55, () => playTone({ freq:  850, type: 'square', duration: 0.06, gain: 0.14 }));
  }
}

// --- WEAPON DEPLOY ---
// Called when switching TO a weapon. Only sniper has a deploy sample; others
// fall through silently (no sound on switch) so the switch feels snappy
// rather than chattery.
export function sfxWeaponDeploy(weaponKey) {
  if (weaponKey === 'sniper') {
    playSample('sniper_deploy', 0);
  }
  // Other weapons: silent on switch by design.
}

// --- NON-WEAPON CUES (synth) ---
// Hit / death / wave / state-change. These don't have samples; the synth is
// improved over m9/m10 but still purely procedural.
export function sfxEmptyClick() {
  playTone({ freq: 360, type: 'square', duration: 0.045, gain: 0.10 });
  playTone({ freq: 180, type: 'square', duration: 0.035, gain: 0.08 });
}
export function sfxEnemyHit() {
  // Quick wet thump: low triangle + tiny noise burst.
  playTone({ freq: 260, type: 'triangle', duration: 0.08, gain: 0.18, freqEnd: 130 });
  playNoise({ duration: 0.04, gain: 0.06, lowpass: 1800, highpass: 400 });
}
export function sfxHeadshot() {
  // Two-tone metallic chime, higher and longer than a body hit.
  playTone({ freq: 1600, type: 'triangle', duration: 0.10, gain: 0.22 });
  setTimeout(() => playTone({ freq: 2400, type: 'triangle', duration: 0.14, gain: 0.18 }), 60);
}
export function sfxEnemyDeath() {
  // Falling sawtooth body + filtered noise tail (the "thud" of dropping).
  playTone({ freq: 320, type: 'sawtooth', duration: 0.28, gain: 0.22, freqEnd: 55 });
  playNoise({ duration: 0.12, gain: 0.10, lowpass: 900 });
}
export function sfxPlayerHurt() {
  // Sharp pained downward sawtooth + low body thump.
  playTone({ freq: 200, type: 'sawtooth', duration: 0.18, gain: 0.28, freqEnd: 70 });
  playTone({ freq: 90,  type: 'sine',     duration: 0.20, gain: 0.18, freqEnd: 40 });
}
export function sfxScopeOn() {
  // Lens-tighten cue: descending high sine.
  playTone({ freq: 1800, type: 'sine', duration: 0.06, gain: 0.10, freqEnd: 1200 });
}
export function sfxScopeOff() {
  // Lens-release: ascending high sine (reverse of scope-on).
  playTone({ freq: 1200, type: 'sine', duration: 0.06, gain: 0.10, freqEnd: 1800 });
}
export function sfxWaveStart() {
  // Two-note alert.
  playTone({ freq: 600, type: 'square', duration: 0.10, gain: 0.16 });
  setTimeout(() => playTone({ freq: 900, type: 'square', duration: 0.16, gain: 0.16 }), 110);
}
export function sfxWaveClear() {
  // Major-arpeggio C5-E5-G5.
  playTone({ freq: 523, type: 'triangle', duration: 0.14, gain: 0.18 });
  setTimeout(() => playTone({ freq: 659, type: 'triangle', duration: 0.14, gain: 0.18 }), 140);
  setTimeout(() => playTone({ freq: 784, type: 'triangle', duration: 0.24, gain: 0.18 }), 280);
}
export function sfxVictory() {
  // C5-E5-G5-C6 sustain.
  playTone({ freq: 523,  type: 'triangle', duration: 0.16, gain: 0.20 });
  setTimeout(() => playTone({ freq: 659,  type: 'triangle', duration: 0.16, gain: 0.20 }), 150);
  setTimeout(() => playTone({ freq: 784,  type: 'triangle', duration: 0.16, gain: 0.20 }), 300);
  setTimeout(() => playTone({ freq: 1047, type: 'triangle', duration: 0.45, gain: 0.22 }), 450);
}
export function sfxGameOver() {
  // Two descending sawtooth slides.
  playTone({ freq: 220, type: 'sawtooth', duration: 0.35, gain: 0.20, freqEnd: 90 });
  setTimeout(() => playTone({ freq: 110, type: 'sawtooth', duration: 0.6, gain: 0.22, freqEnd: 45 }), 250);
}
export function sfxWeaponUnlock() {
  // Bright chime — same shape across all three unlocks (shotgun/SMG/sniper).
  playTone({ freq: 880,  type: 'triangle', duration: 0.10, gain: 0.18 });
  setTimeout(() => playTone({ freq: 1320, type: 'triangle', duration: 0.20, gain: 0.20 }), 100);
}
