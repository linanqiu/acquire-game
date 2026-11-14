# Deploying Acquire

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
| `ACQUIRE_LLM_OPENAI_BASE_URL`, `ACQUIRE_LLM_OPENAI_MODEL`, `ACQUIRE_LLM_OPENAI_API_KEY` | Adds one OpenAI-compatible model (e.g. DeepSeek). Needs base URL and model. |
| `ACQUIRE_LLM_CATALOG` | JSON list that replaces the default LLM entries. |
| `ACQUIRE_LLM_LOG_DIR` | Writes JSONL decision logs with full prompts; leave unset unless debugging (no volume, so ephemeral). |
| `FRONTEND_DIST` | Override the built-app directory. The image default is correct. |

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
