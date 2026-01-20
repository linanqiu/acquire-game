# Acquire Frontend Redesign: Complete Storyboard

## Overview

Complete storyboard for the Acquire board game frontend redesign. This document defines every screen, user flow, and interaction the new frontend must support.

**Design Reference:** `design-system.md` (Bloomberg terminal aesthetic, dark theme, monospace typography, information-dense)

---

## Game Rules Summary (UI must enforce)

### Core Parameters
- **Players:** 3-6 (4 optimal)
- **Starting cash:** $6,000 per player
- **Starting tiles:** 6 per player (hidden from others)
- **Board:** 12x9 grid (108 spaces, columns 1-12, rows A-I)
- **Chains:** 7 total (max 7 active at once)
- **Safe threshold:** 11+ tiles (cannot be acquired)
- **Stock per chain:** 25 certificates total

### The 7 Hotel Chains

| Tier | Chains | Price at 2 tiles |
|------|--------|------------------|
| Cheap | Luxor, Tower | $200 |
| Medium | American, Festival, Worldwide | $300 |
| Expensive | Continental, Imperial | $400 |

### End Game Conditions
Game **may** end (player choice) when:
1. Any single chain reaches **41+ tiles**, OR
2. **All active chains** are safe (11+ tiles each)

### Public vs Private Information

**Public (visible to all players):**
- Each player's cash balance
- Each player's stock holdings (which chains, how many)
- Number of tiles in each player's hand (always 6 unless pool empty)
- Board state: all placed tiles and chain assignments
- Chain sizes and stock availability

**Private (hidden):**
- Specific tile coordinates in each player's hand

---

## Page Inventory

| Page | URL | Device | Purpose |
|------|-----|--------|---------|
| **Lobby** | `/` | Any | Create or join a game room |
| **Player View** | `/play/{room}` | Mobile phone | Private trading terminal |
| **Host View** | `/host/{room}` | TV/Laptop | Shared spectator display |

---

## User Flows

### Flow 1: Game Setup
```
Host creates game -> Gets 4-letter room code -> Host view shows QR code + room code
-> Players join via QR scan or manual code entry -> Host adds bots if needed
-> Host starts game (requires 3+ players)
-> Turn order randomized (digital version) or determined by tile draw closest to 1A (physical rules)
-> Each player receives $6,000 and 6 hidden tiles
-> First player begins their turn
```

### Flow 2: Player Turn (4 Phases)

```
PHASE 1: TRADE (Optional)
|- Active player may propose trades to any other player
|- Trades can include: stocks, cash, or combinations
|- Other players accept or decline
|- Multiple trades allowed
|- Trading closes when tile placement begins

    |
    v

PHASE 2: PLACE TILE (Mandatory)
|- Select one tile from your hand of 6
|- Place on corresponding board position
|- Outcomes:
|   |- Orphan: Tile sits alone (no adjacent tiles)
|   |- Found Chain: Connects orphan tiles -> Choose chain -> Get 1 free stock
|   |- Expand Chain: Joins existing chain -> Chain grows
|   |- Merger: Connects 2+ chains -> See Merger Resolution below
|- If all tiles unplayable: Replace permanently unplayable tiles

    |
    v

PHASE 3: BUY STOCKS (Optional)
|- Purchase 0-3 stock certificates total
|- Only in active chains (currently on board)
|- Pay current stock price per share
|- May split across multiple chains (e.g., 2 American + 1 Luxor)

    |
    v

PHASE 4: DRAW TILE (Automatic)
|- Draw 1 tile from pool to replenish to 6
|- If pool empty, continue without drawing
|- UI should show tile pool status (remaining tiles or "EMPTY")
```

### Flow 3: Merger Resolution

When a tile connects 2+ chains:

```
STEP 1: DETERMINE SURVIVOR
|- Larger chain (more tiles) survives
|- If tied: Mergemaker (active player) chooses
|- Safe chain (11+) always survives vs unsafe

STEP 2: PAY BONUSES (for each defunct chain, largest first)
|- Majority stockholder: Most shares -> Gets majority bonus
|- Minority stockholder: 2nd most shares -> Gets minority bonus
|- Tie for majority: Combine maj+min bonus, split evenly, round up to $100
|- Tie for minority: Split minority bonus, round up to $100
|- Sole stockholder: Gets BOTH majority AND minority bonuses

STEP 3: DISPOSE STOCK (starting with mergemaker, clockwise)
|- SELL: Return to bank at current price (based on defunct chain's size)
|- TRADE: 2 defunct shares -> 1 surviving chain share (if available)
|- HOLD: Keep shares (worthless until chain re-founded)

STEP 4: COMPLETE MERGER
|- Remove defunct chain marker
|- All defunct tiles become surviving chain tiles
|- Defunct chain may be re-founded later
```

**Multi-Chain Mergers (3+ chains):**
- Largest chain survives
- Resolve each defunct chain separately, **largest to smallest**
- Complete all bonuses and stock disposition for one defunct chain before moving to next

### Flow 4: End Game Declaration

