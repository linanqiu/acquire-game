# Seat / Engine Contract

Single source of truth for the seam between the rules engine and everything
that plays it (humans over WebSocket/HTTP, LLM opponents, heuristic bots,
scripted test players). If code and this document disagree, fix one of them in
the same commit.

## Principles

1. **A seat is a human, an LLM, a heuristic bot, or a scripted player. The
   engine cannot tell which.** Every seat acts through the same
   `apply_action()` entry point with the same action dicts.
2. **One decision at a time.** The engine says who must decide what; a driver
   asks that seat; the answer is validated and applied. No whole-turn bot calls.
3. **Public information only** for agent seats: the public event log, public
   state, and the seat's own private hand.
4. **Arithmetic lives in code** (`game/calculator.py`), judgment lives in the
   agent.
5. **Never stall**: an agent error, timeout or illegal answer falls back to the
   heuristic agent for that one decision.

## Actions (wire format, identical for all seats)

```jsonc
{"action": "place_tile", "tile": "5C"}
{"action": "found_chain", "chain": "Tower"}
{"action": "merger_choice", "surviving_chain": "Tower"}
{"action": "merger_disposition", "defunct_chain": "Luxor",
 "disposition": {"sell": 2, "trade": 2, "hold": 1}}
{"action": "buy_stocks", "purchases": {"Tower": 2, "Luxor": 1}}   // may be {}
{"action": "end_turn"}
{"action": "declare_end_game"}
// Player-to-player trading (allowed out of turn):
{"action": "propose_trade", "to_player_id": "...", "offering_stocks": {},
 "offering_money": 0, "requesting_stocks": {}, "requesting_money": 0,
 "trade_id": "..."}   // trade_id optional: explicit id for deterministic fixtures, else a random uuid
{"action": "accept_trade", "trade_id": "..."}
{"action": "reject_trade", "trade_id": "..."}
{"action": "cancel_trade", "trade_id": "..."}
```

These are exactly the messages `backend/main.py` already accepts from clients.

## `backend/game/decisions.py`

```python
@dataclass(frozen=True)
class Decision:
    player_id: str
    kind: str          # place_tile | found_chain | choose_survivor |
                       # stock_disposition | buy_stocks | trade_response
    context: dict      # JSON-serialisable, PUBLIC details (safe to broadcast as
                       # `awaiting.decision`; never contains a hand):
                       # place_tile: {}; found_chain: {tile, available_chains};
                       # choose_survivor: {tile, tied_chains};
                       # stock_disposition: {defunct_chain, surviving_chain,
                       #   stock_count, available_to_trade};
                       # buy_stocks: {stocks_bought_this_turn};
                       # trade_response: {trade: TradeOffer.to_dict()}

def pending_decisions(game) -> list[Decision]
    # [] in LOBBY / GAME_OVER. Otherwise element 0 is the blocking flow
    # decision; any further elements are `trade_response` decisions, one per
    # pending trade offer, addressed to the offer's recipient.

def legal_actions(game, decision) -> dict
    # JSON-serialisable description of every legal answer. Shapes:
    # place_tile:        {"action_types": ["place_tile"] (+ "declare_end_game" when legal),
    #                     "tiles": [{"tile": "5C", "outcome": "nothing|expand|found|merge",
    #                                "chains": [...]}]}
    #                    PRIVATE (lists the seat's hand). "chains": the chain grown
    #                    (expand) or the chains merged (merge); [] otherwise.
    #                    "tiles" is never empty in a reachable state: see
    #                    "No playable tile" below.
    # found_chain:       {"action_types": ["found_chain"], "chains": [...]}
    # choose_survivor:   {"action_types": ["merger_choice"], "chains": [...]}
    # stock_disposition: {"action_types": ["merger_disposition"], "defunct_chain",
    #                     "surviving_chain", "stock_count", "max_trade" (even, limited by
    #                     survivor stock available), "rule": "sell+trade+hold == stock_count"}
    # buy_stocks:        {"action_types": [...subset of buy_stocks, end_turn,
    #                     declare_end_game, propose_trade], "max_total": 3,
    #                     "options": [{"chain", "price", "available", "max_affordable"}],
    #                     "money": int}
    #                    buy_stocks is absent once game.stocks_bought_this_turn is True.
    # trade_response:    {"action_types": ["accept_trade", "reject_trade"], "trade": {...},
    #                     "can_accept": bool}

def validate_action(game, player_id, action: dict) -> str | None   # error or None, no mutation
def apply_action(game, player_id, action: dict) -> dict
    # THE single mutation entry point. Runs validate_action first (so an illegal
    # action never mutates anything), dispatches to the Game methods, returns
    # the result's to_dict() (always has "success"; "error" when False).
    # Never raises on bad input.
def public_events(game, viewer_id=None, since_seq=0) -> list[dict]
```

