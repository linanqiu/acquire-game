import { FlashValue } from '../ui/FlashValue'
import { ChainMarker } from './ChainMarker'
import { SeatKindBadge } from './SeatKindBadge'
import { AiThinking } from './AiThinking'
import { isAiThinking } from '../../lib/agents'
import { shortNames } from '../../lib/shortNames'
import { chainTestId } from '../../lib/ruleset'
import { useRules } from '../../ruleset/useRules'
import type { GameStateMessage } from '../../types/api'
import styles from './Standings.module.css'

export interface StandingsProps {
  gameState: GameStateMessage
  /** The viewer's seat (player page): marked YOU. */
  myPlayerId?: string
  /** Row test id: `player-row` on the player page, `player-card` on the host scoreboard. */
  rowTestId?: string
  /** Test id of the table's container. */
  testId?: string
}

const ROLE_WORD = { majority: 'most shares', minority: 'second most shares' } as const

/**
 * The table at a glance (BL-013, BL-014): one row per player, one column per chain, in the
 * ruleset's chain order, the same for every player, so holdings compare straight down a column.
 * A row is one line: the name (the seat-kind icon and YOU next to it), the share counts, cash,
 * and net worth with the rank in front of it (all from the server's calculator, never added up
 * here). A cell is the share count: filled with the chain colour for the majority holder,
 * outlined for the minority holder (`=` when the place is tied; roles are the server's
 * `chain_holders`), a quiet dot for none. Shares at current prices (net worth minus cash) are
 * printed where there is room (tablets, the sidebar, the host's TV) and are in the money cells'
 * tooltips and the seat popover otherwise. The footer gives each chain's size, price and shares
 * left in the bank, and is left out while no chain is on the board (nothing to say). Chains not
 * on the board keep their column, dimmed. Rows are in seat order so they do not jump around
 * while the ranks change.
 */
