#!/usr/bin/env node
/**
 * Scenario Coverage Report Generator (ST-010)
 *
 * Inventories the E2E scenario tests in frontend/tests/e2e/scenarios/ and maps
 * them against the canonical scenario catalog defined in the Epic 07 story
 * docs (ST-002..ST-009), producing docs/tests/scenario-coverage.md.
 *
 * Usage:
 *   node scripts/generate-scenario-coverage.mjs           # (re)generate the report
 *   node scripts/generate-scenario-coverage.mjs --check   # CI mode: verify the
 *       committed report is up to date and that no scenario test uses
 *       test.skip / test.fixme. Exits non-zero on violation.
 *
 * The script is plain Node (no dependencies) so it can run before `npm ci`.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const STORIES_DIR = path.join(REPO_ROOT, 'docs', 'roadmap', 'stories', '07-scenario-tests')
const SPECS_DIR = path.join(REPO_ROOT, 'frontend', 'tests', 'e2e', 'scenarios')
const OUTPUT_FILE = path.join(REPO_ROOT, 'docs', 'tests', 'scenario-coverage.md')

/** Category number -> { name, storyDoc } (the story doc whose matrix defines the scenario IDs). */
const CATEGORIES = {
  1: { name: 'Turn Flow', story: 'ST-002' },
  2: { name: 'Trading', story: 'ST-003' },
  3: { name: 'Chain Founding', story: 'ST-004' },
  4: { name: 'Chain Expansion', story: 'ST-005' },
  5: { name: 'Mergers', story: 'ST-006' },
  6: { name: 'Stock Purchases', story: 'ST-007' },
  7: { name: 'End Game', story: 'ST-008' },
  8: { name: 'Edge Cases', story: 'ST-009' },
}

/**
 * Curated status/notes for scenarios without a dedicated test, sourced from the
 * completion notes of the shipped stories. Statuses:
 *   deferred - story explicitly deferred it (with reason)
 *   na       - story marked it not applicable to the current engine
 *   indirect - story records coverage via overlap in broader tests (no dedicated test)
 * Entries without a status only attach a note to a directly covered scenario.
 */
