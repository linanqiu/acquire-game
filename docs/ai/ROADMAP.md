# Acquire AI Roadmap

A holistic roadmap for building intelligent game-playing agents for Acquire, from simple heuristics to superhuman play.

## Vision

Build a progression of AI agents that:
1. Provide engaging opponents at multiple skill levels
2. Are explainable (players can understand why moves were made)
3. Can participate in trading negotiations naturally
4. Serve as training partners for human players

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
| PPO documentation | ✅ Complete | `docs/ai/ppo_explained.md` |
| Alternatives analysis | ✅ Complete | `docs/ai/alternatives/` |

### What's Missing

- Neural network implementation
- Training pipeline
- MCTS implementation
- LLM integration for trading
- Evaluation framework

---

## Roadmap Phases

### Recommended Path (LLM-RL Focus)

```
Phase 0          Phase 1          Phase 2          Phase 3          Phase 4
─────────────────────────────────────────────────────────────────────────────►
Rule-Based   →   LLM Bot      →   DPO          →   GRPO         →   Reasoning
(DONE)           (Best-of-N)      Fine-tuning      Self-Play        Enhancement
```

### Alternative Path (Traditional ML)

```
Phase 0          Phase 1          Phase 2          Phase 3          Phase 4
─────────────────────────────────────────────────────────────────────────────►
Rule-Based   →   MCTS Bot     →   Imitation    →   Decision     →   Hybrid
(DONE)           (Search)         Learning         Transformer      Intelligence
```

**Recommendation**: Start with the LLM-RL path. Recent advances (DPO, GRPO, reasoning models) make this simpler and more effective than traditional RL for a strategy game like Acquire. See `docs/ai/alternatives/llm-rl-advances.md` for details.

---

## Phase 0: Rule-Based Foundation ✅ COMPLETE

**Goal**: Playable bots at multiple difficulty levels

**Delivered**:
- Heuristic scoring for all 5 decision types
- Three difficulty levels (easy/medium/hard)
- Deterministic mode for reproducibility

**Strength**: Hard bot provides reasonable play using hand-crafted rules

---

## Phase 1: MCTS Bot (Search-Based)

**Goal**: Strong bot without machine learning

**Timeline**: 1-2 days implementation

### 1.1 Basic MCTS

```python
class MCTSBot:
    def __init__(self, simulations: int = 1000):
        self.simulations = simulations

    def choose_action(self, game, player_id) -> Action:
        # For each legal action:
        # 1. Clone game
        # 2. Apply action
        # 3. Random rollout to completion
        # 4. Track win rate
        # Return action with highest win rate
```

**Key Implementation Details**:
- Use existing `Game.clone()` for simulation
- Use `Rules.get_all_legal_actions()` for legal moves
- Random rollout using random bot for speed
- Configurable simulation count for difficulty scaling

### 1.2 Enhanced MCTS

After basic MCTS works:

| Enhancement | Description | Benefit |
|-------------|-------------|---------|
| UCB1 selection | Balance exploration/exploitation | Better action selection |
| Progressive widening | Focus on promising branches | Faster convergence |
| Heuristic rollouts | Use easy bot instead of random | Better value estimates |
| Transposition table | Cache evaluated positions | Speed improvement |

### 1.3 Information Set MCTS

Handle hidden information (opponent tiles):

```python
def ismcts_action(game, player_id, sims=1000):
    """MCTS with opponent tile sampling."""
    for _ in range(sims):
        # Sample possible opponent tiles consistent with observations
        determinized_game = sample_hidden_state(game, player_id)
        # Run standard MCTS on determinized game
        ...
```

### Deliverables
- [ ] `backend/game/mcts_bot.py` - MCTS implementation
- [ ] Configurable difficulty via simulation count
- [ ] Benchmark vs rule-based bots

### Success Criteria
- MCTS(1000 sims) beats hard bot >60% of games
- <5 second move time with 1000 simulations

---

## Phase 2: Neural Bot (Learning-Based)

**Goal**: Learn from data, faster inference than MCTS

### 2.1 Imitation Learning (Clone the Teacher)

**Approach**: Supervised learning to mimic hard bot

