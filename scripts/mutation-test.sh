#!/usr/bin/env bash
# Mutation testing for the backend (slow: minutes per module; not part of CI
# or the verify scripts). See docs/tests/backend-test-audit.md.
#
#   scripts/mutation-test.sh                       # engine modules, per-test kill matrix
#   scripts/mutation-test.sh game/rules.py         # chosen modules (backend-relative)
#   MATRIX=0 scripts/mutation-test.sh seats.py     # stop at the first killing test
#   OUT=/tmp/m.json scripts/mutation-test.sh ...   # where the JSON result goes
#
# Then: python scripts/mutation_report.py "$OUT"   (scores per module)
#       python scripts/mutation_report.py OLD.json --compare NEW.json
set -euo pipefail
cd "$(dirname "$0")/.."

modules=("$@")
if [ ${#modules[@]} -eq 0 ]; then
  modules=(game/rules.py game/hotel.py game/game.py game/merger.py game/trading.py game/decisions.py game/player.py
           game/board.py game/ranking.py game/calculator.py)
fi
out="${OUT:-/tmp/game-mutation/result.json}"
work="${WORKDIR:-/tmp/game-mutation}"
mkdir -p "$work"
args=()
for m in "${modules[@]}"; do args+=(--module "$m"); done
if [ "${MATRIX:-1}" = "1" ]; then args+=(--matrix); fi
# A fresh coverage map every run (the tests or the code may have changed).
rm -f "$work"/coverage-*
python scripts/mutation_test.py "${args[@]}" --workdir "$work" --out "$out"
python scripts/mutation_report.py "$out"
