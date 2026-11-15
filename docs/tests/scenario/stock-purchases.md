> **Historical.** This catalogue described the retired browser scenario suite. Current coverage is by surface: [surface-coverage.md](../surface-coverage.md); what happened to each old test: [legacy-suite-retirement.md](../legacy-suite-retirement.md).

# Stock Purchase Scenarios

Scenarios covering stock buying rules in Buyout, including purchase limits, availability, and pricing.

---

## Basic Stock Purchases

### Scenario 6.1: Buy Single Stock

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $5,000
- Halcyon chain exists (3 tiles, Medium tier)
- Halcyon stock price: $400
- Halcyon stock available in pool

**Actions:**
1. Player A buys 1 Halcyon stock

**Expected Outcomes:**
- Player A pays $400
- Player A receives 1 Halcyon stock
- Player A money: $4,600

**Key Assertions:**
- Player A Halcyon stock increased by 1
- Player A money decreased by $400
- Halcyon stock pool decreased by 1

---

### Scenario 6.2: Buy Maximum 3 Stocks (Same Chain)

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $3,000
- Marlowe chain exists (2 tiles, Cheap tier)
- Marlowe stock price: $200
- Marlowe has 10+ stock available

**Actions:**
1. Player A buys 3 Marlowe stock

**Expected Outcomes:**
- Player A pays $600 (3 x $200)
- Player A receives 3 Marlowe stock
- Maximum purchase in single turn

**Key Assertions:**
- Player A Marlowe stock increased by 3
- Player A money: $2,400
- 3 is the maximum per turn

---

### Scenario 6.3: Cannot Exceed 3 Per Turn

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $6,000
- Aurelia chain exists (2 tiles, Expensive tier)
- Aurelia stock price: $400

**Actions:**
1. Player A attempts to buy 4 Aurelia stock

**Expected Outcomes:**
- Purchase rejected
- Error: "Maximum 3 stocks per turn"

**Key Assertions:**
- Purchase rejected: true
- Player A Aurelia stock unchanged
- Player A money unchanged

---

### Scenario 6.4: Buy From Multiple Chains

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $2,000
- Active chains:
  - Sandpiper (2 tiles): $200/share
  - Halcyon (3 tiles): $400/share
  - Obsidian (4 tiles): $600/share

**Actions:**
1. Player A buys 1 Sandpiper, 1 Halcyon, 1 Obsidian

**Expected Outcomes:**
- Player A pays $1,200 total ($200 + $400 + $600)
- Player A receives 1 of each stock
- 3 total stocks purchased (at limit)

**Key Assertions:**
- Player A Sandpiper stock increased by 1
- Player A Halcyon stock increased by 1
- Player A Obsidian stock increased by 1
- Player A money: $800
- Total stocks this turn: 3

---

### Scenario 6.5: Cannot Buy Inactive Chain Stock

**Initial State:**
- Player A is active player (in buy stock phase)
- Active chains: Halcyon, Marlowe
- Juniper chain has never been founded (inactive)

**Actions:**
1. Player A attempts to buy Juniper stock

**Expected Outcomes:**
- Purchase rejected
- Error: "Cannot buy stock in inactive chain"

**Key Assertions:**
- Purchase rejected: true
- Juniper chain active: false
- Can only buy stock in chains on the board

---

### Scenario 6.6: Cannot Buy Defunct Chain Stock

**Initial State:**
- Player A is active player (in buy stock phase)
- Sandpiper was acquired by Halcyon earlier (Sandpiper is defunct)
- Sandpiper chain not currently on board

**Actions:**
1. Player A attempts to buy Sandpiper stock

**Expected Outcomes:**
- Purchase rejected
- Error: "Cannot buy stock in defunct chain"

**Key Assertions:**
- Purchase rejected: true
- Sandpiper chain active: false
- Defunct chains not purchasable

---

## Insufficient Resources

### Scenario 6.7: Insufficient Money for Purchase

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $500
- Aurelia chain exists (3 tiles)
- Aurelia stock price: $500

**Actions:**
1. Player A attempts to buy 2 Aurelia stock ($1,000 needed)

**Expected Outcomes:**
- Purchase rejected
- Error: "Insufficient funds"

**Key Assertions:**
- Purchase rejected: true
- Player A money: $500 (unchanged)
- Player A cannot afford 2 shares

---

### Scenario 6.8: Partial Purchase Within Budget

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $700
- Halcyon chain exists (3 tiles, Medium tier)
- Halcyon stock price: $400

**Actions:**
1. Player A buys 1 Halcyon stock ($400)

**Expected Outcomes:**
- Purchase succeeds
- Player A has $300 remaining
- Player A cannot afford second share

**Key Assertions:**
- Player A Halcyon stock increased by 1
- Player A money: $300
- Could only afford 1 share (not 2)

---

## Stock Pool Exhaustion

### Scenario 6.9: Stock Pool Exhausted

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $3,000
- Marlowe chain exists (4 tiles)
- Marlowe stock price: $400
- Marlowe stock pool: 0 (all 25 owned by players)

