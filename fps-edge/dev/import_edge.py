#!/usr/bin/env python3
"""Convert a Quake .map (text brush format) to engine LAYOUT entries.

Approach: each brush is the intersection of half-spaces defined by its planes.
Compute brush vertices as the set of points where 3 planes meet AND lie inside
every other half-space; the AABB of those vertices is the brush bound.

Lossy by design: Quake brushes are arbitrary convex polyhedra (sloped
surfaces, angled walls); AABB conversion fattens every brush to its tightest
axis-aligned bound. Sloped floors become stepped boxes, angled walls become
thicker rectangles. This is the inherent gap between Quake's geometry
vocabulary and our engine's LAYOUT vocabulary.

Filters: skips sky/trigger/clip brushes; drops brushes flagged as part of
'func_*' entities other than func_wall (elevators don't translate); merges
near-duplicate brushes; drops sub-threshold sliver brushes (decorative trim).

Output: writes src/maplayout.js with a LAYOUT array of `box` entries (one per
brush) plus PICKUPS + SPAWN_ANCHORS extracted from point entities.
"""

import re
import sys
import os
import math
import numpy as np
from collections import defaultdict

SRC = os.path.join(os.path.dirname(__file__), 'source', 'q2dm1q1restoration.map')
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'maplayout.js')

# Quake -> engine scale and axis. Player capsule is ~1.7m, Quake player is 56u.
# 56 u / 1.7 m ≈ 33 u/m. Use 32 for round numbers.
S = 1.0 / 32.0

# Texture filters: brushes with these texture prefixes on any face are dropped.
SKIP_TEXTURE_PREFIXES = ('sky', 'trigger', 'clip', '*', 'origin')

# Minimum brush volume (m³) to keep. Sliver trim brushes below this are noise.
MIN_BRUSH_VOLUME = 0.02

# Texture name → engine surface kind. We pick a kit-friendly bucket so the
# arena builder can later assign procedural materials. Defaults to 'wall'.
def classify_texture(tex_names):
    if any(t.startswith('sky') for t in tex_names): return 'sky'
    floors = sum(1 for t in tex_names if 'floor' in t)
    metals = sum(1 for t in tex_names if 'metal' in t or 'cop' in t)
    if floors > metals: return 'floor'
    return 'metal'


def parse_map(path):
    """Yield (depth-1 entity dict, list of brush dicts) tuples."""
    text = open(path, encoding='utf-8', errors='replace').read()
    lines = text.split('\n')
    entities = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i].strip()
        if line == '{':
            # entity block
            ent = {'kv': {}, 'brushes': []}
            i += 1
            while i < n and lines[i].strip() != '}':
                s = lines[i].strip()
                if s == '{':
                    # brush
                    brush_planes = []
                    i += 1
                    while i < n and lines[i].strip() != '}':
                        bl = lines[i].strip()
                        if bl and not bl.startswith('//'):
                            brush_planes.append(bl)
                        i += 1
                    ent['brushes'].append(brush_planes)
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
    """→ (list of (n, d) planes, list of texture names). Returns (None, None)
    if the brush has fewer than 4 valid planes."""
    planes = []
    texs = []
    for line in plane_lines:
        m = PLANE_RE.match(line)
        if not m: continue
        coords = [float(m.group(k+1)) for k in range(9)]
        tex = m.group(10)
        p1 = np.array(coords[0:3])
        p2 = np.array(coords[3:6])
        p3 = np.array(coords[6:9])
        # Quake plane: normal = cross(p3-p1, p2-p1) (CCW when looking from
        # outside the brush). Brush interior satisfies n·p + d ≤ 0.
        nrm = np.cross(p3 - p1, p2 - p1)
        ln = np.linalg.norm(nrm)
        if ln < 1e-4: continue
        nrm = nrm / ln
        d = -float(np.dot(nrm, p1))
        planes.append((nrm, d))
        texs.append(tex)
    if len(planes) < 4: return None, None
    return planes, texs


def brush_aabb(planes):
    """Compute AABB of the convex polyhedron defined by half-spaces
    n·p + d ≤ 0. Returns (qmin, qmax) in Quake units or None if degenerate."""
    n = len(planes)
    verts = []
    EPS = 1e-3
    for i in range(n):
        for j in range(i+1, n):
            for k in range(j+1, n):
                A = np.array([planes[i][0], planes[j][0], planes[k][0]])
                det = np.linalg.det(A)
                if abs(det) < 1e-4: continue
                b = -np.array([planes[i][1], planes[j][1], planes[k][1]])
                try:
                    p = np.linalg.solve(A, b)
                except np.linalg.LinAlgError:
                    continue
                # Inside all other half-spaces?
                ok = True
                for m in range(n):
                    if m in (i, j, k): continue
                    if np.dot(planes[m][0], p) + planes[m][1] > EPS:
                        ok = False; break
                if ok: verts.append(p)
    if not verts: return None
    V = np.array(verts)
    qmin = V.min(axis=0)
    qmax = V.max(axis=0)
    return qmin, qmax


