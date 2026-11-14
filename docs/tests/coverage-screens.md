# Screen-test coverage (tier 3)

Maps each surface of [surface-coverage.md](surface-coverage.md) (names copied exactly) to the
tier-3 screen test that exercises it. Tests live in `frontend/tests/e2e/screens/` (Playwright
project `screens`, `npm run e2e:screens`). `surface-coverage.md` itself is not edited here; merge
this into its "Covered by" column when the coverage map is next updated.

Every test starts at the home page (create game through the UI), adds scripted opponent seats,
loads a generated snapshot fixture with the test-mode route, asserts the screen against the
fixture's `expect` block, performs the real interaction through the UI, then plays at least two
more human turns. Shared setup is in `screens/support/` (`startFromSnapshot`, console/pageerror
guard, screenshots in `frontend/test-results/screens/<test>/NN-name.png`).

Notation: `file : test title`. Files are in `frontend/tests/e2e/screens/`.

## 1. Routes

| ID | Surface | Covered by |
|----|---------|------------|
| R-01 | `/` Home / lobby page (`LobbyPage`) | Only as the start of every test (create game). Not asserted as a screen here; tier 4. |
| R-02 | `/play/:room` Player page (`PlayerPage`) | all specs; e.g. `place-tile.spec.ts : opening: empty board, six playable tiles, place one` |
| R-03 | `/host/:room` Host/spectator page (`HostPage`) | `host.spec.ts : host view of a busy mid-game board follows the players turn by turn` |
| R-04 | `*` Not-found page (`NotFoundPage`, "Back to Lobby" link) | `lobby.spec.ts : unknown URL shows the not-found page with a way back` |

## 2. Home page entry points (`LobbyPage`)

| ID | Surface | Covered by |
|----|---------|------------|
| H-01 | Create game: name input + CREATE | Used by every test's setup; failure path in `lobby.spec.ts : failures show a toast: create game, add bot, start game` |
| H-02 | Join game: name + room code + JOIN | not covered (tier 4) |
| H-03 | Watch bots play (spectator room) | `lobby.spec.ts : host/spectator lobby: add AI and start failures show a toast` (uses the button to reach the host lobby) |
| H-04 | Create validation error (empty name) | not covered (tier 4) |
| H-05 | Join error: bad room code | not covered (tier 4) |
| H-06 | Join error: duplicate name | not covered (tier 4) |
| H-07 | Join error: full room | not covered (tier 4) |
| H-08 | Join error: game already started | not covered (tier 4) |
| H-09 | Create/spectator failure toast (server error) | `lobby.spec.ts : failures show a toast: create game, add bot, start game` (create; the spectator-create failure is not covered) |

## 3. Player page: lobby (`/play/:room`, phase `lobby`)

| ID | Surface | Covered by |
|----|---------|------------|
| PL-01 | Player lobby: room code, player list, "WAITING FOR HOST" | `lobby.spec.ts : lobby: AI menu, START GAME needs three seats, removing a seat, then a real game starts` (host view of the lobby: room code, player count, seat badges; the non-host "WAITING FOR HOST" text is not covered) |
| PL-02 | Add AI control (catalog list; today "+ ADD BOT") | `lobby.spec.ts : lobby: AI menu, ...` (ADD AI menu, adding the scripted entry); "+ ADD BOT" in `failures show a toast` |
| PL-03 | Add AI: unavailable catalog entry shown disabled (planned) | `lobby.spec.ts : lobby: AI menu, ...` (unavailable LLM entries disabled with "not configured on this server") |
| PL-04 | Remove AI seat in lobby (planned) | `lobby.spec.ts : lobby: AI menu, ...` |
| PL-05 | START GAME enabled only with enough players (`canStart`) | `lobby.spec.ts : lobby: AI menu, ...` (disabled at 1 and 2 seats, enabled at 3, disabled again after removal, then a real game starts) |
| PL-06 | Add/start failure toast ("Failed to add bot", "Failed to start game") | `lobby.spec.ts : failures show a toast: create game, add bot, start game` |

## 4. Player page: game phase screens (`/play/:room`)

