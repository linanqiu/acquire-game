import { describe, expect, it } from 'vitest'
import { shortNames } from './shortNames'
import type { GameStateMessage } from '../types/api'

type Players = GameStateMessage['players']

const seat = (name: string, kind: 'human' | 'bot' | 'llm') =>
  ({ name, kind, is_bot: kind !== 'human', money: 6000, stocks: {} }) as unknown as Players[string]

describe('shortNames: what a narrow players row prints', () => {
  it('prints the first word of an AI seat and keeps the rest of the name', () => {
    const names = shortNames({
      a: seat('Linan', 'human'),
      b: seat('Dolly Dollars', 'bot'),
      c: seat('Ivy Interest', 'llm'),
    })
    expect(names.a).toEqual({ head: 'Linan', rest: '' })
    expect(names.b).toEqual({ head: 'Dolly', rest: ' Dollars' })
    expect(names.c).toEqual({ head: 'Ivy', rest: ' Interest' })
    // Nothing is lost: head + rest is the whole name.
    expect(names.b.head + names.b.rest).toBe('Dolly Dollars')
  })

  it("never cuts a person's name", () => {
    const names = shortNames({ a: seat('Anna Maria', 'human'), b: seat('Max Margin', 'bot') })
    expect(names.a).toEqual({ head: 'Anna Maria', rest: '' })
    expect(names.b.head).toBe('Max')
  })

  it('keeps the full name when the short one would not be unique at the table', () => {
    const names = shortNames({
      a: seat('Max', 'human'),
      b: seat('Max Margin', 'bot'),
      c: seat('Rex Revenue', 'bot'),
      d: seat('Rex Rent', 'bot'),
    })
    expect(names.b).toEqual({ head: 'Max Margin', rest: '' })
    expect(names.c).toEqual({ head: 'Rex Revenue', rest: '' })
    expect(names.d).toEqual({ head: 'Rex Rent', rest: '' })
  })
})
