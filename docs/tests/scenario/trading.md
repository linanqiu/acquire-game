# Trading Scenarios

Scenarios covering player-to-player trading and merger 2:1 stock trades in Acquire.

---

## Player-to-Player Trading

### Scenario 2.1: Simple Stock-for-Stock Trade

**Initial State:**
- Player A is active player (in trade phase)
- Player A has 4 American stock
- Player B has 3 Continental stock

**Actions:**
1. Player A proposes trade: 2 American for 1 Continental
2. Player B accepts the trade

**Expected Outcomes:**
- Player A: 2 American, 1 Continental
- Player B: 2 American, 2 Continental
- Trade completes immediately

**Key Assertions:**
- Player A American stock: 2
- Player A Continental stock: 1
- Player B American stock: 2
- Player B Continental stock: 2

---

### Scenario 2.2: Stock-for-Money Trade

**Initial State:**
- Player A is active player (in trade phase)
- Player A has 5 Tower stock, $3,000
- Player B has 0 Tower stock, $6,000

**Actions:**
1. Player A proposes trade: 3 Tower stock for $1,200
2. Player B accepts the trade

**Expected Outcomes:**
- Player A: 2 Tower, $4,200
- Player B: 3 Tower, $4,800

**Key Assertions:**
- Player A Tower stock: 2
- Player A money: $4,200
- Player B Tower stock: 3
- Player B money: $4,800

---

### Scenario 2.3: Combined Stock and Money Trade

**Initial State:**
- Player A is active player
- Player A has 3 Luxor stock, 1 Imperial stock, $2,500
- Player B has 0 Luxor stock, 4 Imperial stock, $5,000

**Actions:**
1. Player A proposes: 2 Luxor + $500 for 2 Imperial
2. Player B accepts

**Expected Outcomes:**
- Player A: 1 Luxor, 3 Imperial, $2,000
- Player B: 2 Luxor, 2 Imperial, $5,500

**Key Assertions:**
- All resources transferred correctly
- Trade atomic (all-or-nothing)

---

### Scenario 2.4: Trade Rejection

**Initial State:**
- Player A is active player
- Player A has 4 Festival stock
- Player B has 2 Continental stock

**Actions:**
1. Player A proposes: 1 Festival for 1 Continental
2. Player B declines the trade

**Expected Outcomes:**
- No resources exchanged
- Player A may propose another trade or proceed to tile placement
- No penalty for rejection

**Key Assertions:**
- Player A Festival stock: 4 (unchanged)
- Player B Continental stock: 2 (unchanged)
- Game still in trade phase
- Player A can make another offer

---

### Scenario 2.5: Trade Cancellation by Proposer

**Initial State:**
- Player A is active player
- Player A has 3 American stock
- Player B has 2 Tower stock
- Trade proposed but not yet accepted

**Actions:**
1. Player A proposes: 1 American for 1 Tower
2. Before Player B responds, Player A cancels the trade

**Expected Outcomes:**
- Trade cancelled, no resources exchanged
- Player A may propose different trade
- No penalty for cancellation

**Key Assertions:**
- All holdings unchanged
- Trade phase continues
- New trade can be proposed

---

### Scenario 2.6: Invalid Trade - Insufficient Stock

**Initial State:**
- Player A is active player
- Player A has 2 Worldwide stock
- Player B has 1 American stock

**Actions:**
1. Player A proposes: 3 Worldwide for 1 American

**Expected Outcomes:**
- Trade rejected by system
- Error: "Insufficient Worldwide stock"
- Player A cannot complete this trade

**Key Assertions:**
- Trade rejected: true
- Error message indicates insufficient resources
- All holdings unchanged

---

### Scenario 2.7: Invalid Trade - Insufficient Money

**Initial State:**
- Player A is active player
- Player A has 1 Tower stock, $200
- Player B has 2 Imperial stock

**Actions:**
1. Player A proposes: 1 Tower + $500 for 1 Imperial

**Expected Outcomes:**
- Trade rejected by system
- Error: "Insufficient money"

**Key Assertions:**
- Trade rejected: true
- Player A money: $200 (insufficient for $500 offer)

---

### Scenario 2.8: Stale Trade - Resources Changed

**Initial State:**
- Multiplayer async game
- Player A proposes trade to Player B
- Between proposal and acceptance, Player B's resources change

**Actions:**
1. Player A proposes: 2 American for 1 Continental
2. Player B currently has 1 Continental
3. Before accepting, Player B sells their Continental (via merger or other mechanism)
4. Player B attempts to accept the original trade

**Expected Outcomes:**
- Trade fails validation
- Error: "Trade no longer valid - resources changed"
- Original proposer notified

**Key Assertions:**
- Trade not executed
- Both players' current holdings preserved
- Stale trade detected and rejected

---

### Scenario 2.9: Only Active Player Can Initiate Trades

**Initial State:**
- Player A is active player
- Player B wants to trade with Player C

**Actions:**
1. Player B attempts to propose trade to Player C

**Expected Outcomes:**
- Trade proposal rejected
- Error: "Only the active player may initiate trades"

**Key Assertions:**
- Trade rejected: true
- Only Player A can initiate trades this turn

---

### Scenario 2.10: Maximum Pending Trades

**Initial State:**
- Player A is active player
- Game has maximum pending trade limit (e.g., 5)
- Player A already has 5 pending trade offers

**Actions:**
1. Player A attempts to propose 6th trade

**Expected Outcomes:**
- Trade proposal rejected
- Error: "Maximum pending trades reached"

