# Acquire Board Game - Code Review Report

**Review Date:** 2026-01-18
**Reviewer:** Senior Code Reviewer / Software Architect
**Codebase:** `/home/linan/acquire`

---

## Executive Summary

The Acquire board game codebase is generally well-structured with good separation of concerns between game logic, session management, and API layers. The code demonstrates thoughtful design with proper type hints and comprehensive docstrings. However, there are several issues that should be addressed before production deployment.

**Overall Assessment:** Good foundation, needs security hardening and some architectural improvements.

---

## Issues by Severity

### Critical Issues

#### 1. Direct Private Attribute Mutation Bypasses Business Logic
**File:** `/home/linan/acquire/backend/game/game.py`
**Lines:** 388, 449, 558-559, 740

**Description:**
Multiple locations directly modify player's private `_stocks` dictionary, bypassing the `Player` class methods that include validation (e.g., max stock limits, money checks).

```python
# Line 388 in game.py
player._stocks[chain_name] += 1  # Founder bonus

# Lines 558-559 in game.py
player._stocks[defunct] -= trade
player._stocks[survivor] += trade_for

# Line 740 in game.py
player._stocks[chain_name] = 0
```

**Impact:** Could allow players to exceed the 25-stock-per-chain limit or create inconsistent state.

**Suggested Fix:**
Add proper methods to `Player` class for these operations:
```python
# In Player class
def add_stocks(self, chain_name: str, quantity: int) -> bool:
    """Add stocks with validation."""
    if self._stocks[chain_name] + quantity > self.MAX_STOCKS_PER_CHAIN:
        return False
    self._stocks[chain_name] += quantity
    return True
```

---

#### 2. No Rate Limiting on WebSocket Actions
**File:** `/home/linan/acquire/backend/main.py`
**Lines:** 223-268

**Description:**
The `handle_player_action` function processes WebSocket messages without any rate limiting. A malicious client could flood the server with actions.

```python
async def handle_player_action(room_code: str, player_id: str, data: dict):
    """Process player actions and broadcast updates."""
    # No rate limiting - processes every message immediately
    action = data.get("action")
    ...
```

**Impact:** Potential denial-of-service attack vector.

**Suggested Fix:**
Implement per-connection rate limiting using a token bucket or sliding window approach.

---

#### 3. No Input Validation on WebSocket Messages
**File:** `/home/linan/acquire/backend/main.py`
**Lines:** 231-268

**Description:**
The WebSocket message handler trusts all incoming data without proper validation. For example:
- `tile_str` from `data.get("tile")` is passed directly to `Tile.from_string`
- `chain_name` from `data.get("chain")` is used without validating it's a real chain
- `purchases` dict structure is not validated

```python
if action == "place_tile":
    tile_str = data.get("tile")
    if tile_str:  # Only checks if truthy, not if valid
        await handle_place_tile(room_code, player_id, tile_str)
```

**Impact:** Could cause unhandled exceptions or unexpected behavior.

**Suggested Fix:**
Add a validation layer using Pydantic models:
```python
from pydantic import BaseModel, validator

class PlaceTileAction(BaseModel):
    action: str
    tile: str

    @validator('tile')
    def validate_tile(cls, v):
        # Validate tile format
        if not re.match(r'^1?[0-9][A-I]$', v.upper()):
            raise ValueError('Invalid tile format')
        return v.upper()
```

---

#### 4. Missing Authentication on Player Actions
**File:** `/home/linan/acquire/backend/main.py`
**Lines:** 204-228

**Description:**
The player WebSocket endpoint only verifies that the `player_id` exists in the room, but doesn't verify that the WebSocket connection actually belongs to that player. Any client that knows a player_id could potentially impersonate them.

```python
@app.websocket("/ws/player/{room_code}/{player_id}")
async def player_websocket(websocket: WebSocket, room_code: str, player_id: str):
    # Only checks if player_id exists, not that it's authorized
    if player_id not in room.players:
        await websocket.close(code=4004, reason="Player not found")
        return
```

**Impact:** Player impersonation vulnerability.

**Suggested Fix:**
Implement session tokens or JWT authentication for WebSocket connections.

---

### Important Issues

#### 5. Duplicate Game Initialization Logic
**File:** `/home/linan/acquire/backend/main.py` vs `/home/linan/acquire/backend/game/game.py`
**Lines:** main.py: 270-310, game.py: 119-141

**Description:**
Game initialization logic is duplicated between `main.py:initialize_game()` and `game.py:Game.start_game()`. This creates two different code paths for starting games.

```python
# main.py - initialize_game()
board = Board()
hotel = Hotel()
tile_pool = Board.all_tiles()
random.shuffle(tile_pool)
...

# game.py - start_game()
self.tile_bag = Board.all_tiles()
self.rng.shuffle(self.tile_bag)
...
```

**Impact:** Maintenance burden, potential for drift between implementations, inconsistent behavior.

**Suggested Fix:**
Remove `initialize_game()` from `main.py` and use `Game.start_game()` exclusively.

