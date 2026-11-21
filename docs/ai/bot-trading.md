# How the rules-based bot judges a trade offer

Story: [LO-010](../roadmap/stories/09-llm-opponents/LO-010.md). Code:
`backend/game/trade_value.py` (`trade_valuation`), used by `backend/agents/heuristic.py`
(`_trade_response`) and shown to LLM seats by `render_trade` in `backend/agents/llm/prompt.py`.

Owner (2026-11-16): "Can you make trading with the rules based bots smarter? They trade valuable
assets at face value without considering majority minority etc."

Before, the bot compared both sides of an offer at current share prices and accepted when it
received more. A player could buy the bot's majority in a chain, or the shares that decide a
coming merger bonus, for their list price plus a dollar.

## The valuation

One pure function, `trade_valuation(game, trade, viewer_id)`, built from public information only
(prices, holdings, cash, bank stock, the board). It reuses the calculator's helpers and
`Rules.calculate_bonuses`, so no rule is written twice. It values a player's position as

```
worth = cash
      + shares x share value           (every chain)
      + bonus weight x bonus if the chain were bought out now   (every active chain)
```

and a trade as *worth after the trade minus worth before*, for both sides.

| Part | Value |
|---|---|
| Share of an active chain | its current price |
| Share of an active chain the bank has run out of | price + 10 % (it cannot be bought back) |
| Share of a chain that is not on the board | 10 % of the price it would have if founded again |
| Bonus | what `Rules.calculate_bonuses` would pay that player now, ties split as the engine does |
| Bonus weight, chain not safe | 0.9: it can be absorbed, and paid, at any time |
| Bonus weight, safe chain | 0.5 at the start of the game rising in a straight line to 0.9 as the board fills (share of board tiles placed): it pays only at the end, and the race can still move |

So selling the shares that hold a majority costs the majority bonus (less whatever position is
left), and a share that wins a position counts for that bonus.

**The other side.** What the proposer gains is a loss relative to that rival:

```
adjusted gain = my change - rival weight x max(0, their change)
```

Rival weight is 1.0 when the other side is ahead of the bot in net worth (cash + shares at list
prices) or the game has two players; otherwise 0.5, because with several opponents a gain for one
of them is only partly a loss for the bot.

**The answer.** Accept when the trade is valid (`Rules.validate_trade`), the adjusted gain is
positive and it is at least the margin: 5 % of the trade's size at list prices (the larger side),
10 % when the other side is ahead. Otherwise reject. No randomness. The bot still never proposes
trades.

All constants are at the top of `trade_value.py`.

### Example

A two-tile chain at $200 a share (bonuses $2,000 / $1,000). The bot holds 3 shares (sole
majority), Ann 2 (minority), Cara 1. Ann offers $400 for 2 shares.

- At list prices: give $400, get $400.
- Bot: 3 -> 1 share, sole majority -> tied minority: $2,000 -> $500, weighted -$1,350.
- Ann: 2 -> 4 shares, minority -> sole majority: $1,000 -> $2,000, weighted +$900.
- Adjusted gain: -1,350 - 0.5 x 900 = -$1,800. Rejected.
- At $1,750 ($400 + $1,350) the bot's own loss is just covered, and Ann, paying that much, no
  longer gains: adjusted gain $0, still rejected. From $1,900 the bot's gain ($150) clears the
  5 % margin ($95) and it accepts.
- Had Ann been ahead of the bot, the margin would be 10 % and anything she still gained would
  count against the trade in full.

## Where the numbers go

- **Calculator pack**: `calc["trades"][trade_id]` holds the valuation of every open offer the
  viewer is a party to, from the viewer's side. The bot reads `acceptable`.
- **LLM prompt**: the offer block of a `trade_response` decision adds one line from the same
  dict: "At list prices: give $X, get $Y. Counting bonus positions ...: net -$1,350 for you
  (bonuses -$1,350), +$900 for Ann (bonuses +$900). Bonus positions that change: you in
  sandpiper: sole majority -> tied for minority; ..." The playbook's "Trade offer" line carries
  the reasoning ([strategy-playbook.md](strategy-playbook.md)).
