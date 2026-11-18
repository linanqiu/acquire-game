# Table talk about trades

Story: [LO-013](../roadmap/stories/09-llm-opponents/LO-013.md). Code: `backend/agents/llm/talk.py`
(talk prompt), `backend/agents/llm/deal_facts.py` (deal facts), `backend/agents/llm/prompt.py`
(trade events, offer line, buy-step follow-up), `backend/chat.py` (who is asked, `talk_view`).

Owner (2026-11-18), game UMWT: "The AI Haiku seems to be saying nonsensical things about trade."

## What went wrong in UMWT

Seat Hedge Hogg (Claude Haiku 5.5) against Linan (the owner):

| Chat | What Hedge said | Why |
|---|---|---|
| "How many chains have you formed" | "I've founded two chains so far, Halcyon and Juniper. Hedge's been unlucky..." | The talk prompt's event list is cut to the last few milestones, so the founding of sandpiper was not shown and juniper's founder was a guess. "Players may call you Hedge" plus "Hedge I feel like..." gave the third person. |
| "Propose me a trade if you want" | "I'll send it as an offer on my turn." It never did. | The talk rules said "say you will make or accept the trade offer on your turn, and then do it". Offers are answered the moment they arrive and can be sent only at the seat's own buy step; nothing reminded it at that step, and its buy-step prompt never named `propose_trade` (it ended the turn with $300: "the only legal move that makes sense"). |
| "If I give you SP you can get ahead of lil John" | "a SP trade would need to pay me for the minority I'd give up" | Direction reversed. Nothing computed what receiving (or giving) sandpiper would do; the model worked it out from prose. Hedge held 10 against lilJohn's 11 with 0 left in the bank: receiving 2 wins the majority. The message also showed as "to the table" because it named nobody. |
| Offer 3 SP for $5,000, then "No but that gives you majority" | "I'm keeping my marlowe majority and my sandpiper shares, so no." | The trade events rendered as a raw dict cut off before the money ("requesting_money: …"), so the talk call never saw what the offer was. |
| Accepting 2 SP for $2,000 | "sandpiper's yours to sell me at that price" | The offer line read "X offers you: A in exchange for: B", easy to garble; nothing asked the `say` to describe it from the seat's side. |

## What a seat is told now

Talk prompt (`TALK_INSTRUCTIONS`):

- How trades work: anyone may send an offer at any time, and an offer to the seat is put to it
  the moment it arrives (accept or reject then, not "on your turn"); the seat can send one only at
  its own buy step. To take up a deal: ask them to send it, or say it will send it at its next buy
  step, and then do it.
- Reading a proposal: "I give you X" means YOU RECEIVE X; "you give me Y" means YOU GIVE Y, with
  one worked example. Check "Deal facts" before answering, describe the deal the right way round;
  if the proposal is clear enough, say which version it would take.
- First person; never its own name. Only facts shown in the prompt; never guess about earlier
  play ("say you do not remember").
- A person writing to the seat always gets an answer; silence is for table messages and events.

Facts added, only when needed (cost):

- **Who did what this game** (every talk call in a game, about 5 lines): per player, chains
  founded (with names), mergers set off, trades done, current majorities and minorities. Built
  from the full event log, not the truncated list.
- **Deal facts** (only when the trigger is a message from another player that names a chain, by
  name or capital abbreviation such as "SP", or uses a deal word, or an offer between the two is
  open or was answered in the last few events). For each chain named (or, with no chain named,
  the chains where 1-3 shares between the two would change a bonus position; at most 3): holders
  and bank, then for 1, 2, 3 shares each way "Linan gives you 2 sandpiper: you 12, top rival
  lilJohnSummNothing 11; you go sole minority -> sole majority, your bonus +$1,500; value to you
  +$2,010". Moves that change nothing are one line. All numbers come from
  `game.trade_value.trade_valuation` on one-sided hypothetical trades; no rule is re-implemented.
  Open or just-answered offers: "you GIVE ..., you GET ..." with the position changes and the net
  value for both sides.
