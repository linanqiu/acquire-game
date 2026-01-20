# Acquire Design System

> Visual language for the Acquire frontend: colors, typography, spacing, animation, and patterns.

---

## Design Philosophy

### Core Principles

1. **Information Density Over Decoration**
   - Every pixel serves a purpose
   - Data is the aesthetic
   - No ornamental flourishes that don't convey game state

2. **Dark & Easy on the Eyes**
   - Deep charcoal backgrounds
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

```css
--bg-primary:    #1a1a2e;  /* deep navy-charcoal */
--bg-secondary:  #16213e;  /* slightly lighter for cards/panels */
--bg-tertiary:   #0f0f1a;  /* darkest, for depth */
--border:        #2a2a4a;  /* subtle separation */
```

### Text Palette

```css
--text-primary:   #e8e8e8;  /* off-white, easy on eyes */
--text-secondary: #8888aa;  /* muted for labels */
--text-accent:    #ffffff;  /* pure white for emphasis only */
--text-negative:  #ff6b6b;  /* muted red for losses/warnings */
--text-positive:  #6bff8a;  /* muted green for gains */
```

### Hotel Chain Colors

Each chain has a distinct, muted color for tiles and UI elements:

| Chain | Hex | CSS Variable | Tier |
|-------|-----|--------------|------|
| LUXOR | `#c9a227` | `--chain-luxor` | Budget |
| TOWER | `#7a5c3d` | `--chain-tower` | Budget |
| AMERICAN | `#5e7a8a` | `--chain-american` | Standard |
| FESTIVAL | `#8a5e7a` | `--chain-festival` | Standard |
| WORLDWIDE | `#5e8a6a` | `--chain-worldwide` | Standard |
| CONTINENTAL | `#8a3d3d` | `--chain-continental` | Premium |
| IMPERIAL | `#3d5e8a` | `--chain-imperial` | Premium |

### Chain Abbreviations

For compact displays (tiles, logs):

| Chain | 3-Letter | 2-Letter |
|-------|----------|----------|
| LUXOR | LUX | LX |
| TOWER | TWR | TW |
| AMERICAN | AME | AM |
| FESTIVAL | FES | FE |
| WORLDWIDE | WOR | WO |
| CONTINENTAL | CON | CO |
| IMPERIAL | IMP | IM |

### Chain Pixel Logos (8x8)

Each chain has a tiny pixel icon for visual identification:

| Chain | Icon Shape |
|-------|------------|
| LUXOR | Pyramid silhouette |
| TOWER | Simple tower shape |
| AMERICAN | Star |
| FESTIVAL | Flag/banner |
| WORLDWIDE | Globe outline |
| CONTINENTAL | Mountain peaks |
| IMPERIAL | Crown |

---

## Typography

### Font Stack

```css
--font-primary: "IBM Plex Mono", "Fira Code", "Consolas", monospace;
--font-pixel: "Press Start 2P", monospace; /* optional, for headers */
```

### Type Scale

| Name | Size | Usage |
|------|------|-------|
| XL | 24px | Phase announcements, winner declaration |
| LG | 18px | Section headers, player names |
| MD | 14px | Stock prices, tile labels, body text |
| SM | 12px | Secondary info, timestamps |
| XS | 10px | Fine print, helper text |

```css
--text-xl: 24px;
--text-lg: 18px;
--text-md: 14px;
--text-sm: 12px;
--text-xs: 10px;
```

### Font Weights

```css
--font-normal: 400;
--font-medium: 500;
--font-bold: 700;
```

---

## Spacing

### Base Unit

All spacing derives from a 4px base unit:

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
```

### Component Spacing Guidelines

| Context | Spacing |
|---------|---------|
| Button padding | `--space-2` horizontal, `--space-1` vertical |
| Card padding | `--space-4` |
| Section gap | `--space-6` |
| Modal padding | `--space-6` |
| List item gap | `--space-2` |
| Input padding | `--space-2` |

---

## Borders & Shadows

### Border Radius

```css
--radius-sm: 2px;   /* buttons, inputs */
--radius-md: 4px;   /* cards, modals */
--radius-lg: 8px;   /* large containers */
--radius-full: 9999px; /* pills, badges */
```

### Border Styles

```css
--border-width: 1px;
--border-style: solid;
--border-default: var(--border-width) var(--border-style) var(--border);
```

### Shadows

Keep shadows minimal - the dark theme provides natural depth:

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
--shadow-md: 0 4px 8px rgba(0, 0, 0, 0.4);
--shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.5);
```

---

## Interactive States

### Buttons

| State | Style |
|-------|-------|
| Default | `--bg-secondary`, `--text-primary` |
| Hover | Lighten background 10%, subtle transition |
| Active | Darken background 5% |
| Disabled | 50% opacity, no cursor |
| Focus | 2px outline with chain color or accent |

### Form Inputs

| State | Style |
|-------|-------|
| Default | `--bg-tertiary` background, `--border` border |
| Focus | Border color changes to accent |
| Error | Border color changes to `--text-negative` |
| Disabled | 50% opacity |

### Tiles (Player Rack)

| State | Visual |
|-------|--------|
| Default | Solid tile with coordinate label |
| Selected | Elevated (shadow), highlighted border |
| Playable | Normal appearance |
| Will Trigger Merger | Warning indicator (!! or exclamation) |
| Temporarily Unplayable | Dimmed, lock icon |
| Permanently Unplayable | Crossed out, offer replacement |

---

## Animation Guidelines

### Timing Functions

```css
--ease-default: cubic-bezier(0.4, 0, 0.2, 1);
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-out: cubic-bezier(0, 0, 0.2, 1);
--ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
```

