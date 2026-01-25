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
cd backend && pytest tests/ -x
cd "$PROJECT_ROOT"

echo ""
echo "=== E2E Smoke Test ==="
cd frontend && npm run e2e -- --grep "smoke"
cd "$PROJECT_ROOT"

echo ""
echo "=== Full verification passed ==="
