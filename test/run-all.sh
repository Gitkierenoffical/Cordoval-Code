#!/usr/bin/env bash
# Runs the headless suite against the Cordoval engine with the scripted test provider.
# Usage: bash test/run-all.sh [test ...]   (needs xvfb-run). LIVE=1 adds the OpenRouter live check.
cd "$(dirname "$0")/.."
TESTS=${*:-"unit smoke e2e editor composer slash deny sudo-ask history review mentions customize agents themes templates tabs-keys tab-dot approvals keys-never-leak"}
[ -n "$LIVE" ] && TESTS="$TESTS live-openrouter"
fail=0
for t in $TESTS; do
  out=$(timeout 300 xvfb-run -a -s "-screen 0 1600x1000x24" node "test/$t.js" 2>&1)
  code=$?
  echo "$out" | grep -E '^(PASS|FAIL|SKIP|  FAIL)' || echo "$out" | tail -5
  [ $code -ne 0 ] && fail=1
done
exit $fail
