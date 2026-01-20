# Edge Cases Scenarios

Scenarios covering boundary conditions, error handling, and unusual game states in Acquire.

---

## Player Count Boundaries

### Scenario 8.1: Minimum Players (3)

**Initial State:**
- Game creation with 3 players

**Actions:**
1. Create game with Players A, B, C
2. Start game

**Expected Outcomes:**
- Game starts successfully
- Turn order: A -> B -> C -> A
- All rules apply normally

**Key Assertions:**
- Player count: 3
- Minimum valid player count
- Game functions correctly

---

### Scenario 8.2: Maximum Players (6)

**Initial State:**
- Game creation with 6 players

**Actions:**
1. Create game with Players A, B, C, D, E, F
2. Start game

**Expected Outcomes:**
- Game starts successfully
- Turn order: A -> B -> C -> D -> E -> F -> A
- Stock competition increases

**Key Assertions:**
- Player count: 6
- Maximum valid player count
- All players can participate

---

### Scenario 8.3: Invalid Player Count - Too Few (2)

**Initial State:**
- Attempt to create game with 2 players

**Actions:**
1. Create game with Players A, B only

**Expected Outcomes:**
- Game creation rejected
- Error: "Minimum 3 players required"

**Key Assertions:**
- Game not created
- 2 players is invalid

---

### Scenario 8.4: Invalid Player Count - Too Many (7)

**Initial State:**
- Attempt to create game with 7 players

**Actions:**
1. Create game with 7 players

**Expected Outcomes:**
- Game creation rejected
- Error: "Maximum 6 players allowed"

**Key Assertions:**
- Game not created
- 7 players is invalid

---

## Starting Money Verification

### Scenario 8.5: Starting Money Correct ($6,000)

**Initial State:**
- New game with 4 players

**Actions:**
1. Game starts
2. Verify each player's starting money

**Expected Outcomes:**
- Player A: $6,000
- Player B: $6,000
- Player C: $6,000
- Player D: $6,000

**Key Assertions:**
- All players start with exactly $6,000
- No variation by player position

---

## Tile Bag Correctness

### Scenario 8.6: Tile Bag Contains 108 Tiles

**Initial State:**
- New game starting

**Actions:**
1. Count tiles before distribution
2. Distribute tiles to players
3. Place initial turn-order tiles
4. Verify remaining pool

**Expected Outcomes:**
- Total tiles: 108
- Tiles per player hand: 6
- Turn-order tiles on board: (number of players)
- Remaining in pool: 108 - (6 × players) - players

**Key Assertions:**
- 4-player game: 108 - 24 - 4 = 80 in pool
- 3-player game: 108 - 18 - 3 = 87 in pool
- 6-player game: 108 - 36 - 6 = 66 in pool

---

### Scenario 8.7: All Tile Coordinates Valid

**Initial State:**
- Full tile set

**Actions:**
1. Verify all tiles have valid coordinates
2. Check columns 1-12, rows A-I

**Expected Outcomes:**
- Tiles range from 1A to 12I
- 12 columns × 9 rows = 108 unique tiles
- No duplicates, no invalid coordinates

**Key Assertions:**
- Every coordinate from 1A to 12I exists exactly once
- No tile like "13A" or "1J"

---

## Hand Size Limits

### Scenario 8.8: Hand Size Always 6 (Normal Play)

**Initial State:**
- Mid-game, tile pool has tiles
- Player A has 6 tiles in hand

**Actions:**
1. Player A places 1 tile (hand now 5)
2. Player A draws 1 tile (hand now 6)

**Expected Outcomes:**
- Hand size maintained at 6
- Always draw after placing

**Key Assertions:**
- Hand size after turn: 6
- Replenishment automatic

---

### Scenario 8.9: Hand Size Decreases When Pool Empty

**Initial State:**
- Late game, tile pool empty
- Player A has 4 tiles remaining

**Actions:**
1. Player A places 1 tile (hand now 3)
2. No tile to draw (pool empty)

