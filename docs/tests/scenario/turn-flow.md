# Turn Flow Scenarios

Scenarios covering complete turn sequences in Acquire. A turn consists of four phases: Trade (optional), Place Tile (mandatory), Buy Stock (optional), Draw Tile (mandatory).

---

## Basic Turn Sequences

### Scenario 1.1: Basic Complete Turn - Orphan Tile

**Initial State:**
- 3-player game in progress
- Player A is the active player
- Player A has $6,000 and tile "5D" in hand
- Board has no tiles adjacent to 5D
- American chain exists (3 tiles), stock price $400
- American has stock available

**Actions:**
1. Skip trading phase (no trades proposed)
2. Player A places tile 5D
3. Player A buys 2 American stock ($800 total)
4. Player A draws a tile

**Expected Outcomes:**
- Tile 5D appears on board as orphan (no chain)
- Player A's money reduced by $800 (now $5,200)
- Player A has 2 American stock
- Player A's hand still has 6 tiles
- Turn advances to Player B

**Key Assertions:**
- Player A money: $5,200
- Player A American stock: 2
- Tile 5D on board, not part of any chain
- Current player: Player B
- Game phase: awaiting tile placement

---

### Scenario 1.2: Turn with Chain Founding

**Initial State:**
- 3-player game in progress
- Player A is the active player
- Player A has $6,000 and tile "6D" in hand
- Board has orphan tile at 6C (not part of any chain)
- No chains exist on board
- All 7 chains available for founding

**Actions:**
1. Skip trading phase
2. Player A places tile 6D (adjacent to 6C)
3. Game prompts for chain selection
4. Player A selects "Continental" (Expensive tier)
5. Player A receives founder's bonus stock
6. Player A buys 1 additional Continental stock ($400)
7. Player A draws a tile

