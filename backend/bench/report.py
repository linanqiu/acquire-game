"""Aggregate game records into per-agent statistics (JSON + Markdown).

Unit of observation: a *seat-game* (one agent label in one game). An agent
that holds several seats in a matchup (the three bots in ``llm:x,bot,bot,bot``)
contributes several seat-games per game; those are not independent, so its
interval is slightly optimistic. Fractional wins: a tie for first gives each
tied winner ``1/k`` of a win.
"""

from __future__ import annotations

import math
import statistics
from datetime import datetime, timezone

from bench.runner import percentile

Z95 = 1.96
MIN_GAMES = 30  # below this, say so loudly


def wilson(wins: float, n: int, z: float = Z95) -> tuple[float, float]:
    """Wilson score interval for ``wins`` successes in ``n`` trials."""
    if n <= 0:
        return (0.0, 1.0)
    p = wins / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def mean_ci(values: list[float], z: float = Z95) -> tuple[float | None, float | None]:
    """(mean, half-width of the normal-approximation 95% CI); None if empty."""
    if not values:
        return (None, None)
    m = statistics.fmean(values)
    if len(values) < 2:
        return (m, None)
    return (m, z * statistics.stdev(values) / math.sqrt(len(values)))


def games_to_detect(
    p_true: float, p0: float, z_a: float = 1.96, z_b: float = 0.84
) -> int:
    """Games needed (two-sided 5%, 80% power, normal approx.) to tell a true
    win rate ``p_true`` from chance ``p0``."""
    if abs(p_true - p0) < 1e-9:
        return 10**9
    num = z_a * math.sqrt(p0 * (1 - p0)) + z_b * math.sqrt(p_true * (1 - p_true))
    return math.ceil((num / (p_true - p0)) ** 2)


def _sum(values):
    return sum(values)


def _per(total, count):
    return None if total is None or not count else total / count


def _cost_total(costs: list[float | None]) -> float | None:
    return None if not costs or any(c is None for c in costs) else sum(costs)


