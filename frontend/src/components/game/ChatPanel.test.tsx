import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ChatPanel } from './ChatPanel'
import { CHAT_KEEP, mergeChat, useGameStore } from '../../store/gameStore'
import type { ChatMessage, LobbySeat } from '../../types/api'

function msg(id: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    player_id: 'p2',
    name: 'Bob',
    kind: 'human',
    source: 'human',
    text: `message ${id}`,
    at: '2026-11-15T10:00:00Z',
    after_seq: -1,
    reply_to: null,
    ...over,
  }
}

const SEATS: LobbySeat[] = [
  { player_id: 'me', name: 'Alice', is_bot: false, kind: 'human' },
  { player_id: 'p2', name: 'Bob', is_bot: false, kind: 'human' },
  { player_id: 'ai', name: 'Claude', is_bot: true, kind: 'llm', agent_label: 'Claude' },
  { player_id: 'b1', name: 'Bot 1', is_bot: true, kind: 'bot' },
]

function deliver(m: ChatMessage) {
  act(() => useGameStore.getState().handleMessage({ type: 'chat_message', message: m }))
}

describe('chat in the game store', () => {
  beforeEach(() => useGameStore.getState().reset())

  it('appends messages, ignores duplicates and merges the reconnect history in order', () => {
    const store = useGameStore.getState()
    store.handleMessage({ type: 'chat_message', message: msg(2) })
    store.handleMessage({ type: 'chat_message', message: msg(2) })
    store.handleMessage({ type: 'chat_history', messages: [msg(1), msg(2), msg(3)] })
    expect(useGameStore.getState().chatMessages.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('keeps the newest CHAT_KEEP messages and resets with the room', () => {
    const many = Array.from({ length: CHAT_KEEP + 5 }, (_, i) => msg(i + 1))
    expect(mergeChat([], many)).toHaveLength(CHAT_KEEP)
    expect(mergeChat([], many)[0].id).toBe(6)
    useGameStore.getState().handleMessage({ type: 'chat_history', messages: many })
    useGameStore.getState().reset()
    expect(useGameStore.getState().chatMessages).toEqual([])
  })
})

describe('ChatPanel', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    useGameStore.getState().reset()
    useGameStore.setState({
      currentPlayer: { id: 'me', name: 'Alice', isHost: false },
      lobbyPlayers: SEATS,
    })
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists messages with name and kind badge, and renders text as text (never HTML)', () => {
    useGameStore.setState({
      chatMessages: [
        msg(1, { text: '<img src=x onerror=alert(1)><b>bold</b>' }),
        msg(2, { player_id: 'ai', name: 'Claude', kind: 'llm', source: 'reply', text: 'Deal.' }),
        msg(3, { player_id: 'me', name: 'Alice', text: 'mine' }),
      ],
    })
    render(<ChatPanel room="ABCD" />)
    const lines = screen.getAllByTestId('chat-message')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toHaveTextContent('<img src=x onerror=alert(1)><b>bold</b>')
    expect(lines[0].querySelector('img, b')).toBeNull()
    expect(lines[1]).toHaveAttribute('data-kind', 'llm')
    expect(within(lines[1]).getByText('AI')).toBeInTheDocument()
    expect(within(lines[2]).getByText('YOU')).toBeInTheDocument()
  })

  it('says which seats are AI that read the chat, and that rules-based bots do not', () => {
    render(<ChatPanel room="ABCD" />)
    const readers = screen.getByTestId('chat-readers')
    expect(readers).toHaveTextContent('AI that reads chat and may answer: Claude.')
    expect(readers).toHaveTextContent('Rules-based bots do not chat.')
    expect(readers).not.toHaveTextContent('Bot 1')
  })

  it('sends on Enter over HTTP and clears the input', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    render(<ChatPanel room="ABCD" />)
    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: '  Claude, I take Marlowe  ' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/room/ABCD/chat/me')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ text: 'Claude, I take Marlowe' })
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('shows the server refusal (rate limit) and keeps the draft', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'You are sending messages too fast; wait a moment' }), {
        status: 429,
      })
    )
    render(<ChatPanel room="ABCD" />)
    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: 'again' } })
    fireEvent.click(screen.getByTestId('chat-send'))
    expect(await screen.findByTestId('chat-error')).toHaveTextContent('too fast')
    expect(input).toHaveValue('again')
  })

  it('does not send an empty message', () => {
    render(<ChatPanel room="ABCD" />)
    expect(screen.getByTestId('chat-send')).toBeDisabled()
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '   ' } })
    fireEvent.submit(screen.getByTestId('chat-input').closest('form')!)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is read-only for spectators, with the reason', () => {
    render(<ChatPanel room="ABCD" mode="spectator" />)
    expect(screen.queryByTestId('chat-input')).toBeNull()
    expect(screen.getByTestId('chat-read-only')).toHaveTextContent(
      'Spectators can read the chat but not write.'
    )
  })

  it('in a tab: no title of its own; outside a game: titled card', () => {
    const { rerender } = render(<ChatPanel room="ABCD" inTab />)
    expect(screen.queryByText('TABLE CHAT')).toBeNull()
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    rerender(<ChatPanel room="ABCD" />)
    expect(screen.getByText('TABLE CHAT')).toBeInTheDocument()
  })

  it('follows new messages at the bottom but does not yank a reader who scrolled up', () => {
    useGameStore.setState({ chatMessages: [msg(1), msg(2)] })
    render(<ChatPanel room="ABCD" />)
    const list = screen.getByTestId('chat-list')
    // jsdom has no layout: fake a scrollable list
    let top = 0
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 200 })
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v
      },
    })
    // at the bottom: a new message scrolls to it
    top = 800
    fireEvent.scroll(list)
    deliver(msg(3))
    expect(top).toBe(1000)
    expect(screen.queryByTestId('chat-new-below')).toBeNull()
    // scrolled up: the view stays, a "new messages" button appears
    top = 100
    fireEvent.scroll(list)
    deliver(msg(4))
    expect(top).toBe(100)
    fireEvent.click(screen.getByTestId('chat-new-below'))
    expect(top).toBe(1000)
    expect(screen.queryByTestId('chat-new-below')).toBeNull()
  })
})
