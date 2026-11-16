# Strategy playbook for LLM seats

Story: [LO-009](../roadmap/stories/09-llm-opponents/LO-009.md). Code: the "Strategy playbook"
section of the system prompt and the calculator renderers in `backend/agents/llm/prompt.py`; the
numbers behind them in `backend/game/calculator.py`.

Owner (2026-11-15): "The LLMs have quite a bit of trouble strategizing, so you may need to make a
strategy rubric or something like a crash course for it. Otherwise it keeps making stupid
mistakes."

The fix is better information and guidance only: no extra model calls, no higher thinking effort,
no larger answers.

## Method

1. Baseline: `bench-v1`, track `vs-baseline` (one LLM seat against three rules-based bots), Claude
   Haiku 5.5, the first 24 games of the protocol (seeds 9001-9006, all 4 seatings of each).
2. A throwaway script replayed every transcript through the engine, rebuilt the calculator pack
   before each LLM decision and counted concrete blunders (definitions below), with the model's own
   `why` lines for the worst ones. The bots' decisions were counted the same way for comparison.
3. Playbook and prompt changes aimed at the largest blunders; the same 24 games re-run; one more
   iteration on the weakest area.

## What the LLM seat got wrong (baseline, 24 games, prompt v4)

Haiku already beat these bots (12 of 24 wins), so the mistakes are the gap between "beats a weak
bot" and "plays well". Ranked by frequency times cost:

| # | Mistake | Baseline count | Measure |
|---|---|---|---|
| 1 | **Shares that change nothing.** 400 of 756 shares bought (53%) left the seat's bonus standing unchanged; 112 went into a chain where it already led by 4+ shares. In 187 of 406 buy steps a single-chain purchase would have gained more bonus (sum of the gaps: $401,100 of bonus position). | 16.7 shares/game | standing and payout before/after each purchase, from the calculator |
| 2 | **Mergers that pay only rivals.** 16 tile placements set off a merger that paid the seat nothing and paid rivals $83,000 in total; 7 more paid a rival more than the seat. | 0.67/game | `bonus_payouts` of the merge scenario |
| 3 | **Idle cash.** Mean cash at the buy step $4,687 against $3,183 for the bots; 23 buy steps ended with nothing bought while holding $3,000+. | | cash at each buy step |
| 4 | **Not founding.** 45 times a tile that founds a chain was in hand and the seat expanded instead. Partly sound (growing a safe chain it leads), partly not. | 1.9/game | tile effects in hand |
| 5 | Missed mergers that would have paid the seat (12, $33,300). | 0.5/game | |
| - | Merger dispositions, end-game timing: essentially fine (1 suboptimal sell/trade in 89; 12 declarations, never while behind, one wait while leading). | | |

What the model was thinking (its own `why` lines):

- "Sandpiper is the cheapest price on the board and I already hold sole majority, so three more
  shares at $200 each add cheap exposure to a chain that will grow" (no bonus gained; in the same
  game it kept buying sandpiper until it held 14 against 5, because the chain was cheap).
- "Merging aurelia and juniper now lifts aurelia to 43 tiles ... adding about $1,000 to my 10
  sole-majority shares" (the merger paid two rivals $10,500 and the seat nothing: it only
  looked at its own share value; the prompt showed only the mover's bonus).
- "Merging obsidian into meridian turns my 3 obsidian shares into $1,800 cash, which I badly need"
  (paid two rivals $9,000).
- "Obsidian is safe and locked up by seat 2, so I need cheap, low-cost positions" (ignoring the
  minority bonus of the largest chain on the board).

Reasoning errors behind them: the model treated "cheap" as "good value", read standing only from its
own side (no idea how safe a lead was), could not see what a merger paid the other players, and
kept a vague "reserve" of several thousand.

## What changed

**Strategy playbook** (system prompt, replaces the six-line "Strategy guidance"; ~700 words,
theme-neutral: every chain/share/merger word, multiplier and purchase limit comes from the
ruleset): core economics (bonus multipliers vs share price, each chain pays once, the biggest
chains pay most, spread across races, cash is ammunition), one checklist question per decision
type phrased against the calculator lines, a list of named blunders, and what a useful private
note looks like.