```
Start of active player's turn
|- Check: Is any chain 41+ tiles OR are all chains safe?
|- If yes: Player MAY declare game over (optional - can continue playing)
|- If declared: Turn ends IMMEDIATELY (no tile, no buy, no draw)

    |
    v

FINAL SCORING
|- Pay majority/minority bonuses for EACH active chain
|- All players sell ALL stock at current prices
|- Defunct stock held from previous mergers = $0 (worthless)
|- Highest total cash wins (cash + bonuses + stock sales)
```

### Flow 5: Trading Rules

```
WHO CAN TRADE:
|- Active player: Can PROPOSE trades during Phase 1
|- Other players: Can only ACCEPT or DECLINE proposals from active player

WHAT CAN BE TRADED:
|- Stock certificates (any chains you own)
|- Cash
|- Combinations (e.g., "2 Luxor + $500 for 1 American")

CONSTRAINTS:
|- Trading only happens BEFORE tile placement
|- Once tile is placed, trading window closes
|- Can only trade stocks/cash you actually have
|- Multiple trades allowed per turn
```

### Flow 6: Waiting (Other Player's Turn)

```
Watch board updates in real-time
|- If active player proposes trade to you: Respond (accept/decline)
|- During merger: Wait for your turn to dispose stock (clockwise from mergemaker)
|- Otherwise: Observe and plan your next move
```

### Flow 7: Reconnection

```
Connection lost -> Show reconnecting spinner
|- Success: Sync state, show "Welcome back" with current game state
|- Failure: Option to rejoin as same player (if within timeout)
```

---

## Screen 1: Lobby (`/`)

### Layout
```
+------------------------------------------+
|           ACQUIRE                        |
|     [Bloomberg-style header]             |
+------------------------------------------+
|                                          |
|  +------------------+ +----------------+ |
|  |  CREATE GAME     | |  JOIN GAME     | |
|  |                  | |                | |
|  |  [Your Name]     | |  [Your Name]   | |
|  |  ------------    | |  ------------  | |
|  |                  | |                | |
|  |  [CREATE]        | |  [Room Code]   | |
|  |                  | |  ------------  | |
|  |                  | |                | |
|  |                  | |  [JOIN]        | |
|  +------------------+ +----------------+ |
|                                          |
|         "3-6 players - ~60 min"          |
+------------------------------------------+
```

### States
| State | Display |
|-------|---------|
| Default | Both forms ready for input |
| Submitting | Button shows loading spinner |
| Error | Inline error below relevant field (room not found, name taken, room full, game already started) |

### Validation
- Name: Required, max 20 characters
- Room code: 4-6 characters, auto-capitalizes, case-insensitive

### Actions
- **Create**: POST to `/create` -> Redirect to `/play/{room}?is_host=1`
- **Join**: POST to `/join` -> Redirect to `/play/{room}`

---

## Screen 2: Player View (`/play/{room}`)

### Layout Structure
```
+------------------------------------------+
| HEADER                                   |
|  Player Name | Room Code | $6,000 | [42] |
+------------------------------------------+
| PHASE INDICATOR                          |
|  "PHASE 1: TRADES" or "BOB'S TURN"       |
+------------------------------------------+
|                                          |
| MAIN CONTENT AREA                        |
| (context-sensitive based on phase)       |
|                                          |
+------------------------------------------+
| PORTFOLIO STRIP                          |
|  Your stocks: [Y]3 [B]2 [R]1             |
+------------------------------------------+
| TILE RACK (bottom-anchored)              |
|  [1A] [3C] [5E] [7G] [9B] [12I]          |
+------------------------------------------+
```

**Header elements:**
- Player Name: Your name
- Room Code: 4-letter code for joining
- Cash: Your current balance (e.g., $6,000)
- Tile Pool: Tiles remaining [42] or [EMPTY]

### State Variations

| Game State | Phase Indicator | Main Content | Tile Rack | Actions |
|------------|-----------------|--------------|-----------|---------|
| Pre-game (lobby) | "WAITING FOR HOST" | Player list, bot count | Hidden | None (host controls on host view) |
| **Your turn: End game option** | "END GAME AVAILABLE" | Declaration modal | Visible | Declare or continue |
| Your turn: Trading | "PHASE 1: TRADES" | Trade UI | Visible | Propose trade, skip to tiles |
| Your turn: Place tile | "PHASE 2: PLACE TILE" | Board with highlights | Active (selectable) | Tap tile, tap board |
| Your turn: Found chain | "CHOOSE A CHAIN" | Chain selection modal | Dimmed | Pick chain name |
| Your turn: Merger (your disposition) | "MERGER: DISPOSE STOCK" | Disposition interface | Dimmed | Sell/Trade/Hold sliders |
| Your turn: Merger (waiting) | "MERGER: WAITING" | Disposition queue | Dimmed | Watch others dispose |
| Your turn: Buy stocks | "PHASE 3: BUY STOCKS" | Stock purchase cart | Dimmed | Add to cart, confirm |
| Your turn: End of turn | "END OF TURN" | Tile replacement offer | Visible | Replace or continue |
| Other's turn | "BOB'S TURN" | Board view, waiting message | Preview only | Watch, respond to trades |
| Respond to trade | "TRADE FROM BOB" | Trade proposal modal | Preview only | Accept/Decline |
| Merger (your disposition) | "YOUR TURN TO DISPOSE" | Disposition interface | Dimmed | Sell/Trade/Hold sliders |
| Merger (waiting) | "MERGER IN PROGRESS" | Disposition queue | Preview only | Watch others dispose |
| Game over | "GAME OVER" | Final scores | Hidden | Play again, back to lobby |

