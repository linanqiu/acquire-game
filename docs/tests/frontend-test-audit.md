# Frontend unit-test audit

Owner instruction: "actively remove trivial or useless tests and make sure tests actually test
meaningful gameplay". This audits the vitest + testing-library suite in `frontend/`
(`frontend/src/**/*.test.{ts,tsx}`, `frontend/tests/unit/**`) with mutation testing as the
yardstick. Companion to [legacy-suite-retirement.md](legacy-suite-retirement.md), which did the
same for the old browser tests (and expected the same disease in the unit tests: it was there).

All numbers below were measured in this session (commands in "Method").

## Summary

| | before | after |
|---|---|---|
| unit test files | 49 | 46 (+ fixtures) |
| unit tests | 719 | 556 |
| lines of test code | 8,628 | 7,709 |
| suite wall time (`npm test`, loaded 4-core box) | ~33-36 s | ~20-28 s |
| mutation score, logic group (29 files) | 45.0% (1046/2327) | 80.0% (1693/2115), taken before the last round of extra tests |
| mutation score, decision UIs / pages | 69.4% / 54.1% | **not measured** (stopped on request) |

The final logic run was taken before the last round of added tests (hooks, ruleset, eventText,
replay, http, store), so those files' final scores are lower bounds; their re-measurement was
killed. The decision-UI and page groups were not re-measured at all.

## Method

