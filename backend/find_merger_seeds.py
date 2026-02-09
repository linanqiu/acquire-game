#!/usr/bin/env python3
"""
Scan Acquire game seeds 1-200 to find seeds that produce specific merger types:
1. Tie-breaker merger (two chains of equal size)
2. 3-way merger (three chains merge simultaneously)
3. Merger creates a safe chain (11+ tiles combined)
4. Human player (p0) holds 3+ shares in defunct chain
5. Human player triggers the merger (places the connecting tile)
"""

import sys
import random

sys.path.insert(0, "/home/user/acquire-game/backend")

from game.game import Game, GamePhase
from game.rules import Rules
from game.bot import Bot


class MergerEvent:
    def __init__(self):
        self.seed = 0
        self.turn_number = 0
        self.triggering_player = ""
        self.triggering_player_id = ""
        self.result_type = ""
        self.chains_involved = []
        self.chain_sizes = {}
        self.is_tie = False
        self.is_3way = False
        self.combined_size = 0
        self.creates_safe_chain = False
        self.human_triggers = False
        self.human_stock_in_defunct = {}
        self.human_has_significant_stock = False
        self.survivor = ""
        self.defunct_chains = []

    def __repr__(self):
        flags = []
        if self.is_tie:
            flags.append("TIE")
        if self.is_3way:
            flags.append("3-WAY")
        if self.creates_safe_chain:
            flags.append("SAFE")
        if self.human_triggers:
            flags.append("HUMAN-TRIGGERS")
        if self.human_has_significant_stock:
            flags.append(f"HUMAN-STOCK({self.human_stock_in_defunct})")
        flag_str = " [" + ", ".join(flags) + "]" if flags else ""
        sizes_str = ", ".join(f"{c}={s}" for c, s in self.chain_sizes.items())
        return (
            f"  Seed {self.seed:3d} | Turn {self.turn_number:2d} | "
            f"{self.triggering_player:6s} | "
            f"Chains: {sizes_str} | Combined: {self.combined_size}{flag_str}"
        )


def _get_human_stocks_in_chains(game, chains):
    """Get human player's stock counts in the given chains."""
    human = game.get_player("p0")
    result = {}
    has_significant = False
    for c in chains:
        count = human.get_stock_count(c)
        if count > 0:
            result[c] = count
        if count >= 3:
            has_significant = True
    return result, has_significant


def _build_event(
    seed_value,
    turn_number,
    player_id,
    player_name,
    result_type,
    chains_involved,
    chain_sizes,
    game,
    survivor="",
    defunct_chains=None,
    is_tie=False,
):
    """Build a MergerEvent."""
    if defunct_chains is None:
        defunct_chains = []

    event = MergerEvent()
    event.seed = seed_value
    event.turn_number = turn_number
    event.triggering_player_id = player_id
    event.triggering_player = player_name
    event.result_type = result_type
    event.chains_involved = chains_involved
    event.chain_sizes = chain_sizes
    event.survivor = survivor
    event.defunct_chains = defunct_chains
    event.is_tie = is_tie
    event.is_3way = len(chains_involved) >= 3
    event.combined_size = sum(chain_sizes.values()) + 1  # +1 for connecting tile
    event.creates_safe_chain = event.combined_size >= 11
    event.human_triggers = player_id == "p0"

    # Check human stock in defunct chains (or all chains for ties)
    check_chains = defunct_chains if defunct_chains else chains_involved
    event.human_stock_in_defunct, event.human_has_significant_stock = (
        _get_human_stocks_in_chains(game, check_chains)
    )

    return event


def _resolve_dispositions(game, bots_map):
    """Resolve all stock dispositions during a merger."""
    for _ in range(100):
        if game.phase != GamePhase.MERGING:
            break
        if not game.pending_action:
            break
        if game.pending_action.get("type") != "stock_disposition":
            break

        pid = game.pending_action.get("player_id")
        defunct = game.pending_action.get("defunct_chain")
        survivor = game.pending_action.get("surviving_chain")
        count = game.pending_action.get("stock_count", 0)

        if pid in bots_map:
            decision = bots_map[pid].choose_stock_disposition(
                defunct, survivor, count, game.board, game.hotel
            )
            game.handle_stock_disposition(
                pid, decision["sell"], decision["trade"], decision["keep"]
            )
        elif pid == "p0":
            # Human keeps all (for simulation purposes)
            game.handle_stock_disposition(pid, sell=0, trade=0, keep=count)
        else:
            break


