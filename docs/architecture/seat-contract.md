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

The server no longer has a hack of its own (`process_bot_turns` is gone);
`Game.execute_bot_turn` calls `resolve_unplayable_turn` and is used only by
engine tests.

### Trading during a merger

`Rules.validate_trade` rejects any trade (proposal or acceptance) involving
stock of a chain in an in-progress merger: bonuses are paid on current
holdings and pending dispositions rely on the stock counts.

Turn shape: after a `buy_stocks` action the turn is **not** over; the seat must
still send `end_turn` (or `declare_end_game`). `game.stocks_bought_this_turn`
is set by `buy_stocks` and cleared when the turn advances; a second
`Game.buy_stocks` in the same turn fails. (The server keeps an
auto-`end_turn` after a human's `buy_stocks` for the existing frontend; see
Server.)

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

## Ruleset (`backend/game/ruleset.py`, `backend/rulesets/*.json`)

Every game parameter -- product name, theme words, board size, chains, tiers
and prices, bonuses, stock counts, limits -- lives in a ruleset file, so a
variant or a re-theme is a new JSON file, not a code change. The engine is
parameterised end to end and never reads configuration: `Game(ruleset=...)`
receives a validated, immutable `Ruleset` (default: the built-in `classic`)
and hands the same object to its `Board`, `Hotel` and `Player`s; `Rules`,
`decisions`, the calculator, the bots, snapshots and the LLM prompt all read
it from there.

Shipped files: `classic` (the game as it has always been: Acquire, 12x9,
seven hotel chains, $6,000, 25 shares...), `valley` (classic numbers,
"Acquihire" theme with invented AI-startup chains) and `mini` (a deliberately
different variant used by the tests: 9x7, five chains, 18 shares, safe at 8,
end at 25, hand of 5, 2-5 players, 2 founder shares, 8x/4x bonuses rounded to
$50).

### File format

All keys are required and unknown keys are rejected (at every level).

```jsonc
{
  "id": "classic",              // wire-safe id: [A-Za-z][A-Za-z0-9_-]{0,31}
  "version": 1,                 // bump whenever numbers change
  "title": "Acquire",           // product / game name
  "theme": {                    // words for the UI and the LLM prompt
    "chain_noun": "hotel chain", "chain_noun_plural": "hotel chains",
    "share_noun": "share", "share_noun_plural": "shares",
    "stock_label": "Stocks",    // heading for holdings ("Equity" in valley)
    "merger_noun": "merger", "merger_noun_plural": "mergers",
    "safe_phrase": "safe",      // "too big to acquire" in valley
    "currency_symbol": "$",
    "tagline": "Found hotel chains, buy stock, merge for profit.",
    "game_description": "Sid Sackson's hotel-chain board game"
  },
  "board": {"columns": 12, "rows": 9},   // 2-50 columns, 2-26 rows (A..Z)
  "tiers": [                             // cheapest first; rank = position
    {"id": "cheap", "label": "cheap",    // label is display text
     "prices": [{"from": 2, "price": 200}, {"from": 3, "price": 300}, ...,
                {"from": 41, "price": 1000}]}   // must start at 2; last is open-ended
  ],
  "chains": [                            // order = display/state order
    {"id": "Luxor", "name": "Luxor", "tier": "cheap",
     "color": "#FFD700", "abbreviation": "L"}   // id is the state/wire key
  ],
  "bonuses": {"majority_multiplier": 10, "minority_multiplier": 5,
              "tie_round_up_to": 100},   // tie splits round UP to this step
  "stocks_per_chain": 25,       // bank size per chain = per-player cap
  "starting_cash": 6000,
  "hand_size": 6,
  "max_stock_purchases_per_turn": 3,
  "safe_chain_size": 11,
  "end_game_chain_size": 41,
  "founder_bonus_shares": 1,    // free shares for the founder (price in cash if the bank is short)
  "merger_trade_ratio": 2,      // defunct shares per survivor share
  "min_players": 3, "max_players": 6,
  "max_pending_trades_per_player": 5
}
```

