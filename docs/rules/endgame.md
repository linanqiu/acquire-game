# End Game

This document covers the end game conditions, declaration rules, final bonus calculations, stock liquidation, and determining the winner in Acquire.

---

## End Game Conditions

The game can end when **either** of the following conditions is true:

### Condition 1: One Chain Has 41+ Tiles

Any single hotel chain has grown to **41 or more tiles**.

```
Example: Continental has grown to 42 tiles
→ Game may be declared over
```

### Condition 2: All Chains Are Safe

**Every** active chain on the board has **11 or more tiles** (all are "safe").

```
Example: Three chains remain on the board:
- American: 15 tiles (safe)
- Continental: 22 tiles (safe)
- Imperial: 11 tiles (safe)
→ Game may be declared over
```

**Note**: This condition requires ALL active chains to be safe. If even one chain has fewer than 11 tiles, this condition is not met.

---

## Declaring the Game Over

### Who Can Declare

**Any player** whose turn it is may declare the game over, **if** one of the end game conditions is met.

### When to Declare

A player may declare at the **beginning** of their turn, after observing the board state.

### Declaration is Optional

**Important**: A player is **not required** to declare the game over even when conditions are met.

**Strategic reasons to continue:**
- You want to grow your stock value further
- You're behind and need more time to catch up
- You anticipate a beneficial merger

**Strategic reasons to end:**
- You have a clear lead
- Further play might reduce your advantage
- Opponents might improve their position

### Declaration Example

```
Turn sequence:
1. Player observes board: Continental has 42 tiles
2. Player may declare: "The game is over" (optional)
3. If declared: Proceed to final scoring
4. If not declared: Play continues normally
```

---

## Final Scoring Procedure

When the game is declared over, follow these steps:

### Step 1: Pay Final Bonuses

For **each active chain** on the board:
1. Count the tiles in the chain
2. Identify majority and minority stockholders
3. Pay majority and minority bonuses

**Apply standard tie-breaking rules:**
- Sole stockholder gets both bonuses
- Ties for majority: combine and split majority + minority
- Ties for minority: split minority bonus

### Step 2: Sell All Remaining Stock

After bonuses are paid:
1. Each chain's stock is sold at its **current market price**
2. All players sell all their stock back to the bank
3. Stock price is determined by the chain's final tile count

**Order of operations:**
- It doesn't matter which order stocks are sold
- All chains are valued at their final size
- Defunct stock (held from previous mergers) has **no value**

### Step 3: Count Total Wealth

Each player counts:
- **Cash on hand** (money held throughout the game)
- **Plus** cash received from final bonuses
- **Plus** cash received from final stock sales

---

## Determining the Winner

### Winner Criteria

The player with the **most total money** wins.

### Tie for Winner

If two or more players have exactly equal money:
- **Official rule**: The game is a tie
- **House rule variant**: May use secondary criteria (most stock certificates, etc.)

---

## Final Scoring Example

### Game State at Declaration

**Board state:**
- American: 18 tiles (Medium tier)
- Continental: 43 tiles (Expensive tier)
- Imperial: 12 tiles (Expensive tier)

**Stock holdings:**

| Player | American | Continental | Imperial | Cash |
|--------|----------|-------------|----------|------|
| Alice | 8 | 3 | 4 | $4,500 |
| Bob | 5 | 6 | 2 | $3,200 |
| Carol | 2 | 4 | 5 | $7,100 |

### Step 1: Final Bonuses

**American (18 tiles, Medium tier):**
- Majority: Alice (8 shares) - $8,000
- Minority: Bob (5 shares) - $4,000

**Continental (43 tiles, Expensive tier):**
- Majority: Bob (6 shares) - $12,000
- Minority: Carol (4 shares) - $6,000

**Imperial (12 tiles, Expensive tier):**
- Majority: Carol (5 shares) - $9,000
- Minority: Alice (4 shares) - $4,500

**Bonus Summary:**

