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

## Git Workflow
After completing code changes, always follow this sequence before being asked:
1. Run ruff format
2. Run ruff lint
3. Commit and push

Exception: For brainstorming or documentation updates, skip steps 1-2.

## Testing
- Always run tests after writing new tests or modifying existing ones
- Don't just write tests - verify they pass

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
   - Save to `test-results/` with descriptive names

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
