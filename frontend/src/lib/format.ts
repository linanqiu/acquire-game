/** Small display formatters shared by the transcript and benchmark pages. */

import type { SummarySeat } from '../types/transcripts'

export function formatPercent(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

export function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return Math.round(v).toLocaleString('en-US')
}

/** `null` cost is shown as "unknown" (the price table has no entry for the model). */
export function formatCost(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return 'unknown'
  return `$${v.toFixed(digits)}`
}

export function formatSeconds(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  if (v < 1) return `${Math.round(v * 1000)} ms`
  if (v < 120) return `${v.toFixed(1)} s`
  return `${Math.floor(v / 60)} m ${Math.round(v % 60)} s`
}

export function formatTokens(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`
  return v.toLocaleString('en-US')
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `$${n.toLocaleString('en-US')}`
}

/** "3 min ago" style label; falls back to the date for anything older than a week. */
export function formatWhen(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const diff = Math.max(0, now - t) / 1000
  if (diff < 45) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`
  if (diff < 7 * 86400) return `${Math.round(diff / 86400)} d ago`
  return new Date(t).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}

/** Model (or agent label) of an AI seat, e.g. `claude-sonnet-4-5`; empty for humans. */
export function seatModelLabel(seat: Pick<SummarySeat, 'agent_label' | 'model'>): string {
  return seat.model || seat.agent_label || ''
}
