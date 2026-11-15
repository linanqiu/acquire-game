import type { CSSProperties } from 'react'
import { ChainMarker } from './ChainMarker'
import { chainTestId } from '../../lib/ruleset'
import { useRules, type Rules } from '../../ruleset/useRules'
import type { ChainHolder, ChainHolders, ChainId, GameStateMessage } from '../../types/api'
import styles from './ChainTable.module.css'

export interface ChainTableProps {
  gameState: GameStateMessage
  /** The viewer (player page): adds a "you" line per chain with their shares and position. */
  myPlayerId?: string
}

const ORDINAL: Record<string, string> = { majority: '1st', minority: '2nd' }

/** "Alice", "Alice & Bob" */
function names(gameState: GameStateMessage, holders: ChainHolder[]): string {
  return holders.map((h) => gameState.players[h.player_id]?.name ?? '?').join(' & ')
}

/**
 * One holder chip: who is 1st / 2nd, with how many shares and what they would be paid now, and
 * a thin bar for the share of the chain's stock they hold. Ties and a sole holder say so.
 */
function RoleChip({
  gameState,
  rules,
  info,
  role,
  chain,
  me,
}: {
  gameState: GameStateMessage
  rules: Rules
  info: ChainHolders
  role: 'majority' | 'minority'
  chain: ChainId
  me?: string
}) {
  const group = info.holders.filter((h) => h.role === role)
  const majorityTie = info.holders.filter((h) => h.role === 'majority').length > 1
  const sole = info.holders.length === 1
  let who: string
  let detail: string
  let shares = 0
  if (group.length > 0) {
    const tie = group.length > 1
    shares = group[0].shares
    who = names(gameState, group)
    detail = `${shares} → ${rules.money(group[0].bonus)}${tie ? ' each (tie)' : ''}${
      sole ? ' (sole holder: both bonuses)' : ''
    }`
  } else if (role === 'minority' && majorityTie) {
    who = 'none'
    detail = 'the tie for 1st shares both bonuses'
  } else if (role === 'minority' && sole) {
    return null
  } else {
    who = 'nobody'
    detail = rules.money(role === 'majority' ? info.majority_bonus : info.minority_bonus)
  }
  const isMe = !!me && group.some((h) => h.player_id === me)
  const total = rules.rs.stocks_per_chain || 25
  return (
    <span
      className={`${styles.chip} ${isMe ? styles.chipMe : ''}`}
      data-testid={`chain-${role}-${chainTestId(chain)}`}
      title={`${ORDINAL[role]}: ${who}, ${rules.shares(shares)}`}
    >
      <span className={styles.roleLabel}>{ORDINAL[role]}</span>
      <span className={styles.who}>{who}</span>
      <span className={styles.figures}>{detail}</span>
      {shares > 0 && (
        <span
          className={styles.bar}
          style={{ '--share': Math.min(1, shares / total) } as CSSProperties}
          aria-hidden="true"
        />
      )}
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
 * The chains on the board, biggest first: size, price, shares left in the bank, the majority
 * and minority holders with the bonuses they would be paid if the chain were bought now (from
 * the server's `chain_holders`, computed by the engine's bonus code), and on the player page
 * the viewer's own shares and position. Chains the viewer holds that are not on the board are
 * listed at the end (their shares are worth nothing until the chain is founded again).
 */
export function ChainTable({ gameState, myPlayerId }: ChainTableProps) {
  const rules = useRules()
  const safeSize = gameState.ruleset?.safe_chain_size ?? rules.rs.safe_chain_size
  const active = gameState.hotel.chains
    .filter((c) => gameState.hotel.active_chains.includes(c.name))
    .sort((a, b) => b.size - a.size)
  const me = myPlayerId ? gameState.players[myPlayerId] : undefined
  const heldOff = me
    ? Object.entries(me.stocks).filter(
        ([c, n]) => n > 0 && !gameState.hotel.active_chains.includes(c)
      )
    : []

  const holdsNothing = !!me && Object.values(me.stocks).every((n) => !n)
  const noneHeld = holdsNothing && (
    <p className={styles.empty} data-testid="portfolio-empty">
      You hold no {rules.theme.share_noun_plural}
    </p>
  )

  if (active.length === 0 && heldOff.length === 0) {
    return (
      <div className={styles.table} data-testid="chain-list">
        <p className={styles.empty}>No {rules.theme.chain_noun_plural} on the board yet</p>
        {noneHeld}
      </div>
    )
  }

  return (
    <div className={styles.table} data-testid="chain-list">
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
            <div className={styles.head}>
              <ChainMarker
                chain={chain.name}
                size={chain.size}
                price={chain.price}
                available={chain.stocks_available}
                safe={chain.size >= safeSize}
                variant="full"
              />
            </div>
            <div className={styles.roles}>
              {info &&
                (info.holders.length === 0 ? (
                  <span className={styles.chip} data-testid={`chain-majority-${id}`}>
                    <span className={styles.roleLabel}>1st</span>
                    <span className={styles.figures}>
                      no {rules.theme.share_noun_plural} held yet ·{' '}
                      {rules.money(info.majority_bonus)} / {rules.money(info.minority_bonus)}
                    </span>
                  </span>
                ) : (
                  <>
                    <RoleChip
                      gameState={gameState}
                      rules={rules}
                      info={info}
                      role="majority"
                      chain={chain.name}
                      me={myPlayerId}
                    />
                    <RoleChip
                      gameState={gameState}
                      rules={rules}
                      info={info}
                      role="minority"
                      chain={chain.name}
                      me={myPlayerId}
                    />
                  </>
                ))}
              {me && mine > 0 && (
                <span
                  className={`${styles.chip} ${styles.mine}`}
                  data-testid={`portfolio-row-${id}`}
                >
                  <span className={styles.roleLabel}>you</span>
                  <span className={styles.figures}>
                    {mine}
                    <span className={styles.srOnly}> {rules.name(chain.name)}</span> ={' '}
                    {rules.money(mine * chain.price)}
                  </span>
                  {info && (
                    <span className={styles.position} data-testid={`chain-you-${id}`}>
                      {myPosition(info, myPlayerId!)}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        )
      })}
      {heldOff.length > 0 && (
        <div className={styles.offBoard}>
          <span className={styles.offTitle}>
            Held, not on the board (worth {rules.money(0)} until founded again)
          </span>
          {heldOff.map(([chain, n]) => (
            <div
              key={chain}
              className={styles.mine}
              data-testid={`portfolio-row-${chainTestId(chain)}`}
            >
              <ChainMarker chain={chain} variant="compact" />
              <span>{n}</span>
            </div>
          ))}
        </div>
      )}
      {noneHeld}
    </div>
  )
}
