# What an LLM seat costs, and what was cut

Story: [LO-011](../roadmap/stories/09-llm-opponents/LO-011.md). Code: `backend/agents/llm/`
(`agent.py`, `schema.py`, `prompt.py`, `providers.py`), `backend/chat.py`, `backend/config.py`.

Owner (2026-11-16): "LLM cost saving is back". Half a game with two LLM seats had cost about
$0.50. Goal: at least 40% less per LLM seat per game, without worse or slower play.

Method: measure first on real games, cut, then replay the same games. All numbers below are from
`bench-v1` style games (one LLM seat against three rules-based bots, seeds 9001-9006 with all four
seatings = 24 games, plus 12 more on seeds 9004-9015), prompt version 6 as the baseline. Prices
from `backend/bench/prices.json`. Bench seats make no table-talk calls; those are counted apart.

## Where the money went (before)

Claude Haiku 5.5, 36 games, $0.064 per game, 42 model calls per game:

| Part of the bill | Tokens per game | Share of cost |
|---|---|---|
| Uncached input (the per-turn prompt) | 248,000 | 38% |
| Prompt-cache WRITES of the system prompt | 187,000 | 36% |
| Prompt-cache reads | 81,000 | 1% |
| Output | 31,500, of which about 5,400 are the visible answer and the rest thinking | 24% |

By decision kind: tile placement 42%, share purchase 41%, merger shares 10%, founding 4%, buy
steps with nothing to buy 3%. Retries: 17 in 1,500 calls, every one a purchase of four shares
where three are allowed. Fallbacks: none.

Kimi K3 (low reasoning effort), 2 games, $0.67 per game, 36 calls: uncached input 73%, cached
input 5%, output 21%.

Three findings:

1. **The prompt cache was being written, not read.** The answer schema was narrowed to the legal
   options of the moment (the playable tiles, the affordable counts). Anthropic puts the schema in
   front of the cached system prompt, so each new schema made a new cache entry: tile placements
   had 0 cache reads and a 5,000-token cache write (billed at 1.25 times the input price) on every
   call. Caching made the bill higher. On Kimi the schema is appended to the system message; the
   purchase schema listed 0..25 for every chain twice (the trade maps), about 1,400 uncached
   tokens on every purchase call.
2. **Over 40% of the per-turn prompt was the event log**: 60 raw events, including turn ends,
   tile draws, empty purchases and the same placement twice.
3. **Table talk** (live games only): every founding, every merger and every lost majority asked
   every LLM seat "do you want to say something?". Counted on the 36 baseline games that is 17
   calls per seat per game (6.9 foundings and 4.6 mergers by others, 4.9 lost majorities, 1 game
   end), before any chat message. Measured per call: $0.0005 on Haiku (8 calls), $0.0115 on Kimi
   (4 calls). That is about $0.20 per Kimi seat per game on top of the decisions.

The minimum cacheable prefix for Haiku 5.5 is 512 tokens (Anthropic prompt-caching reference);
the system prompt is about 5,000, so length was never the problem.

## What was cut

| Cut | What it does |
|---|---|
| Static answer schema | One schema per decision kind (`build_static_schema`): it depends on the kind and the ruleset only. Whether the answer is legal now is checked by `check_against_legal` and the engine, as before. Providers that only describe the schema in the prompt (`json_object` mode, Kimi) get a single schema for all kinds, so their whole system message is a stable prefix. |
| No model call when nothing is to decide | `forced_choice`: a buy step where no share can be bought (unless the seat holds shares and may propose a trade), exactly one playable tile, one chain left to found; as before, the buy step after the purchase. Never when the seat may declare the game over. Same `apply_action` path; the transcript shows `outcome: "forced"` with the reason. |
| Compact event log | One short sentence per event, noise left out, the latest 28 lines (about the same three rounds as 60 raw events) and the latest 12 key earlier events. |
| Three notes instead of six | Each note restates the plan; a repeated note is not stored twice. |
| Shorter state lines | Chains not on the board on one line; purchase counts with the same outcome on one line; player lines without net worth. |
| Talk calls gated by rules | A human message that names seats: those seats. Spoken to the table: at most two seats (`chat_reply_table_seats`). An AI message: only a seat it names, and only when it floats a deal or asks something. Game events: only the end of the game (`chat_reply_events`; the old triggers can be switched back on there). Talk calls run at low effort (`chat_reply_effort`). |

