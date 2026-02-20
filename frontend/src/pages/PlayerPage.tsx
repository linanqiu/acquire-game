import { useState, useMemo, useCallback, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useWebSocket } from '../hooks/useWebSocket'
import { PageShell } from '../components/ui/PageShell'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Spinner } from '../components/ui/Spinner'
import { TileRack, type RackTile } from '../components/game/TileRack'
import { Portfolio, type StockHolding, type ChainPrices } from '../components/game/Portfolio'
import { Board } from '../components/game/Board'
import { ChainSelector } from '../components/game/ChainSelector'
import { MergerDisposition } from '../components/game/MergerDisposition'
import { TradeBuilder } from '../components/game/TradeBuilder'
import { GameOver, type FinalScore } from '../components/game/GameOver'
import { StockStepper } from '../components/game/StockStepper'
import { ChainMarker } from '../components/game/ChainMarker'
import { useGameStore } from '../store/gameStore'
import { useToast } from '../components/ui/useToast'
import { useErrorHandler } from '../hooks/useErrorHandler'
import {
  transformBoardToTileStates,
  transformHandToRackTiles,
  transformPlayabilityMap,
} from '../utils/transforms'
import type { ChainName, GamePhase } from '../types/api'
import type { Coordinate } from '../types/game'
import styles from './PlayerPage.module.css'

// Phase display text
function getPhaseText(phase: GamePhase, isMyTurn: boolean, currentPlayerName: string): string {
  if (phase === 'lobby') return 'WAITING FOR HOST'
  if (phase === 'game_over') return 'GAME OVER'
  if (!isMyTurn) return `${currentPlayerName}'s TURN`

  switch (phase) {
    case 'place_tile':
      return 'PLACE A TILE'
    case 'found_chain':
      return 'CHOOSE A CHAIN'
    case 'merger':
      return 'MERGER IN PROGRESS'
    case 'stock_disposition':
      return 'DISPOSE YOUR STOCK'
    case 'buy_stocks':
      return 'BUY STOCKS'
    default: {
      // This handles any unexpected phases - phase is constrained by GamePhase type
      const _exhaustiveCheck: never = phase
      return String(_exhaustiveCheck).toUpperCase()
    }
  }
}