### Duration Scale

```css
--duration-fast: 100ms;    /* micro-interactions */
--duration-normal: 200ms;  /* state changes */
--duration-slow: 400ms;    /* emphasis animations */
--duration-dramatic: 800ms; /* merger effects */
```

### Animation Hierarchy

**DO animate:**
- Merger sequences (the dramatic moment)
- Chain founding effects
- Turn transitions
- Number changes (cash, stocks)
- Modal entrances/exits

**DON'T animate:**
- Regular tile placement (just appears)
- Drawing new tiles
- Minor state updates
- Scrolling/navigation

### Key Animations

#### Merger Animation (THE BIG MOMENT)
1. **Announcement** - "MERGER!" text pulses twice
2. **Chain highlight** - Acquiring chain glows briefly
3. **Tile absorption** - Defunct chain tiles flip one-by-one to new color (0.1s each)
4. **Bonus payout** - Numbers tick up for majority/minority holders
5. **Stock removal** - Defunct stock count fades to zero

#### Chain Founding Animation
1. **Tile connection** - Connected tiles pulse
2. **Chain birth** - New chain color spreads from center tile outward
3. **Logo reveal** - Small chain logo appears briefly
4. **Free stock** - "+1 [CHAIN]" floats up from founder's name

#### Number Ticker
- Cash and stock counts use a counting animation
- Rapid tick-up effect for bonuses
- Subtle for purchases

#### Turn Transition
- Current player indicator slides smoothly
- Subtle pulse on new active player's name

---

## Responsive Design

### Breakpoints

```css
--breakpoint-sm: 375px;   /* small phones */
--breakpoint-md: 768px;   /* tablets */
--breakpoint-lg: 1024px;  /* laptops */
--breakpoint-xl: 1280px;  /* desktops/TVs */
```

### Touch Targets

Minimum touch target size: **44x44px**

### Player View (Phone)
- Mobile-first, 375px minimum width
- Single-column layout
- Bottom-anchored action buttons (thumb-friendly)
- Swipe gestures for navigation (if applicable)

### Host View (TV)
- Optimized for 1080p display at ~10ft viewing distance
- Minimum font size: 18px for body, 24px for headers
- High contrast for readability
- Large click/touch targets

---

## Iconography

### Style Guidelines
- 16x16 or 24x24 base sizes
- Single-color, uses text color
- Pixel-perfect at small sizes
- Consistent stroke width

### Core Icons

| Icon | Usage |
|------|-------|
| Crown | Majority holder, winner |
| Medal (2nd) | Minority holder |
| Lock | Unplayable tile |
| X | Permanently dead tile, decline |
| Check | Completed, accept |
| Arrow Right | Continue, next |
| Plus | Add stock, add bot |
| Minus | Remove stock |
| Spinner | Loading, waiting |
| Warning | Merger trigger, caution |

---

## Component Patterns

### Cards
- Background: `--bg-secondary`
- Border: `--border-default`
- Padding: `--space-4`
- Border radius: `--radius-md`

### Modals
- Centered overlay
- Background: `--bg-secondary`
- Max width: 400px (phone), 600px (TV)
- Backdrop: `rgba(0, 0, 0, 0.7)`

### Toasts/Notifications
- Bottom or top positioned
- Auto-dismiss after 3-5 seconds
- Slide in/out animation
- Categories: info, success, warning, error

### Tables
- Monospace alignment
- Alternating row backgrounds (subtle)
- Header row: `--text-secondary`
- Horizontal rules: `--border`

---

## Accessibility

### Color Contrast
- Minimum 4.5:1 for normal text
- Minimum 3:1 for large text
- Test all chain colors against backgrounds

### Focus States
- Visible focus ring on all interactive elements
- 2px outline, offset by 2px
- Uses accent color

### Screen Reader Support
- Semantic HTML structure
- ARIA labels for interactive elements
- Announce game state changes

### Reduced Motion
- Respect `prefers-reduced-motion`
- Provide instant state changes as alternative

---

## Sound Design (Future)

Placeholder specifications for audio feedback:

| Event | Sound Type |
|-------|-----------|
| Tile placed | Soft click |
| Stock purchased | Cash register ding (muted) |
| Your turn | Notification ping |
| Merger announced | Dramatic chord |
| Chain founded | Ascending chime |
| Trade received | Alert tone |
| Game over | Fanfare (winner) |

All sounds should be:
- Optional (mutable)
- Subtle, not jarring
- Consistent with "trading floor" aesthetic

---

## CSS Variable Summary

```css
:root {
  /* Colors - Background */
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --bg-tertiary: #0f0f1a;
  --border: #2a2a4a;

  /* Colors - Text */
  --text-primary: #e8e8e8;
  --text-secondary: #8888aa;
  --text-accent: #ffffff;
  --text-negative: #ff6b6b;
  --text-positive: #6bff8a;

  /* Colors - Chains */
  --chain-luxor: #c9a227;
  --chain-tower: #7a5c3d;
  --chain-american: #5e7a8a;
  --chain-festival: #8a5e7a;
  --chain-worldwide: #5e8a6a;
  --chain-continental: #8a3d3d;
  --chain-imperial: #3d5e8a;

  /* Typography */
  --font-primary: "IBM Plex Mono", "Fira Code", "Consolas", monospace;
  --text-xl: 24px;
  --text-lg: 18px;
  --text-md: 14px;
  --text-sm: 12px;
  --text-xs: 10px;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  /* Borders */
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 8px;

  /* Animation */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 400ms;
}
```
