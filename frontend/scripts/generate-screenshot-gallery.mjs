#!/usr/bin/env node
/**
 * Screenshot Gallery Generator (ST-010)
 *
 * Builds a static HTML gallery from the screenshots the scenario tests write
 * to test-results/scenarios/<category>/<test-name>/NN-step.png, and drops it
 * into the Playwright HTML report directory so it ships with the same CI
 * artifact.
 *
 * Usage (from frontend/): node scripts/generate-screenshot-gallery.mjs
 *
 * Plain Node, no dependencies.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_ROOT = path.resolve(__dirname, '..')
const SCENARIOS_DIR = path.join(FRONTEND_ROOT, 'test-results', 'scenarios')
const OUTPUT_DIR = path.join(FRONTEND_ROOT, 'playwright-report')
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'screenshot-gallery.html')

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Recursively collect { dir (relative), pngs: [names] } groups that contain PNGs. */
function collectGroups(root) {
  const groups = []
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const pngs = entries
      .filter((e) => e.isFile() && e.name.endsWith('.png'))
      .map((e) => e.name)
      .sort()
    if (pngs.length > 0) {
      groups.push({ dir: path.relative(root, dir) || '.', pngs })
    }
    for (const e of entries.filter((e) => e.isDirectory())) {
      walk(path.join(dir, e.name))
    }
  }
  walk(root)
  groups.sort((a, b) => a.dir.localeCompare(b.dir))
  return groups
}

function main() {
  const groups = fs.existsSync(SCENARIOS_DIR) ? collectGroups(SCENARIOS_DIR) : []
  const totalShots = groups.reduce((n, g) => n + g.pngs.length, 0)

  const sections = groups
    .map((group) => {
      const [category, ...rest] = group.dir.split(path.sep)
      const testName = rest.join('/') || '(top level)'
      const shots = group.pngs
        .map((png) => {
          // Relative from playwright-report/ to test-results/scenarios/...
          const rel = path.posix.join(
            '..',
            'test-results',
            'scenarios',
            ...group.dir.split(path.sep),
            png
          )
          return `
        <figure class="shot">
          <a href="${escapeHtml(rel)}" target="_blank"><img loading="lazy" src="${escapeHtml(rel)}" alt="${escapeHtml(png)}"></a>
          <figcaption>${escapeHtml(png)}</figcaption>
        </figure>`
        })
        .join('')
      return `
    <section class="test">
      <h2><span class="category">${escapeHtml(category)}</span> / ${escapeHtml(testName)} <span class="count">(${group.pngs.length})</span></h2>
      <div class="shots">${shots}
      </div>
    </section>`
    })
    .join('\n')

  const body =
    groups.length > 0
      ? sections
      : '<p class="empty">No screenshots found. Run the scenario suite first: <code>npx playwright test --project=scenarios</code></p>'

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>E2E Scenario Screenshot Gallery</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #fafafa; color: #222; }
    h1 { margin-top: 0; }
    .meta { color: #666; margin-bottom: 24px; }
    .test { margin-bottom: 32px; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; }
    .test h2 { font-size: 15px; margin: 0 0 12px; }
    .category { color: #0b5fa5; }
    .count { color: #999; font-weight: normal; }
    .shots { display: flex; flex-wrap: wrap; gap: 12px; }
    .shot { margin: 0; width: 280px; }
    .shot img { width: 100%; border: 1px solid #ccc; border-radius: 4px; background: #fff; }
    figcaption { font-size: 11px; color: #666; word-break: break-all; margin-top: 4px; }
    .empty { color: #a00; }
    code { background: #eee; padding: 2px 4px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>E2E Scenario Screenshot Gallery</h1>
  <p class="meta">${groups.length} test screenshot set(s), ${totalShots} screenshot(s) from <code>test-results/scenarios/</code>.</p>
${body}
</body>
</html>
`

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(OUTPUT_FILE, html)
  console.log(
    `Wrote ${path.relative(FRONTEND_ROOT, OUTPUT_FILE)} (${groups.length} test dirs, ${totalShots} screenshots)`
  )
}

main()
