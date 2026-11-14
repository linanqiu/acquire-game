# Backend test audit (2026-11-14)

Owner instruction: *"actively remove trivial or useless tests and make sure
tests actually test meaningful gameplay"*. This audit judged every backend test
by evidence (what it can detect), not by taste. The yardstick is mutation
testing: a test earns its upkeep if it fails when the code it covers is wrong.

## Summary

| | Before | After |
|---|---|---|
| Test functions | 945 | 590 |
| Test cases (with parametrisation) | 1,291 (1,224 fast) | 1,021 (954 fast) |
| Lines of test code (`backend/tests`, `backend/conftest.py`) | 22,911 | 15,169 |
| Engine mutation score (8 modules, fast tier) | 77.9 % (1,240 / 1,592) | 90.0 % (1,360 / 1,511) |
| Agent/server mutation score (5 modules, fast tier) | 54.5 % (508 / 932) | 63.4 % (591 / 932) |
| Fast tier wall time (`-n auto`, 4 cores, same machine load, interleaved runs) | 34.7 s, 35.0 s, 36.8 s | 27.2 s, 32.6 s |
| Full suite wall time (same conditions) | 246 s, 252 s | 226 s |
| Flaky tests | 3 (2 measured at 2.4 % and 0.3 % failure rates; 1 load-dependent) | 0 in 15 seeded random-order runs + 50 loops |

444 test cases were removed and 174 added. The old board-surgery scenario
package (`tests/scenarios/`, 209 cases), `test_rules.py` (49),
`test_phase_transitions.py` (19) and `test_full_game_simulation.py` (19) are
gone; their rules now have one home each in `tests/gameplay/` (59 cases,
positions reached by real moves), `test_decisions.py` and `test_events.py`.

Timing note: the machine was shared with two other agents running browser
suites (load average 12-15 on 4 cores) for the whole session, so the before
and after suites were timed back to back under the same load. On the idle
machine at the start of the session the old suite took 13.6 s (fast tier)
and 152 s (full).

## Mutation scores

Fast tier as the killing suite; score = (killed + timeout) / all mutants
(uncovered mutants count as survivors). "Before" is the pre-audit commit,
"after" the audited tree. Module sizes differ where dead code was removed.

| Module | Before: mutants / killed / survived / uncovered | Score before | After: mutants / killed / survived / uncovered | Score after |
|---|---|---|---|---|
| `game/rules.py` | 241 / 182 / 38 / 21 | 75.5 % | 220 / 189 / 21 / 10 | **85.9 %** |
| `game/hotel.py` | 45 / 41 / 3 / 1 | 91.1 % | 43 / 42 / 1 / 0 | **97.7 %** |
| `game/game.py` | 593 / 461 / 76 / 56 | 77.7 % | 563 / 514 / 42 / 7 | **91.3 %** |
| `game/decisions.py` | 242 / 207 / 23 / 12 | 85.5 % | 242 / 211 / 25 / 6 | **87.2 %** |
| `game/player.py` | 204 / 134 / 32 / 38 | 65.7 % | 182 / 177 / 5 / 0 | **97.3 %** |
| `game/board.py` | 103 / 95 / 4 / 4 | 92.2 % | 97 / 93 / 4 / 0 | **95.9 %** |
| `game/ranking.py` | 5 / 5 / 0 / 0 | 100 % | 5 / 5 / 0 / 0 | 100 % |
| `game/calculator.py` | 159 / 115 / 44 / 0 | 72.3 % | 159 / 129 / 30 / 0 | **81.1 %** |
| **Engine total** | 1,592 / 1,240 / 220 / 132 | **77.9 %** | 1,511 / 1,360 / 128 / 23 | **90.0 %** |
| `agents/driving.py` | 49 / 30 / 11 / 8 | 61.2 % | 49 / 47 / 2 / 0 | **95.9 %** |
| `agents/heuristic.py` | 134 / 53 / 66 / 15 | 39.6 % | 134 / 53 / 66 / 15 | 39.6 % |
| `agents/llm/schema.py` | 241 / 191 / 44 / 6 | 79.3 % | 241 / 216 / 21 / 4 | **89.6 %** |
| `seats.py` | 303 / 150 / 98 / 55 | 49.5 % | 303 / 150 / 98 / 55 | 49.5 % |
| `transcripts/store.py` | 205 / 84 / 67 / 54 | 41.0 % | 205 / 125 / 49 / 31 | **61.0 %** |
| **Agent/server total** | 932 / 508 / 286 / 138 | **54.5 %** | 932 / 591 / 236 / 105 | **63.4 %** |

