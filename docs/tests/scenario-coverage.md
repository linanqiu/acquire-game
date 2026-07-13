# Scenario Test Coverage Report

> **Generated file — do not edit by hand.**
> Regenerate with: `cd frontend && npm run coverage:scenarios`
> CI verifies freshness and rigor rules with: `npm run coverage:scenarios:check`

Maps the 124 documented game scenarios (per the Epic 07 story matrices,
ST-002 through ST-009) to the Playwright E2E tests in
`frontend/tests/e2e/scenarios/`.

## Coverage Summary

| Category | Total | Direct | Indirect | Deferred | N/A | Missing | Covered |
|----------|------:|-------:|---------:|---------:|----:|--------:|--------:|
| 1.x Turn Flow | 10 | 5 | 0 | 5 | 0 | 0 | 50% |
| 2.x Trading | 18 | 18 | 0 | 0 | 0 | 0 | 100% |
| 3.x Chain Founding | 10 | 10 | 0 | 0 | 0 | 0 | 100% |
| 4.x Chain Expansion | 10 | 8 | 0 | 0 | 2 | 0 | 80% |
| 5.x Mergers | 19 | 6 | 13 | 0 | 0 | 0 | 100% |
| 6.x Stock Purchases | 17 | 11 | 0 | 0 | 0 | 6 | 65% |
| 7.x End Game | 16 | 7 | 0 | 9 | 0 | 0 | 44% |
| 8.x Edge Cases | 24 | 13 | 0 | 0 | 0 | 11 | 54% |
| **Total** | **124** | **78** | **13** | **14** | **2** | **17** | **73%** |

Legend:

- **Direct** (✅): a test names the scenario ID in its title.
- **Indirect** (🔶): no dedicated test; the owning story records coverage via overlap in broader gameplay tests.
- **Deferred** (⏳): explicitly deferred by the owning story, with a documented reason.
- **N/A** (🚫): the owning story marked the scenario not applicable to the current engine.
- **Missing** (❌): no test and no documented deferral — a visible coverage gap.
- **Covered %** counts Direct + Indirect over the category total.

## Detailed Mapping

### 1.x Turn Flow (ST-002)

| ID | Scenario | Test (file:line) | Status | Notes |
|----|----------|------------------|--------|-------|
| 1.1 | Basic complete turn | `turn-flow.spec.ts:45` | ✅ covered |  |
| 1.2 | Turn with no stock purchase | `turn-flow.spec.ts:185` | ✅ covered |  |
| 1.3 | Turn with chain founding | `turn-flow.spec.ts:322` | ✅ covered |  |
| 1.4 | Turn with chain expansion | `turn-flow.spec.ts:467` | ✅ covered |  |
| 1.5 | Turn with merger | — | ⏳ deferred | Requires test-setup API to seed specific board states (ST-002) |
| 1.6 | Turn with multi-chain merger | — | ⏳ deferred | Requires test-setup API to seed specific board states (ST-002) |
| 1.7 | Turn ending the game | — | ⏳ deferred | Requires test-setup API to seed specific board states (ST-002) |
| 1.8 | No playable tiles | — | ⏳ deferred | Requires test-setup API to seed specific board states (ST-002) |
| 1.9 | Turn timer expiration | — | ⏳ deferred | Turn timer feature not implemented (ST-002) |
| 1.10 | Player disconnect during turn | `turn-flow.spec.ts:725` | ✅ covered |  |

### 2.x Trading (ST-003)

