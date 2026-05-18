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

# 1. Refresh the SVGs (mapviz writes them into ./).
node mapviz.mjs > /dev/null

# 2. Convert every map_*.svg → map_*.png. Use 2× density on cross-sections
# so the thinner geometry (walls, parapets) stays readable in the PNG.
have_cairosvg=$(python3 -c "import cairosvg" 2>/dev/null && echo yes || echo no)
if [ "$have_cairosvg" != "yes" ]; then
  echo "cairosvg not installed — pip install cairosvg" >&2
  exit 1
fi
for svg in map_plan_*.svg map_oblique.svg map_elev_*.svg; do
  [ -e "$svg" ] || continue
  png="${svg%.svg}.png"
  scale=1.5
  case "$svg" in map_elev_*.svg) scale=1.5 ;; esac
  python3 -c "
import cairosvg, sys
cairosvg.svg2png(url='$svg', write_to='$png', scale=$scale)
" && echo "  wrote $png"
done

# 3. Quick summary of what landed.
echo
echo "Rendered PNGs (Read these to inspect the map):"
ls -1 map_*.png 2>/dev/null | sed 's/^/  /'
