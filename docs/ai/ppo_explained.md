# PPO Explained: Teaching an AI to Play Acquire

This document explains Proximal Policy Optimization (PPO) through the lens of training an AI agent to play the board game Acquire.

## Table of Contents

1. [What is Reinforcement Learning?](#1-what-is-reinforcement-learning)
2. [The Policy Gradient Idea](#2-the-policy-gradient-idea)
3. [The Problem with Vanilla Policy Gradient](#3-the-problem-with-vanilla-policy-gradient)
4. [PPO's Solution: Trust Regions](#4-ppos-solution-trust-regions)
5. [Actor-Critic Architecture](#5-actor-critic-architecture)
6. [GAE: Better Advantage Estimates](#6-gae-better-advantage-estimates)
7. [Putting It Together: Training Loop](#7-putting-it-together-training-loop)
8. [Acquire-Specific Considerations](#8-acquire-specific-considerations)

---

## 1. What is Reinforcement Learning?

Reinforcement Learning (RL) is learning through trial and error. An **agent** interacts with an **environment**, observes **states**, takes **actions**, and receives **rewards**.

### The RL Framework Applied to Acquire

| RL Concept | Acquire Equivalent |
|------------|-------------------|
| **Agent** | The AI player |
| **Environment** | The game (board, tiles, other players) |
| **State** | Current board layout, player money/stocks, hand tiles |
| **Action** | Play a tile, found a chain, buy stocks, etc. |
| **Reward** | +1 for winning, -0.5 for losing |

```
┌─────────────────────────────────────────────────────────┐
│                    ACQUIRE GAME                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Board State: Tiles placed, chains formed       │   │
│  │  Player Info: Money, stocks, hand tiles         │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                               │
│                    observation                          │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │              NEURAL NETWORK AGENT               │   │
│  │  "Given this board state, which tile should     │   │
│  │   I play? Should I buy stocks?"                 │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                               │
│                       action                            │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Execute: Play tile 5A, buy 2 Tower stocks      │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                               │
│                       reward                            │
│                         ▼                               │
│           Game ends → Win (+1) or Lose (-0.5)          │
└─────────────────────────────────────────────────────────┘
```

### The Goal

Learn a **policy** π(a|s) — a function that maps states to actions — that maximizes expected cumulative reward (i.e., wins as many games as possible).

---

## 2. The Policy Gradient Idea

### Why Not Supervised Learning?

In supervised learning, we need labeled examples: "In this position, the correct move is X." But in Acquire:
- We don't have expert labels for every position
- Many moves might be "good enough"
- The best move depends on opponent behavior

### The Key Insight

Instead of learning the "correct" action, we learn to make good actions more likely and bad actions less likely.

**Policy Gradient Theorem:**
```
∇J(θ) = E[∇log π(a|s) · R]
```

In plain English:
- If an action led to a **high reward** → increase its probability
- If an action led to a **low reward** → decrease its probability

### Acquire Example

Imagine the agent plays a game and:
1. Played tile 7B, founding Tower chain → eventually won
2. Bought 3 Continental stocks instead of Luxor → eventually lost

After these games, the policy update will:
- **Increase** probability of founding Tower in similar positions
- **Decrease** probability of buying Continental over Luxor in similar positions

---

## 3. The Problem with Vanilla Policy Gradient

### High Variance

Game outcomes are noisy. The agent might:
- Make a brilliant move but lose due to bad luck
- Make a terrible move but win anyway

This creates high variance in gradient estimates, leading to unstable training.

### The Step Size Dilemma

**Too large step** → Catastrophic policy collapse
```
Before: "Play tiles that connect to chains" (good policy)
After:  "Always buy 3 stocks of any chain" (terrible policy)
```

**Too small step** → Training takes forever
```
After 1 million games, still plays randomly
```

### Acquire Illustration

Suppose the agent discovers that founding chains early is good. With vanilla PG:
- It might overcorrect: "ALWAYS found chains, never join existing ones"
- One bad update can destroy weeks of learning
- The policy oscillates between strategies

---

## 4. PPO's Solution: Trust Regions

PPO's key innovation: **limit how much the policy can change in one update**.

### The Probability Ratio

For each action, compute how much more/less likely it is under the new policy vs. the old:

```
r(θ) = π_new(a|s) / π_old(a|s)
```

| Ratio | Meaning |
|-------|---------|
| r = 1.0 | Same probability as before |
| r = 2.0 | Action is now 2x more likely |
| r = 0.5 | Action is now half as likely |

### The Clipping Mechanism

PPO clips this ratio to stay within [1-ε, 1+ε], typically ε=0.2:

```
L_CLIP = min(r(θ) · A, clip(r(θ), 1-ε, 1+ε) · A)
```

```
                    Clipped Region
                   ┌─────────────┐
                   │             │
     ─────────────┬┴─────────────┴┬─────────────
                0.8     1.0      1.2
                  │      │        │
                  │   No clip    │
                  │              │
            Max decrease    Max increase
            per update      per update
```

### Acquire Example: Founding vs. Joining

Suppose the old policy had:
- 30% chance to found a new chain
- 70% chance to join an existing chain

If founding led to a big win (high advantage), PPO might want to increase founding to 90%. But clipping limits it:

```
Without clipping: 30% → 90% (3x increase, dangerous!)
With clipping:    30% → 36% (1.2x increase, safe)
```

The agent can still learn that founding is good, but gradually over many updates.

---

## 5. Actor-Critic Architecture

PPO uses two neural networks (or two heads of one network):

### The Actor (Policy Network)

**Question:** "Given this board state, which action should I take?"

**Output:** Probability distribution over all legal actions

```
Input: Board state, player info, hand tiles
         │
         ▼
    ┌─────────────┐
    │   Actor     │
    │   Network   │
    └─────────────┘
         │
         ▼
Output: [Play 3A: 0.05, Play 7B: 0.40, Play 9C: 0.15, ...]
        (probabilities for each legal action)
```

### The Critic (Value Network)

**Question:** "How good is this position for me?"

**Output:** Single number estimating expected future reward

```
Input: Board state, player info, hand tiles
         │
         ▼
    ┌─────────────┐
    │   Critic    │
    │   Network   │
    └─────────────┘
         │
         ▼
Output: V(s) = 0.73
        (estimated probability of winning from here)
```

### Why Both?

The critic helps reduce variance in policy updates. Instead of asking "did I win?", we ask "did I do better than expected?"

**Advantage = Actual Outcome - Expected Outcome**

```
A(s,a) = R - V(s)
```

### Acquire Example

Position: You have majority in Tower (safe, 15 tiles). Critic estimates V(s) = 0.8 (80% win chance).

| Outcome | Advantage | Update Direction |
|---------|-----------|------------------|
| Win (+1) | +1 - 0.8 = +0.2 | Slightly reinforce actions |
| Lose (-0.5) | -0.5 - 0.8 = -1.3 | Strongly discourage actions |

The loss is surprising (we expected to win), so we learn more from it.

---

## 6. GAE: Better Advantage Estimates

### The Bias-Variance Tradeoff

Computing advantage is tricky:

**Monte Carlo (low bias, high variance):**
```
A = (total game reward) - V(s)
```
Problem: One unlucky tile draw affects all earlier decisions.

**TD(0) (low variance, high bias):**
```
A = r + γV(s') - V(s)
```
Problem: Relies heavily on critic accuracy, which is imperfect early in training.

### GAE: The Best of Both Worlds

Generalized Advantage Estimation blends multiple horizons:

```
A_GAE = δ_t + (γλ)δ_{t+1} + (γλ)²δ_{t+2} + ...

where δ_t = r_t + γV(s_{t+1}) - V(s_t)
```

**λ parameter:**
- λ = 0: Pure TD(0), low variance, high bias
- λ = 1: Pure Monte Carlo, high variance, low bias
- λ = 0.95: Good balance (typical default)

### Acquire Example

Turn 15: You buy 3 Tower stocks.
Turn 16: Opponent triggers a merger, you get majority bonus.
Turn 17: You use bonus to dominate Continental.
Turn 45: You win the game.

**Without GAE:** The stock purchase on turn 15 gets credit for the win 30 turns later (noisy signal).

**With GAE:** The stock purchase gets immediate credit for enabling the merger bonus (cleaner signal).

---

## 7. Putting It Together: Training Loop

```
┌─────────────────────────────────────────────────────────┐
│                   PPO TRAINING LOOP                     │
└─────────────────────────────────────────────────────────┘

for iteration in range(num_iterations):

    ┌─────────────────────────────────────────────────────┐
    │  1. COLLECT TRAJECTORIES                            │
    │     Play N games using current policy               │
    │     Store: (state, action, reward, next_state)      │
    └─────────────────────────────────────────────────────┘
                              │
                              ▼
    ┌─────────────────────────────────────────────────────┐
    │  2. COMPUTE ADVANTAGES                              │
    │     For each (s, a) pair:                           │
    │     - Get V(s) from critic                          │
    │     - Compute GAE advantage                         │
    └─────────────────────────────────────────────────────┘
                              │
                              ▼
    ┌─────────────────────────────────────────────────────┐
    │  3. UPDATE POLICY (Multiple Epochs)                 │
    │     For epoch in range(K):                          │
    │       - Sample minibatch                            │
    │       - Compute clipped surrogate loss              │
    │       - Update actor via gradient ascent            │
    │       - Update critic via MSE loss                  │
    └─────────────────────────────────────────────────────┘
                              │
                              ▼
    ┌─────────────────────────────────────────────────────┐
    │  4. REPEAT                                          │
    │     Old policy ← New policy                         │
    │     Collect more games...                           │
    └─────────────────────────────────────────────────────┘
```

### Typical Hyperparameters for Acquire

```python
config = {
    "learning_rate": 3e-4,      # Adam optimizer
    "gamma": 0.99,              # Discount factor
    "gae_lambda": 0.95,         # GAE lambda
    "clip_epsilon": 0.2,        # PPO clip ratio
    "num_epochs": 4,            # Epochs per update
    "batch_size": 64,           # Minibatch size
    "rollout_steps": 2048,      # Steps before update
}
```

---

## 8. Acquire-Specific Considerations

### Action Masking

Acquire has **illegal moves** (can't play a tile that merges safe chains). We mask these:

```python
def get_action(state, legal_actions):
    logits = actor_network(state)  # Raw scores for all actions

    # Mask illegal actions with large negative values
    mask = get_legal_action_mask(state)
    logits[mask == 0] = -1e9

    # Now softmax only considers legal actions
    probs = softmax(logits)
    return sample(probs)
```

### Sparse Rewards

Acquire only gives reward at game end (win/loss). This creates a **credit assignment problem**: which of 50+ moves led to victory?

**Solutions:**
1. **Dense reward shaping:** Small rewards for net worth increases
2. **GAE with high λ:** Propagate end-game reward backward
3. **Curriculum learning:** Start with easier games

### Multi-Agent Environment

Acquire is multiplayer. The agent must handle:
- **Variable opponents:** Sometimes easy bots, sometimes hard bots, sometimes self-play
- **Non-stationarity:** Opponents improve during training
- **Partial observability:** Can't see opponent's tiles

### Variable Player Counts

Acquire supports 2-6 players. The observation space is fixed (6 player slots), with inactive players zeroed out:

```
3-player game observation:
Player 0 (self):  [1.0, money, stocks...]   ← active
Player 1:         [1.0, money, stocks...]   ← active
Player 2:         [1.0, money, stocks...]   ← active
Player 3:         [0.0, 0, 0, 0, 0, 0, 0, 0, 0]  ← inactive (zeros)
Player 4:         [0.0, 0, 0, 0, 0, 0, 0, 0, 0]  ← inactive (zeros)
Player 5:         [0.0, 0, 0, 0, 0, 0, 0, 0, 0]  ← inactive (zeros)
```

The network learns to ignore inactive slots during training.

---

## Summary

PPO trains an Acquire agent by:

1. **Playing many games** and observing outcomes
2. **Computing advantages:** "Was this action better than expected?"
3. **Updating the policy conservatively:** Clipping prevents catastrophic changes
4. **Using a critic** to reduce variance in gradient estimates
5. **Repeating** until the agent masters the game

The key insight of PPO is that **stable, incremental improvement** beats aggressive updates that risk destroying what the agent has learned.

---

## Further Reading

- [Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347) - Original PPO paper
- [High-Dimensional Continuous Control Using Generalized Advantage Estimation](https://arxiv.org/abs/1506.02438) - GAE paper
- [OpenAI Spinning Up: PPO](https://spinningup.openai.com/en/latest/algorithms/ppo.html) - Excellent tutorial
