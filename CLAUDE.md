# User Preferences

## Feature Implementation Workflow
Before implementing any feature (FF-XXX, etc.):
1. Check `docs/roadmap/README.md` for current progress and completed stories
2. Read recent completed stories to understand what's already built
3. Read the target story document at `docs/roadmap/stories/<epic>/<story-id>.md`
4. Review acceptance criteria - these define "done", not implementation details
5. Use implementation notes as guidance, not gospel - they may have technical gaps

When deviating from story suggestions:
- Make the call based on what you encounter during implementation
- Note the deviation and reasoning in the commit message or story doc
- Ensure acceptance criteria are still met (or update them with justification)

After completing a story:
1. Mark acceptance criteria as checked in the story doc
2. Update story status to `completed`
3. Update `docs/roadmap/README.md`: progress count, available stories, critical path

## Post-Implementation Review (MANDATORY)
Before committing any feature implementation, perform this review:

1. **API Integration Check**:
   - Verify API endpoints match actual backend routes (not just what docs say)
   - Check request/response formats align with backend expectations
   - Confirm proxy configuration handles URL rewriting correctly

2. **Type Alignment**:
   - Verify TypeScript types match actual backend data structures
   - Document any transformation logic needed between backend and frontend formats
   - Check for case sensitivity mismatches (e.g., backend 'Halcyon' vs frontend 'halcyon')

3. **Test Coverage Reality Check**:
   - Tests should cover real user scenarios, not just code paths
   - Include edge cases that users will actually encounter
   - Avoid testing implementation details that could change

4. **Integration Gap Analysis**:
   - Will this work when connected to the real backend?
   - Are there missing error handling scenarios?
   - Do loading/error states handle real network conditions?

5. **If gaps found**:
   - Fix critical issues before committing
   - Document known limitations in code comments or story doc
   - Create follow-up stories for non-blocking issues

## Setup (Claude on Mobile/Fresh Sessions)
On fresh sessions (e.g., Claude on mobile), install dependencies first:
```bash
pip install -r backend/requirements.txt
pip install ruff
```

## Agentic Development Workflow

This project is optimized for Claude Code (agentic AI) development.

### First-Time Setup (Once Per Session)
```bash
./scripts/dev-ready.sh  # Installs browser, starts servers
```

### Development Cycle
1. Make code changes
2. Quick verify: `./scripts/verify-change.sh`
3. Full verify: `./scripts/verify-full.sh`

### Interactive UI Testing with Playwright MCP
Use Playwright MCP tools to test the real app:

```
browser_navigate → http://127.0.0.1:5173
browser_snapshot → see current page state
browser_click → interact with elements
browser_take_screenshot → capture visual evidence
```

This tests the FULL STACK - real browser, real servers, real user experience.

### Verification Commands
| Command | Time | What it checks |
|---------|------|----------------|
| `./scripts/verify-change.sh` | ~10s | Lint, format, fast tests, surface coverage check, typecheck |
| `./scripts/verify-full.sh` | ~60s | All above + full backend tests + frontend unit tests + `@ci` journeys |
| `pytest backend/tests -q` | ~2s+ | Tier 1 (engine) + tier 2 (protocol) |
| `npm run e2e:screens` | minutes | Tier 3: screen tests from snapshots (real servers, `GAME_TEST_MODE=1`) |
| `npm run e2e:journeys` | minutes | Tier 4: home-page end-to-end journeys (real servers) |
| `npm run e2e:ci` | ~1 min | The `@ci`-tagged journeys only |
| `npm run e2e` | minutes | Screens + journeys + transcripts (the old scenario suite is gone: `docs/tests/legacy-suite-retirement.md`) |
| `python scripts/check-surface-coverage.py` | ~0.1s | Every surface in `docs/tests/surface-coverage.md` names a test that exists |

## Git Workflow
After completing code changes, always follow this sequence before being asked:
1. Run ruff format
2. Run ruff lint
3. Commit and push

Exception: For brainstorming or documentation updates, skip steps 1-2.