const ANNOTATIONS = {
  '1.5': { status: 'deferred', note: 'Requires test-setup API to seed specific board states (ST-002)' },
  '1.6': { status: 'deferred', note: 'Requires test-setup API to seed specific board states (ST-002)' },
  '1.7': { status: 'deferred', note: 'Requires test-setup API to seed specific board states (ST-002)' },
  '1.8': { status: 'deferred', note: 'Requires test-setup API to seed specific board states (ST-002)' },
  '1.9': { status: 'deferred', note: 'Turn timer feature not implemented (ST-002)' },
  '2.8': { note: 'Documentation-only test: records current behavior; stale-trade invalidation is not separately asserted' },
  '2.9': { note: 'Documentation-only test: trade timeout feature not implemented' },
  '4.9': { status: 'na', note: 'Expansion animation: not applicable to current game engine (ST-005)' },
  '4.10': { status: 'na', note: 'Simultaneous expansion edge case: not applicable to current game engine (ST-005)' },
  '5.3': { status: 'indirect', note: 'No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests' },
  '5.4': { status: 'indirect', note: 'No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests' },
  '5.6': { status: 'indirect', note: 'No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests' },
  '5.7': { status: 'indirect', note: 'No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests' },
  '5.9': { status: 'indirect', note: 'No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests' },
  '5.10': { status: 'indirect', note: 'No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests' },
  '5.12': { status: 'indirect', note: 'No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests' },
  '5.13': { status: 'indirect', note: 'No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests' },
  '5.14': { status: 'indirect', note: 'Disposition timeout feature not implemented; not separately verified (ST-006 overlap claim)' },
  '5.16': { status: 'indirect', note: 'No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests' },
  '5.17': { status: 'indirect', note: 'No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests' },
  '5.18': { status: 'indirect', note: 'No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests' },
  '5.19': { status: 'indirect', note: 'No dedicated test; ST-006 records overlap coverage via the extended "5.x" merger gameplay tests' },
  '6.9': { note: 'Not covered; ST-007 shipped core scenarios only' },
  '6.10': { note: 'Not covered; ST-007 shipped core scenarios only' },
  '6.11': { note: 'Not covered; ST-007 shipped core scenarios only' },
  '6.13': { note: 'Not covered; ST-007 shipped core scenarios only' },
  '6.16': { note: 'Not covered; ST-007 shipped core scenarios only' },
  '6.17': { note: 'Purchase timeout feature not implemented' },
  '7.1': { status: 'deferred', note: 'Requires specific game states hard to reach with seed-based testing (ST-008)' },
  '7.2': { status: 'deferred', note: 'Requires specific game states hard to reach with seed-based testing (ST-008)' },
  '7.5': { status: 'deferred', note: 'Requires specific game states hard to reach with seed-based testing (ST-008)' },
  '7.6': { status: 'deferred', note: 'Requires specific game states hard to reach with seed-based testing (ST-008)' },
  '7.7': { status: 'deferred', note: 'Requires specific game states hard to reach with seed-based testing (ST-008)' },
  '7.9': { status: 'deferred', note: 'Requires specific game states hard to reach with seed-based testing (ST-008)' },
  '7.10': { status: 'deferred', note: 'Requires specific game states hard to reach with seed-based testing (ST-008)' },
  '7.12': { status: 'deferred', note: 'Requires specific game states hard to reach with seed-based testing (ST-008)' },
  '7.14': { status: 'deferred', note: 'Requires specific game states hard to reach with seed-based testing (ST-008)' },
  '8.7': { note: 'Not covered by shipped edge-case tests (ST-009)' },
  '8.12': { note: 'Not covered by shipped edge-case tests (ST-009)' },
  '8.14': { note: 'Not covered by shipped edge-case tests (ST-009)' },
  '8.15': { note: 'Reconnection scenario not covered by shipped tests (ST-009)' },
  '8.16': { note: 'Reconnection scenario not covered by shipped tests (ST-009)' },
  '8.17': { note: 'Reconnection scenario not covered by shipped tests (ST-009)' },
  '8.18': { note: 'Reconnection scenario not covered by shipped tests (ST-009)' },
  '8.21': { note: 'Requires playing until the tile bag empties; not covered (ST-009)' },
  '8.22': { note: 'Requires playing until the tile bag empties; not covered (ST-009)' },
  '8.23': { note: 'Error-handling scenario not covered by shipped tests (ST-009)' },
  '8.24': { note: 'Error-handling scenario not covered by shipped tests (ST-009)' },
}

const STATUS_LABEL = {
  direct: '✅ covered',
  indirect: '🔶 indirect',
  deferred: '⏳ deferred',
  na: '🚫 n/a',
  missing: '❌ missing',
}

// ---------------------------------------------------------------------------
// Catalog parsing (story doc scenario matrices)
// ---------------------------------------------------------------------------

function parseCatalog() {
  /** @type {Map<string, {id: string, category: number, name: string}>} */
  const catalog = new Map()
  for (const [cat, { story }] of Object.entries(CATEGORIES)) {
    const docPath = path.join(STORIES_DIR, `${story}.md`)
    const text = fs.readFileSync(docPath, 'utf8')
    const rowRe = new RegExp(`^\\|\\s*(${cat}\\.\\d+[a-z]?)\\s*\\|([^|]*)\\|`, 'gm')
    let m
    while ((m = rowRe.exec(text)) !== null) {
      const id = m[1]
      if (!catalog.has(id)) {
        catalog.set(id, { id, category: Number(cat), name: m[2].trim() })
      }
    }
  }
  return catalog
}