**Key Assertions:**
- New trade rejected
- Existing 5 trades still pending
- Player A must wait for response or cancel existing trade

---

## Merger 2:1 Stock Trades

### Scenario 2.11: Simple 2:1 Merger Trade

**Initial State:**
- Merger in progress: American acquired Tower
- Player A has 6 Tower stock (defunct)
- American has 10 stock available in pool

**Actions:**
1. Player A chooses to trade 6 Tower for 3 American

**Expected Outcomes:**
- Player A receives 3 American stock
- 6 Tower stock returned to pool
- Player A's Tower holdings now 0

**Key Assertions:**
- Player A American stock increased by 3
- Player A Tower stock: 0
- Tower stock returned to pool: 6
- Trade ratio exactly 2:1

---

### Scenario 2.12: Merger Trade with Odd Number of Shares

**Initial State:**
- Merger in progress: Continental acquired Luxor
- Player A has 7 Luxor stock (defunct)

**Actions:**
1. Player A chooses to trade 6 Luxor for 3 Continental
2. Player A sells remaining 1 Luxor for cash

**Expected Outcomes:**
- Player A receives 3 Continental
- Player A receives cash for 1 Luxor at merger price
- Only even numbers can be traded

**Key Assertions:**
- Player A Continental stock increased by 3
- Player A Luxor stock: 0
- Player A received Luxor sale price for 1 share
- Cannot trade single share (odd remainder)

---

### Scenario 2.13: Merger Trade Limited by Available Stock

**Initial State:**
- Merger in progress: Festival acquired Worldwide
- Player A has 10 Worldwide stock (defunct)
- Festival has only 3 stock available in pool

**Actions:**
1. Player A wants to trade all 10 Worldwide
2. Can only trade 6 Worldwide for 3 Festival (limited by availability)
3. Player A must sell or hold remaining 4 Worldwide

**Expected Outcomes:**
- Player A receives 3 Festival (maximum available)
- Player A chooses what to do with remaining 4 Worldwide
- Cannot trade more than 2x available survivor stock

**Key Assertions:**
- Player A Festival stock increased by 3
- Festival pool now empty
- Player A has 4 Worldwide to sell/hold
- Trade limited by survivor stock availability

---

### Scenario 2.14: All Sell - No Trading

**Initial State:**
- Merger in progress: American acquired Tower
- Player A has 8 Tower stock
- Tower had 4 tiles at merger (price $400)

**Actions:**
1. Player A chooses to sell all 8 Tower stock

**Expected Outcomes:**
- Player A receives $3,200 (8 x $400)
- All Tower stock returned to pool
- No American stock acquired

**Key Assertions:**
- Player A money increased by $3,200
- Player A Tower stock: 0
- Sale price based on defunct chain's size at merger

---

### Scenario 2.15: All Hold - No Selling or Trading

**Initial State:**
- Merger in progress: Imperial acquired Festival
- Player A has 5 Festival stock
- Player A expects Festival to be re-founded later

**Actions:**
1. Player A chooses to hold all 5 Festival stock

**Expected Outcomes:**
- Player A retains 5 Festival stock
- Stock currently has no value (chain defunct)
- Stock will become active if Festival re-founded

**Key Assertions:**
- Player A Festival stock: 5
- Festival chain status: defunct
- No money received
- No Imperial stock received

---

### Scenario 2.16: Mixed Disposition - Trade, Sell, and Hold

**Initial State:**
- Merger in progress: Continental acquired Luxor
- Player A has 12 Luxor stock
- Continental has 5 stock available
- Luxor had 3 tiles at merger (price $200)

**Actions:**
1. Player A trades 8 Luxor for 4 Continental
2. Player A sells 2 Luxor for $400
3. Player A holds remaining 2 Luxor

**Expected Outcomes:**
- Player A receives 4 Continental stock
- Player A receives $400 cash
- Player A retains 2 Luxor stock (defunct)

**Key Assertions:**
- Player A Continental stock increased by 4
- Player A money increased by $400
- Player A Luxor stock: 2 (held)
- 10 Luxor returned to pool (8 traded + 2 sold)

---

### Scenario 2.17: Stock Disposition Order - Mergemaker First

**Initial State:**
- Player A (mergemaker) triggers merger: American acquires Tower
- Tower stockholders:
  - Player A: 4 shares
  - Player B: 6 shares
  - Player C: 2 shares
- American has 5 stock available
- Turn order: A, B, C

**Actions:**
1. Player A (mergemaker) disposes first: trades 4 Tower for 2 American
2. Player B disposes second: trades 6 Tower for 3 American (pool now empty)
3. Player C disposes third: must sell or hold (no American available)

**Expected Outcomes:**
- Player A gets first choice of American stock
- Player B gets remaining American stock
- Player C forced to sell or hold

**Key Assertions:**
- Disposition order: mergemaker, then clockwise
- American pool exhausted after Player B
- Player C cannot trade (no stock available)

---

### Scenario 2.18: Zero Defunct Stock - No Disposition Required

**Initial State:**
- Merger in progress: Festival acquires Worldwide
- Player A has 0 Worldwide stock
- Player A has 3 Festival stock

**Actions:**
1. Player A's turn for stock disposition
2. Player A has nothing to dispose

**Expected Outcomes:**
- Player A skipped (no defunct stock)
- Proceeds to next player with defunct stock

**Key Assertions:**
- No action required from Player A
- No error or warning
- Disposition continues to next player