- **Clients (not done)**: the result is a plain JSON-serialisable dict (`list`, `viewer`,
  `counterparty`, `rank_changes`, `chains`, `adjusted_gain`, `margin`, `acceptable`), so it can be
  added to `game_state` for the trade screens later without change.

**Benchmark.** The bot is the baseline of Buyout Bench. Its trade answers changed together with
`PROMPT_BUILDER_VERSION` 6 -> 7, and the leaderboard never mixes prompt versions, so results from
before and after this change are kept apart.

## Self-play check

Three rules-based seats, seeds 1-10, each seat in turn played by a "sniper" (30 games per row).
The sniper plays like the bot, but before placing a tile it offers list price + $100 for the
shares behind the other seats' bonus positions when those are about to be paid: the chains of a
merger it can set off this turn (it then sets it off), or every chain when the game can be ended.

| Bots answer with | Sniper's final score | Margin over the other seats | Wins | Mean rank | Offers accepted |
|---|---|---|---|---|---|
| (no offers made) | $40,297 | $0 | 10/30 | 2.00 | |
| list prices (before) | $49,503 | +$16,140 | 19/30 | 1.47 | 116 of 116 |
| position-aware (now) | $40,273 | +$187 | 10/30 | 2.00 | 3 of 240 |

The three offers still accepted moved no bonus position (the sniper could not afford enough
shares to change one), so list price + $100 was a fair price for them.

The script is throwaway (not in the repo): it drives `build_context` ->
`HeuristicAgent.choose` -> `apply_action` like `tests/support/drive.py`, with the old answer
re-implemented in a subclass for the "before" row.

## What the player is shown (BL-021)

The trade composer asks the server what a draft would do before it is sent
(`POST /api/room/{room}/trade-preview/{player}`, `game.trade_value.trade_preview`). For a draft
addressed to a rules-based seat the answer includes the bot's verdict: `acceptable` (the same
`trade_valuation(...)["acceptable"]` the seat answers with) and `cash_needed`, the least extra
cash, in $100 steps, that would make it acceptable (`cash_to_accept`: first less cash asked of the
bot, then more offered; `None` when all the proposer's cash would not do). The page prints "Bob
(bot) would accept", "would refuse: about $300 short" with a button that adds it, or "would
refuse, even for all your cash".

This gives away nothing a player could not already find out: the rule is this page, it has no
randomness, and an offer costs nothing to make, so proposing and re-proposing finds the same
price. No verdict is ever given for an LLM or a human seat. The preview is built from public
information only and proposes nothing.

## Tests

- Tier 1, `backend/tests/test_trade_preview.py`: the verdict shown equals the answer the seat then
  gives to the same offer through `apply_action` (a sweep of prices, and random offers during bot
  games); `cash_needed` is exact (one step less is refused); drafts are refused in
  `apply_action`'s own words; position changes name third players.
- Tier 2, `backend/tests/protocol/test_trade_preview.py`: the route over HTTP, then the same
  offers over the WebSocket, answered as the preview said; a preview proposes nothing.

- Tier 1, `backend/tests/test_trade_value.py`: positions reached by scripted real play
  (`tests/support/table.py`) or by games the bot plays; offers proposed and answered through
  `apply_action`. Majority and minority at face value (reject) and at a covering price (accept),
  shares with no position (face value plus margin), a share that hands the proposer a majority,
  richer versus poorer proposer, overpayment, cash asked of the bot, share-for-share swaps, stale
  offers (never accepted), sold-out and off-board chains, random offers during bot games.
- Tier 2, `backend/tests/protocol/test_trades.py`: a human over the WebSocket plays to a position
  where a bot holds a sole majority, offers list price (rejected), then a covering price
  (accepted).
- `backend/tests/test_llm_prompt.py`: the offer line and the playbook paragraph.

## Known limits

- The valuation looks at positions as they stand. It does not see that selling two shares of a
  five-share lead (no position changes, so list price plus margin is enough) makes the lead
  easier to overtake from the bank next turn.
- Bonus weights are fixed numbers, not a forecast of which chain will be absorbed.
- The bot does not weigh its own need for cash (an offer that takes its cash is judged like any
  other).
- The bot does not propose trades or make competing offers.
