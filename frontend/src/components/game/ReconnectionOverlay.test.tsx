import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReconnectionOverlay } from './ReconnectionOverlay'

function mount(onReconnect: () => Promise<boolean>, props = {}) {
  const onBackToLobby = vi.fn()
  const view = render(
    <ReconnectionOverlay
      connectionStatus="disconnected"
      playerName="Alice"
      onReconnect={onReconnect}
      onBackToLobby={onBackToLobby}
      retryDelayMs={10}
      {...props}
    />
  )
  return { ...view, onBackToLobby }
}

describe('ReconnectionOverlay', () => {
  it('shows nothing while connected', () => {
    mount(vi.fn().mockResolvedValue(true), { connectionStatus: 'connected' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('on a dropped connection it blocks the screen and starts reconnecting at once', async () => {
    const onReconnect = vi.fn().mockResolvedValue(false)
    mount(onReconnect)
    expect(screen.getByRole('dialog', { name: 'RECONNECTING...' })).toBeInTheDocument()
    expect(screen.getByTestId('attempt-count')).toHaveTextContent('Attempt 1/3')
    await waitFor(() => expect(onReconnect).toHaveBeenCalledTimes(1))
  })

  it('keeps trying up to the attempt limit, counting the attempts, then offers a manual rejoin', async () => {
    const onReconnect = vi.fn().mockResolvedValue(false)
    mount(onReconnect, { maxAttempts: 3 })
    await waitFor(() => expect(screen.getByTestId('manual-rejoin')).toBeInTheDocument())
    expect(onReconnect).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('dialog', { name: 'CONNECTION LOST' })).toBeInTheDocument()
    expect(screen.getByTestId('rejoin-button')).toHaveTextContent('REJOIN AS ALICE')
    // It stops by itself: no fourth attempt.
    await new Promise((r) => setTimeout(r, 60))
    expect(onReconnect).toHaveBeenCalledTimes(3)
  })

  it('a thrown error counts as a failed attempt, not a crash', async () => {
    const onReconnect = vi.fn().mockRejectedValue(new Error('socket'))
    mount(onReconnect, { maxAttempts: 2 })
    await waitFor(() => expect(screen.getByTestId('manual-rejoin')).toBeInTheDocument())
    expect(onReconnect).toHaveBeenCalledTimes(2)
  })

  it('REJOIN starts a fresh round of attempts', async () => {
    const onReconnect = vi.fn().mockResolvedValue(false)
    mount(onReconnect, { maxAttempts: 1 })
    await waitFor(() => expect(screen.getByTestId('manual-rejoin')).toBeInTheDocument())
    expect(onReconnect).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('rejoin-button'))
    await waitFor(() => expect(onReconnect).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('manual-rejoin')).toBeInTheDocument())
  })

  it('BACK TO LOBBY leaves the game', async () => {
    const { onBackToLobby } = mount(vi.fn().mockResolvedValue(false), { maxAttempts: 1 })
    await waitFor(() => expect(screen.getByTestId('manual-rejoin')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('back-to-lobby-button'))
    expect(onBackToLobby).toHaveBeenCalledTimes(1)
  })

  it('once the socket is back the overlay goes away and no more attempts are made', async () => {
    const onReconnect = vi.fn().mockResolvedValue(false)
    const { rerender, onBackToLobby } = mount(onReconnect, { maxAttempts: 5, retryDelayMs: 30 })
    await waitFor(() => expect(onReconnect).toHaveBeenCalledTimes(1))
    rerender(
      <ReconnectionOverlay
        connectionStatus="connected"
        onReconnect={onReconnect}
        onBackToLobby={onBackToLobby}
        retryDelayMs={30}
      />
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 100))
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })
})
