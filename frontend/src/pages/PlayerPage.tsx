import { useRoom } from '../hooks/useRoom'

export function PlayerPage() {
  const room = useRoom()
  return (
    <div className="page player-page">
      <h1>Player View</h1>
      <p>Room: {room}</p>
    </div>
  )
}
