# Epic 6: Security Hardening

> Harden security before production deployment. Run after MVP and E2E tests are complete.

## Overview

This epic addresses security gaps identified during code review that must be resolved before production deployment. While the game logic is solid, the API layer needs hardening against common attack vectors.

## Stories (5 total)

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [SH-001](../stories/06-security-hardening/SH-001.md) | Enforce Session Token Validation | S | GU-016 | `not-started` |
| [SH-002](../stories/06-security-hardening/SH-002.md) | Rate Limit REST Endpoints | S | None | `not-started` |
| [SH-003](../stories/06-security-hardening/SH-003.md) | Configure CORS | XS | None | `not-started` |
| [SH-004](../stories/06-security-hardening/SH-004.md) | Sanitize Player Name Input | XS | None | `not-started` |
| [SH-005](../stories/06-security-hardening/SH-005.md) | Room Cleanup and Memory Management | M | None | `not-started` |

## Context

Security issues identified in holistic review:
- Session tokens are optional for backward compatibility (should be mandatory)
- REST endpoints (`/create`, `/join`, `/start`, `/add-bot`) have no rate limiting
- No CORS configuration (allows any origin)
- Player names not sanitized (potential XSS if displayed raw)
- Rooms persist indefinitely if players disconnect without cleanup

## Success Criteria

- [ ] All session tokens validated on every request
- [ ] Rate limiting applied to all endpoints (REST and WebSocket)
- [ ] CORS configured with explicit allowed origins
- [ ] Player names sanitized on input
- [ ] Stale rooms cleaned up automatically
- [ ] Security tests added for each hardening measure

## Technical Notes

### Rate Limiting Strategy
Existing `RateLimiter` class in `main.py` can be reused for REST endpoints.

### CORS Configuration
FastAPI's `CORSMiddleware` - configure `allow_origins` based on environment.

### Room Cleanup
Add background task to periodically check for stale rooms (no active connections for X minutes).

## Parallelization

All stories except SH-001 can run in parallel. SH-001 depends on E2E tests being complete (GU-016) to avoid breaking existing flows.

```
SH-002 ─┐
SH-003 ─┼─→ All independent, run in parallel
SH-004 ─┤
SH-005 ─┘

GU-016 → SH-001 (after E2E complete)
```
