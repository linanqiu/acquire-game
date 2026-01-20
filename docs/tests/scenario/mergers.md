# Merger Scenarios

Scenarios covering merger resolution in Acquire, including survivor determination, bonuses, stock disposition, and multi-chain mergers.

---

## Determining Survivor

### Scenario 5.1: Simple Two-Chain Merger (Larger Survives)

**Initial State:**
- American chain: 5 tiles
- Tower chain: 3 tiles
- Player A has tile that connects American and Tower

**Actions:**
1. Player A places merger tile

**Expected Outcomes:**
- American (5 tiles) survives
- Tower (3 tiles) becomes defunct
- Merged chain has 9 tiles (5 + 3 + merger tile)

**Key Assertions:**
- American chain active: true
- American chain size: 9 tiles
- Tower chain active: false
- Larger chain always survives

---

### Scenario 5.2: Tied Merger (Mergemaker Chooses Survivor)

**Initial State:**
- Festival chain: 4 tiles
- Worldwide chain: 4 tiles
- Player A (mergemaker) has tile that connects both chains

**Actions:**
1. Player A places merger tile
2. System prompts Player A to choose survivor
3. Player A selects "Worldwide"

**Expected Outcomes:**
- Worldwide survives (mergemaker's choice)
- Festival becomes defunct
- Both chains were equal size, so choice required

**Key Assertions:**
- Worldwide chain active: true
- Festival chain active: false
- Mergemaker made the choice
- Size was equal (4 = 4)

---

### Scenario 5.3: Three-Way Merger

**Initial State:**
- American chain: 6 tiles
- Tower chain: 4 tiles
- Luxor chain: 3 tiles
- Player A has tile that connects all three chains

**Actions:**
1. Player A places merger tile
2. American (largest) automatically survives
3. Resolve Tower (larger defunct) first:
   - Pay Tower bonuses
   - Tower stockholders dispose stock
4. Resolve Luxor (smaller defunct) second:
   - Pay Luxor bonuses
   - Luxor stockholders dispose stock

**Expected Outcomes:**
- American survives with 14 tiles (6 + 4 + 3 + merger tile)
- Tower defunct, resolved first
- Luxor defunct, resolved second
- Resolution order: largest defunct first

**Key Assertions:**
- American chain size: 14 tiles
- Tower and Luxor both defunct
- Tower resolved before Luxor
- Two separate bonus calculations

---

### Scenario 5.4: Safe Chain Absorbs Unsafe Chain

**Initial State:**
- Continental chain: 12 tiles (SAFE)
- Festival chain: 8 tiles (unsafe)
- Player A has merger tile

**Actions:**
1. Player A places merger tile

**Expected Outcomes:**
- Continental survives (it's safe)
- Festival becomes defunct
- Safe status overrides size comparison

**Key Assertions:**
- Continental chain active: true
- Continental was safe, automatically survives
- Even if Festival were larger, Continental would still survive

---

### Scenario 5.5: Cannot Merge Two Safe Chains

**Initial State:**
- American chain: 15 tiles (SAFE)
- Imperial chain: 11 tiles (SAFE)
- Player A has tile that would connect both chains

**Actions:**
1. Player A attempts to place merger tile

**Expected Outcomes:**
- Tile placement rejected
- Error: "Cannot merge two safe chains"
- Tile is permanently unplayable

**Key Assertions:**
- Tile not placed
- Both chains remain separate
- Tile marked as permanently unplayable

---

## Stockholder Bonuses

### Scenario 5.6: Simple Majority/Minority Bonus Distribution

**Initial State:**
- Merger: American acquires Tower (4 tiles, Cheap tier)
- Tower stockholders:
  - Player A: 6 shares (majority)
  - Player B: 3 shares (minority)
  - Player C: 1 share (no bonus)
- Tower 4-tile Cheap bonus: Majority $4,000, Minority $2,000

**Actions:**
1. Merger triggered
2. Bonuses calculated and paid

**Expected Outcomes:**
- Player A receives $4,000 (majority)
- Player B receives $2,000 (minority)
- Player C receives nothing (not majority or minority)

**Key Assertions:**
- Player A bonus: $4,000
- Player B bonus: $2,000
- Player C bonus: $0
- Only top 2 stockholders get bonuses

---

### Scenario 5.7: Sole Stockholder Gets Both Bonuses

**Initial State:**
- Merger: Festival acquires Worldwide (3 tiles, Medium tier)
- Worldwide stockholders:
  - Player A: 5 shares (sole stockholder)
  - No other players own Worldwide
- Worldwide 3-tile Medium bonus: Majority $4,000, Minority $2,000

**Actions:**
1. Merger triggered
2. Bonus calculated

**Expected Outcomes:**
- Player A receives $6,000 (majority + minority)
- Sole stockholder gets both bonuses

**Key Assertions:**
- Player A bonus: $6,000
- Combined majority and minority

---

### Scenario 5.8: Tie for Majority - Split Combined Bonus

**Initial State:**
- Merger: Continental acquires Luxor (5 tiles, Cheap tier)
- Luxor stockholders:
  - Player A: 4 shares (tied for majority)
  - Player B: 4 shares (tied for majority)
  - Player C: 2 shares (would be minority, but absorbed)
- Luxor 5-tile Cheap bonus: Majority $5,000, Minority $2,500

**Actions:**
1. Merger triggered
2. Tied majority detected

**Expected Outcomes:**
- Combined bonus: $5,000 + $2,500 = $7,500
- Split between tied players: $7,500 / 2 = $3,750 each
- Player A receives $3,750
- Player B receives $3,750
- Player C receives nothing (minority absorbed into tie)

**Key Assertions:**
- Player A bonus: $3,750
- Player B bonus: $3,750
- Player C bonus: $0
- No separate minority bonus when majority ties

---

### Scenario 5.9: Tie for Minority - Split Minority Bonus

**Initial State:**
- Merger: American acquires Tower (6 tiles, Cheap tier)
- Tower stockholders:
  - Player A: 8 shares (majority)
  - Player B: 3 shares (tied for minority)
  - Player C: 3 shares (tied for minority)
- Tower 6-tile Cheap bonus: Majority $6,000, Minority $3,000

**Actions:**
1. Merger triggered
2. Tied minority detected

**Expected Outcomes:**
- Player A receives $6,000 (full majority)
- Player B receives $1,500 (half minority)
- Player C receives $1,500 (half minority)

**Key Assertions:**
- Player A bonus: $6,000
- Player B bonus: $1,500
- Player C bonus: $1,500
- Minority split evenly

---

### Scenario 5.10: Three-Way Tie for Majority

**Initial State:**
- Merger: Imperial acquires Festival (4 tiles, Medium tier)
- Festival stockholders:
  - Player A: 3 shares (tied)
  - Player B: 3 shares (tied)
  - Player C: 3 shares (tied)
- Festival 4-tile Medium bonus: Majority $5,000, Minority $2,500

**Actions:**
1. Merger triggered
2. Three-way tie detected

**Expected Outcomes:**
- Combined bonus: $5,000 + $2,500 = $7,500
- Split three ways: $7,500 / 3 = $2,500 each
- All three players receive $2,500

**Key Assertions:**
- Player A bonus: $2,500
- Player B bonus: $2,500
- Player C bonus: $2,500
- Equal split among all tied

---

### Scenario 5.11: Bonus Rounding (Round Up to $100)

**Initial State:**
- Merger: Continental acquires Worldwide (3 tiles, Medium tier)
- Worldwide stockholders:
  - Player A: 2 shares (tied for majority)
  - Player B: 2 shares (tied for majority)
  - Player C: 2 shares (tied for majority)
- Worldwide 3-tile Medium bonus: Majority $4,000, Minority $2,000

**Actions:**
1. Merger triggered
2. Calculate split: $6,000 / 3 = $2,000 each (no rounding needed)

Now test with odd split:
- If bonus were $7,000 / 3 = $2,333.33...
- Round up to nearest $100 = $2,400 each

**Expected Outcomes:**
- Each tied player receives $2,000 (in this case, evenly divisible)
- When not evenly divisible, round up to nearest $100

**Key Assertions:**
- Rounding: up to nearest $100
- No fractional dollars
- Each player's bonus is whole hundreds

---

## Stock Disposition

### Scenario 5.12: All Sell Strategy

**Initial State:**
- Merger: American acquires Tower (4 tiles)
- Tower stock price at merger: $400
- Player A has 8 Tower shares

**Actions:**
1. Player A chooses to sell all 8 shares

**Expected Outcomes:**
- Player A receives $3,200 (8 x $400)
- 8 Tower shares returned to pool
- Player A has 0 Tower shares

**Key Assertions:**
- Player A money increased by $3,200
- Player A Tower stock: 0
- Sale at defunct chain's size-based price

---

### Scenario 5.13: All Trade Strategy (2:1)

**Initial State:**
- Merger: Continental acquires Luxor
- Player A has 10 Luxor shares
- Continental has 5+ shares available in pool

**Actions:**
1. Player A trades all 10 Luxor for 5 Continental

**Expected Outcomes:**
- Player A receives 5 Continental shares
- Player A has 0 Luxor shares
- 10 Luxor returned to pool

**Key Assertions:**
- Player A Continental stock increased by 5
- Player A Luxor stock: 0
- Exact 2:1 ratio applied

---

### Scenario 5.14: All Hold Strategy

**Initial State:**
- Merger: Festival acquires Tower
- Player A has 6 Tower shares
- Player A expects Tower to be re-founded

**Actions:**
1. Player A holds all 6 Tower shares

**Expected Outcomes:**
- Player A retains 6 Tower shares
- Tower shares currently worth $0 (defunct)
- Shares will regain value if Tower re-founded

**Key Assertions:**
- Player A Tower stock: 6
- No money received
- No Continental received
- Tower chain defunct

---

### Scenario 5.15: Mixed Disposition Strategy

**Initial State:**
- Merger: American acquires Worldwide (5 tiles)
- Player A has 11 Worldwide shares
- Worldwide price: $600 (5-tile Medium)
- American has 3 shares available

**Actions:**
1. Player A trades 6 Worldwide for 3 American (max available)
2. Player A sells 3 Worldwide for $1,800
3. Player A holds 2 Worldwide

**Expected Outcomes:**
- Player A receives 3 American shares
- Player A receives $1,800 cash
- Player A retains 2 Worldwide (defunct)

**Key Assertions:**
- Player A American stock increased by 3
- Player A money increased by $1,800
- Player A Worldwide stock: 2 (held)

---

### Scenario 5.16: Trade Limited by Available Survivor Stock

**Initial State:**
- Merger: Imperial acquires Festival
- Player A has 12 Festival shares
- Imperial has only 2 shares available in pool

**Actions:**
1. Player A wants to trade 12 Festival
2. Can only get 2 Imperial (limited by pool)
3. Must trade 4 Festival for 2 Imperial
4. Remaining 8 Festival must be sold or held

**Expected Outcomes:**
- Player A trades 4 Festival for 2 Imperial
- Player A decides what to do with remaining 8 Festival

**Key Assertions:**
- Maximum trade: 4 Festival for 2 Imperial
- 8 Festival remaining
- Cannot trade more than 2x available survivor stock

---

## Multiple Stockholders in Multi-Chain Merger

### Scenario 5.17: Different Holdings Across Two Defunct Chains

**Initial State:**
- Three-way merger: Continental acquires American (5 tiles) and Tower (3 tiles)
- Stock holdings:
  - Player A: 4 American, 2 Tower
  - Player B: 2 American, 5 Tower
  - Player C: 0 American, 3 Tower
- American bonuses (5 tiles, Medium): Majority $6,000, Minority $3,000
- Tower bonuses (3 tiles, Cheap): Majority $3,000, Minority $1,500

**Actions:**
1. Resolve American first (larger defunct):
   - Player A: majority ($6,000)
   - Player B: minority ($3,000)
   - Stock disposition for American
2. Resolve Tower second:
   - Player B: majority ($3,000)
   - Player C: minority ($1,500)
   - Stock disposition for Tower

**Expected Outcomes:**
- Player A: $6,000 from American
- Player B: $3,000 from American + $3,000 from Tower = $6,000 total
- Player C: $1,500 from Tower

**Key Assertions:**
- Each defunct chain resolved separately
- Bonuses calculated independently
- Player can be majority in one, minority in another

---

## Defunct Chain Deactivation

### Scenario 5.18: Chain Marker Removed After Merger

**Initial State:**
- American chain: 6 tiles with chain marker
- Tower chain: 3 tiles with chain marker
- Merger: American acquires Tower

**Actions:**
1. Merger completes
2. Tower chain marker removed

**Expected Outcomes:**
- Tower chain marker removed from board
- Tower available for re-founding
- All former Tower tiles now American tiles

**Key Assertions:**
- Tower chain active: false
- Tower chain marker: removed
- Tower tiles: now belong to American
- Tower can be founded again later

---

### Scenario 5.19: No Stock in Defunct Chain

**Initial State:**
- Merger: Festival acquires Luxor (2 tiles)
- No player owns any Luxor stock
- Luxor stock pool has all 25 shares

**Actions:**
1. Merger triggered
2. Bonus calculation: no stockholders

**Expected Outcomes:**
- No bonuses paid (no stockholders)
- No stock disposition phase (no one has defunct stock)
- Merger completes immediately

**Key Assertions:**
- Total bonuses paid: $0
- No stock disposition required
- Merger still valid and completes
