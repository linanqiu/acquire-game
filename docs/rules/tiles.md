# Tile Placement Rules

This document provides detailed rules for tile placement in Acquire, including all possible placement outcomes and special situations.

---

## The Game Board

### Board Dimensions
- **Columns**: 12 (numbered 1-12)
- **Rows**: 9 (lettered A-I)
- **Total Spaces**: 108

### Board Layout

```
    1    2    3    4    5    6    7    8    9   10   11   12
  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
A │ 1A │ 2A │ 3A │ 4A │ 5A │ 6A │ 7A │ 8A │ 9A │10A │11A │12A │
  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
B │ 1B │ 2B │ 3B │ 4B │ 5B │ 6B │ 7B │ 8B │ 9B │10B │11B │12B │
  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
C │ 1C │ 2C │ 3C │ 4C │ 5C │ 6C │ 7C │ 8C │ 9C │10C │11C │12C │
  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
D │ 1D │ 2D │ 3D │ 4D │ 5D │ 6D │ 7D │ 8D │ 9D │10D │11D │12D │
  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
E │ 1E │ 2E │ 3E │ 4E │ 5E │ 6E │ 7E │ 8E │ 9E │10E │11E │12E │
  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
F │ 1F │ 2F │ 3F │ 4F │ 5F │ 6F │ 7F │ 8F │ 9F │10F │11F │12F │
  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
G │ 1G │ 2G │ 3G │ 4G │ 5G │ 6G │ 7G │ 8G │ 9G │10G │11G │12G │
  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
H │ 1H │ 2H │ 3H │ 4H │ 5H │ 6H │ 7H │ 8H │ 9H │10H │11H │12H │
  ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
I │ 1I │ 2I │ 3I │ 4I │ 5I │ 6I │ 7I │ 8I │ 9I │10I │11I │12I │
  └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘
```

---

## Tile Basics

### Tile Identification
- Each tile is labeled with its board coordinate (e.g., "6D", "12A")
- Each tile can only be placed on its corresponding board space
- Tiles are drawn from the face-down pool and kept hidden

### Adjacency
Tiles are **adjacent** if they share an edge (horizontally or vertically).

**Adjacent positions to tile 6D:**
- 5D (left)
- 7D (right)
- 6C (above)
- 6E (below)

**Diagonal positions are NOT adjacent:**
- 5C, 7C, 5E, 7E are **not** adjacent to 6D

```
        NOT adjacent
            ↓
    ┌────┬────┬────┐
    │ 5C │ 6C │ 7C │ ← NOT adjacent
    ├────┼────┼────┤
    │ 5D │ 6D │ 7D │ ← Adjacent (left/right)
    ├────┼────┼────┤
    │ 5E │ 6E │ 7E │ ← NOT adjacent
    └────┴────┴────┘
            ↑
       Adjacent (above/below)
```

---

## Types of Tile Placements

When a tile is placed on the board, one of four outcomes occurs:

### 1. Orphan Tile (Isolated Placement)

**Condition**: The placed tile is not adjacent to any other tiles on the board.

**Result**:
- The tile simply sits on the board
- No chain is formed
- No special actions occur

**Example**:
```
Before:          After placing 6D:
┌────┬────┐      ┌────┬────┐
│    │    │      │    │    │
├────┼────┤      ├────┼────┤
│    │    │  →   │    │ 6D │
├────┼────┤      ├────┼────┤
│    │    │      │    │    │
└────┴────┘      └────┴────┘
```

---

### 2. Founding a New Chain

**Condition**: The placed tile connects to one or more **orphan tiles** (tiles not part of any chain).

