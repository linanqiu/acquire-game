# Surface Coverage Map

Every user-visible surface of the app, against the test that exercises it. Defined in
[Epic 11](../roadmap/epics/11-test-pyramid.md) and [TP-006](../roadmap/stories/11-test-pyramid/TP-006.md);
replaces the scenario-id mapping of ST-010.

How to use:

- **Covered by** is `file:test name`. Leave it empty until a passing test exists. An empty cell is a
  visible gap, on purpose.
- **Tier**: `3` = screen test (snapshot start), `4` = journey (home page start), `2` = protocol
  test (no browser; only for non-visual aspects), `unit` = component test only (does not count as
  covered on its own).
- Adding or changing a route, modal, phase screen or error state means adding or changing a row in
  the same commit.
- Coverage is reported as "N of M surfaces covered; K journeys", not as a percentage of lines or
  scenarios.

Source of the list (as of 2026-11-14): `frontend/src/App.tsx` (routes), `frontend/src/pages/*.tsx`,
`frontend/src/components/game/`. Surfaces marked "(planned)" are required by Epics 9-11 but do not
exist in the UI yet.

## 1. Routes

| ID | Surface | How to reach | Covered by | Tier |
|----|---------|--------------|------------|------|
| R-01 | `/` Home / lobby page (`LobbyPage`) | Open the app | | 4 |
| R-02 | `/play/:room` Player page (`PlayerPage`) | Create or join a game | | 4 |
| R-03 | `/host/:room` Host/spectator page (`HostPage`) | "Watch bots play" | | 4 |
| R-04 | `*` Not-found page (`NotFoundPage`, "Back to Lobby" link) | Navigate to an unknown URL | | 3 |

## 2. Home page entry points (`LobbyPage`)

| ID | Surface | Test id / control | Covered by | Tier |
|----|---------|-------------------|------------|------|
| H-01 | Create game: name input + CREATE | `create-name-input`, `create-button` | | 4 |
| H-02 | Join game: name + room code + JOIN | `join-name-input`, `join-room-input`, `join-button` | | 4 |
| H-03 | Watch bots play (spectator room) | `watch-bots-button` | | 4 |
| H-04 | Create validation error (empty name) | `create-name-input` error | | 4 |
| H-05 | Join error: bad room code | `join-room-input` error | | 4 |
| H-06 | Join error: duplicate name | toast / inline error | | 4 |
| H-07 | Join error: full room | toast / inline error | | 4 |
| H-08 | Join error: game already started | toast / inline error | | 4 |
| H-09 | Create/spectator failure toast (server error) | toast | | 3 |

## 3. Player page: lobby (`/play/:room`, phase `lobby`)

| ID | Surface | Notes | Covered by | Tier |
|----|---------|-------|------------|------|
| PL-01 | Player lobby: room code, player list, "WAITING FOR HOST" | | | 4 |
| PL-02 | Add AI control (catalog list; today "+ ADD BOT") | LO-005 | | 4 |
| PL-03 | Add AI: unavailable catalog entry shown disabled (planned) | LO-005 | | 3 |
| PL-04 | Remove AI seat in lobby (planned) | LO-005 | | 3 |
| PL-05 | START GAME enabled only with enough players (`canStart`) | | | 3 |
| PL-06 | Add/start failure toast ("Failed to add bot", "Failed to start game") | | | 3 |

## 4. Player page: game phase screens (`/play/:room`)

| ID | Surface | Phase / state | Covered by | Tier |
|----|---------|---------------|------------|------|
| PG-01 | Place tile: tile rack, board, PLACE TILE button (`place-tile-button`) | `place_tile`, my turn | | 3 |
| PG-02 | Place tile: tile selected, button enabled | | | 3 |
| PG-03 | Place tile: unplayable/dead tiles shown | BL-006 | | 3 |
| PG-04 | Found chain: `ChainSelector` | `found_chain` | | 3 |
| PG-05 | Merger: choose surviving chain | `pendingMergerChoice` | | 3 |
| PG-06 | Merger: stock disposition (`MergerDisposition`, `StockStepper`) | `stock_disposition` | | 3 |
| PG-07 | Merger: disposition shown when not my turn | `pendingStockDisposition` | | 3 |
| PG-08 | Buy stocks: stepper, cost, "Not enough cash", "Maximum 3 shares" | `buy_stocks` | | 3 |
| PG-09 | End turn button (`end-turn-button`) | buy phase | | 3 |
| PG-10 | End game button (`end-game-button`) | when declarable | | 3 |
| PG-11 | Waiting for another player ("Waiting for X to place a tile") | not my turn | | 3 |
| PG-12 | Thinking indicator while an AI seat decides (planned) | LO-005 | | 3 |
| PG-13 | Players panel (cash and stock badges per player, YOU badge) | all game phases | | 3 |
| PG-14 | Portfolio strip and cash/price header (`PageShell`, `Portfolio`) | all game phases | | 3 |
| PG-15 | Game over (`GameOver`) on player page, scores, winner | `game_over` | | 4 |
| PG-16 | Play again (`GameOver` PLAY AGAIN button -> `handlePlayAgain`) | after game over | | 4 |

