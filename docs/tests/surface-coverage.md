# Surface Coverage Map

Every user-visible surface of the app, against the test that exercises it. Defined in
[Epic 11](../roadmap/epics/11-test-pyramid.md) and [TP-006](../roadmap/stories/11-test-pyramid/TP-006.md);
replaces the scenario-id mapping of ST-010. Checked by `python scripts/check-surface-coverage.py`
(run by `scripts/verify-change.sh` and CI).

How to use:

- **Covered by** is a list of `` `file : test title` `` references, or `GAP: <reason>` when no test
  can reach the surface yet. The script opens every referenced file and looks for a test whose title
  contains the text after ` : ` (Python tests: a `def` whose name starts with it). An empty cell, a
  reference to a test that was renamed or deleted, or a unit-test-only row without `GAP:` fails the
  check. Paths: `screens/`, `journeys/`, `transcripts/` are under `frontend/tests/e2e/`; backend tests
  are `backend/tests/...`; unit tests are `src/...` and never count as coverage on their own.
- **Tier**: `3` = screen test (snapshot start, real servers), `4` = journey (home page start, UI
  only), `2` = protocol test (no browser), `unit` = component test only.
- Adding or changing a route, modal, phase screen or error state means adding or changing a row in
  the same commit. The script also fails when a route of `frontend/src/App.tsx` is missing here, or
  when a page or component that has a `data-testid` is not named anywhere in this file.
- Coverage is reported as "N of M surfaces covered; K journeys", not as a percentage of lines or
  scenarios.

Sources: `frontend/src/App.tsx` (routes), `frontend/src/pages/*.tsx`, `frontend/src/components/`,
every `data-testid` in `frontend/src`. The first version (2026-11-14 morning) was a skeleton; this is
the filled map (TP-006, with the surfaces added by Epics 9-12).

Where a test is flagged "(tier 3, real server)" it starts from a generated snapshot fixture; the
journeys (J1-J7 in [coverage-journeys.md](coverage-journeys.md)) start at `/` and use the UI only.

## 1. Routes

| ID | Surface | How to reach | Covered by | Tier |
|----|---------|--------------|------------|------|
| R-01 | `/` Home / lobby page (`LobbyPage`) | Open the app | `journeys/entry-errors.spec.ts : entry errors`; every journey starts here | 4 |
| R-02 | `/play/:room` Player page (`PlayerPage`) | Create or join a game | `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI`; `journeys/two-humans-and-bot.spec.ts : two humans and a bot`; `screens/place-tile.spec.ts : opening` | 3, 4 |
| R-03 | `/host/:room` Host/spectator page (`HostPage`) | "Watch bots play" | `journeys/spectator-host-view.spec.ts : spectator host view`; `screens/host.spec.ts : host view of a busy mid-game board` | 3, 4 |
| R-04 | `*` Not-found page (`NotFoundPage`, "Back to Lobby" link) | Navigate to an unknown URL | `screens/lobby.spec.ts : unknown URL shows the not-found page`; `journeys/entry-errors.spec.ts : entry errors` | 3, 4 |
| R-05 | `/games` Games and transcripts list (`GamesPage`) | "Past games" link on the home page; "Games" on the bench pages | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript`; `screens/waking-and-not-found.spec.ts : games list` | 3, 4 |
| R-06 | `/games/:gameId` Transcript viewer (`TranscriptPage`) | Row in the games list, or "View full transcript" on the game-over screen | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript`; `screens/transcript-pages.spec.ts : snapshot game` | 3, 4 |
| R-07 | `/bench` Buyout Bench leaderboard (`BenchPage`) | "Buyout Bench" link on the home page and on the games pages | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript`; `screens/transcript-pages.spec.ts : benchmark page` | 3, 4 |
| R-08 | `/bench/series/:seriesId` Benchmark series page (`BenchSeriesPage`) | Series row on the leaderboard | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript`; `screens/waking-and-not-found.spec.ts : unknown transcript and unknown benchmark series` | 3, 4 |

## 2. Home page entry points (`LobbyPage`)

