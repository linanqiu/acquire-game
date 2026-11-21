# Deploying Buyout

One service serves everything: the React app, the HTTP API (also under `/api`) and
the WebSockets (`/ws/...`), all on one origin. The image is built from the repo root
by `deploy/Dockerfile` (Node stage builds `frontend/`, Python stage runs `backend/`).

## Railway

1. New project, deploy from this GitHub repo, one service. `railway.toml` already
   selects the Dockerfile, the `/health` healthcheck and the start command.
2. Generate a public domain for the service (Settings, Networking).
3. Set variables (all optional; none are required for bot-only play):

| Variable | Purpose |
|---|---|
| `ENVIRONMENT=prod` | Turns off FastAPI debug mode (the image already defaults to it). |
| `ALLOWED_ORIGINS` | Not needed: same-origin. Default `*`; narrow to your URL if you like. |
| `ANTHROPIC_API_KEY` | Enables the built-in Claude LLM players in "Add AI". |
| `GAME_LLM_OPENAI_BASE_URL`, `GAME_LLM_OPENAI_MODEL`, `GAME_LLM_OPENAI_API_KEY` | Adds one OpenAI-compatible model (e.g. DeepSeek). Needs base URL and model. |
| `GAME_LLM_CATALOG` | JSON list that replaces the default LLM entries. |
| `GAME_COMMENTARY_MODEL` | Which catalog entry writes the watch page's commentary lines (a catalog id such as `llm:claude-haiku-5-5`, or a model name). `rules` (or `off`): templated lines only, no model call. Unset: the catalog's Haiku entry when it has a key, else rules-only. About half a cent per watched game with Claude Haiku 5.5; see docs/ai/commentary.md. |
| `SHOW_SEATS` | The AI players of "Watch bots play", comma-separated catalog ids. Default `bot,bot,bot,bot` (free). An LLM seat here is paid for on every show anyone starts. |
| `GAME_LLM_LOG_DIR` | Writes JSONL decision logs with full prompts; leave unset unless debugging (no volume, so ephemeral). |
| `GAME_BRAND_NAME` | Product name shown as the site title, browser tab, headers and bench pages. Default `Buyout`. |
| `GAME_RULESET` | Theme and numbers: a file name in `backend/rulesets/` (`default`, `valley`, `mini`) or a path to a ruleset JSON. Default `default`. |
| `FRONTEND_DIST` | Override the built-app directory. The image default is correct. |
| `GAME_TRANSCRIPT_DIR` | Where every game's transcript (`<game_id>.jsonl`, served at `/games`) is written. Default `backend/data/transcripts/` inside the container; empty or `off` disables transcripts. Point it at a mounted volume (below) to keep them. |
| `GAME_BENCH_DIR` | Benchmark results served at `/bench/leaderboard`, `/bench/series/...` and `/games?source=bench`: one results directory from `python -m bench run --out ...`, or a parent of several. Default `backend/bench_results/`. |

**Transcripts and the disk.** Railway's container disk is ephemeral: every
redeploy or restart wipes `backend/data/transcripts/`, so finished-game
transcripts and the game list at `/games` start empty again. To keep them,
add a Railway volume (service Settings, Volumes, e.g. mounted at `/data`) and
set `GAME_TRANSCRIPT_DIR=/data/transcripts` (and, if you publish benchmark
results, copy a results directory there and set
`GAME_BENCH_DIR=/data/bench`). A fake-LLM or bot game is about 1-2 MB of
JSONL (an LLM game with real prompts is larger); plan the volume size or
prune old files. Files are written line by line, so a restart mid-game leaves
an unfinished transcript that the list shows as `abandoned`.

`PORT` is injected by Railway. Without an LLM key the LLM entries show as
unavailable and bots still work.

**The test-mode switch must stay unset.** It exposes routes that overwrite game
state. A test in `backend/tests/protocol/` fails if any deploy file mentions it.

State is in memory: a redeploy or restart ends running games (single replica only).

## Verify

- `https://<domain>/health` returns `{"status":"ok",...}`
- `https://<domain>/` shows the home page; create a game, add bots, start
- Reload `https://<domain>/play/<CODE>`: the game is still there
- `https://<domain>/api/agents/catalog` returns JSON

## Local

```bash
docker compose -f deploy/docker-compose.yml up --build   # http://localhost:8000
```

Without Docker: `cd frontend && npm ci && npm run build`, then
`cd backend && uvicorn main:app --port 8000` (the app is served automatically when
`frontend/dist` exists). For development keep using Vite (`npm run dev`), which
proxies `/api` and `/ws` to the backend.
