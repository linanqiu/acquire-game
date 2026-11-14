# Tier-4 Journey Coverage

Which surface of [surface-coverage.md](surface-coverage.md) each tier-4 journey exercises
(TP-005). Surface names are copied exactly from that map; this file is merged into it
later, so it does not edit the map itself.

All journeys live in `frontend/tests/e2e/journeys/`, start at the home page `/`, use the
UI only, and run with `npm run e2e:journeys` (Playwright project `journeys`, real servers,
`ACQUIRE_GAME_SEED=2`, `ACQUIRE_TEST_MODE=1`). The static guard `no-shortcuts.spec.ts`
fails the suite if a journey file uses `/api/`, `/test/`, `fetch(`, the `request` fixture,
snapshots or `/configure`, or does not navigate to the home page first.

Journey files and test titles (`@ci` = also in `npm run e2e:ci`):

| Key | File | Test title |
|-----|------|------------|
| J1 | `solo-vs-ai-full-game.spec.ts` | `@ci solo vs AI: full game from the home page to game over and play again` |
| J2 | `two-humans-and-bot.spec.ts` | `two humans and a bot: join by code, play, trade accept/reject/cancel` |
| J3 | `trade-with-ai.spec.ts` | `trade with AI: the bot accepts a generous offer and rejects a bad one` |
| J4 | `spectator-host-view.spec.ts` | `spectator host view: watch an all-AI game to game over` |
| J5 | `reconnect-and-refresh.spec.ts` | `reconnect and refresh: reloads mid-turn and with a pending offer, offline/online` |
| J6 | `entry-errors.spec.ts` | `@ci entry errors: validation, bad codes, duplicate name, full room, started game, bad URLs` |
| J7 | `mobile-player.spec.ts` | `mobile player: 8 turns at phone size with trade panel and disposition` |
| G | `no-shortcuts.spec.ts` | `@ci journeys use the UI only (...)`, `@ci every journey starts at the home page` |

## Surfaces covered

| ID | Surface | Journey(s) | How |
|----|---------|------------|-----|
| R-01 | `/` Home / lobby page (`LobbyPage`) | J1-J7 | every journey starts here |
| R-02 | `/play/:room` Player page (`PlayerPage`) | J1, J2, J3, J5, J7 | full turns |
| R-03 | `/host/:room` Host/spectator page (`HostPage`) | J4 | lobby, game, game over |
| R-04 | `*` Not-found page (`NotFoundPage`, "Back to Lobby" link) | J6 | `/no/such/page`, link back home |
| H-01 | Create game: name input + CREATE | J1-J3, J5-J7 | |
| H-02 | Join game: name + room code + JOIN | J2, J5, J6 | code typed in lower case, upper-cased by the input |
| H-03 | Watch bots play (spectator room) | J4 | |
| H-04 | Create validation error (empty name) | J6 | empty and blank names; 25 typed characters capped at 20 |
| H-05 | Join error: bad room code | J6 | short code and unknown room (inline error + toast) |
| H-06 | Join error: duplicate name | J6 | case-insensitive |
| H-07 | Join error: full room | J6 | 6 seats |
| H-08 | Join error: game already started | J6 | |
| PL-01 | Player lobby: room code, player list, "WAITING FOR HOST" | J1, J2, J6 | host and joined player |
| PL-02 | Add AI control (catalog list; today "+ ADD BOT") | J1, J3, J6, J7 | "+ ADD BOT" and "+ ADD AI" -> `llm:fake` |
| PL-04 | Remove AI seat in lobby (planned) | J6 | host removes Bot 4; no remove button for humans or non-hosts |
| PL-05 | START GAME enabled only with enough players (`canStart`) | J2, J6 | disabled with 1-2 seats, plus the new "Need N more players" hint |
| PG-01 | Place tile: tile rack, board, PLACE TILE button (`place-tile-button`) | J1, J2, J3, J5, J7 | |
| PG-02 | Place tile: tile selected, button enabled | J1, J2, J3, J5, J7 | "Selected: XX" |
| PG-04 | Found chain: `ChainSelector` | J1, J2, J3, J7 | |
| PG-05 | Merger: choose surviving chain | J2 | Bob chooses the survivor of a tie (seeded path, asserted) |
| PG-06 | Merger: stock disposition (`MergerDisposition`, `StockStepper`) | J1, J2, J7 | sell/trade sliders, summary, confirm |
| PG-07 | Merger: disposition shown when not my turn | J1, J2 | another seat's merger prompts the human |
| PG-08 | Buy stocks: stepper, cost, "Not enough cash", "Maximum 3 shares" | J1-J3, J5, J7 | stepper and total only (see gaps) |
| PG-09 | End turn button (`end-turn-button`) | J1-J3, J5, J7 | BUY & END TURN and SKIP & END TURN; cash change checked |
| PG-10 | End game button (`end-game-button`) | J1 | Alice declares the end on her 20th turn (seeded path, asserted) |
| PG-11 | Waiting for another player ("Waiting for X to place a tile") | J2, J5 | live board check on the waiting screen |
| PG-12 | Thinking indicator while an AI seat decides (planned) | J1 | seen for both AI seats |
| PG-13 | Players panel (cash and stock badges per player, YOU badge) | J1, J2, J3 | cash/holdings compared on both screens |
| PG-14 | Portfolio strip and cash/price header (`PageShell`, `Portfolio`) | J1, J5 | header cash after purchases, trades, reloads |
| PG-15 | Game over (`GameOver`) on player page, scores, winner | J1 | standings + real breakdown (bonuses, stock sales) |
| PG-16 | Play again (`GameOver` PLAY AGAIN button -> `handlePlayAgain`) | J1 | lands on home; a new game opens on a clean lobby |
| TR-01 | Propose Trade modal (`Modal` + `TradeBuilder`) | J1, J2, J3, J5, J7 | |
| TR-02 | Trade builder validation (cannot offer what you do not hold) | J3 | partner/offer/request errors; stepper stops at holdings |
| TR-03 | Incoming trade offer with accept/reject | J2, J5 | accept, reject, cancel; offer survives reloads |
| TR-04 | Trade accepted/rejected notification (planned) | J1, J2, J3 | toasts on both sides |
| TR-05 | Trade with an LLM or scripted seat end to end | J1, J3, J7 | Fake LLM accepts (J1, J7); bot accepts + rejects (J3) |
| HO-01 | Host lobby: "WAITING FOR PLAYERS", player list | J4 | |
| HO-02 | Host lobby: add AI control, START GAME | J4 | |
| HO-03 | Host in-game view: board (`Board`, large), player cards (`PlayerCard`), chains | J4 | |
| HO-04 | Host: merger in progress | J4 | "- MERGER" banner seen |
| HO-05 | Host: thinking indicator (planned) | J4 | seen for all three AI seats |
| HO-06 | Host: game over (`GameOver`) | J4 | full breakdown table |
| HO-07 | Host: activity log / "Waiting for players..." messages | J4 | "Bot 1 joined" |
| CN-03 | `ReconnectionOverlay` while reconnecting | J5 | browser offline |
| CN-04 | `ReconnectedToast` after reconnect | J5 | back online, CONTINUE PLAYING |
| CN-05 | Page refresh mid-game restores state (player) | J5 | start of turn, mid-turn (after placing), pending offer |
| CN-06 | Page refresh mid-game restores state (host) | J4 | |
| CN-08 | Player page opened with bad room code / no credentials | J6 | "Game XXXX was not found" / "You are not a player in game" |
| CN-09 | Toast container: success / error / info / warning variants (`Toast`) | J1, J2, J6 | |