`PROMPT_BUILDER_VERSION` 7 -> 8.

## Cost, before and after

Decisions (bench games, paired by seed and seating):

| | Before | After | Change |
|---|---|---|---|
| Haiku, cost per game per seat (36 games) | $0.0639 | $0.0323 | -49% (paired: -$0.0316, standard error $0.0014) |
| Haiku, tokens per game: uncached in / cache write / cache read / out | 248k / 187k / 81k / 31.5k | 150k / 3k / 233k / 29k | |
| Haiku, model calls per game | 42.0 | 41.8 | |
| Haiku, latency per model call, p50 / p95 | 5.2 s / 9.9 s | 4.1 s / 8.8 s | |
| Haiku, LLM thinking time per game | 224 s | 183 s | -18% |
| Kimi, cost per model call (2 games each) | $0.0187 | $0.0127 | -32% |
| Kimi, cost per game per seat (2 games each) | $0.67 | $0.56 | -17%: the two "after" games ran 64 turns against 52 |
| Kimi, latency per decision, p50 | 7.5 s | 6.5 s | |

Model calls per game hardly moved: the new forced moves (about 3 per game) replace the cheapest
calls, and games ran slightly longer.

Kimi's figures are two games per arm; cost per call is the usable number, cost per game is not.
The Kimi runs used the per-kind schema. The single all-kinds schema that ships for `json_object`
providers was measured in a second Kimi run (2 games, other prompt details, below): cached tokens
per call rose from 3,328 to about 4,300. The shipped combination itself was not run on Kimi.

With table talk (live games; the number of calls is counted from the bench games, the price per
call measured separately, so this line is an estimate):

| Per seat per game | Before | After |
|---|---|---|
| Haiku: decisions + event-triggered talk | $0.064 + 17 x $0.0005 = $0.073 | $0.032 + 1 x $0.0004 = $0.033 (-55%) |
| Kimi: decisions + event-triggered talk | $0.67 + 17 x $0.0115 = $0.87 | $0.56 + 1 x $0.009 = $0.57 (-35% on these games; -32% per decision call and -94% of talk calls) |

Replies to chat messages come on top in both columns and depend on how much the humans talk.

Against the 40% target: met for Haiku. For Kimi the decision calls are 32% cheaper, short of 40%;
with the talk calls gone a live game should land near the target, but that was not measured on
live games.

## Did play get worse?

Haiku against three rules-based bots, same seeds and seatings:

| Run | Games | Wins [95% Wilson] | Mean rank | Margin over the bots (standard error) | Fallbacks | Retries |
|---|---|---|---|---|---|---|
| Baseline (v6) | 36 | 33 (92%) [78, 97] | 1.14 | +$23,200 (1,700) | 0 | 17 |
| Baseline again, same code, the 12 extra games | 12 | 7 (58%) [32, 81] | 1.58 | +$19,000 (4,200) | 0 | 2 |
| **After (shipped prompt)** | 36 | 30 (83%) [68, 92] | 1.21 | +$19,400 (1,900) | 0 | 14 |
| Dropped variant (below) | 36 | 24 (67%) [50, 80] | 1.50 | +$18,100 (2,600) | 0 | 5 |

- After against the first baseline run, paired over 36 games: margin -$3,700 (standard error
  2,300), rank +0.07 (0.12), wins -3. Better rank in 2 games, worse in 5, same in 29.
- The baseline is not stable between runs: the same code on the same 12 games went from 12 wins
  and +$25,500 to 7 wins and +$19,000 (paired -$6,500, standard error 5,200). All baseline games
  pooled: 40 wins in 48 (83%), margin +$22,100. The earlier playbook measurement of the same
  prompt family on the first 24 games was 19 of 24 and +$18,100
  ([strategy-playbook.md](strategy-playbook.md)).
- So: the shipped version won 83% against a pooled baseline of 83%, with a margin about $2,700
  lower (roughly one standard error). **No loss is shown, and a loss of a few thousand in margin
  cannot be excluded with this sample.** A difference of this size needs a few hundred games to
  settle.
- Behaviour counts (shares bought, mergers fired or passed, declarations, shares held through a
  merger) moved between the two baseline runs as much as between baseline and after.
- A direct check of one suspicion: 36 recorded decisions where declaring the end was legal were
  asked again with the old and the new schema on the same prompts. Both declared 33 times.
- Retries did not rise with the looser schema: all of them, before and after, are purchases of
  four shares (plus 3 wrong `defunct_chain` values in the dropped variant, 0 in the shipped one).