**Expected Outcomes:**
- Player A hand size: 3
- No error, expected late-game state
- Game continues

**Key Assertions:**
- Hand size: 3 (less than 6)
- Pool empty: true
- Game continues normally

---

## Stock Limits

### Scenario 8.10: Stock Limit Per Chain (25)

**Initial State:**
- American chain active
- Stock distribution:
  - Player A: 10 shares
  - Player B: 8 shares
  - Player C: 5 shares
  - Pool: 2 shares

**Actions:**
1. Player D tries to buy 3 American shares

**Expected Outcomes:**
- Only 2 available
- Player D can buy at most 2

**Key Assertions:**
- Total American stock: 25
- Pool has exactly 2 remaining
- Cannot exceed 25 total

---

## Turn Validation

### Scenario 8.11: Wrong Player's Turn

**Initial State:**
- Current player: Player A
- Player B attempts action

**Actions:**
1. Player B tries to place a tile

**Expected Outcomes:**
- Action rejected
- Error: "Not your turn"

**Key Assertions:**
- Current player: Player A
- Player B action rejected
- Turn order enforced

---

### Scenario 8.12: Invalid Tile Coordinates

**Initial State:**
- Player A's turn
- Player A attempts to place tile at invalid coordinate

**Actions:**
1. Player A tries to place at "13A" (invalid column)
2. Player A tries to place at "1J" (invalid row)

**Expected Outcomes:**
- Both placements rejected
- Error: "Invalid tile coordinate"

**Key Assertions:**
- Valid columns: 1-12
- Valid rows: A-I
- Out of range rejected

---

### Scenario 8.13: Duplicate Tile Placement

**Initial State:**
- Tile 6D already on board
- Player A has (somehow) tile marked 6D

**Actions:**
1. Player A tries to place tile 6D

**Expected Outcomes:**
- Placement rejected
- Error: "Space already occupied" or "Invalid tile"

**Key Assertions:**
- Cannot place on occupied space
- Each tile placed exactly once

---

### Scenario 8.14: Phase Validation - Buy Before Place

**Initial State:**
- Player A's turn, trade phase or tile phase
- Tile not yet placed

**Actions:**
1. Player A tries to buy stock

**Expected Outcomes:**
- Purchase rejected
- Error: "Must place tile first"

**Key Assertions:**
- Phase order enforced
- Cannot skip tile placement to buy

---

## Reproducibility

### Scenario 8.15: Reproducible Games with Seed

**Initial State:**
- Create two games with same random seed
- Same player count and order

**Actions:**
1. Start Game A with seed 12345
2. Start Game B with seed 12345
3. Compare initial tile distributions

**Expected Outcomes:**
- Both games have identical initial state
- Same tiles dealt to same positions
- Same turn-order tile placements

**Key Assertions:**
- Deterministic with seed
- Useful for testing and replay
- State reproducible

---

## Unplayable Tile Handling

### Scenario 8.16: Permanently Unplayable Tiles Replaced

**Initial State:**
- 7 chains active on board
- Player A has tile that would:
  - Connect two orphans (would create 8th chain)
- Tile pool has tiles remaining

**Actions:**
1. Player A identifies unplayable tile
2. At end of turn, Player A returns tile to pool
3. Player A draws replacement

**Expected Outcomes:**
- Unplayable tile returned to pool (shuffled in)
- New tile drawn
- Process repeats if new tile also unplayable

**Key Assertions:**
- Replacement happens at turn end
- Pool must have tiles for replacement
- Eventually finds playable tile or pool empties

---

### Scenario 8.17: All Hand Tiles Unplayable

**Initial State:**
- All 7 chains active, some are safe
- Player A's 6 tiles all would either:
  - Create 8th chain, or
  - Merge two safe chains
- Tile pool empty

**Actions:**
1. Player A cannot place any tile
2. No replacement possible (pool empty)

**Expected Outcomes:**
- Player A skips tile placement
- Player A may still buy stock
- Turn advances

