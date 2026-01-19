# RL Advances for LLMs and Game Playing

Recent breakthroughs in training LLMs with RL (2023-2025) offer new approaches for game-playing agents that weren't covered in the main alternatives document.

## Table of Contents

1. [The LLM-RL Revolution](#1-the-llm-rl-revolution)
2. [Key Techniques](#2-key-techniques)
3. [Application to Acquire](#3-application-to-acquire)
4. [Recommended Approach](#4-recommended-approach)

---

## 1. The LLM-RL Revolution

### What Changed

Traditional game AI (AlphaGo, MuZero) trained neural networks from scratch. The new paradigm:

```
Old: Random weights → RL training → Game expert
New: Pretrained LLM → RL fine-tuning → Game expert with reasoning
```

**Key insight**: Start with an LLM that already understands strategy, language, and reasoning, then fine-tune it for your specific game.

### Notable Examples

| System | Approach | Result |
|--------|----------|--------|
| **OpenAI o1** | RL for reasoning chains | SOTA on math, coding, reasoning |
| **DeepSeek R1** | GRPO + long CoT | Matches o1 at lower cost |
| **Claude** | RLHF + Constitutional AI | Strong general reasoning |
| **Cicero** (Meta) | LLM + planning for Diplomacy | Human-level negotiation game |

---

## 2. Key Techniques

### 2.1 RLHF (Reinforcement Learning from Human Feedback)

The original technique for aligning LLMs (ChatGPT, Claude).

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Supervised Fine-Tuning (SFT)                       │
│  Train LLM on examples of good game play                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Reward Model Training                              │
│  Train a model to predict: "Which move is better?"          │
│  Data: Human rankings of move quality                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: PPO Fine-Tuning                                    │
│  Optimize LLM policy against reward model                   │
│  KL penalty to stay close to SFT model                      │
└─────────────────────────────────────────────────────────────┘
```

**For Acquire**:
- SFT on game transcripts with expert commentary
- Reward model trained on "which move is better" comparisons
- PPO to optimize move selection

**Complexity**: High (need reward model + PPO)

---

### 2.2 DPO (Direct Preference Optimization)

**The breakthrough**: Skip the reward model entirely!

```
RLHF:  SFT → Train Reward Model → PPO with RM
DPO:   SFT → Direct optimization on preferences (one step!)
```

**How it works**:

$$\mathcal{L}_{\text{DPO}} = -\mathbb{E}\left[\log \sigma\left(\beta \log \frac{\pi_\theta(y_w|x)}{\pi_{\text{ref}}(y_w|x)} - \beta \log \frac{\pi_\theta(y_l|x)}{\pi_{\text{ref}}(y_l|x)}\right)\right]$$

In plain English:
- Given pairs of (better move, worse move)
- Directly increase probability of better move
- Decrease probability of worse move
- No separate reward model needed

**For Acquire**:
```python
# DPO training data format
preferences = [
    {
        "state": game_state_description,
        "chosen": "Play 7B to expand Tower (I have majority)",  # Better
        "rejected": "Play 3A to found new chain (spreads too thin)"  # Worse
    },
    ...
]
```

**Complexity**: Medium (much simpler than RLHF)

**Why it's great for games**:
- Easy to generate preference pairs from bot games
- Strong bot move vs weaker bot move = preference pair
- No reward model infrastructure needed

---

### 2.3 GRPO (Group Relative Policy Optimization)

Used by DeepSeek to train R1. Key innovation: **no critic network needed**.

```
┌─────────────────────────────────────────────────────────────┐
│  For each game state:                                       │
│  1. Sample N different moves from the LLM                   │
│  2. Play out each move (or evaluate with heuristic)         │
│  3. Rank moves by outcome                                   │
│  4. Update: increase prob of better moves, decrease worse   │
└─────────────────────────────────────────────────────────────┘
```

**Advantage over PPO**:
- No value network to train
- Self-normalizing (compares moves to each other)
- Simpler implementation

**For Acquire**:
```python
def grpo_step(llm, game_state, n_samples=8):
    # Sample multiple moves
    moves = [llm.sample_move(game_state) for _ in range(n_samples)]

    # Evaluate each (play out game or use heuristic)
    scores = [evaluate_move(game_state, move) for move in moves]

    # Compute advantages (relative to group mean)
    mean_score = np.mean(scores)
    advantages = [(s - mean_score) / np.std(scores) for s in scores]

    # Update LLM to favor higher-advantage moves
    llm.update(moves, advantages)
```

**Complexity**: Medium (simpler than PPO, similar to DPO)

---

### 2.4 Reasoning via RL (o1/R1 Style)

The newest paradigm: Train LLMs to reason step-by-step before acting.

```
Traditional:  State → Action
Reasoning:    State → Think → Think → Think → Action
```

**How it applies to games**:

```
Input: "Current state: You have $4500, 3 Tower stock, 2 Luxor..."

LLM Reasoning (hidden):
"Let me think about this position...
- Tower has 8 tiles, I'm majority holder
- If I play 7B, Tower grows to 9
- Luxor has 5 tiles, I'm minority
- Playing 3A would found American, but I lack cash for stock
- Best move is 7B because..."

Output: "Play 7B"
```

**Training approach**:
1. Generate reasoning traces via search (MCTS) or process supervision
2. Train LLM to produce winning reasoning chains
3. RL to reinforce traces that lead to wins

**For Acquire**:
- Generate reasoning traces for key positions
- Train model to "think through" strategy
- Verifiable: did the reasoning lead to a win?

**Complexity**: High (need reasoning data generation)

---

### 2.5 Rejection Sampling / Best-of-N

Simplest approach: Generate multiple responses, pick the best.

```python
def best_of_n_move(llm, game_state, n=16):
    # Generate N candidate moves with reasoning
    candidates = [llm.generate_move(game_state) for _ in range(n)]

    # Score each (using verifier, heuristic, or another model)
    scores = [score_move(game_state, c) for c in candidates]

    # Return best
    return candidates[np.argmax(scores)]
```

**Why it works**:
- LLM already has game knowledge
- Sampling explores different strategies
- Verifier/scorer picks the best

**For Acquire**:
- Use existing hard bot scoring as verifier
- Or train a simple reward model
- Zero RL complexity, just inference-time scaling

**Complexity**: Very Low

---

### 2.6 Self-Play with LLMs

Combine LLM game-playing with self-play improvement:

```
┌─────────────────────────────────────────────────────────────┐
│  Round 1: LLM plays against itself                          │
│  → Collect game transcripts with outcomes                   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Round 2: Fine-tune on winning strategies                   │
│  → DPO on (winning move, losing move) pairs                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Round 3: Repeat with stronger LLM                          │
│  → Continuous improvement loop                              │
└─────────────────────────────────────────────────────────────┘
```

**Example**: Cicero (Diplomacy) used LLM + planning + self-play to achieve human-level play in a complex negotiation game.

---

## 3. Application to Acquire

### Why LLM-RL is Promising for Acquire

| Acquire Feature | LLM-RL Advantage |
|-----------------|------------------|
| Complex strategy | LLMs understand strategy concepts |
| Trading/negotiation | Natural language is LLM strength |
| Explainability | LLMs can explain reasoning |
| Limited training data | Pretrained knowledge helps |
| Multi-agent | LLMs handle social dynamics |

### Comparison: Traditional RL vs LLM-RL

| Aspect | Traditional RL (PPO) | LLM-RL |
|--------|---------------------|--------|
| Starting point | Random network | Pretrained reasoning |
| Training data | Millions of games | Thousands sufficient |
| Action representation | Discrete indices | Natural language |
| Explainability | Opaque | Built-in |
| Trading support | Very hard | Natural fit |
| Compute cost | GPU for training | GPU/API for inference |

### Proposed LLM-RL Pipeline for Acquire

```
┌─────────────────────────────────────────────────────────────┐
│  Stage 1: Prompt Engineering (0 training)                   │
│  - Design prompts for game state description                │
│  - Few-shot examples of good play                           │
│  - Test with Claude/GPT-4 API                               │
│  - Baseline: Does it play legally? Reasonably?              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 2: SFT on Game Transcripts                           │
│  - Generate 10k games from hard bot with commentary         │
│  - Fine-tune small LLM (Llama-3-8B, Mistral-7B)            │
│  - Input: state description → Output: move + reasoning      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 3: DPO Improvement                                   │
│  - Generate preference pairs from self-play                 │
│  - Winner's moves preferred over loser's moves              │
│  - Or: MCTS-selected moves vs LLM's original choice         │
│  - Fine-tune with DPO loss                                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 4: Reasoning Enhancement (Optional)                  │
│  - Add chain-of-thought for complex positions               │
│  - Process reward model for reasoning steps                 │
│  - GRPO to reinforce good reasoning chains                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Recommended Approach

### Updated Recommendation

Given LLM-RL advances, here's the revised priority:

| Rank | Approach | Complexity | Strength | Notes |
|------|----------|------------|----------|-------|
| 1 | **Best-of-N with LLM** | Very Low | Medium-High | Start here! Zero training |
| 2 | **DPO fine-tuning** | Low-Medium | High | Simple, effective |
| 3 | **MCTS + LLM** | Medium | Very High | LLM guides search |
| 4 | GRPO self-play | Medium | Very High | DeepSeek R1 approach |
| 5 | Full RLHF | High | Very High | Only if needed |

### Quick Start: Best-of-N (Today)

```python
import anthropic

client = anthropic.Anthropic()

def llm_choose_move(game, player_id, n_samples=8):
    state_desc = describe_game_state(game, player_id)
    legal_moves = Rules.get_all_legal_actions(game, player_id)

    prompt = f"""You are playing Acquire.

Current state:
{state_desc}

Legal moves: {[str(m) for m in legal_moves]}

Think step by step about the best move, then output your choice."""

    candidates = []
    for _ in range(n_samples):
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )
        move = parse_move(response.content[0].text, legal_moves)
        candidates.append(move)

    # Score candidates using existing hard bot heuristics
    scores = [hard_bot_score(game, move) for move in candidates]
    return candidates[np.argmax(scores)]
```

**Cost**: ~$0.01-0.05 per move with Claude Sonnet
**Strength**: Likely competitive with hard bot immediately

### Medium-Term: DPO Fine-Tuning

```python
# Generate preference data
def generate_dpo_data(num_games=1000):
    data = []
    for _ in range(num_games):
        game = Game(players=["strong", "weak", "weak", "weak"])
        bots = {
            "strong": MCTSBot(simulations=1000),  # Strong player
            "weak": RuleBot("medium")              # Weaker players
        }

        transcript = []
        while not game.game_over:
            player = game.current_player
            state_desc = describe_game_state(game, player.id)

            if player.id == "strong":
                chosen_move = bots["strong"].choose(game)
                # Also get what a weaker bot would do
                rejected_move = RuleBot("easy").choose(game)

                if chosen_move != rejected_move:
                    data.append({
                        "prompt": state_desc,
                        "chosen": describe_move(chosen_move),
                        "rejected": describe_move(rejected_move)
                    })

            game.apply_action(bots[player.id].choose(game))

    return data

# Train with DPO
from trl import DPOTrainer

trainer = DPOTrainer(
    model=base_llm,
    ref_model=base_llm,
    train_dataset=dpo_data,
    beta=0.1,  # KL penalty
)
trainer.train()
```

### Why This Beats Traditional RL

1. **Faster iteration**: DPO trains in hours, not days
2. **Less infrastructure**: No parallel envs, no value network
3. **Better sample efficiency**: Pretrained knowledge bootstraps learning
4. **Natural trading**: LLM handles negotiation natively
5. **Explainability for free**: LLM can explain its reasoning

---

## Summary: Revised Roadmap

```
Phase 0: Rule-based bots          ✅ DONE
Phase 1: MCTS (search)            → Still valuable for data generation
Phase 2: Best-of-N LLM            → NEW: Quick win, test LLM viability
Phase 3: DPO fine-tuning          → NEW: Simple RL, high impact
Phase 4: GRPO self-play           → NEW: Continuous improvement
Phase 5: Reasoning enhancement    → NEW: o1-style for complex positions
```

The LLM-RL approach is particularly compelling for Acquire because:
- Trading requires natural language (LLM native)
- Strategy is explainable (LLM can articulate)
- Game is complex but not computationally extreme (LLM inference feasible)
- Small training data is sufficient (unlike training from scratch)

**Bottom line**: Try Best-of-N with Claude API first. If it shows promise, proceed to DPO fine-tuning of an open-source model.
