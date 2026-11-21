/**
 * Trading through the Trades tab (BL-021), UI only: the holdings table where an offer starts,
 * the composer that opens in its place, the offers list, and the offers shown in the table
 * panel with my other decisions.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import type { Seat } from './play'
import { openTab } from '../../support/tabs'

export interface TradeSpec {
  /** Partner's display name (as shown in the composer's player buttons). */
  partner: string
  offerStocks?: Record<string, number>
  offerCash?: number
  wantStocks?: Record<string, number>
  wantCash?: number
}

export function tradePanel(page: Page): Locator {
  return page.getByTestId('trade-offers')
}

/** The button of `partner` in the holdings table: a tap starts an offer to them. */
export function startOfferTo(page: Page, partner: string): Locator {
  return page.getByTestId('trade-start').getByRole('button', {
    name: `Start an offer to ${partner}`,
    exact: true,
  })
}

/** Open the Trades tab and the composer on `partner`. Returns the composer. */
export async function openComposer(seat: Seat, partner: string): Promise<Locator> {
  const page = seat.page
  await openTab(page, 'trades', { tap: seat.policy.touch })
  await seat.press(startOfferTo(page, partner))
  const builder = page.getByTestId('trade-builder')
  await expect(builder).toBeVisible()
  await expect(
    builder.locator('[data-testid^="player-select-"]', { hasText: partner })
  ).toHaveAttribute('aria-pressed', 'true')
  return builder
}

/** Put `n` shares of `chain` into one side of the deal: a tap on its chip for each. */
export async function addShares(
  seat: Seat,
  builder: Locator,
  side: 'offer' | 'want',
  chain: string,
  n: number
): Promise<void> {
  for (let i = 0; i < n; i++) await seat.press(builder.getByTestId(`${side}-add-${chain}`))
  await expect(
    builder.getByTestId(`${side}-stock-${chain}`).getByTestId('stepper-value')
  ).toHaveText(String(n))
}

/** Start an offer to the partner, fill it in, send it. Returns the outgoing offer card. */
export async function proposeTrade(seat: Seat, spec: TradeSpec, label: string): Promise<Locator> {
  const page = seat.page
  const builder = await openComposer(seat, spec.partner)
  await seat.shot(`${label}-composer-open`)
  for (const [chain, n] of Object.entries(spec.offerStocks ?? {}))
    await addShares(seat, builder, 'offer', chain, n)
  if (spec.offerCash) await builder.getByTestId('offer-cash-input').fill(String(spec.offerCash))
  for (const [chain, n] of Object.entries(spec.wantStocks ?? {}))
    await addShares(seat, builder, 'want', chain, n)
  if (spec.wantCash) await builder.getByTestId('want-cash-input').fill(String(spec.wantCash))
  seat.log(`propose trade to ${spec.partner}: ${JSON.stringify(spec)}`)
  await seat.shot(`${label}-composer-filled`)
  await seat.press(builder.getByTestId('propose-trade'))
  await expect(builder, 'composer closes once the server confirms the offer').toBeHidden()
  await expect(page.getByText(`Offer sent to ${spec.partner}`).last()).toBeVisible()
  // The outgoing offer may already be answered by a fast AI; return the newest card if any.
  const rows = tradePanel(page).locator('[data-testid^="trade-outgoing-"]')
  seat.log(`outgoing offers: ${await rows.count()}`)
  return rows.last()
}

/** The single incoming offer from `from`: in the table panel, with my other decisions. */
export function incomingFrom(page: Page, from: string): Locator {
  return page
    .getByTestId('trade-incoming')
    .locator('[data-testid^="trade-offer-"]', { hasText: from })
}

export function outgoingTo(page: Page, to: string): Locator {
  return tradePanel(page).locator('[data-testid^="trade-outgoing-"]', { hasText: to })
}
