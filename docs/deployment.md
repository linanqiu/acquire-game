# Deployment

The game deploys as a **single Docker container**: `deploy/Dockerfile` builds the
React frontend (stage 1, Node) and bakes the resulting `dist/` into the Python
backend image (stage 2). FastAPI serves the API, the `/ws/*` WebSockets, **and**
the static frontend from one origin, so no CORS or `VITE_WS_URL` configuration
is needed — the frontend already uses same-origin relative URLs for both REST
(`/api/*`, rewritten server-side) and WebSockets (`/ws/*`).

> The Dockerfile cannot be built on the dev machine (no Docker available there);
> it is validated by the hosting provider's build on every deploy.

## Primary: Render (free tier, $0/month)

Chosen after comparing Render, Fly.io, Railway, Koyeb, and Google Cloud Run
(July 2026 — see comparison below). Render's free tier supports Docker builds,
WebSockets, and native auto-deploy from GitHub, with zero cost and no credit
card required.

### One-time setup (~5 minutes)

1. Go to <https://render.com> and click **Get Started** → sign up with your
   GitHub account (this simultaneously authorizes Render's GitHub app).
2. If asked which repositories to grant access to, select
   `linanqiu/acquire-game` (or "All repositories").
3. In the Render dashboard, click **New +** → **Blueprint**.
4. Select the `linanqiu/acquire-game` repository. Render detects `render.yaml`
   at the repo root and shows the `acquire-game` web service (plan: **Free**).
5. Click **Apply** (or **Deploy Blueprint**). The first build takes ~5–10
   minutes (npm ci + vite build + pip install inside Docker).
6. When the deploy is live, note the public URL — normally
   `https://acquire-game.onrender.com`. If the name was taken, Render appends a
   suffix (e.g. `acquire-game-xyz1.onrender.com`); in that case edit the
   `ALLOWED_ORIGINS` value in `render.yaml` (or in the dashboard under
   **Environment**) to match the real URL and push/redeploy.
7. Open the URL on your phone, create a game, and play.

### What happens after setup

- **Every push to `main` auto-deploys** (`autoDeploy: true` in `render.yaml`).
  Render builds `deploy/Dockerfile` and swaps the service once `/health`
  passes. No GitHub Actions or manual steps.
- **Cost: $0/month.** The free tier includes 750 instance-hours/month per
  workspace — more than a full month for one always-on service.
- **Cold starts:** the free instance spins down after **15 minutes** with no
  inbound traffic (HTTP or WebSocket messages both count as traffic). The next
  request wakes it, taking up to ~1 minute. Fine for casual playtesting: the
  first person to open the page waits, everyone else is instant. Note that
  spin-down wipes all in-memory state, so an *idle* game older than 15 minutes
  is lost — finish games in one sitting.
- **Single instance, in-memory state:** games live in process memory. A deploy
  or restart also resets active games, so avoid pushing to `main` mid-game.

## Runner-up: Koyeb (free tier, $0/month)

If Render's ~1 minute cold start becomes annoying, Koyeb's free tier is the
best alternative: one free service (0.1 vCPU / 512 MB), Docker builds from
GitHub with auto-deploy, WebSockets supported, and it only scales to zero
after **1 hour** idle with a ~1–5 s wake-up (their "Light Sleep" snapshotting
can cut this to ~200 ms). Setup is similar: sign up at koyeb.com with GitHub,
create a Web Service from the repo, set the Dockerfile path to
`deploy/Dockerfile`, health check `/health`, env vars `ENVIRONMENT=production`
and `ALLOWED_ORIGINS=<your koyeb URL>`. Trade-off: 0.1 vCPU is slim (fine for
2 players + bots) and there is no blueprint file — config lives in the Koyeb
dashboard.

## Also considered (July 2026)

| Provider | Cost | Verdict |
|---|---|---|
| **Render free** | $0 | **Winner** — Docker + WS + blueprint auto-deploy; 15 min spin-down, ~1 min cold start |
| **Koyeb free** | $0 | Runner-up — 1 h idle window, 1–5 s cold start, but 0.1 vCPU and dashboard-only config |
| **Fly.io** | ~$2–3/mo | No free tier for new accounts (killed 2024); credit card required; no native git auto-deploy (needs GitHub Actions) |
| **Railway hobby** | $5/mo minimum | Works today via `railway.toml` (kept in repo); flat $5 subscription even when idle |
| **Google Cloud Run** | ~$0 within free tier | WebSockets GA and generous free tier, but requires a GCP project, billing account, and Cloud Build trigger setup — most friction |

## Railway (kept working)

`railway.toml` still points at `deploy/Dockerfile` with the `/health` check and
now ships the frontend too (multi-stage build). If you ever prefer Railway's
$5/mo hobby plan over free-tier cold starts, connect the repo in Railway and it
works unchanged.

## How static serving works (backend/main.py)

- `STATIC_DIR` env var points at the built frontend (the image sets
  `/app/static`; default is `../frontend/dist` relative to `backend/`).
- If `STATIC_DIR/index.html` exists, the backend registers — *after* all API
  and WebSocket routes, so they are never shadowed:
  - an ASGI rewrite that strips the `/api` prefix from HTTP paths (mirroring
    the Vite dev proxy, since the frontend fetches `/api/create` etc.),
  - a `/assets` static mount for the hashed JS/CSS bundles,
  - a catch-all GET route serving files with SPA fallback to `index.html`
    (so deep links like `/host/ABCD` work).
- If `STATIC_DIR` doesn't exist (local dev, CI), none of this activates —
  `npm run dev` + uvicorn and the test suite behave exactly as before.

Local smoke test:

```bash
cd frontend && npm run build
cd ../backend
STATIC_DIR=../frontend/dist uvicorn main:app --port 8000
# curl localhost:8000/          -> index.html
# curl localhost:8000/health    -> {"status":"ok",...}
# curl localhost:8000/host      -> index.html (SPA fallback)
```
