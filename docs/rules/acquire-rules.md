# Acquire Board Game - Official Rules Reference

This document contains the complete rules for the Acquire board game, compiled from official sources for validation of game logic implementation.

## Table of Contents
1. [Overview](#overview)
2. [Game Components](#game-components)
3. [Setup](#setup)
4. [Turn Sequence](#turn-sequence)
5. [Tile Placement](#tile-placement)
6. [Founding Corporations](#founding-corporations)
7. [Expanding Corporations](#expanding-corporations)
8. [Mergers](#mergers)
9. [Stock Purchase](#stock-purchase)
10. [Stock Prices and Bonuses](#stock-prices-and-bonuses)
11. [Unplayable Tiles](#unplayable-tiles)
12. [End Game](#end-game)
13. [Rule Clarifications](#rule-clarifications)

---

## Overview

Acquire is a board game for 2-6 players (3-6 optimal) where players compete to earn the most money by forming and merging hotel corporations. Players place tiles on a grid to create and expand corporations, buy stock in those corporations, and earn bonuses when corporations merge.

---

## Game Components

- **Game Board**: 12x9 grid (108 spaces total)
  - Columns: 1-12
  - Rows: A-I
- **Tiles**: 108 tiles (one for each board space)
- **Hotel Chain Markers**: 7 markers (one per corporation)
- **Stock Certificates**: 25 shares per corporation (175 total)
- **Money**: Denominations of $100, $500, $1,000, and $5,000
- **Information Cards**: 6 reference cards showing stock prices and bonuses

### The Seven Corporations

Corporations are divided into three pricing tiers:

| Tier | Corporation | Color |
|------|-------------|-------|
| **Cheap** | Luxor | Gold |
| **Cheap** | Tower | Brown |
| **Medium** | American | Blue |
| **Medium** | Worldwide | Purple |
| **Medium** | Festival | Green |
| **Expensive** | Imperial | Red |
| **Expensive** | Continental | Cyan |

---

## Setup

1. **Place all tiles face-down** near the game board
2. **Designate one player as the banker** to manage the stock market tray
3. **Each player receives $6,000** in starting cash:
   - Four $1,000 bills
   - Three $500 bills
   - Five $100 bills
4. **Determine turn order**: Each player draws one tile and places it on the board. The player whose tile is closest to position 1-A goes first. Continue clockwise. (Tiles placed during this phase remain on the board but are NOT part of any corporation.)
5. **Draw starting tiles**: Each player draws 6 tiles to form their hand (kept hidden from other players)

---

## Turn Sequence

Each turn consists of four steps performed **in order**:

### 1. Trade with Players (Optional)
- Before placing a tile, the active player may propose trades with other players
- Trades can involve stock certificates, cash, or both
- Other players may accept or decline any proposed trade
- This is the only time player-to-player trades may occur
- Once the active player moves to tile placement, trading closes for the turn

### 2. Play a Tile
- Place exactly one tile from your hand onto its matching board space
- The tile must be placed on the space matching its coordinates (e.g., tile "3-C" goes on column 3, row C)
- This may result in: nothing, founding a corporation, expanding a corporation, or a merger

### 3. Buy Stock (Optional)
- You may purchase **up to 3 stock certificates total** in any active corporation(s)
- Purchases can be split across different corporations (e.g., 2 American + 1 Tower)
- You can only buy stock in corporations currently on the board
- You cannot buy if no corporations are active
- You cannot buy more stock than is available in the stock market

### 4. Draw a Tile
- Draw one tile from the face-down supply to replenish your hand to 6 tiles
- If you draw an unplayable tile (see [Unplayable Tiles](#unplayable-tiles)), follow the appropriate rules

---

## Tile Placement

When placing a tile, one of four outcomes occurs:

### 1. Nothing (Isolated Tile)
- The tile is not adjacent (horizontally or vertically) to any other tile
- The tile remains on the board but is not part of any corporation
- **Note**: Diagonal adjacency does NOT count

### 2. Founding a Corporation
- The tile is placed adjacent to one or more unincorporated tiles (tiles not part of any chain)
- This creates a new corporation (see [Founding Corporations](#founding-corporations))

### 3. Expanding a Corporation
- The tile is placed adjacent to tiles of exactly one existing corporation
- The corporation grows to include the new tile and any unincorporated tiles now connected to it

### 4. Triggering a Merger
- The tile is placed adjacent to tiles from two or more different corporations
- A merger occurs (see [Mergers](#mergers))

---

## Founding Corporations

When a player places a tile that connects two or more previously unincorporated tiles:

1. **Choose a corporation**: The founding player selects any available (inactive) corporation
2. **Place the corporation marker**: Put the marker on any tile in the new corporation
3. **Founder's bonus**: The founding player receives **one free stock certificate** in that corporation
   - If no stock certificates are available, the founder receives cash equal to one share's value instead
4. **All connected tiles** (horizontally/vertically adjacent) become part of the corporation

### Restriction
- **Maximum 7 corporations**: If all 7 corporations are already active on the board, you cannot play a tile that would create an 8th corporation. Such tiles are "temporarily unplayable" (see [Unplayable Tiles](#unplayable-tiles)).

---

## Expanding Corporations

When a tile is placed adjacent to an existing corporation:

1. The new tile becomes part of that corporation
2. Any unincorporated tiles now connected to the corporation also join it
3. The corporation's size increases, potentially increasing its stock price

---

## Mergers

A merger occurs when a tile connects two or more corporations.

### Determining the Survivor

1. **Count tiles**: The corporation with the **most tiles survives**; smaller corporations become defunct
2. **Tie-breaker**: If corporations are tied in size, the **mergemaker (active player) chooses** which corporation survives

### Safe Corporations

- A corporation with **11 or more tiles** is considered **"safe"**
- Safe corporations **cannot be absorbed** by another corporation
- A safe corporation CAN absorb smaller corporations
- **Two safe corporations cannot merge** - any tile that would merge two safe corporations is permanently unplayable

### Merger Resolution Process

For each defunct corporation (from largest to smallest if multiple):

#### Step 1: Pay Bonuses
Determine majority and minority stockholders for the defunct corporation:

- **Majority stockholder**: Player(s) with the most shares
- **Minority stockholder**: Player(s) with the second-most shares

**Bonus Rules**:
| Situation | Bonus Distribution |
|-----------|-------------------|
| One player owns all stock | That player receives BOTH majority AND minority bonuses |
| Tie for majority | Add majority + minority bonuses together, divide evenly among tied players. **Round up to nearest $100**. No minority bonus paid. |
| Clear majority, tie for minority | Majority holder gets full majority bonus. Tied minority holders split the minority bonus evenly. **Round up to nearest $100**. |

#### Step 2: Dispose of Stock
Starting with the mergemaker and proceeding clockwise, each stockholder chooses what to do with their defunct stock. Players may combine any of these options:

1. **HOLD**: Keep the stock certificates for potential future use if that corporation is founded again
2. **SELL**: Sell stock back to the bank at the **current price** (based on defunct corporation's size BEFORE the merger)
3. **TRADE**: Exchange defunct stock for surviving corporation stock at a **2:1 ratio** (2 defunct shares = 1 surviving share)
   - Only possible if surviving corporation stock is available
   - Cannot acquire stock that isn't available in the stock market

#### Step 3: Remove Corporation
- Return the defunct corporation's marker to the supply
- The corporation is now inactive and available to be founded again later
- Tiles from the defunct corporation now belong to the surviving corporation

### Multiple Mergers (3+ Corporations)

When one tile merges three or more corporations:

1. The **largest corporation survives**
2. Handle defunct corporations **one at a time, from largest to smallest**
3. If there's a **tie in size**, the mergemaker chooses the order
4. For each defunct corporation, complete the full merger resolution (bonuses, stock disposition) before moving to the next

---

## Stock Purchase

### Purchase Rules
- Maximum **3 shares per turn** (total, across all corporations)
- Can only purchase stock in **active corporations** (currently on the board)
- Cannot exceed **25 total shares** per corporation in the game
- Purchases are made at the current stock price based on corporation size

### Stock Availability
- Each corporation has exactly **25 shares total**
- Shares not held by players are in the stock market (available for purchase)
- When stock is sold or traded back, it returns to the stock market

### Player-to-Player Trading
- Players **may** trade stock directly with other players
- Trading can only occur **before tile placement** during the active player's turn
- Only the active player may initiate trades
- The other player may **accept or decline** any proposed trade
- Players may negotiate terms (stock for stock, stock for cash, or combinations)
- Multiple trades may occur in a single trading phase
- Once the active player places their tile, trading is closed for that turn

---

## Stock Prices and Bonuses

Stock prices and bonuses are determined by **corporation size (tile count)** and **tier**.

### Stock Price Table

| Chain Size | Cheap Tier | Medium Tier | Expensive Tier |
|------------|------------|-------------|----------------|
| 2 tiles | $200 | $300 | $400 |
| 3 tiles | $300 | $400 | $500 |
| 4 tiles | $400 | $500 | $600 |
| 5 tiles | $500 | $600 | $700 |
| 6-10 tiles | $600 | $700 | $800 |
| 11-20 tiles | $700 | $800 | $900 |
| 21-30 tiles | $800 | $900 | $1,000 |
| 31-40 tiles | $900 | $1,000 | $1,100 |
| 41+ tiles | $1,000 | $1,100 | $1,200 |

### Bonus Calculation

Bonuses are based on the stock price at the time of the merger:

- **Majority Bonus** = Stock Price × 10
- **Minority Bonus** = Stock Price × 5

### Complete Bonus Table

| Chain Size | Cheap Tier ||| Medium Tier ||| Expensive Tier |||
|------------|---------|---------|---------|---------|---------|---------|---------|---------|---------|
| | Price | Maj | Min | Price | Maj | Min | Price | Maj | Min |
| 2 | $200 | $2,000 | $1,000 | $300 | $3,000 | $1,500 | $400 | $4,000 | $2,000 |
| 3 | $300 | $3,000 | $1,500 | $400 | $4,000 | $2,000 | $500 | $5,000 | $2,500 |
| 4 | $400 | $4,000 | $2,000 | $500 | $5,000 | $2,500 | $600 | $6,000 | $3,000 |
| 5 | $500 | $5,000 | $2,500 | $600 | $6,000 | $3,000 | $700 | $7,000 | $3,500 |
| 6-10 | $600 | $6,000 | $3,000 | $700 | $7,000 | $3,500 | $800 | $8,000 | $4,000 |
| 11-20 | $700 | $7,000 | $3,500 | $800 | $8,000 | $4,000 | $900 | $9,000 | $4,500 |
| 21-30 | $800 | $8,000 | $4,000 | $900 | $9,000 | $4,500 | $1,000 | $10,000 | $5,000 |
| 31-40 | $900 | $9,000 | $4,500 | $1,000 | $10,000 | $5,000 | $1,100 | $11,000 | $5,500 |
| 41+ | $1,000 | $10,000 | $5,000 | $1,100 | $11,000 | $5,500 | $1,200 | $12,000 | $6,000 |

---

## Unplayable Tiles

### Permanently Unplayable Tiles
A tile is **permanently unplayable** if it would merge two or more **safe corporations** (corporations with 11+ tiles).

**Handling**:
1. Reveal the tile to all players
2. Discard it face-up (removed from game)
3. Draw a replacement tile
4. You may continue replacing permanently unplayable tiles until you have 6 playable tiles or the tile supply is empty
5. This can only be done **once per turn** for tiles already in hand

### Temporarily Unplayable Tiles
A tile is **temporarily unplayable** if it would create an **8th corporation** when all 7 are already active.

**Handling**:
1. You must **keep the tile** in your hand
2. Wait until a corporation becomes defunct (via merger) to play it
3. These tiles **cannot be discarded or traded**

### All Tiles Unplayable (2008+ Rule)
If all 6 tiles in a player's hand are unplayable at the start of their turn:
1. Reveal hand to all players
2. Set aside all unplayable tiles (removed from game)
3. Draw 6 new tiles
4. Continue the turn normally

---

## End Game

### End Game Conditions
The game can end when **either** condition is met:

1. **Any corporation reaches 41 or more tiles**, OR
2. **All corporations on the board are safe** (11+ tiles each)

### Declaring Game End
- A player **may** announce the game is over during their turn if a condition is met
- A player is **not required** to end the game - they may continue playing if it's advantageous
- The game can only be declared over at the **start or end** of a player's turn

### Final Scoring

1. **Pay final bonuses**: Majority and minority stockholder bonuses are paid for ALL active corporations
2. **Liquidate stock**: All players sell their stock back to the bank at current prices
3. **Stock in inactive corporations** (not on the board) is **worthless**
4. **Count total cash**: The player with the most money wins

---

## Rule Clarifications

### Adjacency
- Only **horizontal and vertical** adjacency counts
- **Diagonal adjacency does NOT connect** tiles or corporations

### Stock Limits
- **25 shares maximum** per corporation in the entire game
- **No limit** on how many shares one player can hold (except the 25 total)

### Tie Resolution
| Situation | Resolution |
|-----------|------------|
| Tied corporation sizes in merger | Mergemaker chooses survivor |
| Tied for majority stockholder | Split combined maj+min bonus, round up to $100 |
| Tied for minority stockholder | Split minority bonus, round up to $100 |
| Multiple defunct corps same size | Mergemaker chooses order |

### Money and Rounding
- All bonus splits **round UP to the nearest $100**
- Players can never go into debt
- Cash is unlimited (use paper as needed)

### Founding When No Stock Available
If all 25 shares of a corporation are held by players when someone founds that corporation:
- The founder receives **cash equal to one share's value** instead of a free stock

### Safe Corporation Threshold
- **11+ tiles** = safe (cannot be taken over)
- Safe corporations CAN absorb others
- Two safe corporations CANNOT merge

---

## Sources

This rules reference was compiled from:
- [Hasbro Official Instructions](https://instructions.hasbro.com/en-us/instruction/acquire)
- [UltraBoardGames - Acquire Rules](https://www.ultraboardgames.com/acquire/game-rules.php)
- [CMU - How to Play Acquire](https://www.cs.cmu.edu/~lanthony/classes/SEng/Design/acquire.html)
- [Renegade Game Studios Rulebook](https://renegadegamestudios.com/content/File%20Storage%20for%20site/Rulebooks/Acquire/Acquire_RGS_Rulebook_WEB.pdf)
- [BoardGameGeek - Acquire](https://boardgamegeek.com/boardgame/5/acquire)
- [Lloyd's Rules of Acquire](https://acquisitiongames.com/index.php/mobile-lloyds-rules-of-acquire/lloyds-changes-to-the-rules-of-acquire)
