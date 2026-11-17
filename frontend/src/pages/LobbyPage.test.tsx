/**
 * The home page's forms. The server's answers are the real ones (recorded from the backend,
 * tests/unit/fixtures/generate_wire_messages.py): create, join, spectator, and each refusal.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserRouter } from 'react-router-dom'
import { LobbyPage } from './LobbyPage'
import { ToastProvider } from '../components/ui/ToastProvider'
import { wireHome } from '../../tests/unit/fixtures/wire'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

type Answer = { status: number; body: unknown }
const home = wireHome()

/** Answer the page's calls: health is always fine; the others as `answers` says (by path). */
function serve(answers: Record<string, Answer | (() => Promise<Answer>)>) {
  const fn = vi.fn(async (url: string) => {
    if (url === '/api/health') return { ok: true, status: 200 } as Response
    const a = answers[url]
    const { status, body } = typeof a === 'function' ? await a() : a
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const post = (fn: ReturnType<typeof serve>, path: string) =>
  fn.mock.calls.find((c) => c[0] === path) as unknown as [string, RequestInit] | undefined
const form = (fn: ReturnType<typeof serve>, path: string) =>
  post(fn, path)![1].body as URLSearchParams

function mount() {
  return render(
    <BrowserRouter>
      <ToastProvider>
        <LobbyPage />
      </ToastProvider>
    </BrowserRouter>
  )
}
// The name is asked once, for both ways in (BL-017).
const create = (name: string) => {
  fireEvent.change(screen.getByTestId('name-input'), { target: { value: name } })
  fireEvent.click(screen.getByTestId('create-button'))
}
const join = (name: string, code: string) => {
  fireEvent.change(screen.getByTestId('name-input'), { target: { value: name } })
  fireEvent.change(screen.getByTestId('join-room-input'), { target: { value: code } })
  fireEvent.click(screen.getByTestId('join-button'))
}

beforeEach(() => {
  mockNavigate.mockClear()
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await new Promise((r) => setTimeout(r, 0))
})

describe('create a game', () => {
  it('an empty or blank name, or one over 20 characters, is refused before anything is sent', async () => {
    const fn = serve({})
    mount()
    create('')
    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    create('   ')
    expect(screen.getByText('Name is required')).toBeInTheDocument()
    create('x'.repeat(21))
    expect(await screen.findByText('Name must be 20 characters or less')).toBeInTheDocument()
    expect(post(fn, '/api/create')).toBeUndefined()
  })

  it('a 20-character name is fine; the name is trimmed; the host lands in the room with the host flag', async () => {
    const fn = serve({ '/api/create': home.create })
    mount()
    create('  ' + 'n'.repeat(20) + '  ')
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/play/${home.create.body.room_code}?is_host=1`)
    )
    const [, init] = post(fn, '/api/create')!
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })
    expect(form(fn, '/api/create').get('player_name')).toBe('n'.repeat(20))
    expect(sessionStorage.getItem('player_id')).toBe(home.create.body.player_id)
    // /create sends no token and the browser stores none (it once stored "undefined")
    expect(sessionStorage.getItem('session_token')).toBeNull()
    expect(sessionStorage.getItem('player_name')).toBe('n'.repeat(20))
  })

  it("while the request is in flight the button is off, and a failure is shown with the server's reason", async () => {
    let release: (a: Answer) => void = () => {}
    serve({ '/api/create': () => new Promise<Answer>((r) => (release = r)) })
    mount()
    create('Alice')
    expect(screen.getByTestId('create-button')).toBeDisabled()
    release({ status: 500, body: { detail: 'Failed to create room' } })
    await waitFor(() =>
      expect(screen.getAllByText('Failed to create room').length).toBeGreaterThan(0)
    )
    expect(screen.getByTestId('create-button')).toBeEnabled()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('player_id')).toBeNull()
  })

  it('typing again clears the error; Enter in the name field also creates the game', async () => {
    const fn = serve({ '/api/create': home.create })
    mount()
    create('')
    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'A' } })
    expect(screen.queryByText('Name is required')).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByTestId('name-input'), { key: 'Enter' })
    await waitFor(() => expect(post(fn, '/api/create')).toBeDefined())
  })
})

describe('join a game', () => {
  it('needs a name and a four-character room code', async () => {
    const fn = serve({})
    mount()
    join('', 'ABCD')
    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    join('Bob', 'ABC')
    expect(await screen.findByText('Room code must be 4 characters')).toBeInTheDocument()
    join('Bob', 'ABCDE')
    expect(screen.getByText('Room code must be 4 characters')).toBeInTheDocument()
    expect(post(fn, '/api/join')).toBeUndefined()
  })

  it('the room code is shown upper-case as typed and sent upper-case, trimmed; the player lands in the room', async () => {
    const fn = serve({ '/api/join': home.join })
    mount()
    fireEvent.change(screen.getByTestId('join-room-input'), { target: { value: 'ubqo' } })
    expect(screen.getByTestId('join-room-input')).toHaveValue('UBQO')
    join(' Bob ', ' ubqo ')
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/play/${home.join.body.room_code}`)
    )
    expect(form(fn, '/api/join').get('room_code')).toBe('UBQO')
    expect(form(fn, '/api/join').get('player_name')).toBe('Bob')
    expect(sessionStorage.getItem('player_id')).toBe(home.join.body.player_id)
    expect(sessionStorage.getItem('session_token')).toBeNull()
    expect(sessionStorage.getItem('player_name')).toBe('Bob')
  })

  it.each([
    ['join_unknown_room', 'Room not found'],
    ['join_duplicate_name', 'Player name already taken'],
    ['join_full_room', 'Room is full'],
    ['join_started_game', 'Game already started'],
  ] as const)('the server\'s refusal "%s" is shown as the server worded it', async (key, text) => {
    serve({ '/api/join': home[key] })
    mount()
    join('Bob', 'ABCD')
    await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0))
    expect(home[key].body.detail).toBe(text)
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('player_id')).toBeNull()
  })

  it('Enter in the room-code field joins', async () => {
    const fn = serve({ '/api/join': home.join })
    mount()
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'Bob' } })
    fireEvent.change(screen.getByTestId('join-room-input'), { target: { value: 'ABCD' } })
    fireEvent.keyDown(screen.getByTestId('join-room-input'), { key: 'Enter' })
    await waitFor(() => expect(post(fn, '/api/join')).toBeDefined())
  })

  it('Enter in the name field joins when a code has been typed (and does not create a game)', async () => {
    const fn = serve({ '/api/join': home.join })
    mount()
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'Bob' } })
    fireEvent.change(screen.getByTestId('join-room-input'), { target: { value: 'ABCD' } })
    fireEvent.keyDown(screen.getByTestId('name-input'), { key: 'Enter' })
    await waitFor(() => expect(post(fn, '/api/join')).toBeDefined())
    expect(post(fn, '/api/create')).toBeUndefined()
  })

  it('each problem is said at the control it is about: the name at the name, the room at the code', async () => {
    serve({ '/api/join': home.join_duplicate_name })
    mount()
    const name = screen.getByTestId('name-input')
    const code = screen.getByTestId('join-room-input')
    // A missing name, asked for by JOIN: at the name field, which takes the focus.
    join('', 'ABCD')
    expect(name).toHaveAccessibleDescription('Name is required')
    expect(code).not.toHaveAttribute('aria-invalid')
    expect(name).toHaveFocus()
    // A bad code: at the code field.
    join('Bob', 'AB')
    expect(code).toHaveAccessibleDescription('Room code must be 4 characters')
    expect(name).not.toHaveAttribute('aria-invalid')
    // The server refuses the name: back at the name field.
    join('Bob', 'ABCD')
    await waitFor(() => expect(name).toHaveAccessibleDescription('Player name already taken'))
    expect(code).not.toHaveAttribute('aria-invalid')
  })

  it('the server refusing the room is said at the code field', async () => {
    serve({ '/api/join': home.join_unknown_room })
    mount()
    join('Bob', 'ABCD')
    const code = screen.getByTestId('join-room-input')
    await waitFor(() => expect(code).toHaveAccessibleDescription('Room not found'))
    expect(screen.getByTestId('name-input')).not.toHaveAttribute('aria-invalid')
  })
})

