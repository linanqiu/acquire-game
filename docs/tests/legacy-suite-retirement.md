# Legacy browser suite: retirement record

Written before the old suite was deleted (TP-007, 2026-11-14). The old suite was the Playwright
`legacy` project: `frontend/tests/e2e/scenarios/*.spec.ts` (62 tests, about 7,000 lines plus 1,700
lines of helpers) and the top-level specs `bot-game`, `home`, `lobby`, `play-tile-test`,
`verification` (28 tests, 3 of them `test.skip`). 90 titles in all. It took more than 10 minutes
because every test played 20-40 turns through the browser against live bots.

Method: every test body was read (not just its title). Many overclaim. Of the 18 "trading" tests,
7 only create a game and take screenshots ("Test demonstrates trade notification infrastructure");
2.10-2.18 sit behind `if (stockCount >= 2 && tradeMax >= 2)` guards and pass without checking
anything when the seeded game does not reach the state; 5.15 "majority bonus paid" only asserts that
a merger happened (cash before/after is `console.log`ged, never compared); 1.10 "disconnected player
is skipped" asserts only that the phase banner is still visible. Those are listed under "not worth
covering" or "gap" according to whether the behaviour they name is real.

What replaced it, by tier:

| Tier | Where | Size |
|------|-------|------|
| 1 engine, 2 protocol | `backend/tests/` (`scenarios/`, `protocol/`, `test_*.py`) | 1,181 fast tests (+44 slow) |
| 3 screen | `frontend/tests/e2e/screens/` | 57 tests (43 before this change, 14 added), about 2.2 minutes |
| 4 journey | `frontend/tests/e2e/journeys/` | 9 tests (7 journeys + 2 static guards), about 1.4 minutes |
| transcripts | `frontend/tests/e2e/transcripts/` | 1 journey, about 2 minutes |

Names below are `file : test`. Screen tests are in `frontend/tests/e2e/screens/`, journeys in
`frontend/tests/e2e/journeys/`, backend tests in `backend/tests/`.

## 1. Covered: legacy test -> new test

### Top-level specs

| Legacy test | What it really checked | Now covered by |
|---|---|---|
| bot-game: can create a game with bots and receive game state | WS `game_state` arrives with phase and 3 players | protocol `test_websocket_gameplay.py : test_game_starts_with_valid_state`, `protocol/test_full_games.py : test_human_vs_two_scripted_to_game_over` |
| bot-game: human player receives their hand | hand has 1-6 tiles | protocol `test_websocket_gameplay.py : test_player_receives_private_hand`; screens `place-tile.spec.ts : opening: ...` (six tiles in the rack) |
| bot-game: can play a tile from hand | place_tile over the WS changes the board | protocol `test_websocket_gameplay.py : test_turn_advances_after_valid_tile_placement`; every screen test places a tile through the UI |
| bot-game: bots take turns automatically | bots move before the human's turn | protocol `protocol/test_driver.py` (agents act through the driver), journeys `solo-vs-ai-full-game.spec.ts` |
| bot-game: can complete a turn: place tile, skip buy, end turn | one full turn | screens `buy-phase.spec.ts : buy phase: skip buying keeps cash and ends the turn`; journeys J1 |
| bot-game: game state includes all required fields | JSON shape | protocol `test_websocket_gameplay.py : test_game_state_includes_all_required_fields` |
| bot-game: player state includes money and stocks | start cash 6000 | engine `test_player.py` (starting cash), screens `place-tile.spec.ts : opening: ...` (`$6,000` in header and players panel) |
| home: displays the welcome message / shows lobby page content | heading and tagline | every journey opens `/` and uses the forms; trivial copy, see list 2 |
| home: unknown route shows 404 | not-found page | screens `lobby.spec.ts : unknown URL shows the not-found page with a way back`; journeys `entry-errors.spec.ts` |
| home: 3 skipped routing tests | skipped for a long time, assert nothing | superseded by journeys `entry-errors.spec.ts` (`/play/QZQZ`, not-a-player) |
| lobby: displays Create Game form / Join Game form | the form controls exist | journeys J1-J7 use them; `no-shortcuts.spec.ts` |
| lobby: Create: shows validation error when name is empty | "Name is required" | journeys `entry-errors.spec.ts` |
| lobby: Join: shows validation error when name is empty / room code too short | validation messages | journeys `entry-errors.spec.ts` |
| lobby: auto-capitalizes room code | input uppercases | journeys `entry-errors.spec.ts` (`qzqz` joins as `QZQZ`), screens `home-entry.spec.ts : names are trimmed ...` |
| lobby: shows error for non-existent room | "Room not found" | journeys `entry-errors.spec.ts` |
| lobby: creates game and redirects to player view with is_host flag | `/play/XXXX?is_host=1` | journeys J1; screens `home-entry.spec.ts : names are trimmed ... host is marked in the URL` |
| lobby: joins existing room and redirects | join works | journeys J2, `entry-errors.spec.ts` |
| lobby: host creates game and player joins (`@ci`) | two contexts, join | journeys `two-humans-and-bot.spec.ts` |
| play-tile-test: can select and place a tile on the board | select, button enabled, place, phase changes | screens `place-tile.spec.ts : opening: ...` |
| verification: complete flow with screenshot evidence (`@ci`) | home -> create -> lobby shows name, 1/6, ADD BOT, START GAME | journeys J1 (`@ci`), `entry-errors.spec.ts` (`@ci`); screens `lobby.spec.ts : lobby: AI menu, ...` |

