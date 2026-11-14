import { LlmPanel } from './LlmPanel'
import { SeatChip, SourceBadge } from './SeatChip'
import { TextBlock } from './TextBlock'
import { decisionKindLabel, describeAction, tradeText } from '../../lib/eventText'
import { formatMoney, formatSeconds } from '../../lib/format'
import type { ReplayStep } from '../../lib/replay'
import type { DecisionEntry, TranscriptSeat } from '../../types/transcripts'
import styles from './DecisionPanel.module.css'

const FALLBACK_REASON: Record<string, string> = {
  timeout: 'the model did not answer in time',
  error: 'the model call failed',
  illegal: "the model's answers were rejected as illegal",
  cap: 'the model used up its allowed calls for this decision',
}

interface DecisionPanelProps {
  step: ReplayStep
  totalSteps: number
  seats: TranscriptSeat[]
  names: Record<string, string>
  systemPrompts: Record<string, string>
  redacted: boolean
}

function Chip({ text, active, title }: { text: string; active?: boolean; title?: string }) {
  return (
    <span className={`${styles.option} ${active ? styles.chosen : ''}`} title={title}>
      {text}
    </span>
  )
}

function LegalOptions({
  d,
  names,
  redacted,
}: {
  d: DecisionEntry
  names: Record<string, string>
  redacted: boolean
}) {
  const legal = d.legal as Record<string, unknown>
  const action = d.action as Record<string, unknown>
  const types = (legal.action_types as string[]) ?? []
  const extras = types.filter(
    (t) => !['place_tile', 'found_chain', 'merger_choice', 'merger_disposition'].includes(t)
  )

  let body: React.ReactNode = null
  switch (d.kind) {
    case 'place_tile': {
      const tiles = legal.tiles as
        | { tile: string; outcome: string; chains?: string[] }[]
        | undefined
      body = tiles ? (
        <div className={styles.options}>
          {tiles.map((t) => (
            <Chip
              key={t.tile}
              text={`${t.tile}${t.outcome !== 'nothing' ? ` · ${t.outcome}` : ''}`}
              active={action.tile === t.tile}
              title={t.chains?.length ? t.chains.join(', ') : undefined}
            />
          ))}
        </div>
      ) : (
        <p className={styles.muted}>
          {redacted ? 'The hand is hidden until the game ends.' : 'No tile list recorded.'}
        </p>
      )
      break
    }
    case 'found_chain':
    case 'choose_survivor': {
      const chains = (legal.chains as string[]) ?? []
      const chosen = (action.chain ?? action.surviving_chain) as string | undefined
      body = (
        <div className={styles.options}>
          {chains.map((c) => (
            <Chip key={c} text={c} active={c === chosen} />
          ))}
        </div>
      )
      break
    }
    case 'buy_stocks': {
      const options =
        (legal.options as {
          chain: string
          price: number
          available: number
          max_affordable: number
        }[]) ?? []
      body = (
        <>
          <p className={styles.muted}>
            Cash {formatMoney(legal.money as number)} · up to {String(legal.max_total ?? 0)} shares
          </p>
          {options.length > 0 && (
            <div className={styles.options}>
              {options.map((o) => {
                const bought = (action.purchases as Record<string, number> | undefined)?.[o.chain]
                return (
                  <Chip
                    key={o.chain}
                    text={`${o.chain} ${formatMoney(o.price)}${bought ? ` · bought ${bought}` : ''}`}
                    active={!!bought}
                    title={`${o.available} available, up to ${o.max_affordable} affordable`}
                  />
                )
              })}
            </div>
          )}
        </>
      )
      break
    }
    case 'stock_disposition': {
      body = (
        <p className={styles.muted}>
          {String(legal.stock_count)} {String(legal.defunct_chain)} shares; survivor{' '}
          {String(legal.surviving_chain)}; at most {String(legal.max_trade ?? 0)} can be traded.
        </p>
      )
      break
    }
    case 'trade_response': {
      body = (
        <p className={styles.muted}>
          {tradeText(legal.trade as Record<string, unknown>, names)}
          {legal.can_accept === false && ' (cannot be accepted)'}
        </p>
      )
      break
    }
    default:
      body = null
  }

  return (
    <div data-testid="legal-options">
      <h4 className={styles.h4}>LEGAL OPTIONS</h4>
      {body}
      {extras.length > 0 && (
        <div className={styles.options}>
          {extras.map((t) => (
            <Chip key={t} text={t.replace(/_/g, ' ')} active={action.action === t} />
          ))}
        </div>
      )}
      <TextBlock
        id={`legal-${d.index}`}
        label="Raw legal options (JSON)"
        text={JSON.stringify(legal, null, 2)}
      />
    </div>
  )
}

export function DecisionPanel({
  step,
  totalSteps,
  seats,
  names,
  systemPrompts,
  redacted,
}: DecisionPanelProps) {
  const d = step.decision
  if (!d) {
    return (
      <section className={styles.panel} data-testid="decision-panel">
        <h3 className={styles.title}>START OF GAME</h3>
        <p className={styles.muted}>
          Nothing has been decided yet. Press play or the right arrow to step through the game.
        </p>
      </section>
    )
  }
  const seat = seats.find((s) => s.player_id === d.player_id)
  const aiName = seat?.agent_label || seat?.model || names[d.player_id] || d.player_id
  const fb = d.fallback
  return (
    <section className={styles.panel} aria-label="Decision" data-testid="decision-panel">
      <header className={styles.head}>
        <h3 className={styles.title}>
          STEP {step.step} <span className={styles.of}>of {totalSteps}</span>
          <span className={styles.turn}> · Turn {step.turn}</span>
        </h3>
        <SourceBadge source={d.source} />
      </header>

      <div className={styles.who}>
        {seat ? <SeatChip seat={seat} /> : <span>{names[d.player_id] ?? d.player_id}</span>}
        <span className={styles.kind}>{decisionKindLabel(d.kind)}</span>
        <span className={styles.latency}>{formatSeconds(d.latency_s)}</span>
      </div>

      {(d.source === 'fallback' || fb) && (
        <div className={styles.fallback} role="alert" data-testid="fallback-banner">
          <strong>Fallback.</strong> The rules-based player stepped in for {aiName}
          {fb && (
            <>
              {' '}
              — reason: <span className={styles.reason}>{fb.reason}</span>
              {FALLBACK_REASON[fb.reason] ? ` (${FALLBACK_REASON[fb.reason]})` : ''}
            </>
          )}
          .{fb?.message && <span className={styles.fbMessage}> {fb.message}</span>}
        </div>
      )}

      <div>
        <h4 className={styles.h4}>CHOSEN</h4>
        <p className={styles.chosenLine} data-testid="chosen-action">
          {describeAction(d.action)}
        </p>
      </div>

      <LegalOptions d={d} names={names} redacted={redacted} />

      {d.llm && <LlmPanel decision={d} systemPrompts={systemPrompts} redacted={redacted} />}
    </section>
  )
}
