// Verifies APERTURE WALLS from the real wallBoxes() decomposition built into
// real collision.js: a DOORWAY is walk-through (body passes, no solid in the
// opening at foot height), a WINDOW blocks the body at foot height (sill) but
// its mid band is clear (see/shoot through — no solid there).
import { wallBoxes } from '../src/maplayout.js';
import { makeBoxSolid, collideCapsule, solids } from '../src/collision.js';
const R = 0.4, BODY = 1.7;
// point-in-any-solid (proxy for "would a straight bullet be blocked here")
function blocked(x, y, z) {
  for (const s of solids) {
    if (s.kind === 'ramp') continue;
    if (x > s.minX && x < s.maxX && y > s.minY && y < s.maxY && z > s.minZ && z < s.maxZ) return true;
  }
  return false;
}
function build(e) { for (const r of wallBoxes(e)) makeBoxSolid(r.x0, r.x1, r.y0, r.y1, r.z0, r.z1); }

// floor so the capsule has ground
makeBoxSolid(-50, 50, -2, 0, -50, 50);
// DOORWAY: x-axis wall at z=0, opening centred, 2.4 wide, 2.6 tall, H=4
build({ t: 'wall', axis: 'x', cx: 0, cz: 0, length: 12, height: 4, thick: 0.6,
        door: { width: 2.4, height: 2.6 } });
// WINDOW: x-axis wall at z=20, 2.6 wide, sill 1.1, band 1.1..2.4, H=4
build({ t: 'wall', axis: 'x', cx: 0, cz: 20, length: 12, height: 4, thick: 0.6,
        window: { width: 2.6, height: 1.3, sill: 1.1 } });

let pass = 0, total = 0;
const ok = (n, c, d) => { total++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}  ${d || ''}`); if (c) pass++; };
const f = v => Number(v).toFixed(4);

// 1. Doorway: a capsule pushed through the opening is NOT displaced.
{ const before = { x: 0, z: 0 };
  // start just south, "walk" to just north through the gap; sample at z=0
  const r = collideCapsule(0, 0, 0, R, BODY);
  ok('doorway opening is clear — body passes (no horizontal push)',
     Math.hypot(r.x - before.x, r.z - before.z) < 0.02, `x=${f(r.x)} z=${f(r.z)}`);
  ok('doorway: no solid in the opening at foot height (y=0.3)',
     !blocked(0, 0.3, 0), 'centre of doorway');
  ok('doorway jamb beside the opening IS solid (x=4,y=0.3)',
     blocked(4, 0.3, 0), 'wall still there beside the gap'); }

// 2. Window: body blocked at foot height (sill), but band is clear.
{ const r = collideCapsule(0, 0, 20, R, BODY);
  ok('window sill BLOCKS the body at foot height (pushed out)',
     Math.hypot(r.x - 0, r.z - 20) > 0.05, `pushed to x=${f(r.x)} z=${f(r.z)} (dist ${f(Math.hypot(r.x,r.z-20))})`);
  ok('window sill is solid at foot height (y=0.5)',
     blocked(0, 0.5, 20), 'sill present');
  ok('window MID BAND is clear — see/shoot through (y=1.7)',
     !blocked(0, 1.7, 20), 'eye/aim height open');
  ok('window lintel above the band IS solid (y=3.0)',
     blocked(0, 3.0, 20), 'lintel present');
  ok('window jamb beside the band IS solid (x=4,y=1.7)',
     blocked(4, 1.7, 20), 'wall beside the window'); }

console.log(`\n================  ${pass}/${total} PASS  ================`);
if (pass !== total) process.exit(1);
