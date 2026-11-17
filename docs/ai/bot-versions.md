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
| v1 | Original heuristic: fixed points per tile effect (found 100; grow a chain I hold 50 + 5 per share; merger 30 + 3 per survivor share if I hold any, 20 + 2 per defunct share if I hold any), medium picks at random among the top 3 tiles. Spread-out buying, sell/trade by price, declare when projected first, position-aware trade answers. | kept (baseline) |
| v2 | Tile value in money: my gain minus weighted rival gains ([bot-tiles.md](bot-tiles.md)); medium varies only within $100 of the best and never plays a harmful tile while a harmless one exists. | **accepted** |

## Results (final seeds 100001-100060)

### v2 vs v1 (600 games)

| | v2 | v1 |
|---|---|---|
| Paired margin difference per seed | **+$7,897 (95 % CI +/- $1,039)** | |
| 2v2 win share (120 games) | 81.2 % | 18.8 % |
| Lone seat among three of the other (240 games each; equal = 25 %) | 48.1 % (+/- 6.3) | 9.6 % (+/- 3.7) |
| Mean rank (1200 seat-games each) | 2.21 | 2.78 |

| Profile per seat-game | v2 | v1 |
|---|---|---|
| Mergers set off | 1.34 | 1.85 |
| Suicide merges | **0.16** | **0.86** |
| Chains founded | 3.17 | 2.16 |
| Shares held (own turn ends) | 17.5 | 16.2 |
| Cash at own turn ends | $2,293 | $2,028 |
| Cash at the last turn | $5,593 | $4,341 |
| End declarations | 0.36 | 0.14 |
| Bonus income | $24,154 | $18,750 |

The remaining v2 "suicide merges" are cases where every other tile was worse (all tiles merge, or
the others grow rival chains past a price step or to safe) or where the bot gains more from the
survivor growing (price and bonus position) than the rivals' bonuses cost it.