def _choose_stocks_to_buy(game, player_id):
    """Choose stocks for human to buy - prioritize diversity across active chains."""
    player = game.get_player(player_id)
    active_chains = game.hotel.get_active_chains()
    if not active_chains:
        return []

    purchases = []
    for chain_name in active_chains:
        if len(purchases) >= 3:
            break
        size = game.board.get_chain_size(chain_name)
        price = game.hotel.get_stock_price(chain_name, size)
        if price <= player.money and game.hotel.get_available_stocks(chain_name) > 0:
            purchases.append(chain_name)

    # If we have room, buy more of the same chains (prefer smaller/cheaper ones)
    while len(purchases) < 3:
        bought_any = False
        for chain_name in active_chains:
            if len(purchases) >= 3:
                break
            size = game.board.get_chain_size(chain_name)
            price = game.hotel.get_stock_price(chain_name, size)
            total_cost = (
                sum(
                    game.hotel.get_stock_price(c, game.board.get_chain_size(c))
                    for c in purchases
                )
                + price
            )
            if (
                total_cost <= player.money
                and game.hotel.get_available_stocks(chain_name) > 0
            ):
                purchases.append(chain_name)
                bought_any = True
        if not bought_any:
            break

    # Verify total cost
    total_cost = sum(
        game.hotel.get_stock_price(c, game.board.get_chain_size(c)) for c in purchases
    )
    if total_cost > player.money:
        # Back off to what we can afford
        while purchases and total_cost > player.money:
            purchases.pop()
            total_cost = sum(
                game.hotel.get_stock_price(c, game.board.get_chain_size(c))
                for c in purchases
            )

    return purchases


def simulate_seed(seed_value, max_turns=40):
    """Simulate a game with the given seed and return merger events found."""
    merger_events = []

    game = Game()
    game.add_player("p0", "Human")
    game.add_player("p1", "Bot1")
    game.add_player("p2", "Bot2")

    random.seed(seed_value)
    game.start_game()

    bot1 = Bot(game.get_player("p1"), "easy", rng=random.Random(seed_value + 1000))
    bot2 = Bot(game.get_player("p2"), "easy", rng=random.Random(seed_value + 2000))
    game.bots["p1"] = bot1
    game.bots["p2"] = bot2
    bots_map = {"p1": bot1, "p2": bot2}

    turn_count = 0

    for turn in range(max_turns):
        if game.phase == GamePhase.GAME_OVER:
            break
        if game.phase != GamePhase.PLAYING:
            break

        current_pid = game.get_current_player_id()
        current_player = game.get_current_player()
        turn_count += 1

        if current_pid in ("p1", "p2"):
            # Bot turn
            try:
                actions = game.execute_bot_turn(current_pid)
                for action in actions:
                    if action.get("action") == "play_tile":
                        rt = action.get("result_type", "")
                        if rt in ("merge", "merge_tie"):
                            # Build chain info from the action
                            survivor = action.get("survivor", "")
                            defunct = action.get("defunct", []) or []
                            tied = action.get("tied_chains", []) or []

                            if rt == "merge_tie":
                                chains = tied
                                chain_sizes = {
                                    c: game.board.get_chain_size(c) for c in chains
                                }
                                event = _build_event(
                                    seed_value,
                                    turn_count,
                                    current_pid,
                                    current_player.name,
                                    rt,
                                    chains,
                                    chain_sizes,
                                    game,
                                    is_tie=True,
                                )
                            else:
                                chains = [survivor] + defunct if survivor else defunct
                                chain_sizes = {
                                    c: game.board.get_chain_size(c) for c in chains
                                }
                                event = _build_event(
                                    seed_value,
                                    turn_count,
                                    current_pid,
                                    current_player.name,
                                    rt,
                                    chains,
                                    chain_sizes,
                                    game,
                                    survivor=survivor,
                                    defunct_chains=defunct,
                                )
                            merger_events.append(event)
            except Exception:
                break

            # Handle any remaining dispositions needing human
            if game.phase == GamePhase.MERGING:
                _resolve_dispositions(game, bots_map)

        else:
            # Human turn (p0)
            player = game.get_player("p0")
            playable = Rules.get_playable_tiles(game.board, player.hand, game.hotel)

            if not playable:
                game.phase = GamePhase.BUYING_STOCKS
            else:
                tile_to_play = playable[0]
                result = game.play_tile("p0", tile_to_play)

                if not result.success:
                    break

                if result.result_type in ("merge", "merge_tie"):
                    if result.result_type == "merge_tie":
                        chains = result.tied_chains or []
                        chain_sizes = {c: game.board.get_chain_size(c) for c in chains}
                        event = _build_event(
                            seed_value,
                            turn_count,
                            "p0",
                            "Human",
                            result.result_type,
                            chains,
                            chain_sizes,
                            game,
                            is_tie=True,
                        )
                    else:
                        survivor = result.survivor or ""
                        defunct = result.defunct or []
                        chains = [survivor] + defunct if survivor else defunct
                        chain_sizes = {c: game.board.get_chain_size(c) for c in chains}
                        event = _build_event(
                            seed_value,
                            turn_count,
                            "p0",
                            "Human",
                            result.result_type,
                            chains,
                            chain_sizes,
                            game,
                            survivor=survivor,
                            defunct_chains=defunct,
                        )
                    merger_events.append(event)

                # Handle founding
                if game.phase == GamePhase.FOUNDING_CHAIN:
                    available = game.pending_action.get("available_chains", [])
                    if available:
                        game.found_chain("p0", available[0])

                # Handle merger survivor choice
                if game.phase == GamePhase.MERGING:
                    if (
                        game.pending_action
                        and game.pending_action.get("type") == "choose_survivor"
                    ):
                        tied = game.pending_action.get("tied_chains", [])
                        if tied:
                            game.choose_merger_survivor("p0", tied[0])

                # Handle stock dispositions
                if game.phase == GamePhase.MERGING:
                    _resolve_dispositions(game, bots_map)

            # Buy stocks - human buys aggressively
            if game.phase == GamePhase.BUYING_STOCKS:
                purchases = _choose_stocks_to_buy(game, "p0")
                game.buy_stocks("p0", purchases)
                game.end_turn("p0")

    return merger_events


