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
{"action": "found_chain", "chain": "Marlowe"}
{"action": "merger_choice", "surviving_chain": "Marlowe"}
{"action": "merger_disposition", "defunct_chain": "Sandpiper",
 "disposition": {"sell": 2, "trade": 2, "hold": 1}}
{"action": "buy_stocks", "purchases": {"Marlowe": 2, "Sandpiper": 1}}   // may be {}
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
`purchases` `{"Marlowe": 2}` -> `["Marlowe", "Marlowe"]` (zero counts ignored; the
engine's list form is also accepted); disposition `hold` -> engine `keep`
(`keep` is accepted as an alias, missing keys default to 0); `propose_trade`
builds a `TradeOffer` with `from_player_id = player_id`. All counts/money must
be non-negative ints (bools rejected), chain names must be real chains.
Stricter than `main.py`: `merger_disposition.defunct_chain` must equal the
pending defunct chain. `buy_stocks` with `{}` counts as the turn's purchase.
Out-of-turn actions (`propose_trade`, `accept_trade`, `reject_trade`,
`cancel_trade`) are accepted from any player at any time between game start
and game over; trade responses never block the flow decision.

Trade offers are public (BL-012). The four trade events are public and carry
the whole offer; the server sends `trade_proposed` / `trade_accepted` /
`trade_rejected` / `trade_canceled` to every player and the host, each with
`trade`, `trade_id`, `from_player`, `to_player` and `seq` (the event's
number), and repeats the last 12 of them in `game_state.trade_log`. Only the
recipient may accept or reject and only the proposer may cancel
(`TradingMixin`); a competing offer is an ordinary `propose_trade` by a third
player. An LLM seat sees open offers between other players in its `buy_stocks`
prompt and can only compete through that decision's `propose_trade` option
(no extra model call).

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

The server no longer has a hack of its own (`process_bot_turns` is gone).
`Game.execute_bot_turn` was removed as well (only tests used it); tests drive
bot seats through the decision seam with `tests/support/drive.py`.

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
| `trade_rejected` | `trade_id`, `trade` (the offer; BL-012, absent in older transcripts) |
| `trade_cancelled` | `trade_id`, `reason` (`cancelled\|no_longer_valid`), `trade` (as above) |
| `end_game_declared` | – |
| `game_ended` | `reason` (`declared\|no_playable_tiles\|ended`), `final_sales: {pid: cash}`, `standings` (best first; tied players share a rank, competition ranking 1,1,3), `winner` (first of `winners`), `winners: [pid]` (every rank-1 player; several on a tie) |

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

Every game parameter -- theme title and words, board size, chains, tiers
and prices, bonuses, stock counts, limits -- lives in a ruleset file, so a
variant or a re-theme is a new JSON file, not a code change. The product name
is not part of a ruleset: it is the brand setting `GAME_BRAND_NAME` (default
"Buyout"), served as `brand` next to the ruleset by `GET /config/game` and used
by the frontend for the site title, browser tab, headers and bench pages. The engine is
parameterised end to end and never reads configuration: `Game(ruleset=...)`
receives a validated, immutable `Ruleset` (default: the built-in `default`)
and hands the same object to its `Board`, `Hotel` and `Player`s; `Rules`,
`decisions`, the calculator, the bots, snapshots and the LLM prompt all read
it from there.

Shipped files: `default` ("Grand Hotels": 12x9, seven hotel chains --
Sandpiper and Marlowe cheap; Halcyon, Meridian and Juniper medium; Obsidian and
Aurelia expensive -- $6,000, 25 shares...), `valley` (default numbers,
"Acquihire" theme with invented AI-startup chains) and `mini` (a deliberately
different variant used by the tests: 9x7, five of the default chains as
"shipping lines" in the "Harborline" theme, 18 shares, safe at 8, end at 25,
hand of 5, 2-5 players, 2 founder shares, 8x/4x bonuses rounded to $50).

### File format

All keys are required and unknown keys are rejected (at every level).

```jsonc
{
  "id": "default",              // wire-safe id: [A-Za-z][A-Za-z0-9_-]{0,31}
  "version": 1,                 // bump whenever numbers change
  "title": "Grand Hotels",     // theme name (not the product name)
  "theme": {                    // words for the UI and the LLM prompt
    "chain_noun": "hotel chain", "chain_noun_plural": "hotel chains",
    "share_noun": "share", "share_noun_plural": "shares",
    "stock_label": "Stocks",    // heading for holdings ("Equity" in valley)
    "merger_noun": "merger", "merger_noun_plural": "mergers",
    "safe_phrase": "safe",      // "too big to acquire" in valley
    "currency_symbol": "$",
    "tagline": "Found hotel chains, buy stock, merge for profit.",
    "game_description": "a board game about founding and merging hotel chains"
  },
  "board": {"columns": 12, "rows": 9},   // 2-50 columns, 2-26 rows (A..Z)
  "tiers": [                             // cheapest first; rank = position
    {"id": "cheap", "label": "cheap",    // label is display text
     "prices": [{"from": 2, "price": 200}, {"from": 3, "price": 300}, ...,
                {"from": 41, "price": 1000}]}   // must start at 2; last is open-ended
  ],
  "chains": [                            // order = display/state order
    {"id": "sandpiper", "name": "Sandpiper", "tier": "cheap",
     "color": "#CBBA2F", "abbreviation": "SP"}  // id is the state/wire key
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
`backend/rulesets/` (`default`, `valley`, `mini`) or a path to a JSON file.
Default `default`. The app refuses to start on a bad ruleset. Each room is
created with the configured ruleset (`GameRoom.ruleset`, `max_players` from it)
and its game uses it. Protocol validation of client messages (chain ids, tile
pattern, per-turn purchase limit) uses the ruleset of the room's GAME
(`validate_websocket_message(data, ruleset)`; the server default only when none
is passed), so a game loaded from another ruleset's snapshot is validated
against its own chains; the engine's `validate_action` remains authoritative.

The LLM seat builds its system prompt and answer schema from the game's ruleset
(`ctx.state["ruleset"]`): chain names and ids, limits, theme words and the
currency symbol (system and user prompt). `prompt_version(ruleset)` and
`system_prompt_id(text, ruleset)` include the ruleset fingerprint, so prompt
versions of different rulesets never coincide.

### Final standings and ties

`Game.end_game` ranks by final cash with competition ranking: players tied on
money share the rank (1, 1, 3) and keep seating order inside the tie.
`EndGameResult` / `DeclareEndGameResult` have `winners` (all rank-1 standings)
besides `winner` (the first of them); the `game_ended` event and the broadcast
`game_over` message carry `winners: [player_id]` next to `winner`. Transcript
footers, `GET /games` `winners`, benchmark standings (`bench.runner.assign_ranks`
is the same function) and the calculator's `projected_rank` all use
`game.ranking.competition_ranks`; a benchmark tie is a split win and a half-win
in the rating.

### What clients get

- `GET /config/game` (also `/api/config/game`): the configured ruleset
  before any game exists -- the file's dict plus `"fingerprint"`, and `"brand"`
  (the product name, `GAME_BRAND_NAME`; not part of the ruleset or its fingerprint).
- Every `game_state` message, and `Game.get_public_state()` /
  `get_player_state()`, carries the same object as `ruleset` (the game's own
  ruleset). `hotel.chains[]` entries also carry `color`.
- Coordinates stay `<column><row letter>`; chain keys in state are chain ids;
  display names, colours, abbreviations, tier labels and theme words come
  from `ruleset`.
- `legal_actions` for `stock_disposition` adds `trade_ratio` only when the
  ruleset's ratio is not 2 (default output is unchanged).

### Snapshots

A non-default game's snapshot stores the full ruleset dict under `"ruleset"`
and `from_snapshot` restores it; default games omit the key (snapshots and
generated fixtures from before rulesets stay valid and byte-identical).
`SNAPSHOT_VERSION` is unchanged.

### Not parameters

Kept as engine rules (not configurable): orthogonal adjacency; a chain needs 2
tiles; the survivor/tie/defunct-order rules; sole holder takes both bonuses;
majority tie pools majority + minority; end-game conditions (any chain >= end
size, or all active chains safe) and the "frozen board ends the game" rule;
dead-tile replacement; one tile per turn and one tile drawn at end of turn.
Wire values such as `would_create_eighth_chain` and the default fixtures'
criterion names keep their historical names.

## Calculator pack (`backend/game/calculator.py`)

`build_calculator_pack(game, viewer_id) -> dict` – pure, JSON-serialisable,
public information plus the viewer's own holdings only. Contains per-chain
size/price/safe/available stock, every player's public holdings and cash,
majority/minority holders and bonus payouts per chain if it were acquired now,
the viewer's net worth and everyone's projected end-game score, and remaining
tiles in the bag.

The same module builds the public table view of `game_state`
(`public_net_worth`, `public_chain_holders`, `merger_history`; see Server) from
the same helpers, so the browser shows exactly the numbers the LLM seats see.

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
    chat: list[dict] = []  # recent table chat (LLM seats; see "Table chat")

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
answers always drawn from `ctx.legal`; RNG seeded by `seed` (a seat added
through the server gets "Bot N" for the room's N-th bot, so its play does not
depend on its random character name), else by seat name, so a seeded game is
reproducible; declares the end when legal and `ctx.calc` ranks it
first; accepts a trade only when `can_accept` and what it receives is worth
strictly more at current prices; it is also the fallback for every other
seat), `agents/scripted.py` (`ScriptedAgent`, deterministic test
opponents), `agents/llm/` (LLM opponent). `agents/registry.py`:
`catalog()` and `create(agent_id, *, name, **opts)` (LLM package imported
lazily). Humans are seats
with no `Agent`; the driver simply waits for their message.

## Server (`backend/main.py` + `backend/seats.py`)

Module layout: `agents/driving.py` (the pure driver rules shared with
`bench/`: answer check, fallback category and answer, timeouts),
`protocol.py` (pydantic validation of client messages),
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
  an LLM seat the driver logs at WARNING on `llm` and sends, to every
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
  pending_trades, awaiting, game_id`; to each player also `your_hand`,
  `tile_playability`, `end_game_available`, `incoming_trades`,
  `outgoing_trades`. `awaiting` is the agent decision being thought about, else
  the flow decision (`kind` may be `human`), else null.
- **Table view in `game_state`** (BL-007, 2026-11-15; public, sent to the host
  and every player alike; computed by `game/calculator.py`, never by clients):
  - per player `stock_value` (shares at current prices; a defunct chain's
    shares count 0), `net_worth` (`money + stock_value`) and `rank`
    (competition rank by net worth, ties share a rank: 1, 1, 3)
    (`public_net_worth`);
  - `chain_holders: {chain: {size, price, majority_bonus, minority_bonus,
    holders: [{player_id, shares, role: "majority"|"minority"|null, tied,
    majority, minority, bonus}]}}` for active chains, holders most shares
    first (seat order breaks ties); `role` and amounts are what
    `Rules.calculate_bonuses` would pay if the chain were bought out now (a
    sole holder gets both bonuses, role `majority`; a majority tie splits both
    and pays no minority; a minority tie splits the minority); `tied` when
    another holder shares the role (`public_chain_holders`);
  - `mergers: [{seq, player_id, tile, survivor, sizes, defunct: [{chain, size,
    price, bonuses: [{player_id, majority, minority}] | null, dispositions:
    [{player_id, sell, trade, hold, sale_proceeds, survivor_shares_received}],
    waiting_on: [player_id]}], survivor_size | null, complete}]`: every merger
    of the game, oldest first, rebuilt from the `merger_started` /
    `bonuses_paid` / `stock_disposition` / `merger_completed` events (amounts
    as paid); `waiting_on` are the stockholders still to decide on the chain
    being processed (`merger_history`). The snapshot fixtures' `expect` block
    carries the same three (`net_worth`, `chain_holders`, `mergers`).
  - Each merger also has `survivor_after` (BL-011): `null` once complete;
    while in progress `{size, price, majority_bonus, minority_bonus, bank,
    holders: [{player_id, shares, received, undecided, role, tied, majority,
    minority, bonus}]}`, the surviving chain as it will be when the merger
    ends. `size` is `Board.absorb_merger` (the engine's own finalisation) run
    on a copy of the board, `price` and bonuses are the hotel's for that size,
    `bank` is the survivor's stock left now. Holders are the survivor's
    shareholders now (trades already made in this merger included; `received`
    = survivor shares got by trading in it), plus, with 0 shares, players who
    still hold defunct shares and may trade (`undecided: true`). Roles and
    amounts are `Rules.calculate_bonuses` at the post-merger size with today's
    holdings: exact once nobody still to decide trades (tier 1:
    `test_public_table.py`).
- Starting needs `max(room.min_players, Game.MIN_PLAYERS)` = 3 seats (the
  room said 2; starting with 2 used to 500 and leave the room stuck).
- Disconnects: unchanged -- a closed socket is dropped; nothing is skipped on a
  human's behalf. Reconnecting re-sends the full state and any pending prompt.

### HTTP additions

| Route | Body | Notes |
|-------|------|-------|
| `GET /agents/catalog` | – | `[{"id","kind","label","description","available"}]` – AI opponents the lobby can offer. Always includes `{"id":"bot","kind":"bot",...}`; LLM entries from `agents.llm.config.catalog_entries()` (`available` only when their provider key is configured); `scripted` only in test mode. |
| `POST /room/{code}/add-seat` | `{"agent_id": "<catalog id>", "name"?: str}` | Adds an AI seat. Returns `{"player_id", "name", "kind"}`. 404 unknown id, 400 unavailable / full / started / name taken, 422 missing id. Default names: see "Seat names" below; `Scripted 1`, `Scripted 2`... for scripted test seats. An explicit `name` wins (trimmed; 400 when taken). |
| `POST /room/{code}/add-bot` | – | Alias for `agent_id="bot"`; returns `{"bot_id", "player_id", "name", "kind"}`. |
| `POST /room/{code}/remove-seat/{player_id}` | – | Lobby only, AI seats only (400 human / started, 404 unknown). Returns `{"status": "removed", "player_id"}`. |
| `GET /room/{code}/debug` | – | Driver diagnostics (above). |
| `GET /config/game` | – | The server's configured ruleset dict + `fingerprint` (see Ruleset), plus `brand` (the product name, `GAME_BRAND_NAME`). Also under `/api`. |

Lobby updates (and `GET /room/{code}/state`) list each player as
`{player_id, name, is_bot, kind, agent_label}`. The default bot has
`agent_label: null` (its badge stays "BOT"); other AI seats carry the catalog
label.

### Seat names (BL-010)

The wire fields are unchanged (`name`, `kind`, `agent_label`); only the default
`name` of an AI seat changed. A bot or LLM seat added without `name` gets a
playful character name from `backend/session/seat_names.py` (`SEAT_NAMES`, 48
names such as "Penny Stocks", "Baron Brick", "Lady Ledger", "Max Margin"):

- **Never the model.** The model is only in `agent_label`; clients show it in
  the seat badge's popover (and as primary text where models are compared:
  the lobby's Add AI menu, the transcript summary, the bench leaderboard).
- **Unique in the room**, case-insensitively, against every seat including
  humans. Every name in the list has its own first word, and a name whose full
  name or first word equals a taken name or a taken name's first word is
  skipped, so addressing a seat by its first word in the chat ("Baron, deal?")
  stays unambiguous.
- **Random per room; deterministic under a seed.** The room's name generator
  is created when its first unnamed AI seat is added, seeded from the room's
  `seed` (`/configure`) if already set, else `GAME_SEED`, else unseeded. Under
  `GAME_SEED` (tests, `dev-ready.sh`) the same sequence of seats gets the same
  names in every room.
- **Exhaustion:** when no list name is free, `Tycoon 1`, `Tycoon 2`...
- Scripted test seats keep `Scripted N`; an explicit `name` always wins.

LLM seats learn their name from the prompts ("You are Baron Brick (player id
...)"); the talk prompt adds the short form others may use ('Players may call
you "Baron".') and marks a message "to you" when it names the seat by full
name, `@name` or that distinctive first word (`seat_names.short_names`, the
same rule as `chat.named_seats`).

### Test-mode only (`GAME_TEST_MODE=1`)

| Route | Body | Notes |
|-------|------|-------|
| `POST /test/room/{code}/load-snapshot` | `{"snapshot": {...}, "seat_map"?: {snapshot_player_id: room_player_id}}` | Remaps player ids everywhere in the snapshot dict (any string or key equal to a snapshot player id), takes names and AI seats from the room, restores with `from_snapshot`, marks the room started, broadcasts, prompts the human whose decision is pending, kicks the driver. Without `seat_map`, snapshot players map onto room seats in order (counts must match). 400 on a bad snapshot/map; the room's game is untouched. Returns `{status, phase, current_player, players}`. |
| `GET /test/room/{code}/snapshot` | – | `to_snapshot` of the live game. |
| `POST /room/{code}/add-seat` with `{"agent_id":"scripted","script"?: [...actions],"strict"?: bool}` | | `ScriptedAgent`: plays script entries in order when the entry's action type is offered for the decision (otherwise the entry waits and the default is played); an entry of the right type that is illegal is dropped. Default: first legal tile, first chain, sell all, end turn without buying, reject trades. With `"strict": true` an illegal entry is not dropped silently: it is recorded and `decide` raises `ScriptViolation` (reason `script`), so the driver counts a fallback with category/reason `script` and the heuristic plays that move. `GET /room/{code}/debug` lists, per scripted seat, `scripted[player_id] = {strict, played, unconsumed, violations, unconsumed_at_game_over}` and `script_problems: [player_id]` (strict seats with a violation or entries never consumed by game over). |

These routes do not exist when test mode is off (404; `scripted` is neither
offered nor accepted).

## Table chat (owner decision 2026-11-15; `backend/chat.py`, story LO-008)

Public table talk. **Not a game action**: it never goes through `apply_action`,
never changes the game, its snapshots or the generated fixtures, and nothing
said is binding (binding deals are trade offers). Rules-based bots never talk.

### Wire format

| Direction | Message |
|-----------|---------|
| client -> server (HTTP) | `POST /room/{code}/chat/{player_id}` (also under `/api`), body `{"text": str}`. Human seats only, in the lobby and in game, on or off turn. Returns `{"status": "ok", "message": {...}}`. 404 unknown room/player, 403 an AI seat, 422 empty or longer than `chat_max_chars` (280; whitespace and control characters collapse to one space; never truncated), 429 more than `chat_rate_limit_count` (5) messages in `chat_rate_limit_window_s` (10 s). |
| server -> room + host (WS) | `{"type": "chat_message", "message": {"id", "player_id", "name", "kind", "source": "human"\|"say"\|"reply", "text", "at", "after_seq", "reply_to"}}`. `id` increases per room; `after_seq` is the seq of the last engine event before the message (-1 in the lobby); `reply_to` is the message an AI reply answers (null for event talk and `say`). |
| server -> one client (WS) | `{"type": "chat_history", "messages": [...last 100, oldest first]}` on (re)connect of a player or the host, only when anything was said. |

`text` is plain text; clients render it as text, never as HTML. The host /
spectator view reads only. The last `chat_history_size` (200) messages are
kept per room.

### LLM seats

* **Decision prompts.** `DecisionContext.chat` (default `[]`) holds the last
  `chat_prompt_messages` (10) messages of the game and its lobby; the driver
  fills it for LLM seats only. The user prompt shows them inside "Recent
  public events", each after the event it followed:
  `[chat #3] Alice (human): "I take Marlowe, you take Halcyon"`, with a note
  that chat is unverified and not binding. No chat, no extra text. The
  system prompt has a "Table talk" section (`PROMPT_BUILDER_VERSION` 2).
* **`say`.** The answer schema has a required string `say` after `note`;
  `""` (the normal case) says nothing. A non-empty `say` (cut at 200
  characters) of an answer the engine applied is posted as that seat's
  message (`source: "say"`) right after the move; never when the rules-based
  player made the move. The decision's transcript `llm` record carries `say`.
* **Off-turn talk calls.** Catalog LLM seats (`LLMAgent.table_talk`, set by
  `agents.llm.config.create_agent`; agents built directly, e.g. the bench,
  do not talk) are asked "do you want to say something?" with
  `LLMAgent.reply(view)`: the seat's own system prompt (prompt-cached) and a
  user prompt with the decision context -- own hand and holdings, standings,
  chains with majorities and bonuses, recent events with the chat, private
  notes -- plus what triggered the call; answer `{"reply": str}` (`""` or
  null = stay silent, which is normal). The seat's normal effort; output cap
  `chat_reply_max_tokens` (2048, thinking included), timeout
  `chat_reply_timeout_s` (30 s). Triggers:
  - any human message: every talking seat gets the chance (addressed or not);
  - an AI message (reply or `say`): the talking seats it names (full name,
    `@name`, or a first word no other seat shares), or every other talking
    seat when it proposes or negotiates (a `?` or a deal word: deal, trade,
    offer, sell, buy, majority, merger, shares...);
  - after a move: `chain_founded` and `merger_started` (every talking seat
    but the mover, who can `say`), `trade_accepted` / `trade_rejected` (the
    other party), a seat losing its place as top holder of a chain
    (synthetic `majority_lost`), `game_ended` (everyone). A trade offered to
    a seat is answered by its `trade_response` decision, which can `say`.
* **Loop protection** (settings in `backend/config.py`, env vars of the same
  name): AI messages stop triggering talk once `chat_ai_streak_max` (3) AI
  messages came in a row (a human message or a move resets the streak); a
  per-seat cooldown `chat_reply_cooldown_s` (8 s) between calls -- a trigger
  arriving meanwhile is kept (the most important one: human > event > AI)
  and runs when the cooldown ends; one call in flight per seat; a runaway cap
  `chat_reply_max_per_game` (60 calls per seat per game, the lobby counted
  separately). `chat_replies_enabled` (true) switches talk calls off.
* A talk call runs in a background task: it never holds the room lock,
  never touches game state and never delays a move. A failed call is logged
  and recorded; nothing is retried and nothing falls back.
* `GET /room/{code}/debug` adds `chat_replies: {player_id: {count, skipped,
  in_flight, pending}}` for the current game.

### Transcript lines

```jsonc
{"type":"chat","id":3,"player_id":"...","name":"Alice","kind":"human","source":"human"|"say"|"reply",
 "text":"...","at":"<ISO>","after_seq":41,"reply_to":null,"decision_index":12|null}
{"type":"chat_reply","after_seq":41,"player_id":"llm_...","trigger":{"source":"human"|"ai"|"event",
 "message_id":3|null,"events":["chain_founded"]},"reply_to":3|null,
 "outcome":"replied"|"silent"|"failed"|"dropped","message_id":4|null,"latency_s":1.2,
 "llm":{"model","system_prompt_id","user_prompt","attempts":[...as for decisions...],"error"?}}
```

A `chat` line is written when the message is posted, after every engine event
before it (so file order matches `after_seq`); lobby messages (and lobby talk
calls) are written right after the transcript's opening lines. `decision_index`
links a `say` to its decision. Every talk call is a `chat_reply` line; footer
and live totals count it in `reply_calls`, its answers in `llm_calls` and its
tokens (and so `cost_usd`) like decision calls. While the game is unfinished
the HTTP transcript drops `chat_reply.llm.user_prompt` (it holds the seat's
hand and notes). When a game ends with talk calls in flight, the transcript is
closed once they finish (at most `chat_reply_timeout_s` + 5 s later), so their
lines and cost are in it.

## Game transcripts and Buyout Bench (first-class requirement, 2026-11-14)

Every game — live or benchmark — writes a complete transcript: every engine
event, every decision by every seat, and for LLM seats exactly what the model
was shown and exactly what it returned, including rejected attempts. The same
writer (`backend/transcripts/writer.py`, `TranscriptWriter`) is used by the
server driver and by the benchmark runner.

### Storage

One JSON Lines file per game: `<GAME_TRANSCRIPT_DIR>/<game_id>.jsonl`
(default `backend/data/transcripts/`, git-ignored; empty or `off` disables
transcripts; `game_id` is URL-safe, unique and time-sortable, e.g.
`20261114-153012-a1b2c3d4`, matching `[A-Za-z0-9][A-Za-z0-9_-]{0,95}`).
Benchmark runs write to `<results dir>/transcripts/`. Next to each file a small
`<game_id>.summary.json` (written at open and at close) lets listings avoid
parsing transcripts; it is rebuilt from the transcript when missing or stale.
Lines, in order:

```jsonc
{"type":"header","transcript_version":1,"game_id":"...","source":"live"|"bench",
 "room_code":"ABCD"|null,
 "bench":{"series_id":"...","matchup":"...","seed":1,"rotation":0,
          "protocol":"bench-v1"|absent,"track":"vs-baseline"|...,"prompt_version":"...",
          "series_games":72,"seating_index":0,"lineup":[...]}|null,
 "started_at":"<ISO-8601 UTC>","seed":1|null,"tile_order":[...]|null,
 "ruleset_id":"default","ruleset_fingerprint":"<12 hex>",
 "ruleset":{...the full ruleset dict (file format); replays use it...},
 "seats":[{"player_id","name","kind","agent_id"|null,"agent_label"|null,"model"|null,"is_bot"}],
 "prompt_version":"v1-<10 hex>",
 "system_prompts":{"sp-<12 hex>":"<full system prompt text built for this ruleset>"},   // {} without LLM seats
 "loaded_from_snapshot":false,"start_seq":0}

{"type":"event","event":{...the engine event verbatim: seq, type, player_id, private_to, payload}}

{"type":"decision","index":0,"after_seq":12,"player_id":"...","kind":"place_tile",
 "legal":{...legal_actions()...}|null,"action":{...the action that was applied...},
 "source":"human"|"bot"|"scripted"|"llm"|"fallback",
 "fallback":{"reason":"timeout|error|illegal|cap","message":"...","detail":"<raw failure>"}|null,
 "latency_s":1.23|null,
 "llm":{"model":"...","system_prompt_id":"sp-...","user_prompt":"<full text>",
        "attempts":[{"raw":"<full model output>"|null,"parsed":{...}|null,
                     "error":"<why it was rejected>"|null,"latency_s":0.9|null,
                     "input_tokens":0,"output_tokens":0,"cache_read_tokens":0,
                     "cache_write_tokens":0,
                     "retry_prompt":"<full text of the retry message>"|null}],
        "why":"..."|null,"note":"..."|null,
        "outcome":"answered"|"failed","error":"<why the agent gave up>"|absent,
        "system_prompt":"<text>"|absent}|null}

{"type":"state","after_seq":13,"public":{...game.get_public_state()...}}

{"type":"footer","ended_at":"...","reason":"declared|no_playable_tiles|forced|abandoned",
 "detail":"..."|absent,
 "standings":[{"player_id","name","rank","score"}],
 "totals":{"<player_id>":{"decisions","llm_calls","retries","fallbacks",
           "input_tokens","output_tokens","cache_read_tokens","cache_write_tokens",
           "cost_usd"|null,"latency_s","reply_calls"}}}
```

Table chat adds `chat` and `chat_reply` lines between these (see "Table chat"
above); a decision's `llm` record also carries `say`.

Semantics clients rely on:

* **Event lines are wrapped** (`{"type":"event","event":{...}}`), on disk and
  over HTTP: the engine event has its own `type` key.
* **Order.** Entries are in file order. A `decision` line is written right
  after its action was applied and BEFORE the events that action produced;
  its `after_seq` is the seq of the last event before the action. The `state`
  line follows the action's events; its `after_seq` is the last seq included.
  So a viewer pairs `decision -> its events -> state` by walking in order.
  The file starts with the header, the `start_game` events and one `state`.
  Mutations that are not seat actions (host-forced end) write their events
  and a `state` with no decision.
* Every applied action of every seat is recorded once, through the server's
  one action path (`seats.apply_and_publish`) or the bench runner: human
  actions too (`source: "human"`, `llm: null`; `kind` is the decision the
  action answered, `out_of_turn` for a trade proposal/cancel outside one,
  `legal` then null). A human `buy_stocks` followed by the server's automatic
  `end_turn` is two decisions. A `propose_trade` without `trade_id` is
  recorded with the id the engine assigned. Replaying the `decision.action`
  list through a fresh `Game(seed, tile_order)` with the header's seats (in
  order, `is_bot` as given) reproduces the game exactly
  (`transcripts/replay.py`), except for `loaded_from_snapshot` transcripts and
  a host-forced end.
* `llm` attempts span the whole decision, including the driver's `rejected=`
  re-asks: an answer the engine/driver refused carries that error; an attempt
  cut off by the decision timeout has `raw: null` and an error saying so. When
  the rules-based player decided, `source` is `fallback`, `fallback` gives the
  reason, `action` is the bot's action and `llm` still holds the failed
  attempts. `system_prompt_id` refers to `header.system_prompts`; a prompt not
  in the header (a custom agent) is stored inline once as
  `llm.system_prompt`.
* **Retries** = number of attempts with a non-null `error` (also in
  `totals.retries` and the leaderboard's `retry_rate`). `llm_calls` counts
  attempts with a model answer (`raw` not null).
* `cost_usd` is from `backend/bench/prices.json`: `0` for seats that used no
  tokens (humans, bots), null when a price is unknown.
* Snapshot loads (test mode) close the room's previous transcript with reason
  `abandoned` and start a new one at the loaded state
  (`loaded_from_snapshot: true`, `start_seq` = first event written). An
  aborted or stalled bench game is closed `abandoned` with `detail`.

Nothing is sampled or truncated. A game with no footer is unfinished.
Writing never breaks a game: errors are logged once and the writer disables
itself. Lines are flushed one by one, so a crash leaves a valid file without
footer.

### Privacy rule

While a game is unfinished, transcripts served over HTTP are **redacted**:

* removed: events with `private_to` set; each decision's `llm.user_prompt`,
  `llm.why`, `llm.note`, `llm.error`, `attempts[].raw`,
  `attempts[].retry_prompt`, `fallback.detail`, and `legal.tiles` (the tile
  list of a `place_tile` decision);
* blanked, key kept: `attempts[].parsed` -> null, a non-null
  `attempts[].error` -> `"rejected (details are shown when the game is
  over)"` (both can name a tile in hand), plus `attempts[].rejected: bool`;
  the header's `seed` and `tile_order` -> null (either one determines every
  hand and the whole bag).

After the footer is written the full transcript is public. Files on disk are
always full. The static system prompt (public rules) stays visible.

### HTTP (also under `/api`; `backend/api/games.py`)

| Route | Returns |
|-------|---------|
| `GET /games?source=live\|bench&limit=50&before=<id>` | `{"games":[{"game_id","source","status":"live\|finished\|abandoned","started_at","ended_at"\|null,"room_code"\|null,"series_id"\|null,"seats":[{"player_id","name","kind","agent_label","model"}],"winners":[player_id],"turns":int,"ruleset_id","ruleset_title"}],"next":"<game_id>"\|null}` newest first; `next` is the `before` cursor of the next page (null on the last page); an unknown `before` id gives an empty page; `limit` 1..500 |
| `GET /games/{game_id}` | that summary plus `standings`, `totals`, `end_reason`, `prompt_version`, `ruleset_fingerprint`, `bench`, `loaded_from_snapshot` |
| `GET /games/{game_id}/transcript` | `{"header":{...},"entries":[...event/decision/state lines in order...],"footer":{...}\|null,"redacted":bool}`, plus `live_totals` (footer-shaped totals so far) while unfinished. gzip when the client accepts it. |
| `GET /bench/leaderboard?protocol=<id>&ruleset=<id or fingerprint>&prompt_version=<v>&track=all\|vs-baseline\|head-to-head` | `{"protocol":{"id","description","players","games_per_matchup","seeds"},"ruleset":{"id","title","fingerprint"},"ruleset_id","ruleset_fingerprint","prompt_version","track","updated_at"\|null,"games","agents":[{"agent_id","label","model","games","seat_games","wins","win_rate","ci_low","ci_high","mean_rank","rating","rating_ci":[lo,hi]\|null,"fallback_rate","retry_rate","tokens_per_game","cost_per_game"\|null,"latency_p50_s"\|null,"verdict","decisions","is_anchor"}],"series":[{"series_id","matchup","track","games","planned","started_at","finished":bool,"full_protocol":bool}],"available":{"protocols","prompt_versions","rulesets":[{"id","fingerprint"}]},"rating":{...method...},"warnings":[...]}`. Defaults: the protocol, then the ruleset, then the prompt version of the most recent result; only records of that protocol + ruleset fingerprint + prompt version are used. Empty results: the default protocol with `agents: []`, `series: []`, `updated_at: null`. |
| `GET /bench/series/{series_id}` | `{"series_id","matchup","protocol","track","prompt_version","ruleset_id","ruleset_fingerprint","planned","games":[{"game_id","seed","rotation","status","seat_order","standings":[{"player_id","name","agent_id","rank","score"}]}]}` (`rotation` = seating index) |

Unknown ids/protocols are JSON 404s; ids are validated before any file access.
`status`: `finished` = footer (reason not `abandoned`); `abandoned` = footer
with reason `abandoned`, or no footer and the game is not running (a live game
not in this server process; a bench transcript not modified for 15 min);
`live` otherwise. Leaderboard rows: rates and CI bounds are 0..1, the
rules-based bot row has `cost_per_game: 0` (null means an unknown price),
`verdict` is display text. A browser navigation (`Accept: text/html`) to a bare
`/games...` or `/bench...` path gets the SPA's `index.html` when the frontend is
served, so those can be client-side routes too; API clients use `/api/...`.

The game-over message and every `game_state` carry `game_id` so clients can
link to `/games/{game_id}`.

### Buyout Bench

A named, versioned protocol (`bench-v1`, `backend/bench/protocols.py`):
fixed seed list (9001-9018), 4 seats, every distinct seating of each lineup
played on the same deal, 72 games per series, ruleset (`ruleset_id`,
`ruleset_fingerprint`) and prompt version recorded in every result — and two
tracks — **vs-baseline** (one model against three
rules-based bots) and **head-to-head** (the models in one game, bots filling
empty seats; more than 4 models: every 4-combination). Results are only
comparable within a protocol id + ruleset fingerprint + prompt version; the
leaderboard never mixes them. A run plays on one ruleset (`python -m bench run
--ruleset <name|path>`, `run_protocol(..., ruleset=)`; default the server's
`GAME_RULESET`, else default); the ruleset is part of every game key, series id,
prompt version, transcript header and leaderboard. Ratings are computed from finishing order across all games of a
protocol + prompt version (pairwise Bradley-Terry on the Elo scale, the
rules-based bot anchored at 1500, bootstrap CI over games); every leaderboard
row links to its games' transcripts via `/bench/series/{id}`. Usage, layout of
a results directory and the rating method: `docs/ai/benchmarking.md`.