("killed" includes timeouts.) No module's score dropped. Compared mutant by
mutant (module, function, source line, mutation), **no mutant that the old
suite killed survives the new one except ten listed below, all equivalent or
unreachable through the seat API**; 161 engine mutants and 79 agent/server
mutants that the old suite let live are now killed.

Which test files kill engine mutants now (matrix mode, cheap tests): the
gameplay files kill 236-372 engine mutants each (`test_mergers.py` 372,
`test_end_game.py` 326, `test_founding.py` 288, `test_stock_trading.py` 265,
`test_bonuses.py` 236, `test_turn_flow.py` 216, `test_dead_tiles.py` 208,
`test_player_trades.py` 204). They overlap heavily with each other and with
`test_decisions.py` / `test_events.py` / `test_fixture_provenance.py` by design
(every one plays real turns); their value is that a rule mistake fails a test
named after the rule, with the position spelled out move by move. Old-suite
survivors now killed, by the file that kills them (a mutant can count for
several files): `test_game.py` 62, `test_player.py` 37, `test_calculator.py`
16, `gameplay/test_player_trades.py` 15, `gameplay/test_mergers.py` 14,
`test_board.py` 5, `gameplay/test_turn_flow.py`, `test_end_game.py`,
`test_dead_tiles.py` and `test_decisions.py` 4 each, `test_founding.py`,
`test_hotel.py`, `test_events.py` 3 each; agent/server: `test_transcripts.py`
38, `test_llm_schema.py` 24, `test_driving.py` 17.

### The ten "lost" kills (old suite killed, new suite does not)

All ten were killed only by assertions on helper internals that play cannot
observe:

- `rules.py` `can_place_tile`/`check_end_game`/`is_tile_permanently_unplayable`
  `return False` -> `return None` (5): every caller tests truthiness; the old
  tests asserted `is False`. Equivalent.
- `rules.py` `can_place_tile` on an occupied cell -> `True`, and
  `is_tile_permanently_unplayable` on an already played tile (2): a tile in a
  hand is never on the board (tiles are unique), so unreachable in play.
- `rules.py` `get_merger_survivor([])` (1): no merger has zero chains.
- `game.py` `turn_phase` setter (2): a test-only alias (`game.turn_phase =
  "..."` is board surgery used by two server tests); nothing in the product
  sets it.
- `board.py` `_initialize_grid` starting at column 0 (1, the old test counted
  `board._grid`): the extra cells are unreachable because a `Tile` cannot
  have column 0. Equivalent through the public API.

## Tests added (174 cases), per rule area

