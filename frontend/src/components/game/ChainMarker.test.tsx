import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ChainMarker } from './ChainMarker'
import { RulesetScope } from '../../ruleset/RulesetScope'
import { readableText } from '../../lib/ruleset'
import { ALL_RULESETS, CLASSIC, VALLEY } from '../../../tests/unit/fixtures/rulesets'
import type { Ruleset } from '../../types/ruleset'

function renderIn(rs: Ruleset, ui: React.ReactElement) {
  return render(<RulesetScope ruleset={rs}>{ui}</RulesetScope>)
}

describe('ChainMarker', () => {
  describe('icon variant', () => {
    it('shows the abbreviation on the chain colour with a readable foreground', () => {
      renderIn(CLASSIC, <ChainMarker chain="Luxor" variant="icon" />)
      const marker = screen.getByTestId('chain-marker-luxor')
      expect(marker).toHaveTextContent('L')
      expect(marker.style.getPropertyValue('--chain-bg')).toBe('#FFD700')
      expect(marker.style.getPropertyValue('--chain-fg')).toBe(readableText('#FFD700'))
    })

    it('names the chain in its title and accessible name', () => {
      renderIn(VALLEY, <ChainMarker chain="hallucinate" variant="icon" />)
      const marker = screen.getByTestId('chain-marker-hallucinate')
      expect(marker).toHaveAttribute('title', 'Hallucinate.ai')
      expect(screen.getByRole('img', { name: 'Hallucinate.ai' })).toBe(marker)
      expect(marker).toHaveTextContent('HA')
    })
  })

  describe('compact variant (default)', () => {
    it('renders swatch + display name', () => {
      renderIn(VALLEY, <ChainMarker chain="gradient" />)
      const marker = screen.getByTestId('chain-marker-gradient')
      expect(marker).toHaveTextContent('GL')
      expect(marker).toHaveTextContent('Gradient Labs')
    })

    it("shows the ruleset's safe phrase when safe", () => {
      renderIn(VALLEY, <ChainMarker chain="latent" safe />)
      expect(screen.getByText(VALLEY.theme.safe_phrase)).toBeInTheDocument()
    })

    it('shows no safe badge when not safe', () => {
      renderIn(CLASSIC, <ChainMarker chain="Tower" />)
      expect(screen.queryByText('safe')).not.toBeInTheDocument()
    })
  })

  describe('full variant', () => {
    it('shows name, size, price (ruleset currency) and stock left', () => {
      renderIn(
        CLASSIC,
        <ChainMarker chain="Continental" variant="full" size={12} price={1200} available={8} safe />
      )
      const marker = screen.getByTestId('chain-marker-continental')
      expect(marker).toHaveTextContent('Continental')
      expect(marker).toHaveTextContent('12 tiles')
      expect(marker).toHaveTextContent('$1,200')
      expect(marker).toHaveTextContent('[8]')
      expect(marker).toHaveTextContent('safe')
    })

    it('omits what is not provided', () => {
      renderIn(CLASSIC, <ChainMarker chain="Imperial" variant="full" />)
      const marker = screen.getByTestId('chain-marker-imperial')
      expect(marker).not.toHaveTextContent('tiles')
      expect(marker).not.toHaveTextContent('$')
    })
  })

  describe('every chain of every shipped ruleset', () => {
    for (const [name, rs] of Object.entries(ALL_RULESETS)) {
      it(`${name}: name, abbreviation and colour come from the ruleset`, () => {
        for (const c of rs.chains) {
          const { unmount } = renderIn(rs, <ChainMarker chain={c.id} variant="compact" />)
          const marker = screen.getByTestId(`chain-marker-${c.id.toLowerCase()}`)
          expect(marker).toHaveTextContent(c.name)
          expect(marker).toHaveTextContent(c.abbreviation)
          const swatch = marker.firstElementChild as HTMLElement
          expect(swatch.style.getPropertyValue('--chain-bg')).toBe(c.color)
          unmount()
        }
      })
    }
  })

  it('still renders an id the ruleset does not know (its id is its name)', () => {
    renderIn(VALLEY, <ChainMarker chain="Mystery" />)
    expect(screen.getByTestId('chain-marker-mystery')).toHaveTextContent('Mystery')
  })
})
