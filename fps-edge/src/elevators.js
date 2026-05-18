// elevators.js — animated platform lifts (`func_plat` from Quake .map).
//
// Imported as LAYOUT entries of the form:
//   { t: 'elevator', cx, cz, sx, sy, sz, bottomY, topY, speed, wait, startsAtTop }
// The arena builder calls registerElevator(e) for each entry. We build:
//   * a kinematic SOLID box (its minY/maxY mutate each frame as the platform
//     moves) so the player's capsule + groundHeightAt see the moving plate
//   * a matching THREE.Mesh that the renderer follows
//
// Behaviour (matches Quake func_plat closely):
//   * Plate rests at `topY` (Quake convention: brush IS the top position)
//     until activated.
//   * Activation: player capsule overlaps the plate's XZ footprint AND is
//     vertically near the plate (within a generous proximity band — so
//     stepping onto the plate from the side at the bottom triggers it).
//   * State machine: at_top → falling → at_bottom → rising → at_top.
//   * `wait` seconds at each end before reversing if the trigger condition
//     is met / cleared.

import * as THREE from 'three';
import { solids } from './collision.js';
import { scene } from './scene.js';
import { player } from './state.js';
import { PLAYER_RADIUS } from './constants.js';

const elevators = [];

const PLATE_MAT = new THREE.MeshStandardMaterial({
  color: 0x9aa0a8, metalness: 0.45, roughness: 0.55,
});

function makeMovableSolid(minX, maxX, minY, maxY, minZ, maxZ) {
  // Mirror of collision.makeBoxSolid but the planes list keeps a reference
  // to the y-bounds via a back-pointer; setSolidY() updates them in place.
  const s = {
    kind: 'box',
    planes: [
      { nx: -1, ny: 0, nz: 0, d: minX },
      { nx:  1, ny: 0, nz: 0, d: -maxX },
      { nx: 0, ny: -1, nz: 0, d: minY },   // 2: minY
      { nx: 0, ny:  1, nz: 0, d: -maxY },  // 3: -maxY
      { nx: 0, ny: 0, nz: -1, d: minZ },
      { nx: 0, ny: 0, nz:  1, d: -maxZ },
    ],
    minX, maxX, minY, maxY, minZ, maxZ,
    walkable: true,
    topY: maxY,
    kinematic: true,
  };
  solids.push(s);
  return s;
}

function setSolidY(s, plateBottomY, plateTopY) {
  s.minY = plateBottomY;
  s.maxY = plateTopY;
  s.topY = plateTopY;
  s.planes[2].d = plateBottomY;
  s.planes[3].d = -plateTopY;
}

export function registerElevator(e) {
  // Plate at TOP (rest) position. We attach the collision body + mesh and
  // start the state machine "at_top".
  const x0 = e.cx - e.sx / 2;
  const x1 = e.cx + e.sx / 2;
  const z0 = e.cz - e.sz / 2;
  const z1 = e.cz + e.sz / 2;
  const plateBottomY = e.topY;            // plate bottom face = plate-top − thickness
  const plateTopY    = e.topY + e.sy;     // plate top face = walkable surface (above topY)

  // collision body
  const solid = makeMovableSolid(x0, x1, plateBottomY, plateTopY, z0, z1);

  // visual mesh (centred on the plate volume)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(e.sx, e.sy, e.sz), PLATE_MAT);
  mesh.position.set(e.cx, (plateBottomY + plateTopY) / 2, e.cz);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);

  elevators.push({
    cx: e.cx, cz: e.cz,
    sx: e.sx, sy: e.sy, sz: e.sz,
    bottomY: e.bottomY,                   // walkable surface when down
    topY:    e.topY,                      // walkable surface when up
    speed:   e.speed,
    wait:    e.wait || 1.0,
    state:   'at_top',
    plateY:  e.topY,                      // current walkable surface y
    waitT:   0,
    solid,
    mesh,
  });
}

// `playerOnPlate` = player is standing on top of the moving plate.
// `playerCalling` = player is in the plate's XZ footprint but NEAR or BELOW
// the bottom rest position — the cue for a plate at top to come down and
// pick them up (matches Quake func_plat behaviour where the trigger field
// sits at the bottom). Both tests use a generous PLAYER_RADIUS halo so the
// player approaching the plate from beside it still activates it.
function playerInPlateXZ(lift) {
  const px = player.position.x, pz = player.position.z;
  return px > lift.cx - lift.sx / 2 - PLAYER_RADIUS &&
         px < lift.cx + lift.sx / 2 + PLAYER_RADIUS &&
         pz > lift.cz - lift.sz / 2 - PLAYER_RADIUS &&
         pz < lift.cz + lift.sz / 2 + PLAYER_RADIUS;
}

function playerOnPlate(lift) {
  if (!playerInPlateXZ(lift)) return false;
  return Math.abs(player.position.y - lift.plateY) < 1.0;
}

function playerCalling(lift) {
  // "Calling" = within XZ footprint AND below the plate (within a generous
  // band around the plate's bottomY rest level so approaching from the
  // adjacent floor also counts).
  if (!playerInPlateXZ(lift)) return false;
  return player.position.y < lift.bottomY + 2.0;
}

function applyPlateY(lift, newY) {
  lift.plateY = newY;
  const plateBottomY = newY;
  const plateTopY = newY + lift.sy;
  setSolidY(lift.solid, plateBottomY, plateTopY);
  lift.mesh.position.y = (plateBottomY + plateTopY) / 2;
}

export function updateElevators(dt) {
  for (const lift of elevators) {
    const on = playerOnPlate(lift);
    const calling = playerCalling(lift);
    switch (lift.state) {
      case 'at_top':
        // Stay at top while player is riding. If the player is below in the
        // shaft (calling), drop the plate to pick them up.
        if (on) { lift.waitT = lift.wait; }
        else if (calling) { lift.state = 'falling'; }
        break;
      case 'falling': {
        const step = lift.speed * dt;
        const newY = Math.max(lift.bottomY, lift.plateY - step);
        applyPlateY(lift, newY);
        if (newY <= lift.bottomY + 1e-3) {
          lift.state = 'at_bottom';
          lift.waitT = lift.wait;
        }
        // If the player steps onto the plate mid-fall, reverse immediately.
        if (on) lift.state = 'rising';
        break;
      }
      case 'at_bottom':
        // Wait briefly at bottom; if player is on, rise.
        if (on) {
          lift.state = 'rising';
        } else {
          lift.waitT -= dt;
          if (lift.waitT <= 0 && !calling) lift.state = 'rising';
          // (Quake plats return to top after `wait` seconds when nobody is
          // around. The classic "called → rise → wait at top → drop" loop.)
        }
        break;
      case 'rising': {
        const step = lift.speed * dt;
        const newY = Math.min(lift.topY, lift.plateY + step);
        applyPlateY(lift, newY);
        if (newY >= lift.topY - 1e-3) {
          lift.state = 'at_top';
          lift.waitT = lift.wait;
        }
        break;
      }
    }
  }
}

export function clearElevators() {
  for (const lift of elevators) {
    scene.remove(lift.mesh);
    lift.mesh.geometry.dispose();
    const idx = solids.indexOf(lift.solid);
    if (idx >= 0) solids.splice(idx, 1);
  }
  elevators.length = 0;
}

// Exposed for the validator BFS — it treats each elevator as a directed
// edge between (cx, cz, bottomY) and (cx, cz, topY).
export function getElevatorEdges() {
  return elevators.map(l => ({
    cx: l.cx, cz: l.cz, sx: l.sx, sz: l.sz,
    bottomY: l.bottomY, topY: l.topY,
  }));
}