| ID | Scenario | Test (file:line) | Status | Notes |
|----|----------|------------------|--------|-------|
| 2.1 | Initiate trade offer | `trading.spec.ts:59` | ✅ covered |  |
| 2.2 | Cancel trade offer | `trading.spec.ts:144` | ✅ covered |  |
| 2.3 | Accept trade offer | `trading.spec.ts:209` | ✅ covered |  |
| 2.4 | Reject trade offer | `trading.spec.ts:262` | ✅ covered |  |
| 2.5 | Counter trade offer | `trading.spec.ts:291` | ✅ covered |  |
| 2.6 | Trade with insufficient stocks | `trading.spec.ts:318` | ✅ covered |  |
| 2.7 | Multiple simultaneous offers | `trading.spec.ts:381` | ✅ covered |  |
| 2.8 | Stale trade (stocks changed) | `trading.spec.ts:413` | ✅ covered | Documentation-only test: records current behavior; stale-trade invalidation is not separately asserted |
| 2.9 | Trade timeout | `trading.spec.ts:434` | ✅ covered | Documentation-only test: trade timeout feature not implemented |
| 2.10 | Basic 2:1 trade | `trading.spec.ts:458` | ✅ covered |  |
| 2.11 | Maximum 2:1 trade | `trading.spec.ts:527` | ✅ covered |  |
| 2.12 | Partial 2:1 trade | `trading.spec.ts:575` | ✅ covered |  |
| 2.13 | No 2:1 trade available | `trading.spec.ts:629` | ✅ covered |  |
| 2.14 | Odd number of defunct stock | `trading.spec.ts:677` | ✅ covered |  |
| 2.15 | 2:1 with sell combination | `trading.spec.ts:722` | ✅ covered |  |
| 2.16 | 2:1 with hold combination | `trading.spec.ts:770` | ✅ covered |  |
| 2.17 | 2:1 depletes survivor pool | `trading.spec.ts:817` | ✅ covered |  |
| 2.18 | 2:1 in multi-chain merger | `trading.spec.ts:868` | ✅ covered |  |

### 3.x Chain Founding (ST-004)

| ID | Scenario | Test (file:line) | Status | Notes |
|----|----------|------------------|--------|-------|
| 3.1 | Basic chain creation | `chain-founding.spec.ts:56` | ✅ covered |  |
| 3.2 | Three-tile founding | `chain-founding.spec.ts:921` | ✅ covered |  |
| 3.3 | Chain selection from all available | `chain-founding.spec.ts:56` | ✅ covered |  |
| 3.4 | Chain selection limited | `chain-founding.spec.ts:261` | ✅ covered |  |
| 3.5 | Founder's bonus | `chain-founding.spec.ts:261` | ✅ covered |  |
| 3.6 | Founder's bonus stock depleted | `chain-founding.spec.ts:1149` | ✅ covered |  |
| 3.7 | Cannot found 8th chain | `chain-founding.spec.ts:1362` | ✅ covered |  |
| 3.8 | Chain colors on board | `chain-founding.spec.ts:483` | ✅ covered |  |
| 3.9 | Chain size tracking | `chain-founding.spec.ts:483` | ✅ covered |  |
| 3.10 | Chain founding cancellation | `chain-founding.spec.ts:683` | ✅ covered |  |

### 4.x Chain Expansion (ST-005)

| ID | Scenario | Test (file:line) | Status | Notes |
|----|----------|------------------|--------|-------|
| 4.1 | Single tile expansion | `chain-expansion.spec.ts:172` | ✅ covered |  |
| 4.2 | Multi-tile expansion | `chain-expansion.spec.ts:611` | ✅ covered |  |
| 4.3 | Orphan absorption | `chain-expansion.spec.ts:172` | ✅ covered |  |
| 4.4 | Size affects stock price | `chain-expansion.spec.ts:402` | ✅ covered |  |
| 4.5 | Safe status at 11 tiles | `chain-expansion.spec.ts:611` | ✅ covered |  |
| 4.6 | Safe status visual indicator | `chain-expansion.spec.ts:611` | ✅ covered |  |
| 4.7 | Expansion doesn't trigger founding | `chain-expansion.spec.ts:172` | ✅ covered |  |
| 4.8 | Chain info panel updates | `chain-expansion.spec.ts:402` | ✅ covered |  |
| 4.9 | Expansion animation | — | 🚫 n/a | Expansion animation: not applicable to current game engine (ST-005) |
| 4.10 | Simultaneous expansion (edge) | — | 🚫 n/a | Simultaneous expansion edge case: not applicable to current game engine (ST-005) |