Wire -> engine translation done by `apply_action` (same as `main.py` today):
tile strings are stripped/upper-cased and must match `1A`..`12I`;
`purchases` `{"Tower": 2}` -> `["Tower", "Tower"]` (zero counts ignored; the
engine's list form is also accepted); disposition `hold` -> engine `keep`
(`keep` is accepted as an alias, missing keys default to 0); `propose_trade`
builds a `TradeOffer` with `from_player_id = player_id`. All counts/money must
be non-negative ints (bools rejected), chain names must be real chains.
Stricter than `main.py`: `merger_disposition.defunct_chain` must equal the
pending defunct chain. `buy_stocks` with `{}` counts as the turn's purchase.
Out-of-turn actions (`propose_trade`, `accept_trade`, `reject_trade`,
`cancel_trade`) are accepted from any player at any time between game start
and game over; trade responses never block the flow decision.

### No playable tile (engine-owned)

The engine guarantees a way forward; drivers do nothing special.
`Game.resolve_unplayable_turn()` runs automatically at the start of every turn
(end of `start_game` and `end_turn`) and is idempotent (drivers only call it
after editing game state by hand, e.g. tests). If the current player holds no
playable tile it:
1. applies the all-tiles-unplayable replacement rule
   (`handle_all_tiles_unplayable`: hand revealed and discarded, redrawn) if the
   hand is non-empty;
2. if a tile is now playable, stops (decision stays `place_tile`);
3. if the bag is empty and **no** player holds a playable tile, the board can
   never change again, so the game ends (`game_ended`, reason
   `no_playable_tiles`);
4. otherwise skips placement: phase -> `BUYING_STOCKS`, event
   `tile_placement_skipped`.

The `game.phase = BUYING_STOCKS` hacks in `main.py::process_bot_turns` and
`Game.execute_bot_turn` are therefore dead code (the latter now calls
`resolve_unplayable_turn`); the former can go when main.py moves to
`apply_action`.

### Trading during a merger

`Rules.validate_trade` rejects any trade (proposal or acceptance) involving
stock of a chain in an in-progress merger: bonuses are paid on current
holdings and pending dispositions rely on the stock counts.

Turn shape: after a `buy_stocks` action the turn is **not** over; the seat must
still send `end_turn` (or `declare_end_game`). `game.stocks_bought_this_turn`
is set by `buy_stocks` and cleared when the turn advances; a second
`Game.buy_stocks` in the same turn fails. (Integration note: today
`main.py::handle_buy_stocks` ends the turn itself and the frontend sends a
single `buy_stocks`, never `end_turn`; when main.py switches to
`apply_action`, either keep that auto-`end_turn` for human seats or teach the
frontend to send `end_turn`.)

## Event log (`game.events`)

Append-only list of JSON-serialisable dicts, emitted by the engine on every
mutation:

```python
{"seq": 0, "type": "...", "player_id": "p1" | None, "private_to": None | "p1", ...payload}
```

`private_to` is set only for information a human at the table would not see
(e.g. which tile was drawn). Helper: `public_events(game, viewer_id=None,
since_seq=0)` returns events with `private_to in (None, viewer_id)`. `seq` is
the event's index in `game.events` (contiguous from 0). A player's hand can be
reconstructed exactly from the events they can see (`tiles_dealt` +
`tile_drawn` - `tile_placed` - `tiles_replaced.removed_tiles`), and cash flows
reconcile exactly (see `money_delta_from_events` in `tests/test_decisions.py`).

Event types: `game_started` (turn order; initial hands as private per-player
`tiles_dealt` events), `tile_placed` (tile, outcome), `chain_founded`,
`chain_expanded`, `merger_started` (survivor, defunct, sizes),
`bonuses_paid` (chain, per-player amounts), `survivor_chosen`,
`stock_disposition` (sell/trade/hold), `merger_completed`,
`stocks_purchased` (purchases, total cost), `turn_ended`, `tile_drawn`
(private), `tiles_replaced` (public: which dead tiles were discarded),
`trade_proposed`, `trade_accepted`, `trade_rejected`, `trade_cancelled`,
`end_game_declared`, `game_ended` (final standings).

Payloads as built (beyond `seq/type/player_id/private_to`):

| type | payload |
|------|---------|
| `game_started` | `turn_order`, `players: [{player_id, name}]` |
| `tiles_dealt` (private) | `tiles` |
| `tile_placed` | `tile`, `outcome` (`nothing\|expand\|found\|merge\|merge_tie`), plus `chains` (expand/merge), `available_chains` (found), `sizes`, `tied_chains` (merge) |
| `chain_founded` | `chain`, `tile`, `size`, `founder_bonus_type` (`stock\|cash`), `founder_bonus_value` |
| `chain_expanded` | `chain`, `tile`, `size` |
| `survivor_chosen` | `survivor`, `tied_chains` |
| `merger_started` | `tile`, `survivor`, `defunct` (processing order), `sizes` |
| `bonuses_paid` | `chain`, `chain_size`, `final` (true at game end), `bonuses: {pid: {majority, minority}}` |
| `stock_disposition` | `defunct_chain`, `surviving_chain`, `sell`, `trade`, `hold`, `sale_proceeds`, `survivor_shares_received` |
| `merger_completed` | `survivor`, `defunct`, `survivor_size` |
| `stocks_purchased` | `purchases: {chain: n}`, `prices: {chain: price}`, `total_cost` |
| `tile_drawn` (private) | `tile`, `reason` (`end_turn\|replacement`) |
| `tiles_replaced` | `reason` (`permanently_unplayable\|all_unplayable`), `revealed_hand`, `removed_tiles`, `new_tile_count` |
| `tile_placement_skipped` | `reason: "no_playable_tiles"` |
| `turn_ended` | `next_player_id` |
| `trade_proposed` / `trade_accepted` | `trade` (TradeOffer dict) |
| `trade_rejected` | `trade_id` |
| `trade_cancelled` | `trade_id`, `reason` (`cancelled\|no_longer_valid`) |
| `end_game_declared` | – |
| `game_ended` | `reason` (`declared\|no_playable_tiles\|ended`), `final_sales: {pid: cash}`, `standings`, `winner` |

Order for a declared end: `end_game_declared`, `bonuses_paid` (final, one per
active chain), `game_ended`.

## Snapshots (`backend/game/snapshot.py`)

```python
SNAPSHOT_VERSION = 1
def to_snapshot(game) -> dict      # JSON-serialisable, complete (incl. RNG state,
                                   # tile bag order, hands, merger state, pending
                                   # action, trades, events, stocks_bought_this_turn)
def from_snapshot(data) -> Game    # raises ValueError on bad version/shape
```

Guarantee: for any reachable game state `g`, `from_snapshot(to_snapshot(g))`
behaves identically to `g` under any subsequent action sequence.

## Calculator pack (`backend/game/calculator.py`)

`build_calculator_pack(game, viewer_id) -> dict` – pure, JSON-serialisable,
public information plus the viewer's own holdings only. Contains per-chain
size/price/safe/available stock, every player's public holdings and cash,
majority/minority holders and bonus payouts per chain if it were acquired now,
the viewer's net worth and everyone's projected end-game score, and remaining
tiles in the bag.

## Seats (`backend/agents/`)

```python
@dataclass
class DecisionContext:
    player_id: str
    decision: Decision
    legal: dict            # legal_actions()
    state: dict            # game.get_player_state(player_id)
    events: list[dict]     # public_events(game, player_id)
    calc: dict             # build_calculator_pack(game, player_id)

class Agent(Protocol):
    kind: str              # "bot" | "llm" | "scripted"
    async def decide(self, ctx: DecisionContext) -> dict   # returns an action dict
```

Implementations: `agents/heuristic.py` (wraps `game/bot.py`), `agents/scripted.py`
(deterministic test opponents), `agents/llm/` (LLM opponent). Humans are seats
with no `Agent`; the driver simply waits for their message.

## Server (`backend/main.py` + `backend/seats.py`)

- One per-room `asyncio.Lock` serialises all mutations.
- One driver loop: `while pending_decisions(game)[0]` belongs to an agent seat:
  build context -> `await agent.decide()` (with timeout) -> `validate_action` ->
  on failure fall back to heuristic -> `apply_action` -> broadcast.
- Human messages go through the same `apply_action`.
- Game state broadcasts include, per player, `kind` (`human|bot|llm|scripted`)
  and keep `is_bot` (true for every non-human) for compatibility, plus a
  top-level `awaiting: {"player_id", "kind", "decision"} | null`.

### HTTP additions

| Route | Body | Notes |
|-------|------|-------|
| `GET /agents/catalog` | – | `[{"id","kind","label","description","available"}]` – AI opponents the lobby can offer. Always includes `{"id":"bot","kind":"bot",...}`; LLM entries are `available` only when their provider key is configured. |
| `POST /room/{code}/add-seat` | `{"agent_id": "<catalog id>", "name"?: str}` | Adds an AI seat. Returns `{"player_id", "name", "kind"}`. `add-bot` stays as an alias for `agent_id="bot"`. |
| `POST /room/{code}/remove-seat/{player_id}` | – | Lobby only, AI seats only. |

Lobby updates list each player with `kind` and `agent_label`.

### Test-mode only (`ACQUIRE_TEST_MODE=1`)

| Route | Body | Notes |
|-------|------|-------|
| `POST /test/room/{code}/load-snapshot` | `{"snapshot": {...}, "seat_map"?: {snapshot_player_id: room_player_id}}` | Replaces the room's game with a restored snapshot and broadcasts. |
| `POST /room/{code}/add-seat` with `{"agent_id":"scripted","script"?: [...actions]}` | | Scripted opponent; with no script it plays the first legal action. |

These routes do not exist when test mode is off.
