# Acquire Board Game - Product Backlog

## Overview

This document contains the prioritized product backlog for the Acquire board game web application. Items are organized by priority and grouped into suggested sprints.

**Legend:**
- **Effort**: S (Small, 1-2 days), M (Medium, 3-5 days), L (Large, 1-2 weeks), XL (Extra Large, 2+ weeks)
- **Priority**: P0 (Critical/MVP), P1 (High), P2 (Medium), P3 (Low/Nice-to-have)

---

## MVP Definition

The **Minimum Viable Product** enables users to:
1. Create/join a game room via browser
2. Play a complete game of Acquire with 2-6 players (humans or bots)
3. See the game board on a host display (TV/laptop)
4. Interact via phone/tablet for private tile/stock decisions

**MVP Excludes:** Player-to-player trading UI, AI training, cloud deployment, persistent games.

---

## Sprint 1: MVP - Complete Game Loop (P0)

### BACKLOG-001: Wire Up Tile Placement UI
**Priority:** P0 | **Effort:** M

**As a** player on my phone
**I want to** tap a tile in my hand and place it on the board
**So that** I can take my turn in the game

**Acceptance Criteria:**
- [ ] Tapping a tile selects it with visual feedback
- [ ] Confirmation dialog appears before placement
- [ ] WebSocket message sent to backend with tile coordinates
- [ ] Board updates on host display after placement
- [ ] Error message shown if tile is unplayable
- [ ] Tile removed from hand after successful placement

**Dependencies:** None (backend complete)

---

### BACKLOG-002: Wire Up Chain Founding UI
**Priority:** P0 | **Effort:** S

**As a** player who just connected tiles
**I want to** choose which hotel chain to found
**So that** the chain is established and I receive my founder's stock

**Acceptance Criteria:**
- [ ] Modal appears with available chain options (colored buttons)
- [ ] Only inactive chains shown as options
- [ ] Selecting chain sends WebSocket message to backend
- [ ] Board updates to show new chain colors
- [ ] Host display shows new chain in legend
- [ ] Player's stock count updates to show founder share

**Dependencies:** BACKLOG-001

---

### BACKLOG-003: Wire Up Stock Buying UI
**Priority:** P0 | **Effort:** M

**As a** player after placing a tile
**I want to** buy up to 3 stocks from active chains
**So that** I can invest in growing hotel chains

**Acceptance Criteria:**
- [ ] Stock buying panel appears after tile placement
- [ ] Shows only active chains with prices and availability
- [ ] +/- buttons to adjust quantity (max 3 total)
- [ ] Running total displayed, disabled if exceeds cash
- [ ] "Skip" button to buy nothing
- [ ] "Confirm" sends purchase to backend
- [ ] Player's cash and stock counts update

**Dependencies:** BACKLOG-001

---

### BACKLOG-004: Wire Up Merger Decision UI
**Priority:** P0 | **Effort:** M

**As a** stockholder in a merged chain
**I want to** decide to sell, trade, or keep my stocks
**So that** I can manage my portfolio during mergers

**Acceptance Criteria:**
- [ ] Merger modal appears when player has defunct stocks
- [ ] Shows defunct chain, surviving chain, and stock count
- [ ] Sell/Trade/Keep sliders or +/- controls
- [ ] Trade only allows even numbers (2:1 ratio)
- [ ] Keep = total - sell - trade (auto-calculated)
- [ ] Confirm sends disposition to backend
- [ ] Player's cash and stocks update accordingly

**Dependencies:** BACKLOG-001

---

### BACKLOG-005: Wire Up Merger Survivor Choice UI
**Priority:** P0 | **Effort:** S

**As a** player who triggered a tie merger
**I want to** choose which chain survives
**So that** the merger can proceed

**Acceptance Criteria:**
- [ ] Modal appears listing tied chains with sizes
- [ ] Clicking chain sends choice to backend
- [ ] Merger proceeds with selected survivor

**Dependencies:** BACKLOG-004

---

### BACKLOG-006: End Turn and Turn Advancement
**Priority:** P0 | **Effort:** S

**As a** player
**I want** turns to advance automatically after I complete my actions
**So that** the game flows smoothly

**Acceptance Criteria:**
- [ ] After stock purchase/skip, turn ends automatically
- [ ] New tile drawn for player
- [ ] Unplayable tiles replaced
- [ ] Next player notified it's their turn
- [ ] Turn indicator updates on all clients

**Dependencies:** BACKLOG-003

---

### BACKLOG-007: Game End and Scoring
**Priority:** P0 | **Effort:** S

**As a** player
**I want** to end the game when conditions are met and see final scores
**So that** we know who won

**Acceptance Criteria:**
- [ ] "End Game" option appears when conditions met
- [ ] All chains pay out bonuses
- [ ] All stocks sold at final prices
- [ ] Final standings displayed on all clients
- [ ] Winner highlighted

**Dependencies:** BACKLOG-006

---

### BACKLOG-008: Bot Turn Execution
**Priority:** P0 | **Effort:** S

**As a** host
**I want** bot players to take their turns automatically
**So that** games can proceed without waiting