### 5.x Mergers (ST-006)

| ID | Scenario | Test (file:line) | Status | Notes |
|----|----------|------------------|--------|-------|
| 5.1 | Two-chain merger | `mergers.spec.ts:267` | ✅ covered |  |
| 5.2 | Tie-breaker merger | `mergers.spec.ts:415` | ✅ covered |  |
| 5.3 | Three-way merger | — | 🔶 indirect | No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests |
| 5.4 | Four-way merger | — | 🔶 indirect | No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests |
| 5.5 | Safe chain survives | `mergers.spec.ts:524` | ✅ covered |  |
| 5.6 | Safe chain tie | — | 🔶 indirect | No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests |
| 5.7 | Merger creates safe chain | — | 🔶 indirect | No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests |
| 5.8 | Sell all defunct stock | `mergers.spec.ts:660` | ✅ covered |  |
| 5.9 | Trade all defunct stock | — | 🔶 indirect | No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests |
| 5.10 | Hold all defunct stock | — | 🔶 indirect | No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests |
| 5.11 | Mixed disposition | `mergers.spec.ts:763` | ✅ covered |  |
| 5.12 | Insufficient survivor stock | — | 🔶 indirect | No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests |
| 5.13 | Disposition order | — | 🔶 indirect | No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests |
| 5.14 | Disposition timeout | — | 🔶 indirect | Disposition timeout feature not implemented; not separately verified (ST-006 overlap claim) |
| 5.15 | Majority bonus | `mergers.spec.ts:857` | ✅ covered |  |
| 5.16 | Minority bonus | — | 🔶 indirect | No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests |
| 5.17 | Tied majority | — | 🔶 indirect | No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests |
| 5.18 | Tied minority | — | 🔶 indirect | No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests |
| 5.19 | Sole stockholder | — | 🔶 indirect | No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests |

### 6.x Stock Purchases (ST-007)

| ID | Scenario | Test (file:line) | Status | Notes |
|----|----------|------------------|--------|-------|
| 6.1 | Buy 1 stock | `stock-purchases.spec.ts:275`<br>`stock-purchases.spec.ts:844` | ✅ covered |  |
| 6.2 | Buy 2 stocks | `stock-purchases.spec.ts:275`<br>`stock-purchases.spec.ts:844` | ✅ covered |  |
| 6.3 | Buy 3 stocks | `stock-purchases.spec.ts:275`<br>`stock-purchases.spec.ts:844` | ✅ covered |  |
| 6.4 | Buy 0 stocks | `stock-purchases.spec.ts:373`<br>`stock-purchases.spec.ts:844` | ✅ covered |  |
| 6.5 | Cannot buy 4+ | `stock-purchases.spec.ts:436`<br>`stock-purchases.spec.ts:844` | ✅ covered |  |
| 6.6 | Mixed chain purchase | `stock-purchases.spec.ts:436`<br>`stock-purchases.spec.ts:844` | ✅ covered |  |
| 6.7 | Chain not on board | `stock-purchases.spec.ts:776` | ✅ covered |  |
| 6.8 | Insufficient funds | `stock-purchases.spec.ts:553` | ✅ covered |  |
| 6.9 | Partial insufficient | — | ❌ missing | Not covered; ST-007 shipped core scenarios only |
| 6.10 | Stock pool exhausted | — | ❌ missing | Not covered; ST-007 shipped core scenarios only |
| 6.11 | Pool partially exhausted | — | ❌ missing | Not covered; ST-007 shipped core scenarios only |
| 6.12 | Price tier display | `stock-purchases.spec.ts:553` | ✅ covered |  |
| 6.13 | Purchase after merger | — | ❌ missing | Not covered; ST-007 shipped core scenarios only |
| 6.14 | Purchase after founding | `stock-purchases.spec.ts:683` | ✅ covered |  |
| 6.15 | No chains available | `stock-purchases.spec.ts:776` | ✅ covered |  |
| 6.16 | All pools exhausted | — | ❌ missing | Not covered; ST-007 shipped core scenarios only |
| 6.17 | Purchase timeout | — | ❌ missing | Purchase timeout feature not implemented |

