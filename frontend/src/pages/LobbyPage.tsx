import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { PageShell } from '../components/ui/PageShell'
import { BoardMotif } from '../components/ui/BoardMotif'
import { ThemeToggle } from '../components/ui/ThemeToggle'
import { TextInput } from '../components/ui/TextInput'
import { Button } from '../components/ui/Button'
import { WakingBanner } from '../components/transcripts/PageFrame'
import { warmUpServer } from '../lib/http'
import { createShow } from '../lib/lobby'
import { useBrand, useServerRules } from '../ruleset/useRules'
import { recallName, rememberName } from '../lib/playerName'
import { cleanCode, joinStepCode, ROOM_CODE_LENGTH } from '../lib/joinLink'
import styles from './LobbyPage.module.css'

/** History state of the join step when it was opened from the name step (Back = history back). */
interface StepState {
  fromName?: boolean
}

/**
 * The home page, one question at a time (BL-018).
 *
 * Step 1 (`/`): the name (remembered from last time), then NEW GAME or JOIN GAME. NEW GAME creates
 * the room and goes straight to the lobby. JOIN GAME opens step 2 (`/?join`): one large room-code
 * field that joins as soon as four letters are typed. A join link (`/?code=ABCD`, shared from the
 * lobby) opens step 2 with the code filled in. The steps live in the URL, so the browser's Back
 * button goes from the code back to the name. The other destinations (watch bots, games, bench)
 * are a quiet row of links at the bottom.
 */
