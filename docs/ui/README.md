# Buyout UI

The visual language lives in code: design tokens in `frontend/src/styles/tokens.css` (colours,
spacing, radii), chain colours in `frontend/src/styles/colors.css`, type in
`frontend/src/styles/typography.css`. Chain names and colours come from the ruleset
(`backend/rulesets/*.json`), not from the frontend. There is no separate UI spec; the screens
are covered, one by one, in [surface-coverage.md](../tests/surface-coverage.md).

Look (BL-014): neutral ink surfaces that separate by fill before a line, one accent (my turn, my playable tiles, the main button), the board as the only saturated thing, system sans-serif with tabular figures, information-dense, no glow and no CRT effects. A matching light theme.

## Routes (`frontend/src/App.tsx`)

| Route | Page | Use |
|-------|------|-----|
| `/` | `LobbyPage` | Create or join a game, watch bots play, links to games and bench |
| `/play/:room` | `PlayerPage` | Private player terminal (phone-first) |
| `/host/:room` | `HostPage` | Shared board for a TV or laptop |
| `/games`, `/games/:gameId` | `GamesPage`, `TranscriptPage` | Finished-game list and transcript replay |
| `/bench`, `/bench/series/:seriesId` | `BenchPage`, `BenchSeriesPage` | Buyout Bench leaderboard and series |