**Turn Flow Diagram:**
```
Your Turn Starts
       |
       v
[End conditions met?]--YES--> END GAME OPTION --> [Declare?]--YES--> FINAL SCORING
       |                                               |
       NO                                              NO
       |                                               |
       v                                               v
PHASE 1: TRADES (optional) <---------------------------+
       |
       v
PHASE 2: PLACE TILE (mandatory)
       |
       +--[Founds chain?]--> CHOOSE CHAIN --> receive free stock
       |
       +--[Triggers merger?]--> MERGER RESOLUTION (all players dispose)
       |
       v
PHASE 3: BUY STOCKS (optional, 0-3)
       |
       v
PHASE 4: DRAW TILE (automatic)
       |
       v
[Have permanently unplayable tiles?]--YES--> OFFER REPLACEMENT (optional)
       |
       v
TURN ENDS --> Next Player
```

---

## Screen 2a: Player View - Trading Phase

### Your Turn: Trade Options
```
+------------------------------------------+
| PHASE 1: TRADES                          |
+------------------------------------------+
|                                          |
| [PROPOSE A TRADE]    [VIEW PENDING]      |
|                                          |
| ------------ or ------------             |
|                                          |
| [SKIP TO TILE PLACEMENT ->]              |
|                                          |
+------------------------------------------+
```

### Trade Builder (Your Turn)
```
+------------------------------------------+
| NEW TRADE                           [x]  |
+------------------------------------------+
| TRADE WITH:                              |
| +--------+ +--------+ +--------+         |
| | BOB    | | CAROL  | | DAN    |         |
| |$4,200  | |$7,100  | |$3,800  |         |
| +--------+ +--------+ +--------+         |
+------------------------------------------+
| YOU OFFER:                               |
|   Stocks: [LUXOR v] x [2]   [+ ADD]      |
|           LUXOR x2 (you have 5)          |
|   Cash:   [$500_____]                    |
+------------------------------------------+
| YOU WANT:                                |
|   Stocks: [AMERICAN v] x [1] [+ ADD]     |
|           AMERICAN x1 (they have 3)      |
|   Cash:   [$0_______]                    |
+------------------------------------------+
| [CANCEL]              [PROPOSE TRADE]    |
+------------------------------------------+
```

### Responding to Trade (Not Your Turn)
```
+------------------------------------------+
| TRADE PROPOSAL FROM BOB                  |
+------------------------------------------+
|                                          |
| BOB OFFERS:                              |
|   2x LUXOR                               |
|   $500 cash                              |
|                                          |
| BOB WANTS:                               |
|   1x AMERICAN (you have 3)               |
|                                          |
+------------------------------------------+
| [ACCEPT]              [DECLINE]          |
+------------------------------------------+
```

### Trading Rules Enforced by UI
- Only show "Propose Trade" when it's your turn and in Phase 1
- Only show stocks/cash you actually have in "You Offer"
- Show opponent's holdings to help build valid requests
- **Trades are sequential**: One proposal at a time, wait for response before proposing another
- Trade response modal appears immediately when proposal received
- Trading UI hidden once tile placement begins
- "VIEW PENDING" shows your outstanding proposal (if any) and its status

---

## Screen 2b: Player View - Tile Placement

### Layout
```
+------------------------------------------+
| PHASE 2: PLACE A TILE                    |
+------------------------------------------+
|                                          |
| +--------------------------------------+ |
| |     1  2  3  4  5  6  7  8  9 10 11 12 |
| |  A  .  .  .  #  .  .  .  .  .  .  .  . |
| |  B  .  .  #  #  #  .  .  .  .  .  .  . |
| |  C  .  .  .  B  B  .  .  .  .  .  .  . |
| |  D  .  .  .  .  B  o  .  .  .  .  .  . |
| |  E  .  .  .  .  .  .  .  Y  Y  .  .  . |
| |  F  .  .  .  .  .  .  .  Y  .  .  .  . |
| |  ...                                   |
| +--------------------------------------+ |
|                                          |
| o = Selected tile placement preview      |
| # = Orphan tile   B = AMERICAN           |
|                                          |
| PREVIEW: "6D expands AMERICAN to 4"      |
|          "Stock price: $500/share"       |
+------------------------------------------+
| SELECT A TILE:                           |
| +-----+ +-----+ +-----+ +-----+ +-----+ +-----+
| | 1A  | | 3C  | | 6D  | | 7G  | | 9B  | |12I |
| |     | | !!  | | *   | |     | | X   | | XX |
| +-----+ +-----+ +-----+ +-----+ +-----+ +-----+
+------------------------------------------+
```

### Tile Rack States