### scenarios/smoke.spec.ts

| Legacy test | Now covered by |
|---|---|
| should capture screenshots at each step | the screenshot helpers are used by every spec; checking that the helper writes a file is not product behaviour |
| should capture console errors | screens `support/test.ts` `guard` fixture fails every test on console/page errors; journeys `support/journey.ts` does the same |
| should verify lobby page structure | journeys (all start at `/`) |
| should create game, add bots, and start via UI (`@ci`) | screens `lobby.spec.ts : lobby: AI menu, START GAME needs three seats, ...`; journeys J1 |
| should create spectator game with bots only | journeys `spectator-host-view.spec.ts`; screens `lobby.spec.ts : host/spectator lobby: ...`, `host.spec.ts` |

### Turn flow (1.x)

| Legacy test | Now covered by |
|---|---|
| 1.1 10+ complete turns | journeys J1 (20+ turns), J2 (11 each), J7; protocol `test_full_games.py` |
| 1.2 skip purchase 10 turns | screens `buy-phase.spec.ts : buy phase: skip buying keeps cash ...`, `low cash: ... skipping still works`; every screen test ends turns without buying |
| 1.3 turn with chain founding | screens `found-chain.spec.ts`; journeys J1/J2 (founding is looped for); engine `scenarios/test_turn_flow.py : test_scenario_1_2_turn_with_chain_founding` |
| 1.4 20 turns with state tracking | journeys J1 (cash/holdings checked every turn against the players panel) |
| 1.10 disconnect during turn | asserted nothing beyond "banner visible". Reload and offline behaviour: journeys `reconnect-and-refresh.spec.ts`, screens `connection.spec.ts`, `reload.spec.ts`; engine/session `test_session_manager.py : test_disconnect_removes_websocket` |

### Chain founding (3.x)

