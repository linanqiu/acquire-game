# Epic 12: Transcripts & Buyout Bench

> Created 2026-11-14 from owner decisions of the same date. Stories live in
> `docs/roadmap/stories/12-bench/`, prefix `AB-`. The format and rules are specified in
> [docs/architecture/seat-contract.md](../../architecture/seat-contract.md), section "Game
> transcripts and Buyout Bench" (authoritative); this epic builds it.

## Owner decisions (2026-11-14)

1. **Complete game transcripts are a first-class requirement.** Every game, live and benchmark,
   keeps a log of every move and, for AI seats, exactly what the model was prompted with and
   exactly what it returned, including rejected attempts and retry prompts. The owner's purposes:
   testing/debugging, and because users are curious. Users can browse recent games and step
   through a replay showing each AI decision's prompt, answer and stated reasoning. Hands and
   private notes of a live game unlock only when it ends (privacy rule in the contract).
2. **Buyout Bench is a first-class product, not a dev tool.** Putting LLMs in seats yields an AI
   benchmark as a byproduct: models of different strength play each other and the rules-based
   baseline. It must be
   (a) **programmatically runnable on its own**: a standalone command and a Python API with
   machine-readable output and meaningful exit codes, no server or browser, usable from CI or a
   script;
   (b) **versioned**: protocol id plus prompt version; results are never mixed across versions;
   (c) **transparent**: every leaderboard row links to full transcripts;
   (d) **honest about sample size and cost**;
   (e) **visible in the product**: a leaderboard page.
3. **LLM failure handling** (also recorded in [Epic 9](09-llm-bot.md), LO-003): an illegal move is
   sent back to the model with the reason and it tries again (default up to 4 retries within the
   decision's time budget). Only timeout, provider error or exhausted retries hand that one
   decision to the rules-based player. Every such fallback is made known to everyone at the table
   (notice plus a persistent marker on the seat) and recorded in the transcript. The benchmark
   reports retries and fallbacks separately, because they are part of how good a model is at this
   game.
4. **Model availability:** LLM opponents are selectable only when their API key is configured on
   the server; otherwise they are shown disabled and only the rules-based player can be added.
5. **Deployment:** one Railway service serves UI, API and WebSockets (see
   [deploy/README.md](../../../deploy/README.md)); single replica. Transcripts need a persistent
   volume if they should survive redeploys (AB-008; open item).

## What exists today (2026-11-14)

- `backend/bench/` (from LO-006): `python -m bench` run from `backend/`. Plays full games
  in-process through the same decide/check/fallback step as the server driver, with seat rotation,
  fixed seeds, resumable JSONL results, a budget guard (`--max-usd`, `--max-decisions`), a price
  table (`bench/prices.json`, all real models `null` until filled in) and a JSON + Markdown report
  (Wilson intervals, mean rank, score margin vs bot, fallback and repair rates, latency, tokens,
  cost). Exit codes 0 / 1 / 2. See [docs/ai/benchmarking.md](../../ai/benchmarking.md).
- `backend/agents/llm/decision_log.py`: per-decision records in a ring buffer and, if
  `GAME_LLM_LOG_DIR` is set, JSONL with full prompts. Per agent, server-side only.
- Python entry points `bench.run_game` and `bench.run_series` (both async); no stable synchronous
  API, no protocol id, no transcripts, no leaderboard, no HTTP routes under `/games` or `/bench`,
  no frontend pages for either.

The retry loop in `LLMAgent.decide` is still one answer plus one repair. The 4-retry policy of
decision 3 is LO-003 work; the benchmark runner mirrors the server step in `bench.runner._obtain`
and must follow it.

## Design constraints

- One transcript writer, used by the server driver and the bench runner. Bench output and live
  output have the same format so the same viewer shows both.
- Transcripts are written from the same code path that applies actions (no second source of truth),
  so a transcript cannot disagree with the engine log.
- Nothing is sampled or truncated.
- The privacy rule is enforced on the server (redaction in the HTTP layer), not in the UI.
- The benchmark never mixes protocol id or prompt version in one leaderboard view.
- No invented numbers: the price table stays `null` until filled from a provider's published
  prices; the leaderboard shows `unknown` cost, not zero.

## Stories

| Story | Title | Status | Depends on |
|-------|-------|--------|------------|
| [AB-001](../stories/12-bench/AB-001.md) | Transcript writer (server driver + bench runner) | in-progress | ES-002, LO-003 |
| [AB-002](../stories/12-bench/AB-002.md) | Transcript HTTP API with redaction | in-progress | AB-001 |
| [AB-003](../stories/12-bench/AB-003.md) | Transcript browser and replay viewer UI | in-progress | AB-002 |
| [AB-004](../stories/12-bench/AB-004.md) | Standalone eval: CLI, Python API, exit codes, JSON output, CI workflow | in-progress | AB-001, AB-005 |
| [AB-005](../stories/12-bench/AB-005.md) | Protocol `bench-v1` | in-progress | LO-006 (harness) |
| [AB-006](../stories/12-bench/AB-006.md) | Ratings and leaderboard computation | in-progress | AB-005, AB-001 |
| [AB-007](../stories/12-bench/AB-007.md) | Leaderboard UI | in-progress | AB-002, AB-006 |
| [AB-008](../stories/12-bench/AB-008.md) | Transcript persistence and retention in deployment | not-started | AB-001 (blocked: volume decision) |
| [AB-009](../stories/12-bench/AB-009.md) | First published results | not-started | AB-004, AB-006 (blocked: API key) |

## Non-goals

- Submission of third-party agents over the network. (The Python API lets a local script register
  an agent; hosting external submissions is out of scope.)
- Showing hidden information of a game in progress to anyone. Live games are redacted until they
  end.
- A database. Transcripts are files; indexes are rebuilt from them.
- Claims beyond what the protocol measured. The leaderboard reports results with intervals.

## Open items

- **Persistent volume** for transcripts on Railway (AB-008): the owner has to attach one and
  choose a retention limit. Without it, transcripts vanish on redeploy; the UI must say so.
- **API key** for the first real run (AB-009), and a published price for each model entered in
  `backend/bench/prices.json`. Not available to the implementing agents.
- Whether results from models behind an OpenAI-compatible endpoint (self-reported model name) are
  listed next to first-party models. Default: listed, labelled with the provider.

## Status

- **Created**: 2026-11-14