Validation (`RulesetError` with the offending path): unknown/missing keys,
integer types (booleans rejected) and ranges, wire-safe unique chain/tier ids,
unique chain names, abbreviations (1-3 alphanumerics) and `#RRGGBB` colours,
2-26 chains, every chain's tier defined, price brackets starting at 2 and
strictly increasing and reachable on the board, `safe`/`end` sizes within the
board, `min_players <= max_players`, and board tiles >= `max_players x hand_size`.
`fingerprint` is the first 12 hex chars of the SHA-256 of the canonical dict
(sorted keys); results recorded under one fingerprint are comparable.

### Selection

`GAME_RULESET` (setting `game_ruleset` in `backend/config.py`): a file name in
`backend/rulesets/` (`classic`, `valley`, `mini`) or a path to a JSON file.
Default `classic`. The app refuses to start on a bad ruleset. Each room is
created with the configured ruleset (`GameRoom.ruleset`, `max_players` from it)
and its game uses it. Protocol validation of client messages (chain ids, tile
pattern, per-turn purchase limit) uses the configured ruleset; the engine's
`validate_action` remains authoritative.

### What clients get

- `GET /config/game` (also `/api/config/game`): the configured ruleset
  before any game exists -- the file's dict plus `"fingerprint"`.
- Every `game_state` message, and `Game.get_public_state()` /
  `get_player_state()`, carries the same object as `ruleset` (the game's own
  ruleset). `hotel.chains[]` entries also carry `color`.
- Coordinates stay `<column><row letter>`; chain keys in state are chain ids;
  display names, colours, abbreviations, tier labels and theme words come
  from `ruleset`.
- `legal_actions` for `stock_disposition` adds `trade_ratio` only when the
  ruleset's ratio is not 2 (classic output is unchanged).

### Snapshots

A non-classic game's snapshot stores the full ruleset dict under `"ruleset"`
and `from_snapshot` restores it; classic games omit the key (snapshots and
generated fixtures from before rulesets stay valid and byte-identical).
`SNAPSHOT_VERSION` is unchanged.

### Not parameters

Kept as engine rules (not configurable): orthogonal adjacency; a chain needs 2
tiles; the survivor/tie/defunct-order rules; sole holder takes both bonuses;
majority tie pools majority + minority; end-game conditions (any chain >= end
size, or all active chains safe) and the "frozen board ends the game" rule;
dead-tile replacement; one tile per turn and one tile drawn at end of turn.
Wire values such as `would_create_eighth_chain` and the classic fixtures'
criterion names keep their historical names.

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

**Optional retry extension.** An agent with a truthy `accepts_rejections`
attribute (`agents.base.accepts_rejections(agent)`; `LLMAgent` sets it) is
called as `decide(ctx, rejected=[{"action", "error"}, ...], deadline=t)`:
`rejected` lists the answers the engine refused for this decision (oldest
first, empty/absent on the first call) and `deadline` is a `time.monotonic()`
instant. Heuristic and scripted agents ignore all of this (plain
`decide(ctx)`). An agent may also expose `max_illegal_retries`.

Implementations: `agents/heuristic.py` (`HeuristicAgent`, kind `bot`: the
`game/bot.py` scoring on a board/hotel/player rebuilt from `ctx.state`,
answers always drawn from `ctx.legal`; RNG seeded by seat name so a seeded
game is reproducible; declares the end when legal and `ctx.calc` ranks it
first; accepts a trade only when `can_accept` and what it receives is worth
strictly more at current prices; it is also the fallback for every other
seat), `agents/scripted.py` (`ScriptedAgent`, deterministic test
opponents), `agents/llm/` (LLM opponent). `agents/registry.py`:
`catalog()` and `create(agent_id, *, name, **opts)` (LLM package imported
lazily). Humans are seats
with no `Agent`; the driver simply waits for their message.

## Server (`backend/main.py` + `backend/seats.py`)

Module layout: `protocol.py` (pydantic validation of client messages),
`broadcast.py` (every server -> client message), `seats.py` (per-room lock,
driver, the one action path), `lifecycle.py` (start / host-forced end),
`api/rooms.py`, `api/ws.py`, `api/testmode.py` (routers), `app_state.py`
(the `SessionManager` singleton). `main:app` stays the uvicorn entry point;
`main.create_app()` builds the app (test-mode routes are decided at build time).

- One per-room `asyncio.Lock` (`GameRoom.runtime.lock`) serialises all
  mutations: human WebSocket/HTTP actions, the driver, snapshot loads, the
  host's forced end.
