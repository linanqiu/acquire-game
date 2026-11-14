import { BrowserRouter, Routes, Route } from 'react-router-dom'
import {
  LobbyPage,
  PlayerPage,
  HostPage,
  NotFoundPage,
  GamesPage,
  TranscriptPage,
  BenchPage,
  BenchSeriesPage,
} from './pages'
import { ToastProvider } from './components/ui'
import './App.css'

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
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
      </BrowserRouter>
    </ToastProvider>
  )
}

export default App
