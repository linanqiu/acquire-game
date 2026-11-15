import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from './Modal'

function open(props = {}) {
  const onClose = vi.fn()
  const view = render(
    <Modal open onClose={onClose} title="Propose Trade" {...props}>
      <button>First</button>
      <button>Last</button>
    </Modal>
  )
  return { onClose, ...view }
}

afterEach(() => {
  document.body.style.overflow = ''
})

describe('Modal', () => {
  it('is a labelled dialog while open and absent when closed', () => {
    const { rerender } = open()
    expect(screen.getByRole('dialog', { name: 'Propose Trade' })).toHaveAttribute(
      'aria-modal',
      'true'
    )
    rerender(
      <Modal open={false} onClose={() => {}} title="Propose Trade">
        x
      </Modal>
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes from the close button, Escape, the Cancel button and a click outside, not a click inside', () => {
    const { onClose } = open()
    fireEvent.click(screen.getByText('First'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Close modal'))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByText('Cancel'))
    fireEvent.click(screen.getByTestId('modal-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('a non-dismissible modal (waiting for the connection) cannot be closed by the player', () => {
    const { onClose } = open({ dismissible: false })
    expect(screen.queryByLabelText('Close modal')).not.toBeInTheDocument()
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByTestId('modal-backdrop'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps Tab inside the dialog: from the last control to the first and back', () => {
    open()
    const backdrop = screen.getByTestId('modal-backdrop')
    screen.getByText('Cancel').focus()
    fireEvent.keyDown(backdrop, { key: 'Tab' })
    expect(screen.getByLabelText('Close modal')).toHaveFocus()
    fireEvent.keyDown(backdrop, { key: 'Tab', shiftKey: true })
    expect(screen.getByText('Cancel')).toHaveFocus()
  })

  it('leaves Tab alone between the ends so normal focus order works', () => {
    open()
    screen.getByText('First').focus()
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    screen.getByTestId('modal-backdrop').dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
  })

  it('moves focus into the dialog, locks page scroll, and gives both back on close', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const { rerender } = open()
    expect(screen.getByRole('dialog')).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    rerender(
      <Modal open={false} onClose={() => {}} title="Propose Trade">
        x
      </Modal>
    )
    expect(document.body.style.overflow).toBe('')
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('releases the scroll lock when it is removed while open', () => {
    const { unmount } = open()
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