| File | Cases | What it pins down (and old-suite survivors it kills) |
|---|---|---|
| `gameplay/test_mergers.py` | 11 | survivor by size and by tie choice (only the mergemaker, only tied chains); disposition order mergemaker-then-clockwise; sell at the pre-merger price, 2:1 trade, hold; missing disposition keys default to 0 (`decisions._parse_disposition` defaults, 3 survivors); trade limited by survivor bank stock (snapshot `disposition-trade-limited`); merger tile and touching lone tiles join the survivor; multi-chain: defuncts largest first, each at its own size (`_start_merger_process` `reverse=True`, `stock_index = 0` reset: survivors); held shares count again after re-founding; trades of merging stock frozen |
| `gameplay/test_bonuses.py` | 8 | sole holder, clear majority/minority, third holder gets nothing, majority elsewhere, majority tie (rounded up), three-way tie, minority tie (rounded up); final bonuses for every chain plus final sales |
| `gameplay/test_founding.py` | 8 | lone tile, founding with every connected lone tile, founder share free, cannot found an active chain, expansion adopts lone tiles and reprices; founder shares from the ruleset (classic 1, mini 2); founder shares the bank lacks paid in cash (`found_chain` `shares > 0` boundary: 2 survivors); 8th-chain tile not offered, its playability as the player sees it |
| `gameplay/test_stock_trading.py` | 9 | mixed purchase at current prices, one purchase per turn, empty purchase, over the limit, never-founded and defunct chains, purchase limit from the ruleset, running out of money, the last bank share |
| `gameplay/test_end_game.py` | 6 | declaring at exactly the end size (classic 41, mini 25) with an unsafe chain on the board (`check_end_game` `>=` -> `>`, a baseline survivor), every chain safe at exactly the safe size (11 / 8), only the player on turn, not while founding, final scoring with defunct stock worthless, standings and winners |
| `gameplay/test_dead_tiles.py` | 4 | tile between two safe chains not playable and replaced at end of turn (`end_turn` replaced list); one tile short of safe it merges; safe size from the ruleset; an all-unplayable hand replaced at turn start (`handle_all_tiles_unplayable` draws and events: 3 survivors) |
| `gameplay/test_player_trades.py` | 9 | accepted trade moves shares and cash both ways and never blocks the turn; only recipient answers / only proposer cancels; a stale offer cannot be accepted and stays until rejected; offering what you lack, zero-quantity trades, bad ids; the smallest trade is one share or one dollar one way (`validate_trade` `> 0` boundaries: 3 survivors) |
| `gameplay/test_turn_flow.py` | 4 | deal and seating order, only the player on turn and only hand tiles, step order, the draw (`drew_tile`), the empty bag, and play to the natural end of tiles (`are_all_tiles_unplayable([])`: a baseline survivor) |
| `test_game.py` (rewritten) | 56 | seat limits from the ruleset, lobby rules, explicit tile order, seeding; 44 cases of "the engine refuses an illegal call by itself and changes nothing" (`Game` guards that `apply_action` normally shadows: 62 mutants the old suite let live); disposition queue and `can_act` in client state; bot flags |
| `test_player.py` (3 new) | 3 | holdings never negative or past the cap, refused changes leave holdings untouched (37 survivors/uncovered) |
| `test_board.py`, `test_hotel.py` | 2 + 3 | tile identity and error texts, empty-cell connectivity; bank bookkeeping and the classic aliases |
| `test_calculator.py` (4 new) | 4 | on positions reached by play: end-game reason exactly at 41/11, who may declare, buy options in the buy phase, merge scenario order and leftovers, the last bank share, bot flags (16 survivors) |
| `test_decisions.py` (1 new) | 1 | replacements also dead: placement skipped and the hand never exceeds its size (`draw_tile` `>=` boundary) |
| `test_driving.py` (new) | 16 | time allowed per seat kind, per-turn action and proposal caps, fallback announcements and categories (17 survivors) |
| `test_llm_schema.py` (23 new) | 23 | `check_against_legal` boundaries: exact money/stock passes, one more fails; disposition defaults and limits; proposals against holdings (24 survivors) |
| `test_transcripts.py` (2 new) | 2 | redaction removes every trace of a hand (fallback detail, legal tiles, LLM text and attempts) and keeps public lines; live totals rebuilt from decision lines (38 survivors/uncovered) |

Shared builders live in `backend/tests/support/` (`table.py`, `drive.py`,
`snapshots.py`); unused fixtures were removed from `backend/conftest.py`
(board/hotel/player/tile fixtures, `game_state`, `async_iterator`, ...).
`tests/llm_support.bot_game` plays its position once per process and hands
out copies.

## Surviving mutants left, and why

Engine: 128 survive and 23 are uncovered (of 1,511). Each one was assigned a reason (`classify_surv` rules over module, function, mutation and source line, then read):

