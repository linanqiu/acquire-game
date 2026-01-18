# Mergers

This document provides comprehensive rules for mergers in Acquire, including survivor determination, stockholder bonuses, tie-breaking rules, and stock disposition options.

---

## When Mergers Occur

A merger occurs when a player places a tile that is **adjacent to tiles from two or more different chains**.

The placed tile is called the **"merger tile"** and the player who placed it is the **"mergemaker"**.

```
Example - Merger situation:
┌────┬────┬────┐
│    │[6C]│    │  [brackets] = American chain
├────┼────┼────┤
│{5D}│    │[7D]│  {braces} = Tower chain
└────┴────┴────┘

Placing tile 6D connects American and Tower:
┌────┬────┬────┐
│    │[6C]│    │
├────┼────┼────┤
│{5D}│ 6D │[7D]│  ← Merger tile
└────┴────┴────┘
```

---

## Merger Resolution Steps

When a merger occurs, follow these steps **in order**:

### Step 1: Determine the Surviving Chain

**Rule**: The chain with **more tiles** survives. The smaller chain becomes **defunct**.

**Counting tiles**: Count only tiles physically on the board; do not count stock certificates.

**Example**:
- American: 5 tiles
- Tower: 3 tiles
- **American survives**, Tower becomes defunct

### Step 2: Pay Stockholder Bonuses

The **majority** and **minority** stockholders in the **defunct chain** receive cash bonuses.

