import { useMemo } from 'react'
import { VirtualList } from './VirtualList'
import { describeAction } from '../../lib/eventText'
import { useRules } from '../../ruleset/useRules'
import type { Replay, ReplayStep } from '../../lib/replay'
import type { ChatEntry } from '../../types/transcripts'
import styles from './Timeline.module.css'

type Row =
  | { kind: 'start' }
  | { kind: 'turn'; turn: number; playerId: string | null }
  | { kind: 'step'; step: ReplayStep }
  | { kind: 'chat'; step: number; entry: ChatEntry }

const SOURCE_MARK: Record<string, string> = {
  human: 'H',
  bot: 'B',
  scripted: 'S',
  llm: 'AI',
  fallback: 'FB',
}

interface TimelineProps {
  replay: Replay
  names: Record<string, string>
  current: number
  onSelect: (step: number) => void
}

const TIMELINE_ROW_HEIGHT = 32

/** Decisions grouped by turn, windowed so thousands of rows stay cheap. */
export function Timeline({ replay, names, current, onSelect }: TimelineProps) {
  const rules = useRules()
  const { rows, activeIndex } = useMemo(() => {
    const rows: Row[] = [{ kind: 'start' }]
    let activeIndex = 0
    const chatRows = (s: ReplayStep) => {
      for (const entry of s.chat ?? []) rows.push({ kind: 'chat', step: s.step, entry })
    }
    if (replay.steps[0]) chatRows(replay.steps[0])
    for (const g of replay.groups) {
      rows.push({ kind: 'turn', turn: g.turn, playerId: g.playerId })
      for (const s of g.steps) {
        if (s.step === current) activeIndex = rows.length
        rows.push({ kind: 'step', step: s })
        chatRows(s)
      }
    }
    return { rows, activeIndex }
  }, [replay, current])

  return (
    <VirtualList
      items={rows}
      rowHeight={TIMELINE_ROW_HEIGHT}
      className={styles.list}
      activeIndex={activeIndex}
      ariaLabel="Decision timeline"
      testId="timeline"
      renderRow={(row) => {
        if (row.kind === 'start') {
          return (
            <button
              className={`${styles.row} ${styles.start} ${current === 0 ? styles.current : ''}`}
              onClick={() => onSelect(0)}
              aria-current={current === 0 ? 'step' : undefined}
              data-testid="timeline-step-0"
            >
              <span className={styles.num}>0</span>
              <span className={styles.text}>Start of game</span>
            </button>
          )
        }
        if (row.kind === 'turn') {
          return (
            <div className={styles.turn} data-testid={`timeline-turn-${row.turn}`}>
              TURN {row.turn}
              {row.playerId ? ` · ${names[row.playerId] ?? row.playerId}` : ''}
            </div>
          )
        }
        if (row.kind === 'chat') {
          const c = row.entry
          // Table talk: plain text (never HTML); selecting it shows the step it followed.
          return (
            <button
              className={`${styles.row} ${styles.chat}`}
              onClick={() => onSelect(row.step)}
              title={`${c.name}: ${c.text}`}
              data-testid="timeline-chat"
              data-source={c.source}
            >
              <span className={styles.num} aria-hidden="true">
                “
              </span>
              <span className={styles.who}>{c.name}</span>
              <span className={styles.text}>{c.text}</span>
              <span className={styles.mark}>CHAT</span>
            </button>
          )
        }
        const s = row.step
        const d = s.decision!
        const rejected = d.llm ? d.llm.attempts.filter((a) => a.error).length : 0
        const isCurrent = s.step === current
        return (
          <button
            className={`${styles.row} ${isCurrent ? styles.current : ''} ${d.source === 'fallback' ? styles.fallback : ''}`}
            onClick={() => onSelect(s.step)}
            aria-current={isCurrent ? 'step' : undefined}
            data-testid={`timeline-step-${s.step}`}
            data-source={d.source}
          >
            <span className={styles.num}>{s.step}</span>
            <span className={styles.who}>{names[d.player_id] ?? d.player_id}</span>
            <span className={styles.text}>{describeAction(d.action, rules.rs)}</span>
            {rejected > 0 && (
              <span className={styles.retry} title={`${rejected} rejected answer(s)`}>
                ↻{rejected}
              </span>
            )}
            <span className={`${styles.mark} ${styles[d.source] ?? ''}`}>
              {SOURCE_MARK[d.source] ?? d.source}
            </span>
          </button>
        )
      }}
    />
  )
}