| Legacy test | Now covered by |
|---|---|
| 3.1 & 3.3 chain creation, all chains available, stock count rises | screens `found-chain.spec.ts` (selector, free share); engine `scenarios/test_chain_founding.py : test_founder_receives_free_stock` |
| 3.4 & 3.5 selection limited, founder's bonus | screens `found-chain.spec.ts` (active chains disabled as ACTIVE, free share, cash unchanged); engine `test_cannot_found_active_chain` |
| 3.8 & 3.9 chain colours and size on board | screens `turn-basics.spec.ts : expanding a chain: ...` (new), `found-chain.spec.ts` |
| 3.10 founding survives a disconnect | screens `reload.spec.ts : reload while choosing a chain: ...` |
| 3.2 three-tile founding | engine `test_rules.py : test_found_multiple_adjacent_played_tiles` |
| 3.6 founder bonus stock depleted | the legacy test only bought stock and logged progress (conditional `expect`); rule: engine `scenarios/test_chain_founding.py` ("Exhaust all Sandpiper stocks"); sold-out UI: screens `buy-phase.spec.ts : buy phase: prices and availability shown, ...` |
| 3.7 cannot found 8th chain | screens `place-tile.spec.ts : dead tile in hand: ...` (the tile is marked and cannot be selected); engine `scenarios/test_chain_founding.py : test_scenario_3_5_cannot_found_eighth_chain`, `test_tile_placement.py : test_cannot_create_8th_chain` |

### Chain expansion (4.x)

| Legacy test | Now covered by |
|---|---|
| 4.1 & 4.3 & 4.7 expansion, orphan absorption, no founding | screens `turn-basics.spec.ts : expanding a chain: ...` (chain grows by more than the placed tile, buy list and board agree); engine `scenarios/test_chain_expansion.py : test_scenario_4_1`, `4_3`, `4_7` |
| 4.4 & 4.8 price changes with size, info panel updates | prices: engine `test_stock_purchases.py` price tests, `test_calculator.py`; panel: screens `buy-phase.spec.ts` (price/size/available per row), `host.spec.ts` (chain markers) |
| 4.2 & 4.5 & 4.6 multi-tile expansion, safe at 11 | engine `test_chain_expansion.py : test_scenario_4_2`, `4_5`, `4_6`; screens `place-tile.spec.ts : safe chain on board: ...` (safe chain visible and unmergeable) |

### Mergers (5.x)

| Legacy test | Now covered by |
|---|---|
| 5.1 two-chain merger | screens `merger.spec.ts` (all five tests), journeys J1/J2/J7 (a merger is looped for); engine `scenarios/test_mergers.py` |
| 5.2 tie-breaker, survivor selection | screens `merger.spec.ts : merger: tie between two equal chains, human picks the survivor`; journeys J2 (Bob picks the survivor) |
| 5.5 safe chain immunity + extended play | screens `place-tile.spec.ts : safe chain on board: ...`; engine `test_mergers.py : test_scenario_5_5_cannot_merge_two_safe_chains`; extended play is covered by J1 |
| 5.8 sell all defunct stock | screens `merger.spec.ts : multi-chain merger: nothing to trade for, sell it all, ...` |
| 5.11 mixed disposition | screens `merger.spec.ts : disposition (human first): sell/trade/hold limits and a mixed disposition` |
| 5.15 majority bonus paid | the legacy test never compared cash. Rule: engine `test_mergers.py : test_scenario_5_6`..`5_10`, `test_complex_mergers.py`. Screen: `merger-payout.spec.ts : merger payout: bonuses reach the defunct chain stockholders on screen, nobody else` (new) |
| 5.x multiple mergers in extended play | journeys J1/J2; protocol `test_full_games.py`; engine `test_full_game_simulation.py` |
| 5.x merger with stock purchase afterwards | screens `merger.spec.ts` (each test plays three more turns, buying included in `buy-phase.spec.ts`); journeys J1 |

### Stock purchases (6.x)