| Icon | Meaning | Tap Action |
|------|---------|------------|
| (blank) | Normal playable tile | Select -> show preview on board |
| * | Currently selected | Tap board to place, or tap another tile |
| !! | Will trigger merger | Select -> show merger preview |
| X | Temporarily unplayable (would create 8th chain) | Disabled with tooltip |
| XX | Permanently unplayable (merges 2 safe chains) | Disabled, offer replacement |

### Preview Text by Outcome

| Outcome | Preview Text |
|---------|--------------|
| Orphan | "1A - Isolated tile (no chain)" |
| Found chain | "3C - Creates new chain! Choose name after placement" |
| Expand | "6D - AMERICAN grows to 4 tiles ($500/share)" |
| Expand + absorb orphans | "6D - AMERICAN grows to 6 tiles (absorbs 2 orphans)" |
| Merger | "5C - AMERICAN (5 tiles) absorbs LUXOR (3 tiles)" |
| Merger (tied) | "5C - TIE! AMERICAN (4) vs LUXOR (4). You choose survivor" |
| Multi-chain merger | "5C - Triple merger! AMERICAN survives, LUXOR & TOWER defunct" |

### Unplayable Tile Handling

**Two scenarios for tile replacement:**

**Scenario 1: ALL 6 tiles are unplayable (during Phase 2)**

If you cannot legally play ANY tile, replacement happens immediately so you can proceed:
```
+------------------------------------------+
| ALL TILES UNPLAYABLE                     |
+------------------------------------------+
| None of your tiles can be legally        |
| placed. Drawing replacement tiles...     |
|                                          |
| Replacing: 3B, 7D, 12I (merge 2 safe)    |
|            9A, 11C (would create 8th)    |
|            6E (merge 2 safe)             |
|                                          |
| [DRAW NEW TILES]                         |
+------------------------------------------+
```
After drawing, if still unplayable, repeat. If pool empty, skip Phase 2.

**Scenario 2: SOME tiles are permanently unplayable (end of turn)**

If you have playable tiles, play one normally. At END of turn (after drawing), you may optionally replace permanently unplayable tiles:
```
+------------------------------------------+
| END OF TURN                              |
+------------------------------------------+
| You have 2 permanently unplayable tiles: |
|   12I - would merge 2 safe chains        |
|   3B - would merge 2 safe chains         |
|                                          |
| Replace them now?                        |
|                                          |
| [REPLACE TILES]     [KEEP FOR NOW]       |
+------------------------------------------+
```
**Note:** Temporarily unplayable tiles (would create 8th chain) may become playable later and should NOT be replaced.

---

## Screen 2c: Player View - Chain Founding

```
+------------------------------------------+
| FOUND A NEW CHAIN!                       |
+------------------------------------------+
| Your tile connected 3 orphan tiles.      |
| Choose which hotel chain to establish:   |
|                                          |
| CHEAP TIER (starts at $200/share)        |
| +------------------+ +------------------+ |
| | [Y] LUXOR        | | [Br] TOWER       | |
| | 25 stock avail   | | 25 stock avail   | |
| +------------------+ +------------------+ |
|                                          |
| MEDIUM TIER (starts at $300/share)       |
| +-----------+ +-----------+ +-----------+ |
| |[B]AMERICAN| |[P]FESTIVAL| |[G]WORLDWIDE| |
| | 25 avail  | | 25 avail  | | 25 avail  | |
| +-----------+ +-----------+ +-----------+ |
|                                          |
| EXPENSIVE TIER (starts at $400/share)    |
| +------------------+ +------------------+ |
| | [R] CONTINENTAL  | | [Bl] IMPERIAL    | |
| | 25 stock avail   | | 25 stock avail   | |
| +------------------+ +------------------+ |
|                                          |
| >> You'll receive 1 FREE share!          |
+------------------------------------------+
```

### Chain Selection States

| State | Visual | Behavior |
|-------|--------|----------|
| Available | Full color, stock count | Selectable |
| Already on board | Grayed out, "ACTIVE" | Not selectable |
| No stock available | Full color, "0 avail" | Selectable (no free stock given - rare edge case) |

### Founding Confirmation
```
+------------------------------------------+
| [ok] AMERICAN FOUNDED!                   |
+------------------------------------------+
| Chain size: 3 tiles                      |
| Starting stock price: $400/share         |
|                                          |
| You received: 1 FREE AMERICAN share      |
|                                          |
| [CONTINUE TO BUY STOCKS ->]              |
+------------------------------------------+
```

### Founding Confirmation (No Stock Available - Rare)
```
+------------------------------------------+
| [ok] AMERICAN FOUNDED!                   |
+------------------------------------------+
| Chain size: 3 tiles                      |
| Starting stock price: $400/share         |
|                                          |
| All 25 AMERICAN shares already owned.    |
| No founder's bonus awarded.              |
|                                          |
| [CONTINUE TO BUY STOCKS ->]              |
+------------------------------------------+
```

---

## Screen 2d: Player View - Merger Resolution

