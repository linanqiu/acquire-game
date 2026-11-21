import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useGameTabs, type GameTabsOptions } from './useGameTabs'
import { useGameStore } from '../store/gameStore'
import {
  autoSwitchTarget,
  eventSwitch,
  isBusyTrading,
  shortLabel,
  unreadCount,
  visibleTab,
} from '../lib/gameTabs'
import type { ChatMessage } from '../types/api'

function msg(id: number, player_id = 'p2'): ChatMessage {
  return {
    id,
    player_id,
    name: player_id,
    kind: 'human',
    source: 'human',
    text: `m${id}`,
    at: '2026-11-15T10:00:00Z',
    after_seq: -1,
    reply_to: null,
  }
}

const PHONE = ['board', 'now', 'players', 'chains', 'chat', 'trades']

function setup(over: Partial<GameTabsOptions> = {}) {
  const typing = { now: false }
  const props: GameTabsOptions = {
    room: 'ABCD',
    scope: 'player',
    available: PHONE,
    fallback: 'board',
    myId: 'me',
    events: [],
    isTyping: () => typing.now,
    ...over,
  }
  const hook = renderHook((p: GameTabsOptions) => useGameTabs(p), { initialProps: props })
  return { hook, props, typing }
}

describe('tab rules', () => {
  it('shows the chosen tab only when it exists on this layout', () => {
    expect(visibleTab('chat', PHONE, 'board')).toBe('chat')
    expect(visibleTab('board', ['players', 'chat'], 'players')).toBe('players')
    expect(visibleTab(null, PHONE, 'board')).toBe('board')
  })

  it('switches to the Board only when my place-tile turn starts, on a phone, while not typing', () => {
    const base = {
      wasMyPlaceTurn: false,
      isMyPlaceTurn: true,
      selected: 'chains',
      hasBoardTab: true,
      typing: false,
    }
    expect(autoSwitchTarget(base)).toBe('board')
    expect(autoSwitchTarget({ ...base, typing: true })).toBeNull()
    expect(autoSwitchTarget({ ...base, hasBoardTab: false })).toBeNull()
    expect(autoSwitchTarget({ ...base, wasMyPlaceTurn: true })).toBeNull()
    expect(autoSwitchTarget({ ...base, isMyPlaceTurn: false })).toBeNull()
    expect(autoSwitchTarget({ ...base, selected: 'board' })).toBeNull()
  })

  it('goes to the decision tab for something new, once; a badge instead while typing or when the Board takes over', () => {
    const base = { fresh: ['buy:p1:12'], selected: 'chains', typing: false, boardSwitch: false }
    expect(eventSwitch(base)).toEqual({ target: 'now', badge: false })
    expect(eventSwitch({ ...base, typing: true })).toEqual({ target: null, badge: true })
    expect(eventSwitch({ ...base, boardSwitch: true })).toEqual({ target: null, badge: true })
    expect(eventSwitch({ ...base, selected: 'now' })).toEqual({ target: null, badge: false })
    expect(eventSwitch({ ...base, fresh: [] })).toEqual({ target: null, badge: false })
  })

  it('counts unread lines from others only', () => {
    expect(unreadCount([msg(1), msg(2, 'me'), msg(3)], 1, 'me')).toBe(1)
  })

  it('makes short labels from the ruleset nouns', () => {
    expect(shortLabel('hotel chains')).toBe('Chains')
    expect(shortLabel('AI startups')).toBe('Startups')
  })
})