## Testing
- Always run tests after writing new tests or modifying existing ones
- Don't just write tests - verify they pass

### Test Policy: Four Tiers (owner decision 2026-11-14)

Background: the old browser scenario suite (62 tests, ~9,300 lines) did not finish in 10 minutes,
because tests played 20-40 turns through the browser against live bots to reach the screen under
test. The old rule "NO database seeding" is relaxed, **with guard rails**, because tests that
skipped the home page once looked good on coverage but left many real bugs. Full detail:
`docs/roadmap/epics/11-test-pyramid.md`. Technical contract: `docs/architecture/seat-contract.md`.

| Tier | What it tests | Command | Starts from |
|------|---------------|---------|-------------|
| 1. Engine | All game rules, in pytest, including property/fuzz full games through the decisions API | `pytest backend/tests -q` | Python |
| 2. Protocol | Server driven in-process (no browser) with scripted seats: full games, reconnects, concurrency | `pytest backend/tests -q` | HTTP/WS test client |
| 3. Screen | One screen state per test, Playwright against real servers | `npm run e2e:screens` | A **snapshot** loaded via the test-mode endpoint, scripted opponents |
| 4. Journey | ~5-8 true end-to-end journeys, no shortcuts | `npm run e2e:journeys` | **Always the home page** |

**Rules are tested once (tier 1).** Do not re-verify rules through the browser. Screen tests check
that a screen renders a state and sends the right action; journeys check that a user can get
through the app.

#### Guard rails (MANDATORY)

1. **Snapshot fixtures are generated by real play, never hand-built.** A fixture is a recorded seed
   plus action list replayed through the engine by a generator (`python -m fixtures_gen`, run from `backend/`).
   A backend test regenerates every fixture and compares it with the checked-in file. If you need a
   new state, add a spec (seed + actions) and regenerate; do not edit snapshot JSON. This makes
   contrived, unreachable states impossible.
2. **Tier-4 journeys always start at the home page and take no shortcuts.** UI interactions only
   (`page.click()`, `page.fill()`, `page.getByRole()`, `page.getByTestId()`). No `/api/*` calls, no
   `/test/*` endpoints, no snapshot loading, no seeding. The required journeys:
   - create game -> lobby -> add AI/scripted seats -> play real turns -> merger -> trade -> game over -> play again
   - multi-human: two browser contexts, second joins by room code
   - human + LLM seat (fake provider)
   - host/spectator view
   - reconnect/refresh mid-game
   - error paths: bad room code, duplicate name, full room
3. **Surface coverage map.** `docs/tests/surface-coverage.md` lists every user-visible surface
   (every route/page, every home-page entry point, every game phase screen, every modal, every
   error state) against the journey or screen test that covers it. When you add or change a
   surface, update the map in the same commit. A surface with no test is a visible gap. Coverage is
   measured by surfaces and journeys, not by line or scenario counts.
4. Test-mode endpoints exist only when `GAME_TEST_MODE=1` and must never be enabled in deploy config.

Example - what each tier may do:
```typescript
// Tier 4 journey: home page, UI only
await page.goto('/')
await page.getByTestId('name-input').fill('Player1')
await page.getByTestId('create-button').click()
await page.waitForURL(/\/play\/[A-Z]{4}/)

// Tier 3 screen test: setup may use the API and a snapshot, then assert on the real UI
const room = await createRoomWithSeats(request)                 // allowed in tier 3 only
await loadSnapshot(request, room, 'stock-disposition-p1')      // generated fixture, provenance-checked
await page.goto(`/play/${room}`)
await expect(page.getByTestId('merger-disposition')).toBeVisible()
```

#### Rules that apply to every tier

**Never terminate early on bugs.** Tests exist to surface integration bugs; fix the root cause.
```typescript
// WRONG - works around a bug instead of surfacing it
if (mergerGotStuck) {
  console.log('Merger stuck, considering test successful at turn 10')
  return // Test "passes" but bug is hidden
}

// RIGHT - test fails, bug gets fixed
if (mergerGotStuck) {
  throw new Error('Merger stuck - this is a bug that needs fixing')
}
```
- Journeys play real turns (20+ in the main journey) and **loop until the feature occurs** (merger,
  trade) with a hard cap that fails the test; never assume turn N has one.
