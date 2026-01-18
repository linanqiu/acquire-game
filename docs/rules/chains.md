# Hotel Chains

This document covers the seven hotel chains in Acquire, including their pricing tiers, how to found chains, expansion rules, and the safe chain threshold.

---

## The Seven Hotel Chains

Acquire features seven hotel chains organized into three pricing tiers:

### Budget Tier (Lowest Prices)

| Chain | Color (Classic) | Starting Price | Stock per Share (2 tiles) |
|-------|-----------------|----------------|---------------------------|
| **Luxor** | Yellow | $200 | $200 |
| **Tower** | Red | $200 | $200 |

### Standard Tier (Medium Prices)

| Chain | Color (Classic) | Starting Price | Stock per Share (2 tiles) |
|-------|-----------------|----------------|---------------------------|
| **American** | Blue | $300 | $300 |
| **Festival** | Green | $300 | $300 |
| **Worldwide** | Orange | $300 | $300 |

### Premium Tier (Highest Prices)

| Chain | Color (Classic) | Starting Price | Stock per Share (2 tiles) |
|-------|-----------------|----------------|---------------------------|
| **Continental** | Purple | $400 | $400 |
| **Imperial** | Turquoise/Cyan | $400 | $400 |

---

## Price Tier Comparison

At any given chain size, the three tiers have different stock prices:

| Chain Size | Budget | Standard | Premium |
|------------|--------|----------|---------|
| 2 tiles | $200 | $300 | $400 |
| 3 tiles | $300 | $400 | $500 |
| 4 tiles | $400 | $500 | $600 |
| 5 tiles | $500 | $600 | $700 |
| 6-10 tiles | $600 | $700 | $800 |
| 11-20 tiles | $700 | $800 | $900 |
| 21-30 tiles | $800 | $900 | $1,000 |
| 31-40 tiles | $900 | $1,000 | $1,100 |
| 41+ tiles | $1,000 | $1,100 | $1,200 |

**Note**: See [Pricing Reference](pricing.md) for the complete official price table.

---

## Founding a New Chain

### When Founding Occurs

A new chain is founded when a player places a tile that connects:
- One or more **orphan tiles** (tiles not part of any chain)
- Where no existing chains are involved

### Founding Procedure

1. **Place the tile**: The founding player places the tile that creates the connection

2. **Choose the chain**: The founding player selects which hotel chain to create
   - May choose any of the 7 chains that is not currently on the board
   - The choice is strategic (different tiers have different prices)

3. **Place the chain marker**: The corresponding chain marker is placed on one of the tiles
   - Typically placed on the founding tile or one of the connected tiles
   - The marker identifies which tiles belong to which chain

4. **Receive founder's bonus**: The founding player receives **1 free stock certificate** in the new chain
   - This stock comes from the stock market tray
   - The founder does NOT pay for this stock
   - If no stock is available (all 25 already distributed), no bonus is given

### Founding Example

```
Board state before:
┌────┬────┬────┐
│    │ 6C │    │  ← Orphan tile
├────┼────┼────┤
│    │    │    │
└────┴────┴────┘

Player places tile 6D:
┌────┬────┬────┐
│    │[6C]│    │
├────┼────┼────┤
│    │[6D]│    │  ← Founding tile
└────┴────┴────┘

1. Tiles 6C and 6D are now connected
2. Player chooses to found "American" (Standard tier)
3. American chain marker placed on the tiles
4. Player receives 1 free American stock
```

### Strategic Considerations for Founding

**Choosing the chain tier:**
- **Budget chains** (Luxor, Tower): Lower stock prices mean cheaper purchases, but smaller bonuses
- **Standard chains** (American, Festival, Worldwide): Balanced pricing
- **Premium chains** (Continental, Imperial): Higher stock prices, larger bonuses, but more expensive to invest in

**Timing considerations:**
- Founding early allows you to buy cheap stock
- The free founder's bonus is valuable regardless of timing
- Control which chains enter play to influence stock availability

---

## Chain Expansion

### How Chains Grow

A chain expands when a tile is placed adjacent to existing chain tiles, adding the new tile to the chain.

### Types of Expansion

**Simple Expansion**: Adding one tile to an existing chain
```
Before:           After placing 7D:
┌────┬────┐       ┌────┬────┐
│[6C]│    │       │[6C]│    │
├────┼────┤   →   ├────┼────┤
│[6D]│    │       │[6D]│[7D]│  ← Chain grows
└────┴────┘       └────┴────┘
```