**Actions:**
1. Player A attempts to buy Marlowe stock

**Expected Outcomes:**
- Purchase rejected
- Error: "No Marlowe stock available"

**Key Assertions:**
- Purchase rejected: true
- Marlowe stock pool: 0
- All 25 Marlowe shares distributed among players

---

### Scenario 6.10: Partial Availability

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $2,000
- Juniper chain exists (3 tiles, Medium tier)
- Juniper stock price: $400
- Juniper stock pool: 2 shares remaining

**Actions:**
1. Player A attempts to buy 3 Juniper stock

**Expected Outcomes:**
- Purchase limited to 2 shares (availability)
- Player A pays $800 (2 x $400)
- Player A receives 2 Juniper stock

**Key Assertions:**
- Player A Juniper stock increased by 2
- Player A money: $1,200
- Juniper stock pool: 0
- Limited by availability, not budget

---

## Skip Buying

### Scenario 6.11: Skip Buying (Zero Purchase)

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $5,000
- Multiple chains exist with stock available

**Actions:**
1. Player A chooses to buy 0 stocks (skip)

**Expected Outcomes:**
- No stocks purchased
- No money spent
- Turn proceeds to draw phase

**Key Assertions:**
- All stock holdings unchanged
- Player A money: $5,000 (unchanged)
- Valid to buy 0 stocks

---

### Scenario 6.12: Forced Skip - No Affordable Options

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $100
- Only active chain: Aurelia (2 tiles, $400/share)

**Actions:**
1. Player A cannot afford any stock
2. Buy phase skipped automatically

**Expected Outcomes:**
- No purchase possible
- Turn proceeds to draw phase
- No error (expected game state)

**Key Assertions:**
- Player A money: $100 (unchanged)
- No stocks purchased
- Minimum stock price exceeds player's money

---

## Price Verification

### Scenario 6.13: Price Verification - Cheap Tier

**Initial State:**
- Player A is active player
- Sandpiper chain exists with varying sizes

**Actions:**
1. Verify Sandpiper (Cheap) prices at each size bracket

**Expected Outcomes:**
- 2 tiles: $200
- 3 tiles: $300
- 4 tiles: $400
- 5 tiles: $500
- 6-10 tiles: $600
- 11-20 tiles: $700
- 21-30 tiles: $800
- 31-40 tiles: $900
- 41+ tiles: $1,000

**Key Assertions:**
- Prices match Cheap tier table
- Marlowe has same prices as Sandpiper

---

### Scenario 6.14: Price Verification - Medium Tier

**Initial State:**
- Player A is active player
- Halcyon chain exists with varying sizes

**Actions:**
1. Verify Halcyon (Medium) prices at each size bracket

**Expected Outcomes:**
- 2 tiles: $300
- 3 tiles: $400
- 4 tiles: $500
- 5 tiles: $600
- 6-10 tiles: $700
- 11-20 tiles: $800
- 21-30 tiles: $900
- 31-40 tiles: $1,000
- 41+ tiles: $1,100

**Key Assertions:**
- Prices match Medium tier table
- Juniper and Meridian have same prices

---

### Scenario 6.15: Price Verification - Expensive Tier

**Initial State:**
- Player A is active player
- Aurelia chain exists with varying sizes

**Actions:**
1. Verify Aurelia (Expensive) prices at each size bracket

**Expected Outcomes:**
- 2 tiles: $400
- 3 tiles: $500
- 4 tiles: $600
- 5 tiles: $700
- 6-10 tiles: $800
- 11-20 tiles: $900
- 21-30 tiles: $1,000
- 31-40 tiles: $1,100
- 41+ tiles: $1,200

**Key Assertions:**
- Prices match Expensive tier table
- Obsidian has same prices as Aurelia

---

## Founder's Bonus Interaction

### Scenario 6.16: Founder's Bonus Does Not Count Toward Limit

**Initial State:**
- Player A is active player
- Player A has $2,000
- Player A places tile that founds new chain
- Chain founded: Marlowe (Cheap tier, $200/share)

**Actions:**
1. Player A receives 1 free Marlowe stock (founder's bonus)
2. Player A buys 3 additional Marlowe stock ($600)

**Expected Outcomes:**
- Player A has 4 Marlowe stock total
- Founder's bonus (1) + purchased (3) = 4
- 3 purchased is within turn limit

**Key Assertions:**
- Player A Marlowe stock: 4
- Player A money: $1,400
- Founder's bonus is separate from purchase limit
- Can still buy 3 after receiving bonus

---

### Scenario 6.17: Buy Stock in Newly Founded Chain

**Initial State:**
- Player A is active player
- Player A just founded Halcyon chain (2 tiles)
- Player A received founder's bonus
- Halcyon stock price: $300

**Actions:**
1. Player A buys 2 more Halcyon stock

**Expected Outcomes:**
- Player A pays $600
- Player A has 3 Halcyon total (1 bonus + 2 bought)
- Can buy stock in chain just founded

**Key Assertions:**
- Player A Halcyon stock: 3
- Newly founded chain is immediately purchasable
- Same turn as founding