- A test that cannot find its expected control fails. Never `return` early.

**Screenshots as evidence at every step.** No screenshot = no proof = didn't happen.
- Before/after every action: tile selected, tile placed, chain selector, chain chosen, buy phase,
  merger states, trade modal, final state.
- Save to `frontend/test-results/<tier>/<test-name>/` with numbered names (`01-lobby.png`,
  `02-game-created.png`); use the `shots.take()` fixture (screens), `j.shot()` (journeys) or `captureStep()` from `frontend/tests/e2e/support/screenshot.ts`.
- If tests "pass" but the page is blank or broken, the tests are wrong: add assertions that catch
  render failures.

**Check browser console errors.** Console errors and page errors fail the test (network noise
filtered):
```typescript
page.on('console', msg => console.log('[' + msg.type() + ']', msg.text()))
page.on('pageerror', err => console.log('Page error:', err.message))
```

**Determinism through seeding.** Use `GAME_SEED` for reproducible tile distribution:
```typescript
// playwright.config.ts
env: {
  GAME_SEED: '2',  // Same seed = same tile distribution
}
```

**Same code paths for bots, LLMs, scripted seats and humans.** Every seat acts through the single
`apply_action()` entry point. A seat only *produces* an action dict; validation and application
are identical for all. Separate paths hide bugs:
```python
# WRONG - separate paths that can diverge
if player.is_bot:
    bot_handle_disposition(...)  # Has bugs
else:
    send_websocket_message(...)  # Works fine

# RIGHT - same path for both
result = apply_action(game, player_id, action)
# The seat just generates the decision, execution is identical
```

**Detailed logging.** Log every action:
```typescript
console.log(`[Turn ${turn}] Placing tile: ${coord}`)
console.log(`[Turn ${turn}] Phase after place: ${phase}`)
console.log(`[Turn ${turn}] Founded chain: ${chain}`)
```

**Run against real servers.** Tier 3 and 4 tests that don't hit real servers are lies. Use
`./scripts/dev-ready.sh`, or start them by hand and verify:
```bash
cd backend && python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 &
cd frontend && npm run dev -- --host 127.0.0.1 &
curl -s http://127.0.0.1:8000/docs > /dev/null && echo "Backend: OK"
curl -s http://127.0.0.1:5173 > /dev/null && echo "Frontend: OK"
```
(Tier 3 also needs `GAME_TEST_MODE=1` on the backend.)

### WebSocket Reliability Pattern
When building real-time features:
- **WebSocket for receiving state updates** - game state changes, player joins, etc.
- **HTTP for sending actions** - add bot, start game, place tile, etc.
- Why: WebSocket connections can close unexpectedly; HTTP is more reliable for critical actions
- The Vite proxy handles `/api/*` routes to the backend automatically

### Avoiding Flaky Tests
- **Never assume specific tiles in player hands** when using `game_room` fixture - tiles are randomly distributed
- When testing invalid tile scenarios, dynamically find a tile NOT in the player's hand:
  ```python
  player_tile_strs = {str(t) for t in player.hand}
  invalid_tile = next(f"{c}{r}" for c in range(1,13) for r in "ABCDEFGHI" if f"{c}{r}" not in player_tile_strs)
  ```
- When testing valid tile scenarios, use `player.hand[0]` or similar to get actual tiles
- Run flaky-prone tests multiple times locally: `for i in {1..20}; do pytest path/to/test -v 2>&1 | grep -E "(PASSED|FAILED)"; done`

## CI Awareness
- GitHub CI (`.github/workflows/ci.yml`) runs: ruff lint, ruff format check, pytest with coverage (tiers 1-2, incl. snapshot provenance), a bench smoke run, the surface-coverage check, frontend typecheck/lint/unit tests, and the Playwright projects `screens`, `journeys` and `transcripts` (tiers 3-4)
