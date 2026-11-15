import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageShell } from '../components/ui/PageShell'
import { BoardMotif } from '../components/ui/BoardMotif'
import { ThemeToggle } from '../components/ui/ThemeToggle'
import { Card } from '../components/ui/Card'
import { TextInput } from '../components/ui/TextInput'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/useToast'
import { WakingBanner } from '../components/transcripts/PageFrame'
import { warmUpServer } from '../lib/http'
import { useBrand, useServerRules } from '../ruleset/useRules'
import { playerRange } from '../lib/ruleset'
import styles from './LobbyPage.module.css'

export function LobbyPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  // The home page is the product's front door: its name is the brand (server setting
  // GAME_BRAND_NAME); the theme title, pitch and numbers come from the server's ruleset.
  const brand = useBrand()
  const product = useServerRules()

  // Create game state
  const [createName, setCreateName] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')

  // Join game state
  const [joinName, setJoinName] = useState('')
  const [joinRoom, setJoinRoom] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)
  const [joinError, setJoinError] = useState('')

  // Spectator mode state
  const [spectatorLoading, setSpectatorLoading] = useState(false)

  // A sleeping host: wake it while the player types their name (retried GET; shows a friendly
  // "waking the server" note instead of an error).
  const [serverDown, setServerDown] = useState(false)
  const [warmNonce, setWarmNonce] = useState(0)
  useEffect(() => {
    const ctrl = new AbortController()
    void warmUpServer(ctrl.signal).then((ok) => {
      if (!ctrl.signal.aborted) setServerDown(!ok)
    })
    return () => ctrl.abort()
  }, [warmNonce])

  const validateName = (name: string): string | null => {
    if (!name.trim()) {
      return 'Name is required'
    }
    // The trimmed name is what is sent, so it is the trimmed length that counts.
    if (name.trim().length > 20) {
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

      // Remember who this browser is (the server identifies a player by room code + player id)
      sessionStorage.setItem('player_id', data.player_id)
      sessionStorage.setItem('player_name', createName.trim())

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

      // Remember who this browser is (the server identifies a player by room code + player id)
      sessionStorage.setItem('player_id', data.player_id)
      sessionStorage.setItem('player_name', joinName.trim())

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

  const handleWatchBots = async () => {
    setSpectatorLoading(true)
    try {
      const res = await fetch('/api/create-spectator', {
        method: 'POST',
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || 'Failed to create spectator room')
      }

      // Clear any existing player credentials (we're not a player)
      sessionStorage.removeItem('player_id')
      sessionStorage.removeItem('player_name')

      navigate(`/host/${data.room_code}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast(message, 'error')
    } finally {
      setSpectatorLoading(false)
    }
  }

  return (
    <PageShell header={null}>
      <div className={styles.lobby}>
        <div className={styles.topBar}>
          <ThemeToggle />
        </div>
        <header className={styles.hero}>
          <BoardMotif chains={product.rs.chains} />
          <h1 className={styles.title} data-testid="home-title">
            {brand.toUpperCase()}
          </h1>
          <p className={styles.theme} data-testid="home-theme">
            {product.title}
          </p>
          <p className={styles.subtitle} data-testid="home-tagline">
            {product.theme.tagline}
          </p>
        </header>

        <WakingBanner />
        {serverDown && (
          <p className={styles.meta} role="alert" data-testid="server-down">
            The server is not answering yet.{' '}
            <button
              type="button"
              onClick={() => {
                setServerDown(false)
                setWarmNonce((n) => n + 1)
              }}
              data-testid="server-retry"
            >
              Try again
            </button>
          </p>
        )}

        <div className={styles.forms}>
          <Card title="CREATE GAME" className={styles.card}>
            <div className={styles.formContent}>
              <TextInput
                id="create-name"
                label="Your Name"
                value={createName}
                onChange={(e) => {
                  setCreateName(e.target.value)
                  setCreateError('')
                }}
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
                className={styles.cta}
                data-testid="create-button"
              >
                CREATE
              </Button>
            </div>
          </Card>

          <Card title="JOIN GAME" className={styles.card}>
            <div className={styles.formContent}>
              <TextInput
                id="join-name"
                label="Your Name"
                value={joinName}
                onChange={(e) => {
                  setJoinName(e.target.value)
                  setJoinError('')
                }}
                onKeyDown={handleJoinKeyDown}
                maxLength={20}
                placeholder="Enter your name"
                data-testid="join-name-input"
              />
              <TextInput
                id="join-room"
                label="Room Code"
                value={joinRoom}
                onChange={(e) => {
                  setJoinRoom(e.target.value)
                  setJoinError('')
                }}
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
                className={styles.cta}
                data-testid="join-button"
              >
                JOIN
              </Button>
            </div>
          </Card>
        </div>

        <p className={styles.meta} data-testid="home-meta">
          {playerRange(product.rs)} &middot; {product.rs.board.columns}&times;
          {product.rs.board.rows} board &middot; {product.rs.chains.length}{' '}
          {product.theme.chain_noun_plural}
        </p>

        <nav className={styles.explore} aria-label="Explore">
          <button
            type="button"
            className={styles.entry}
            onClick={handleWatchBots}
            disabled={spectatorLoading}
            aria-busy={spectatorLoading || undefined}
            data-testid="watch-bots-button"
          >
            <span className={styles.entryTitle}>WATCH BOTS PLAY</span>{' '}
            <span className={styles.entryHint}>Create a game with only AI players and watch</span>
          </button>
          <Link to="/games" className={styles.entry} data-testid="games-link">
            <span className={styles.entryTitle}>Games &amp; transcripts</span>{' '}
            <span className={styles.entryHint}>Replay finished games move by move</span>
          </Link>
          <Link to="/bench" className={styles.entry} data-testid="bench-link">
            <span className={styles.entryTitle}>{brand} Bench</span>{' '}
            <span className={styles.entryHint}>How AI players rank against each other</span>
          </Link>
        </nav>
      </div>
    </PageShell>
  )
}
