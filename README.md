# Acquire Board Game

A web-based implementation of the classic 1999 Acquire board game with a "couch co-op" architecture.

[![CI](https://github.com/linanqiu/acquire-game/actions/workflows/ci.yml/badge.svg)](https://github.com/linanqiu/acquire-game/actions/workflows/ci.yml)

## Product Vision

**Play Acquire with friends on any device** - One shared board on a TV/laptop, each player uses their phone for private tiles and actions. Add bots to fill empty seats.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Host Display  │     │  Player Phone   │     │  Player Phone   │
│   (TV/Laptop)   │     │   (Private)     │     │   (Private)     │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │              WebSocket Connections            │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    FastAPI Backend      │
                    │  (Game Logic + State)   │
                    └─────────────────────────┘
```

---

## Development Roadmap

### 🎯 MVP Scope
> **Goal:** Fully playable game with rule-based bots, no critical security issues, deployed to cloud.

---

### Phase 1: Core Game Logic ✅
- [x] Board implementation (12x9 grid, 108 tiles)
- [x] Hotel chains (7 chains, 3 pricing tiers)
- [x] Player state (money, stocks, tiles)
- [x] Game rules engine (placement, founding, mergers)
- [x] Rule-based bot AI (easy/medium/hard difficulty)
- [x] Game orchestration (turn flow, state management)
- [x] Unit tests for all game modules

### Phase 2: Server & Real-time ✅
- [x] Session manager (room codes, player connections)
- [x] FastAPI application with HTTP routes
- [x] WebSocket endpoints (host + player)
- [x] Game state broadcasting
- [x] Bot player support in rooms
- [x] Integration tests

### Phase 3: Security Hardening 🎯 MVP
- [ ] Input validation on all WebSocket messages
- [ ] Rate limiting on WebSocket actions
- [ ] Player authentication tokens
- [ ] Proper stock mutation through Player methods

### Phase 4: Frontend Integration 🎯 MVP
- [x] HTML templates (lobby, host, player views)
- [x] CSS styling with responsive design
- [x] JavaScript WebSocket clients
- [x] Host display board grid rendering
- [x] Player tile rack and portfolio UI
- [ ] Wire up tile placement action
- [ ] Wire up chain founding selection
- [ ] Wire up stock buying modal
- [ ] Wire up merger decisions (sell/trade/keep)
- [ ] Wire up end turn / game over

### Phase 5: Deployment 🎯 MVP
- [x] Docker containerization
- [x] GitHub Actions CI pipeline
- [x] Railway configuration
- [ ] Deploy to Railway
- [ ] Verify WebSocket connectivity
- [ ] Basic health monitoring

---

### Post-MVP: AI Training Infrastructure
- [x] Unified action representation (`action.py`)
- [x] Deterministic game seeding and cloning
- [x] Legal action enumeration for RL
- [x] State encoder (game → tensor)
- [x] Training config with curriculum
- [ ] Gymnasium environment wrapper
- [ ] PPO policy network
- [ ] Training pipeline with self-play
- [ ] Neural bot integration

### Post-MVP: Advanced Features
- [x] Player-to-player trading (backend)
- [ ] Trade negotiation UI
- [ ] House rules configuration
- [ ] Persistent game state
- [ ] Spectator mode
- [ ] Game replays

---

## Tech Stack

| Component | Technology | Status |
|-----------|------------|--------|
| Backend | Python 3.12 + FastAPI | ✅ |
| Frontend | Vanilla HTML/CSS/JS | ✅ |
| Real-time | WebSockets | ✅ |
| Session | In-memory | ✅ |
| Testing | pytest + pytest-asyncio | ✅ |
| CI/CD | GitHub Actions | ✅ |
| Container | Docker | ✅ |
| AI Training | NumPy + Config System | 🔄 |
| Deployment | Railway | 📋 |

---

## Quick Start

### Local Development

```bash
# Clone the repo
git clone https://github.com/linanqiu/acquire-game.git
cd acquire-game

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt

# Run tests
cd backend && pytest -v

# Start development server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Access the Game
- **Lobby**: http://localhost:8000
- **Create a room** → Share the 4-letter code
- **Players join** on their phones via the code
- **Host display** shows the shared board

---

## Project Structure

```
acquire/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── conftest.py          # Shared pytest fixtures
│   ├── game/
│   │   ├── board.py         # Board state and tile logic
│   │   ├── player.py        # Player state management
│   │   ├── hotel.py         # Hotel chain logic
│   │   ├── rules.py         # Game rules validation
│   │   ├── game.py          # Game orchestration
│   │   └── bot.py           # AI player logic
│   ├── session/
│   │   └── manager.py       # Room/session management
│   └── tests/
│       ├── test_board.py
│       ├── test_hotel.py
│       ├── test_player.py
│       ├── test_rules.py
│       ├── test_game.py
│       ├── test_bot.py
│       └── test_integration.py
├── frontend/
│   ├── templates/
│   │   ├── lobby.html
│   │   ├── host.html
│   │   └── player.html
│   └── static/
│       ├── css/style.css
│       ├── js/host.js
│       └── js/player.js
├── docs/
│   └── rules/               # Comprehensive game rules
├── deploy/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── railway.toml
└── .github/
    └── workflows/
        └── ci.yml
```

---

## Game Rules

See [docs/rules/](docs/rules/) for comprehensive rules documentation.

**Quick Summary:**
- 2-6 players place tiles on a 12x9 grid
- Adjacent tiles form hotel chains (7 possible chains)
- Players buy stocks in chains (up to 3 per turn)
- Mergers pay bonuses to majority/minority stockholders
- Game ends when any chain reaches 41+ tiles or all chains are "safe" (11+)
- Winner: most cash after selling all stocks

---

## Development

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=game --cov-report=html

# Run specific test file
pytest tests/test_rules.py -v

# Run tests matching pattern
pytest -k "merger" -v
```

---

## Deployment

### Docker

```bash
# Build
docker build -t acquire-game -f deploy/Dockerfile .

# Run
docker run -p 8000:8000 acquire-game
```

### Railway (One-click deploy)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

---

## License

MIT
