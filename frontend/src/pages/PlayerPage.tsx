import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
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
import { TradeOffers } from '../components/game/TradeOffers'
import { ReconnectionOverlay } from '../components/game/ReconnectionOverlay'
import { ReconnectedToast } from '../components/game/ReconnectedToast'
import { GameOver } from '../components/game/GameOver'
import { StockStepper } from '../components/game/StockStepper'
import { ChainMarker } from '../components/game/ChainMarker'
import { AddAiControl } from '../components/game/AddAiControl'
import { SeatKindBadge } from '../components/game/SeatKindBadge'
import { RemoveSeatButton } from '../components/game/RemoveSeatButton'
import { AiThinking } from '../components/game/AiThinking'
import { isAiThinking, resolveSeatKind } from '../lib/agents'
import { buildFinalScores } from '../lib/finalScores'
import { roomUnavailable } from '../lib/roomAvailability'
import { waitingMessage } from '../lib/waiting'
import { useGameStore } from '../store/gameStore'
import { useToast } from '../components/ui/useToast'
import { useFallbackToasts } from '../hooks/useFallbackToasts'
import { useErrorHandler } from '../hooks/useErrorHandler'
import {
  transformBoardToTileStates,
  transformHandToRackTiles,
  transformPlayabilityMap,
  unplayableReasons,
} from '../utils/transforms'
import type { ChainId, GameAction } from '../types/api'
import { RulesetScope } from '../ruleset/RulesetScope'
import { rulesFor, useServerRuleset } from '../ruleset/useRules'
import { chainTestId, orderChainIds, withArticle } from '../lib/ruleset'
import {
  buyPhaseText,
  dispositionPhaseText,
  playerPhaseText,
  survivorPhaseText,
} from '../lib/phaseText'
import type { Coordinate } from '../types/game'
import styles from './PlayerPage.module.css'

