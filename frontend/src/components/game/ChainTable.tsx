import { Fragment } from 'react'
import { ChainMarker } from './ChainMarker'
import { chainTestId, orderChainIds } from '../../lib/ruleset'
import { shortNames } from '../../lib/shortNames'
import { useRules, type Rules } from '../../ruleset/useRules'
import type { ChainHolder, ChainHolders, ChainId, GameStateMessage } from '../../types/api'
import styles from './ChainTable.module.css'

export interface ChainTableProps {
  gameState: GameStateMessage
  /** The viewer (player page): their shares and position in each chain. */
  myPlayerId?: string
}

const ORDINAL: Record<string, string> = { majority: '1st', minority: '2nd' }

type Names = ReturnType<typeof shortNames>

/** "Max", "Max & Rex": the short name on screen, the rest kept for screen readers and tests. */
function Who({ holders, names }: { holders: ChainHolder[]; names: Names }) {
  return (
    <>
      {holders.map((h, i) => {
        const n = names[h.player_id] ?? { head: '?', rest: '' }
        return (
          <Fragment key={h.player_id}>
            {i > 0 && ' & '}
            {n.head}
            {n.rest && <span className={styles.srOnly}>{n.rest}</span>}
          </Fragment>
        )
      })}
    </>
  )
}

/**
 * One bonus cell: who is 1st / 2nd, their shares and what they would be paid now. Ties and a
 * sole holder say so; the full names are in the title.
 */
function RoleCell({
  gameState,
  rules,
  names,
  info,
  role,
  chain,
  me,
}: {
  gameState: GameStateMessage
  rules: Rules
  names: Names
  info: ChainHolders
  role: 'majority' | 'minority'
  chain: ChainId
  me?: string
}) {
  const group = info.holders.filter((h) => h.role === role)
  const majorityTie = info.holders.filter((h) => h.role === 'majority').length > 1
  const sole = info.holders.length === 1
  const id = chainTestId(chain)
  if (group.length === 0) {
    // Nobody is 2nd: the tie for 1st (or the only holder) is paid both bonuses.
    if (role === 'minority' && (majorityTie || sole)) return null
    return (
      <span className={styles.cell} data-testid={`chain-${role}-${id}`}>
        <span className={styles.roleLabel}>{ORDINAL[role]}</span>
        <span className={styles.nobody}>nobody</span>
        <span className={styles.figures}>
          {rules.money(role === 'majority' ? info.majority_bonus : info.minority_bonus)}
        </span>
      </span>
    )
  }
  const tie = group.length > 1
  const shares = group[0].shares
  const label = tie ? `=${ORDINAL[role]}` : sole ? '1st+2nd' : ORDINAL[role]
  const isMe = !!me && group.some((h) => h.player_id === me)
  const full = group.map((h) => gameState.players[h.player_id]?.name ?? '?').join(' & ')
  // A tie for 1st or a sole holder takes both bonuses: the cell spans both columns.
  const wide = role === 'majority' && (majorityTie || sole)
  return (
    <span
      className={`${styles.cell} ${isMe ? styles.cellMe : ''} ${wide ? styles.wide : ''}`}
      data-testid={`chain-${role}-${id}`}
      data-tied={tie ? 'true' : undefined}
      title={
        tie
          ? `Tied for ${ORDINAL[role]}: ${full}, ${rules.shares(shares)} each; the bonus is shared`
          : sole
            ? `${full} is the only holder (${rules.shares(shares)}) and gets both bonuses`
            : `${ORDINAL[role]}: ${full}, ${rules.shares(shares)}`
      }
    >
      <span className={styles.roleLabel}>{label}</span>
      <span className={styles.who}>
        <Who holders={group} names={names} />
      </span>
      <span className={styles.figures}>
        {shares}&nbsp;&rarr;&nbsp;{rules.money(group[0].bonus)}
        {tie ? ' each' : ''}
      </span>
    </span>
  )
}

/** "1st", "tied 2nd", "3 behind 2nd", "2 ahead" ... for the viewer. */
function myPosition(info: ChainHolders, me: string): string {
  const mine = info.holders.find((h) => h.player_id === me)
  if (!mine) return ''
  const others = info.holders.filter((h) => h.player_id !== me)
  if (mine.role) {
    const label = `${mine.tied ? 'tied ' : ''}${ORDINAL[mine.role]}`
    const below = others.filter((h) => h.shares < mine.shares)
    const lead = below.length > 0 ? mine.shares - below[0].shares : null
    return lead !== null && !mine.tied ? `${label}, ${lead} ahead` : label
  }
  // Not paid: how far from the last paid position.
  const paid = info.holders.filter((h) => h.role !== null)
  const target = paid[paid.length - 1]
  if (!target) return ''
  const gap = target.shares - mine.shares
  return `${gap} behind ${ORDINAL[target.role!]}`
}

