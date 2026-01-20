# End Game Scenarios

Scenarios covering end game conditions, declaration, final scoring, and winner determination in Acquire.

---

## End Game Conditions

### Scenario 7.1: Chain Reaches 41 Tiles

**Initial State:**
- Continental chain: 40 tiles
- Player A is active player
- Player A has tile that will expand Continental

**Actions:**
1. Player A places tile, Continental grows to 41 tiles
2. End game condition met
3. Player A may declare game over

**Expected Outcomes:**
- Continental size: 41 tiles
- End game condition: true (41+ tiles)
- Player A has option to declare game over

**Key Assertions:**
- End condition met: chain >= 41 tiles
- Declaration is now possible
- Game does not auto-end (player must declare)

---

### Scenario 7.2: All Chains Safe (11+ Tiles Each)

**Initial State:**
- Three chains on board:
  - American: 15 tiles (safe)
  - Continental: 12 tiles (safe)
  - Tower: 10 tiles (not safe)
- Player A expands Tower to 11 tiles

**Actions:**
1. Player A places tile, Tower grows to 11 tiles
2. All chains now safe
3. End game condition met

**Expected Outcomes:**
- Tower size: 11 tiles (now safe)
- All active chains are safe
- End game condition: true

**Key Assertions:**
- American safe: true
- Continental safe: true
- Tower safe: true
- All chains safe condition met

---

### Scenario 7.3: Cannot End When Unsafe Chain Exists

**Initial State:**
- Three chains on board:
  - American: 20 tiles (safe)
  - Imperial: 15 tiles (safe)
  - Luxor: 8 tiles (NOT safe)
- No chain has 41+ tiles

**Actions:**
1. Player A attempts to declare game over

**Expected Outcomes:**
- Declaration rejected
- Error: "End conditions not met"
- Luxor is unsafe, blocking "all safe" condition
- No chain has 41+ tiles

**Key Assertions:**
- End condition met: false
- Luxor safe: false
- Game continues

---

## End Game Declaration

### Scenario 7.4: End Game Declaration is Optional

**Initial State:**
- Continental chain: 42 tiles (end condition met)
- Player A is active player
- Player A is behind in score, wants to continue

**Actions:**
1. Player A's turn begins
2. End condition is met
3. Player A chooses NOT to declare game over
4. Player A places tile, buys stock, draws tile

**Expected Outcomes:**
- Game continues normally
- Player A completes full turn
- Other players will have option to declare on their turns

**Key Assertions:**
- Declaration is optional
- Player may continue playing
- Next player can declare if conditions still met

---

### Scenario 7.5: Declaration Ends Game Immediately

**Initial State:**
- All chains safe (end condition met)
- Player A is active player
- Player A declares game over

**Actions:**
1. Player A declares "Game Over"

**Expected Outcomes:**
- Game ends immediately
- Player A does not place tile, buy stock, or draw
- Proceed directly to final scoring

**Key Assertions:**
- Game state: ended
- No further actions this turn
- Final scoring begins

---

### Scenario 7.6: Cannot End Game from Lobby

**Initial State:**
- Game has not started
- Players still in lobby/setup phase

**Actions:**
1. Attempt to declare game over

**Expected Outcomes:**
- Declaration rejected
- Error: "Game has not started"

**Key Assertions:**
- Game must be in progress to end
- Cannot skip directly to scoring

---

### Scenario 7.7: Cannot Act After Game Over

**Initial State:**
- Game has been declared over
- Final scoring in progress or completed

**Actions:**
1. Player attempts to place a tile
2. Player attempts to buy stock
3. Player attempts to trade

**Expected Outcomes:**
- All actions rejected
- Error: "Game has ended"

**Key Assertions:**
- No game actions after declaration
- Only scoring/viewing allowed

---

## Final Bonuses Calculation

### Scenario 7.8: Final Bonuses for Single Chain

**Initial State:**
- Game declared over
- Only one chain exists: American (18 tiles, Medium tier)
- Stock holdings:
  - Player A: 8 shares (majority)
  - Player B: 5 shares (minority)
  - Player C: 2 shares
- American 11-20 tile Medium bonus: Majority $8,000, Minority $4,000

**Actions:**
1. Calculate final bonuses for American

**Expected Outcomes:**
- Player A receives $8,000 (majority)
- Player B receives $4,000 (minority)
- Player C receives $0 (no bonus)

**Key Assertions:**
- Final bonuses same as merger bonuses
- Based on chain size at game end

---

### Scenario 7.9: Final Bonuses for Multiple Chains

**Initial State:**
- Game declared over
- Three chains exist:
  - American (15 tiles): Player A majority, Player B minority
  - Continental (20 tiles): Player B majority, Player C minority
  - Tower (12 tiles): Player C majority, Player A minority

**Actions:**
1. Calculate bonuses for each chain

**Expected Outcomes:**
- American bonuses paid
- Continental bonuses paid
- Tower bonuses paid
- Each chain calculated independently