### Step 1: Choose Survivor (Only If Tied)
```
+------------------------------------------+
| MERGER TIE - YOU CHOOSE SURVIVOR         |
+------------------------------------------+
| Your tile connects two equal chains.     |
| As mergemaker, choose which survives:    |
|                                          |
| +------------------+ +------------------+ |
| | [B] AMERICAN     | | [Y] LUXOR        | |
| | 5 tiles          | | 5 tiles          | |
| | $600/share       | | $500/share       | |
| |                  | |                  | |
| | You own: 3       | | You own: 2       | |
| |                  | |                  | |
| | [SURVIVES]       | | [SURVIVES]       | |
| +------------------+ +------------------+ |
+------------------------------------------+
```

### Step 2: Bonus Payout (Informational)
```
+------------------------------------------+
| LUXOR ACQUIRED BY AMERICAN               |
+------------------------------------------+
| LUXOR (5 tiles, Cheap tier) bonuses:    |
|                                          |
| [crown] MAJORITY (6 shares): BOB         |
|    Bonus: $5,000                         |
|                                          |
| [2nd] MINORITY (3 shares): YOU, CAROL    |
|    Bonus: $1,300 each (split $2,500)     |
|                                          |
| ---------------------------------------- |
| Your LUXOR shares: 3                     |
| Your bonus received: +$1,300             |
|                                          |
| [CONTINUE TO STOCK DISPOSITION ->]       |
+------------------------------------------+
```

### Bonus Tie-Breaking Display

| Scenario | Display |
|----------|---------|
| Sole stockholder | "BOB (sole owner): $5,000 + $2,500 = $7,500 (both bonuses)" |
| Tie for majority | "TIE: BOB & CAROL split $7,500 -> $3,800 each" |
| Tie for minority | "MINORITY TIE: YOU & DAN split $2,500 -> $1,300 each" |

### Step 3: Stock Disposition (Your Turn)
```
+------------------------------------------+
| DISPOSE OF YOUR LUXOR STOCK              |
+------------------------------------------+
| You have: 3 LUXOR shares                 |
| LUXOR price at merger: $500/share        |
| AMERICAN (survivor) stock available: 15  |
|                                          |
| +--------------------------------------+ |
| | SELL to bank                         | |
| | [----------*-----] 2 shares          | |
| | Cash received: $1,000                | |
| +--------------------------------------+ |
|                                          |
| +--------------------------------------+ |
| | TRADE 2:1 for AMERICAN               | |
| | [--*--------------] 0 shares         | |
| | (Need 2 LUXOR -> Get 1 AMERICAN)     | |
| | AMERICAN received: 0                 | |
| +--------------------------------------+ |
|                                          |
| +--------------------------------------+ |
| | HOLD (keep for re-founding)          | |
| | Remaining: 1 share                   | |
| | (Worth $0 until LUXOR re-founded)    | |
| +--------------------------------------+ |
|                                          |
+------------------------------------------+
| SUMMARY: SELL 2 (+$1,000) | HOLD 1       |
|                                          |
| [CONFIRM DISPOSITION]                    |
+------------------------------------------+
```

### Disposition Rules Enforced by UI
- Sliders for sell/trade with real-time calculation
- Trade slider only allows even numbers (2:1 ratio)
- Trade disabled if surviving chain has no stock
- Hold = total - sell - trade (calculated automatically)
- Show surviving chain stock availability
- Players dispose in order: mergemaker first, then clockwise

### Waiting for Others to Dispose
```
+------------------------------------------+
| WAITING FOR STOCK DISPOSITION            |
+------------------------------------------+
| Disposing LUXOR stock in order:          |
|                                          |
| [ok] ALICE (mergemaker) - done           |
| [..] BOB - deciding...                   |
| [ ] CAROL - waiting                      |
| [ ] YOU - waiting                        |
|                                          |
+------------------------------------------+
```

**Notes on disposition order:**
- Players with 0 shares in defunct chain are skipped
- After ALL players dispose, merger completes
- **If you're the mergemaker**: After merger completes, you continue to Phase 3 (buy stocks)
- **If you're not the mergemaker**: You return to watching the active player's turn

### Multi-Chain Merger (3+ Chains)
```
+------------------------------------------+
| TRIPLE MERGER!                           |
+------------------------------------------+
| Your tile connects 3 chains:             |
|                                          |
| [B] AMERICAN (6 tiles) -> SURVIVES       |
| [Y] LUXOR (4 tiles) -> DEFUNCT (1st)     |
| [R] CONTINENTAL (3 tiles) -> DEFUNCT (2nd)|
|                                          |
| Resolving LUXOR first, then CONTINENTAL  |
|                                          |
| [CONTINUE ->]                            |
+------------------------------------------+
```

**Multi-chain merger flow:**
1. Show overview of all chains involved
2. Resolve FIRST defunct chain (largest):
   - Pay LUXOR bonuses
   - ALL players dispose LUXOR stock (in order)
3. Resolve SECOND defunct chain:
   - Pay CONTINENTAL bonuses
   - ALL players dispose CONTINENTAL stock (in order)
4. Merger complete
5. Active player continues to Phase 3

---

## Screen 2e: Player View - Stock Buying