export function LobbyPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const brand = useBrand()
  const product = useServerRules()

  const linkCode = joinStepCode(params)
  const joinStep = linkCode !== null

  const [name, setName] = useState(recallName)
  const [nameError, setNameError] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')

  const [code, setCode] = useState(linkCode ?? '')
  const [joinLoading, setJoinLoading] = useState(false)
  const [joinError, setJoinError] = useState('')
  /** The server refused the name (taken): the code field offers to go back and change it. */
  const [nameRefused, setNameRefused] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const [spectatorLoading, setSpectatorLoading] = useState(false)
  const [spectatorError, setSpectatorError] = useState('')

  // A join link with a different code (pasted while on the page): take it.
  useEffect(() => {
    if (linkCode) setCode(linkCode)
  }, [linkCode])

  // A name was entered on step 1: the join step shows it as one quiet line, not a second field.
  // A join link opened with no name known asks for it on the join step itself.
  const [nameKnown, setNameKnown] = useState(() => recallName().trim() !== '')

  // Each step puts the cursor in its own field (BL-018: focus moves to the new step).
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      // Landing on the join step (a join link) with a name known: straight to the code.
      if (joinStep && nameKnown) codeRef.current?.focus()
      return
    }
    if (joinStep) (nameKnown ? codeRef : nameRef).current?.focus()
    else nameRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinStep])

  // A sleeping host: wake it while the player types their name.
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
    const problem = !trimmed
      ? 'Name is required'
      : trimmed.length > 20
        ? 'Name must be 20 characters or less'
        : ''
    setNameError(problem)
    if (problem) {
      setNameKnown(false)
      nameRef.current?.focus()
      return null
    }
    return trimmed
  }

  const enter = (data: { player_id: string; room_code: string }, playerName: string) => {
    sessionStorage.setItem('player_id', data.player_id)
    sessionStorage.setItem('player_name', playerName)
    rememberName(playerName)
  }

  const handleCreate = async () => {
    setCreateError('')
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
      if (!res.ok) throw new Error(data.detail || 'Failed to create game')
      enter(data, playerName)
      navigate(`/play/${data.room_code}?is_host=1`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setCreateLoading(false)
    }
  }

  /** Step 1 -> step 2: the name first, then the code. */
  const openJoinStep = () => {
    setCreateError('')
    if (!checkName()) return
    setNameKnown(true)
    setNameRefused(false)
    setJoinError('')
    const next = new URLSearchParams(params)
    next.delete('code')
    next.set('join', '')
    setParams(next, { state: { fromName: true } satisfies StepState })
  }

  /** Step 2 -> step 1: history back when step 1 is where we came from; else replace. */
  const backToName = (refused = false) => {
    setJoinError('')
    setNameRefused(false)
    if (refused) setNameError('That name is taken in this room: pick another')
    if ((location.state as StepState | null)?.fromName) navigate(-1)
    else setParams(new URLSearchParams(), { replace: true })
  }

  const handleJoin = async (typed = code) => {
    if (joinLoading) return
    setJoinError('')
    setNameRefused(false)
    const playerName = checkName()
    if (!playerName) return
    const roomCode = typed.trim().toUpperCase()
    if (roomCode.length !== ROOM_CODE_LENGTH) {
      setJoinError(`Room code must be ${ROOM_CODE_LENGTH} letters`)
      codeRef.current?.focus()
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
      if (!res.ok) throw new Error(data.detail || 'Failed to join game')
      enter(data, playerName)
      navigate(`/play/${data.room_code}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      // Every refusal is said at the code field; one about the name offers to change it.
      setJoinError(message)
      setNameRefused(/\bname\b/i.test(message))
      codeRef.current?.select()
    } finally {
      setJoinLoading(false)
    }
  }

  const onCodeChange = (raw: string) => {
    const next = cleanCode(raw)
    setCode(next)
    setJoinError('')
    setNameRefused(false)
    // The fourth letter is the submit: no button to find on a phone keyboard.
    if (next.length === ROOM_CODE_LENGTH && code.length !== ROOM_CODE_LENGTH) void handleJoin(next)
  }

  const handleWatchBots = async () => {
    setSpectatorLoading(true)
    setSpectatorError('')
    try {
      // A game of AI players with commentary; it starts when the watch page connects.
      const room = await createShow()
      sessionStorage.removeItem('player_id')
      sessionStorage.removeItem('player_name')
      navigate(`/host/${room}`)
    } catch (err) {
      setSpectatorError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSpectatorLoading(false)
    }
  }

  const nameField = (
    <TextInput
      ref={nameRef}
      id="player-name"
      label="Your name"
      value={name}
      onChange={(e) => {
        setName(e.target.value)
        setNameError('')
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || createLoading || joinLoading) return
        if (joinStep) codeRef.current?.focus()
        else void handleCreate()
      }}
      maxLength={20}
      error={nameError}
      placeholder="Ada"
      autoComplete="nickname"
      enterKeyHint={joinStep ? 'next' : 'go'}
      className={styles.nameInput}
      data-testid="name-input"
    />
  )

  return (
    <PageShell header={null}>
      <div className={styles.home} data-step={joinStep ? 'join' : 'name'}>
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
          {/* The pitch, as one quiet line; the numbers (players, board, chains) are left to
              the lobby and the board (BL-018). */}
          <p className={styles.tagline} data-testid="home-tagline">
            {product.theme.tagline}
          </p>
        </header>

        <WakingBanner />
        {serverDown && (
          <p className={styles.note} role="alert" data-testid="server-down">
            The server is not answering yet.{' '}
            <button
              type="button"
              className={styles.textButton}
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

        {!joinStep ? (
          <section className={styles.step} aria-label="Play" data-testid="play-form">
            {nameField}
            <Button
              fullWidth
              size="lg"
              loading={createLoading}
              onClick={handleCreate}
              className={styles.cta}
              data-testid="create-button"
            >
              NEW GAME
            </Button>
            <Button
              fullWidth
              size="lg"
              variant="secondary"
              onClick={openJoinStep}
              disabled={createLoading}
              data-testid="join-button"
            >
              JOIN GAME
            </Button>
            {createError && (
              <p className={styles.formError} role="alert" data-testid="create-error">
                {createError}
              </p>
            )}
          </section>
        ) : (
          <section className={styles.step} aria-label="Join a game" data-testid="join-form">
            {nameKnown ? (
              <p className={styles.asLine}>
                <span className={styles.asName} data-testid="join-as">
                  Joining as <strong>{name.trim()}</strong>
                </span>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => backToName()}
                  data-testid="join-change-name"
                >
                  Change
                </button>
              </p>
            ) : (
              nameField
            )}
            <TextInput
              ref={codeRef}
              id="join-room"
              label="Room code"
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleJoin()
              }}
              maxLength={ROOM_CODE_LENGTH}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              enterKeyHint="go"
              error={joinError}
              placeholder="ABCD"
              className={styles.codeInput}
              data-testid="join-room-input"
            />
            {nameRefused && (
              <Button
                variant="secondary"
                fullWidth
                onClick={() => backToName(true)}
                data-testid="join-name-taken-change"
              >
                CHANGE MY NAME
              </Button>
            )}
            <Button
              fullWidth
              size="lg"
              loading={joinLoading}
              onClick={() => void handleJoin()}
              className={styles.cta}
              data-testid="join-submit-button"
            >
              JOIN
            </Button>
            <button
              type="button"
              className={styles.back}
              onClick={() => backToName()}
              data-testid="join-back"
            >
              &larr; Back
            </button>
          </section>
        )}

        <nav className={styles.more} aria-label="More">
          <button
            type="button"
            className={styles.moreLink}
            onClick={handleWatchBots}
            disabled={spectatorLoading}
            aria-busy={spectatorLoading || undefined}
            data-testid="watch-bots-button"
          >
            Watch bots play
          </button>
          <span className={styles.dot} aria-hidden="true">
            &middot;
          </span>
          <Link to="/games" className={styles.moreLink} data-testid="games-link">
            Past games
          </Link>
          <span className={styles.dot} aria-hidden="true">
            &middot;
          </span>
          <Link to="/bench" className={styles.moreLink} data-testid="bench-link">
            {brand} Bench
          </Link>
        </nav>
        {spectatorError && (
          <p className={styles.formError} role="alert" data-testid="spectator-error">
            {spectatorError}
          </p>
        )}
      </div>
    </PageShell>
  )
}
