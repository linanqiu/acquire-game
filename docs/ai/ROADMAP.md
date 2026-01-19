# Acquire AI Roadmap

A linear progression from heuristics to intelligent game-playing agents.

## Vision

Build AI agents that:
1. Provide engaging opponents at multiple skill levels
2. Can participate in trading negotiations naturally
3. Are explainable (players understand why moves were made)

---

## Roadmap Overview

```
Phase 0              Phase 1              Phase 2              Phase 3
────────────────────────────────────────────────────────────────────────►
Rule-Based       →   MCTS            →   RL               →   RL + LLM
(DONE)               (Search)            (DPO/PPO)            Negotiation
```

| Phase | Approach | What It Adds | Status |
|-------|----------|--------------|--------|
| 0 | Rule-based bots | Playable opponents | ✅ Done |
| 1 | MCTS | Stronger play via search | 📋 Next |
| 2 | RL (DPO or PPO) | Learning, faster inference | 📋 Planned |
| 3 | RL + LLM | Natural trading negotiation | 📋 Planned |

---

## Current State

### What We Have

| Component | Status | Location |
|-----------|--------|----------|
| Rule-based bot (easy/medium/hard) | ✅ Complete | `backend/game/bot.py` |
| Unified Action representation | ✅ Complete | `backend/game/action.py` |
| Deterministic game seeding | ✅ Complete | `backend/game/game.py` |
| Game cloning for simulation | ✅ Complete | `backend/game/game.py` |
| Legal action enumeration | ✅ Complete | `backend/game/rules.py` |
| State encoder design | ✅ Documented | `docs/ai/state_encoding.md` |
| Training config | ✅ Complete | `backend/training/config.py` |

---

## Phase 0: Rule-Based ✅ COMPLETE

**Goal**: Playable bots at multiple difficulty levels

**Delivered**:
- Heuristic scoring for all 5 decision types (tile, founding, merger, disposition, buying)
- Three difficulty levels (easy/medium/hard)
- Deterministic mode for reproducibility

**Strength**: Hard bot provides reasonable play using hand-crafted rules

---

## Phase 1: MCTS (Search-Based)

**Goal**: Stronger bot through search, no machine learning required

### Approach

Monte Carlo Tree Search explores possible futures by simulation:

```python
class MCTSBot:
    def __init__(self, simulations: int = 1000):
        self.simulations = simulations

    def choose_action(self, game, player_id) -> Action:
        legal_actions = Rules.get_all_legal_actions(game, player_id)
        wins = {a: 0 for a in legal_actions}
        plays = {a: 0 for a in legal_actions}

        for _ in range(self.simulations):
            action = self.select_action(wins, plays)  # UCB1
            game_copy = game.clone()
            game_copy.apply_action(action)
            winner = self.rollout(game_copy)  # Random playout
            plays[action] += 1
            if winner == player_id:
                wins[action] += 1

        return max(legal_actions, key=lambda a: wins[a] / max(plays[a], 1))
```

### Key Features

| Feature | Description |
|---------|-------------|
| UCB1 selection | Balance exploration vs exploitation |
| Random rollouts | Simulate games to completion |
| Configurable strength | More simulations = stronger play |
| Information Set MCTS | Handle hidden opponent tiles |

### Deliverables

- [ ] `backend/game/mcts_bot.py` - Core MCTS implementation
- [ ] Configurable difficulty via simulation count
- [ ] Benchmark against rule-based bots

### Success Criteria

- MCTS(1000) beats hard bot >60% of games
- Move time <5 seconds with 1000 simulations

---

## Phase 2: Reinforcement Learning (DPO or PPO)

**Goal**: Learn strong play from data, fast inference

### Option A: DPO (Direct Preference Optimization)

