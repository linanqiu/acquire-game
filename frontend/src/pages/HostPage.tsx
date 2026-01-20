import { useRoom } from '../hooks/useRoom'

export function HostPage() {
  const room = useRoom()
  return (
    <div className="page host-page">
      <h1>Host View</h1>
      <p>Room: {room}</p>
    </div>
  )
}