```
+------------------------------------------+
| PHASE 3: BUY STOCKS                      |
| Your cash: $5,800                        |
+------------------------------------------+
| ACTIVE CHAINS                            |
|                                          |
| +--------------------------------------+ |
| | [B] AMERICAN                         | |
| | 8 tiles - $700/share - 15 available  | |
| | You own: 3                           | |
| |                                      | |
| | [-]  0  [+]                          | |
| +--------------------------------------+ |
|                                          |
| +--------------------------------------+ |
| | [Y] LUXOR                            | |
| | 4 tiles - $400/share - 22 available  | |
| | You own: 1                           | |
| |                                      | |
| | [-]  0  [+]                          | |
| +--------------------------------------+ |
|                                          |
| +--------------------------------------+ |
| | [R] CONTINENTAL [SAFE]               | |
| | 12 tiles - $900/share - 18 avail     | |
| | You own: 0                           | |
| |                                      | |
| | [-]  0  [+]                          | |
| +--------------------------------------+ |
|                                          |
+------------------------------------------+
| CART: 0/3 stocks                         |
| Total cost: $0                           |
| Cash after purchase: $5,800              |
|                                          |
| [SKIP BUYING]      [CONFIRM PURCHASE]    |
+------------------------------------------+
```

### Stock Buying Constraints (UI enforced)
- [+] disabled when: cart has 3 stocks (max per turn)
- [+] disabled when: that chain has 0 available
- [+] disabled when: player can't afford another share
- [-] disabled when: count is 0
- Show "Cash after purchase" to prevent overspending
- Safe chains marked with [SAFE] badge

### Purchase Confirmation
```
+------------------------------------------+
| [ok] PURCHASE COMPLETE                   |
+------------------------------------------+
| You bought:                              |
|   2x AMERICAN @ $700 = $1,400            |
|   1x LUXOR @ $400 = $400                 |
|                                          |
| Total spent: $1,800                      |
| Remaining cash: $4,000                   |
|                                          |
| [END TURN ->]                            |
+------------------------------------------+
```

---

## Screen 2f: Player View - End Game Declaration

When end conditions are met (your turn):

### Variant 1: Chain Reached 41+ Tiles
```
+------------------------------------------+
| END GAME AVAILABLE                       |
+------------------------------------------+
| CONTINENTAL has reached 41 tiles!        |
|                                          |
| You may declare the game over now,       |
| or continue playing for strategic        |
| advantage.                               |
|                                          |
| [DECLARE GAME OVER]  [CONTINUE PLAYING]  |
+------------------------------------------+
```

### Variant 2: All Chains Are Safe
```
+------------------------------------------+
| END GAME AVAILABLE                       |
+------------------------------------------+
| All active chains are now SAFE (11+):    |
|  - AMERICAN: 15 tiles                    |
|  - CONTINENTAL: 22 tiles                 |
|  - IMPERIAL: 11 tiles                    |
|                                          |
| You may declare the game over now,       |
| or continue playing.                     |
|                                          |
| [DECLARE GAME OVER]  [CONTINUE PLAYING]  |
+------------------------------------------+
```

If "DECLARE GAME OVER":
- Turn ends immediately (no tile, no buy, no draw)
- Proceed to final scoring

---

## Screen 3: Host View (`/host/{room}`)

### Pre-Game (Lobby)
```
+------------------------------------------------------------------+
| ACQUIRE                                         Room: ABCD       |
+------------------------------------------------------------------+
|                                                                  |
|                    +--------------------+                        |
|                    |   SCAN TO JOIN     |                        |
|                    |  +--------------+  |                        |
|                    |  |   [QR CODE]  |  |                        |
|                    |  |              |  |                        |
|                    |  +--------------+  |                        |
|                    |  or enter: ABCD    |                        |
|                    +--------------------+                        |
|                                                                  |
|  PLAYERS (3/6)                                                   |
|  +----------+  +----------+  +----------+                        |
|  | ALICE    |  | BOB      |  | CAROL    |                        |
|  | (host)   |  |          |  | (bot)    |                        |
|  +----------+  +----------+  +----------+                        |
|                                                                  |
|  [+ ADD BOT]                      [START GAME]                   |
|                                   (need 3+ players)              |
+------------------------------------------------------------------+
```

