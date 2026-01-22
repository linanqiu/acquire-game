import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserRouter } from 'react-router-dom'
import { LobbyPage } from './LobbyPage'
import { ToastProvider } from '../components/ui/ToastProvider'

// Mock useNavigate - must be at module level for vi.mock hoisting
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// Mock fetch
const mockFetch = vi.fn()

// Helper to render with providers
function renderLobbyPage() {
  return render(
    <BrowserRouter>
      <ToastProvider>
        <LobbyPage />
      </ToastProvider>
    </BrowserRouter>
  )
}

describe('LobbyPage', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockNavigate.mockClear()
    mockFetch.mockReset()
    sessionStorage.clear()
    // Use stubGlobal for proper isolation
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    // Wait for any pending microtasks/promises to flush
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  describe('rendering', () => {
    it('renders the title', () => {
      renderLobbyPage()
      expect(screen.getByText('ACQUIRE')).toBeInTheDocument()
    })

    it('renders subtitle', () => {
      renderLobbyPage()
      expect(
        screen.getByText('A classic board game of hotel chains and mergers')
      ).toBeInTheDocument()
    })

    it('renders game metadata', () => {
      renderLobbyPage()
      expect(screen.getByText(/3-6 players/)).toBeInTheDocument()
      expect(screen.getByText(/~60 min/)).toBeInTheDocument()
    })

    it('renders Create Game form', () => {
      renderLobbyPage()
      expect(screen.getByText('CREATE GAME')).toBeInTheDocument()
      expect(screen.getByTestId('create-name-input')).toBeInTheDocument()
      expect(screen.getByTestId('create-button')).toBeInTheDocument()
    })

    it('renders Join Game form', () => {
      renderLobbyPage()
      expect(screen.getByText('JOIN GAME')).toBeInTheDocument()
      expect(screen.getByTestId('join-name-input')).toBeInTheDocument()
      expect(screen.getByTestId('join-room-input')).toBeInTheDocument()
      expect(screen.getByTestId('join-button')).toBeInTheDocument()
    })
  })

  describe('Create Game validation', () => {
    it('shows error when name is empty', async () => {
      renderLobbyPage()
      const createButton = screen.getByTestId('create-button')
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument()
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('shows error when name is only whitespace', async () => {
      renderLobbyPage()
      const nameInput = screen.getByTestId('create-name-input')
      const createButton = screen.getByTestId('create-button')

      fireEvent.change(nameInput, { target: { value: '   ' } })
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument()
      })
    })
  })

  describe('Join Game validation', () => {
    it('shows error when name is empty', async () => {
      renderLobbyPage()
      const joinButton = screen.getByTestId('join-button')
      const roomInput = screen.getByTestId('join-room-input')

      fireEvent.change(roomInput, { target: { value: 'ABCD' } })
      fireEvent.click(joinButton)

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument()
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('shows error when room code is not 4 characters', async () => {
      renderLobbyPage()
      const nameInput = screen.getByTestId('join-name-input')
      const roomInput = screen.getByTestId('join-room-input')
      const joinButton = screen.getByTestId('join-button')

      fireEvent.change(nameInput, { target: { value: 'Player1' } })
      fireEvent.change(roomInput, { target: { value: 'AB' } })
      fireEvent.click(joinButton)

      await waitFor(() => {
        expect(screen.getByText('Room code must be 4 characters')).toBeInTheDocument()
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('auto-capitalizes room code', () => {
      renderLobbyPage()
      const roomInput = screen.getByTestId('join-room-input') as HTMLInputElement

      fireEvent.change(roomInput, { target: { value: 'abcd' } })

      expect(roomInput.value).toBe('ABCD')
    })
  })

  describe('Create Game submission', () => {
    it('submits create request and navigates on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            room_code: 'WXYZ',
            player_id: 'player-123',
            session_token: 'token-abc',
          }),
      })

      renderLobbyPage()
      const nameInput = screen.getByTestId('create-name-input')
      const createButton = screen.getByTestId('create-button')

      fireEvent.change(nameInput, { target: { value: 'Alice' } })
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: expect.any(URLSearchParams),
        })
      })

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/play/WXYZ?is_host=1')
      })

      expect(sessionStorage.getItem('player_id')).toBe('player-123')
      expect(sessionStorage.getItem('session_token')).toBe('token-abc')
      expect(sessionStorage.getItem('player_name')).toBe('Alice')
    })

    it('shows error on create failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ detail: 'Server error' }),
      })

      renderLobbyPage()
      const nameInput = screen.getByTestId('create-name-input')
      const createButton = screen.getByTestId('create-button')

      fireEvent.change(nameInput, { target: { value: 'Alice' } })
      fireEvent.click(createButton)

      await waitFor(() => {
        // Error shows in both the input field and toast
        expect(screen.getAllByText('Server error').length).toBeGreaterThanOrEqual(1)
      })
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('shows loading state during submission', async () => {
      // Use a promise we can control to avoid async leakage
      let resolvePromise: () => void
      const fetchPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve
      })

      mockFetch.mockImplementation(() =>
        fetchPromise.then(() => ({
          ok: true,
          json: () =>
            Promise.resolve({
              room_code: 'WXYZ',
              player_id: 'player-123',
              session_token: 'token-abc',
            }),
        }))
      )

      renderLobbyPage()
      const nameInput = screen.getByTestId('create-name-input')
      const createButton = screen.getByTestId('create-button')

      fireEvent.change(nameInput, { target: { value: 'Alice' } })
      fireEvent.click(createButton)

      // Button should be disabled during loading
      expect(createButton).toBeDisabled()

      // Resolve and wait to prevent async leakage into subsequent tests
      resolvePromise!()
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalled()
      })
    })
  })

  describe('Join Game submission', () => {
    it('submits join request and navigates on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            room_code: 'WXYZ',
            player_id: 'player-456',
            session_token: 'token-def',
          }),
      })

      renderLobbyPage()
      const nameInput = screen.getByTestId('join-name-input')
      const roomInput = screen.getByTestId('join-room-input')
      const joinButton = screen.getByTestId('join-button')

      fireEvent.change(nameInput, { target: { value: 'Bob' } })
      fireEvent.change(roomInput, { target: { value: 'wxyz' } })
      fireEvent.click(joinButton)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: expect.any(URLSearchParams),
        })
      })

      // Verify form data contains uppercase room code
      const callArgs = mockFetch.mock.calls[0]
      const formData = callArgs[1].body as URLSearchParams
      expect(formData.get('room_code')).toBe('WXYZ')

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/play/WXYZ')
      })

      expect(sessionStorage.getItem('player_id')).toBe('player-456')
      expect(sessionStorage.getItem('session_token')).toBe('token-def')
    })

    it('shows error on join failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ detail: 'Room not found' }),
      })

      renderLobbyPage()
      const nameInput = screen.getByTestId('join-name-input')
      const roomInput = screen.getByTestId('join-room-input')
      const joinButton = screen.getByTestId('join-button')

      fireEvent.change(nameInput, { target: { value: 'Bob' } })
      fireEvent.change(roomInput, { target: { value: 'ABCD' } })
      fireEvent.click(joinButton)

      await waitFor(() => {
        // Error shows in both the input field and toast
        expect(screen.getAllByText('Room not found').length).toBeGreaterThanOrEqual(1)
      })
      expect(mockNavigate).not.toHaveBeenCalled()
    })
  })

  describe('keyboard interactions', () => {
    it('submits create form on Enter key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            room_code: 'WXYZ',
            player_id: 'player-123',
            session_token: 'token-abc',
          }),
      })

      renderLobbyPage()
      const nameInput = screen.getByTestId('create-name-input')

      fireEvent.change(nameInput, { target: { value: 'Alice' } })
      fireEvent.keyDown(nameInput, { key: 'Enter' })

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })
    })

    it('submits join form on Enter key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            room_code: 'WXYZ',
            player_id: 'player-456',
            session_token: 'token-def',
          }),
      })

      renderLobbyPage()
      const nameInput = screen.getByTestId('join-name-input')
      const roomInput = screen.getByTestId('join-room-input')

      fireEvent.change(nameInput, { target: { value: 'Bob' } })
      fireEvent.change(roomInput, { target: { value: 'WXYZ' } })
      fireEvent.keyDown(roomInput, { key: 'Enter' })

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })
    })
  })
})