// ---------------------------------------------------------------------------
// Spec file parsing
// ---------------------------------------------------------------------------

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/** Extract scenario IDs from a test title, expanding ranges like "6.1-6.3". */
function extractScenarioIds(title) {
  const ids = new Set()
  let rest = title
  // Ranges within the same category: "6.1-6.3"
  rest = rest.replace(/(\d+)\.(\d+)\s*-\s*(\d+)\.(\d+)/g, (whole, c1, s1, c2, s2) => {
    if (c1 === c2 && Number(s2) >= Number(s1)) {
      for (let s = Number(s1); s <= Number(s2); s++) ids.add(`${c1}.${s}`)
      return ' '
    }
    return whole
  })
  // Singles: "5.11", "3.4a"
  for (const m of rest.matchAll(/(\d+)\.(\d+[a-z]?)/g)) {
    ids.add(`${m[1]}.${m[2]}`)
  }
  return [...ids]
}

function parseSpecs() {
  const tests = []
  const skipViolations = []
  const specFiles = fs
    .readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort()

  for (const file of specFiles) {
    const filePath = path.join(SPECS_DIR, file)
    const text = fs.readFileSync(filePath, 'utf8')
    const relPath = path.posix.join('frontend', 'tests', 'e2e', 'scenarios', file)

    // Rigor: no skip/fixme annotations allowed in scenario tests
    for (const m of text.matchAll(/\btest\.(skip|fixme|only)\b|\bdescribe\.(skip|fixme|only)\b/g)) {
      skipViolations.push(`${relPath}:${lineOf(text, m.index)} uses ${m[0]}`)
    }

    // Match test('title'), including multi-line first argument
    const testRe = /\btest\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g
    const matches = [...text.matchAll(testRe)]
    matches.forEach((m, i) => {
      const start = m.index
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length
      const body = text.slice(start, end)
      const title = m[2].replace(/\s+/g, ' ').trim()

      let turns = null
      const minTurns = body.match(/MIN_TURNS\s*=\s*(\d+)/)
      if (minTurns) {
        turns = `${minTurns[1]} (min, enforced)`
      } else {
        let bound = null
        for (const t of body.matchAll(/(?:\bturn\s*<=\s*|MAX_TURNS\s*=\s*|maxTurns\s*=\s*)(\d+)/g)) {
          bound = Math.max(bound ?? 0, Number(t[1]))
        }
        if (bound !== null) turns = `up to ${bound} (loop until feature)`
      }
      const screenshots = (body.match(/captureStep\(/g) || []).length
      const seedMatch = body.match(/seed:\s*(\d+)/)
      const seed = seedMatch ? seedMatch[1] : '2 (global ACQUIRE_GAME_SEED)'

      tests.push({
        file: relPath,
        shortFile: file,
        line: lineOf(text, start),
        title,
        scenarioIds: extractScenarioIds(title),
        turns,
        screenshots,
        seed,
      })
    })
  }
  return { tests, skipViolations }
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function buildReport(catalog, tests) {
  // scenario id -> [tests]
  const coverage = new Map()
  for (const test of tests) {
    for (const id of test.scenarioIds) {
      if (!catalog.has(id)) continue // ids not in the catalog are ignored
      if (!coverage.has(id)) coverage.set(id, [])
      coverage.get(id).push(test)
    }
  }

  const rows = []
  for (const scenario of catalog.values()) {
    const covering = coverage.get(scenario.id) ?? []
    const annotation = ANNOTATIONS[scenario.id] ?? {}
    let status
    if (covering.length > 0) status = 'direct'
    else if (annotation.status) status = annotation.status
    else status = 'missing'
    rows.push({ ...scenario, status, tests: covering, note: annotation.note ?? '' })
  }

  const lines = []
  lines.push('# Scenario Test Coverage Report')
  lines.push('')
  lines.push('> **Generated file — do not edit by hand.**')
  lines.push('> Regenerate with: `cd frontend && npm run coverage:scenarios`')
  lines.push('> CI verifies freshness and rigor rules with: `npm run coverage:scenarios:check`')
  lines.push('')
  lines.push('Maps the 124 documented game scenarios (per the Epic 07 story matrices,')
  lines.push('ST-002 through ST-009) to the Playwright E2E tests in')
  lines.push('`frontend/tests/e2e/scenarios/`.')
  lines.push('')

  // --- Summary ---
  lines.push('## Coverage Summary')
  lines.push('')
  lines.push('| Category | Total | Direct | Indirect | Deferred | N/A | Missing | Covered |')
  lines.push('|----------|------:|-------:|---------:|---------:|----:|--------:|--------:|')
  const totals = { total: 0, direct: 0, indirect: 0, deferred: 0, na: 0, missing: 0 }
  for (const [cat, { name }] of Object.entries(CATEGORIES)) {
    const catRows = rows.filter((r) => r.category === Number(cat))
    const count = (s) => catRows.filter((r) => r.status === s).length
    const direct = count('direct')
    const indirect = count('indirect')
    const deferred = count('deferred')
    const na = count('na')
    const missing = count('missing')
    const covered = direct + indirect
    const pct = catRows.length ? Math.round((covered / catRows.length) * 100) : 0
    lines.push(
      `| ${cat}.x ${name} | ${catRows.length} | ${direct} | ${indirect} | ${deferred} | ${na} | ${missing} | ${pct}% |`
    )
    totals.total += catRows.length
    totals.direct += direct
    totals.indirect += indirect
    totals.deferred += deferred
    totals.na += na
    totals.missing += missing
  }
  const totalCovered = totals.direct + totals.indirect
  const totalPct = Math.round((totalCovered / totals.total) * 100)
  lines.push(
    `| **Total** | **${totals.total}** | **${totals.direct}** | **${totals.indirect}** | **${totals.deferred}** | **${totals.na}** | **${totals.missing}** | **${totalPct}%** |`
  )
  lines.push('')
  lines.push('Legend:')
  lines.push('')
  lines.push('- **Direct** (✅): a test names the scenario ID in its title.')
  lines.push('- **Indirect** (🔶): no dedicated test; the owning story records coverage via overlap in broader gameplay tests.')
  lines.push('- **Deferred** (⏳): explicitly deferred by the owning story, with a documented reason.')
  lines.push('- **N/A** (🚫): the owning story marked the scenario not applicable to the current engine.')
  lines.push('- **Missing** (❌): no test and no documented deferral — a visible coverage gap.')
  lines.push('- **Covered %** counts Direct + Indirect over the category total.')
  lines.push('')

  // --- Detailed mapping ---
  lines.push('## Detailed Mapping')
  lines.push('')
  for (const [cat, { name, story }] of Object.entries(CATEGORIES)) {
    const catRows = rows.filter((r) => r.category === Number(cat))
    lines.push(`### ${cat}.x ${name} (${story})`)
    lines.push('')
    lines.push('| ID | Scenario | Test (file:line) | Status | Notes |')
    lines.push('|----|----------|------------------|--------|-------|')
    for (const r of catRows) {
      const testRefs =
        r.tests.length > 0
          ? r.tests.map((t) => `\`${t.shortFile}:${t.line}\``).join('<br>')
          : '—'
      lines.push(
        `| ${r.id} | ${r.name} | ${testRefs} | ${STATUS_LABEL[r.status]} | ${r.note} |`
      )
    }
    lines.push('')
  }

  // --- Gaps ---
  lines.push('## Coverage Gaps')
  lines.push('')
  const missingRows = rows.filter((r) => r.status === 'missing')
  const deferredRows = rows.filter((r) => r.status === 'deferred')
  if (missingRows.length === 0) {
    lines.push('No missing scenarios — every scenario is covered, deferred, or marked N/A.')
  } else {
    lines.push(`**${missingRows.length} scenarios have no test and no documented deferral:**`)
    lines.push('')
    for (const r of missingRows) {
      lines.push(`- ${r.id} ${r.name}${r.note ? ` — ${r.note}` : ''}`)
    }
  }
  lines.push('')
  lines.push(`**${deferredRows.length} scenarios are explicitly deferred** (see notes in the tables above).`)
  lines.push('')

  // --- Rigor inventory ---
  lines.push('## Test Rigor Inventory')
  lines.push('')
  lines.push('Static inventory of every scenario test (heuristics parsed from source):')
  lines.push('')
  lines.push('- **Turns**: from `MIN_TURNS = N` (a hard minimum the test asserts) or the largest')
  lines.push('  `turn <= N` / `MAX_TURNS` loop bound (an upper bound for loop-until-feature tests).')
  lines.push('  — means the test is not turn-based.')
  lines.push('- **Screenshots**: number of `captureStep(...)` call sites in the test body (per-turn loops capture many more at runtime).')
  lines.push('- **Seed**: per-room seed passed via `configureRoom({ seed })`, else the global `ACQUIRE_GAME_SEED=2` from `playwright.config.ts`.')
  lines.push('')
  lines.push('| File:Line | Test | Scenario IDs | Turns | Screenshot calls | Seed |')
  lines.push('|-----------|------|--------------|------:|-----------------:|------|')
  for (const t of tests) {
    const ids = t.scenarioIds.length > 0 ? t.scenarioIds.join(', ') : '—'
    lines.push(
      `| \`${t.shortFile}:${t.line}\` | ${t.title.replaceAll('|', '\\|')} | ${ids} | ${t.turns ?? '—'} | ${t.screenshots} | ${t.seed} |`
    )
  }
  lines.push('')

  // --- Methodology ---
  lines.push('## Methodology & Caveats')
  lines.push('')
  lines.push('- **Scenario numbering source**: the test-matrix tables in the Epic 07 story docs')
  lines.push('  (`docs/roadmap/stories/07-scenario-tests/ST-002.md` … `ST-009.md`), which is the')
  lines.push('  numbering the tests were implemented against. The older specs in')
  lines.push('  `docs/tests/scenario/` use the same categories but different per-ID descriptions;')
  lines.push('  they are not the mapping source for this report.')
  lines.push('- **Direct coverage** is detected by scenario IDs appearing in test titles')
  lines.push('  (including `&`-joined lists and `N.a-N.b` ranges).')
  lines.push('- Rigor columns are static heuristics from test source, not runtime measurements.')
  lines.push('  The tests themselves enforce turn minimums at runtime (they fail if the loop')
  lines.push('  cannot complete).')
  lines.push('- CI (`e2e-scenarios` job) runs the full scenario suite, fails on `test.skip` /')
  lines.push('  `test.fixme` / `test.only`, verifies screenshots were produced, verifies this')
  lines.push('  report is up to date, and publishes the Playwright HTML report plus a')
  lines.push('  screenshot gallery (`playwright-report/screenshot-gallery.html`) as artifacts.')
  lines.push('')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const checkMode = process.argv.includes('--check')

  const catalog = parseCatalog()
  const { tests, skipViolations } = parseSpecs()
  const report = buildReport(catalog, tests)

  let failed = false

  if (skipViolations.length > 0) {
    console.error('RIGOR VIOLATION: scenario tests must not use skip/fixme/only:')
    for (const v of skipViolations) console.error(`  - ${v}`)
    failed = true
  }

  if (checkMode) {
    const existing = fs.existsSync(OUTPUT_FILE) ? fs.readFileSync(OUTPUT_FILE, 'utf8') : null
    if (existing === null) {
      console.error(`STALE: ${path.relative(REPO_ROOT, OUTPUT_FILE)} does not exist.`)
      console.error('Run: cd frontend && npm run coverage:scenarios')
      failed = true
    } else if (existing !== report) {
      console.error(`STALE: ${path.relative(REPO_ROOT, OUTPUT_FILE)} is out of date with the test suite.`)
      console.error('Run: cd frontend && npm run coverage:scenarios  (and commit the result)')
      failed = true
    } else {
      console.log('Coverage report is up to date.')
    }
  } else {
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true })
    fs.writeFileSync(OUTPUT_FILE, report)
    console.log(`Wrote ${path.relative(REPO_ROOT, OUTPUT_FILE)}`)
  }

  console.log(
    `Catalog: ${catalog.size} scenarios | Tests: ${tests.length} | Skip/fixme violations: ${skipViolations.length}`
  )
  if (failed) process.exit(1)
}

main()
