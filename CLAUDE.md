# User Preferences

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