---

#### 6. Missing Atomic Trade Execution
**File:** `/home/linan/acquire/backend/game/game.py`
**Lines:** 863-870

**Description:**
Trade execution is not atomic. If one part fails, the state could be left inconsistent:

```python
# Execute the trade atomically - but this isn't truly atomic!
from_player.execute_trade_give(trade.offering_stocks, trade.offering_money)
to_player.execute_trade_give(trade.requesting_stocks, trade.requesting_money)
# If this line fails, from_player has lost resources but to_player still has theirs

to_player.execute_trade_receive(trade.offering_stocks, trade.offering_money)
from_player.execute_trade_receive(trade.requesting_stocks, trade.requesting_money)
```

**Impact:** Race conditions or partial failures could leave game in inconsistent state.

**Suggested Fix:**
Implement proper transaction semantics with rollback capability:
```python
def execute_trade_atomic(self, from_player, to_player, trade):
    # Snapshot state
    from_state = from_player.get_state()
    to_state = to_player.get_state()
    try:
        # Execute trade
        ...
    except Exception:
        # Rollback
        from_player.restore_state(from_state)
        to_player.restore_state(to_state)
        raise
```

---

#### 7. Unbounded Pending Actions Storage
**File:** `/home/linan/acquire/backend/game/game.py`
**Lines:** 64, 786-826

**Description:**
While there's a limit of 5 pending trades per player, the `pending_trades` dict itself has no global limit. With many players, this could grow large.

**Impact:** Memory consumption could grow unbounded in extreme cases.

**Suggested Fix:**
Add a global limit on total pending trades.

---

#### 8. Silent Exception Swallowing in WebSocket Broadcasting
**File:** `/home/linan/acquire/backend/session/manager.py`
**Lines:** 151-157, 168-173, 180-185

**Description:**
Exceptions during WebSocket broadcasting are caught and silently ignored:

```python
try:
    await player.websocket.send_json(message)
except Exception:
    # Handle disconnected websocket
    player.websocket = None  # No logging!
```

**Impact:** Debugging production issues becomes difficult.

**Suggested Fix:**
Add logging for exceptions:
```python
import logging
logger = logging.getLogger(__name__)

except Exception as e:
    logger.warning(f"Failed to send to player {player.player_id}: {e}")
    player.websocket = None
```

---

#### 9. Clone Method Missing Deep Copy of pending_action Tile
**File:** `/home/linan/acquire/backend/game/game.py`
**Lines:** 1258

**Description:**
The `clone()` method does a shallow dict copy of `pending_action`, but if it contains a `Tile` object (as in founding chain scenarios), that object reference is shared:

```python
new_game.pending_action = dict(self.pending_action) if self.pending_action else None
```

**Impact:** Modifications to the cloned game's pending_action tile could affect the original game.

**Suggested Fix:**
Deep copy or recreate the entire pending_action structure.

---

#### 10. No Cleanup of Abandoned Rooms
**File:** `/home/linan/acquire/backend/session/manager.py`

**Description:**
Rooms are never cleaned up after all players disconnect. If players abandon games, the rooms persist in memory.

**Impact:** Memory leak over time.

**Suggested Fix:**
Implement a background task that periodically removes rooms with no connected players after a timeout.

---

### Minor Issues

#### 11. Inconsistent Error Return Patterns
**File:** `/home/linan/acquire/backend/game/game.py`

**Description:**
Some methods return `{"success": False, "error": "..."}` while others return `{"error": "..."}`. For example, `get_player_state()` returns `{"error": "Player not found"}` without a success field.

**Lines:** 1135 vs 239

**Suggested Fix:**
Standardize on always including `success` field in all return dicts.

---

#### 12. Magic Numbers in Bot Logic
**File:** `/home/linan/acquire/backend/game/bot.py`
**Lines:** 104, 111, 129-131, 165-166

**Description:**
Many hardcoded scoring constants without explanation:

```python
score += 100  # What does 100 represent?
score += 50 + stock_count * 5  # Why these numbers?
if self.player.money < 1500:  # Why 1500?
```

**Suggested Fix:**
Extract to named constants with documentation.

---

#### 13. Missing Type Hints in Some Functions
**File:** `/home/linan/acquire/backend/main.py`
**Lines:** 231, 270, 313, etc.

**Description:**
Many async functions lack return type hints:

```python
async def handle_player_action(room_code: str, player_id: str, data: dict):
    # Missing -> None or -> dict return type
```

**Suggested Fix:**
Add complete type annotations.

---

#### 14. Potential O(n) Lookups in Hot Paths
**File:** `/home/linan/acquire/backend/game/game.py`
**Lines:** 171-176

**Description:**
`get_player()` iterates through all players to find one by ID:

```python
def get_player(self, player_id: str) -> Optional[Player]:
    for player in self.players:
        if player.player_id == player_id:
            return player
    return None
```

**Impact:** With 6 players this is trivial, but the pattern is inefficient.

