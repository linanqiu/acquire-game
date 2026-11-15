import { Badge } from '../ui/Badge'
import { TextBlock } from './TextBlock'
import { formatSeconds, formatTokens } from '../../lib/format'
import type { DecisionEntry, LlmAttempt } from '../../types/transcripts'
import styles from './LlmPanel.module.css'

interface LlmPanelProps {
  decision: DecisionEntry
  systemPrompts: Record<string, string>
  /** True while the game is unfinished: prompts, raw output and private notes are withheld. */
  redacted: boolean
}

function LockedNote() {
  return (
    <p className={styles.locked} data-testid="llm-locked">
      Prompts, raw model output, private notes and hands unlock when the game ends.
    </p>
  )
}

function AttemptView({
  attempt,
  index,
  total,
  decisionIndex,
  redacted,
}: {
  attempt: LlmAttempt
  index: number
  total: number
  decisionIndex: number
  redacted: boolean
}) {
  const rejected = attempt.rejected ?? !!attempt.error
  const idBase = `attempt-${decisionIndex}-${index}`
  return (
    <li
      className={`${styles.attempt} ${rejected ? styles.rejected : styles.accepted}`}
      data-testid={`attempt-${index}`}
      data-outcome={rejected ? 'rejected' : 'accepted'}
    >
      <div className={styles.attemptHead}>
        <span className={styles.attemptTitle}>
          Attempt {index + 1} of {total}
        </span>
        <Badge label={rejected ? 'REJECTED' : 'ACCEPTED'} variant={rejected ? 'danger' : 'safe'} />
        <span className={styles.stats}>
          {formatSeconds(attempt.latency_s)} · {formatTokens(attempt.input_tokens)} in /{' '}
          {formatTokens(attempt.output_tokens)} out
          {attempt.cache_read_tokens > 0 && ` · ${formatTokens(attempt.cache_read_tokens)} cached`}
          {(attempt.cache_write_tokens ?? 0) > 0 &&
            ` · ${formatTokens(attempt.cache_write_tokens)} cache-written`}
        </span>
      </div>
      {rejected && attempt.error && (
        <p className={styles.reason} data-testid={`attempt-${index}-error`}>
          Rejected: {attempt.error}
        </p>
      )}
      {!redacted && attempt.raw === null && (
        <p className={styles.muted}>
          No output: the attempt was cut off before the model answered.
        </p>
      )}
      {!redacted && typeof attempt.raw === 'string' && (
        <TextBlock
          id={`${idBase}-raw`}
          label="Raw model output"
          text={attempt.raw}
          tone={rejected ? 'error' : 'default'}
        />
      )}
      {!redacted && attempt.retry_prompt && (
        <TextBlock
          id={`${idBase}-retry`}
          label="Retry prompt sent back to the model"
          text={attempt.retry_prompt}
        />
      )}
    </li>
  )
}

/** "Inside the model's head": the model's reasoning, every attempt, and the exact prompts. */
export function LlmPanel({ decision, systemPrompts, redacted }: LlmPanelProps) {
  const llm = decision.llm
  if (!llm) return null
  const idx = decision.index
  const systemPrompt = systemPrompts[llm.system_prompt_id] ?? llm.system_prompt
  const attempts = llm.attempts ?? []
  const tokensIn = attempts.reduce((n, a) => n + (a.input_tokens ?? 0), 0)
  const tokensOut = attempts.reduce((n, a) => n + (a.output_tokens ?? 0), 0)
  const hasPrivate = llm.why !== undefined || llm.note !== undefined
  const locked = redacted || (!hasPrivate && llm.user_prompt === undefined)

  return (
    <section className={styles.panel} aria-label="Inside the model's head" data-testid="llm-panel">
      <header className={styles.head}>
        <h3 className={styles.title}>INSIDE THE MODEL&apos;S HEAD</h3>
        <span className={styles.meta}>
          {llm.model} · {attempts.length} {attempts.length === 1 ? 'call' : 'calls'} ·{' '}
          {formatTokens(tokensIn)} in / {formatTokens(tokensOut)} out ·{' '}
          {formatSeconds(decision.latency_s)}
        </span>
      </header>

      {locked && <LockedNote />}

      {!locked && (llm.why || llm.note) && (
        <dl className={styles.thoughts}>
          {llm.why && (
            <div>
              <dt>Why (stated)</dt>
              <dd data-testid="llm-why">{llm.why}</dd>
            </div>
          )}
          {llm.note && (
            <div>
              <dt>Private note (kept for later turns)</dt>
              <dd data-testid="llm-note">{llm.note}</dd>
            </div>
          )}
        </dl>
      )}
      {!locked && !llm.why && !llm.note && decision.source === 'fallback' && (
        <p className={styles.muted}>
          The model never gave a usable answer, so there is no stated reason.
        </p>
      )}
      {!locked && llm.outcome === 'failed' && llm.error && (
        <p className={styles.reason} data-testid="llm-gave-up">
          The model was given up on: {llm.error}
        </p>
      )}

      {attempts.length === 0 ? (
        <p className={styles.muted} data-testid="llm-no-attempts">
          No answer came back from the model.
        </p>
      ) : (
        <ol className={styles.attempts} aria-label="Attempts">
          {attempts.map((a, i) => (
            <AttemptView
              key={i}
              attempt={a}
              index={i}
              total={attempts.length}
              decisionIndex={idx}
              redacted={redacted}
            />
          ))}
        </ol>
      )}

      {!locked && (
        <div className={styles.prompts}>
          {llm.user_prompt !== undefined && (
            <TextBlock
              id={`user-prompt-${idx}`}
              label="User prompt (exact text sent)"
              text={llm.user_prompt}
            />
          )}
          {systemPrompt !== undefined ? (
            <TextBlock
              id={`system-prompt-${idx}`}
              label={`System prompt (${llm.system_prompt_id})`}
              text={systemPrompt}
            />
          ) : (
            <p className={styles.muted}>
              System prompt <code>{llm.system_prompt_id}</code> is not in this transcript&apos;s
              header.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