**Result**:
1. A new hotel chain is founded
2. The founding player chooses which chain to create (from available chains)
3. The chain marker is placed on one of the tiles
4. The founding player receives **1 free stock** in the new chain (founder's bonus)

**Example**:
```
Before:           After placing 6D:
┌────┬────┐       ┌────┬────┐
│    │ 6C │       │    │ 6C │ ← Now part of new chain
├────┼────┤   →   ├────┼────┤
│    │    │       │    │ 6D │ ← Founding tile
└────┴────┘       └────┴────┘

Player founds "American" chain and receives 1 free American stock.
```

See [Hotel Chains](chains.md) for more details on founding.

---

### 3. Expanding an Existing Chain

**Condition**: The placed tile is adjacent to tiles that are all part of **one existing chain**.

**Result**:
- The new tile becomes part of that chain
- The chain grows by one tile
- Stock price may increase based on new size

**Example**:
```
Before:                After placing 7D:
┌────┬────┬────┐       ┌────┬────┬────┐
│    │[6C]│    │       │    │[6C]│    │
├────┼────┼────┤   →   ├────┼────┼────┤
│    │[6D]│    │       │    │[6D]│[7D]│ ← Chain expands
└────┴────┴────┘       └────┴────┴────┘

[Brackets] indicate tiles in the American chain.
American chain grows from 2 tiles to 3 tiles.
```

---

### 4. Triggering a Merger

**Condition**: The placed tile is adjacent to tiles belonging to **two or more different chains**.

**Result**:
1. A merger occurs
2. The larger chain survives
3. Smaller chain(s) become defunct
4. Bonuses are paid to majority/minority stockholders
5. Stockholders dispose of defunct stock

**Example**:
```
Before:                 After placing 6D:
┌────┬────┬────┐        ┌────┬────┬────┐
│    │ 6C │    │        │    │[6C]│    │
├────┼────┼────┤   →    ├────┼────┼────┤
│{5D}│    │(7D)│        │[5D]│[6D]│[7D]│ ← Merger tile
└────┴────┴────┘        └────┴────┴────┘

{5D} = Tower chain (2 tiles total)
(7D) = American chain (3 tiles total)
American (larger) acquires Tower (smaller)
```

See [Mergers](mergers.md) for detailed merger rules.

---

## Unplayable Tiles

Certain tiles cannot be legally played and are considered **unplayable**:

### Permanently Unplayable Tiles

A tile is **permanently unplayable** if placing it would:

1. **Merge two or more safe chains**
   - A chain with **11 or more tiles** is "safe"
   - Safe chains cannot be acquired
   - A tile that would connect two safe chains can never be played

2. **Create an 8th chain**
   - Maximum of 7 chains can exist simultaneously
   - A tile that would found an 8th chain cannot be played

### Handling Unplayable Tiles (1999 Hasbro Rules)

1. **At the end of a turn**, a player may replace permanently unplayable tiles
2. Return the unplayable tile(s) to the tile pool face-down
3. Draw replacement tile(s)
4. If the new tile(s) are also unplayable, continue replacing
5. Stop when:
   - The player has 6 playable tiles, OR
   - The tile pool is exhausted

**Important**: Tile replacement happens at the **end** of the turn, after buying stock and drawing a tile.

### Temporarily Unplayable Tiles

A tile may be **temporarily unplayable** if:
- It would create an 8th chain, but chains may merge later

Such tiles may become playable again as the game progresses.

---

## Special Placement Situations

### Multiple Orphan Tiles

When a tile connects **multiple orphan tiles**, they all join the new chain:

```
Before:                 After placing 6D:
┌────┬────┬────┐        ┌────┬────┬────┐
│    │ 6C │    │        │    │[6C]│    │
├────┼────┼────┤   →    ├────┼────┼────┤
│ 5D │    │    │        │[5D]│[6D]│    │
└────┴────┴────┘        └────┴────┴────┘

Both 5D and 6C become part of the new chain.
Chain starts with 3 tiles.
```

### Expansion Plus Orphan Adoption

When a tile connects an **existing chain** to **orphan tiles**, the orphans join the chain:

```
Before:                 After placing 6D:
┌────┬────┬────┐        ┌────┬────┬────┐
│    │ 6C │    │ orphan │    │[6C]│    │
├────┼────┼────┤   →    ├────┼────┼────┤
│    │    │[7D]│        │    │[6D]│[7D]│
│    │    │[7E]│ chain  │    │    │[7E]│
└────┴────┴────┘        └────┴────┴────┘

Orphan 6C joins the existing chain.
Chain grows from 2 to 4 tiles.
```

### Multi-Chain Mergers

A single tile may connect **three or more chains**:

```
Before:                 After placing 6D:
┌────┬────┬────┐        ┌────┬────┬────┐
│    │ 6C │    │ Chain A│    │[6C]│    │
├────┼────┼────┤   →    ├────┼────┼────┤
│ 5D │    │ 7D │        │[5D]│[6D]│[7D]│
│    │ 6E │    │ Chain C│    │[6E]│    │
└────┴────┴────┘        └────┴────┴────┘
Chain B      Chain B

Three chains merge! See Mergers for resolution.
```

---

## Edge Cases

### Corner Tiles
Corner tiles (1A, 12A, 1I, 12I) have only 2 adjacent spaces.

### Edge Tiles
Edge tiles have only 3 adjacent spaces.

### No Tiles Remaining
When the tile pool is empty, players continue with their remaining tiles without drawing.

### All Tiles Unplayable
If a player's entire hand consists of unplayable tiles:
1. Attempt to replace tiles (per above rules)
2. If still unable to play, skip the tile placement phase
3. The player may still buy stock
4. Draw does not occur (no tiles to draw)

---

## Tile Placement Summary

| Situation | Adjacent To | Result |
|-----------|-------------|--------|
| Orphan | Nothing | Tile sits alone |
| Found | 1+ orphan tiles | New chain created |
| Expand | 1 chain only | Chain grows |
| Merge | 2+ chains | Merger occurs |
| Illegal | 2+ safe chains | Cannot play |
| Illegal | Would create 8th chain | Cannot play |

---

[Previous: Gameplay Overview](gameplay.md) | [Back to Table of Contents](README.md) | [Next: Hotel Chains](chains.md)
