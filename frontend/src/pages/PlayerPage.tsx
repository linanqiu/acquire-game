import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useWebSocket } from '../hooks/useWebSocket'
import { useConnectionLifecycle } from '../hooks/useConnectionLifecycle'
import { PageShell } from '../components/ui/PageShell'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Spinner } from '../components/ui/Spinner'
import { TileRack, RackNotes, type RackTile } from '../components/game/TileRack'
import { Standings, StandingsLegend } from '../components/game/Standings'
import { ChainTable } from '../components/game/ChainTable'
import { hintSeen, markHintSeen } from '../lib/hints'
import { MergerLog } from '../components/game/MergerResult'
import { StatusLine } from '../components/game/StatusLine'
import { useMergerResult } from '../hooks/useMergerResult'
import { Board } from '../components/game/Board'
import { TradeBuilder } from '../components/game/TradeBuilder'
import { TradeOffers } from '../components/game/TradeOffers'
import { TradeActivity } from '../components/game/TradeActivity'
import { competingOffer } from '../lib/trades'
import { ReconnectionOverlay } from '../components/game/ReconnectionOverlay'
import { ReconnectedToast } from '../components/game/ReconnectedToast'
import { GameOver } from '../components/game/GameOver'
import { ChatPanel } from '../components/game/ChatPanel'
import { GameLayout } from '../components/game/GameLayout'
import { WIDE_QUERY, shortLabel } from '../lib/gameTabs'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { decisionEvents, decisionView, turnKey } from '../lib/decision'
import { shortNames } from '../lib/shortNames'
import { buildFinalScores } from '../lib/finalScores'
import { roomUnavailable } from '../lib/roomAvailability'
import { useGameStore } from '../store/gameStore'
import { useFallbackToasts } from '../hooks/useFallbackToasts'
import { useErrorHandler } from '../hooks/useErrorHandler'
import {
  transformBoardToTileStates,
  transformHandToRackTiles,
  transformPlayabilityMap,
  unplayableReasons,
} from '../utils/transforms'
import type { ChainId, GameStateMessage } from '../types/api'
import { RulesetScope } from '../ruleset/RulesetScope'
import { rulesFor, useServerRuleset } from '../ruleset/useRules'
import { orderChainIds } from '../lib/ruleset'
import {
  dispositionPhaseText,
  lobbyPhaseText,
  orderPhaseText,
  playerPhaseText,
  survivorPhaseText,
  waitingPhaseText,
} from '../lib/phaseText'
import type { Coordinate } from '../types/game'
import { DecisionTab } from './player/DecisionTab'
import { LobbyPanel } from './player/LobbyPanel'
import { usePlayerTrades } from './player/usePlayerTrades'
import { useTurnActions } from './player/useTurnActions'
import styles from './PlayerPage.module.css'

type StockHolding = { chain: ChainId; quantity: number }

/** Runs `then` whenever its tab is (or becomes) the one shown. */
function WhenShown({ shown, then }: { shown: boolean; then: () => void }) {
  useEffect(() => {
    if (shown) then()
  }, [shown, then])
  return null
}