export function Standings({
  gameState,
  myPlayerId,
  rowTestId = 'player-row',
  testId = 'players-panel',
}: StandingsProps) {
  const rules = useRules()
  const { theme } = rules
  const current = gameState.current_player
  const order = gameState.turn_order?.length ? gameState.turn_order : Object.keys(gameState.players)
  const tied = (rank: number | undefined) =>
    rank !== undefined && Object.values(gameState.players).filter((p) => p.rank === rank).length > 1
  const chains = rules.rs.chains.map((c) => c.id)
  const active = new Set(gameState.hotel.active_chains)
  const chainInfo = (chain: string) => gameState.hotel.chains.find((c) => c.name === chain)
  const safeSize = gameState.ruleset?.safe_chain_size ?? rules.rs.safe_chain_size
  const symbol = theme.currency_symbol
  const names = shortNames(gameState.players)
  const stocksWord = theme.stock_label.toLowerCase()

  return (
    <div className={styles.standings} data-testid={testId}>
      <table
        className={styles.matrix}
        data-testid="holdings-matrix"
        data-players={order.length}
        data-footer={active.size > 0 ? 'true' : 'false'}
      >
        <caption className={styles.srOnly}>
          Players: {theme.share_noun_plural} held in each {theme.chain_noun}, cash and net worth
        </caption>
        <colgroup>
          <col className={styles.colName} />
          {chains.map((c) => (
            <col key={c} />
          ))}
          <col className={styles.colCash} />
          <col className={styles.colWorth} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={styles.nameHead}>
              Player
            </th>
            {chains.map((chain) => (
              <th
                key={chain}
                scope="col"
                className={`${styles.chainHead} ${active.has(chain) ? '' : styles.off}`}
                data-testid={`matrix-chain-${chainTestId(chain)}`}
                data-active={active.has(chain) ? 'true' : 'false'}
              >
                <ChainMarker chain={chain} variant="icon" />
              </th>
            ))}
            <th scope="col" className={styles.moneyHead}>
              Cash<span className={styles.wideOnly}> + {stocksWord}</span>
            </th>
            <th scope="col" className={styles.moneyHead}>
              Worth<span className={styles.srOnly}> and rank</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {order.map((id) => {
            const player = gameState.players[id]
            if (!player) return null
            const isTurn = id === current
            const isMe = id === myPlayerId
            const { head, rest } = names[id] ?? { head: player.name, rest: '' }
            const stockValue =
              player.stock_value !== undefined ? rules.money(player.stock_value) : ''
            const sum = stockValue
              ? `${player.name}: ${rules.money(player.money)} cash + ${stockValue} ${stocksWord}`
              : undefined
            return (
              <tr
                key={id}
                className={`${styles.row} ${isTurn ? styles.turn : ''} ${isMe ? styles.me : ''}`}
                data-testid={rowTestId}
                data-player-id={id}
                data-me={isMe ? 'true' : undefined}
                data-current-turn={isTurn ? 'true' : undefined}
              >
                <th scope="row" className={styles.name}>
                  <span className={styles.nameLine}>
                    {isTurn && (
                      <span className={styles.turnMarker} data-testid="turn-marker" title="On turn">
                        ▸<span className={styles.srOnly}> on turn</span>
                      </span>
                    )}
                    <span className={styles.nameText} title={player.name} data-testid="player-name">
                      {head}
                      {rest && <span className={styles.nameRest}>{rest}</span>}
                    </span>
                    <SeatKindBadge
                      playerId={id}
                      kind={player.kind}
                      isBot={player.is_bot}
                      agentLabel={player.agent_label}
                      fallbacks={player.fallbacks}
                      playerName={player.name}
                      extra={
                        stockValue
                          ? `Cash ${rules.money(player.money)} · ${stocksWord} ${stockValue}`
                          : undefined
                      }
                      size="inline"
                    />
                    {isMe && <span className={styles.you}>YOU</span>}
                    {isAiThinking(gameState.awaiting, id) && <AiThinking compact />}
                  </span>
                </th>
                {chains.map((chain) => {
                  const n = player.stocks[chain] ?? 0
                  const holder = gameState.chain_holders?.[chain]?.holders.find(
                    (h) => h.player_id === id
                  )
                  const role = n > 0 ? (holder?.role ?? null) : null
                  const isTied = !!role && !!holder?.tied
                  return (
                    <td
                      key={chain}
                      className={`${styles.cell} ${active.has(chain) ? '' : styles.off}`}
                      data-testid={`matrix-cell-${id}-${chain}`}
                      data-role={role ?? undefined}
                      data-tied={isTied ? 'true' : undefined}
                      title={`${player.name}: ${rules.shares(n)} of ${rules.name(chain)}${
                        role ? `, ${isTied ? 'tied for ' : ''}${ROLE_WORD[role]}` : ''
                      }`}
                    >
                      {n > 0 ? (
                        <span
                          className={`${styles.count} ${role ? styles[role] : ''}`}
                          style={role ? rules.style(chain) : undefined}
                        >
                          {isTied && <span aria-hidden="true">=</span>}
                          <span
                            data-testid={`player-stock-${id}-${chain}`}
                            data-abbr={rules.abbr(chain)}
                            style={rules.style(chain)}
                          >
                            {n}
                          </span>
                          {role && (
                            <span className={styles.srOnly}>
                              {' '}
                              {isTied ? 'tied for ' : ''}
                              {ROLE_WORD[role]}
                            </span>
                          )}
                        </span>
                      ) : (
                        <>
                          <span className={styles.none} aria-hidden="true">
                            ·
                          </span>
                          <span className={styles.srOnly}>none</span>
                        </>
                      )}
                    </td>
                  )
                })}
                <td className={styles.money} title={sum}>
                  <FlashValue
                    value={player.money}
                    className={styles.cash}
                    data-testid={`player-cash-${id}`}
                  >
                    {rules.money(player.money)}
                  </FlashValue>
                  {/* Shares at current prices: printed where there is room, always in the DOM. */}
                  <span className={styles.stockValue}>
                    <span aria-hidden="true"> +</span>
                    <span className={styles.srOnly}> {theme.stock_label}: </span>
                    <span data-testid={`player-stockvalue-${id}`}>{stockValue}</span>
                  </span>
                </td>
                <td className={styles.money} title={sum}>
                  <span
                    className={styles.rank}
                    data-testid={`player-rank-${id}`}
                    title={tied(player.rank) ? 'Tied on net worth' : 'Rank by net worth'}
                  >
                    {player.rank !== undefined
                      ? `${tied(player.rank) ? '=' : ''}#${player.rank}`
                      : ''}
                  </span>{' '}
                  <FlashValue
                    value={player.net_worth}
                    className={styles.worth}
                    data-testid={`player-networth-${id}`}
                  >
                    {player.net_worth !== undefined ? rules.money(player.net_worth) : ''}
                  </FlashValue>
                </td>
              </tr>
            )
          })}
        </tbody>
        {active.size > 0 && (
          <tfoot>
            <tr className={styles.footRow} data-testid="matrix-size">
              <th scope="row">Tiles</th>
              {chains.map((chain) => {
                const size = active.has(chain) ? (chainInfo(chain)?.size ?? 0) : 0
                const safe = size >= safeSize
                return (
                  <td
                    key={chain}
                    className={`${active.has(chain) ? '' : styles.off} ${safe ? styles.safe : ''}`}
                    data-testid={`matrix-size-${chainTestId(chain)}`}
                    title={safe ? `${rules.name(chain)} is ${theme.safe_phrase}` : undefined}
                  >
                    {size > 0 ? size : <Blank />}
                    {safe && <span className={styles.srOnly}> ({theme.safe_phrase})</span>}
                  </td>
                )
              })}
              <td colSpan={2} rowSpan={3} />
            </tr>
            <tr className={styles.footRow} data-testid="matrix-price">
              <th scope="row">Price {symbol}</th>
              {chains.map((chain) => {
                const price = active.has(chain) ? (chainInfo(chain)?.price ?? 0) : 0
                return (
                  <td
                    key={chain}
                    className={active.has(chain) ? '' : styles.off}
                    data-testid={`matrix-price-${chainTestId(chain)}`}
                    data-price={price}
                    title={price > 0 ? rules.money(price) : undefined}
                  >
                    {price > 0 ? price : <Blank />}
                  </td>
                )
              })}
            </tr>
            <tr className={styles.footRow} data-testid="matrix-bank">
              <th scope="row">Bank</th>
              {chains.map((chain) => (
                <td
                  key={chain}
                  className={active.has(chain) ? '' : styles.off}
                  data-testid={`matrix-bank-${chainTestId(chain)}`}
                  title={`${rules.shares(gameState.hotel.available_stocks[chain] ?? 0)} left in the bank`}
                >
                  {gameState.hotel.available_stocks[chain] ?? 0}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/**
 * How to read the matrix (it used to be a legend under the table; now it is in the "?" of the
 * phase bar, where it costs no height).
 */
export function StandingsLegend() {
  const rules = useRules()
  const { theme } = rules
  return (
    <ul className={styles.legend} data-testid="matrix-legend">
      <li>
        <span className={`${styles.count} ${styles.majority} ${styles.key}`}>5</span> most{' '}
        {theme.share_noun_plural} of a {theme.chain_noun} (1st bonus)
      </li>
      <li>
        <span className={`${styles.count} ${styles.minority} ${styles.key}`}>3</span> second most
        (2nd bonus)
      </li>
      <li>
        <span className={styles.keyText}>=</span> the place is tied
      </li>
      <li>
        <span className={`${styles.keyText} ${styles.safe}`}>11</span> tiles underlined: the{' '}
        {theme.chain_noun} is {theme.safe_phrase}
      </li>
      <li>
        <span className={styles.keyText}>#1</span> rank by net worth (cash +{' '}
        {theme.share_noun_plural} at current prices)
      </li>
    </ul>
  )
}

/** An empty figure: quiet for the eye, "none" for a screen reader. */
function Blank() {
  return (
    <>
      <span aria-hidden="true">·</span>
      <span className={styles.srOnly}>none</span>
    </>
  )
}