**Per-decision prompt, from new calculator numbers** (`backend/game/calculator.py`, tier-1 tests in
`backend/tests/test_calculator.py` against heuristic-played games, including the `mini` and
`valley` rulesets for the disposition):

| Calculator field | Rendered as |
|---|---|
| `chains[*].viewer.best_rival_shares`, `lead`, `rival_shares_to_pass`, `majority_locked` | "lead 2 over the next holder (6); a rival buying 3 passes you", "LOCKED: the bank cannot supply a rival enough to pass you", "top rival holds 7, 3 more than you" |
| merge scenario `bonus_by_player`, `survivor_safe_after` | "bonuses paid to all: Seat 2 $7,000, Seat 3 $3,500, YOU $0", ", SAFE" |
| `disposition` (only for the seat deciding) | SELL / TRADE / HOLD lines: sale value, trade value at the survivor's post-merger price, the survivor stake and standing before/after the trade, and the survivor bonus that stake would earn |

`PROMPT_BUILDER_VERSION` 4 -> 5.

## Results (Claude Haiku 5.5, bench-v1 vs-baseline, same 24 games each)

Prompt versions: baseline `v4-43d877887c`, draft `v5-e1dcbce608`, shipped `v5-4b7f5594af`.
Spend: $1.42, $1.57 and $1.51.

| | Baseline (v4) | Playbook draft (v5 draft) | Shipped (v5) |
|---|---|---|---|
| Wins | 12/24 (50%) [31, 69] | 19/24 (79%; split wins: 77.1%) [57, 89] | 19/24 (79.2%) [59, 91] |
| Mean rank | 2.00 | 1.46 | 1.38 |
| Score margin vs bots | +$6,721 (+/- 4,906) | +$16,783 (+/- 4,783) | +$18,090 (+/- 6,582) |
| Rating (bot = 1500) | 1619 [1510, 1742] | 1782 [1652, 1973] | 1830 [1688, 2080] |
| Shares that change no standing / game | 16.7 | 14.3 | 10.8 |
| Shares into a 4+ lead / game | 4.7 | 1.6 | 0.25 |
| Mergers paying rivals only / game | 0.67 ($83,000) | 0.08 ($6,800) | 0.08 ($14,000) |
| Missed paying mergers / game | 0.50 | 0.96 | 0.88 |
| Mean cash at buy step | $4,687 | $5,233 | $5,058 |
| Retries / decision, fallbacks | 0.002, 0 | 0.010, 0 | 0.009, 0 |
| Tokens / game (in+out), cost / game | 264k, $0.059 | 284k, $0.065 | 270k, $0.063 |

Paired by seed and seating, the draft playbook raised the seat's margin over the bots by
$10,062 per game (standard error $2,889, 24 pairs) and improved its rank by 0.54 on average.
The shipped version: +$11,369 per game against the baseline (standard error $3,245) and 0.62
better in rank; against the draft +$1,307 (standard error $4,383), i.e. no measurable difference
in results, with fewer wasted shares.

How strong is this? 24 games is small: the win-rate intervals overlap. The score margin and the
paired comparison are the stronger signals (about 3.5 standard errors for the draft), and the
blunder counts moved the way the playbook aimed. Against the rules-based bot only; strength
against humans or stronger models is not measured here.

### What each change did

