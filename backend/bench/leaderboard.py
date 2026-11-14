"""Leaderboard for one protocol + prompt version (``GET /bench/leaderboard``).

``compute_leaderboard(records, protocol=..., prompt_version=..., track=...)``
returns the contract's shape::

    {"protocol": {id, description, players, games_per_matchup, seeds},
     "ruleset": {id, title, fingerprint}, "prompt_version", "track", "updated_at",
     "agents": [{agent_id, label, model, games, wins, win_rate, ci_low, ci_high,
                 mean_rank, rating, rating_ci, fallback_rate, retry_rate,
                 tokens_per_game, cost_per_game, latency_p50_s, verdict, ...}],
     "series": [{series_id, matchup, games, started_at, finished}],
     "available": {"protocols": [...], "prompt_versions": [...],
                   "rulesets": [{id, fingerprint}]},
     "rating": {method, anchor, anchor_rating, prior, bootstrap_samples},
     "games", "warnings"}

Only records of the chosen protocol, ruleset AND prompt version are used
(default: those of the most recent record, in that order). Results of
different ruleset fingerprints are never mixed. ``ruleset`` selects by id or
fingerprint; records written before rulesets existed count as classic. Unit for win rate / rank: a seat-game (the
three bot seats of a vs-baseline game are three seat-games; they are not
independent, so the bot's interval is optimistic). Rates are 0..1.
"""

from __future__ import annotations

import statistics
from collections.abc import Iterable

from bench.protocols import BASELINE, PROTOCOLS
from bench.rating import ANCHOR_RATING, bootstrap, bradley_terry
from bench.report import MIN_GAMES, wilson
from bench.runner import percentile
from game.ruleset import classic

BOT_LABEL = "Rules-based bot"


def _key(r: dict) -> str:
    return r.get("finished_at") or r.get("started_at") or ""


def record_ruleset(r: dict) -> tuple[str, str | None]:
    """``(ruleset id, fingerprint)`` of a game record (classic when absent)."""
    rid = r.get("ruleset_id") or "classic"
    fp = r.get("ruleset_fingerprint")
    if fp is None and rid == "classic":
        fp = classic().fingerprint
    return rid, fp


def select(
    records: Iterable[dict],
    protocol: str | None = None,
    prompt_version: str | None = None,
    ruleset: str | None = None,
) -> tuple[str | None, tuple[str, str | None] | None, str | None, list[dict]]:
    """``(protocol, (ruleset id, fingerprint), prompt_version, records)`` of
    one comparable group."""
    recs = [r for r in records if r.get("protocol")]
    if protocol is None and recs:
        protocol = max(recs, key=_key)["protocol"]
    recs = [r for r in recs if r["protocol"] == protocol]
    if ruleset is not None:
        recs = [r for r in recs if ruleset in record_ruleset(r)]
    chosen = max(recs, key=_key) if recs else None
    rs = record_ruleset(chosen) if chosen is not None else None
    recs = [r for r in recs if record_ruleset(r) == rs]
    if prompt_version is None and recs:
        prompt_version = max(recs, key=_key).get("prompt_version")
    recs = [r for r in recs if r.get("prompt_version") == prompt_version]
    return protocol, rs, prompt_version, recs


def _verdict(lo: float, hi: float, chance: float, n: int) -> str:
    if lo > chance:
        v = "above chance"
    elif hi < chance:
        v = "below chance"
    else:
        v = "inconclusive"
    if n < MIN_GAMES:
        v += f" (only {n} games; need {MIN_GAMES}+)"
    return v


