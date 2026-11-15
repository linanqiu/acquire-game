import { describe, it, expect } from 'vitest'
import {
  article,
  chainName,
  chainSpec,
  chainsByTier,
  columnLabels,
  contrastRatio,
  DARK_TEXT,
  formatAmount,
  LIGHT_TEXT,
  luminance,
  orderChainIds,
  playerRange,
  readableText,
  rowLabels,
  rulesetForTranscript,
  tileCount,
  unplayableReasonText,
} from './ruleset'
import { describeAction, describeEvents, decisionKindLabel } from './eventText'
import { DEFAULT_RS, MINI, VALLEY } from '../../tests/unit/fixtures/rulesets'

describe('ruleset helpers', () => {
  it('board labels follow the ruleset size', () => {
    expect(rowLabels(DEFAULT_RS)).toEqual('ABCDEFGHI'.split(''))
    expect(columnLabels(DEFAULT_RS)).toHaveLength(12)
    expect(rowLabels(MINI)).toEqual('ABCDEFG'.split(''))
    expect(columnLabels(MINI)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('chain display data comes from the ruleset; unknown ids still render', () => {
    expect(chainName(VALLEY, 'hallucinate')).toBe('Hallucinate.ai')
    expect(chainSpec(MINI, 'aurelia').abbreviation).toBe('AU')
    expect(chainName(VALLEY, 'sandpiper')).toBe('sandpiper')
  })

  it('groups chains by tier with tier labels, cheapest first', () => {
    expect(chainsByTier(VALLEY).map((g) => [g.tier.label, g.chains.length])).toEqual([
      ['seed-stage', 2],
      ['growth-stage', 3],
      ['frontier lab', 2],
    ])
  })

  it('orders chain ids by the ruleset', () => {
    expect(orderChainIds(MINI, ['aurelia', 'sandpiper', 'zzz'])).toEqual([
      'sandpiper',
      'aurelia',
      'zzz',
    ])
  })

  it('formats money with the currency symbol and words with the right article', () => {
    expect(formatAmount({ ...MINI, theme: { ...MINI.theme, currency_symbol: '€' } }, 4000)).toBe(
      '€4,000'
    )
    expect(formatAmount(DEFAULT_RS, -50)).toBe('-$50')
    expect(article('AI startup')).toBe('an')
    expect(article('shipping line')).toBe('a')
    expect(playerRange(MINI)).toBe('2-5 players')
  })

  it('"a" or "an" follows how the ordinal is spoken: an 8th, an 11th, an 18th, but a 7th, a 12th, a 110th', () => {
    for (const p of ['8th', '11th', '18th', '80th', 'AI startup']) expect(article(p), p).toBe('an')
    for (const p of ['1st', '7th', '9th', '12th', '110th', '118th', 'hotel'])
      expect(article(p), p).toBe('a')
  })

  it('words unplayable-tile reasons from the ruleset', () => {
    expect(unplayableReasonText(MINI, 'would_create_eighth_chain')).toBe(
      'it would start a 6th shipping line (all 5 are already on the board)'
    )
    expect(unplayableReasonText(VALLEY, 'would_merge_safe_chains')).toBe(
      'it would merge two AI startups that are too big to acquire'
    )
  })
})

describe('colours and readable text', () => {
  it('the text colour on a chain colour is the one with the better contrast (white on dark, near-black on light)', () => {
    expect(readableText('#000000')).toBe(LIGHT_TEXT)
    expect(readableText('#FFFFFF')).toBe(DARK_TEXT)
    expect(readableText('#FFD700')).toBe(DARK_TEXT)
    expect(readableText('#1E3A8A')).toBe(LIGHT_TEXT)
    expect(readableText('#fff')).toBe(DARK_TEXT)
  })

  it('luminance and contrast follow WCAG', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5)
    expect(luminance('#f00')).toBeCloseTo(0.2126, 4)
    expect(luminance('#00ff00')).toBeCloseTo(0.7152, 4)
    expect(luminance('#0000FF')).toBeCloseTo(0.0722, 4)
    expect(luminance('not a colour')).toBe(0)
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 3)
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 3)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
  })

  it('every chain colour of every shipped ruleset has a text colour readable at 4.5:1', () => {
    for (const rs of [DEFAULT_RS, VALLEY, MINI]) {
      for (const c of rs.chains) {
        expect(
          contrastRatio(c.color, readableText(c.color)),
          `${rs.id} ${c.id}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('board and chain details', () => {
  it('the board has columns x rows squares', () => {
    expect(tileCount(DEFAULT_RS)).toBe(108)
    expect(tileCount(MINI)).toBe(63)
  })

  it('an unknown chain id is shown by its own name, abbreviated by its first two letters, in a neutral colour', () => {
    const spec = chainSpec(MINI, 'Zeta Corp')
    expect(spec).toMatchObject({ id: 'Zeta Corp', name: 'Zeta Corp', abbreviation: 'ZE', tier: '' })
    expect(spec.color).toBe('#6B7280')
    expect(chainSpec(MINI, '!!').abbreviation).toBe('?')
    expect(chainSpec(MINI, 'a-b-c').abbreviation).toBe('AB')
  })

  it('tiers that no chain uses are left out of the grouping', () => {
    const rs = { ...MINI, chains: MINI.chains.filter((c) => c.tier === MINI.tiers[0].id) }
    expect(chainsByTier(rs)).toHaveLength(1)
  })

  it('the ordinal in "the 12th chain" is right for 1st, 2nd, 3rd, 11th-13th, 21st, 22nd and 111th', () => {
    const word = (chains: number) =>
      unplayableReasonText(
        {
          ...MINI,
          chains: Array.from({ length: chains - 1 }, (_, i) => ({
            ...MINI.chains[0],
            id: `c${i}`,
          })),
        },
        'would_create_eighth_chain'
      ).match(/start an? (\w+) /)![1]
    expect(word(2)).toBe('2nd')
    expect(word(3)).toBe('3rd')
    expect(word(4)).toBe('4th')
    expect(word(11)).toBe('11th')
    expect(word(12)).toBe('12th')
    expect(word(13)).toBe('13th')
    expect(word(21)).toBe('21st')
    expect(word(22)).toBe('22nd')
    expect(word(111)).toBe('111th')
  })

  it('an unknown tile reason has a neutral text; a fixed player count reads as one number', () => {
    expect(unplayableReasonText(DEFAULT_RS, 'something_new')).toBe('it is not playable now')
    expect(unplayableReasonText(DEFAULT_RS, null)).toBe('it is not playable now')
    expect(playerRange({ ...DEFAULT_RS, min_players: 4, max_players: 4 })).toBe('4 players')
  })

  it('money: a dash for nothing, a minus sign before the symbol, thousands separators', () => {
    expect(formatAmount(DEFAULT_RS, null)).toBe('—')
    expect(formatAmount(DEFAULT_RS, undefined)).toBe('—')
    expect(formatAmount(DEFAULT_RS, Number.NaN)).toBe('—')
    expect(formatAmount(DEFAULT_RS, 0)).toBe('$0')
    expect(formatAmount(DEFAULT_RS, 1234567)).toBe('$1,234,567')
  })
})

describe('the ruleset of a transcript that does not carry one', () => {
  const states = (cells: string[], chains: Record<string, { color?: string }> = {}) => [
    { board: { cells: Object.fromEntries(cells.map((c) => [c, {}])) }, chains },
  ]

  it('a header that carries one wins', () => {
    expect(rulesetForTranscript(MINI, states(['1A']))).toBe(MINI)
  })

  it("otherwise the first known ruleset the states fit: the server's, then default", () => {
    // 12I is outside the 9x7 mini board but inside default.
    expect(rulesetForTranscript(null, states(['12I']), [MINI]).id).toBe('default')
    expect(rulesetForTranscript(null, states(['9G'], { sandpiper: {} }), [MINI])).toBe(MINI)
    // A chain the candidate does not have rules it out.
    expect(rulesetForTranscript(null, states(['1A'], { juniper: {} }), [MINI]).id).toBe('default')
    expect(rulesetForTranscript(undefined, states(['1A']))).toBeDefined()
  })

  it('failing that: default numbers with the chains and the board extent seen, and no borrowed title', () => {
    const rs = rulesetForTranscript(
      null,
      states(['14K', '3B', 'junk'], {
        sandpiper: { color: '#123456' },
        Zeta: {},
        marlowe: { color: '#654321' },
      }),
      []
    )
    expect(rs.id).toBe('unknown')
    expect(rs.title).toBe('')
    expect(rs.board).toEqual({ columns: 14, rows: 11 })
    expect(rs.chains.map((c) => c.id)).toEqual(['sandpiper', 'Zeta', 'marlowe'])
    expect(rs.chains.find((c) => c.id === 'sandpiper')!.color).toBe('#123456')
    expect(rs.chains.find((c) => c.id === 'sandpiper')!.tier).toBe(
      DEFAULT_RS.chains.find((c) => c.id === 'sandpiper')!.tier
    )
    // A chain default does not know gets the middle tier and a neutral colour.
    const zeta = rs.chains.find((c) => c.id === 'Zeta')!
    expect(zeta.tier).toBe(DEFAULT_RS.tiers[Math.floor(DEFAULT_RS.tiers.length / 2)].id)
    expect(zeta.color).toBe('#6B7280')
  })

  it('an empty board still gets a usable 2x2 grid', () => {
    const rs = rulesetForTranscript(null, states([], { Zeta: {} }), [])
    expect(rs.board).toEqual({ columns: 2, rows: 2 })
  })
})

describe('event sentences', () => {
  const names = { p1: 'Dan' }
  it('use display names, nouns and currency of the transcript ruleset', () => {
    const lines = describeEvents(
      [
        {
          seq: 1,
          type: 'merger_started',
          player_id: 'p1',
          private_to: null,
          survivor: 'omnimind',
          defunct: ['gradient'],
        },
        {
          seq: 2,
          type: 'stocks_purchased',
          player_id: 'p1',
          private_to: null,
          purchases: { hallucinate: 2 },
          total_cost: 600,
        },
      ],
      names,
      VALLEY
    )
    expect(lines[0].text).toBe('Acquisition: OmniMind absorbs Gradientfold.')
    expect(lines[1].text).toBe('Dan bought 2 Hallucinate.ai for $600.')
    expect(describeAction({ action: 'found_chain', chain: 'meridian' }, MINI)).toBe(
      'found Meridian'
    )
    expect(decisionKindLabel('found_chain', MINI)).toBe('Found a shipping line')
  })
})