export function PlayerPage() {
  const room = useRoom()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isHost = searchParams.get('is_host') === '1'
  const { toast } = useToast()
  const { handleServerError } = useErrorHandler()

  // Stable callbacks for WebSocket to prevent infinite re-renders
  const handleWsError = useCallback(
    (error: string) => handleServerError(error),
    [handleServerError]
  )

  // WebSocket connection for game actions
  const { sendAction } = useWebSocket({
    roomCode: room,
    playerId: sessionStorage.getItem('player_id') || '',
    token: sessionStorage.getItem('session_token') || '',
    onError: handleWsError,
  })

  // Game store state
  const {
    connectionStatus,
    currentPlayer,
    lobbyPlayers,
    canStart,
    gameState,
    yourHand,
    tilePlayability,
    pendingChainChoice,
    pendingMergerChoice,
    pendingStockDisposition,
    setCurrentPlayer,
  } = useGameStore()

  // Initialize currentPlayer from sessionStorage on mount
  useEffect(() => {
    const playerId = sessionStorage.getItem('player_id')
    const playerName = sessionStorage.getItem('player_name')
    const token = sessionStorage.getItem('session_token')

    console.log('[PlayerPage] Initializing currentPlayer:', {
      playerId,
      playerName,
      hasToken: !!token,
      isHost,
    })

    if (playerId && playerName && token) {
      setCurrentPlayer({ id: playerId, name: playerName, token, isHost })
    }
  }, [setCurrentPlayer, isHost])

  // Local UI state
  const [selectedTile, setSelectedTile] = useState<Coordinate | undefined>()
  const [showTradeBuilder, setShowTradeBuilder] = useState(false)
  const [stockPurchases, setStockPurchases] = useState<Partial<Record<ChainName, number>>>({})
  const [actionLoading, setActionLoading] = useState(false)

  // Derived state
  const myPlayerId = currentPlayer?.id
  const phase = gameState?.phase ?? 'lobby'
  const currentTurnPlayerId = gameState?.current_player
  const isMyTurn = myPlayerId === currentTurnPlayerId

  const currentPlayerName = useMemo(() => {
    if (!gameState || !currentTurnPlayerId) return ''
    return gameState.players[currentTurnPlayerId]?.name ?? ''
  }, [gameState, currentTurnPlayerId])

  const myPlayerData = useMemo(() => {
    if (!gameState || !myPlayerId) return null
    return gameState.players[myPlayerId]
  }, [gameState, myPlayerId])

  const chainPrices: ChainPrices = useMemo(() => {
    if (!gameState) return {}
    const prices: ChainPrices = {}
    for (const chain of gameState.hotel.chains) {
      prices[chain.name] = chain.price
    }
    return prices
  }, [gameState])

  const myHoldings: StockHolding[] = useMemo(() => {
    if (!myPlayerData) return []
    return Object.entries(myPlayerData.stocks)
      .filter(([, qty]) => qty > 0)
      .map(([chain, quantity]) => ({
        chain: chain as ChainName,
        quantity,
      }))
  }, [myPlayerData])

  const boardTileStates = useMemo(() => {
    if (!gameState) return {}
    return transformBoardToTileStates(gameState.board.cells)
  }, [gameState])

  const rackTiles: RackTile[] = useMemo(() => {
    const playabilityMap = tilePlayability
      ? transformPlayabilityMap(tilePlayability)
      : undefined
    return transformHandToRackTiles(yourHand, playabilityMap)
  }, [yourHand, tilePlayability])

  const activeChains = useMemo(() => {
    if (!gameState) return []
    return gameState.hotel.chains.filter((c) => gameState.hotel.active_chains.includes(c.name))
  }, [gameState])

  const stockAvailability: Partial<Record<ChainName, number>> = useMemo(() => {
    if (!gameState) return {}
    return gameState.hotel.available_stocks
  }, [gameState])

  // Reset loading state when game state updates (action completed)
  useEffect(() => {
    if (gameState) {
      setActionLoading(false)
    }
  }, [gameState])

  // Safety timeout: reset actionLoading after 10 seconds to prevent stuck UI
  useEffect(() => {
    if (!actionLoading) return
    const timer = setTimeout(() => {
      setActionLoading(false)
    }, 10000)
    return () => clearTimeout(timer)
  }, [actionLoading])

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
      toast('Game started!', 'success')
    } catch (err) {
      console.error('Failed to start game:', err)
      toast('Failed to start game', 'error')
      setActionLoading(false)
    }
  }, [room, toast])

  const handleAddBot = useCallback(async () => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/room/${room}/add-bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        throw new Error('Failed to add bot')
      }
      toast('Bot added successfully', 'success')
    } catch (err) {
      console.error('Failed to add bot:', err)
      toast('Failed to add bot', 'error')
    } finally {
      setActionLoading(false)
    }
  }, [room, toast])

  const handlePlaceTile = useCallback(() => {
    if (!selectedTile) return
    setActionLoading(true)
    sendAction({ action: 'place_tile', tile: selectedTile })
    setSelectedTile(undefined)
  }, [selectedTile, sendAction])

  const handleFoundChain = useCallback(
    (chain: ChainName) => {
      setActionLoading(true)
      sendAction({ action: 'found_chain', chain })
    },
    [sendAction]
  )

  const handleMergerChoice = useCallback(
    (chain: ChainName) => {
      setActionLoading(true)
      sendAction({ action: 'merger_choice', surviving_chain: chain })
    },
    [sendAction]
  )

  const handleMergerDisposition = useCallback(
    (sell: number, trade: number, hold: number) => {
      if (!pendingStockDisposition) return
      setActionLoading(true)
      sendAction({
        action: 'merger_disposition',
        defunct_chain: pendingStockDisposition.defunctChain,
        disposition: { sell, trade, hold },
      })
    },
    [sendAction, pendingStockDisposition]
  )

  const handleBuyStocks = useCallback(() => {
    setActionLoading(true)
    sendAction({ action: 'buy_stocks', purchases: stockPurchases })
    setStockPurchases({})
  }, [stockPurchases, sendAction])

  const handleProposeTrade = useCallback(
    (
      partnerId: string,
      offer: { stocks: { chain: ChainName; quantity: number }[]; cash: number },
      want: { stocks: { chain: ChainName; quantity: number }[]; cash: number }
    ) => {
      setActionLoading(true)
      // Transform array format to record format expected by API
      const offeringStocks: Partial<Record<ChainName, number>> = {}
      for (const { chain, quantity } of offer.stocks) {
        offeringStocks[chain] = quantity
      }
      const requestingStocks: Partial<Record<ChainName, number>> = {}
      for (const { chain, quantity } of want.stocks) {
        requestingStocks[chain] = quantity
      }
      sendAction({
        action: 'propose_trade',
        to_player_id: partnerId,
        offering_stocks: offeringStocks,
        offering_money: offer.cash,
        requesting_stocks: requestingStocks,
        requesting_money: want.cash,
      })
      setShowTradeBuilder(false)
    },
    [sendAction]
  )

  const handlePlayAgain = useCallback(() => {
    navigate('/')
  }, [navigate])

  const handleBackToLobby = useCallback(() => {
    navigate('/')
  }, [navigate])

  // Update stock purchase amount
  const updatePurchase = useCallback((chain: ChainName, qty: number) => {
    setStockPurchases((prev) => {
      const next = { ...prev }
      if (qty > 0) {
        next[chain] = qty
      } else {
        delete next[chain]
      }
      return next
    })
  }, [])

  // Calculate total purchase cost
  const totalPurchaseCost = useMemo(() => {
    return Object.entries(stockPurchases).reduce((sum, [chain, qty]) => {
      const price = chainPrices[chain] ?? 0
      return sum + price * qty
    }, 0)
  }, [stockPurchases, chainPrices])

  const totalSharesPurchased = useMemo(() => {
    return Object.values(stockPurchases).reduce((sum, qty) => sum + qty, 0)
  }, [stockPurchases])

  // Build other players list for trade
  const otherPlayers = useMemo(() => {
    if (!gameState || !myPlayerId) return []
    return Object.entries(gameState.players)
      .filter(([id]) => id !== myPlayerId)
      .map(([id, p]) => ({
        id,
        name: p.name,
        cash: p.money,
        stocks: p.stocks,
      }))
  }, [gameState, myPlayerId])

  // Render lobby content
  const renderLobbyContent = () => (
    <div className={styles.lobbyContent}>
      <h2 className={styles.lobbyTitle}>WAITING FOR PLAYERS</h2>
      <p className={styles.roomInfo}>
        Room Code: <span className={styles.roomCode}>{room}</span>
      </p>
      <div className={styles.playerList}>
        {lobbyPlayers.map((p) => (
          <div key={p.player_id} className={styles.lobbyPlayer}>
            <span>{p.name}</span>
            {p.is_bot && <span className={styles.botBadge}>BOT</span>}
          </div>
        ))}
      </div>
      <p className={styles.playerCount}>{lobbyPlayers.length}/6 players</p>
      {isHost && (
        <div className={styles.hostActions}>
          <Button
            variant="secondary"
            onClick={handleAddBot}
            disabled={lobbyPlayers.length >= 6 || actionLoading}
          >
            + ADD BOT
          </Button>
          <Button
            onClick={handleStartGame}
            disabled={!canStart || actionLoading}
            loading={actionLoading}
          >
            START GAME
          </Button>
        </div>
      )}
      {!isHost && <p className={styles.waitingText}>Waiting for host to start...</p>}
    </div>
  )

  // Render tile placement content
  const renderTilePlacementContent = () => (
    <div className={styles.tilePlacementContent}>
      <div className={styles.boardContainer}>
        <Board
          tiles={boardTileStates}
          highlightedTile={selectedTile}
          playableTiles={new Set(yourHand)}
          size="md"
          interactive={isMyTurn}
          onTileClick={(coord) => {
            if (yourHand.includes(coord)) {
              setSelectedTile(coord)
            }
          }}
        />
      </div>
      {isMyTurn && selectedTile && (
        <div className={styles.placementActions}>
          <p>
            Selected: <strong>{selectedTile}</strong>
          </p>
          <Button onClick={handlePlaceTile} loading={actionLoading} data-testid="place-tile-button">
            PLACE TILE
          </Button>
        </div>
      )}
      {!isMyTurn && <p className={styles.waitingMessage}>Waiting for {currentPlayerName}...</p>}
    </div>
  )

  // Render chain founding content
  const renderFoundingContent = () => (
    <div className={styles.foundingContent}>
      <h3 className={styles.sectionTitle}>FOUND A NEW CHAIN</h3>
      {pendingChainChoice && (
        <ChainSelector
          availableChains={pendingChainChoice}
          onSelect={handleFoundChain}
          stockAvailability={stockAvailability}
        />
      )}
    </div>
  )

  // Render merger content
  const renderMergerContent = () => (
    <div className={styles.mergerContent}>
      {pendingMergerChoice ? (
        <ChainSelector
          availableChains={pendingMergerChoice}
          onSelect={handleMergerChoice}
          stockAvailability={{}}
        />
      ) : pendingStockDisposition ? (
        <MergerDisposition
          defunctChain={pendingStockDisposition.defunctChain}
          survivorChain={pendingStockDisposition.survivingChain}
          sharesOwned={pendingStockDisposition.stockCount}
          defunctPrice={chainPrices[pendingStockDisposition.defunctChain] ?? 0}
          survivorStockAvailable={pendingStockDisposition.availableToTrade}
          onConfirm={handleMergerDisposition}
        />
      ) : (
        <div className={styles.waitingMerger}>
          <Spinner />
          <p>Waiting for other players to dispose their stock...</p>
        </div>
      )}
    </div>
  )

  // Render stock buying content
  const renderBuyingContent = () => {
    const canAfford = (myPlayerData?.money ?? 0) >= totalPurchaseCost
    const validPurchase = totalSharesPurchased <= 3

    return (
      <div className={styles.buyingContent}>
        <Card title="BUY STOCKS">
          <div className={styles.stockPurchaseForm}>
            {activeChains.length === 0 ? (
              <p className={styles.noChains}>No active chains to purchase</p>
            ) : (
              activeChains.map((chain) => {
                const available = stockAvailability[chain.name] ?? 0
                const currentQty = stockPurchases[chain.name] ?? 0
                const maxBuyable = Math.min(available, 3 - totalSharesPurchased + currentQty)

                return (
                  <div key={chain.name} className={styles.purchaseRow}>
                    <ChainMarker chain={chain.name} variant="compact" price={chain.price} />
                    <StockStepper
                      value={currentQty}
                      max={maxBuyable}
                      onChange={(qty) => updatePurchase(chain.name, qty)}
                      disabled={!isMyTurn}
                    />
                    <span className={styles.availableStock}>[{available}]</span>
                  </div>
                )
              })
            )}
            <div className={styles.purchaseSummary}>
              <span>Total: ${totalPurchaseCost.toLocaleString()}</span>
              <span>({totalSharesPurchased}/3 shares)</span>
            </div>
            {!canAfford && <p className={styles.errorText}>Not enough cash</p>}
            {!validPurchase && <p className={styles.errorText}>Maximum 3 shares per turn</p>}
          </div>
        </Card>
        <div className={styles.buyingActions}>
          <Button
            variant="secondary"
            onClick={() => setShowTradeBuilder(true)}
            disabled={!isMyTurn || actionLoading}
          >
            PROPOSE TRADE
          </Button>
          <Button
            onClick={handleBuyStocks}
            disabled={!isMyTurn || !canAfford || !validPurchase || actionLoading}
            loading={actionLoading}
            data-testid="end-turn-button"
          >
            {totalSharesPurchased > 0 ? 'BUY & END TURN' : 'SKIP & END TURN'}
          </Button>
        </div>
      </div>
    )
  }

  // Render game over content
  const renderGameOverContent = () => {
    // TODO: Backend should provide final scores with bonus breakdown in game_over phase.
    // Currently we only show cash. The actual breakdown (bonuses, stockSales) needs to
    // come from the game_over message or be calculated from the final game state.
    // See: RT-002 for WebSocket message handling
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
      <GameOver
        scores={scores}
        myPlayerId={myPlayerId}
        onPlayAgain={handlePlayAgain}
        onBackToLobby={handleBackToLobby}
        variant="player"
      />
    )
  }

  // Render waiting content for when it's not your turn
  const renderWaitingContent = () => (
    <div className={styles.waitingContent}>
      <div className={styles.boardContainer}>
        <Board tiles={boardTileStates} playableTiles={new Set(yourHand)} size="md" />
      </div>
      <p className={styles.waitingMessage}>
        Waiting for {currentPlayerName} to {phase === 'place_tile' ? 'place a tile' : 'take action'}
        ...
      </p>
    </div>
  )

  // Main content renderer
  const renderMainContent = () => {
    if (connectionStatus === 'connecting') {
      return (
        <div className={styles.connecting}>
          <Spinner />
          <p>Connecting to game...</p>
        </div>
      )
    }

    if (connectionStatus === 'error') {
      return (
        <div className={styles.error}>
          <p>Connection error. Please refresh the page.</p>
          <Button onClick={() => window.location.reload()}>REFRESH</Button>
        </div>
      )
    }

    if (phase === 'lobby') {
      return renderLobbyContent()
    }

    if (phase === 'game_over') {
      return renderGameOverContent()
    }

    // During game phases
    // Allow rendering merger/disposition content when we have a pending stock
    // disposition or merger choice, even if it's not technically our turn
    if (!isMyTurn && phase !== 'stock_disposition' && !pendingStockDisposition && !pendingMergerChoice) {
      return renderWaitingContent()
    }

    switch (phase) {
      case 'place_tile':
        return renderTilePlacementContent()
      case 'found_chain':
        return renderFoundingContent()
      case 'merger':
      case 'stock_disposition':
        return renderMergerContent()
      case 'buy_stocks':
        return renderBuyingContent()
      default:
        return renderWaitingContent()
    }
  }

  const showTileRack = phase !== 'lobby' && phase !== 'game_over'
  const showPortfolio = phase !== 'lobby' && phase !== 'game_over'
  const showPlayersPanel = phase !== 'lobby' && phase !== 'game_over'

  // Render players panel showing all players' cash and stock holdings
  const renderPlayersPanel = () => {
    if (!gameState) return null
    return (
      <div className={styles.playersPanel}>
        <h4 className={styles.playersPanelTitle}>PLAYERS</h4>
        {Object.entries(gameState.players).map(([id, player]) => (
          <div
            key={id}
            className={`${styles.playerRow} ${id === currentTurnPlayerId ? styles.activePlayer : ''}`}
          >
            <span className={styles.playerName}>
              {player.name}
              {id === myPlayerId && <span className={styles.youBadge}>YOU</span>}
            </span>
            <span className={styles.playerCash}>${player.money.toLocaleString()}</span>
            <div className={styles.playerStocks}>
              {Object.entries(player.stocks)
                .filter(([, count]) => count > 0)
                .map(([chain, count]) => (
                  <span
                    key={chain}
                    className={`${styles.stockBadge} bg-${chain.toLowerCase()}`}
                  >
                    {count}
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <PageShell
      phase={pendingMergerChoice ? 'CHOOSE SURVIVING CHAIN' : pendingStockDisposition ? 'DISPOSE YOUR STOCK' : getPhaseText(phase, isMyTurn, currentPlayerName)}
      roomCode={room}
      cash={myPlayerData?.money}
      playerName={currentPlayer?.name}
      tilePool={gameState?.tiles_remaining ?? undefined}
      footer={
        showTileRack && (
          <TileRack
            tiles={rackTiles}
            selectedTile={selectedTile}
            onTileSelect={setSelectedTile}
            disabled={phase !== 'place_tile' || !isMyTurn}
          />
        )
      }
    >
      <div className={styles.content}>{renderMainContent()}</div>

      {showPlayersPanel && renderPlayersPanel()}

      {showPortfolio && (
        <div className={styles.portfolioStrip}>
          <Portfolio holdings={myHoldings} prices={chainPrices} showTotal={false} />
        </div>
      )}

      {/* Trade Builder Modal */}
      {showTradeBuilder && (
        <Modal
          open={showTradeBuilder}
          onClose={() => setShowTradeBuilder(false)}
          title="Propose Trade"
        >
          <TradeBuilder
            players={otherPlayers}
            myHoldings={myHoldings.map((h) => ({ chain: h.chain, quantity: h.quantity }))}
            myCash={myPlayerData?.money ?? 0}
            onPropose={handleProposeTrade}
            onCancel={() => setShowTradeBuilder(false)}
          />
        </Modal>
      )}
    </PageShell>
  )
}