**Suggested Fix:**
Use a dict for player lookup:
```python
self.players_by_id: dict[str, Player] = {}
```

---

#### 15. Board State Serialization Includes Non-Empty Cells Only
**File:** `/home/linan/acquire/backend/game/board.py`
**Lines:** 181-190

**Description:**
`get_state()` only includes non-empty cells, which is efficient but could cause issues if code assumes all cells are present in the dict.

**Suggested Fix:**
Document this behavior clearly or consider including all cells in some contexts.

---

### Suggestions for Future Improvements

#### 16. Consider Event Sourcing for Game State
**Description:**
The current approach mutates state directly. Event sourcing would provide better auditability and enable replay functionality:

```python
class GameEvent:
    pass

class TilePlaced(GameEvent):
    tile: Tile
    player_id: str
    timestamp: datetime

class Game:
    def apply_event(self, event: GameEvent):
        ...

    def get_events(self) -> list[GameEvent]:
        ...
```

---

#### 17. Add Structured Logging
**Description:**
The codebase has no logging. Adding structured logging would greatly improve observability.

---

#### 18. Consider Using Dataclasses or Pydantic for State Objects
**Description:**
Using dataclasses with `frozen=True` or Pydantic models for game state would provide:
- Automatic validation
- Immutability where appropriate
- Better serialization

---

#### 19. Add WebSocket Heartbeat/Ping-Pong
**Description:**
No heartbeat mechanism exists to detect stale connections. FastAPI WebSockets support ping/pong frames.

---

#### 20. Consider Database Persistence
**Description:**
All game state is in-memory. For production:
- Games don't survive server restarts
- Can't scale horizontally

Consider using Redis for session state or PostgreSQL for game persistence.

---

## Test Coverage Analysis

### Well-Tested Areas:
- Board logic (`test_board.py`) - Comprehensive tile and chain operations
- Rules validation (`test_rules.py`) - Excellent coverage of game rules
- Player operations (`test_player.py`) - Good coverage of player state
- Hotel/chain logic (`test_hotel.py`) - Complete pricing and state tests
- Bot AI (`test_bot.py`) - Good coverage of decision-making
- Game flow (`test_game.py`) - Good integration tests

### Test Coverage Gaps:

1. **No tests for `game.py` clone() and from_state()** - Critical for AI training
2. **No tests for concurrent trade operations** - Race condition scenarios
3. **No tests for WebSocket reconnection handling**
4. **No tests for malformed WebSocket messages** - Security testing
5. **No load/stress tests** - Performance under many concurrent games
6. **No tests for the trading feature in `main.py`** - Trade actions via WebSocket
7. **Missing edge case tests:**
   - What happens when tile_bag is empty during draw?
   - Player disconnection during their turn
   - Multiple simultaneous merger scenarios

---

## Architecture Review

### Strengths:
1. **Clear separation**: Game logic is well-isolated from API layer
2. **Reproducibility**: Seeded random for deterministic tests
3. **State serialization**: Good support for save/load via `get_state()`/`from_state()`
4. **Bot abstraction**: Clean AI player interface

### Concerns:
1. **Circular import risk**: `game.py` imports from `action.py`, `action.py` defines `TradeOffer` used by `game.py`
2. **God class tendency**: `Game` class is very large (1363 lines)
3. **Mixed responsibilities in main.py**: Both API handlers and game logic
4. **No dependency injection**: Hard to test components in isolation

### Recommendations:
1. Split `Game` class into smaller components (TurnManager, MergerHandler, TradeManager)
2. Move game logic from `main.py` to appropriate game classes
3. Consider using dependency injection for testing

---

## Security Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Input validation | Partial | Some checks exist but not comprehensive |
| Authentication | Missing | No auth on WebSocket connections |
| Authorization | Partial | Turn-based checks exist |
| Rate limiting | Missing | No protection against DoS |
| Injection prevention | OK | No SQL/command injection vectors |
| Error exposure | Partial | Some detailed errors exposed |
| CORS | Not reviewed | Not in scope |

---

## Performance Considerations

1. **Broadcasting efficiency**: Each game state broadcast sends full state to all clients. Consider delta updates for large games.

2. **Chain size calculation**: `get_chain_size()` iterates all cells. Consider caching chain sizes.

3. **Action generation**: `get_all_legal_actions()` generates all combinations, which could be large during stock buying phase.

4. **Memory per game**: Full game state including all tiles is kept in memory. Acceptable for small scale.

---

## Conclusion

The codebase demonstrates solid software engineering principles with good test coverage and clear organization. The main concerns are:

1. **Security hardening required** - Authentication, input validation, rate limiting
2. **State consistency** - Atomic operations for trades, proper use of Player methods
3. **Code duplication** - Game initialization logic exists in two places
4. **Production readiness** - Logging, room cleanup, persistence

**Recommended priority:**
1. Fix critical security issues (authentication, input validation)
2. Address state consistency issues (direct `_stocks` mutation)
3. Remove code duplication
4. Add logging and monitoring
5. Implement persistence layer