def main():
    print("=" * 100)
    print("ACQUIRE GAME MERGER SEED SCANNER (v2 - with human stock buying)")
    print("Scanning seeds 1-200, up to 40 turns each, 3 players (1 human + 2 bots)")
    print("=" * 100)

    all_events = []
    seeds_with_mergers = set()
    error_seeds = []

    for seed in range(1, 201):
        try:
            events = simulate_seed(seed, max_turns=40)
            if events:
                seeds_with_mergers.add(seed)
                all_events.extend(events)
        except Exception as e:
            error_seeds.append((seed, str(e)))

    # Print all merger events
    print(f"\nTotal merger events found: {len(all_events)}")
    print(f"Seeds with mergers: {len(seeds_with_mergers)} out of 200")
    if error_seeds:
        print(f"Seeds with errors: {len(error_seeds)}")
        for s, e in error_seeds[:10]:
            print(f"  Seed {s}: {e}")
    print()

    # Categorize
    tie_events = [e for e in all_events if e.is_tie]
    three_way_events = [e for e in all_events if e.is_3way]
    safe_events = [e for e in all_events if e.creates_safe_chain]
    human_stock_events = [e for e in all_events if e.human_has_significant_stock]
    human_trigger_events = [e for e in all_events if e.human_triggers]
    bot_trigger_events = [e for e in all_events if not e.human_triggers]

    # Combined categories
    human_trigger_stock = [
        e for e in all_events if e.human_triggers and e.human_has_significant_stock
    ]
    human_trigger_tie = [e for e in all_events if e.human_triggers and e.is_tie]
    human_trigger_safe = [
        e for e in all_events if e.human_triggers and e.creates_safe_chain
    ]

    # Print by category
    categories = [
        ("TIE-BREAKER MERGERS (equal size chains)", tie_events),
        ("3-WAY MERGERS (3+ chains merge)", three_way_events),
        ("MERGERS CREATING SAFE CHAINS (11+ tiles)", safe_events),
        ("HUMAN HOLDS 3+ STOCK IN DEFUNCT CHAIN", human_stock_events),
        ("HUMAN TRIGGERS THE MERGER", human_trigger_events),
        ("BOT TRIGGERS THE MERGER", bot_trigger_events),
        ("HUMAN TRIGGERS + HAS SIGNIFICANT STOCK", human_trigger_stock),
        ("HUMAN TRIGGERS TIE-BREAKER", human_trigger_tie),
        ("HUMAN TRIGGERS SAFE CHAIN MERGER", human_trigger_safe),
    ]

    for cat_name, events in categories:
        print("=" * 100)
        print(f"CATEGORY: {cat_name}")
        print("=" * 100)
        if events:
            for e in events:
                print(e)
        else:
            print("  None found")
        print()

    # Summary: best seeds for each scenario
    def _best_seeds(events, limit=5):
        seen = set()
        result = []
        for e in events:
            if e.seed not in seen:
                seen.add(e.seed)
                result.append(e)
            if len(result) >= limit:
                break
        return result

    print("=" * 100)
    print("BEST SEEDS SUMMARY")
    print("=" * 100)

    summaries = [
        (
            "1. TIE-BREAKER MERGER (equal size chains requiring survivor choice)",
            tie_events,
        ),
        ("2. 3-WAY MERGER (three chains merge simultaneously)", three_way_events),
        ("3. MERGER CREATING SAFE CHAIN (11+ combined tiles)", safe_events),
        ("4. HUMAN HAS 3+ STOCK IN DEFUNCT CHAIN", human_stock_events),
        ("5. HUMAN TRIGGERS MERGER", human_trigger_events),
        (
            "6. HUMAN TRIGGERS + SIGNIFICANT STOCK (best for disposition testing)",
            human_trigger_stock,
        ),
        ("7. HUMAN TRIGGERS TIE-BREAKER", human_trigger_tie),
    ]

    for title, events in summaries:
        print(f"\n{title}:")
        best = _best_seeds(events)
        if best:
            for e in best:
                extra = ""
                if e.human_stock_in_defunct:
                    extra += f", human stocks: {e.human_stock_in_defunct}"
                if e.creates_safe_chain:
                    extra += f", combined: {e.combined_size}"
                print(
                    f"   Seed {e.seed:3d}, Turn {e.turn_number:2d}: "
                    f"{e.triggering_player} triggers, "
                    f"chains {dict(e.chain_sizes)}{extra}"
                )
        else:
            print("   No seeds found")

    # Statistics
    print()
    print("=" * 100)
    print("STATISTICS")
    print("=" * 100)
    print("Total seeds scanned:          200")
    print(f"Seeds producing mergers:      {len(seeds_with_mergers)}")
    print(f"Total merger events:          {len(all_events)}")
    print(f"Tie-breaker mergers:          {len(tie_events)}")
    print(f"3-way mergers:                {len(three_way_events)}")
    print(f"Safe chain mergers:           {len(safe_events)}")
    print(f"Human significant stock:      {len(human_stock_events)}")
    print(f"Human-triggered mergers:      {len(human_trigger_events)}")
    print(f"Bot-triggered mergers:        {len(bot_trigger_events)}")
    print(f"Human trigger + stock:        {len(human_trigger_stock)}")
    print(f"Human trigger + tie:          {len(human_trigger_tie)}")
    print(f"Error seeds:                  {len(error_seeds)}")

    # Detailed analysis for stock scenario - check what human typically holds
    print()
    print("=" * 100)
    print("DETAILED: HUMAN STOCK AT TIME OF MERGER (all events with any human stock)")
    print("=" * 100)
    any_stock_events = [e for e in all_events if e.human_stock_in_defunct]
    if any_stock_events:
        for e in any_stock_events:
            print(e)
    else:
        print("  Human had zero stock in defunct chains for ALL merger events.")
        print(
            "  This might indicate the human isn't buying enough stock in chains that later merge."
        )
        print()
        # Show what stocks human has at each merger for debugging
        print("  Checking a few seeds in detail...")
        for seed in [3, 5, 67, 82]:
            game = Game()
            game.add_player("p0", "Human")
            game.add_player("p1", "Bot1")
            game.add_player("p2", "Bot2")
            random.seed(seed)
            game.start_game()
            bot1 = Bot(game.get_player("p1"), "easy", rng=random.Random(seed + 1000))
            bot2 = Bot(game.get_player("p2"), "easy", rng=random.Random(seed + 2000))
            game.bots["p1"] = bot1
            game.bots["p2"] = bot2

            for turn in range(40):
                if game.phase != GamePhase.PLAYING:
                    break
                pid = game.get_current_player_id()
                if pid in ("p1", "p2"):
                    try:
                        game.execute_bot_turn(pid)
                    except Exception:
                        break
                    if game.phase == GamePhase.MERGING:
                        _resolve_dispositions(game, {"p1": bot1, "p2": bot2})
                else:
                    p = game.get_player("p0")
                    playable = Rules.get_playable_tiles(game.board, p.hand, game.hotel)
                    if playable:
                        game.play_tile("p0", playable[0])
                        if game.phase == GamePhase.FOUNDING_CHAIN:
                            avail = game.pending_action.get("available_chains", [])
                            if avail:
                                game.found_chain("p0", avail[0])
                        if game.phase == GamePhase.MERGING:
                            if (
                                game.pending_action
                                and game.pending_action.get("type") == "choose_survivor"
                            ):
                                tied = game.pending_action.get("tied_chains", [])
                                game.choose_merger_survivor("p0", tied[0])
                            _resolve_dispositions(game, {"p1": bot1, "p2": bot2})
                    else:
                        game.phase = GamePhase.BUYING_STOCKS
                    if game.phase == GamePhase.BUYING_STOCKS:
                        purchases = _choose_stocks_to_buy(game, "p0")
                        game.buy_stocks("p0", purchases)
                        game.end_turn("p0")

            # Print final stocks for human
            human = game.get_player("p0")
            all_stocks = {
                c: human.get_stock_count(c)
                for c in game.hotel.get_all_chain_names()
                if human.get_stock_count(c) > 0
            }
            print(f"  Seed {seed}: Human stocks={all_stocks}, money={human.money}")


