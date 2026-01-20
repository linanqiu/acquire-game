# Acquire UI Components

> Reusable component specifications for the Acquire frontend.

---

## Component Index

| Category | Components |
|----------|------------|
| **Layout** | Header, PageShell, Card, Modal, Panel |
| **Game Board** | Board, Tile, ChainMarker, CoordinateLabel |
| **Player** | PlayerCard, TileRack, Portfolio, CashDisplay |
| **Actions** | Button, StockStepper, Slider, TradeBuilder |
| **Feedback** | Toast, Spinner, ProgressIndicator, Badge |
| **Forms** | TextInput, Select, RadioGroup |

---

## Layout Components

### Header

Top navigation bar present on all pages.

**Variants:**
- Lobby: Logo only
- Player View: Logo + Room Code + Cash Balance
- Host View: Logo + Room Code + Current Turn Info

**Structure:**
```
+------------------------------------------+
| [LOGO]          [Room: ABCD]    [$6,000] |
+------------------------------------------+
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| roomCode | string? | 4-letter room code |
| cash | number? | Player's cash balance |
| playerName | string? | Current player name |

---

### PageShell

Wrapper component providing consistent page structure.

**Structure:**
```
+------------------------------------------+
| HEADER                                   |
+------------------------------------------+
| PHASE INDICATOR (optional)               |
+------------------------------------------+
|                                          |
| MAIN CONTENT (scrollable)                |
|                                          |
+------------------------------------------+
| FOOTER (optional, bottom-anchored)       |
+------------------------------------------+
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| phase | string? | Current game phase text |
| footer | ReactNode? | Bottom-anchored content |
| children | ReactNode | Main content |

---

### Card

Container for grouped content.

**Structure:**
```
+----------------------------------+
| TITLE (optional)            [x]  |
+----------------------------------+
|                                  |
| CONTENT                          |
|                                  |
+----------------------------------+
| FOOTER ACTIONS (optional)        |
+----------------------------------+
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| title | string? | Card header text |
| onClose | function? | Close button handler |
| footer | ReactNode? | Footer action buttons |
| children | ReactNode | Card content |

---

### Modal

Overlay dialog for focused interactions.

**Structure:**
```
+==========================================+
|                BACKDROP                  |
|   +----------------------------------+   |
|   | TITLE                       [x]  |   |
|   +----------------------------------+   |
|   |                                  |   |
|   | CONTENT                          |   |
|   |                                  |   |
|   +----------------------------------+   |
|   | [CANCEL]         [CONFIRM]       |   |
|   +----------------------------------+   |
+==========================================+
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| open | boolean | Visibility state |
| onClose | function | Close handler |
| title | string | Modal title |
| confirmLabel | string? | Primary action text |
| cancelLabel | string? | Secondary action text |
| onConfirm | function? | Primary action handler |
| children | ReactNode | Modal body |

**Behavior:**
- Escape key closes modal
- Click outside closes modal (if dismissible)
- Focus trapped within modal
- Scroll locked on body

---

### Panel

Sidebar panel for the Host View.

**Structure:**
```
+------------------------+
| PANEL TITLE            |
+------------------------+
|                        |
| CONTENT                |
|                        |
+------------------------+
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| title | string | Panel header |
| children | ReactNode | Panel content |

---

## Game Board Components

### Board

The 12x9 game grid.

**Structure:**
```
    1  2  3  4  5  6  7  8  9 10 11 12
 A  .  .  .  .  .  .  .  .  .  .  .  .
 B  .  .  #  #  .  .  .  .  .  .  .  .
 C  .  .  .  B  B  .  .  .  .  .  .  .
 D  .  .  .  .  B  .  .  .  .  .  .  .
 ...
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| tiles | TileState[][] | 12x9 grid of tile states |
| highlightedTile | Coordinate? | Tile to highlight (preview) |
| onTileClick | function? | Click handler for empty cells |
| size | 'sm' \| 'md' \| 'lg' | Board size variant |

**Tile States:**
- Empty (`.`)
- Orphan (`#`) - no chain assignment
- Chain tile - colored by chain

---

### Tile

Individual tile display (on board or in rack).

**Variants:**
- Board Tile: Shows chain color or orphan state
- Rack Tile: Shows coordinate, interactive