**Key Assertions:**
- Tile placement skipped
- Stock purchase allowed
- Game continues

---

## Empty Tile Bag

### Scenario 8.18: Tile Bag Empties Mid-Game

**Initial State:**
- Tile pool: 1 tile remaining
- Player A places tile
- Player A would normally draw

**Actions:**
1. Player A places tile
2. Player A draws last tile from pool
3. Pool now empty

**Expected Outcomes:**
- Player A successfully draws
- Pool becomes empty
- Next player will not draw (pool empty)

**Key Assertions:**
- Last tile drawn successfully
- Pool size: 0
- No error when pool empties

---

## Bonus Rounding

### Scenario 8.19: Bonus Rounding to Nearest $100

**Initial State:**
- Merger with tie that doesn't divide evenly
- Example: 3-way tie for majority
- Combined bonus: $7,000

**Actions:**
1. Calculate split: $7,000 / 3 = $2,333.33

**Expected Outcomes:**
- Each player receives $2,400 (rounded up to $100)
- Or implementation may use floor: $2,300 each
- Verify consistent rounding behavior

**Key Assertions:**
- No fractional dollars
- Rounding to nearest $100
- Consistent across all bonus calculations

---

## Game State Serialization

### Scenario 8.20: Game State Can Be Cloned

**Initial State:**
- Mid-game with complex state:
  - Multiple chains
  - Various stock holdings
  - Pending merger

**Actions:**
1. Serialize game state
2. Deserialize to new game object
3. Compare states

**Expected Outcomes:**
- All state preserved:
  - Board tiles and chains
  - Player money and stock
  - Current phase and player
  - Tile hands and pool

**Key Assertions:**
- Serialization round-trips correctly
- No data loss
- Game can resume from serialized state

---

### Scenario 8.21: Game State Cloning for AI

**Initial State:**
- Active game
- AI player needs to simulate moves

**Actions:**
1. Clone current game state
2. AI makes hypothetical moves on clone
3. Original game unaffected

**Expected Outcomes:**
- Clone is independent copy
- Mutations to clone don't affect original
- Original game continues normally

**Key Assertions:**
- Deep copy (not shallow)
- Original state immutable
- Clone fully functional

---

## Concurrent Access

### Scenario 8.22: Simultaneous Action Attempts

**Initial State:**
- Multiplayer game
- Player A's turn
- Player A and Player B both submit actions

**Actions:**
1. Player A submits tile placement
2. Player B submits tile placement (nearly simultaneous)

**Expected Outcomes:**
- Player A's action processed (it's their turn)
- Player B's action rejected
- No race condition or corruption

**Key Assertions:**
- Turn order enforced under concurrency
- Only valid player's action succeeds
- Game state consistent

---

## Boundary Tile Positions

### Scenario 8.23: Corner Tile Adjacency

**Initial State:**
- Tile at 1A (top-left corner)
- Only 2 adjacent spaces: 2A, 1B

**Actions:**
1. Place tiles at 2A and 1B
2. Verify chain formation

**Expected Outcomes:**
- Corner tile has only 2 neighbors (not 4)
- Chain forms correctly with adjacent tiles
- Diagonal tiles (2B) not considered adjacent

**Key Assertions:**
- 1A adjacent to: 2A, 1B only
- 12I adjacent to: 11I, 12H only
- Corner tiles have 2 adjacencies

---

### Scenario 8.24: Edge Tile Adjacency

**Initial State:**
- Tile at 6A (top edge, middle)
- Only 3 adjacent spaces: 5A, 7A, 6B

**Actions:**
1. Verify adjacency calculation

**Expected Outcomes:**
- Edge tiles have 3 neighbors (not 4)
- No "wrap around" to other edge

**Key Assertions:**
- 6A adjacent to: 5A, 7A, 6B only
- 6I adjacent to: 5I, 7I, 6H only
- Edge tiles have 3 adjacencies
