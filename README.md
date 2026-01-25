# Acquire Board Game

A digital implementation of the classic Acquire board game with a "couch co-op" architecture designed for local multiplayer.

[![CI](https://github.com/linanqiu/acquire-game/actions/workflows/ci.yml/badge.svg)](https://github.com/linanqiu/acquire-game/actions/workflows/ci.yml)

---

## For AI Agents: Start Here

If you're an AI agent tasked with working on this project:

1. **Read the roadmap** at [`docs/roadmap/README.md`](docs/roadmap/README.md)
2. **Find an unclaimed story** with `Status: not-started` and no blocking dependencies
3. **Mark it `in-progress`** by editing the story file
4. **Complete the acceptance criteria** following the implementation notes
5. **Run verification commands** listed in the story
6. **Mark it `complete`** and commit your changes

Stories are designed for single-session completion. See [Roadmap](#roadmap) for the full breakdown.

---

## Architecture

### Couch Co-op Pattern

Acquire uses a **shared display + private terminals** architecture, similar to Jackbox games:

```
┌─────────────────────────────────────────────────────────────────┐
│                        SHARED DISPLAY                            │
│                      (TV or Laptop)                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              12x9 Game Board                            │    │
│  │   Shows: Tiles, Chains, Public Game State               │    │
│  │   Hidden: Individual player tiles, private info         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Player 1 │  │ Player 2 │  │ Player 3 │  │   Bot    │        │
│  │  $6000   │  │  $4200   │  │  $5100   │  │  $3800   │        │
│  │ 3 stocks │  │ 5 stocks │  │ 2 stocks │  │ 4 stocks │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
         │               │               │
    WebSocket       WebSocket       WebSocket
         │               │               │
┌────────▼───────┐ ┌────▼────────┐ ┌────▼────────┐
│  Player Phone  │ │ Player Phone│ │ Player Phone│
│  (Private)     │ │  (Private)  │ │  (Private)  │
│                │ │             │ │             │
│ ┌────────────┐ │ │ Your tiles: │ │ Your tiles: │
│ │ Your tiles │ │ │  [A1] [B5]  │ │  [C3] [D7]  │
│ │ [A1] [C3]  │ │ │  [E2] [F9]  │ │  [G4] [H8]  │
│ │ [B5] [D7]  │ │ │             │ │             │
│ └────────────┘ │ │ [Buy Stock] │ │ [End Turn]  │
│ [Place Tile]   │ │             │ │             │
└────────────────┘ └─────────────┘ └─────────────┘
```

### Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| **Backend-first development** | Complete, tested game logic before any UI |
| **WebSocket real-time** | Bidirectional communication for instant state sync |
| **Authoritative server** | All game logic runs server-side; clients are dumb terminals |
| **Heuristic bots first** | Rule-based bots (easy/medium/hard) before ML training |
| **React frontend** | Component-based UI with TypeScript for maintainability |
| **Zustand state management** | Lightweight, hooks-based state for React |

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                      Backend (Python)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   FastAPI   │  │   Session   │  │    Game Engine      │ │
│  │  (HTTP/WS)  │──│   Manager   │──│  Board | Rules      │ │
│  │             │  │  (Rooms)    │  │  Player | Hotel     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│                                              │              │
│                                    ┌─────────▼───────────┐ │
│                                    │    Bot Engine       │ │
│                                    │  Easy|Medium|Hard   │ │
│                                    │  (Future: Neural)   │ │
│                                    └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                     WebSocket / HTTP
                            │
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Host View │  │ Player View │  │   State Store       │ │
│  │  (Board,    │  │ (Tiles,     │  │   (Zustand)         │ │
│  │   Scores)   │  │  Actions)   │  │                     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Current Status

### What's Complete

- **Game Engine** (~3600 LOC Python)
  - Full Acquire rules implementation
  - Board, Hotel, Player, Rules modules
  - Three-tier bot AI (easy, medium, hard)
  - Comprehensive test coverage (pytest, 645+ tests)

- **Server Infrastructure**
  - FastAPI with WebSocket support
  - Session/room management (4-letter codes)
  - Bot integration in multiplayer rooms
  - Docker containerization

- **AI Training Foundation**
  - State encoder (game → 750-dim tensor)
  - Training configuration system
  - Deterministic game seeding for reproducibility

- **Frontend Application**
  - React + TypeScript + Vite
  - Full design system (typography, colors, layout)
  - Complete Game UI (lobby, board, player view, host view)
  - All game components (tile rack, stock stepper, chain selector, merger disposition)
  - E2E test infrastructure with Playwright

- **Real-time Integration**
  - WebSocket client with Zustand state management
  - Live game state synchronization
  - Reconnection handling

### What's Planned

See the [Roadmap](#roadmap) for detailed stories:

- **AI Training** - Neural bots (MCTS, decision transformer)
- **Deployment** - Railway setup, monitoring
- **Security Hardening** - CORS, rate limiting, input validation
- **Scenario Tests** - Comprehensive E2E coverage

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Backend | Python 3.12 + FastAPI | Game logic, API, WebSocket |
| Frontend | React + TypeScript + Vite | UI components |
| State | Zustand | Frontend state management |
| Testing | pytest, Playwright | Unit tests, E2E tests |
| Linting | ruff | Format + lint |
| CI/CD | GitHub Actions | Automated checks |
| Container | Docker | Deployment packaging |
| Hosting | Railway | Cloud deployment |

---

## Project Structure

```
acquire/
├── backend/
│   ├── main.py              # FastAPI entry point
│   ├── game/
│   │   ├── board.py         # 12x9 grid, tile placement
│   │   ├── player.py        # Player state, stocks, money
│   │   ├── hotel.py         # Chain logic, pricing tiers
│   │   ├── rules.py         # Legal moves, mergers
│   │   ├── game.py          # Game orchestration
│   │   ├── bot.py           # Heuristic AI (3 levels)
│   │   └── action.py        # Unified action representation
│   ├── session/
│   │   └── manager.py       # Room codes, connections
│   ├── training/            # AI training infrastructure
│   │   ├── state_encoder.py # Game → tensor encoding
│   │   └── config.py        # Training configuration
│   └── tests/               # pytest test suite
├── frontend/                # React application
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/           # Page components (Lobby, Player, Host)
│   │   ├── stores/          # Zustand state stores
│   │   └── styles/          # Design system CSS
├── docs/
│   ├── rules/               # Game rules documentation
│   ├── ui/                  # UI specifications
│   │   ├── storyboard.md    # Screen-by-screen spec
│   │   ├── design-system.md # Colors, typography
│   │   └── components.md    # Component specifications
│   ├── ai/                  # AI training documentation
│   │   └── ROADMAP.md       # Training phases
│   └── roadmap/             # Product roadmap
│       ├── README.md        # Dashboard, how to claim stories
│       ├── epics/           # Epic overviews
│       └── stories/         # Individual stories
└── deploy/
    └── Dockerfile
```

---

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 20+

### Local Development

```bash
# Clone
git clone https://github.com/linanqiu/acquire-game.git
cd acquire-game

# Python environment
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

# Run tests
cd backend && pytest -v

# Start server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Access Points

- **Lobby**: http://localhost:8000
- **Create room** → Get 4-letter code → Share with players
- **Players join** via code on their phones
- **Host display** shows shared board

---

## Roadmap

The product roadmap lives in [`docs/roadmap/`](docs/roadmap/README.md) with:

- **9 Epics**: Backend Hardening, Frontend Foundation, Game UI, Real-time, AI Training, Deployment, Security Hardening, Scenario Tests, Backlog
- **75 Stories**: Each designed for single-session completion
- **Dependency Graph**: Clear parallelization opportunities

### Epic Overview

| Epic | Progress | Status | Notes |
|------|----------|--------|-------|
| [Backend Hardening](docs/roadmap/epics/00-backend-hardening.md) | 13/13 | Complete | Foundation layer |
| [Frontend Foundation](docs/roadmap/epics/01-frontend-foundation.md) | 11/11 | Complete | Design system |
| [Game UI](docs/roadmap/epics/02-game-ui.md) | 16/16 | Complete | All game components |
| [Real-time Integration](docs/roadmap/epics/03-realtime-integration.md) | 5/6 | In Progress | WebSocket core done |
| [AI Training](docs/roadmap/epics/04-ai-training.md) | 0/9 | Not Started | Independent track |
| [Deployment](docs/roadmap/epics/05-deployment.md) | 0/5 | Not Started | Independent track |
| [Security Hardening](docs/roadmap/epics/06-security-hardening.md) | 0/5 | Not Started | Pre-production |
| [Scenario Tests](docs/roadmap/epics/07-scenario-tests.md) | 2/10 | In Progress | E2E coverage |
| [Backlog](docs/roadmap/epics/08-backlog.md) | 0/4 | Not Started | Feature ideas |

### Parallelization

Three tracks can run independently:
1. **Backend → Frontend** (BH → FF → GU → RT)
2. **AI Training** (AI-001 → AI-009)
3. **Deployment** (DP-001 → DP-005)

---

## Collaboration Standards

### Code Quality Requirements

All code must pass CI checks before merge:

```bash
# Format check
ruff format --check .

# Lint check
ruff check .

# Tests with coverage
pytest --cov=game --cov-report=term-missing
```

### Git Workflow

1. **Before committing**: Run `ruff format . && ruff check .`
2. **Commit messages**: Descriptive, imperative mood ("Add tile placement", not "Added")
3. **Branch naming**: `feature/FF-001-project-setup`, `fix/merger-calculation`
4. **PR requirements**: All CI checks pass, tests included for new code

### Testing Standards

**Testing is paramount.** Every feature needs:

1. **Unit tests** (pytest) - Test individual functions/classes
2. **Integration tests** - Test module interactions
3. **E2E tests** (Playwright) - Simulate real user scenarios

```bash
# Run all tests
cd backend && pytest -v

# Run with coverage (aim for >80%)
pytest --cov=game --cov-report=html

# Run specific test
pytest tests/test_rules.py::test_merger_payout -v
```

**E2E Test Philosophy**: Tests should simulate actual user/bot scenarios:
- Player joins room, places tile, buys stock, ends turn
- Host view updates when any player acts
- Bot takes turn within time limit
- Reconnection after disconnect

### Linting & Formatting

We use **ruff** for both:

```bash
# Auto-format
ruff format .

# Lint with auto-fix
ruff check --fix .

# Check only (CI mode)
ruff format --check . && ruff check .
```

Configuration is in `pyproject.toml`. Do not disable rules without team discussion.

---

## Creating New Stories

Before creating a new story, follow this process:

### 1. Check for Scope Creep

Ask yourself (or the product manager):
- Does this directly support the MVP goal?
- Is this a "nice to have" or a "must have"?
- Can we ship without this?

If it's scope creep, document it in a `docs/roadmap/backlog/` file for post-MVP.

### 2. Verify Architecture Alignment

Check with the architect (or review existing decisions):
- Does this fit the couch co-op pattern?
- Does it follow the authoritative server model?
- Will it work with the planned tech stack?

### 3. Write the Story

Use the standard template in [`docs/roadmap/stories/`](docs/roadmap/stories/):

```markdown
# [EPIC-NNN]: [Title]

## Metadata
- **Epic**: [Epic Name]
- **Status**: `not-started`
- **Priority**: `critical` | `high` | `medium` | `low`
- **Effort**: `XS` (<30m) | `S` (30-60m) | `M` (1-2h) | `L` (2-4h)
- **Dependencies**: [List of story IDs or "None"]

## Context
[Why this story exists]

## Requirements
[What must be built]

## Acceptance Criteria
- [ ] [Testable criterion 1]
- [ ] [Testable criterion 2]

## Implementation Notes
[Suggested approach]

## Verification
[Commands to verify completion]
```

### 4. Update Dependencies

If your story blocks or is blocked by others, update both story files.

---

## Game Rules

See [`docs/rules/`](docs/rules/) for comprehensive rules.

**Quick Summary:**
- 3-6 players place tiles on a 12x9 grid
- Adjacent tiles form hotel chains (7 possible)
- Buy stocks in chains (up to 3 per turn)
- Mergers pay bonuses to majority/minority stockholders
- Game ends when any chain reaches 41+ tiles or all are "safe" (11+)
- Winner: most cash after liquidating all stocks

---

## License

MIT
