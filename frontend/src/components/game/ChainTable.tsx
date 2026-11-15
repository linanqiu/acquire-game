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

/** One bonus line: who is 1st / 2nd, with how many shares and what they would be paid now. */
function RoleLine({
  gameState,
  rules,
  info,
  role,
  chain,
}: {
  gameState: GameStateMessage
  rules: Rules
  info: ChainHolders
  role: 'majority' | 'minority'
  chain: ChainId
}) {
  const group = info.holders.filter((h) => h.role === role)
  const majorityTie = info.holders.filter((h) => h.role === 'majority').length > 1
  const sole = info.holders.length === 1
  let body: string
  if (group.length > 0) {
    const tie = group.length > 1
    const shares = group[0].shares
    const pay = rules.money(group[0].bonus)
    body = `${names(gameState, group)}: ${rules.shares(shares)} → ${pay}${tie ? ' each (tie)' : ''}${
      sole ? ' (sole holder: both bonuses)' : ''
    }`
  } else if (role === 'minority' && majorityTie) {
    body = 'none: the tie for 1st shares both bonuses'
  } else if (role === 'minority' && sole) {
    return null
  } else {
    body = `nobody · ${rules.money(role === 'majority' ? info.majority_bonus : info.minority_bonus)}`
  }
  return (
    <div className={styles.role} data-testid={`chain-${role}-${chainTestId(chain)}`}>
      <span className={styles.roleLabel}>{ORDINAL[role]}</span>
      <span className={styles.roleBody}>{body}</span>
    </div>
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
          <div key={chain.name} className={styles.chain} data-testid={`chain-row-${id}`}>
            <ChainMarker
              chain={chain.name}
              size={chain.size}
              price={chain.price}
              available={chain.stocks_available}
              safe={chain.size >= safeSize}
              variant="full"
            />
            {info && (
              <div className={styles.roles}>
                {info.holders.length === 0 ? (
                  <div className={styles.role} data-testid={`chain-majority-${id}`}>
                    <span className={styles.roleLabel}>1st</span>
                    <span className={styles.roleBody}>
                      no {rules.theme.share_noun_plural} held yet ·{' '}
                      {rules.money(info.majority_bonus)} / {rules.money(info.minority_bonus)}
                    </span>
                  </div>
                ) : (
                  <>
                    <RoleLine
                      gameState={gameState}
                      rules={rules}
                      info={info}
                      role="majority"
                      chain={chain.name}
                    />
                    <RoleLine
                      gameState={gameState}
                      rules={rules}
                      info={info}
                      role="minority"
                      chain={chain.name}
                    />
                  </>
                )}
              </div>
            )}
            {me && mine > 0 && (
              <div className={styles.mine} data-testid={`portfolio-row-${id}`}>
                <span className={styles.roleLabel}>you</span>
                <span>
                  {mine} {rules.name(chain.name)} = {rules.money(mine * chain.price)}
                </span>
                {info && (
                  <span className={styles.position} data-testid={`chain-you-${id}`}>
                    {myPosition(info, myPlayerId!)}
                  </span>
                )}
              </div>
            )}
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
