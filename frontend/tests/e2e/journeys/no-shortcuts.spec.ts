/**
 * Static guard for tier 4 (TP-005): journey files take no shortcuts.
 *
 * No API or test-mode routes, no Playwright `request` fixture, no `fetch(`, no
 * snapshot loading or room configuration; and every journey starts at the home page.
 */
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const FORBIDDEN: [RegExp, string][] = [
  [/['"`]\/api\//, 'an /api/ URL'],
  [/['"`]\/test\//, 'a /test/ URL'],
  [/\brequest\./, 'the request fixture'],
  [/\bfetch\(/, 'fetch('],
  [/load-snapshot|loadSnapshot/, 'snapshot loading'],
  [/\/configure\b/, 'the /configure route'],
  [/\{\s*request\s*[,}]/, 'the request fixture'],
]

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return files(p)
    return p.endsWith('.ts') && !p.endsWith('no-shortcuts.spec.ts') ? [p] : []
  })
}

test('@ci journeys use the UI only (no API, test-mode routes, snapshots or fetch)', () => {
  const problems: string[] = []
  for (const file of files(DIR)) {
    const text = fs.readFileSync(file, 'utf8')
    for (const [re, what] of FORBIDDEN) {
      if (re.test(text)) problems.push(`${path.relative(DIR, file)} uses ${what}`)
    }
  }
  expect(problems).toEqual([])
})

test('@ci every journey starts at the home page', () => {
  const specs = files(DIR).filter((f) => f.endsWith('.spec.ts'))
  expect(specs.length).toBeGreaterThanOrEqual(7)
  for (const spec of specs) {
    const text = fs.readFileSync(spec, 'utf8')
    const first = text.match(/\b(createGame|openHome|goto)\(([^)]*)/)
    expect(first, `${path.basename(spec)} never navigates`).not.toBeNull()
    const ok = first![1] !== 'goto' || /^['"`]\/['"`]$/.test(first![2].trim())
    expect(ok, `${path.basename(spec)} first navigates with ${first![0]}`).toBe(true)
  }
})