def aggregate_matchup(matchup: str, records: list[dict]) -> dict:
    done = [r for r in records if r["status"] == "completed"]
    bad = [r for r in records if r["status"] != "completed"]
    n_players = len(done[0]["seat_order"]) if done else 0
    out: dict = {
        "matchup": matchup,
        "games": len(done),
        "failed_games": len(bad),
        "players": n_players,
        "chance_win_rate": (1 / n_players) if n_players else None,
        "seed_range": [min(r["seed"] for r in done), max(r["seed"] for r in done)]
        if done
        else None,
        "mean_turns": statistics.fmean(r["turns"] for r in done) if done else None,
        "end_reasons": {},
        "agents": [],
        "positions": [],
        "warnings": [],
    }
    for r in done:
        out["end_reasons"][str(r["end_reason"])] = (
            out["end_reasons"].get(str(r["end_reason"]), 0) + 1
        )
    if bad:
        out["warnings"].append(
            f"{len(bad)} game(s) did not complete (stalled) and are excluded: "
            + ", ".join(f"seed {r['seed']} ({r.get('detail')})" for r in bad[:5])
        )
    if not done:
        out["warnings"].append("no completed games")
        return out

    chance = 1 / n_players
    labels: list[str] = []
    for r in done:
        for lab in r["seat_order"]:
            if lab not in labels:
                labels.append(lab)

    # per-position win rate (seat-order bias check)
    for pos in range(n_players):
        wins = sum(1 / len(r["winners"]) for r in done if pos in r["winners"])
        ranks = [
            next(s["rank"] for s in r["standings"] if s["pos"] == pos) for r in done
        ]
        lo, hi = wilson(wins, len(done))
        out["positions"].append(
            {
                "position": pos + 1,
                "games": len(done),
                "wins": wins,
                "win_rate": wins / len(done),
                "win_ci": [lo, hi],
                "mean_rank": statistics.fmean(ranks),
            }
        )

    for lab in labels:
        obs = []  # one per seat-game
        for r in done:
            for seat in r["seats"]:
                if seat["agent"] != lab:
                    continue
                pos = seat["pos"]
                st = next(s for s in r["standings"] if s["pos"] == pos)
                bots = [
                    s["pos"]
                    for s in r["seats"]
                    if s["agent"] == "bot" and s["pos"] != pos
                ]
                score_by = {s["pos"]: s["score"] for s in r["standings"]}
                margin = (
                    st["score"] - statistics.fmean(score_by[b] for b in bots)
                    if bots
                    else None
                )
                obs.append(
                    {
                        "seat": seat,
                        "rank": st["rank"],
                        "score": st["score"],
                        "win": (1 / len(r["winners"])) if pos in r["winners"] else 0.0,
                        "margin": margin,
                    }
                )
        n = len(obs)
        wins = _sum(o["win"] for o in obs)
        lo, hi = wilson(wins, n)
        rank_m, rank_h = mean_ci([o["rank"] for o in obs])
        margins = [o["margin"] for o in obs if o["margin"] is not None]
        mar_m, mar_h = mean_ci(margins)
        seats = [o["seat"] for o in obs]
        decisions = _sum(s["decisions"] for s in seats)
        lat = [x for s in seats for x in s["latencies_ms"]]
        tokens = {
            k: _sum(s[k] for s in seats)
            for k in (
                "input_tokens",
                "output_tokens",
                "cache_read_tokens",
                "cache_write_tokens",
            )
        }
        cost = _cost_total([s["cost_usd"] for s in seats])
        reasons: dict[str, int] = {}
        for s in seats:
            for k, v in s["fallback_reasons"].items():
                reasons[k] = reasons.get(k, 0) + v
        fallbacks = _sum(s["fallbacks"] for s in seats)
        # per-game quantities use games in which the agent sat, not seat-games
        games_with = sum(1 for r in done if lab in r["seat_order"])
        a = {
            "agent": lab,
            "seat_games": n,
            "games": games_with,
            "wins": wins,
            "win_rate": wins / n if n else None,
            "win_ci": [lo, hi],
            "verdict": "n/a (holds every seat)"
            if len(labels) == 1
            else _verdict(lo, hi, chance, n),
            "mean_rank": rank_m,
            "mean_rank_ci": rank_h,
            "mean_score": statistics.fmean(o["score"] for o in obs),
            "margin_vs_bot": None if len(labels) == 1 else mar_m,
            "margin_vs_bot_ci": None if len(labels) == 1 else mar_h,
            "decisions": decisions,
            "fallbacks": fallbacks,
            "fallback_reasons": reasons,
            "fallback_rate": _per(fallbacks, decisions),
            "repairs": _sum(s["repairs"] for s in seats),
            "repair_rate": _per(_sum(s["repairs"] for s in seats), decisions),
            "retries": _sum(s.get("retries", 0) for s in seats),
            "retry_rate": _per(_sum(s.get("retries", 0) for s in seats), decisions),
            "calls": _sum(s["calls"] for s in seats),
            "latency_mean_ms": statistics.fmean(lat) if lat else None,
            "latency_p50_ms": percentile(lat, 0.5),
            "latency_p95_ms": percentile(lat, 0.95),
            "tokens": tokens,
            "tokens_per_game": {k: v / n for k, v in tokens.items()} if n else None,
            "tokens_per_decision": {k: v / decisions for k, v in tokens.items()}
            if decisions
            else None,
            "cost_usd": cost,
            "cost_per_game_usd": _per(cost, n),
            "cost_per_decision_usd": _per(cost, decisions),
            "cost_known": cost is not None,
            "trades_proposed": _sum(s["trades_proposed"] for s in seats),
            "trades_accepted": _sum(s["trades_accepted"] for s in seats),
            "trades_rejected": _sum(s["trades_rejected"] for s in seats),
            "declarations": _sum(s["declarations"] for s in seats),
        }
        out["agents"].append(a)

    out["warnings"].extend(_sample_warnings(out, chance))
    return out


def _verdict(lo: float, hi: float, chance: float, n: int) -> str:
    if lo > chance:
        return "above chance"
    if hi < chance:
        return "below chance"
    return "inconclusive"


def _sample_warnings(m: dict, chance: float) -> list[str]:
    games = m["games"]
    half = Z95 * math.sqrt(chance * (1 - chance) / games)
    need = (
        games_to_detect(0.40, chance)
        if chance == 0.25
        else games_to_detect(min(0.95, chance + 0.15), chance)
    )
    msgs = []
    if games < MIN_GAMES:
        msgs.append(
            f"Only {games} game(s): too few to distinguish a real edge from chance. "
            f"With {games} games the 95% interval on a win rate near {chance:.0%} is "
            f"about +/-{half * 100:.0f} points wide."
        )
    msgs.append(
        f"Chance win rate for {m['players']} players is {chance:.0%}. Detecting a true "
        f"{(0.40 if chance == 0.25 else chance + 0.15):.0%} win rate needs roughly "
        f"{need} games (80% power); smaller edges need many more."
    )
    return msgs


def build_report(matchups: dict[str, list[dict]], meta: dict | None = None) -> dict:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "meta": meta or {},
        "matchups": [aggregate_matchup(m, recs) for m, recs in matchups.items()],
    }


# ----------------------------------------------------------------- Markdown


def _pct(x):
    return "-" if x is None else f"{x * 100:.1f}%"


def _num(x, nd=2):
    return "-" if x is None else f"{x:.{nd}f}"


def _pm(x, h, nd=2):
    if x is None:
        return "-"
    return f"{x:.{nd}f}" if h is None else f"{x:.{nd}f} +/- {h:.{nd}f}"