**Structure:**
```
+-----+
| 3B  |
|     |
+-----+
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| coordinate | string | "1A" through "12I" |
| chain | ChainName? | Assigned chain (null = orphan) |
| state | 'default' \| 'selected' \| 'disabled' \| 'merger' \| 'dead' | Visual state |
| onClick | function? | Click handler |
| size | 'sm' \| 'md' \| 'lg' | Tile size |

**States Visual:**
| State | Appearance |
|-------|------------|
| default | Normal tile |
| selected | Elevated, bright border |
| disabled | Dimmed, lock icon |
| merger | Warning indicator |
| dead | Crossed out |

---

### ChainMarker

Visual indicator for a hotel chain.

**Variants:**
- Icon only (8x8 pixel logo)
- Compact: Icon + abbreviation
- Full: Icon + name + size + price

**Structure (Full):**
```
[B] AMERICAN  8 tiles  $700/share  [15]
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| chain | ChainName | Which chain |
| size | number? | Chain tile count |
| price | number? | Current stock price |
| available | number? | Stock certificates available |
| safe | boolean? | Whether chain is safe (11+) |
| variant | 'icon' \| 'compact' \| 'full' | Display mode |

---

## Player Components

### PlayerCard

Displays player information in scoreboard.

**Structure:**
```
+--------------------------------+
| > ALICE              $12,400   |
|   AME:3 LUX:2 CON:1            |
+--------------------------------+
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| name | string | Player name |
| cash | number | Cash balance |
| stocks | StockHolding[] | Stock portfolio |
| isCurrentTurn | boolean | Highlight as active |
| isHost | boolean | Show host badge |
| isBot | boolean | Show bot badge |
| tileCount | number? | Tiles in hand (public info) |

---

### TileRack

Player's private tile hand (6 tiles).

**Structure:**
```
+-----+ +-----+ +-----+ +-----+ +-----+ +-----+
| 1A  | | 3C  | | 6D  | | 7G  | | 9B  | |12I |
|     | | !!  | | *   | |     | | X   | | XX |
+-----+ +-----+ +-----+ +-----+ +-----+ +-----+
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| tiles | RackTile[] | Array of tile objects |
| selectedTile | string? | Currently selected coordinate |
| onTileSelect | function | Tile selection handler |
| disabled | boolean | Disable all interaction |

**RackTile Object:**
```typescript
{
  coordinate: string;        // "3B"
  playability: 'playable' | 'merger' | 'temp_unplayable' | 'perm_unplayable';
}
```

---

### Portfolio

Stock holdings display with values.

**Structure:**
```
+------------------------------+
| PORTFOLIO                    |
+------------------------------+
| LUX   5 x $800  = $4,000     |
| AME   3 x $600  = $1,800     |
| CON   8 x $1000 = $8,000     |
+------------------------------+
| TOTAL VALUE:       $13,800   |
+------------------------------+
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| holdings | StockHolding[] | Stocks owned |
| prices | ChainPrices | Current prices per chain |
| showTotal | boolean | Show total value row |

---

### CashDisplay

Formatted cash amount with optional change animation.

**Structure:**
```
$12,400  (+$2,500)
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| amount | number | Cash value |
| change | number? | Recent change (animates) |
| size | 'sm' \| 'md' \| 'lg' | Text size |

---

## Action Components

### Button

Primary interactive element.

**Variants:**
- Primary: Filled background, main actions
- Secondary: Outlined, secondary actions
- Ghost: No background, tertiary actions
- Danger: Red tint, destructive actions

**Structure:**
```
+-------------------+
|    BUTTON TEXT    |
+-------------------+
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| variant | 'primary' \| 'secondary' \| 'ghost' \| 'danger' | Style variant |
| size | 'sm' \| 'md' \| 'lg' | Button size |
| disabled | boolean | Disable interaction |
| loading | boolean | Show spinner |
| fullWidth | boolean | Expand to container |
| onClick | function | Click handler |
| children | ReactNode | Button content |

---

### StockStepper

Quantity selector for stock purchases.

**Structure:**
```
[-]  3  [+]
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| value | number | Current quantity |
| min | number | Minimum value (usually 0) |
| max | number | Maximum value |
| onChange | function | Value change handler |
| disabled | boolean | Disable interaction |

---

### Slider

Range input for stock disposition.

**Structure:**
```
SELL: [----------*-----] 2 shares
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| label | string | Slider label |
| value | number | Current value |
| min | number | Minimum value |
| max | number | Maximum value |
| step | number | Value increment (1 or 2 for 2:1 trades) |
| onChange | function | Value change handler |
| displayValue | string | Formatted display text |

---

### TradeBuilder

Complex form for building trade proposals.

**Structure:**
```
+------------------------------------------+
| TRADE WITH: [Player Selector]            |
+------------------------------------------+
| YOU OFFER:                               |
| [Chain] x [qty]  [+ADD]                  |
| Cash: [$____]                            |
+------------------------------------------+
| YOU WANT:                                |
| [Chain] x [qty]  [+ADD]                  |
| Cash: [$____]                            |
+------------------------------------------+
| [CANCEL]           [PROPOSE]             |
+------------------------------------------+
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| players | Player[] | Available trade partners |
| myHoldings | StockHolding[] | Your stocks |
| myCash | number | Your cash |
| onPropose | function | Submit trade proposal |
| onCancel | function | Cancel builder |