def compute_leaderboard(
    records: Iterable[dict],
    *,
    protocol: str | None = None,
    prompt_version: str | None = None,
    ruleset: str | None = None,
    track: str = "all",
    bootstrap_samples: int = 200,
    seed: int = 0,
) -> dict:
    """Leaderboard of one protocol + ruleset + prompt version (see module doc).
    ``track``: ``all`` | ``vs-baseline`` | ``head-to-head``."""
    records = list(records)
    available_protocols = sorted({r["protocol"] for r in records if r.get("protocol")})
    protocol, rs, prompt_version, recs = select(
        records, protocol, prompt_version, ruleset
    )
    versions = sorted(
        {
            r.get("prompt_version")
            for r in records
            if r.get("protocol") == protocol
            and record_ruleset(r) == rs
            and r.get("prompt_version")
        }
    )
    available_rulesets = sorted(
        {record_ruleset(r) for r in records if r.get("protocol") == protocol},
        key=lambda t: (t[0], t[1] or ""),
    )
    rs_titles = {}
    for r in records:
        rid, fp = record_ruleset(r)
        if r.get("ruleset_title"):
            rs_titles[(rid, fp)] = r["ruleset_title"]
    if track != "all":
        recs = [r for r in recs if r.get("track") == track]
    done = [r for r in recs if r.get("status") == "completed"]
    proto = PROTOCOLS.get(protocol or "")
    proto_public = (
        proto.public()
        if proto
        else {
            "id": protocol,
            "description": "",
            "players": None,
            "games_per_matchup": None,
            "seeds": [],
        }
    )

    # -- per-agent observations (one per seat-game)
    obs: dict[str, list[dict]] = {}
    meta: dict[str, dict] = {}
    games_for: dict[str, set] = {}
    ranked_games = []
    for r in done:
        by_pos = {s["pos"]: s for s in r["standings"]}
        labels = r.get("seat_labels") or r["seat_order"]
        ranked_games.append(
            [(r["seat_order"][s["pos"]], s["rank"]) for s in r["standings"]]
        )
        n_win = len(r["winners"])
        for seat in r["seats"]:
            aid = seat["agent"]
            st = by_pos[seat["pos"]]
            obs.setdefault(aid, []).append(
                {
                    "seat": seat,
                    "rank": st["rank"],
                    "win": (1 / n_win) if seat["pos"] in r["winners"] else 0.0,
                }
            )
            games_for.setdefault(aid, set()).add(r.get("game_id") or r.get("key"))
            m = meta.setdefault(aid, {"label": labels[seat["pos"]], "model": None})
            m["model"] = m["model"] or seat.get("model")

    ratings = bradley_terry(ranked_games) if ranked_games else {}
    cis = (
        bootstrap(ranked_games, samples=bootstrap_samples, seed=seed)
        if ranked_games and bootstrap_samples > 0
        else {}
    )
    players = (proto_public.get("players") or 4) if done else 4
    chance = 1 / players

    agents = []
    for aid, rows in obs.items():
        n = len(rows)
        wins = sum(o["win"] for o in rows)
        lo, hi = wilson(wins, n)
        seats = [o["seat"] for o in rows]
        decisions = sum(s["decisions"] for s in seats)
        fallbacks = sum(s["fallbacks"] for s in seats)
        retries = sum(s.get("retries", 0) for s in seats)
        tokens = sum(s["input_tokens"] + s["output_tokens"] for s in seats)
        costs = [s.get("cost_usd") for s in seats]
        cost = None if any(c is None for c in costs) else sum(costs)
        lat = [x / 1000 for s in seats for x in s.get("latencies_ms") or []]
        is_anchor = aid == BASELINE
        agents.append(
            {
                "agent_id": aid,
                "label": BOT_LABEL if is_anchor else meta[aid]["label"],
                "model": meta[aid]["model"],
                "games": len(games_for[aid]),
                "seat_games": n,
                "wins": round(wins, 4),
                "win_rate": wins / n if n else 0.0,
                "ci_low": lo,
                "ci_high": hi,
                "mean_rank": statistics.fmean(o["rank"] for o in rows),
                "rating": round(ratings.get(aid, ANCHOR_RATING), 1),
                "rating_ci": (
                    [round(cis[aid][0], 1), round(cis[aid][1], 1)]
                    if aid in cis and not is_anchor
                    else [ANCHOR_RATING, ANCHOR_RATING]
                    if is_anchor
                    else None
                ),
                "fallback_rate": fallbacks / decisions if decisions else 0.0,
                "retry_rate": retries / decisions if decisions else 0.0,
                "tokens_per_game": tokens / n if n else 0,
                "cost_per_game": None if cost is None else cost / n,
                "latency_p50_s": percentile(lat, 0.5),
                "verdict": "baseline (rating anchor)"
                if is_anchor
                else _verdict(lo, hi, chance, n),
                "decisions": decisions,
                "is_anchor": is_anchor,
            }
        )
    agents.sort(key=lambda a: (-a["rating"], a["agent_id"]))

    series: dict[str, dict] = {}
    for r in recs:
        sid = r.get("series_id")
        if not sid:
            continue
        s = series.setdefault(
            sid,
            {
                "series_id": sid,
                "matchup": r.get("matchup"),
                "track": r.get("track"),
                "games": 0,
                "planned": r.get("series_games"),
                "started_at": r.get("started_at"),
                "finished": False,
            },
        )
        if r.get("status") == "completed":
            s["games"] += 1
        if r.get("started_at") and (
            s["started_at"] is None or r["started_at"] < s["started_at"]
        ):
            s["started_at"] = r["started_at"]
    full = (proto_public.get("games_per_matchup") or 0) if proto else 0
    for s in series.values():
        s["finished"] = bool(s["planned"]) and s["games"] >= s["planned"]
        s["full_protocol"] = bool(full) and s["games"] >= full

    warnings = []
    stalled = [r for r in recs if r.get("status") != "completed"]
    if stalled:
        warnings.append(f"{len(stalled)} game(s) stalled and are excluded")
    if len({fp for _, fp in available_rulesets}) > 1:
        warnings.append(
            f"results exist for other rulesets of {protocol}: "
            + ", ".join(f"{i} ({fp})" for i, fp in available_rulesets if (i, fp) != rs)
            + " (not mixed into this table)"
        )
    if len(versions) > 1:
        warnings.append(
            f"other prompt versions exist for {protocol}: "
            + ", ".join(v for v in versions if v != prompt_version)
            + " (not mixed into this table)"
        )
    return {
        "protocol": proto_public,
        "ruleset": {
            "id": rs[0] if rs else None,
            "title": rs_titles.get(rs) if rs else None,
            "fingerprint": rs[1] if rs else None,
        },
        "prompt_version": prompt_version,
        "track": track,
        "updated_at": max((_key(r) for r in recs), default=None) or None,
        "games": len(done),
        "agents": agents,
        "series": sorted(series.values(), key=lambda s: s["series_id"]),
        "available": {
            "protocols": available_protocols,
            "prompt_versions": versions,
            "rulesets": [{"id": i, "fingerprint": fp} for i, fp in available_rulesets],
        },
        "rating": {
            "method": "pairwise Bradley-Terry (full rank-breaking), Elo scale",
            "anchor": BASELINE,
            "anchor_rating": ANCHOR_RATING,
            "prior": "1 virtual half-won comparison per agent vs the anchor",
            "bootstrap_samples": bootstrap_samples,
        },
        "warnings": warnings,
    }


