import { describe, it, expect } from 'vitest'
import { hostPhaseText, orderPhaseText, playerPhaseText } from './phaseText'
import { DEFAULT_RS, MINI, VALLEY } from '../../tests/unit/fixtures/rulesets'

describe('the banner the player reads, by phase, whose turn it is, and the ruleset words', () => {
  it('on my turn, each phase says what I am to do (default)', () => {
    const say = (phase) => playerPhaseText(DEFAULT_RS, phase, true, 'Alice')
    expect(say('place_tile')).toBe('PLACE A TILE')
    expect(say('found_chain')).toBe('CHOOSE A HOTEL CHAIN')
    expect(say('merger')).toBe('MERGER IN PROGRESS')
    expect(say('stock_disposition')).toBe('DISPOSE YOUR SHARES')
    expect(say('buy_stocks')).toBe('BUY STOCKS')
  })

  it('each ruleset uses its own words for founding, mergers, shares and buying', () => {
    expect(playerPhaseText(VALLEY, 'found_chain', true, 'A')).toBe('CHOOSE AN AI STARTUP')
    expect(playerPhaseText(VALLEY, 'merger', true, 'A')).toBe('ACQUISITION IN PROGRESS')
    expect(playerPhaseText(VALLEY, 'stock_disposition', true, 'A')).toBe(
      'DISPOSE YOUR EQUITY SHARES'
    )
    expect(playerPhaseText(VALLEY, 'buy_stocks', true, 'A')).toBe('BUY EQUITY')
    expect(playerPhaseText(MINI, 'found_chain', true, 'A')).toBe('CHOOSE A SHIPPING LINE')
    expect(playerPhaseText(MINI, 'merger', true, 'A')).toBe('TAKEOVER IN PROGRESS')
    expect(playerPhaseText(MINI, 'buy_stocks', true, 'A')).toBe('BUY SHARES')
  })

  it('the merger-order choice has its own banner, in the ruleset words', () => {
    expect(orderPhaseText(DEFAULT_RS)).toBe('CHOOSE THE MERGER ORDER')
    expect(orderPhaseText(VALLEY)).toBe('CHOOSE THE ACQUISITION ORDER')
    expect(orderPhaseText(MINI)).toBe('CHOOSE THE TAKEOVER ORDER')
  })

  it('when it is not my turn the banner names whose turn it is, in any phase', () => {
    for (const phase of [
      'place_tile',
      'found_chain',
      'merger',
      'stock_disposition',
      'buy_stocks',
    ]) {
      expect(playerPhaseText(DEFAULT_RS, phase, false, 'Bob')).toBe("Bob's TURN")
    }
  })

  it('the lobby and the end of the game read the same whoever is asking', () => {
    for (const mine of [true, false]) {
      expect(playerPhaseText(DEFAULT_RS, 'lobby', mine, 'Bob')).toBe('WAITING FOR HOST')
      expect(playerPhaseText(DEFAULT_RS, 'game_over', mine, 'Bob')).toBe('GAME OVER')
    }
  })
})

describe('the banner the spectator reads', () => {
  it("is '<name>'s TURN - <step>' with the ruleset's words", () => {
    expect(hostPhaseText(DEFAULT_RS, 'place_tile', 'Alice')).toBe("Alice's TURN - PLACE TILE")
    expect(hostPhaseText(DEFAULT_RS, 'found_chain', 'Alice')).toBe(
      "Alice's TURN - FOUND A HOTEL CHAIN"
    )
    expect(hostPhaseText(DEFAULT_RS, 'merger', 'Alice')).toBe("Alice's TURN - MERGER")
    expect(hostPhaseText(DEFAULT_RS, 'stock_disposition', 'Alice')).toBe(
      "Alice's TURN - MERGER: SHARES"
    )
    expect(hostPhaseText(DEFAULT_RS, 'buy_stocks', 'Alice')).toBe("Alice's TURN - BUY STOCKS")
    expect(hostPhaseText(VALLEY, 'merger', 'Alice')).toBe("Alice's TURN - ACQUISITION")
    expect(hostPhaseText(MINI, 'found_chain', 'Alice')).toBe("Alice's TURN - FOUND A SHIPPING LINE")
  })

  it('the lobby and the end of the game have no turn', () => {
    expect(hostPhaseText(DEFAULT_RS, 'lobby', 'Alice')).toBe('WAITING FOR PLAYERS')
    expect(hostPhaseText(DEFAULT_RS, 'game_over', 'Alice')).toBe('GAME OVER')
  })
})