- **Equivalent** (43). `dict.get(k, 0)` defaults where the key always
  exists (bonus dicts, holdings); `> 0` -> `>= 0` on a zero quantity that does
  nothing either way (selling or trading 0 shares); `return False` ->
  `return None` where callers test truthiness; assignments repeated later in
  the same flow (`_merger.survivor` is set in `play_tile`,
  `choose_merger_survivor` and `_start_merger_process`; `pending_action =
  None` before it is overwritten); `_expand_chain` setting the placed tile
  that the connected-tiles loop also sets; splitting a single minority
  holder's bonus by 1 (`calculate_bonuses` `> 1` -> `>= 1`); "exactly one safe
  chain survives" (a safe chain is always the larger one, so the size rule
  gives the same answer); `zip(..., strict=True)` on equal lengths; loop
  guards that `draw_tile` repeats (`handle_all_tiles_unplayable`).
- **Unreachable through the seat API** (54). Guards in `decisions.py`
  that the engine repeats (`apply_action` still refuses, with the engine's
  message: "Not enough ... stock", pending-trade limit, tile cannot be
  placed, ...); the per-chain holding cap in `validate_trade` (the cap equals
  the bank's stock, so no trade can exceed it); playability of an already
  played tile; a merger with no defunct stockholders (the founder always
  holds a share unless the bank was empty); `found_chain` without a pending
  founding; an unknown placement result; `get_merger_survivor([])`.
- **Return values nobody reads** (11). The dicts returned by
  `resolve_unplayable_turn` and `handle_all_tiles_unplayable`, `_emit`'s
  return.
- **Defensive Player/Board/Hotel API details** (9): e.g. `Player.set_stocks`
  accepting exactly the cap, `get_stock_value` skipping zero holdings,
  docstring copies in `hybridmethod`.
- **Test-compat aliases** (4): the `turn_phase` / `current_turn_index`
  setters used as board surgery by two server tests.
- **Calculator internals deliberately not pinned** (30): `_shares_needed`
  /`cap` arithmetic that only matters past the 25-share cap (unreachable), the
  hypothetical-player stand-ins' defaults, and four `_tile_info` details
  (`chains` on merge tiles is also derived elsewhere; founder-share
  availability when a chain's bank is empty).

Agent/server: `agents/heuristic.py` (66 survivors) is strategy, not rules:
its weights and tie-breaks can change without any rule being broken, and the
protocol tests only require that its answers are legal (which the engine
checks). `seats.py` survivors/uncovered (153) are mostly in the driver loop,
which runs on the server's background task: per-test coverage contexts cannot
attribute those lines to tests, so many are reported uncovered although the
protocol tests run them; mutation-testing them properly needs a different
harness (deliberately not done here). `transcripts/store.py` listing and
summary code (`summarize`, `has_footer`, `_load_summary`) is observability
for the transcript browser; left for the transcript owner.

### Survivors the slow tier would kill: not measured

The slow tier (`-m slow`: fuzzed full games, snapshot replays, calculator vs
engine over whole games) was going to be run against the 36 non-equivalent
`game.py`/`rules.py` survivors. Each mutant needs about 5 minutes of the slow
tier on this (shared, overloaded) machine; the run was stopped unfinished at
the coordinator's request, so no slow-tier numbers are reported. To measure
it: `python scripts/mutation_test.py --rerun RESULT.json --marker slow
--max-seconds 900 --out slow.json`, then `scripts/mutation_merge.py RESULT.json
slow.json --slow-only` (the report then shows the slow-only kills per module).



## Method

1. **Mutation testing.** `mutmut`/`cosmic-ray` were not installed and do not
   fit this suite (xdist, per-test kill data, tests that read files relative
   to the repo), so a small purpose-built mutator was written:
   `scripts/mutation_test.py` (wrapper `scripts/mutation-test.sh`, reports
   `scripts/mutation_report.py`, `scripts/mutation_merge.py`). It parses a
   module with `ast` and applies one mutation at a time: arithmetic and
   comparison operators (`+`/`-`, `<`/`<=`, `==`/`!=`, `in`/`not in`, ...),
   `and`/`or`, removal of `not` and unary minus, integer and boolean constants
   (`0`->`1`, `1`->`0`, `n`->`n+1`, `True`/`False`), `min`/`max`, `any`/`all`,
   `return x` -> `return None`, deletion of call statements and of
   attribute/item assignments, and negation of plain `if`/`while` tests.
   Docstrings, annotations, imports, `__repr__` and `TYPE_CHECKING` blocks are
   skipped. **Every mutant of every target module was run (no sampling).**
   - A coverage map with per-test contexts (`pytest --cov-context=test`, fast
     tier) gives, for each mutated line, the tests that execute it; only those
     run. Lines executed only at import time (default arguments, class
     bodies) run the whole fast tier.
   - Each mutant runs in a private copy of `backend/` in a fresh interpreter,
     four in parallel, with a time limit (a hang counts as killed).
   - Engine modules ran in **matrix mode**: every cheap test (< 0.1 s under
     coverage) that covers the line runs, so the result names *every* test
     that kills the mutant (per-test value); only if none does, the expensive
     tests (full games, fuzz, snapshots) run, stopping at the first failure.
     Agent/server modules stopped at the first failing test.
   - The killing suite is the fast tier (`-m "not slow"`).
   - The baseline was measured on an export of the pre-audit commit
     (`c200d86`), the final run on the audited tree; mutants are compared by
     module, function, source line and mutation, so line shifts do not matter.
2. **Per-test value** came from the kill matrix (tests that kill nothing that
   another test does not also kill), and every candidate was **read** before
   a decision. Removal criteria are below with examples.
3. **Gaps** (surviving mutants that are real rules) got new gameplay tests,
   organised by rule area in `backend/tests/gameplay/`. Positions are reached
   by real moves through `game.decisions.apply_action` (the entry point every
   seat uses) with `tests/support/table.py`: a `Table` stacks the tile bag so
   each player holds and later draws exactly the tiles the test scripts, then
   every move is a real, validated action. Two tests load real-play snapshot
   fixtures (`tests/support/snapshots.py`). No board surgery, no private
   state in `tests/gameplay`.
4. **Consolidation**: one obvious home per rule; dead code that only tests
   used was removed together with its tests (below).
5. **Speed and independence**: `-n auto`, random order (`pytest-randomly`),
   15 seeds of the fast tier, the files most at risk looped 50x.

## Where each rule lives now

| Rule area (docs/rules) | Home |
|---|---|
| Turn structure, seating order, draw, empty bag, end of tiles (gameplay.md, tiles.md) | `tests/gameplay/test_turn_flow.py` |
| Lone tiles, founding, expansion, founder shares, 8th chain (tiles.md, chains.md) | `tests/gameplay/test_founding.py` |
| Survivor, tie choice, disposition order, sell/trade/hold, multi-chain order, merged board, frozen trades (mergers.md) | `tests/gameplay/test_mergers.py` |
| Majority/minority bonuses, ties, rounding, final bonuses (mergers.md, endgame.md) | `tests/gameplay/test_bonuses.py` |
| Buying stock: limits, prices, money, bank, defunct chains (stocks.md) | `tests/gameplay/test_stock_trading.py` |
| Declaring the end, final scoring, standings (endgame.md) | `tests/gameplay/test_end_game.py` (+ `test_ties.py`) |
| Safe chains, dead tiles, all-unplayable hands (tiles.md) | `tests/gameplay/test_dead_tiles.py` (+ the skip / frozen-board cases in `test_decisions.py::TestNoPlayableTile`) |
| Player-to-player trades (stocks.md, seat contract) | `tests/gameplay/test_player_trades.py` |
| Decision seam: legal actions, validation, wire format, fuzzed full games | `tests/test_decisions.py`, `tests/test_fuzz_games.py` |
| Event log payloads and privacy | `tests/test_events.py` |
| Lobby, deal, the engine's own guards, client state | `tests/test_game.py` (rewritten) |

## Tests removed (444 cases), by criterion

Every removed case was assigned one primary criterion (a case can fit several;
it is counted once). Counts are exact: they come from diffing the collected
test ids before and after and classifying each removed id.

| Criterion | Cases |
|---|---|
| Duplicate of a rule now tested through real play, with weaker assertions and/or a board-surgery position | 282 |
| Existence / type / default value / constructor echo | 47 |
| Dead path: `Game.execute_bot_turn` (nothing but tests used it) | 33 |
| Consolidated: merged into fewer tests, every assertion kept | 26 |
| Dead code: tests of helpers nothing but tests used (helpers removed) | 20 |
| Duplicate of the frozen classic price table in `test_ruleset.py` | 14 |
| Can never fail: assertion inside a branch, or a bound that holds whatever happens | 10 |
| Asserts on private attributes / restates the implementation | 7 |
| "Scenario" that never plays the move it describes | 3 |
| Flaky (fails on some deals) | 2 |
| Only checks that a mock was called | 0 (the mock-based server tests assert on what was sent; kept) |

Per file (cases before -> after, removed by criterion, added):

| File | Before | After | Removed | Added |
|---|---|---|---|---|
| `tests/gameplay/test_bonuses.py` | 0 | 8 | - | 8 |
| `tests/gameplay/test_dead_tiles.py` | 0 | 4 | - | 4 |
| `tests/gameplay/test_end_game.py` | 0 | 6 | - | 6 |
| `tests/gameplay/test_founding.py` | 0 | 8 | - | 8 |
| `tests/gameplay/test_mergers.py` | 0 | 11 | - | 11 |
| `tests/gameplay/test_player_trades.py` | 0 | 9 | - | 9 |
| `tests/gameplay/test_stock_trading.py` | 0 | 9 | - | 9 |
| `tests/gameplay/test_turn_flow.py` | 0 | 4 | - | 4 |
| `tests/scenarios/test_bot_games.py` | 11 | 0 | 11 dead path | 0 |
| `tests/scenarios/test_chain_expansion.py` | 10 | 0 | 10 duplicate | 0 |
| `tests/scenarios/test_chain_founding.py` | 13 | 0 | 13 duplicate | 0 |
| `tests/scenarios/test_complex_mergers.py` | 17 | 0 | 14 duplicate, 2 dead code, 1 never-plays | 0 |
| `tests/scenarios/test_edge_cases.py` | 22 | 0 | 17 duplicate, 3 echo, 1 dead code, 1 never-plays | 0 |
| `tests/scenarios/test_end_game.py` | 30 | 0 | 29 duplicate, 1 never-fail | 0 |
| `tests/scenarios/test_mergers.py` | 30 | 0 | 27 duplicate, 1 dead code, 1 private, 1 never-plays | 0 |
| `tests/scenarios/test_stock_purchases.py` | 24 | 0 | 24 duplicate | 0 |
| `tests/scenarios/test_tile_placement.py` | 23 | 0 | 23 duplicate | 0 |
| `tests/scenarios/test_trading.py` | 19 | 0 | 17 duplicate, 2 never-fail | 0 |
| `tests/scenarios/test_turn_flow.py` | 10 | 0 | 10 duplicate | 0 |
| `tests/test_board.py` | 34 | 28 | 6 echo, 2 dead code | 2 |
| `tests/test_bot.py` | 32 | 27 | 3 echo, 1 never-fail, 1 duplicate | 0 |
| `tests/test_calculator.py` | 28 | 32 | - | 4 |
| `tests/test_decisions.py` | 76 | 77 | - | 1 |
| `tests/test_driving.py` | 0 | 16 | - | 16 |
| `tests/test_events.py` | 18 | 17 | 1 echo | 0 |
| `tests/test_full_game_simulation.py` | 19 | 0 | 19 dead path | 0 |
| `tests/test_game.py` | 54 | 56 | 36 duplicate, 11 echo, 3 dead path, 2 flaky, 2 never-fail | 56 |
| `tests/test_health.py` | 14 | 4 | 8 consolidated, 6 echo | 4 |
| `tests/test_hotel.py` | 36 | 3 | 18 consolidated, 14 price-table duplicate, 3 echo, 1 dead code | 3 |
| `tests/test_llm_schema.py` | 63 | 86 | - | 23 |
| `tests/test_main_handlers.py` | 31 | 22 | 5 private, 2 never-fail, 2 duplicate | 0 |
| `tests/test_phase_transitions.py` | 19 | 0 | 16 duplicate, 2 echo, 1 never-fail | 0 |
| `tests/test_player.py` | 46 | 36 | 7 dead code, 6 echo | 3 |
| `tests/test_rules.py` | 49 | 0 | 41 duplicate, 5 dead code, 3 echo | 0 |
| `tests/test_ruleset.py` | 76 | 76 | 1 dead code | 1 |
| `tests/test_session_manager.py` | 37 | 35 | 2 echo | 0 |
| `tests/test_transcripts.py` | 8 | 10 | - | 2 |
| `tests/test_websocket_gameplay.py` | 18 | 13 | 2 duplicate, 1 echo, 1 private, 1 never-fail | 0 |


Representative examples (read them against the criterion):

- **Duplicate, weaker.**
  `test_game.py::TestBuyStocks::test_buy_stocks_success` asserted `success`
  and `len(purchased) == 1`; `gameplay/test_stock_trading.py::test_mixed_purchase_at_current_prices_then_only_end_turn`
  checks cash, shares, bank stock, the event's prices and that the turn can
  only end. `test_rules.py::TestCheckEndGame::test_chain_41_plus_can_end` built
  a lone 41-tile chain, which is also "every chain safe", so it could not tell
  the two end conditions apart: the baseline survivor `check_end_game` `>=` ->
  `>` proves it. `scenarios/test_chain_founding.py::test_scenario_3_3_chain_tier_affects_pricing`
  only read the price table (a copy of `test_ruleset.py`'s frozen table).
- **Existence / default / echo.** `test_game.py::TestGameInitialization::test_game_has_hotel_manager`
  (`isinstance(game.hotel, Hotel)`), `test_bot.py::TestBotInit::test_bot_init_easy_difficulty`
  (`Bot(p, "easy").difficulty == "easy"`), `scenarios/test_edge_cases.py::test_scenario_8_6_tile_bag_contains_108_tiles`.
- **Dead path.** `test_full_game_simulation.py` (19 cases) and
  `scenarios/test_bot_games.py` (11) drove games with `execute_bot_turn`,
  which the server no longer uses; their invariants (money and stock
  conservation, termination, chain sizes) are checked more strongly by the
  event-ledger fuzz in `test_decisions.py` / `test_fuzz_games.py`, and bot
  games run through the real driver in `protocol/test_full_games.py`.
- **Dead code.** `test_rules.py::TestRoundUpToHundred` (`Rules._round_up_to_hundred`),
  `test_player.py::TestStockTrade` (`Player.trade_stock`),
  `test_hotel.py::test_load_state`.
- **Can never fail.** `test_phase_transitions.py::test_pending_action_cleared_after_phase_complete`
  (its only assertion sat inside two nested `if`s);
  `scenarios/test_trading.py::test_scenario_2_17_mergemaker_first`
  (`if game.phase == MERGING: assert ...`);
  `test_main_handlers.py::test_buy_stocks_respects_available_count`
  (`final <= initial + 1`, true if nothing is bought);
  `test_game.py::test_merger_pays_bonuses` (`money >= initial`).
- **Private state / implementation.** `scenarios/test_mergers.py::test_defunct_processed_largest_first`
  set `game._merger_chains` (an attribute that no longer exists) and then
  sorted a list *in the test* with the engine's own key: it restated the
  implementation and exercised nothing. `test_main_handlers.py::test_found_chain_gives_founder_stock`
  forged `pending_action` and asserted on `player._stocks`.
- **Never plays the move.** `scenarios/test_mergers.py::test_three_way_merger_largest_survives`
  built three chains and then called `Rules.get_merger_survivor` directly
  ("for simplicity").
- **Flaky.** See below.


## Flaky tests found and fixed

Both were in the old `test_game.py`, used an unseeded `Game()` and a freshly
shuffled deal, and were removed (their rules are covered deterministically in
`tests/gameplay`):

- `TestBuyStocks::test_buy_stocks_deducts_money` planted Luxor on 1A-2A by
  board surgery, then placed the first hand tile not on 1A/2A. When that tile
  touched the chain (3A, 1B or 2B) Luxor grew to 3 tiles and cost $300, not
  the asserted $200. Measured: 118 failures in 5,000 runs (2.4 %); it also
  failed once in the very first baseline run of this audit.
- `TestTurnFlow::test_cannot_play_tile_not_in_hand` assumed 1A and 12I were
  never both in the hand. Measured: 15 failures in 5,000 runs (0.3 %).

A third, load-dependent one surfaced while the slow tier ran under coverage
on the busy machine: `protocol/test_driver.py::test_hanging_seat_times_out_other_rooms_keep_playing`
asserted that a seat timing out every 0.5 s timed out at most 6 times while
another room played a whole game; on a slow machine the other game takes
longer and the count grows. The wall-clock upper bound was dropped (the test
still requires at least one timeout, the hung room's driver still running and
the other room finishing with no fallback). It is the only change to the
protocol tier's assertions.

The `game_room` fixture (`backend/conftest.py`) also dealt an unseeded game;
it is seeded now. Checks after the change: the fast tier passed under
`--randomly-seed` 1-12 (`-n 2`) and, after the last test changes, 101, 202 and 303; the server, gameplay, engine-API,
board/player/bot and event files passed 50 random-order loops in a row; the
pre-audit versions of the same files failed 3 times in 50 loops, always in
`test_buy_stocks_deducts_money`.

## Product changes

No rule bug was found: every new gameplay test passed against the engine as
it was. Changes to product code are removals of code nothing but tests used:

- `Game.execute_bot_turn` (and its tests). The server drives bot seats
  through `seats.py`; tests now drive them the same way with
  `tests/support/drive.py` (`HeuristicTable`: `build_context` ->
  `HeuristicAgent.choose` -> `apply_action`). `game.bots` stays: it marks
  bot seats in state, standings and snapshots.
- `Rules.get_unplayable_tiles`, `Rules.get_legal_tile_plays`,
  `Rules.get_valid_disposition_combinations`, `Rules._round_up_to_hundred`,
  `Player.trade_stock`, `Board.get_chain_tiles`, `Board.get_all_chains`,
  `Hotel.load_state`, `Game.tile_pool`, `Game.get_pending_trades_for_player`.

Two behaviours worth knowing (documented in the tests, not changed):

- `Game.accept_trade` drops an offer that can no longer be honoured, but
  through `apply_action` (the only path seats use) the accept is refused by
  validation first, so the stale offer stays pending until its recipient
  rejects it (`legal_actions` reports `can_accept: false`).
- The per-chain holding cap in `Rules.validate_trade` and `Player` can never
  bind in real play: the cap equals the bank's stock per chain in every
  shipped ruleset.
- Cosmetic, not fixed: the LLM pre-check's feedback says "you only has $500"
  / "you holds only 2 Luxor shares" (`agents/llm/schema.py::_check_propose`);
  the new tests match the stable part of the text. Left alone so that the
  mutated module stayed identical between the baseline and final runs.

## How to re-run mutation testing

```bash
scripts/mutation-test.sh                         # 8 engine modules, kill matrix (~45 min, 4 cores)
scripts/mutation-test.sh game/rules.py           # one module
MATRIX=0 scripts/mutation-test.sh seats.py agents/heuristic.py   # stop at first kill
OUT=/tmp/after.json scripts/mutation-test.sh     # choose the result file
python scripts/mutation_report.py /tmp/after.json                 # scores per module
python scripts/mutation_report.py /tmp/before.json --compare /tmp/after.json   # kills lost
python scripts/mutation_report.py /tmp/after.json --unique tests/test_board.py  # per-test value
python scripts/mutation_test.py --rerun /tmp/after.json --marker slow --out /tmp/slow.json
python scripts/mutation_merge.py /tmp/after.json /tmp/slow.json --slow-only
```

The wrapper is deliberately not part of `verify-*.sh` or CI (too slow). Each
run builds a fresh coverage map; workers copy `backend/` at start, so do not
edit code while a run is in progress.
