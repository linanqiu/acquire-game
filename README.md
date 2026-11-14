# Acquire

Acquire, the 1960s hotel-chain board game, playable online in the browser with 3 to 6 seats. Each
seat is a human, a rules-based bot, or an LLM opponent. Players can also trade stock with each
other, including with AI seats.

[![CI](https://github.com/linanqiu/acquire-game/actions/workflows/ci.yml/badge.svg)](https://github.com/linanqiu/acquire-game/actions/workflows/ci.yml)

- **Play**: create a game on the home page, share the 4-letter room code, add friends (phones or
  laptops) and AI seats, start. A shared screen can show the board ("Watch bots play" opens that
  host view for an all-AI table).
- **Opponents**: the rules-based bot is always available. Claude models (and one
  OpenAI-compatible model, e.g. DeepSeek) appear in the "Add AI" menu; they are selectable only when
  the server has the matching API key, otherwise they are shown disabled.
- **Trading**: any player can propose stock/cash trades out of turn. LLM seats answer and propose
  trades too.
- **Transcripts** (in progress, [Epic 12](docs/roadmap/epics/12-acquire-bench.md)): every game
  keeps a complete log of every move and, for AI seats, exactly what the model was shown and what it
  returned, including rejected attempts and retries. The plan is that anyone can browse recent
  games and step through a replay; hands and private AI notes of a running game stay hidden until it
  ends. Format: the last section of the [seat contract](docs/architecture/seat-contract.md).
- **Acquire Bench** (in progress): a versioned benchmark where models of different strength play
  each other and the rules-based bot. It is meant to be runnable on its own (command and Python
  API, JSON output, exit codes) and to appear as a leaderboard page that links to the transcripts.
  A headless harness already exists (see [Acquire Bench](#acquire-bench)); no real-model results have
  been published yet.

How an AI seat behaves: it is asked one decision at a time. An illegal answer is sent back to the
model with the reason so it can try again (default up to 4 retries, planned: today one repair);
only a timeout, provider error or exhausted retries hand that single decision to the rules-based
player, and the table is told. Details: [Epic 9](docs/roadmap/epics/09-llm-bot.md).

Status and plans live in the [roadmap](docs/roadmap/README.md). Reinforcement-learning training was
dropped; old notes under `docs/ai/` are historical.

---

## Run it locally

Prerequisites: Python 3.11+ (CI runs 3.11 and 3.12) and Node.js 20+.

```bash
git clone https://github.com/linanqiu/acquire-game.git
cd acquire-game

python3 -m venv venv && source venv/bin/activate
pip install -r backend/requirements.txt
cd frontend && npm ci && cd ..

# terminal 1: backend on :8000
cd backend && uvicorn main:app --reload --host 127.0.0.1 --port 8000
# terminal 2: frontend on :5173 (proxies /api and /ws to the backend)
cd frontend && npm run dev
```

Open http://127.0.0.1:5173. `./dev.sh setup` and `./dev.sh dev` do the same steps in one script
(`./dev.sh` with no arguments lists its commands).

To enable LLM opponents, set the key before starting the backend, for example
`export ANTHROPIC_API_KEY=...` (built-in Claude entries), or
`ACQUIRE_LLM_OPENAI_BASE_URL`, `ACQUIRE_LLM_OPENAI_MODEL`, `ACQUIRE_LLM_OPENAI_API_KEY` for one
OpenAI-compatible model. Without a key only the rules-based bot can be added.

Serving the built app from the backend alone (what production does):

```bash
cd frontend && npm run build && cd ../backend && uvicorn main:app --port 8000   # http://127.0.0.1:8000
# or: docker compose -f deploy/docker-compose.yml up --build
```

## Tests

Four tiers ([Epic 11](docs/roadmap/epics/11-test-pyramid.md)); rules are tested once, in tier 1.

| Tier | What | Command (from repo root) |
|------|------|--------------------------|
| 1 Engine | Rules, decisions API, snapshots, calculator, prompts, agents, bench harness | `cd backend && pytest tests -q` (add `-m "not slow"` for the 12 s loop; the full run takes about 2 minutes) |
| 2 Protocol | Server driven in-process with scripted/fake seats: full games, reconnects, concurrency | included in the command above (`backend/tests/protocol/`) |
| 3 Screen | Playwright, one screen state per test, loaded from generated snapshots | `cd frontend && npm run e2e:screens` |
| 4 Journey | Playwright, true end-to-end flows starting at the home page | `cd frontend && npm run e2e:journeys` |

`cd frontend && npm run e2e` runs screens, journeys and the transcripts journey; `npm run e2e:ci`
runs only the `@ci`-tagged journeys. Which test covers which user-visible surface:
[docs/tests/surface-coverage.md](docs/tests/surface-coverage.md) (`python scripts/check-surface-coverage.py`
fails if a surface lost its test). The old 10-minute scenario suite was retired; see
[docs/tests/legacy-suite-retirement.md](docs/tests/legacy-suite-retirement.md).
Playwright starts both servers itself, with `ACQUIRE_TEST_MODE=1` and `ACQUIRE_GAME_SEED=2`; install the
browser once with `cd frontend && npx playwright install chromium`.

Other checks: `cd frontend && npm test` (Vitest), `npm run typecheck`, `npm run lint`;
`./scripts/verify-change.sh` (lint, format check, fast backend tests, surface coverage check, typecheck) and
`./scripts/verify-full.sh` (adds all backend tests, frontend unit tests and the `@ci` journeys).
Snapshot fixtures for tier 3 are generated by real play: `cd backend && python -m fixtures_gen`
(never edit them by hand; `backend/tests/test_fixture_provenance.py` checks them).

Lint and format (CI runs both): `ruff check backend/ && ruff format --check backend/`
(`pip install ruff`).

## Acquire Bench

`backend/bench/` plays full games headlessly (no browser, no WebSocket) and reports win rate with
confidence intervals, mean rank, score margin against the bot, retries/fallbacks, latency, tokens
and cost. From `backend/`:

```bash
python -m bench --matchup bot,bot,bot,bot --games 20                              # heuristic sanity run
ACQUIRE_TEST_MODE=1 python -m bench --matchup llm:fake,bot,bot,bot --games 8     # LLM code path, offline
python -m bench --matchup llm:claude-haiku-5-5,bot,bot,bot --games 4 --max-decisions 2000   # needs ANTHROPIC_API_KEY
```

Exit codes: 0 all games finished, 1 stopped early or a game stalled, 2 configuration error. Real
models need prices in `backend/bench/prices.json` (shipped as `null`; nothing is invented) for
`--max-usd`. Planned and not built yet: a versioned protocol (`acquire-bench-v1`), a documented
Python API and `--json` mode, transcripts, ratings, the leaderboard page. See
[docs/ai/benchmarking.md](docs/ai/benchmarking.md).

## Deploy

One Railway service serves the UI, the HTTP API and the WebSockets from one origin; single replica;
game state is in memory, so a redeploy ends running games. Setup, variables and checks are in
[deploy/README.md](deploy/README.md). Never set `ACQUIRE_TEST_MODE` in production. Transcripts
(when built) need a persistent volume to survive redeploys; that is an open item
([AB-008](docs/roadmap/stories/12-acquire-bench/AB-008.md)).

---

## How it is built

```
Browser (React, Zustand)  <-- WebSocket: state -->  FastAPI (backend/main.py, api/, seats.py)
        |                                                 |
        +-------- HTTP: actions, lobby, catalog --------->+-- Game engine (backend/game/)
                                                          +-- Seats: human | bot | LLM | scripted
```

- **Engine** (`backend/game/`): board, hotel chains, rules, players, plus the seam used by every
  seat: `decisions.py` (who must decide what, what is legal, one `apply_action` entry point), an
  append-only event log, `snapshot.py` (save/restore a whole game), `calculator.py` (exact public
  figures for agents).
- **Seats** (`backend/seats.py`, `backend/agents/`): a per-room driver asks the seat whose decision
  is pending (humans act over WebSocket/HTTP; bots, LLMs and scripted players through agents) and
  applies the answer through the same path for all of them. LLM seats live in `backend/agents/llm/`
  (providers, prompt builder, schema, agent, catalog).
- **Frontend** (`frontend/src`): lobby, player view, host view, trading UI.
- **Contract**: [docs/architecture/seat-contract.md](docs/architecture/seat-contract.md) is the
  authoritative description of actions, events, snapshots, the driver, HTTP routes, transcripts
  and the benchmark.

## Working on the project

- Roadmap and stories: [docs/roadmap/README.md](docs/roadmap/README.md). Pick a story, check its
  dependencies, follow its acceptance criteria. Agent-specific workflow, testing rules and the
  post-implementation review checklist are in [CLAUDE.md](CLAUDE.md).
- Before committing: `ruff format backend && ruff check backend`, then the tests above.
- Commit messages: imperative, descriptive. Include tests with new code.

## Game rules

See [`docs/rules/`](docs/rules/). In short: 3 to 6 players place tiles on a 12x9 grid; adjacent tiles
form hotel chains (seven chains); buy up to 3 shares a turn; mergers pay bonuses to the majority
and minority stockholders; the game ends when a chain reaches 41 tiles or all chains on the board
are safe (11+ tiles) and a player declares it; the winner has the most cash after liquidating all
stock.

## License

MIT
