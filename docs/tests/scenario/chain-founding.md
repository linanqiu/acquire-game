> **Historical.** This catalogue described the retired browser scenario suite. Current coverage is by surface: [surface-coverage.md](../surface-coverage.md); what happened to each old test: [legacy-suite-retirement.md](../legacy-suite-retirement.md).

# Chain Founding Scenarios

Scenarios covering chain creation in Buyout, including founder's bonus, chain selection, and edge cases.

---

## Basic Chain Founding

### Scenario 3.1: Found Chain with Two Adjacent Tiles

**Initial State:**
- Player A is active player
- Player A has tile "6D" in hand
- Board has orphan tile at 6C (not part of any chain)
- No chains exist on board
- All 7 chains available for founding

**Actions:**
1. Player A places tile 6D (adjacent to orphan 6C)
2. System prompts for chain selection
3. Player A selects "Halcyon"

**Expected Outcomes:**
- Halcyon chain founded with 2 tiles (6C, 6D)
- Player A receives 1 free Halcyon stock (founder's bonus)
- Halcyon chain marked as active

**Key Assertions:**
- Halcyon chain size: 2 tiles
- Halcyon chain active: true
- Player A Halcyon stock: 1
- Founder's bonus not charged (free stock)

---

### Scenario 3.2: Found Chain with Multiple Connected Tiles

**Initial State:**
- Player A is active player
- Player A has tile "6D" in hand
- Board has orphan tiles at: 5D, 6C, 7D (L-shape around 6D)
- No chains exist

**Actions:**
1. Player A places tile 6D
2. Tile connects all three orphans
3. Player A selects "Marlowe"

**Expected Outcomes:**
- Marlowe chain founded with 4 tiles (5D, 6C, 6D, 7D)
- Player A receives 1 free Marlowe stock
- Stock price based on 4-tile chain ($400 for Cheap tier)

**Key Assertions:**
- Marlowe chain size: 4 tiles
- Marlowe stock price: $400
- Player A Marlowe stock: 1
- All 4 tiles belong to Marlowe chain

---

### Scenario 3.3: Chain Tier Affects Pricing

**Initial State:**
- Player A is active player
- Player A has tile that will found a 2-tile chain
- All 7 chains available

**Actions:**
1. Player A places founding tile
2. Test case A: Player A selects "Sandpiper" (Cheap tier)
3. Test case B: Player A selects "Juniper" (Medium tier)
4. Test case C: Player A selects "Obsidian" (Expensive tier)

**Expected Outcomes:**
- Sandpiper (Cheap): Stock price $200, Majority bonus $2,000
- Juniper (Medium): Stock price $300, Majority bonus $3,000
- Obsidian (Expensive): Stock price $400, Majority bonus $4,000

**Key Assertions:**
- Chain tier determines starting price
- Same size (2 tiles) but different prices per tier
- Founder's bonus stock value varies by tier choice

---

### Scenario 3.4: No Founder Stock When Pool Depleted

**Initial State:**
- Player A is active player
- Player A has founding tile
- Sandpiper chain was previously founded, merged, and re-founded multiple times
- All 25 Sandpiper stock certificates are held by players
- Sandpiper is currently defunct (available for re-founding)

**Actions:**
1. Player A places tile that would found Sandpiper
2. Player A selects "Sandpiper"

**Expected Outcomes:**
- Sandpiper chain founded successfully
- Player A receives NO founder's bonus (pool empty)
- No error - this is valid game state

**Key Assertions:**
- Sandpiper chain active: true
- Player A Sandpiper stock: 0 (no bonus awarded)
- Sandpiper stock in pool: 0
- Total Sandpiper stock among players: 25

---

### Scenario 3.5: Cannot Found 8th Chain

**Initial State:**
- 7 chains already exist on board:
  - Sandpiper, Marlowe, Halcyon, Juniper, Meridian, Aurelia, Obsidian
- Player A has tile "8E" that would connect two orphan tiles
- Orphan tiles at 8D and 8F (not adjacent to any chain)

**Actions:**
1. Player A attempts to place tile 8E

**Expected Outcomes:**
- Tile placement rejected
- Error: "Cannot create 8th chain - maximum 7 chains allowed"
- Tile 8E remains in Player A's hand

**Key Assertions:**
- Tile not placed on board
- 7 chains still exist (no 8th)
- Tile marked as temporarily unplayable
- Player A must play different tile

---

### Scenario 3.6: Only Available Chains Can Be Founded

**Initial State:**
- Player A is active player with founding tile
- 4 chains already active: Halcyon, Juniper, Marlowe, Sandpiper
- 3 chains available: Meridian, Aurelia, Obsidian

**Actions:**
1. Player A places founding tile
2. System shows chain selection options

**Expected Outcomes:**
- Only Meridian, Aurelia, Obsidian shown as options
- Active chains (Halcyon, Juniper, Marlowe, Sandpiper) not selectable
- Player must choose from available chains only

**Key Assertions:**
- Available chains count: 3
- Halcyon not in selection list
- Player can only select inactive chains

---

## Chain Selection Strategy

### Scenario 3.7: Strategic Cheap Tier Selection

**Initial State:**
- Player A is active player with $2,000
- Player A can found a chain
- Player A wants to maximize stock purchases

**Actions:**
1. Player A founds chain, selects "Marlowe" (Cheap tier, $200/share)
2. Player A buys 3 additional Marlowe stock

**Expected Outcomes:**
- Player A has 4 Marlowe stock (1 free + 3 bought)
- Player A spent $600 (3 x $200)
- Cheap tier allows more shares with limited money

**Key Assertions:**
- Player A Marlowe stock: 4
- Player A money: $1,400
- Majority position established cheaply

---

### Scenario 3.8: Strategic Expensive Tier Selection

**Initial State:**
- Player A is active player with $6,000
- Player A can found a chain
- Player A anticipates chain will grow large

**Actions:**
1. Player A founds chain, selects "Aurelia" (Expensive tier)
2. Player A buys 3 additional Aurelia stock ($1,200)

**Expected Outcomes:**
- Player A has 4 Aurelia stock
- Higher potential bonuses if chain grows
- Aurelia at 2 tiles: $4,000 majority bonus (vs $2,000 for Cheap)

**Key Assertions:**
- Player A Aurelia stock: 4
- Player A money: $4,800
- Higher bonus potential for expensive tier

---

## Re-founding Defunct Chains

### Scenario 3.9: Re-found Previously Defunct Chain

**Initial State:**
- Marlowe was active, then acquired in merger (became defunct)
- Player B held 3 Marlowe stock through the merger
- Player A now has founding tile
- Board has new orphan tiles that can form a chain

**Actions:**
1. Player A places founding tile
2. Player A selects "Marlowe" (re-founding it)

**Expected Outcomes:**
- Marlowe chain active again
- Player A receives 1 founder's bonus stock
- Player B's held Marlowe stock (3) becomes active again

**Key Assertions:**
- Marlowe chain active: true
- Marlowe chain size: 2 tiles (new location)
- Player A Marlowe stock: 1 (new)
- Player B Marlowe stock: 3 (from before merger, now active)

---

### Scenario 3.10: Held Defunct Stock Regains Value on Re-founding

**Initial State:**
- Sandpiper was acquired by Halcyon in earlier merger
- Player C held 5 Sandpiper stock (chose "hold" during merger)
- Sandpiper currently defunct
- Player A has founding tile

**Actions:**
1. Player A places tile, selects "Sandpiper"
2. Sandpiper chain re-founded

**Expected Outcomes:**
- Player C's 5 Sandpiper stock now has value
- Player C can sell Sandpiper stock (at new chain's price)
- Player C benefits from the hold strategy

**Key Assertions:**
- Sandpiper active: true
- Player C Sandpiper stock: 5 (unchanged but now valuable)
- Sandpiper stock price: $200 (2-tile Cheap chain)
- Player C's stock worth $1,000 (5 x $200)
