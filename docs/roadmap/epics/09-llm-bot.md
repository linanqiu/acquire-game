# Epic 9: LLM Opponents (first-class seats)

> Rewritten 2026-11-14 (owner decision). The July 2026 draft of this epic (open-weight only,
> planner/critic chain, chat router, table talk) is reduced to a v0 and a Deferred section below.
> File name kept as `09-llm-bot.md` so existing links work. Stories live in
> `docs/roadmap/stories/09-llm-opponents/`, prefix `LO-`.

## Overview

A seat at the table is a **human, an LLM, a heuristic bot, or a scripted player**. The engine cannot
tell which; all of them act through the same `apply_action()` entry point. The technical contract is
[docs/architecture/seat-contract.md](../../architecture/seat-contract.md). This epic builds the LLM
seat on top of the seam delivered by [Epic 10](10-engine-seam.md).

Transcripts of every game and the Buyout Bench benchmark are specified in
[Epic 12](12-bench.md).

Mechanistic RL/MCTS training (Epic 4) is dropped for good. LLM opponents are
a first-class capability alongside humans, not an experiment.

## How an LLM seat decides

One decision at a time. For each decision the engine reports (via `pending_decisions`), the driver:

1. Synthesises context: public event log + calculator pack + legal actions + the seat's own hand
   (the `DecisionContext` in the seat contract). Never other players' hands.
2. Makes a **single** model call (v0) asking for a structured answer.
3. Validates the answer with `validate_action`. If illegal or malformed, **sends it back to the
   model with the reason and the legal actions and lets it try again**: default up to 4 retries,
   inside the decision's time budget (owner decision 2026-11-14; the first build does one repair
   only, see LO-003).
4. Only a **timeout, a provider error, or exhausted retries** hand that one decision to the
   rules-based (heuristic) player. The game never stalls. **Every such fallback is made known to
   everyone at the table** (a notice plus a persistent marker on the seat) and is recorded in the
   transcript with its reason.
5. Applies the action through the same path a human message uses.

Arithmetic (prices, bonuses, affordability, score projections) is computed by
`game/calculator.py` and handed to the model. The model supplies judgment only.

## Models and providers

- The seat names its model in config. The July "open-weight only, for cheapness" constraint is
  **lifted** (owner decision 2026-11-14).
- Providers are pluggable behind one adapter interface. Two adapters in v0: **Anthropic** and
  **OpenAI-compatible** (`base_url` + key + model; covers DeepSeek, Moonshot, z.ai, OpenRouter,
  local servers).
- A catalog (`GET /agents/catalog`) lists the AI opponents the lobby can offer. LLM entries are
  `available` only when their provider key is configured on the server. Otherwise the lobby shows
  them disabled and only the rules-based player can be added (owner decision 2026-11-14; the server
  already rejects `add-seat` for an unavailable id).
- Which model is the default for each difficulty tier is **decided by Buyout Bench results**
  ([Epic 12](12-bench.md), AB-009), not fixed in this document. No real-model run has been
  made yet; it needs an API key.

## Trading

Player-to-player trading stays; the owner considers it an important part of the fun. LLM seats must
be able to:

- **Respond** to trade offers (`trade_response` decisions: accept or reject), including when it is
  not their turn.
- **Propose** trades (`propose_trade`, offered as a legal action in the buy phase).

Trade responses and proposals use the same decision loop, validation, retry, and fallback as every other
decision (LO-004).

## Design principles

- **Never stall a game.** Illegal output is sent back for a retry; a provider error, a timeout or
  exhausted retries degrade to the heuristic agent for that one decision, visibly.
- **Public info only.** Prompts are built from `public_events(game, player_id)`, public state, and
  the seat's own hand.
- **Same code path as humans.** The LLM only produces the action dict. Validation and application
  are identical to a human message.
- **Deterministic math stays in code.**
- **Every decision is recorded in the game transcript**: prompt, every raw answer, retries,
  fallbacks, latency, tokens (owner decision 2026-11-14; format in the seat contract,
  [Epic 12](12-bench.md), AB-001). This replaces the LO-007 per-decision log.
- **Retries and fallbacks are visible and measured**, not hidden: the benchmark reports them
  separately.