- One driver task per room (`seats.kick(room_code)` starts it after any
  mutation). Loop: under the lock pick the first agent decision -- trade
  responses addressed to agent seats first, then the flow decision if its
  seat is an agent -- build its `DecisionContext`, broadcast state with
  `awaiting`; **release the lock**; `await asyncio.wait_for(agent.decide(ctx),
  timeout)`; re-acquire; if that exact `Decision` is no longer pending
  (cancelled trade, snapshot loaded, ...) discard the answer; check it (action
  type offered in `ctx.legal["action_types"]`, per-turn caps,
  `validate_action`); an illegal answer from an agent that accepts rejections
  is NOT a fallback yet: the driver releases the lock (the `awaiting` state
  stays), calls `decide(ctx, rejected=[...], deadline=...)` again and re-checks,
  until the answer is legal or the agent raises (retry budget: 1 +
  `max_illegal_retries` answers per decision, shared with the agent's own
  internal retries; time budget: one deadline for the whole decision). Only on
  exception / timeout / an exhausted retry budget (or, for agents without the
  extension, an illegal answer) is `HeuristicAgent` used for that one decision
  (`agent.note_fallback(reason)` is called if the agent has it);
  `apply_action`; publish. A timeout never retries. Stops when no agent
  decision is pending.
- Timeouts per seat kind (`config.py`): `bot_decision_timeout` 10 s,
  `scripted_decision_timeout` 10 s, `llm_decision_timeout` 130 s (the whole
  decision, retries included), or an agent's own `decision_timeout` attribute. Pacing after each
  agent action: `agent_action_delay` 0.4 s, `test_mode_agent_action_delay`
  0.05 s (non-zero so browser tests can watch an all-bot game; protocol tests
  use 0). Runaway caps per seat per turn: `max_agent_actions_per_turn` 40,
  `max_trade_proposals_per_turn` 2 (exceeding them counts as a fallback).
- Fallbacks are logged and counted: `GET /room/{code}/debug` returns
  `{driver_running, version, awaiting_agent, agent_actions, fallback_count,
  fallback_kinds: {error|timeout|illegal|cap|engine: n}, fallbacks: [last 50
  {player_id, seat_kind, decision, reason, category, at}], stalled}`.
