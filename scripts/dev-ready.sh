#!/bin/bash
# Ensure development environment is ready for agentic testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Install Playwright browser if needed
echo "Checking Playwright browser..."
if ! npx playwright install --dry-run chromium 2>&1 | grep -q "already installed"; then
  echo "Installing Playwright browser..."
  cd frontend && npx playwright install chromium
  cd "$PROJECT_ROOT"
fi
echo "✓ Playwright browser: OK"

# Start backend if not running
if ! curl -s http://127.0.0.1:8000/docs > /dev/null 2>&1; then
  echo "Starting backend..."
  cd backend && python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 &
  cd "$PROJECT_ROOT"
  sleep 2
fi

# Start frontend if not running
if ! curl -s http://127.0.0.1:5173 > /dev/null 2>&1; then
  echo "Starting frontend..."
  cd frontend && npm run dev -- --host 127.0.0.1 &
  cd "$PROJECT_ROOT"
  sleep 3
fi

# Verify both are up
echo ""
echo "Verifying services..."
if curl -s http://127.0.0.1:8000/docs > /dev/null 2>&1; then
  echo "✓ Backend:  http://127.0.0.1:8000"
else
  echo "✗ Backend: FAILED"
  exit 1
fi

if curl -s http://127.0.0.1:5173 > /dev/null 2>&1; then
  echo "✓ Frontend: http://127.0.0.1:5173"
else
  echo "✗ Frontend: FAILED"
  exit 1
fi

echo ""
echo "Dev environment ready!"
