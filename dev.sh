#!/usr/bin/env bash
set -euo pipefail

# Acquire Game - Local Development Script
# Usage: ./dev.sh <command>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
VENV_DIR="$SCRIPT_DIR/venv"
NODE_VERSION="v20.19.0"
NODE_DIR="$HOME/.local"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Activate virtual environment if it exists
activate_venv() {
    if [ -d "$VENV_DIR" ]; then
        source "$VENV_DIR/bin/activate"
    else
        warn "Virtual environment not found. Run './dev.sh setup' first."
        exit 1
    fi
}

# Ensure Node.js is available
ensure_node() {
    export PATH="$NODE_DIR/bin:$PATH"
    if ! command -v node &> /dev/null; then
        error "Node.js not found. Run './dev.sh setup' first."
    fi
}

# Install Node.js if not present
install_node() {
    export PATH="$NODE_DIR/bin:$PATH"
    if command -v node &> /dev/null; then
        info "Node.js already installed: $(node --version)"
        return 0
    fi

    info "Installing Node.js ${NODE_VERSION}..."
    local tmp_dir
    tmp_dir=$(mktemp -d)
    cd "$tmp_dir"

    curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" -o node.tar.xz
    tar -xf node.tar.xz

    mkdir -p "$NODE_DIR"
    cp -r "node-${NODE_VERSION}-linux-x64/bin" "$NODE_DIR/"
    cp -r "node-${NODE_VERSION}-linux-x64/lib" "$NODE_DIR/"
    cp -r "node-${NODE_VERSION}-linux-x64/share" "$NODE_DIR/" 2>/dev/null || true

    cd "$SCRIPT_DIR"
    rm -rf "$tmp_dir"

    info "Node.js installed: $(node --version)"
    info "npm installed: $(npm --version)"
}

cmd_setup() {
    info "Setting up development environment..."

    # Python setup
    if [ ! -d "$VENV_DIR" ]; then
        info "Creating virtual environment..."
        python3 -m venv "$VENV_DIR"
    fi

    source "$VENV_DIR/bin/activate"

    info "Upgrading pip..."
    pip install --upgrade pip

    info "Installing Python dependencies..."
    pip install -r "$BACKEND_DIR/requirements.txt"

    info "Installing development tools..."
    pip install ruff

    # Node.js setup
    install_node

    # Frontend setup
    info "Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm install)

    info "Setup complete!"
    info ""
    info "To start development servers, run: ./dev.sh dev"
}

cmd_test() {
    activate_venv
    info "Running tests with coverage..."
    cd "$BACKEND_DIR"
    pytest --cov=game --cov=session --cov-report=term-missing -v "$@"
}

cmd_test_quick() {
    activate_venv
    info "Running tests (no coverage)..."
    cd "$BACKEND_DIR"
    pytest -v "$@"
}

cmd_lint() {
    activate_venv
    info "Running linter..."
    ruff check "$BACKEND_DIR/"

    info "Checking code formatting..."
    ruff format --check "$BACKEND_DIR/"

    info "Lint passed!"
}

cmd_format() {
    activate_venv
    info "Formatting code..."
    ruff format "$BACKEND_DIR/"
    ruff check --fix "$BACKEND_DIR/"
    info "Formatting complete!"
}

cmd_serve() {
    activate_venv
    info "Starting development server..."
    cd "$BACKEND_DIR"
    uvicorn main:app --reload --host 0.0.0.0 --port "${PORT:-8000}"
}

cmd_docker_build() {
    info "Building Docker image..."
    docker build -t acquire-game -f "$SCRIPT_DIR/deploy/Dockerfile" "$SCRIPT_DIR"
    info "Docker image built: acquire-game"
}

cmd_docker_run() {
    info "Running Docker container..."
    docker run -it --rm -p "${PORT:-8000}:8000" acquire-game
}

cmd_ci() {
    info "Running full CI checks (lint + test)..."
    cmd_lint
    cmd_test
    info "All CI checks passed!"
}

cmd_dev() {
    info "Starting full development environment..."

    # Ensure Node.js is available
    ensure_node

    # Check if frontend dependencies are installed
    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        info "Installing frontend dependencies..."
        (cd "$FRONTEND_DIR" && npm install)
    fi

    # Start backend in background
    activate_venv
    info "Starting backend on port 8000..."
    (cd "$BACKEND_DIR" && uvicorn main:app --reload --host 127.0.0.1 --port 8000) &
    BACKEND_PID=$!

    # Start frontend
    info "Starting frontend on port 5173..."
    (cd "$FRONTEND_DIR" && npm run dev) &
    FRONTEND_PID=$!

    # Trap to kill both on exit
    trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

    info "Development servers running:"
    info "  Backend:  http://127.0.0.1:8000"
    info "  Frontend: http://127.0.0.1:5173"
    info "Press Ctrl+C to stop both servers"

    wait
}

cmd_help() {
    cat << EOF
Acquire Game - Development Script

Usage: ./dev.sh <command> [options]

Commands:
  setup         Set up Python venv, Node.js, and install all dependencies
  test          Run tests with coverage
  test-quick    Run tests without coverage (faster)
  lint          Run ruff linter and format check
  format        Auto-format code with ruff
  serve         Start development server (default port: 8000)
  dev           Start both backend and frontend servers
  docker-build  Build the Docker image
  docker-run    Run the Docker container
  ci            Run full CI checks (lint + test)
  help          Show this help message

Environment variables:
  PORT          Server port (default: 8000)

Examples:
  ./dev.sh setup              # First-time setup
  ./dev.sh test               # Run all tests with coverage
  ./dev.sh test -k merger     # Run tests matching 'merger'
  ./dev.sh serve              # Start dev server on port 8000
  PORT=3000 ./dev.sh serve    # Start dev server on port 3000
EOF
}

# Main dispatch
case "${1:-help}" in
    setup)       cmd_setup ;;
    test)        shift; cmd_test "$@" ;;
    test-quick)  shift; cmd_test_quick "$@" ;;
    lint)        cmd_lint ;;
    format)      cmd_format ;;
    serve)       cmd_serve ;;
    dev)         cmd_dev ;;
    docker-build) cmd_docker_build ;;
    docker-run)  cmd_docker_run ;;
    ci)          cmd_ci ;;
    help|--help|-h) cmd_help ;;
    *)           error "Unknown command: $1. Run './dev.sh help' for usage." ;;
esac