| Player | American | Continental | Imperial | Total Bonus |
|--------|----------|-------------|----------|-------------|
| Alice | $8,000 | - | $4,500 | $12,500 |
| Bob | $4,000 | $12,000 | - | $16,000 |
| Carol | - | $6,000 | $9,000 | $15,000 |

### Step 2: Stock Sales

**Stock prices:**
- American (18 tiles, Medium): $800/share
- Continental (43 tiles, Expensive): $1,200/share
- Imperial (12 tiles, Expensive): $900/share

| Player | American | Continental | Imperial | Stock Value |
|--------|----------|-------------|----------|-------------|
| Alice | 8 x $800 = $6,400 | 3 x $1,200 = $3,600 | 4 x $900 = $3,600 | $13,600 |
| Bob | 5 x $800 = $4,000 | 6 x $1,200 = $7,200 | 2 x $900 = $1,800 | $13,000 |
| Carol | 2 x $800 = $1,600 | 4 x $1,200 = $4,800 | 5 x $900 = $4,500 | $10,900 |

### Step 3: Final Totals

| Player | Cash | Bonuses | Stock Sales | **Total** |
|--------|------|---------|-------------|-----------|
| Alice | $4,500 | $12,500 | $13,600 | **$30,600** |
| Bob | $3,200 | $16,000 | $13,000 | **$32,200** |
| Carol | $7,100 | $15,000 | $10,900 | **$33,000** |

### Winner: Carol with $33,000

---

## Defunct Stock at Game End

### Held Stock from Mergers

If you held stock from a defunct chain (hoping for re-founding), and the game ends before re-founding:
- **That stock is worthless**
- It provides no cash value at game end
- This is a risk of the "hold" strategy

### Example

```
During the game:
- Tower was acquired by American
- You held 5 Tower shares (didn't sell or trade)
- Tower was never re-founded

At game end:
- Your 5 Tower shares = $0
- You cannot sell them
- They do not count for bonuses
```

---

## Special End Game Situations

### No Chains on Board

**Extremely rare**: If somehow no chains exist at the end:
- No bonuses to pay
- No stock to sell
- Player with most cash wins

### Single Chain Games

If only one chain exists:
- Pay bonuses for that chain
- Sell stock in that chain
- Unused chains provide no value

### All Stock Held as Defunct

If a player's only stock is defunct chains:
- They receive no stock sale value
- They may still receive bonuses (if they held majority/minority before merger)
- Final score is just cash on hand

---

## Game End Timing Details

### Exact Moment

The game ends **immediately** upon declaration, meaning:
- No more tiles are placed
- No more stock is purchased
- No more drawing of tiles

### What Happens to the Active Turn

When a player declares the game over:
- Their turn ends immediately
- They do **not** place a tile, buy stock, or draw
- Proceed directly to final scoring

### Can Declaration Be Taken Back?

**No.** Once declared, the game is over.

---

## End Game Strategy Tips

### When to End Early
- You have significant majority positions
- Your opponents are cash-poor
- Further play could help opponents more than you

### When to Continue
- You're behind in stock positions
- You expect beneficial mergers
- An opponent has a dominant position you might disrupt

### Watching End Game Conditions
- Track chain sizes throughout the game
- Know which chains are approaching safety
- Anticipate when opponents might declare

---

## End Game Checklist

1. [ ] End condition verified (41+ tiles OR all chains safe)
2. [ ] Declaration made by active player
3. [ ] For each active chain:
   - [ ] Count tiles
   - [ ] Identify majority/minority stockholders
   - [ ] Pay bonuses (apply tie-breakers if needed)
4. [ ] Sell all stock at current prices
5. [ ] Each player totals: Cash + Bonuses + Stock Sales
6. [ ] Player with most money wins!

---

[Previous: Stock Purchasing](stocks.md) | [Back to Table of Contents](README.md) | [Next: Pricing Reference](pricing.md)
