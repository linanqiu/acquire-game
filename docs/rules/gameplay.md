# Gameplay Overview

This document covers the complete turn structure, player actions, and game flow for Acquire.

---

## Turn Structure

Each player's turn consists of **four phases** performed in order:

### Phase 1: Trade with Players (Optional)

Before placing a tile, the active player may propose stock trades with other players.

**Trading rules:**
- Only the active player may initiate trades
- Trades can involve stock certificates, cash, or combinations
- The other player may **accept or decline** any proposed trade
- Multiple trades may occur in this phase
- Once tile placement begins, trading closes for the turn

**Examples of valid trades:**
- 2 Tower shares for 1 Continental share
- 3 Luxor shares for $1,500 cash
- 1 American share + $500 for 2 Festival shares

### Phase 2: Place a Tile

The active player **must** place exactly one tile from their hand onto the board in its corresponding space.

**Possible outcomes of tile placement:**
1. **Orphan Tile**: Tile is not adjacent to any other tile (isolated)
2. **Chain Founding**: Tile connects to one or more orphan tiles, creating a new chain
3. **Chain Expansion**: Tile is placed adjacent to an existing chain, adding to it
4. **Merger**: Tile connects two or more existing chains

See [Tile Placement Rules](tiles.md) for detailed placement rules.

### Phase 3: Buy Stock (Optional)

After placing a tile, the player **may** purchase stock certificates:

- **Maximum**: Up to **3 stock certificates** per turn
- **Restriction**: May only buy stock in **active chains** (chains currently on the board)
- **Combinations**: May buy stocks in one, two, or three different chains
- **Cost**: Pay the current stock price for each certificate purchased

**Examples of valid purchases:**
- 3 shares of Continental
- 2 shares of Tower + 1 share of American
- 1 share each of Luxor, Festival, and Imperial

**Note**: If a player cannot afford any stock or chooses not to buy, they may skip this phase.

See [Stock Purchasing](stocks.md) for detailed purchasing rules.

### Phase 4: Draw a Tile

The player draws **one tile** from the face-down tile pool to replenish their hand.

- Players should always have **6 tiles** in hand (except when the tile pool is exhausted)
- The drawn tile is kept hidden from other players

---

## Turn Order

1. Play proceeds **clockwise** from the starting player
2. The starting player is determined during setup (closest tile to "1A")
3. Each player completes all three phases before the next player begins

---

## Game Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      PLAYER'S TURN                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ PHASE 1: TRADE WITH PLAYERS (Optional)              │   │
│  │                                                     │   │
│  │  • Propose trades to other players                  │   │
│  │  • Other players may accept or decline              │   │
│  │  • Trade stock, cash, or combinations               │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ PHASE 2: PLACE TILE (Mandatory)                     │   │
│  │                                                     │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │   │
│  │  │ Orphan   │  │ Found    │  │ Expand   │          │   │
│  │  │ Tile     │  │ Chain    │  │ Chain    │          │   │
│  │  └──────────┘  └──────────┘  └──────────┘          │   │
│  │        │              │             │               │   │
│  │        │       ┌──────┴──────┐     │               │   │
│  │        │       │ Get 1 Free  │     │               │   │
│  │        │       │ Stock       │     │               │   │
│  │        │       └─────────────┘     │               │   │
│  │        │                           │               │   │
│  │  ┌─────┴───────────────────────────┴─────┐         │   │
│  │  │              MERGER                    │         │   │
│  │  │  1. Determine surviving chain          │         │   │
│  │  │  2. Pay majority/minority bonuses      │         │   │
│  │  │  3. Stockholders dispose of stock      │         │   │
│  │  │  4. Complete the merger                │         │   │
│  │  └───────────────────────────────────────┘         │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ PHASE 3: BUY STOCK (Optional)                       │   │
│  │                                                     │   │
│  │  • Buy 0-3 stocks in active chains                  │   │
│  │  • Pay stock price to bank                          │   │
│  │  • Receive stock certificates                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ PHASE 4: DRAW TILE (Mandatory)                      │   │
│  │                                                     │   │
│  │  • Draw 1 tile from face-down pool                  │   │
│  │  • Maintain 6 tiles in hand                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│              NEXT PLAYER (Clockwise)                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Special Situations During Turns

### Unable to Place a Tile

In rare situations, a player may be unable to legally place any of their tiles:

- All 6 tiles would create an illegal merger (merging two safe chains)
- All 6 tiles would create an 8th chain when 7 already exist

**Resolution** (1999 Hasbro Rules):
1. The player may replace permanently unplayable tiles
2. Draw new tiles to replace them
3. Continue replacing until the player has playable tiles or the tile pool is empty
4. If still unable to play, the player skips the tile placement phase

### Empty Tile Pool

When the tile pool is exhausted:
- Players continue playing with their remaining tiles
- No new tiles are drawn after playing
- The game continues until an end condition is met

### No Available Stock

If a player wishes to buy stock but:
- The desired chain has no stock available (all 25 sold), or
- The player cannot afford any stock

The player simply skips the stock purchase phase.

---

## Turn Timing Guidelines

### No Backsies Rule

Once a tile is placed on the board, the placement cannot be undone. Players should:
- Consider their moves carefully before placing
- Announce their intentions clearly
- Wait for any disputes to be resolved before proceeding

### Stock Purchase Timing

Stock must be purchased **after** tile placement but **before** drawing a new tile.

### Merger Resolution

All merger procedures must be completed before the player may buy stock. The merger order is:
1. Determine surviving chain
2. Pay bonuses
3. All players dispose of defunct stock
4. Remove defunct chain marker
5. **Then** the active player may purchase stock

---

## Player Conduct

### Mandatory Actions
- Place one tile (if legally possible)
- Draw one tile (if tiles remain)

### Optional Actions
- Trade stock with other players (before tile placement)
- Buy stock (0-3 certificates)
- Declare game end (when conditions are met)

### Information Sharing
- Players may discuss strategy openly
- Players may not show their tiles to other players
- Stock holdings and money are public information (standard rules)

---

## End of Turn Checklist

Before the next player begins, verify:
- [ ] Player-to-player trading phase completed (if any trades occurred)
- [ ] Exactly one tile was placed
- [ ] Any chain founding was resolved (marker placed, free stock given)
- [ ] Any merger was fully resolved (bonuses paid, stock disposed)
- [ ] Stock purchases were completed (maximum 3)
- [ ] One tile was drawn (if pool not empty)
- [ ] Player has 6 tiles (or pool is empty)

---

## Common Mistakes to Avoid

1. **Trading after tile placement**: Player-to-player trades can only happen BEFORE tile placement
2. **Buying stock before placing tile**: Stock purchase comes AFTER tile placement
3. **Buying more than 3 stocks**: Maximum 3 per turn, regardless of chain
4. **Buying stock in defunct chains**: Can only buy stock in active chains on the board
5. **Forgetting founder's bonus**: Player who founds a chain gets 1 free stock
6. **Skipping tile draw**: Always draw unless the pool is empty

---

[Previous: Game Setup](setup.md) | [Back to Table of Contents](README.md) | [Next: Tile Placement Rules](tiles.md)
