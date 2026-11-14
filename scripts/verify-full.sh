#!/bin/bash
# Full verification (slower, more thorough)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Run quick checks first
./scripts/verify-change.sh || exit 1

echo ""
echo "=== All Backend Tests ==="
cd backend && pytest tests/ -x -n auto
cd "$PROJECT_ROOT"

echo ""
echo "=== Frontend unit tests ==="
cd frontend && npm test
cd "$PROJECT_ROOT"

echo ""
echo "=== E2E: @ci journeys (full game from the home page + entry errors) ==="
# Playwright starts the servers itself (ACQUIRE_TEST_MODE=1, seed 2) or reuses ones on 8000/5173.
# The whole browser suite is: npm run e2e   (screens + journeys + transcripts)
cd frontend && npm run e2e:ci
cd "$PROJECT_ROOT"

echo ""
echo "=== Full verification passed ==="
