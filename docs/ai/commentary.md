# Commentary: a voice for the watch page

Story: [LO-014](../roadmap/stories/09-llm-opponents/LO-014.md). Code: `backend/commentary.py`
(when it speaks, caps, delivery), `backend/agents/llm/commentary.py` (prompt, facts, rules-only
lines, checks on the answer), `frontend/src/components/game/Commentary.tsx` (the strip).
Contract: [seat-contract.md, "Commentary"](../architecture/seat-contract.md).

Owner (2026-11-21), on "let the AIs play each other live, with commentary": "Commentary is a
good idea."

The commentator is a non-playing voice on the host / watch page. It is **not a seat**: it never
goes through `apply_action`, never changes the game, and sees only public information (the
public event log and the calculator's public views; no hand, no private event, no seat's notes).

## When it speaks

Decided by rules, never by asking a model. After every applied action `commentary.on_action`
turns the action's public events, and what they changed, into **moments**:

| Moment | From | Line by itself? |
|---|---|---|
| `chain_founded` | `chain_founded` event | yes; a chain founded *again* only when another player kept its shares |
| `merger` | each `bonuses_paid` of a merger (one per acquired chain): who set it off, who collected what, how many mergers that player has set off and what they collected from them | yes |
| `merger_done` | `merger_completed`: the survivor's size, what each holder did with the defunct shares | no (context only) |
| `majority` | the holders the engine would pay the majority bonus changed (`public_chain_holders`), after a purchase, a trade or a merger's share exchange | only when the top holding is 5+ shares, the majority bonus is $3,000+, at most once per chain in 6 turns and once in 4 turns overall |
| `minority` | second place changed | no |
| `trade_accepted` / `trade_rejected` | the trade events, with both sides of the deal | yes |
| `chain_safe` | a chain reached the safe size | yes |
| `lead` | a new sole leader in net worth (`public_net_worth`), after the first round | when nobody led before, or the previous leader had held it 4+ turns |
| `end_available` | the end-of-game condition became true | yes, once |
| `game_ended` | the final result (who declared, final cash, winner and margin) | always, at once |
| `quiet` | 8 turns (`commentary_quiet_turns`) without a line: where things stand (leader and margin, tiles in the bag, the closest majority race) | yes |

Not moments: placing a tile, an ordinary purchase, ending a turn, trade proposals and
cancellations, anything during a merger's share disposal (the defunct chain's holders are
selling out; the survivor is compared once, when the merger is settled).

Moments wait in a batch. A line is made from the batch **at most once every
`commentary_min_gap_s` (8 s)**, and only when the batch holds a moment worth a line by itself.
The line gets the most important moment and at most one other of some weight; moments older than
6 turns are dropped; the wording of a moment is rebuilt from the table as it is when the line is
made (a lead that was lost again meanwhile is not told). At most
`commentary_max_lines_per_game` (80) lines per game; the final result is always said.

## What it says

One line: one sentence, a second only when a fact supports it; at most 220 characters (the
prompt asks for 170). The register is a dry sports commentator who knows the game: what
happened, why it matters for the money, what to watch next; players and chains by name, the
numbers as given; no hype words, no exclamation marks, no emoji, no catchphrases, no talking to
the players or the audience.

One model call per line (`provider.complete`, schema `{"line": string}`):

- **System prompt** (`build_system_prompt`, about 1,800 tokens, identical for every call of a
  game, so the provider's prompt cache applies): the game in brief (bonuses, ties, safe size,
  end conditions, what net worth leaves out), what the request holds, the rules of the register,
  three placeholder examples.
- **User prompt** (`build_user_prompt`): the moments (most important first, each a sentence of
  computed facts), **Table now** (turn, tiles in the bag, whether the game may be ended, players
  by net worth with cash and share value, every chain with size, price, bank, holders and the
  bonuses "if acquired now" or, for a safe chain, "paid at the end of the game"), **The game so
  far** (per player: chains founded, mergers set off and what they paid that player, bonuses
  collected in all, trades done), and **its own latest lines** (`commentary_memory_lines`, 6) so
  it does not repeat itself and can make a callback ("the third merger Polly has set off").

Every fact is computed by the engine (`game.calculator`); the prompt forbids stating anything
that is not in the request, doing arithmetic, giving reasons the request does not give, and
guessing at plans or hands.

### Checks on the answer

A line is shown only if it passes; otherwise the rules line for the same moments is shown and
the refused answer stays in the transcript with the reason:

