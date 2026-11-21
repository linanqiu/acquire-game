import { useMemo, useState, type ReactNode } from 'react'
import { describeAction } from '../../lib/eventText'
import { useRules } from '../../ruleset/useRules'
import type { Replay, ReplayStep } from '../../lib/replay'
import type { ChatEntry, CommentaryEntry } from '../../types/transcripts'
import styles from './Timeline.module.css'

type Row =
  | { kind: 'start' }
  | { kind: 'turn'; turn: number; playerId: string | null }
  | { kind: 'step'; step: ReplayStep }
  | { kind: 'chat'; step: number; entry: ChatEntry }
  | { kind: 'commentary'; step: number; entry: CommentaryEntry }

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

/** Rows shown before and after the current one. */
const BEFORE = 3
const AFTER = 8

/**
 * Decisions grouped by turn, around the current step (BL-019): a short window of the timeline
 * (the turn heading above it, a few decisions before and after), part of the page rather than
 * a box that scrolls inside it. The scrubber and the step buttons move through the whole game;
 * a tap on a row goes to that step. "All decisions" opens the whole list in the page.
 */
export function Timeline({ replay, names, current, onSelect }: TimelineProps) {
  const rules = useRules()
  // Built once per transcript (not once per step: a long game has hundreds of rows).
  const { rows, rowOfStep } = useMemo(() => {
    const rows: Row[] = [{ kind: 'start' }]
    const rowOfStep = new Map<number, number>([[0, 0]])
    const chatRows = (s: ReplayStep) => {
      for (const entry of s.chat ?? []) rows.push({ kind: 'chat', step: s.step, entry })
      // What the commentator said after this step, when the game was watched live.
      for (const entry of s.commentary ?? []) rows.push({ kind: 'commentary', step: s.step, entry })
    }
    if (replay.steps[0]) chatRows(replay.steps[0])
    for (const g of replay.groups) {
      rows.push({ kind: 'turn', turn: g.turn, playerId: g.playerId })
      for (const s of g.steps) {
        rowOfStep.set(s.step, rows.length)
        rows.push({ kind: 'step', step: s })
        chatRows(s)
      }
    }
    return { rows, rowOfStep }
  }, [replay])
  const activeIndex = rowOfStep.get(current) ?? 0

  const [all, setAll] = useState(false)
  let start = all ? 0 : Math.max(0, activeIndex - BEFORE)
  // Start at the turn heading when it is just above the window.
  for (let i = activeIndex; i >= start; i--) {
    if (rows[i].kind === 'turn') {
      start = i
      break
    }
  }
  const end = all ? rows.length : Math.min(rows.length, activeIndex + AFTER + 1)
  const decisions = replay.steps.length - 1

  return (
    <>
      <WindowList
        items={rows}
        start={start}
        end={end}
        ariaLabel="Decision timeline"
        testId="timeline"
        className={styles.list}
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
          if (row.kind === 'commentary') {
            const c = row.entry
            return (
              <button
                className={`${styles.row} ${styles.chat} ${styles.commentary}`}
                onClick={() => onSelect(row.step)}
                title={c.text ?? ''}
                data-testid="timeline-commentary"
                data-source={c.source ?? undefined}
              >
                <span className={styles.num} aria-hidden="true">
                  ›
                </span>
                <span className={styles.text}>{c.text}</span>
                <span className={styles.mark}>
                  {c.source === 'model' ? 'COMMENTARY' : 'COMMENTARY · RULES'}
                </span>
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
      {decisions > AFTER && (
        <button
          type="button"
          className={styles.more}
          onClick={() => setAll((a) => !a)}
          aria-expanded={all}
          data-testid="timeline-all"
        >
          {all ? 'Only the decisions around this step' : `All ${decisions} decisions`}
        </button>
      )}
    </>
  )
}

/** A slice of a list, in the page (no scroller of its own). */
function WindowList<T>({
  items,
  start,
  end,
  renderRow,
  className,
  ariaLabel,
  testId,
}: {
  items: T[]
  start: number
  end: number
  renderRow: (item: T, index: number) => ReactNode
  className?: string
  ariaLabel: string
  testId: string
}) {
  const rows: ReactNode[] = []
  for (let i = start; i < end; i++) {
    rows.push(
      <li key={i} className={styles.item}>
        {renderRow(items[i], i)}
      </li>
    )
  }
  return (
    <ul className={className} aria-label={ariaLabel} data-testid={testId}>
      {rows}
    </ul>
  )
}
