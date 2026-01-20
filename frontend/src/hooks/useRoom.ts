import { useParams } from 'react-router-dom'

export function useRoom() {
  const { room } = useParams<{ room: string }>()
  return room?.toUpperCase() ?? ''
}
