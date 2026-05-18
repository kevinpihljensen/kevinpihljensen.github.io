#!/usr/bin/env bash
# render-map.sh — produce PNG renders of the mapviz SVG outputs so the agent
# (or a human reviewer) can VIEW the map with the Read tool.
#
# S55d: closes the visibility gap that let two visual-only bugs (wall-deck
# clipping, stair-doorway trap) ship before the user spotted them. With
# PNGs in dev/, the agent can simply `Read` each one and SEE the map at
# every tier, in oblique, AND in 4 elevation cross-sections — the cross-
# sections are the view that would have made wall-pokes-through-deck
# obvious before the user had to report it.
#
# Usage:  cd dev && ./render-map.sh        (or: bash render-map.sh)
# Requires:  python3 + cairosvg (pip install cairosvg).

set -euo pipefail
cd "$(dirname "$0")"

# 1. Refresh the SVGs (mapviz writes them into ./) and the FPS PPM renders
# (fps-render.mjs writes first-person raytraced views of curated camera
# poses — spawn, building entries, stair landings, pickups).
node mapviz.mjs > /dev/null
node fps-render.mjs > /dev/null

# 2. Convert every SVG → PNG (cairosvg) and every PPM → PNG (Pillow).
have_cairosvg=$(python3 -c "import cairosvg" 2>/dev/null && echo yes || echo no)
have_pillow=$(python3 -c "from PIL import Image" 2>/dev/null && echo yes || echo no)
if [ "$have_cairosvg" != "yes" ] || [ "$have_pillow" != "yes" ]; then
  echo "missing python deps — pip install cairosvg pillow" >&2
  exit 1
fi
for svg in map_plan_*.svg map_oblique.svg map_elev_*.svg; do
  [ -e "$svg" ] || continue
  png="${svg%.svg}.png"
  python3 -c "
import cairosvg
cairosvg.svg2png(url='$svg', write_to='$png', scale=1.5)
" && echo "  wrote $png"
done
for ppm in fps_*.ppm; do
  [ -e "$ppm" ] || continue
  png="${ppm%.ppm}.png"
  python3 -c "
from PIL import Image
Image.open('$ppm').save('$png')
" && echo "  wrote $png"
  rm -f "$ppm"
done

# 3. Quick summary of what landed.
echo
echo "Rendered PNGs (Read these to inspect the map):"
echo "  Orthographic views:"
ls -1 map_*.png 2>/dev/null | sed 's/^/    /'
echo "  First-person POV views:"
ls -1 fps_*.png 2>/dev/null | sed 's/^/    /'
