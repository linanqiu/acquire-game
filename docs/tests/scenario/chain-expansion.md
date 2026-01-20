# Chain Expansion Scenarios

Scenarios covering chain growth in Acquire, including simple expansion, orphan absorption, and approaching safe status.

---

## Simple Expansion

### Scenario 4.1: Basic Single Tile Expansion

**Initial State:**
- Player A is active player
- Player A has tile "7D" in hand
- American chain exists: tiles at 6C, 6D (2 tiles)
- Tile 7D is adjacent to 6D
- American stock price: $300 (2-tile Medium chain)

**Actions:**
1. Player A places tile 7D

**Expected Outcomes:**
- 7D joins American chain
- American chain now has 3 tiles
- Stock price increases to $400 (3-tile Medium chain)
- No founder bonus (expansion, not founding)

**Key Assertions:**
- American chain size: 3 tiles
- American stock price: $400
- Tile 7D belongs to American chain
- No free stock awarded

---

### Scenario 4.2: Expansion at Multiple Adjacency Points

**Initial State:**
- Tower chain exists: tiles at 5C, 5D, 6D (3 tiles, L-shape)
- Player A has tile "6C" in hand
- Tile 6C is adjacent to both 5C and 6D (two chain tiles)

**Actions:**
1. Player A places tile 6C

**Expected Outcomes:**
- 6C joins Tower chain
- Tower chain now has 4 tiles
- Only 1 tile added despite multiple adjacencies

**Key Assertions:**
- Tower chain size: 4 tiles
- Tile 6C part of Tower
- Single tile added (not double-counted)

---

## Expansion with Orphan Absorption

### Scenario 4.3: Expansion Absorbs Single Orphan Tile

**Initial State:**
- American chain: tiles at 6D, 7D (2 tiles)
- Orphan tile at 6C (not part of any chain)
- Player A has tile "6E" that is adjacent to both 6D and orphan 6C...
  - Wait, 6E is adjacent to 6D but not 6C. Let me reconsider.
- Player A has tile "5D" adjacent to orphan 5C and... no.
- Actually: American at 6D, 7D. Orphan at 8D. Player has 8E.
  - 8E adjacent to 8D (orphan) but not to chain. Would found new chain.
- Better setup: American at 5D, 6D. Orphan at 7C. Player has 7D.
  - 7D adjacent to 6D (chain) and 7C (orphan). This triggers expansion + absorption.

**Initial State (corrected):**
- American chain: tiles at 5D, 6D (2 tiles)
- Orphan tile at 7C (not part of any chain)
- Player A has tile "7D" in hand
- Tile 7D is adjacent to 6D (American) and 7C (orphan)

**Actions:**
1. Player A places tile 7D

**Expected Outcomes:**
- 7D joins American chain
- Orphan 7C absorbed into American chain
- American chain now has 4 tiles (5D, 6D, 7D, 7C)

**Key Assertions:**
- American chain size: 4 tiles
- All 4 tiles belong to American
- 7C no longer orphan
- No new chain founded (expansion, not founding)

---

### Scenario 4.4: Expansion Absorbs Multiple Orphan Tiles

**Initial State:**
- Tower chain: tiles at 5D, 5E (2 tiles, vertical)
- Orphan tiles at: 6D, 6E, 7E (scattered near chain)
- Player A has tile "6E"... wait, 6E is listed as orphan
- Correction: Orphan tiles at 6C, 6E, 7D
- Player has tile "6D" which connects to chain at 5D and orphans

**Initial State (corrected):**
- Tower chain: tiles at 5D, 5E (2 tiles)
- Orphan tiles at: 6C, 7D (near potential expansion)
- Player A has tile "6D" in hand
- Tile 6D adjacent to: 5D (Tower), 6C (orphan), 7D (orphan), 6E (empty)

**Actions:**
1. Player A places tile 6D

**Expected Outcomes:**
- 6D joins Tower chain
- Orphans 6C and 7D absorbed into Tower
- Tower chain now has 5 tiles

**Key Assertions:**
- Tower chain size: 5 tiles
- Tiles 5D, 5E, 6D, 6C, 7D all belong to Tower
- Stock price updated for 5-tile chain ($500 Cheap tier)

---

### Scenario 4.5: Expansion Creates Large Jump in Chain Size

**Initial State:**
- Festival chain: 2 tiles at 6D, 6E
- Multiple orphan tiles forming a line: 7D, 8D, 9D, 10D
- Player A has tile "7E" adjacent to Festival (6E) and orphan line
- Actually 7E is only adjacent to 6E and 7D, 7F. Let me use 7D instead.
- Player has tile adjacent to both chain and the orphan cluster.