### 7.x End Game (ST-008)

| ID | Scenario | Test (file:line) | Status | Notes |
|----|----------|------------------|--------|-------|
| 7.1 | Chain reaches 41 tiles | — | ⏳ deferred | Requires specific game states hard to reach with seed-based testing (ST-008) |
| 7.2 | All chains safe | — | ⏳ deferred | Requires specific game states hard to reach with seed-based testing (ST-008) |
| 7.3 | Voluntary end | `end-game.spec.ts:510` | ✅ covered |  |
| 7.4 | Cannot end prematurely | `end-game.spec.ts:630` | ✅ covered |  |
| 7.5 | End after merger | — | ⏳ deferred | Requires specific game states hard to reach with seed-based testing (ST-008) |
| 7.6 | End on last tile | — | ⏳ deferred | Requires specific game states hard to reach with seed-based testing (ST-008) |
| 7.7 | End with no tiles left | — | ⏳ deferred | Requires specific game states hard to reach with seed-based testing (ST-008) |
| 7.8 | Final scoring display | `end-game.spec.ts:758` | ✅ covered |  |
| 7.9 | Stock value calculation | — | ⏳ deferred | Requires specific game states hard to reach with seed-based testing (ST-008) |
| 7.10 | Final bonuses | — | ⏳ deferred | Requires specific game states hard to reach with seed-based testing (ST-008) |
| 7.11 | Cash + stock total | `end-game.spec.ts:758` | ✅ covered |  |
| 7.12 | Tie-breaking | — | ⏳ deferred | Requires specific game states hard to reach with seed-based testing (ST-008) |
| 7.13 | Single winner | `end-game.spec.ts:510` | ✅ covered |  |
| 7.14 | Multiple winners | — | ⏳ deferred | Requires specific game states hard to reach with seed-based testing (ST-008) |
| 7.15 | Game over modal | `end-game.spec.ts:510` | ✅ covered |  |
| 7.16 | New game option | `end-game.spec.ts:510` | ✅ covered |  |

### 8.x Edge Cases (ST-009)

| ID | Scenario | Test (file:line) | Status | Notes |
|----|----------|------------------|--------|-------|
| 8.1 | Minimum players (3) | `edge-cases.spec.ts:174` | ✅ covered |  |
| 8.2 | Maximum players (6) | `edge-cases.spec.ts:174` | ✅ covered |  |
| 8.3 | Cannot start with 2 | `edge-cases.spec.ts:234` | ✅ covered |  |
| 8.4 | Cannot add 7th player | `edge-cases.spec.ts:270` | ✅ covered |  |
| 8.5 | Hand size limit | `edge-cases.spec.ts:307` | ✅ covered |  |
| 8.6 | Draw after placement | `edge-cases.spec.ts:351` | ✅ covered |  |
| 8.7 | No draw when bag empty | — | ❌ missing | Not covered by shipped edge-case tests (ST-009) |
| 8.8 | Start with 6 tiles | `edge-cases.spec.ts:307` | ✅ covered |  |
| 8.9 | Permanently unplayable | `edge-cases.spec.ts:431` | ✅ covered |  |
| 8.10 | Temporarily unplayable | `edge-cases.spec.ts:431` | ✅ covered |  |
| 8.11 | Unplayable tile UI | `edge-cases.spec.ts:431` | ✅ covered |  |
| 8.12 | All tiles unplayable | — | ❌ missing | Not covered by shipped edge-case tests (ST-009) |
| 8.13 | Replace unplayable tiles | `edge-cases.spec.ts:431` | ✅ covered |  |
| 8.14 | Tile becomes playable | — | ❌ missing | Not covered by shipped edge-case tests (ST-009) |
| 8.15 | Player reconnects | — | ❌ missing | Reconnection scenario not covered by shipped tests (ST-009) |
| 8.16 | State sync on reconnect | — | ❌ missing | Reconnection scenario not covered by shipped tests (ST-009) |
| 8.17 | Reconnect during turn | — | ❌ missing | Reconnection scenario not covered by shipped tests (ST-009) |
| 8.18 | Reconnect after turn | — | ❌ missing | Reconnection scenario not covered by shipped tests (ST-009) |
| 8.19 | Initial tile bag | `edge-cases.spec.ts:307` | ✅ covered |  |
| 8.20 | Tile bag count display | `edge-cases.spec.ts:351` | ✅ covered |  |
| 8.21 | Tile bag empties | — | ❌ missing | Requires playing until the tile bag empties; not covered (ST-009) |
| 8.22 | No tiles and no moves | — | ❌ missing | Requires playing until the tile bag empties; not covered (ST-009) |
| 8.23 | Network error | — | ❌ missing | Error-handling scenario not covered by shipped tests (ST-009) |
| 8.24 | Server error | — | ❌ missing | Error-handling scenario not covered by shipped tests (ST-009) |

