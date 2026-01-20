# User Preferences

## Feature Implementation Workflow
**CRITICAL**: Before implementing any feature (FF-XXX, etc.):
1. Read the story document at `docs/roadmap/stories/<epic>/<story-id>.md`
2. Review all acceptance criteria - these are checkboxes that MUST be satisfied
3. Check implementation notes and testing requirements in the story
4. Reference linked documents (e.g., design-system.md) for exact specifications

This prevents missing requirements and ensures implementations match specifications.

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
