import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Toast } from './Toast'
import { ToastProvider } from './ToastProvider'
import { useToast } from './useToast'

describe('Toast', () => {
  const defaultProps = {
    id: 'test-toast',
    message: 'Test message',
    type: 'info' as const,
    onDismiss: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders message', () => {
    render(<Toast {...defaultProps} />)
    expect(screen.getByText('Test message')).toBeInTheDocument()
  })

  it('has alert role for accessibility', () => {
    render(<Toast {...defaultProps} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('renders correct icon for info type', () => {
    render(<Toast {...defaultProps} type="info" />)
    expect(screen.getByText('ℹ')).toBeInTheDocument()
  })

  it('renders correct icon for success type', () => {
    render(<Toast {...defaultProps} type="success" />)
    expect(screen.getByText('✓')).toBeInTheDocument()
  })

  it('renders correct icon for warning type', () => {
    render(<Toast {...defaultProps} type="warning" />)
    expect(screen.getByText('⚠')).toBeInTheDocument()
  })

  it('renders correct icon for error type', () => {
    render(<Toast {...defaultProps} type="error" />)
    expect(screen.getByText('✕')).toBeInTheDocument()
  })

  it('calls onDismiss with id when dismiss clicked', () => {
    render(<Toast {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Dismiss notification'))
    expect(defaultProps.onDismiss).toHaveBeenCalledWith('test-toast')
  })

  it('applies correct class for info type', () => {
    const { container } = render(<Toast {...defaultProps} type="info" />)
    // CSS modules hash class names, so check for partial match
    expect((container.firstChild as HTMLElement).className).toMatch(/info/i)
  })

  it('applies correct class for success type', () => {
    const { container } = render(<Toast {...defaultProps} type="success" />)
    expect((container.firstChild as HTMLElement).className).toMatch(/success/i)
  })

  it('applies correct class for warning type', () => {
    const { container } = render(<Toast {...defaultProps} type="warning" />)
    expect((container.firstChild as HTMLElement).className).toMatch(/warning/i)
  })

  it('applies correct class for error type', () => {
    const { container } = render(<Toast {...defaultProps} type="error" />)
    expect((container.firstChild as HTMLElement).className).toMatch(/error/i)
  })
})

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Helper component to trigger toasts
  function ToastTrigger({
    type = 'info',
    duration,
    message = 'Test toast',
  }: {
    type?: 'info' | 'success' | 'warning' | 'error'
    duration?: number
    message?: string
  }) {
    const { toast } = useToast()
    return <button onClick={() => toast(message, type, duration)}>Show Toast</button>
  }

  it('shows toast when triggered', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('Show Toast'))
    expect(screen.getByText('Test toast')).toBeInTheDocument()
  })

  it('auto-dismisses after duration', () => {
    render(
      <ToastProvider>
        <ToastTrigger duration={3000} />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('Show Toast'))
    expect(screen.getByText('Test toast')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('Test toast')).not.toBeInTheDocument()
  })

  it('uses default 5s duration when not specified', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('Show Toast'))
    expect(screen.getByText('Test toast')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expect(screen.getByText('Test toast')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText('Test toast')).not.toBeInTheDocument()
  })

  it('does not auto-dismiss when duration is 0', () => {
    render(
      <ToastProvider>
        <ToastTrigger duration={0} />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('Show Toast'))
    expect(screen.getByText('Test toast')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(10000)
    })

    expect(screen.getByText('Test toast')).toBeInTheDocument()
  })

  it('stacks multiple toasts', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Toast 1" />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('Show Toast'))
    fireEvent.click(screen.getByText('Show Toast'))

    const toasts = screen.getAllByRole('alert')
    expect(toasts).toHaveLength(2)
  })

  it('removes toast when dismissed manually', () => {
    render(
      <ToastProvider>
        <ToastTrigger duration={0} />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('Show Toast'))
    expect(screen.getByText('Test toast')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Dismiss notification'))
    expect(screen.queryByText('Test toast')).not.toBeInTheDocument()
  })

  it('creates toast with correct type', () => {
    render(
      <ToastProvider>
        <ToastTrigger type="error" />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('Show Toast'))

    const toast = screen.getByRole('alert')
    // CSS modules hash class names, so check for partial match
    expect(toast.className).toMatch(/error/i)
  })

  it('throws error when useToast is used outside provider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function BadComponent() {
      useToast()
      return null
    }

    expect(() => render(<BadComponent />)).toThrow('useToast must be used within ToastProvider')

    consoleSpy.mockRestore()
  })
})
