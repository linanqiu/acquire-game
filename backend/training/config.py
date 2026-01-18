"""Hyperparameters and configuration for training."""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
import json


@dataclass
class CurriculumStage:
    """Configuration for a curriculum learning stage."""

    opponents: List[str]
    win_threshold: float
    min_games: int = 1000


@dataclass
class TrainingConfig:
    """Configuration for PPO training."""

    # PPO hyperparameters
    learning_rate: float = 3e-4
    gamma: float = 0.99  # Discount factor
    gae_lambda: float = 0.95  # GAE lambda
    clip_epsilon: float = 0.2  # PPO clip ratio
    value_loss_coef: float = 0.5
    entropy_coef: float = 0.01
    max_grad_norm: float = 0.5

    # Network architecture
    hidden_sizes: List[int] = field(default_factory=lambda: [256, 256, 256])
    activation: str = "relu"
    use_layer_norm: bool = True

    # Training settings
    batch_size: int = 64
    num_epochs: int = 10  # PPO epochs per update
    rollout_steps: int = 2048  # Steps per rollout
    num_envs: int = 8  # Parallel environments
    total_timesteps: int = 1_000_000

    # Environment settings
    num_players: int = 4
    opponent_types: List[str] = field(default_factory=lambda: ["easy", "easy", "easy"])
    max_steps_per_episode: int = 500
    seed: Optional[int] = None

    # Curriculum learning stages with opponent configs and win thresholds
    curriculum_enabled: bool = True
    curriculum_stages: List[Dict[str, Any]] = field(
        default_factory=lambda: [
            {
                "opponents": ["easy", "easy", "easy"],
                "win_threshold": 0.6,
                "min_games": 1000,
            },
            {
                "opponents": ["easy", "easy", "medium"],
                "win_threshold": 0.55,
                "min_games": 2000,
            },
            {
                "opponents": ["easy", "medium", "medium"],
                "win_threshold": 0.5,
                "min_games": 3000,
            },
            {
                "opponents": ["medium", "medium", "medium"],
                "win_threshold": 0.5,
                "min_games": 5000,
            },
            {
                "opponents": ["medium", "medium", "hard"],
                "win_threshold": 0.45,
                "min_games": 7000,
            },
            {
                "opponents": ["medium", "hard", "hard"],
                "win_threshold": 0.4,
                "min_games": 10000,
            },
            {
                "opponents": ["hard", "hard", "hard"],
                "win_threshold": 0.35,
                "min_games": 15000,
            },
        ]
    )

    # Self-play settings
    self_play_enabled: bool = False
    self_play_history_size: int = 10  # Number of historical models to keep
    self_play_update_interval: int = 1000  # Steps between model pool updates

    # Reward settings
    win_reward: float = 1.0
    loss_reward: float = -0.5
    dense_reward_scale: float = 0.0001  # Scale for net worth changes

    # Checkpointing and logging
    checkpoint_dir: str = "checkpoints"
    checkpoint_interval: int = 10000
    log_interval: int = 1000
    eval_interval: int = 5000
    eval_episodes: int = 100

    # Observation space dimensions
    board_size: int = 108  # 12 x 9
    num_chains: int = 7
    max_players: int = 6
    max_hand_size: int = 6
    num_phases: int = 7

    # Action space dimensions
    max_tile_actions: int = 6  # Play any of 6 tiles
    max_chain_actions: int = 7  # Found/choose any of 7 chains
    max_stock_actions: int = 28  # 7 chains x 4 quantities (0-3)
    max_disposition_actions: int = 100  # Approximate max combinations

    def save(self, path: str):
        """Save configuration to JSON file."""
        with open(path, "w") as f:
            json.dump(self.__dict__, f, indent=2)

    @classmethod
    def load(cls, path: str) -> "TrainingConfig":
        """Load configuration from JSON file."""
        with open(path, "r") as f:
            data = json.load(f)
        return cls(**data)

    def get_observation_dim(self) -> int:
        """Calculate total observation dimension.

        Observation space breakdown:
        - Board: 108 (12x9 grid, values 0-8 for empty/chains)
        - Chain info: 7 chains x 5 features = 35
        - Player info: 6 players x 8 features = 48
        - Hand: 6 tile indices
        - Phase: 7 (one-hot)
        - Meta: ~10 features

        Total: ~750 dimensions
        """
        board_dim = self.board_size  # 108
        chain_dim = self.num_chains * 5  # 35 (size, price, available, active, safe)
        player_dim = self.max_players * 8  # 48 (money + 7 stocks)
        hand_dim = self.max_hand_size  # 6 tile indices (0-107)
        phase_dim = self.num_phases  # 7
        meta_dim = 10  # Current player, can_end_game, pending action type, etc.

        return board_dim + chain_dim + player_dim + hand_dim + phase_dim + meta_dim

    def get_action_dim(self) -> int:
        """Calculate total flattened action dimension."""
        return max(
            self.max_tile_actions,
            self.max_chain_actions,
            self.max_stock_actions,
            self.max_disposition_actions,
        )


# Preset configurations
FAST_DEBUG_CONFIG = TrainingConfig(
    num_envs=2,
    rollout_steps=128,
    total_timesteps=10000,
    eval_episodes=10,
    log_interval=100,
    eval_interval=1000,
    checkpoint_interval=2000,
)

STANDARD_CONFIG = TrainingConfig()

LARGE_SCALE_CONFIG = TrainingConfig(
    num_envs=32,
    rollout_steps=4096,
    total_timesteps=10_000_000,
    hidden_sizes=[512, 512, 512, 512],
    batch_size=256,
)
