# Bot generations

Story: [LO-012](../roadmap/stories/09-llm-opponents/LO-012.md). Code: `backend/agents/bot_versions.py`
(one `BotPolicy` per version: a named option for each rule component, plus weights),
`backend/agents/heuristic.py` (reads the policy at each decision), `backend/game/bot.py`,
`backend/game/tile_value.py` (the rules), tournament
`backend/bench/bot_tournament.py`.

Owner (2026-11-17): "Try a few loops of this. Propose new bot rules, keep old versions and Monte
Carlo who wins. And then add new rules."

Every generation stays playable: a seat picks one with `bot:v1`, `bot:v2`, ... (catalog id for
`agents.registry.create` and bench seat specs) or `HeuristicAgent(version=...)`; plain `bot` is
`DEFAULT_VERSION`, the strongest accepted version (v8). With `GAME_TEST_MODE=1` the lobby's AI
menu also offers every other generation as "Bot vN" (production menus unchanged). Difficulty (easy / medium / hard) works on top
of every version. v1 is exactly the bot on `main` before this story: 16 fixed-seed games (seeds
1-8, medium and hard) give the same action sequence and final money on `main` and as `bot:v1`.

## Method

- **Tournament** (`python -m bench.bot_tournament A B --seeds LO-HI --procs 3`, from `backend/`):
  bot-only games, no network, through `build_context -> HeuristicAgent.choose -> apply_action`.
  Per seed, 10 four-seat games: 2v2 in both alternating seatings (ABAB, BABA) and 1v3 with the lone
  seat in each position, both ways. `--mixed` plays 3-6 seat tables of several versions, rotated.
  Difficulty medium (the default for bot seats).
- **Margin** of a seat: its final money minus the mean of the other seats at its table.
- **Acceptance test** (paired by seed): per seed, the new version's mean margin minus the old
  one's over that seed's 10 games; the mean of those per-seed differences with a 95 % interval
  (normal approximation, seeds independent). Accept only if the new version beats the current
  best with the interval excluding zero, with at least 400 games (40 seeds) in the pairing.
- **Seeds**: development (looking at games, tuning) on seeds 1-999; every reported number on the
  final range 100001-100060 (600 games per pairing), never used during development.
- **Behaviour profile**, per seat-game: mergers set off; suicide merges (set off a merger that
  paid the maker $0 and rivals at least $1,000 in bonuses); chains founded; shares held at the end
  of own turns; cash at the end of own turns and at the last turn; end-game declarations; trades
  accepted (bot-only tables have no offers: always 0); bonus income (merger and final bonuses).

## Versions

| Version | Rules added | Status |
|---|---|---|
| v1 | Original heuristic: fixed points per tile effect (found 100; grow a chain I hold 50 + 5 per share; merger 30 + 3 per survivor share if I hold any, 20 + 2 per defunct share if I hold any), medium picks at random among the top 3 tiles. Spread-out buying (owned chains, size, tier), sell/trade by price, found dear tiers when rich, declare when projected first, position-aware trade answers. | baseline |
| v2 | **Tile value in money**: my gain minus weighted rival gains ([bot-tiles.md](bot-tiles.md)); medium varies only within $100 of the best and never plays a harmful tile while a harmless one exists. | **accepted** (beats v1) |
| v3 | **Buy for bonus positions** (`buy="position"`, `agents/bot_rules.py: choose_buys_position`): over every affordable combination of up to 3 shares, the one with the largest weighted bonus-position gain (my bonus if bought out now, up; rivals' bonuses, down, rival-weighted as in the tile value; weight = the trade valuation's bonus weight). If no purchase gains at least $1, v1's buying rule. | **accepted** (beats v2, v1) |
| v4 | v3 + **merger shares by post-merger math** (`disposition="position"`, `choose_disposition_position`): trade the amount (a multiple of the ratio, up to the legal maximum) that maximises survivor shares at the post-merger price plus my weighted survivor bonus gain plus rivals' bonus loss there; sell the rest. | rejected: vs v3 +$1,200 +/- 1,176 per seed (dev seeds 1-40, 400 games), not clear |
| v5 | v3 + **defended buying** (`weights={"defend": 0.5}`): a purchase's value for me blends "bonus if bought out now" with "bonus after the rival holding the most shares buys a full turn of shares". | rejected: vs v3 +$547 +/- 1,817 (dev 1-40) |
| v6 | v3 but **no fallback buying** (`weights={"fallback": "none"}`): keep the cash when no purchase gains a bonus position. | rejected: vs v3 +$1,436 +/- 1,602 (dev 1-40) |
| v7 | v3 + **found the cheapest chain** (`found="cheapest"`): more shares per dollar for the race the founder starts. | rejected alone: vs v3 +$4,176 +/- 2,050 (dev 101-120) but +$972 +/- 1,713 (dev 201-240) |
| v8 | v7 + **buy for the chain 3 tiles ahead** (`weights={"size_ahead": 3}`): purchases are valued with the bonuses at the chain's size + 3 (bonuses grow with size, so positions in chains that will grow count more and the cheap early races less). | **accepted** (beats v3, v2, v1); **default** |