| Check | Why |
|---|---|
| every amount of money in the line is written in the prompt (`unsupported_amounts`) | a made-up or self-computed number is the failure the owner cares about most |
| no exclamation mark, emoji or hype word (`style_problems`) | the register |
| not one of its latest lines again, and no 10 consecutive words in common with one (`repeats`) | "never repeats itself", enforced |
| longer than 220 characters: only the leading sentences that fit are kept | readable on the strip |

### Rules-only lines

Templated sentences from the same facts (`rules_line`): "Rosie Returns merges Marlowe into
Obsidian; the bonuses: Rosie Returns $5,000 and Nina Nest-Egg $2,500." They are used when no
model is configured, when a cap is reached, when a call fails or its answer is refused, and in
tests. Zero cost; the strip marks them "rules" (a model's line: "model").

## Cost control

- Nothing happens unless commentary is **on for the room** and a **spectator is connected**
  (the host/watch WebSocket). No spectator: no moments are collected and no model is called; a
  spectator who leaves stops it at once.
- Off by default in ordinary rooms; on in rooms opened to watch ("Watch bots play",
  `POST /create-show`; "Choose the players of a new game", `/create-spectator?commentary=1`).
  The watch page has the switch (OFF in the strip, TURN ON in the Log tab):
  `POST /room/{code}/commentary {"enabled": bool}`.
- One small call per line: cached system prompt, low effort (`commentary_effort`), output cap
  `commentary_max_tokens` (2,048, thinking included; a line is about 70 output tokens).
- Per game: at most `commentary_max_calls_per_game` (60) calls and `commentary_max_spend_usd`
  ($0.05); after either, and after 3 failed calls in a row, the game goes on rules-only.
- The model: `GAME_COMMENTARY_MODEL`, a catalog id or model name; `rules` (or `off`) for no
  model at all. **Unset: the catalog's Haiku entry when it has a key, else rules-only.** No other
  catalog model (Kimi K3) ever narrates unless it is named there.
- Never in the way of the game: `on_action` only reads and schedules; the call runs in a
  background task that holds no lock. A finished game's transcript is closed once the final line
  is in it (at most `commentary_timeout_s` + 5 s later).

### Measured (Claude Haiku 5.5, 2026-11-21)

Full shows of four rules-based bots through the real server at the production pace
(`broadcast_action_delay` 1.2 s, `broadcast_step_delay` 0.7 s, gap 8 s). Prices from
`backend/bench/prices.json`.

| Game (seed) | Turns | Lines | Model calls | Refused, rules line shown | Uncached input | Cache read | Cache write | Output | Cost |
|---|---|---|---|---|---|---|---|---|---|
| 11 | 81 | 24 | 24 | 0 | 36,493 | 42,458 | 1,846 | 5,201 | $0.0069 |
| 23 | 68 | 27 | 27 | 3 (each repeated an earlier line) | 44,212 | 47,996 | 1,846 | 2,725 | $0.0065 |
| 41 | 84 | 23 | 23 | 0 | 34,576 | 42,458 | 0 | 2,728 | $0.0052 |

Per call: about 1,550 uncached input tokens (the table and the game so far), 1,846 cached (the
system prompt; written once, read from then on), 70 to 220 output tokens (a line is about 70;
the rest is thinking), about 1 s. About $0.00025 a line.

Sample lines (game 41, in order; every one from the model):

- "Clem Coupon takes the Obsidian majority with 5 shares to Vera Venture's 4 and Lady Ledger's 4,
  worth $4,000 to Clem if acquired now."
- "Lady Ledger's 10D merger folds Marlowe into Sandpiper, and Clem Coupon collects $3,000 for the
  majority, taking the net-worth lead at $11,100 over Vera Venture's $8,900."
- "Sandpiper has grown to 12 tiles and is now safe, so it can never be acquired. Vera Venture's 8
  shares stand to collect $7,000 at game's end."
- "Clem Coupon leads on net worth at $12,800, $1,700 ahead of Vera Venture, with 34 tiles left in
  the bag. Obsidian is the closest majority race, Lady Ledger and Clem Coupon tied at 5 shares
  each."
- "Clem Coupon's 7I runs Aurelia into safe Marlowe, paying Gus Gross and Clem $3,800 each on a
  tied majority. Clem has set off 2 of 3 mergers, collecting $7,800."
- "Sandpiper reaches 41 tiles, so Vera Venture may now end the game, though nobody has to. Vera
  holds the Sandpiper majority at 9 shares, worth $10,000 at the end."
- "Clem Coupon ends the game on turn 84 and wins with $38,700, $800 clear of Gus Gross at
  $37,900. Vera Venture finishes third on $24,800."

A show costs a little over half a cent of commentary. One show an hour for a year is about
$55. In all, the eight rounds of sample games (19 games or parts of games) cost $0.10.

## The show ("Watch bots play")

`POST /create-show` seats the AI players of `show_seats` (default four rules-based bots, which
cost nothing; a seat that is not available becomes a bot), turns commentary on and starts the
game **when the first spectator connects**, so nobody misses the opening and nothing is played
for an empty room. A game with no human seat that someone is watching is played at the
**broadcast pace** (1.2 s after a move that passes the game on, 0.7 s between a seat's own
moves; `pace: "fast"` on the commentary route turns that off for a room): about three seconds a
turn, four to five minutes a game, a line every third turn at most. At the end the
commentator's last line (the result) stands over the final standings, with WATCH ANOTHER.

## What went wrong on the way, and the fix

Real games read line by line, eight rounds (19 games or parts of games):

| Seen | Fix |
|---|---|
| "Quiet stretch of eight turns ...", then "Nine quiet turns ..." three turns later | the quiet moment no longer says how long; a rule against saying the game is quiet; the turn of the last batch is remembered when the call starts, not when it returns |
| Lines of 230 characters stringing three topics with "while" and "and" | one moment to tell plus at most one other; "sentence one ..., a second only when the request holds a fact for it"; longer answers cut to their leading sentences |
| "his seventh chain on the board" (from "chain number 7 on the board") | the fact now lists the chains on the board by name with "N of 7" |
| "Commodore Coin's second merger brings $5,000 in bonuses" (it was the total from both) | "has now set off 2 of the 9 mergers of this game, and collected $5,000 from those 2 together" |
| "the third merger of the game" for the third merger that player set off | same fact |
| "split the $6,000 majority bonus" when each tied holder gets $6,000 | tied holders are named together: "A and B $6,000 each (tied for the majority; this is each one's part of both bonuses)" |
| "makes Meridian safe" when it already was; "no longer safe, not yet" | the merger fact says "(26 tiles, safe)" or "(9 tiles, not yet safe)" |
| "Halcyon tiles now sit with one player" about a chain founded again | chains founded again say so, and who kept shares from before; a plain re-founding is no line |
| "with the lead coming from Meridian and Obsidian stakes"; "worth more than Prof's cash and stock combined" | no reasons unless the request gives one; no comparisons or arithmetic of its own |
| "paying him $3,000", "her fourth merger", "its two mergers" | never he / she / it for a player: the name, or "they" |
| The same sentence shape for every founding and every majority ("X takes the Y majority with N shares to Z's M, a buyout now would pay ...") | majority moments are rare now (see the table above); "vary the shape", with the phrase named; 10 words in common with a latest line is a refused answer |
| A call cut off at the output cap (`stop_reason=max_tokens`, 1,024 with thinking) | cap 2,048; the rules line covered it |
| Medium effort (one round): twice the cost, 4 s per line, and more "insight" of its own | stays at low |

Still seen after the last round: a word the facts do not carry now and then
("lifting the if-acquired majority bonus to $4,000": the facts give the amount, not a direction),
a clumsy sentence ("Gus Gross and Bertie Buyout count again from earlier holdings" for their
kept shares counting again), "will split $6,000 each" for two holders who get $6,000 each, and a
favourite verb ("folds ... into") that comes back more often than the rule against it allows.
Amounts of money cannot be wrong (they are checked against the prompt); other words can.

## Tests

- Tier 1 `backend/tests/test_commentary.py`: which events are moments in a whole game played by
  the rules-based seat, the majority rule, trades, private events ignored, the prompt free of
  every tile in a hand at every point of a game, the facts against the calculator, the checks on
  the answer, the rules line, which model narrates.
- Tier 2 `backend/tests/protocol/test_commentary.py` (real server, fake model): the show starts
  with its first spectator; lines reach the host socket and come back as history; players get
  none; no line and no call in an ordinary room, when off, or without a spectator; the gap, the
  line cap, the call cap and the spend cap; the prompt, effort and output cap of a call; tokens
  and cost in the transcript; failed calls and refused answers; a slow model never delays the
  game; the broadcast pace.
- Tier 3 `frontend/tests/e2e/screens/commentary.spec.ts`; tier 4
  `journeys/spectator-host-view.spec.ts` (from "Watch bots play").
