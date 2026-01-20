import { useParams, Link } from 'react-router-dom'

export function GamePage() {
  const { gameId } = useParams<{ gameId: string }>()

  return (
    <div className="page game-page">
      <h1>Game Room</h1>
      <p>Game ID: {gameId}</p>
      <nav>
        <Link to="/lobby">Back to Lobby</Link>
      </nav>
    </div>
  )
}