---

## Feedback Components

### Toast

Temporary notification message.

**Structure:**
```
+----------------------------------+
| [icon] Message text         [x]  |
+----------------------------------+
```

**Variants:**
- Info: Neutral information
- Success: Positive confirmation
- Warning: Caution notice
- Error: Problem alert

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| message | string | Toast content |
| type | 'info' \| 'success' \| 'warning' \| 'error' | Toast style |
| duration | number | Auto-dismiss time (ms) |
| onDismiss | function | Dismiss handler |

---

### Spinner

Loading indicator.

**Variants:**
- Inline: Small, within text/buttons
- Block: Centered, standalone

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| size | 'sm' \| 'md' \| 'lg' | Spinner size |
| label | string? | Accessible loading text |

---

### ProgressIndicator

Step-based progress display.

**Structure:**
```
[ok] Step 1  [..] Step 2  [ ] Step 3
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| steps | string[] | Step labels |
| currentStep | number | Active step index |
| completedSteps | number[] | Completed step indices |

---

### Badge

Small status indicator.

**Variants:**
- Default: Neutral
- Safe: Protected chain indicator
- Warning: Attention needed
- Count: Numeric badge

**Structure:**
```
[SAFE]  [BOT]  [HOST]  [3]
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| label | string | Badge text |
| variant | 'default' \| 'safe' \| 'warning' \| 'count' | Style variant |

---

## Form Components

### TextInput

Single-line text entry.

**Structure:**
```
Label
+----------------------------------+
| Placeholder text                 |
+----------------------------------+
Helper or error text
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| label | string? | Input label |
| placeholder | string? | Placeholder text |
| value | string | Current value |
| onChange | function | Value change handler |
| error | string? | Error message |
| maxLength | number? | Character limit |
| autoCapitalize | boolean | Auto-uppercase input |

---

### Select

Dropdown selection.

**Structure:**
```
+----------------------------------+
| Selected Option              [v] |
+----------------------------------+
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| options | Option[] | Available choices |
| value | string | Selected value |
| onChange | function | Selection handler |
| placeholder | string? | Default text |
| disabled | boolean | Disable interaction |

---

### RadioGroup

Single selection from visible options.

**Structure:**
```
( ) Option A
(o) Option B
( ) Option C
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| options | Option[] | Available choices |
| value | string | Selected value |
| onChange | function | Selection handler |
| name | string | Radio group name |

---

## Composite Components

### StockPurchaseCart

Complete stock buying interface.

**Contains:**
- List of active chains with StockStepper for each
- Running total calculation
- Confirm/Skip buttons

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| chains | ActiveChain[] | Buyable chains |
| playerCash | number | Available cash |
| onPurchase | function | Confirm handler |
| onSkip | function | Skip handler |

---

### MergerDisposition

Stock disposition interface during mergers.

**Contains:**
- Sliders for SELL / TRADE / HOLD
- Real-time calculation
- Summary display
- Confirm button

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| defunctChain | ChainName | Chain being acquired |
| survivorChain | ChainName | Surviving chain |
| sharesOwned | number | Player's defunct shares |
| defunctPrice | number | Defunct chain's price |
| survivorStockAvailable | number | Available survivor stock |
| onConfirm | function | Disposition handler |

---

### ChainSelector

Grid for selecting a chain (founding, survivor choice).

**Contains:**
- Grouped by tier (Budget, Standard, Premium)
- Visual state for available/unavailable
- Selection highlight

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| availableChains | ChainName[] | Selectable chains |
| selectedChain | ChainName? | Current selection |
| onSelect | function | Selection handler |
| stockAvailability | Record<ChainName, number> | Stock counts |

---

## Shared Types

```typescript
type ChainName = 'luxor' | 'tower' | 'american' | 'festival' | 'worldwide' | 'continental' | 'imperial';

type Coordinate = string; // "1A" through "12I"

interface StockHolding {
  chain: ChainName;
  quantity: number;
}

interface Player {
  id: string;
  name: string;
  cash: number;
  stocks: StockHolding[];
  tileCount: number;
  isHost: boolean;
  isBot: boolean;
}

interface ActiveChain {
  name: ChainName;
  size: number;
  price: number;
  stockAvailable: number;
  isSafe: boolean;
}

interface RackTile {
  coordinate: Coordinate;
  playability: 'playable' | 'merger' | 'temp_unplayable' | 'perm_unplayable';
}
```
