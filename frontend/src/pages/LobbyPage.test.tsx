/**
 * The home page's forms. The server's answers are the real ones (recorded from the backend,
 * tests/unit/fixtures/generate_wire_messages.py): create, join, spectator, and each refusal.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
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

function mount(url = '/') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <LobbyPage />
      </ToastProvider>
    </MemoryRouter>
  )
}
// The name is asked first; then NEW GAME or JOIN GAME (BL-018).
const create = (name: string) => {
  fireEvent.change(screen.getByTestId('name-input'), { target: { value: name } })
  fireEvent.click(screen.getByTestId('create-button'))
}
/** Mount the home page, give the name, JOIN GAME, type the code (the fourth letter joins). */
const join = (name: string, code: string) => {
  mount()
  fireEvent.change(screen.getByTestId('name-input'), { target: { value: name } })
  fireEvent.click(screen.getByTestId('join-button'))
  fireEvent.change(screen.getByTestId('join-room-input'), { target: { value: code } })
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
  it('JOIN GAME needs a name first, then opens the code step with the cursor in the code field', () => {
    const fn = serve({})
    mount()
    fireEvent.click(screen.getByTestId('join-button'))
    expect(screen.getByTestId('name-input')).toHaveAccessibleDescription('Name is required')
    expect(screen.queryByTestId('join-room-input')).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'Bob' } })
    fireEvent.click(screen.getByTestId('join-button'))
    // One question at a time: the name is now a quiet line, the code the only field.
    expect(screen.queryByTestId('name-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('join-as')).toHaveTextContent('Joining as Bob')
    expect(screen.getByTestId('join-room-input')).toHaveFocus()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(post(fn, '/api/join')).toBeUndefined()
  })

  it('a short code is refused at the code field; nothing is sent', async () => {
    const fn = serve({})
    mount('/?join')
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'Bob' } })
    fireEvent.change(screen.getByTestId('join-room-input'), { target: { value: 'ABC' } })
    fireEvent.click(screen.getByTestId('join-submit-button'))
    expect(screen.getByTestId('join-room-input')).toHaveAccessibleDescription(
      'Room code must be 4 letters'
    )
    expect(post(fn, '/api/join')).toBeUndefined()
  })

  it('the fourth letter joins: the code is upper-cased, letters only, and sent with the trimmed name', async () => {
    const fn = serve({ '/api/join': home.join })
    join(' Bob ', 'ub')
    expect(screen.getByTestId('join-room-input')).toHaveValue('UB')
    expect(post(fn, '/api/join')).toBeUndefined()
    fireEvent.change(screen.getByTestId('join-room-input'), { target: { value: 'ub-q1o' } })
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
  ] as const)('the server\'s refusal "%s" is said once, at the code field', async (key, text) => {
    serve({ '/api/join': home[key] })
    join('Bob', 'ABCD')
    const code = screen.getByTestId('join-room-input')
    await waitFor(() => expect(code).toHaveAccessibleDescription(text))
    expect(screen.getAllByText(text)).toHaveLength(1)
    expect(home[key].body.detail).toBe(text)
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('player_id')).toBeNull()
  })

  it('a taken name offers to change it: back on the name step, the name field explains why', async () => {
    serve({ '/api/join': home.join_duplicate_name })
    // Opened from a join link (from the name step, the browser goes back in history instead).
    localStorage.setItem('player_name_last', 'Bob')
    mount('/?join')
    fireEvent.change(screen.getByTestId('join-room-input'), { target: { value: 'ABCD' } })
    fireEvent.click(await screen.findByTestId('join-name-taken-change'))
    const name = screen.getByTestId('name-input')
    expect(name).toHaveValue('Bob')
    expect(name).toHaveFocus()
    expect(name).toHaveAccessibleDescription('That name is taken in this room: pick another')
    // Join again: the code typed before is kept.
    fireEvent.change(name, { target: { value: 'Bobby' } })
    fireEvent.click(screen.getByTestId('join-button'))
    expect(screen.getByTestId('join-room-input')).toHaveValue('ABCD')
  })

  it('a refusal about the room does not offer to change the name', async () => {
    serve({ '/api/join': home.join_unknown_room })
    join('Bob', 'ABCD')
    await waitFor(() =>
      expect(screen.getByTestId('join-room-input')).toHaveAccessibleDescription('Room not found')
    )
    expect(screen.queryByTestId('join-name-taken-change')).not.toBeInTheDocument()
  })

  it('Enter in the room-code field joins', async () => {
    const fn = serve({ '/api/join': home.join })
    mount('/?code=ABCD')
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'Bob' } })
    fireEvent.keyDown(screen.getByTestId('join-room-input'), { key: 'Enter' })
    await waitFor(() => expect(post(fn, '/api/join')).toBeDefined())
    expect(post(fn, '/api/create')).toBeUndefined()
  })

  it('a join link opens the code step with the code filled in; with a name known, one tap joins', async () => {
    localStorage.setItem('player_name_last', 'Ada')
    const fn = serve({ '/api/join': home.join })
    mount('/?code=ubqo')
    expect(screen.getByTestId('join-room-input')).toHaveValue('UBQO')
    expect(screen.getByTestId('join-room-input')).toHaveFocus()
    expect(screen.getByTestId('join-as')).toHaveTextContent('Joining as Ada')
    fireEvent.click(screen.getByTestId('join-submit-button'))
    await waitFor(() => expect(post(fn, '/api/join')).toBeDefined())
    expect(form(fn, '/api/join').get('player_name')).toBe('Ada')
    expect(form(fn, '/api/join').get('room_code')).toBe('UBQO')
  })

  it('a join link with no name known asks the name on the code step', () => {
    const fn = serve({})
    mount('/?code=ABCD')
    expect(screen.getByTestId('name-input')).toHaveValue('')
    fireEvent.click(screen.getByTestId('join-submit-button'))
    expect(screen.getByTestId('name-input')).toHaveAccessibleDescription('Name is required')
    expect(screen.getByTestId('name-input')).toHaveFocus()
    expect(post(fn, '/api/join')).toBeUndefined()
  })

  it('Back returns to the name step', () => {
    serve({})
    mount('/?join')
    fireEvent.click(screen.getByTestId('join-back'))
    expect(screen.getByTestId('create-button')).toBeInTheDocument()
    expect(screen.queryByTestId('join-room-input')).not.toBeInTheDocument()
  })
})

