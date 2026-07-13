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

The model returns a structured move — but not from a single naked prompt. Decisions run through an
**agentic orchestration** layer (see below): a persistent per-bot strategy scratchpad, and for
high-stakes decisions a planner → adversarial-critic → decide chain. The model is **swappable**
via configuration between:

- Anthropic **Claude Opus** (`claude-opus-4-8`)
- Anthropic **Claude Fable** (`claude-fable-5`)
- **GLM-5.2** (Zhipu, OpenAI-compatible endpoint)

## Agentic Orchestration

Verification of the classic LLM failure modes is **deterministic, not LLM-based**: arithmetic
lives in the calculator pack, and move legality is enumerated and validated by the engine (with
one repair retry, then fallback). LLM-on-LLM verification is reserved for what code can't check —
strategic judgment:

- **Strategist scratchpad** (every decision): the bot maintains a short written plan across turns
  ("accumulating Tower; want the 5C merger before Imperial is safe"), returned as a field on each
  move and fed back into the next prompt. Cross-turn intent at zero extra calls.
- **Criticality gate** (deterministic code): classifies each decision. Routine tile placements →
  single call. Critical decisions — merger survivor, stock disposition, end-game declaration,
  buys when a majority race is within a few shares, safe-chain-adjacent placements → escalate.
- **Planner → adversarial critic → decide** (critical decisions only): propose 2–3 candidate
  lines, a critic call attacks them from the opponents' seats ("how does the leader punish
  this?"), a final call commits. ~15–25% of decisions escalate, so expect ~1.5× single-call cost
  and longer thinks only on dramatic moves.
- **Benchmark-gated**: the evaluation harness A/Bs single-call vs orchestrated win rates per
  model, so orchestration depth is justified by measured strength, not vibes.

## Table Talk (Room Chat)

Players get a free-form room chat (new product feature: WS `chat` message, broadcast to all,
shown on player and host screens). Chat messages are recorded as **public events in the same
append-only timeline as moves**, so the bot's prompt shows table talk interleaved with game
actions — what a human at the table hears. This lets players express intent to bots ("let's
not feed Imperial"), negotiate, and bluff; the bot is prompted to treat chat as unverified —
cross-checking claims against the event log and public holdings (bluff/lie detection is a
judgment call informed by verifiable history). Optionally the bot can respond with its own
short table-talk line per move. If chat volume ever bloats the prompt, an auxiliary
summarizer call compresses chat older than a few turns into a rolling summary (follow-up
story; casual chat volume rarely needs it).

Bots also reply to chat **off-turn**, via two-stage routing: code guards first (per-bot
cooldown; bots never reply to other bots — no banter loops), then a **very cheap LLM
router** (default `claude-haiku-4-5`, configurable) classifies each message on a tiny
context window — should this bot reply? It catches implicit addressing and provocation
that keyword rules miss, at sub-second latency and negligible cost. Only routed messages
reach the full model: a fire-and-forget background call producing `{reply: string | null}`
— silence still allowed, game state untouched (no lock, no stall risk). The reply prompt
includes the bot's private strategist scratchpad with the rule that the plan is private —
reveal, deflect, or misdirect deliberately.

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
| Orchestration | Strategist scratchpad; criticality gate; planner→critic→decide on critical moves |
| Table talk | Room chat feature; chat as public events in the bot prompt timeline; optional bot banter; summarizer when long |
| Evaluation | Benchmark harness: LLM bot vs existing bot, single-call vs orchestrated, win rates & cost |

## Status

- **Created**: 2026-07-13 (pivot decision)
- **Stories**: pending planning report
