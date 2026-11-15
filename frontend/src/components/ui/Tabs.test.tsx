import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TabList, TabPanels, type TabItem } from './Tabs'

function Harness({ tabs, start = 'a' }: { tabs: TabItem[]; start?: string }) {
  const [selected, setSelected] = useState(start)
  return (
    <>
      <TabPanels tabs={tabs} selected={selected} idPrefix="t" />
      <TabList tabs={tabs} selected={selected} onSelect={setSelected} label="Views" idPrefix="t" />
    </>
  )
}

const TABS: TabItem[] = [
  { id: 'a', label: 'Alpha', content: <p>alpha body</p> },
  { id: 'b', label: 'Beta', content: <p>beta body</p>, badge: 3, badgeLabel: '3 unread' },
  { id: 'c', label: 'Gamma', content: (shown) => <p>gamma {shown ? 'shown' : 'hidden'}</p> },
]

describe('Tabs', () => {
  it('has tablist / tab / tabpanel roles wired together, one tab selected', () => {
    render(<Harness tabs={TABS} />)
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    // One tab stop: only the selected tab is in the tab order.
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1])
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent('alpha body')
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0].id)
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id)
  })

  it('switches on click; every panel stays mounted, only the selected one shows', () => {
    render(<Harness tabs={TABS} />)
    fireEvent.click(screen.getByRole('tab', { name: /Gamma/ }))
    expect(screen.getByRole('tab', { name: /Gamma/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('gamma shown')
    expect(screen.getByText('alpha body')).not.toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: /Alpha/ }))
    expect(screen.getByText('gamma hidden')).not.toBeVisible()
  })

  it('arrow keys, Home and End move the selection and the focus, wrapping around', () => {
    render(<Harness tabs={TABS} />)
    const list = screen.getByRole('tablist')
    const tab = (n: RegExp) => screen.getByRole('tab', { name: n })
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(tab(/Beta/)).toHaveAttribute('aria-selected', 'true')
    expect(tab(/Beta/)).toHaveFocus()
    fireEvent.keyDown(list, { key: 'End' })
    expect(tab(/Gamma/)).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(tab(/Alpha/)).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    expect(tab(/Gamma/)).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(list, { key: 'Home' })
    expect(tab(/Alpha/)).toHaveFocus()
    fireEvent.keyDown(list, { key: 'a' })
    expect(tab(/Alpha/)).toHaveAttribute('aria-selected', 'true')
  })

  it('shows count and dot badges, named for screen readers; no badge at zero', () => {
    const tabs: TabItem[] = [
      ...TABS.slice(0, 2),
      { ...TABS[2], badge: 'dot', badgeLabel: 'new result' },
      { id: 'd', label: 'Delta', content: null, badge: 0 },
    ]
    render(<Harness tabs={tabs} />)
    expect(screen.getByTestId('tab-badge-b')).toHaveTextContent('3')
    expect(screen.getByRole('tab', { name: 'Beta (3 unread)' })).toBeInTheDocument()
    expect(screen.getByTestId('tab-badge-c')).toHaveTextContent('')
    expect(screen.getByRole('tab', { name: 'Gamma (new result)' })).toBeInTheDocument()
    expect(screen.queryByTestId('tab-badge-a')).toBeNull()
    expect(screen.queryByTestId('tab-badge-d')).toBeNull()
  })
})