export function PlayerPage() {
  const room = useRoom()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isHost = searchParams.get('is_host') === '1'
  const { toast } = useToast()
  useFallbackToasts()
  const { handleServerError } = useErrorHandler()

  // Set while a propose_trade is in flight so a server refusal can be shown inside the builder
  const [proposing, setProposing] = useState(false)
  const [tradeError, setTradeError] = useState('')
  const proposingRef = useRef(false)
  useEffect(() => {
    proposingRef.current = proposing
  }, [proposing])

  // Stable callbacks for WebSocket to prevent infinite re-renders
  // Chain / survivor / disposition prompts are cleared the moment the answer is sent (the server
  // sends no "resolved" message and the phase can stay `merger` across several prompts). If the
  // server then refuses the answer, this puts the prompt back so the player can try again.
  const restorePrompt = useRef<(() => void) | null>(null)

  const handleWsError = useCallback(
    (error: string) => {
      restorePrompt.current?.()
      restorePrompt.current = null
      if (proposingRef.current) {
        setTradeError(error)
        setProposing(false)
      }
      handleServerError(error)
    },
    [handleServerError]
  )

  // The game store is global: leaving this room (PLAY AGAIN, BACK TO LOBBY, another room)
  // must not leak its state into the next room, which would otherwise open on the old
  // game's screen (e.g. a brand-new room showing the previous GAME OVER).
  useEffect(() => () => useGameStore.getState().reset(), [room])

  // WebSocket connection for game actions
  const { sendAction, reconnect } = useWebSocket({
    roomCode: room,
    playerId: sessionStorage.getItem('player_id') || '',
    onError: handleWsError,
  })

  // Game store state
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
    trades,
    lastTradeEvent,
    gameOver,
    setCurrentPlayer,
  } = useGameStore()

  // Initialize currentPlayer from sessionStorage on mount
  useEffect(() => {
    const playerId = sessionStorage.getItem('player_id')
    const playerName = sessionStorage.getItem('player_name')

    console.log('[PlayerPage] Initializing currentPlayer:', {
      playerId,
      playerName,
      isHost,
    })

    if (playerId && playerName) {
      setCurrentPlayer({ id: playerId, name: playerName, isHost })
    }
  }, [setCurrentPlayer, isHost])

  // Local UI state
  const [selectedTile, setSelectedTile] = useState<Coordinate | undefined>()
  const [showTradeBuilder, setShowTradeBuilder] = useState(false)
  const [stockPurchases, setStockPurchases] = useState<Partial<Record<ChainId, number>>>({})
  const [actionLoading, setActionLoading] = useState(false)

  // The game's ruleset (the server's until the first game_state arrives): every limit and word.
  const serverRuleset = useServerRuleset()
  const ruleset = gameState?.ruleset ?? serverRuleset
  const rules = rulesFor(ruleset)
  const { theme } = rules
  const maxPurchases = ruleset.max_stock_purchases_per_turn
  const minPlayers = ruleset.min_players
  const maxPlayers = ruleset.max_players

  // Phone layout: the board can be folded away while a decision panel needs the room. The
  // player's choice holds until the phase changes.
  const [boardOverride, setBoardOverride] = useState<{ key: string; open: boolean } | null>(null)

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
        chain: chain as ChainId,
        quantity,
      }))
  }, [myPlayerData])

  const boardTileStates = useMemo(() => {
    if (!gameState) return {}
    return transformBoardToTileStates(gameState.board.cells)
  }, [gameState])

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

  const stockAvailability: Partial<Record<ChainId, number>> = useMemo(() => {
    if (!gameState) return {}
    return gameState.hotel.available_stocks
  }, [gameState])

  // --- Connection lifecycle: overlay while the socket is down, welcome-back card after ---
  const [hasConnected, setHasConnected] = useState(connectionStatus === 'connected')
  const [showReconnected, setShowReconnected] = useState(false)
  const prevStatusRef = useRef(connectionStatus)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = connectionStatus
    if (connectionStatus === 'connected') {
      setHasConnected(true)
      if (prev !== 'connected' && hasConnected) setShowReconnected(true)
    } else {
      setShowReconnected(false)
    }
  }, [connectionStatus, hasConnected])
  const unavailable = roomUnavailable(connectionStatus, connectionError)
  const showReconnectionOverlay =
    hasConnected && connectionStatus !== 'connected' && unavailable === null

  // --- Trade notifications (toast) and builder lifecycle ---
  const seenTradeSeq = useRef(lastTradeEvent?.seq ?? 0)
  useEffect(() => {
    if (!lastTradeEvent || lastTradeEvent.seq <= seenTradeSeq.current) return
    // A trade can resolve before the first game state arrives (an AI seat
    // answers at once). Wait for the state so the toast can name the player.
    if (!gameState) return
    seenTradeSeq.current = lastTradeEvent.seq
    if (!myPlayerId) return
    const nameOf = (id?: string) => (id && gameState?.players[id]?.name) || 'Someone'
    const { kind, trade, byPlayerId } = lastTradeEvent
    const mine = trade?.from_player_id === myPlayerId
    const toMe = trade?.to_player_id === myPlayerId
    if (!mine && !toMe) return
    if (kind === 'proposed') {
      if (mine) {
        toast(`Offer sent to ${nameOf(trade?.to_player_id)}`, 'success')
        setProposing(false)
        setShowTradeBuilder(false)
      } else {
        toast(`${nameOf(trade?.from_player_id)} sent you a trade offer`, 'info', 8000)
      }
    } else if (kind === 'accepted') {
      toast(
        mine
          ? `${nameOf(trade?.to_player_id)} accepted your offer`
          : `Trade with ${nameOf(trade?.from_player_id)} completed`,
        'success'
      )
    } else if (kind === 'rejected') {
      toast(
        byPlayerId === myPlayerId
          ? 'Offer rejected'
          : `${nameOf(trade?.to_player_id)} rejected your offer`,
        mine ? 'warning' : 'info'
      )
    } else if (kind === 'canceled') {
      toast(
        byPlayerId === myPlayerId
          ? 'Offer canceled'
          : `${nameOf(trade?.from_player_id)} withdrew their offer`,
        'info'
      )
    }
  }, [lastTradeEvent, myPlayerId, gameState, toast])

  // Reset loading state when game state updates (action completed)
  useEffect(() => {
    if (gameState) {
      setActionLoading(false)
      restorePrompt.current = null
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
      const res = await fetch(`/api/room/${room}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      if (!res.ok) {
        throw new Error('Failed to start game')
      }
    } catch (err) {
      console.error('Failed to start game:', err)
      toast('Failed to start game', 'error')
      setActionLoading(false)
    }
  }, [room, toast])

  const handlePlaceTile = useCallback(() => {
    if (!selectedTile) return
    setActionLoading(true)
    sendAction({ action: 'place_tile', tile: selectedTile })
    setSelectedTile(undefined)
  }, [selectedTile, sendAction])

  const answerPrompt = useCallback(
    (action: GameAction, prompt: 'chain' | 'merger' | 'disposition') => {
      const store = useGameStore.getState()
      const saved = {
        pendingChainChoice: store.pendingChainChoice,
        pendingMergerChoice: store.pendingMergerChoice,
        pendingStockDisposition: store.pendingStockDisposition,
      }
      setActionLoading(true)
      if (sendAction(action) === false) {
        setActionLoading(false)
        toast('Not connected to the game. Try again in a moment.', 'error')
        return
      }
      restorePrompt.current = () => {
        useGameStore.setState(saved)
        setActionLoading(false)
      }
      if (prompt === 'chain') useGameStore.setState({ pendingChainChoice: null })
      if (prompt === 'merger') useGameStore.setState({ pendingMergerChoice: null })
      if (prompt === 'disposition') useGameStore.setState({ pendingStockDisposition: null })
    },
    [sendAction, toast]
  )

  const handleFoundChain = useCallback(
    (chain: ChainId) => answerPrompt({ action: 'found_chain', chain }, 'chain'),
    [answerPrompt]
  )

  const handleMergerChoice = useCallback(
    (chain: ChainId) => answerPrompt({ action: 'merger_choice', surviving_chain: chain }, 'merger'),
    [answerPrompt]
  )

  const handleMergerDisposition = useCallback(
    (sell: number, trade: number, hold: number) => {
      if (!pendingStockDisposition) return
      answerPrompt(
        {
          action: 'merger_disposition',
          defunct_chain: pendingStockDisposition.defunctChain,
          disposition: { sell, trade, hold },
        },
        'disposition'
      )
    },
    [answerPrompt, pendingStockDisposition]
  )

  const handleBuyStocks = useCallback(() => {
    setActionLoading(true)
    // Skipping is a plain end_turn: it also works when the purchase for this turn is already
    // recorded (a second buy_stocks, even an empty one, is refused by the engine).
    const sharesBought = Object.values(stockPurchases).reduce<number>(
      (sum, qty) => sum + (qty ?? 0),
      0
    )
    if (sharesBought === 0) {
      sendAction({ action: 'end_turn' })
    } else {
      sendAction({ action: 'buy_stocks', purchases: stockPurchases })
    }
    setStockPurchases({})
  }, [stockPurchases, sendAction])

  const handleDeclareEndGame = useCallback(() => {
    setActionLoading(true)
    sendAction({ action: 'declare_end_game' })
  }, [sendAction])

  const handleProposeTrade = useCallback(
    (
      partnerId: string,
      offer: { stocks: { chain: ChainId; quantity: number }[]; cash: number },
      want: { stocks: { chain: ChainId; quantity: number }[]; cash: number }
    ) => {
      setTradeError('')
      // Transform array format to record format expected by API
      const offeringStocks: Partial<Record<ChainId, number>> = {}
      for (const { chain, quantity } of offer.stocks) {
        offeringStocks[chain] = quantity
      }
      const requestingStocks: Partial<Record<ChainId, number>> = {}
      for (const { chain, quantity } of want.stocks) {
        requestingStocks[chain] = quantity
      }
      const sent = sendAction({
        action: 'propose_trade',
        to_player_id: partnerId,
        offering_stocks: offeringStocks,
        offering_money: offer.cash,
        requesting_stocks: requestingStocks,
        requesting_money: want.cash,
      })
      if (sent === false) {
        setTradeError('Not connected to the game. Try again in a moment.')
        return
      }
      // The builder closes when the server confirms (trade_proposed) and stays open
      // with the server's reason when it refuses.
      setProposing(true)
    },
    [sendAction]
  )

  // Trade responses go over the same WebSocket as every other action. Trades are not
  // turn-bound, so no actionLoading here (it would lock the turn UI).
  const sendTradeResponse = useCallback(
    (action: 'accept_trade' | 'reject_trade' | 'cancel_trade', tradeId: string) => {
      if (sendAction({ action, trade_id: tradeId }) === false) {
        toast('Not connected to the game. Try again in a moment.', 'error')
      }
    },
    [sendAction, toast]
  )
  const handleAcceptTrade = useCallback(
    (id: string) => sendTradeResponse('accept_trade', id),
    [sendTradeResponse]
  )
  const handleRejectTrade = useCallback(
    (id: string) => sendTradeResponse('reject_trade', id),
    [sendTradeResponse]
  )
  const handleCancelTrade = useCallback(
    (id: string) => sendTradeResponse('cancel_trade', id),
    [sendTradeResponse]
  )

  const handlePlayAgain = useCallback(() => {
    navigate('/')
  }, [navigate])

  const handleBackToLobby = useCallback(() => {
    navigate('/')
  }, [navigate])

  // Update stock purchase amount
  const updatePurchase = useCallback((chain: ChainId, qty: number) => {
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
    return Object.entries(stockPurchases).reduce<number>((sum, [chain, qty]) => {
      const price = chainPrices[chain] ?? 0
      return sum + price * (qty ?? 0)
    }, 0)
  }, [stockPurchases, chainPrices])

  const totalSharesPurchased = useMemo(() => {
    return Object.values(stockPurchases).reduce<number>((sum, qty) => sum + (qty ?? 0), 0)
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
        isBot: p.is_bot,
        kind: p.kind,
        agentLabel: p.agent_label,
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
          <div
            key={p.player_id}
            className={styles.lobbyPlayer}
            data-testid={`lobby-player-${p.player_id}`}
          >
            <span>{p.name}</span>
            <span className={styles.seatTags}>
              <SeatKindBadge
                playerId={p.player_id}
                kind={p.kind}
                isBot={p.is_bot}
                agentLabel={p.agent_label}
              />
              {isHost && resolveSeatKind(p) !== 'human' && (
                <RemoveSeatButton room={room} playerId={p.player_id} playerName={p.name} />
              )}
            </span>
          </div>
        ))}
      </div>
      <p className={styles.playerCount}>
        {lobbyPlayers.length}/{maxPlayers} players
      </p>
      {isHost && (
        <div className={styles.hostActions}>
          <AddAiControl room={room} disabled={lobbyPlayers.length >= maxPlayers || actionLoading} />
          <Button
            onClick={handleStartGame}
            disabled={!canStart || actionLoading}
            loading={actionLoading}
          >
            START GAME
          </Button>
        </div>
      )}
      {isHost && (
        <p className={styles.waitingText} data-testid="start-hint">
          {lobbyPlayers.length < minPlayers
            ? `Need ${minPlayers - lobbyPlayers.length} more player${
                minPlayers - lobbyPlayers.length > 1 ? 's' : ''
              } to start`
            : 'Ready to start!'}
        </p>
      )}
      {!isHost && <p className={styles.waitingText}>Waiting for host to start...</p>}
    </div>
  )

  // The board. Always on screen in a game (desktop: its own column; phone: one tap away while
  // a decision panel needs the room).
  const renderBoard = () => (
    <Board
      tiles={boardTileStates}
      highlightedTile={selectedTile}
      playableTiles={new Set(playableHand)}
      size="md"
      interactive={isMyTurn && phase === 'place_tile'}
      onTileClick={(coord) => {
        if (playableHand.includes(coord)) {
          setSelectedTile(coord)
        }
      }}
    />
  )

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
          <Button onClick={handlePlaceTile} loading={actionLoading} data-testid="place-tile-button">
            PLACE TILE
          </Button>
        </div>
      )}
      {isMyTurn && gameState?.end_game_available && (
        <div className={styles.placementActions}>
          <Button
            variant="danger"
            onClick={handleDeclareEndGame}
            disabled={actionLoading}
            data-testid="end-game-button"
          >
            END GAME
          </Button>
        </div>
      )}
      {!isMyTurn && <p className={styles.waitingMessage}>Waiting for {currentPlayerName}...</p>}
    </div>
  )

  // Render chain founding content
  const renderFoundingContent = () => (
    <div className={styles.foundingContent}>
      <h3 className={styles.sectionTitle}>Found {withArticle(theme.chain_noun)}</h3>
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
          onConfirm={handleMergerDisposition}
        />
      ) : (
        <div className={styles.waitingMerger}>
          <Spinner />
          <p>Waiting for other players to dispose of their {theme.share_noun_plural}...</p>
        </div>
      )}
    </div>
  )

  // Render stock buying content
  const renderBuyingContent = () => {
    const canAfford = (myPlayerData?.money ?? 0) >= totalPurchaseCost
    const validPurchase = totalSharesPurchased <= maxPurchases
    const inStock = activeChains.filter((c) => (stockAvailability[c.name] ?? 0) > 0)
    const cannotAffordAny =
      inStock.length > 0 && inStock.every((c) => c.price > (myPlayerData?.money ?? 0))

    return (
      <div className={styles.buyingContent}>
        <Card title={buyPhaseText(ruleset)}>
          <div className={styles.stockPurchaseForm}>
            {activeChains.length === 0 ? (
              <p className={styles.noChains}>No active {theme.chain_noun_plural} to buy into</p>
            ) : (
              activeChains.map((chain) => {
                const available = stockAvailability[chain.name] ?? 0
                const currentQty = stockPurchases[chain.name] ?? 0
                // Limits: the per-turn maximum, what the bank has left, and what I can pay for.
                const cashLeft =
                  (myPlayerData?.money ?? 0) - totalPurchaseCost + currentQty * chain.price
                const affordable = chain.price > 0 ? Math.floor(cashLeft / chain.price) : 0
                const maxBuyable = Math.max(
                  0,
                  Math.min(available, maxPurchases - totalSharesPurchased + currentQty, affordable)
                )

                return (
                  <div
                    key={chain.name}
                    className={styles.purchaseRow}
                    data-testid={`buy-row-${chainTestId(chain.name)}`}
                    data-price={chain.price}
                    data-available={available}
                  >
                    <span className={styles.purchaseChain}>
                      <ChainMarker chain={chain.name} variant="compact" />
                    </span>
                    <span className={styles.chainPrice} data-testid="buy-price">
                      {rules.money(chain.price)}
                    </span>
                    <span className={styles.chainSize} data-testid="buy-size">
                      {chain.size} tiles
                    </span>
                    <StockStepper
                      value={currentQty}
                      max={maxBuyable}
                      onChange={(qty) => updatePurchase(chain.name, qty)}
                      disabled={!isMyTurn}
                    />
                    <span
                      className={styles.availableStock}
                      data-testid="buy-available"
                      title={`${theme.share_noun_plural} left in the bank`}
                    >
                      [{available}]
                    </span>
                  </div>
                )
              })
            )}
            <div className={styles.purchaseSummary}>
              <span data-testid="purchase-total">Total: {rules.money(totalPurchaseCost)}</span>
              <span data-testid="purchase-shares">
                ({totalSharesPurchased}/{maxPurchases} {theme.share_noun_plural})
              </span>
            </div>
            {cannotAffordAny && (
              <p className={styles.errorText} data-testid="buy-note-no-cash">
                You can&apos;t afford any {theme.share_noun_plural} right now.
              </p>
            )}
            {!canAfford && (
              <p className={styles.errorText} data-testid="buy-error-cash">
                Not enough cash
              </p>
            )}
            {!validPurchase && (
              <p className={styles.errorText}>
                Maximum {maxPurchases} {theme.share_noun_plural} per turn
              </p>
            )}
          </div>
        </Card>
        <div className={styles.buyingActions}>
          <Button
            onClick={handleBuyStocks}
            disabled={!isMyTurn || !canAfford || !validPurchase || actionLoading}
            loading={actionLoading}
            data-testid="end-turn-button"
          >
            {totalSharesPurchased > 0 ? 'BUY & END TURN' : 'SKIP & END TURN'}
          </Button>
          {gameState?.end_game_available && (
            <Button
              variant="danger"
              onClick={handleDeclareEndGame}
              disabled={!isMyTurn || actionLoading}
              loading={actionLoading}
              data-testid="end-game-button"
            >
              END GAME
            </Button>
          )}
        </div>
      </div>
    )
  }

  // Render game over content
  const renderGameOverContent = () => {
    const scores = buildFinalScores(gameState, gameOver)

    return (
      <GameOver
        scores={scores}
        myPlayerId={myPlayerId}
        onPlayAgain={handlePlayAgain}
        onBackToLobby={handleBackToLobby}
        variant="player"
        gameId={gameState?.game_id}
      />
    )
  }

  // Not my move: who the table is waiting on
  const renderWaitingContent = () => (
    <p className={styles.waitingMessage} data-testid="waiting-message">
      {waitingMessage(gameState?.awaiting, gameState?.players ?? {}, currentPlayerName, ruleset)}
    </p>
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
      return renderLobbyContent()
    }

    if (phase === 'game_over') {
      return renderGameOverContent()
    }
    return null
  }

  // The decision panel for the current phase (in a game)
  const renderAction = () => {
    // Merger/disposition prompts can be mine even when it is not my turn
    if (
      !isMyTurn &&
      phase !== 'stock_disposition' &&
      !pendingStockDisposition &&
      !pendingMergerChoice
    ) {
      return renderWaitingContent()
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
        return renderBuyingContent()
      default:
        return renderWaitingContent()
    }
  }

  const inGame = phase !== 'lobby' && phase !== 'game_over'
  const showTileRack = inGame
  // A decision panel (not the board) is what this phase is about: on a phone the board then
  // folds behind a "SHOW BOARD" button (one tap away); on wider screens it always shows.
  const decisionPhase =
    !!pendingMergerChoice ||
    !!pendingStockDisposition ||
    (isMyTurn && (phase === 'found_chain' || phase === 'buy_stocks'))
  const boardKey = `${phase}:${isMyTurn}:${decisionPhase}`
  const boardOpen = boardOverride?.key === boardKey ? boardOverride.open : !decisionPhase

  // Render players panel showing all players' cash and stock holdings
  const renderPlayersPanel = () => {
    if (!gameState) return null
    return (
      <div className={styles.playersPanel} data-testid="players-panel">
        <h4 className={styles.playersPanelTitle}>PLAYERS</h4>
        {Object.entries(gameState.players).map(([id, player]) => (
          <div
            key={id}
            className={`${styles.playerRow} ${id === currentTurnPlayerId ? styles.activePlayer : ''}`}
            data-testid="player-row"
            data-player-id={id}
            data-current-turn={id === currentTurnPlayerId ? 'true' : undefined}
          >
            <span className={styles.playerName}>
              {player.name}
              {id === myPlayerId && <span className={styles.youBadge}>YOU</span>}
              <SeatKindBadge
                playerId={id}
                kind={player.kind}
                isBot={player.is_bot}
                agentLabel={player.agent_label}
                fallbacks={player.fallbacks}
              />
              {isAiThinking(gameState.awaiting, id) && <AiThinking />}
            </span>
            <span className={styles.playerCash} data-testid={`player-cash-${id}`}>
              {rules.money(player.money)}
            </span>
            <div className={styles.playerStocks}>
              {orderChainIds(
                ruleset,
                Object.keys(player.stocks).filter((c) => (player.stocks[c] ?? 0) > 0)
              ).map((chain) => (
                <span
                  key={chain}
                  className={styles.stockBadge}
                  style={rules.style(chain)}
                  data-testid={`player-stock-${id}-${chain}`}
                  title={`${rules.name(chain)}: ${rules.shares(player.stocks[chain])}`}
                  data-abbr={rules.abbr(chain)}
                >
                  {player.stocks[chain]}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const outOfGame = renderOutOfGame()

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
          showTileRack &&
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
              <div className={styles.boardBody}>{renderBoard()}</div>
            </section>

            <div className={styles.sidePane}>
              <div className={styles.content}>{renderAction()}</div>

              {myPlayerId && gameState && (
                <TradeOffers
                  offers={trades}
                  myPlayerId={myPlayerId}
                  players={gameState.players}
                  onAccept={handleAcceptTrade}
                  onReject={handleRejectTrade}
                  onCancel={handleCancelTrade}
                  onPropose={() => {
                    setTradeError('')
                    setShowTradeBuilder(true)
                  }}
                />
              )}

              {renderPlayersPanel()}

              <div className={styles.portfolioStrip}>
                <Portfolio holdings={myHoldings} prices={chainPrices} showTotal={false} />
              </div>
            </div>
          </div>
        )}

        {/* Trade Builder Modal */}
        {showTradeBuilder && (
          <Modal
            open={showTradeBuilder}
            onClose={() => setShowTradeBuilder(false)}
            title="Propose Trade"
            cancelLabel=""
          >
            <TradeBuilder
              players={otherPlayers}
              myHoldings={myHoldings.map((h) => ({ chain: h.chain, quantity: h.quantity }))}
              myCash={myPlayerData?.money ?? 0}
              onPropose={handleProposeTrade}
              onCancel={() => {
                setShowTradeBuilder(false)
                setProposing(false)
              }}
              serverError={tradeError}
              submitting={proposing}
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
              onContinue={() => setShowReconnected(false)}
            />
          </div>
        )}
      </PageShell>
    </RulesetScope>
  )
}