**Key Assertions:**
- All active chains pay bonuses
- Same stockholder can receive multiple bonuses
- Total bonuses = sum of all chain bonuses

---

### Scenario 7.10: Inactive Chain Stock Worth Zero

**Initial State:**
- Game declared over
- Player A holds 5 Luxor stock
- Luxor was acquired earlier and never re-founded (defunct)
- Luxor chain not on board

**Actions:**
1. Final scoring

**Expected Outcomes:**
- Player A's 5 Luxor shares worth $0
- No bonus from Luxor (not active)
- Defunct stock has no value at game end

**Key Assertions:**
- Luxor stock value: $0
- No Luxor bonuses paid
- Player A loses value of held defunct stock

---

## Winner Determination

### Scenario 7.11: Clear Winner - Highest Total Money

**Initial State:**
- Game ended, bonuses paid, stock sold
- Final totals:
  - Player A: $32,000
  - Player B: $28,500
  - Player C: $25,200

**Actions:**
1. Determine winner

**Expected Outcomes:**
- Player A wins with $32,000
- Clear majority, no tie

**Key Assertions:**
- Winner: Player A
- Winning amount: $32,000
- Single winner declared

---

### Scenario 7.12: Tie for Winner

**Initial State:**
- Game ended, bonuses paid, stock sold
- Final totals:
  - Player A: $30,000
  - Player B: $30,000
  - Player C: $22,000

**Actions:**
1. Determine winner

**Expected Outcomes:**
- Player A and Player B tie
- Both declared winners (official rules)
- No tiebreaker in standard rules

**Key Assertions:**
- Winners: Player A and Player B
- Tie amount: $30,000
- Multiple winners possible

---

### Scenario 7.13: Final Stock Sale at Current Prices

**Initial State:**
- Game declared over
- Player A has:
  - 5 American stock (chain is 18 tiles, Medium tier)
  - 3 Continental stock (chain is 25 tiles, Expensive tier)
- American price (11-20 tiles, Medium): $800
- Continental price (21-30 tiles, Expensive): $1,000

**Actions:**
1. Sell all stock at current prices

**Expected Outcomes:**
- American: 5 x $800 = $4,000
- Continental: 3 x $1,000 = $3,000
- Total from stock: $7,000

**Key Assertions:**
- Stock sold at final chain size prices
- Each chain's price determined by its tile count
- All stock converted to cash

---

## Complete End Game Sequence

### Scenario 7.14: Full End Game Walkthrough

**Initial State:**
- Player A declares game over (Continental has 41 tiles)
- Active chains:
  - Continental: 41 tiles (Expensive)
  - American: 15 tiles (Medium)
- Stock holdings:
  - Player A: 6 Continental, 4 American, $3,000 cash
  - Player B: 3 Continental, 7 American, $2,500 cash
  - Player C: 4 Continental, 2 American, $4,000 cash

**Actions:**
1. Pay Continental bonuses:
   - Majority (Player A, 6 shares): $12,000
   - Minority (Player C, 4 shares): $6,000
2. Pay American bonuses:
   - Majority (Player B, 7 shares): $8,000
   - Minority (Player A, 4 shares): $4,000
3. Sell all stock:
   - Continental (41 tiles): $1,200/share
   - American (15 tiles): $800/share

**Expected Outcomes:**
- Player A: $3,000 + $12,000 + $4,000 + (6×$1,200) + (4×$800) = $29,400
- Player B: $2,500 + $0 + $8,000 + (3×$1,200) + (7×$800) = $19,700
- Player C: $4,000 + $6,000 + $0 + (4×$1,200) + (2×$800) = $16,400

**Key Assertions:**
- Winner: Player A with $29,400
- All bonuses calculated correctly
- All stock sold at correct prices
- Final total = cash + bonuses + stock value

---

### Scenario 7.15: End Game with No Chains (Edge Case)

**Initial State:**
- Extremely rare: all chains have been acquired and none re-founded
- No active chains on board
- Players have cash only (and possibly defunct stock)

**Actions:**
1. End conditions cannot be met normally
2. (This scenario tests robustness)

**Expected Outcomes:**
- Game may continue until chains founded
- Or special handling if tile pool exhausted
- No bonuses to pay (no active chains)

**Key Assertions:**
- Edge case handling
- Winner determined by cash on hand
- Defunct stock worth $0

---

### Scenario 7.16: End Game Declaration Timing

**Initial State:**
- Player A's turn
- At start of turn, all chains are safe
- Player A must decide whether to declare

**Actions:**
1. Player A observes board state
2. Player A decides to declare OR continue
3. If continuing, normal turn proceeds

**Expected Outcomes:**
- Declaration happens at START of turn
- If not declared, full turn occurs
- Cannot declare mid-turn or after actions

**Key Assertions:**
- Declaration window: beginning of turn only
- Once tile placed, cannot declare until next turn
- Other players get chance to declare on their turns
