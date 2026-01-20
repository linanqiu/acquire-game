import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { LobbyPage, PlayerPage, HostPage, NotFoundPage } from './pages'
import './App.css'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/play/:room" element={<PlayerPage />} />
        <Route path="/host/:room" element={<HostPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
