import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Panel } from './Panel'

describe('Panel', () => {
  it('renders title', () => {
    render(<Panel title="Panel Title">Content</Panel>)
    expect(screen.getByText('Panel Title')).toBeInTheDocument()
  })

  it('renders children', () => {
    render(<Panel title="Title">Panel content</Panel>)
    expect(screen.getByText('Panel content')).toBeInTheDocument()
  })

  it('renders as aside element', () => {
    render(<Panel title="Title">Content</Panel>)
    expect(screen.getByRole('complementary')).toBeInTheDocument()
  })

  it('renders title as heading', () => {
    render(<Panel title="My Panel">Content</Panel>)
    expect(screen.getByRole('heading', { name: 'My Panel' })).toBeInTheDocument()
  })

  it('accepts custom className', () => {
    const { container } = render(
      <Panel title="Title" className="custom-class">
        Content
      </Panel>
    )
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('renders complex children', () => {
    render(
      <Panel title="Settings">
        <ul>
          <li>Option 1</li>
          <li>Option 2</li>
        </ul>
      </Panel>
    )
    expect(screen.getByText('Option 1')).toBeInTheDocument()
    expect(screen.getByText('Option 2')).toBeInTheDocument()
  })
})