| ID | Surface | Test id / control | Covered by | Tier |
|----|---------|-------------------|------------|------|
| H-01 | Create game: step one asks only the name, then NEW GAME (BL-018: one question at a time) goes straight to the lobby | `name-input`, `create-button` | `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI`; `screens/home-entry.spec.ts : names are trimmed` | 3, 4 |
| H-02 | Join game: the name, JOIN GAME, then the code step (`/?join`): "Joining as <name>" with Change, one large Room code field that joins on the fourth letter (or JOIN), and Back; the browser's Back returns to the name | `name-input`, `join-button`, `join-as`, `join-room-input`, `join-submit-button`, `join-back` | `journeys/two-humans-and-bot.spec.ts : two humans and a bot`; `screens/home-entry.spec.ts : one question at a time` | 3, 4 |
| H-03 | Watch bots play (spectator room) | `watch-bots-button` | `journeys/spectator-host-view.spec.ts : spectator host view` | 4 |
| H-04 | Name error (empty, blank, over-long) under the name field, before NEW GAME or JOIN GAME | `name-input` error (`#player-name-error`) | `journeys/entry-errors.spec.ts : entry errors` | 4 |
| H-05 | Join error: bad room code (short, unknown) | `join-room-input` error | `journeys/entry-errors.spec.ts : entry errors` | 4 |
| H-06 | Join error: duplicate name, said at the code field with CHANGE MY NAME, which goes back to the name step and says why there | `join-room-input` error, `join-name-taken-change`, `#player-name-error` | `journeys/entry-errors.spec.ts : entry errors` | 4 |
| H-07 | Join error: full room | inline error | `journeys/entry-errors.spec.ts : entry errors` | 4 |
| H-08 | Join error: game already started | inline error | `journeys/entry-errors.spec.ts : entry errors` | 4 |
| H-09 | Create/spectator failure (server error), said once inline (`role=alert`, no toast repeating it) | `create-error`, `spectator-error` | `screens/lobby.spec.ts : failures show a toast: create game, add bot, start game` | 3 |
| H-10 | Link to the games list | `games-link` | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` | 4 |
| H-11 | Link to the Buyout Bench leaderboard | `bench-link` | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` | 4 |
| H-12 | "Waking the server" note while the health check is retried | `waking-server` | `screens/waking-and-not-found.spec.ts : home page: waking the server note` | 3 |
| H-13 | "The server is not answering yet" notice with Try again | `server-down`, `server-retry` | `screens/waking-and-not-found.spec.ts : home page: server not answering` | 3 |
| H-14 | Names trimmed; room code upper-cased as typed; creator lands on `?is_host=1` | form behaviour | `screens/home-entry.spec.ts : names are trimmed` | 3 |
| H-15 | Home first impression: board motif in the ruleset's chain colours (`BoardMotif`), the theme and its tagline as one quiet line, and one quiet row of links (Watch bots play, Past games, Bench) at the foot (BL-018) | `home-motif`, `watch-bots-button`, `games-link`, `bench-link` | `screens/appearance.spec.ts : system colour scheme: home and the key game screens render` | 3 |
| H-16 | Light / dark theme toggle (`ThemeToggle`; home page, game header on wide screens, host header, transcript pages): follows `prefers-color-scheme`, a pick is remembered in localStorage | `theme-toggle`, `html[data-theme]` | `screens/appearance.spec.ts : the toggle switches the scheme`; `screens/appearance.spec.ts : system colour scheme: home and the key game screens render` | 3 |
| H-17 | The last name used is filled in again on the home page (localStorage, `player_name_last`; a browser without storage just asks again) | `name-input` value | `screens/home-entry.spec.ts : the name is remembered` | 3 |
| H-18 | Join link (`/?code=ABCD`, shared by the lobby's Invite): opens the code step with the code filled in; with no name known the name is asked on that step, with one known a single tap joins | `join-room-input` value, `lobby-share` | `screens/home-entry.spec.ts : join link` | 3 |

## 3. Player page: lobby (`/play/:room`, phase `lobby`)

| ID | Surface | Notes | Covered by | Tier |
|----|---------|-------|------------|------|
| PL-01 | Player lobby: the room code with its Invite button (Web Share API, else the link is copied, else shown: `lobby-share`, `lobby-share-outcome`), the player list and the seats left as its foot (`lobby`, `lobby-room-code`, `seats-free`); what the room waits for is said once, in the phase bar ("WAITING FOR THE HOST TO START" for a guest, BL-017) | host and guest views (`LobbyPanel`) | `screens/home-entry.spec.ts : names are trimmed`; `screens/lobby.spec.ts : lobby: AI menu`; `journeys/two-humans-and-bot.spec.ts : two humans and a bot` | 3, 4 |
| PL-02 | Add AI control (catalog list and "+ ADD BOT") | `AddAiControl` | `screens/lobby.spec.ts : lobby: AI menu`; `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` | 3, 4 |
| PL-03 | Add AI: unavailable catalog entry shown disabled; failed catalog leaves only ADD BOT | | `screens/server-faults.spec.ts : AI menu: unavailable entries are disabled`; `screens/lobby.spec.ts : lobby: AI menu` | 3 |
| PL-04 | Remove AI seat in lobby (host only, not for humans) | `RemoveSeatButton` | `screens/lobby.spec.ts : lobby: AI menu`; `journeys/entry-errors.spec.ts : entry errors` | 3, 4 |
| PL-05 | START GAME enabled only with enough players; the host's phase bar says "NEED N MORE PLAYERS TO START", then "START WHEN EVERYONE IS IN" (no caption under the button; the host page keeps `start-hint` only while it cannot start) | `game-phase`, `start-hint` (host page) | `screens/lobby.spec.ts : lobby: AI menu`; `journeys/entry-errors.spec.ts : entry errors`; `journeys/spectator-host-view.spec.ts : spectator host view` | 3, 4 |
| PL-06 | Add/start failure toast ("Failed to add bot", "Failed to start game") | | `screens/lobby.spec.ts : failures show a toast: create game, add bot, start game` | 3 |

## 4. Player page: game phase screens (`/play/:room`)

| ID | Surface | Phase / state | Covered by | Tier |
|----|---------|---------------|------------|------|
| PG-01 | Place tile: tile rack, board, PLACE TILE button (`place-tile-button`) | `place_tile`, my turn | `screens/place-tile.spec.ts : opening` | 3 |
| PG-02 | Place tile: tile selected, button enabled | | `screens/place-tile.spec.ts : opening`; `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` | 3, 4 |
| PG-03 | Place tile: unplayable/dead tiles marked, with the reason under the rack | `rack-note-*` | `screens/place-tile.spec.ts : dead tile in hand`; `screens/place-tile.spec.ts : safe chain on board` | 3 |
| PG-04 | Found chain: `ChainSelector` | `found_chain` | `screens/found-chain.spec.ts : found chain`; `screens/reload.spec.ts : reload while choosing a chain` | 3, 4 |
| PG-05 | Merger: choose surviving chain | `pendingMergerChoice` | `screens/merger.spec.ts : merger: tie between two equal chains` | 3, 4 |
| PG-06 | Merger: stock disposition (`MergerDisposition`, `StockStepper`) | `stock_disposition` | `screens/merger.spec.ts : disposition (human first)`; `screens/merger.spec.ts : disposition (trade limited by the bank)`; `screens/merger.spec.ts : multi-chain merger` | 3, 4 |
| PG-07 | Merger: disposition shown when not my turn / waiting on another stockholder | `pendingStockDisposition` | `screens/merger.spec.ts : disposition (waiting)`; `screens/merger.spec.ts : disposition (trade limited by the bank)` | 3 |
| PG-08 | Buy stocks: stepper, cost, 3-share cap, sold-out chain, "No cash" note | `buy_stocks` (`BuyPanel`) | `screens/buy-phase.spec.ts : buy phase: prices and availability shown`; `screens/buy-phase.spec.ts : low cash` | 3 |
| PG-09 | End turn button (`end-turn-button`: BUY & END TURN / SKIP & END TURN) | buy phase | `screens/buy-phase.spec.ts : buy phase: skip buying keeps cash`; `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` | 3, 4 |
| PG-10 | End game button (`end-game-button`), offered only when declarable | | `screens/end-game.spec.ts : end game available`; `screens/turn-basics.spec.ts : opening turn`; `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` | 3, 4 |
| PG-11 | Waiting for another player: the phase bar names who and what ("CARA IS BUYING SHARES"), once (BL-017) | not my turn | `screens/merger.spec.ts : disposition (waiting)`; `journeys/two-humans-and-bot.spec.ts : two humans and a bot` | 3, 4 |
| PG-12 | Thinking indicator while an AI seat decides (`AiThinking`) | AI on turn | `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI`; GAP: no screen test, the scripted and fake-LLM seats answer instantly and have no delay option in test mode, so there is no stable state to assert on | 4 |
| PG-13 | Players matrix (`Standings`, `holdings-matrix`, BL-013): a table with one row per player and one column per chain in the ruleset's order (the same for every player); share counts with majority filled / minority outlined / `=` tie (`matrix-cell-*`, `data-role`), empty cells quiet; one 28px line per player (BL-014): name (first name of an AI seat where the column is narrow, the whole name as tooltip), the seat-kind icon and YOU on that line, cash, net worth with the rank in front; shares at current prices printed on wide panels, else in the tooltip and the seat popover; footer with tiles, price and bank per chain, left out while no chain is on the board; turn marker; inactive chains dimmed in place; never wider than its panel at 360 / 375 / 390 / 1366 | all game phases | `screens/table-view.spec.ts : players matrix at`; `screens/board-fit.spec.ts : Board tab at 390x675, six players mid-game`; `screens/board-fit.spec.ts : the seat-kind icon is small`; `screens/table-view.spec.ts : table view on desktop`; `screens/table-view.spec.ts : table view on phone`; `screens/layout.spec.ts : busy`; `screens/place-tile.spec.ts : opening`; `journeys/two-humans-and-bot.spec.ts : two humans and a bot` | 3, 4 |
| PG-14 | Header: bag counter always; my cash, net worth and rank on the tabs without the players table (on the Board / Table tab my row of the table has them and the header shows the room code instead, at the same height, BL-017) (`PageShell`, `Header`); my holdings in the chains table (`portfolio-row-*`, `portfolio-empty`) | all game phases | `screens/tabs.spec.ts : tabs at`; `screens/merger-payout.spec.ts : merger payout`; `screens/buy-phase.spec.ts : buy phase: prices and availability shown`; `journeys/reconnect-and-refresh.spec.ts : reconnect and refresh` | 3, 4 |
| PG-15 | Game over (`GameOver`) on player page: standings, winner, breakdown, tie | `game_over` | `screens/end-game.spec.ts : game over: standings`; `screens/end-game.spec.ts : game over with a tie`; `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` | 3, 4 |
| PG-16 | Play again (`GameOver`): the one way back to the home page (a BACK TO LOBBY button led to the same place and was removed, BL-017) | after game over | `screens/end-game.spec.ts : game over: standings`; `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` | 3, 4 |
| PG-17 | Board colours and chain sizes follow the play (expansion, absorbed lone tiles) | | `screens/turn-basics.spec.ts : expanding a chain` | 3 |
| PG-18 | Rack refills and bag counter shrinks after a turn; lone tile shown on the board | | `screens/turn-basics.spec.ts : opening turn` | 3 |
| PG-19 | Merger payout: majority/minority bonuses reach the right players on screen | | `screens/merger-payout.spec.ts : merger payout` | 3 |
| PG-20 | AI seat badge (`SeatKindBadge`, BL-010): one icon per kind next to the seat's character name (players table, lobby, chat authors, merger result, trade offers, game over, replay board); accessible name "AI player, <model>" / "Rules-based bot"; 32px target without a taller row | bot / LLM seats | `screens/seat-badge.spec.ts : seat badge on a phone`; `screens/seat-badge.spec.ts : seat badge on a laptop`; `screens/chat.spec.ts : chat on desktop`; `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` | 3, 4 |
| PG-37 | Seat badge popover (`seat-popover-*`): click / tap / Enter / Space opens "AI player · <model>" + "Reads the table chat" or "Rules-based bot · does not chat"; outside click and Escape close it; fully on screen at 390x844 and 1366x768 (never under the bottom bar) | any AI seat badge | `screens/seat-badge.spec.ts : seat badge on a phone`; `screens/seat-badge.spec.ts : seat badge on a laptop`; `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI`; `src/components/game/SeatKindBadge.test.tsx : opens a popover on click` | 3, 4 |
| PG-22 | Chains table (`ChainTable`): chains in the ruleset's order under one header (Tiles / Price / Bank), SAFE, majority and minority holders with shares and bonus if bought now (`=1st … each` for a tie, `1st+2nd` for a sole holder), my shares and position ("2nd, 1 ahead", "3 behind 2nd") | all game phases | `screens/table-view.spec.ts : table view on desktop`; `screens/table-view.spec.ts : table view on phone`; `screens/host.spec.ts : host view of a busy mid-game board`; `src/components/game/TableView.test.tsx : names the 1st and 2nd holders` | 3 |
| PG-23 | Merger view in the table panel (`MergerResult`, BL-011, BL-013): takeover, sizes, each defunct holder with shares, bonus paid and sell/trade/keep as it comes in; no close button; never on top of another tab | a merger starts (or is in progress on load) | `screens/table-view.spec.ts : merger result: bonuses at once`; `screens/table-view.spec.ts : merger result after the human's own merger`; `screens/decision-tab.spec.ts : shown with what was paid, nothing to close`; `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` | 3, 4 |
| PG-24 | Merger log (`MergerLog`): every merger of the game as a quiet line that opens in place to the full result and closes again (Trades tab, host Log; the "Last merger" line under the players, `decision-last-merger`) | after the first merger | `screens/table-view.spec.ts : merger result: bonuses at once`; `screens/tabs.spec.ts : phone: a merger is under the board`; `screens/table-view.spec.ts : merger result after the human's own merger` | 3 |
| PG-25 | Desktop layout at 1366x768: board with the status line and the rack under it, the sidebar tabs with the table panel first, rack on screen without scrolling in every phase, each tab fits | all decision phases | `screens/table-view.spec.ts : 1366x768, place tile`; `screens/table-view.spec.ts : 1366x768, disposition`; `screens/table-view.spec.ts : 1366x768, buy`; `screens/decision-tab.spec.ts : every chain's holders and my shares next to the stepper` | 3 |
| PG-26 | Phone tab bar (`GameLayout`, `TabList`, `tab-bar`): Board / Chains / Chat / Trades (no Now, no Players tab) at the bottom, under the dock (`dock`: the rack; the status line on the reference tabs, and PLACE TILE once a tile is picked); at 390x844 and 360x640 in place-tile, buy, disposition and waiting states everything is on screen, apart, and the page does not scroll; at 360x640 the rack gives its row to an open decision | phones (< 768px) | `screens/tabs.spec.ts : board, decision, rack and tabs fit; every tab shows its content`; `journeys/mobile-player.spec.ts : mobile player` | 3, 4 |
| PG-27 | Sidebar tabs on wide screens (`tab-list`): Table / Chains / Chat / Trades, board always on the left (no Board tab); at 1366x768 and 768x1024 each tab fits and the page does not scroll | tablets and up | `screens/tabs.spec.ts : board, decision, rack and tabs fit; every tab shows its content` | 3 |
| PG-28 | Board tab (phones): the full board (every square inside the viewport) in every phase, with the table panel under it (`table-panel`); on a short screen the board gets smaller for an open decision, never cut; opens by itself when my place-tile turn starts (not while I type in the chat); dot on the tab while my tile or a new decision waits and another tab is open | phones | `screens/decision-tab.spec.ts : the full board in every phase`; `screens/tabs.spec.ts : phone: my place-tile turn opens the Board`; `screens/tabs.spec.ts : phone: unread chat badge`; `screens/layout.spec.ts : busy`; `src/hooks/useGameTabs.test.ts : goes to the Board` | 3 |
| PG-29 | Standings with the board (BL-013): the players matrix is in the table panel, under the board on phones and next to it on wide screens; there is no Players tab to toggle with | all game phases | `screens/tabs.spec.ts : board, decision, rack and tabs fit; every tab shows its content`; `screens/table-view.spec.ts : players matrix at`; `screens/table-view.spec.ts : table view on phone`; `journeys/mobile-player.spec.ts : mobile player` | 3, 4 |
| PG-30 | Chains tab (`tabpanel-chains`, label from the ruleset: Chains / Startups / Lines): majority holders from the fixture | all game phases | `screens/tabs.spec.ts : board, decision, rack and tabs fit; every tab shows its content`; `screens/table-view.spec.ts : table view on phone` | 3 |
| PG-31 | Chat tab (`tabpanel-chat`) with the unread badge (`tab-badge-chat`; history sent on a first visit counts as read) | all game phases | `screens/chat.spec.ts : chat on a phone`; `screens/tabs.spec.ts : phone: unread chat badge` | 3 |
| PG-32 | Trades tab (`tabpanel-trades`): my offers, PROPOSE TRADE, every other open offer at the table (BL-012), recent trades and the mergers log; badge with the number of offers waiting for my answer, else a dot for a new offer between other players (`tab-badge-trades`) | all game phases | `screens/trades.spec.ts : outgoing offer stays pending until cancelled`; `screens/tabs.spec.ts : phone: an incoming trade offer`; `screens/tabs.spec.ts : phone: a merger is under the board`; `screens/table-view.spec.ts : merger result after the human's own merger`; `screens/trades.spec.ts : an offer between two other players` | 3 |
| PG-33 | Selected tab remembered per room for the session (reload keeps it) | | `screens/tabs.spec.ts : phone: my place-tile turn opens the Board`; `screens/chat.spec.ts : chat on desktop` | 3 |
| PG-34 | "Your turn" signal: phase bar `data-turn="mine"` (accent tint) and the status line accent while the table waits on me; calm "other" with a turn marker otherwise (host: whose turn) | all game phases | `screens/appearance.spec.ts : your-turn signal` | 3 |
| PG-35 | Chains drawn as shapes on the board: same-chain neighbours joined (`data-join`), one visible label per chain (`data-anchor`), orphans separate | board | `screens/appearance.spec.ts : a chain is one block with one label` | 3 |
| PG-36 | Motion (tile settles, merger sweep, cash / net-worth flash) is off under `prefers-reduced-motion` | board, header, players | `screens/appearance.spec.ts : reduced motion` | 3 |
| PG-38 | Table panel (`table-panel`, `decision-view`, BL-011, BL-013): under the board on phones, the first sidebar tab on wide screens; from the top an offer for me, my decision with its context (`data-view` buy / disposition / merger / survivor / found / place / waiting), the players matrix, the last merger line; a decision appears in place and goes when made | all game phases | `screens/decision-tab.spec.ts : every chain's holders and my shares next to the stepper`; `screens/tabs.spec.ts : board, decision, rack and tabs fit; every tab shows its content`; `src/pages/player/DecisionTab.test.tsx : my decisions first` | 3 |
| PG-39 | Buy decision (`BuyPanel`, BL-017): one compact row per chain (44px) under one column header (`buy-head`: Price / Tiles / Bank / You / Buy), in the ruleset's chain order; my shares marked as in the players table (filled = most, outlined = second, `=` tie) and "3→5" while I buy (`buy-mine`, `buy-mine-next`); the row I buy in opens one line with my projected place (`buy-projection`) and 1st / 2nd bonus (`buy-bonus`); a tap on a chain's name opens every holder (`buy-details-*`, `buy-holders-*`); total, cash after and the button pinned beside each other; all seven chains and the whole board on screen at 390x675 (the board yields what the rows need, `data-table-core`) | `buy_stocks`, my turn | `screens/decision-tab.spec.ts : every chain's holders and my shares next to the stepper`; `screens/decision-tab.spec.ts : with seven chains: the buy button stays on screen` | 3 |
| PG-40 | Disposition inside the merger view: defunct holders and decisions, the survivor after the merger (`merger-survivor-after`: engine size, price, bonuses, bank, everyone's shares, undecided), my sell / trade / keep (each number once, BL-017: what a slider gives next to it, cash after over CONFIRM, my survivor shares after in the survivor's table), my place and the bank following the trade slider live, CONFIRM pinned | `stock_disposition`, mine | `screens/decision-tab.spec.ts : holders and decisions, the survivor after the merger` | 3 |
| PG-41 | Survivor choice with each tied chain's size, price, bank and holders (`choice-facts-*`); founding choice with the price tiers | `choose_survivor`, `found_chain` | `screens/decision-tab.spec.ts : survivor choice`; `screens/found-chain.spec.ts : found chain` | 3 |
| PG-42 | Waiting in the table panel: who the table waits on and for what, the merger in progress read-only; a merger that just ended stays until the next tile is placed, then goes by itself (`useMergerResult`), nothing to close | not my decision | `screens/decision-tab.spec.ts : waiting during someone else's disposition`; `screens/decision-tab.spec.ts : shown with what was paid, nothing to close`; `src/pages/player/DecisionTab.test.tsx : a merger that finishes while I watch` | 3 |
| PG-43 | Placement line (`status`, `status-line`): over the rack on phones (under the board on wide screens), only while I place a tile and there is something to press ("Place 6C?" with PLACE TILE, END GAME). Not a status display: the phase bar says what the game waits for (BL-017) | `place_tile`, my turn | `screens/tabs.spec.ts : tabs at`; `screens/tabs.spec.ts : phone: my place-tile turn opens the Board`; `src/pages/PlayerPage.screens.test.tsx : lists the real hand` | 3 |
| PG-44 | The decision comes into view once per new event (my decision, an offer for me, a merger starting or resolving): the page goes to the tab with the table panel (Board on phones) and scrolls it to the top; not while typing in the chat (dot badge `tab-badge-board` instead); a reload keeps the tab and badges what is pending | | `screens/decision-tab.spec.ts : redirect: an opponent starts a merger`; `screens/decision-tab.spec.ts : no redirect while I have a chat draft`; `screens/tabs.spec.ts : phone: unread chat badge`; `src/hooks/useGameTabs.test.ts : a new decision or merger takes me to the decision tab` | 3 |
| PG-45 | Text fields on phones are at least 16px, so Safari and Chrome do not zoom in when a field gets focus (home page names, room code, chat, trade amounts) | phones | `screens/layout.spec.ts : phone: no text field is under 16px` | 3 |
| PG-46 | One-time hints (`Hint`, `hint-*`, BL-013): an instruction is shown until the player has done the thing (found, pick a survivor, open the trade builder; remembered in the browser; how to place a tile moved behind the phase bar's "?", PG-49), then it is a "?" button (`hint-button-*`) that brings the words back | first time vs later | `screens/trades.spec.ts : a hint is read once` | 3 |
| PG-47 | Header on a phone: bag, cash, net worth and rank stay on one line whatever their size (the brand gives way below 380px) | phones | `screens/table-view.spec.ts : players matrix at`; `screens/layout.spec.ts : busy` | 3 |
| PG-48 | Board tab in the space a phone browser really leaves (BL-014): at 390x675 and 375x630 with four players (game start and mid-game) the header, phase bar, whole board, every player row, the footer and the rack are on screen with nothing to scroll and nothing cut; at 390x675 with six players too (the board's squares get flatter, never under 20px, before anything scrolls); at 360x600 four players fit and with six only the table panel scrolls inside itself | phones with browser toolbars showing | `screens/board-fit.spec.ts : four players at the start of a game`; `screens/board-fit.spec.ts : four players mid-game`; `screens/board-fit.spec.ts : Board tab at 390x675, six players mid-game`; `screens/board-fit.spec.ts : Board tab at 360x600` | 3 |
| PG-49 | Help behind the phase bar's "?" (`PhaseHelp`, `phase-help`, `phase-help-panel`, BL-014): how to place a tile and the legend of the players matrix (`matrix-legend`); accent-coloured until the first tile is placed; closes on a tap outside, Escape or the "?"; costs no line of the page (player and host) | in game | `screens/board-fit.spec.ts : in the phase bar holds the placing hint` | 3 |
| PG-51 | The phase bar as the way back (`phase-link`, BL-017): while my move waits and the tab with the decision is not open, the bar is a button naming that tab ("BUY STOCKS · BOARD →", Table on wide screens) that opens it; plain text otherwise | my decision, another tab open | `screens/tabs.spec.ts : tabs at`; `screens/decision-tab.spec.ts : no redirect while I have a chat draft` | 3 |
| PG-50 | Merger order (`MergerOrderChoice`, `merger-order`): my tile merged chains and two or more defunct chains are the same size; "Which hotel chain is absorbed first?" ("next?" for the second question of a three-way tie) with one tappable row per tied chain: size, price, 1st / 2nd bonus and holders (`merger-order-*`); tapping a row answers (`merger_order`) and the merger goes on with that chain; phase bar CHOOSE THE MERGER ORDER; other players read "Waiting for X to choose which hotel chain is absorbed first" | `choose_defunct_order` (prompt `choose_merger_order`) | `screens/merger-order.spec.ts : merger order: the human picks which same-size chain is absorbed first`; `src/pages/player/DecisionTab.test.tsx : merger order: one tappable row per same-size chain` | 3 |
| PG-21 | AI fallback marker ("BOT ASSIST xN") when an LLM seat had to be replaced by the bot | `seat-fallback-*` | `src/components/game/AgentFallback.test.tsx : fallback`; GAP: browser coverage needs a fake LLM that answers illegally on purpose; the test-mode fake LLM only plays legal first moves (protocol side: `backend/tests/protocol/test_llm_retries.py`) | unit |

## 5. Player page: modals and trading

| ID | Surface | Notes | Covered by | Tier |
|----|---------|-------|------------|------|
| TR-01 | Propose a trade (`Modal` sheet + `TradeBuilder`, BL-013): full screen on phones, partners on one line, one line per row with chains in the ruleset's order, a footer always in view with both sides in words valued at current prices (`trade-summary`), the refusal reason and 44px buttons | opened from the Trades tab | `screens/trades.spec.ts : propose a trade through the builder`; `screens/trades.spec.ts : a full-screen sheet, one line per row` | 3, 4 |
| TR-02 | Trade builder validation (partner, offer, request; the steppers stop at what you hold) | | `screens/trades.spec.ts : propose a trade through the builder`; `journeys/trade-with-ai.spec.ts : trade with AI` | 3, 4 |
| TR-03 | Incoming trade offer with accept/reject (`TradeOffers part="incoming"`, `trade-incoming`), in the "now" area whatever tab is open, on my turn and on another's turn | | `screens/trades.spec.ts : incoming offer on my turn: accept it`; `screens/trades.spec.ts : incoming offer on my turn: reject it`; `screens/trades.spec.ts : incoming offer while another player is on turn`; `screens/reload.spec.ts : reload with a trade offer waiting` | 3, 4 |
| TR-04 | Trade accepted/rejected/cancelled notifications (toasts, both sides; each event announced once, also when an offer and its answer arrive together) | | `screens/trades.spec.ts : outgoing offer: a scripted opponent accepts it`; `screens/trades.spec.ts : outgoing offer: a scripted opponent rejects it`; `journeys/two-humans-and-bot.spec.ts : two humans and a bot` | 3, 4 |
| TR-05 | Trade with an LLM or scripted seat end to end | | `journeys/trade-with-ai.spec.ts : trade with AI`; `screens/trades.spec.ts : outgoing offer: a scripted opponent accepts it` | 3, 4 |
| TR-06 | Outgoing offer pending, with cancel | `trade-outgoing-*`, `trade-cancel-*` | `screens/trades.spec.ts : outgoing offer stays pending until cancelled` | 3, 4 |
| TR-07 | Server refuses a trade: reason in the builder and a toast | `trade-error` | `screens/trades.spec.ts : server refuses a trade mid-merger` | 3 |
| TR-08 | Trades tab (`trade-offers`): one quiet line when nothing is open (`trade-table-empty`, "No open offers"), PROPOSE TRADE and the one-time note that offers are public; open offers between two other players listed read-only (`trade-table`, BL-012; who offers what to whom, no accept / reject / cancel) | Trades tab | `screens/trades.spec.ts : an offer between two other players`; `screens/trades.spec.ts : a new offer between two other players`; `journeys/trade-with-ai.spec.ts : trade with AI` | 3, 4 |
| TR-09 | Competing offer: "Make a competing offer" TO recipient / TO proposer (`trade-compete-*`) opens the builder on that player with the terms filled in (`trade-started-from`); sent as my own offer, the first one stays open | from an offer between others | `screens/trades.spec.ts : an offer between two other players` | 3 |
| TR-10 | A new offer between two other players: one info toast and a dot on the Trades tab until it is opened; their answers are not toasted | while I am on another tab | `screens/trades.spec.ts : a new offer between two other players`; `journeys/two-humans-and-bot.spec.ts : two humans and a bot` | 3, 4 |
| TR-11 | Recent trades (`trade-activity`, `TradeActivity`): every offer and answer at the table in words with the terms, newest first | after the first trade event | `screens/trades.spec.ts : an offer between two other players`; `screens/trades.spec.ts : a new offer between two other players`; `journeys/two-humans-and-bot.spec.ts : two humans and a bot` | 3, 4 |

## 5b. Table chat (`ChatPanel`, player and host pages)

| ID | Surface | Notes | Covered by | Tier |
|----|---------|-------|------------|------|
| CH-01 | Chat in the player lobby: send with Enter, own line marked YOU, the Fake LLM answers | `chat-panel`, `chat-input`, `chat-message` | `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` | 4 |
| CH-02 | Chat in game on desktop: the sidebar's Chat tab, AI reply with the AI badge, text shown as text (never HTML), the game untouched | `chat-send`, `chat-list` | `screens/chat.spec.ts : chat on desktop` | 3 |
| CH-03 | Chat on a phone: a tab of the bottom bar with an unread count; never over the board, the tile rack or the tab bar; open, send, back to the board (the old collapsing bar was removed in BL-008) | `tab-chat`, `tab-badge-chat` | `screens/chat.spec.ts : chat on a phone` | 3 |
| CH-04 | Who reads the chat at this table, in one line ("Ada (AI) reads the chat and may answer." or "No AI at this table reads the chat."); what is true at every table (public, not binding, rules-based bots never chat) behind the "?" (`chat-about-button`, `chat-about`, BL-017) | `chat-readers` | `screens/chat.spec.ts : chat on desktop`; `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` | 3, 4 |
| CH-05 | Host / spectator view: same messages, read-only with the reason | `chat-read-only` | `screens/chat.spec.ts : chat on desktop` | 3 |
| CH-06 | Chat history after a reload / reconnect, in order | `chat_history` | `screens/chat.spec.ts : chat on desktop`; `backend/tests/protocol/test_chat.py : test_reconnect_gets_the_history_in_order` | 2, 3 |
| CH-07 | Send refused (too fast, too long, empty): reason under the input | `chat-error` | `backend/tests/protocol/test_chat.py : test_rate_limit`; `backend/tests/protocol/test_chat.py : test_refusals` | 2 |
| CH-08 | An LLM seat's table talk with its move (`say`) and off-turn talk after a game event | `data-source="say"` | `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI`; `backend/tests/protocol/test_chat.py : test_llm_seat_speaks_unprompted_after_a_game_event` | 2, 4 |
| CH-09 | "New messages" button when the reader scrolled up | `chat-new-below` | GAP: needs more messages than the list shows while scrolled up; unit test `src/components/game/ChatPanel.test.tsx` | unit |
| CH-10 | Chat lines in the transcript timeline, in order with the moves | `timeline-chat` | `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` | 4 |

## 6. Host / spectator page (`/host/:room`)

| ID | Surface | Notes | Covered by | Tier |
|----|---------|-------|------------|------|
| HO-01 | Host lobby: "WAITING FOR PLAYERS", player list | | `journeys/spectator-host-view.spec.ts : spectator host view`; `screens/lobby.spec.ts : host/spectator lobby` | 3, 4 |
| HO-02 | Host lobby: add AI control, START GAME | | `journeys/spectator-host-view.spec.ts : spectator host view`; `screens/lobby.spec.ts : host/spectator lobby` | 3, 4 |
| HO-12 | Host on a TV (1920x1080): board, Players and Chains pinned side by side (`pinned-players`, `pinned-chains`) without a tap; Chat and Log stay tabs | `(min-width: 1600px) and (min-height: 900px)` | `screens/host.spec.ts : board, scoreboard and chain list do not overlap or leave the screen` | 3 |
| HO-13 | Host: trade activity in the Log (`TradeActivity`, BL-012): offers and answers in words with the terms | after the first trade event | `screens/host.spec.ts : host view lists a pending trade` | 3 |
| HO-03 | Host in-game view: board (large; always visible on wide screens, a tab on phones), Players / Chains / Chat / Log tabs (`Standings` rows `player-card`, `ChainTable`); every tab fits at 390x844, 360x640, 768x1024, 1100x700 and 1366x768 without page scroll | | `screens/host.spec.ts : host view of a busy mid-game board`; `journeys/spectator-host-view.spec.ts : spectator host view` | 3, 4 |
| HO-04 | Host: merger in progress | | `screens/host.spec.ts : host view of a merger in progress` | 3, 4 |
| HO-05 | Host: thinking indicator | | `journeys/spectator-host-view.spec.ts : spectator host view`; GAP: no screen test, same reason as PG-12 | 4 |
| HO-06 | Host: game over with the full results table | | `screens/host.spec.ts : host view of a finished game`; `journeys/spectator-host-view.spec.ts : spectator host view` | 3, 4 |
| HO-07 | Host: activity log in the Log tab ("Baron Brick joined", ..., and the mergers) | `role=log` | `journeys/spectator-host-view.spec.ts : spectator host view` | 4 |
| HO-08 | Host: start/add failure toast | | `screens/lobby.spec.ts : host/spectator lobby` | 3 |
| HO-09 | Host: pending trades list (Log tab) | `pending-trades` | `screens/host.spec.ts : host view lists a pending trade` | 3 |
| HO-10 | Host: net worth and rank per player, majority/minority holders per chain | | `screens/table-view.spec.ts : table view on desktop`; `screens/table-view.spec.ts : table view on phone` | 3 |
| HO-11 | Host: table panel (`host-now`, BL-011, BL-013; under the board on phones, the first tab on wide screens, pinned on a TV): who the table waits on, the merger in progress read-only with the survivor after the merger, its result until the next tile is placed (nothing to close), the scoreboard matrix; the merger's line in the activity log opens it in place | | `screens/table-view.spec.ts : merger result: bonuses at once`; `screens/host.spec.ts : host view of a merger in progress` | 3 |

## 7. Connection and error states

| ID | Surface | Notes | Covered by | Tier |
|----|---------|-------|------------|------|
| CN-01 | "Connection error. Please refresh the page." + REFRESH (player) | socket refused, no state yet | `screens/server-faults.spec.ts : player page: a refused socket` | 3 |
| CN-02 | Same connection-error screen (host) | | `screens/server-faults.spec.ts : host page: a refused socket` | 3 |
| CN-03 | `ReconnectionOverlay` while reconnecting (player) | | `screens/connection.spec.ts : connection drops mid-game`; `journeys/reconnect-and-refresh.spec.ts : reconnect and refresh` | 3, 4 |
| CN-04 | `ReconnectedToast` ("welcome back") after reconnect; goes by itself after six seconds | | `screens/connection.spec.ts : connection drops mid-game`; `journeys/reconnect-and-refresh.spec.ts : reconnect and refresh` | 3, 4 |
| CN-05 | Page refresh mid-game restores state (player) | sessionStorage credentials | `screens/reload.spec.ts : reload while choosing a chain`; `screens/reload.spec.ts : reload during a stock disposition`; `journeys/reconnect-and-refresh.spec.ts : reconnect and refresh` | 3, 4 |
| CN-06 | Page refresh mid-game restores state (host) | | `journeys/spectator-host-view.spec.ts : spectator host view` | 4 |
| CN-07 | Server error message from the WebSocket shown as a toast (`useErrorHandler`) | e.g. illegal action | `screens/trades.spec.ts : server refuses a trade mid-merger` | 3 |
| CN-08 | Player page opened with a bad room code / no credentials (`room-unavailable`) | | `journeys/entry-errors.spec.ts : entry errors` | 4 |
| CN-09 | Toast container: success / error / info / warning variants (`Toast`) | | `screens/lobby.spec.ts : failures show a toast`; `screens/trades.spec.ts : outgoing offer: a scripted opponent rejects it`; `journeys/two-humans-and-bot.spec.ts : two humans and a bot` | 3, 4 |
| CN-10 | Reconnection overlay on the host page | `HostPage` mounts the same overlay | `screens/host-connection.spec.ts : host page: connection drops mid-game` | 3 |

## 8. Transcripts, games list and Buyout Bench

| ID | Surface | Notes | Covered by | Tier |
|----|---------|-------|------------|------|
| TX-01 | Games list (BL-018): one row per game in two lines (status unless finished, room, turns and when; seats with the winner named at the end), filter chips, refresh; the pages' bar is one way up (Home, Games or Bench) and the other section (`frame-up`, `frame-across`) | `game-row-*`, `filter-*` | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript`; `screens/transcript-pages.spec.ts : snapshot game` | 3, 4 |
| TX-02 | Games list: empty state | `games-empty` | `screens/waking-and-not-found.spec.ts : games list` | 3 |
| TX-03 | Games list: server error with TRY AGAIN; unreachable server | `error-server`, `error-network`, `retry-button` | `screens/waking-and-not-found.spec.ts : games list` | 3 |
| TX-04 | Games list: LOAD MORE (more than 50 games) | `load-more` | GAP: needs more than 50 recorded games; no fixture produces them and faking the list response would test nothing but the button | - |
| TX-05 | Transcript of a live game: redacted banner, live bar, locked LLM panel | | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` | 4 |
| TX-06 | Transcript of a finished game: summary header, standings equal the game-over screen, seat table | | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` | 4 |
| TX-07 | Replay: first / previous / next / last, scrubber, keyboard, deep link, event log, replay board | | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` | 4 |
| TX-08 | Replay: play/pause and speed controls; copy-step-link | `play-pause`, `speed`, `copy-step-link` | GAP: not clicked by any browser test (the stepping controls are); no component test either | - |
| TX-09 | Decision panel (chosen action, legal options) and LLM panel (system prompt, user prompt, raw output, attempts) | `DecisionPanel`, `LlmPanel`, `TextBlock` | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` | 4 |
| TX-09b | LLM panel for a move made without a model call ("NO MODEL CALL" and the reason) | `llm-forced` | `frontend/tests/unit/transcripts.test.tsx : says so when an LLM seat moved without a model call`; `backend/tests/test_llm_agent.py : test_a_forced_move_is_recorded_as_forced_with_no_attempts` | unit |
| TX-10 | Timeline of turns and steps (`Timeline`, `VirtualList`) | | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` | 4 |
| TX-11 | Download transcript JSON | `download-transcript` | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` | 4 |
| TX-12 | Transcript: unknown game id (not-found page with links back) | `error-not-found` | `screens/waking-and-not-found.spec.ts : unknown transcript and unknown benchmark series` | 3 |
| TX-13 | Transcript: "loaded from a snapshot" notice | `snapshot-banner` | `screens/transcript-pages.spec.ts : snapshot game` | 3 |
| TX-14 | Seat chips and seat summary (`SeatChip`, `SummaryHeader`: model first and the seat's character name second for AI seats, kind icon, retries, fallbacks, tokens, cost) | | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript`; `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` | 4 |
| TX-15 | "Waking the server" note on the transcript and bench pages (`PageFrame`) | | `screens/waking-and-not-found.spec.ts : games list` | 3 |
| BN-01 | Leaderboard: protocol id, prompt version, track, the numbers on one line (players, games per matchup, seeds) with the description and the comparability note behind "About this protocol", sample size, warnings, rows with rating, win rate, cost (`RangeBar`) | `leaderboard-table` | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` | 4 |
| BN-02 | Leaderboard: track tabs (all / head-to-head / vs-baseline) and the empty state | `track-*`, `bench-empty` | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` | 4 |
| BN-03 | Leaderboard: protocol and prompt-version selectors | `protocol-select`, `prompt-version-select` | GAP: the standalone run produces a single protocol and prompt version, so there is nothing to switch to | - |
| BN-04 | Leaderboard: server error with TRY AGAIN | | `screens/transcript-pages.spec.ts : benchmark page` | 3 |
| BN-05 | Series list on the leaderboard page | `series-list`, `series-empty` | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` | 4 |
| BN-06 | Series page: games of the series, one opened in the viewer | `series-games`, `series-played` | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` | 4 |
| BN-07 | Series page: unknown series id | `error-not-found` | `screens/waking-and-not-found.spec.ts : unknown transcript and unknown benchmark series` | 3 |

## 9. Game and UI components (visual states; each must appear in a covered screen above)

| Component | States to see on screen | Seen in surface IDs | Covered by |
|-----------|-------------------------|---------------------|------------|
| `Board` | empty, tiles placed, chains coloured, playable highlight, size md/lg | PG-01, PG-17, HO-03 | `screens/turn-basics.spec.ts : expanding a chain`; `screens/layout.spec.ts : busy`; `screens/host.spec.ts : host view of a busy mid-game board` |
| `Tile` | empty, in rack, selected, placed, lone (orphan), dead/unplayable | PG-01..03 | `screens/place-tile.spec.ts : dead tile in hand`; `screens/turn-basics.spec.ts : opening turn` |
| `TileRack` | enabled, disabled (not my turn), selection | PG-01, PG-11 | `screens/place-tile.spec.ts : opening`; `screens/layout.spec.ts : busy` |
| `ChainMarker` | each of 7 chains, size, price, stock left | PG-04, HO-03 | `screens/host.spec.ts : host view of a busy mid-game board`; `screens/buy-phase.spec.ts : buy phase: prices and availability shown` |
| `ChainSelector` | available chains only; "NOT TIED" in a survivor choice | PG-04, PG-05 | `screens/found-chain.spec.ts : found chain`; `screens/merger.spec.ts : merger: tie between two equal chains` |
| `MergerOrderChoice` | one row per same-size defunct chain (size, price, bonuses, holders); first / next wording | PG-50 | `screens/merger-order.spec.ts : merger order: the human picks which same-size chain is absorbed first` |
| `MergerDisposition` / `StockStepper` | sell/trade/hold limits, trade max by survivor stock, buy stepper | PG-06, PG-08 | `screens/merger.spec.ts : disposition (human first)`; `screens/buy-phase.spec.ts : buy phase: prices and availability shown` |
| `Standings` | the matrix: chain columns in ruleset order, majority / minority / tie cells, empty cells, inactive chains, cash + shares, net worth, rank (ties "="), footer rows, turn marker, YOU | PG-13, PG-29, HO-03, HO-10 | `screens/table-view.spec.ts : players matrix at`; `screens/table-view.spec.ts : table view on desktop`; `screens/table-view.spec.ts : table view on phone`; `screens/host.spec.ts : host view of a busy mid-game board`; `screens/board-fit.spec.ts : four players mid-game` |
| `PhaseHelp` | closed, open, closed again by Escape / outside / the button; unread mark | PG-49 | `screens/board-fit.spec.ts : in the phase bar holds the placing hint` |
| `ChainTable` | majority, minority, ties, sole holder, nobody; my position; held off-board chains; no holdings | PG-14, PG-22 | `screens/table-view.spec.ts : table view on desktop`; `screens/table-view.spec.ts : table view on phone`; `screens/place-tile.spec.ts : opening`; `screens/merger.spec.ts : disposition (human first)` |
| `MergerResult`, `MergerLog` | in progress (deciding / to decide), bonuses with ties, survivor after the merger with my live projection, complete with dispositions, gone by itself after the next tile, a log line opened in place and closed | PG-23, PG-24, PG-40, PG-42, HO-11 | `screens/table-view.spec.ts : merger result: bonuses at once`; `screens/decision-tab.spec.ts : holders and decisions, the survivor after the merger`; `screens/decision-tab.spec.ts : shown with what was paid, nothing to close` |
| `DecisionTab`, `BuyPanel`, `HolderChips`, `StatusLine` | each view; holders in rank order with ties and me; projection; status line mine / other | PG-38..PG-44 | `screens/decision-tab.spec.ts : every chain's holders and my shares next to the stepper`; `screens/decision-tab.spec.ts : waiting during someone else's disposition` |
| `TradeBuilder` | stocks and money both ways, player picker; opened on a starting point from another player's offer (`trade-started-from`) | TR-01, TR-09 | `screens/trades.spec.ts : propose a trade through the builder`; `screens/trades.spec.ts : an offer between two other players` |
| `TradeOffers`, `TradeActivity` | incoming, outgoing, none; open offers at the table (between others with competing-offer buttons, for me with ANSWER, none); recent trades in words | TR-03, TR-06, TR-08, TR-11 | `screens/trades.spec.ts : outgoing offer stays pending until cancelled`; `screens/trades.spec.ts : an offer between two other players` |
| `GameOver` | final scores, winner, ties, breakdown | PG-15, HO-06 | `screens/end-game.spec.ts : game over with a tie`; `screens/host.spec.ts : host view of a finished game` |
| `ReconnectionOverlay`, `ReconnectedToast` | reconnecting, welcome back | CN-03, CN-04 | `screens/connection.spec.ts : connection drops mid-game` |
| `AddAiControl`, `RemoveSeatButton` | menu, disabled entry, remove | PL-02..04 | `screens/lobby.spec.ts : lobby: AI menu` |
| `ShareRoom` | room code and Invite (share sheet, copied, link shown) | PL-01, H-18 | `screens/home-entry.spec.ts : join link` |
| `AiThinking` | shown while an AI seat decides | PG-12 | `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` |
| `SeatKindBadge` | bot, LLM, scripted icons; popover open (LLM with model, bot); static icon inside the trade builder's partner buttons and transcript seat chips; fallback marker | PG-20, PG-21, PG-37 | `screens/seat-badge.spec.ts : seat badge on a phone`; `screens/seat-badge.spec.ts : seat badge on a laptop`; `journeys/solo-vs-ai-full-game.spec.ts : solo vs AI` |
| `ChatPanel` | card (lobby, game over), in a tab, read-only (spectator), AI badge | CH-01..CH-05 | `screens/chat.spec.ts : chat on a phone`; `screens/chat.spec.ts : chat on desktop` |
| `GameLayout`, `Tabs` (`TabList`, `TabPanels`) | phone: Board tab (board + table panel) + dock (rack, status line) + bottom bar; wide: board (status line, rack) + sidebar tabs with the table panel first; TV: pinned players and Chains; count and dot badges | PG-26..PG-33, PG-38, HO-03, HO-12 | `screens/tabs.spec.ts : board, decision, rack and tabs fit; every tab shows its content`; `screens/host.spec.ts : board, scoreboard and chain list do not overlap or leave the screen`; `src/components/ui/Tabs.test.tsx : arrow keys` |
| `Modal`, `Hint` | open (trade builder: dialog on wide screens, full-screen sheet on phones), backdrop; a hint in full and retired to "?" | TR-01, PG-46 | `screens/trades.spec.ts : propose a trade through the builder`; `screens/trades.spec.ts : a full-screen sheet, one line per row`; `screens/trades.spec.ts : a hint is read once` |
| `Header`, `PageShell`, `FlashValue` | room, name, cash (flashes on change), tile pool; `fill` (in game: the screen, no page scroll); phase bar `data-turn` | PG-14, PG-26, PG-34 | `screens/turn-basics.spec.ts : opening turn`; `screens/appearance.spec.ts : your-turn signal` |
| `Slider`, `Badge` | disposition sliders; status and kind badges | PG-06, TX-01 | `screens/merger.spec.ts : disposition (human first)` |
| `DecisionPanel`, `LlmPanel`, `TextBlock`, `Timeline`, `VirtualList`, `ReplayBoard`, `SummaryHeader`, `SeatChip`, `RangeBar`, `PageFrame` | transcript and bench widgets | TX-01..TX-15, BN-01..BN-07 | `transcripts/transcripts.spec.ts : play a game, read its live and full transcript` |


## Known gaps (also listed by the check script)

Every `GAP:` above has a reason. In short:

- **Thinking indicator in a screen test** (PG-12, HO-05): no seat with a delay exists in test mode.
  Asserted in journeys J1 and J4.
- **BOT ASSIST marker** (PG-21): needs a fake LLM that answers illegally; unit tests only.
- **LOAD MORE** (TX-04), **replay play/pause/speed** (TX-08),
  **leaderboard selectors** (BN-03): no test drives them.
- **Chat "New messages" button** (CH-09): the screen would need more messages than the list
  shows while the reader is scrolled up; covered by the ChatPanel unit test.

Facts learned while filling this map (2026-11-14):

- The "no incoming-trade-offer UI" and "overlay not mounted" notes of the skeleton were stale:
  `TradeOffers` and `ReconnectionOverlay`/`ReconnectedToast` are mounted and tested.
- CN-01/CN-02 are reachable only when the server refuses the socket with a reason the page does not
  recognise; a real handshake failure shows the spinner and retries (see
  [legacy-suite-retirement.md](legacy-suite-retirement.md), gaps).
- A game loaded from an already-finished snapshot shows as "IN PROGRESS" in its transcript (the
  recorder never saw it end). Test mode only; not asserted.

## Summary (checked by the script; update when rows change)

- Surfaces: 176
- Covered: 171
- GAP: 7
- Journeys: 7

## Appendix: Snapshot fixtures available

Generated by real play (`cd backend && python -m fixtures_gen`); see `frontend/tests/e2e/fixtures/snapshots/README.md`. Each file holds a recipe, snapshot and `expect` block; the human seat is `p1` unless noted. Every fixture is used by at least one screen test (checked below by the script: a fixture row without a test reference fails).

| Fixture | Players | Phase | Decision (who) | What the human sees | Covered by |
|---|---|---|---|---|---|
| `buy-phase-multi-chain` | 4 | buy_stocks | buy_stocks (p1) | The human is in the buy phase with at least 3 active chains and enough cash for 3 shares of any of them. | `screens/buy-phase.spec.ts : buy phase: prices and availability shown`; `screens/connection.spec.ts : connection drops mid-game` |
| `dead-tile-in-hand` | 3 | place_tile | place_tile (p1) | All 7 chains are active and the human holds a tile that would create an 8th chain (unplayable). | `screens/place-tile.spec.ts : dead tile in hand` |
| `disposition-human-first` | 4 | merger | stock_disposition (p1) | The human is first to dispose of defunct stock: holds an odd number (>= 3) of shares and a 2:1 trade is possible. | `screens/merger.spec.ts : disposition (human first)`; `screens/reload.spec.ts : reload during a stock disposition` |
| `disposition-trade-limited` | 3 | merger | stock_disposition (p1) | The human disposes defunct stock but the survivor's remaining bank stock limits the 2:1 trade below the human's even share count. | `screens/merger.spec.ts : disposition (trade limited by the bank)` |
| `disposition-waiting-on-other` | 4 | merger | stock_disposition (p3) | A merger is in progress; another player is deciding on defunct stock and the human (a stockholder) is queued behind them. | `screens/merger.spec.ts : disposition (waiting)`; `screens/host.spec.ts : host view of a merger in progress` |
| `end-game-available` | 4 | place_tile | place_tile (p1) | The human's turn (place tile) and declaring the end game is legal. | `screens/end-game.spec.ts : end game available` |
| `found-chain-choice` | 4 | found_chain | found_chain (p1) | The human just placed a tile that founds a chain and must choose among at least 3 available chains (some chains already on the board). | `screens/found-chain.spec.ts : found chain`; `screens/reload.spec.ts : reload while choosing a chain` |
| `game-over` | 4 | game_over | - (-) | A finished game (end declared) with final standings and a single winner. | `screens/end-game.spec.ts : game over: standings`; `screens/transcript-pages.spec.ts : snapshot game` |
| `game-over-tie` | 5 | game_over | - (-) | A finished game where the top two players tie on final cash. | `screens/end-game.spec.ts : game over with a tie` |
| `last-turn-before-game-over` | 4 | buy_stocks | buy_stocks (p1) | The human already bought stock this turn and declaring the end game (one action) ends the game. | `screens/end-game.spec.ts : last turn before game over` |
| `low-cash` | 4 | buy_stocks | buy_stocks (p1) | The human is in the buy phase and cannot afford any stock. | `screens/buy-phase.spec.ts : low cash` |
| `merger-order-tie` | 3 | merger | choose_defunct_order (p1) | The human's tile merged three chains; the two defunct chains are the same size and the human must choose which is absorbed first. | `screens/merger-order.spec.ts : merger order: the human picks which same-size chain is absorbed first` |
| `merger-survivor-tie` | 4 | merger | choose_survivor (p1) | The human merged two equal-size chains and must choose the survivor. | `screens/merger.spec.ts : merger: tie between two equal chains`; `screens/merger-payout.spec.ts : merger payout` |
| `multi-chain-merger` | 3 | merger | stock_disposition (p1) | One tile merged 3 chains; the human is a stockholder deciding on defunct stock. | `screens/merger.spec.ts : multi-chain merger` |
| `opening-place-tile` | 4 | place_tile | place_tile (p1) | Turn 1: empty board, the human holds 6 tiles and must place one. | `screens/place-tile.spec.ts : opening`; `screens/turn-basics.spec.ts : opening turn` |
| `safe-chain-on-board` | 3 | place_tile | place_tile (p1) | A safe chain (11+ tiles) is on the board and the human holds a tile that cannot be played because it would merge two safe chains. | `screens/place-tile.spec.ts : safe chain on board` |
| `six-player-midgame` | 6 | place_tile | place_tile (p1) | Six players, busy mid-game board, the human to place a tile. | `screens/layout.spec.ts : busy` |
| `three-player-midgame` | 3 | place_tile | place_tile (p1) | Three players, busy mid-game board, the human to place a tile. | `screens/layout.spec.ts : busy`; `screens/host.spec.ts : host view of a busy mid-game board`; `screens/turn-basics.spec.ts : expanding a chain` |
| `trade-between-others` | 4 | buy_stocks | buy_stocks (p1) | The human's turn; one opponent has proposed a trade (stock for cash) to another opponent. The human is not a party but sees the public offer. | `screens/trades.spec.ts : an offer between two other players`; `screens/trades.spec.ts : a new offer between two other players` |
| `trade-incoming` | 4 | buy_stocks | buy_stocks (p1) | It is the human's turn and another player has proposed a trade to them (stock for cash). | `screens/trades.spec.ts : incoming offer on my turn: accept it` |
| `trade-incoming-not-my-turn` | 4 | buy_stocks | buy_stocks (p3) | Another player's turn; a third player has proposed a trade to the human. | `screens/trades.spec.ts : incoming offer while another player is on turn`; `screens/reload.spec.ts : reload with a trade offer waiting` |
| `trade-outgoing-pending` | 4 | buy_stocks | buy_stocks (p1) | The human proposed a trade (stock for cash) and is awaiting the answer. | `screens/trades.spec.ts : outgoing offer stays pending until cancelled`; `screens/host.spec.ts : host view lists a pending trade` |
