#!/bin/bash
# Quick verification after a code change (<10s)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "=== Backend Linting ==="
cd backend && ruff check . && ruff format --check .
cd "$PROJECT_ROOT"

echo ""
echo "=== Fast Backend Tests ==="
cd backend && pytest tests/test_board.py tests/test_rules.py -x -q
cd "$PROJECT_ROOT"

echo ""
echo "=== TypeScript Check ==="
cd frontend && npm run typecheck
cd "$PROJECT_ROOT"

echo ""
echo "=== All quick checks passed ==="
