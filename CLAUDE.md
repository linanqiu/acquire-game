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
