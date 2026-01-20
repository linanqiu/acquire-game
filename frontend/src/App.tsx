import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { LobbyPage, PlayerPage, HostPage, NotFoundPage } from './pages'
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
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}

export default App