Simpler than PPO - no reward model, no value network.

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Generate Preference Data                           │
│  - Play MCTS vs weaker bots                                 │
│  - MCTS move = "chosen", weaker move = "rejected"           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Train with DPO Loss                                │
│  - Increase probability of chosen moves                     │
│  - Decrease probability of rejected moves                   │
│  - Single loss function, stable training                    │
└─────────────────────────────────────────────────────────────┘
```

**DPO Loss**:
$$\mathcal{L}_{\text{DPO}} = -\log \sigma\left(\beta \log \frac{\pi_\theta(a_w|s)}{\pi_{\text{ref}}(a_w|s)} - \beta \log \frac{\pi_\theta(a_l|s)}{\pi_{\text{ref}}(a_l|s)}\right)$$

### Option B: PPO (Proximal Policy Optimization)

More complex but well-understood. See `docs/ai/ppo_explained.md` for details.

```
┌─────────────────────────────────────────────────────────────┐
│  Components                                                  │
│  - Policy network π(a|s)                                    │
│  - Value network V(s)                                        │
│  - GAE for advantage estimation                              │
│  - Clipped objective for stability                           │
└─────────────────────────────────────────────────────────────┘
```

### Comparison

| Aspect | DPO | PPO |
|--------|-----|-----|
| Complexity | Lower | Higher |
| Training stability | Very stable | Requires tuning |
| Data requirement | Preference pairs | Online interaction |
| Reward model | Not needed | Not needed |
| Value network | Not needed | Required |

**Recommendation**: Start with DPO. Simpler to implement, stable training, can leverage MCTS as the "expert" for generating preference data.

### Deliverables

- [ ] `backend/training/state_encoder.py` - State → tensor
- [ ] `backend/training/policy_network.py` - Neural network
- [ ] `backend/training/dpo_trainer.py` - DPO training loop
- [ ] `backend/game/neural_bot.py` - Bot using trained network
- [ ] `backend/training/evaluator.py` - Benchmarking

### Success Criteria

- Beat hard bot >70% of games
- Beat MCTS(1000) >55% of games
- Inference <10ms per move

---

## Phase 3: RL + LLM Negotiation

**Goal**: Add natural language trading to the RL bot

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Hybrid Bot                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  RL Policy (from Phase 2)                             │  │
│  │  - Tile placement                                      │  │
│  │  - Stock purchases                                     │  │
│  │  - Merger decisions                                    │  │
│  │  - Fast inference (<10ms)                              │  │
│  └───────────────────────────────────────────────────────┘  │
│                            +                                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  LLM Trading Agent                                     │  │
│  │  - Evaluate trade offers                               │  │
│  │  - Propose trades                                      │  │
│  │  - Natural language negotiation                        │  │
│  │  - Explainable decisions                               │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### LLM Trading Agent

```python
class LLMTradingAgent:
    def evaluate_offer(self, game, offer) -> tuple[bool, str]:
        """Evaluate incoming trade offer."""
        prompt = f"""You are playing Acquire. Evaluate this trade offer.

Game state:
- Your money: ${game.current_player.money}
- Your stocks: {game.current_player.stocks}
- Active chains: {describe_chains(game)}

Trade offer: {describe_offer(offer)}

Consider:
1. Relative stock values based on chain sizes
2. Your majority/minority positions
3. Game stage (early/mid/late)

Respond: ACCEPT or REJECT, then explain briefly."""

        response = llm.complete(prompt)
        return parse_response(response)

    def propose_trade(self, game, player_id) -> Optional[TradeOffer]:
        """Generate a trade proposal if beneficial."""
        prompt = f"""You are playing Acquire. Consider proposing a trade.

Your position: {describe_position(game, player_id)}
Other players: {describe_opponents(game, player_id)}

If a mutually beneficial trade exists, propose it.
If not, respond "NO_TRADE".

Format: TRADE [your stocks] FOR [their stocks] WITH [player]"""

        response = llm.complete(prompt)
        return parse_trade_proposal(response)