- The trigger line says "(to you, after your last message)" when the message names nobody but
  the seat's own message came right before it in reply to the same writer. The server routes such
  a message to that seat only (one-to-one exchange: everything said since the writer's previous
  message came from that seat); after a table conversation it goes to the table as before.

Decision prompt (`PROMPT_BUILDER_VERSION` 10 -> 11):

- Trade events are sentences: "Linan offered Hedge Hogg a trade: Linan gives 3 sandpiper, Hedge
  Hogg gives $5,000"; "Hedge Hogg rejected Linan's offer: ...".
- The offer to answer: "If you accept: you GIVE $5,000 (worth ...) and you GET 3 sandpiper (worth
  ...); you have $5,600 cash", then the position-aware numbers, then: describe the offer this way
  round in `say` and give the reason from these numbers.
- The buy step says it is the only time to propose a trade and when that is worth it.
- When there was deal talk since the seat's previous turn (its own messages or others' with an
  offer word), a "Deal talk since your last turn (follow up now)" block lists it: send the offer
  you promised now with `propose_trade`, or say you will not; "I give you X, you give me Y" puts
  X in `requesting_stocks` and Y in `offering_stocks`. No deal talk: no block, no extra tokens.

## Before and after (Claude Haiku 5.5, 3 samples each)

Method: the UMWT transcript (seed not recorded) was replayed through the engine with the tile
order recovered from the private deal and draw events; at each point the new builders rebuilt the
prompt from that state (board, chains and players blocks identical to the saved prompts). "Old" is
the prompt saved in the transcript, verbatim; "new" is the rebuilt one. Same request shape as the
live seat: talk at effort low, decisions at the seat's effort (medium) with the static schema.
Total spent on all runs while iterating: $0.147 (five rounds of 48 calls, two of 12).

