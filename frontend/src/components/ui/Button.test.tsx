import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './Button'

describe('Button', () => {
  it('clicking it runs the handler', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>PLACE TILE</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'PLACE TILE' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disabled does nothing when clicked', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>
    )
    expect(screen.getByRole('button')).toBeDisabled()
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('while loading it shows a spinner instead of its label and cannot be double-clicked', () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        BUY & END TURN
      </Button>
    )
    expect(screen.queryByText('BUY & END TURN')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeDisabled()
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
