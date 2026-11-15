/**
 * Trading through the TRADES panel and the Propose Trade modal, UI only.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import type { Seat } from './play'

export interface TradeSpec {
  /** Partner's display name (as shown in the builder's TRADE WITH list). */
  partner: string
  offerStocks?: Record<string, number>
  offerCash?: number
  wantStocks?: Record<string, number>
  wantCash?: number
}

export function tradePanel(page: Page): Locator {
  return page.getByTestId('trade-offers')
}

/** Open the builder from the TRADES panel, fill it in, PROPOSE. Returns the outgoing offer row. */
export async function proposeTrade(seat: Seat, spec: TradeSpec, label: string): Promise<Locator> {
  const page = seat.page
  const panel = tradePanel(page)
  await expect(panel).toBeVisible()
  const outgoingBefore = await panel.locator('[data-testid^="trade-outgoing-"]').count()
  await seat.press(panel.getByRole('button', { name: 'PROPOSE TRADE' }))
  const builder = page.getByTestId('trade-builder')
  await expect(builder).toBeVisible()
  await seat.shot(`${label}-builder-open`)
  await seat.press(builder.locator('[data-testid^="player-select-"]', { hasText: spec.partner }))
  await expect(builder.getByText(`YOU WANT FROM ${spec.partner.toUpperCase()}:`)).toBeVisible()
  for (const [chain, n] of Object.entries(spec.offerStocks ?? {})) {
    const row = builder.getByTestId(`offer-stock-${chain}`)
    for (let i = 0; i < n; i++) await seat.press(row.getByTestId('stepper-increment'))
    await expect(row.getByTestId('stepper-value')).toHaveText(String(n))
  }
  if (spec.offerCash) await builder.getByTestId('offer-cash-input').fill(String(spec.offerCash))
  for (const [chain, n] of Object.entries(spec.wantStocks ?? {})) {
    const row = builder.getByTestId(`want-stock-${chain}`)
    for (let i = 0; i < n; i++) await seat.press(row.getByTestId('stepper-increment'))
    await expect(row.getByTestId('stepper-value')).toHaveText(String(n))
  }
  if (spec.wantCash) await builder.getByTestId('want-cash-input').fill(String(spec.wantCash))
  seat.log(`propose trade to ${spec.partner}: ${JSON.stringify(spec)}`)
  await seat.shot(`${label}-builder-filled`)
  await seat.press(builder.getByTestId('propose-trade'))
  await expect(builder, 'builder closes once the server confirms the offer').toBeHidden()
  await expect(page.getByText(`Offer sent to ${spec.partner}`).last()).toBeVisible()
  // The outgoing offer may already be answered by a fast AI; return the newest row if any.
  const rows = panel.locator('[data-testid^="trade-outgoing-"]')
  seat.log(`outgoing offers: ${outgoingBefore} -> ${await rows.count()}`)
  return rows.last()
}

/** The single incoming offer from `from` in the TRADES panel. */
export function incomingFrom(page: Page, from: string): Locator {
  return tradePanel(page).locator('[data-testid^="trade-offer-"]', { hasText: from })
}

export function outgoingTo(page: Page, to: string): Locator {
  return tradePanel(page).locator('[data-testid^="trade-outgoing-"]', { hasText: to })
}
