import { useState, useMemo, useCallback, useEffect } from 'react'
import { useConnectionLifecycle } from '../hooks/useConnectionLifecycle'
import { startGame, startHint } from '../lib/lobby'
import { useNavigate } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useHostWebSocket } from '../hooks/useHostWebSocket'
import { PageShell } from '../components/ui/PageShell'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { Board } from '../components/game/Board'
import { ChainMarker } from '../components/game/ChainMarker'
import { PlayerCard, type StockHolding } from '../components/game/PlayerCard'
import { GameOver } from '../components/game/GameOver'
import { AddAiControl } from '../components/game/AddAiControl'
import { ReconnectionOverlay } from '../components/game/ReconnectionOverlay'
import { SeatKindBadge } from '../components/game/SeatKindBadge'
import { RemoveSeatButton } from '../components/game/RemoveSeatButton'
import { isAiThinking, resolveSeatKind } from '../lib/agents'
import { buildFinalScores } from '../lib/finalScores'
import { roomUnavailable } from '../lib/roomAvailability'
import { useGameStore } from '../store/gameStore'
import { useToast } from '../components/ui/useToast'
import { useFallbackToasts } from '../hooks/useFallbackToasts'
import { useErrorHandler } from '../hooks/useErrorHandler'
import { transformBoardToTileStates } from '../utils/transforms'
import type { ChainId, TradeOffer } from '../types/api'
import { RulesetScope } from '../ruleset/RulesetScope'
import { rulesFor, useBrand, useServerRuleset, type Rules } from '../ruleset/useRules'
import { orderChainIds } from '../lib/ruleset'
import { hostPhaseText } from '../lib/phaseText'
import styles from './HostPage.module.css'

/** "2 sandpiper + $100" style summary of one side of a trade. */
function describeSide(
  rules: Rules,
  stocks: Partial<Record<ChainId, number>> | undefined,
  money: number | undefined
): string {
  const parts = Object.entries(stocks ?? {})
    .filter(([, q]) => (q ?? 0) > 0)
    .map(([chain, q]) => `${q} ${rules.name(chain)}`)
  if ((money ?? 0) > 0) parts.push(rules.money(money))
  return parts.length > 0 ? parts.join(' + ') : 'nothing'
}

function describeTrade(rules: Rules, trade: TradeOffer): string {
  return `${describeSide(rules, trade.offering_stocks, trade.offering_money)} for ${describeSide(
    rules,
    trade.requesting_stocks,
    trade.requesting_money
  )}`
}

