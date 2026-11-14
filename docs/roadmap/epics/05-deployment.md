# Epic 5: Deployment

## Overview

Deploy the application to Railway with proper WebSocket support, environment configuration, and monitoring. This epic is **fully independent** and can run in parallel with frontend/AI work.

## Goals

- Deploy backend to Railway
- Configure WebSocket proxy
- Set up environment variables
- Implement health checks
- Add logging and observability

## Tech Stack

- **Platform**: Railway
- **Container**: Docker (already configured)
- **Monitoring**: Railway metrics + custom logging

## Stories

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [DP-001](../stories/05-deployment/DP-001.md) | Railway Setup | S | None | not-started |
| [DP-002](../stories/05-deployment/DP-002.md) | Environment Config | S | DP-001 | not-started |
| [DP-003](../stories/05-deployment/DP-003.md) | WebSocket Proxy | M | DP-001, RT-001 | not-started |
| [DP-004](../stories/05-deployment/DP-004.md) | Health Monitoring | S | DP-001 | not-started |
| [DP-005](../stories/05-deployment/DP-005.md) | Logging & Observability | M | DP-001 | not-started |

## Dependency Graph

```
DP-001 (Railway Setup)
   │
   ├── DP-002 (Environment Config)
   ├── DP-004 (Health Monitoring)
   ├── DP-005 (Logging)
   │
   └── DP-003 (WebSocket Proxy) ◄── RT-001 (needs frontend WS client for testing)
```

## Existing Infrastructure

Already configured in `/deploy/`:
- `Dockerfile` - Container build
- `docker-compose.yml` - Local development

> **Note**: `railway.toml` was temporarily removed to prevent deployment costs while the frontend is not available. DP-001 includes recreating this file.

## Success Criteria

- [ ] Backend accessible via Railway URL
- [ ] WebSocket connections work through proxy
- [ ] Environment variables properly configured
- [ ] Health endpoint returns 200
- [ ] Logs visible in Railway dashboard
- [ ] E2E tests pass against deployed instance

## Reference

- [deploy/Dockerfile](../../deploy/Dockerfile)
- [deploy/railway.toml](../../deploy/railway.toml)
- [Railway Docs](https://docs.railway.app/)

## Update 2026-11-14: single-service frontend serving

The deploy used to ship only the backend. `deploy/Dockerfile` is now multi-stage
(Node builds `frontend/dist`, the Python image serves it), and the FastAPI app
serves the built SPA with an `index.html` fallback for client routes. All HTTP API
routes are also exposed under `/api` (the bare routes remain for tests and the Vite
dev proxy). One Railway service now serves UI, API and WebSockets from one origin.
See [deploy/README.md](../../../deploy/README.md). Verified locally (backend only)
and in a built container: create game, add bots, play turns, reload `/play/<code>`.
