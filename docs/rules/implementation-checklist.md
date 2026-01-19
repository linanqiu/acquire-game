# Acquire Implementation Verification Checklist

This document maps the official rules to implementation requirements for verifying game logic correctness.

---

## Board Configuration

- [ ] Board is 12 columns (1-12) × 9 rows (A-I) = 108 spaces
- [ ] Tiles have coordinates matching board spaces
- [ ] Tile coordinates validated: column 1-12, row A-I

## Game Setup

- [ ] Each player starts with **$6,000**
- [ ] Each player draws **6 tiles** to start
- [ ] Support for **2-6 players**
- [ ] Turn order determined by initial tile draw (closest to 1-A goes first)

## Corporations

### Configuration
- [ ] **7 corporations** total
- [ ] Correct tier assignments:
  - Cheap: Luxor, Tower
  - Medium: American, Worldwide, Festival
  - Expensive: Imperial, Continental
- [ ] **25 stock certificates** per corporation
- [ ] Maximum **7 active corporations** at any time

### Safety
- [ ] Corporation with **11+ tiles** is "safe"
- [ ] Safe corporations cannot be taken over
- [ ] Safe corporations CAN absorb smaller corporations

## Turn Sequence

- [ ] Four phases in order: Trade → Place Tile → Buy Stock → Draw Tile
- [ ] Player-to-player trading is **optional** (Phase 1)
- [ ] Tile placement is **mandatory** (unless all tiles unplayable)
- [ ] Stock purchase is **optional**
- [ ] Maximum **3 stocks purchased per turn**
- [ ] Tile drawing is **mandatory**

## Player-to-Player Trading

- [ ] Trading only allowed **before** tile placement
- [ ] Only **active player** may initiate trades
- [ ] Other players may **accept or decline** proposed trades
- [ ] Trades can include stock, cash, or combinations
- [ ] Multiple trades may occur per trading phase
- [ ] Trading closes once tile placement begins

## Tile Placement Results

### Nothing (Isolated)
- [ ] Tile not adjacent (horizontal/vertical) to any other tile
- [ ] Tile stays on board, not part of any corporation
- [ ] **Diagonal does NOT count as adjacent**

### Founding
- [ ] Triggered when tile connects to unincorporated tile(s)
- [ ] Player chooses from inactive corporations
- [ ] Founder receives **1 free stock**
- [ ] If no stock available, founder receives cash equivalent
- [ ] All connected unincorporated tiles join the new corporation

### Expansion
- [ ] Triggered when tile adjacent to exactly one corporation
- [ ] New tile joins that corporation
- [ ] Any newly-connected unincorporated tiles also join

### Merger
- [ ] Triggered when tile adjacent to 2+ corporations
- [ ] Larger corporation survives
- [ ] Tie in size: **mergemaker chooses** survivor

## Merger Resolution

### Bonus Calculation
- [ ] **Majority bonus = Stock Price × 10**
- [ ] **Minority bonus = Stock Price × 5**
- [ ] Bonuses based on **defunct corporation size BEFORE merger**

### Bonus Distribution Rules
| Scenario | Implementation |
|----------|----------------|
| Single stockholder | Gets BOTH majority + minority bonuses |
| Tie for majority | Split (majority + minority) evenly, round UP to $100, no minority paid |
| Clear majority, tie for minority | Full majority to winner, split minority, round UP to $100 |

- [ ] Bonus rounding is **UP to nearest $100**

### Stock Disposition
- [ ] Order: mergemaker first, then clockwise
- [ ] Three options: HOLD, SELL, TRADE
- [ ] HOLD: Keep stock for potential future corporation founding
- [ ] SELL: At current price (defunct corp size before merger)
- [ ] TRADE: **2 defunct shares = 1 surviving share**
- [ ] Cannot trade for unavailable surviving stock
- [ ] Players can combine options (e.g., sell some, trade some, hold some)

### Multiple Mergers (3+ corps)
- [ ] Largest corporation survives
- [ ] Process defunct corps **largest to smallest**
- [ ] Tie in defunct corp size: mergemaker chooses order
- [ ] Complete full resolution for each defunct corp before next

## Stock Purchase

