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
`DEFAULT_VERSION`, the strongest accepted version. Difficulty (easy / medium / hard) works on top
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
| v1 | Original heuristic: fixed points per tile effect (found 100; grow a chain I hold 50 + 5 per share; merger 30 + 3 per survivor share if I hold any, 20 + 2 per defunct share if I hold any), medium picks at random among the top 3 tiles. Spread-out buying (owned chains, size, tier), sell/trade by price, declare when projected first, position-aware trade answers. | baseline |
| v2 | **Tile value in money**: my gain minus weighted rival gains ([bot-tiles.md](bot-tiles.md)); medium varies only within $100 of the best and never plays a harmful tile while a harmless one exists. | **accepted** (beats v1) |
| v3 | **Buy for bonus positions** (`buy="position"`, `agents/bot_rules.py: choose_buys_position`): over every affordable combination of up to 3 shares, the one with the largest weighted bonus-position gain (my bonus if bought out now, up; rivals' bonuses, down, rival-weighted as in the tile value; weight = the trade valuation's bonus weight). If no purchase gains at least $1, v1's buying rule. | **accepted** (beats v2, v1); default |
| v4 | **Merger shares by post-merger math** (`disposition="position"`, `choose_disposition_position`): trade the amount (a multiple of the ratio, up to the legal maximum) that maximises survivor shares at the post-merger price plus my weighted survivor bonus gain plus rivals' bonus loss there; sell the rest. | candidate |
| v5 | v3 + **defended buying** (`weights={"defend": 0.5}`): a purchase's value for me blends "bonus if bought out now" with "bonus after the strongest rival buys a full turn of shares", so a one-share lead counts less and widening a contestable lead counts. | candidate |
| v6 | v3 but **no fallback buying** (`weights={"fallback": "none"}`): when no purchase gains a bonus position, keep the cash instead of v1's spread buying. | candidate |

## Results (final seeds 100001-100060, 600 games per pairing, medium)

| Pairing (A vs B) | Games | Paired margin A - B per seed (95 % CI) | 2v2 win share A / B | Lone seat wins A / B (equal = 25 %) | Mean rank A / B | Verdict |
|---|---|---|---|---|---|---|
| v2 vs v1 | 600 | +7,897 +/- 1,039 | 81.2% / 18.8% | 48.1% / 9.6% | 2.21 / 2.78 | v2 better |
| v3 vs v2 | 600 | +12,793 +/- 1,145 | 83.3% / 16.7% | 73.8% / 8.5% | 2.07 / 2.92 | v3 better |
| v3 vs v1 | 600 | +19,016 +/- 1,024 | 95.8% / 4.2% | 79.6% / 2.1% | 1.91 / 3.08 | v3 better |

| Version (table) | Mergers set off | Suicide merges | Chains founded | Shares held | Cash at turn end | Cash at last turn | End declarations | Bonus income |
|---|---|---|---|---|---|---|---|---|
| v2 (vs v1) | 1.34 | 0.16 | 3.17 | 17.5 | $2,293 | $5,593 | 0.36 | $24,154 |
| v1 (vs v2) | 1.85 | 0.86 | 2.15 | 16.2 | $2,028 | $4,341 | 0.14 | $18,750 |
| v3 (vs v2) | 1.93 | 0.10 | 2.53 | 18.1 | $2,057 | $4,897 | 0.41 | $26,600 |
| v2 (vs v3) | 1.11 | 0.24 | 2.75 | 16.9 | $1,445 | $2,683 | 0.09 | $17,173 |
| v3 (vs v1) | 1.52 | 0.07 | 3.16 | 18.3 | $2,808 | $7,091 | 0.45 | $28,522 |
| v1 (vs v3) | 1.79 | 1.05 | 2.20 | 15.7 | $1,775 | $3,145 | 0.05 | $14,642 |

Profiles are per seat-game, measured in that pairing's games.

## Notes per generation

- **v2.** The remaining "suicide merges" are cases where every other tile was worse (all tiles
  merge, or the others grow rival chains past a price step or to safe) or where the bot gains more
  from the survivor growing (price and bonus position) than the rivals' bonuses cost it.
- **v3.** v1's buying spread shares over owned chains, big chains and expensive tiers without
  asking whether a share wins anything. Development games (seeds 1-40) showed v2 losing races it
  could have taken with one or two shares and adding shares to leads nobody contested. Buying by
  position change roughly doubles the margin gained by v2's tile rule. It sets off more mergers
  (it now holds the majorities that make them pay) and collects about 55 % more bonus income.
