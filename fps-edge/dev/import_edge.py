#!/usr/bin/env python3
"""Quake .map → engine LAYOUT importer (v2).

v2 over v1 (single-AABB-per-brush): classifies brushes by their TOP face
orientation and converts slope brushes into stair-step stacks so sloped
floors stay walkable. Also extracts teleporter trigger volumes as a new
LAYOUT entry type, and drops sub-volume decorative trim brushes.

Pipeline:
  parse_map      → list of entities (each with kv + brushes)
  parse_brush    → list of (normal, d) half-spaces + face texture names
  classify       → 'box' | 'slope' | 'sky' | 'water' | 'special' | 'trim'
  brush_aabb     → axis-aligned bound via plane-triple vertex enumeration
  slope_to_steps → for slope brushes, emit N step-box entries
  q2engine       → Quake (x east, y north, z up) → engine (x east, y up, z south)
  emit           → write src/maplayout.js

Output LAYOUT entries:
  { t: 'ground', ... }       — engine perimeter floor
  { t: 'perimeter', ... }    — engine perimeter walls
  { t: 'box', cx, cz, base, sx, sy, sz, kind } — every walkable / blocking solid
  { t: 'teleporter', x0..z1, dx, dy, dz }      — NEW: trigger volume + dest

PICKUPS + SPAWN + SPAWN_ANCHORS extracted from point entities.
"""

import math
import os
import re
import sys
from collections import defaultdict

import numpy as np

SRC = os.path.join(os.path.dirname(__file__), 'source', 'q2dm1q1restoration.map')
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'maplayout.js')

# Quake 1 unit ≈ 3 cm; player is 56 u tall ≈ 1.7 m → 32 u/m.
S = 1.0 / 32.0

# Trim brushes below this volume are dropped (m³). Many Quake brushes are
# 2-unit thick decorative chamfers / lighting trim that bloat the box list.
MIN_BRUSH_VOLUME = 0.008

# Per-step rise for slope→stairs conversion (m). Engine step-up limit is
# 0.6 m so anything ≤ 0.4 walks smoothly.
SLOPE_STEP_RISE = 0.35

# Top-face dot product (with world UP) classifications:
#  ≥ 0.98 → flat top (axis-aligned floor/ceiling/deck) → emit as box
#  0.40 - 0.98 → sloped top (walkable ramp) → emit as stairs
#  < 0.40 → no walkable top (wall/cap) → emit as box
SLOPE_TOP_MIN = 0.40
SLOPE_TOP_MAX = 0.98

# Textures that mark a brush as non-renderable / non-solid.
SKIP_TEX_PREFIXES = ('sky', 'trigger', 'clip', '*', 'origin')
WATER_TEX_PREFIXES = ('*04', '*water', '*slime')


# ───────────────────────── parse ─────────────────────────

def parse_map(path):
    text = open(path, encoding='utf-8', errors='replace').read()
    lines = text.split('\n')
    entities, i, n = [], 0, len(lines)
    while i < n:
        if lines[i].strip() == '{':
            ent = {'kv': {}, 'brushes': []}
            i += 1
            while i < n and lines[i].strip() != '}':
                s = lines[i].strip()
                if s == '{':
                    bp = []
                    i += 1
                    while i < n and lines[i].strip() != '}':
                        bl = lines[i].strip()
                        if bl and not bl.startswith('//'): bp.append(bl)
                        i += 1
                    ent['brushes'].append(bp)
                else:
                    m = re.match(r'"([^"]+)"\s+"([^"]*)"', s)
                    if m: ent['kv'][m.group(1)] = m.group(2)
                i += 1
            entities.append(ent)
        i += 1
    return entities


PLANE_RE = re.compile(
    r'\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)\s+'
    r'\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)\s+'
    r'\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)\s+'
    r'(\S+)'
)


