# Performance: where the lag comes from, and what was done (BL-020)

Owner feedback (2026-11-18, iPhone, against rules bots and LLM seats): "Generally it should feel
lighter weight and snappier, more responsive. Sometimes the lag is high."

Everything below was measured, before and after, on 2026-11-18. Measuring tools (kept out of the
repo; easy to rebuild from this description):

- **Protocol probe**: a Python client that creates a room through the HTTP routes, adds N rules
  bots, starts, and plays one human seat over the player WebSocket (first playable tile, one
  cheap share, hold on dispositions). Per action it times send -> the first `game_state` that
  shows the result; per round it times my END TURN -> my next `place_tile`, and counts the
  `game_state` messages and bytes received meanwhile.
- **Browser probe**: Playwright on the production build (served by the backend), phone viewport
  390x844, touch, **CPU throttled 4x** (`Emulation.setCPUThrottlingRate`), playing through the UI
  only. An init script wraps `WebSocket` (arrival time and size of every message, then the next
  animation frame), counts React commits and components rendered per commit (devtools hook), and
  records long tasks. In-page timers measure tap -> result on screen (MutationObserver + next
  frame). A CPU profile (`Profiler`) and a trace (`Tracing`, devtools.timeline) attributed the
  main-thread time.
- **In-process timing** of `apply_action`, the bot's decision (`build_context` with the
  calculator pack + `HeuristicAgent.choose`), `build_public_state`, `private_fields` and JSON for
  every state of whole 4- and 6-player games.

Local = this sandbox, backend on 127.0.0.1. Deployed = https://acquire-game-production.up.railway.app
(Railway edge `iad1`), measured read-only with 3 rules bots, no LLM seats; the games were left.
The sandbox machine was shared (load average 7-12 on 4 cores), so single runs vary by about
+-20 %; the before/after browser numbers below come from interleaved A/B runs (old build and new
build served side by side, alternating).

## The breakdown before

| What | Local | Deployed | Notes |
|---|---|---|---|
| Server: one engine action (`apply_action`) | 0.06 ms | | |
| Server: one rules-bot decision (context + calculator pack + choice) | 1.6 ms mean, 5 ms max | | 6 players: same |
| Server: one broadcast (public state + calculator parts, once per state; per player only hand, playability, trades) | 0.4 ms + 0.04 ms per player | | late game 6 players: 0.4 ms |
| `game_state` size | 7-11 KB median, 15-19 KB late | 8 KB median | deflated by the socket (`permessage-deflate`, negotiated on Railway too) to about 2.5 KB |
| Action round trip (send -> state back), protocol | **2 ms** | **106 ms** | deployed = network round trip from the sandbox to `iad1` |
| Wait between my turns, 3 bots | **4.0 s** | **3.6 s** | protocol probe; 3.5 s in the browser |
| Wait between my turns, 5 bots | **6.5 s** | | |
| `game_state` messages per round, 3 / 5 bots | 21 / 33 | 21 | 139-226 KB (uncompressed) per round |
| Browser 4x: tap PLACE TILE -> tile on the board | **270-305 ms** | **334 ms** | of which: about 60-85 ms rendering the button's pending state before the answer is read, about 135-150 ms rendering the new state |
| Browser 4x: tap END TURN -> buy panel gone | 151-189 ms | 249 ms | |
| Browser 4x: per `game_state`: message -> settled | 31-38 ms median, 146-186 ms p90 | 40 / 145 ms | components rendered per state: median 322; 2 React commits per state |
| JS bundle (one chunk) | 458 KB (149 KB gzip), CSS 116 KB | 147 KB transferred | |
| First load, Fast 3G + 4x CPU (local, uncompressed) | 5.26 s | | |

**Where the time went.**

1. **Bot pacing: about 99 % of the wait between turns.** The driver slept a fixed
   `agent_action_delay` = 0.4 s after *every* agent action. A bot turn is about 3.3 actions
   (place, sometimes found or a merger answer, buy, end turn), so 1.3 s per bot: 4 s at a 3-bot
   table, 6.5 s with 5 bots. The bots' compute was 2-5 ms per turn. With LLM seats the same 0.4 s
   was added *after* every model call (Haiku about 4 s), on top of the think time.