**Initial State (corrected):**
- Festival chain: tiles at 6E, 6F (2 tiles, vertical)
- Orphan tiles: 7E, 7F, 8F (cluster)
- Player A has tile "7G" - no, that's not adjacent to anything listed
- Better: Festival at 5E, 6E. Orphans at 7E, 7F, 8E. Player has tile 6F.
  - 6F adjacent to 6E (Festival) and 7F (orphan). Chain expands, absorbs 7F.
  - But 7E and 8E need connection too.

**Initial State (simplified):**
- Luxor chain: tiles at 5D, 5E (2 tiles)
- Orphan tiles at: 5F, 6E, 6F (forming cluster)
- Player A has tile "5G"... no.
- Let's simplify: chain can absorb orphans that are connected through the expansion.

**Initial State (final):**
- Luxor chain: tiles at 4D, 5D (2 tiles)
- Orphan tiles at: 6D, 7D, 8D (line of 3 orphans extending from chain area)
- Player A has tile "6C"... no, need tile that connects.
- Player A has tile "5E" - adjacent to 5D (chain) but not to orphan line.

Let me just write a clear, valid scenario:

**Initial State:**
- Luxor chain: tiles at 5C, 5D (2 tiles, vertical)
- Orphan tile at 6D
- Orphan tile at 6E (adjacent to 6D)
- Player A has tile "5E" in hand
- Tile 5E is adjacent to 5D (Luxor chain) and 6E (orphan)

**Actions:**
1. Player A places tile 5E

**Expected Outcomes:**
- 5E joins Luxor chain (adjacent to 5D)
- 6E absorbed (adjacent to 5E)
- 6D absorbed (adjacent to 6E, now part of chain)
- Luxor grows from 2 to 5 tiles

**Key Assertions:**
- Luxor chain size: 5 tiles
- All connected tiles absorbed
- Chain absorbs transitively connected orphans

---

## Expansion Toward Safe Status

### Scenario 4.6: Expansion to Safe Size (11 Tiles)

**Initial State:**
- Continental chain: 10 tiles
- Continental is NOT safe (requires 11+)
- Player A has tile adjacent to Continental

**Actions:**
1. Player A places tile expanding Continental

**Expected Outcomes:**
- Continental now has 11 tiles
- Continental becomes SAFE
- Continental can no longer be acquired in mergers

**Key Assertions:**
- Continental chain size: 11 tiles
- Continental safe status: true
- Stock price: $900 (11-20 tile Expensive tier)

---

### Scenario 4.7: Safe Chain Remains Safe

**Initial State:**
- American chain: 15 tiles (already safe)
- Player A has tile adjacent to American

**Actions:**
1. Player A places tile expanding American

**Expected Outcomes:**
- American now has 16 tiles
- American remains safe
- Price unchanged ($800 for 11-20 Medium tier)

**Key Assertions:**
- American chain size: 16 tiles
- American safe status: true
- Stock price: $800 (same bracket)

---

### Scenario 4.8: Expansion Price Bracket Change

**Initial State:**
- Tower chain: 5 tiles (price $500 Cheap tier)
- Player A has tile that will expand Tower

**Actions:**
1. Player A places tile, Tower grows to 6 tiles

**Expected Outcomes:**
- Tower price changes from $500 to $600
- Crossed from "5 tiles" bracket to "6-10 tiles" bracket

**Key Assertions:**
- Tower chain size: 6 tiles
- Tower stock price: $600
- Price bracket: 6-10 tiles

---

## Expansion Without Triggering Merger

### Scenario 4.9: Expansion Near Another Chain (No Contact)

**Initial State:**
- American chain: tiles at 4D, 5D (2 tiles)
- Tower chain: tiles at 7D, 8D (2 tiles)
- Empty space at 6D between them
- Player A has tile "5E" (adjacent only to American at 5D)

**Actions:**
1. Player A places tile 5E

**Expected Outcomes:**
- 5E joins American chain
- Tower chain unaffected
- No merger (tile not adjacent to Tower)

**Key Assertions:**
- American chain size: 3 tiles
- Tower chain size: 2 tiles (unchanged)
- No merger triggered
- Chains remain separate

---

### Scenario 4.10: Expansion with Orphan Near Other Chain

**Initial State:**
- Festival chain: tiles at 3D, 4D (2 tiles)
- Worldwide chain: tiles at 7D, 8D (2 tiles)
- Orphan tile at 5D (between chains but not adjacent to either)
- Player A has tile "4E" (adjacent to 4D Festival, not adjacent to orphan 5D)

**Actions:**
1. Player A places tile 4E

**Expected Outcomes:**
- 4E joins Festival chain
- Festival grows to 3 tiles
- Orphan 5D remains orphan (not connected)
- Worldwide unaffected

**Key Assertions:**
- Festival chain size: 3 tiles
- Orphan 5D: still orphan
- Worldwide chain size: 2 tiles
- No merger, no unexpected absorption
