import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageShell } from '../components/ui/PageShell'
import { Card } from '../components/ui/Card'
import { TextInput } from '../components/ui/TextInput'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/useToast'
import styles from './LobbyPage.module.css'

export function LobbyPage() {
  const navigate = useNavigate()
  const { toast } = useToast()

  // Create game state
  const [createName, setCreateName] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')

  // Join game state
  const [joinName, setJoinName] = useState('')
  const [joinRoom, setJoinRoom] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)
  const [joinError, setJoinError] = useState('')

  const validateName = (name: string): string | null => {
    if (!name.trim()) {
      return 'Name is required'
    }
    if (name.length > 20) {
      return 'Name must be 20 characters or less'
    }
    return null
  }

  const handleCreate = async () => {
    setCreateError('')

    const nameError = validateName(createName)
    if (nameError) {
      setCreateError(nameError)
      return
    }

    setCreateLoading(true)
    try {
      const formData = new URLSearchParams()
      formData.append('player_name', createName.trim())

      const res = await fetch('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || 'Failed to create game')
      }

      // Store credentials for WebSocket auth
      sessionStorage.setItem('player_id', data.player_id)
      sessionStorage.setItem('session_token', data.session_token)
      sessionStorage.setItem('player_name', createName.trim())

      toast('Game created!', 'success')
      navigate(`/play/${data.room_code}?is_host=1`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setCreateError(message)
      toast(message, 'error')
    } finally {
      setCreateLoading(false)
    }
  }

  const handleJoin = async () => {
    setJoinError('')

    const nameError = validateName(joinName)
    if (nameError) {
      setJoinError(nameError)
      return
    }

    const roomCode = joinRoom.trim().toUpperCase()
    if (roomCode.length !== 4) {
      setJoinError('Room code must be 4 characters')
      return
    }

    setJoinLoading(true)
    try {
      const formData = new URLSearchParams()
      formData.append('player_name', joinName.trim())
      formData.append('room_code', roomCode)

      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || 'Failed to join game')
      }

      // Store credentials for WebSocket auth
      sessionStorage.setItem('player_id', data.player_id)
      sessionStorage.setItem('session_token', data.session_token)
      sessionStorage.setItem('player_name', joinName.trim())

      toast('Joined game!', 'success')
      navigate(`/play/${data.room_code}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setJoinError(message)
      toast(message, 'error')
    } finally {
      setJoinLoading(false)
    }
  }

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !createLoading) {
      handleCreate()
    }
  }

  const handleJoinKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !joinLoading) {
      handleJoin()
    }
  }

  return (
    <PageShell header={null}>
      <div className={styles.lobby}>
        <h1 className={styles.title}>ACQUIRE</h1>
        <p className={styles.subtitle}>A classic board game of hotel chains and mergers</p>

        <div className={styles.forms}>
          <Card title="CREATE GAME" className={styles.card}>
            <div className={styles.formContent}>
              <TextInput
                label="Your Name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={handleCreateKeyDown}
                maxLength={20}
                error={createError}
                placeholder="Enter your name"
                data-testid="create-name-input"
              />
              <Button
                fullWidth
                loading={createLoading}
                onClick={handleCreate}
                data-testid="create-button"
              >
                CREATE
              </Button>
            </div>
          </Card>

          <Card title="JOIN GAME" className={styles.card}>
            <div className={styles.formContent}>
              <TextInput
                label="Your Name"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                onKeyDown={handleJoinKeyDown}
                maxLength={20}
                placeholder="Enter your name"
                data-testid="join-name-input"
              />
              <TextInput
                label="Room Code"
                value={joinRoom}
                onChange={(e) => setJoinRoom(e.target.value)}
                onKeyDown={handleJoinKeyDown}
                maxLength={4}
                autoCapitalize
                error={joinError}
                placeholder="XXXX"
                data-testid="join-room-input"
              />
              <Button
                fullWidth
                loading={joinLoading}
                onClick={handleJoin}
                data-testid="join-button"
              >
                JOIN
              </Button>
            </div>
          </Card>
        </div>

        <p className={styles.meta}>3-6 players &middot; ~60 min</p>
      </div>
    </PageShell>
  )
}