def render_leaderboard_md(board: dict) -> str:
    p = board["protocol"]
    lines = [
        f"## Leaderboard: `{p['id']}` / ruleset `{board['ruleset']['id']}` "
        f"/ prompt `{board['prompt_version']}` "
        f"(track: {board['track']}, {board['games']} games)",
        "",
        "| # | Agent | Rating [95% CI] | Win rate [95% Wilson] | Mean rank | "
        "Fallback | Retries/dec | Tokens/game | Cost/game | p50 latency | Verdict |",
        "|---:|---|---|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for i, a in enumerate(board["agents"], 1):
        ci = a["rating_ci"]
        rating = f"{a['rating']:.0f}" + (
            f" [{ci[0]:.0f}, {ci[1]:.0f}]" if ci and not a["is_anchor"] else " (anchor)"
        )
        cost = "unknown" if a["cost_per_game"] is None else f"${a['cost_per_game']:.4f}"
        lat = "-" if a["latency_p50_s"] is None else f"{a['latency_p50_s']:.3f} s"
        lines.append(
            f"| {i} | `{a['agent_id']}` | {rating} | {a['win_rate'] * 100:.1f}% "
            f"[{a['ci_low'] * 100:.1f}, {a['ci_high'] * 100:.1f}] | "
            f"{a['mean_rank']:.2f} | {a['fallback_rate'] * 100:.1f}% | "
            f"{a['retry_rate']:.3f} | {a['tokens_per_game']:,.0f} | {cost} | {lat} | "
            f"{a['verdict']} |"
        )
    for w in board.get("warnings") or []:
        lines.append(f"\n> {w}")
    lines.append("")
    return "\n".join(lines)
