# Acquire AI Training Infrastructure

This document describes the plan for training a neural network-based AI to play Acquire using Reinforcement Learning with Self-Play.

## Overview

**Approach**: PPO (Proximal Policy Optimization) with curriculum learning, starting against existing heuristic bots and progressing to self-play.

## Architecture

### Files Structure

```
backend/
├── game/
│   ├── action.py          # Unified action representation (NEW)
│   ├── game.py            # Modified: seeding, cloning, apply_action
│   ├── bot.py             # Modified: deterministic RNG support
│   ├── rules.py           # Modified: legal action enumeration
│   └── neural_bot.py      # Neural network bot integration (TODO)
├── training/
│   ├── __init__.py
│   ├── config.py          # Hyperparameters (DONE)
│   ├── state_encoder.py   # Game state -> tensors (TODO)
│   ├── game_env.py        # Gymnasium environment (TODO)
│   ├── policy.py          # Actor-critic network (TODO)
│   ├── trainer.py         # PPO training loop (TODO)
│   └── evaluator.py       # Benchmark against bots (TODO)
scripts/
├── train.py               # Training entry point (TODO)
└── evaluate.py            # Evaluation script (TODO)
```

## Completed Work

### 1. Deterministic Seeding
- `Game` class now accepts optional `seed` parameter
- Uses `random.Random(seed)` instance instead of global `random`
- Bot class also supports deterministic RNG
- Enables reproducible games for debugging and evaluation

### 2. Unified Action Class (`game/action.py`)
```python
class ActionType(Enum):
    PLAY_TILE = "play_tile"
    FOUND_CHAIN = "found_chain"
    CHOOSE_MERGER_SURVIVOR = "choose_merger_survivor"
    STOCK_DISPOSITION = "stock_disposition"
    BUY_STOCKS = "buy_stocks"
    END_TURN = "end_turn"
    END_GAME = "end_game"

@dataclass
class Action:
    action_type: ActionType
    tile: Optional[str] = None
    chain: Optional[str] = None
    stocks: Optional[List[str]] = None
    disposition: Optional[Dict[str, int]] = None
```

Factory methods: `Action.play_tile("1A")`, `Action.found_chain("Luxor")`, etc.

### 3. Game Cloning Support
- `Game.clone()` - Deep copy for MCTS/simulation
- `Game.get_full_state()` - Serialize complete state
- `Game.from_state()` - Restore from serialized state
- `Game.apply_action()` - Unified action interface

### 4. Legal Action Enumeration (`rules.py`)
```python
Rules.get_all_legal_actions(game, player_id) -> List[Action]
```
Returns all valid actions for current game state, essential for action masking in RL.

### 5. Training Config (`training/config.py`)
Hyperparameters including:
- PPO settings (lr, gamma, clip_epsilon, etc.)
- Curriculum learning stages
- Self-play configuration
- Network architecture params

## Remaining Work

### Phase 1: State Encoder (`state_encoder.py`)
Observation space (~750 dimensions):
- Board: 108 values (12x9 grid, 0-8 for empty/chains)
- Chains: 7 x 5 features (size, price, available, active, safe)
- Players: 6 x 8 features (money + 7 stock counts)
- Hand: 6 tile indices
- Phase: 7 one-hot
- Meta: current player, can_end_game, pending action type

### Phase 2: Gymnasium Environment (`game_env.py`)
```python
class AcquireEnv(gym.Env):
    def reset() -> observation
    def step(action) -> (obs, reward, done, truncated, info)
    def get_legal_actions_mask() -> np.ndarray
```

### Phase 3: Policy Network (`policy.py`)
Actor-critic architecture:
- Shared encoder (MLP)
- Policy heads (separate per action type)
- Value head (scalar)
- Action masking for illegal moves

### Phase 4: PPO Trainer (`trainer.py`)
- Experience buffer
- GAE advantage estimation
- PPO clip loss
- Curriculum progression
- Self-play support

### Phase 5: NeuralBot Integration (`neural_bot.py`)
- Extends Bot interface
- Loads trained weights
- Inference for all 5 decision methods

## Reward Design

| Signal | Value | Description |
|--------|-------|-------------|
| Win | +1.0 | First place |
| Loss | -0.5 | Not first place |
| Dense (optional) | 0.0001 * Δnet_worth | Net worth change per turn |

## Curriculum Learning Stages

| Stage | Opponents | Win Threshold | Games |
|-------|-----------|---------------|-------|
| 1 | easy x3 | 60% | 10k |
| 2 | easy x2, medium | 55% | 20k |
| 3 | easy, medium x2 | 50% | 30k |
| 4 | medium x3 | 50% | 50k |
| 5 | medium x2, hard | 45% | 70k |
| 6 | medium, hard x2 | 40% | 100k |
| 7 | hard x3 | 35% | 150k |

## Verification Plan

1. **Unit tests**: Environment step/reset, state encoding roundtrip
2. **Smoke test**: 100 games with random actions, no crashes
3. **Training sanity**: Loss decreases, rewards improve over 1000 steps
4. **Baseline comparison**:
   - Win rate vs easy: target >80%
   - Win rate vs medium: target >60%
   - Win rate vs hard: target >50%
5. **Integration**: NeuralBot playable via WebSocket UI

## Dependencies

```
# requirements-training.txt
torch>=2.0.0
gymnasium>=0.29.0
tensorboard>=2.14.0
numpy>=1.24.0
tqdm>=4.65.0
```