- [ ] Maximum **3 shares total per turn**
- [ ] Can split across multiple corporations
- [ ] Only **active corporations** (on board) purchasable
- [ ] Cannot exceed available stock in market
- [ ] Stock price based on current corporation size

## Stock Price Table Verification

### Cheap Tier (Luxor, Tower)
| Size | Price |
|------|-------|
| 2 | $200 |
| 3 | $300 |
| 4 | $400 |
| 5 | $500 |
| 6-10 | $600 |
| 11-20 | $700 |
| 21-30 | $800 |
| 31-40 | $900 |
| 41+ | $1,000 |

### Medium Tier (American, Worldwide, Festival)
| Size | Price |
|------|-------|
| 2 | $300 |
| 3 | $400 |
| 4 | $500 |
| 5 | $600 |
| 6-10 | $700 |
| 11-20 | $800 |
| 21-30 | $900 |
| 31-40 | $1,000 |
| 41+ | $1,100 |

### Expensive Tier (Imperial, Continental)
| Size | Price |
|------|-------|
| 2 | $400 |
| 3 | $500 |
| 4 | $600 |
| 5 | $700 |
| 6-10 | $800 |
| 11-20 | $900 |
| 21-30 | $1,000 |
| 31-40 | $1,100 |
| 41+ | $1,200 |

## Unplayable Tiles

### Permanently Unplayable
- [ ] Would merge **two or more safe corporations**
- [ ] Disclosed to all players
- [ ] **Removed from game**
- [ ] Player draws replacement
- [ ] Can replace multiple per turn (first time through hand)

### Temporarily Unplayable
- [ ] Would create **8th corporation**
- [ ] Player **must keep** in hand
- [ ] **Cannot be discarded**

### All Tiles Unplayable
- [ ] If all 6 tiles unplayable at turn start
- [ ] Reveal hand to all players
- [ ] Set aside unplayable tiles (removed from game)
- [ ] Draw 6 new tiles

## End Game

### Conditions (Either)
- [ ] Any corporation reaches **41+ tiles**
- [ ] **All active corporations** are safe (11+ tiles)

### Declaration
- [ ] Player **may** declare (not required)
- [ ] Declaration at start or end of turn

### Final Scoring
- [ ] Pay maj/min bonuses for **all active corporations**
- [ ] All players sell stock at current prices
- [ ] Stock in **inactive corporations = worthless**
- [ ] **Highest total cash wins**

---

## Current Implementation Notes

Based on `/backend/game/hotel.py`, the current price table uses:

```python
PRICE_TABLE = {
    CHEAP: {2: 200, 3: 300, 4: 400, 5: 500, 6: 600, 11: 700, 21: 800, 31: 900, 41: 1000},
    MEDIUM: {2: 300, 3: 400, 4: 500, 5: 600, 6: 700, 11: 800, 21: 900, 31: 1000, 41: 1100},
    EXPENSIVE: {2: 400, 3: 500, 4: 600, 5: 700, 6: 800, 11: 900, 21: 1000, 31: 1100, 41: 1200}
}
```

### Price Table Discrepancy

The implementation uses threshold keys (6, 11, 21, 31, 41) which means:
- Size 6-10 uses the "6" threshold
- Size 11-20 uses the "11" threshold
- etc.

This matches the rules, but verify the bracket selection logic handles:
- Size 6 → uses $600 (cheap)
- Size 10 → uses $600 (cheap)
- Size 11 → uses $700 (cheap)

### Bonus Calculation
Currently implemented as:
- Majority = price × 10
- Minority = price × 5

This matches the official rules.

---

## Edge Cases to Test

1. **Founding with no stock available** - should founder get cash?
2. **Triple merger** - correct order of defunct corp processing?
3. **Tie for majority with 3+ players** - correct split?
4. **Trading when surviving stock limited** - partial trades allowed?
5. **Player bankrupting during turn** - can they complete turn?
6. **Safe corp absorbing unsafe** - verify this works
7. **Exactly 11 tiles** - is it safe?
8. **Exactly 41 tiles** - can game be declared over?
9. **All 7 corps active, no mergers possible** - handled correctly?
10. **Stock sold/traded mid-merger** - availability updates immediately?

---

[Back to Table of Contents](README.md)
