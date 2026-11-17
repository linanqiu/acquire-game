import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageShell } from '../components/ui/PageShell'
import { BoardMotif } from '../components/ui/BoardMotif'
import { ThemeToggle } from '../components/ui/ThemeToggle'
import { TextInput } from '../components/ui/TextInput'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/useToast'
import { WakingBanner } from '../components/transcripts/PageFrame'
import { warmUpServer } from '../lib/http'
import { useBrand, useServerRules } from '../ruleset/useRules'
import { playerRange } from '../lib/ruleset'
import { recallName, rememberName } from '../lib/playerName'
import styles from './LobbyPage.module.css'

export function LobbyPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  // The home page is the product's front door: its name is the brand (server setting
  // GAME_BRAND_NAME); the theme title, pitch and numbers come from the server's ruleset.
  const brand = useBrand()
  const product = useServerRules()

  // One name for both ways in (create, join); the last one used is offered again.
  const [name, setName] = useState(recallName)
  const [nameError, setNameError] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  // A failure to create that is not about the name (the server could not make a room).
  const [createError, setCreateError] = useState('')

  const [joinRoom, setJoinRoom] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)
  const [joinError, setJoinError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

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

  /** The name is asked once; a missing or too-long name is said at the name field. */
  const checkName = (): string | null => {
    const trimmed = name.trim()
    // The trimmed name is what is sent, so it is the trimmed length that counts.
    const problem = !trimmed
      ? 'Name is required'
      : trimmed.length > 20
        ? 'Name must be 20 characters or less'
        : ''
    setNameError(problem)
    if (problem) {
      nameRef.current?.focus()
      return null
    }
    return trimmed
  }

  const enter = (data: { player_id: string; room_code: string }, playerName: string) => {
    // Remember who this browser is (the server identifies a player by room code + player id)
    sessionStorage.setItem('player_id', data.player_id)
    sessionStorage.setItem('player_name', playerName)
    rememberName(playerName)
  }

  const handleCreate = async () => {
    setCreateError('')
    setJoinError('')
    const playerName = checkName()
    if (!playerName) return

    setCreateLoading(true)
    try {
      const formData = new URLSearchParams()
      formData.append('player_name', playerName)

      const res = await fetch('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || 'Failed to create game')
      }

      enter(data, playerName)
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
    setCreateError('')
    setJoinError('')
    const playerName = checkName()
    if (!playerName) return

    const roomCode = joinRoom.trim().toUpperCase()
    if (roomCode.length !== 4) {
      setJoinError('Room code must be 4 characters')
      return
    }

    setJoinLoading(true)
    try {
      const formData = new URLSearchParams()
      formData.append('player_name', playerName)
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

      enter(data, playerName)
      navigate(`/play/${data.room_code}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      // A refusal about the name ("Player name already taken") belongs at the name field;
      // everything else is about the room.
      if (/\bname\b/i.test(message)) setNameError(message)
      else setJoinError(message)
      toast(message, 'error')
    } finally {
      setJoinLoading(false)
    }
  }

  // Enter in the name field: join when a code has been typed, else create.
  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || createLoading || joinLoading) return
    if (joinRoom.trim()) handleJoin()
    else handleCreate()
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

        <section className={styles.entryForm} aria-label="Play" data-testid="play-form">
          <TextInput
            ref={nameRef}
            id="player-name"
            label="Your name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameError('')
            }}
            onKeyDown={handleNameKeyDown}
            maxLength={20}
            error={nameError}
            placeholder="Ada"
            autoComplete="nickname"
            data-testid="name-input"
          />
          <Button
            fullWidth
            loading={createLoading}
            onClick={handleCreate}
            className={styles.cta}
            data-testid="create-button"
          >
            CREATE GAME
          </Button>
          {createError && (
            <p className={styles.formError} role="alert" data-testid="create-error">
              {createError}
            </p>
          )}
          <div className={styles.joinRow}>
            <span className={styles.joinLabel} id="join-room-label">
              or join with a code
            </span>
            <TextInput
              id="join-room"
              aria-labelledby="join-room-label"
              value={joinRoom}
              onChange={(e) => {
                setJoinRoom(e.target.value)
                setJoinError('')
              }}
              onKeyDown={handleJoinKeyDown}
              maxLength={4}
              autoCapitalize
              autoComplete="off"
              error={joinError}
              placeholder="ABCD"
              className={styles.codeInput}
              data-testid="join-room-input"
            />
            <Button
              loading={joinLoading}
              onClick={handleJoin}
              className={styles.joinButton}
              data-testid="join-button"
            >
              JOIN
            </Button>
          </div>
        </section>

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
            <span className={styles.entryTitle}>Watch bots play</span>{' '}
            <span className={styles.entryHint}>A new game with only AI players</span>
          </button>
          <Link to="/games" className={styles.entry} data-testid="games-link">
            <span className={styles.entryTitle}>Games &amp; transcripts</span>{' '}
            <span className={styles.entryHint}>Replay any game move by move</span>
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