2. **Twice the messages needed.** Before asking an agent, the driver broadcast the state with
   `awaiting` set to that agent ("thinking"). For a bot's flow decision that state is identical to
   the one just sent, so every bot move cost two full `game_state` messages to every player and
   the host (and two renders of the whole game page). A reconnect re-sent everyone's state.
3. **The network.** 106 ms per round trip from the sandbox to Railway `iad1` (the server itself
   answers in 2 ms). From a phone on a cellular network the round trip is typically larger.
4. **Rendering on a slow CPU.** Each state re-rendered the whole player page (about 320
   components, every one of the 108 board squares). The CPU profile and trace showed the
   main-thread time is mostly style, layout and paint (over 5 turns: 1.8 s style, 1.3 s layout,
   1.2 s paint, 2.1 s scripting), with forced synchronous layouts in a few places: the table
   panel's measuring effect ran on every DOM mutation in the panel (about 0.8 s per 5 turns,
   `getBoundingClientRect` after writing a CSS variable), the "show the top" scroll reset, the
   animation restarts (`void el.offsetWidth` on every placed tile and every changed number), and
   `toLocaleString` building a number formatter for each of the hundreds of amounts on screen
   (0.2 s). The board, the store and the ruleset object were all new on every message (so even
   memoised parts recomputed).
5. **Not a cause:** server compute (under 5 ms per action and per broadcast, 6 players, late
   game); payload size on the wire (about 2.5 KB deflated); the LLM seats' own server work
   (1.8 ms of synchronous prompt building per decision; providers are async; table-talk calls run
   as background tasks; the room lock is released while a model thinks, so humans keep acting).
   The UI already shows a "thinking" marker for the seat being waited on (66 ms after my END
   TURN in the browser probe, with a fake LLM seat delayed 4 s).

## What changed, and what each change did

| Change | Where | Effect (measured) |
|---|---|---|
| **Pacing condensed and overlapped.** The pause is a minimum gap between two agent moves, counted from the first one: 0.1 s between the moves of one seat's turn (`agent_step_delay`), 0.35 s when the game moves to another seat (`agent_action_delay`). An agent's think time counts toward the gap, so an LLM seat gets no extra pause | `seats.py`, `config.py` | Wait between my turns, 3 bots: **4.0 s -> 1.67 s** (protocol), **3.55 s -> 1.36 s** (browser A/B); 5 bots: **6.5 s -> 2.9 s**. A bot turn now reads as one quick sequence (about 0.55 s), each move still drawn in turn. LLM seats: about 0.4 s less per model call |
| **No identical state sent twice.** `broadcast_game_state` remembers the last state text per recipient and skips an identical one; a new socket (player or host) and the refresh route always get it | `broadcast.py`, `session/manager.py`, `api/rooms.py` | `game_state` per round: **21 -> 10** (3 bots), **33 -> 18** (5 bots); per 6 turns in the browser **115 -> 64**. Bytes per round 226 -> 80 KB uncompressed |
| **The placed tile shows at once** (optimistic). The tile I place is drawn on its square while the action is in flight (only then, only on an empty square); the next state draws it as it is (chain colour, merger), a refusal removes it | `PlayerPage.tsx` | Tap PLACE TILE -> tile on the board: **291-305 ms -> 65 ms** (4x CPU, local), and no longer depends on the network (was 334 ms deployed) |
| **One store update per state; unchanged parts keep their identity.** The `game_state` handler sets everything in one update (was up to three). Each part of the state (board, hotel, players, mergers, ruleset, hand, trades) that did not change keeps the previous object | `store/gameStore.ts` | React commits per state 2 -> 1. A bot buying shares no longer redraws the board; the ruleset context no longer changes on every message |
| **Board and squares memoised.** `Board` is `memo`; each square is `memo` with one stable click handler per square; the page passes a memoised playable set and handler and keys the board on the board alone; the page subscribes to the store fields it reads (a chat message does not re-render it) | `Board.tsx`, `Tile.tsx`, `PlayerPage.tsx` | Board squares rendered for a state that does not touch the board: 108 -> 0; for one placed tile: 108 -> 1-5. Components rendered per state: median 322 -> 186 |
| **Fewer forced layouts.** The table panel measures again only when its set of core parts changes (sizes come from the ResizeObserver), reads every size before writing, and writes a CSS variable only when its value changed; the scroll reset writes `scrollTop` only when the panel is scrolled; tile and number animations force a reflow only to restart one still running; one shared `Intl.NumberFormat` for amounts | `GameLayout.tsx`, `Tile.tsx`, `useChangeFlash.ts`, `lib/ruleset.ts` | Tap PLACE TILE: message -> tile shown 147 -> 85 ms before the optimistic change; longest task 248 -> 146 ms in the same run pair |
| **Code-split rarely used pages.** Host display, games list, transcript viewer, bench and series load on first visit | `App.tsx` | Game bundle **458 -> 401 KB** (149 -> 131 KB gzip), CSS 116 -> 84 KB; first load on Fast 3G + 4x CPU **5.26 -> 4.84 s** (local, uncompressed) |