## 5. Player page: modals and trading

| ID | Surface | Notes | Covered by | Tier |
|----|---------|-------|------------|------|
| TR-01 | Propose Trade modal (`Modal` + `TradeBuilder`) | opened from buy phase | | 3 |
| TR-02 | Trade builder validation (cannot offer what you do not hold) | | | 3 |
| TR-03 | Incoming trade offer with accept/reject (**no UI found in frontend as of 2026-11-14; needed for LO-004 and the trade journey**) | gap: create story | | 3 |
| TR-04 | Trade accepted/rejected notification (planned) | | | 3 |
| TR-05 | Trade with an LLM or scripted seat end to end | | | 4 |

## 6. Host / spectator page (`/host/:room`)

| ID | Surface | Notes | Covered by | Tier |
|----|---------|-------|------------|------|
| HO-01 | Host lobby: "WAITING FOR PLAYERS", player list | | | 4 |
| HO-02 | Host lobby: add AI control, START GAME | | | 4 |
| HO-03 | Host in-game view: board (`Board`, large), player cards (`PlayerCard`), chains | | | 4 |
| HO-04 | Host: merger in progress | | | 3 |
| HO-05 | Host: thinking indicator (planned) | LO-005 | | 3 |
| HO-06 | Host: game over (`GameOver`) | | | 4 |
| HO-07 | Host: activity log / "Waiting for players..." messages | | | 3 |
| HO-08 | Host: start/add failure toast | | | 3 |

## 7. Connection and error states

| ID | Surface | Notes | Covered by | Tier |
|----|---------|-------|------------|------|
| CN-01 | "Connection error. Please refresh the page." + REFRESH (player) | `connectionStatus === 'error'` | | 3 |
| CN-02 | Same connection-error screen (host) | | | 3 |
| CN-03 | `ReconnectionOverlay` while reconnecting (**not mounted in any page as of 2026-11-14; verify**) | | | 3 |
| CN-04 | `ReconnectedToast` after reconnect (**not mounted; verify**) | | | 3 |
| CN-05 | Page refresh mid-game restores state (player) | sessionStorage credentials | | 4 |
| CN-06 | Page refresh mid-game restores state (host) | | | 4 |
| CN-07 | Server error message toast from WebSocket (`useErrorHandler`) | e.g. illegal action | | 3 |
| CN-08 | Player page opened with bad room code / no credentials | | | 4 |
| CN-09 | Toast container: success / error / info variants (`Toast`) | | | 3 |

## 8. Game components (visual states; each must appear in a covered screen above)

| Component | States to see on screen | Seen in surface IDs | Covered by |
|-----------|-------------------------|---------------------|------------|
| `Board` | empty, tiles placed, chains coloured, playable highlight, size md/lg | PG-01, HO-03 | |
| `Tile` | empty, in rack, selected, placed, dead/unplayable | PG-01..03 | |
| `TileRack` | enabled, disabled (not my turn), selection | PG-01, PG-11 | |
| `ChainMarker` | each of 7 chains, safe marker | PG-04, PG-13 | |
| `ChainSelector` | available chains only | PG-04 | |
| `MergerDisposition` / `StockStepper` | sell/trade/hold limits, trade max by survivor stock | PG-06 | |
| `Portfolio` | holdings with prices, zero holdings | PG-14 | |
| `PlayerCard` | current turn, bot/LLM badge (planned) | HO-03 | |
| `TradeBuilder` | stocks and money both ways, player picker | TR-01 | |
| `GameOver` | final scores, winner, ties | PG-15, HO-06 | |
| `ReconnectionOverlay`, `ReconnectedToast` | see CN-03, CN-04 | CN-03, CN-04 | |

## Known gaps found while building this map (2026-11-14)

- No incoming-trade-offer UI exists in the frontend (`TR-03`). LO-004 and the trade journey need
  one; a story should be created if the LLM/frontend agents have not already added it.
- `ReconnectionOverlay` and `ReconnectedToast` exist as components but are not rendered by any
  page (`CN-03`, `CN-04`). Confirm and either mount them or drop the rows.

## Summary (update when rows change)

- Surfaces listed: see rows above
- Covered: 0 (skeleton)
- Journeys: 0 of ~6 planned (TP-005)