def parse_brush(plane_lines):
    planes, texs = [], []
    for line in plane_lines:
        m = PLANE_RE.match(line)
        if not m: continue
        c = [float(m.group(k+1)) for k in range(9)]
        p1, p2, p3 = np.array(c[0:3]), np.array(c[3:6]), np.array(c[6:9])
        # Quake .map: brush interior satisfies n·p + d ≤ 0, with the normal
        # pointing OUT of the brush. The plane's points are wound so that
        # cross(p3-p1, p2-p1) gives the outward normal.
        nrm = np.cross(p3 - p1, p2 - p1)
        ln = np.linalg.norm(nrm)
        if ln < 1e-4: continue
        nrm = nrm / ln
        d = -float(np.dot(nrm, p1))
        planes.append((nrm, d))
        texs.append(m.group(10))
    if len(planes) < 4: return None, None
    return planes, texs


def brush_aabb(planes):
    """AABB of the convex polyhedron n·p + d ≤ 0."""
    n = len(planes)
    verts = []
    EPS = 1e-3
    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                A = np.array([planes[i][0], planes[j][0], planes[k][0]])
                if abs(np.linalg.det(A)) < 1e-4: continue
                b = -np.array([planes[i][1], planes[j][1], planes[k][1]])
                try:
                    p = np.linalg.solve(A, b)
                except np.linalg.LinAlgError:
                    continue
                ok = True
                for m in range(n):
                    if m in (i, j, k): continue
                    if np.dot(planes[m][0], p) + planes[m][1] > EPS:
                        ok = False; break
                if ok: verts.append(p)
    if not verts: return None, None
    V = np.array(verts)
    return V, (V.min(axis=0), V.max(axis=0))


# ───────────────────────── classify ─────────────────────────

# Texture-name → engine MAT bucket. The kit's MAT entries are 'qmetal'
# (rust panel), 'qstone' (sandstone blocks), 'qfloor' (grimy concrete).
def classify_material(tex_names):
    floors = sum(1 for t in tex_names if 'floor' in t)
    metals = sum(1 for t in tex_names
                 if any(s in t for s in ('metal', 'cop', 'plat_top', 'lgmetal',
                                          'mmetal', 'nmetal', 'lead', 'met5',
                                          'tech', 'comp')))
    stones = sum(1 for t in tex_names
                 if any(s in t for s in ('blum', 'blume', 'rock', 'wbrick',
                                          'wizmet', 'green3', 'stone', 'brick')))
    # Tie-breaker order: floor wins (it's the deck the player stands on),
    # then stone (warm sandstone), then metal (default for Edge's industrial
    # interior).
    if floors >= max(metals, stones) and floors > 0: return 'qfloor'
    if stones >  metals: return 'qstone'
    return 'qmetal'


def find_top_face(planes):
    """Return (normal, d) of the face with the highest dot-with-UP."""
    best, best_dot = None, -2
    for n, d in planes:
        if n[2] > best_dot:
            best_dot, best = n[2], (n, d)
    return best, best_dot


def top_y_at(top, qx, qy):
    n, d = top
    if abs(n[2]) < 1e-4: return None
    return -(d + n[0] * qx + n[1] * qy) / n[2]


