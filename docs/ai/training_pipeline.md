# Training Pipeline Design

## PPO Algorithm

### Overview
Proximal Policy Optimization (PPO) is a policy gradient method that uses a clipped objective to prevent large policy updates.

### Key Components

#### 1. Actor-Critic Network
```
                    ┌─────────────────┐
                    │   Observation   │
                    │    (750 dim)    │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Shared Encoder │
                    │   MLP (256x3)   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼────────┐    │    ┌────────▼────────┐
     │   Policy Head   │    │    │   Value Head    │
     │  (action logits)│    │    │   (scalar V)    │
     └─────────────────┘    │    └─────────────────┘
                            │
               ┌────────────┴────────────┐
               │      Action Masking     │
               │ (mask illegal actions)  │
               └─────────────────────────┘
```

#### 2. PPO Objective

$$L_{\text{CLIP}} = \mathbb{E}\left[\min\left(r(\theta) \cdot A, \text{clip}(r(\theta), 1-\epsilon, 1+\epsilon) \cdot A\right)\right]$$

where:
- $r(\theta) = \frac{\pi_\theta(a|s)}{\pi_{\theta_{\text{old}}}(a|s)}$ — probability ratio
- $A$ — advantage estimate (from GAE)
- $\epsilon = 0.2$ — clip parameter

#### 3. Value Loss

$$L_V = 0.5 \cdot (V(s) - V_{\text{target}})^2$$

#### 4. Entropy Bonus

$$L_H = -0.01 \cdot H(\pi(\cdot|s))$$

### Training Loop

```python
for iteration in range(total_iterations):
    # 1. Collect rollouts
    for env in parallel_envs:
        for step in range(rollout_steps):
            action = policy.sample(obs)
            obs, reward, done = env.step(action)
            buffer.store(obs, action, reward, done, value, log_prob)

    # 2. Compute advantages (GAE)
    advantages = compute_gae(rewards, values, dones)
    returns = advantages + values

    # 3. PPO update
    for epoch in range(num_epochs):
        for batch in buffer.sample_batches(batch_size):
            # Compute losses
            policy_loss = clip_loss(batch)
            value_loss = mse_loss(batch)
            entropy_loss = entropy_bonus(batch)

            loss = policy_loss + 0.5*value_loss - 0.01*entropy_loss

            # Update
            optimizer.zero_grad()
            loss.backward()
            clip_grad_norm(parameters, max_norm=0.5)
            optimizer.step()

    # 4. Curriculum check
    if win_rate > threshold:
        advance_curriculum()
```

## Curriculum Learning

### Stages
```
Stage 1: [easy, easy, easy]     → 60% win rate
Stage 2: [easy, easy, medium]   → 55% win rate
Stage 3: [easy, medium, medium] → 50% win rate
Stage 4: [medium, medium, medium] → 50% win rate
Stage 5: [medium, medium, hard] → 45% win rate
Stage 6: [medium, hard, hard]   → 40% win rate
Stage 7: [hard, hard, hard]     → 35% win rate
```

### Implementation
```python
class CurriculumManager:
    def __init__(self, stages):
        self.stages = stages
        self.current_stage = 0
        self.win_history = deque(maxlen=100)

    def get_opponent_config(self):
        return self.stages[self.current_stage]["opponents"]

    def update(self, won: bool):
        self.win_history.append(won)
        win_rate = sum(self.win_history) / len(self.win_history)

        if win_rate >= self.stages[self.current_stage]["win_threshold"]:
            if self.current_stage < len(self.stages) - 1:
                self.current_stage += 1
                self.win_history.clear()
                return True  # Advanced
        return False
```

## Self-Play (Advanced)

After curriculum completion, enable self-play:

```python
class SelfPlayManager:
    def __init__(self, policy):
        self.policy = policy
        self.historical_policies = []
        self.update_interval = 1000

    def get_opponent_policy(self):
        if random.random() < 0.5:
            # Play against current policy
            return self.policy
        else:
            # Play against historical policy
            return random.choice(self.historical_policies)

    def maybe_save_policy(self, timestep):
        if timestep % self.update_interval == 0:
            self.historical_policies.append(copy.deepcopy(self.policy))
```

## Reward Shaping

### Sparse Rewards
```python
def compute_sparse_reward(game, player_id):
    if game.phase != GamePhase.GAME_OVER:
        return 0

    standings = game.end_game()["standings"]
    player_rank = next(s["rank"] for s in standings if s["player_id"] == player_id)

    if player_rank == 1:
        return 1.0  # Win
    else:
        return -0.5  # Loss
```

### Dense Rewards (Optional)
```python
def compute_dense_reward(prev_state, curr_state, player_id):
    prev_worth = get_net_worth(prev_state, player_id)
    curr_worth = get_net_worth(curr_state, player_id)
    delta = curr_worth - prev_worth
    return delta * 0.0001  # Scale down
```

## Parallel Environments

Use vectorized environments for faster training:

```python
class VectorizedAcquireEnv:
    def __init__(self, num_envs, config):
        self.envs = [AcquireEnv(config) for _ in range(num_envs)]

    def reset(self):
        return np.stack([env.reset() for env in self.envs])

    def step(self, actions):
        results = [env.step(a) for env, a in zip(self.envs, actions)]
        obs, rewards, dones, infos = zip(*results)
        return np.stack(obs), np.array(rewards), np.array(dones), infos
```

## Checkpointing

```python
def save_checkpoint(path, policy, optimizer, timestep, config):
    torch.save({
        "policy_state_dict": policy.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "timestep": timestep,
        "config": config.__dict__
    }, path)

def load_checkpoint(path, policy, optimizer):
    checkpoint = torch.load(path)
    policy.load_state_dict(checkpoint["policy_state_dict"])
    optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
    return checkpoint["timestep"]
```

## Logging (TensorBoard)

```python
writer = SummaryWriter("runs/acquire_training")

# Log metrics
writer.add_scalar("train/policy_loss", policy_loss, timestep)
writer.add_scalar("train/value_loss", value_loss, timestep)
writer.add_scalar("train/entropy", entropy, timestep)
writer.add_scalar("eval/win_rate", win_rate, timestep)
writer.add_scalar("curriculum/stage", curriculum.current_stage, timestep)
```
