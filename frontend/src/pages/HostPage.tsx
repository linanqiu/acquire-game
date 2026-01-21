import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { PageShell } from '../components/ui/PageShell'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { Board } from '../components/game/Board'
import { ChainMarker } from '../components/game/ChainMarker'
import { PlayerCard, type StockHolding } from '../components/game/PlayerCard'
import { GameOver, type FinalScore } from '../components/game/GameOver'
import { useGameStore } from '../store/gameStore'
import { useToast } from '../components/ui/useToast'
import { transformBoardToTileStates } from '../utils/transforms'
import type { ChainName, GamePhase } from '../types/api'
import styles from './HostPage.module.css'

// Phase display text for host view
function getHostPhaseText(phase: GamePhase, currentPlayerName: string): string {
  if (phase === 'lobby') return 'WAITING FOR PLAYERS'
  if (phase === 'game_over') return 'GAME OVER'

  const phaseText = (() => {
    switch (phase) {
      case 'place_tile':
        return 'PLACE TILE'
      case 'found_chain':
        return 'FOUND CHAIN'
      case 'merger':
        return 'MERGER'
      case 'stock_disposition':
        return 'STOCK DISPOSITION'
      case 'buy_stocks':
        return 'BUY STOCKS'
      default: {
        // Exhaustive check - phase is constrained by GamePhase type
        const _exhaustiveCheck: never = phase
        return String(_exhaustiveCheck).toUpperCase()
      }
    }
  })()

  return `${currentPlayerName}'s TURN - ${phaseText}`
}

