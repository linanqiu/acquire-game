# User Preferences

## Feature Implementation Workflow
Before implementing any feature (FF-XXX, etc.):
1. Read the story document at `docs/roadmap/stories/<epic>/<story-id>.md`
2. Review acceptance criteria - these define "done", not implementation details
3. Use implementation notes as guidance, not gospel - they may have technical gaps

When deviating from story suggestions:
- Make the call based on what you encounter during implementation
- Note the deviation and reasoning in the commit message or story doc
- Ensure acceptance criteria are still met (or update them with justification)

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

## CI Awareness
- GitHub CI runs: ruff lint, ruff format check, pytest with coverage