1. **Mutation testing as the yardstick.** [Stryker](https://stryker-mutator.io/) with the vitest
   runner (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`, installed as
   devDependencies, `npm run mutation`, config in `frontend/stryker.config.json`). It changes the
   product code one small way at a time (flips a comparison, drops a condition, empties a
   string...) and runs the tests that cover that line; a mutant that no test notices *survives*,
   which means the behaviour it changed is not tested. Settings: `coverageAnalysis: perTest`,
   `ignoreStatic`, `inPlace` (the repository's tests read `../backend/rulesets`, so Stryker's
   usual sandbox copy cannot run them; **run it on a clean, committed tree**: it rewrites the
   source files while it runs and restores them at the end).
2. **Three measurement groups**, each measured before any test was touched (baseline) and again
   at the end, with identical file sets and settings:
   * *logic*: `src/store`, `src/hooks`, `src/lib`, `src/utils`, `src/ruleset` (29 files, every
     mutator including string literals);
   * *decision UIs*: `src/components/game` and `src/components/ui` (30 files, string-literal
     mutants excluded: they are mostly CSS class names and copy);
   * *pages*: `PlayerPage`, `HostPage`, `LobbyPage` (string-literal mutants excluded).

   Not measured (the run for this group was started and stopped to keep the audit to a day):
   `src/components/transcripts/**`, `TranscriptPage`, `GamesPage`, `BenchPage`,
   `BenchSeriesPage`. Their unit tests (`tests/unit/transcripts.test.tsx`, real backend
   fixtures) were kept apart from removing 4 tests that duplicate the new `lib` tests.
   To keep both runs apples-to-apples the baseline and final runs were done on two scratch copies
   of the worktree (one at the starting commit, one at the end).
3. **Decide per test, after reading it.** Kept or strengthened: tests that drive a user
   interaction and assert what the player sees or the action sent to the server; state from a
   server message; rule/limit enforcement in the UI; accessibility that matters (focus trap,
   keyboard operation of steppers, tile rack and chain selector, labels). Removed: the criteria in
   "Tests removed".
4. **Real shapes instead of hand-made ones.** The old suites built game states by hand
   (`board: { cells: {} }`, `hotel: { chains: [...] }` with invented fields) and answered `fetch`
   with invented JSON. They drifted from the backend (see "Product bugs found"). The new fixture
   `frontend/tests/unit/fixtures/wire-messages.json` is **recorded from the real backend** by
   `frontend/tests/unit/fixtures/generate_wire_messages.py` (FastAPI `TestClient`, the same test
   endpoint the screen tests use):
   * for each of the 20 generated engine snapshots (`tests/e2e/fixtures/snapshots/*.json`): the
     messages a seat receives when it is loaded (prompt, `game_state` with private fields,
     `game_over`), the spectator's `game_state`, and, for one fixture, what the server sends after
     the human sold everything;
   * one short real game per shipped ruleset (default, valley, mini): first state of each phase,
     the prompts, the lobby, a buy turn with chains to buy into;
   * a real trade lifecycle (proposed, accepted, rejected, canceled), the sentences the server
     answers when an action is refused, the AI catalog, and the answers of the home page's routes
     (create, join, spectator, and each refusal).

   Helper: `frontend/tests/unit/fixtures/wire.ts` (`loadSnapshotAsPlayer`, `playedGame`, ...). It
   feeds the messages through the real store handler, so the UI sees what a browser would.
   Regenerate with `GAME_TEST_MODE=1 python3 frontend/tests/unit/fixtures/generate_wire_messages.py`
   (the file is not byte-stable: player ids are random; no test depends on a specific id).

## Results

### Mutation score per file

Logic group (all mutators; `Timeout` counted as killed):

| file | baseline | final |
|---|---|---|
| `src/hooks/useDocumentTitle.ts` | 50.0% (2/4) | 75.0% (3/4) |
| `src/hooks/useErrorHandler.ts` | 11.1% (2/18) | 42.9% (3/7) |
| `src/hooks/useFallbackToasts.ts` | 81.8% (9/11) | 81.8% (9/11) |
| `src/hooks/useFetch.ts` | 53.8% (14/26) | 80.8% (21/26) |
| `src/hooks/useHostWebSocket.ts` | 12.5% (22/176) | 52.6% (81/154) |
| `src/hooks/useRoom.ts` | 100.0% (5/5) | 100.0% (5/5) |
| `src/hooks/useWebSocket.ts` | 13.1% (23/176) | 64.2% (113/176) |
| `src/lib/agents.ts` | 73.6% (53/72) | 98.6% (71/72) |
| `src/lib/errorHandler.ts` | 42.9% (90/210) | 95.9% (94/98) |
| `src/lib/eventText.ts` | 27.2% (101/371) | 75.5% (249/330) |
| `src/lib/finalScores.ts` | 77.3% (17/22) | 77.3% (17/22) |
| `src/lib/format.ts` | 15.8% (26/165) | 100.0% (154/154) |
| `src/lib/http.ts` | 67.8% (61/90) | 71.1% (64/90) |
| `src/lib/network.ts` | 11.1% (1/9) | 88.9% (8/9) |
| `src/lib/phaseText.ts` | 58.8% (40/68) | 91.2% (62/68) |
| `src/lib/replay.ts` | 64.6% (93/144) | 83.3% (120/144) |
| `src/lib/roomAvailability.ts` | 92.3% (12/13) | 92.3% (12/13) |
| `src/lib/ruleset.ts` | 69.9% (181/259) | 69.9% (172/246) |
| `src/lib/trades.ts` | 48.8% (21/43) | 100.0% (43/43) |
| `src/lib/transcripts.ts` | 56.8% (46/81) | 91.1% (72/79) |
| `src/lib/waiting.ts` | 95.0% (19/20) | 100.0% (20/20) |
| `src/ruleset/defaultRuleset.ts` | 100.0% (0/0) | 100.0% (0/0) |
| `src/ruleset/RulesetGate.tsx` | 69.2% (18/26) | 84.6% (22/26) |
| `src/ruleset/RulesetScope.tsx` | 75.0% (3/4) | 75.0% (3/4) |
| `src/ruleset/store.ts` | 46.6% (34/73) | 94.5% (69/73) |
| `src/ruleset/useRules.ts` | 81.8% (18/22) | 77.3% (17/22) |
| `src/store/gameStore.ts` | 64.7% (108/167) | 88.6% (148/167) |
| `src/utils/transforms.ts` | 51.9% (27/52) | 78.8% (41/52) |
| **logic group total** | **45.0%** (1046/2327) | **80.0%** (1693/2115) |

Decision UIs and pages: baseline only, **final not measured**. Those tests were rewritten (real
states for rack, steppers, selector, modal, trade builder, game over; page screens, actions,
trades, lobby, host), so no claim is made about their final score. Two real bugs found by the
rewrite (ReconnectionOverlay was 35.3% at baseline; ChainSelector) are fixed.

| file | baseline | final |
|---|---|---|
| `src/components/game/AddAiControl.tsx` | 56.3% (36/64) | not measured |
| `src/components/game/AiThinking.tsx` | 100.0% (1/1) | not measured |
| `src/components/game/Board.tsx` | 95.2% (40/42) | not measured |
| `src/components/game/ChainMarker.tsx` | 80.6% (25/31) | not measured |
| `src/components/game/ChainSelector.tsx` | 78.8% (67/85) | not measured |
| `src/components/game/GameOver.tsx` | 64.2% (70/109) | not measured |
| `src/components/game/MergerDisposition.tsx` | 84.2% (32/38) | not measured |
| `src/components/game/PlayerCard.tsx` | 86.8% (33/38) | not measured |
| `src/components/game/Portfolio.tsx` | 96.3% (26/27) | not measured |
| `src/components/game/ReconnectedToast.tsx` | 100.0% (1/1) | not measured |
| `src/components/game/ReconnectionOverlay.tsx` | 35.3% (41/116) | not measured |
| `src/components/game/RemoveSeatButton.tsx` | 60.0% (6/10) | not measured |
| `src/components/game/SeatKindBadge.tsx` | 92.9% (26/28) | not measured |
| `src/components/game/StockStepper.tsx` | 93.8% (45/48) | not measured |
| `src/components/game/Tile.tsx` | 89.1% (49/55) | not measured |
| `src/components/game/TileRack.tsx` | 92.5% (37/40) | not measured |
| `src/components/game/TradeBuilder.tsx` | 66.2% (141/213) | not measured |
| `src/components/game/TradeOffers.tsx` | 41.9% (31/74) | not measured |
| `src/components/ui/Badge.tsx` | 100.0% (1/1) | not measured |
| `src/components/ui/Button.tsx` | 100.0% (10/10) | not measured |
| `src/components/ui/Card.tsx` | 94.4% (17/18) | not measured |
| `src/components/ui/Header.tsx` | 71.4% (15/21) | not measured |
| `src/components/ui/Modal.tsx` | 70.5% (55/78) | not measured |
| `src/components/ui/PageShell.tsx` | 100.0% (10/10) | not measured |
| `src/components/ui/Panel.tsx` | 100.0% (4/4) | not measured |
| `src/components/ui/Slider.tsx` | 38.9% (7/18) | not measured |
| `src/components/ui/Spinner.tsx` | 100.0% (1/1) | not measured |
| `src/components/ui/TextInput.tsx` | 63.6% (14/22) | not measured |
| `src/components/ui/Toast.tsx` | 100.0% (2/2) | not measured |
| `src/components/ui/ToastProvider.tsx` | 54.8% (23/42) | not measured |
| `src/pages/HostPage.tsx` | 52.7% (127/241) | not measured |
| `src/pages/LobbyPage.tsx` | 59.4% (85/143) | not measured |
| `src/pages/PlayerPage.tsx` | 53.5% (394/736) | not measured |
| decision-UI total | 69.4% (866/1247) | not measured |
| pages total | 54.1% (606/1120) | not measured |

Not measured at all: `components/transcripts/**`, `TranscriptPage`, `GamesPage`, `BenchPage`.

### Tests per file (titles: before / after / baseline titles not carried over / new titles)

Titles change when a test is rewritten, so "not carried over" counts rewrites as well as removals.



### Tests removed, by criterion (judged per test, by file; counts approximate)

* **Design tokens / CSS / class names / variants** (about 115): `src/styles/typography.test.ts` (38),
  `tokens.test.ts` (18), `TypographyDemo.test.tsx` (14), `colors.test.tsx` (6); Button
  variants/sizes, Tile size/state classes, Toast icon/class per type, Badge (10), Spinner (5),
  Card/Panel class tests. Examples: "applies .text-xs class with font-size token", "renders sm
  size with correct styles", "applies correct class for warning type".
* **Renders-only / default prop / role exists** (about 90): ReconnectedToast (12 of 14),
  PageShell/Header/Panel/Card "renders title/children", ChainSelector rendering/aria matrix,
  Modal "has dialog role" (twice), LobbyPage "renders the title/subtitle/metadata/forms",
  HostPage "renders BUYOUT title in lobby".
* **Cannot fail / no assertion**: barrel tests (`ui/index.test.ts`, `game/index.test.ts`:
  "is defined"), Slider "does not call onChange when disabled" (no assertion), Button
  "responds to Enter key" (fires a click), ReconnectionOverlay "hides manual rejoin UI when
  rejoin button clicked" ("we just verify the component didn't crash"), TokenSwatch (component
  mounted nowhere).
* **Hand-made state that drifted from the backend** (replaced): PlayerPage phase tests with
  `board: { cells: {} }`, 24 PlayerCard tests (now tested from real spectator states), HostPage
  game states, App routing tests that re-declared the routes instead of rendering `App`.
* **Duplicates with weaker assertions**: 4 "replay building" tests in `transcripts.test.tsx`,
  "phase banners" in `ruleset.test.ts`, agent-helper tests in `AiSeats.test.tsx`, one-per-key
  `errorHandler` tests (29) for error codes the server never sends.
* **Kept**: StockStepper, Modal focus trap/scroll lock, Toast timers, TextInput upper-casing,
  MergerDisposition rules, TradeBuilder validation, themes.test, http.test (+6), transcripts.test.

### Tests added (each tied to a surviving mutant or a real behaviour)

* `store/gameStore.test.ts` (4 to 29): real prompts clear/stay when the merger moves on, trade
  lists, hand and playability kept, game over (64.7% to 88.6%).
* `pages/PlayerPage.screens/actions/trades/.test.tsx` (45/17/15/10): phase-to-screen for all 20
  recorded states, per-turn buy limit per ruleset (3, 3, 4), disposition capped by the engine's
  max_trade, refused answers restore the prompt, trade answers and notices, lobby from a real
  lobby_update.
* `hooks/useWebSocket.test.tsx` (3 to 35): URL, real message dispatch, pings, doubling
  back-off, give-up after 5, 4004 refusal, offline/online, reconnect(), host socket.
* `lib/replay.test.ts` (seat stats checked against the footer totals the backend wrote),
  `eventText.test.ts`, `format.test.ts` (15.8% to 100%), `trades.test.ts` (48.8% to 100%),
  `agents.test.ts`, `transcripts.test.ts`, `phaseText.test.ts`, `errorHandler.test.tsx` (real
  refusal sentences), `ruleset/store.test.tsx` (46.6% to 94.5%), `hooks/useFetch.test.tsx`.
* Rewrites on real data: TileRack, Board, ChainSelector, GameOver (tie), Portfolio,
  TradeBuilder, ReconnectionOverlay, HostPage, LobbyPage (real create/join answers), App.

### Dead code deleted

`TokenSwatch` (+test, + surface-coverage row), unreferenced barrels `components/game/index.ts`,
`hooks/index.ts`, `utils/index.ts`, `types/index.ts`, unused `tests/fixtures/gameState.ts` and
`tests/mocks/websocket.ts`, `sharePrice`, `capitalize`, `formatMoney`, `fetchGame`, the host
socket's `addBot/startGame/endGame`, and the error-code table in `lib/errorHandler.ts` (about 40
codes, `getToastType`, `handleConnectionError`): the backend sends sentences, never codes.
`npm run build` passes. Unsure, not deleted: `Board` matrix prop, `resolveSeatKind`'s `is_bot`
fallback, host socket `disconnect/isConnected`, the `session_token` concept, unused CSS classes
(not audited).

### Product bugs found

1. **ReconnectionOverlay never gave up**: an attempt's result was discarded when its own phase
   change re-ran the effect, so after one failed reconnect it showed "Attempt 1/3" forever and
   never offered REJOIN / BACK TO LOBBY. Fixed.
2. **ChainSelector arrow keys stuck on locked chains**. Fixed: arrows skip unchoosable chains.
3. **"a 8th hotel chain"**. Fixed ("an 8th", "an 11th", "an 18th").
4. **Lobby name length counted untrimmed** (20 characters plus a space refused). Fixed.
5. **Contract drift, not fixed**: the frontend stores `data.session_token` from /create and
   /join, but the backend sends none (`{room_code, player_id, is_host}`); the browser stores
   the string "undefined" and sends `?token=undefined` / `Bearer undefined`. Works only because
   the server ignores tokens. Needs a decision.
6. Observation: server refusals are all categorised "unknown", so rule refusals show as red
   error toasts.
7. Test-mode artefact: `game_over` from a loaded snapshot carries the recording's player names.

### Surviving mutants left (logic group) and why

Mostly defensive refs/flags, `clearTimeout` guards that are unreachable (a back-off timer only
exists when the socket is already null; an `offline` event during a back-off does not cancel it,
harmless), optional-chaining on callbacks, `import.meta.env` branches, and event kinds the real
game does not produce. Per-file lists: `npm run mutation`.

### Tooling

* `npm run mutation` (Stryker, `frontend/stryker.config.json`); runs in place: use a clean tree.
* Coverage was never enforced (CI runs `npm test`). Thresholds now cover the logic directories
  only (`store, hooks, lib, ruleset, utils`): statements 85, branches 75, functions 85, lines 85
  (measured 97.3 / 94.0 / 96.4 / 97.5), via `npm run test:coverage`; CI not changed.
  `testTimeout` 15 s (a transcript test flaked at 5 s under load).
* Passes under `--sequence.shuffle` (three runs; one flaked on the 5 s timeout before the change,
  then a shuffled run passed).