def q2engine(qmin, qmax):
    """Quake (X east, Y north, Z up) → engine (X east, Y up, Z south).
    Returns (x0, y0, z0, x1, y1, z1) in metres."""
    ex0 = qmin[0] * S
    ex1 = qmax[0] * S
    ey0 = qmin[2] * S
    ey1 = qmax[2] * S
    # Mirror Quake Y into engine -Z so the map isn't reflected.
    ez0 = -qmax[1] * S
    ez1 = -qmin[1] * S
    return ex0, ey0, ez0, ex1, ey1, ez1


def main():
    ents = parse_map(SRC)
    print(f"parsed {len(ents)} entities", file=sys.stderr)

    # World brushes come from entity[0] (worldspawn). Func_wall brushes are
    # solid too (static, non-moving). Other func_* (plat, train, door) are
    # dynamic — skip for now.
    world = ents[0]
    classname0 = world['kv'].get('classname', '?')
    assert classname0 == 'worldspawn', f"first entity is {classname0!r}"

    all_brushes = list(world['brushes'])
    for e in ents[1:]:
        if e['kv'].get('classname') == 'func_wall':
            all_brushes.extend(e['brushes'])

    boxes = []
    skipped = defaultdict(int)
    for brush in all_brushes:
        planes, texs = parse_brush(brush)
        if planes is None:
            skipped['parse_fail'] += 1; continue
        # Skip if any face is sky/trigger/clip.
        if any(any(t.startswith(p) for p in SKIP_TEXTURE_PREFIXES) for t in texs):
            skipped['sky_or_special'] += 1; continue
        bb = brush_aabb(planes)
        if bb is None:
            skipped['no_verts'] += 1; continue
        qmin, qmax = bb
        x0, y0, z0, x1, y1, z1 = q2engine(qmin, qmax)
        vol = (x1 - x0) * (y1 - y0) * (z1 - z0)
        if vol < MIN_BRUSH_VOLUME:
            skipped['too_small'] += 1; continue
        kind = classify_texture(texs)
        boxes.append({'x0': x0, 'y0': y0, 'z0': z0, 'x1': x1, 'y1': y1, 'z1': z1, 'kind': kind})
    print(f"kept {len(boxes)} boxes; skipped: {dict(skipped)}", file=sys.stderr)

    # Extents.
    xs = [b['x0'] for b in boxes] + [b['x1'] for b in boxes]
    ys = [b['y0'] for b in boxes] + [b['y1'] for b in boxes]
    zs = [b['z0'] for b in boxes] + [b['z1'] for b in boxes]
    minX, maxX = min(xs), max(xs)
    minY, maxY = min(ys), max(ys)
    minZ, maxZ = min(zs), max(zs)
    # Translate so the map is centred at the origin on XZ and the floor sits at y=0.
    cx = (minX + maxX) / 2
    cz = (minZ + maxZ) / 2
    floorY = minY
    for b in boxes:
        b['x0'] -= cx; b['x1'] -= cx
        b['z0'] -= cz; b['z1'] -= cz
        b['y0'] -= floorY; b['y1'] -= floorY
    print(f"extents (engine m): x={maxX-minX:.1f}  y={maxY-minY:.1f}  z={maxZ-minZ:.1f}", file=sys.stderr)
    print(f"centred at ({cx:.1f}, _, {cz:.1f}); floor lifted by {floorY:.1f}", file=sys.stderr)

    # Half-extent for the perimeter (round up to nearest 5m).
    half = max(maxX - cx, cx - minX, maxZ - cz, cz - minZ)
    half = math.ceil(half / 5) * 5 + 2

    # Extract point entities for SPAWN / SPAWN_ANCHORS / PICKUPS.
    spawns = []
    pickups = []
    weapon_map = {
        'weapon_supershotgun': 'shotgun',
        'weapon_nailgun': 'smg',
        'weapon_supernailgun': 'saw',
        'weapon_lightning': 'sniper',
        # RL/GL not modelled — convert to health
        'weapon_rocketlauncher': None,
        'weapon_grenadelauncher': None,
    }
    for e in ents:
        cn = e['kv'].get('classname', '')
        o = e['kv'].get('origin')
        if not o: continue
        try:
            qx, qy, qz = [float(v) for v in o.split()]
        except ValueError: continue
        ex = qx * S - cx
        ey = qz * S - floorY
        ez = -qy * S - cz
        if cn == 'info_player_deathmatch' or cn == 'info_player_start':
            spawns.append({'x': ex, 'y': ey, 'z': ez, 'kind': cn})
        elif cn in weapon_map:
            w = weapon_map[cn]
            if w is None: continue
            pickups.append({'kind': 'weapon', 'what': w, 'x': ex, 'y': ey, 'z': ez})
        elif cn == 'item_health':
            pickups.append({'kind': 'health', 'x': ex, 'y': ey, 'z': ez})
        # Armor / ammo: skip (engine has no equivalents)

    # Pick the deathmatch spawn closest to (0,0) as the canonical SPAWN; the
    # rest become SPAWN_ANCHORS.
    spawns_dm = [s for s in spawns if s['kind'] == 'info_player_deathmatch']
    if not spawns_dm:
        spawns_dm = spawns
    spawns_dm.sort(key=lambda s: s['x']**2 + s['z']**2)
    spawn0 = spawns_dm[0] if spawns_dm else {'x': 0, 'y': 0, 'z': 0}

    # --- Write maplayout.js ---
    lines = []
    lines.append('// maplayout.js — THE EDGE (auto-imported from Quake .map by dev/import_edge.py).')
    lines.append('//')
    lines.append('// Source: q2dm1q1restoration by Chuma (restoration of Tim Willits\'s Q1 conversion')
    lines.append('// of q2dm1 "The Edge"). See dev/source/README.md for credits.')
    lines.append('//')
    lines.append('// THIS FILE IS GENERATED. Edit dev/import_edge.py and re-run instead.')
    lines.append('//')
    lines.append('// Generator strategy: each Quake brush → AABB → one `box` LAYOUT entry.')
    lines.append('// Lossy by design: sloped/angled brushes become axis-aligned boxes, fattening')
    lines.append('// the bound. The map will read as a blocky stair-step approximation of The')
    lines.append('// Edge, not a faithful Quake port.')
    lines.append('')
    lines.append(f"export const SPAWN = {{ x: {spawn0['x']:.2f}, z: {spawn0['z']:.2f} }};")
    lines.append('')
    lines.append('export const SPAWN_ANCHORS = [')
    lines.append(f"  {{ id: 'C', x: {spawn0['x']:.2f}, z: {spawn0['z']:.2f} }},")
    for i, s in enumerate(spawns_dm[1:6]):
        lines.append(f"  {{ id: '{i+1}', x: {s['x']:.2f}, z: {s['z']:.2f} }},")
    lines.append('];')
    lines.append('')
    lines.append('// Quake doors / windows are full brushes — we can\'t carve apertures from')
    lines.append('// the AABB output. wallBoxes stays as a stub for engine compatibility.')
    lines.append('export function wallBoxes(e) {')
    lines.append('  const base = e.base || 0, H = e.height, t = e.thick == null ? 0.5 : e.thick;')
    lines.append('  const L = e.length, axis = e.axis;')
    lines.append('  const lmin = (axis === \'x\' ? e.cx : e.cz) - L / 2;')
    lines.append('  const lmax = (axis === \'x\' ? e.cx : e.cz) + L / 2;')
    lines.append('  const c0 = (axis === \'x\' ? e.cz : e.cx) - t / 2;')
    lines.append('  const c1 = (axis === \'x\' ? e.cz : e.cx) + t / 2;')
    lines.append('  if (axis === \'x\') return [{ x0: lmin, x1: lmax, y0: base, y1: base + H, z0: c0, z1: c1 }];')
    lines.append('  return [{ x0: c0, x1: c1, y0: base, y1: base + H, z0: lmin, z1: lmax }];')
    lines.append('}')
    lines.append('')
    lines.append('// DOORWAYS empty — Quake doesn\'t have the engine\'s aperture concept.')
    lines.append('export const DOORWAYS = [];')
    lines.append('')
    lines.append('export const LAYOUT = [')
    lines.append(f'  {{ t: \'ground\', half: {half}, y: 0 }},')
    lines.append(f'  {{ t: \'perimeter\', half: {half}, height: 18, thick: 1.0 }},')
    for b in boxes:
        cx_ = (b['x0'] + b['x1']) / 2
        cz_ = (b['z0'] + b['z1']) / 2
        sx_ = b['x1'] - b['x0']
        sy_ = b['y1'] - b['y0']
        sz_ = b['z1'] - b['z0']
        base_ = b['y0']
        # Skip zero-thickness slivers in any axis.
        if min(sx_, sy_, sz_) < 0.05: continue
        lines.append(
            f"  {{ t: 'box', cx: {cx_:.2f}, cz: {cz_:.2f}, "
            f"base: {base_:.2f}, sx: {sx_:.2f}, sy: {sy_:.2f}, sz: {sz_:.2f} }},"
        )
    lines.append('];')
    lines.append('')
    lines.append('export const PICKUPS = [')
    for p in pickups:
        if p['kind'] == 'weapon':
            lines.append(f"  {{ kind: 'weapon', what: '{p['what']}', x: {p['x']:.2f}, z: {p['z']:.2f}, y: {p['y']:.2f} }},")
        else:
            lines.append(f"  {{ kind: 'health', x: {p['x']:.2f}, z: {p['z']:.2f}, y: {p['y']:.2f} }},")
    lines.append('];')

    out_text = '\n'.join(lines) + '\n'
    with open(OUT, 'w') as f:
        f.write(out_text)
    print(f"wrote {OUT} ({len(boxes)} boxes, {len(spawns_dm)} spawns, {len(pickups)} pickups)", file=sys.stderr)


if __name__ == '__main__':
    main()