## Results (final seeds 100001-100060, 600 games per pairing, medium)

| Pairing (A vs B) | Games | Paired margin A - B per seed (95 % CI) | 2v2 win share A / B | Lone seat wins A / B (equal = 25 %) | Mean rank A / B | Verdict |
|---|---|---|---|---|---|---|
| v2 vs v1 | 600 | +7,897 +/- 1,039 | 81.2% / 18.8% | 48.1% / 9.6% | 2.21 / 2.78 | v2 better |
| v3 vs v2 | 600 | +12,793 +/- 1,145 | 83.3% / 16.7% | 73.8% / 8.5% | 2.07 / 2.92 | v3 better |
| v3 vs v1 | 600 | +19,016 +/- 1,024 | 95.8% / 4.2% | 79.6% / 2.1% | 1.91 / 3.08 | v3 better |
| v8 vs v3 | 600 | +6,123 +/- 1,325 | 64.6% / 35.4% | 41.2% / 17.9% | 2.29 / 2.71 | v8 better |
| v8 vs v2 | 600 | +11,799 +/- 1,140 | 85.0% / 15.0% | 73.5% / 11.3% | 2.09 / 2.91 | v8 better |
| v8 vs v1 | 600 | +16,445 +/- 1,082 | 93.3% / 6.7% | 78.7% / 4.2% | 1.97 / 3.03 | v8 better |

| Version (table) | Mergers set off | Suicide merges | Chains founded | Shares held | Cash at turn end | Cash at last turn | End declarations | Bonus income |
|---|---|---|---|---|---|---|---|---|
| v2 (vs v1) | 1.34 | 0.16 | 3.17 | 17.5 | $2,293 | $5,593 | 0.36 | $24,154 |
| v1 (vs v2) | 1.85 | 0.86 | 2.15 | 16.2 | $2,028 | $4,341 | 0.14 | $18,750 |
| v3 (vs v2) | 1.93 | 0.10 | 2.53 | 18.1 | $2,057 | $4,897 | 0.41 | $26,600 |
| v2 (vs v3) | 1.11 | 0.24 | 2.75 | 16.9 | $1,445 | $2,683 | 0.09 | $17,173 |
| v3 (vs v1) | 1.52 | 0.07 | 3.16 | 18.3 | $2,808 | $7,091 | 0.45 | $28,522 |
| v1 (vs v3) | 1.79 | 1.05 | 2.20 | 15.7 | $1,775 | $3,145 | 0.05 | $14,642 |
| v8 (vs v3) | 1.75 | 0.11 | 2.57 | 18.9 | $2,190 | $4,804 | 0.31 | $23,918 |
| v3 (vs v8) | 1.25 | 0.16 | 2.65 | 17.6 | $1,718 | $3,265 | 0.19 | $19,521 |
| v8 (vs v2) | 1.95 | 0.10 | 2.57 | 19.4 | $2,403 | $5,595 | 0.41 | $26,302 |
| v2 (vs v8) | 1.14 | 0.26 | 2.75 | 17.8 | $1,657 | $2,822 | 0.09 | $17,564 |
| v8 (vs v1) | 1.51 | 0.08 | 3.14 | 19.6 | $3,173 | $7,540 | 0.44 | $27,813 |
| v1 (vs v8) | 1.79 | 1.11 | 2.20 | 16.9 | $2,033 | $3,400 | 0.06 | $15,495 |

Profiles are per seat-game, measured in that pairing's games.

### Mixed tables (final seeds 100001-100030, 480 games: 3, 4, 5 and 6 seats, v1 v2 v3 v8 seated round-robin and rotated)