**Expansion with Orphan Adoption**: Chain absorbs adjacent orphan tiles
```
Before:               After placing 6D:
┌────┬────┬────┐      ┌────┬────┬────┐
│    │ 6C │    │      │    │[6C]│    │  ← Orphan joins chain
├────┼────┼────┤  →   ├────┼────┼────┤
│    │    │[7D]│      │    │[6D]│[7D]│
│    │    │[7E]│      │    │    │[7E]│
└────┴────┴────┘      └────┴────┴────┘

Chain grows from 2 to 4 tiles.
6C was an orphan that is now absorbed.
```

### Effects of Expansion

1. **Stock Price Increase**: As chains grow larger, stock prices increase according to the price table
2. **Approaching Safety**: Chains with 11+ tiles become "safe" (see below)
3. **Strategic Value**: Larger chains are harder to acquire in mergers

---

## Safe Chains

### The Safe Threshold

A chain becomes **"safe"** when it contains **11 or more tiles**.

### Properties of Safe Chains

1. **Cannot be acquired**: Safe chains cannot be taken over by larger chains in a merger
2. **Permanent protection**: Once safe, a chain remains safe for the rest of the game
3. **Merger immunity**: If a safe chain is involved in a merger situation, it is always the surviving chain

### Safe Chain Rules

**A tile that would merge two safe chains cannot be played.**

This is an illegal move because:
- Neither chain can acquire the other
- The merger cannot be resolved
- The tile becomes "permanently unplayable"

**Example of an illegal merger:**
```
┌────┬────┬────┐
│[  ]│    │{  }│  [brackets] = Continental (12 tiles, SAFE)
│[  ]│    │{  }│  {braces} = Imperial (11 tiles, SAFE)
│[  ]│ 6D │{  }│
│[  ]│    │{  }│
└────┴────┴────┘

Tile 6D would connect Continental and Imperial.
Both chains are SAFE.
6D CANNOT be played - it is permanently unplayable.
```

### Safe vs. Unsafe Mergers

| Merger Situation | Legal? | Result |
|------------------|--------|--------|
| Unsafe + Unsafe | Yes | Larger acquires smaller |
| Safe + Unsafe | Yes | Safe chain survives |
| Safe + Safe | **NO** | Illegal - cannot play tile |

---

## Chain Limits

### Maximum Chains on Board

- **Maximum**: 7 chains can exist simultaneously
- **Minimum to exist**: A chain must have at least 2 tiles

### Creating an 8th Chain

A tile that would found an 8th chain when 7 already exist **cannot be played**.

**Example**:
```
Seven chains already on board:
- Luxor (3 tiles)
- Tower (4 tiles)
- American (5 tiles)
- Festival (2 tiles)
- Worldwide (6 tiles)
- Continental (8 tiles)
- Imperial (7 tiles)

A tile that would connect two orphan tiles cannot be played
because it would create an 8th chain.
```

**Resolution**: The player must either:
1. Play a different tile that doesn't create a new chain
2. Wait for a merger to reduce the number of chains
3. Replace the unplayable tile (at end of turn, per rules)

---

## Chain Status Summary

| Status | Tile Count | Can Be Acquired? | Can Acquire Others? |
|--------|------------|------------------|---------------------|
| Active (Small) | 2-10 tiles | Yes | Only smaller chains |
| Safe | 11+ tiles | **No** | Yes (any smaller chain) |
| Defunct | 0 tiles (after merger) | N/A | N/A |
| Not Founded | N/A | N/A | N/A |

---

## Edition Variations

### Classic/1999 Rules
- Safe threshold: **11 tiles**
- All seven chains available from start

### 2008 Wizards of the Coast Edition
- Luxor renamed to **Sackson**
- Tier assignments reorganized:
  - Budget: Sackson, Worldwide
  - Standard: Festival, Imperial, American
  - Premium: Continental, Tower

### 2016 Edition
- Safe threshold changed to **10 tiles**
- Board changed to 10x10

---

## Strategic Notes

### Building Safe Chains
- Building a chain to 11+ tiles secures your investment
- Safe chains guarantee bonuses at game end
- Other players cannot "steal" your majority position through mergers

### Denying Safety
- Try to merge chains before opponents can make them safe
- Controlling merger timing is a key strategy

### Chain Selection
- Budget chains are easier to dominate (cheaper stock)
- Premium chains offer larger bonuses but require more capital
- Standard chains provide balanced risk/reward

---

[Previous: Tile Placement Rules](tiles.md) | [Back to Table of Contents](README.md) | [Next: Mergers](mergers.md)
