# Benchmarking seats

> **Buyout Bench**: the harness in `backend/bench/` is the engine of a product, not just a dev tool.
> Epic: [Epic 12](../roadmap/epics/12-bench.md). The protocol, standalone CLI, Python API, ratings and
> leaderboard are built (sections "Current harness" onwards describe them); published results and
> persistence on a server volume are not (AB-008, AB-009).

## Buyout Bench

Putting LLMs in seats gives a benchmark as a byproduct: models of different strength play full
games of Buyout against each other and against the rules-based baseline (the heuristic bot).
Properties:

1. **Runs on its own.** A standalone command and a Python API, with machine-readable output and
   meaningful exit codes. No server, no browser, no WebSocket. Usable from CI or from a script that
   benchmarks its own agent.
2. **Versioned.** A result belongs to a protocol id (`bench-v1`) and a prompt version.
   Results from different protocol ids or prompt versions are never mixed in one table.
3. **Transparent.** Every game of a benchmark run writes a full transcript (every move, and for LLM
   seats the exact prompt, every raw answer, retries and fallbacks). Every leaderboard row links to
   the transcripts behind it. Format: seat contract, "Game transcripts and Buyout Bench".
4. **Honest about sample size and cost.** Intervals, not point estimates; rows with too few games
   are marked and not ranked; cost per game is `unknown` unless every price is known.
5. **Visible in the product.** A leaderboard page at `/bench`.

Protocol `bench-v1` (defined in `backend/bench/protocols.py`, details below) has two tracks:
**vs-baseline** (one model against three rules-based bots) and **head-to-head** (models of
different strength in the same game). Changing any pinned element means a new protocol id.

### Retries and fallbacks are part of the score