## Coverage Gaps

**17 scenarios have no test and no documented deferral:**

- 6.9 Partial insufficient — Not covered; ST-007 shipped core scenarios only
- 6.10 Stock pool exhausted — Not covered; ST-007 shipped core scenarios only
- 6.11 Pool partially exhausted — Not covered; ST-007 shipped core scenarios only
- 6.13 Purchase after merger — Not covered; ST-007 shipped core scenarios only
- 6.16 All pools exhausted — Not covered; ST-007 shipped core scenarios only
- 6.17 Purchase timeout — Purchase timeout feature not implemented
- 8.7 No draw when bag empty — Not covered by shipped edge-case tests (ST-009)
- 8.12 All tiles unplayable — Not covered by shipped edge-case tests (ST-009)
- 8.14 Tile becomes playable — Not covered by shipped edge-case tests (ST-009)
- 8.15 Player reconnects — Reconnection scenario not covered by shipped tests (ST-009)
- 8.16 State sync on reconnect — Reconnection scenario not covered by shipped tests (ST-009)
- 8.17 Reconnect during turn — Reconnection scenario not covered by shipped tests (ST-009)
- 8.18 Reconnect after turn — Reconnection scenario not covered by shipped tests (ST-009)
- 8.21 Tile bag empties — Requires playing until the tile bag empties; not covered (ST-009)
- 8.22 No tiles and no moves — Requires playing until the tile bag empties; not covered (ST-009)
- 8.23 Network error — Error-handling scenario not covered by shipped tests (ST-009)
- 8.24 Server error — Error-handling scenario not covered by shipped tests (ST-009)

**14 scenarios are explicitly deferred** (see notes in the tables above).

## Test Rigor Inventory

Static inventory of every scenario test (heuristics parsed from source):

- **Turns**: from `MIN_TURNS = N` (a hard minimum the test asserts) or the largest
  `turn <= N` / `MAX_TURNS` loop bound (an upper bound for loop-until-feature tests).
  — means the test is not turn-based.
- **Screenshots**: number of `captureStep(...)` call sites in the test body (per-turn loops capture many more at runtime).
- **Seed**: per-room seed passed via `configureRoom({ seed })`, else the global `ACQUIRE_GAME_SEED=2` from `playwright.config.ts`.

