// arena.js — executes the data-driven map (src/maplayout.js) through the
// verified kit. The layout is the single source of truth; this file only
// dispatches each entry to the matching kit constructor and tracks platform
// handles by id so connectors can reference their target by name.

import {
  ground, platform, connectRamp, connectStairs, box, wall, overhang, perimeter, solidBox,
  portal, jumppad, banner,
} from './kit.js';
import { makeTorch, makeBrazier } from './torches.js';
import { LAYOUT, wallBoxes } from './maplayout.js';

const H = {};   // id -> kit handle (platform/box/connector foot)

for (const e of LAYOUT) {
  switch (e.t) {
    case 'ground':
      ground(e.half, e.y);
      break;
    case 'perimeter':
      perimeter(e.half, e.height, e.thick);
      break;
    case 'platform': {
      const h = platform({ cx: e.cx, cz: e.cz, top: e.top, sx: e.sx, sz: e.sz, thick: e.thick, mat: e.mat });
      if (e.id) H[e.id] = h;
      break;
    }
    case 'box': {
      const h = box({ cx: e.cx, cz: e.cz, base: e.base, sx: e.sx, sy: e.sy, sz: e.sz, mat: e.mat });
      if (e.id) H[e.id] = h;
      break;
    }
    case 'wall':
      for (const r of wallBoxes(e)) solidBox(r, 'wall', e.mat);
      break;
    case 'rampTo': {
      const target = H[e.to];
      const foot = connectRamp(target, { side: e.side, run: e.run, width: e.width, fromY: e.fromY, thick: e.thick });
      if (e.id) H[e.id] = foot;
      break;
    }
    case 'stairsTo': {
      const target = H[e.to];
      const foot = connectStairs(target, { side: e.side, run: e.run, width: e.width, fromY: e.fromY, steps: e.steps, thick: e.thick });
      if (e.id) H[e.id] = foot;
      break;
    }
    case 'overhang':
      overhang({ axis: e.axis, loPos: e.loPos, hiPos: e.hiPos, loY: e.loY, hiY: e.hiY, c0: e.c0, c1: e.c1, thick: e.thick });
      break;
    case 'teleporter':
      portal({ id: e.id, from: e.from, to: e.to });
      break;
    case 'torch':
      makeTorch(e.x, e.y || 0, e.z, e.opts);
      break;
    case 'jumppad':
      jumppad({ id: e.id, cx: e.cx, cz: e.cz, sx: e.sx, sz: e.sz, launchVy: e.launchVy });
      break;
    case 'banner':
      banner({ x: e.x, y: e.y || 0, z: e.z, face: e.face, tone: e.tone, w: e.w, h: e.h });
      break;
    case 'brazier':
      makeBrazier(e.x, e.y || 0, e.z, e.opts);
      break;
    default:
      console.warn('arena: unknown layout entry', e.t);
  }
}
