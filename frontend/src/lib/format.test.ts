import { describe, it, expect } from 'vitest'
import {
  formatBytes,
  formatCost,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatSeconds,
  formatTokens,
  formatWhen,
  seatModelLabel,
} from './format'

describe('what the transcript and benchmark pages print', () => {
  it('missing numbers are a dash, never "NaN" or "null"', () => {
    for (const bad of [null, undefined, Number.NaN]) {
      expect(formatPercent(bad)).toBe('—')
      expect(formatNumber(bad)).toBe('—')
      expect(formatSeconds(bad)).toBe('—')
    }
    expect(formatTokens(null)).toBe('—')
    expect(formatTokens(undefined)).toBe('—')
  })

  it('percentages and counts', () => {
    expect(formatPercent(0.5)).toBe('50%')
    expect(formatPercent(0.1234, 1)).toBe('12.3%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatNumber(1234567.6)).toBe('1,234,568')
    expect(formatNumber(0)).toBe('0')
  })

  it('cost: two decimals, and "unknown" when the model has no price (a zero cost is $0.00, not unknown)', () => {
    expect(formatCost(1.5)).toBe('$1.50')
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(0.123456, 4)).toBe('$0.1235')
    expect(formatCost(null)).toBe('unknown')
    expect(formatCost(undefined)).toBe('unknown')
  })

  it('durations: milliseconds under a second, seconds under two minutes, then minutes', () => {
    expect(formatSeconds(0.25)).toBe('250 ms')
    expect(formatSeconds(0)).toBe('0 ms')
    expect(formatSeconds(1)).toBe('1.0 s')
    expect(formatSeconds(119.94)).toBe('119.9 s')
    expect(formatSeconds(120)).toBe('2 m 0 s')
    expect(formatSeconds(185)).toBe('3 m 5 s')
  })

  it('token counts: exact below 10,000, in thousands from there', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(9999)).toBe('9,999')
    expect(formatTokens(10_000)).toBe('10.0k')
    expect(formatTokens(367_538)).toBe('367.5k')
  })

  it('sizes in B, KB and MB', () => {
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024 - 1)).toMatch(/KB$/)
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('"when": just now, minutes, hours and days ago, then the date', () => {
    const now = Date.parse('2026-11-14T12:00:00Z')
    const ago = (s: number) => new Date(now - s * 1000).toISOString()
    expect(formatWhen(ago(10), now)).toBe('just now')
    expect(formatWhen(ago(44), now)).toBe('just now')
    expect(formatWhen(ago(45), now)).toBe('1 min ago')
    expect(formatWhen(ago(600), now)).toBe('10 min ago')
    expect(formatWhen(ago(3600), now)).toBe('1 h ago')
    expect(formatWhen(ago(5 * 3600), now)).toBe('5 h ago')
    expect(formatWhen(ago(86400), now)).toBe('1 d ago')
    expect(formatWhen(ago(6 * 86400), now)).toBe('6 d ago')
    expect(formatWhen(ago(7 * 86400), now)).toBe('Nov 7, 2026')
    // A clock slightly ahead of the server never prints a negative age.
    expect(formatWhen(new Date(now + 5000).toISOString(), now)).toBe('just now')
  })

  it('"when" with nothing or nonsense: a dash, or the text as it came', () => {
    expect(formatWhen(null)).toBe('—')
    expect(formatWhen('')).toBe('—')
    expect(formatWhen('yesterday-ish')).toBe('yesterday-ish')
  })

  it('date and time in UTC, so it reads the same everywhere', () => {
    expect(formatDateTime('2026-11-14T18:59:00+00:00')).toBe('Nov 14, 2026, 06:59 PM UTC')
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDateTime('whenever')).toBe('whenever')
  })

  it('an AI seat is named by its model, else its label, else nothing (humans)', () => {
    expect(seatModelLabel({ model: 'claude-sonnet-5-5', agent_label: 'Claude' })).toBe(
      'claude-sonnet-5-5'
    )
    expect(seatModelLabel({ model: null, agent_label: 'Bot' })).toBe('Bot')
    expect(seatModelLabel({ model: null, agent_label: null })).toBe('')
  })
})
