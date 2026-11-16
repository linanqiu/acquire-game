/**
 * Layout checks for the game pages (BL-007, BL-008): nothing leaves the screen, nothing
 * overlaps, and the page itself does not scroll (the tab panels scroll inside themselves).
 */
import { expect, type Page } from '@playwright/test'

export interface FitOptions {
  /** Also require every box to lie fully inside the viewport vertically. Default true. */
  vertical?: boolean
  /** Also require that the page does not scroll vertically. Default true. */
  noPageScroll?: boolean
}

/**
 * Problems with the boxes of the given test ids (missing or hidden ids are skipped): a box
 * leaving the screen, two boxes overlapping, the page scrolling sideways (or up and down).
 */
export async function layoutProblems(
  page: Page,
  ids: string[],
  opts: FitOptions = {}
): Promise<string[]> {
  const { vertical = true, noPageScroll = true } = opts
  return page.evaluate(
    ({ ids, vertical, noPageScroll }) => {
      const root = document.documentElement
      const width = root.clientWidth
      const height = root.clientHeight
      const out: string[] = []
      if (root.scrollWidth > width)
        out.push(`page scrolls sideways (${root.scrollWidth} > ${width})`)
      if (noPageScroll && root.scrollHeight > height + 1)
        out.push(`page scrolls vertically (${root.scrollHeight} > ${height})`)
      const boxes = ids
        .map((id) => {
          const el = document.querySelector(`[data-testid="${id}"]`)
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { id, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
        })
        .filter((b): b is NonNullable<typeof b> => b !== null && b.right > b.left)
      for (const b of boxes) {
        if (b.left < -0.5 || b.right > width + 0.5)
          out.push(
            `${b.id} leaves the screen sideways (${Math.round(b.left)}..${Math.round(b.right)})`
          )
        if (vertical && (b.top < -0.5 || b.bottom > height + 0.5))
          out.push(
            `${b.id} leaves the screen (${Math.round(b.top)}..${Math.round(b.bottom)} of ${height})`
          )
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i], boxes[j]]
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (x > 1 && y > 1) out.push(`${a.id} overlaps ${b.id}`)
        }
      }
      return out
    },
    { ids, vertical, noPageScroll }
  )
}

/** Every element matching `selector` is inside the viewport's width. */
export async function outsideWidth(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const w = document.documentElement.clientWidth
    return Array.from(document.querySelectorAll(sel))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.left < -0.5 || r.right > w + 0.5))
      .map(
        ({ el, r }) =>
          `${el.getAttribute('data-testid')} ${Math.round(r.left)}..${Math.round(r.right)} of ${w}`
      )
  }, selector)
}

export async function expectFits(page: Page, ids: string[], opts: FitOptions = {}) {
  expect(await layoutProblems(page, ids, opts)).toEqual([])
}

/** Every square of the board is inside the viewport (the Board tab shows the full board). */
export async function expectFullBoard(page: Page) {
  const found = await page.evaluate(() => {
    const w = document.documentElement.clientWidth
    const h = document.documentElement.clientHeight
    const squares = Array.from(
      document.querySelectorAll('[data-testid="board"] [data-testid^="tile-"]')
    )
    return {
      count: squares.length,
      outside: squares
        .map((el) => ({ id: el.getAttribute('data-testid'), r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.left < -0.5 || r.top < -0.5 || r.right > w + 0.5 || r.bottom > h + 0.5)
        .map(({ id }) => id),
    }
  })
  expect(found.count, 'board squares').toBeGreaterThan(0)
  expect(found.outside, 'board squares outside the viewport').toEqual([])
}
