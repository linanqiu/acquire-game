> **Historical.** This catalogue described the retired browser scenario suite. Current coverage is by surface: [surface-coverage.md](../surface-coverage.md); what happened to each old test: [legacy-suite-retirement.md](../legacy-suite-retirement.md).

# Trading Scenarios

Scenarios covering player-to-player trading and merger 2:1 stock trades in Buyout.

---

## Player-to-Player Trading

### Scenario 2.1: Simple Stock-for-Stock Trade

**Initial State:**
- Player A is active player (in trade phase)
- Player A has 4 Halcyon stock
- Player B has 3 Aurelia stock

**Actions:**
1. Player A proposes trade: 2 Halcyon for 1 Aurelia
2. Player B accepts the trade

**Expected Outcomes:**
- Player A: 2 Halcyon, 1 Aurelia
- Player B: 2 Halcyon, 2 Aurelia
- Trade completes immediately

**Key Assertions:**
- Player A Halcyon stock: 2
- Player A Aurelia stock: 1
- Player B Halcyon stock: 2
- Player B Aurelia stock: 2

---

### Scenario 2.2: Stock-for-Money Trade

**Initial State:**
- Player A is active player (in trade phase)
- Player A has 5 Marlowe stock, $3,000
- Player B has 0 Marlowe stock, $6,000

**Actions:**
1. Player A proposes trade: 3 Marlowe stock for $1,200
2. Player B accepts the trade

**Expected Outcomes:**
- Player A: 2 Marlowe, $4,200
- Player B: 3 Marlowe, $4,800

**Key Assertions:**
- Player A Marlowe stock: 2
- Player A money: $4,200
- Player B Marlowe stock: 3
- Player B money: $4,800

---

### Scenario 2.3: Combined Stock and Money Trade

**Initial State:**
- Player A is active player
- Player A has 3 Sandpiper stock, 1 Obsidian stock, $2,500
- Player B has 0 Sandpiper stock, 4 Obsidian stock, $5,000

**Actions:**
1. Player A proposes: 2 Sandpiper + $500 for 2 Obsidian
2. Player B accepts

**Expected Outcomes:**
- Player A: 1 Sandpiper, 3 Obsidian, $2,000
- Player B: 2 Sandpiper, 2 Obsidian, $5,500

**Key Assertions:**
- All resources transferred correctly
- Trade atomic (all-or-nothing)

---

### Scenario 2.4: Trade Rejection

**Initial State:**
- Player A is active player
- Player A has 4 Juniper stock
- Player B has 2 Aurelia stock

**Actions:**
1. Player A proposes: 1 Juniper for 1 Aurelia
2. Player B declines the trade

**Expected Outcomes:**
- No resources exchanged
- Player A may propose another trade or proceed to tile placement
- No penalty for rejection

**Key Assertions:**
- Player A Juniper stock: 4 (unchanged)
- Player B Aurelia stock: 2 (unchanged)
- Game still in trade phase
- Player A can make another offer

---

### Scenario 2.5: Trade Cancellation by Proposer

**Initial State:**
- Player A is active player
- Player A has 3 Halcyon stock
- Player B has 2 Marlowe stock
- Trade proposed but not yet accepted

**Actions:**
1. Player A proposes: 1 Halcyon for 1 Marlowe
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
- Player A has 2 Meridian stock
- Player B has 1 Halcyon stock

**Actions:**
1. Player A proposes: 3 Meridian for 1 Halcyon

**Expected Outcomes:**
- Trade rejected by system
- Error: "Insufficient Meridian stock"
- Player A cannot complete this trade

**Key Assertions:**
- Trade rejected: true
- Error message indicates insufficient resources
- All holdings unchanged

---

### Scenario 2.7: Invalid Trade - Insufficient Money

**Initial State:**
- Player A is active player
- Player A has 1 Marlowe stock, $200
- Player B has 2 Obsidian stock

**Actions:**
1. Player A proposes: 1 Marlowe + $500 for 1 Obsidian

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
1. Player A proposes: 2 Halcyon for 1 Aurelia
2. Player B currently has 1 Aurelia
3. Before accepting, Player B sells their Aurelia (via merger or other mechanism)
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
- Merger in progress: Halcyon acquired Marlowe
- Player A has 6 Marlowe stock (defunct)
- Halcyon has 10 stock available in pool

**Actions:**
1. Player A chooses to trade 6 Marlowe for 3 Halcyon

**Expected Outcomes:**
- Player A receives 3 Halcyon stock
- 6 Marlowe stock returned to pool
- Player A's Marlowe holdings now 0

**Key Assertions:**
- Player A Halcyon stock increased by 3
- Player A Marlowe stock: 0
- Marlowe stock returned to pool: 6
- Trade ratio exactly 2:1