| Version | Seat-games | Win share (95 % CI) | Mean rank | Mean margin (95 % CI) | Suicide merges | Bonus income |
|---|---|---|---|---|---|---|
| v1 | 540 | 3.4% +/- 1.5% | 3.78 | -11,024 +/- 968 | 1.25 | $11,544 |
| v2 | 540 | 8.7% +/- 2.4% | 3.24 | -5,363 +/- 1,025 | 0.14 | $15,128 |
| v3 | 540 | 29.7% +/- 3.9% | 2.55 | +5,659 +/- 1,198 | 0.09 | $23,399 |
| v8 | 540 | 47.0% +/- 4.2% | 1.96 | +10,728 +/- 1,095 | 0.09 | $27,514 |

## Weight screens (development seeds, 200 games each against the version named, not reported as results)

Cheap screens of single weights before building a version; none was clear on its own.

| Variant of v3 (dev seeds 101-120) | Paired margin vs v3 per seed |
|---|---|
| tile `lambda` 0.5 (rivals' gains count half) | +$2,024 +/- 1,923 |
| tile `lambda` 1.5 | -$320 +/- 1,818 |
| tile `found_factor` 0.5 / 0.1 | +$243 +/- 552 / +$25 +/- 685 |
| buy `cash_cost` 0.1 | +$1,348 +/- 1,733 |
| buy `buy_min_gain` $300 | identical games (every v3 purchase gains more) |
| buy `size_ahead` 3 | +$3,588 +/- 2,694 |
| found dearest / cheapest | +$2,374 +/- 2,693 / +$4,176 +/- 2,050 |
| v4's disposition + `lambda` 0.5 | +$2,347 +/- 1,892 |
| cheapest + `size_ahead` 3 (= v8), dev seeds 201-240 | **+$6,886 +/- 1,769** |

Next loop, variants of v8 (dev seeds 301-320, 200 games each); none clear, so no v9 was built:

| Variant of v8 | Paired margin vs v8 per seed |
|---|---|
| buy `size_ahead` 5 | -$618 +/- 2,457 |
| tile `lambda` 0.5 | -$229 +/- 2,470 |
| v4's disposition | +$1,421 +/- 1,881 |
| v5's defended buying | +$778 +/- 2,789 |

## Limits

- Bot-only tables at difficulty medium. Strength against humans or LLM seats is not measured.
- Bot-only games have no trade offers (bots never propose), so trade answers are not exercised;
  every version answers offers with the same position-aware rule (LO-010).
- `bot` (the bench baseline) is now v8: bench results from before LO-012 are not comparable with
  later ones; `bot:v1` reproduces the old baseline.
- The intervals are per pairing and many screens were run, so a borderline interval would mean
  little. None of the accepted ones is borderline: the smallest, v8 vs v3, is +$6,123 +/- 1,325
  (the mean is 4.6 half-widths from zero).

## Notes per generation

- **v2.** The remaining "suicide merges" are cases where every other tile was worse (all tiles
  merge, or the others grow rival chains past a price step or to safe) or where the bot gains more
  from the survivor growing (price and bonus position) than the rivals' bonuses cost it.
- **v3.** v1's buying spread shares over owned chains, big chains and expensive tiers without
  asking whether a share wins anything. Development games showed v2 losing races it could have
  taken with one or two shares and adding shares to leads nobody contested. Buying by position
  change roughly doubles the margin gained by v2's tile rule. It sets off more mergers (it now holds
  the majorities that make them pay) and collects about 55 % more bonus income.
- **v4-v6.** Disposition by post-merger math, defending leads and keeping cash instead of spread
  buying each moved the margin by about $1,000 or less with intervals well across zero: the
  dispositions and the fallback purchases are a small part of a game's money next to bonus
  positions. They stay playable (`bot:v4` ... `bot:v6`) so the numbers can be reproduced.
- **v8.** The idea: v3 values a purchase by the bonus "if bought out now", which undervalues
  positions in chains that will still grow (bonuses rise with size), and v1's founding picks dear
  chains when cash is plentiful, so holding the new race costs more. Valuing positions 3 tiles
  ahead and founding the cheapest chain together beat v3 clearly; founding cheap alone did not
  (v7). Against v3 it sets off more mergers, holds more shares, ends with more cash and collects
  about 23 % more bonus income in the same games. Why the two only work together was not
  investigated further.
