# Acquire UI Design Principles

> Target: Retro pixel aesthetic meets Bloomberg terminal. Dark, muted, minimal, professional.

---

## Design Philosophy

### Core Principles

1. **Information Density Over Decoration**
   - Every pixel serves a purpose
   - Data is the aesthetic
   - No ornamental flourishes that don't convey game state

2. **Dark & Easy on the Eyes**
   - Deep charcoal backgrounds (#1a1a2e or similar)
   - Muted, desaturated accent colors
   - High contrast for critical information only

3. **Monospace Everything**
   - Terminal-inspired typography throughout
   - Consistent character widths aid alignment
   - Reinforces the "trading floor" atmosphere

4. **Modern Pixel, Not Retro Kitsch**
   - Clean pixel art without CRT effects (no scanlines, no glow, no bloom)
   - Crisp edges, intentional pixels
   - Like Balatro: nostalgic but polished

5. **Two Screens, Two Vibes**
   - **TV (Host)**: Public scoreboard - readable from across the room, spectator-friendly
   - **Phone (Player)**: Private trading terminal - dense info, quick decisions

---

## Color System

### Background Palette
```
Primary BG:     #1a1a2e  (deep navy-charcoal)
Secondary BG:   #16213e  (slightly lighter for cards/panels)
Tertiary BG:    #0f0f1a  (darkest, for depth)
Border:         #2a2a4a  (subtle separation)
```

### Text Palette
```
Primary Text:   #e8e8e8  (off-white, easy on eyes)
Secondary Text: #8888aa  (muted for labels)
Accent Text:    #ffffff  (pure white for emphasis only)
Negative:       #ff6b6b  (muted red for losses/warnings)
Positive:       #6bff8a  (muted green for gains)
```

### Hotel Chain Colors (Muted, Distinct)
```
LUXOR:       #c9a227  (muted gold)      - Budget tier
TOWER:       #7a5c3d  (brown/bronze)    - Budget tier
AMERICAN:    #5e7a8a  (slate blue)      - Standard tier
FESTIVAL:    #8a5e7a  (dusty mauve)     - Standard tier
WORLDWIDE:   #5e8a6a  (sage green)      - Standard tier
CONTINENTAL: #8a3d3d  (burgundy)        - Premium tier
IMPERIAL:    #3d5e8a  (deep blue)       - Premium tier
```

Each chain will have a tiny 8x8 pixel logo:
- LUXOR: Pyramid silhouette
- TOWER: Simple tower shape
- AMERICAN: Star
- FESTIVAL: Flag/banner
- WORLDWIDE: Globe outline
- CONTINENTAL: Mountain peaks
- IMPERIAL: Crown

---

## Typography

### Font Stack
```
Primary:    "IBM Plex Mono", "Fira Code", monospace
Pixel Alt:  Custom pixel font for headers (optional enhancement)
```

### Scale
```
XL:  24px  (phase announcements, winner declaration)
LG:  18px  (section headers, player names)
MD:  14px  (stock prices, tile labels)
SM:  12px  (secondary info, timestamps)
XS:  10px  (fine print, helper text)
```

---

## TV/Host Screen Layout

```
+------------------------------------------------------------------+
|  ACQUIRE                                    ROOM: XKCD    2/6 [*] |
+------------------------------------------------------------------+
|                                                                    |
|   BOARD 12x9                           |  CHAINS                  |
|   +--+--+--+--+--+--+--+--+--+--+--+--+ |  +--------------------+  |
|   |1A|2A|3A|4A|5A|6A|7A|8A|9A|10|11|12| |  | LUX [P] 12  $800   |  |
|   +--+--+--+--+--+--+--+--+--+--+--+--+ |  | TWR     --  ----   |  |
|   |1B|2B|##|##|5B|6B|7B|8B|9B|10|11|12| |  | AME [*]  8  $600   |  |
|   +--+--+LX|LX+--+--+--+--+--+--+--+--+ |  | FES      4  $400   |  |
|   |1C|##|##|##|##|6C|7C|8C|9C|10|11|12| |  | WOR     --  ----   |  |
|   +--+LX|LX|LX|LX+--+--+--+--+--+--+--+ |  | CON [*] 15  $1000  |  |
|   |1D|2D|##|##|5D|##|##|8D|9D|10|11|12| |  | IMP     --  ----   |  |
|   +--+--+LX|LX+--+AM|AM+--+--+--+--+--+ |  +--------------------+  |
|   |1E|2E|3E|4E|5E|##|##|##|9E|10|11|12| |  [P] = Safe (11+ tiles) |
|   +--+--+--+--+--+AM|AM|AM+--+--+--+--+ |  [*] = Available stock  |
|   |1F|2F|3F|4F|5F|##|##|8F|9F|10|11|12| |                         |
|   +--+--+--+--+--+AM|AM+--+--+--+--+--+ |  PLAYERS                |
|   |1G|2G|3G|4G|5G|6G|7G|8G|9G|10|11|12| |  +--------------------+  |
|   +--+--+--+--+--+--+--+--+--+--+--+--+ |  | > ALICE    $12,400  |  |
|   |1H|2H|3H|4H|5H|6H|7H|8H|9H|10|11|12| |  |   BOB      $8,200   |  |
|   +--+--+--+--+--+--+--+--+--+--+--+--+ |  |   CAROL    $15,100  |  |
|   |1I|2I|3I|4I|5I|6I|7I|8I|9I|10|11|12| |  |   [BOT]    $6,000   |  |
|   +--+--+--+--+--+--+--+--+--+--+--+--+ |  +--------------------+  |
|                                         |  > = current turn       |
+-----------------------------------------+-------------------------+
|  PHASE: BUYING_STOCKS          ALICE is buying stocks...          |
+------------------------------------------------------------------+
```

### Key Elements:
- **Coordinate labels** prominent and readable
- **Chain tiles** show abbreviated chain name (LX, AM, etc.) with colored background
- **Safe chains** marked with [P] (protected)
- **Stock availability** shown with [*]
- **Current player** highlighted with `>`
- **Phase status** always visible at bottom

---

## Phone/Player Screen Layout

```
+--------------------------------+
|  ACQUIRE          $12,400  [i] |
+--------------------------------+
|  YOUR TURN - BUY STOCKS        |
+--------------------------------+
|                                |
|  PORTFOLIO                     |
|  +--------------------------+  |
|  | LUX   5 x $800  = $4,000 |  |
|  | TWR   0 x ----  = -----  |  |
|  | AME   3 x $600  = $1,800 |  |
|  | FES   2 x $400  = $800   |  |
|  | WOR   0 x ----  = -----  |  |
|  | CON   8 x $1000 = $8,000 |  |
|  | IMP   0 x ----  = -----  |  |
|  +--------------------------+  |
|  TOTAL STOCK VALUE:  $14,600   |
|  NET WORTH:          $27,000   |
|                                |
+--------------------------------+
|  BUY STOCKS (3 remaining)      |
|  +--------------------------+  |
|  | [LUX +] $800   12 avail  |  |
|  | [AME +] $600    8 avail  |  |
|  | [FES +] $400   15 avail  |  |
|  | [CON +] $1000   3 avail  |  |
|  +--------------------------+  |
|                                |
|  Cart: AME x1, CON x2 = $2,600 |
|                                |
|  [    CONFIRM PURCHASE    ]    |
|  [        SKIP BUY        ]    |
+--------------------------------+

+--------------------------------+
|  YOUR TILES                    |
|  +--+  +--+  +--+  +--+  +--+  +--+
|  |3B|  |7D|  |9F|  |2A|  |11C| |5E|
|  +--+  +--+  +--+  +--+  +--+  +--+
|   ok   FOUNDS  ok   ok  MERGE  ok
+--------------------------------+
```

### Key Elements:
- **Cash always visible** top right
- **Portfolio** shows owned stocks with current value
- **Net worth calculation** prominent
- **Buy interface** shows price, availability, running total
- **Tile rack** at bottom with placement preview hints
- **Dense but scannable** - Bloomberg terminal energy

---

## Phone - Tile Placement Preview

```
+--------------------------------+
|  ACQUIRE          $12,400  [i] |
+--------------------------------+
|  YOUR TURN - PLACE TILE        |
+--------------------------------+
|                                |
|  SELECT A TILE TO PLAY         |
|                                |
|  +--+  +--+  +--+  +--+  +--+  +--+
|  |3B|  |7D|  |9F|  |2A|  |11C| |5E|
|  +--+  +--+  +--+  +--+  +--+  +--+
|                                |
+--------------------------------+
|  SELECTED: 7D                  |
|  +---------------------------+ |
|  | RESULT: FOUNDS NEW CHAIN  | |
|  |                           | |
|  | Connects 2 orphan tiles   | |
|  | You will choose a chain   | |
|  | and receive 1 free stock  | |
|  +---------------------------+ |
|                                |
|  [     PLACE TILE 7D      ]    |
|  [        CANCEL          ]    |
+--------------------------------+
```

---

## Phone - Merger Resolution

```
+--------------------------------+
|  ACQUIRE          $12,400  [i] |
+--------------------------------+
|  !! MERGER IN PROGRESS !!      |
+--------------------------------+
|                                |
|  CONTINENTAL acquires FESTIVAL |
|                                |
|  +---------------------------+ |
|  | CONTINENTAL  15 tiles [P] | |
|  | FESTIVAL      4 tiles     | |
|  +---------------------------+ |
|                                |
|  YOUR FESTIVAL STOCK: 2 shares |
|                                |
|  +---------------------------+ |
|  | HOLD    Keep for later    | |
|  |         (chain may return)| |
|  +---------------------------+ |
|  | SELL    2 x $400 = $800   | |
|  +---------------------------+ |
|  | TRADE   2:1 for CON       | |
|  |         Get 1 CON ($1000) | |
|  +---------------------------+ |
|                                |
|  Selected: SELL 2             |
|                                |
|  [     CONFIRM DECISION    ]   |
+--------------------------------+
```

---

## Phone - Player Trading Interface

The game supports player-to-player trading of stocks and money. This is a side-channel negotiation system.

### Proposing a Trade

```
+--------------------------------+
|  ACQUIRE          $12,400  [i] |
+--------------------------------+
|  TRADES                   [+]  |
+--------------------------------+
|                                |
|  NEW TRADE                     |
|                                |
|  TRADE WITH:                   |
|  +---------------------------+ |
|  | ( ) ALICE     $12,400     | |
|  | (o) BOB       $8,200      | |
|  | ( ) CAROL     $15,100     | |
|  +---------------------------+ |
|                                |
|  YOU OFFER:                    |
|  +---------------------------+ |
|  | Cash:    [$____500____]   | |
|  | LUX:     [- 0 +]          | |
|  | AME:     [- 2 +]          | |
|  | CON:     [- 0 +]          | |
|  +---------------------------+ |
|  Your offer: $500 + 2 AME     |
|                                |
|  YOU RECEIVE:                  |
|  +---------------------------+ |
|  | Cash:    [$___1000____]   | |
|  | LUX:     [- 1 +]          | |
|  | FES:     [- 0 +]          | |
|  +---------------------------+ |
|  You get: $1000 + 1 LUX       |
|                                |
|  [    PROPOSE TRADE     ]      |
|  [       CANCEL         ]      |
+--------------------------------+
```

### Pending Trades View

```
+--------------------------------+
|  ACQUIRE          $12,400  [i] |
+--------------------------------+
|  TRADES                   [+]  |
+--------------------------------+
|                                |
|  INCOMING (1)                  |
|  +---------------------------+ |
|  | FROM: BOB                 | |
|  | You give: $500 + 2 AME    | |
|  | You get:  $1000 + 1 LUX   | |
|  |                           | |
|  | [ACCEPT]  [REJECT]        | |
|  +---------------------------+ |
|                                |
|  OUTGOING (1)                  |
|  +---------------------------+ |
|  | TO: CAROL                 | |
|  | You give: 3 CON           | |
|  | You get:  $2500           | |
|  |                           | |
|  | [CANCEL]    pending...    | |
|  +---------------------------+ |
|                                |
+--------------------------------+
```

### Trade Notification (Toast)

```
+--------------------------------+
| +----------------------------+ |
| |  NEW TRADE from BOB    [x] | |
| |  Tap to view               | |
| +----------------------------+ |
+--------------------------------+
```

### Trade Completed (Toast)

```
+--------------------------------+
| +----------------------------+ |
| |  TRADE ACCEPTED            | |
| |  -$500 -2 AME  +$1000 +LUX | |
| +----------------------------+ |
+--------------------------------+
```

### Key Design Decisions:
- **Accessible anytime** - [+] button always visible in header
- **Clear what you give vs get** - two distinct sections
- **Real-time validation** - can't offer stocks you don't have
- **Notification system** - toast alerts for incoming trades
- **No blocking** - trades happen alongside normal gameplay

---

## Animation Guidelines

### Merger Animation (THE BIG MOMENT)
1. **Announcement** - "MERGER!" text pulses twice
2. **Chain highlight** - Acquiring chain glows briefly
3. **Tile absorption** - Defunct chain tiles flip one-by-one to new color (0.1s each)
4. **Bonus payout** - Numbers tick up for majority/minority holders
5. **Stock removal** - Defunct stock count fades to zero

### Chain Founding Animation
1. **Tile connection** - Connected tiles pulse
2. **Chain birth** - New chain color spreads from center tile outward
3. **Logo reveal** - Small chain logo appears briefly
4. **Free stock** - "+1 [CHAIN]" floats up from founder's name

### Stock Purchase Animation
- **Subtle**: Stock count ticks up, cash ticks down
- **Sound**: Soft "cha-ching" or typewriter click

### Turn Transition
- Current player indicator slides smoothly
- Subtle pulse on new active player's name

### NO Animation For:
- Regular tile placement (just appears)
- Drawing new tiles
- Small state updates

---

## Interaction Patterns

### Tile Selection (Phone)
1. Tap tile in rack - tile lifts slightly, shows preview
2. Tap again or "Place" button - confirms placement
3. Tap different tile - switches selection

### Stock Buying (Phone)
1. Tap [+] on chain row - adds to cart (up to 3 total)
2. Running total updates instantly
3. "Confirm" sends purchase

### Merger Decisions (Phone)
1. Radio-style selection (HOLD/SELL/TRADE)
2. Can split: "SELL 1, TRADE 2" if applicable
3. Clear preview of outcome before confirming

---

## Responsive Considerations

### TV/Host Screen
- Optimized for 1080p display at ~10ft viewing distance
- Large text, high contrast
- Works on any modern browser

### Phone/Player Screen
- Mobile-first, 375px minimum width
- Touch targets minimum 44px
- Single-column layout
- Bottom-anchored action buttons (thumb-friendly)

---

## Sound Design Notes (Future)

While visuals are the focus, the aesthetic suggests:
- **Ambient**: Low hum of trading floor, subtle
- **Tile place**: Soft click
- **Stock buy**: Cash register "ding" (muted)
- **Merger**: Dramatic chord + ticker tape sound
- **Chain found**: Ascending chime
- **Your turn**: Subtle notification ping

---

## Implementation Priority

### Phase 1: Foundation
- [ ] Dark theme CSS variables
- [ ] Monospace typography system
- [ ] Basic board grid with coordinate labels
- [ ] Player list component

### Phase 2: Core Interactions
- [ ] Tile rack with selection states
- [ ] Stock purchase interface
- [ ] Merger decision modal
- [ ] Chain color system

### Phase 3: Polish
- [ ] Chain pixel logos (8x8)
- [ ] Merger animation sequence
- [ ] Chain founding animation
- [ ] Sound effects integration

### Phase 4: Refinement
- [ ] Accessibility audit
- [ ] Performance optimization
- [ ] Cross-browser testing
- [ ] User testing feedback

---

## Quick Reference

| Aspect | Decision |
|--------|----------|
| Style | Modern pixel art (no CRT effects) |
| Theme | Dark, muted colors, easy on eyes |
| Typography | Monospace throughout |
| Personality | Minimal & clean |
| TV Screen | Public scoreboard, letter-code tiles |
| Phone Screen | Private trading terminal (Bloomberg vibes) |
| Chain Identity | 7 muted colors + 8x8 pixel logos |
| Animation | Moderate - mergers & founding are impactful |

---

*Design direction: Modern pixel meets Bloomberg terminal. Dark, muted, minimal, information-dense. Mergers are the dramatic moment. The phone is your private trading desk.*
