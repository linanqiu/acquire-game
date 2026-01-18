#!/usr/bin/env bash
set -euo pipefail

# Acquire Game - Local Development Script
# Usage: ./dev.sh <command>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
VENV_DIR="$SCRIPT_DIR/venv"

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

cmd_setup() {
    info "Setting up development environment..."

    if [ ! -d "$VENV_DIR" ]; then
        info "Creating virtual environment..."
        python3 -m venv "$VENV_DIR"
    fi

    source "$VENV_DIR/bin/activate"

    info "Upgrading pip..."
    pip install --upgrade pip

    info "Installing dependencies..."
    pip install -r "$BACKEND_DIR/requirements.txt"

    info "Installing development tools..."
    pip install ruff

    info "Setup complete!"
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

cmd_help() {
    cat << EOF
Acquire Game - Development Script

Usage: ./dev.sh <command> [options]

Commands:
  setup         Create virtual environment and install dependencies
  test          Run tests with coverage
  test-quick    Run tests without coverage (faster)
  lint          Run ruff linter and format check
  format        Auto-format code with ruff
  serve         Start development server (default port: 8000)
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
    docker-build) cmd_docker_build ;;
    docker-run)  cmd_docker_run ;;
    ci)          cmd_ci ;;
    help|--help|-h) cmd_help ;;
    *)           error "Unknown command: $1. Run './dev.sh help' for usage." ;;
esac
