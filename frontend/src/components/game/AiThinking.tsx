import styles from './AiThinking.module.css'

/**
 * Unobtrusive "thinking…" marker shown next to the AI seat the engine is waiting on. `compact`
 * (a one-line table row): only the moving dots are drawn; the word is still read out.
 */
export function AiThinking({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`${styles.thinking} ${compact ? styles.compact : ''}`}
      data-testid="ai-thinking"
      role="status"
      aria-live="polite"
      title="thinking"
    >
      <span className={styles.word}>thinking</span>
      <span className={styles.dots} aria-hidden="true" />
    </span>
  )
}
