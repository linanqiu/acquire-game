import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useWebSocket } from '../hooks/useWebSocket'
import { useConnectionLifecycle } from '../hooks/useConnectionLifecycle'
import { PageShell } from '../components/ui/PageShell'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Spinner } from '../components/ui/Spinner'
import { TileRack, type RackTile } from '../components/game/TileRack'
import { Portfolio, type StockHolding, type ChainPrices } from '../components/game/Portfolio'
import { Board } from '../components/game/Board'
import { ChainSelector } from '../components/game/ChainSelector'
import { MergerDisposition } from '../components/game/MergerDisposition'
import { TradeBuilder } from '../components/game/TradeBuilder'
import { TradeOffers } from '../components/game/TradeOffers'
import { ReconnectionOverlay } from '../components/game/ReconnectionOverlay'
import { ReconnectedToast } from '../components/game/ReconnectedToast'
import { GameOver } from '../components/game/GameOver'
import { ChatPanel } from '../components/game/ChatPanel'
import { buildFinalScores } from '../lib/finalScores'
import { roomUnavailable } from '../lib/roomAvailability'
import { waitingMessage } from '../lib/waiting'
import { useGameStore } from '../store/gameStore'
import { useFallbackToasts } from '../hooks/useFallbackToasts'
import { useErrorHandler } from '../hooks/useErrorHandler'
import {
  transformBoardToTileStates,
  transformHandToRackTiles,
  transformPlayabilityMap,
  unplayableReasons,
} from '../utils/transforms'
import type { ChainId } from '../types/api'
import { RulesetScope } from '../ruleset/RulesetScope'
import { rulesFor, useServerRuleset } from '../ruleset/useRules'
import { orderChainIds, withArticle } from '../lib/ruleset'
import { dispositionPhaseText, playerPhaseText, survivorPhaseText } from '../lib/phaseText'
import type { Coordinate } from '../types/game'
import { BuyPanel } from './player/BuyPanel'
import { LobbyPanel } from './player/LobbyPanel'
import { PlayersPanel } from './player/PlayersPanel'
import { usePlayerTrades } from './player/usePlayerTrades'
import { useTurnActions } from './player/useTurnActions'
import styles from './PlayerPage.module.css'