describe('one name, two ways in', () => {
  it('asks the name once, with an accessible name on every control and no repeated label', () => {
    serve({})
    mount()
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    expect(screen.getByRole('textbox', { name: 'Your name' })).toBe(
      screen.getByTestId('name-input')
    )
    expect(screen.getByRole('textbox', { name: 'or join with a code' })).toBe(
      screen.getByTestId('join-room-input')
    )
    expect(screen.getAllByText(/your name/i)).toHaveLength(1)
    expect(screen.queryByPlaceholderText(/enter your name/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CREATE GAME' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'JOIN' })).toBeInTheDocument()
  })

  it('remembers the last name used and offers it again; the join uses the same name', async () => {
    const fn = serve({ '/api/create': home.create, '/api/join': home.join })
    const first = mount()
    create('Ada')
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    first.unmount()
    mount()
    expect(screen.getByTestId('name-input')).toHaveValue('Ada')
    fireEvent.change(screen.getByTestId('join-room-input'), { target: { value: 'ABCD' } })
    fireEvent.click(screen.getByTestId('join-button'))
    await waitFor(() => expect(post(fn, '/api/join')).toBeDefined())
    expect(form(fn, '/api/join').get('player_name')).toBe('Ada')
  })

  it('a failed attempt is not remembered, and a browser without storage still works', async () => {
    serve({ '/api/create': { status: 500, body: { detail: 'Failed to create room' } } })
    const first = mount()
    create('Nobody')
    expect(await screen.findByTestId('create-error')).toHaveTextContent('Failed to create room')
    first.unmount()
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is off')
    })
    mount()
    expect(screen.getByTestId('name-input')).toHaveValue('')
    getItem.mockRestore()
  })
})

describe('watch bots play', () => {
  it('creates a spectator room, forgets any player seat of this browser, and opens the host view', async () => {
    sessionStorage.setItem('player_id', 'old')
    sessionStorage.setItem('player_name', 'Old')
    const fn = serve({ '/api/create-spectator': home.spectator })
    mount()
    fireEvent.click(screen.getByTestId('watch-bots-button'))
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/host/${home.spectator.body.room_code}`)
    )
    expect(post(fn, '/api/create-spectator')![1].method).toBe('POST')
    expect(sessionStorage.getItem('player_id')).toBeNull()
    expect(sessionStorage.getItem('player_name')).toBeNull()
  })

  it('a failure is shown and nothing changes', async () => {
    sessionStorage.setItem('player_id', 'keep')
    serve({ '/api/create-spectator': { status: 500, body: { detail: 'No room for you' } } })
    mount()
    fireEvent.click(screen.getByTestId('watch-bots-button'))
    await waitFor(() => expect(screen.getByText('No room for you')).toBeInTheDocument())
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('player_id')).toBe('keep')
  })
})