| Legacy test | Now covered by |
|---|---|
| 6.1-6.3 buy 1, 2, 3 | screens `buy-phase.spec.ts : buy phase: prices and availability shown, 3-share cap, buy a mix`; engine `test_stock_purchases.py : test_scenario_6_1`..`6_3` |
| 6.4 buy 0 (skip) | screens `buy-phase.spec.ts : buy phase: skip buying ...` |
| 6.5 & 6.6 cannot buy 4+, mixed chains | screens `buy-phase.spec.ts : ... 3-share cap, buy a mix` (all `+` disabled at 3/3, two chains bought) |
| 6.8 & 6.12 insufficient funds, price display | screens `buy-phase.spec.ts : low cash: cannot afford any stock, ...` |
| 6.14 buy the newly founded chain | screens `found-chain.spec.ts` (buy row of the new chain is offered); journeys J1 |
| 6.15 & 6.7 no chains: nothing to buy | screens `turn-basics.spec.ts : opening turn: no chains to buy, ...` (new) |
| 6.1-6.6 extended, 10+ turns with purchases | journeys J1, J2, J7 (purchases checked against cash and holdings on screen) |

### Trading (2.x)

| Legacy test | Now covered by |
|---|---|
| 2.1 initiate trade offer (opens builder, picks a recipient, cancels) | screens `trades.spec.ts : propose a trade through the builder: validation, then the offer shows as pending`; journeys J2 |
| 2.2 cancel trade offer (cancels the builder dialog) | screens `trades.spec.ts : outgoing offer stays pending until cancelled`; journeys J2 (cancel) |
| 2.3 accept trade offer (body: join, start, screenshots) | screens `trades.spec.ts : incoming offer on my turn: accept it, ...`, `incoming offer while another player is on turn: accept`; journeys J2 |
| 2.4 reject trade offer (body: join, start, screenshots) | screens `trades.spec.ts : ... reject it, nothing changes`; journeys J2, J3 |
| 2.6 trade with insufficient stocks (empty trade shows a validation error) | screens `trades.spec.ts : propose a trade through the builder: ...` (partner, offer and request messages); engine `scenarios/test_trading.py : test_scenario_2_6`, `2_7` |
| 2.7 multiple simultaneous offers (body: three humans join, screenshots) | engine `scenarios/test_trading.py : test_scenario_2_10_maximum_pending_trades`; protocol `protocol/test_trades.py : test_trade_lists_notifications_and_stale_accept` |
| 2.8 stale trade (body: start game, log line) | protocol `protocol/test_trades.py : test_trade_lists_notifications_and_stale_accept` (the stale accept) |
| 2.10 basic 2:1 trade | screens `merger.spec.ts : disposition (human first): ...` (trade slider moves in pairs, survivor shares arrive); engine `test_trading.py : test_scenario_2_11` |
| 2.11 maximum 2:1 | screens `merger.spec.ts : disposition (human first): ...` (trade set to its cap); `disposition (trade limited by the bank)` |
| 2.12 / 2.15 / 2.16 mixed, with sell, with hold | screens `merger.spec.ts : disposition (human first): ...` (sell 3 / trade 6 / hold rest); engine `test_trading.py : test_mixed_sell_trade_keep`, `test_keep_all_unchanged`, `test_sell_all_receives_money` |
| 2.13 no 2:1 available (pool empty) | screens `merger.spec.ts : multi-chain merger: nothing to trade for, ...` (trade slider disabled); engine `test_complex_mergers.py : test_trade_blocked_no_survivor_stock` |
| 2.14 odd holding, cannot trade the last one | screens `merger.spec.ts : disposition (human first): ...` (step 2); engine `test_trading.py : test_scenario_2_12_merger_trade_odd_shares`, `test_odd_trade_count_rejected` |
| 2.17 2:1 depletes the survivor pool | screens `merger.spec.ts : disposition (trade limited by the bank)`; engine `test_trading.py : test_trade_limited_by_survivor_availability`, `test_complex_mergers.py : test_partial_trade_limited_stock` |
| 2.18 2:1 in a multi-chain merger | screens `merger.spec.ts : multi-chain merger: ...`; engine `test_complex_mergers.py : test_merger_handles_multiple_defunct_chains` |

### Edge cases (8.x)