const nameIn = (state: GameStateMessage | null, id: string) =>
  state?.players[id]?.name ?? 'another player'

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
    pendingMergerOrder,
    pendingStockDisposition,
    trades: myTrades,
    publicTrades,
    tradeLog,
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
  const trades = usePlayerTrades({
    sendAction,
    gameState,
    myPlayerId,
    tradeLog,
    publicTrades,
  })
  const { onRefused: turnRefused } = turn
  const { onRefused: tradeRefused } = trades
  useEffect(() => {
    onRefusedRef.current = (error) => {
      turnRefused()
      tradeRefused(error)
    }
  }, [turnRefused, tradeRefused])

  const [selectedTile, setSelectedTile] = useState<Coordinate | undefined>()
  const tilesOnBoard = Object.values(gameState?.board.cells ?? {}).filter(
    (c) => c.state !== 'empty'
  ).length
  const mergerResult = useMergerResult(gameState?.mergers, tilesOnBoard)
  // Bumped to bring the table panel into view: ANSWER on an offer listed in the Trades tab,
  // and the phase bar while my move waits on another tab.
  const [answer, setAnswer] = useState(0)
  // Is the table panel (my decision, the players table) on screen? What it shows is not said
  // again by the header (my cash, worth, rank) or by a second status line (BL-017).
  const [tableVisible, setTableVisible] = useState(true)

  // The game's ruleset (the server's until the first game_state arrives): every limit and word.
  const serverRuleset = useServerRuleset()
  const ruleset = gameState?.ruleset ?? serverRuleset
  const rules = rulesFor(ruleset)
  const { theme } = rules
  const wide = useMediaQuery(WIDE_QUERY)

  const phase = gameState?.phase ?? 'lobby'
  const currentTurnPlayerId = gameState?.current_player
  const isMyTurn = myPlayerId === currentTurnPlayerId
  const currentPlayerName =
    (currentTurnPlayerId && gameState?.players[currentTurnPlayerId]?.name) || ''
  const myPlayerData = (myPlayerId && gameState?.players[myPlayerId]) || null

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

  // Overlay while the socket is down, welcome-back card after.
  const { hasConnected, showReconnected, dismissReconnected } =
    useConnectionLifecycle(connectionStatus)
  const unavailable = roomUnavailable(connectionStatus, connectionError)
  const showReconnectionOverlay =
    hasConnected && connectionStatus !== 'connected' && unavailable === null

  const handlePlaceTile = () => {
    if (!selectedTile) return
    turn.placeTile(selectedTile)
    markHintSeen('place')
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
          variant="player"
          gameId={gameState?.game_id}
        />
      )
    }
    return null
  }

  const outOfGame = renderOutOfGame()
  const inGame = phase !== 'lobby' && phase !== 'game_over'

  const rack = inGame && !outOfGame && (
    <TileRack
      tiles={rackTiles}
      selectedTile={selectedTile}
      onTileSelect={setSelectedTile}
      disabled={phase !== 'place_tile' || !isMyTurn}
      notes={wide}
    />
  )
  // Is it on me to act right now (turn signal)?
  const myDecision =
    !!pendingMergerChoice ||
    !!pendingMergerOrder ||
    !!pendingStockDisposition ||
    (isMyTurn && phase !== 'merger' && phase !== 'stock_disposition')

  const incoming = myTrades.filter((t) => t.to_player_id === myPlayerId)
  const incomingCount = incoming.length

  // The decision tab (BL-011): which view, the events that bring the page to it, the status.
  const mergers = gameState?.mergers ?? []
  const lastMerger = mergers[mergers.length - 1]
  const view = decisionView({
    phase,
    isMyTurn,
    survivorChoice: !!pendingMergerChoice,
    orderChoice: !!pendingMergerOrder,
    disposition: !!pendingStockDisposition,
    foundChoice: !!pendingChainChoice,
    mergerInProgress: !!lastMerger && !lastMerger.complete,
  })
  const events = decisionEvents({
    turnKey: turnKey(currentTurnPlayerId, Object.keys(gameState?.board.cells ?? {}).length),
    view: decisionView({
      phase,
      isMyTurn,
      survivorChoice: !!pendingMergerChoice,
      orderChoice: !!pendingMergerOrder,
      disposition: !!pendingStockDisposition,
      foundChoice: !!pendingChainChoice,
      mergerInProgress: false,
    }),
    disposition:
      pendingStockDisposition && lastMerger
        ? { seq: lastMerger.seq, chain: pendingStockDisposition.defunctChain }
        : null,
    incomingTradeIds: incoming.map((t) => t.trade_id),
    mergers,
    live: mergerResult.live,
  })
  const placing = isMyTurn && phase === 'place_tile'
  // My cash, worth and rank are in my row of the players table, which is always in the table
  // panel (under my decision when there is one). The header shows them on the other tabs only:
  // what it shows changes with the tab, never mid-turn on the same tab.
  const showMyNumbers = inGame && !outOfGame && !tableVisible
  // The trade log without the offers that are still open: those are listed as offers.
  const pastTrades = useMemo(() => {
    const open = new Set([...myTrades, ...publicTrades].map((t) => t.trade_id))
    return tradeLog.filter((e) => !(e.kind === 'proposed' && open.has(e.tradeId)))
  }, [tradeLog, myTrades, publicTrades])

  // The phase bar: the one place that says what the game waits for.
  const names = useMemo(() => shortNames(gameState?.players ?? {}), [gameState?.players])
  const phaseText = unavailable
    ? undefined
    : phase === 'lobby'
      ? lobbyPhaseText(isHost, lobbyPlayers.length, ruleset.min_players)
      : pendingMergerChoice
        ? survivorPhaseText(ruleset)
        : pendingMergerOrder
          ? orderPhaseText(ruleset)
          : pendingStockDisposition
          ? dispositionPhaseText(ruleset)
          : myDecision || phase === 'game_over'
            ? playerPhaseText(ruleset, phase, isMyTurn, currentPlayerName)
            : waitingPhaseText(
                ruleset,
                gameState?.awaiting,
                gameState?.players ?? {},
                currentPlayerName,
                (id) => names[id]?.head
              )
  // What the placement line says next to its buttons (nothing to press: no line).
  const placementText = !placing
    ? null
    : selectedTile
      ? `Place ${selectedTile}?`
      : gameState?.end_game_available
        ? 'The game can end now'
        : null

  return (
    <RulesetScope ruleset={gameState?.ruleset}>
      <PageShell
        phase={phaseText}
        turn={unavailable || !inGame ? undefined : myDecision ? 'mine' : 'other'}
        // The lobby shows the room code large and game over shows the final cash; in a game the
        // header shows my numbers only while the players table (which has them) is not open.
        roomCode={inGame ? room : undefined}
        cash={showMyNumbers ? myPlayerData?.money : undefined}
        netWorth={showMyNumbers ? myPlayerData?.net_worth : undefined}
        rank={showMyNumbers ? myPlayerData?.rank : undefined}
        playerName={currentPlayer?.name}
        tilePool={inGame ? (gameState?.tiles_remaining ?? undefined) : undefined}
        inGame={inGame && !outOfGame}
        phaseLink={
          inGame && !outOfGame && myDecision && !tableVisible
            ? { label: wide ? 'Table' : 'Board', onOpen: () => setAnswer((n) => n + 1) }
            : undefined
        }
        fill={!outOfGame}
        helpFresh={placing && !hintSeen('place')}
        help={
          inGame && !outOfGame ? (
            <>
              <p data-testid="help-place">
                <strong>Your turn:</strong> pick a tile from your rack, or a marked square on the
                board, then PLACE TILE.
              </p>
              <StandingsLegend />
            </>
          ) : undefined
        }
      >
        {outOfGame ? (
          <div className={styles.content}>{outOfGame}</div>
        ) : (
          gameState && (
            <GameLayout
              room={room}
              scope="player"
              myId={myPlayerId}
              events={events}
              openTable={answer}
              myPlaceTurn={placing}
              deciding={
                incomingCount > 0 || !['place', 'waiting'].includes(view) || !!mergerResult.auto
              }
              onTableVisible={setTableVisible}
              board={
                <Board
                  tiles={boardTileStates}
                  highlightedTile={selectedTile}
                  playableTiles={new Set(playableHand)}
                  size="lg"
                  interactive={placing}
                  onTileClick={(coord) => {
                    if (playableHand.includes(coord)) setSelectedTile(coord)
                  }}
                />
              }
              rack={rack}
              status={
                placementText && (
                  <StatusLine text={placementText} mine>
                    <span className={styles.placementActions} data-testid="placement-actions">
                      {selectedTile && (
                        <Button
                          size="sm"
                          variant="accent"
                          onClick={handlePlaceTile}
                          loading={turn.loading}
                          data-testid="place-tile-button"
                        >
                          PLACE TILE
                        </Button>
                      )}
                      {gameState.end_game_available && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={turn.declareEndGame}
                          disabled={turn.loading}
                          data-testid="end-game-button"
                        >
                          END GAME
                        </Button>
                      )}
                    </span>
                  </StatusLine>
                )
              }
              table={
                <DecisionTab
                  view={view}
                  gameState={gameState}
                  myId={myPlayerId}
                  isMyTurn={isMyTurn}
                  incoming={
                    myPlayerId && (
                      <TradeOffers
                        part="incoming"
                        offers={myTrades}
                        myPlayerId={myPlayerId}
                        players={gameState.players}
                        onAccept={trades.accept}
                        onReject={trades.reject}
                        onCancel={trades.cancel}
                        onPropose={trades.openBuilder}
                      />
                    )
                  }
                  rackNotes={wide ? undefined : <RackNotes tiles={rackTiles} />}
                  standings={<Standings gameState={gameState} myPlayerId={myPlayerId} />}
                  pendingChainChoice={pendingChainChoice}
                  pendingMergerChoice={pendingMergerChoice}
                  pendingMergerOrder={pendingMergerOrder}
                  onMergerOrder={turn.chooseMergerOrder}
                  pendingStockDisposition={pendingStockDisposition}
                  activeChains={activeChains}
                  merger={mergerResult}
                  loading={turn.loading}
                  onFound={(chain) => {
                    markHintSeen('found')
                    turn.foundChain(chain)
                  }}
                  onSurvivor={(chain) => {
                    markHintSeen('survivor')
                    turn.chooseSurvivor(chain)
                  }}
                  onDispose={turn.dispose}
                  onBuy={turn.buy}
                  onDeclareEndGame={turn.declareEndGame}
                />
              }
              wideDefault="now"
              tabs={[
                {
                  id: 'chains',
                  label: shortLabel(theme.chain_noun_plural),
                  content: <ChainTable gameState={gameState} myPlayerId={myPlayerId} />,
                },
                {
                  id: 'chat',
                  label: 'Chat',
                  content: (shown) => <ChatPanel room={room} inTab active={shown} />,
                },
                {
                  id: 'trades',
                  label: 'Trades',
                  // Offers waiting for my answer are counted; a new offer between two
                  // other players is a quiet dot until the tab has been opened.
                  badge: incomingCount > 0 ? incomingCount : trades.newAtTable > 0 ? 'dot' : 0,
                  badgeLabel:
                    incomingCount > 0 ? `${incomingCount} for you` : 'new offer at the table',
                  content: (shown) => (
                    <div className={styles.tradesTab}>
                      <WhenShown shown={shown} then={trades.markTableSeen} />
                      {myPlayerId && (
                        <TradeOffers
                          part="mine"
                          offers={myTrades}
                          tableOffers={publicTrades}
                          myPlayerId={myPlayerId}
                          players={gameState.players}
                          onAccept={trades.accept}
                          onReject={trades.reject}
                          onCancel={trades.cancel}
                          onPropose={() => {
                            markHintSeen('trades')
                            trades.openBuilder()
                          }}
                          onAnswer={() => setAnswer((n) => n + 1)}
                          onCompete={(offer, target) =>
                            trades.openBuilderFrom(
                              competingOffer(
                                offer,
                                target,
                                myPlayerData ?? undefined,
                                gameState.players
                              )
                            )
                          }
                        />
                      )}
                      {pastTrades.length > 0 && (
                        <section aria-label="Recent trades">
                          <h4 className={styles.refTitle}>Recent trades</h4>
                          <TradeActivity events={pastTrades} players={gameState.players} />
                        </section>
                      )}
                      {/* No heading over nothing: the section appears with the first one. */}
                      {(gameState.mergers?.length ?? 0) > 0 && (
                        <section aria-label={theme.merger_noun_plural}>
                          <h4 className={styles.refTitle}>{theme.merger_noun_plural}</h4>
                          <MergerLog
                            mergers={gameState.mergers ?? []}
                            players={gameState.players}
                            gameState={gameState}
                            myId={myPlayerId}
                          />
                        </section>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )
        )}
        {/* Lobby, game over and the waiting screens: chat under the content. */}
        {!unavailable && outOfGame && <ChatPanel room={room} />}

        {trades.builderOpen && (
          <Modal
            open={trades.builderOpen}
            onClose={trades.hideBuilder}
            title="Propose a trade"
            cancelLabel=""
            variant="sheet"
          >
            <TradeBuilder
              key={trades.builderKey}
              initial={trades.prefill ?? undefined}
              startedFrom={
                trades.prefill
                  ? `Started from ${nameIn(gameState, trades.prefill.basedOn.from_player_id)}'s offer to ${nameIn(gameState, trades.prefill.basedOn.to_player_id)}. Change anything before you send it.`
                  : undefined
              }
              players={otherPlayers}
              myHoldings={myHoldings}
              myCash={myPlayerData?.money ?? 0}
              prices={Object.fromEntries(activeChains.map((c) => [c.name, c.price]))}
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
