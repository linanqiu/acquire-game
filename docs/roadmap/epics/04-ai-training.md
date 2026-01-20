# Epic 4: AI Training

## Overview

Build the neural network training pipeline to create stronger-than-heuristic bots. This epic is **fully independent** of frontend work and can be parallelized completely.

## Goals

- Implement MCTS bot for strong baseline
- Complete state encoder for neural network input
- Build imitation learning pipeline
- Train neural bot to match/exceed hard bot
- Create evaluation framework for benchmarking

> **Note**: Story implementation notes contain directional code examples. Always verify actual `Game`, `Rules`, and `Action` API signatures in the codebase before implementing.

## Tech Stack

- **Language**: Python 3.12
- **ML Framework**: PyTorch
- **Testing**: pytest

## Stories

### Phase 1: Foundations (No Dependencies)

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [AI-001](../stories/04-ai-training/AI-001.md) | MCTS Basic | L | None | not-started |
| [AI-003](../stories/04-ai-training/AI-003.md) | State Encoder | M | None | not-started |

### Phase 2: Enhanced Search & Data (After Phase 1)

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [AI-002](../stories/04-ai-training/AI-002.md) | MCTS Enhanced | M | AI-001 | not-started |
| [AI-004](../stories/04-ai-training/AI-004.md) | Data Generator | M | AI-001, AI-003 | not-started |
| [AI-005](../stories/04-ai-training/AI-005.md) | Policy Network | M | AI-003 | not-started |

### Phase 3: Training & Integration (After Phase 2)

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [AI-006](../stories/04-ai-training/AI-006.md) | Imitation Trainer | L | AI-004, AI-005 | not-started |
| [AI-007](../stories/04-ai-training/AI-007.md) | Neural Bot | M | AI-006 | not-started |
| [AI-008](../stories/04-ai-training/AI-008.md) | Evaluation Framework | M | AI-001, AI-007 | not-started |

### Phase 4: Advanced (Optional)

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [AI-009](../stories/04-ai-training/AI-009.md) | Decision Transformer | L | AI-004, AI-005 | not-started |

## Dependency Graph

```
(No external dependencies - fully independent track)

AI-001 (MCTS Basic)          AI-003 (State Encoder)
   │                              │
   ├── AI-002 (MCTS Enhanced)     ├── AI-005 (Policy Network)
   │                              │
   └──────────┬───────────────────┘
              │
              ▼
         AI-004 (Data Generator)
              │
              ▼
         AI-006 (Imitation Trainer)
              │
              ▼
         AI-007 (Neural Bot)
              │
              ▼
         AI-008 (Evaluation) ◄── AI-001

         AI-009 (Decision Transformer) ◄── AI-004, AI-005
```

## Success Criteria

| Milestone | Metric |
|-----------|--------|
| MCTS works | MCTS(1000) beats hard bot >60% |
| State encoder | Roundtrip encode/decode matches |
| Neural bot | Within 5% of hard bot win rate |
| Inference | <10ms per move |
| Training | Completes in <2 hours |

## Reference

- [AI Roadmap](../../ai/ROADMAP.md) - Detailed training approach
- [State Encoding](../../ai/state_encoding.md) - Observation space design
- [PPO Explained](../../ai/ppo_explained.md) - RL background
- [Existing bot.py](../../backend/game/bot.py) - Heuristic bot implementation