- **Fallbacks are announced** (LLM seats). When the rules-based bot decides for
  an LLM seat the driver logs at WARNING on `acquire.llm` and sends, to every
  connected player and the host,
  `{"type": "agent_fallback", "player_id", "player_name", "agent_label",
  "reason": "timeout"|"error"|"illegal"|"cap", "decision": "<decision kind>",
  "message": "<one sentence>"}`. Reasons: `timeout` (decision deadline hit,
  "timed out after N s"), `error` (provider error / nothing answerable),
  `illegal` (retry budget exhausted: "kept answering illegally after N
  tries"; also an engine/validator mismatch), `cap` (per-turn runaway cap).
  Every `game_state` player also carries `fallbacks: {count, last_reason}`
  (`{0, null}` when none), so the frontend can show a marker after a reload.
  The `/debug` counters above are unchanged.
- Human messages go through the same `apply_action`
  (`seats.human_action`). Human wire convenience: a successful `buy_stocks`
  from a human also ends their turn (second `apply_action(end_turn)`), because
  the frontend sends one `buy_stocks` and never `end_turn`; explicit `end_turn`
  is accepted too. Agents always send `end_turn` themselves. Agent seats cannot
  be driven by human messages (`error: "This seat is played by an AI agent"`).
- A recipient's `accept_trade` that fails because the offer is no longer valid
  is followed by an automatic `reject_trade` from that recipient (the only legal
  answer left), so the stale offer leaves everyone's lists; the caller still
  gets the error.
- Notifications are derived from engine output only (new events since the
  action + the new flow decision), so human and agent actions produce
  identical messages (see `broadcast.py`): `choose_chain`,
  `choose_merger_survivor`, `stock_disposition_required` and `can_end_game` go
  to the human whose decision just became pending (and again on reconnect);
  `all_tiles_unplayable` (room) and `tiles_replaced` (player) from
  `tiles_replaced` events; `trade_proposed|accepted|rejected|canceled` to both
  parties and the host; `game_over` (room + host) from `game_ended`, with
  `declared_by` when declared. Every successful action broadcasts `game_state`.
- `game_state` (JSON-safe; `pending_action` is not sent): per player
  `name, money, stocks, hand_size, kind, is_bot, agent_label`; top level
  `board, hotel, turn_order, current_player, phase, tiles_remaining,
  pending_trades, awaiting`; to each player also `your_hand`,
  `tile_playability`, `end_game_available`, `incoming_trades`,
  `outgoing_trades`. `awaiting` is the agent decision being thought about, else
  the flow decision (`kind` may be `human`), else null.
- Starting needs `max(room.min_players, Game.MIN_PLAYERS)` = 3 seats (the
  room said 2; starting with 2 used to 500 and leave the room stuck).
- Disconnects: unchanged -- a closed socket is dropped; nothing is skipped on a
  human's behalf. Reconnecting re-sends the full state and any pending prompt.

### HTTP additions

| Route | Body | Notes |
|-------|------|-------|
| `GET /agents/catalog` | – | `[{"id","kind","label","description","available"}]` – AI opponents the lobby can offer. Always includes `{"id":"bot","kind":"bot",...}`; LLM entries from `agents.llm.config.catalog_entries()` (`available` only when their provider key is configured); `scripted` only in test mode. |
| `POST /room/{code}/add-seat` | `{"agent_id": "<catalog id>", "name"?: str}` | Adds an AI seat. Returns `{"player_id", "name", "kind"}`. 404 unknown id, 400 unavailable / full / started / name taken, 422 missing id. Names: `Bot 1`, `Bot 2`...; LLM seats use the catalog label, `Label 2` when taken; `Scripted 1`... |
| `POST /room/{code}/add-bot` | – | Alias for `agent_id="bot"`; returns `{"bot_id", "player_id", "name", "kind"}`. |
| `POST /room/{code}/remove-seat/{player_id}` | – | Lobby only, AI seats only (400 human / started, 404 unknown). Returns `{"status": "removed", "player_id"}`. |
| `GET /room/{code}/debug` | – | Driver diagnostics (above). |
| `GET /config/game` | – | The server's configured ruleset dict + `fingerprint` (see Ruleset). Also under `/api`. |

Lobby updates (and `GET /room/{code}/state`) list each player as
`{player_id, name, is_bot, kind, agent_label}`. The classic bot has
`agent_label: null` (its badge stays "BOT"); other AI seats carry the catalog
label.

### Test-mode only (`ACQUIRE_TEST_MODE=1`)

| Route | Body | Notes |
|-------|------|-------|
| `POST /test/room/{code}/load-snapshot` | `{"snapshot": {...}, "seat_map"?: {snapshot_player_id: room_player_id}}` | Remaps player ids everywhere in the snapshot dict (any string or key equal to a snapshot player id), takes names and AI seats from the room, restores with `from_snapshot`, marks the room started, broadcasts, prompts the human whose decision is pending, kicks the driver. Without `seat_map`, snapshot players map onto room seats in order (counts must match). 400 on a bad snapshot/map; the room's game is untouched. Returns `{status, phase, current_player, players}`. |
| `GET /test/room/{code}/snapshot` | – | `to_snapshot` of the live game. |
| `POST /room/{code}/add-seat` with `{"agent_id":"scripted","script"?: [...actions]}` | | `ScriptedAgent`: plays script entries in order when the entry's action type is offered for the decision (otherwise the entry waits and the default is played); an entry of the right type that is illegal is dropped. Default: first legal tile, first chain, sell all, end turn without buying, reject trades. |

These routes do not exist when test mode is off (404; `scripted` is neither
offered nor accepted).

## Game transcripts and Acquire Bench (first-class requirement, 2026-11-14)

Every game — live or benchmark — writes a complete transcript: every engine
event, every decision by every seat, and for LLM seats exactly what the model
was shown and exactly what it returned, including rejected attempts. The same
writer is used by the server driver and by the benchmark runner.

### Storage

One JSON Lines file per game: `<ACQUIRE_TRANSCRIPT_DIR>/<game_id>.jsonl`
(default `backend/data/transcripts/`, git-ignored; `game_id` is a URL-safe
unique id). Lines, in order:

```jsonc
{"type":"header","transcript_version":1,"game_id":"...","source":"live"|"bench",
 "room_code":"ABCD"|null,
 "bench":{"series_id":"...","matchup":"...","seed":1,"rotation":0}|null,
 "started_at":"<ISO-8601 UTC>","seed":1|null,
 "seats":[{"player_id","name","kind","agent_id"|null,"agent_label"|null,"model"|null}],
 "prompt_version":"<hash of the system prompt + prompt builder version>",
 "system_prompts":{"<id>":"<full system prompt text>"}}

{"type":"event", ...the engine event verbatim (seq, type, player_id, private_to, payload)}

{"type":"decision","index":0,"after_seq":12,"player_id":"...","kind":"place_tile",
 "legal":{...legal_actions()...},"action":{...the action that was applied...},
 "source":"human"|"bot"|"scripted"|"llm"|"fallback",
 "fallback":{"reason":"timeout|error|illegal|cap","message":"..."}|null,
 "latency_s":1.23,
 "llm":{"model":"...","system_prompt_id":"...","user_prompt":"<full text>",
        "attempts":[{"raw":"<full model output>","parsed":{...}|null,
                     "error":"<why it was rejected>"|null,"latency_s":0.9,
                     "input_tokens":0,"output_tokens":0,"cache_read_tokens":0,
                     "retry_prompt":"<full text of the retry message>"|null}],
        "why":"...","note":"..."}|null}

{"type":"state","after_seq":13,"public":{...game.get_public_state()...}}   // after every applied action

{"type":"footer","ended_at":"...","reason":"declared|no_playable_tiles|forced|abandoned",
 "standings":[{"player_id","name","rank","score"}],
 "totals":{"<player_id>":{"decisions","llm_calls","retries","fallbacks",
           "input_tokens","output_tokens","cost_usd"|null,"latency_s"}}}
```

Human decisions are recorded too (source `human`, `llm: null`). Nothing is
sampled or truncated. A game with no footer is unfinished/abandoned.

### Privacy rule

While a game is unfinished, transcripts served over HTTP are **redacted**:
events with `private_to` set, and each decision's `llm.user_prompt`,
`attempts[].raw`, `attempts[].retry_prompt`, `why`, `note` and the tile lists
inside `legal` are removed (they reveal hands and private plans). After the
footer is written the full transcript is public. Files on disk are always full.

### HTTP (also under `/api`)

| Route | Returns |
|-------|---------|
| `GET /games?source=live\|bench&limit=50&before=<id>` | `{"games":[{"game_id","source","status":"live\|finished\|abandoned","started_at","ended_at"\|null,"room_code"\|null,"series_id"\|null,"seats":[{"player_id","name","kind","agent_label","model"}],"winners":[player_id],"turns":int}]}` newest first |
| `GET /games/{game_id}` | that summary plus `standings` and `totals` |
| `GET /games/{game_id}/transcript` | `{"header":{...},"entries":[...event/decision/state lines in order...],"footer":{...}\|null,"redacted":bool}` |
| `GET /bench/leaderboard?protocol=<id>` | `{"protocol":{"id","description","players","games_per_matchup","seeds"},"updated_at","agents":[{"agent_id","label","model","games","wins","win_rate","ci_low","ci_high","mean_rank","rating","rating_ci","fallback_rate","retry_rate","tokens_per_game","cost_per_game"\|null,"latency_p50_s","verdict"}],"series":[{"series_id","matchup","games","started_at","finished":bool}]}` |
| `GET /bench/series/{series_id}` | `{"series_id","matchup","protocol","games":[{"game_id","seed","rotation","standings":[...]}]}` |

The game-over message and `game_state` carry `game_id` so clients can link to
`/games/{game_id}`.

### Acquire Bench

A named, versioned protocol (`acquire-bench-v1`): fixed seed list, 4 seats,
full seat rotation, fixed prompt version, and two tracks — **vs-baseline**
(one model against three rules-based bots) and **head-to-head** (models of
different strength in the same game). Results are only comparable within a
protocol id + prompt version; the leaderboard never mixes them. Ratings are
computed from finishing order across all games of a protocol; every
leaderboard row links to its games' transcripts.