See [Stockholder Bonuses](#stockholder-bonuses) section below for details.

### Step 3: Dispose of Defunct Stock

Each player with stock in the defunct chain must decide what to do with their shares.

Players make decisions **in order**, starting with the mergemaker and proceeding clockwise.

See [Stock Disposition Options](#stock-disposition-options) section below.

### Step 4: Complete the Merger

1. Remove the defunct chain's marker from the board
2. Place the surviving chain's marker on the merged tiles
3. All tiles from the defunct chain become part of the surviving chain
4. The defunct chain may be re-founded later if tiles connect

---

## Determining the Surviving Chain

### Standard Case: Different Sizes

The **larger chain** (more tiles) always survives.

| Chain A Size | Chain B Size | Survivor |
|--------------|--------------|----------|
| 5 tiles | 3 tiles | Chain A |
| 7 tiles | 12 tiles | Chain B |
| 2 tiles | 4 tiles | Chain B |

### Tie Case: Equal Sizes

If two chains have **equal** tile counts, the **mergemaker chooses** which chain survives.

**Example**:
- American: 4 tiles
- Festival: 4 tiles
- Mergemaker decides: "American survives"

### Safe Chain Involvement

If one chain is **safe** (11+ tiles) and the other is not:
- The **safe chain always survives**, regardless of size

If both chains are safe:
- **The merger is illegal** - the tile cannot be played

| Chain A | Chain B | Survivor |
|---------|---------|----------|
| Safe (15 tiles) | Unsafe (8 tiles) | Chain A |
| Unsafe (20 tiles) | Safe (11 tiles) | Chain B |
| Safe | Safe | **ILLEGAL** |

---

## Stockholder Bonuses

### Who Receives Bonuses

At the time of merger, all players reveal their stock holdings in the **defunct chain**.

- **Majority Stockholder**: Player(s) with the most shares
- **Minority Stockholder**: Player(s) with the second-most shares

### Bonus Amounts

Bonuses are determined by:
1. The **tier** of the defunct chain (Budget, Standard, Premium)
2. The **size** of the defunct chain (number of tiles at merger time)

| Chain Size | Budget Tier | Standard Tier | Premium Tier |
|------------|-------------|---------------|--------------|
| | Majority / Minority | Majority / Minority | Majority / Minority |
| 2 tiles | $2,000 / $1,000 | $3,000 / $1,500 | $4,000 / $2,000 |
| 3 tiles | $3,000 / $1,500 | $4,000 / $2,000 | $5,000 / $2,500 |
| 4 tiles | $4,000 / $2,000 | $5,000 / $2,500 | $6,000 / $3,000 |
| 5 tiles | $5,000 / $2,500 | $6,000 / $3,000 | $7,000 / $3,500 |
| 6-10 tiles | $6,000 / $3,000 | $7,000 / $3,500 | $8,000 / $4,000 |
| 11-20 tiles | $7,000 / $3,500 | $8,000 / $4,000 | $9,000 / $4,500 |
| 21-30 tiles | $8,000 / $4,000 | $9,000 / $4,500 | $10,000 / $5,000 |
| 31-40 tiles | $9,000 / $4,500 | $10,000 / $5,000 | $11,000 / $5,500 |
| 41+ tiles | $10,000 / $5,000 | $11,000 / $5,500 | $12,000 / $6,000 |

**Note**: The minority bonus is always **half** of the majority bonus.

See [Pricing Reference](pricing.md) for the complete official bonus table.

---

## Tie-Breaking Rules for Bonuses

### Sole Stockholder

If **only one player** owns stock in the defunct chain:
- That player receives **BOTH** the majority AND minority bonuses

**Example**: Only Player A owns Tower stock (5 shares)
- Player A receives: $2,000 (majority) + $1,000 (minority) = **$3,000 total**

### Tie for Majority Stockholder

If **two or more players** tie for the most shares:

1. **Add** the majority and minority bonuses together
2. **Divide equally** among the tied players
3. **Round up** to the nearest $100 if needed
4. **No minority bonus** is paid (it was absorbed into the split)

**Example**: Player A and Player B both have 6 shares (tie for majority)
- Chain: Tower (4 tiles) - Majority $4,000, Minority $2,000
- Combined bonus: $4,000 + $2,000 = $6,000
- Split: $6,000 / 2 = **$3,000 each**
- No minority bonus is paid

**Example with rounding**: Player A, B, and C tie for majority
- Chain: American (5 tiles) - Majority $6,000, Minority $3,000
- Combined: $6,000 + $3,000 = $9,000
- Split: $9,000 / 3 = **$3,000 each**

### Tie for Minority Stockholder

If majority is clear but **two or more players** tie for second place:

1. **Majority stockholder** receives full majority bonus
2. **Split** the minority bonus equally among tied players
3. **Round up** to the nearest $100 if needed

**Example**: Player A has 8 shares (majority), Players B and C have 4 shares each (tie for minority)
- Chain: Continental (6 tiles) - Majority $8,000, Minority $4,000
- Player A receives: **$8,000** (majority)
- Players B and C split: $4,000 / 2 = **$2,000 each**

### Three-Way Tie Examples

**All three top stockholders tie**:
- Majority + Minority combined, split three ways

**Two tie for majority, one for minority**:
- Two players split majority + minority
- Third player gets nothing (minority was absorbed)

---

## Stock Disposition Options

After bonuses are paid, stockholders must decide what to do with their defunct stock.

**Order**: Starting with the mergemaker, then clockwise, each player handles their defunct stock.

Each player may use **any combination** of the following three options:

### Option 1: HOLD

**Keep** the stock certificates.

- The stock remains in your possession
- It has no current value (chain is defunct)
- If the chain is re-founded later, your stock becomes active again
- Useful if you expect the chain to return

### Option 2: SELL

**Sell** stock back to the bank at the current market price.

- Receive cash equal to: (Number of shares) x (Stock price at time of merger)
- Stock price is based on the defunct chain's size **before** the merger
- Stock certificates return to the stock market tray

**Example**:
- You have 5 shares of Tower
- Tower had 4 tiles when merged (price: $400/share)
- Sell all 5 shares: 5 x $400 = **$2,000**

### Option 3: TRADE

**Exchange** defunct stock for surviving chain stock at a **2:1 ratio**.

- Trade 2 shares of defunct stock for 1 share of surviving stock
- Must trade in pairs (cannot trade odd shares)
- Only works if surviving chain has stock available

**Example**:
- You have 6 shares of defunct Tower
- American survived the merger
- Trade 6 Tower shares for 3 American shares
- (If you had 7 shares, you could trade 6, then hold or sell the remaining 1)

### Combining Options

Players may **combine** options for their shares:

**Example**:
- You have 10 shares of defunct Festival
- Trade 6 shares for 3 Continental shares
- Sell 2 shares for cash
- Hold 2 shares for possible re-founding

---

## Multiple Chain Mergers

When a tile connects **three or more chains**, handle them in order:

### Resolution Order

1. Identify all chains involved
2. Determine which chain survives (largest, or mergemaker chooses if tied)
3. **Resolve each defunct chain separately**, largest to smallest:
   - Pay bonuses for that chain
   - Allow stock disposition for that chain
4. Proceed to the next defunct chain
5. After all defunct chains are resolved, the merger is complete

### Example: Three-Chain Merger

```
┌────┬────┬────┐
│    │{6C}│    │  Tower (4 tiles)
├────┼────┼────┤
│[5D]│    │(7D)│  American (6 tiles), Continental (3 tiles)
└────┴────┴────┘

Placing 6D merges all three chains.
```

**Resolution**:
1. American (6 tiles) survives (largest)
2. First, resolve Tower (4 tiles) - second largest defunct:
   - Pay Tower bonuses
   - Players dispose of Tower stock
3. Then, resolve Continental (3 tiles) - smallest:
   - Pay Continental bonuses
   - Players dispose of Continental stock
4. All tiles become American tiles

---

## Special Merger Situations

### No Stock in Defunct Chain

If no player owns any stock in the defunct chain:
- No bonuses are paid
- Simply complete the merger

### Insufficient Stock for Trading

If the surviving chain has no stock available:
- Players cannot choose the TRADE option for those shares
- They must HOLD or SELL

### Chain Re-founding After Merger

After a chain becomes defunct:
- Its marker is removed from the board
- The chain can be founded again later
- If you HELD stock, it becomes active again when re-founded

---

## Merger Summary Checklist

1. [ ] Identify all chains involved in the merger
2. [ ] Determine surviving chain (most tiles, or mergemaker's choice if tie)
3. [ ] Count tiles in each defunct chain
4. [ ] All players reveal stock holdings in defunct chain(s)
5. [ ] Identify majority and minority stockholders
6. [ ] Calculate and pay bonuses (handle ties appropriately)
7. [ ] Starting with mergemaker, clockwise, each player disposes of stock
8. [ ] Remove defunct chain marker(s)
9. [ ] Update board to show surviving chain
10. [ ] Continue with active player's turn (buy stock, draw tile)

---

## Common Merger Mistakes

1. **Counting stock instead of tiles**: Surviving chain is determined by **tiles on the board**, not by stock ownership
2. **Forgetting the trading option**: Players may forget they can trade 2-for-1
3. **Incorrect tie-breaking**: Remember to combine majority + minority for ties for majority
4. **Wrong resolution order**: In multi-chain mergers, resolve largest defunct first
5. **Selling at wrong price**: Use the defunct chain's tile count at merger time

---

[Previous: Hotel Chains](chains.md) | [Back to Table of Contents](README.md) | [Next: Stock Purchasing](stocks.md)
