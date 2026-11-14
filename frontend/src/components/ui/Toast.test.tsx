import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ToastProvider } from './ToastProvider'
import { useToast } from './useToast'

function Trigger({
  duration,
  message = 'Offer sent to Bob',
  type = 'info',
}: {
  duration?: number
  message?: string
  type?: 'info' | 'success' | 'warning' | 'error'
}) {
  const { toast } = useToast()
  return <button onClick={() => toast(message, type, duration)}>Show Toast</button>
}

const show = (props = {}) => {
  render(
    <ToastProvider>
      <Trigger {...props} />
    </ToastProvider>
  )
  fireEvent.click(screen.getByText('Show Toast'))
}
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

describe('toasts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a toast is announced as an alert and leaves by itself after 5 seconds by default', () => {
    show()
    expect(screen.getByRole('alert')).toHaveTextContent('Offer sent to Bob')
    advance(4999)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    advance(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a given duration replaces the default', () => {
    show({ duration: 3000 })
    advance(2999)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    advance(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a toast with duration 0 stays until the player dismisses it', () => {
    show({ duration: 0 })
    advance(60_000)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Dismiss notification'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('several toasts stack, and dismissing one leaves the others', () => {
    show({ duration: 0 })
    fireEvent.click(screen.getByText('Show Toast'))
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    fireEvent.click(screen.getAllByLabelText('Dismiss notification')[0])
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('using the hook outside the provider fails loudly instead of silently dropping toasts', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Trigger />)).toThrow('useToast must be used within ToastProvider')
    spy.mockRestore()
  })
})
