import styles from './AiThinking.module.css'

/** Unobtrusive "thinking…" marker shown next to the AI seat the engine is waiting on. */
export function AiThinking() {
  return (
    <span className={styles.thinking} data-testid="ai-thinking" role="status" aria-live="polite">
      thinking
      <span className={styles.dots} aria-hidden="true" />
    </span>
  )
}
