# Buyout Rules

These documents describe how a game of **Buyout** is played: players place tiles on a grid,
found hotel chains, buy shares in them, and profit when chains merge. The engine in
`backend/game/` implements exactly these rules; this is the reference its tests are checked
against.

> **Numbers in these documents describe the `default` ruleset** (theme "Grand Hotels").
> The server's board size, chain names and tiers, price table, bonuses, share counts,
> starting cash, hand size, purchase limit, safe/end-game sizes, founder bonus, trade ratio
> and player counts all come from a ruleset file (`backend/rulesets/<name>.json`, selected
> with `GAME_RULESET`); other rulesets (e.g. `valley`, `mini`) change those numbers and
> names but not the flow of play described here. See the "Ruleset" section of
> `docs/architecture/seat-contract.md`.

## At a glance

- **Players**: 3-6
- **Length**: about 60-90 minutes with humans; a few seconds with bots only
- **Board**: 12 columns x 9 rows, one tile per square (108 tiles)

## Goal

Finish with the most money. Money comes from cash on hand, shares sold at the end, and the
bonuses paid to the largest and second-largest shareholders of a chain when it is absorbed in a
merger or when the game ends.

---

## Contents

### 1. [Setup](setup.md)
- What each player starts with ($6,000 and 6 tiles)
- Deciding who goes first

### 2. [Turn sequence](gameplay.md)
- Trade (optional), place a tile, buy shares, draw a tile
- Trading between players

### 3. [Placing tiles](tiles.md)
- The 12x9 board
- What a placed tile can do
- Tiles that cannot be played, and replacing them

### 4. [Hotel chains](chains.md)
- The seven chains and their price tiers
- Founding a chain and the founder's free share
- Growing a chain; safe chains (11+ tiles)

### 5. [Mergers](mergers.md)
- When a merger happens and which chain survives
- Largest and second-largest shareholder bonuses, and ties
- Selling, trading or keeping shares of the absorbed chain
- Mergers of three or four chains

### 6. [Buying shares](stocks.md)
- Up to 3 shares per turn, 25 per chain in the bank

### 7. [End of the game](endgame.md)
- When the game may be ended
- Final bonuses and selling every share
- The winner

### 8. [Prices and bonuses](pricing.md)
- Share price by chain size and tier
- Bonus tables

---

## The seven hotel chains (default ruleset)

| Tier | Chains | Share price at 2 tiles |
|------|--------|------------------------|
| **Cheap** | Sandpiper, Marlowe | $200 |
| **Medium** | Halcyon, Meridian, Juniper | $300 |
| **Expensive** | Obsidian, Aurelia | $400 |

---

## Summary

1. **Start**: everyone has $6,000 and 6 tiles.
2. **Turn**: trade with other players if you like, place 1 tile, buy up to 3 shares, draw 1 tile.
3. **Found**: a tile that joins loose tiles into a group of 2+ founds a chain; the founder gets 1 free share.
4. **Merge**: a tile that joins two or more chains merges them; the largest survives and the shareholders of the others are paid bonuses.
5. **Safe**: a chain of 11+ tiles can no longer be absorbed.
6. **End**: the game may be ended once a chain has 41+ tiles, or every chain on the board is safe.
7. **Win**: the most money after final bonuses and selling all shares.
