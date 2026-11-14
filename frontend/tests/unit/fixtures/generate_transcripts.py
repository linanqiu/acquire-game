"""Generate sample transcript fixtures by running the real engine.

Usage (from the repo root):

    ACQUIRE_TEST_MODE=1 python3 frontend/tests/unit/fixtures/generate_transcripts.py

Writes JSON next to this file, exactly in the shape of the HTTP routes in
docs/architecture/seat-contract.md ("Game transcripts and Acquire Bench"):

    transcript-full.json       GET /games/{id}/transcript for a finished game
    transcript-redacted.json   the same game, still live and redacted
    games-list.json            GET /games
    game-summary.json          GET /games/{id}
    leaderboard.json / leaderboard-empty.json   GET /bench/leaderboard
    series.json                GET /bench/series/{id}

All seats are driven by the rules-based HeuristicAgent; the LLM seats' prompts
are the real prompt builder's output and the model answers are synthesised
(including two rejected attempts and two fallbacks) so the UI has every
decision source to render. Read-only use of the backend.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("ACQUIRE_TEST_MODE", "1")

from agents.base import build_context  # noqa: E402
from agents.heuristic import HeuristicAgent  # noqa: E402
from agents.llm.prompt import build_system_prompt, build_user_prompt  # noqa: E402
from game.decisions import apply_action, pending_decisions  # noqa: E402
from game.game import Game, GamePhase  # noqa: E402

GAME_ID = "g_20261114_k3f9xq"
SYSTEM_ID = "sys-7c1e04a2"
STARTED = "2026-11-14T10:02:11Z"

SEATS = [
    ("p1", "Dan", "human", None, None, None),
    ("p2", "Sonnet", "llm", "llm:claude-sonnet", "Claude Sonnet", "claude-sonnet-4-5"),
    ("p3", "Haiku", "llm", "llm:claude-haiku", "Claude Haiku", "claude-haiku-4-5"),
    ("p4", "Robo", "bot", "bot", "Bot", None),
]


def why_for(kind: str, action: dict, legal: dict) -> tuple[str, str]:
    a = action.get("action")
    if kind == "place_tile":
        t = action.get("tile")
        opt = next((o for o in legal.get("tiles", []) if o["tile"] == t), {})
        oc = opt.get("outcome", "nothing")
        why = {
            "merge": f"{t} triggers a merger and I hold shares in the smaller chain.",
            "found": f"{t} founds a chain and the free share is a good start.",
            "expand": f"{t} grows {', '.join(opt.get('chains', []))} where I hold stock.",
        }.get(oc, f"{t} is safe and keeps my options open.")
        return why, f"Last tile: {t} ({oc}). Keep an eye on chain sizes near 11."
    if kind == "buy_stocks":
        if a == "buy_stocks":
            return (
                "Cheap shares in a growing chain; cash is still plentiful.",
                f"Bought {json.dumps(action.get('purchases'))}; revisit when it nears safe size.",
            )
        return "Nothing worth buying at current prices.", "Hold cash for the next merger."
    if kind == "stock_disposition":
        d = action.get("disposition", {})
        return (
            f"Sell {d.get('sell', 0)} / trade {d.get('trade', 0)} / hold {d.get('hold', 0)} "
            "based on the payout versus the survivor's price.",
            "Defunct stock is worthless later, so convert it now.",
        )
    if kind == "found_chain":
        return f"{action.get('chain')} is the cheapest tier available.", "Founded cheap."
    if kind == "choose_survivor":
        return "Keeping the larger brand alive protects my holdings.", "Survivor chosen by holdings."
    if kind == "trade_response":
        return "The price is fair and it helps me reach a majority.", "Accepted a trade; watch cash."
    return "Following the highest-value legal option.", ""


def redact_legal(legal: dict) -> dict:
    return {k: v for k, v in legal.items() if k != "tiles"}


async def run(seed: int):
    game = Game(seed=seed)
    for pid, name, kind, *_ in SEATS:
        game.add_player(pid, name, is_bot=(kind != "human"))
    game.start_game()
    brain = {pid: HeuristicAgent(name=pid, seed=f"{seed}:{pid}") for pid, *_ in SEATS}
    kinds = {s[0]: s[2] for s in SEATS}
    entries: list[dict] = []
    system_prompt = build_system_prompt()
    emitted = 0
    di = 0
    traded = False
    counts: dict[tuple, int] = {}
    totals = {
        pid: dict(
            decisions=0,
            llm_calls=0,
            retries=0,
            fallbacks=0,
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0 if k == "llm" and pid == "p2" else None,
            latency_s=0.0,
        )
        for pid, _n, k, *_ in SEATS
    }

    def flush_events():
        nonlocal emitted
        while emitted < len(game.events):
            entries.append({"type": "event", **game.events[emitted]})
            emitted += 1

    flush_events()
    entries.append({"type": "state", "after_seq": emitted - 1, "public": game.get_public_state()})
    while game.phase != GamePhase.GAME_OVER and di < 900:
        decs = pending_decisions(game)
        if not decs:
            break
        decision = next((d for d in decs[1:] if d.kind == "trade_response"), decs[0])
        pid = decision.player_id
        ctx = build_context(game, decision)
        action = brain[pid].choose(ctx)
        kind = decision.kind
        counts[(pid, kind)] = counts.get((pid, kind), 0) + 1
        n_kind = counts[(pid, kind)]

        # Scripted trade: Dan offers a share to Sonnet for cash.
        if (
            not traded
            and pid == "p1"
            and kind == "buy_stocks"
            and "propose_trade" in ctx.legal["action_types"]
        ):
            me = next(p for p in ctx.state["players"] if p["player_id"] == "p1")
            holds = {c: n for c, n in me["stocks"].items() if n > 0}
            if holds:
                chain = next(iter(holds))
                action = {
                    "action": "propose_trade",
                    "to_player_id": "p2",
                    "offering_stocks": {chain: 1},
                    "offering_money": 0,
                    "requesting_stocks": {},
                    "requesting_money": 400,
                }
                traded = True
        if kind == "trade_response" and pid == "p2" and ctx.legal.get("can_accept"):
            action = {"action": "accept_trade", "trade_id": ctx.legal["trade"]["trade_id"]}
        source = kinds[pid]
        fallback = None
        llm = None
        latency = 0.001 if source == "bot" else 0.0
        if source == "human":
            latency = 6.4 + (di % 7)
        if source == "llm":
            user_prompt = build_user_prompt(ctx)
            why, note = why_for(kind, action, ctx.legal)
            model = next(s[5] for s in SEATS if s[0] == pid)
            tok_in = len(system_prompt + user_prompt) // 4
            lat = 1.4 + (di % 5) * 0.7 if pid == "p2" else 0.8 + (di % 4) * 0.3
            good_raw = json.dumps({**action, "why": why, "note": note})

            def att(raw, parsed, error, retry=None, l=lat):
                return {
                    "raw": raw,
                    "parsed": parsed,
                    "error": error,
                    "latency_s": round(l, 2),
                    "input_tokens": tok_in,
                    "output_tokens": max(12, len(raw) // 4),
                    "cache_read_tokens": tok_in // 2,
                    "retry_prompt": retry,
                }

            if pid == "p3" and kind == "place_tile" and n_kind == 3:
                bad1 = {"action": "place_tile", "tile": "13Z", "why": "Corner tile is safest."}
                bad2 = {"action": "place_tile", "tile": "0A"}
                r1 = (
                    "Your answer was rejected: tile 13Z is not one of the legal tiles. "
                    "Answer again with exactly one of the legal options."
                )
                r2 = (
                    "Your answer was rejected: tile 0A is not one of the legal tiles. "
                    "This is your last retry; pick a tile from your hand."
                )
                attempts = [
                    att(json.dumps(bad1), bad1, "illegal: tile 13Z is not in the legal options", r1),
                    att(json.dumps(bad2), bad2, "illegal: tile 0A is not in the legal options", r2),
                    att(good_raw, action, None, None),
                ]
                totals[pid]["retries"] += 2
                latency = sum(a["latency_s"] for a in attempts)
            elif pid == "p3" and kind == "buy_stocks" and n_kind == 4:
                prose = (
                    "I think I should buy some Tower stock because it looks cheap, "
                    "but let me think about"
                )
                over = {"action": "buy_stocks", "purchases": {"Tower": 9}}
                attempts = [
                    att(prose, None, "could not parse a JSON object from the answer", "Reply with JSON only."),
                    att(json.dumps(over), over, "illegal: at most 3 shares per turn", "Reply with JSON only."),
                ]
                source = "fallback"
                fallback = {
                    "reason": "illegal",
                    "message": "2 rejected answers (unparseable, over the 3-share cap); "
                    "rules-based player acted instead.",
                }
                totals[pid]["retries"] += 2
                totals[pid]["fallbacks"] += 1
                latency = sum(a["latency_s"] for a in attempts)
                why = note = None
            elif pid == "p3" and kind == "place_tile" and n_kind == 7:
                attempts = []
                source = "fallback"
                fallback = {"reason": "timeout", "message": "No answer within 30s."}
                totals[pid]["fallbacks"] += 1
                latency = 30.0
                why = note = None
            else:
                attempts = [att(good_raw, action, None)]
                latency = lat
            llm = {
                "model": model,
                "system_prompt_id": SYSTEM_ID,
                "user_prompt": user_prompt,
                "attempts": attempts,
                "why": why,
                "note": note,
            }
            t = totals[pid]
            t["llm_calls"] += len(attempts)
            t["input_tokens"] += sum(a["input_tokens"] for a in attempts)
            t["output_tokens"] += sum(a["output_tokens"] for a in attempts)
            if pid == "p2":
                t["cost_usd"] = round(
                    t["cost_usd"]
                    + sum(a["input_tokens"] * 3e-6 + a["output_tokens"] * 15e-6 for a in attempts),
                    4,
                )
        totals[pid]["decisions"] += 1
        totals[pid]["latency_s"] = round(totals[pid]["latency_s"] + latency, 2)

        entries.append(
            {
                "type": "decision",
                "index": di,
                "after_seq": emitted - 1,
                "player_id": pid,
                "kind": kind,
                "legal": ctx.legal,
                "action": action,
                "source": source,
                "fallback": fallback,
                "latency_s": round(latency, 2),
                "llm": llm,
            }
        )
        di += 1
        result = apply_action(game, pid, action)
        assert result.get("success"), (pid, kind, action, result)
        flush_events()
        entries.append({"type": "state", "after_seq": emitted - 1, "public": game.get_public_state()})
    return game, entries, totals, game.phase == GamePhase.GAME_OVER, system_prompt


def main():
    best = None
    for seed in range(1, 40):
        game, entries, totals, ended, sp = asyncio.run(run(seed))
        evtypes = {e.get("type") for e in game.events}
        n_dec = sum(1 for e in entries if e["type"] == "decision")
        merger = "merger_started" in evtypes
        trade = "trade_accepted" in evtypes
        print(seed, ended, n_dec, "merger" if merger else "", "trade" if trade else "")
        if ended and merger and trade and (best is None or n_dec < best[0]):
            best = (n_dec, seed, game, entries, totals, sp)
    assert best, "no suitable seed"
    n_dec, seed, game, entries, totals, sp = best
    print("chosen seed", seed, "decisions", n_dec)
    write_all(seed, game, entries, totals, sp)


def write_all(seed, game, entries, totals, sp):
    end = next(e for e in reversed(game.events) if e["type"] == "game_ended")
    standings_out = []
    for i, s in enumerate(end.get("standings") or []):
        standings_out.append(
            {
                "player_id": s.get("player_id"),
                "name": s.get("name"),
                "rank": s.get("rank", i + 1),
                "score": s.get("score", s.get("total", s.get("money"))),
            }
        )
    seats = [
        {"player_id": a, "name": b, "kind": c, "agent_id": d, "agent_label": e, "model": f}
        for a, b, c, d, e, f in SEATS
    ]
    header = {
        "type": "header",
        "transcript_version": 1,
        "game_id": GAME_ID,
        "source": "live",
        "room_code": "KQXD",
        "bench": None,
        "started_at": STARTED,
        "seed": seed,
        "seats": seats,
        "prompt_version": "pv-4be9d1f0",
        "system_prompts": {SYSTEM_ID: sp},
    }
    footer = {
        "type": "footer",
        "ended_at": "2026-11-14T10:41:52Z",
        "reason": end.get("reason", "declared"),
        "standings": standings_out,
        "totals": totals,
    }
    dump(
        HERE / "transcript-full.json",
        {"header": header, "entries": entries, "footer": footer, "redacted": False},
    )

    # Redacted: still live, cut at ~45% of the entries, private data removed.
    cut = int(len(entries) * 0.45)
    part = entries[:cut]
    while part and part[-1]["type"] != "state":
        part.pop()
    red = []
    for e in part:
        if e["type"] not in ("decision", "state") and e.get("private_to"):
            continue
        if e["type"] == "decision":
            e = dict(e)
            e["legal"] = redact_legal(e["legal"])
            if e["llm"]:
                llm = dict(e["llm"])
                for k in ("user_prompt", "why", "note"):
                    llm.pop(k, None)
                llm["attempts"] = [
                    {k: v for k, v in a.items() if k not in ("raw", "retry_prompt")}
                    for a in llm["attempts"]
                ]
                e["llm"] = llm
        red.append(e)
    rh = dict(header)
    rh["system_prompts"] = {}
    dump(
        HERE / "transcript-redacted.json",
        {"header": rh, "entries": red, "footer": None, "redacted": True},
    )

    turns = sum(1 for e in game.events if e["type"] == "turn_ended")
    summary = {
        "game_id": GAME_ID,
        "source": "live",
        "status": "finished",
        "started_at": STARTED,
        "ended_at": footer["ended_at"],
        "room_code": "KQXD",
        "series_id": None,
        "seats": [
            {k: s[k] for k in ("player_id", "name", "kind", "agent_label", "model")} for s in seats
        ],
        "winners": [standings_out[0]["player_id"]],
        "turns": turns,
    }
    dump(HERE / "game-summary.json", {**summary, "standings": standings_out, "totals": totals})

    def mk(gid, source, status, started, ended, room, series, labels, winners, turns_):
        return {
            "game_id": gid,
            "source": source,
            "status": status,
            "started_at": started,
            "ended_at": ended,
            "room_code": room,
            "series_id": series,
            "seats": [
                {"player_id": f"p{i + 1}", "name": n, "kind": k, "agent_label": lab, "model": m}
                for i, (n, k, lab, m) in enumerate(labels)
            ],
            "winners": winners,
            "turns": turns_,
        }

    models = [
        ("Sonnet", "llm", "Claude Sonnet", "claude-sonnet-4-5"),
        ("Haiku", "llm", "Claude Haiku", "claude-haiku-4-5"),
        ("Robo", "bot", "Bot", None),
        ("Robo 2", "bot", "Bot", None),
    ]
    games = [
        mk("g_20261114_n7a2lp", "live", "live", "2026-11-14T11:20:03Z", None, "WXYZ", None,
           [("Maya", "human", None, None), ("Haiku", "llm", "Claude Haiku", "claude-haiku-4-5"),
            ("Robo", "bot", "Bot", None)], [], 14),
        summary,
        mk("b_acq1_s1_0003", "bench", "finished", "2026-11-14T09:12:40Z", "2026-11-14T09:19:02Z",
           None, "acquire-bench-v1-20261114", models, ["p1"], 38),
        mk("b_acq1_s1_0002", "bench", "finished", "2026-11-14T09:05:10Z", "2026-11-14T09:12:30Z",
           None, "acquire-bench-v1-20261114", models[::-1], ["p4", "p3"], 41),
        mk("g_20261113_x1q8rv", "live", "abandoned", "2026-11-13T20:01:00Z", "2026-11-13T20:09:12Z",
           "ABCD", None,
           [("Lee", "human", None, None), ("Ana", "human", None, None), ("Robo", "bot", "Bot", None)],
           [], 9),
    ]
    dump(HERE / "games-list.json", {"games": games})

    agents = [
        agent_row("llm:claude-sonnet", "Claude Sonnet", "claude-sonnet-4-5", 24, 11, 0.458, 0.28, 0.65,
                  1.9, 1532, [1496, 1568], 0.021, 0.034, 41200, 0.73, 1.8,
                  "ahead of the bot baseline; interval overlaps other models"),
        agent_row("llm:claude-haiku", "Claude Haiku", "claude-haiku-4-5", 24, 7, 0.292, 0.15, 0.49,
                  2.4, 1488, [1451, 1525], 0.063, 0.081, 38800, None, 1.1,
                  "not distinguishable from the baseline at this sample size"),
        agent_row("bot", "Bot", None, 24, 6, 0.25, 0.12, 0.45, 2.6, 1480, [1444, 1516], 0.0, 0.0, 0,
                  None, 0.0, "baseline"),
    ]
    board = {
        "protocol": {
            "id": "acquire-bench-v1",
            "description": "Fixed seeds, 4 seats, full seat rotation, fixed prompt version. "
            "Tracks: vs-baseline and head-to-head.",
            "players": 4,
            "games_per_matchup": 24,
            "seeds": [1, 2, 3, 4, 5, 6],
        },
        "updated_at": "2026-11-14T09:19:02Z",
        "agents": agents,
        "series": [
            {"series_id": "acquire-bench-v1-20261114", "matchup": "Sonnet vs Haiku vs Bot x2",
             "games": 24, "started_at": "2026-11-14T08:40:00Z", "finished": True},
            {"series_id": "acquire-bench-v1-20261115", "matchup": "Sonnet + 3 Bots",
             "games": 6, "started_at": "2026-11-15T08:40:00Z", "finished": False},
        ],
    }
    dump(HERE / "leaderboard.json", board)
    empty = dict(board)
    empty["agents"] = []
    empty["series"] = []
    empty["updated_at"] = None
    dump(HERE / "leaderboard-empty.json", empty)
    series = {
        "series_id": "acquire-bench-v1-20261114",
        "matchup": "Sonnet vs Haiku vs Bot x2",
        "protocol": "acquire-bench-v1",
        "games": [
            {
                "game_id": f"b_acq1_s1_{i:04d}",
                "seed": 1 + i // 4,
                "rotation": i % 4,
                "standings": [
                    {"player_id": f"p{(i + j) % 4 + 1}", "name": nm, "rank": j + 1,
                     "score": 38000 - 6500 * j - 300 * i}
                    for j, nm in enumerate(
                        ["Sonnet", "Bot", "Haiku", "Bot 2"] if i % 2 == 0
                        else ["Haiku", "Sonnet", "Bot 2", "Bot"]
                    )
                ],
            }
            for i in range(1, 7)
        ],
    }
    dump(HERE / "series.json", series)


def agent_row(aid, label, model, games, wins, wr, lo, hi, mr, rating, rci, fb, rt, tok, lat, cost, verdict):
    return {
        "agent_id": aid, "label": label, "model": model, "games": games, "wins": wins,
        "win_rate": wr, "ci_low": lo, "ci_high": hi, "mean_rank": mr, "rating": rating,
        "rating_ci": rci, "fallback_rate": fb, "retry_rate": rt, "tokens_per_game": tok,
        "cost_per_game": cost if model else 0.0, "latency_p50_s": lat, "verdict": verdict,
    }


def dump(path: Path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":"), default=str) + "\n")
    print("wrote", path.name, path.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
