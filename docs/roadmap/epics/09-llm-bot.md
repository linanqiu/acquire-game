# Epic 9: LLM Bot

## Overview

Replace the planned RL/MCTS training pipeline ([Epic 4](04-ai-training.md), superseded) with an
**LLM-agent bot**: at each decision point, a large language model is shown everything a human
opponent sitting at the table would know, plus exact arithmetic, and applies judgment to pick a move.

The core idea: don't train a policy — prompt a strong general model with:

1. **Public event log** — every visible move made so far by all players (tile placements, chain
   foundings, mergers and their resolutions, stock purchases, trades). Only information a human
   at the table would have; opponents' hands stay hidden.
2. **Calculator pack** — deterministic figures "a very precise human with a calculator" could
   derive from public info: current stock prices, chain sizes and safe-chain status, remaining
   stock per chain, majority/minority bonus payouts for each potential merger at current public
   holdings, affordability of purchases, end-game score projections.
3. **Legal moves** — the exact set of valid actions for the current decision.

The model returns a structured move. The model is **swappable** via configuration between:

- Anthropic **Claude Opus** (`claude-opus-4-8`)
- Anthropic **Claude Fable** (`claude-fable-5`)
- **GLM-5.2** (Zhipu, OpenAI-compatible endpoint)

## Design Principles

- **Never stall a game**: any provider error, timeout, or malformed response falls back to the
  existing simple bot logic for that decision. LLM unavailability degrades difficulty, not uptime.
- **Public info only**: the bot must not see private hands or hidden state. The prompt builder
  consumes the same public projection a human opponent gets.
- **Separable**: the LLM bot lives in its own module behind the existing bot decision interface;
  the game engine gains only an event log (which also serves replay/debugging — see
  [BL-004](../stories/08-backlog/BL-004.md), a natural prerequisite).
- **Deterministic math stays in code**: the LLM is for judgment, not arithmetic. Anything
  computable is computed and handed to it.

## Stories

Story breakdown is being produced by a planning pass (architecture, change-surface analysis,
provider/cost research) and will land as `docs/roadmap/stories/09-llm-bot/` files. Expected shape:

| Area | Work |
|------|------|
| Event log | Engine emits public events per mutation (aligns with BL-004) |
| Calculator pack | Pure module deriving exact figures from public state |
| Provider adapter | One interface, three backends (Anthropic x2, GLM), env-var config |
| LLM bot brain | Prompt builder + structured move output + fallback to simple bot |
| Evaluation | Benchmark harness: LLM bot vs existing bot, per-model win rates & cost |

## Status

- **Created**: 2026-07-13 (pivot decision)
- **Stories**: pending planning report