Not changed, because the numbers do not support it: the calculator pack (already computed once
per broadcast, 0.4 ms; only the cheap private part is per player), diffs instead of full states
(about 2.5 KB per message after deflate; a diff protocol is not worth its risk), and the "thinking"
dots (they animate a pseudo-element's width in four steps; a trace showed no measurable cost).

## After

| What | Before | After |
|---|---|---|
| Wait between my turns, 3 bots (protocol, local) | 4.0 s | 1.67 s |
| Wait between my turns, 3 bots (browser A/B, 4x CPU) | 3.54-3.59 s | 1.32-1.40 s |
| Wait between my turns, 5 bots | 6.5 s | 2.9 s |
| `game_state` messages per 3-bot round | 21 | 10 |
| Tap PLACE TILE -> tile on the board (4x CPU) | 291-305 ms | 65 ms |
| Tap END TURN -> buy panel gone (4x CPU) | 164-189 ms | 144-170 ms (unchanged within noise) |
| Per state: message -> settled (4x CPU) | 33-38 ms median | 30-32 ms median |
| Components rendered per state | 201-322 median | 184-188 median |
| Game JS / CSS | 458 KB / 116 KB | 401 KB / 84 KB |
| Action round trip, server side | 2 ms | 2 ms |

Deployed (not redeployed by this work): expect the local gains plus the unchanged network round
trip (about 0.1 s from the sandbox, more from a phone on a cellular network) on the actions that
wait for the server.

## What remains, and recommendations

- **Network round trip.** About 106 ms from the sandbox to Railway `iad1`, the server's own
  time is 2 ms. Every action that waits for the server pays it (END TURN, merger answers, buys);
  PLACE TILE no longer does. If the owner plays from far away from US East, a Railway region
  closer to them is the largest remaining win for those actions (a Railway setting: not changed
  here).
- **`AGENT_ACTION_DELAY` on Railway.** If that variable is set on the service (it was the way to
  tune the old per-move pause), it now sets the pause between seats; 0.35 s is the new default
  and the variable can be removed. The pause inside one seat's turn is `AGENT_STEP_DELAY`
  (0.1 s).
- **LLM think time.** Haiku about 4 s per model call and about two calls per turn (the second
  buy question is already skipped, LO-012); Kimi longer. The page shows the seat thinking within a
  frame of the turn passing to it. Faster models or lower effort are the only lever; nothing on
  our side serialises other work behind a model call.
- **Rendering on slow phones.** What is left per state is mostly style and layout of the whole
  game page (a big view switch, e.g. place -> buy, costs about 100-150 ms at 4x CPU, about a
  quarter of that on a recent iPhone). Further gains need a lighter page (fewer elements, simpler
  selectors), which belongs with the layout work rather than the data flow.
- **First load.** HTML -> JS -> `/api/config/game` -> first render is a serial chain; on a slow
  network the config request could start with the HTML (a preload hint or inlining the ruleset).

## Guards (tests)

- `backend/tests/protocol/test_responsiveness.py`: no identical `game_state` twice in a row and at
  most one state per move over 8 turns with 3 bots; a second socket, the host and the refresh
  route still get the state; pacing overlaps a slow seat's think time (wall time under 80 % of
  think + pause in sequence); a bot turn's pacing is at most 0.6 s.
- `backend/tests/test_broadcast_budget.py`: a whole 6-player game, every broadcast (public state +
  six private parts + JSON) under 10 ms mean late in the game and 100 ms max (measured about
  0.5 ms), and under 40 KB uncompressed.
- `frontend/src/store/gameStore.sharing.test.ts`: one store update per `game_state`; unchanged
  parts keep their identity, changed ones do not.
- `frontend/src/components/game/Board.renders.test.tsx`: a state that leaves the board alone
  renders no square; one placed tile renders at most a handful.
