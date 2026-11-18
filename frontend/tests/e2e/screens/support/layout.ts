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

/**
 * Every box on the page that scrolls inside itself (BL-019): overflow auto or scroll and more
 * content than room, up and down or sideways. The owner does not want a page inside the page:
 * the document is the one scroller, so on the main screens this list is empty, or holds only
 * the boxes named in `allowed` (test ids or class-name fragments, e.g. an open modal sheet).
 */
export async function innerScrollers(page: Page, allowed: string[] = []): Promise<string[]> {
  return page.evaluate((allowed) => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el)
      const y = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1
      const x = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1
      if (!x && !y) continue
      const name =
        el.getAttribute('data-testid') ??
        (typeof el.className === 'string' && el.className ? el.className : el.tagName)
      if (allowed.some((a) => name.includes(a))) continue
      out.push(
        `${name} scrolls ${y ? `${el.scrollHeight}/${el.clientHeight} down` : ''}${x ? ` ${el.scrollWidth}/${el.clientWidth} across` : ''}`
      )
    }
    return out
  }, allowed)
}

/** No box scrolls inside the page (see `innerScrollers`). */
export async function expectNoInnerScroll(page: Page, allowed: string[] = []) {
  expect(await innerScrollers(page, allowed), 'boxes that scroll inside the page').toEqual([])
}

/**
 * A game screen in the BL-019 layout, where the document is the one scroller: the parts that
 * stay put (`frame`: phase bar, dock, tab bar; or board pane and tab list) are on screen and
 * apart; the scrolling content (`content`: a tab panel) is inside the width (it may run under
 * the dock and on below the screen, the page scrolls to it); nothing scrolls sideways; and no
 * box scrolls inside the page.
 */
export async function pageFrameProblems(
  page: Page,
  frame: string[],
  content: string[] = []
): Promise<string[]> {
  return [
    ...(await layoutProblems(page, frame, { noPageScroll: false })),
    ...(await layoutProblems(page, content, { noPageScroll: false, vertical: false })).filter(
      (p) => !p.includes(' overlaps ')
    ),
    ...(await innerScrollers(page)),
  ]
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

/**
 * The containers (overflow other than visible, and the viewport) that cut off part of `sel`, in
 * exact pixels (CI's wider system font and headless shell have clipped a flush button by 0.003px:
 * a viewport ratio alone does not say which box or by how much). Empty when it is whole.
 */
export async function clippedBy(page: Page, sel: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector)
    if (!el) return ['not found']
    const r = el.getBoundingClientRect()
    const out: string[] = []
    const check = (
      name: string,
      b: { left: number; top: number; right: number; bottom: number }
    ) => {
      const cut = [
        ['left', b.left - r.left],
        ['top', b.top - r.top],
        ['right', r.right - b.right],
        ['bottom', r.bottom - b.bottom],
      ].filter(([, d]) => (d as number) > 0)
      if (cut.length)
        out.push(
          `${name} cuts ${cut.map(([s, d]) => `${s} ${(d as number).toFixed(4)}px`).join(', ')}`
        )
    }
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      // The clip box in exact pixels: client sizes are whole numbers, the box is not.
      const b = p.getBoundingClientRect()
      const bw = (side: string) => parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0
      const barX = p.offsetWidth - p.clientWidth - bw('left') - bw('right')
      const barY = p.offsetHeight - p.clientHeight - bw('top') - bw('bottom')
      const name = `${p.getAttribute('data-testid') ?? p.tagName.toLowerCase()}.${p.className}`
      check(`${name} (scroll ${p.scrollLeft},${p.scrollTop})`, {
        left: b.left + bw('left'),
        top: b.top + bw('top'),
        right: b.right - bw('right') - barX,
        bottom: b.bottom - bw('bottom') - barY,
      })
    }
    check('viewport', {
      left: 0,
      top: 0,
      right: document.documentElement.clientWidth,
      bottom: window.innerHeight,
    })
    return out.length ? [`button ${r.left},${r.top},${r.width}x${r.height}`, ...out] : []
  }, sel)
}
