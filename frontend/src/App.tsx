import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { LobbyPage } from './pages/LobbyPage'
import { PlayerPage } from './pages/PlayerPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ToastProvider } from './components/ui/ToastProvider'
import { RulesetGate } from './ruleset/RulesetGate'
import './App.css'

// The home page and the player page are the game; the rest (host display, transcripts, the
// benchmark) load on first visit, so a phone downloads and parses less to start (BL-020).
const HostPage = lazy(() => import('./pages/HostPage').then((m) => ({ default: m.HostPage })))
const GamesPage = lazy(() => import('./pages/GamesPage').then((m) => ({ default: m.GamesPage })))
const TranscriptPage = lazy(() =>
  import('./pages/TranscriptPage').then((m) => ({ default: m.TranscriptPage }))
)
const BenchPage = lazy(() => import('./pages/BenchPage').then((m) => ({ default: m.BenchPage })))
const BenchSeriesPage = lazy(() =>
  import('./pages/BenchSeriesPage').then((m) => ({ default: m.BenchSeriesPage }))
)

export function App() {
  return (
    <ToastProvider>
      {/* Every page shows the server's ruleset (title, wording, board): load it first. */}
      <RulesetGate>
        <BrowserRouter>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<LobbyPage />} />
              <Route path="/play/:room" element={<PlayerPage />} />
              <Route path="/host/:room" element={<HostPage />} />
              <Route path="/games" element={<GamesPage />} />
              <Route path="/games/:gameId" element={<TranscriptPage />} />
              <Route path="/bench" element={<BenchPage />} />
              <Route path="/bench/series/:seriesId" element={<BenchSeriesPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </RulesetGate>
    </ToastProvider>
  )
}
