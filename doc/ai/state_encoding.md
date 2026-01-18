# State Encoding Design

## Overview

Convert game state into fixed-size tensors suitable for neural network input.

## Observation Space

Total dimension: ~750 features

### 1. Board State (108 features)
12x9 grid flattened to 108 values.

| Value | Meaning |
|-------|---------|
| 0 | Empty |
| 1 | Played (no chain) |
| 2-8 | Chain index (Luxor=2, Tower=3, ..., Continental=8) |

### 2. Chain Information (35 features)
7 chains × 5 features each:

| Feature | Range | Description |
|---------|-------|-------------|
| size | 0-41 | Number of tiles (normalized 0-1) |
| price | 0-1200 | Stock price (normalized 0-1) |
| available | 0-25 | Stocks in bank (normalized 0-1) |
| active | 0/1 | Is chain on board |
| safe | 0/1 | Size >= 11 |

### 3. Player Information (48 features)
6 players × 8 features each (rotated so current player is always index 0):

| Feature | Range | Description |
|---------|-------|-------------|
| money | 0-∞ | Cash normalized by starting money |
| stock_0-6 | 0-25 | Shares per chain (normalized) |

### 4. Hand (6 features)
Tile indices (0-107) for tiles in hand, -1 for empty slots.

Alternative: 6 × 108 one-hot = 648 features (sparse)

### 5. Phase (7 features)
One-hot encoding:
- LOBBY, PLAYING, TILE_PLAYED, FOUNDING_CHAIN, MERGING, BUYING_STOCKS, GAME_OVER

### 6. Meta Information (10 features)
- Current player index (one-hot, 6)
- Can end game (1)
- Pending action type (one-hot, 5)

## Canonical Player Ordering

**Critical for learning**: Always rotate player order so the acting player is at index 0.

```python
def encode_players(game, player_id):
    current_idx = get_player_index(game, player_id)
    rotated = game.players[current_idx:] + game.players[:current_idx]
    return [encode_player(p) for p in rotated]
```

This ensures the agent always sees itself as "player 0", making the observation space consistent regardless of turn order.

## Variable Player Count Support

Acquire supports 2-6 players, but neural networks require fixed-size inputs. We solve this with **fixed-size encoding with masking**.

### Strategy: Always Encode 6 Player Slots

```
Players observation (6 × 9 = 54 features):
┌────────────────────────────────────────────────────────┐
│ Player 0 (self): active=1, money, 7 stocks            │
│ Player 1:        active=1, money, 7 stocks            │
│ Player 2:        active=1, money, 7 stocks            │
│ Player 3:        active=0, money=0, stocks=0 (unused) │
│ Player 4:        active=0, money=0, stocks=0 (unused) │
│ Player 5:        active=0, money=0, stocks=0 (unused) │
└────────────────────────────────────────────────────────┘
```

### Player Features (9 per player)

| Feature | Range | Description |
|---------|-------|-------------|
| active | 0/1 | Is this player slot in use |
| money | 0-∞ | Cash normalized by 10000 |
| stock_0-6 | 0-25 | Shares per chain (normalized) |

### Why This Works

1. **Simple implementation**: No architecture changes needed
2. **Network learns masking**: All-zero slots with `active=0` are ignored
3. **Consistent tensor shape**: Same observation size for 2, 3, 4, 5, or 6 players
4. **Canonical ordering preserved**: Self always at index 0

### Encoding Implementation

```python
def encode_players(game: Game, player_id: str) -> np.ndarray:
    """Encode all players with rotation and padding."""
    # Rotate so current player is index 0
    current_idx = get_player_index(game, player_id)
    rotated = game.players[current_idx:] + game.players[:current_idx]

    # Pad to max 6 players
    features = []
    for i in range(6):
        if i < len(rotated):
            player = rotated[i]
            features.append([
                1.0,  # active flag
                player.money / 10000,  # normalized money
                *[player.stocks.get(chain, 0) / 25 for chain in CHAIN_NAMES]
            ])
        else:
            # Inactive player slot
            features.append([0.0] * 9)  # active=0, money=0, stocks=0

    return np.array(features).flatten()
```

### Meta Information Update

Include normalized player count in meta features:

```python
def encode_meta(game: Game, player_id: str) -> np.ndarray:
    return np.array([
        len(game.players) / 6,  # Normalized player count (0.33-1.0)
        float(game.can_player_act(player_id)),
        float(Rules.check_end_game(game.board, game.hotel)),
        # ... phase encoding, pending action, etc.
    ])
```

## Normalization Strategy

| Feature | Method |
|---------|--------|
| Money | Divide by 10000 (typical max) |
| Chain size | Divide by 41 (max) |
| Stock price | Divide by 1200 (max) |
| Stock count | Divide by 25 (max) |
| Tile index | Divide by 107 (max) |

## Implementation

```python
class StateEncoder:
    def encode(game: Game, player_id: str) -> np.ndarray:
        """Encode full game state for a player."""

    def encode_board(game: Game) -> np.ndarray:
        """Encode 12x9 board as flat array."""

    def encode_chains(game: Game) -> np.ndarray:
        """Encode chain information."""

    def encode_players(game: Game, player_id: str) -> np.ndarray:
        """Encode all players with rotation."""

    def encode_hand(game: Game, player_id: str) -> np.ndarray:
        """Encode player's tile hand."""

    def encode_phase(game: Game) -> np.ndarray:
        """One-hot encode game phase."""

    def encode_meta(game: Game, player_id: str) -> np.ndarray:
        """Encode metadata (can_end_game, pending action, etc.)."""
```

## Action Encoding

### Flat Action Space (Simplified)
Single discrete action from enumerated legal actions.

```python
def get_action_index(action: Action, legal_actions: List[Action]) -> int:
    return legal_actions.index(action)

def get_action_from_index(index: int, legal_actions: List[Action]) -> Action:
    return legal_actions[index]
```

### Hierarchical Action Space (Advanced)
Multi-head output for different action types:

1. **Type head**: 5 outputs (tile, chain, survivor, disposition, stocks)
2. **Tile head**: 6 outputs (hand positions)
3. **Chain head**: 7 outputs (chain names)
4. **Disposition head**: 3 continuous outputs (sell%, trade%, keep%)
5. **Stock head**: 7×4=28 outputs (chain × quantity)

## Action Masking

Essential for preventing illegal moves:

```python
def get_action_mask(game: Game, player_id: str) -> np.ndarray:
    legal_actions = Rules.get_all_legal_actions(game, player_id)
    mask = np.zeros(max_actions)
    for i, action in enumerate(all_possible_actions):
        if action in legal_actions:
            mask[i] = 1
    return mask
```

During policy forward pass:
```python
logits = policy_network(observation)
logits[mask == 0] = -1e9  # Mask illegal actions
probs = softmax(logits)
```