```
┌─────────────────────────────────────────────────────────────┐
│  Generate Data                                               │
│  - Run 100k games: hard bot vs hard bot                     │
│  - Record (state, action) pairs                             │
│  - ~500k training examples                                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Train Network                                               │
│  - Input: StateEncoder output (~750 dims)                   │
│  - Output: Action probabilities                              │
│  - Loss: CrossEntropy                                        │
│  - 10-20 epochs, ~1 hour training                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Result                                                      │
│  - Neural bot matches hard bot performance                   │
│  - Inference: <1ms per move (vs 5s for MCTS)                │
│  - Foundation for further improvement                        │
└─────────────────────────────────────────────────────────────┘
```

### Deliverables
- [ ] `backend/training/data_generator.py` - Generate training data
- [ ] `backend/training/state_encoder.py` - Implement state encoding
- [ ] `backend/training/policy_network.py` - Neural network
- [ ] `backend/training/imitation_trainer.py` - Training loop
- [ ] `backend/game/neural_bot.py` - Bot using trained network

### Success Criteria
- Neural bot performs within 5% of hard bot win rate
- Inference <10ms per move
- Training completes in <2 hours

### 2.2 Imitation from MCTS

Once MCTS works, use it as a stronger teacher:

```python
def generate_mcts_data(num_games, sims_per_move=2000):
    """Generate training data from MCTS decisions."""
    data = []
    for _ in range(num_games):
        game = Game(...)
        while not game.game_over:
            state = encode(game)
            # MCTS provides action AND visit counts (soft targets)
            action, visit_probs = mcts_search(game, sims_per_move)
            data.append((state, visit_probs))  # Soft targets
            game.apply_action(action)
    return data
```

**Benefit**: Neural net learns from stronger-than-hard-bot play

---

## Phase 3: Advanced Learning (Exceed Human Design)

**Goal**: Surpass heuristic bots through self-improvement

### 3.1 Option A: Decision Transformer

Treat game-playing as sequence modeling:

```
Training: Learn to predict actions that lead to wins
Inference: Condition on "I want to win" → get winning moves

Trajectory: [R=1, s₀, a₀, s₁, a₁, ..., sₜ, ?] → aₜ
            "Win"  states  actions       "What now?"
```

**Why Decision Transformer**:
- No value function needed (simpler than PPO)
- Standard supervised learning (stable training)
- Can condition on desired outcome
- Leverages transformer scaling

**Implementation**:
- [ ] Collect trajectories with outcomes from bot games
- [ ] GPT-2 style architecture (4 layers, 256 dim)
- [ ] Train to predict actions given (return, state, action) sequences
- [ ] At test time, condition on R=1.0 (winning)

### 3.2 Option B: Offline RL (IQL)

Learn from logged games without environment interaction:

```python
# Using d3rlpy library
import d3rlpy

# Load dataset of (s, a, r, s', done) from bot games
dataset = d3rlpy.dataset.MDPDataset(
    observations=states,
    actions=actions,
    rewards=rewards,
    terminals=dones
)

# Train IQL
iql = d3rlpy.algos.IQL()
iql.fit(dataset, n_epochs=100)

# Extract policy
policy = iql.as_stateful_wrapper()
```

**Why Offline RL**:
- Can exceed data quality (unlike pure imitation)
- No environment interaction during training
- Stable training (no policy gradient variance)
- Existing libraries (d3rlpy) handle complexity

### 3.3 Option C: AlphaZero-Style (MCTS + Neural Network)

Combine neural network with search:

```
┌─────────────────────────────────────────────────────────────┐
│  Neural Network                                              │
│  Input: Game state                                           │
│  Output: Policy p(a|s), Value v(s)                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  MCTS with Neural Guidance                                   │
│  - Use p(a|s) to guide tree expansion                       │
│  - Use v(s) to evaluate leaf nodes (no random rollout)      │
│  - Much more efficient than pure MCTS                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Self-Play Training                                          │
│  - Play games using MCTS                                     │
│  - Train network on (state, mcts_policy, outcome)           │
│  - Repeat: network improves → MCTS improves → ...           │
└─────────────────────────────────────────────────────────────┘
```

