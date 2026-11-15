import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useGameTabs, type GameTabsOptions } from './useGameTabs'
import { useGameStore } from '../store/gameStore'
import { autoSwitchTarget, shortLabel, unreadCount, visibleTab } from '../lib/gameTabs'
import type { ChatMessage, MergerRecord } from '../types/api'

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

function merger(seq: number): MergerRecord {
  return {
    seq,
    player_id: 'p1',
    tile: '6C',
    survivor: 'Halcyon',
    sizes: {},
    defunct: [],
    survivor_size: null,
    complete: false,
  }
}

const PHONE = ['board', 'players', 'chains', 'chat', 'trades']

function setup(over: Partial<GameTabsOptions> = {}) {
  const typing = { now: false }
  const props: GameTabsOptions = {
    room: 'ABCD',
    scope: 'player',
    available: PHONE,
    fallback: 'board',
    myId: 'me',
    logTab: 'trades',
    mergers: [],
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

  it('dots the log tab for a merger that arrives while the page is open, until the log is opened', () => {
    const { hook, props } = setup({ mergers: [merger(5)] })
    expect(hook.result.current.newMerger).toBe(false) // already there on load
    hook.rerender({ ...props, mergers: [merger(5), merger(9)] })
    expect(hook.result.current.newMerger).toBe(true)
    act(() => hook.result.current.select('trades'))
    expect(hook.result.current.newMerger).toBe(false)
    act(() => hook.result.current.select('board'))
    expect(hook.result.current.newMerger).toBe(false)
  })
})