### In-Game
```
+------------------------------------------------------------------+
| ACQUIRE    ABCD    ALICE'S TURN - Phase 1: Trading               |
+----------------------------------+-------------------------------+
|                                  | CHAINS                        |
|     1  2  3  4  5  6  7  8  9 10 11 12|                           |
|  A  .  .  .  #  .  .  .  .  .  .  .  .| [B] AMERICAN  8  $700 [15]|
|  B  .  .  #  #  #  .  .  .  .  .  .  .| [Y] LUXOR     4  $400 [22]|
|  C  .  .  .  B  B  .  .  .  .  .  .  .| [R] CONTIN. 12  $900 [P]  |
|  D  .  .  .  .  B  B  .  .  .  .  .  .|                           |
|  E  .  .  .  .  B  B  B  .  Y  Y  .  .| Legend:                   |
|  F  .  .  .  .  .  .  .  .  Y  .  .  .| [P] = Safe (11+ tiles)    |
|  G  .  .  .  .  .  .  .  .  Y  R  .  .| [n] = Stock available     |
|  H  .  .  .  .  .  .  .  .  .  R  R  R|                           |
|  I  .  .  .  .  .  .  .  .  .  R  R  R+-----------------------------+
|                                  | ACTIVE TRADE                  |
|  # = Orphan tile                 | ALICE -> BOB                  |
|                                  | 2xLUX + $500 for 1xAME        |
|                                  | [..] Waiting for BOB...       |
|                                  +-------------------------------+
|                                  | SCOREBOARD                    |
|                                  |                               |
|                                  | > ALICE  $4,000               |
|                                  |   AME:3 LUX:1 CON:2           |
|                                  |                               |
|                                  |   BOB    $6,200               |
|                                  |   AME:5                       |
|                                  |                               |
|                                  |   CAROL  $5,100               |
|                                  |   AME:2 LUX:2 CON:1           |
+----------------------------------+-------------------------------+
| LOG: [ok] ALICE<->BOB traded - Alice placed 6E - Alice bought 2xAME |
+------------------------------------------------------------------+
```

### Host View Design Notes
- **Large board**: Readable from 10ft TV viewing distance
- **Current player**: > marker in scoreboard, name in header
- **Trade visibility**: All proposed/completed trades shown
- **Chain status**: Size, price, available stock, [P] for safe
- **Tile pool status**: Show remaining tiles (e.g., "TILES: 42" or "TILES: EMPTY")
- **Activity log**: Rolling log of recent game events
- **Room code**: Always visible for latecomers

### Host View - Trade States

| State | Display in "ACTIVE TRADE" panel |
|-------|--------------------------------|
| Pending | "ALICE -> BOB: 2xLUX for 1xAME [..] Waiting..." |
| Accepted | "[ok] ALICE <-> BOB: Trade completed" |
| Declined | "[x] ALICE -> BOB: Declined" |
| No trade | Panel hidden or "No active trades" |

---

## Screen 4: Game Over

### Player View - Results
```
+------------------------------------------+
| GAME OVER                                |
+------------------------------------------+
|                                          |
| [crown] WINNER: BOB ($32,200)            |
|                                          |
| FINAL STANDINGS                          |
| ---------------------------------------- |
| 1. BOB      $32,200  [crown]             |
| 2. CAROL    $28,100                      |
| 3. YOU      $24,800                      |
| 4. DAN      $19,500                      |
|                                          |
| YOUR BREAKDOWN                           |
| ---------------------------------------- |
| Cash on hand:        $4,500              |
| Final bonuses:      +$8,300              |
| Stock liquidation: +$12,000              |
| TOTAL:              $24,800              |
|                                          |
| Note: 2 TOWER shares held = $0           |
| (TOWER was never re-founded)             |
|                                          |
| [PLAY AGAIN]      [BACK TO LOBBY]        |
+------------------------------------------+
```

### Host View - Results
```
+------------------------------------------------------------------+
|                          GAME OVER                                |
+------------------------------------------------------------------+
|                                                                   |
|                       [crown] BOB WINS! [crown]                   |
|                          $32,200                                  |
|                                                                   |
|  +--------------------------------------------------------------+ |
|  | RANK | PLAYER | CASH   | BONUSES | STOCK  | TOTAL            | |
|  | ---- | ------ | ------ | ------- | ------ | -----            | |
|  |  1st | BOB    | $3,200 | $11,000 | $18,000| $32,200  [crown] | |
|  |  2nd | CAROL  | $5,100 | $8,500  | $14,500| $28,100          | |
|  |  3rd | ALICE  | $4,500 | $8,300  | $12,000| $24,800          | |
|  |  4th | DAN    | $2,800 | $6,200  | $10,500| $19,500          | |
|  +--------------------------------------------------------------+ |
|                                                                   |
|                        [PLAY AGAIN]                               |
+------------------------------------------------------------------+
```

### Host View - Results (Tie)
```
+------------------------------------------------------------------+
|                          GAME OVER                                |
+------------------------------------------------------------------+
|                                                                   |
|                    [crown] TIE GAME! [crown]                      |
|                 BOB & CAROL: $32,200 each                         |
|                                                                   |
|  +--------------------------------------------------------------+ |
|  | RANK | PLAYER | CASH   | BONUSES | STOCK  | TOTAL            | |
|  | ---- | ------ | ------ | ------- | ------ | -----            | |
|  | =1st | BOB    | $3,200 | $11,000 | $18,000| $32,200  [crown] | |
|  | =1st | CAROL  | $5,100 | $9,100  | $18,000| $32,200  [crown] | |
|  |  3rd | ALICE  | $4,500 | $8,300  | $12,000| $24,800          | |
|  |  4th | DAN    | $2,800 | $6,200  | $10,500| $19,500          | |
|  +--------------------------------------------------------------+ |
|                                                                   |
|                        [PLAY AGAIN]                               |
+------------------------------------------------------------------+
```

---

## Screen 5: Reconnection

