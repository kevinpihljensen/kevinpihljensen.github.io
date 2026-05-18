#!/usr/bin/env bash
# fps-edge regression battery — adapted from fps/'s test-all.sh.
#
# The Quake-imported map (brush-soup) has no named structures and no
# connector graph, so the map-specific harnesses from fps/ are inapplicable
# and the mapviz validator doesn't speak the same vocabulary. This script:
#   - keeps the SIX engine-pure harnesses that do not depend on the map
#     (weapons, kit, combat, crouch2, raisedfloor, duckjump)
#   - skips the FOUR map-dependent ones (harness_ai, harness_arena,
#     harness_doors, harness_pickups) — see dev/IMPORT_STATUS.md
#   - runs the new dev/edge_validate.mjs in place of mapviz
#
# Exit non-zero on any harness fail or edge_validate fail.
#
# Usage:  cd dev && ./test-all.sh
set -u
cd "$(dirname "$0")"
fail=0

echo "== syntax check (all src modules + build script) =="
for f in ../src/*.js ../build-singlefile.mjs; do
  node --check "$f" 2>/dev/null || { echo "  SYNTAX FAIL: $f"; fail=1; }
done
[ $fail -eq 0 ] && echo "  all clean"

echo
echo "== engine-pure harness battery (map-independent) =="
for h in harness_weapons harness_kit harness_combat harness_crouch2 \
         harness_raisedfloor harness_duckjump; do
  out=$(node "$h.mjs" 2>&1)
  res=$(echo "$out" | grep -oE "[0-9]+/[0-9]+ PASS" | tail -1)
  if echo "$out" | grep -q "PASS" && ! echo "$out" | grep -q "FAIL"; then
    printf "  %-20s %s\n" "$h" "$res"
  else
    printf "  %-20s FAILED\n" "$h"; fail=1
  fi
done

echo
echo "== skipped map-dependent harnesses (Quake brush-soup, see IMPORT_STATUS.md) =="
for h in harness_ai harness_arena harness_doors harness_pickups; do
  printf "  %-20s SKIPPED — assumes structured-map IDs\n" "$h"
done

echo
echo "== edge map validation =="
ev=$(node edge_validate.mjs 2>&1)
echo "$ev" | grep -E "SUMMARY|EDGE MAP|visited" | sed 's/^/  /'
echo "$ev" | grep -q "EDGE MAP OK" || { echo "  EDGE MAP NOT OK (see dev/edge_validate.txt)"; fail=1; }

echo
if [ $fail -eq 0 ]; then echo "ALL GREEN"; else echo "*** FAILURES ABOVE ***"; fi
exit $fail