def slope_to_steps(planes, qmin, qmax, top):
    """Generate stair-step boxes that approximate a sloped top face.

    Returns a list of (qx0, qy0, qz0, qx1, qy1, qz1) tuples in Quake coords
    or None if the brush is too small / too steep / not really sloped.
    """
    n, d = top
    # Slope direction: horizontal projection of -n (downhill direction).
    nx, ny = n[0], n[1]
    horiz = math.hypot(nx, ny)
    if horiz < 0.05: return None  # too close to flat

    # Choose dominant horizontal axis.
    axis = 'x' if abs(nx) >= abs(ny) else 'y'

    qx0, qy0, qz_bot = qmin
    qx1, qy1, qz_top_box = qmax  # qmax z is the brush top BOUND (not slope top)

    # Sample top Y at the four corners of the brush footprint.
    z_x0y0 = top_y_at(top, qx0, qy0)
    z_x1y0 = top_y_at(top, qx1, qy0)
    z_x0y1 = top_y_at(top, qx0, qy1)
    z_x1y1 = top_y_at(top, qx1, qy1)
    if None in (z_x0y0, z_x1y0, z_x0y1, z_x1y1): return None

    if axis == 'x':
        # Slope runs along X. Mid-Y top heights:
        zLo = (z_x0y0 + z_x0y1) / 2
        zHi = (z_x1y0 + z_x1y1) / 2
    else:
        zLo = (z_x0y0 + z_x1y0) / 2
        zHi = (z_x0y1 + z_x1y1) / 2

    # Clip top heights to brush bound (don't go above the AABB top).
    zLo = min(zLo, qz_top_box); zHi = min(zHi, qz_top_box)
    rise = abs(zHi - zLo)
    if rise < 0.2 / S: return None  # negligible slope at engine scale

    # Steps in Quake units.
    step_rise_q = SLOPE_STEP_RISE / S  # m → quake units
    n_steps = max(2, int(math.ceil(rise / step_rise_q)))
    n_steps = min(n_steps, 16)  # cap so we don't explode the box count

    boxes = []
    increasing = zHi > zLo
    for i in range(n_steps):
        t0 = i / n_steps
        t1 = (i + 1) / n_steps
        # Step top at the MIDPOINT of the strip (gives smoother walking).
        tm = (t0 + t1) / 2
        if increasing:
            stepTop = zLo + (zHi - zLo) * tm
        else:
            stepTop = zLo + (zHi - zLo) * tm

        if axis == 'x':
            sx0 = qx0 + t0 * (qx1 - qx0)
            sx1 = qx0 + t1 * (qx1 - qx0)
            boxes.append((sx0, qy0, qz_bot, sx1, qy1, stepTop))
        else:
            sy0 = qy0 + t0 * (qy1 - qy0)
            sy1 = qy0 + t1 * (qy1 - qy0)
            boxes.append((qx0, sy0, qz_bot, qx1, sy1, stepTop))
    return boxes


# ───────────────────────── coord transform ─────────────────────────

def q2engine_box(qmin, qmax):
    return (qmin[0] * S, qmin[2] * S, -qmax[1] * S,
            qmax[0] * S, qmax[2] * S, -qmin[1] * S)


def q2engine_pt(qx, qy, qz):
    return (qx * S, qz * S, -qy * S)


# ───────────────────────── main ─────────────────────────