In the server an illegal move is sent back to the model with the reason and it tries again (default
up to 4 retries, inside the decision's time budget); only a timeout, a provider error or exhausted
retries hand that one decision to the rules-based player. The benchmark reports **retries** and
**fallbacks** separately: a model that needs many retries, or that falls back often, is worse at
this game than its win rate alone shows, and a fallback-heavy model is partly a heuristic bot.

### What exists and what does not

| Piece | State |
|---|---|
| Command | `python -m bench` subcommands `run`, `leaderboard`, `list-models`, and the older `python -m bench --matchup ...` form (below). |
| Python API | `bench.run_protocol`, `run_series`, `run_game`, `load_results`, `compute_leaderboard` (async runners; see "Python API"). |
| Output | JSON report, Markdown summary, resumable per-game `results.jsonl`, one transcript per game; `--json` prints only JSON on stdout. |
| Exit codes | `0` all games finished; `1` stopped early (budget) or a game stalled; `2` configuration error. |
| CI | `.github/workflows/bench.yml` runs the protocol with the fake provider; the fake-provider tests in `backend/tests/test_bench.py` run in the normal pytest job. |
| Leaderboard | Ratings from finishing orders, served as `GET /bench/leaderboard`, shown at `/bench`. |
| Published results | No leaderboard results are published (AB-009). The first measured runs (Claude Haiku 5.5, 24 games, and Kimi K3, 4 games, of `bench-v1` vs-baseline, before and after the strategy playbook) are written up in [strategy-playbook.md](strategy-playbook.md). |

## Current harness

`backend/bench/` plays full Buyout games headlessly (no server, no sockets) and
reports how each agent does against the others: win rate, rank, score margin
versus the heuristic bot, reliability, latency, tokens and cost.

It makes decisions the way the server's seat driver (`backend/seats.py`) does:
`pending_decisions` -> `build_context` -> `agent.decide` (with the per-kind
timeout; an illegal answer is sent back to agents that accept rejections) ->
`check_answer` (offered action type, `validate_action`, per-turn caps) ->
heuristic fallback -> `apply_action`. The check, fallback category, fallback
answer and timeouts live in `agents/driving.py`, shared with the server, so they
cannot drift, and `import bench` does not import the web server. Mirrored rather
than shared (the server's version needs a room and a lock): picking the next
decision (trade responses first, then the flow decision) and the re-ask loop.

## Running

From `backend/`:

```bash
# heuristic sanity run: finishes in ~15 s, win rates ~25% each
python -m bench --matchup bot,bot,bot,bot --games 20

# whole LLM code path offline (fake provider plays the first legal action)
GAME_TEST_MODE=1 python -m bench --matchup llm:fake,bot,bot,bot --games 8

# a real model (needs ANTHROPIC_API_KEY; fails fast with a clear message otherwise)
python -m bench --matchup llm:claude-haiku-5-5,bot,bot,bot --games 4 --max-decisions 2000
```

Flags:

| Flag | Meaning |
|---|---|
| `--matchup a,b,c,d` | Seat agent ids (`bot`, `scripted`, `llm:<id>`; 3-6 seats). Repeatable: several matchups run on the same seeds. |
| `--games N` | Games per matchup (default 20). |
| `--seed S` | Base seed; game `i` uses seed `S+i` (default 1). |
| `--max-concurrency K` | Games in flight at once (default 4). LLM calls are I/O bound, so raise it for real models, mindful of rate limits. |
| `--max-decisions D` | Hard stop after D decisions made by non-bot seats (all decisions in an all-bot series). |
| `--max-usd X` | Hard stop after about X dollars. Refuses to start unless every paid model in the matchups has input and output prices. |
| `--results FILE` | JSONL results file, default `bench_results/results.jsonl`. |
| `--fresh` | Delete the results file first. |
| `--prices FILE` | Alternative price table. |
| `--report-json / --report-md` | Default `<results>.report.json` / `.report.md`. The Markdown is also printed. |

Exit code: 0 = all games finished, 1 = stopped early by a budget or some game
stalled, 2 = configuration error (unknown or unavailable agent, bad flags).

Agents can also be injected from Python: a seat may be an agent instance or a
`(label, factory)` tuple, e.g. `run_game([("mine", lambda: MyAgent()), "bot", "bot"], seed=3)`.

### Seat rotation and seeds

Game `i` of a matchup rotates the seating by `i mod n`, so over any multiple of
`n` games every agent sits in every position equally. Seed and rotation depend
only on `i`, so every matchup sees the same seeds and rotations: compare
matchups on the same `--seed/--games`. (Bots are seeded from game seed and
position, not from the matchup, so a bot in position 3 plays the same random
stream in every matchup.)

### Budget guard

The guard is checked before every decision. When it trips, games in flight are
abandoned (not recorded; a rerun replays them) and the series stops. Overshoot
is at most one in-flight decision per concurrent game. The report is still
written, headed `STOPPED EARLY ... results below are PARTIAL`: an agent that was
stopped mid-series has seat rotation that is not balanced, so read partial
results as anecdotes.

### Resuming

Each finished game is appended to the JSONL file under the key
`<matchup>|seed=<s>|rot=<r>`. Rerunning the same command skips keys already in
the file (it says how many); raising `--games` runs only the extra games. A
torn final line from a killed run is ignored. The report covers exactly the
games planned by the current command. Games that stalled (no legal fallback
or a runaway game) are recorded with their status and excluded from the
statistics, with a warning naming their seeds.

## Reading the report

Per matchup, one row per agent label. An agent that holds several seats (the three
`bot`s in `llm:x,bot,bot,bot`) contributes several seat-games per game.

* **Win rate [95% Wilson]**: a tie for first counts as a split win. **Verdict**
  compares the interval with chance (1/players = 25% for four): `above chance`,
  `below chance`, or `inconclusive` when the interval contains it.
* **Mean rank**: 1 = best, ties share the average rank, so a baseline is 2.5 in a
  four-player game. The interval is a normal approximation over seat-games.
* **Score margin vs bot**: final money minus the mean of the *other* bot seats in
  the same game; empty when the agent holds every seat.
* **Fallback rate / by reason**: share of decisions where the server would have
  replaced the agent's answer with the heuristic's. Reasons: `error` (exception or
  provider failure), `timeout`, `illegal` (answer not offered or rejected by
  `validate_action`), `cap` (per-turn caps), `engine` (validated but refused).
  A fallback-heavy LLM is partly a heuristic bot: its strength numbers are
  contaminated, so check this column first.
* **Repair rate**: decisions whose first answer was illegal (agent-reported); **illegal retries/decision** counts the extra model calls spent on them (0 if the agent does not report `retries`).
* **Latency**: wall time per decision (p50/p95 over all decisions of that agent).
  Bots are not timed.
* **Tokens, cost**: per game, per decision. Cache read tokens are shown separately
  because they bill differently.
* **Trades**: proposals made, and accept/reject answers given as responder.
* **By seat position**: win rate per seat, a direct check for first-mover advantage
  (see sample sizes below).

### What sample sizes mean

Four players, so chance is 25%. The 95% interval on a win rate near 25% is about
+/-19 points at 20 games, +/-12 at 50, +/-8.5 at 100. To distinguish a true 40%
win rate from 25% with 80% power you need about 71 games; to distinguish 33%
from 25% roughly 300. With fewer than 30 games the report says so. Mean rank
and score margin are less noisy than win rate (they use the whole ranking), so
for a first look prefer them, but the same caution applies. Don't pick a
winner between two LLMs from a handful of games: run one `--matchup` per model
on the same seeds and look at whether the intervals separate.

## Price table

`backend/bench/prices.json` holds USD per 1,000,000 tokens per model name (the
provider's model, e.g. `claude-haiku-5-5`, not the catalog id):

```json
"claude-haiku-5-5": {"input": null, "output": null, "cache_read": null, "cache_write": null}
```

It ships with `null` for every real model. Nothing here invents prices: fill
the four numbers from your provider's published pricing page, or pass another
file with `--prices`. Reports show `unknown` for any agent whose cost depends on
a missing price (a price is only needed for token types actually used), and
`--max-usd` refuses to run until prices are set. `fake` is the offline provider
and is free (0.0). A model that is not in the file counts as unknown.

## Choosing a default model per tier

1. Fill the price table.
2. For each candidate model run the same series, e.g.
   `--matchup llm:<model>,bot,bot,bot --games 60 --seed 100 --max-concurrency 6 --max-usd <cap>`
   (use `--max-decisions` while exploring). Fewer than ~60 games will rarely settle anything.
3. Discard candidates with a fallback rate above a few percent or a repair rate that
   is high: they cost money and play like the heuristic.
4. Among the rest, take strength first: mean rank and score margin vs bot with their
   intervals, then win rate. Treat models whose intervals overlap as tied.
5. Break ties by p95 latency (must sit comfortably under the seat's timeout, 30-130 s,
   and feel right for a human waiting) and cost per game.
6. Tier mapping: cheapest/fastest model that is not below chance for the entry tier;
   best strength-per-dollar for the middle tier; strongest within an acceptable p95
   latency and cost per game for the top tier.
7. Record the results file, the report and the seeds you used under
   `docs/ai/benchmarks/` next to the decision.

## Known limits

* Per-decision tokens are read from the agent's `totals` (the `DecisionLog`
  counters), so only agents exposing them (`LLMAgent`) report tokens.
* Seat-games from one multi-seat agent are not independent; its interval is
  optimistic.
* Games take about 0.7 s of CPU for bots only, dominated by the engine's calculator
  pack (shared with the server). Concurrency helps with LLM latency, not CPU.
* Retries: the runner re-asks agents that accept rejections exactly like the server
  driver (same retry and time budget); retries are counted from the agent's
  decision record (attempts with an error), so agents without one report only
  the driver's re-asks.
* See "Buyout Bench: running the protocol" below for the protocol, transcripts,
  ratings and the leaderboard.

## Buyout Bench: running the protocol

Implemented (transcripts, protocol, ratings, leaderboard, standalone CLI and
Python API). Everything here runs without the server.

### Protocol `bench-v1`

Defined in `backend/bench/protocols.py` (`PROTOCOLS["bench-v1"]`):

| Pinned | Value |
|---|---|
| Seats | 4 |
| Seeds | 9001-9018 (fixed list) |
| Series | 72 games: every distinct seating of the lineup is played on the same deal (seed), seed after seed |
| vs-baseline | per model, lineup `(model, bot, bot, bot)`: 4 seatings x 18 seeds |
| head-to-head | 2 models + 2 bots: 12 seatings x 6 seeds; 3 models + 1 bot or 4 models: 24 seatings x 3 seeds; more than 4 models: one series per 4-combination |
| Ruleset | one game variant per run (`--ruleset default\|valley\|mini\|<path>`; default env `GAME_RULESET`, else default): `ruleset_id` and `ruleset_fingerprint` are recorded in every result and transcript header, and are part of every game key and series id |
| Prompt | `prompt_version(ruleset)` of `agents.llm` (hash of the ruleset fingerprint, the system prompt text built for it and `PROMPT_BUILDER_VERSION`), recorded in every result |
| Retries / timeouts | the server's: `max_illegal_retries` per catalog entry (default 4), `llm_decision_timeout` (130 s per decision) |

Balance: within a series every entrant sits in every position equally often,
and in head-to-head every model acts before every other model in exactly half
the games. `--games N` caps a series (seed-major order); a cap that is not a
multiple of the seatings unbalances positions and the run says so in
`warnings`.

**Why 72 games, and what they can and cannot show.** Chance win rate is 25%.
At 72 games the 95% Wilson interval on a 25% win rate is about +/-10 points,
and a true 40% win rate is detected with about 80% power (two-sided 5%). A
true 30% (a 5-point edge) needs about 550 games: this protocol cannot see it,
and the verdict will read `inconclusive`. Mean rank and the rating use the
whole finishing order and separate agents sooner than win rate. Rows with
fewer than 30 games carry `(only N games; need 30+)` in their verdict.

A result is comparable only with results of the same protocol id, ruleset
fingerprint AND prompt version; the leaderboard never mixes them (it lists the
other versions and rulesets under `available` and in `warnings`;
`GET /bench/leaderboard?ruleset=<id or fingerprint>` and `python -m bench
leaderboard --ruleset` choose one, default: that of the newest result).
Records written before rulesets existed count as default. Changing seeds, seats, schedule or game
count means a new protocol id; changing what the model sees means bumping
`PROMPT_BUILDER_VERSION` in `backend/agents/llm/prompt.py` (the system prompt
text is hashed automatically).

### Standalone CLI

From `backend/`:

```bash
# offline smoke (fake LLM, no network): ~1 s per game
GAME_TEST_MODE=1 python -m bench run --protocol bench-v1 \
    --models llm:fake --track vs-baseline --games 4 --out bench_results/smoke --json

# real models (needs ANTHROPIC_API_KEY); both tracks, budget-capped
python -m bench run --protocol bench-v1 \
    --models llm:claude-haiku-5-5,llm:claude-sonnet-5-5 --track both \
    --out bench_results/claude --max-concurrency 6 --max-decisions 20000

python -m bench run --protocol bench-v1 --models llm:fake \
    --ruleset mini --games 4 --out bench_results/mini                # another game variant
python -m bench leaderboard --out bench_results/claude          # Markdown table
python -m bench leaderboard --out bench_results/claude --json   # the /bench/leaderboard JSON
python -m bench list-models [--json]                            # catalog ids + availability

# ad-hoc matchups (exploration; also the old form `python -m bench --matchup ...`)
python -m bench run --matchup llm:fake,bot,bot,bot --games 8 --out bench_results/adhoc
```

`run` flags: `--protocol`, `--models` (comma-separated catalog ids),
`--track vs-baseline|head-to-head|both`, `--games` (cap per series),
`--out` (results directory, required), `--json`, `--max-concurrency`,
`--max-usd`, `--max-decisions`, `--prices`, `--fresh`, `--quiet`,
`--no-transcripts` (transcripts are on by default). Rerunning the same command
resumes: games already in `results.jsonl` are skipped.

With `--json` stdout carries exactly one JSON document and all progress goes
to stderr:

```jsonc
{"status": "complete" | "stopped" | "stalled" | "config_error", "exit_code": 0,
 "protocol": "bench-v1", "prompt_version": "v1-...", "tracks": [...],
 "out": "...", "series": ["<series_id>", ...],
 "games": {"planned", "ran", "skipped", "aborted", "stalled"},
 "stopped_reason": null | "--max-decisions N reached",
 "budget": {"decisions", "usd"}, "warnings": [...],
 "files": {"results", "transcripts", "leaderboard", "report"},
 "leaderboard": {...same shape as GET /bench/leaderboard...}}
```

Exit codes: **0** every planned game finished; **1** partial: stopped by a
budget (`stopped`) or a game stalled (`stalled`); **2** configuration error:
unknown or unavailable model (e.g. no `ANTHROPIC_API_KEY`; reported before any
game starts, with the variable to set), unknown protocol/track, bad flags, or
`--max-usd` with unknown prices. A config error under `--json` prints
`{"status": "config_error", "exit_code": 2, "error": "..."}`.

### Python API

```python
import asyncio
from bench import run_protocol, run_series, compute_leaderboard, load_results

class MyAgent:                      # any object with kind + async decide(ctx)
    kind = "llm"                    # "llm" seats get the LLM timeout/retry rules
    async def decide(self, ctx):    # ctx: agents.base.DecisionContext
        ...                         # return an action dict from ctx.legal

res = asyncio.run(run_protocol(
    [("my-agent", MyAgent), "llm:claude-haiku-5-5"],   # ids, (label, factory) or instances
    out="bench_results/mine", track="both", games=None, max_concurrency=4,
))
print(res.status, res.exit_code, res.summary()["games"])
board = compute_leaderboard(load_results("bench_results/mine"), track="vs-baseline")
```

* `run_protocol(models, *, out, protocol="bench-v1", track="both",
  games=None, max_concurrency=4, max_usd=None, max_decisions=None,
  prices=None, fresh=False, transcripts=True, progress=None,
  prompt_version=None, write_outputs=True, ruleset=None) -> ProtocolResult` (async; in a
  notebook `await run_protocol(...)`). A `(label, factory)` seat gets a fresh
  agent per game; an Agent instance is reused, so the run drops to one game at
  a time. Raises `BenchError` for configuration errors before any game starts.
* `run_series(matchups, games, *, results_path, ...)`: ad-hoc matchups.
* `load_results(path)`: records from a `results.jsonl`, a results directory or
  a parent of several. `compute_leaderboard(records, protocol=None,
  prompt_version=None, ruleset=None, track="all", bootstrap_samples=200, seed=0)`.
* Also exported: `run_game`, `run_games`, `schedule`, `get_protocol`,
  `PROTOCOLS`, `bradley_terry`, `bootstrap`, `write_outputs`, `PriceTable`.
* No global state; importing `bench` starts nothing and imports no web
  server (checked by a test).

### Results directory (stable layout)

```
<out>/results.jsonl                 one record per finished game (resumable)
<out>/transcripts/<game_id>.jsonl   full transcript per game (seat contract format)
<out>/transcripts/<game_id>.summary.json
<out>/leaderboard.json              {"generated_at", "boards": [one per protocol + ruleset + prompt version]}
<out>/report.md                     leaderboard tables + per-matchup statistics
```

A record has the old fields (`key, matchup, seed, status, seat_order,
standings, winners, turns, end_reason, decisions, seats[...]`) plus
`game_id`, `transcript` (relative to `<out>`), `seat_labels`, `started_at`,
`finished_at`, `rotation` (seating index), `series_id`, and for protocol runs
`protocol`, `track`, `prompt_version`, `series_games`, `seating_index`,
`lineup`; every record has `ruleset_id` and `ruleset_fingerprint`. Final
standings use competition ranking (a tie shares the rank; a tie for first is a
split win and a half-win in the rating). The server serves `GAME_BENCH_DIR` (default
`backend/bench_results/`; one results directory or a parent of several) at
`GET /bench/leaderboard`, `GET /bench/series/{id}` and `GET /games?source=bench`.

### Rating method and caveats

`bench/rating.py`. Each game's finishing order is broken into all pairs of
seats held by different agents (finishing ahead = a win, equal money = half a
win each; the three bot seats of a vs-baseline game are not compared with each
other). A Bradley-Terry model is fitted by Hunter's MM algorithm and put on the
Elo scale with the rules-based bot fixed at **1500**: a 400-point gap means
10:1 odds of finishing ahead of the other agent. Why not a full Plackett-Luce
fit: ties are handled exactly as half wins, several seats of one agent need no
special case, and full rank-breaking into pairs is a consistent estimator of
Plackett-Luce strengths (Azari Soufiani, Parkes & Xia, ICML 2014). The
interval is a percentile bootstrap over **games** (whole finishing orders are
resampled, 200 draws, fixed seed), because pairs from one game are not
independent. A weak prior (one virtual half-won comparison of each agent
against the bot) keeps ratings finite for an agent that always or never
finishes ahead and shrinks very small samples towards 1500.

Caveats: a rating is relative to the rules-based bot on THIS protocol and
prompt version; it is not comparable with chess Elo or with another protocol.
Agents that never met the bot (a head-to-head-only run without bots) are tied
to the scale only by the prior, so run vs-baseline too. Fallbacks make an LLM
partly a bot: check `fallback_rate` before reading strength. Win rate and
Wilson interval are per seat-game; the bot's interval is optimistic (three
correlated seats per game).

Leaderboard columns: `rating` [`rating_ci`], `win_rate` [`ci_low`, `ci_high`]
(0..1), `mean_rank`, `fallback_rate` (fallbacks per decision),
`retry_rate` (rejected answers per decision), `tokens_per_game` (input +
output per seat-game), `cost_per_game` (null = a price is unknown; 0 for the
bot), `latency_p50_s`, `verdict` (Wilson interval vs chance, with the
sample-size note).

### Adding a model

1. Add a catalog entry: built-in Anthropic entries live in
   `backend/agents/llm/config.py` (`_default_entries`); any other model goes in
   `GAME_LLM_CATALOG` (JSON list, e.g.
   `[{"id": "llm:my-model", "label": "My model", "provider": "openai", "model": "my-model", "base_url": "https://api.example.com/v1", "api_key_env": "MY_KEY"}]`).
2. `python -m bench list-models` must show it `available`.
3. Add its prices to `backend/bench/prices.json` (below) if you want costs or
   `--max-usd`.
4. Run the protocol with `--models llm:my-model`; to benchmark code that is not
   in the catalog, use the Python API with a `(label, factory)` seat.

### Filling `prices.json`

`backend/bench/prices.json` maps the provider's model name (the `model` of the
catalog entry, e.g. `claude-haiku-5-5`) to USD per 1,000,000 tokens:
`{"input", "output", "cache_read", "cache_write"}`. Copy the four numbers from
the provider's published price page; leave `null` for anything you do not
know (costs then show as unknown, never guessed). Transcript footers
(`totals.cost_usd`) and the leaderboard use the same table.

### CI

* `.github/workflows/ci.yml` runs an offline smoke (fake LLM, 2 games) after the
  test suite.
* `.github/workflows/bench.yml` (manual `workflow_dispatch` only:
  models, track, games cap, max USD, max decisions) runs the protocol with the
  `ANTHROPIC_API_KEY` / `GAME_LLM_OPENAI_API_KEY` repository secrets and
  uploads the results directory as an artifact. It never runs on push or PR.

Real-model runs so far: the before/after measurement of the strategy playbook
([strategy-playbook.md](strategy-playbook.md), which also explains how to re-run it and how the
blunder counts are defined).