- **Draft playbook + new figures (v5 draft).** The merger blunder nearly vanished once the prompt
  showed "bonuses paid to all" (0.67 -> 0.08 per game: the model now writes "The merger pays Seat 1
  and Seat 4 $4,600 and gives me nothing ... so I'll keep 8D in hand"). Overbuying a comfortable lead
  fell by two thirds once leads were shown as "a rival buying N passes you" / LOCKED. Notes became
  plans ("Halcyon locked (8 v 7). Hold 8D for a merger that pays me").
- **Side effect:** the draft rule "fire a merger only if I get at least as much as any rival" made
  it hold back mergers that would have paid it (missed paying mergers 0.50 -> 0.96 per game).
- **Iteration (shipped v5).** Reworded the merger rule (compare with the rival you most need to beat;
  an equal split still gains on everyone else; a bonus in hand beats a bigger one a rival may take)
  and the cash rule (cash in shares is not lost, idle cash can never win a bonus). Overbuying fell
  further (1.6 -> 0.25 per game) and wasted shares 14.3 -> 10.8 per game; missed paying mergers
  stayed at about 0.9 per game.
- **What did not help:** idle cash. Mean cash at the buy step stayed near $5,000 in all three runs
  (bots: $2,800-3,200); the model keeps a self-chosen "reserve" well above one turn's purchases.
  A cash rule in words did not move it; a calculator figure (e.g. what one turn of purchases costs)
  is the next thing to try. Missed paying mergers are partly sound waiting (letting a chain it leads
  grow before cashing it in), so they are not all blunders.
- Disposition "suboptimal" counts rose (1 -> 8 -> 14 of about 100 dispositions; $2,800 -> $13,000
  of sell-vs-trade value over 24 games) partly because the model now trades to protect a survivor majority
  ("Trading 4 halcyon shares for 2 obsidian raises my obsidian lead from 1 to 3 over Seat 4 ... for
  only about $200 less in value"), which the sell-vs-trade measure counts as a small loss by design.

## Kimi K3 (low effort), the same first games

Catalog entry as the owner uses it (`provider: openai`, `kimi-k3`, `reasoning_effort: low`,
`json_mode: json_object`, 60 s timeout). Kimi costs about ten times as much per game as Haiku, so
this is a small check, not a measurement: the first 4 games of the protocol (seed 9001, all four
seatings), before (v4) and after (shipped v5).

| | Before (v4) | After (v5) |
|---|---|---|
| Wins | 1/4 | 3/4 |
| Mean rank | 2.00 | 1.25 |
| Score margin vs bots | +$5,033 | +$18,158 |
| Bonus income, seat vs bot mean | $20,125 vs $17,717 | $29,675 vs $16,033 |
| Mergers paying rivals only | 1 | 0 |
| Fallbacks (timeouts) / decision | 0.5% (1) | 1.9% (4) |
| Retries / decision | 0.011 | 0.028 |
| Cost / game | $0.64 | $0.76 |

Paired by seating: +$13,125 per game (standard error $2,848, 4 pairs). The direction matches
Haiku's, but four games of one deal cannot establish it. The longer prompt costs Kimi about 20%
more per game and a few more timeouts at the 60 s limit (p95 latency 30 s -> 40 s).

A caution against reading much into it: two further "before" games (seed 9002, run to extend the
sample before the budget cap stopped it) both went well for v4 Kimi (6 games: 3 wins, mean rank
1.67, margin +$15,006), and there is no "after" for them. Kimi's spread between deals is large.

## Re-running

From `backend/` (needs `ANTHROPIC_API_KEY`; about $1.5 and 30-60 minutes per 24 games at
`--max-concurrency 8-12`):

```bash
python -m bench run --protocol bench-v1 --models llm:claude-haiku-5-5 --track vs-baseline \
    --games 24 --max-usd 3 --max-concurrency 8 --out bench_results/playbook --json
```

Compare with an older prompt by running the same command from a checkout of that commit into
another directory: games are paired by seed and seating. The blunder counts come from a throwaway
script (not in the repo) that replays each transcript with `transcripts.replay`-style
`apply_action` calls and calls `build_calculator_pack` before each LLM decision; the definitions:

- *share changes nothing*: `buy_options[chain].purchases[n].standing_after == standing_now` and
  `payout_change == 0`;
- *share into a 4+ lead*: viewer sole majority with `lead >= 4` before buying;
- *merger pays rivals only*: the placed tile's merge scenario has `viewer_total_bonus == 0` and a
  rival's bonus `> 0`;
- *missed paying merger*: a playable merge tile with `viewer_total_bonus > 0` was in hand and
  another tile was played;
- *idle cash*: the viewer's cash at every buy step where buying was legal.
