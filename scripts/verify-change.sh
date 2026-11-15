#!/bin/bash
# Quick verification after a code change (~15s; the fast backend tests run in
# parallel with pytest-xdist)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "=== Backend Linting ==="
cd backend && ruff check . && ruff format --check .
cd "$PROJECT_ROOT"

echo ""
echo "=== Fast Backend Tests ==="
cd backend && pytest tests -x -q -m "not slow" -n auto
cd "$PROJECT_ROOT"

echo ""
echo "=== Surface Coverage Map ==="
python3 scripts/check-surface-coverage.py

echo ""
echo "=== TypeScript Check ==="
cd frontend && npm run typecheck
cd "$PROJECT_ROOT"

echo ""
echo "=== All quick checks passed ==="
