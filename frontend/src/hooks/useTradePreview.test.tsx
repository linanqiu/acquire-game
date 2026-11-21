import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PREVIEW_DELAY_MS, useTradePreview } from './useTradePreview'
import type { TradeDraft, TradePreview } from '../lib/trades'

const draft = (cash: number): TradeDraft => ({
  to_player_id: 'p2',
  offering_stocks: {},
  offering_money: cash,
  requesting_stocks: { sandpiper: 1 },
  requesting_money: 0,
})
const answer = (n: number): TradePreview => ({
  valid: true,
  error: '',
  list: { offering: n, requesting: 200 },
  positions: [],
  bot: null,
})

type Props = { body: TradeDraft | null; version?: unknown }

describe('useTradePreview', () => {
  let asked: number[]

  beforeEach(() => {
    vi.useFakeTimers()
    asked = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const cash = (JSON.parse(init.body) as TradeDraft).offering_money
        asked.push(cash)
        return { ok: true, json: async () => answer(cash) }
      })
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const mount = (props: Props) =>
    renderHook((p: Props) => useTradePreview('ABCD', 'me', p.body, p.version), {
      initialProps: props,
    })
  const settle = () => act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS + 5))

  it('asks nothing with nothing to ask', async () => {
    const { result } = mount({ body: null })
    await settle()
    expect(asked).toEqual([])
    expect(result.current).toEqual({ preview: null, current: false })
  })

  it('a burst of taps is one question, about the last draft', async () => {
    const { result, rerender } = mount({ body: draft(100) })
    rerender({ body: draft(200) })
    rerender({ body: draft(300) })
    expect(asked).toEqual([])
    await settle()
    expect(asked).toEqual([300])
    expect(result.current.preview?.list?.offering).toBe(300)
    expect(result.current.current).toBe(true)
  })

  it('keeps the last answer on screen, marked as not current, until the next one is in', async () => {
    const { result, rerender } = mount({ body: draft(100) })
    await settle()
    rerender({ body: draft(200) })
    expect(result.current.preview?.list?.offering).toBe(100)
    expect(result.current.current).toBe(false)
    await settle()
    expect(result.current.preview?.list?.offering).toBe(200)
    expect(result.current.current).toBe(true)
  })

  it('a move at the table asks again without marking the answer old', async () => {
    const { result, rerender } = mount({ body: draft(100), version: 1 })
    await settle()
    rerender({ body: draft(100), version: 2 })
    expect(result.current.current).toBe(true) // same draft: no blink
    await settle()
    expect(asked).toEqual([100, 100])
    expect(result.current.current).toBe(true)
  })

  it('an answer that arrives for a draft already put away is dropped', async () => {
    const { result, rerender } = mount({ body: draft(100) })
    await settle()
    rerender({ body: null })
    expect(result.current).toEqual({ preview: null, current: false })
    await settle()
    expect(asked).toEqual([100])
  })

  it('with no answer from the server there is simply no preview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    const { result } = mount({ body: draft(100) })
    await settle()
    expect(result.current).toEqual({ preview: null, current: false })
  })
})