| Legacy test | Now covered by |
|---|---|
| 8.1 & 8.2 min and max players | screens `lobby.spec.ts : lobby: AI menu, START GAME needs three seats, ...` (3 seats enable START); journeys `entry-errors.spec.ts` (6/6, add buttons disabled); engine `test_edge_cases.py : test_scenario_8_1`, `8_2` |
| 8.3 cannot start with one player | screens `lobby.spec.ts : lobby: ...` (disabled at 1 and 2 seats); journeys `entry-errors.spec.ts` (hint text); protocol `protocol/test_seat_routes.py : test_two_seats_cannot_start` |
| 8.4 cannot add more than 6 | journeys `entry-errors.spec.ts`; protocol `test_seat_routes.py : test_full_room` |
| 8.5 & 8.8 & 8.19 hand of 6, bag count | screens `place-tile.spec.ts : opening: ...` (six tiles, `header-tile-pool`); engine `test_edge_cases.py : test_scenario_8_6`, `8_8` |
| 8.6 & 8.20 hand refills, bag decreases | screens `turn-basics.spec.ts : opening turn: ...` (new); protocol `test_websocket_gameplay.py : test_tile_pool_decreases_with_turns` |
| 8.9 & 8.10 & 8.11 & 8.13 unplayable tiles appear | the legacy test played up to 40 turns hoping to see one ("No unplayable tiles appeared ... possible with some seeds"). Screens `place-tile.spec.ts : dead tile in hand: ...`, `safe chain on board: ...` (marker, reason text, not selectable); engine `test_tile_placement.py`, `test_calculator.py : test_unplayable_reasons` |

### End game (7.x)

| Legacy test | Now covered by |
|---|---|
| 7.3 & 7.15 & 7.13 & 7.16 play to the end by the END GAME button, game over screen, play again | journeys J1 (declares the end, standings, breakdown, play again); screens `end-game.spec.ts : end game available: ...`, `game over: standings, single winner, play again returns to the home page` |
| 7.4 cannot end the game prematurely, no END GAME button | screens `turn-basics.spec.ts : opening turn: ...` (new: absent while placing and while buying); `end-game.spec.ts` (present when declarable); engine `test_end_game.py : test_cannot_declare_end_game_conditions_not_met` |
| 7.8 & 7.11 final scoring with breakdown | screens `end-game.spec.ts : game over: ...`, `game over with a tie: ...`; `host.spec.ts : host view of a finished game shows the full results table` (cash + bonuses + sales = total); engine `test_end_game.py : test_final_bonuses_paid_all_chains`, `test_all_stocks_liquidated_at_price` |

## 2. Not worth covering

| Legacy test | Reason |
|---|---|
| home: displays the welcome message; shows lobby page content | static copy |
| lobby: displays the title and subtitle; displays game metadata (3-6 players, ~60 min) | static copy |
| home: three `test.skip` routing tests | skipped, assert placeholder copy that no longer exists |
| lobby: trims whitespace / stores credentials in sessionStorage | the sessionStorage keys are an implementation detail (a refresh that restores the game is covered by CN-05 journeys and screens). The visible part, trimming, is now covered (see gaps) |
| smoke: should capture screenshots at each step | tests the test helper, not the product |
| trading 2.5 counter trade offer | no counter-offer feature exists in the product; the body only joins and starts a game |
| trading 2.9 trade timeout | no timeout feature exists; the body only starts a game |
| turn-flow 1.10 disconnected player's turn is skipped | the product does not skip disconnected players; the test asserted nothing beyond "banner visible" (real reconnect behaviour is in J5) |
| bot-game: bots take turns automatically (assertion `tilesOnBoard > 0 \|\| isOurTurn`) | cannot fail; driver behaviour is tested in protocol tests |
| mergers 5.x "Multiple mergers in extended gameplay", "Merger with stock purchase after completion" | duplicate of 5.1 plus a turn counter; J1 and the protocol full games cover long play |
| stock-purchases "extended 10+ turns" | duplicate of 6.1-6.3 with a loop; J1/J2 do it with live cash checks |
| turn-flow 1.1/1.2/1.4 as separate tests | same loop at 10, 10 and 20 turns; J1 does 20+ |
| 3.6 "Founder bonus stock depleted" as a browser test | needed ~8 turns of buying 3 stocks and then did not assert depletion unless it happened; rule is tier 1 |

