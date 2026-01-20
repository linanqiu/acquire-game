import { Link } from 'react-router-dom'

export function HomePage() {
  return (
    <div className="page home-page">
      <h1>Acquire</h1>
      <p>A classic board game of hotel chains and mergers</p>
      <nav>
        <Link to="/lobby">Enter Lobby</Link>
      </nav>
    </div>
  )
}