### Reconnecting State
```
+------------------------------------------+
| RECONNECTING...                          |
+------------------------------------------+
|                                          |
|          [Spinner animation]             |
|                                          |
| Re-establishing connection to room ABCD  |
|                                          |
| If this takes too long:                  |
| [REJOIN AS SAME PLAYER]                  |
+------------------------------------------+
```

### Reconnected Successfully
```
+------------------------------------------+
| [ok] RECONNECTED                         |
+------------------------------------------+
| Welcome back, ALICE!                     |
|                                          |
| CURRENT GAME STATE:                      |
| ---------------------------------------- |
| Turn: BOB (Phase 3: Buying stocks)       |
| Your cash: $4,200                        |
| Your stocks: AME:3 LUX:1 CON:2           |
| Your tiles: 6 in hand                    |
|                                          |
| [CONTINUE PLAYING]                       |
+------------------------------------------+
```

---

## Error States

### Connection Error
```
+------------------------------------------+
| CONNECTION LOST                          |
+------------------------------------------+
| Unable to reach the game server.         |
|                                          |
| [RETRY]          [BACK TO LOBBY]         |
+------------------------------------------+
```

### Room Not Found
```
+------------------------------------------+
| ROOM NOT FOUND                           |
+------------------------------------------+
| Room "WXYZ" does not exist or has        |
| already ended.                           |
|                                          |
| [BACK TO LOBBY]                          |
+------------------------------------------+
```

### Name Already Taken
```
+------------------------------------------+
| NAME TAKEN                               |
+------------------------------------------+
| "ALICE" is already in this room.         |
| Please choose a different name.          |
|                                          |
| [OK]                                     |
+------------------------------------------+
```

### Room Full
```
+------------------------------------------+
| ROOM FULL                                |
+------------------------------------------+
| Room "ABCD" already has 6 players.       |
|                                          |
| [BACK TO LOBBY]                          |
+------------------------------------------+
```

### Invalid Action
```
+------------------------------------------+
| INVALID ACTION                           |
+------------------------------------------+
| [Error message from server]              |
|                                          |
| [DISMISS]                                |
+------------------------------------------+
```

---

## Summary: All Screens

| # | Screen | Description |
|---|--------|-------------|
| 1 | Lobby | Create/Join game forms |
| 2 | Player View (shell) | Main player interface layout |
| 2a | Trading Phase | Propose/respond to trades |
| 2b | Tile Placement | Select and place tile with preview |
| 2c | Chain Founding | Choose chain name, get free stock |
| 2d | Merger Resolution | Survivor choice, bonus display, stock disposition |
| 2e | Stock Buying | Purchase 0-3 stocks cart interface |
| 2f | End Game Declaration | Option to declare game over |
| 3 | Host View | TV display with board, trades, scoreboard |
| 4 | Game Over | Final scores and breakdown |
| 5 | Reconnection | Reconnect flow |
| - | Error States | Various error modals |

---

## Rules Coverage Checklist

### Setup Rules
- [x] 3-6 players, $6,000 starting cash, 6 tiles per hand
- [x] 12x9 board (108 tiles), 7 chains, 25 stock per chain
- [x] Turn order determination (randomized for digital)

### Turn Phase Rules
- [x] 4-phase turn: Trade -> Place Tile -> Buy Stock -> Draw Tile
- [x] Player-to-player trading (active player proposes, others respond)
- [x] Trading closes after tile placement
- [x] Buy 0-3 stocks per turn in active chains only
- [x] Tile pool exhaustion handling (continue without drawing)

### Tile Placement Rules
- [x] Tile outcomes: orphan, found chain, expand chain, merger
- [x] Expansion with orphan absorption (orphans join existing chain)
- [x] Unplayable tiles: permanently (merge 2 safe) vs temporarily (8th chain)
- [x] Tile replacement when tiles are permanently unplayable

### Chain Rules
- [x] Chain founding: choose chain, get 1 free stock
- [x] Founder gets NO bonus if all 25 stocks already distributed
- [x] Chain tiers: Cheap, Medium, Expensive (pricing per rules)
- [x] Safe chains: 11+ tiles, cannot be acquired
- [x] Max 7 chains on board at once

### Merger Rules
- [x] Merger: larger survives, tie = mergemaker chooses, safe always survives
- [x] Merger bonuses: majority/minority with tie-breaking rules
- [x] Sole stockholder gets BOTH bonuses
- [x] Tie for majority: combine and split maj+min, round up to $100
- [x] Tie for minority: split minority, round up to $100
- [x] Stock disposition: sell/trade(2:1)/hold in clockwise order from mergemaker
- [x] Trade only if surviving chain has stock available
- [x] Multi-chain merger: resolve largest defunct first

### End Game Rules
- [x] End game conditions: 41+ tiles OR all chains safe
- [x] Declaration is optional (player choice)
- [x] Declaration ends turn immediately (no tile, no buy, no draw)
- [x] Final scoring: bonuses for all active chains, sell all stock
- [x] Defunct held stock = worthless at game end

### Information Visibility
- [x] Public info: cash, stocks, tile count, board state, chain sizes, stock availability
- [x] Private info: specific tiles in hand
