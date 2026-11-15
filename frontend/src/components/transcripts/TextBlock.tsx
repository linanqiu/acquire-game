import { useState } from 'react'
import { formatBytes } from '../../lib/format'
import styles from './TextBlock.module.css'

/** Above this many characters the block shows a prefix until the reader asks for everything. */
const TEXT_PREVIEW_LIMIT = 60_000

interface TextBlockProps {
  label: string
  text: string
  /** Stable id used for data-testid hooks. */
  id: string
  tone?: 'default' | 'error'
}

/**
 * A collapsible monospace block for prompts and raw model output. The text is not put in
 * the DOM until the block is opened, so a decision with several large prompts is cheap.
 */
export function TextBlock({ label, text, id, tone = 'default' }: TextBlockProps) {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const truncated = !full && text.length > TEXT_PREVIEW_LIMIT
  const shown = truncated ? text.slice(0, TEXT_PREVIEW_LIMIT) : text

  return (
    <div
      className={`${styles.block} ${tone === 'error' ? styles.error : ''}`}
      data-testid={`text-${id}`}
    >
      <div className={styles.bar}>
        <button
          className={styles.toggle}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          data-testid={`toggle-${id}`}
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> {label}
          <span className={styles.size}>{formatBytes(text.length)}</span>
        </button>
        {open && (
          <button className={styles.copy} onClick={copy} data-testid={`copy-${id}`}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      {open && (
        <>
          <pre className={styles.pre} data-testid={`body-${id}`} tabIndex={0}>
            {shown}
          </pre>
          {truncated && (
            <button
              className={styles.more}
              onClick={() => setFull(true)}
              data-testid={`full-${id}`}
            >
              Showing the first {TEXT_PREVIEW_LIMIT.toLocaleString('en-US')} characters. Show all{' '}
              {formatBytes(text.length)}
            </button>
          )}
        </>
      )}
    </div>
  )
}