describe('useGameTabs', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useGameStore.getState().reset()
  })

  it('remembers the selected tab per room and page for the session', () => {
    const { hook } = setup()
    expect(hook.result.current.selected).toBe('board')
    act(() => hook.result.current.select('chains'))
    expect(hook.result.current.selected).toBe('chains')
    hook.unmount()
    expect(setup().hook.result.current.selected).toBe('chains')
    expect(setup({ room: 'WXYZ' }).hook.result.current.selected).toBe('board')
    expect(setup({ scope: 'host' }).hook.result.current.selected).toBe('board')
  })

  it('a remembered Board falls back to the default on a wide layout (no Board tab there)', () => {
    sessionStorage.setItem('tab:player:ABCD', 'board')
    const { hook } = setup({
      available: ['players', 'chains', 'chat', 'trades'],
      fallback: 'players',
    })
    expect(hook.result.current.selected).toBe('players')
  })

  it('goes to the Board when my place-tile turn starts, and marks the Board meanwhile', () => {
    const { hook, props } = setup()
    act(() => hook.result.current.select('chains'))
    expect(hook.result.current.boardMarker).toBe(false)
    hook.rerender({ ...props, myPlaceTurn: true })
    expect(hook.result.current.selected).toBe('board')
    // I can leave the Board during my turn; it is marked until I place.
    act(() => hook.result.current.select('players'))
    expect(hook.result.current.selected).toBe('players')
    expect(hook.result.current.boardMarker).toBe(true)
    hook.rerender({ ...props, myPlaceTurn: false })
    expect(hook.result.current.boardMarker).toBe(false)
  })

  it('never switches while I am typing in the chat', () => {
    const { hook, props, typing } = setup()
    act(() => hook.result.current.select('chat'))
    typing.now = true
    hook.rerender({ ...props, myPlaceTurn: true })
    expect(hook.result.current.selected).toBe('chat')
    expect(hook.result.current.boardMarker).toBe(true)
  })

  it('never switches while I am in the middle of a trade: a marker and a badge instead (BL-021)', () => {
    const busy = { now: true }
    const { hook, props } = setup({ isBusy: (selected) => busy.now && selected === 'trades' })
    act(() => hook.result.current.select('trades'))
    // My place-tile turn starts while I compose an offer (or read down the Trades tab).
    hook.rerender({ ...props, myPlaceTurn: true })
    expect(hook.result.current.selected).toBe('trades')
    expect(hook.result.current.boardMarker).toBe(true)
    // An offer for me arrives: no switch to the decision tab either; it gets the badge.
    hook.rerender({ ...props, myPlaceTurn: true, decisionTab: 'board', events: ['trade:t1'] })
    expect(hook.result.current.selected).toBe('trades')
    expect(hook.result.current.nowBadge).toBe(true)
    // Done trading: the next new thing takes me there as before.
    busy.now = false
    hook.rerender({
      ...props,
      myPlaceTurn: true,
      decisionTab: 'board',
      events: ['trade:t1', 'trade:t2'],
    })
    expect(hook.result.current.selected).toBe('board')
  })

  it('isBusyTrading: the composer on the page, or the Trades tab scrolled', () => {
    expect(isBusyTrading('trades')).toBe(false)
    const y = Object.getOwnPropertyDescriptor(window, 'scrollY')
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true })
    expect(isBusyTrading('trades')).toBe(true)
    expect(isBusyTrading('chains')).toBe(false)
    if (y) Object.defineProperty(window, 'scrollY', y)
    else Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    const composer = document.createElement('div')
    composer.setAttribute('data-testid', 'trade-builder')
    document.body.appendChild(composer)
    expect(isBusyTrading('board')).toBe(true)
    // A draft parked in a hidden tab panel is not being composed.
    const panel = document.createElement('div')
    panel.hidden = true
    document.body.appendChild(panel)
    panel.appendChild(composer)
    expect(isBusyTrading('board')).toBe(false)
    panel.remove()
    expect(isBusyTrading('board')).toBe(false)
  })

  it('does not switch on wide screens (no Board tab)', () => {
    const wide = ['players', 'chains', 'chat', 'trades']
    const { hook, props } = setup({ available: wide, fallback: 'players' })
    act(() => hook.result.current.select('chat'))
    hook.rerender({ ...props, available: wide, fallback: 'players', myPlaceTurn: true })
    expect(hook.result.current.selected).toBe('chat')
    expect(hook.result.current.boardMarker).toBe(false)
  })

  it('counts unread chat from others while Chat is not open, and clears it on open', () => {
    const { hook } = setup()
    act(() => useGameStore.setState({ chatMessages: [msg(1), msg(2, 'me'), msg(3)] }))
    expect(hook.result.current.chatUnread).toBe(2)
    act(() => hook.result.current.select('chat'))
    expect(hook.result.current.chatUnread).toBe(0)
    act(() => hook.result.current.select('board'))
    expect(hook.result.current.chatUnread).toBe(0)
    act(() => useGameStore.setState({ chatMessages: [msg(1), msg(2, 'me'), msg(3), msg(4)] }))
    expect(hook.result.current.chatUnread).toBe(1)
  })

  it('a first visit counts the chat history sent on connect as read; later lines are unread', () => {
    const { hook } = setup()
    act(() =>
      useGameStore.getState().handleMessage({ type: 'chat_history', messages: [msg(1), msg(2)] })
    )
    expect(hook.result.current.chatUnread).toBe(0)
    act(() => useGameStore.getState().handleMessage({ type: 'chat_message', message: msg(3) }))
    expect(hook.result.current.chatUnread).toBe(1)
  })

  it('a new decision or merger takes me to the decision tab once per event', () => {
    const { hook, props } = setup()
    act(() => hook.result.current.select('chains'))
    hook.rerender({ ...props, events: ['merger:40'] })
    expect(hook.result.current.selected).toBe('now')
    // I leave it; the same event does not pull me back.
    act(() => hook.result.current.select('players'))
    hook.rerender({ ...props, events: ['merger:40', 'disposition:40:halcyon'] })
    expect(hook.result.current.selected).toBe('now') // my disposition is a new event
    act(() => hook.result.current.select('players'))
    hook.rerender({ ...props, events: ['merger:40'] })
    hook.rerender({ ...props, events: ['merger:40', 'disposition:40:halcyon'] })
    expect(hook.result.current.selected).toBe('players') // seen before: no second yank
    // The merger resolves: a new event.
    hook.rerender({ ...props, events: ['merger:40', 'merger-done:40'] })
    expect(hook.result.current.selected).toBe('now')
  })

  it('while I type in the chat: no switch, a badge on the decision tab until I open it', () => {
    const { hook, props, typing } = setup()
    act(() => hook.result.current.select('chat'))
    typing.now = true
    hook.rerender({ ...props, events: ['merger:40'] })
    expect(hook.result.current.selected).toBe('chat')
    expect(hook.result.current.nowBadge).toBe(true)
    typing.now = false
    hook.rerender({ ...props, events: ['merger:40'] })
    expect(hook.result.current.selected).toBe('chat') // the event was handled (badge)
    act(() => hook.result.current.select('now'))
    expect(hook.result.current.nowBadge).toBe(false)
  })

  it('my place-tile turn wins: Board, and a badge for what arrived with it', () => {
    const { hook, props } = setup()
    act(() => hook.result.current.select('chains'))
    hook.rerender({ ...props, myPlaceTurn: true, events: ['merger:40', 'merger-done:40'] })
    expect(hook.result.current.selected).toBe('board')
    expect(hook.result.current.nowBadge).toBe(true)
  })

  it('a decision pending on the first state opens the decision tab; after a reload, a badge', () => {
    const first = setup({ events: ['buy:p1:12'] })
    expect(first.hook.result.current.selected).toBe('now')
    first.hook.unmount()
    sessionStorage.setItem('tab:player:ABCD', 'chains')
    const reloaded = setup({ events: ['buy:p1:12'] })
    expect(reloaded.hook.result.current.selected).toBe('chains')
    expect(reloaded.hook.result.current.nowBadge).toBe(true)
  })
})
