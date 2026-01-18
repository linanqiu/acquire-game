# Acquire Board Game

A web-based implementation of the classic 1999 Acquire board game with a "couch co-op" architecture.

## Architecture

- **Host display** (laptop/TV): Shows shared board state visible to all players
- **Player devices** (phones): Private views for tiles, stocks, and actions
- **Bot players**: AI opponents to fill empty seats

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | Python + FastAPI |
| Frontend | Vanilla HTML/CSS/JS |
| Real-time | WebSockets |
| Session | In-memory |

## Project Structure

```
acquire/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── game/
│   │   ├── board.py         # Board state and tile logic
│   │   ├── player.py        # Player state (money, stocks, tiles)
│   │   ├── hotel.py         # Hotel chain logic
│   │   ├── rules.py         # Game rules and validation
│   │   ├── game.py          # Game orchestration
│   │   └── bot.py           # AI player logic
│   ├── session/
│   │   └── manager.py       # Room/game session management
│   └── tests/               # Pytest test suite
├── frontend/
│   ├── templates/           # Jinja2 HTML templates
│   └── static/              # CSS and JavaScript
└── README.md
```

## Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt

# Run tests
cd backend && pytest

# Start server
uvicorn backend.main:app --reload
```

## Game Rules

Acquire is a tile-laying board game where players:
1. Place tiles on a 12x9 grid to form hotel chains
2. Buy stocks in hotel chains
3. Merge chains (larger absorbs smaller) and receive bonuses
4. Win by having the most money when the game ends

### End Game Conditions
- One chain reaches 41+ tiles
- All active chains are "safe" (11+ tiles)
- All 7 chains are on the board and cannot merge

## Development

```bash
# Run tests with coverage
pytest --cov=game --cov-report=html

# Run specific test file
pytest tests/test_board.py -v
```

## License

MIT
