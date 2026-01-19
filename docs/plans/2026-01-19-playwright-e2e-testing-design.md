# Playwright E2E Testing Design

**Date:** 2026-01-19
**Status:** Approved
**Goal:** E2E tests that run with `./dev.sh test` and verify the actual game works from a user's perspective.

## Problem

Tests pass but the game is broken. There's a disconnect between what unit tests verify and what "working" means to a real user. The game loads but interactions fail, work partially, or behave inconsistently.

## Solution

Playwright browser automation tests that exercise the full user flow through a real browser, against a real server.

## Test Structure

**Location:** `backend/tests/test_e2e_playwright.py`

**Test progression (each builds on the previous):**

| Test | Description |
|------|-------------|
| `test_01_create_and_join_room` | Create room, join as player, verify game screen loads |
| `test_02_place_first_tile` | Place a tile, verify board updates, verify turn advances |
| `test_03_single_turn_with_bot` | Add bot, complete turn, verify bot responds |
| `test_04_two_player_game` | Two browser contexts simulating two phones |
| `test_05_full_game_to_completion` | Play through merger, stock buying, end-game (marked slow) |

Tests are numbered to run in order. If `test_01` fails, later tests are meaningless.

## Test Mechanics

### Server Fixture

```python
@pytest.fixture(scope="module")
def server():
    # Start uvicorn on random available port
    # Yield the base URL (e.g., http://localhost:54321)
    # Shut down after all tests complete
```

Using `scope="module"` means one server instance for all E2E tests.

### Browser Fixtures

Playwright's pytest plugin provides:
- `page` - single browser tab
- `context` - for multi-tab scenarios (two-player test)

### Waiting Strategy

**No arbitrary sleeps.** Every wait is for a specific condition:
- WebSocket connection established (wait for element that appears after connection)
- Board state updated (wait for tile to appear on board)
- Turn change (wait for "Your turn" or "Waiting for..." indicator)

If the condition never happens, the test fails with a clear error.

### Selectors

Tests use `data-testid` attributes where needed:
- `data-testid="tile-A1"`
- `data-testid="place-tile-btn"`
- `data-testid="room-code"`

Only add these where existing selectors aren't reliable.

## Test Flow Details

### Test 01 - Create and Join Room
1. Open browser to `/lobby`
2. Click "Create Room"
3. Capture room code from URL or display
4. Navigate to player view
5. Enter name, join room
6. **Assert:** Player sees their tiles, host sees player in list

### Test 02 - Place First Tile
1. Fresh room setup
2. On player view, click a tile from hand
3. Click "Place Tile"
4. **Assert:** Tile appears on board (host view)
5. **Assert:** Tile removed from player's hand
6. **Assert:** Turn state advances or prompts for next action

### Test 03 - Single Turn with Bot
1. Create room with 1 human + 1 bot
2. Human places tile, completes any required actions
3. End turn
4. **Assert:** Bot takes its turn automatically
5. **Assert:** Board reflects bot's tile placement
6. **Assert:** It's human's turn again

### Test 04 - Two Player Game
1. Two browser contexts (simulating two phones)
2. Both join same room
3. Players alternate turns
4. **Assert:** Both see consistent board state

### Test 05 - Full Game to Completion
1. Play through multiple turns
2. Trigger at least one merger
3. Complete stock buying phases
4. Play to end-game condition
5. **Assert:** Winner determined, final scores shown

### Shared Helpers

```python
def create_room(page) -> str:
    """Create room and return room code"""

def join_room(page, code: str, name: str):
    """Join existing room as player"""

def place_tile(page, tile_id: str):
    """Place a tile from player's hand"""

def wait_for_turn(page):
    """Wait until it's this player's turn"""
```

## Integration

### Dependencies

Add to `pyproject.toml`:
```
pytest-playwright
```

After install, run once:
```
playwright install chromium
```

### CI Changes

Add to GitHub Actions workflow:
```yaml
- run: playwright install chromium --with-deps
```

### Test Markers

```python
@pytest.mark.slow
def test_05_full_game_to_completion():
    ...
```

Skip slow tests during rapid iteration: `pytest -m "not slow"`

### Failure Debugging

Configure pytest-playwright to save on failure:
- Screenshots: `backend/tests/playwright-results/*.png`
- Traces: `backend/tests/playwright-results/*.zip`

## Changes Required

1. Add `pytest-playwright` to dependencies
2. Add `playwright install chromium` to setup documentation and CI
3. Add `data-testid` attributes to key UI elements in HTML templates
4. Write `backend/tests/test_e2e_playwright.py` with fixtures and helpers
5. Configure playwright result output directory

## Success Criteria

When `./dev.sh test` passes:
- You can create a room and join it
- You can place a tile and see it on the board
- A bot can take its turn
- Two players can interact with the same game
- A full game can be played to completion