**Acceptance Criteria:**
- [ ] Bot turns trigger automatically when it's their turn
- [ ] Bot makes tile, chain, stock decisions using existing Bot class
- [ ] Bot decisions reflected on all clients
- [ ] Brief delay between bot actions for visibility

**Dependencies:** BACKLOG-006

---

## Sprint 2: Polish and UX (P1)

### BACKLOG-009: Lobby Player Management
**Priority:** P1 | **Effort:** S

**As a** host
**I want to** see who has joined and add bots
**So that** I can start the game when ready

**Acceptance Criteria:**
- [ ] Lobby shows list of joined players
- [ ] "Add Bot" button adds AI player
- [ ] "Start Game" enabled when 2+ players
- [ ] Player join/leave updates in real-time

**Dependencies:** None

---

### BACKLOG-010: Connection Reconnection Handling
**Priority:** P1 | **Effort:** M

**As a** player whose connection dropped
**I want to** reconnect and resume my game
**So that** I don't lose my progress

**Acceptance Criteria:**
- [ ] Auto-reconnect attempts on disconnect
- [ ] Game state synced on reconnect
- [ ] Player can resume if it's their turn
- [ ] "Reconnecting..." indicator shown

**Dependencies:** None

---

### BACKLOG-011: Game Log Display
**Priority:** P1 | **Effort:** S

**As a** player
**I want to** see a log of game actions
**So that** I can follow what happened

**Acceptance Criteria:**
- [ ] Host display shows scrollable game log
- [ ] Log entries for: tile placements, chain foundings, mergers, stock purchases
- [ ] Most recent entries at top
- [ ] Timestamps on entries

**Dependencies:** BACKLOG-001

---

### BACKLOG-012: Sound and Visual Feedback
**Priority:** P2 | **Effort:** M

**As a** player
**I want** sound effects and animations
**So that** the game feels polished

**Acceptance Criteria:**
- [ ] Sound on tile placement
- [ ] Sound on chain founding
- [ ] Sound on merger
- [ ] Sound on turn start
- [ ] Mute button
- [ ] Tile placement animation

**Dependencies:** BACKLOG-007

---

## Sprint 3: Advanced Features (P1-P2)

### BACKLOG-013: Trade Negotiation UI
**Priority:** P1 | **Effort:** L

**As a** player
**I want to** propose trades with other players
**So that** I can negotiate strategic exchanges

**Acceptance Criteria:**
- [ ] "Propose Trade" button in player view
- [ ] Select target player
- [ ] Offer: stocks and/or money
- [ ] Request: stocks and/or money
- [ ] Submit sends to target player
- [ ] Target can accept/reject
- [ ] Trade executes on accept

**Dependencies:** Backend complete

---

### BACKLOG-014: Trade Notification System
**Priority:** P1 | **Effort:** S

**As a** player receiving a trade offer
**I want to** be notified and review the offer
**So that** I can decide whether to accept

**Acceptance Criteria:**
- [ ] Notification badge when trade pending
- [ ] Trade details modal
- [ ] Accept/Reject buttons
- [ ] Trade result notification to both parties

**Dependencies:** BACKLOG-013

---

### BACKLOG-015: House Rules Configuration
**Priority:** P2 | **Effort:** M

**As a** host
**I want to** configure game variants
**So that** we can play with preferred rules

**Acceptance Criteria:**
- [ ] Settings panel in lobby
- [ ] Options: starting money, max stocks per turn, safe size
- [ ] Settings saved per room
- [ ] Settings displayed to all players

**Dependencies:** None

---

## Sprint 4: AI Training (P2)

### BACKLOG-016: Gymnasium Environment Wrapper
**Priority:** P2 | **Effort:** L

**As a** ML engineer
**I want** a Gymnasium-compatible environment
**So that** I can train RL agents

**Acceptance Criteria:**
- [ ] AcquireEnv class implementing gym.Env
- [ ] Observation space matches StateEncoder output
- [ ] Action space covers all game actions
- [ ] reset() initializes new game
- [ ] step() applies action, returns obs/reward/done
- [ ] Legal action masking via info dict

**Dependencies:** None (RL foundations complete)

---

### BACKLOG-017: PPO Policy Network
**Priority:** P2 | **Effort:** M

**As a** ML engineer
**I want** a policy network architecture
**So that** I can train agents with PPO

**Acceptance Criteria:**
- [ ] Actor-critic network with configurable layers
- [ ] Handles masked actions
- [ ] Compatible with stable-baselines3 or custom PPO
- [ ] Checkpointing support

**Dependencies:** BACKLOG-016

---

### BACKLOG-018: Training Pipeline
**Priority:** P2 | **Effort:** L

**As a** ML engineer
**I want** an end-to-end training script
**So that** I can train and evaluate agents

**Acceptance Criteria:**
- [ ] Parallel environment training
- [ ] Curriculum learning implementation
- [ ] Self-play option
- [ ] TensorBoard logging
- [ ] Checkpoint saving/loading
- [ ] Evaluation against rule-based bots