export function HostPage() {
  const room = useRoom()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { handleServerError } = useErrorHandler()
  useFallbackToasts()

  // The game store is global: leaving this room (PLAY AGAIN, BACK TO LOBBY, another room)
  // must not leak its state into the next room, which would otherwise open on the old
  // game's screen (e.g. a brand-new room showing the previous GAME OVER).
  useEffect(() => () => useGameStore.getState().reset(), [room])

  const { reconnect } = useHostWebSocket({ roomCode: room, onError: handleServerError })

  // Game store state
  const {
    connectionStatus,
    connectionError,
    lobbyPlayers,
    canStart,
    gameState,
    publicTrades,
    gameOver,
  } = useGameStore()
  const unavailable = roomUnavailable(connectionStatus, connectionError)

  // The game's ruleset once a game_state arrived; the server's before (lobby).
  const serverRuleset = useServerRuleset()
  const ruleset = gameState?.ruleset ?? serverRuleset
  const rules = rulesFor(ruleset)
  const { theme } = rules
  const minPlayers = ruleset.min_players
  const maxPlayers = ruleset.max_players

  // The reconnection overlay only after we have been connected once
  const { hasConnected } = useConnectionLifecycle(connectionStatus)

  // Local UI state
  const [actionLoading, setActionLoading] = useState(false)
  const [activityLog, setActivityLog] = useState<{ id: number; text: string }[]>([
    { id: 0, text: 'Waiting for players...' },
  ])
  const addActivityLog = useCallback((text: string) => {
    setActivityLog((prev) => [...prev, { id: prev.length, text }])
  }, [])

  // Derived state
  const phase = gameState?.phase ?? 'lobby'
  const currentTurnPlayerId = gameState?.current_player

  const currentPlayerName =
    (currentTurnPlayerId && gameState?.players[currentTurnPlayerId]?.name) || ''

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

  const safeSize = ruleset.safe_chain_size

  const allPlayers = useMemo(() => {
    if (!gameState) return []
    return gameState.turn_order.map((playerId) => {
      const player = gameState.players[playerId]
      const stocks: StockHolding[] = orderChainIds(
        ruleset,
        Object.keys(player.stocks).filter((c) => (player.stocks[c] ?? 0) > 0)
      ).map((chain) => ({ chain, quantity: player.stocks[chain] }))
      return {
        id: playerId,
        name: player.name,
        cash: player.money,
        stocks,
        isCurrentTurn: playerId === currentTurnPlayerId,
        isBot: resolveSeatKind(player) !== 'human',
        kind: player.kind,
        agentLabel: player.agent_label,
        fallbacks: player.fallbacks,
        thinking: isAiThinking(gameState.awaiting, playerId),
      }
    })
  }, [gameState, currentTurnPlayerId, ruleset])

  const handleStartGame = useCallback(async () => {
    setActionLoading(true)
    try {
      await startGame(room)
      addActivityLog('Game started!')
    } catch (err) {
      console.error('Failed to start game:', err)
      toast('Failed to start game', 'error')
    } finally {
      setActionLoading(false)
    }
  }, [room, toast, addActivityLog])

  const joinUrl = `${window.location.origin}/play/${room}`

  const brand = useBrand()
  const renderLobbyView = () => (
    <div className={styles.lobby}>
      <h1 className={styles.lobbyTitle} data-testid="host-title">
        {brand.toUpperCase()}
      </h1>
      <p className={styles.lobbyTheme} data-testid="host-theme">
        {serverRuleset.title}
      </p>
      <div className={styles.joinInfo}>
        <div className={styles.roomCodeDisplay}>
          <span className={styles.roomLabel}>ROOM CODE</span>
          <span className={styles.roomCodeLarge}>{room}</span>
        </div>
        <div className={styles.urlDisplay}>
          <span className={styles.urlLabel}>Join at:</span>
          <code className={styles.url}>{joinUrl}</code>
        </div>
      </div>

      <div className={styles.lobbyPlayerList}>
        <h2 className={styles.playerListTitle}>
          PLAYERS ({lobbyPlayers.length}/{maxPlayers})
        </h2>
        <div className={styles.playerGrid}>
          {lobbyPlayers.map((p) => (
            <div key={p.player_id} className={styles.lobbyPlayerCard}>
              <span className={styles.playerName}>{p.name}</span>
              <SeatKindBadge
                playerId={p.player_id}
                kind={p.kind}
                isBot={p.is_bot}
                agentLabel={p.agent_label}
              />
              {resolveSeatKind(p) !== 'human' && (
                <RemoveSeatButton room={room} playerId={p.player_id} playerName={p.name} />
              )}
            </div>
          ))}
          {lobbyPlayers.length < maxPlayers && (
            <div className={styles.emptySlot}>
              <span>Waiting...</span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.lobbyActions}>
        <AddAiControl
          room={room}
          size="lg"
          disabled={lobbyPlayers.length >= maxPlayers || actionLoading}
          onAdded={(id, name) => addActivityLog(`${name ?? id ?? 'AI'} joined`)}
        />
        <Button
          size="lg"
          onClick={handleStartGame}
          disabled={!canStart || actionLoading}
          loading={actionLoading}
        >
          START GAME
        </Button>
      </div>

      <p className={styles.minPlayers}>{startHint(lobbyPlayers.length, minPlayers)}</p>
    </div>
  )

  const renderGameOverView = () => (
    <div className={styles.gameOverContainer}>
      <GameOver
        scores={buildFinalScores(gameState, gameOver)}
        onPlayAgain={() => navigate('/')}
        onBackToLobby={() => navigate('/')}
        variant="host"
        gameId={gameState?.game_id}
      />
    </div>
  )

  const renderGameView = () => (
    <div className={styles.gameLayout}>
      <div className={styles.boardSection}>
        <Board tiles={boardTileStates} size="lg" />
      </div>

      <div className={styles.sidebar}>
        <Panel title="SCOREBOARD">
          <div className={styles.scoreboard} data-testid="scoreboard">
            {allPlayers.map((p) => (
              <PlayerCard
                key={p.id}
                name={p.name}
                cash={p.cash}
                stocks={p.stocks}
                isCurrentTurn={p.isCurrentTurn}
                isBot={p.isBot}
                playerId={p.id}
                kind={p.kind}
                agentLabel={p.agentLabel}
                fallbacks={p.fallbacks}
                thinking={p.thinking}
                variant="full"
              />
            ))}
          </div>
        </Panel>

        <Panel title={theme.chain_noun_plural.toUpperCase()}>
          <div className={styles.chainList} data-testid="chain-list">
            {activeChains.length === 0 ? (
              <p className={styles.noChains}>No active {theme.chain_noun_plural}</p>
            ) : (
              activeChains.map((chain) => (
                <ChainMarker
                  key={chain.name}
                  chain={chain.name}
                  size={chain.size}
                  price={chain.price}
                  available={chain.stocks_available}
                  safe={chain.size >= safeSize}
                  variant="full"
                />
              ))
            )}
          </div>
        </Panel>

        {publicTrades.length > 0 && gameState && (
          <Panel title="PENDING TRADES">
            <ul className={styles.pendingTrades} data-testid="pending-trades">
              {publicTrades.map((t) => (
                <li key={t.trade_id} data-testid={`pending-trade-${t.trade_id}`}>
                  <strong>{gameState.players[t.from_player_id]?.name ?? '?'}</strong>
                  {' → '}
                  <strong>{gameState.players[t.to_player_id]?.name ?? '?'}</strong>
                  <span className={styles.tradeText}>{describeTrade(rules, t)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
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

  const renderPage = () => {
    if (unavailable) {
      return (
        <PageShell header={<HostHeader roomCode={room} />}>
          <div className={styles.error} data-testid="room-unavailable">
            <p>Game {room} was not found. Check the room code, or the game may have ended.</p>
            <Button onClick={() => navigate('/')}>BACK TO HOME</Button>
          </div>
        </PageShell>
      )
    }

    if (connectionStatus === 'connecting' && !gameState) {
      return (
        <PageShell header={<HostHeader roomCode={room} />}>
          <div className={styles.connecting}>
            <Spinner />
            <p>Connecting to game...</p>
          </div>
        </PageShell>
      )
    }

    if (connectionStatus === 'error' && !gameState) {
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
      return <PageShell header={null}>{renderLobbyView()}</PageShell>
    }

    if (phase === 'game_over') {
      return (
        <PageShell header={<HostHeader roomCode={room} />} phase="GAME OVER">
          {renderGameOverView()}
        </PageShell>
      )
    }

    return (
      <PageShell
        header={<HostHeader roomCode={room} />}
        phase={hostPhaseText(ruleset, phase, currentPlayerName)}
      >
        {renderGameView()}
      </PageShell>
    )
  }

  return (
    <RulesetScope ruleset={gameState?.ruleset}>
      {renderPage()}
      {hasConnected && connectionStatus !== 'connected' && !unavailable && (
        <ReconnectionOverlay
          connectionStatus={connectionStatus === 'disconnected' ? 'disconnected' : 'reconnecting'}
          playerName="Host"
          onReconnect={reconnect}
          onBackToLobby={() => navigate('/')}
        />
      )}
    </RulesetScope>
  )
}

/** The host's header: brand and room code (the lobby shows them large instead). */
function HostHeader({ roomCode }: { roomCode: string }) {
  const brand = useBrand()
  return (
    <header className={styles.hostHeader}>
      <div className={styles.hostLogo} data-testid="header-title">
        {brand.toUpperCase()}
      </div>
      <div className={styles.hostRoomCode}>
        <span className={styles.roomLabel}>ROOM</span>
        <span className={styles.roomValue}>{roomCode}</span>
      </div>
    </header>
  )
}