| File:Line | Test | Scenario IDs | Turns | Screenshot calls | Seed |
|-----------|------|--------------|------:|-----------------:|------|
| `chain-expansion.spec.ts:172` | 4.1 & 4.3 & 4.7: Chain expansion, orphan absorption, and no founding trigger | 4.1, 4.3, 4.7 | up to 30 (loop until feature) | 8 | 2 |
| `chain-expansion.spec.ts:402` | 4.4 & 4.8: Stock price changes with chain growth and info panel updates | 4.4, 4.8 | up to 30 (loop until feature) | 7 | 2 |
| `chain-expansion.spec.ts:611` | 4.2 & 4.5 & 4.6: Multi-tile expansion and safe status at 11 tiles | 4.2, 4.5, 4.6 | up to 40 (loop until feature) | 7 | 2 |
| `chain-founding.spec.ts:56` | 3.1 & 3.3: Basic chain creation with all chains available | 3.1, 3.3 | up to 30 (loop until feature) | 11 | 2 |
| `chain-founding.spec.ts:261` | 3.4 & 3.5: Chain selection limited + founders bonus verification | 3.4, 3.5 | up to 40 (loop until feature) | 11 | 2 |
| `chain-founding.spec.ts:483` | 3.8 & 3.9: Chain colors and size tracking on board | 3.8, 3.9 | up to 30 (loop until feature) | 8 | 2 |
| `chain-founding.spec.ts:683` | 3.10: Chain founding cancellation on disconnect | 3.10 | up to 30 (loop until feature) | 10 | 2 |
| `chain-founding.spec.ts:921` | 3.2: Three-tile founding (3+ tiles form chain) | 3.2 | up to 5 (loop until feature) | 8 | 2 |
| `chain-founding.spec.ts:1149` | 3.6: Founder bonus stock depleted | 3.6 | up to 25 (loop until feature) | 6 | 2 |
| `chain-founding.spec.ts:1362` | 3.7: Cannot found 8th chain (all 7 chains active) | 3.7 | up to 40 (loop until feature) | 8 | 2 |
| `edge-cases.spec.ts:174` | 8.1 & 8.2: Min and max player counts | 8.1, 8.2 | — | 5 | 2 (global ACQUIRE_GAME_SEED) |
| `edge-cases.spec.ts:234` | 8.3: Cannot start with only 1 player | 8.3 | — | 3 | 2 (global ACQUIRE_GAME_SEED) |
| `edge-cases.spec.ts:270` | 8.4: Cannot add more than 6 players | 8.4 | — | 1 | 2 (global ACQUIRE_GAME_SEED) |
| `edge-cases.spec.ts:307` | 8.5 & 8.8 & 8.19: Initial hand size 6 and tile bag count | 8.5, 8.8, 8.19 | — | 3 | 2 (global ACQUIRE_GAME_SEED) |
| `edge-cases.spec.ts:351` | 8.6 & 8.20: Hand refills after placement, tile bag decreases | 8.6, 8.20 | 10 (min, enforced) | 3 | 2 (global ACQUIRE_GAME_SEED) |
| `edge-cases.spec.ts:431` | 8.9 & 8.10 & 8.11 & 8.13: Play until unplayable tiles appear | 8.9, 8.10, 8.11, 8.13 | up to 40 (loop until feature) | 5 | 2 (global ACQUIRE_GAME_SEED) |
| `end-game.spec.ts:510` | 7.3 & 7.15 & 7.13 & 7.16: Play to game end via UI button and verify game over screen | 7.3, 7.15, 7.13, 7.16 | — | 8 | 2 (global ACQUIRE_GAME_SEED) |
| `end-game.spec.ts:630` | 7.4: Cannot end game prematurely - END GAME button not visible | 7.4 | — | 6 | 2 (global ACQUIRE_GAME_SEED) |
| `end-game.spec.ts:758` | 7.8 & 7.11: Final scoring display with breakdown | 7.8, 7.11 | — | 7 | 2 (global ACQUIRE_GAME_SEED) |
| `mergers.spec.ts:267` | 5.1: Two-chain merger - smaller chain absorbed by larger | 5.1 | up to 50 (loop until feature) | 5 | 2 (global ACQUIRE_GAME_SEED) |
| `mergers.spec.ts:415` | 5.2: Tie-breaker merger - survivor selection when chains are equal | 5.2 | up to 50 (loop until feature) | 6 | 2 (global ACQUIRE_GAME_SEED) |
| `mergers.spec.ts:524` | 5.5: Safe chain immunity and extended gameplay | 5.5 | up to 50 (loop until feature) | 5 | 2 (global ACQUIRE_GAME_SEED) |
| `mergers.spec.ts:660` | 5.8: Sell all defunct stock during merger | 5.8 | up to 50 (loop until feature) | 3 | 2 (global ACQUIRE_GAME_SEED) |
| `mergers.spec.ts:763` | 5.11: Mixed disposition - sell some, trade some, hold some | 5.11 | up to 50 (loop until feature) | 3 | 2 (global ACQUIRE_GAME_SEED) |
| `mergers.spec.ts:857` | 5.15: Majority stockholder bonus paid during merger | 5.15 | up to 50 (loop until feature) | 5 | 2 (global ACQUIRE_GAME_SEED) |
| `mergers.spec.ts:1002` | 5.x: Multiple mergers in extended gameplay | — | up to 50 (loop until feature) | 4 | 2 (global ACQUIRE_GAME_SEED) |
| `mergers.spec.ts:1137` | 5.x: Merger with stock purchase after completion | — | up to 50 (loop until feature) | 4 | 2 (global ACQUIRE_GAME_SEED) |
| `smoke.spec.ts:27` | should capture screenshots at each step | — | — | 2 | 2 (global ACQUIRE_GAME_SEED) |
| `smoke.spec.ts:45` | should capture console errors | — | — | 0 | 2 (global ACQUIRE_GAME_SEED) |
| `smoke.spec.ts:68` | should verify lobby page structure | — | — | 2 | 2 (global ACQUIRE_GAME_SEED) |
| `smoke.spec.ts:89` | should create game, add bots, and start via UI | — | — | 6 | 2 |
| `smoke.spec.ts:144` | should create spectator game with bots only | — | — | 4 | 2 |
| `stock-purchases.spec.ts:275` | 6.1-6.3: Purchase limits - buy 1, 2, 3 stocks across turns | 6.1, 6.2, 6.3 | up to 30 (loop until feature) | 5 | 2 (global ACQUIRE_GAME_SEED) |
| `stock-purchases.spec.ts:373` | 6.4: Buy 0 stocks - skip purchase by ending turn | 6.4 | up to 20 (loop until feature) | 4 | 2 (global ACQUIRE_GAME_SEED) |
| `stock-purchases.spec.ts:436` | 6.5 & 6.6: Cannot buy 4+ and mixed chain purchase | 6.5, 6.6 | up to 30 (loop until feature) | 4 | 2 (global ACQUIRE_GAME_SEED) |
| `stock-purchases.spec.ts:553` | 6.8 & 6.12: Insufficient funds and price display | 6.8, 6.12 | up to 30 (loop until feature) | 4 | 2 (global ACQUIRE_GAME_SEED) |
| `stock-purchases.spec.ts:683` | 6.14: Purchase after founding - buy newly founded chain stock | 6.14 | up to 30 (loop until feature) | 5 | 2 (global ACQUIRE_GAME_SEED) |
| `stock-purchases.spec.ts:776` | 6.15 & 6.7: No chains available - no stocks to buy | 6.15, 6.7 | — | 4 | 2 (global ACQUIRE_GAME_SEED) |
| `stock-purchases.spec.ts:844` | 6.1-6.6 extended: 10+ turns with real purchases and cash tracking | 6.1, 6.2, 6.3, 6.4, 6.5, 6.6 | up to 30 (loop until feature) | 2 | 2 (global ACQUIRE_GAME_SEED) |
| `trading.spec.ts:59` | 2.1: Initiate trade offer | 2.1 | up to 20 (loop until feature) | 6 | 2 |
| `trading.spec.ts:144` | 2.2: Cancel trade offer | 2.2 | up to 15 (loop until feature) | 4 | 2 |
| `trading.spec.ts:209` | 2.3: Accept trade offer (two-player context) | 2.3 | — | 4 | 2 |
| `trading.spec.ts:262` | 2.4: Reject trade offer | 2.4 | — | 2 | 2 |
| `trading.spec.ts:291` | 2.5: Counter trade offer | 2.5 | — | 2 | 2 |
| `trading.spec.ts:318` | 2.6: Trade with insufficient stocks (validation) | 2.6 | up to 15 (loop until feature) | 3 | 2 |
| `trading.spec.ts:381` | 2.7: Multiple simultaneous offers | 2.7 | — | 3 | 2 |
| `trading.spec.ts:413` | 2.8: Stale trade (stocks changed) | 2.8 | — | 1 | 2 |
| `trading.spec.ts:434` | 2.9: Trade timeout | 2.9 | — | 1 | 2 |
| `trading.spec.ts:458` | 2.10: Basic 2:1 trade | 2.10 | — | 8 | 2 |
| `trading.spec.ts:527` | 2.11: Maximum 2:1 trade | 2.11 | — | 3 | 2 |
| `trading.spec.ts:575` | 2.12: Partial 2:1 trade (mixed sell/trade/keep) | 2.12 | — | 3 | 2 |
| `trading.spec.ts:629` | 2.13: No 2:1 trade available (survivor pool empty) | 2.13 | — | 3 | 2 |
| `trading.spec.ts:677` | 2.14: Odd number of defunct stock (can't trade 1 remaining) | 2.14 | — | 3 | 2 |
| `trading.spec.ts:722` | 2.15: 2:1 with sell combination | 2.15 | — | 3 | 2 |
| `trading.spec.ts:770` | 2.16: 2:1 with hold combination | 2.16 | — | 3 | 2 |
| `trading.spec.ts:817` | 2.17: 2:1 depletes survivor pool | 2.17 | — | 3 | 2 |
| `trading.spec.ts:868` | 2.18: 2:1 in multi-chain merger | 2.18 | — | 2 | 2 |
| `turn-flow.spec.ts:45` | 1.1: Basic complete turns - play at least 10 turns with detailed logging | 1.1 | 10 (min, enforced) | 9 | 2 |
| `turn-flow.spec.ts:185` | 1.2: Skip stock purchase - play at least 10 turns skipping buy phase | 1.2 | 10 (min, enforced) | 9 | 2 |
| `turn-flow.spec.ts:322` | 1.3: Turn with chain founding - play until two chains are founded | 1.3 | up to 30 (loop until feature) | 9 | 2 |
| `turn-flow.spec.ts:467` | 1.4: Extended gameplay - play at least 20 turns with full state tracking | 1.4 | 20 (min, enforced) | 13 | 2 |
| `turn-flow.spec.ts:725` | 1.10: Player disconnect during turn - turn gets skipped | 1.10 | — | 10 | 2 |

## Methodology & Caveats

- **Scenario numbering source**: the test-matrix tables in the Epic 07 story docs
  (`docs/roadmap/stories/07-scenario-tests/ST-002.md` … `ST-009.md`), which is the
  numbering the tests were implemented against. The older specs in
  `docs/tests/scenario/` use the same categories but different per-ID descriptions;
  they are not the mapping source for this report.
- **Direct coverage** is detected by scenario IDs appearing in test titles
  (including `&`-joined lists and `N.a-N.b` ranges).
- Rigor columns are static heuristics from test source, not runtime measurements.
  The tests themselves enforce turn minimums at runtime (they fail if the loop
  cannot complete).
- CI (`e2e-scenarios` job) runs the full scenario suite, fails on `test.skip` /
  `test.fixme` / `test.only`, verifies screenshots were produced, verifies this
  report is up to date, and publishes the Playwright HTML report plus a
  screenshot gallery (`playwright-report/screenshot-gallery.html`) as artifacts.