## 3. Gaps: behaviour only the legacy suite exercised, and the test added for each

| Gap | Legacy test | New test |
|---|---|---|
| Names are trimmed on create and join; host URL carries `is_host=1`; guest lobby shows WAITING FOR HOST and no START GAME | lobby: trims whitespace from name; creates game ... is_host flag | screens `home-entry.spec.ts : names are trimmed on create and join, and the host is marked in the URL` |
| Opening turn: buy phase with no chain on the board says so, offers SKIP & END TURN and no buy rows | 6.15 & 6.7 | screens `turn-basics.spec.ts : opening turn: no chains to buy, END GAME not offered, hand refills and the bag shrinks` |
| END GAME is not offered when the game cannot be ended | 7.4 | same test |
| Rack refills to 6 after a turn; the bag counter in the header decreases; the placed lone tile shows as a lone tile on the board | 8.6 & 8.20 | same test |
| An expanding tile takes the chain colour; the chain grows by more than the tile when lone tiles are absorbed; buy list and board agree on the size | 3.8 & 3.9, 4.1 & 4.3 | screens `turn-basics.spec.ts : expanding a chain: the new tile takes the chain colour and the chain size follows the board` |
| Majority/minority bonuses reach the right players and the players panel shows them | 5.15 (the legacy test never compared) | screens `merger-payout.spec.ts : merger payout: bonuses reach the defunct chain stockholders on screen, nobody else` |

Gaps from the test agents' coverage docs (not legacy tests) closed in the same change:

| Surface | New test |
|---|---|
| CN-01 / CN-02 connection error screen, player and host, and REFRESH recovering | screens `server-faults.spec.ts : player page: a refused socket ...`, `host page: a refused socket ...` |
| CN-10 host page reconnection overlay | screens `host-connection.spec.ts : host page: connection drops mid-game ...` |
| PL-03 unavailable AI option and a failed catalog | screens `server-faults.spec.ts : AI menu: unavailable entries are disabled ...` |
| H-12 / H-13 waking the server, server not answering (home page) | screens `waking-and-not-found.spec.ts : home page: ...` (two tests) |
| TX-02 / TX-03 / TX-12 / BN-07 games list empty and failing, unknown transcript and series | screens `waking-and-not-found.spec.ts : games list ...`, `unknown transcript and unknown benchmark series ...` |
| TX-13 snapshot notice, BN-04 leaderboard error | screens `transcript-pages.spec.ts` (two tests) |

Already covered by the earlier screen tests although the coverage doc listed them as open: failure
toasts for create / add bot / start (`lobby.spec.ts : failures show a toast ...`), dead-tile
explanation (`place-tile.spec.ts : dead tile in hand ...`, `rack-note-*`), "not enough cash"
(`buy-phase.spec.ts : low cash ...`; the buy form disables the steppers and shows a "no cash" note).

Finding while writing the connection-error test: the screen is reached only when the server refuses
the socket (close code 4004) with a reason the page does not recognise. A real handshake failure
fires `onerror` and then `onclose`; `onclose` immediately resets the status to "connecting" and the
page retries, so the user sees the spinner and then the reconnection overlay, never the error screen.
The test therefore uses `page.routeWebSocket` to refuse the socket; no game state is faked.

Not closed (reasons in `surface-coverage.md`): the AI thinking indicator in a screen test. Scripted
and fake-LLM seats have no delay option, so there is no stable state to look at; it is asserted in
journeys J1 and J4.
