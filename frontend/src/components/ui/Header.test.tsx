import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Header } from './Header'

describe('Header', () => {
  it('renders logo', () => {
    render(<Header />)
    expect(screen.getByText('ACQUIRE')).toBeInTheDocument()
  })

  it('renders room code when provided', () => {
    render(<Header roomCode="ABCD" />)
    expect(screen.getByText(/ABCD/)).toBeInTheDocument()
  })

  it('does not render room code when not provided', () => {
    render(<Header />)
    expect(screen.queryByText(/Room:/)).not.toBeInTheDocument()
  })

  it('renders cash when provided', () => {
    render(<Header cash={6000} />)
    expect(screen.getByText('$6,000')).toBeInTheDocument()
  })

  it('does not render cash when not provided', () => {
    render(<Header />)
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('renders player name when provided', () => {
    render(<Header playerName="Alice" />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('renders tile pool count when provided', () => {
    render(<Header tilePool={42} />)
    expect(screen.getByText('[42]')).toBeInTheDocument()
  })

  it('renders EMPTY for empty tile pool', () => {
    render(<Header tilePool="EMPTY" />)
    expect(screen.getByText('[EMPTY]')).toBeInTheDocument()
  })

  it('renders all props together', () => {
    render(<Header roomCode="WXYZ" cash={12500} playerName="Bob" tilePool={30} />)
    expect(screen.getByText('ACQUIRE')).toBeInTheDocument()
    expect(screen.getByText(/WXYZ/)).toBeInTheDocument()
    expect(screen.getByText('$12,500')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('[30]')).toBeInTheDocument()
  })
})