| ID | Surface | Covered by |
|----|---------|------------|
| PG-01 | Place tile: tile rack, board, PLACE TILE button (`place-tile-button`) | `place-tile.spec.ts : opening: empty board, six playable tiles, place one` |
| PG-02 | Place tile: tile selected, button enabled | same test (button absent until a tile is selected, then placing) |
| PG-03 | Place tile: unplayable/dead tiles shown | `place-tile.spec.ts : dead tile in hand: ...`, `place-tile.spec.ts : safe chain on board: ...` (lock/cross, not clickable, reason under the rack, board square cannot select it) |
| PG-04 | Found chain: `ChainSelector` | `found-chain.spec.ts : found chain: only the chains not on the board are offered; founder gets a free share`, `reload.spec.ts : reload while choosing a chain: ...` |
| PG-05 | Merger: choose surviving chain | `merger.spec.ts : merger: tie between two equal chains, human picks the survivor` |
| PG-06 | Merger: stock disposition (`MergerDisposition`, `StockStepper`) | `merger.spec.ts : disposition (human first): ...`, `disposition (trade limited by the bank): ...`, `multi-chain merger: ...`; `reload.spec.ts : reload during a stock disposition: ...` |
| PG-07 | Merger: disposition shown when not my turn | `merger.spec.ts : disposition (trade limited by the bank): ...` (the human disposes while another seat holds the turn); waiting side: `disposition (waiting): another stockholder decides first; ...` and `multi-chain merger: ...` |
| PG-08 | Buy stocks: stepper, cost, "Not enough cash", "Maximum 3 shares" | `buy-phase.spec.ts : buy phase: prices and availability shown, 3-share cap, buy a mix`, `low cash: cannot afford any stock, steppers locked, skipping still works`. The two error strings are no longer reachable from the UI (steppers stop at the 3-share and cash limits); they stay as a fallback. |
| PG-09 | End turn button (`end-turn-button`) | `buy-phase.spec.ts : buy phase: skip buying keeps cash and ends the turn` (and every test's follow-up turns) |
| PG-10 | End game button (`end-game-button`) | `end-game.spec.ts : end game available: END GAME is offered while placing a tile, ...`, `... not declaring keeps the game going, END GAME also shows in the buy phase`, `last turn before game over: declare from the buy phase` |
| PG-11 | Waiting for another player ("Waiting for X to place a tile") | `merger.spec.ts : disposition (waiting): ...` (names the player the engine waits on), `trades.spec.ts : incoming offer while another player is on turn: accept` |
| PG-12 | Thinking indicator while an AI seat decides (planned) | not covered: scripted seats answer within ~50 ms, there is no stable state to look at |
| PG-13 | Players panel (cash and stock badges per player, YOU badge) | `layout.spec.ts : busy three-player-midgame board on desktop ...` (and the other three viewport/fixture combinations); `place-tile.spec.ts : opening: ...` |
| PG-14 | Portfolio strip and cash/price header (`PageShell`, `Portfolio`) | `buy-phase.spec.ts : buy phase: prices and availability shown, ...` (cash and holdings after buying), `merger.spec.ts : disposition (human first): ...` |
| PG-15 | Game over (`GameOver`) on player page, scores, winner | `end-game.spec.ts : game over: standings, single winner, play again returns to the home page`, `game over with a tie: both leaders announced, ranked equally`; `reload.spec.ts : reload on the game-over screen: ...` |
| PG-16 | Play again (`GameOver` PLAY AGAIN button -> `handlePlayAgain`) | `end-game.spec.ts : game over: standings, ...` (returns to the home page) and `game over with a tie: ...` (BACK TO LOBBY) |

## 5. Player page: modals and trading

| ID | Surface | Covered by |
|----|---------|------------|
| TR-01 | Propose Trade modal (`Modal` + `TradeBuilder`) | `trades.spec.ts : propose a trade through the builder: validation, then the offer shows as pending` |
| TR-02 | Trade builder validation (cannot offer what you do not hold) | same test (partner, offer, request messages). The "do not hold" cases cannot be produced through the UI: the steppers are capped at the holding and the cash field clamps. |
| TR-03 | Incoming trade offer with accept/reject | `trades.spec.ts : incoming offer on my turn: accept it, ...`, `... reject it, nothing changes`, `incoming offer while another player is on turn: accept` / `reject`; `reload.spec.ts : reload with a trade offer waiting: ...` |
| TR-04 | Trade accepted/rejected notification (planned) | `trades.spec.ts : outgoing offer: a scripted opponent accepts it` / `rejects it (the default answer)`; "Offer rejected", "Offer canceled", "completed" toasts in the incoming/outgoing tests |
| TR-05 | Trade with an LLM or scripted seat end to end | scripted seat both ways in `trades.spec.ts` (outgoing accepted/rejected, incoming from a scripted proposer); the LLM seat is tier 4 |

Also covered: outgoing offer pending and cancel (`trades.spec.ts : outgoing offer stays pending until cancelled`) and a server refusal shown inside the builder (`trades.spec.ts : server refuses a trade mid-merger: ...`).

## 6. Host / spectator page (`/host/:room`)

| ID | Surface | Covered by |
|----|---------|------------|
| HO-01 | Host lobby: "WAITING FOR PLAYERS", player list | `lobby.spec.ts : host/spectator lobby: ...` (page reached through WATCH BOTS PLAY; lobby text and list only screenshotted, the toast paths are asserted) |
| HO-02 | Host lobby: add AI control, START GAME | `lobby.spec.ts : host/spectator lobby: add AI and start failures show a toast` |
| HO-03 | Host in-game view: board (`Board`, large), player cards (`PlayerCard`), chains | `host.spec.ts : host view of a busy mid-game board follows the players turn by turn` |
| HO-04 | Host: merger in progress | `host.spec.ts : host view of a merger in progress shows the merging state and who the table waits on` |
| HO-05 | Host: thinking indicator (planned) | not covered (see PG-12) |
| HO-06 | Host: game over (`GameOver`) | `host.spec.ts : host view of a finished game shows the full results table` |
| HO-07 | Host: activity log / "Waiting for players..." messages | not covered: the log only holds "Waiting for players..." / "Game started!" and is not asserted |
| HO-08 | Host: start/add failure toast | `lobby.spec.ts : host/spectator lobby: add AI and start failures show a toast` |

Also covered: the host's pending-trades list (`host.spec.ts : host view lists a pending trade between two players`).

## 7. Connection and error states

| ID | Surface | Covered by |
|----|---------|------------|
| CN-01 | "Connection error. Please refresh the page." + REFRESH (player) | not covered: needs the WebSocket handshake to fail (`onerror`); Playwright's WebSocket routing can close a socket but not make it error. Unit test only. |
| CN-02 | Same connection-error screen (host) | not covered, same reason |
| CN-03 | `ReconnectionOverlay` while reconnecting (**mounted in `PlayerPage` and `HostPage` now**) | `connection.spec.ts : connection drops mid-game: reconnecting overlay, then a welcome-back card on the same screen` (player page; the host page's overlay is not exercised) |
| CN-04 | `ReconnectedToast` after reconnect (**mounted in `PlayerPage`**) | same test |
| CN-05 | Page refresh mid-game restores state (player) | `reload.spec.ts : reload while choosing a chain: ...`, `reload during a stock disposition: ...`, `reload with a trade offer waiting: ...`, `reload on the game-over screen: ...` |
| CN-06 | Page refresh mid-game restores state (host) | not covered |
| CN-07 | Server error message toast from WebSocket (`useErrorHandler`) | `trades.spec.ts : server refuses a trade mid-merger: reason shown in the builder and as a toast` (this was broken: see "Product bugs" in the commit message and `useWebSocket.test.tsx`) |
| CN-08 | Player page opened with bad room code / no credentials | not covered (tier 4) |
| CN-09 | Toast container: success / error / info variants (`Toast`) | seen across the suite (success: created/sent/accepted, error: failure and refusal toasts, info: canceled/rejected, warning: your offer rejected) but no dedicated test |

## 8. Game components

| Component | Covered by |
|-----------|------------|
| `Board` | `place-tile.spec.ts` (playable highlight, blocked squares), `layout.spec.ts` (md board on desktop and phone, every column in view), `host.spec.ts` (large board) |
| `Tile` | `place-tile.spec.ts` (default, selected, lock, cross); merger-triggering tile marker `!!` is only visible in screenshots |
| `TileRack` | `place-tile.spec.ts`, `layout.spec.ts`; disabled rack on someone else's turn only in screenshots |
| `ChainMarker` | `buy-phase.spec.ts`, `found-chain.spec.ts`, `host.spec.ts` (full variant with size, price, stock) |
| `ChainSelector` | `found-chain.spec.ts`, `merger.spec.ts : merger: tie between ...` |
| `MergerDisposition` / `StockStepper` | `merger.spec.ts` (sliders: sell/trade/hold, even trades, trade cap), `buy-phase.spec.ts` (buy steppers: 3-share cap, sold-out, cash) |
| `Portfolio` | `buy-phase.spec.ts`, `merger.spec.ts`, `trades.spec.ts` |
| `PlayerCard` | `host.spec.ts` (scoreboard cards, turn marker, cash, stocks) |
| `TradeBuilder` | `trades.spec.ts : propose a trade through the builder ...`, `server refuses a trade mid-merger ...` |
| `GameOver` | `end-game.spec.ts`, `host.spec.ts` |
| `ReconnectionOverlay`, `ReconnectedToast` | `connection.spec.ts` |

## Not covered, and why

- **Tier 4 by design** (home-page entry points and join errors: H-02, H-04 to H-08, CN-08; the non-host lobby text in PL-01; LLM seat in TR-05).
- **PG-12, HO-05 (thinking indicator)**: scripted seats answer in about 50 ms, so no stable state exists in which to look at it. It would need a scripted seat with an artificial delay.
- **CN-01, CN-02 (connection error screen)**: cannot make a WebSocket handshake fail from Playwright.
- **CN-06 (host refresh), HO-07 (activity log), host-page reconnection overlay**: no screen test written.
- **CN-09**: no dedicated toast-variant test.
- **Merger-triggering tile marker and the disabled rack** are only visible in screenshots, not asserted.

## Fixtures

Every fixture in `frontend/tests/e2e/fixtures/snapshots/index.json` has at least one screen test:

| Fixture | Tests |
|---|---|
| `opening-place-tile` | `place-tile.spec.ts : opening: ...` |
| `safe-chain-on-board` | `place-tile.spec.ts : safe chain on board: ...` |
| `dead-tile-in-hand` | `place-tile.spec.ts : dead tile in hand: ...` |
| `found-chain-choice` | `found-chain.spec.ts`, `reload.spec.ts : reload while choosing a chain` |
| `buy-phase-multi-chain` | `buy-phase.spec.ts` (two tests), `connection.spec.ts` |
| `low-cash` | `buy-phase.spec.ts : low cash: ...` |
| `merger-survivor-tie` | `merger.spec.ts : merger: tie between ...` |
| `disposition-human-first` | `merger.spec.ts`, `reload.spec.ts : reload during a stock disposition` |
| `disposition-trade-limited` | `merger.spec.ts` |
| `multi-chain-merger` | `merger.spec.ts : multi-chain merger: ...` |
| `disposition-waiting-on-other` | `merger.spec.ts : disposition (waiting): ...`, `trades.spec.ts : server refuses ...`, `host.spec.ts : ... merger in progress ...` |
| `trade-incoming` | `trades.spec.ts` (accept, reject) |
| `trade-incoming-not-my-turn` | `trades.spec.ts` (accept, reject), `reload.spec.ts : reload with a trade offer waiting` |
| `trade-outgoing-pending` | `trades.spec.ts` (pending/cancel, scripted accept, scripted reject, builder), `host.spec.ts : ... pending trade ...` |
| `end-game-available` | `end-game.spec.ts` (two tests) |
| `last-turn-before-game-over` | `end-game.spec.ts` |
| `game-over` | `end-game.spec.ts`, `host.spec.ts`, `reload.spec.ts` |
| `game-over-tie` | `end-game.spec.ts : game over with a tie ...` |
| `three-player-midgame` | `layout.spec.ts` (desktop, phone), `host.spec.ts : ... busy mid-game board ...` |
| `six-player-midgame` | `layout.spec.ts` (desktop, phone) |

## Seats that are not scripted

Two screens need an opponent who does not answer: waiting on another player, and an offer that must
stay pending. `startFromSnapshot(page, fixture, { idle: ['p3'] })` joins that seat as a human through
`POST /api/join` and nobody drives it. `room.driveIdle()` (called by the turn helpers while they
wait) plays first-legal moves for idle seats once the test lets them act, so the game never blocks.