/**
 * The Chains tab (BL-018): one row per chain on the board, in the ruleset's order, under one
 * column header (Tiles / Price / Bank, as in the players table). Each row has a second line
 * with the 1st and 2nd holders in two aligned columns, with the bonus they would be paid if
 * the chain were bought now (from the server's `chain_holders`, computed by the engine's bonus
 * code). On the player page the viewer's own shares and position sit next to the chain's name.
 * Chains not on the board are one quiet line at the foot (with my shares in them, worth
 * nothing until the chain is founded again).
 */
export function ChainTable({ gameState, myPlayerId }: ChainTableProps) {
  const rules = useRules()
  const names = shortNames(gameState.players)
  const safeSize = gameState.ruleset?.safe_chain_size ?? rules.rs.safe_chain_size
  const activeIds = orderChainIds(rules.rs, gameState.hotel.active_chains)
  const active = activeIds
    .map((id) => gameState.hotel.chains.find((c) => c.name === id))
    .filter((c) => c !== undefined)
  const me = myPlayerId ? gameState.players[myPlayerId] : undefined
  const offIds = orderChainIds(
    rules.rs,
    rules.rs.chains.map((c) => c.id).filter((c) => !gameState.hotel.active_chains.includes(c))
  )

  const holdsNothing = !!me && Object.values(me.stocks).every((n) => !n)
  const noneHeld = holdsNothing && (
    <p className={styles.empty} data-testid="portfolio-empty">
      You hold no {rules.theme.share_noun_plural}
    </p>
  )

  return (
    <div className={styles.table} data-testid="chain-list">
      {active.length === 0 ? (
        <p className={styles.empty}>No {rules.theme.chain_noun_plural} on the board yet</p>
      ) : (
        <div className={`${styles.line} ${styles.columns}`} aria-hidden="true">
          <span />
          <span>Tiles</span>
          <span>Price</span>
          <span>Bank</span>
        </div>
      )}
      {active.map((chain) => {
        const info = gameState.chain_holders?.[chain.name]
        const mine = me?.stocks[chain.name] ?? 0
        const id = chainTestId(chain.name)
        return (
          <div
            key={chain.name}
            className={`${styles.chain} ${me && mine > 0 ? styles.held : ''}`}
            data-testid={`chain-row-${id}`}
          >
            <div className={styles.line}>
              <span className={styles.name}>
                <ChainMarker chain={chain.name} variant="compact" safe={chain.size >= safeSize} />
                {me && mine > 0 && (
                  <span className={styles.mine} data-testid={`portfolio-row-${id}`}>
                    <span className={styles.srOnly}>{rules.name(chain.name)}: </span>
                    you {mine}
                    {info && (
                      <span className={styles.position} data-testid={`chain-you-${id}`}>
                        {' · '}
                        {myPosition(info, myPlayerId!)}
                      </span>
                    )}
                  </span>
                )}
              </span>
              <span data-testid={`chain-size-${id}`}>
                {chain.size}
                <span className={styles.srOnly}> tiles</span>
              </span>
              <span data-testid={`chain-price-${id}`} className={styles.price}>
                <span className={styles.srOnly}>price </span>
                {rules.money(chain.price)}
              </span>
              <span data-testid={`chain-bank-${id}`}>
                {chain.stocks_available}
                <span className={styles.srOnly}> left in the bank</span>
              </span>
            </div>
            {info && (
              <div className={styles.roles}>
                {info.holders.length === 0 ? (
                  <span
                    className={`${styles.cell} ${styles.wide}`}
                    data-testid={`chain-majority-${id}`}
                  >
                    <span className={styles.nobody}>
                      no {rules.theme.share_noun_plural} held yet
                    </span>
                    <span className={styles.figures}>
                      {rules.money(info.majority_bonus)} / {rules.money(info.minority_bonus)}
                    </span>
                  </span>
                ) : (
                  <>
                    <RoleCell
                      gameState={gameState}
                      rules={rules}
                      names={names}
                      info={info}
                      role="majority"
                      chain={chain.name}
                      me={myPlayerId}
                    />
                    <RoleCell
                      gameState={gameState}
                      rules={rules}
                      names={names}
                      info={info}
                      role="minority"
                      chain={chain.name}
                      me={myPlayerId}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
      {offIds.length > 0 && (
        <div className={styles.offBoard} data-testid="chains-off-board">
          <span className={styles.offTitle}>Not on the board</span>
          {offIds.map((chain) => {
            const n = me?.stocks[chain] ?? 0
            return (
              <span
                key={chain}
                className={styles.offChain}
                data-testid={`chain-off-${chainTestId(chain)}`}
              >
                <span
                  className={styles.swatch}
                  style={rules.style(chain)}
                  role="img"
                  aria-label={rules.name(chain)}
                  title={rules.name(chain)}
                >
                  {rules.abbr(chain)}
                </span>
                {n > 0 && (
                  <span
                    className={styles.offMine}
                    data-testid={`portfolio-row-${chainTestId(chain)}`}
                    title={`You hold ${n}, worth ${rules.money(0)} until it is founded again`}
                  >
                    <span className={styles.srOnly}>{rules.name(chain)}: you </span>
                    {n}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      )}
      {noneHeld}
    </div>
  )
}
