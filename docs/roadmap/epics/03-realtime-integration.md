# Epic 3: Real-time Integration

## Overview

Connect the React frontend to the FastAPI backend via WebSocket. Handle state synchronization, optimistic updates, reconnection, and error recovery.

## Goals

- Establish WebSocket connection to backend
- Manage game state in frontend store
- Handle all message types from backend
- Implement reconnection with state recovery
- Provide optimistic updates for responsiveness

## Tech Stack

- **WebSocket**: Native WebSocket API
- **State Management**: Zustand
- **Testing**: Vitest + Playwright e2e

## Stories

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [RT-001](../stories/03-realtime-integration/RT-001.md) | WebSocket Client | M | FF-001 | not-started |
| [RT-002](../stories/03-realtime-integration/RT-002.md) | State Store | M | FF-001 | not-started |
| [RT-003](../stories/03-realtime-integration/RT-003.md) | Message Handlers | M | RT-001, RT-002 | not-started |
| [RT-004](../stories/03-realtime-integration/RT-004.md) | Optimistic Updates | M | RT-002, RT-003 | not-started |
| [RT-005](../stories/03-realtime-integration/RT-005.md) | Reconnection Logic | M | RT-001, RT-003 | not-started |
| [RT-006](../stories/03-realtime-integration/RT-006.md) | Error Handling | S | RT-003, FF-009 | not-started |

## Dependency Graph

```
FF-001
   ├── RT-001 (WebSocket Client)
   └── RT-002 (State Store)
         │
         └──┬── RT-003 (Message Handlers)
            │      │
            │      ├── RT-004 (Optimistic Updates)
            │      ├── RT-005 (Reconnection)
            │      └── RT-006 (Error Handling)
            │
            └── Required by GU-012, GU-013
```

## Message Types

Based on existing backend (`backend/main.py`):

> **Note**: Always verify actual message types in `main.py` before implementing. This documentation may be outdated.

### Client → Server (action field)
- `place_tile` - Place a tile on the board
- `found_chain` - Choose chain name when founding
- `merger_choice` - Pick merger survivor chain
- `merger_disposition` - Handle defunct shares (sell/trade/keep)
- `buy_stocks` - Purchase stocks (up to 3)
- `end_turn` - Complete turn and draw tile
- `add_bot` - Add AI player (lobby only)
- `start_game` - Host starts the game
- `end_game` - Force game end (lobby or when allowed)
- `declare_end_game` - Trigger game end during play
- `propose_trade` - Start trade offer
- `accept_trade` - Accept pending trade
- `reject_trade` - Decline pending trade
- `cancel_trade` - Cancel own trade offer

### Server → Client (type field)
- `game_state` - Full public state update
- `lobby_update` - Lobby state (players, bots, started)
- `error` - Error message with details
- `choose_chain` - Prompt to pick chain for founding
- `choose_merger_survivor` - Prompt to pick surviving chain
- `stock_disposition_required` - Prompt to handle defunct shares
- `can_end_game` - Notify player can declare game end
- `all_tiles_unplayable` - Player has no playable tiles
- `tiles_replaced` - Unplayable tiles were replaced
- `trade_proposed` - Incoming trade offer
- `trade_accepted` - Trade was accepted
- `trade_rejected` - Trade was declined
- `trade_canceled` - Trade was canceled
- `game_over` - Final results with scores and winner

## Success Criteria

- [ ] WebSocket connects and authenticates
- [ ] All message types handled correctly
- [ ] State store updates reactively
- [ ] Optimistic updates feel instant (<100ms)
- [ ] Reconnection recovers within 5 seconds
- [ ] Errors display via toast system
- [ ] E2E tests: full game flow with real backend

## Reference

- [Backend main.py](../../backend/main.py) - WebSocket endpoints
- [Backend game.py](../../backend/game/game.py) - Game state structure
