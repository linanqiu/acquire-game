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

Mechanistic RL/MCTS training ([Epic 4](04-ai-training.md)) is dropped for good. LLM opponents are
a first-class capability alongside humans, not an experiment.

## How an LLM seat decides

One decision at a time. For each decision the engine reports (via `pending_decisions`), the driver:

1. Synthesises context: public event log + calculator pack + legal actions + the seat's own hand
   (the `DecisionContext` in the seat contract). Never other players' hands.
2. Makes a **single** model call (v0) asking for a structured answer.
3. Validates the answer with `validate_action`. If illegal or malformed: one repair retry that
   quotes the error and the legal actions.
4. If still invalid, or on timeout/provider error: falls back to the heuristic agent for that one
   decision. The game never stalls.
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
  `available` only when their provider key is configured.
- Which model is the default for each difficulty tier is **decided by the benchmark harness**
  (LO-006), not fixed in this document.

## Trading

Player-to-player trading stays; the owner considers it an important part of the fun. LLM seats must
be able to:

- **Respond** to trade offers (`trade_response` decisions: accept or reject), including when it is
  not their turn.
- **Propose** trades (`propose_trade`, offered as a legal action in the buy phase).

Trade responses and proposals use the same decision loop, validation, and fallback as every other
decision (LO-004).

## Design principles

- **Never stall a game.** Provider error, timeout, or illegal output degrades to the heuristic
  agent for that decision.
- **Public info only.** Prompts are built from `public_events(game, player_id)`, public state, and
  the seat's own hand.
- **Same code path as humans.** The LLM only produces the action dict. Validation and application
  are identical to a human message.
- **Deterministic math stays in code.**
- **Every decision is logged**: prompt, response, latency, repair/fallback (LO-007).

## Stories

| Story | Title | Status | Depends on |
|-------|-------|--------|------------|
| [LO-001](../stories/09-llm-opponents/LO-001.md) | Provider adapters and agent catalog/config | in-progress | ES-001 (interface only) |
| [LO-002](../stories/09-llm-opponents/LO-002.md) | Context synthesis (prompt builder) | in-progress | ES-002, ES-004 |
| [LO-003](../stories/09-llm-opponents/LO-003.md) | Decision loop: validate, repair, fallback | in-progress | LO-001, LO-002, ES-005 |
| [LO-004](../stories/09-llm-opponents/LO-004.md) | Trade responses and proposals | in-progress | LO-003 |
| [LO-005](../stories/09-llm-opponents/LO-005.md) | Lobby UI for AI opponents and "thinking" indicator | in-progress | LO-001, ES-005 |
| [LO-006](../stories/09-llm-opponents/LO-006.md) | Benchmark harness (LLM vs heuristic) | in-progress | LO-003 |
| [LO-007](../stories/09-llm-opponents/LO-007.md) | Observability: per-decision log | in-progress | LO-003 |

All are `in-progress` as of 2026-11-14; implementation is under way in parallel.

## Deferred (not in v0; revisit only if the benchmark shows they win games)

These ideas from the July draft are **not** being built now:

- Planner -> adversarial critic -> decide chain, and the criticality gate that escalates to it.
- Persistent per-bot strategist scratchpad.
- Room chat / table talk as public events, the cheap chat-router model, off-turn replies, and the
  rolling summarizer.
- Per-role x per-tier model routing table.

Rule for promotion: the benchmark harness (LO-006) must show a measured win-rate gain per dollar
over the single-call baseline before any of these gets a story.

## Status

- **Created**: 2026-07-13 (pivot from Epic 4)
- **Rewritten**: 2026-11-14 (owner decision: first-class seats, single call v0)