Components seen in the journeys (section 8 of the map): `Board` (J1, J4, J7 phone size),
`Tile` (rack, selected, placed, chain colours), `TileRack`, `ChainMarker`, `ChainSelector`,
`MergerDisposition` / `StockStepper`, `Portfolio`, `PlayerCard` (J4), `TradeBuilder`,
`GameOver` (J1 player, J4 host), `ReconnectionOverlay` and `ReconnectedToast` (J5).

## Surfaces not reached through the UI (product gaps worth knowing)

| ID | Surface | Why a journey cannot reach it |
|----|---------|-------------------------------|
| H-09 | Create/spectator failure toast (server error) | Needs the server to fail; nothing a user can do triggers it. Tier 3 territory. |
| PL-03 | Add AI: unavailable catalog entry shown disabled (planned) | Depends on which provider keys the machine running the servers has; not deterministic in a journey. |
| PL-06 | Add/start failure toast ("Failed to add bot", "Failed to start game") | The UI disables the buttons in every state where the server would refuse (full room, too few seats), so the toast needs a server fault. |
| PG-03 | Place tile: unplayable/dead tiles shown | The suite seed never deals the human a dead or temporarily unplayable tile in the turns played. Covered by the `dead-tile-in-hand` snapshot (tier 3). |
| PG-08 (part) | "Not enough cash", "Maximum 3 shares" | "Maximum 3 shares" is unreachable: the steppers cap the total at 3. "Not enough cash" needs a purchase above the player's cash, which the journeys' buying policy avoids; tier 3 (`low-cash`). |
| HO-08 | Host: start/add failure toast | Same as PL-06. |
| CN-01 / CN-02 | "Connection error. Please refresh the page." (player / host) | Shown only when the very first socket errors before any state arrives (network or server fault). An unknown room or seat now shows the CN-08 message instead. |
| CN-07 | Server error message toast from WebSocket (`useErrorHandler`) | The UI never sends an illegal action (buttons are disabled), so the server never refuses one in a journey. |

Notes:

- The suite seed makes the main path reproducible: J1 ends on Alice's 20th turn when she
  takes END GAME (it is first offered then); J2 contains a survivor choice; J4 runs an
  all-AI game to game over in about 12 s.
- After a host refresh the activity log starts again from "Waiting for players..." (local
  state only); not a bug, but the log is not part of the restored state.