def main():
    ents = parse_map(SRC)
    world = ents[0]
    assert world['kv'].get('classname') == 'worldspawn'

    # World + func_wall brushes are solid static geometry.
    static_brushes = list(world['brushes'])
    for e in ents[1:]:
        if e['kv'].get('classname') == 'func_wall':
            static_brushes.extend(e['brushes'])

    # Pre-extract pickup Quake positions — used by the redundant-overlap
    # prune to keep any brush whose top serves as a pickup landing surface.
    pickup_q_pts = []
    for e in ents:
        cn = e['kv'].get('classname', '')
        if cn in ('info_player_deathmatch', 'info_player_start',
                  'item_health', 'weapon_supershotgun', 'weapon_nailgun',
                  'weapon_supernailgun', 'weapon_lightning'):
            o = e['kv'].get('origin')
            if not o: continue
            try:
                qx, qy, qz = [float(v) for v in o.split()]
            except ValueError: continue
            pickup_q_pts.append((qx, qy, qz))

    def supports_pickup(qmin, qmax):
        """True if any pickup XZ falls inside this brush's footprint AND
        the pickup's Quake Z is within ~1 m of the brush's top — i.e. the
        brush is serving as a pickup landing surface."""
        for (qx, qy, qz) in pickup_q_pts:
            if (qmin[0] - 2 <= qx <= qmax[0] + 2 and
                qmin[1] - 2 <= qy <= qmax[1] + 2 and
                abs(qz - qmax[2]) <= 32):
                return True
        return False

    # First pass: parse + categorise all static brushes.
    boxes = []
    water_brushes = []   # NEW: water surfaces (rendered as translucent volumes)
    skipped = defaultdict(int)
    for brush in static_brushes:
        planes, texs = parse_brush(brush)
        if planes is None:
            skipped['parse_fail'] += 1; continue
        # Order matters: check water FIRST since water texture names begin
        # with '*' which is also in SKIP_TEX_PREFIXES (Quake conventions
        # prefix special-purpose textures with '*').
        is_water = any(any(t.startswith(p) for p in WATER_TEX_PREFIXES) for t in texs)
        if any(any(t.startswith(p) for p in SKIP_TEX_PREFIXES) for t in texs) and not is_water:
            skipped['sky_or_special'] += 1; continue
        if is_water:
            V, bb = brush_aabb(planes)
            if bb is None:
                skipped['water_no_verts'] += 1; continue
            qmin, qmax = bb
            vol = ((qmax[0] - qmin[0]) * (qmax[1] - qmin[1]) * (qmax[2] - qmin[2])) * (S ** 3)
            if vol < MIN_BRUSH_VOLUME:
                skipped['water_too_small'] += 1; continue
            water_brushes.append({
                'q': (qmin[0], qmin[1], qmin[2], qmax[0], qmax[1], qmax[2]),
            })
            skipped['water'] += 1
            continue
        V, bb = brush_aabb(planes)
        if bb is None:
            skipped['no_verts'] += 1; continue
        qmin, qmax = bb
        # Volume gate (in Quake units, converted to m³).
        vol = ((qmax[0] - qmin[0]) * (qmax[1] - qmin[1]) * (qmax[2] - qmin[2])) * (S ** 3)
        if vol < MIN_BRUSH_VOLUME:
            skipped['too_small'] += 1; continue

        # Classify by top-face orientation.
        top, top_dot = find_top_face(planes)
        if top is None:
            skipped['no_top'] += 1; continue

        mat = classify_material(texs)

        if SLOPE_TOP_MIN < top_dot < SLOPE_TOP_MAX:
            # Sloped walkable top → stair-step approximation; the steps
            # inherit the parent brush's material.
            steps = slope_to_steps(planes, qmin, qmax, top)
            if steps:
                for s in steps:
                    boxes.append({'q': s, 'kind': 'slope', 'mat': mat})
                skipped['slope_to_steps'] += 1
                continue
        # Default: emit as single AABB.
        boxes.append({
            'q': (qmin[0], qmin[1], qmin[2], qmax[0], qmax[1], qmax[2]),
            'kind': 'box',
            'mat': mat,
        })

    # ── prune redundant overlapping AABBs of the same material ──
    # AABB-from-Quake conversion inflates diagonal brushes; piles of these
    # in one region end up mutually overlapping. Same-material overlaps
    # produce visible z-fight at the interior surfaces (the user-reported
    # "clipping"). For each pair (larger, smaller) of the same material
    # where ≥70 % of the smaller brush's volume sits inside the larger,
    # the smaller adds nothing visible (its surface is mostly behind the
    # larger's faces) → drop it. Pickup-bearing brushes are still
    # protected via supports_pickup.
    n_before = len(boxes)
    def box_vol(q):
        return (q[3] - q[0]) * (q[4] - q[1]) * (q[5] - q[2])
    sorted_idx = sorted(range(len(boxes)), key=lambda k: -box_vol(boxes[k]['q']))
    keep_mask = [True] * len(boxes)
    for ki in range(len(sorted_idx)):
        i = sorted_idx[ki]
        if not keep_mask[i]: continue
        ai = boxes[i]
        amat = ai.get('mat')
        ax0, ay0, az0, ax1, ay1, az1 = ai['q']
        for kj in range(ki + 1, len(sorted_idx)):
            j = sorted_idx[kj]
            if not keep_mask[j]: continue
            bj = boxes[j]
            if bj.get('mat') != amat: continue
            bx0, by0, bz0, bx1, by1, bz1 = bj['q']
            # Pickup protection — keep brushes serving as pickup floors
            # regardless of overlap.
            if supports_pickup((bx0, by0, bz0), (bx1, by1, bz1)):
                continue
            # Compute overlap volume between A (larger) and B (smaller).
            ox = min(ax1, bx1) - max(ax0, bx0)
            oy = min(ay1, by1) - max(ay0, by0)
            oz = min(az1, bz1) - max(az0, bz0)
            if ox <= 0 or oy <= 0 or oz <= 0: continue
            ov = ox * oy * oz
            bv = box_vol(bj['q'])
            if bv > 0 and ov / bv >= 0.55:
                keep_mask[j] = False
    boxes = [boxes[k] for k in range(len(boxes)) if keep_mask[k]]
    skipped['redundant_overlap'] = n_before - len(boxes)

    # ── func_plat (elevator) extraction ──
    # Each func_plat has 1+ brushes; the PLATE is the largest-XZ-area brush
    # (typically thin in Y). 'height' keyvalue is the travel distance in
    # Quake units (default = overall brush AABB Z extent − 8). spawnflags
    # bit 1 = PLAT_LOW_TRIGGER: starts at bottom (brush represents bottom);
    # otherwise starts at top (brush represents top).
    elevators = []
    for e in ents:
        if e['kv'].get('classname') != 'func_plat':
            continue
        plate_bb = None
        plate_area = 0
        overall = None
        for brush in e['brushes']:
            planes, _texs = parse_brush(brush)
            if planes is None: continue
            _V, bb = brush_aabb(planes)
            if bb is None: continue
            qmn, qmx = bb
            area = (qmx[0] - qmn[0]) * (qmx[1] - qmn[1])  # XY in Quake = XZ in engine
            if area > plate_area:
                plate_area = area; plate_bb = (qmn.copy(), qmx.copy())
            if overall is None:
                overall = [qmn.copy(), qmx.copy()]
            else:
                for k in range(3):
                    overall[0][k] = min(overall[0][k], qmn[k])
                    overall[1][k] = max(overall[1][k], qmx[k])
        if plate_bb is None: continue
        pmn, pmx = plate_bb
        # Travel = explicit 'height' or overall Z extent − 8 (Quake default).
        height_kv = e['kv'].get('height')
        if height_kv is not None:
            travel = float(height_kv)
        else:
            travel = (overall[1][2] - overall[0][2]) - 8
        # Quake .map convention: the brush ALWAYS represents the top (raised)
        # position regardless of spawnflags. spawnflags bit 1 = PLAT_LOW_TRIGGER
        # only changes WHERE the trigger field sits (low vs the area below the
        # plate); the plat itself rests at top and lowers when un-triggered.
        speed = float(e['kv'].get('speed', '150'))
        wait_t = float(e['kv'].get('wait', '3'))
        plate_top_z = pmx[2]
        top_z = plate_top_z
        bottom_z = plate_top_z - travel
        spawnflags = int(e['kv'].get('spawnflags', '0') or '0')
        starts_at_top = (spawnflags & 1) == 0   # informational only
        elevators.append({
            'pmn': pmn, 'pmx': pmx,
            'bottom_z': bottom_z, 'top_z': top_z,
            'thickness': pmx[2] - pmn[2],
            'speed': speed * S, 'wait': wait_t,
            'starts_at_top': starts_at_top,
        })

    # Second pass: parse teleporter triggers + their destinations.
    tp_dests = {}
    for e in ents:
        if e['kv'].get('classname') == 'info_teleport_destination':
            nm = e['kv'].get('targetname')
            o = e['kv'].get('origin')
            if nm and o:
                qx, qy, qz = [float(v) for v in o.split()]
                tp_dests[nm] = (qx, qy, qz)
    teleporters = []
    for e in ents:
        if e['kv'].get('classname') != 'trigger_teleport': continue
        tgt = e['kv'].get('target')
        if tgt not in tp_dests: continue
        # Compute trigger AABB (union of all its brushes).
        bnd = None
        for brush in e['brushes']:
            planes, _texs = parse_brush(brush)
            if planes is None: continue
            _V, bb = brush_aabb(planes)
            if bb is None: continue
            qmn, qmx = bb
            if bnd is None: bnd = [qmn.copy(), qmx.copy()]
            else:
                for i in range(3):
                    bnd[0][i] = min(bnd[0][i], qmn[i])
                    bnd[1][i] = max(bnd[1][i], qmx[i])
        if bnd is None: continue
        teleporters.append({
            'trigger_q': (bnd[0][0], bnd[0][1], bnd[0][2], bnd[1][0], bnd[1][1], bnd[1][2]),
            'dest_q': tp_dests[tgt],
            'name': tgt,
        })

    # Compute extents from box AABBs.
    xs, ys, zs = [], [], []
    for b in boxes:
        qx0, qy0, qz0, qx1, qy1, qz1 = b['q']
        xs += [qx0, qx1]; ys += [qy0, qy1]; zs += [qz0, qz1]
    qcx = (min(xs) + max(xs)) / 2
    qcy = (min(ys) + max(ys)) / 2
    qcz_floor = min(zs)

    def transform_box(qbox):
        qx0, qy0, qz0, qx1, qy1, qz1 = qbox
        # Centre on XZ and lift floor to engine y=0.
        qx0 -= qcx; qx1 -= qcx
        qy0 -= qcy; qy1 -= qcy
        qz0 -= qcz_floor; qz1 -= qcz_floor
        # Quake (x,y,z=up) → engine (x, z=Q_y mirrored, y=Q_z).
        ex0 = qx0 * S; ex1 = qx1 * S
        ey0 = qz0 * S; ey1 = qz1 * S
        ez0 = -qy1 * S; ez1 = -qy0 * S
        return (ex0, ey0, ez0, ex1, ey1, ez1)

    def transform_pt(qx, qy, qz):
        qx -= qcx; qy -= qcy; qz -= qcz_floor
        return (qx * S, qz * S, -qy * S)

    # Compute engine extents → choose perimeter half.
    minX = minY = minZ = float('inf')
    maxX = maxY = maxZ = float('-inf')
    for b in boxes:
        ex0, ey0, ez0, ex1, ey1, ez1 = transform_box(b['q'])
        minX = min(minX, ex0); maxX = max(maxX, ex1)
        minY = min(minY, ey0); maxY = max(maxY, ey1)
        minZ = min(minZ, ez0); maxZ = max(maxZ, ez1)
    half = math.ceil(max(maxX - minX, maxZ - minZ) / 2 / 5) * 5 + 2
    # Perimeter height = max box height + 4 m clearance.
    perim_h = math.ceil(maxY + 4)

    # Extract pickups + spawns from point entities.
    weapon_map = {
        'weapon_supershotgun': 'shotgun',
        'weapon_nailgun':      'smg',
        'weapon_supernailgun': 'saw',
        'weapon_lightning':    'sniper',
        # RL / GL — no engine equivalent yet; convert to extra health.
        'weapon_rocketlauncher':   None,
        'weapon_grenadelauncher':  None,
    }
    spawns_dm, spawns_start = [], []
    pickups = []
    for e in ents:
        cn = e['kv'].get('classname', '')
        o = e['kv'].get('origin')
        if not o: continue
        try:
            qx, qy, qz = [float(v) for v in o.split()]
        except ValueError:
            continue
        ex, ey, ez = transform_pt(qx, qy, qz)
        if cn == 'info_player_deathmatch':
            spawns_dm.append({'x': ex, 'y': ey, 'z': ez})
        elif cn == 'info_player_start':
            spawns_start.append({'x': ex, 'y': ey, 'z': ez})
        elif cn in weapon_map:
            w = weapon_map[cn]
            if w is None: continue
            pickups.append({'kind': 'weapon', 'what': w, 'x': ex, 'y': ey, 'z': ez})
        elif cn == 'item_health':
            pickups.append({'kind': 'health', 'x': ex, 'y': ey, 'z': ez})

    # Anchor list: prefer DM spawns, fall back to single_player.
    all_spawns = spawns_dm or spawns_start
    # Initial SPAWN = the one closest to the geometric centre.
    all_spawns.sort(key=lambda s: s['x']**2 + s['z']**2)
    spawn0 = all_spawns[0] if all_spawns else {'x': 0, 'y': 0, 'z': 0}

    # Transform water brushes (engine AABB only — runtime renders them as
    # translucent volumes, no collision).
    water_engine = []
    for w in water_brushes:
        ex0, ey0, ez0, ex1, ey1, ez1 = transform_box(w['q'])
        if min(ex1 - ex0, ey1 - ey0, ez1 - ez0) < 0.05: continue
        water_engine.append({
            'cx': (ex0 + ex1) / 2,
            'cz': (ez0 + ez1) / 2,
            'sx': ex1 - ex0,
            'sy': ey1 - ey0,
            'sz': ez1 - ez0,
            'base': ey0,
        })

    # Transform elevators.
    el_engine = []
    for lift in elevators:
        # Convert plate XZ + thickness to engine. The plate footprint maps via
        # the same q2engine_box transform; bottom_z / top_z are Quake Z values
        # → engine Y. Y mirroring (Quake Y → engine -Z) applies to plate XZ
        # bounds: build a dummy box at bottom Z to get the engine X/Z extents.
        qb_lo = (lift['pmn'][0], lift['pmn'][1], lift['bottom_z'])
        qb_hi = (lift['pmx'][0], lift['pmx'][1], lift['bottom_z'] + lift['thickness'])
        ex0, ey_bot_lo, ez0, ex1, ey_bot_hi, ez1 = transform_box((*qb_lo, *qb_hi))
        # Top position (just the y range; XZ is identical).
        qb_lo2 = (lift['pmn'][0], lift['pmn'][1], lift['top_z'])
        qb_hi2 = (lift['pmx'][0], lift['pmx'][1], lift['top_z'] + lift['thickness'])
        _, ey_top_lo, _, _, ey_top_hi, _ = transform_box((*qb_lo2, *qb_hi2))
        el_engine.append({
            'cx': (ex0 + ex1) / 2,
            'cz': (ez0 + ez1) / 2,
            'sx': ex1 - ex0,
            'sz': ez1 - ez0,
            'sy': ey_bot_hi - ey_bot_lo,
            'bottom_y': ey_bot_lo,
            'top_y':    ey_top_lo,
            'speed':    lift['speed'],
            'wait':     lift['wait'],
            'starts_at_top': lift['starts_at_top'],
        })

    # Transform teleporters.
    tp_engine = []
    for tp in teleporters:
        ex0, ey0, ez0, ex1, ey1, ez1 = transform_box(tp['trigger_q'])
        dx, dy, dz = transform_pt(*tp['dest_q'])
        tp_engine.append({
            'x0': ex0, 'y0': ey0, 'z0': ez0,
            'x1': ex1, 'y1': ey1, 'z1': ez1,
            'dx': dx, 'dy': dy, 'dz': dz,
            'name': tp['name'],
        })

    # ─────── emit src/maplayout.js ───────
    out = []
    out.append('// maplayout.js — THE EDGE (auto-imported from Quake .map by dev/import_edge.py v2).')
    out.append('//')
    out.append('// Source: q2dm1q1restoration by Chuma (restoration of Tim Willits\'s Q1')
    out.append('// conversion of his own Q2 q2dm1 "The Edge"). See dev/source/README.md.')
    out.append('//')
    out.append('// THIS FILE IS GENERATED. Edit dev/import_edge.py and re-run.')
    out.append('//')
    out.append('// v2 over v1: slope brushes (top face at 5–66° tilt) become stair-step')
    out.append('// stacks instead of inflated AABBs, so sloped floors remain walkable.')
    out.append('// Teleporter triggers + destinations are emitted as a new LAYOUT entry')
    out.append('// type (\'teleporter\') consumed by the runtime.')
    out.append('')
    out.append(f"export const SPAWN = {{ x: {spawn0['x']:.2f}, y: {spawn0['y']:.2f}, z: {spawn0['z']:.2f} }};")
    out.append('')
    out.append('// All deathmatch spawn points from the .map. The engine\'s arena')
    out.append('// mode picks one at random per respawn.')
    out.append('export const SPAWN_ANCHORS = [')
    out.append(f"  {{ id: 'C', x: {spawn0['x']:.2f}, y: {spawn0['y']:.2f}, z: {spawn0['z']:.2f} }},")
    for i, s in enumerate(all_spawns[1:]):
        out.append(f"  {{ id: 's{i+1}', x: {s['x']:.2f}, y: {s['y']:.2f}, z: {s['z']:.2f} }},")
    out.append('];')
    out.append('')
    out.append('// Quake brushes don\'t have the engine\'s aperture concept; wallBoxes')
    out.append('// is a stub kept for engine compatibility.')
    out.append('export function wallBoxes(e) {')
    out.append('  const base = e.base || 0, H = e.height, t = e.thick == null ? 0.5 : e.thick;')
    out.append('  const L = e.length, axis = e.axis;')
    out.append('  const lmin = (axis === \'x\' ? e.cx : e.cz) - L / 2;')
    out.append('  const lmax = (axis === \'x\' ? e.cx : e.cz) + L / 2;')
    out.append('  const c0 = (axis === \'x\' ? e.cz : e.cx) - t / 2;')
    out.append('  const c1 = (axis === \'x\' ? e.cz : e.cx) + t / 2;')
    out.append('  if (axis === \'x\') return [{ x0: lmin, x1: lmax, y0: base, y1: base + H, z0: c0, z1: c1 }];')
    out.append('  return [{ x0: c0, x1: c1, y0: base, y1: base + H, z0: lmin, z1: lmax }];')
    out.append('}')
    out.append('')
    out.append('export const DOORWAYS = [];')
    out.append('')
    out.append('export const LAYOUT = [')
    out.append(f'  {{ t: \'ground\', half: {half}, y: 0 }},')
    out.append(f'  {{ t: \'perimeter\', half: {half}, height: {perim_h}, thick: 1.0 }},')
    n_emitted = 0
    for b in boxes:
        ex0, ey0, ez0, ex1, ey1, ez1 = transform_box(b['q'])
        sx = ex1 - ex0; sy = ey1 - ey0; sz = ez1 - ez0
        if min(sx, sy, sz) < 0.05: continue
        cx_ = (ex0 + ex1) / 2; cz_ = (ez0 + ez1) / 2
        mat = b.get('mat', 'qmetal')
        out.append(
            f"  {{ t: 'box', cx: {cx_:.2f}, cz: {cz_:.2f}, "
            f"base: {ey0:.2f}, sx: {sx:.2f}, sy: {sy:.2f}, sz: {sz:.2f}, "
            f"kind: '{mat}' }},"
        )
        n_emitted += 1
    for tp in tp_engine:
        out.append(
            f"  {{ t: 'teleporter', name: '{tp['name']}', "
            f"x0: {tp['x0']:.2f}, y0: {tp['y0']:.2f}, z0: {tp['z0']:.2f}, "
            f"x1: {tp['x1']:.2f}, y1: {tp['y1']:.2f}, z1: {tp['z1']:.2f}, "
            f"dx: {tp['dx']:.2f}, dy: {tp['dy']:.2f}, dz: {tp['dz']:.2f} }},"
        )
    for lift in el_engine:
        out.append(
            f"  {{ t: 'elevator', "
            f"cx: {lift['cx']:.2f}, cz: {lift['cz']:.2f}, "
            f"sx: {lift['sx']:.2f}, sy: {lift['sy']:.2f}, sz: {lift['sz']:.2f}, "
            f"bottomY: {lift['bottom_y']:.2f}, topY: {lift['top_y']:.2f}, "
            f"speed: {lift['speed']:.2f}, wait: {lift['wait']:.2f}, "
            f"startsAtTop: {str(lift['starts_at_top']).lower()} }},"
        )
    for w in water_engine:
        out.append(
            f"  {{ t: 'water', "
            f"cx: {w['cx']:.2f}, cz: {w['cz']:.2f}, "
            f"base: {w['base']:.2f}, sx: {w['sx']:.2f}, sy: {w['sy']:.2f}, sz: {w['sz']:.2f} }},"
        )
    out.append('];')
    out.append('')
    out.append('export const PICKUPS = [')
    for p in pickups:
        if p['kind'] == 'weapon':
            out.append(f"  {{ kind: 'weapon', what: '{p['what']}', x: {p['x']:.2f}, z: {p['z']:.2f}, y: {p['y']:.2f} }},")
        else:
            out.append(f"  {{ kind: 'health', x: {p['x']:.2f}, z: {p['z']:.2f}, y: {p['y']:.2f} }},")
    out.append('];')

    with open(OUT, 'w') as f:
        f.write('\n'.join(out) + '\n')

    print(f"parsed {len(ents)} entities", file=sys.stderr)
    print(f"static brushes processed: {len(static_brushes)}", file=sys.stderr)
    print(f"skipped: {dict(skipped)}", file=sys.stderr)
    print(f"emitted: {n_emitted} boxes + {len(tp_engine)} teleporters + {len(el_engine)} elevators + {len(water_engine)} water", file=sys.stderr)
    print(f"  {len(all_spawns)} spawns, {len(pickups)} pickups", file=sys.stderr)
    print(f"engine extents: x=[{minX:.1f},{maxX:.1f}] y=[{minY:.1f},{maxY:.1f}] z=[{minZ:.1f},{maxZ:.1f}]", file=sys.stderr)
    print(f"perimeter half={half}, height={perim_h}", file=sys.stderr)
    print(f"wrote {OUT}", file=sys.stderr)


if __name__ == '__main__':
    main()
