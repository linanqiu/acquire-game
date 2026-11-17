"""Self-play tournament between versions of the rules-based bot.

No server, no network, no LLM: every game is played through
``build_context`` -> ``HeuristicAgent.choose`` -> ``apply_action``, the path
the server's seat driver uses for a bot seat. Games run in parallel processes
with fixed seeds, so a run is exactly repeatable.

Pairing A vs B (4 seats), per seed: 2v2 in both alternating seatings (ABAB,
BABA) and 1v3 with the single seat in each of the 4 positions, both ways
(A BBB, B AAA): 10 games. Mixed tables (``--mixed``): 3 to 6 seats, every
version listed, seats assigned round-robin and rotated.

Results per version: wins (ties split), mean rank, mean margin (a seat's final
money minus the mean of the other seats at its table), each with a 95 %
confidence interval, and a behaviour profile. For a pairing, the paired test:
per seed, A's mean margin minus B's over the seed's 10 games; the mean of
those differences with a 95 % interval (normal approximation, seeds are
independent). "A beats B clearly" = the interval excludes zero.

Usage (from ``backend/``)::

    python -m bench.bot_tournament v2 v1 --seeds 1000-1099 --procs 3
    python -m bench.bot_tournament v1 v2 v3 --mixed --seeds 5000-5049
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor

from agents.base import build_context
from agents.heuristic import HeuristicAgent
from game.decisions import apply_action, pending_decisions
from game.game import Game, GamePhase
from game.ranking import competition_ranks

SUICIDE_RIVAL_MIN = 1000  # a merger paying the maker $0 and rivals >= this
MAX_DECISIONS = 20_000

PROFILE_KEYS = (
    "mergers",
    "suicide_merges",
    "foundings",
    "shares_held",  # mean shares held at the end of the seat's own turns
    "cash_turn_end",  # mean cash at the end of the seat's own turns
    "cash_last_turn",  # cash at the end of the seat's last turn
    "declares",
    "trades_accepted",
    "bonus_income",  # merger + final bonuses received
)


def play_game(seed: int, versions: list[str], difficulty: str = "medium") -> dict:
    """One bot-only game; ``versions[i]`` plays seat i. Returns final money,
    ranks and the per-seat behaviour profile."""
    game = Game(seed=seed)
    n = len(versions)
    for i in range(n):
        game.add_player(f"s{i}", f"Seat {i + 1}", is_bot=True)
    game.start_game()
    agents = {
        f"s{i}": HeuristicAgent(
            name=f"Seat {i + 1}",
            difficulty=difficulty,
            seed=f"{seed}:{i}",
            version=v,
        )
        for i, v in enumerate(versions)
    }
    prof = {f"s{i}": defaultdict(float) for i in range(n)}
    turns = defaultdict(int)
    merger = None
    steps = 0
    while game.phase != GamePhase.GAME_OVER:
        steps += 1
        if steps > MAX_DECISIONS:
            raise RuntimeError(f"seed {seed}: game did not finish")
        decision = pending_decisions(game)[0]
        pid = decision.player_id
        action = agents[pid].choose(build_context(game, decision))
        mark = len(game.events)
        result = apply_action(game, pid, action)
        if not result.get("success"):
            raise RuntimeError(f"seed {seed}: {pid} {action} refused: {result}")
        if action.get("action") == "declare_end_game":
            prof[pid]["declares"] += 1
        if action.get("action") == "accept_trade":
            prof[pid]["trades_accepted"] += 1
        for e in game.events[mark:]:
            t = e["type"]
            if t == "merger_started":
                merger = {"maker": e.get("player_id"), "paid": defaultdict(int)}
            elif t == "bonuses_paid":
                for q, b in e.get("bonuses", {}).items():
                    total = b.get("majority", 0) + b.get("minority", 0)
                    prof[q]["bonus_income"] += total
                    if merger is not None and not e.get("final"):
                        merger["paid"][q] += total
            elif t == "merger_completed" and merger is not None:
                maker = merger["maker"]
                prof[maker]["mergers"] += 1
                rivals = sum(v for q, v in merger["paid"].items() if q != maker)
                if merger["paid"].get(maker, 0) == 0 and rivals >= SUICIDE_RIVAL_MIN:
                    prof[maker]["suicide_merges"] += 1
                merger = None
            elif t == "chain_founded":
                q = e.get("player_id")
                if q in prof:
                    prof[q]["foundings"] += 1
            elif t == "turn_ended":
                q = e.get("player_id")
                if q in prof:
                    p = game.get_player(q)
                    turns[q] += 1
                    prof[q]["shares_held"] += sum(p.stocks.values())
                    prof[q]["cash_turn_end"] += p.money
                    prof[q]["cash_last_turn"] = p.money
    for q, k in turns.items():
        prof[q]["shares_held"] /= k
        prof[q]["cash_turn_end"] /= k
    final = [game.get_player(f"s{i}").money for i in range(n)]
    ranks = competition_ranks(final)
    return {
        "seed": seed,
        "versions": list(versions),
        "final": final,
        "ranks": ranks,
        "profile": [
            {k: prof[f"s{i}"].get(k, 0.0) for k in PROFILE_KEYS} for i in range(n)
        ],
    }


def _job(args):
    return play_game(*args)


def pairing_seatings(a: str, b: str) -> list[list[str]]:
    """The 10 seatings of a pairing (see module docstring)."""
    out = [[a, b, a, b], [b, a, b, a]]
    for single, rest in ((a, b), (b, a)):
        for pos in range(4):
            seats = [rest] * 4
            seats[pos] = single
            out.append(seats)
    return out


def mixed_seatings(versions: list[str], sizes=(3, 4, 5, 6)) -> list[list[str]]:
    out = []
    for n in sizes:
        for rot in range(len(versions)):
            out.append([versions[(rot + i) % len(versions)] for i in range(n)])
    return out


def run(jobs: list[tuple], procs: int = 1) -> list[dict]:
    if procs <= 1:
        return [_job(j) for j in jobs]
    with ProcessPoolExecutor(max_workers=procs) as ex:
        return list(ex.map(_job, jobs, chunksize=2))


def _ci(values: list[float]) -> tuple[float, float]:
    """Mean and 95 % half-width (normal approximation)."""
    if not values:
        return 0.0, 0.0
    m = statistics.fmean(values)
    if len(values) < 2:
        return m, 0.0  # one sample: no interval
    return m, 1.96 * statistics.stdev(values) / math.sqrt(len(values))


def summarize(games: list[dict]) -> dict:
    """Per version: games, win share, mean rank, mean margin (95 % CIs) and
    the mean behaviour profile per seat-game."""
    seats = defaultdict(lambda: {"win": [], "rank": [], "margin": [], "prof": []})
    for g in games:
        n = len(g["final"])
        top = min(g["ranks"])
        winners = sum(1 for r in g["ranks"] if r == top)
        for i, v in enumerate(g["versions"]):
            others = [x for j, x in enumerate(g["final"]) if j != i]
            s = seats[v]
            s["win"].append((1.0 / winners) if g["ranks"][i] == top else 0.0)
            s["rank"].append(g["ranks"][i])
            s["margin"].append(g["final"][i] - sum(others) / (n - 1))
            s["prof"].append(g["profile"][i])
    out = {}
    for v, s in sorted(seats.items()):
        win, win_h = _ci(s["win"])
        rank, rank_h = _ci(s["rank"])
        margin, margin_h = _ci(s["margin"])
        out[v] = {
            "seat_games": len(s["win"]),
            "win": round(win, 4),
            "win_ci": round(win_h, 4),
            "rank": round(rank, 3),
            "rank_ci": round(rank_h, 3),
            "margin": round(margin),
            "margin_ci": round(margin_h),
            "profile": {
                k: round(statistics.fmean(p[k] for p in s["prof"]), 3)
                for k in PROFILE_KEYS
            },
        }
    return out


def paired(games: list[dict], a: str, b: str) -> dict:
    """Paired by seed: mean over seeds of (A's mean margin - B's mean margin)
    across that seed's seatings, with a 95 % interval; plus each version's
    win share in the 2v2 games."""
    by_seed = defaultdict(lambda: {a: [], b: []})
    wins = defaultdict(float)
    counts = {"2v2": 0, "1v3": 0}
    for g in games:
        n = len(g["final"])
        for i, v in enumerate(g["versions"]):
            others = [x for j, x in enumerate(g["final"]) if j != i]
            by_seed[g["seed"]][v].append(g["final"][i] - sum(others) / (n - 1))
        kind = "2v2" if g["versions"].count(a) == 2 else "1v3"
        counts[kind] += 1
        if kind == "2v2":
            top = min(g["ranks"])
            winners = [g["versions"][i] for i, r in enumerate(g["ranks"]) if r == top]
            for w in winners:
                wins[w] += 1 / len(winners)
    diffs = [
        statistics.fmean(d[a]) - statistics.fmean(d[b])
        for d in by_seed.values()
        if d[a] and d[b]
    ]
    m, h = _ci(diffs)
    return {
        "a": a,
        "b": b,
        "seeds": len(diffs),
        "games": len(games),
        "margin_diff": round(m),
        "margin_diff_ci": round(h),
        "a_clearly_better": bool(m - h > 0),
        "b_clearly_better": bool(m + h < 0),
        "win_share_2v2": {v: round(wins[v] / max(1, counts["2v2"]), 3) for v in (a, b)},
        "games_2v2": counts["2v2"],
        "games_1v3": counts["1v3"],
    }


def single_seat_wins(games: list[dict], a: str, b: str) -> dict:
    """In 1v3 games: how often the lone seat of each version wins (ties split);
    an equal player would win 25 %."""
    res = {}
    for v in (a, b):
        gs = [g for g in games if g["versions"].count(v) == 1 and len(g["final"]) == 4]
        w = []
        for g in gs:
            i = g["versions"].index(v)
            top = min(g["ranks"])
            k = sum(1 for r in g["ranks"] if r == top)
            w.append((1.0 / k) if g["ranks"][i] == top else 0.0)
        m, h = _ci(w)
        res[v] = {"games": len(gs), "win": round(m, 3), "win_ci": round(h, 3)}
    return res


def parse_seeds(text: str) -> list[int]:
    if "-" in text:
        lo, hi = text.split("-", 1)
        return list(range(int(lo), int(hi) + 1))
    return [int(x) for x in text.split(",")]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("versions", nargs="+")
    ap.add_argument("--seeds", default="1-20")
    ap.add_argument("--procs", type=int, default=1)
    ap.add_argument("--difficulty", default="medium")
    ap.add_argument("--mixed", action="store_true")
    ap.add_argument("--out", help="write games and summary as JSON here")
    args = ap.parse_args(argv)
    seeds = parse_seeds(args.seeds)
    if args.mixed:
        seatings = mixed_seatings(args.versions)
    else:
        if len(args.versions) != 2:
            ap.error("a pairing takes two versions (or use --mixed)")
        seatings = pairing_seatings(*args.versions)
    jobs = [(s, seat, args.difficulty) for s in seeds for seat in seatings]
    t0 = time.time()
    games = run(jobs, args.procs)
    out = {"summary": summarize(games), "games_played": len(games)}
    if not args.mixed:
        a, b = args.versions
        out["paired"] = paired(games, a, b)
        out["single_seat"] = single_seat_wins(games, a, b)
    out["seconds"] = round(time.time() - t0)
    print(json.dumps(out, indent=1))
    if args.out:
        with open(args.out, "w") as f:
            json.dump({**out, "games": games}, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