def _resolve_dispositions(game, bots_map):
    """Resolve all stock dispositions during a merger."""
    for _ in range(100):
        if game.phase != GamePhase.MERGING:
            break
        if not game.pending_action:
            break
        if game.pending_action.get("type") != "stock_disposition":
            break
        pid = game.pending_action.get("player_id")
        defunct = game.pending_action.get("defunct_chain")
        survivor = game.pending_action.get("surviving_chain")
        count = game.pending_action.get("stock_count", 0)
        if pid in bots_map:
            decision = bots_map[pid].choose_stock_disposition(
                defunct, survivor, count, game.board, game.hotel
            )
            game.handle_stock_disposition(
                pid, decision["sell"], decision["trade"], decision["keep"]
            )
        elif pid == "p0":
            game.handle_stock_disposition(pid, sell=0, trade=0, keep=count)
        else:
            break


def _choose_stocks_to_buy(game, player_id):
    """Choose stocks for human to buy - prioritize diversity across active chains."""
    player = game.get_player(player_id)
    active_chains = game.hotel.get_active_chains()
    if not active_chains:
        return []

    purchases = []
    for chain_name in active_chains:
        if len(purchases) >= 3:
            break
        size = game.board.get_chain_size(chain_name)
        price = game.hotel.get_stock_price(chain_name, size)
        if price <= player.money and game.hotel.get_available_stocks(chain_name) > 0:
            purchases.append(chain_name)

    while len(purchases) < 3:
        bought_any = False
        for chain_name in active_chains:
            if len(purchases) >= 3:
                break
            size = game.board.get_chain_size(chain_name)
            price = game.hotel.get_stock_price(chain_name, size)
            total_cost = (
                sum(
                    game.hotel.get_stock_price(c, game.board.get_chain_size(c))
                    for c in purchases
                )
                + price
            )
            if (
                total_cost <= player.money
                and game.hotel.get_available_stocks(chain_name) > 0
            ):
                purchases.append(chain_name)
                bought_any = True
        if not bought_any:
            break

    total_cost = sum(
        game.hotel.get_stock_price(c, game.board.get_chain_size(c)) for c in purchases
    )
    while purchases and total_cost > player.money:
        purchases.pop()
        total_cost = (
            sum(
                game.hotel.get_stock_price(c, game.board.get_chain_size(c))
                for c in purchases
            )
            if purchases
            else 0
        )

    return purchases


if __name__ == "__main__":
    main()
