import { describe, it, expect } from 'vitest'
import {
  article,
  chainName,
  chainSpec,
  chainsByTier,
  columnLabels,
  formatAmount,
  orderChainIds,
  playerRange,
  rowLabels,
  sharePrice,
  unplayableReasonText,
} from './ruleset'
import { playerPhaseText, hostPhaseText } from './phaseText'
import { describeAction, describeEvents, decisionKindLabel } from './eventText'
import { CLASSIC, MINI, VALLEY } from '../../tests/unit/fixtures/rulesets'

describe('ruleset helpers', () => {
  it('board labels follow the ruleset size', () => {
    expect(rowLabels(CLASSIC)).toEqual('ABCDEFGHI'.split(''))
    expect(columnLabels(CLASSIC)).toHaveLength(12)
    expect(rowLabels(MINI)).toEqual('ABCDEFG'.split(''))
    expect(columnLabels(MINI)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('chain display data comes from the ruleset; unknown ids still render', () => {
    expect(chainName(VALLEY, 'hallucinate')).toBe('Hallucinate.ai')
    expect(chainSpec(MINI, 'beacon').abbreviation).toBe('B')
    expect(chainName(VALLEY, 'Luxor')).toBe('Luxor')
  })

  it('groups chains by tier with tier labels, cheapest first', () => {
    expect(chainsByTier(VALLEY).map((g) => [g.tier.label, g.chains.length])).toEqual([
      ['seed-stage', 2],
      ['growth-stage', 3],
      ['frontier lab', 2],
    ])
  })

  it('orders chain ids by the ruleset', () => {
    expect(orderChainIds(MINI, ['beacon', 'harbor', 'zzz'])).toEqual(['harbor', 'beacon', 'zzz'])
  })

  it('prices from tier brackets', () => {
    expect(sharePrice(MINI, 'harbor', 2)).toBe(100)
    expect(sharePrice(MINI, 'harbor', 7)).toBe(300)
    expect(sharePrice(MINI, 'beacon', 30)).toBe(1000)
    expect(sharePrice(CLASSIC, 'Luxor', 1)).toBe(0)
  })

  it('formats money with the currency symbol and words with the right article', () => {
    expect(formatAmount({ ...MINI, theme: { ...MINI.theme, currency_symbol: '€' } }, 4000)).toBe(
      '€4,000'
    )
    expect(formatAmount(CLASSIC, -50)).toBe('-$50')
    expect(article('AI startup')).toBe('an')
    expect(article('shipping line')).toBe('a')
    expect(playerRange(MINI)).toBe('2-5 players')
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

describe('phase banners', () => {
  it('classic keeps its familiar wording', () => {
    expect(playerPhaseText(CLASSIC, 'buy_stocks', true, 'x')).toBe('BUY STOCKS')
    expect(playerPhaseText(CLASSIC, 'found_chain', true, 'x')).toBe('CHOOSE A HOTEL CHAIN')
    expect(hostPhaseText(CLASSIC, 'merger', 'Bob')).toBe("Bob's TURN - MERGER")
  })

  it('themes use their own nouns', () => {
    expect(playerPhaseText(VALLEY, 'found_chain', true, 'x')).toBe('CHOOSE AN AI STARTUP')
    expect(playerPhaseText(VALLEY, 'merger', true, 'x')).toBe('ACQUISITION IN PROGRESS')
    expect(playerPhaseText(MINI, 'stock_disposition', true, 'x')).toBe('DISPOSE YOUR SHARES')
    expect(playerPhaseText(VALLEY, 'buy_stocks', true, 'x')).toBe('BUY EQUITY')
    expect(hostPhaseText(MINI, 'merger', 'Bob')).toBe("Bob's TURN - TAKEOVER")
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
    expect(lines[0].text).toBe('Acquisition: OmniMind absorbs Gradient Labs.')
    expect(lines[1].text).toBe('Dan bought 2 Hallucinate.ai for $600.')
    expect(describeAction({ action: 'found_chain', chain: 'quarry' }, MINI)).toBe('found Quarry')
    expect(decisionKindLabel('found_chain', MINI)).toBe('Found a shipping line')
  })
})
