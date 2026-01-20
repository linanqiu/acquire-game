# Trading Flow E2E Scenarios

Player-to-player trading is an optional feature that allows players to exchange stocks and money during the game. These scenarios test the complete trading workflow.

## Overview

Trading in Acquire allows players to negotiate stock/money exchanges outside of their turn. The backend supports:
- `propose_trade`: Offer a trade to another player
- `accept_trade`: Accept a pending trade
- `reject_trade`: Decline a pending trade
- `cancel_trade`: Withdraw your own trade offer

## Scenarios

### Scenario 6.1: Propose and Accept Trade

**Preconditions:**
- Game in progress with at least 2 human players
- Player A has stocks to offer
- Player B is connected and can receive trade

**Steps:**
1. Player A opens trade dialog
2. Player A selects Player B as recipient
3. Player A offers: 2 Luxor stocks + $500
4. Player A requests: 1 Tower stock
5. Player A submits trade proposal
6. Player B receives trade notification
7. Player B reviews trade details
8. Player B clicks "Accept"
9. Both players see trade confirmation

**Expected Outcomes:**
- Player A loses 2 Luxor stocks and $500
- Player A gains 1 Tower stock
- Player B gains 2 Luxor stocks and $500
- Player B loses 1 Tower stock
- Trade notification dismissed for both

**WebSocket Messages:**
```typescript
// Player A sends
{ action: 'propose_trade', to_player_id: 'player-b-uuid',
  offering_stocks: { Luxor: 2 }, offering_money: 500,
  requesting_stocks: { Tower: 1 }, requesting_money: 0 }

// Both receive
{ type: 'trade_proposed', trade: { id: '...', from_player_id: '...', ... } }

// Player B sends
{ action: 'accept_trade', trade_id: 'trade-uuid' }

// Both receive
{ type: 'trade_accepted', trade_id: '...', from_player: '...', to_player: '...' }
```

**Playwright Hints:**
```typescript
// Wait for trade notification
await page.waitForSelector('[data-testid="trade-notification"]')
// Accept trade
await page.click('[data-testid="accept-trade"]')
// Verify stocks updated
await expect(page.locator('[data-testid="luxor-count"]')).toHaveText('2')
```

---

### Scenario 6.2: Reject Trade Offer

**Preconditions:**
- Game in progress
- Player A has proposed a trade to Player B
- Trade is pending

**Steps:**
1. Player B receives trade notification
2. Player B reviews trade details
3. Player B clicks "Reject"
4. Both players see trade rejected message
5. Trade is removed from pending list

**Expected Outcomes:**
- No stocks or money exchanged
- Trade notification dismissed
- Player A can propose a new trade

**WebSocket Messages:**
```typescript
// Player B sends
{ action: 'reject_trade', trade_id: 'trade-uuid' }

// Both receive
{ type: 'trade_rejected', trade_id: '...', rejected_by: 'player-b-uuid' }
```

---

### Scenario 6.3: Cancel Trade Offer

**Preconditions:**
- Player A has an outstanding trade proposal
- Trade has not been accepted or rejected

**Steps:**
1. Player A opens pending trades view
2. Player A sees their outgoing trade
3. Player A clicks "Cancel" on the trade
4. Both players see trade canceled message

**Expected Outcomes:**
- Trade removed from pending list
- No stocks or money exchanged
- Player A can propose a new trade

**WebSocket Messages:**
```typescript
// Player A sends
{ action: 'cancel_trade', trade_id: 'trade-uuid' }

// Both receive
{ type: 'trade_canceled', trade_id: '...', canceled_by: 'player-a-uuid' }
```

---

### Scenario 6.4: Trade Validation - Insufficient Stocks

**Preconditions:**
- Game in progress
- Player A has 1 Luxor stock

**Steps:**
1. Player A tries to propose a trade offering 2 Luxor stocks
2. Frontend validation prevents submission
3. Error message displayed: "You don't have enough Luxor stocks"

**Expected Outcomes:**
- Trade not submitted to backend
- Player sees inline validation error
- Form remains open for correction

---

### Scenario 6.5: Trade Validation - Insufficient Funds

**Preconditions:**
- Game in progress
- Player A has $200 cash

**Steps:**
1. Player A tries to propose a trade offering $500
2. Frontend validation prevents submission
3. Error message displayed: "Insufficient funds"

**Expected Outcomes:**
- Trade not submitted to backend
- Player sees inline validation error

---

### Scenario 6.6: Multiple Pending Trades

**Preconditions:**
- 3+ players in game
- Player A proposes trade to Player B
- Player A proposes another trade to Player C

**Steps:**
1. Player A proposes trade to Player B
2. Player A proposes different trade to Player C
3. Player B accepts their trade
4. Player C rejects their trade
5. Both trades resolve independently

**Expected Outcomes:**
- Player A and B complete their trade
- Player A and C trade is canceled
- All notifications cleared appropriately

---

### Scenario 6.7: Trade During Bot Turn

**Preconditions:**
- Game with human players and bots
- Bot is currently taking its turn

**Steps:**
1. Human player A proposes trade to Human player B
2. Human player B accepts while bot is playing
3. Trade completes regardless of whose turn it is

**Expected Outcomes:**
- Trades can occur asynchronously
- Bot turn not interrupted
- Trade completes immediately upon acceptance

**Note:** This tests that trading is independent of turn order.

---

## Implementation Notes

### UI Components Needed
- Trade proposal form/dialog
- Trade notification component
- Pending trades list
- Accept/Reject/Cancel buttons

### State Management
- Pending incoming trades (from others)
- Pending outgoing trades (to others)
- Trade history (for current session)

### Chain Name Format
Backend expects title-case chain names: `"Luxor"`, `"Tower"`, `"American"`, etc.

## Reference

- Backend trade handlers: `backend/main.py` lines 1007-1175
- Trade validation: `backend/game/action.py`
- WebSocket message types: `trade_proposed`, `trade_accepted`, `trade_rejected`, `trade_canceled`
