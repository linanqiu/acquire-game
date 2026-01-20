import { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import styles from './Modal.module.css'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm?: () => void
  dismissible?: boolean
  children: React.ReactNode
}

export function Modal({
  open,
  onClose,
  title,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  dismissible = true,
  children,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<Element | null>(null)

  // Focus management and body scroll lock
  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement
      modalRef.current?.focus()
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus()
      }
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // Keyboard event handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        onClose()
      }

      // Focus trap
      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        const firstElement = focusableElements[0] as HTMLElement
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault()
          lastElement?.focus()
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault()
          firstElement?.focus()
        }
      }
    },
    [onClose, dismissible]
  )

  // Backdrop click handler
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && dismissible) {
        onClose()
      }
    },
    [onClose, dismissible]
  )

  if (!open) return null

  const showFooter = onConfirm || cancelLabel

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      data-testid="modal-backdrop"
    >
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 id="modal-title" className={styles.title}>
            {title}
          </h2>
          {dismissible && (
            <button className={styles.closeButton} onClick={onClose} aria-label="Close modal">
              ×
            </button>
          )}
        </div>
        <div className={styles.body}>{children}</div>
        {showFooter && (
          <div className={styles.footer}>
            {cancelLabel && dismissible && (
              <Button variant="secondary" onClick={onClose}>
                {cancelLabel}
              </Button>
            )}
            {onConfirm && confirmLabel && (
              <Button variant="primary" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