def _usd(x, known=True, nd=4):
    return "unknown" if x is None or not known else f"${x:.{nd}f}"


def _tok(x):
    return "-" if x is None else f"{x:,.0f}"


def render_markdown(report: dict) -> str:
    lines = ["# Acquire benchmark report", ""]
    meta = report.get("meta") or {}
    lines.append(f"Generated {report['generated_at']}.")
    for k, v in meta.items():
        lines.append(f"- {k}: {v}")
    lines.append("")
    for m in report["matchups"]:
        lines += [f"## Matchup `{m['matchup']}`", ""]
        if not m["games"]:
            lines += [f"No completed games. {'; '.join(m['warnings'])}", ""]
            continue
        lo_seed, hi_seed = m["seed_range"]
        lines.append(
            f"{m['games']} completed games (seeds {lo_seed}-{hi_seed}), "
            f"{m['players']} players, mean {m['mean_turns']:.0f} turns; "
            f"chance win rate {_pct(m['chance_win_rate'])}. "
            f"End reasons: {m['end_reasons']}."
        )
        lines.append("")
        for w in m["warnings"]:
            lines.append(f"> **Note:** {w}")
        lines.append("")
        lines += [
            "### Strength",
            "",
            "| Agent | Seat-games | Win rate (95% Wilson) | Verdict | Mean rank (95% CI) | Score margin vs bot (95% CI) |",
            "|---|---:|---|---|---|---|",
        ]
        for a in m["agents"]:
            lines.append(
                f"| `{a['agent']}` | {a['seat_games']} | {_pct(a['win_rate'])} "
                f"[{_pct(a['win_ci'][0])}, {_pct(a['win_ci'][1])}] | {a['verdict']} | "
                f"{_pm(a['mean_rank'], a['mean_rank_ci'])} | "
                f"{_pm(a['margin_vs_bot'], a['margin_vs_bot_ci'], 0)} |"
            )
        lines += [
            "",
            "### Reliability and latency",
            "",
            "| Agent | Decisions | Fallback rate | Fallbacks by reason | Repair rate | Illegal retries/decision | Mean latency ms | p50 ms | p95 ms |",
            "|---|---:|---:|---|---:|---:|---:|---:|---:|",
        ]
        for a in m["agents"]:
            reasons = (
                ", ".join(f"{k}: {v}" for k, v in sorted(a["fallback_reasons"].items()))
                or "-"
            )
            lines.append(
                f"| `{a['agent']}` | {a['decisions']} | {_pct(a['fallback_rate'])} | {reasons} | "
                f"{_pct(a['repair_rate'])} | {_num(a['retry_rate'], 3)} | {_num(a['latency_mean_ms'], 1)} | "
                f"{_num(a['latency_p50_ms'], 1)} | {_num(a['latency_p95_ms'], 1)} |"
            )
        lines += [
            "",
            "### Tokens and cost",
            "",
            "| Agent | In tok/game | Out tok/game | Cache read tok/game | Cost/game | Cost/decision | Total cost |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ]
        for a in m["agents"]:
            tpg = a["tokens_per_game"] or {}
            lines.append(
                f"| `{a['agent']}` | {_tok(tpg.get('input_tokens'))} | {_tok(tpg.get('output_tokens'))} | "
                f"{_tok(tpg.get('cache_read_tokens'))} | {_usd(a['cost_per_game_usd'], a['cost_known'])} | "
                f"{_usd(a['cost_per_decision_usd'], a['cost_known'], 6)} | {_usd(a['cost_usd'], a['cost_known'])} |"
            )
        lines += [
            "",
            "### Trades and declarations",
            "",
            "| Agent | Proposed | Accepted (as responder) | Rejected (as responder) | End-game declarations |",
            "|---|---:|---:|---:|---:|",
        ]
        for a in m["agents"]:
            lines.append(
                f"| `{a['agent']}` | {a['trades_proposed']} | {a['trades_accepted']} | "
                f"{a['trades_rejected']} | {a['declarations']} |"
            )
        lines += [
            "",
            "### By seat position (seat-order bias check)",
            "",
            "| Position | Win rate (95% Wilson) | Mean rank |",
            "|---:|---|---:|",
        ]
        for p in m["positions"]:
            lines.append(
                f"| {p['position']} | {_pct(p['win_rate'])} "
                f"[{_pct(p['win_ci'][0])}, {_pct(p['win_ci'][1])}] | {_num(p['mean_rank'])} |"
            )
        lines.append("")
    lines += [
        "---",
        (
            "Win rate counts a tie for first as a split win. Seat-games of one agent that holds "
            "several seats in the same game are not independent, so its interval is somewhat "
            "optimistic. Costs are estimates from `bench/prices.json`; `unknown` means a price "
            "is missing there."
        ),
        "",
    ]
    return "\n".join(lines)
