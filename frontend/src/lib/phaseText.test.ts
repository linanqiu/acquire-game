import { describe, it, expect } from 'vitest'
import { hostPhaseText, lobbyPhaseText, playerPhaseText, waitingPhaseText } from './phaseText'
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

describe('the player banner says once what the room or the table waits for (BL-015)', () => {
  it('in the lobby: how many players are missing, or that the host can start; a guest waits', () => {
    expect(lobbyPhaseText(true, 1, 3)).toBe('NEED 2 MORE PLAYERS TO START')
    expect(lobbyPhaseText(true, 2, 3)).toBe('NEED 1 MORE PLAYER TO START')
    expect(lobbyPhaseText(true, 3, 3)).toBe('START WHEN EVERYONE IS IN')
    expect(lobbyPhaseText(false, 1, 3)).toBe('WAITING FOR THE HOST TO START')
    expect(lobbyPhaseText(false, 6, 3)).toBe('WAITING FOR THE HOST TO START')
  })

  it('names the player the table waits on and what they do, in the ruleset words', () => {
    const players = { p1: { name: 'Alice' }, p2: { name: 'Cara Coin' } }
    const wait = (decision: string, rs = DEFAULT_RS) =>
      waitingPhaseText(rs, { player_id: 'p2', kind: 'human', decision }, players, 'Alice')
    expect(wait('buy_stocks')).toBe('CARA COIN IS BUYING SHARES')
    expect(wait('stock_disposition')).toBe('CARA COIN IS DISPOSING OF SHARES')
    expect(wait('place_tile')).toBe('CARA COIN IS PLACING A TILE')
    expect(wait('buy_stocks', VALLEY)).toMatch(/^CARA COIN IS BUYING /)
    // A short name for a narrow bar, when the page has one.
    expect(
      waitingPhaseText(
        DEFAULT_RS,
        { player_id: 'p2', kind: 'human', decision: 'buy_stocks' },
        players,
        'Alice',
        () => 'Cara'
      )
    ).toBe('CARA IS BUYING SHARES')
  })

  it('falls back to whose turn it is when the decision or the player is unknown', () => {
    const players = { p1: { name: 'Alice' } }
    expect(waitingPhaseText(DEFAULT_RS, null, players, 'Alice')).toBe("Alice's TURN")
    expect(
      waitingPhaseText(
        DEFAULT_RS,
        { player_id: 'p9', kind: 'human', decision: 'buy_stocks' },
        players,
        'Alice'
      )
    ).toBe("Alice's TURN")
    expect(
      waitingPhaseText(
        DEFAULT_RS,
        { player_id: 'p1', kind: 'human', decision: 'mystery' },
        players,
        'Alice'
      )
    ).toBe("Alice's TURN")
  })
})