**Why AlphaZero-Style**:
- State-of-the-art for board games
- Self-play enables continuous improvement
- No need for human expertise in training data

**Complexity**: Higher than Decision Transformer/IQL, but potentially stronger

### Recommended Path

```
Decision Transformer (simpler) ─────┐
                                    ├──► Evaluate both ──► Choose winner
Offline RL / IQL (proven) ──────────┘
```

### Success Criteria
- Beat hard bot >70% of games
- Beat MCTS(1000) >55% of games

---

## Phase 4: Hybrid Intelligence

**Goal**: Combine neural speed with LLM reasoning and explainability

### 4.1 LLM for Trading

Already planned - use LLM for player-to-player trading:

```python
class TradingLLM:
    def evaluate_offer(self, game, offer) -> tuple[bool, str]:
        """Evaluate trade offer, return (accept, reasoning)."""
        prompt = f"""
        Game state: {describe_game(game)}
        Trade offer: {describe_offer(offer)}

        Should I accept? Consider:
        - Current stock holdings
        - Chain sizes and growth potential
        - Game stage (early/mid/late)

        Respond with: ACCEPT or REJECT, then explain why.
        """
        response = llm.complete(prompt)
        return parse_response(response)

    def propose_trade(self, game, player_id) -> Optional[TradeOffer]:
        """Generate trade proposal if beneficial."""
        ...
```

### 4.2 LLM for Critical Decisions

Use neural net for fast tactical moves, LLM for strategic decisions:

```python
class HybridBot:
    def __init__(self):
        self.neural = NeuralBot()
        self.llm = LLMBot()

    def choose_action(self, game, player_id):
        if self.is_critical_moment(game):
            # Merger decisions, endgame, etc.
            return self.llm.choose_with_reasoning(game, player_id)
        else:
            # Routine tile plays, stock purchases
            return self.neural.choose_action(game, player_id)

    def is_critical_moment(self, game):
        return (
            game.phase == GamePhase.MERGING or
            game.can_end_game() or
            self.is_close_game(game)
        )
```

### 4.3 Explainability

Allow players to ask "Why did you make that move?":

```python
def explain_move(game, action, bot_type="neural"):
    if bot_type == "neural":
        # Show action probabilities
        probs = neural_bot.get_action_probs(game)
        top_actions = sorted(probs.items(), key=lambda x: -x[1])[:3]
        return f"Top choices: {top_actions}"

    elif bot_type == "mcts":
        # Show visit counts
        visits = mcts_bot.get_visit_counts(game)
        return f"Simulations: {visits}"

    elif bot_type == "llm":
        # Natural language explanation
        return llm_bot.last_reasoning
```

### 4.4 Difficulty Adaptation

Adjust bot strength based on player skill:

```python
class AdaptiveBot:
    def __init__(self):
        self.player_skill = 0.5  # Estimated skill level

    def choose_action(self, game, player_id):
        if random.random() < self.mistake_rate():
            # Intentionally suboptimal play
            return self.second_best_action(game, player_id)
        return self.best_action(game, player_id)

    def mistake_rate(self):
        # Higher skill player → fewer bot mistakes
        return max(0, 0.3 - self.player_skill * 0.3)

    def update_skill_estimate(self, game_result):
        # Bayesian update based on game outcomes
        ...
```

---

## Evaluation Framework

### Benchmark Suite

```python
def run_benchmarks():
    bots = {
        "random": RandomBot(),
        "easy": RuleBot("easy"),
        "medium": RuleBot("medium"),
        "hard": RuleBot("hard"),
        "mcts_100": MCTSBot(100),
        "mcts_1000": MCTSBot(1000),
        "neural_v1": NeuralBot("v1"),
        "neural_v2": NeuralBot("v2"),
    }

    results = {}
    for bot_a, bot_b in combinations(bots, 2):
        wins_a, wins_b, draws = play_matches(bot_a, bot_b, n=1000)
        results[(bot_a, bot_b)] = (wins_a, wins_b, draws)

    return create_elo_ratings(results)
```

### Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| Win rate vs hard | % wins against hard bot | >70% for Phase 3 |
| Elo rating | Relative strength | Track over time |
| Move time | Inference latency | <100ms for neural |
| Training time | Time to reach target | <1 week Phase 3 |
| Explainability | Can explain decisions | Yes for Phase 4 |

### Human Evaluation

- Play against real players
- Collect feedback on difficulty/engagement
- A/B test different bot versions

---

## Implementation Priority

### High Priority (Do First)

1. **MCTS Bot** - No ML required, immediate strong play
2. **State Encoder** - Foundation for all neural approaches
3. **Imitation Learning** - Simplest ML approach
4. **Evaluation Framework** - Need to measure progress

### Medium Priority

5. **Decision Transformer or IQL** - Exceed hard bot
6. **Neural-guided MCTS** - Combine learning + search
7. **LLM Trading** - Enable bot trading

### Lower Priority (Nice to Have)

8. **Self-play Training** - Continuous improvement
9. **Difficulty Adaptation** - Better player experience
10. **Full Explainability** - Why did bot do X?

---

## File Structure

```
backend/
├── game/
│   ├── bot.py              # ✅ Rule-based bots
│   ├── mcts_bot.py         # 📋 MCTS implementation
│   └── neural_bot.py       # 📋 Neural network bot
├── training/
│   ├── config.py           # ✅ Hyperparameters
│   ├── state_encoder.py    # 📋 State → tensor
│   ├── data_generator.py   # 📋 Generate training data
│   ├── policy_network.py   # 📋 Neural network
│   ├── imitation.py        # 📋 Imitation learning
│   ├── decision_transformer.py  # 📋 DT implementation
│   ├── offline_rl.py       # 📋 IQL/CQL wrapper
│   └── evaluator.py        # 📋 Benchmarking
├── llm/
│   ├── game_player.py      # 📋 LLM game-playing agent
│   ├── dpo_trainer.py      # 📋 DPO fine-tuning
│   ├── trading_agent.py    # 📋 LLM for trading
│   └── explainer.py        # 📋 Move explanations
docs/ai/
├── README.md               # ✅ Overview
├── ROADMAP.md              # ✅ This document
├── ppo_explained.md        # ✅ PPO deep dive
├── state_encoding.md       # ✅ Observation design
├── training_pipeline.md    # ✅ Training details
└── alternatives/
    ├── README.md           # ✅ Traditional RL alternatives
    └── llm-rl-advances.md  # ✅ LLM-RL approaches (DPO, GRPO, etc.)
```

Legend: ✅ Complete | 📋 Planned

---

## Summary

### LLM-RL Path (Recommended)

| Phase | Approach | Complexity | Strength | Timeline |
|-------|----------|------------|----------|----------|
| 0 | Rule-based | Low | Medium | ✅ Done |
| 1 | **Best-of-N LLM** | Very Low | Medium-High | Hours |
| 2 | **DPO Fine-tuning** | Low-Medium | High | 1-3 days |
| 3 | **GRPO Self-Play** | Medium | Very High | 1 week |
| 4 | Reasoning Enhancement | Medium-High | Highest | 2 weeks |

### Traditional ML Path (Alternative)

| Phase | Approach | Complexity | Strength | Timeline |
|-------|----------|------------|----------|----------|
| 0 | Rule-based | Low | Medium | ✅ Done |
| 1 | MCTS | Low | High | 1-2 days |
| 2 | Imitation | Low-Medium | Medium | 3-5 days |
| 3 | DT/IQL | Medium | Very High | 1-2 weeks |
| 4 | Hybrid+LLM | Medium-High | Highest | 2-4 weeks |

### Why LLM-RL is Recommended

1. **Faster to start**: Best-of-N requires zero training, just API calls
2. **Simpler training**: DPO is one loss function, no reward model or value network
3. **Natural trading**: LLMs handle negotiation natively (Acquire's unique feature)
4. **Explainability built-in**: LLMs can articulate reasoning
5. **Better sample efficiency**: Pretrained knowledge bootstraps game understanding

**Recommended next step**: Try Best-of-N with Claude API (Phase 1 of LLM path) - test LLM viability in hours with zero training infrastructure.