export function HostPage() {
  const room = useRoom()
  const navigate = useNavigate()
  const { toast } = useToast()

  // Game store state
  const {
    connectionStatus,
    lobbyPlayers,
    canStart,
    gameState,
  } = useGameStore()

  // Local UI state
  const [actionLoading, setActionLoading] = useState(false)
  // TODO (RT-002): Activity log should be populated from WebSocket game events
  // (tile placements, chain foundings, mergers, stock purchases, etc.)
  const [activityLog, setActivityLog] = useState<{ id: number; text: string }[]>([
    { id: 0, text: 'Waiting for players...' },
  ])
  const [nextLogId, setNextLogId] = useState(1)

  // Helper to add activity log entries with unique IDs
  const addActivityLog = useCallback((text: string) => {
    setActivityLog((prev) => [...prev, { id: nextLogId, text }])
    setNextLogId((id) => id + 1)
  }, [nextLogId])

  // Derived state
  const phase = gameState?.phase ?? 'lobby'
  const currentTurnPlayerId = gameState?.current_player

  const currentPlayerName = useMemo(() => {
    if (!gameState || !currentTurnPlayerId) return ''
    return gameState.players[currentTurnPlayerId]?.name ?? ''
  }, [gameState, currentTurnPlayerId])

  const boardTileStates = useMemo(() => {
    if (!gameState) return {}
    return transformBoardToTileStates(gameState.board.cells)
  }, [gameState])

  const activeChains = useMemo(() => {
    if (!gameState) return []
    return gameState.hotel.chains
      .filter((c) => gameState.hotel.active_chains.includes(c.name))
      .sort((a, b) => b.size - a.size)
  }, [gameState])

  const allPlayers = useMemo(() => {
    if (!gameState) return []
    return gameState.turn_order.map((playerId) => {
      const player = gameState.players[playerId]
      const stocks: StockHolding[] = Object.entries(player.stocks)
        .filter(([, qty]) => qty > 0)
        .map(([chain, quantity]) => ({
          chain: chain as ChainName,
          quantity,
        }))
      return {
        id: playerId,
        name: player.name,
        cash: player.money,
        stocks,
        isCurrentTurn: playerId === currentTurnPlayerId,
        // TODO (RT-002): Backend GameStateMessage should include is_bot per player.
        // Currently lost when transitioning from lobby to game state.
        isBot: false,
      }
    })
  }, [gameState, currentTurnPlayerId])

  // Action handlers
  const handleStartGame = useCallback(async () => {
    setActionLoading(true)
    try {
      const sessionToken = sessionStorage.getItem('session_token')
      const res = await fetch(`/api/room/${room}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
      })
      if (!res.ok) {
        throw new Error('Failed to start game')
      }
      addActivityLog('Game started!')
      toast('Game started!', 'success')
    } catch (err) {
      console.error('Failed to start game:', err)
      toast('Failed to start game', 'error')
    } finally {
      setActionLoading(false)
    }
  }, [room, toast, addActivityLog])

  const handleAddBot = useCallback(async () => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/room/${room}/bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        throw new Error('Failed to add bot')
      }
      const data = await res.json()
      addActivityLog(`Bot added: ${data.bot_id}`)
      toast('Bot added successfully', 'success')
    } catch (err) {
      console.error('Failed to add bot:', err)
      toast('Failed to add bot', 'error')
    } finally {
      setActionLoading(false)
    }
  }, [room, toast, addActivityLog])

  const handlePlayAgain = useCallback(() => {
    navigate('/')
  }, [navigate])

  const handleBackToLobby = useCallback(() => {
    navigate('/')
  }, [navigate])

  // Generate QR code URL (using a simple QR code API)
  const joinUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/play/${room}`
  }, [room])

  // Render lobby view
  const renderLobbyView = () => (
    <div className={styles.lobby}>
      <h1 className={styles.lobbyTitle}>ACQUIRE</h1>
      <div className={styles.joinInfo}>
        <div className={styles.qrSection}>
          <div className={styles.qrPlaceholder}>
            {/* TODO: Replace with actual QR code component pointing to joinUrl */}
            <div className={styles.qrBox} role="img" aria-label={`QR code to join room ${room}`}>
              QR
            </div>
            <p className={styles.scanText}>SCAN TO JOIN</p>
          </div>
          <div className={styles.roomCodeDisplay}>
            <span className={styles.roomLabel}>ROOM CODE</span>
            <span className={styles.roomCodeLarge}>{room}</span>
          </div>
        </div>
        <div className={styles.urlDisplay}>
          <span className={styles.urlLabel}>Or visit:</span>
          <code className={styles.url}>{joinUrl}</code>
        </div>
      </div>

      <div className={styles.lobbyPlayerList}>
        <h2 className={styles.playerListTitle}>PLAYERS ({lobbyPlayers.length}/6)</h2>
        <div className={styles.playerGrid}>
          {lobbyPlayers.map((p) => (
            <div key={p.player_id} className={styles.lobbyPlayerCard}>
              <span className={styles.playerName}>{p.name}</span>
              {p.is_bot && <span className={styles.botBadge}>BOT</span>}
            </div>
          ))}
          {lobbyPlayers.length < 6 && (
            <div className={styles.emptySlot}>
              <span>Waiting...</span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.lobbyActions}>
        <Button
          variant="secondary"
          size="lg"
          onClick={handleAddBot}
          disabled={lobbyPlayers.length >= 6 || actionLoading}
        >
          + ADD BOT
        </Button>
        <Button
          size="lg"
          onClick={handleStartGame}
          disabled={!canStart || actionLoading}
          loading={actionLoading}
        >
          START GAME
        </Button>
      </div>

      <p className={styles.minPlayers}>
        {lobbyPlayers.length < 3
          ? `Need ${3 - lobbyPlayers.length} more player${3 - lobbyPlayers.length > 1 ? 's' : ''} to start`
          : 'Ready to start!'}
      </p>
    </div>
  )

  // Render game over view
  const renderGameOverView = () => {
    // TODO: Backend should provide final scores with bonus breakdown in game_over phase.
    // Currently we only show cash. See PlayerPage.tsx for detailed TODO.
    const scores: FinalScore[] = gameState
      ? Object.entries(gameState.players).map(([id, p]) => ({
          playerId: id,
          name: p.name,
          cash: p.money,
          bonuses: 0, // TODO: Get from backend game_over message
          stockSales: 0, // TODO: Get from backend game_over message
          total: p.money, // TODO: Should be cash + bonuses + stockSales
        }))
      : []

    return (
      <div className={styles.gameOverContainer}>
        <GameOver
          scores={scores}
          onPlayAgain={handlePlayAgain}
          onBackToLobby={handleBackToLobby}
          variant="host"
        />
      </div>
    )
  }

  // Render game view
  const renderGameView = () => (
    <div className={styles.gameLayout}>
      <div className={styles.boardSection}>
        <Board tiles={boardTileStates} size="lg" />
      </div>

      <div className={styles.sidebar}>
        <Panel title="CHAINS">
          <div className={styles.chainList}>
            {activeChains.length === 0 ? (
              <p className={styles.noChains}>No active chains</p>
            ) : (
              activeChains.map((chain) => (
                <ChainMarker
                  key={chain.name}
                  chain={chain.name}
                  size={chain.size}
                  price={chain.price}
                  available={chain.stocks_available}
                  safe={chain.size >= 11}
                  variant="full"
                />
              ))
            )}
          </div>
        </Panel>

        <Panel title="SCOREBOARD">
          <div className={styles.scoreboard}>
            {allPlayers.map((p) => (
              <PlayerCard
                key={p.id}
                name={p.name}
                cash={p.cash}
                stocks={p.stocks}
                isCurrentTurn={p.isCurrentTurn}
                isBot={p.isBot}
                variant="full"
              />
            ))}
          </div>
        </Panel>
      </div>

      <div className={styles.activityLog} role="log" aria-live="polite" aria-label="Game activity">
        <span className={styles.logLabel}>ACTIVITY:</span>
        {activityLog.slice(-5).map((entry) => (
          <span key={entry.id} className={styles.logEntry}>
            {entry.text}
          </span>
        ))}
      </div>
    </div>
  )

  // Main render
  if (connectionStatus === 'connecting') {
    return (
      <PageShell header={<HostHeader roomCode={room} />}>
        <div className={styles.connecting}>
          <Spinner />
          <p>Connecting to game...</p>
        </div>
      </PageShell>
    )
  }

  if (connectionStatus === 'error') {
    return (
      <PageShell header={<HostHeader roomCode={room} />}>
        <div className={styles.error}>
          <p>Connection error. Please refresh the page.</p>
          <Button onClick={() => window.location.reload()}>REFRESH</Button>
        </div>
      </PageShell>
    )
  }

  if (phase === 'lobby') {
    return (
      <PageShell header={null}>
        {renderLobbyView()}
      </PageShell>
    )
  }

  if (phase === 'game_over') {
    return (
      <PageShell
        header={<HostHeader roomCode={room} />}
        phase="GAME OVER"
      >
        {renderGameOverView()}
      </PageShell>
    )
  }

  return (
    <PageShell
      header={<HostHeader roomCode={room} />}
      phase={getHostPhaseText(phase, currentPlayerName)}
    >
      {renderGameView()}
    </PageShell>
  )
}

// Custom header component for host view
function HostHeader({ roomCode }: { roomCode: string }) {
  return (
    <header className={styles.hostHeader}>
      <div className={styles.hostLogo}>ACQUIRE</div>
      <div className={styles.hostRoomCode}>
        <span className={styles.roomLabel}>ROOM</span>
        <span className={styles.roomValue}>{roomCode}</span>
      </div>
    </header>
  )
}
