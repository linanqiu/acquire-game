# Scenario Test Specifications

This directory contains comprehensive end-to-end test specifications for the Acquire board game. These are human-readable specifications that document test scenarios covering all major game mechanics.

## Purpose

These specifications serve as:
- **Test design documentation**: Clear descriptions of what to test and expected outcomes
- **Acceptance criteria**: Unambiguous success conditions for each scenario
- **Implementation guidance**: Detailed setup and action sequences for test authors
- **Rules verification**: Cross-reference against `/docs/rules/` for accuracy

## Scenario Format

Each scenario follows this structure:

```markdown
### Scenario X.Y: [Descriptive Name]

**Initial State:**
- [Setup conditions - board state, player holdings, game phase, etc.]

**Actions:**
1. [Step-by-step actions to perform]
2. [Each action should be atomic and verifiable]

**Expected Outcomes:**
- [What should happen at each significant step]
- [State changes, notifications, phase transitions]

**Key Assertions:**
- [Specific values/states to verify]
- [Quantitative checks: money amounts, stock counts, tile counts]
```

## Specifications

| File | Coverage |
|------|----------|
| [turn-flow.md](turn-flow.md) | Complete turn sequences: trade, tile, buy, draw |
| [trading.md](trading.md) | Player-to-player and merger 2:1 trades |
| [chain-founding.md](chain-founding.md) | Chain creation and founder bonuses |
| [chain-expansion.md](chain-expansion.md) | Chain growth and orphan absorption |
| [mergers.md](mergers.md) | Merger resolution, bonuses, stock disposition |
| [stock-purchases.md](stock-purchases.md) | Stock buying rules and limits |
| [end-game.md](end-game.md) | End conditions, final scoring, winner determination |
| [edge-cases.md](edge-cases.md) | Boundary conditions and error handling |

## Numbering Convention

Scenarios are numbered by category:

| Prefix | Category |
|--------|----------|
| 1.x | Turn Flow |
| 2.x | Trading |
| 3.x | Chain Founding |
| 4.x | Chain Expansion |
| 5.x | Mergers |
| 6.x | Stock Purchases |
| 7.x | End Game |
| 8.x | Edge Cases |

## Implementation Notes

When implementing tests from these specifications:

1. **Reproducibility**: Use seeded random for tile draws and consistent initial states
2. **Isolation**: Each scenario should be independent and self-contained
3. **Assertions**: Verify all key assertions listed, not just the final outcome
4. **Cleanup**: Restore any global state after test completion

## Cross-References

- Game rules: `/docs/rules/`
- Existing tests: `/backend/tests/`
- Game implementation: `/backend/game/`
