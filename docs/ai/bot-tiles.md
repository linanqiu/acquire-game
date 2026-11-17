# How the rules-based bot picks a tile

Story: [LO-012](../roadmap/stories/09-llm-opponents/LO-012.md). Code:
`backend/game/tile_value.py` (`tile_valuation`), used by `Bot._score_tile` in
`backend/game/bot.py` and the pick in `backend/agents/heuristic.py` (`pick_tile`). Bot
generations: [bot-versions.md](bot-versions.md) (this is bot **v2**; v1 is the old rule, still
playable as `bot:v1`; the default bot is now v8, which keeps this tile rule).

Owner (2026-11-17), with a phone screenshot: "Bots keep doing suicide merge moves like this." A
bot placed 7C and merged a 3-tile chain into a 4-tile one. It held none of the smaller chain: the
merger paid one rival $4,000 (majority), the human $2,000 (minority) and the bot nothing.

## Why it happened (v1)

`Bot._score_tile` gave a merging tile `30 + 3 x survivor shares` if the bot held any survivor
shares and `20 + 2 x defunct shares` if it held any defunct shares, otherwise 0. It never looked
at who collects the bonuses (holding shares but ranking third pays nothing), never subtracted
what rivals receive, and on "medium" (the default) the bot picked uniformly at random among the 3
best-scored tiles. A merger scored 0 that hands rivals $6,000 was exactly as likely as a lone
tile scored 0.

## The tile value (v2)

One pure function, `tile_valuation(game, tile, viewer_id)`, deterministic, public information
plus the bot's own tile. It reuses `Rules.get_placement_result`, `Rules.get_merger_survivor`,
`Rules.calculate_bonuses` (through the calculator's helpers) and the calculator's board
simulation, so no rule is written twice. It returns every player's **gain** in money from the
tile, then

```
score = my gain - LAMBDA x sum over rivals of rival weight x max(0, rival gain)
```

| Effect | Gain of each player |
|---|---|
| Merge | For each defunct chain: the bonuses the engine pays at its size before the merger, in full (cash in hand now; ties split as the engine does). Plus the trade surplus of each holder for whom trading into the survivor (post-merger price) beats selling; the survivor's bank stock is used up in the engine's order, the maker first, so the maker trades at the best moment. Plus the survivor's growth (below), with the traded shares. Survivor by the engine's rule; when it is the placer's choice (tie), the best one for the bot. |
| Grow a chain | The chain's growth (below). |
| Found | The bot only: the free founder's share at the new chain's price plus 25 % (`FOUND_POSITION_FACTOR`) of the bonuses a sole holder would get at that size (a race it leads, but one rivals can contest). Best chain still available. |
| Lone tile | 0 |

**Growth** of a chain to its new size, for a player holding `h` shares (`h'` after merger
trades): `h x price change + w x (bonus after - bonus before)`, plus 25 % (`SAFE_LOCK_FACTOR`) of
the bonus after when the tile makes the chain safe (the race is locked: good for whoever holds
its bonus positions, bad for me when that is a rival). `w` is the trade valuation's bonus weight
(0.9 for a chain that can still be absorbed; 0.5 -> 0.9 with game progress for a safe one).

**Rival weight**: 0.5 for a rival behind the bot, 0.75 for one ahead of it, 1.0 for the table
leader (when that is not the bot); 1.0 for the only rival of a two-player game. "Behind/ahead" is
worth = cash + shares at current prices + the bonuses every chain would pay now. `LAMBDA` = 1.0.
In this game helping one rival more than yourself loses ground, so an equal split with the leader
is about neutral, an equal split with someone behind is a clear plus.

So:

- a merger that pays only rivals is clearly negative (the screenshot: about -$9,900 for the bot,
  test `test_merger_that_pays_only_rivals_scores_clearly_negative`);
- a merger that pays the bot the majority while rivals get less stays clearly positive;
- growing a chain where only rivals hold shares is negative when it moves the price or a bonus
  bracket, and more so when it makes the chain safe;
- founding is worth roughly $700-2,000; growing a chain the bot leads, about the same.

All constants are at the top of `tile_value.py`.

## The pick

- **hard**: the best score (the first in hand order on a tie).
- **medium**: a random tile among those within `MEDIUM_TILE_MARGIN` ($100) of the best, never a
  negative tile while a non-negative one exists. Several lone tiles at 0 still vary.
- Every tile harmful: both take the least harmful.
- **easy**: unchanged, a random legal tile (that is its purpose).

## Results

Self-play, 4 seats, final seed range 100001-100060 (600 games: per seed 2 games of 2v2 in both
alternating seatings and 8 games of 1v3, the single seat in each position, both ways), medium;
from `python -m bench.bot_tournament v2 v1 --seeds 100001-100060`. See
[bot-versions.md](bot-versions.md) for the numbers.

## Limits

- One move deep: the value does not count what rivals can do with the new board next turn (a
  chain one tile from safe, a merger the bot sets up for a rival).
- The founding value assumes the best chain still available; the bot's chain choice is a separate
  rule.
- The survivor choice on a tie is still the old rule (most own shares); the tile value assumes the
  best survivor for the bot, which is usually the same chain.
- Rules-based seats only. LLM seats get the reasoning in the strategy playbook and the
  "pays only rivals" mark on merging tiles (prompt v10, see [strategy-playbook.md](strategy-playbook.md)).