describe('one question at a time', () => {
  it('step one asks only the name, with two choices; the other destinations are quiet links', () => {
    serve({})
    mount()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Your name' })).toBe(
      screen.getByTestId('name-input')
    )
    expect(screen.getAllByText(/your name/i)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'NEW GAME' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'JOIN GAME' })).toBeInTheDocument()
    const more = screen.getByRole('navigation', { name: 'More' })
    expect(more).toContainElement(screen.getByTestId('watch-bots-button'))
    expect(more).toContainElement(screen.getByTestId('games-link'))
    expect(more).toContainElement(screen.getByTestId('bench-link'))
  })

  it('the code step labels its field "Room code"', () => {
    serve({})
    mount('/?join')
    expect(screen.getByRole('textbox', { name: 'Room code' })).toBe(
      screen.getByTestId('join-room-input')
    )
  })

  it('remembers the last name used and offers it again; the join uses the same name', async () => {
    const fn = serve({ '/api/create': home.create, '/api/join': home.join })
    const first = mount()
    create('Ada')
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    first.unmount()
    mount()
    expect(screen.getByTestId('name-input')).toHaveValue('Ada')
    fireEvent.click(screen.getByTestId('join-button'))
    fireEvent.change(screen.getByTestId('join-room-input'), { target: { value: 'ABCD' } })
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
  it('asks for a show, forgets any player seat of this browser, and opens the watch page', async () => {
    sessionStorage.setItem('player_id', 'old')
    sessionStorage.setItem('player_name', 'Old')
    const fn = serve({ '/api/create-show': home.show })
    mount()
    fireEvent.click(screen.getByTestId('watch-bots-button'))
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/host/${home.show.body.room_code}`)
    )
    expect(post(fn, '/api/create-show')![1].method).toBe('POST')
    expect(sessionStorage.getItem('player_id')).toBeNull()
    expect(sessionStorage.getItem('player_name')).toBeNull()
  })

  it('a failure is shown and nothing changes', async () => {
    sessionStorage.setItem('player_id', 'keep')
    serve({ '/api/create-show': { status: 500, body: { detail: 'No room for you' } } })
    mount()
    fireEvent.click(screen.getByTestId('watch-bots-button'))
    await waitFor(() => expect(screen.getByText('No room for you')).toBeInTheDocument())
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('player_id')).toBe('keep')
  })
})
