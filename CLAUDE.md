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
   - Check for case sensitivity mismatches (e.g., backend 'American' vs frontend 'american')

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
| `./scripts/verify-change.sh` | ~10s | Lint, format, fast tests, typecheck |
| `./scripts/verify-full.sh` | ~60s | All above + full backend tests + E2E smoke |
| `pytest backend/tests -x` | ~2s | All backend unit/integration tests |
| `npm run e2e` | ~60s | Full Playwright E2E suite |

## Git Workflow
After completing code changes, always follow this sequence before being asked:
1. Run ruff format
2. Run ruff lint
3. Commit and push

Exception: For brainstorming or documentation updates, skip steps 1-2.

## Testing
- Always run tests after writing new tests or modifying existing ones
- Don't just write tests - verify they pass

### Scenario Tests vs API Tests (CRITICAL DISTINCTION)

**Scenario tests ARE user journey tests.** They exercise the app exactly as users would:

1. **Scenario tests (E2E user flows):**
   - MUST use UI interactions: `page.click()`, `page.fill()`, `page.getByRole()`
   - NO API shortcuts - don't call `/api/create-game` directly
   - NO database seeding - if a user can't do it through the UI, neither should the test
   - Screenshots at every step prove the UI actually works
   - These tests answer: "Can a user accomplish this task?"

2. **API tests (backend/isolated):**
   - Direct API calls are appropriate here
   - Test business logic, validation, error handling
   - These tests answer: "Does the API behave correctly?"

3. **Why this matters:**
   - API tests can pass while the UI is completely broken
   - Scenario tests catch integration failures that API tests miss
   - If you're testing a "user journey" but calling APIs directly, you're lying about coverage

**Example - Creating a game:**
```typescript
// WRONG for scenario tests - this is an API shortcut
const response = await fetch('/api/create-game', { method: 'POST' })

// RIGHT for scenario tests - this is what users do
await page.getByTestId('create-name-input').fill('Player1')
await page.getByTestId('create-button').click()
await page.waitForURL(/\/play\/[A-Z]{4}/)
```

### Scenario Test Rigor Standards (MANDATORY)

Scenario tests must exercise **real gameplay**, not just verify UI elements exist. The purpose is to surface integration bugs that unit tests miss.

**1. Play Real Turns, Don't Just Check UI**
```typescript
// WRONG - just checks UI elements exist
await expect(page.getByTestId('tile-rack')).toBeVisible()
await expect(page.getByTestId('place-tile-button')).toBeVisible()
// Test passes even if game is completely broken

// RIGHT - actually plays the game
for (let turn = 1; turn <= 10; turn++) {
  await waitForMyTurn(page)
  await selectTileFromRack(page)
  await placeTile(page)
  // Handle chain founding if triggered
  if (await hasChainSelector(page)) {
    await selectFirstAvailableChain(page)
  }
  await endTurn(page)
}
// Test only passes if 10 complete turns work end-to-end
```

**2. Minimum Turn Requirements**
- Basic turn tests: **10+ complete turns**
- Complex multi-feature tests: **20+ turns**
- Feature-specific tests: **loop until feature occurs** (e.g., loop until a merger happens, don't assume turn 5 will have one)

**3. Never Terminate Early on Bugs**
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
Scenario tests exist to find integration bugs. When a test surfaces a bug, **fix the root cause**. Don't add workarounds that hide real problems.

**4. Screenshots at Every Action**
Not just "before" and "after", but at EVERY step:
- Before placing tile
- After selecting tile (button enabled)
- After placing tile
- Chain selector visible (if founding)
- After selecting chain
- Buy phase
- Merger states (in progress, stock disposition, complete)
- Final state

**5. Determinism Through Seeding**
Use `ACQUIRE_GAME_SEED` env var for reproducible tests:
```typescript
// playwright.config.ts
env: {
  ACQUIRE_GAME_SEED: '2',  // Same seed = same tile distribution
}
```

**6. Same Code Paths for Bots and Humans**
If bots and humans have different code paths for the same action (e.g., stock disposition), bugs hide. The backend should use unified handlers:
```python
# WRONG - separate paths that can diverge
if player.is_bot:
    bot_handle_disposition(...)  # Has bugs
else:
    send_websocket_message(...)  # Works fine

# RIGHT - same path for both
result = game.handle_stock_disposition(player_id, sell, trade, keep)
# Bot just generates the decision, execution is identical
```

**7. Detailed Logging**
Log every action for debugging:
```typescript
console.log(`[Turn ${turn}] Placing tile: ${coord}`)
console.log(`[Turn ${turn}] Phase after place: ${phase}`)
console.log(`[Turn ${turn}] Founded chain: ${chain}`)
```

### E2E Testing (CRITICAL)
**Tests that don't actually run against real servers are LIES.** Follow this protocol:

1. **Always start real servers before E2E tests:**
   ```bash
   # Start backend
   cd backend && python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 &

   # Start frontend
   cd frontend && npm run dev -- --host 127.0.0.1 &

   # Verify both are running
   curl -s http://127.0.0.1:8000/docs > /dev/null && echo "Backend: OK"
   curl -s http://127.0.0.1:5173 > /dev/null && echo "Frontend: OK"
   ```

2. **Capture screenshots as evidence at every step:**
   - Screenshots prove the test actually ran against real UI
   - No screenshot = no proof = didn't happen
   - Save to `frontend/test-results/scenarios/<test-name>/` with numbered names
   - Use the `takeScreenshot()` helper from `helpers/screenshot.ts`
   - Example: `01-lobby-before-create.png`, `02-game-created.png`

3. **Check browser console for errors:**
   ```typescript
   page.on('console', msg => console.log('[' + msg.type() + ']', msg.text()))
   page.on('pageerror', err => console.log('Page error:', err.message))
   ```

4. **Test the full user flow, not just API calls:**
   - Create game via UI → verify redirect → verify page renders
   - Check WebSocket connects successfully
   - Verify game state displays correctly

5. **If tests "pass" but page is blank/broken:**
   - The tests are wrong, not the code
   - Add screenshot assertions to catch render failures
   - Check for JavaScript errors in console

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
- GitHub CI runs: ruff lint, ruff format check, pytest with coverage