**Expected Outcomes:**
- Continental chain founded with 2 tiles (6C, 6D)
- Player A receives 1 free Continental stock (founder's bonus)
- Player A pays $400 for additional stock
- Player A has 2 Continental stock total

**Key Assertions:**
- Continental chain size: 2 tiles
- Continental chain active: true
- Player A Continental stock: 2
- Player A money: $5,600
- Founder's bonus awarded (not charged)

---

### Scenario 1.3: Turn with Chain Expansion

**Initial State:**
- 3-player game in progress
- Player A is the active player
- Player A has $5,000 and tile "7D" in hand
- Tower chain exists: tiles at 6C, 6D (2 tiles, Cheap tier, $200/share)
- Tile 7D is adjacent to 6D

**Actions:**
1. Skip trading phase
2. Player A places tile 7D (adjacent to Tower chain)
3. Player A buys 3 Tower stock ($900 total at $300/share for 3 tiles)
4. Player A draws a tile

**Expected Outcomes:**
- Tower chain expands to 3 tiles
- Stock price increases from $200 to $300
- Player A pays $900 for 3 stocks

**Key Assertions:**
- Tower chain size: 3 tiles
- Tower stock price: $300
- Player A money: $4,100
- Player A Tower stock: 3

---

### Scenario 1.4: Turn with No Playable Tiles

**Initial State:**
- 4-player game in progress
- Player A is the active player
- All 7 chains exist on board
- Player A's entire hand contains tiles that would:
  - Found an 8th chain (connect two orphans), OR
  - Merge two safe chains
- Tile pool has tiles remaining

**Actions:**
1. Skip trading phase
2. Player A cannot legally place any tile
3. Game allows tile replacement
4. Player A returns unplayable tiles to pool
5. Player A draws replacement tiles
6. (Repeat until playable tile found or pool empty)
7. Player A buys stock (optional)
8. Turn ends (no tile drawn since replacement occurred)

**Expected Outcomes:**
- Unplayable tiles returned to pool
- Replacement tiles drawn
- If playable tile found, it may be placed
- If no playable tiles after pool exhausted, skip placement
- Stock purchase still allowed

**Key Assertions:**
- Player A hand size: 6 (or fewer if pool exhausted)
- All tiles in hand are playable (or pool is empty)
- Turn advances to next player

---

### Scenario 1.5: Full Round - All Players Take One Turn

**Initial State:**
- 3-player game (Players A, B, C)
- Player A is starting player
- Each player has $6,000
- Board has several orphan tiles
- No chains exist

**Actions:**
1. Player A: places tile, skips buy, draws tile
2. Player B: places tile (founds Luxor), buys 1 Luxor, draws tile
3. Player C: places tile, buys 2 Luxor, draws tile
4. Player A's turn begins again

**Expected Outcomes:**
- All three players complete one full turn
- Turn order is A -> B -> C -> A (clockwise)
- Luxor chain exists after Player B's turn
- Player B has 2 Luxor (1 founder + 1 bought)
- Player C has 2 Luxor

**Key Assertions:**
- Current player after round: Player A
- Luxor chain exists: true
- Luxor chain size: 2 tiles
- Player B Luxor stock: 2
- Player C Luxor stock: 2
- Player B money: $5,800 (spent $200)
- Player C money: $5,600 (spent $400)

---

## Phase Ordering

### Scenario 1.6: Cannot Trade After Tile Placement

**Initial State:**
- Player A is active player
- Player A has placed their tile (in buy stock phase)
- Player B has stock Player A wants

**Actions:**
1. Player A places tile
2. Player A attempts to initiate trade with Player B

**Expected Outcomes:**
- Trade is rejected/not allowed
- Error: "Trading phase has ended"

**Key Assertions:**
- Trade rejected: true
- Game phase: buy stock (not trade)
- No stock exchanged between players

---

### Scenario 1.7: Cannot Buy Stock Before Tile Placement

**Initial State:**
- Player A is active player
- Player A has not yet placed a tile
- American chain exists with stock available

**Actions:**
1. Player A attempts to buy American stock before placing tile

**Expected Outcomes:**
- Purchase is rejected/not allowed
- Error: "Must place tile before buying stock"

**Key Assertions:**
- Purchase rejected: true
- Game phase: tile placement (or trade)
- Player A American stock unchanged

---

### Scenario 1.8: Draw Tile Phase with Empty Pool

**Initial State:**
- 3-player game in late stage
- Tile pool is empty (all tiles distributed or on board)
- Player A has 5 tiles in hand (played one earlier this turn)
- Player A has completed tile placement and stock purchase

**Actions:**
1. Player A completes stock purchase phase
2. Turn ends (no tile to draw)

**Expected Outcomes:**
- Player A's hand remains at 5 tiles
- No error or warning (expected late-game state)
- Turn advances to next player

**Key Assertions:**
- Player A hand size: 5
- Tile pool size: 0
- Turn advances normally

---

## Merger During Turn

### Scenario 1.9: Turn with Merger Resolution

**Initial State:**
- Player A is active player with $5,000
- Player A has tile "6D" in hand
- Board state:
  - American chain: 5 tiles (includes 6C)
  - Tower chain: 3 tiles (includes 5D)
  - Tile 6D connects American and Tower
- Player A has 3 Tower stock
- Player B has 5 Tower stock (majority)
- Player C has 2 Tower stock

**Actions:**
1. Skip trading phase
2. Player A places tile 6D (triggers merger)
3. American (5 tiles) acquires Tower (3 tiles)
4. Bonuses paid:
   - Player B (majority): $3,000
   - Player C (minority): $1,500
5. Stock disposition (starting with Player A):
   - Player A: sells 3 Tower for $900
   - Player B: trades 4 Tower for 2 American, sells 1
   - Player C: holds 2 Tower
6. Player A buys stock
7. Player A draws tile

**Expected Outcomes:**
- Tower chain defunct
- American chain now has 9 tiles (5 + 3 + merger tile)
- Bonuses distributed correctly
- Stock disposed per player choice

**Key Assertions:**
- American chain size: 9 tiles
- Tower chain active: false
- Player B received $3,000 bonus
- Player C received $1,500 bonus
- Player A sold Tower stock for $300/share (3 tiles price)
- Turn completes normally after merger

---

## Trade Phase Scenarios

### Scenario 1.10: Multiple Trades in Single Trade Phase

**Initial State:**
- Player A is active player
- Player A has 5 American stock, $4,000
- Player B has 3 Continental stock
- Player C has 4 Tower stock

**Actions:**
1. Player A proposes trade to Player B: 2 American for 1 Continental
2. Player B accepts
3. Player A proposes trade to Player C: 1 American + $500 for 2 Tower
4. Player C accepts
5. Player A places tile

**Expected Outcomes:**
- Player A: 2 American, 1 Continental, 2 Tower, $3,500
- Player B: 2 American, 2 Continental
- Player C: 2 Tower, 1 American, $500 extra

**Key Assertions:**
- Multiple trades allowed in single trade phase
- Trade phase ends when tile placement begins
- All resource transfers completed atomically
