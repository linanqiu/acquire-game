# Benchmarking seats

`backend/bench/` plays full Acquire games headlessly (no server, no sockets) and
reports how each agent does against the others: win rate, rank, score margin
versus the heuristic bot, reliability, latency, tokens and cost.

It makes decisions the way the server's seat driver (`backend/seats.py`) does:
`pending_decisions` -> `build_context` -> `agent.decide` (with the per-kind
timeout) -> `seats._check` (offered action type, `validate_action`, per-turn
caps) -> heuristic fallback -> `apply_action`. `_check`, `_category` and
`_timeout_for` are imported from `seats`, so they cannot drift. Mirrored rather
than imported (they need a room): picking the next decision (trade responses
addressed to agents first, then the flow decision) and the fallback candidate
order (`HeuristicAgent`, then `default_action`).

## Running

From `backend/`:

```bash
# heuristic sanity run: finishes in ~15 s, win rates ~25% each
python -m bench --matchup bot,bot,bot,bot --games 20

# whole LLM code path offline (fake provider plays the first legal action)
ACQUIRE_TEST_MODE=1 python -m bench --matchup llm:fake,bot,bot,bot --games 8

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
* The runner decide/check step lives in one function (`bench.runner._obtain`). The server driver is moving to re-asking an LLM after an illegal answer (several retries, shared time budget) and falling back only on timeout, provider error or exhausted retries; when that lands, mirror it in `_obtain` (or call the driver function). Retry counts already flow from the agent `totals`, read defensively.
