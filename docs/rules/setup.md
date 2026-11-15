# Game Setup

This document covers the complete setup procedure for Buyout, including all components, money distribution, and preparation steps.

---

## What the game keeps track of

Buyout is played in the browser; the server holds every piece of state.

### Board and tiles
- **Board**: 12 columns x 9 rows, 108 squares. Columns are numbered 1-12 and rows lettered
  A-I, so every square has a name such as "1A", "6D" or "12I".
- **Tiles**: one per square, named after it. Tiles not yet drawn are in a hidden pool; the
  tiles in a player's hand are visible only to that player.

### Chains and shares
- **7 hotel chains**, each with a name, a colour and a price tier.
- **25 shares per chain** in the bank (175 in all). Shares a player owns are public.

### Money
- Each player's cash is public. The bank never runs out of money.

---

## The Seven Hotel Chains

| Chain | Tier | Colour | Starting Price |
|-------|------|--------|----------------|
| **Sandpiper** | Cheap | Ochre `#CBBA2F` | $200 |
| **Marlowe** | Cheap | Rose `#F797AC` | $200 |
| **Halcyon** | Medium | Sky teal `#41CBE6` | $300 |
| **Juniper** | Medium | Sage green `#7FAD74` | $300 |
| **Meridian** | Medium | Amber `#DF8528` | $300 |
| **Aurelia** | Expensive | Lavender `#B78AC8` | $400 |
| **Obsidian** | Expensive | Cornflower blue `#64A1FD` | $400 |

**Note**: Names, tiers and colours come from `backend/rulesets/default.json`.

---

## Setup Procedure

### Step 1: Prepare the Bank

1. Select one player to act as the **Banker**
2. The Banker manages:
   - All money transactions
   - The stock market tray
   - Bonus payments during mergers
3. Place all money and stock certificates within the Banker's reach
4. The Banker may also play in the game

### Step 2: Distribute Starting Money

Each player receives **$6,000** in starting capital:

| Denomination | Quantity | Subtotal |
|--------------|----------|----------|
| $1,000 | 4 | $4,000 |
| $500 | 3 | $1,500 |
| $100 | 5 | $500 |
| **Total** | **12 bills** | **$6,000** |

Players should keep their money visible or in a manner agreed upon by all players.

### Step 3: Prepare the Tiles

1. Place all 108 tiles **face-down** in the center of the table
2. Mix the tiles thoroughly
3. The resulting pile is the **tile pool** from which players will draw

### Step 4: Determine Turn Order

1. Each player draws **one tile** from the face-down pool
2. Each player places their drawn tile on the corresponding board space
3. The player whose tile is **closest to "1A"** goes first
   - Compare by column first (lower number = closer)
   - If columns match, compare by row (earlier letter = closer)
   - Example: "2B" beats "3A"; "1C" beats "1D"
4. Play proceeds **clockwise** from the first player

**Note**: These initially placed tiles remain on the board but do **not** form chains at this time (they are "orphan" tiles).

### Step 5: Draw Starting Tiles

1. Each player draws **6 tiles** from the face-down pool
2. Players keep their tiles hidden from other players
3. Tiles should be arranged on a tile rack or held in hand

---

## Setup Summary Checklist

- [ ] Banker designated and given control of money/stocks
- [ ] Each player has $6,000 (4x$1000, 3x$500, 5x$100)
- [ ] All 108 tiles mixed face-down in center
- [ ] Each player drew 1 tile for turn order
- [ ] Turn order tiles placed on board
- [ ] First player determined (closest to 1A)
- [ ] Each player drew 6 tiles for their hand
- [ ] Information cards distributed to players
- [ ] Ready to begin play!

---

## Player Information (Visibility Rules)

### Public Information
- Money holdings (traditionally visible, though house rules may vary)
- Stock certificates owned (traditionally visible)
- Number of tiles in hand (always 6, except end of game)
- All tiles placed on the board
- Available stock in each chain

### Hidden Information
- The specific tiles in each player's hand
- Face-down tiles in the tile pool

---

## Seating Arrangement

For optimal play:
- Players should be seated in a circle around the board
- The Banker should have easy access to the stock market tray
- Each player should be able to reach the tile pool
- Information cards should be visible to all players

---

## Number of Players

| Players | Notes |
|---------|-------|
| 3 | Good game, faster pace |
| 4 | **Optimal** - tournament standard |
| 5 | Good game, more competition for stock |
| 6 | Maximum players, longest game time |

---

## Variants for Setup

### Open vs. Closed Holdings

**Closed Holdings** (Optional Variant):
- Players may keep their stock holdings hidden
- Money may also be kept secret
- Adds an element of uncertainty to mergers

**Open Holdings** (Standard):
- All stock and money is visible
- Allows for more strategic planning

### Speed Setup

For experienced players:
- Skip the turn-order tile placement
- Simply choose first player randomly
- Saves time without affecting gameplay

---

[Back to Table of Contents](README.md) | [Next: Gameplay Overview](gameplay.md)
