# Alternative Approaches to PPO for Acquire AI

This document evaluates whether PPO is the best approach for training Acquire bots and explores simpler and more modern alternatives based on RL advancements from 2024-2026.

## Table of Contents

1. [Is PPO the Best Choice?](#1-is-ppo-the-best-choice)
2. [Simpler Alternatives](#2-simpler-alternatives)
3. [Modern Alternatives (2024-2026)](#3-modern-alternatives-2024-2026)
4. [Comparison Matrix](#4-comparison-matrix)
5. [Recommendations](#5-recommendations)

---

## 1. Is PPO the Best Choice?

### PPO Strengths for Acquire

| Strength | Relevance |
|----------|-----------|
| Stable training | Important for sparse rewards |
| Works with discrete actions | Acquire has discrete action space |
| Well-documented | Extensive tutorials and implementations |
| Sample efficient (vs REINFORCE) | Helps with long games |

### PPO Weaknesses for Acquire

| Weakness | Impact |
|----------|--------|
| Requires extensive hyperparameter tuning | High implementation cost |
| Online learning only | Can't leverage existing game data |
| Complex infrastructure | Needs parallel environments, GAE, etc. |
| Sparse reward challenge | 50+ turns before feedback |
| Multi-agent non-stationarity | Opponents change during training |

### Verdict

PPO is a **reasonable but not optimal** choice for Acquire. It's a general-purpose algorithm that works, but there are approaches better suited to:
- Turn-based board games (MCTS-based methods)
- Leveraging existing bot games (offline RL)
- Reducing implementation complexity (imitation learning)

---

## 2. Simpler Alternatives

### 2.1 Pure Monte Carlo Tree Search (MCTS)

**Overview**: MCTS doesn't require neural networks at all. It uses random rollouts to evaluate positions.

```
                    Current Position
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          Play 3A      Play 7B      Buy stocks
              │            │            │
         Simulate     Simulate     Simulate
         100 games    100 games    100 games
              │            │            │
              ▼            ▼            ▼
          Win: 45%     Win: 62%     Win: 38%

         → Choose "Play 7B" (highest win rate)
```

**Implementation Complexity**: Low
- No neural networks
- No training required
- Just need game simulation (already have `Game.clone()`)

**Strengths**:
- Works immediately with no training
- Performance scales with compute time
- Handles multi-agent naturally
- Already have the infrastructure (`Game.clone()`, `Rules.get_all_legal_actions()`)

**Weaknesses**:
- Slow at runtime (needs many simulations per move)
- Doesn't learn from experience
- Hidden information (opponent tiles) problematic

**Acquire Suitability**: **High** - Turn-based game with cloneable state

**Implementation Estimate**: 200-300 lines of Python

```python
# Pseudocode
def mcts_choose_action(game, player_id, simulations=1000):
    legal_actions = Rules.get_all_legal_actions(game, player_id)
    win_counts = {a: 0 for a in legal_actions}

    for action in legal_actions:
        for _ in range(simulations // len(legal_actions)):
            game_copy = game.clone()
            game_copy.apply_action(action)
            winner = random_rollout(game_copy)
            if winner == player_id:
                win_counts[action] += 1

    return max(legal_actions, key=lambda a: win_counts[a])
```

---

### 2.2 Imitation Learning (Behavioral Cloning)

**Overview**: Train a neural network to mimic the existing hard bot using supervised learning.

```
┌─────────────────────────────────────────────────────────┐
│  Step 1: Generate Training Data                         │
│  Run 100,000 games with hard bots                       │
│  Record: (game_state, action_taken) pairs               │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: Supervised Learning                            │
│  Train neural network to predict action given state     │
│  Loss = CrossEntropy(predicted_action, bot_action)      │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Result: Neural bot that mimics hard bot                │
│  Faster inference than rule-based bot                   │
│  Can be fine-tuned with RL later                        │
└─────────────────────────────────────────────────────────┘
```

**Implementation Complexity**: Low
- Standard supervised learning
- Use existing StateEncoder design
- PyTorch CrossEntropyLoss

**Strengths**:
- Much simpler than PPO
- Stable training (just supervised learning)
- Can generate unlimited training data from existing bots
- Good starting point for RL fine-tuning

**Weaknesses**:
- Can't exceed teacher performance (hard bot is the ceiling)
- May not generalize to unseen positions
- Distribution shift at deployment

**Acquire Suitability**: **Very High** - Already have strong heuristic bot to learn from

**When to Use**: As a first milestone before attempting RL

---

### 2.3 Enhanced Heuristics

**Overview**: Instead of ML, improve the existing rule-based bot with more sophisticated heuristics.

The current hard bot uses relatively simple scoring:
- Founding chains: +100
- Expanding owned chains: +50 + 5 × stock_count
- Triggering good mergers: +30

**Potential Enhancements**:
1. **Look-ahead search**: Evaluate 2-3 moves ahead
2. **Opponent modeling**: Track opponent tendencies
3. **Position evaluation**: Better scoring of board positions
4. **Endgame calculation**: Exact computation when few tiles remain

**Implementation Complexity**: Low-Medium

**Strengths**:
- No training infrastructure needed
- Interpretable decisions
- Can be very strong for board games

**Weaknesses**:
- Requires domain expertise
- Diminishing returns on heuristic tuning
- May miss non-obvious strategies

**Acquire Suitability**: **High** - Chess engines show heuristics can be very strong

---

## 3. Modern Alternatives (2024-2026)

### 3.1 Decision Transformers

**Overview**: Treat RL as sequence modeling. A transformer learns to predict actions that lead to high returns.

**Key Innovation**: Instead of learning a policy that maximizes reward, learn a model that generates actions conditioned on desired return.

```
Input Sequence:
[R=1.0, s₁, a₁, s₂, a₂, ..., sₜ, ?]
  │                              │
  └─ "I want to win"            └─ "What action?"

Output: Next action that leads to return R
```

**Paper**: "Decision Transformer: Reinforcement Learning via Sequence Modeling" (Chen et al., 2021) + many 2024-2025 improvements

**Implementation Complexity**: Medium
- Requires transformer architecture
- Needs trajectory data (can generate from bot games)
- Standard supervised learning with cross-entropy

**Strengths**:
- No value function estimation
- No policy gradient variance issues
- Leverages transformer scaling laws
- Works offline (no environment interaction during training)
- Can condition on desired outcome

**Weaknesses**:
- Requires good trajectory data (ideally from strong players)
- May struggle with out-of-distribution states
- Transformer inference slower than MLP

**Acquire Suitability**: **High**
- Can condition on "R=1.0" (winning) to get strong play
- Game trajectories are natural sequences
- Can bootstrap from bot games

**Example Architecture**:
```python
class AcquireDecisionTransformer(nn.Module):
    def __init__(self):
        self.state_encoder = StateEncoder()  # Existing design
        self.transformer = GPT2(
            n_embd=256,
            n_layer=4,
            n_head=4,
            context_length=100  # ~100 turns max
        )
        self.action_head = nn.Linear(256, num_actions)

    def forward(self, returns, states, actions, timesteps):
        # Returns: desired cumulative reward
        # States: game observations
        # Actions: previous actions taken
        # Predict next action
        ...
```

---

### 3.2 Offline RL (IQL / CQL)

**Overview**: Learn policies entirely from logged data, without any environment interaction.

**Key Methods**:
- **CQL (Conservative Q-Learning)**: Learns a pessimistic Q-function
- **IQL (Implicit Q-Learning)**: Avoids querying out-of-distribution actions
- **TD3+BC**: Combines TD3 with behavioral cloning regularization

**Why Relevant for Acquire**:
- Can train on games played by existing bots
- Can incorporate human games if logged
- No need for environment interaction during training

```
┌─────────────────────────────────────────────────────────┐
│  Offline Dataset                                        │
│  - 1M games from hard bot vs hard bot                   │
│  - 100k games from human players (if available)         │
│  - Mixed difficulty games for diversity                 │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  IQL Training                                           │
│  - Learn Q(s,a) from data                               │
│  - Constrained to not overestimate OOD actions          │
│  - Extract policy: π(a|s) ∝ exp(A(s,a)/β)              │
└─────────────────────────────────────────────────────────┘
```

**Implementation Complexity**: Medium
- Requires careful Q-function regularization
- More complex than behavioral cloning
- Good implementations available (CleanRL, d3rlpy)

**Strengths**:
- No environment interaction needed
- Can learn from suboptimal data
- More stable than online RL
- Can exceed data quality (unlike pure imitation)

**Weaknesses**:
- Requires sufficient data coverage
- Hyperparameter sensitive
- May be conservative in novel situations

**Acquire Suitability**: **Very High**
- Can easily generate millions of bot games
- Avoids sparse reward exploration problem
- Simpler infrastructure than PPO

---

### 3.3 MuZero-Style Planning

**Overview**: Learn a world model and use it for planning, without requiring a perfect simulator.

**Key Insight**: Don't model raw observations—model abstract states sufficient for planning.

```
┌─────────────────────────────────────────────────────────┐
│  MuZero Components                                      │
│                                                         │
│  Representation: s → h (encode state to hidden)        │
│  Dynamics: (h, a) → h' (predict next hidden state)     │
│  Prediction: h → (p, v) (policy and value)             │
│  Planning: MCTS in learned model                        │
└─────────────────────────────────────────────────────────┘
```

**Paper**: "Mastering Atari, Go, Chess and Shogi by Planning with a Learned Model" (Schrittwieser et al., 2020) + 2024 EfficientZero improvements

**Implementation Complexity**: High
- Requires learned dynamics model
- MCTS integration
- Complex training loop

**Strengths**:
- State-of-the-art for board games
- Handles partial observability
- Combines learning with planning
- Self-play improves over time

**Weaknesses**:
- Very complex implementation
- Significant compute requirements
- Harder to debug than simpler methods

**Acquire Suitability**: **Medium-High**
- Powerful but perhaps overkill
- Justified if aiming for superhuman play
- Already have perfect simulator, so world model less critical

---

### 3.4 LLM-Based Game Playing

**Overview**: Use large language models to play games through prompting or fine-tuning.

**Recent Work**: GPT-4 and Claude can play board games via chain-of-thought reasoning with game state descriptions.

```
Prompt:
"You are playing Acquire. Current state:
- Your money: $4,500
- Your stocks: Tower(3), Luxor(2)
- Active chains: Tower(8 tiles), Luxor(5 tiles)
- Your tiles: 3A, 7B, 9C, 11D, 2E, 5F

Legal actions: Play 3A (founds American), Play 7B (expands Tower), ...

What's your move and why?"

Response:
"I'll play 7B to expand Tower because I have majority stockholding..."
```

**Implementation Complexity**: Very Low (API) to Medium (fine-tuning)

**Strengths**:
- Explainable decisions
- Zero-shot capability
- Can handle complex reasoning
- Natural language interface
- No training required for API approach

**Weaknesses**:
- Slower inference (API latency)
- Higher cost per decision
- May make illegal moves (need validation)
- Not optimal for pure performance

**Acquire Suitability**: **High for hybrid approach**
- Already planned for trading negotiations
- Could handle strategic reasoning while simple policy handles execution
- Great for explainability ("Why did you make that move?")

**Hybrid Architecture**:
```python
class HybridBot:
    def __init__(self):
        self.fast_policy = NeuralPolicy()  # Fast tactical decisions
        self.llm = ClaudeAPI()              # Strategic reasoning

    def choose_action(self, game, player_id):
        if self.is_critical_decision(game):
            # Use LLM for important decisions (mergers, endgame)
            return self.llm_decide(game, player_id)
        else:
            # Use fast policy for routine moves
            return self.fast_policy(game, player_id)
```

---

## 4. Comparison Matrix

| Approach | Complexity | Training Time | Performance Ceiling | Infrastructure Needed |
|----------|------------|---------------|---------------------|----------------------|
| **PPO** | High | Days-Weeks | High | Parallel envs, GAE, many hyperparams |
| **Pure MCTS** | Low | None | Medium | Just game simulation |
| **Imitation Learning** | Low | Hours | Medium (teacher level) | Data generation, supervised training |
| **Enhanced Heuristics** | Low-Medium | None | Medium-High | Domain expertise |
| **Decision Transformer** | Medium | Hours-Days | High | Trajectory data, transformer |
| **Offline RL (IQL)** | Medium | Hours-Days | High | Offline data, Q-learning |
| **MuZero** | Very High | Days-Weeks | Very High | Complex system |
| **LLM-Based** | Very Low | None | Medium-High | API access |

### Cost-Benefit Analysis for Acquire

Given:
- Already have strong heuristic bot
- Game has moderate complexity (not Chess/Go level)
- Goal is likely "beat hard bot" not "superhuman"
- Limited development resources (hobby project)

**Ranking by ROI**:

1. **Imitation Learning** - Lowest effort, immediate results, good baseline
2. **Pure MCTS** - No training, scales with compute, works today
3. **Decision Transformer** - Modern, elegant, leverages trajectory data
4. **Offline RL (IQL)** - Can exceed bot performance, stable training
5. **LLM Hybrid** - Great for explainability and trading
6. **PPO** - Works but high complexity for the payoff
7. **MuZero** - Overkill for this game

---

## 5. Recommendations

### Recommended Approach: Staged Development

#### Stage 1: Immediate Win - MCTS Bot (1-2 days)

Implement a simple MCTS bot that:
- Uses `Game.clone()` for simulation
- Random rollouts to evaluate positions
- Configurable simulation count for difficulty

**Why**: Works immediately, no training, provides strong baseline.

#### Stage 2: Learning Baseline - Imitation Learning (3-5 days)

Train a neural network to mimic the hard bot:
- Generate 100k+ games of hard bot vs hard bot
- Use existing StateEncoder design
- Simple MLP with CrossEntropy loss

**Why**: Proves the pipeline works, creates fast neural bot.

#### Stage 3: Exceed the Teacher - Decision Transformer or IQL (1-2 weeks)

Choose based on preference:

**Option A: Decision Transformer**
- Collect trajectories with outcomes
- Train transformer to predict winning moves
- Condition on R=1.0 at test time

**Option B: Implicit Q-Learning (IQL)**
- Use d3rlpy library
- Train on bot game data
- Extract greedy policy

**Why**: Both can exceed the heuristic bot with offline data alone.

#### Stage 4 (Optional): Hybrid Intelligence

Add LLM for:
- Critical decision analysis
- Trading negotiations (already planned)
- Explainability ("Why this move?")

### Not Recommended

**PPO as first approach**: Too complex for the potential payoff. The infrastructure burden (parallel environments, GAE, hyperparameter tuning, curriculum design) is high when simpler methods can achieve similar results.

**MuZero**: Overkill for Acquire. The game isn't complex enough to justify the implementation cost. Reserve for Chess/Go level challenges.

---

## Appendix: Quick-Start Code Snippets

### A. Minimal MCTS

```python
import random
from game import Game, Rules

def mcts_action(game: Game, player_id: str, sims: int = 500) -> Action:
    """Select action using Monte Carlo Tree Search."""
    legal = Rules.get_all_legal_actions(game, player_id)
    if len(legal) == 1:
        return legal[0]

    wins = {i: 0 for i in range(len(legal))}
    plays = {i: 0 for i in range(len(legal))}

    for i, action in enumerate(legal):
        for _ in range(sims // len(legal)):
            g = game.clone()
            g.apply_action(action)
            winner = rollout_random(g)
            plays[i] += 1
            if winner == player_id:
                wins[i] += 1

    # UCB1 selection (exploration/exploitation)
    best = max(range(len(legal)),
               key=lambda i: wins[i] / max(plays[i], 1))
    return legal[best]

def rollout_random(game: Game) -> str:
    """Play random moves until game ends."""
    while not game.game_over:
        player = game.current_player
        actions = Rules.get_all_legal_actions(game, player.id)
        game.apply_action(random.choice(actions))
    return game.get_winner().id
```

### B. Imitation Learning Dataset

```python
from dataclasses import dataclass
from typing import List, Tuple
import torch

@dataclass
class Transition:
    state: torch.Tensor
    action_idx: int

def generate_imitation_data(num_games: int) -> List[Transition]:
    """Generate training data from hard bot games."""
    data = []
    encoder = StateEncoder()

    for _ in range(num_games):
        game = Game(players=["bot1", "bot2", "bot3", "bot4"])
        bots = {p.id: Bot(game, p.id, "hard") for p in game.players}

        while not game.game_over:
            player = game.current_player
            bot = bots[player.id]

            # Encode current state
            state = encoder.encode(game, player.id)

            # Get bot's chosen action
            action = bot.get_action(game)
            action_idx = action_to_index(action)

            data.append(Transition(state, action_idx))
            game.apply_action(action)

    return data
```

### C. Decision Transformer Skeleton

```python
import torch
import torch.nn as nn

class AcquireDecisionTransformer(nn.Module):
    def __init__(self, state_dim=750, action_dim=200, hidden=256):
        super().__init__()

        self.state_embed = nn.Linear(state_dim, hidden)
        self.action_embed = nn.Embedding(action_dim, hidden)
        self.return_embed = nn.Linear(1, hidden)
        self.pos_embed = nn.Embedding(100, hidden)  # Max 100 timesteps

        self.transformer = nn.TransformerEncoder(
            nn.TransformerEncoderLayer(d_model=hidden, nhead=4),
            num_layers=4
        )

        self.action_head = nn.Linear(hidden, action_dim)

    def forward(self, returns, states, actions, timesteps):
        B, T = states.shape[:2]

        # Embed each modality
        r_emb = self.return_embed(returns.unsqueeze(-1))
        s_emb = self.state_embed(states)
        a_emb = self.action_embed(actions)
        pos = self.pos_embed(timesteps)

        # Interleave: [r1, s1, a1, r2, s2, a2, ...]
        h = torch.stack([r_emb, s_emb, a_emb], dim=2)
        h = h.reshape(B, 3*T, -1) + pos.repeat(1, 3, 1)

        # Transformer
        h = self.transformer(h.transpose(0, 1)).transpose(0, 1)

        # Predict action from state embeddings
        state_h = h[:, 1::3]  # Every 3rd starting from index 1
        return self.action_head(state_h)
```

---

## Further Reading

### Decision Transformers
- [Decision Transformer](https://arxiv.org/abs/2106.01345) (Chen et al., 2021)
- [Online Decision Transformer](https://arxiv.org/abs/2202.05607) (Zheng et al., 2022)
- [Q-learning Decision Transformer](https://arxiv.org/abs/2209.03993) (Yamagata et al., 2023)

### Offline RL
- [IQL: Implicit Q-Learning](https://arxiv.org/abs/2110.06169) (Kostrikov et al., 2021)
- [CQL: Conservative Q-Learning](https://arxiv.org/abs/2006.04779) (Kumar et al., 2020)
- [d3rlpy Library](https://github.com/takuseno/d3rlpy)

### MCTS
- [Monte Carlo Tree Search Survey](https://ieeexplore.ieee.org/document/6145622)
- [Information Set MCTS](https://arxiv.org/abs/1111.2396) (for hidden information)

### LLM Game Playing
- [Language Models as Game Players](https://arxiv.org/abs/2303.17491)
- [Chain-of-Thought Prompting](https://arxiv.org/abs/2201.11903)
