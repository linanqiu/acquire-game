import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from './Modal'

describe('Modal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    title: 'Test Modal',
    children: <p>Modal content</p>,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.style.overflow = ''
  })

  // Rendering tests
  it('renders when open is true', () => {
    render(<Modal {...defaultProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    render(<Modal {...defaultProps} open={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders title', () => {
    render(<Modal {...defaultProps} />)
    expect(screen.getByText('Test Modal')).toBeInTheDocument()
  })

  it('renders children', () => {
    render(<Modal {...defaultProps} />)
    expect(screen.getByText('Modal content')).toBeInTheDocument()
  })

  // Close behavior tests
  it('calls onClose when close button clicked', () => {
    render(<Modal {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Close modal'))
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Escape pressed', () => {
    render(<Modal {...defaultProps} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop clicked', () => {
    render(<Modal {...defaultProps} />)
    const backdrop = screen.getByTestId('modal-backdrop')
    fireEvent.click(backdrop)
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when clicking inside modal', () => {
    render(<Modal {...defaultProps} />)
    fireEvent.click(screen.getByText('Modal content'))
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })

  it('does not close on Escape when dismissible is false', () => {
    render(<Modal {...defaultProps} dismissible={false} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })

  it('does not show close button when dismissible is false', () => {
    render(<Modal {...defaultProps} dismissible={false} />)
    expect(screen.queryByLabelText('Close modal')).not.toBeInTheDocument()
  })

  it('does not close on backdrop click when dismissible is false', () => {
    render(<Modal {...defaultProps} dismissible={false} />)
    const backdrop = screen.getByTestId('modal-backdrop')
    fireEvent.click(backdrop)
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })

  // Confirm/Cancel tests
  it('renders confirm button when onConfirm and confirmLabel provided', () => {
    const onConfirm = vi.fn()
    render(<Modal {...defaultProps} onConfirm={onConfirm} confirmLabel="OK" />)
    expect(screen.getByText('OK')).toBeInTheDocument()
  })

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn()
    render(<Modal {...defaultProps} onConfirm={onConfirm} confirmLabel="OK" />)
    fireEvent.click(screen.getByText('OK'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('renders cancel button by default', () => {
    render(<Modal {...defaultProps} />)
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('renders cancel button with custom label', () => {
    render(<Modal {...defaultProps} cancelLabel="Dismiss" />)
    expect(screen.getByText('Dismiss')).toBeInTheDocument()
  })

  it('cancel button calls onClose', () => {
    render(<Modal {...defaultProps} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
  })

  // Body scroll lock
  it('locks body scroll when open', () => {
    render(<Modal {...defaultProps} />)
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores body scroll when closed', () => {
    const { rerender } = render(<Modal {...defaultProps} />)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Modal {...defaultProps} open={false} />)
    expect(document.body.style.overflow).toBe('')
  })

  it('restores body scroll on unmount', () => {
    const { unmount } = render(<Modal {...defaultProps} />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  // ARIA tests
  it('has dialog role', () => {
    render(<Modal {...defaultProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('has aria-modal attribute', () => {
    render(<Modal {...defaultProps} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('has aria-labelledby pointing to title', () => {
    render(<Modal {...defaultProps} />)
    const dialog = screen.getByRole('dialog')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    // Verify the ID matches the title element's ID
    const titleElement = screen.getByText('Test Modal')
    expect(titleElement.getAttribute('id')).toBe(labelledBy)
  })

  it('title has id for aria-labelledby', () => {
    render(<Modal {...defaultProps} />)
    const titleElement = screen.getByText('Test Modal')
    expect(titleElement.getAttribute('id')).toBeTruthy()
  })

  // Focus trap tests
  describe('focus trap', () => {
    it('wraps focus from last to first element on Tab', () => {
      const onConfirm = vi.fn()
      render(
        <Modal {...defaultProps} onConfirm={onConfirm} confirmLabel="OK">
          <button>First focusable</button>
        </Modal>
      )

      // Focus the last button (OK/confirm button)
      const okButton = screen.getByText('OK')
      okButton.focus()
      expect(document.activeElement).toBe(okButton)

      // Press Tab - should wrap to first focusable element (close button)
      fireEvent.keyDown(screen.getByTestId('modal-backdrop'), {
        key: 'Tab',
        shiftKey: false,
      })

      // Focus should wrap to first element (close button)
      expect(document.activeElement).toBe(screen.getByLabelText('Close modal'))
    })

    it('wraps focus from first to last element on Shift+Tab', () => {
      const onConfirm = vi.fn()
      render(
        <Modal {...defaultProps} onConfirm={onConfirm} confirmLabel="OK">
          <button>Middle focusable</button>
        </Modal>
      )

      // Focus the first focusable element (close button)
      const closeButton = screen.getByLabelText('Close modal')
      closeButton.focus()
      expect(document.activeElement).toBe(closeButton)

      // Press Shift+Tab - should wrap to last focusable element
      fireEvent.keyDown(screen.getByTestId('modal-backdrop'), {
        key: 'Tab',
        shiftKey: true,
      })

      // Focus should wrap to last element (OK button)
      expect(document.activeElement).toBe(screen.getByText('OK'))
    })

    it('does not prevent default Tab when not on boundary elements', () => {
      const onConfirm = vi.fn()
      render(
        <Modal {...defaultProps} onConfirm={onConfirm} confirmLabel="OK">
          <button>Middle button</button>
        </Modal>
      )

      // Focus a middle element
      const middleButton = screen.getByText('Middle button')
      middleButton.focus()

      // Press Tab - should not prevent default (normal tab behavior)
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
      })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

      screen.getByTestId('modal-backdrop').dispatchEvent(event)

      // preventDefault should not have been called since we're not at a boundary
      expect(preventDefaultSpy).not.toHaveBeenCalled()
    })
  })
})