## Stories

| Story | Title | Status | Depends on |
|-------|-------|--------|------------|
| [LO-001](../stories/09-llm-opponents/LO-001.md) | Provider adapters and agent catalog/config | in-progress | ES-001 (interface only) |
| [LO-002](../stories/09-llm-opponents/LO-002.md) | Context synthesis (prompt builder) | in-progress | ES-002, ES-004 |
| [LO-003](../stories/09-llm-opponents/LO-003.md) | Decision loop: validate, retry (up to 4), fallback | in-progress | LO-001, LO-002, ES-005 |
| [LO-004](../stories/09-llm-opponents/LO-004.md) | Trade responses and proposals | in-progress | LO-003 |
| [LO-005](../stories/09-llm-opponents/LO-005.md) | Lobby UI for AI opponents and "thinking" indicator | in-progress | LO-001, ES-005 |
| [LO-006](../stories/09-llm-opponents/LO-006.md) | Benchmark harness (built as `backend/bench`; see Epic 12) | complete (harness; rest moved to Epic 12) | LO-003 |
| [LO-007](../stories/09-llm-opponents/LO-007.md) | Observability: per-decision log (replaced by transcripts, AB-001) | superseded by AB-001, AB-002 | LO-003 |
| [LO-008](../stories/09-llm-opponents/LO-008.md) | Public table chat; LLM seats talk and negotiate (owner decision 2026-11-15) | complete | LO-003, LO-005, AB-001 |
| [LO-009](../stories/09-llm-opponents/LO-009.md) | Strategy playbook and strategy figures in the prompt, measured with the bench (owner request 2026-11-15) | complete | LO-002, ES-004, AB-003 |
| [LO-010](../stories/09-llm-opponents/LO-010.md) | Position-aware trading: the rules-based bot prices majority/minority positions, the LLM guide and offer line too (owner request 2026-11-16) | complete | ES-004, LO-004, LO-009 |
| [LO-011](../stories/09-llm-opponents/LO-011.md) | Cost per game: a prompt cache that hits, no call when nothing is to decide, smaller prompt, talk calls gated by rules (owner request 2026-11-16) | complete | LO-003, LO-008, LO-009, AB-001 |
| [LO-012](../stories/09-llm-opponents/LO-012.md) | No suicide mergers: position-aware tile value for the bot, "pays only rivals" for LLM seats; bot generations compared in self-play (owner request 2026-11-17) | complete | ES-004, LO-009, LO-010 |

Status as of 2026-11-17: **6 of 11 active stories complete** (LO-012 no suicide mergers and bot generations; LO-011 cost per game; LO-010 position-aware trading; LO-009 strategy playbook; LO-008
table chat; LO-006, the headless harness); LO-001..LO-005 are partly built (see the status note at the bottom of each story);
LO-007 is superseded. The benchmark as a product (protocol, standalone CLI/API contract, ratings,
leaderboard, first results) and transcripts moved to [Epic 12](12-bench.md). Changes caused
by the 2026-11-14 owner decisions: LO-003 (retry loop, notice, seat marker), LO-005 (fallback marker,
availability), LO-006 (moved), LO-007 (superseded).

## Deferred (not in v0; revisit only if the benchmark shows they win games)

These ideas from the July draft are **not** being built now:

- Planner -> adversarial critic -> decide chain, and the criticality gate that escalates to it.
- Persistent per-bot strategist scratchpad.
- The cheap chat-router model and the rolling summarizer. (Room chat / table talk and off-turn
  replies were promoted by owner decision on 2026-11-15 and built as LO-008: seats use their own
  model, no separate router.)
- Per-role x per-tier model routing table.

Rule for promotion: Buyout Bench ([Epic 12](12-bench.md)) must show a measured win-rate gain per dollar
over the single-call baseline before any of these gets a story.

## Status

- **Created**: 2026-07-13 (pivot from Epic 4)
- **Rewritten**: 2026-11-14 (owner decision: first-class seats, single call v0)
- **Updated**: 2026-11-14 (retry-then-fallback policy, visible fallbacks, availability rule; observability and benchmark moved to Epic 12)