```

### Integration

```python
class HybridBot:
    def __init__(self):
        self.rl_policy = load_trained_policy()
        self.llm_trader = LLMTradingAgent()

    def choose_action(self, game, player_id):
        # RL handles core gameplay
        return self.rl_policy.choose_action(game, player_id)

    def handle_trade_offer(self, game, offer):
        # LLM handles trading
        accept, reasoning = self.llm_trader.evaluate_offer(game, offer)
        return accept

    def maybe_propose_trade(self, game, player_id):
        # LLM proposes trades when beneficial
        return self.llm_trader.propose_trade(game, player_id)
```

### Deliverables

- [ ] `backend/llm/trading_agent.py` - LLM trading logic
- [ ] `backend/llm/prompts.py` - Prompt templates
- [ ] `backend/game/hybrid_bot.py` - Combined RL + LLM bot
- [ ] Integration with game WebSocket API

### Success Criteria

- Bot participates in trading (previously declined all trades)
- Trade decisions are reasonable (evaluated by human review)
- Trading adds strategic depth without slowing gameplay

---

## Evaluation Framework

### Benchmark Suite

```python
def run_benchmarks():
    bots = {
        "easy": RuleBot("easy"),
        "medium": RuleBot("medium"),
        "hard": RuleBot("hard"),
        "mcts_100": MCTSBot(100),
        "mcts_1000": MCTSBot(1000),
        "rl_v1": RLBot("v1"),
        "hybrid": HybridBot(),
    }

    # Round-robin tournament
    results = {}
    for bot_a, bot_b in combinations(bots, 2):
        wins_a, wins_b = play_matches(bot_a, bot_b, n=1000)
        results[(bot_a, bot_b)] = (wins_a, wins_b)

    return compute_elo_ratings(results)
```

### Metrics by Phase

| Phase | Key Metric | Target |
|-------|------------|--------|
| 1 (MCTS) | Win rate vs hard bot | >60% |
| 2 (RL) | Win rate vs MCTS(1000) | >55% |
| 2 (RL) | Inference time | <10ms |
| 3 (Hybrid) | Trades accepted/proposed | >0 per game |
| 3 (Hybrid) | Human evaluation of trades | "Reasonable" |

---

## File Structure

```
backend/
├── game/
│   ├── bot.py              # ✅ Rule-based bots
│   ├── mcts_bot.py         # 📋 Phase 1: MCTS
│   ├── neural_bot.py       # 📋 Phase 2: RL bot
│   └── hybrid_bot.py       # 📋 Phase 3: RL + LLM
├── training/
│   ├── config.py           # ✅ Hyperparameters
│   ├── state_encoder.py    # 📋 State → tensor
│   ├── policy_network.py   # 📋 Neural network
│   ├── dpo_trainer.py      # 📋 DPO training
│   ├── ppo_trainer.py      # 📋 PPO training (optional)
│   └── evaluator.py        # 📋 Benchmarking
├── llm/
│   ├── trading_agent.py    # 📋 Phase 3: LLM trading
│   └── prompts.py          # 📋 Prompt templates
docs/ai/
├── README.md               # ✅ Overview
├── ROADMAP.md              # ✅ This document
├── ppo_explained.md        # ✅ PPO deep dive
├── state_encoding.md       # ✅ Observation design
├── training_pipeline.md    # ✅ Training details
└── alternatives/
    ├── README.md           # ✅ RL alternatives analysis
    └── llm-rl-advances.md  # ✅ LLM-RL techniques (DPO, GRPO)
```

Legend: ✅ Complete | 📋 Planned

---

## Summary

| Phase | What | Why | Effort |
|-------|------|-----|--------|
| **0** | Rule-based | Baseline opponents | ✅ Done |
| **1** | MCTS | Strong play via search, no ML | 1-2 days |
| **2** | RL (DPO/PPO) | Learn from data, fast inference | 1-2 weeks |
| **3** | RL + LLM | Natural trading negotiation | 1 week |

**Next step**: Implement MCTS (Phase 1) - provides immediate strength improvement with no ML infrastructure required.
