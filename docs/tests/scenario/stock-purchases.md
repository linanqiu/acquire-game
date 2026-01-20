# Stock Purchase Scenarios

Scenarios covering stock buying rules in Acquire, including purchase limits, availability, and pricing.

---

## Basic Stock Purchases

### Scenario 6.1: Buy Single Stock

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $5,000
- American chain exists (3 tiles, Medium tier)
- American stock price: $400
- American stock available in pool

**Actions:**
1. Player A buys 1 American stock

**Expected Outcomes:**
- Player A pays $400
- Player A receives 1 American stock
- Player A money: $4,600

**Key Assertions:**
- Player A American stock increased by 1
- Player A money decreased by $400
- American stock pool decreased by 1

---

### Scenario 6.2: Buy Maximum 3 Stocks (Same Chain)

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $3,000
- Tower chain exists (2 tiles, Cheap tier)
- Tower stock price: $200
- Tower has 10+ stock available

**Actions:**
1. Player A buys 3 Tower stock

**Expected Outcomes:**
- Player A pays $600 (3 x $200)
- Player A receives 3 Tower stock
- Maximum purchase in single turn

**Key Assertions:**
- Player A Tower stock increased by 3
- Player A money: $2,400
- 3 is the maximum per turn

---

### Scenario 6.3: Cannot Exceed 3 Per Turn

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $6,000
- Continental chain exists (2 tiles, Expensive tier)
- Continental stock price: $400

**Actions:**
1. Player A attempts to buy 4 Continental stock

**Expected Outcomes:**
- Purchase rejected
- Error: "Maximum 3 stocks per turn"

**Key Assertions:**
- Purchase rejected: true
- Player A Continental stock unchanged
- Player A money unchanged

---

### Scenario 6.4: Buy From Multiple Chains

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $2,000
- Active chains:
  - Luxor (2 tiles): $200/share
  - American (3 tiles): $400/share
  - Imperial (4 tiles): $600/share

**Actions:**
1. Player A buys 1 Luxor, 1 American, 1 Imperial

**Expected Outcomes:**
- Player A pays $1,200 total ($200 + $400 + $600)
- Player A receives 1 of each stock
- 3 total stocks purchased (at limit)

**Key Assertions:**
- Player A Luxor stock increased by 1
- Player A American stock increased by 1
- Player A Imperial stock increased by 1
- Player A money: $800
- Total stocks this turn: 3

---

### Scenario 6.5: Cannot Buy Inactive Chain Stock

**Initial State:**
- Player A is active player (in buy stock phase)
- Active chains: American, Tower
- Festival chain has never been founded (inactive)

**Actions:**
1. Player A attempts to buy Festival stock

**Expected Outcomes:**
- Purchase rejected
- Error: "Cannot buy stock in inactive chain"

**Key Assertions:**
- Purchase rejected: true
- Festival chain active: false
- Can only buy stock in chains on the board

---

### Scenario 6.6: Cannot Buy Defunct Chain Stock

**Initial State:**
- Player A is active player (in buy stock phase)
- Luxor was acquired by American earlier (Luxor is defunct)
- Luxor chain not currently on board

**Actions:**
1. Player A attempts to buy Luxor stock

**Expected Outcomes:**
- Purchase rejected
- Error: "Cannot buy stock in defunct chain"

**Key Assertions:**
- Purchase rejected: true
- Luxor chain active: false
- Defunct chains not purchasable

---

## Insufficient Resources

### Scenario 6.7: Insufficient Money for Purchase

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $500
- Continental chain exists (3 tiles)
- Continental stock price: $500

**Actions:**
1. Player A attempts to buy 2 Continental stock ($1,000 needed)

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
- American chain exists (3 tiles, Medium tier)
- American stock price: $400

**Actions:**
1. Player A buys 1 American stock ($400)

**Expected Outcomes:**
- Purchase succeeds
- Player A has $300 remaining
- Player A cannot afford second share

**Key Assertions:**
- Player A American stock increased by 1
- Player A money: $300
- Could only afford 1 share (not 2)

---

## Stock Pool Exhaustion

### Scenario 6.9: Stock Pool Exhausted

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $3,000
- Tower chain exists (4 tiles)
- Tower stock price: $400
- Tower stock pool: 0 (all 25 owned by players)

**Actions:**
1. Player A attempts to buy Tower stock

**Expected Outcomes:**
- Purchase rejected
- Error: "No Tower stock available"

**Key Assertions:**
- Purchase rejected: true
- Tower stock pool: 0
- All 25 Tower shares distributed among players

---

### Scenario 6.10: Partial Availability

**Initial State:**
- Player A is active player (in buy stock phase)
- Player A has $2,000
- Festival chain exists (3 tiles, Medium tier)
- Festival stock price: $400
- Festival stock pool: 2 shares remaining

**Actions:**
1. Player A attempts to buy 3 Festival stock

**Expected Outcomes:**
- Purchase limited to 2 shares (availability)
- Player A pays $800 (2 x $400)
- Player A receives 2 Festival stock

**Key Assertions:**
- Player A Festival stock increased by 2
- Player A money: $1,200
- Festival stock pool: 0
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
- Only active chain: Continental (2 tiles, $400/share)

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
- Luxor chain exists with varying sizes

**Actions:**
1. Verify Luxor (Cheap) prices at each size bracket

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
- Tower has same prices as Luxor

---

### Scenario 6.14: Price Verification - Medium Tier

**Initial State:**
- Player A is active player
- American chain exists with varying sizes

**Actions:**
1. Verify American (Medium) prices at each size bracket

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
- Festival and Worldwide have same prices

---

### Scenario 6.15: Price Verification - Expensive Tier

**Initial State:**
- Player A is active player
- Continental chain exists with varying sizes

**Actions:**
1. Verify Continental (Expensive) prices at each size bracket

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
- Imperial has same prices as Continental

---

## Founder's Bonus Interaction

### Scenario 6.16: Founder's Bonus Does Not Count Toward Limit

**Initial State:**
- Player A is active player
- Player A has $2,000
- Player A places tile that founds new chain
- Chain founded: Tower (Cheap tier, $200/share)

**Actions:**
1. Player A receives 1 free Tower stock (founder's bonus)
2. Player A buys 3 additional Tower stock ($600)

**Expected Outcomes:**
- Player A has 4 Tower stock total
- Founder's bonus (1) + purchased (3) = 4
- 3 purchased is within turn limit

**Key Assertions:**
- Player A Tower stock: 4
- Player A money: $1,400
- Founder's bonus is separate from purchase limit
- Can still buy 3 after receiving bonus

---

### Scenario 6.17: Buy Stock in Newly Founded Chain

**Initial State:**
- Player A is active player
- Player A just founded American chain (2 tiles)
- Player A received founder's bonus
- American stock price: $300

**Actions:**
1. Player A buys 2 more American stock

**Expected Outcomes:**
- Player A pays $600
- Player A has 3 American total (1 bonus + 2 bought)
- Can buy stock in chain just founded

**Key Assertions:**
- Player A American stock: 3
- Newly founded chain is immediately purchasable
- Same turn as founding