| Point | | Old prompt | New prompt |
|---|---|---|---|
| 459 talk: How many chains have you formed | live: Hi Linan, I've founded two chains so far, Halcyon and Juniper. Hedge's been unlucky, but I'm still in it. | | |
| | sample 1 | Two so far, Linan: juniper and halcyon. Still plenty of game left. | I have formed two chains so far, sandpiper and halcyon. Halcyon is the one I lead. |
| | sample 2 | Hi Linan, I've formed four chains so far: sandpiper, marlowe, halcyon and juniper, and I'm still in the race. | I've formed two chains so far, sandpiper and halcyon. Linan, you've got the bigger empire, so I'm playing catch-up. |
| | sample 3 | Two chains so far, Linan: juniper and halcyon, plus I'm in on sandpiper and marlowe. Still plenty of game left. | I've founded two chains so far, sandpiper and halcyon. Linan, you've founded three, so you're ahead on that one. |
| 462 talk: Propose me a trade if you want | live: Linan, I'm open to a deal, but I'll send it as an offer on my turn. What do you want for some marlowe shares? | | |
| | sample 1 | Linan, I'm open to a deal, but I'm short on cash right now, so I'll send an offer once I've sorted my holdings. | Linan, I'm open to a deal, but you'll have to make the offer. I'll send one at my next buy step if you want to talk specifics. |
| | sample 2 | Linan, I'm open to a trade. Tell me what you want and I'll look at it. | Hi Linan, I'm open to a deal. I'd want sandpiper shares from you for marlowe-side cash or shares; send me a concrete offer and I'll answer it straight away. |
| | sample 3 | Linan, I'm open to a trade. Tell me what you're after and I'll send an offer on my turn. | Linan, I'm open to a deal. Send me a marlowe offer and we'll see what works for both of us. |
| 472 talk: SP? That’d give you back majority | live: Linan, sandpiper's bank is nearly empty and lilJohn is ahead there, so I'm not sure what you mean. Happy to talk trades on my turn. | | |
| | sample 1 | Linan, not sure yet. Sandpiper is a tight race with lilJohn, so I'll see what the board gives me. | Linan, if you give me 2 sandpiper I'd take that, since it puts me in the sandpiper majority. I'd want nothing else in return. Send the offer and I'll answer it right away. |
| | sample 2 | Linan, sandpiper's bank is empty and I'm only one share short of lilJohn there, so I'm not handing you anything. Marlowe shares are still open if you want to talk. | Linan, I'd take 2 sandpiper from you for nothing in return? No, I'd need cash back for that. Send me 2 sandpiper for $1,000 and I'll take it. |
| | sample 3 | Linan, not interested in a sandpiper-for-marlowe swap right now. Let's see what the board does. | Linan, I'd take 2 sandpiper from you for nothing in return, that flips the majority to me. Send it over, or tell me what you want back for 2. |
| 475 talk: If I give you SP you can get ahead of lil John | live: Linan, a SP trade would need to pay me for the minority I'd give up. Make me an offer and I'll look at it on my turn. | | |
| | sample 1 | Linan, a sandpiper deal needs more than talk. Send me a concrete offer on your turn and I'll look at it. | Linan, I'm not giving you a sandpiper for free. Send an offer and I'll weigh it: I want 2 sandpiper from you for something back. |
| | sample 2 | Linan, I'm listening. Send me a concrete offer and I'll look at it on the numbers, not the chat. | Linan, I'd want more than that. Giving you SP is a real favor, so if you send 2 SP for my 1 marlowe, I'll take it; otherwise I'll pass. |
| | sample 3 | Linan, a sandpiper giveaway only helps me if you're paying for it. What do you want for SP shares? | Linan, I'd take the 2-share version for sandpiper, but only if you also throw in some cash, since I'm at $300. Send the offer and I'll answer it right away. |
| 511 talk: I mean I give you SP, you give me MA | live: Linan, I'm listening. Send me the offer and I'll look at it on my turn. | | |
| | sample 1 | Linan, I'm listening, but I want more than marlowe for sandpiper. Send me a proper offer and I'll look at it on my turn. | Linan, I'd take the offer as you framed it if you add a bit more: 2 sandpiper for 2 marlowe from me? Send the exact trade and I'll look at it right away. |
| | sample 2 | Linan, a sandpiper-for-marlowe swap doesn't interest me as offered. Send a real trade offer on my turn and I'll weigh it. | Linan, I'm open to that, but I want more than one marlowe back for my sandpiper. Send me a real offer with 2 marlowe for 2 sandpiper and we can talk. |
| | sample 3 | Linan, I'm listening, but MA for SP is a lopsided ask from where I sit. Send a real offer and I'll look at it on my turn. | Linan, I'd take the marlowe-for-sandpiper swap only if you send it as an offer. Sandpiper 2 from you for marlowe 1 from me is the version I'd look at. |
| 733 trade (3 SP for $5,000) | live: Linan, that's too much cash for three shares. No deal. [reject_trade] | | |
| | sample 1 | [reject_trade] Nice try, Linan. Five grand for shares worth nine hundred isn't happening. | [reject_trade] Linan, $5,000 for three sandpiper is too much for me. Pass. |
| | sample 2 | [reject_trade] (silent) | [reject_trade] Linan, $5,000 for three sandpiper is too much. Not this one. |
| | sample 3 | [reject_trade] Linan, $5,000 for three sandpiper is too steep for me. Pass. | [reject_trade] Linan, $5,000 for shares worth $900 is a no. Try again with a real price. |
| 740 talk: No but that gives you majority | live: Linan, I'm keeping my marlowe majority and my sandpiper shares, so no. Make a real offer on my turn if you want to talk numbers. | | |
| | sample 1 | Linan, three sandpiper shares for $0 is not a majority for you, and I'm not paying cash for it. Send a real offer if you want to talk marlowe. | Linan, I'd take 2 sandpiper for $1,500 from you... no, that's still not a deal I'll chase. Send a real offer if you want to trade, and I'll answer it straight away. |
| | sample 2 | Linan, I'm not selling you a majority for three sandpiper shares. Make a real offer and I'll look at it. | Linan, I'd want more than a sandpiper for giving up my minority: the deal only helps you while lilJohn still holds the majority. Send me a real offer and I'll look at it. |
| | sample 3 | Linan, three sandpiper shares for $0 isn't a majority deal I'm interested in. Make me a real offer on my turn if you want to talk. | Linan, I'm not giving up $5,000 for three sandpiper shares, even if it flips the majority. If you want to deal, offer me a sandpiper share for a marlowe share and we can talk. |
| 743 trade (2 SP for $2,000) | live: Fine, Linan, sandpiper's yours to sell me at that price. [accept_trade] | | |
| | sample 1 | [accept_trade] Deal, Linan. Sandpiper's mine now. | [reject_trade] Linan, $2,000 for two sandpiper helps you more than me. No deal. |
| | sample 2 | [reject_trade] Linan, $2,000 for two sandpiper is too rich for me. No deal. | [reject_trade] Linan, $2,000 for two sandpiper is too rich for me. No deal. |
| | sample 3 | [accept_trade] Deal, Linan. | [accept_trade] Linan, that's $2,000 for two sandpiper, so I'll take it. Sandpiper majority is worth more to me than the cash. |
| 491 buy step after chat #7-#12 | live: [end_turn] | | |
| | sample 1 | [end_turn] (silent) | [end_turn] Linan, no offer from me this turn. I can't afford anything anyway. |
| | sample 2 | [end_turn] (silent) | [buy_stocks] Linan, I'm too short on cash for a deal this turn, so no offer from me. |
| | sample 3 | [end_turn] (silent) | [propose: give sandpiper: 2  for marlowe: 2 ] Linan, I'll send you an offer: 2 sandpiper for 2 marlowe. Marlowe is worth more to me than the sandpiper I'm giving up. |
| 532 buy step after chat #13 (SP for MA) | live: [end_turn] | | |
| | sample 1 | [end_turn] (silent) | [propose: give marlowe: 2  for sandpiper: 2 ] Linan, I'll take your sandpiper for two marlowe, 2 for 2. Fair deal for both of us. |
| | sample 2 | [end_turn] (silent) | [end_turn] (silent) |
| | sample 3 | [end_turn] (silent) | [end_turn] Linan, the SP-for-MA swap doesn't pay me enough, so I'm passing for now. |