export function PlayerPage() {
  const room = useRoom()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isHost = searchParams.get('is_host') === '1'
  useFallbackToasts()
  const { handleServerError } = useErrorHandler()

  // The game store is global: leaving this room (PLAY AGAIN, BACK TO LOBBY, another room)
  // must not leak its state into the next room, which would otherwise open on the old
  // game's screen (e.g. a brand-new room showing the previous GAME OVER).
  useEffect(() => () => useGameStore.getState().reset(), [room])

  const {
    connectionStatus,
    connectionError,
    currentPlayer,
    lobbyPlayers,
    canStart,
    gameState,
    yourHand,
    tilePlayability,
    pendingChainChoice,
    pendingMergerChoice,
    pendingStockDisposition,
    trades: myTrades,
    lastTradeEvent,
    gameOver,
    setCurrentPlayer,
  } = useGameStore()

  useEffect(() => {
    const playerId = sessionStorage.getItem('player_id')
    const playerName = sessionStorage.getItem('player_name')
    if (playerId && playerName) {
      setCurrentPlayer({ id: playerId, name: playerName, isHost })
    }
  }, [setCurrentPlayer, isHost])

  const myPlayerId = currentPlayer?.id

  // Server refusals ({type:'error'}) come through the socket: they undo an optimistic prompt
  // answer, show inside the trade builder when they answer a proposal, and toast. The socket
  // needs this handler before the action hooks exist, so it reaches them through a ref.
  const onRefusedRef = useRef<(error: string) => void>(() => {})
  const handleWsError = useCallback(
    (error: string) => {
      onRefusedRef.current(error)
      handleServerError(error)
    },
    [handleServerError]
  )

  const { sendAction, reconnect } = useWebSocket({
    roomCode: room,
    playerId: sessionStorage.getItem('player_id') || '',
    onError: handleWsError,
  })

  const turn = useTurnActions({ room, sendAction, gameState })
  const trades = usePlayerTrades({ sendAction, gameState, myPlayerId, lastTradeEvent })
  const { onRefused: turnRefused } = turn
  const { onRefused: tradeRefused } = trades
  useEffect(() => {
    onRefusedRef.current = (error) => {
      turnRefused()
      tradeRefused(error)
    }
  }, [turnRefused, tradeRefused])

  const [selectedTile, setSelectedTile] = useState<Coordinate | undefined>()

  // The game's ruleset (the server's until the first game_state arrives): every limit and word.
  const serverRuleset = useServerRuleset()
  const ruleset = gameState?.ruleset ?? serverRuleset
  const { theme } = rulesFor(ruleset)

  // Phone layout: the board can be folded away while a decision panel needs the room. The
  // player's choice holds until the phase changes.
  const [boardOverride, setBoardOverride] = useState<{ key: string; open: boolean } | null>(null)

  const phase = gameState?.phase ?? 'lobby'
  const currentTurnPlayerId = gameState?.current_player
  const isMyTurn = myPlayerId === currentTurnPlayerId
  const currentPlayerName =
    (currentTurnPlayerId && gameState?.players[currentTurnPlayerId]?.name) || ''
  const myPlayerData = (myPlayerId && gameState?.players[myPlayerId]) || null

  const chainPrices: ChainPrices = useMemo(
    () => Object.fromEntries((gameState?.hotel.chains ?? []).map((c) => [c.name, c.price])),
    [gameState]
  )

  const myHoldings: StockHolding[] = useMemo(() => {
    if (!myPlayerData) return []
    return Object.entries(myPlayerData.stocks)
      .filter(([, qty]) => qty > 0)
      .map(([chain, quantity]) => ({ chain: chain as ChainId, quantity }))
  }, [myPlayerData])

  const boardTileStates = useMemo(
    () => (gameState ? transformBoardToTileStates(gameState.board.cells) : {}),
    [gameState]
  )

  const rackTiles: RackTile[] = useMemo(() => {
    const playabilityMap = tilePlayability ? transformPlayabilityMap(tilePlayability) : undefined
    const reasons = tilePlayability ? unplayableReasons(tilePlayability, ruleset) : undefined
    return transformHandToRackTiles(yourHand, playabilityMap, reasons)
  }, [yourHand, tilePlayability, ruleset])

  // Tiles the engine says can be placed now. The board highlights and accepts clicks on these
  // only; unplayable tiles (8th chain, merging safe chains) must not be selectable there.
  const playableHand = useMemo(
    () => yourHand.filter((t) => tilePlayability?.[t]?.playable !== false),
    [yourHand, tilePlayability]
  )

  const activeChains = useMemo(() => {
    if (!gameState) return []
    const active = gameState.hotel.chains.filter((c) =>
      gameState.hotel.active_chains.includes(c.name)
    )
    const order = orderChainIds(
      ruleset,
      active.map((c) => c.name)
    )
    return [...active].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  }, [gameState, ruleset])

  const stockAvailability = gameState?.hotel.available_stocks ?? {}

  // Overlay while the socket is down, welcome-back card after.
  const { hasConnected, showReconnected, dismissReconnected } =
    useConnectionLifecycle(connectionStatus)
  const unavailable = roomUnavailable(connectionStatus, connectionError)
  const showReconnectionOverlay =
    hasConnected && connectionStatus !== 'connected' && unavailable === null

  const handlePlaceTile = () => {
    if (!selectedTile) return
    turn.placeTile(selectedTile)
    setSelectedTile(undefined)
  }

  const otherPlayers = useMemo(() => {
    if (!gameState || !myPlayerId) return []
    return Object.entries(gameState.players)
      .filter(([id]) => id !== myPlayerId)
      .map(([id, p]) => ({
        id,
        name: p.name,
        cash: p.money,
        stocks: p.stocks,
        isBot: p.is_bot,
        kind: p.kind,
        agentLabel: p.agent_label,
      }))
  }, [gameState, myPlayerId])

  // Tile placement: the board takes the clicks; this is the confirm / end-game strip.
  const renderPlacementActions = () => (
    <div className={styles.tilePlacementContent} data-testid="placement-actions">
      {isMyTurn && !selectedTile && (
        <p className={styles.hintText}>Pick a tile from your rack or click a lit square.</p>
      )}
      {isMyTurn && selectedTile && (
        <div className={styles.placementActions}>
          <p>
            Selected: <strong>{selectedTile}</strong>
          </p>
          <Button onClick={handlePlaceTile} loading={turn.loading} data-testid="place-tile-button">
            PLACE TILE
          </Button>
        </div>
      )}
      {isMyTurn && gameState?.end_game_available && (
        <div className={styles.placementActions}>
          <Button
            variant="danger"
            onClick={turn.declareEndGame}
            disabled={turn.loading}
            data-testid="end-game-button"
          >
            END GAME
          </Button>
        </div>
      )}
      {!isMyTurn && <p className={styles.waitingMessage}>Waiting for {currentPlayerName}...</p>}
    </div>
  )

  const renderFoundingContent = () => (
    <div className={styles.foundingContent}>
      <h3 className={styles.sectionTitle}>Found {withArticle(theme.chain_noun)}</h3>
      {pendingChainChoice && (
        <ChainSelector
          availableChains={pendingChainChoice}
          onSelect={turn.foundChain}
          stockAvailability={stockAvailability}
        />
      )}
    </div>
  )

  const renderMergerContent = () => (
    <div className={styles.mergerContent}>
      {pendingMergerChoice ? (
        <ChainSelector
          availableChains={pendingMergerChoice}
          onSelect={turn.chooseSurvivor}
          stockAvailability={stockAvailability}
          unavailableLabel="NOT TIED"
        />
      ) : pendingStockDisposition ? (
        <MergerDisposition
          defunctChain={pendingStockDisposition.defunctChain}
          survivorChain={pendingStockDisposition.survivingChain}
          sharesOwned={pendingStockDisposition.stockCount}
          defunctPrice={chainPrices[pendingStockDisposition.defunctChain] ?? 0}
          survivorStockAvailable={pendingStockDisposition.availableToTrade}
          onConfirm={(sell, trade, hold) =>
            turn.dispose(pendingStockDisposition.defunctChain, sell, trade, hold)
          }
        />
      ) : (
        <div className={styles.waitingMerger}>
          <Spinner />
          <p>Waiting for other players to dispose of their {theme.share_noun_plural}...</p>
        </div>
      )}
    </div>
  )

  // Page states outside a running game (unavailable, connecting, lobby, game over); null in game.
  const renderOutOfGame = () => {
    if (unavailable) {
      return (
        <div className={styles.error} data-testid="room-unavailable">
          <p>
            {unavailable === 'room'
              ? `Game ${room} was not found. Check the room code, or the game may have ended.`
              : `You are not a player in game ${room}. Join it from the home page.`}
          </p>
          <Button onClick={() => navigate('/')}>BACK TO HOME</Button>
        </div>
      )
    }
    if (connectionStatus === 'connecting' && !gameState) {
      return (
        <div className={styles.connecting}>
          <Spinner />
          <p>Connecting to game...</p>
        </div>
      )
    }
    if (connectionStatus === 'error' && !gameState) {
      return (
        <div className={styles.error}>
          <p>Connection error. Please refresh the page.</p>
          <Button onClick={() => window.location.reload()}>REFRESH</Button>
        </div>
      )
    }
    if (phase === 'lobby') {
      return (
        <LobbyPanel
          room={room}
          players={lobbyPlayers}
          isHost={isHost}
          canStart={canStart}
          minPlayers={ruleset.min_players}
          maxPlayers={ruleset.max_players}
          loading={turn.loading}
          onStart={turn.start}
        />
      )
    }
    if (phase === 'game_over') {
      return (
        <GameOver
          scores={buildFinalScores(gameState, gameOver)}
          myPlayerId={myPlayerId}
          onPlayAgain={() => navigate('/')}
          onBackToLobby={() => navigate('/')}
          variant="player"
          gameId={gameState?.game_id}
        />
      )
    }
    return null
  }

  // The decision panel for the current phase (in a game)
  const renderAction = () => {
    // Merger/disposition prompts can be mine even when it is not my turn
    const waiting = (
      <p className={styles.waitingMessage} data-testid="waiting-message">
        {waitingMessage(gameState?.awaiting, gameState?.players ?? {}, currentPlayerName, ruleset)}
      </p>
    )
    if (
      !isMyTurn &&
      phase !== 'stock_disposition' &&
      !pendingStockDisposition &&
      !pendingMergerChoice
    ) {
      return waiting
    }

    switch (phase) {
      case 'place_tile':
        return renderPlacementActions()
      case 'found_chain':
        return renderFoundingContent()
      case 'merger':
      case 'stock_disposition':
        return renderMergerContent()
      case 'buy_stocks':
        return (
          <BuyPanel
            chains={activeChains}
            bank={stockAvailability}
            cash={myPlayerData?.money ?? 0}
            isMyTurn={isMyTurn}
            endGameAvailable={!!gameState?.end_game_available}
            loading={turn.loading}
            onSubmit={turn.buy}
            onDeclareEndGame={turn.declareEndGame}
          />
        )
      default:
        return waiting
    }
  }

  // A decision panel (not the board) is what this phase is about: on a phone the board then
  // folds behind a "SHOW BOARD" button (one tap away); on wider screens it always shows.
  const decisionPhase =
    !!pendingMergerChoice ||
    !!pendingStockDisposition ||
    (isMyTurn && (phase === 'found_chain' || phase === 'buy_stocks'))
  const boardKey = `${phase}:${isMyTurn}:${decisionPhase}`
  const boardOpen = boardOverride?.key === boardKey ? boardOverride.open : !decisionPhase

  const outOfGame = renderOutOfGame()
  const inGame = phase !== 'lobby' && phase !== 'game_over'

  return (
    <RulesetScope ruleset={gameState?.ruleset}>
      <PageShell
        phase={
          unavailable
            ? undefined
            : pendingMergerChoice
              ? survivorPhaseText(ruleset)
              : pendingStockDisposition
                ? dispositionPhaseText(ruleset)
                : playerPhaseText(ruleset, phase, isMyTurn, currentPlayerName)
        }
        roomCode={room}
        cash={myPlayerData?.money}
        playerName={currentPlayer?.name}
        tilePool={gameState?.tiles_remaining ?? undefined}
        footer={
          inGame &&
          !outOfGame && (
            <TileRack
              tiles={rackTiles}
              selectedTile={selectedTile}
              onTileSelect={setSelectedTile}
              disabled={phase !== 'place_tile' || !isMyTurn}
            />
          )
        }
      >
        {outOfGame ? (
          <div className={styles.content}>{outOfGame}</div>
        ) : (
          <div className={styles.gameLayout} data-testid="game-layout">
            <section
              className={`${styles.boardPane} ${boardOpen ? '' : styles.boardFolded}`}
              aria-label="Board"
              data-testid="board-pane"
              data-folded={boardOpen ? undefined : 'true'}
            >
              <button
                type="button"
                className={styles.boardToggle}
                aria-expanded={boardOpen}
                onClick={() => setBoardOverride({ key: boardKey, open: !boardOpen })}
                data-testid="board-toggle"
              >
                {boardOpen ? 'HIDE BOARD ▲' : 'SHOW BOARD ▼'}
              </button>
              <div className={styles.boardBody}>
                <Board
                  tiles={boardTileStates}
                  highlightedTile={selectedTile}
                  playableTiles={new Set(playableHand)}
                  size="md"
                  interactive={isMyTurn && phase === 'place_tile'}
                  onTileClick={(coord) => {
                    if (playableHand.includes(coord)) setSelectedTile(coord)
                  }}
                />
              </div>
            </section>

            <div className={styles.sidePane}>
              <div className={styles.content}>{renderAction()}</div>

              {myPlayerId && gameState && (
                <TradeOffers
                  offers={myTrades}
                  myPlayerId={myPlayerId}
                  players={gameState.players}
                  onAccept={trades.accept}
                  onReject={trades.reject}
                  onCancel={trades.cancel}
                  onPropose={trades.openBuilder}
                />
              )}

              {gameState && <PlayersPanel gameState={gameState} myPlayerId={myPlayerId} />}

              <div className={styles.portfolioStrip}>
                <Portfolio holdings={myHoldings} prices={chainPrices} showTotal={false} />
              </div>
            </div>
          </div>
        )}
        {!unavailable && <ChatPanel room={room} />}

        {trades.builderOpen && (
          <Modal
            open={trades.builderOpen}
            onClose={trades.hideBuilder}
            title="Propose Trade"
            cancelLabel=""
          >
            <TradeBuilder
              players={otherPlayers}
              myHoldings={myHoldings}
              myCash={myPlayerData?.money ?? 0}
              onPropose={trades.propose}
              onCancel={trades.cancelBuilder}
              serverError={trades.error}
              submitting={trades.proposing}
              notice={
                phase === 'merger' || phase === 'stock_disposition'
                  ? `A ${theme.merger_noun} is in progress: ${theme.share_noun_plural} of the ${theme.chain_noun_plural} involved cannot be traded until it ends.`
                  : undefined
              }
            />
          </Modal>
        )}

        {showReconnectionOverlay && (
          <ReconnectionOverlay
            connectionStatus={connectionStatus === 'disconnected' ? 'disconnected' : 'reconnecting'}
            playerName={currentPlayer?.name}
            onReconnect={reconnect}
            onBackToLobby={() => navigate('/')}
          />
        )}

        {showReconnected && !showReconnectionOverlay && gameState && (
          <div className={styles.reconnectedToast}>
            <ReconnectedToast
              playerName={currentPlayer?.name ?? 'Player'}
              currentTurn={currentPlayerName}
              phase={playerPhaseText(ruleset, phase, isMyTurn, currentPlayerName)}
              cash={myPlayerData?.money ?? 0}
              stockCount={myHoldings.reduce((n, h) => n + h.quantity, 0)}
              tileCount={yourHand.length}
              onContinue={dismissReconnected}
            />
          </div>
        )}
      </PageShell>
    </RulesetScope>
  )
}