- Kimi: 2 of 2 wins before and after; far too few games to say anything about play.

Measured on prompt v6 plus these cuts. The trade-offer numbers that arrived with v7 were merged
afterwards and are not part of these games.

## Tried and dropped

- **Second variant** (purchase lines and player lines as in the baseline, legal options without
  the details the calculator sections already show, a sentence that the three-share limit counts
  all chains together). Same cost on Haiku, 24 wins in 36. The difference from the shipped variant
  (30 wins) is within the noise seen between two baseline runs, but nothing spoke for it, so it
  was dropped. The four-share retry is therefore still there (about 1% of purchase calls).
- **`""` keeps the last note.** The system prompt offers it; the models write a note anyway
  (10 empty notes in 1,500 decisions). Output stayed the same.
- **Lower effort for small decisions.** Not done: founding and survivor choices are 4% of the
  bill, and purchases and mergers are where thinking pays.
- **Forcing "end turn" for a broke seat that holds shares.** Not done: selling shares to another
  player is then its only move, and a deal agreed in chat needs it.
- **Lower `max_tokens`.** No saving: it is a ceiling, not a spend. Answers use 500-1,000 output
  tokens on Haiku, thinking included.
- **Caching the event log as a second cache block.** Not tried; the compact log is small.
- Low effort for talk calls made no difference on Haiku (it already answered in 10-70 output
  tokens); it stays as a guard for models that think more.

## Production settings

No catalog change is needed: the savings are in code. `max_tokens` and timeouts can stay. The
new settings and their defaults (environment variables of the same name in upper case):

```
CHAT_REPLY_EVENTS=game_ended     # add chain_founded,merger_started,trade_accepted,trade_rejected,majority_lost to get the old talk back
CHAT_REPLY_TABLE_SEATS=2
CHAT_REPLY_EFFORT=low
```

## Re-running

From `backend/` (keys in the environment; about $1.2 for the 36 Haiku games at
`--max-concurrency 12`, 5-10 minutes):

```bash
python -m bench run --protocol bench-v1 --models llm:claude-haiku-5-5 --track vs-baseline \
    --games 24 --max-usd 1.5 --max-concurrency 12 --out bench_results/cost --json
python -m bench run --matchup llm:claude-haiku-5-5,bot,bot,bot --seed 9004 --games 12 \
    --max-usd 1 --max-concurrency 12 --out bench_results/cost_b --json
```

The breakdown per decision kind comes from the transcripts: every `decision` line of an LLM seat
has `llm.attempts[*]` with `input_tokens`, `cache_read_tokens`, `cache_write_tokens` and
`output_tokens`. Check `cache_read_tokens` first: if it is 0 on most calls, something in front of
the system prompt changes from call to call.

Spent on this work: $5.56 on Haiku (120 games and 88 single calls), $3.53 on Kimi (6 games and 8
single calls).

## DeepSeek V4.1 Flash (2026-11-21)

Owner: "Open router key. Please add and use cheap deepseek 41 flash". Catalog entry (Railway
`GAME_LLM_CATALOG`, key in `OPENROUTER_API_KEY`):

```json
{"id": "llm:deepseek-v4.1-flash", "provider": "openai", "model": "deepseek/deepseek-v4.1-flash",
 "label": "DeepSeek V4.1 Flash", "base_url": "https://openrouter.ai/api/v1",
 "api_key_env": "OPENROUTER_API_KEY", "timeout": 45, "max_tokens": 4000,
 "json_mode": "json_object", "extra_body": {"reasoning": {"enabled": false}}}
```

OpenRouter list price $0.05 / $0.20 per million input / output tokens (cache reads $0.001).
One LLM seat against three rules-based bots:

| Setting | Games | Fallback rate | Latency p50 / p95 | Cost per game | Rank |
|---|---|---|---|---|---|
| reasoning effort low | 1 | 33% (19 of 58: thinking ran past 4,000 tokens, `finish_reason=length`) | 7.7 s / 27 s | $0.013 | 2nd |
| **thinking off** | 2 | **0%** (2 repaired answers in 109) | **1.4 s / 2.9 s** | **$0.010** | 2nd, 2nd |

Thinking off is the shipped setting: no fallbacks, the fastest LLM seat in the catalog, and about
a sixth of Haiku's $0.064 (before LO-011's cuts) per game. Two games say nothing about strength.