Reading the table:

- History: old prompts say juniper (founded by Lady Ledger) 3/3, one claims four chains; new
  prompts say sandpiper and halcyon 3/3, first person.
- "On my turn": 6 of the 15 old answers to deal talk (462-740) put the deal off to a turn ("on my
  turn", once "on your turn"); none of the 15 new ones do.
- Direction (472, 475, 511): old answers treat receiving sandpiper as giving it up; new answers
  mostly read it right ("2 sandpiper from you ... flips the majority to me", "Sandpiper 2 from you
  for marlowe 1 from me"). Haiku still garbles some ("I'd take 2 sandpiper from you for nothing in
  return? No...", 475 sample 1 reverses it again).
- 740: old answers talk about a marlowe majority the offer never asked for; new answers name the
  offer ($5,000 for three sandpiper); one suggests a share-for-share swap instead, one is garbled.
- Promises: at its next buy step (491) the old prompt ends the turn 3/3 with no word; the new one
  sends an offer or says it will not, 3/3. After "I give you SP, you give me MA" (532) the new
  prompt sent the right swap (receive 2 sandpiper, give 2 marlowe) once in 3; an earlier wording
  of the block, without the direction rule, sent it reversed.

Known limits: the decision prompt has no "Deal facts" block (it would need the game in the
decision context, built by the calculator pack another change is optimising); the buy step relies
on the chain lines ("+N to take majority") instead. Haiku's answers vary a lot between samples;
the facts make the right answer available but do not guarantee it.

## Cost

Talk prompts grow by about 1,700 characters (about 420 tokens: longer rules, "Who did what");
"Deal facts" adds 400-1,500 characters only on deal talk. At Haiku prices ($0.10 per million
uncached input tokens) that is about $0.00004 per talk call, and a game has a handful of talk
calls (LO-011 gates them). The system prompt is unchanged, so its cache keeps hitting. The
decision prompt grows only at a buy step that follows deal talk, and in offer lines (a few words).
