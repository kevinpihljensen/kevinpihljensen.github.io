#!/usr/bin/env bash
# Runs the full regression battery + map analysis. Exit non-zero on any fail.
# Usage:  cd dev && ./test-all.sh        (or: bash test-all.sh)
set -u
cd "$(dirname "$0")"
fail=0

echo "== syntax check (all src modules + build script) =="
for f in ../src/*.js ../build-singlefile.mjs; do
  node --check "$f" 2>/dev/null || { echo "  SYNTAX FAIL: $f"; fail=1; }
done
[ $fail -eq 0 ] && echo "  all clean"

echo
echo "== regression battery =="
for h in harness_ai harness_arena harness_weapons harness_doors \
         harness_raisedfloor harness_duckjump harness_kit \
         harness_combat harness_crouch2 harness_pickups \
         harness_teleporters harness_arena_spawn harness_jumppads; do
  out=$(node "$h.mjs" 2>&1)
  res=$(echo "$out" | grep -oE "[0-9]+/[0-9]+ PASS" | tail -1)
  if echo "$out" | grep -q "PASS"  && ! echo "$out" | grep -q "FAIL"; then
    printf "  %-20s %s\n" "$h" "$res"
  else
    printf "  %-20s FAILED\n" "$h"; fail=1
  fi
done

echo
echo "== map analysis (mapviz) =="
mv=$(node mapviz.mjs 2>&1)
echo "$mv" | grep -E "SUMMARY|MAP (OK|HAS)" | sed 's/^/  /'
echo "$mv" | grep -q "MAP OK" || { echo "  MAP NOT OK"; fail=1; }

echo
if [ $fail -eq 0 ]; then echo "ALL GREEN"; else echo "*** FAILURES ABOVE ***"; fi
exit $fail