**Dependencies:** BACKLOG-016, BACKLOG-017

---

### BACKLOG-019: Neural Bot Integration
**Priority:** P2 | **Effort:** M

**As a** player
**I want to** play against trained AI
**So that** I have a challenging opponent

**Acceptance Criteria:**
- [ ] NeuralBot class wrapping trained model
- [ ] Model loading from checkpoint
- [ ] Integration with game as bot type
- [ ] Difficulty levels based on different checkpoints

**Dependencies:** BACKLOG-018

---

## Sprint 5: Deployment (P1)

### BACKLOG-020: Cloud Deployment
**Priority:** P1 | **Effort:** M

**As a** user
**I want to** access the game via a public URL
**So that** I can play without local setup

**Acceptance Criteria:**
- [ ] Deploy to Railway or Fly.io
- [ ] HTTPS enabled
- [ ] WebSocket (WSS) working
- [ ] Environment variables configured
- [ ] Domain name configured

**Dependencies:** BACKLOG-007 (MVP complete)

---

### BACKLOG-021: Production Monitoring
**Priority:** P1 | **Effort:** S

**As a** developer
**I want** basic monitoring
**So that** I can detect issues

**Acceptance Criteria:**
- [ ] Health check endpoint
- [ ] Basic error logging
- [ ] Uptime monitoring (external service)
- [ ] Memory/CPU metrics

**Dependencies:** BACKLOG-020

---

## Sprint 6: Enhancements (P3)

### BACKLOG-022: Persistent Game State
**Priority:** P3 | **Effort:** L

**As a** player
**I want** games to persist across server restarts
**So that** long games aren't lost

**Acceptance Criteria:**
- [ ] Redis or SQLite backend
- [ ] Game state serialization
- [ ] Automatic save on state change
- [ ] Game resume on reconnect

**Dependencies:** BACKLOG-020

---

### BACKLOG-023: Spectator Mode
**Priority:** P3 | **Effort:** M

**As a** spectator
**I want to** watch an ongoing game
**So that** I can observe without playing

**Acceptance Criteria:**
- [ ] "Spectate" option in lobby
- [ ] View-only mode (no actions)
- [ ] See all public info (board, scores)
- [ ] Cannot see player hands

**Dependencies:** BACKLOG-007

---

### BACKLOG-024: Game Replays
**Priority:** P3 | **Effort:** L

**As a** player
**I want to** replay past games
**So that** I can review strategy

**Acceptance Criteria:**
- [ ] Game actions logged
- [ ] Replay viewer UI
- [ ] Step forward/backward
- [ ] Playback speed control

**Dependencies:** BACKLOG-022

---

### BACKLOG-025: Tournament Mode
**Priority:** P3 | **Effort:** XL

**As a** tournament organizer
**I want to** run multi-game tournaments
**So that** I can crown a champion

**Acceptance Criteria:**
- [ ] Create tournament with bracket
- [ ] Automatic game creation
- [ ] Score aggregation
- [ ] Leaderboard
- [ ] Winner progression

**Dependencies:** BACKLOG-022, BACKLOG-019

---

## Dependency Graph

```
BACKLOG-001 (Tile Placement)
    └── BACKLOG-002 (Chain Founding)
    └── BACKLOG-003 (Stock Buying)
    └── BACKLOG-004 (Merger Decision)
        └── BACKLOG-005 (Survivor Choice)
    └── BACKLOG-006 (Turn Advancement)
        └── BACKLOG-007 (Game End)
        └── BACKLOG-008 (Bot Turns)
            └── BACKLOG-020 (Cloud Deploy)
                └── BACKLOG-021 (Monitoring)
                └── BACKLOG-022 (Persistence)
                    └── BACKLOG-024 (Replays)
                    └── BACKLOG-025 (Tournaments)

BACKLOG-013 (Trade UI) → BACKLOG-014 (Trade Notifications)

BACKLOG-016 (Gym Env) → BACKLOG-017 (Policy) → BACKLOG-018 (Pipeline) → BACKLOG-019 (Neural Bot)
```

---

## Sprint Summary

| Sprint | Focus | Items | Est. Duration |
|--------|-------|-------|---------------|
| 1 | MVP - Complete Game Loop | BACKLOG-001 to 008 | 2 weeks |
| 2 | Polish and UX | BACKLOG-009 to 012 | 1 week |
| 3 | Advanced Features | BACKLOG-013 to 015 | 1.5 weeks |
| 4 | AI Training | BACKLOG-016 to 019 | 3 weeks |
| 5 | Deployment | BACKLOG-020 to 021 | 1 week |
| 6 | Enhancements | BACKLOG-022 to 025 | 4+ weeks |

**Total MVP (Sprint 1):** ~2 weeks
**Total to Production (Sprints 1-5):** ~8.5 weeks

---

## Notes

1. **Backend is largely complete** - Most game logic, rules, and API endpoints exist
2. **Frontend needs wiring** - UI components exist but need WebSocket integration
3. **AI training is optional for MVP** - Rule-based bots provide good opponents
4. **Trading is a post-MVP feature** - Backend exists, frontend can come later