---

### Scenario 2.12: Merger Trade with Odd Number of Shares

**Initial State:**
- Merger in progress: Aurelia acquired Sandpiper
- Player A has 7 Sandpiper stock (defunct)

**Actions:**
1. Player A chooses to trade 6 Sandpiper for 3 Aurelia
2. Player A sells remaining 1 Sandpiper for cash

**Expected Outcomes:**
- Player A receives 3 Aurelia
- Player A receives cash for 1 Sandpiper at merger price
- Only even numbers can be traded

**Key Assertions:**
- Player A Aurelia stock increased by 3
- Player A Sandpiper stock: 0
- Player A received Sandpiper sale price for 1 share
- Cannot trade single share (odd remainder)

---

### Scenario 2.13: Merger Trade Limited by Available Stock

**Initial State:**
- Merger in progress: Juniper acquired Meridian
- Player A has 10 Meridian stock (defunct)
- Juniper has only 3 stock available in pool

**Actions:**
1. Player A wants to trade all 10 Meridian
2. Can only trade 6 Meridian for 3 Juniper (limited by availability)
3. Player A must sell or hold remaining 4 Meridian

**Expected Outcomes:**
- Player A receives 3 Juniper (maximum available)
- Player A chooses what to do with remaining 4 Meridian
- Cannot trade more than 2x available survivor stock

**Key Assertions:**
- Player A Juniper stock increased by 3
- Juniper pool now empty
- Player A has 4 Meridian to sell/hold
- Trade limited by survivor stock availability

---

### Scenario 2.14: All Sell - No Trading

**Initial State:**
- Merger in progress: Halcyon acquired Marlowe
- Player A has 8 Marlowe stock
- Marlowe had 4 tiles at merger (price $400)

**Actions:**
1. Player A chooses to sell all 8 Marlowe stock

**Expected Outcomes:**
- Player A receives $3,200 (8 x $400)
- All Marlowe stock returned to pool
- No Halcyon stock acquired

**Key Assertions:**
- Player A money increased by $3,200
- Player A Marlowe stock: 0
- Sale price based on defunct chain's size at merger

---

### Scenario 2.15: All Hold - No Selling or Trading

**Initial State:**
- Merger in progress: Obsidian acquired Juniper
- Player A has 5 Juniper stock
- Player A expects Juniper to be re-founded later

**Actions:**
1. Player A chooses to hold all 5 Juniper stock

**Expected Outcomes:**
- Player A retains 5 Juniper stock
- Stock currently has no value (chain defunct)
- Stock will become active if Juniper re-founded

**Key Assertions:**
- Player A Juniper stock: 5
- Juniper chain status: defunct
- No money received
- No Obsidian stock received

---

### Scenario 2.16: Mixed Disposition - Trade, Sell, and Hold

**Initial State:**
- Merger in progress: Aurelia acquired Sandpiper
- Player A has 12 Sandpiper stock
- Aurelia has 5 stock available
- Sandpiper had 3 tiles at merger (price $200)

**Actions:**
1. Player A trades 8 Sandpiper for 4 Aurelia
2. Player A sells 2 Sandpiper for $400
3. Player A holds remaining 2 Sandpiper

**Expected Outcomes:**
- Player A receives 4 Aurelia stock
- Player A receives $400 cash
- Player A retains 2 Sandpiper stock (defunct)

**Key Assertions:**
- Player A Aurelia stock increased by 4
- Player A money increased by $400
- Player A Sandpiper stock: 2 (held)
- 10 Sandpiper returned to pool (8 traded + 2 sold)

---

### Scenario 2.17: Stock Disposition Order - Mergemaker First

**Initial State:**
- Player A (mergemaker) triggers merger: Halcyon acquires Marlowe
- Marlowe stockholders:
  - Player A: 4 shares
  - Player B: 6 shares
  - Player C: 2 shares
- Halcyon has 5 stock available
- Turn order: A, B, C

**Actions:**
1. Player A (mergemaker) disposes first: trades 4 Marlowe for 2 Halcyon
2. Player B disposes second: trades 6 Marlowe for 3 Halcyon (pool now empty)
3. Player C disposes third: must sell or hold (no Halcyon available)

**Expected Outcomes:**
- Player A gets first choice of Halcyon stock
- Player B gets remaining Halcyon stock
- Player C forced to sell or hold

**Key Assertions:**
- Disposition order: mergemaker, then clockwise
- Halcyon pool exhausted after Player B
- Player C cannot trade (no stock available)

---

### Scenario 2.18: Zero Defunct Stock - No Disposition Required

**Initial State:**
- Merger in progress: Juniper acquires Meridian
- Player A has 0 Meridian stock
- Player A has 3 Juniper stock

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
