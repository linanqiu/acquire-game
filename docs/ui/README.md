# Acquire UI Documentation

> Complete design documentation for the Acquire board game frontend.

## Overview

This directory contains everything needed to implement the Acquire frontend:

| Document | Purpose |
|----------|---------|
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | Visual language: colors, typography, spacing, animation |
| [STORYBOARD.md](./STORYBOARD.md) | All screens, wireframes, states, and user flows |
| [COMPONENTS.md](./COMPONENTS.md) | Reusable UI component specifications |

## Design Philosophy

**"Bloomberg terminal meets modern pixel art"**

- Dark, muted, easy on the eyes
- Monospace typography throughout
- Information-dense, no wasted space
- Data is the decoration
- Clean pixel aesthetic (no CRT effects)

## Target Devices

| View | Device | Optimized For |
|------|--------|---------------|
| Player View | Mobile phone | Touch, private info, quick decisions |
| Host View | TV / Laptop | 10ft viewing, public scoreboard, spectators |

## Quick Reference

### Pages

| Page | URL | Description |
|------|-----|-------------|
| Lobby | `/` | Create or join a game |
| Player View | `/play/{room}` | Private player terminal |
| Host View | `/host/{room}` | Shared TV display |

### Color Palette (Chain Colors)

```
LUXOR:       #c9a227  (muted gold)      - Budget
TOWER:       #7a5c3d  (brown/bronze)    - Budget
AMERICAN:    #5e7a8a  (slate blue)      - Standard
FESTIVAL:    #8a5e7a  (dusty mauve)     - Standard
WORLDWIDE:   #5e8a6a  (sage green)      - Standard
CONTINENTAL: #8a3d3d  (burgundy)        - Premium
IMPERIAL:    #3d5e8a  (deep blue)       - Premium
```

### Game Flow Summary

```
Player Turn:
  1. TRADE (optional) - propose trades with other players
  2. PLACE TILE (mandatory) - play one tile from hand
  3. BUY STOCKS (optional) - purchase 0-3 shares
  4. DRAW TILE (automatic) - replenish hand to 6
```

## Implementation Status

- [ ] Design System CSS variables
- [ ] Lobby page
- [ ] Player View shell
- [ ] Host View shell
- [ ] Trading interface
- [ ] Tile placement
- [ ] Chain founding modal
- [ ] Merger resolution flow
- [ ] Stock buying cart
- [ ] End game screens
- [ ] Reconnection handling
- [ ] Error states
