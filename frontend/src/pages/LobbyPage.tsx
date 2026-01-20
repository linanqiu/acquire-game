import { Link } from 'react-router-dom'

export function LobbyPage() {
  return (
    <div className="page lobby-page">
      <h1>Game Lobby</h1>
      <p>Create or join a game room</p>
      <nav>
        <Link to="/">Back to Home</Link>
      </nav>
    </div>
  )
}
